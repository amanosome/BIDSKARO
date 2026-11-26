import React from 'react';
import { AuthUserPublic } from '../shared/auctionTypes';
import { useAuctionSocket } from '../hooks/useAuctionSocket';
import { HostDashboard, WorkspaceTab } from './HostDashboard';

export interface ActiveSessionConfig {
  roomCode: string;
  participantId: string;
  participantName: string;
  role: 'host' | 'bidder' | 'spectator';
  teamId?: string;
  initialTab: WorkspaceTab;
}

interface ActiveSessionViewProps {
  session: ActiveSessionConfig;
  authUser: AuthUserPublic | null;
  onExitSession: () => void;
}

export const ActiveSessionView: React.FC<ActiveSessionViewProps> = ({
  session,
  authUser,
  onExitSession,
}) => {
  const socket = useAuctionSocket({
    roomCode: session.roomCode,
    participantId: session.participantId,
    participantName: session.participantName,
    role: session.role,
    teamId: session.teamId,
  });

  const handleResetDemo = async () => {
    await fetch('/api/rooms/DEMO5/reset', { method: 'POST' }).catch(() => {});
    socket.refresh();
  };

  if (socket.loading && !socket.room) {
    return (
      <div className="min-h-screen bg-[#060B18] flex items-center justify-center p-6">
        <div className="text-center space-y-3">
          <div className="text-lg font-display font-bold text-white">
            Connecting to BidsKaro Room {session.roomCode}...
          </div>
          <p className="text-xs text-slate-400">Synchronizing live purse, rules, and timer.</p>
        </div>
      </div>
    );
  }

  if (socket.error && !socket.room) {
    return (
      <div className="min-h-screen bg-[#060B18] flex items-center justify-center p-6">
        <div className="max-w-md w-full rounded-2xl border border-slate-800 bg-[#0D1526] p-6 text-center space-y-4">
          <h2 className="text-lg font-display font-bold text-white">Room Unavailable</h2>
          <p className="text-sm text-red-300">{socket.error}</p>
          <button
            type="button"
            onClick={onExitSession}
            className="rounded-lg bg-emerald-500 px-5 py-2.5 text-xs font-bold text-slate-950"
          >
            Return to BidsKaro Home
          </button>
        </div>
      </div>
    );
  }

  if (!socket.room) {
    return null;
  }

  return (
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
        socket.sendCommand('leave_room', { participantId: session.participantId, autoFinish: true });
        fetch(`/api/rooms/${encodeURIComponent(session.roomCode)}/leave`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ participantId: session.participantId }),
        }).catch(() => {});
        onExitSession();
      }}
      onResetDemo={handleResetDemo}
    />
  );
};
