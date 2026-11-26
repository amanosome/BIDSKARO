import { useCallback, useEffect, useRef, useState } from 'react';
import { AuctionRoomState, BidRecord } from '../shared/auctionTypes';
import {
  dispatchLocalCommand,
  getLocalRoom,
  subscribeLocalRoom,
} from '../services/localAuctionEngine';

interface UseAuctionSocketOptions {
  roomCode: string | null;
  participantId: string;
  participantName: string;
  role: 'host' | 'bidder' | 'spectator';
  teamId?: string;
}

export function useAuctionSocket(options: UseAuctionSocketOptions) {
  const { roomCode, participantId, participantName, role, teamId } = options;
  const [room, setRoom] = useState<AuctionRoomState | null>(null);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bidFeedback, setBidFeedback] = useState<{
    type: 'accepted' | 'rejected';
    message: string;
    timestamp: number;
  } | null>(null);
  const [clockOffsetMs, setClockOffsetMs] = useState(0);
  const [remainingSeconds, setRemainingSeconds] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const isLocalRef = useRef(false);

  const handleEngineMessage = useCallback((msg: Record<string, unknown>) => {
    if (msg.type === 'room_state') {
      if (typeof msg.serverTimeMs === 'number') {
        setClockOffsetMs(msg.serverTimeMs - Date.now());
      }
      setRoom(msg.room as AuctionRoomState);
    } else if (msg.type === 'bid_rejected') {
      setBidFeedback({
        type: 'rejected',
        message: (msg.reason as string) || 'Bid rejected by auction server.',
        timestamp: Date.now(),
      });
    } else if (msg.type === 'bid_accepted') {
      const bid = msg.bid as BidRecord;
      setBidFeedback({
        type: 'accepted',
        message: `Bid accepted for ${bid.teamName}! Countdown reset.`,
        timestamp: Date.now(),
      });
    } else if (msg.type === 'error') {
      setBidFeedback({
        type: 'rejected',
        message: (msg.message as string) || 'Action rejected.',
        timestamp: Date.now(),
      });
    }
  }, []);

  const fetchSnapshot = useCallback(async (code: string): Promise<'server' | 'local' | 'error'> => {
    setLoading(true);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 2000);
    try {
      const res = await fetch(`/api/rooms/${encodeURIComponent(code)}`, { signal: controller.signal });
      const ct = res.headers.get('content-type') || '';
      if (res.ok && ct.includes('application/json')) {
        const data = await res.json();
        if (data.serverTimeMs) {
          setClockOffsetMs(data.serverTimeMs - Date.now());
        }
        setRoom(data.room);
        setError(null);
        isLocalRef.current = false;
        return 'server';
      }
    } catch {
      // fall through to local check
    } finally {
      window.clearTimeout(timeoutId);
    }

    const local = getLocalRoom(code);
    if (local) {
      setClockOffsetMs(local.serverTimeMs - Date.now());
      setRoom(local.room);
      setError(null);
      isLocalRef.current = true;
      setLoading(false);
      return 'local';
    }

    setError('Auction room not found.');
    setLoading(false);
    return 'error';
  }, []);

  useEffect(() => {
    if (!roomCode) {
      setRoom(null);
      setConnected(false);
      isLocalRef.current = false;
      return;
    }

    let disposed = false;
    let failedAttempts = 0;
    let unsubscribeLocal: (() => void) | null = null;

    const connect = () => {
      if (disposed) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (disposed) {
          ws.close();
          return;
        }
        failedAttempts = 0;
        setConnected(true);
        setError(null);
        ws.send(
          JSON.stringify({
            type: 'join_room',
            roomCode,
            participantId,
            name: participantName,
            role,
            teamId,
          })
        );
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          handleEngineMessage(msg);
        } catch {
          // ignore malformed messages
        }
      };

      ws.onerror = () => {
        // Suppress unhandled socket error events
      };

      ws.onclose = () => {
        setConnected(false);
        failedAttempts += 1;
        if (!disposed && failedAttempts < 5) {
          reconnectTimerRef.current = window.setTimeout(connect, 1500);
        }
      };
    };

    fetchSnapshot(roomCode).then((mode) => {
      if (disposed) return;
      setLoading(false);
      if (mode === 'server') {
        connect();
      } else if (mode === 'local') {
        setConnected(true);
        unsubscribeLocal = subscribeLocalRoom(
          roomCode,
          { participantId, name: participantName, role, teamId },
          handleEngineMessage
        );
      }
    });

    return () => {
      disposed = true;
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
      wsRef.current = null;
      unsubscribeLocal?.();
    };
  }, [roomCode, participantId, participantName, role, teamId, fetchSnapshot, handleEngineMessage]);

  // Authoritative synchronized countdown ticker
  useEffect(() => {
    const updateTimer = () => {
      if (!room) {
        setRemainingSeconds(0);
        return;
      }
      if (room.lotStatus === 'paused') {
        setRemainingSeconds(Math.max(0, Math.ceil((room.timerRemainingAtPause || 0) / 1000)));
        return;
      }
      if (room.lotStatus !== 'bidding' || !room.timerDeadlineMs) {
        setRemainingSeconds(0);
        return;
      }
      const serverNow = Date.now() + clockOffsetMs;
      const remMs = Math.max(0, room.timerDeadlineMs - serverNow);
      setRemainingSeconds(Math.ceil(remMs / 1000));
    };

    updateTimer();
    const interval = window.setInterval(updateTimer, 150);
    return () => window.clearInterval(interval);
  }, [room, clockOffsetMs]);

  const sendCommand = useCallback(
    (type: string, payload: Record<string, unknown> = {}) => {
      if (isLocalRef.current && roomCode) {
        return dispatchLocalCommand(
          roomCode,
          participantId,
          type,
          { ...payload, asHost: role === 'host' },
          handleEngineMessage
        );
      }
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        setBidFeedback({
          type: 'rejected',
          message: 'Connecting to live server... please retry in a moment.',
          timestamp: Date.now(),
        });
        return false;
      }
      wsRef.current.send(
        JSON.stringify({
          type,
          roomCode,
          participantId,
          asHost: role === 'host',
          ...payload,
        })
      );
      return true;
    },
    [roomCode, participantId, role, handleEngineMessage]
  );

  const placeBid = useCallback(
    (params: {
      teamId: string;
      amount: number;
      bidType: 'quick' | 'custom' | 'host';
      bidderName?: string;
    }) => {
      const bidRequestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      return sendCommand('place_bid', {
        teamId: params.teamId,
        amount: params.amount,
        bidType: params.bidType,
        bidderName: params.bidderName || participantName,
        expectedSequence: room?.bidSequence ?? 0,
        bidRequestId,
      });
    },
    [sendCommand, participantName, room?.bidSequence]
  );

  const clearFeedback = useCallback(() => setBidFeedback(null), []);

  return {
    room,
    connected,
    loading,
    error,
    remainingSeconds,
    bidFeedback,
    clearFeedback,
    sendCommand,
    placeBid,
    refresh: () => roomCode && fetchSnapshot(roomCode),
  };
}
