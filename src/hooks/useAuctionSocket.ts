import { useCallback, useEffect, useRef, useState } from 'react';
import { AuctionRoomState, BidRecord } from '../shared/auctionTypes';

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

  const fetchSnapshot = useCallback(async (code: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/rooms/${encodeURIComponent(code)}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Auction room not found.');
      }
      const data = await res.json();
      if (data.serverTimeMs) {
        setClockOffsetMs(data.serverTimeMs - Date.now());
      }
      setRoom(data.room);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load auction room.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!roomCode) {
      setRoom(null);
      setConnected(false);
      return;
    }

    let disposed = false;
    fetchSnapshot(roomCode);

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
          if (msg.type === 'room_state') {
            if (typeof msg.serverTimeMs === 'number') {
              setClockOffsetMs(msg.serverTimeMs - Date.now());
            }
            setRoom(msg.room);
          } else if (msg.type === 'bid_rejected') {
            setBidFeedback({
              type: 'rejected',
              message: msg.reason || 'Bid rejected by auction server.',
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
              message: msg.message || 'Action rejected.',
              timestamp: Date.now(),
            });
          }
        } catch {
          // ignore malformed messages
        }
      };

      ws.onerror = () => {
        // Suppress unhandled socket error events
      };

      ws.onclose = () => {
        setConnected(false);
        if (!disposed) {
          reconnectTimerRef.current = window.setTimeout(connect, 1500);
        }
      };
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [roomCode, participantId, participantName, role, teamId, fetchSnapshot]);

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
    [roomCode, participantId, role]
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
