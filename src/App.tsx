import React, { useEffect, useState } from 'react';
import { AuctionRoomState, AuthUserPublic, LeagueId, PlayMode } from './shared/auctionTypes';
import { useAuctionSocket } from './hooks/useAuctionSocket';
import { LandingPage } from './components/LandingPage';
import { HostDashboard, WorkspaceTab } from './components/HostDashboard';
import { CreateRoomModal } from './components/CreateRoomModal';
import { AuthModal } from './components/AuthModal';
import { OfflineIndicator } from './components/PWAInstallButton';
import { getAuthToken, logoutAuth } from './services/authService';
import { joinLocalRoom } from './services/localAuctionEngine';

interface ActiveSession {
  roomCode: string;
  participantId: string;
  participantName: string;
  role: 'host' | 'bidder' | 'spectator';
  teamId?: string;
  initialTab: WorkspaceTab;
}

function getOrCreateClientId(): string {
  try {
    const existing = localStorage.getItem('bidskaro_client_id');
    if (existing) return existing;
    const fresh = `user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    localStorage.setItem('bidskaro_client_id', fresh);
    return fresh;
  } catch {
    return `user-${Date.now()}`;
  }
}

export default function App() {
  const [authUser, setAuthUser] = useState<AuthUserPublic | null>(null);
  const [authModal, setAuthModal] = useState<{
    open: boolean;
    mode: 'login' | 'register' | 'owner';
  }>({ open: false, mode: 'login' });

  const [session, setSession] = useState<ActiveSession | null>(() => {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room')?.toUpperCase().trim();
    if (!roomParam) return null;

    const viewParam = params.get('view');
    const teamParam = params.get('team') || undefined;
    let storedHostId: string | null = null;
    try {
      storedHostId = localStorage.getItem(`bidskaro_host_${roomParam}`);
    } catch {
      storedHostId = null;
    }

    const isHost = Boolean(storedHostId) || (roomParam === 'DEMO5' && viewParam === 'host');
    const participantId = isHost
      ? storedHostId || 'host-demo'
      : getOrCreateClientId();

    const initialTab: WorkspaceTab =
      viewParam === 'tv'
        ? 'tv'
        : viewParam === 'bidder'
          ? 'bidder'
          : viewParam === 'rules'
            ? 'rules'
            : viewParam === 'fantasy'
              ? 'fantasy'
              : viewParam === 'results'
                ? 'results'
                : isHost
                  ? 'host'
                  : 'bidder';

    return {
      roomCode: roomParam,
      participantId,
      participantName: isHost ? 'Auction Host' : 'Team Owner',
      role: isHost ? 'host' : viewParam === 'spectator' ? 'spectator' : 'bidder',
      teamId: teamParam,
      initialTab,
    };
  });

  const [createModal, setCreateModal] = useState<{
    open: boolean;
    leagueId?: LeagueId;
    seasonYear?: string;
    playMode?: PlayMode;
  }>({ open: false });

  const [joinStatusError, setJoinStatusError] = useState<string | null>(null);

  const socket = useAuctionSocket({
    roomCode: session?.roomCode || null,
    participantId: session?.participantId || getOrCreateClientId(),
    participantName: session?.participantName || authUser?.name || 'User',
    role: session?.role || 'bidder',
    teamId: session?.teamId,
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (session?.roomCode) {
      url.searchParams.set('room', session.roomCode);
      if (session.teamId) {
        url.searchParams.set('team', session.teamId);
      } else {
        url.searchParams.delete('team');
      }
      window.history.replaceState({}, '', url.toString());
    } else {
      url.searchParams.delete('room');
      url.searchParams.delete('view');
      url.searchParams.delete('team');
      window.history.replaceState({}, '', url.toString());
    }
  }, [session]);



  const handleResetDemo = async () => {
    await fetch('/api/rooms/DEMO5/reset', { method: 'POST' });
    socket.refresh();
  };

  const handleJoinRoom = async (
    roomCode: string,
    mode: 'bidder' | 'spectator' | 'tv',
    name: string,
    teamId?: string
  ) => {
    setJoinStatusError(null);
    const pid = getOrCreateClientId();
    try {
      let joinedViaServer = false;
      try {
        const res = await fetch(`/api/rooms/${encodeURIComponent(roomCode)}/join`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            participantId: pid,
            name,
            role: mode === 'tv' ? 'spectator' : mode,
            teamId,
          }),
        });
        const ct = res.headers.get('content-type') || '';
        if (res.ok && ct.includes('application/json')) {
          joinedViaServer = true;
        } else if (res.status !== 404 && res.status !== 405 && res.status !== 501 && ct.includes('application/json')) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Room ${roomCode} not found.`);
        }
      } catch (fetchErr) {
        const isNetworkError =
          fetchErr instanceof TypeError ||
          (fetchErr instanceof Error &&
            (fetchErr.message === 'Failed to fetch' ||
              fetchErr.message === 'Load failed' ||
              fetchErr.message.includes('NetworkError')));
        if (!isNetworkError) {
          throw fetchErr;
        }
      }

      let storedHostId: string | null = null;
      try {
        storedHostId = localStorage.getItem(`bidskaro_host_${roomCode}`);
      } catch {
        storedHostId = null;
      }

      if (!joinedViaServer) {
        const localJoined = joinLocalRoom(roomCode, {
          participantId: storedHostId || pid,
          name,
          role: storedHostId ? 'host' : mode === 'tv' ? 'spectator' : mode,
          teamId,
        });
        if (!localJoined) {
          throw new Error(`Room ${roomCode} not found.`);
        }
      }

      setSession({
        roomCode,
        participantId: storedHostId || pid,
        participantName: name,
        role: storedHostId ? 'host' : mode === 'tv' ? 'spectator' : mode,
        teamId,
        initialTab: mode === 'tv' ? 'tv' : storedHostId ? 'host' : 'bidder',
      });
    } catch (err) {
      setJoinStatusError(err instanceof Error ? err.message : 'Unable to join room.');
    }
  };

  const handleCreatedRoom = (roomCode: string, hostId: string, hostName: string) => {
    try {
      localStorage.setItem(`bidskaro_host_${roomCode}`, hostId);
    } catch {
      // ignore storage failure
    }
    setCreateModal({ open: false });
    setSession({
      roomCode,
      participantId: hostId,
      participantName: hostName,
      role: 'host',
      initialTab: 'rules',
    });
  };



  const handleLogout = async () => {
    await logoutAuth();
    setAuthUser(null);
  };

  return (
    <>
      {!session ? (
        <>
          {joinStatusError && (
            <div className="fixed top-20 right-6 z-50 rounded-xl border border-red-500/40 bg-red-950/95 px-4 py-3 text-xs text-red-200 shadow-xl">
              {joinStatusError}
            </div>
          )}
          <LandingPage
            authUser={authUser}
            onOpenAuth={(mode = 'login') => setAuthModal({ open: true, mode })}
            onLogout={handleLogout}
            onOpenCreateRoom={(leagueId, seasonYear, playMode) =>
              setCreateModal({ open: true, leagueId, seasonYear, playMode })
            }
            onJoinRoom={handleJoinRoom}
          />
        </>
      ) : socket.loading && !socket.room ? (
        <div className="min-h-screen bg-[#060B18] flex items-center justify-center p-6">
          <div className="text-center space-y-3">
            <div className="text-lg font-display font-bold text-white">
              Connecting to BidsKaro Room {session.roomCode}...
            </div>
            <p className="text-xs text-slate-400">Synchronizing live purse, rules, and timer.</p>
          </div>
        </div>
      ) : socket.error && !socket.room ? (
        <div className="min-h-screen bg-[#060B18] flex items-center justify-center p-6">
          <div className="max-w-md w-full rounded-2xl border border-slate-800 bg-[#0D1526] p-6 text-center space-y-4">
            <h2 className="text-lg font-display font-bold text-white">Room Unavailable</h2>
            <p className="text-sm text-red-300">{socket.error}</p>
            <button
              type="button"
              onClick={() => setSession(null)}
              className="rounded-lg bg-emerald-500 px-5 py-2.5 text-xs font-bold text-slate-950"
            >
              Return to BidsKaro Home
            </button>
          </div>
        </div>
      ) : socket.room ? (
        <HostDashboard
          room={socket.room}
          participantId={session.participantId}
          participantName={session.participantName}
          isHost={session.role === 'host' || session.participantId === socket.room.hostId}
          isSpectator={session.role === 'spectator'}
          authUser={authUser}
          assignedTeamId={session.teamId}
          initialTab={session.initialTab}
          connected={socket.connected}
          remainingSeconds={socket.remainingSeconds}
          bidFeedback={socket.bidFeedback}
          onClearFeedback={socket.clearFeedback}
          onSendCommand={socket.sendCommand}
          onPlaceBid={socket.placeBid}
          onLeaveRoom={() => {
            if (session?.roomCode) {
              socket.sendCommand('leave_room', { participantId: session.participantId, autoFinish: true });
              fetch(`/api/rooms/${encodeURIComponent(session.roomCode)}/leave`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ participantId: session.participantId }),
              }).catch(() => {});
            }
            setSession(null);
          }}
          onResetDemo={handleResetDemo}
        />
      ) : null}

      {createModal.open && (
        <CreateRoomModal
          initialLeagueId={createModal.leagueId}
          initialSeasonYear={createModal.seasonYear}
          initialPlayMode={createModal.playMode}
          defaultHostName={authUser?.name || 'Auction Host'}
          onClose={() => setCreateModal({ open: false })}
          onCreated={handleCreatedRoom}
        />
      )}

      {authModal.open && (
        <AuthModal
          initialMode={authModal.mode}
          onClose={() => setAuthModal({ open: false, mode: 'login' })}
          onAuthenticated={(user) => {
            setAuthUser(user);
            setAuthModal({ open: false, mode: 'login' });
          }}
        />
      )}

      <OfflineIndicator />
    </>
  );
}
