import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Cpu,
  Eye,
  EyeOff,
  Gavel,
  History,
  Lock,
  Monitor,
  Pause,
  Play,
  Plus,
  QrCode,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  Smartphone,
  SkipForward,
  Star,
  Trophy,
  Undo2,
  Unlock,
  XCircle,
} from 'lucide-react';
import {
  AuctionPlayer,
  AuctionRoomState,
  AuctionRules,
  AuthUserPublic,
  PlayerCategory,
  PlayerRole,
} from '../shared/auctionTypes';
import {
  formatCurrency,
  formatIndianCommas,
  formatShortCurrency,
  LAKH,
  parseCustomBidInput,
} from '../shared/currency';
import { getNextValidBid } from '../shared/rulesEngine';
import { BidsKaroLogo, TeamCrest } from './BidsKaroLogo';
import { AuctionRulesPanel } from './AuctionRulesPanel';
import { MobileBidderView } from './MobileBidderView';
import { BigScreenView } from './BigScreenView';
import { AuctionResultsView } from './AuctionResultsView';
import { QRInviteModal } from './QRInviteModal';
import { PWAInstallButton } from './PWAInstallButton';
import { SeasonFantasyPanel } from './SeasonFantasyPanel';

export type WorkspaceTab = 'host' | 'bidder' | 'tv' | 'rules' | 'fantasy' | 'results';

interface HostDashboardProps {
  room: AuctionRoomState;
  participantId: string;
  participantName: string;
  isHost: boolean;
  isSpectator?: boolean;
  authUser: AuthUserPublic | null;
  assignedTeamId?: string;
  initialTab?: WorkspaceTab;
  connected: boolean;
  remainingSeconds: number;
  bidFeedback: { type: 'accepted' | 'rejected'; message: string; timestamp: number } | null;
  onClearFeedback: () => void;
  onSendCommand: (type: string, payload?: Record<string, unknown>) => boolean;
  onPlaceBid: (params: {
    teamId: string;
    amount: number;
    bidType: 'quick' | 'custom' | 'host';
    bidderName?: string;
  }) => void;
  onLeaveRoom: () => void;
  onResetDemo?: () => void;
}

function formatClockMMSS(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export const HostDashboard: React.FC<HostDashboardProps> = ({
  room,
  participantId,
  participantName,
  isHost,
  isSpectator = false,
  authUser,
  assignedTeamId,
  initialTab = 'host',
  connected,
  remainingSeconds,
  bidFeedback,
  onClearFeedback,
  onSendCommand,
  onPlaceBid,
  onLeaveRoom,
  onResetDemo,
}) => {
  const canActAsHost = isHost || Boolean(room.rules.allBiddersCanHost && !isSpectator);
  const isOwner = authUser?.role === 'owner';
  const isLobbyLocked = room.status === 'lobby';

  const [activeTab, setActiveTab] = useState<WorkspaceTab>(() => {
    if (!canActAsHost && initialTab === 'host') return 'bidder';
    return initialTab;
  });
  const [auctionClockSeconds, setAuctionClockSeconds] = useState(0);
  const [lastSeenSeason, setLastSeenSeason] = useState<number>(room.seasonNumber || 1);

  useEffect(() => {
    if (room.status === 'completed') {
      setActiveTab('results');
    }
  }, [room.status]);

  useEffect(() => {
    const sNum = room.seasonNumber || 1;
    if (sNum > lastSeenSeason) {
      setLastSeenSeason(sNum);
      setActiveTab(canActAsHost ? 'host' : 'bidder');
    }
  }, [room.seasonNumber, lastSeenSeason, canActAsHost]);

  useEffect(() => {
    const tick = () => {
      if (room.status === 'live' && room.auctionEndDeadlineMs > 0) {
        setAuctionClockSeconds(Math.max(0, Math.floor((room.auctionEndDeadlineMs - Date.now()) / 1000)));
      } else {
        setAuctionClockSeconds(0);
      }
    };
    tick();
    const t = window.setInterval(tick, 1000);
    return () => window.clearInterval(t);
  }, [room.status, room.auctionEndDeadlineMs]);
  const [showQR, setShowQR] = useState(false);
  const [hostBidTeamId, setHostBidTeamId] = useState<string>(room.teams[0]?.id || '');
  const [hostCustomBid, setHostCustomBid] = useState<string>('');
  const [verbalTeamId, setVerbalTeamId] = useState<string>(room.teams[0]?.id || '');
  const [verbalAmountInput, setVerbalAmountInput] = useState<string>('');
  const [playerSearch, setPlayerSearch] = useState('');
  const [playerFilter, setPlayerFilter] = useState<'all' | 'upcoming' | 'sold' | 'unsold'>('all');
  const [confirmModal, setConfirmModal] = useState<{
    title: string;
    message: string;
    actionLabel: string;
    variant: 'emerald' | 'red' | 'amber';
    onConfirm: () => void;
  } | null>(null);
  const [showAddPlayer, setShowAddPlayer] = useState(false);
  const [newPlayer, setNewPlayer] = useState({
    name: '',
    country: 'India',
    isOverseas: false,
    role: 'All-Rounder' as PlayerRole,
    category: 'Marquee' as PlayerCategory,
    basePriceLakhs: 50,
  });

  const currentPlayer = useMemo(
    () => (isLobbyLocked ? null : room.players.find((p) => p.id === room.currentPlayerId) || null),
    [room.players, room.currentPlayerId, isLobbyLocked]
  );

  const highestTeam = useMemo(
    () => room.teams.find((t) => t.id === room.highestBidderTeamId) || null,
    [room.teams, room.highestBidderTeamId]
  );

  const hasHighestBidder = Boolean(room.highestBidderTeamId && room.currentBid > 0);
  const nextValidBid = currentPlayer
    ? getNextValidBid(
        room.currentBid,
        hasHighestBidder,
        currentPlayer.basePrice,
        room.rules,
        currentPlayer.category
      )
    : 0;

  const filteredPlayers = useMemo(() => {
    const q = playerSearch.trim().toLowerCase();
    return room.players.filter((p) => {
      if (playerFilter !== 'all' && p.status !== playerFilter) return false;
      if (q && !p.name.toLowerCase().includes(q) && !p.country.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [room.players, playerSearch, playerFilter]);

  const upcomingCount = room.players.filter((p) => p.status === 'upcoming').length;
  const soldCount = room.players.filter((p) => p.status === 'sold').length;

  const handleHostQuickBid = (teamId: string) => {
    const team = room.teams.find((t) => t.id === teamId);
    if (!team) return;
    onPlaceBid({
      teamId,
      amount: nextValidBid,
      bidType: 'host',
      bidderName: `${team.ownerName} (Host)`,
    });
  };

  const handleHostCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const team = room.teams.find((t) => t.id === hostBidTeamId);
    const parsed = parseCustomBidInput(hostCustomBid);
    if (!team || !parsed) return;
    onPlaceBid({
      teamId: team.id,
      amount: parsed,
      bidType: 'custom',
      bidderName: `${team.ownerName} (Host)`,
    });
    setHostCustomBid('');
  };

  const handleVerbalSellSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPlayer || !verbalTeamId) return;
    const parsed = parseCustomBidInput(verbalAmountInput) ?? currentPlayer.basePrice;
    onSendCommand('verbal_sell', {
      teamId: verbalTeamId,
      playerId: currentPlayer.id,
      amount: parsed,
    });
    setVerbalAmountInput('');
  };

  const isSnakeMode = room.rules.buildingMode === 'snake_draft';
  const snakeTurnTeam = useMemo(() => {
    if (!isSnakeMode || !room.teams.length) return null;
    const n = room.teams.length;
    const idx = room.snakeDraftPickIndex;
    const round = Math.floor(idx / n);
    const pos = idx % n;
    const teamIdx = round % 2 === 0 ? pos : n - 1 - pos;
    return room.teams[teamIdx] || null;
  }, [isSnakeMode, room.teams, room.snakeDraftPickIndex]);

  const handleAddPlayerSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlayer.name.trim()) return;
    onSendCommand('add_custom_player', {
      player: {
        name: newPlayer.name.trim(),
        country: newPlayer.country.trim(),
        isOverseas: newPlayer.isOverseas,
        role: newPlayer.role,
        category: newPlayer.category,
        basePrice: newPlayer.basePriceLakhs * LAKH,
      },
    });
    setShowAddPlayer(false);
    setNewPlayer({
      name: '',
      country: 'India',
      isOverseas: false,
      role: 'All-Rounder',
      category: 'Marquee',
      basePriceLakhs: 50,
    });
  };

  // Dedicated Fullscreen Big Screen TV Route
  if (activeTab === 'tv') {
    return (
      <div className="min-h-screen bg-[#040812] p-4 sm:p-6">
        <BigScreenView
          room={room}
          remainingSeconds={remainingSeconds}
          connected={connected}
          onExitTV={() => setActiveTab(canActAsHost ? 'host' : 'bidder')}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#060B18] text-slate-100 flex flex-col">
      {/* Clean 3-Zone Workspace Top Bar */}
      <header className="sticky top-0 z-40 border-b border-slate-800/90 bg-[#060B18]/95 backdrop-blur-md">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <button
              type="button"
              onClick={onLeaveRoom}
              className="hover:opacity-90 transition-opacity"
              title="Back to BidsKaro Home"
            >
              <BidsKaroLogo size="sm" />
            </button>
            <div className="hidden lg:block text-xs text-slate-400 truncate">
              <span className="font-semibold text-white">{room.roomName}</span>
              <span className="mx-2 text-slate-600">·</span>
              <span className="font-mono-tabular text-emerald-400">CODE: {room.roomCode}</span>
              <span className="mx-2 text-slate-600">·</span>
              <span>{connected ? 'Live Sync' : 'Connecting...'}</span>
            </div>
          </div>

          {/* Workspace View Tabs */}
          <nav className="flex items-center gap-1 overflow-x-auto">
            {canActAsHost && (
              <button
                type="button"
                onClick={() => setActiveTab('host')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                  activeTab === 'host'
                    ? 'bg-emerald-500 text-slate-950'
                    : 'text-slate-300 hover:bg-slate-800/70'
                }`}
              >
                <Gavel className="w-3.5 h-3.5" />
                <span>Host Console</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setActiveTab('bidder')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                activeTab === 'bidder'
                  ? 'bg-emerald-500 text-slate-950'
                  : 'text-slate-300 hover:bg-slate-800/70'
              }`}
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span>Mobile Bid</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('tv')}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-amber-300 hover:bg-amber-500/10 whitespace-nowrap shrink-0 transition-colors"
            >
              <Monitor className="w-3.5 h-3.5" />
              <span>Big Screen TV</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('rules')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                activeTab === 'rules'
                  ? 'bg-emerald-500 text-slate-950'
                  : 'text-slate-300 hover:bg-slate-800/70'
              }`}
            >
              <Settings className="w-3.5 h-3.5" />
              <span>Rules</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('fantasy')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                activeTab === 'fantasy'
                  ? 'bg-emerald-500 text-slate-950'
                  : 'text-slate-300 hover:bg-slate-800/70'
              }`}
            >
              <Star className="w-3.5 h-3.5" />
              <span>Fantasy League</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('results')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                activeTab === 'results'
                  ? 'bg-emerald-500 text-slate-950'
                  : 'text-slate-300 hover:bg-slate-800/70'
              }`}
            >
              <Trophy className="w-3.5 h-3.5" />
              <span>Results</span>
            </button>
          </nav>

          {/* Primary Right Action */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="hidden sm:block">
              <PWAInstallButton />
            </div>
            <button
              type="button"
              onClick={() => setShowQR(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20 whitespace-nowrap shrink-0"
            >
              <QrCode className="w-4 h-4" />
              <span className="hidden sm:inline">QR Invite ({room.roomCode})</span>
            </button>
            <button
              type="button"
              onClick={() =>
                setConfirmModal({
                  title: 'Leave Auction Room?',
                  message: 'Are you sure you want to leave this auction room? Your seat can be resumed or handled by AI.',
                  actionLabel: 'Leave Room',
                  variant: 'red',
                  onConfirm: onLeaveRoom,
                })
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-300 hover:bg-red-500/20 whitespace-nowrap shrink-0"
            >
              <span>Leave Room</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 py-6">
        {activeTab === 'rules' && (
          <AuctionRulesPanel
            room={room}
            isHost={canActAsHost}
            onSaveRules={(patch: Partial<AuctionRules>) => onSendCommand('update_rules', { rules: patch })}
            onUpdateTeam={(teamId, patch) => onSendCommand('update_team', { teamId, patch })}
            onConfirmAndStart={() => {
              if (room.status === 'lobby') {
                onSendCommand('start_auction', { playerId: room.currentPlayerId });
              }
              setActiveTab('host');
            }}
          />
        )}

        {activeTab === 'bidder' && (
          <MobileBidderView
            room={room}
            participantId={participantId}
            participantName={participantName}
            isHost={canActAsHost}
            assignedTeamId={assignedTeamId}
            remainingSeconds={remainingSeconds}
            bidFeedback={bidFeedback}
            onClearFeedback={onClearFeedback}
            onSendCommand={onSendCommand}
            onOpenHostControls={canActAsHost ? () => setActiveTab('host') : undefined}
            onPlaceBid={onPlaceBid}
            onLeaveRoom={() =>
              setConfirmModal({
                title: 'Leave Auction Room?',
                message: 'Are you sure you want to leave this auction room? Your seat can be resumed or handled by AI.',
                actionLabel: 'Leave Room',
                variant: 'red',
                onConfirm: onLeaveRoom,
              })
            }
          />
        )}

        {activeTab === 'fantasy' && (
          <SeasonFantasyPanel
            room={room}
            isHost={canActAsHost}
            assignedTeamId={assignedTeamId}
            onSendCommand={onSendCommand}
          />
        )}



        {activeTab === 'results' && (
          <AuctionResultsView room={room} onSendCommand={onSendCommand} />
        )}

        {activeTab === 'host' && canActAsHost && (
          <div className="space-y-6">
            {/* Top Action Strip */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-[#0D1526] px-4 py-3">
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
                <span className="font-semibold text-white">Room {room.roomCode}</span>
                <span className="text-slate-600">·</span>
                <span>{room.leagueId} {room.seasonYear} (S{room.seasonNumber || 1})</span>
                <span className="text-slate-600">·</span>
                <span className="text-amber-300 font-semibold">
                  {room.rules.stackMode === 'season_only' ? 'Season-Only' : 'Lifetime Stacks'}
                </span>
                <span className="text-slate-600">·</span>
                <span className="font-mono-tabular text-emerald-400">
                  {soldCount}/{room.players.length} Sold ({upcomingCount} Upcoming)
                </span>
                <span className="text-slate-600">·</span>
                <span>{room.participants.length} Connected</span>
                {room.rules.aiOpponentsEnabled ? (
                  <span className="inline-flex items-center gap-1 rounded border border-emerald-500/35 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
                    <Cpu className="w-3 h-3" />
                    AI Opponents ON
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded border border-sky-500/35 bg-sky-500/10 px-2 py-0.5 text-[11px] font-semibold text-sky-300">
                    Friends Invite Code
                  </span>
                )}
                {room.status === 'live' && room.auctionEndDeadlineMs > 0 && (
                  <span className="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-mono-tabular font-semibold text-amber-300">
                    <Clock className="w-3 h-3" />
                    Duration Left: {formatClockMMSS(auctionClockSeconds)}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => onSendCommand('toggle_big_screen_publish')}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                    room.bigScreenPublished
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                      : 'border-slate-700 bg-slate-900 text-slate-400'
                  }`}
                >
                  {room.bigScreenPublished ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                  <span>{room.bigScreenPublished ? 'Big Screen Published' : 'Big Screen Hidden'}</span>
                </button>

                {room.isDemo && onResetDemo && (
                  <button
                    type="button"
                    onClick={onResetDemo}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Reset 5-Team Demo</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() =>
                    setConfirmModal({
                      title: 'Complete Auction & Publish Results?',
                      message: 'This marks the auction room as completed and updates the global BidsKaro leaderboard.',
                      actionLabel: 'Complete Auction',
                      variant: 'amber',
                      onConfirm: () => {
                        onSendCommand('complete_auction');
                        setActiveTab('results');
                      },
                    })
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-300 hover:bg-amber-500/20"
                >
                  <Trophy className="w-3.5 h-3.5" />
                  <span>Finish &amp; Publish Results</span>
                </button>
              </div>
            </div>

            {bidFeedback && (
              <div
                className={`rounded-xl border px-4 py-2.5 text-xs flex items-center justify-between ${
                  bidFeedback.type === 'rejected'
                    ? 'border-red-500/40 bg-red-950/50 text-red-200'
                    : 'border-emerald-500/40 bg-emerald-950/50 text-emerald-200'
                }`}
              >
                <span>{bidFeedback.message}</span>
                <button type="button" onClick={onClearFeedback} className="underline ml-3">
                  Dismiss
                </button>
              </div>
            )}

            {/* Main 12-Col Host Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Left 7 Cols: Live Lot Stage, Host Timer Controls, Host-as-Bidder */}
              <div className="lg:col-span-7 space-y-5">
                {/* Active Lot & Hammer Controls */}
                <div className="rounded-2xl border border-slate-800 bg-[#0D1526] p-5 space-y-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="text-xs font-medium text-emerald-400">
                        {room.status === 'lobby'
                          ? 'READY TO START'
                          : room.lotStatus === 'bidding'
                            ? 'LIVE BIDDING'
                            : room.lotStatus === 'paused'
                              ? 'TIMER PAUSED'
                              : room.lotStatus === 'awaiting_hammer'
                                ? 'TIMER EXPIRED — AWAITING HOST HAMMER'
                                : room.lotStatus === 'sold_reveal'
                                  ? 'PLAYER SOLD'
                                  : room.lotStatus === 'unsold_reveal'
                                    ? 'PLAYER UNSOLD'
                                    : 'STANDBY'}
                      </div>
                      <h2 className="mt-1 text-2xl sm:text-3xl font-display font-extrabold text-white">
                        {currentPlayer ? currentPlayer.name : 'Select a Player from Catalog'}
                      </h2>
                      {currentPlayer && (
                        <p className="mt-1 text-xs text-slate-400">
                          {currentPlayer.country} · {currentPlayer.role} · {currentPlayer.category} · Base{' '}
                          <span className="font-mono-tabular text-white">
                            {formatCurrency(currentPlayer.basePrice, room.rules.currency)}
                          </span>
                        </p>
                      )}
                    </div>

                    <div className="text-right">
                      <div className="text-[11px] text-slate-400">COUNTDOWN</div>
                      <div
                        className={`text-5xl font-mono-tabular font-extrabold ${
                          remainingSeconds <= 3 && room.lotStatus === 'bidding'
                            ? 'text-red-400'
                            : remainingSeconds <= 5 && room.lotStatus === 'bidding'
                              ? 'text-orange-400'
                              : 'text-emerald-400'
                        }`}
                      >
                        {room.lotStatus === 'bidding' || room.lotStatus === 'paused'
                          ? `${remainingSeconds}s`
                          : room.lotStatus === 'awaiting_hammer'
                            ? '0s'
                            : `${room.rules.initialTimerSeconds}s`}
                      </div>
                      <div className="text-[11px] text-slate-400 font-mono-tabular">
                        Init {room.rules.initialTimerSeconds}s · Reset {room.rules.resetTimerSeconds}s
                      </div>
                    </div>
                  </div>

                  {/* Current Bid & Leading Team */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="rounded-xl border border-slate-800 bg-[#060B18] p-4">
                      <div className="text-[11px] text-slate-400">
                        {hasHighestBidder ? 'CURRENT HIGHEST BID' : 'OPENING BASE PRICE'}
                      </div>
                      <div className="mt-1 text-2xl font-mono-tabular font-extrabold text-emerald-400">
                        {currentPlayer ? formatCurrency(room.currentBid, room.rules.currency) : '—'}
                      </div>
                      <div className="mt-1 text-xs text-slate-300">
                        Next valid bid: <span className="font-mono-tabular text-amber-300">{formatCurrency(nextValidBid, room.rules.currency)}</span>
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-800 bg-[#060B18] p-4 flex items-center gap-3">
                      {highestTeam ? (
                        <>
                          <TeamCrest
                            shortCode={highestTeam.shortCode}
                            primaryColor={highestTeam.primaryColor}
                            secondaryColor={highestTeam.secondaryColor}
                          />
                          <div className="min-w-0">
                            <div className="text-[11px] text-amber-400 font-semibold">HIGHEST BIDDER</div>
                            <div className="text-base font-bold text-white truncate">{highestTeam.name}</div>
                            <div className="text-xs text-slate-400 truncate">{room.highestBidderName}</div>
                          </div>
                        </>
                      ) : (
                        <div className="text-xs text-slate-500">No valid bid received yet on this player.</div>
                      )}
                    </div>
                  </div>

                  {/* Host Timer & Hammer Controls */}
                  <div className="space-y-2.5 pt-2 border-t border-slate-800">
                    <div className="text-[11px] font-semibold text-slate-400">HOST TIMER &amp; LOT CONTROLS</div>
                    <div className="flex flex-wrap gap-2">
                      {room.status === 'lobby' || room.lotStatus === 'idle' || room.lotStatus === 'sold_reveal' || room.lotStatus === 'unsold_reveal' ? (
                        <button
                          type="button"
                          onClick={() =>
                            onSendCommand(room.status === 'lobby' ? 'start_auction' : 'start_lot', {
                              playerId: room.status === 'lobby' ? room.currentPlayerId : null,
                            })
                          }
                          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2.5 text-xs font-bold text-slate-950 hover:bg-emerald-400"
                        >
                          {room.status === 'lobby' ? <Play className="w-4 h-4" /> : <SkipForward className="w-4 h-4" />}
                          <span>{room.status === 'lobby' ? 'Start Auction & Timer' : 'Next Upcoming Player'}</span>
                        </button>
                      ) : null}

                      {room.lotStatus === 'bidding' && (
                        <button
                          type="button"
                          onClick={() => onSendCommand('pause_timer')}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3.5 py-2 text-xs font-semibold text-amber-300 hover:bg-amber-500/20"
                        >
                          <Pause className="w-3.5 h-3.5" />
                          <span>Pause Timer</span>
                        </button>
                      )}

                      {room.lotStatus === 'paused' && (
                        <button
                          type="button"
                          onClick={() => onSendCommand('resume_timer')}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3.5 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-400"
                        >
                          <Play className="w-3.5 h-3.5" />
                          <span>Resume Timer</span>
                        </button>
                      )}

                      {[5, 10, 15].map((sec) => (
                        <button
                          key={sec}
                          type="button"
                          onClick={() => onSendCommand('extend_timer', { seconds: sec })}
                          className="rounded-lg border border-slate-700 bg-[#060B18] px-3 py-2 text-xs font-mono-tabular font-semibold text-slate-200 hover:border-emerald-500/50"
                        >
                          +{sec}s
                        </button>
                      ))}

                      <button
                        type="button"
                        onClick={() => onSendCommand('reset_timer', { seconds: room.rules.resetTimerSeconds })}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-[#060B18] px-3 py-2 text-xs font-medium text-slate-200 hover:border-slate-500"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Reset ({room.rules.resetTimerSeconds}s)</span>
                      </button>

                      {(room.lotStatus === 'bidding' || room.lotStatus === 'paused') && (
                        <button
                          type="button"
                          onClick={() => onSendCommand('close_bidding_manual')}
                          className="rounded-lg border border-slate-700 bg-[#060B18] px-3 py-2 text-xs font-medium text-slate-200 hover:border-amber-500/50"
                        >
                          Close Bidding Manually
                        </button>
                      )}
                    </div>

                    {/* Critical Hammer & Undo Actions */}
                    <div className="flex flex-wrap gap-2.5 pt-1">
                      <button
                        type="button"
                        disabled={!hasHighestBidder || room.lotStatus === 'sold_reveal' || room.lotStatus === 'unsold_reveal'}
                        onClick={() =>
                          setConfirmModal({
                            title: `Confirm SOLD — ${currentPlayer?.name}`,
                            message: `Sell ${currentPlayer?.name} to ${highestTeam?.name} for ${formatCurrency(room.currentBid, room.rules.currency)}?`,
                            actionLabel: 'Confirm SOLD',
                            variant: 'emerald',
                            onConfirm: () => onSendCommand('mark_sold'),
                          })
                        }
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        <span>MARK SOLD</span>
                      </button>

                      <button
                        type="button"
                        disabled={!currentPlayer || room.lotStatus === 'sold_reveal' || room.lotStatus === 'unsold_reveal'}
                        onClick={() =>
                          setConfirmModal({
                            title: `Confirm UNSOLD — ${currentPlayer?.name}`,
                            message: `Mark ${currentPlayer?.name} as UNSOLD and pass this lot?`,
                            actionLabel: 'Confirm UNSOLD',
                            variant: 'red',
                            onConfirm: () => onSendCommand('mark_unsold'),
                          })
                        }
                        className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/40 bg-red-500/15 px-4 py-2.5 text-xs font-bold text-red-300 hover:bg-red-500/25 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <XCircle className="w-4 h-4" />
                        <span>MARK UNSOLD</span>
                      </button>

                      <button
                        type="button"
                        disabled={room.undoStackCount === 0}
                        onClick={() =>
                          setConfirmModal({
                            title: 'Undo Last Auction Action?',
                            message: 'Revert the previous bid or SOLD/UNSOLD decision and restore team purses?',
                            actionLabel: 'Undo Action',
                            variant: 'amber',
                            onConfirm: () => onSendCommand('undo_last_action'),
                          })
                        }
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#060B18] px-3.5 py-2.5 text-xs font-semibold text-slate-200 hover:border-amber-500/50 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Undo2 className="w-4 h-4" />
                        <span>Undo ({room.undoStackCount})</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Snake Draft Clock OR Verbal Table Sell Dock */}
                {isSnakeMode && snakeTurnTeam && (
                  <div className="rounded-2xl border border-amber-500/40 bg-[#0D1526] p-5 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-xs font-bold text-amber-300">
                          SNAKE DRAFT MODE · ROUND {room.snakeDraftRound} · PICK #{room.snakeDraftPickIndex + 1}
                        </div>
                        <div className="text-sm font-bold text-white mt-0.5">
                          On the Clock: {snakeTurnTeam.name} ({formatShortCurrency(snakeTurnTeam.remainingPurse, room.rules.currency)})
                        </div>
                      </div>
                      {currentPlayer && currentPlayer.status !== 'sold' && (
                        <button
                          type="button"
                          onClick={() =>
                            onSendCommand('snake_draft_pick', {
                              teamId: snakeTurnTeam.id,
                              playerId: currentPlayer.id,
                            })
                          }
                          className="rounded-xl bg-emerald-500 px-4 py-2.5 text-xs font-bold text-slate-950 hover:bg-emerald-400"
                        >
                          Draft {currentPlayer.name} ({formatShortCurrency(currentPlayer.basePrice, room.rules.currency)})
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Verbal Table Bidding Quick-Sell Dock */}
                <form
                  onSubmit={handleVerbalSellSubmit}
                  className="rounded-2xl border border-slate-800 bg-[#0D1526] p-5 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-bold text-white">
                        Verbal Table Sell (Direct Floor Entry)
                      </h3>
                      <p className="text-xs text-slate-400">
                        Log a verbal floor bid/sale directly for {currentPlayer?.name || 'selected player'}.
                      </p>
                    </div>
                    {room.rules.biddingStyle === 'verbal' && (
                      <span className="text-[11px] font-bold text-amber-300">VERBAL MODE ON</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <select
                      value={verbalTeamId}
                      onChange={(e) => setVerbalTeamId(e.target.value)}
                      className="rounded-lg border border-slate-700 bg-[#060B18] px-3 py-2 text-xs text-white"
                    >
                      {room.teams.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} ({formatShortCurrency(t.remainingPurse, room.rules.currency)})
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={verbalAmountInput}
                      onChange={(e) => setVerbalAmountInput(e.target.value)}
                      placeholder={
                        currentPlayer
                          ? `Price (default ${formatShortCurrency(currentPlayer.basePrice, room.rules.currency)})`
                          : 'Amount (e.g. 2.5 Cr)'
                      }
                      className="flex-1 min-w-[160px] rounded-lg border border-slate-700 bg-[#060B18] px-3 py-2 text-xs font-mono-tabular text-white"
                    />
                    <button
                      type="submit"
                      disabled={!currentPlayer || currentPlayer.status === 'sold'}
                      className="rounded-lg bg-emerald-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-400 disabled:opacity-40"
                    >
                      Verbal SOLD
                    </button>
                  </div>
                </form>

                {/* Host-as-Bidder Live Simulation / Table Dock */}
                {room.rules.hostCanBid && !isSnakeMode && (
                  <div className="rounded-2xl border border-slate-800 bg-[#0D1526] p-5 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="text-sm font-bold text-white">
                          Host-as-Bidder &amp; Quick Table Bidding
                        </h3>
                        <p className="text-xs text-slate-400">
                          Submit quick bids or custom amounts for any franchise directly from the host console.
                        </p>
                      </div>
                      <span className="text-xs font-mono-tabular text-emerald-400">
                        Next Min: {formatCurrency(nextValidBid, room.rules.currency)}
                      </span>
                    </div>

                    {/* 1-Click Quick Bid per Team */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                      {room.teams.map((t) => {
                        const isLeading = t.id === room.highestBidderTeamId;
                        const canPlace =
                          room.status === 'live' &&
                          room.lotStatus === 'bidding' &&
                          !t.isLocked &&
                          !isLeading &&
                          t.remainingPurse >= nextValidBid;

                        return (
                          <button
                            key={t.id}
                            type="button"
                            disabled={!canPlace}
                            onClick={() => handleHostQuickBid(t.id)}
                            className={`rounded-xl border p-3 text-left transition-all ${
                              isLeading
                                ? 'border-amber-400 bg-amber-500/15'
                                : 'border-slate-800 bg-[#060B18] hover:border-emerald-500/60'
                            } disabled:opacity-45 disabled:cursor-not-allowed`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-bold text-white truncate">{t.name}</span>
                              <span className="text-[11px] font-mono-tabular text-emerald-400 font-semibold">
                                {formatShortCurrency(t.remainingPurse, room.rules.currency)}
                              </span>
                            </div>
                            <div className="mt-1 text-[11px] text-slate-400">
                              {isLeading
                                ? 'Leading Bid'
                                : `Click to bid ${formatShortCurrency(nextValidBid, room.rules.currency)}`}
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    {/* Host Custom Bid Entry */}
                    <form onSubmit={handleHostCustomSubmit} className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800">
                      <select
                        value={hostBidTeamId}
                        onChange={(e) => setHostBidTeamId(e.target.value)}
                        className="rounded-lg border border-slate-700 bg-[#060B18] px-3 py-2 text-xs text-white"
                      >
                        {room.teams.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={hostCustomBid}
                        onChange={(e) => setHostCustomBid(e.target.value)}
                        placeholder={`Custom amount (e.g. ${formatIndianCommas(nextValidBid)} or 2.75 Cr)`}
                        className="flex-1 min-w-[180px] rounded-lg border border-slate-700 bg-[#060B18] px-3 py-2 text-xs font-mono-tabular text-white"
                      />
                      <button
                        type="submit"
                        disabled={room.lotStatus !== 'bidding'}
                        className="rounded-lg bg-amber-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-40"
                      >
                        Place Custom Bid
                      </button>
                    </form>
                  </div>
                )}

                {/* Embedded Live Big Screen Preview */}
                <div className="rounded-2xl border border-slate-800 bg-[#0D1526] p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
                      <Monitor className="w-4 h-4 text-amber-400" />
                      <span>Big Screen TV Preview</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveTab('tv')}
                      className="text-xs font-semibold text-emerald-400 hover:underline"
                    >
                      Open Fullscreen TV →
                    </button>
                  </div>
                  <div className="rounded-xl border border-slate-800 bg-[#060B18] p-4 flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <div className="text-[11px] text-slate-400">ON TV STAGE</div>
                      <div className="text-lg font-display font-bold text-white">
                        {currentPlayer?.name || 'Standby'}
                      </div>
                      <div className="text-xs text-amber-300">
                        {highestTeam ? `Leading: ${highestTeam.name}` : 'Opening Base'}
                      </div>
                    </div>
                    <div className="text-right font-mono-tabular">
                      <div className="text-xl font-extrabold text-emerald-400">
                        {currentPlayer ? formatCurrency(room.currentBid, room.rules.currency) : '—'}
                      </div>
                      <div className="text-xs text-slate-400">
                        {room.lotStatus === 'bidding' ? `${remainingSeconds}s left` : room.lotStatus}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right 5 Cols: Player Catalog, Teams Management & Audit Log */}
              <div className="lg:col-span-5 space-y-5">
                {/* Player Catalog (Hidden Until Auction Starts) */}
                <div className="rounded-2xl border border-slate-800 bg-[#0D1526] p-5 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-bold text-white">
                      Player Catalog ({room.players.length})
                    </h3>
                    {!isLobbyLocked && (
                      <button
                        type="button"
                        onClick={() => setShowAddPlayer(true)}
                        className="inline-flex items-center gap-1 rounded-lg bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-slate-700"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add Player</span>
                      </button>
                    )}
                  </div>

                  {isLobbyLocked ? (
                    <div className="rounded-xl border border-emerald-500/30 bg-[#060B18] p-5 text-center space-y-3">
                      <div className="mx-auto w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
                        <Lock className="w-5 h-5" />
                      </div>
                      <div className="text-sm font-bold text-white">
                        Players Hidden Before Auction Start
                      </div>
                      <p className="text-xs text-slate-400 leading-relaxed">
                        {room.players.length} players staged ({room.teams.length} teams × {room.rules.maxSquadSize} + {room.rules.maxSquadSize} reserve). Click below to start the auction and reveal Lot #1.
                      </p>
                      <button
                        type="button"
                        onClick={() =>
                          onSendCommand('start_auction', { playerId: room.currentPlayerId })
                        }
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-400"
                      >
                        <Play className="w-3.5 h-3.5" />
                        <span>Start Auction &amp; Reveal Lot #1</span>
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-wrap gap-2">
                        <div className="relative flex-1 min-w-[160px]">
                          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                          <input
                            type="text"
                            value={playerSearch}
                            onChange={(e) => setPlayerSearch(e.target.value)}
                            placeholder="Search players..."
                            className="w-full rounded-lg border border-slate-700 bg-[#060B18] pl-8 pr-3 py-1.5 text-xs text-white"
                          />
                        </div>
                        <div className="flex items-center gap-1 rounded-lg bg-[#060B18] p-1 border border-slate-800">
                          {(['all', 'upcoming', 'sold', 'unsold'] as const).map((f) => (
                            <button
                              key={f}
                              type="button"
                              onClick={() => setPlayerFilter(f)}
                              className={`px-2 py-1 rounded text-[11px] font-medium capitalize ${
                                playerFilter === f ? 'bg-emerald-500 text-slate-950 font-bold' : 'text-slate-400'
                              }`}
                            >
                              {f}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="max-h-72 overflow-y-auto divide-y divide-slate-800/70 pr-1">
                        {filteredPlayers.map((p: AuctionPlayer) => (
                          <div key={p.id} className="py-2.5 flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-xs font-semibold text-white truncate">
                                {p.name}
                                <span className="text-slate-500 font-normal"> · {p.role}</span>
                              </div>
                              <div className="text-[11px] text-slate-400 font-mono-tabular">
                                Base {formatShortCurrency(p.basePrice, room.rules.currency)}
                                {p.status === 'sold' && p.soldToTeamName
                                  ? ` · SOLD to ${p.soldToTeamName} (${formatShortCurrency(p.soldPrice || 0, room.rules.currency)})`
                                  : p.status === 'unsold'
                                    ? ' · UNSOLD'
                                    : p.id === room.currentPlayerId
                                      ? ' · ON BLOCK'
                                      : ''}
                              </div>
                            </div>

                            {p.status === 'unsold' ? (
                              <button
                                type="button"
                                onClick={() =>
                                  onSendCommand('nominate_reauction', {
                                    playerId: p.id,
                                    startImmediately: true,
                                  })
                                }
                                className="inline-flex items-center gap-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-amber-300 hover:bg-amber-500/20 shrink-0"
                                title="Re-auction at 50% reduced base price"
                              >
                                <RefreshCw className="w-3 h-3" />
                                <span>Re-Auction 50%</span>
                              </button>
                            ) : p.status !== 'sold' ? (
                              <button
                                type="button"
                                onClick={() =>
                                  isSnakeMode && snakeTurnTeam
                                    ? onSendCommand('snake_draft_pick', { teamId: snakeTurnTeam.id, playerId: p.id })
                                    : onSendCommand('start_lot', { playerId: p.id })
                                }
                                className="rounded-lg border border-slate-700 bg-[#060B18] px-2.5 py-1.5 text-[11px] font-semibold text-emerald-300 hover:border-emerald-500/60 shrink-0"
                              >
                                {isSnakeMode
                                  ? 'Draft'
                                  : p.id === room.currentPlayerId && room.lotStatus === 'bidding'
                                    ? 'Live'
                                    : 'Auction'}
                              </button>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                {/* Team Management */}
                <div className="rounded-2xl border border-slate-800 bg-[#0D1526] p-5 space-y-3">
                  <h3 className="text-sm font-bold text-white">Team Management &amp; Purse Lock</h3>
                  <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                    {room.teams.map((t) => (
                      <div
                        key={t.id}
                        className="rounded-lg border border-slate-800 bg-[#060B18] px-3 py-2.5 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-white truncate">{t.name}</div>
                          <div className="text-[11px] text-slate-400 font-mono-tabular">
                            Rem {formatCurrency(t.remainingPurse, room.rules.currency)} · {t.squad.length}/{room.rules.maxSquadSize}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            onSendCommand('update_team', {
                              teamId: t.id,
                              patch: { isLocked: !t.isLocked },
                            })
                          }
                          className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-medium shrink-0 ${
                            t.isLocked
                              ? 'border-red-500/40 bg-red-500/10 text-red-300'
                              : 'border-slate-700 text-slate-300 hover:border-slate-500'
                          }`}
                        >
                          {t.isLocked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                          <span>{t.isLocked ? 'Locked' : 'Active'}</span>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Audit Event Log */}
                <div className="rounded-2xl border border-slate-800 bg-[#0D1526] p-5 space-y-3">
                  <div className="flex items-center gap-2 text-sm font-bold text-white">
                    <History className="w-4 h-4 text-slate-400" />
                    <span>Live Auction Event Log</span>
                  </div>
                  <div className="max-h-52 overflow-y-auto space-y-1.5 pr-1">
                    {room.eventLog.slice(0, 25).map((evt) => (
                      <div key={evt.id} className="text-[11px] border-b border-slate-800/60 pb-1.5">
                        <span className="font-mono-tabular text-slate-500">
                          {new Date(evt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </span>
                        <span className="mx-1.5 text-slate-600">·</span>
                        <span className="text-slate-200">{evt.message}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* QR Modal */}
      {showQR && <QRInviteModal room={room} onClose={() => setShowQR(false)} />}

      {/* Confirmation Modal */}
      {confirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-[#0D1526] p-6 space-y-4 shadow-2xl">
            <h3 className="text-lg font-display font-bold text-white">{confirmModal.title}</h3>
            <p className="text-sm text-slate-300">{confirmModal.message}</p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setConfirmModal(null)}
                className="rounded-lg border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  confirmModal.onConfirm();
                  setConfirmModal(null);
                }}
                className={`rounded-lg px-4 py-2 text-xs font-bold ${
                  confirmModal.variant === 'red'
                    ? 'bg-red-500 text-white hover:bg-red-400'
                    : confirmModal.variant === 'amber'
                      ? 'bg-amber-500 text-slate-950 hover:bg-amber-400'
                      : 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'
                }`}
              >
                {confirmModal.actionLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Custom Player Modal */}
      {showAddPlayer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <form
            onSubmit={handleAddPlayerSubmit}
            className="w-full max-w-md rounded-2xl border border-slate-800 bg-[#0D1526] p-6 space-y-4 shadow-2xl"
          >
            <h3 className="text-lg font-display font-bold text-white">Add Player to Catalog</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Player Name</label>
                <input
                  type="text"
                  required
                  value={newPlayer.name}
                  onChange={(e) => setNewPlayer({ ...newPlayer, name: e.target.value })}
                  placeholder="e.g. Suresh Raina"
                  className="w-full rounded-lg border border-slate-700 bg-[#060B18] px-3 py-2 text-sm text-white"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Country</label>
                  <input
                    type="text"
                    value={newPlayer.country}
                    onChange={(e) => setNewPlayer({ ...newPlayer, country: e.target.value })}
                    className="w-full rounded-lg border border-slate-700 bg-[#060B18] px-3 py-2 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Base Price (Lakhs)</label>
                  <input
                    type="number"
                    min={10}
                    value={newPlayer.basePriceLakhs}
                    onChange={(e) =>
                      setNewPlayer({ ...newPlayer, basePriceLakhs: Math.max(10, Number(e.target.value) || 50) })
                    }
                    className="w-full rounded-lg border border-slate-700 bg-[#060B18] px-3 py-2 text-sm font-mono-tabular text-white"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Role</label>
                  <select
                    value={newPlayer.role}
                    onChange={(e) => setNewPlayer({ ...newPlayer, role: e.target.value as PlayerRole })}
                    className="w-full rounded-lg border border-slate-700 bg-[#060B18] px-3 py-2 text-xs text-white"
                  >
                    <option value="Batter">Batter</option>
                    <option value="Bowler">Bowler</option>
                    <option value="All-Rounder">All-Rounder</option>
                    <option value="Wicketkeeper">Wicketkeeper</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Category</label>
                  <select
                    value={newPlayer.category}
                    onChange={(e) => setNewPlayer({ ...newPlayer, category: e.target.value as PlayerCategory })}
                    className="w-full rounded-lg border border-slate-700 bg-[#060B18] px-3 py-2 text-xs text-white"
                  >
                    <option value="Marquee">Marquee</option>
                    <option value="Capped Batter">Capped Batter</option>
                    <option value="Capped Bowler">Capped Bowler</option>
                    <option value="Capped All-Rounder">Capped All-Rounder</option>
                    <option value="Wicketkeeper">Wicketkeeper</option>
                    <option value="Uncapped">Uncapped</option>
                  </select>
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={newPlayer.isOverseas}
                  onChange={(e) => setNewPlayer({ ...newPlayer, isOverseas: e.target.checked })}
                  className="accent-emerald-500"
                />
                Overseas Player
              </label>
            </div>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowAddPlayer(false)}
                className="rounded-lg border border-slate-700 px-4 py-2 text-xs text-slate-300"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-lg bg-emerald-500 px-4 py-2 text-xs font-bold text-slate-950"
              >
                Add Player
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
