import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Award,
  Check,
  CheckCircle2,
  Clock,
  Cpu,
  Gavel,
  Layers,
  Lock,
  Pause,
  Play,
  RotateCcw,
  Star,
  Trophy,
  Users,
  Zap,
} from 'lucide-react';
import { AuctionPlayer, AuctionRoomState, PlayerRole } from '../shared/auctionTypes';
import {
  CRORE,
  formatCurrency,
  formatIndianCommas,
  formatShortCurrency,
  LAKH,
  parseCustomBidInput,
} from '../shared/currency';
import {
  calculateReservedPurse,
  getMinIncrementForBid,
  getNextValidBid,
  validateBidSubmission,
} from '../shared/rulesEngine';
import { TeamCrest } from './BidsKaroLogo';
import playerShowcaseImg from '../assets/images/cricket_player_showcase_1795725551044.jpg';

interface MobileBidderViewProps {
  room: AuctionRoomState;
  participantId: string;
  participantName: string;
  isHost: boolean;
  assignedTeamId?: string;
  remainingSeconds: number;
  bidFeedback: { type: 'accepted' | 'rejected'; message: string; timestamp: number } | null;
  onClearFeedback: () => void;
  onSelectTeam?: (teamId: string) => void;
  onSendCommand?: (type: string, payload?: Record<string, unknown>) => boolean;
  onOpenHostControls?: () => void;
  onPlaceBid: (params: {
    teamId: string;
    amount: number;
    bidType: 'quick' | 'custom' | 'host';
    bidderName?: string;
  }) => void;
  onLeaveRoom?: () => void;
}

type RaisePresetKey = 'default' | '10l' | '20l' | '50l' | '1cr' | '5cr' | '10cr' | 'custom';

const QUICK_RAISE_PRESETS: Array<{
  key: Exclude<RaisePresetKey, 'default' | 'custom'>;
  label: string;
  value: number;
  highlightClass?: string;
}> = [
  { key: '10l', label: '10L', value: 10 * LAKH },
  { key: '20l', label: '20L', value: 20 * LAKH },
  { key: '50l', label: '50L', value: 50 * LAKH },
  { key: '1cr', label: '1 CR', value: 1 * CRORE },
  { key: '5cr', label: '5 CR', value: 5 * CRORE },
  { key: '10cr', label: '10 CR', value: 10 * CRORE, highlightClass: 'border-fuchsia-500/70 bg-fuchsia-950/50 text-white' },
];

function formatClockMMSS(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function mapRoleToBucket(role: PlayerRole): 'batters' | 'bowlers' | 'allRounders' | 'wicketkeepers' {
  switch (role) {
    case 'Batter':
    case 'Forward':
      return 'batters';
    case 'Bowler':
    case 'Defender':
      return 'bowlers';
    case 'All-Rounder':
    case 'Midfielder':
      return 'allRounders';
    case 'Wicketkeeper':
    case 'Goalkeeper':
      return 'wicketkeepers';
  }
}

export const MobileBidderView: React.FC<MobileBidderViewProps> = ({
  room,
  participantId,
  participantName,
  isHost,
  assignedTeamId,
  remainingSeconds,
  bidFeedback,
  onClearFeedback,
  onSelectTeam,
  onSendCommand,
  onPlaceBid,
}) => {
  const [activeTeamId, setActiveTeamId] = useState<string>(
    assignedTeamId || room.teams[0]?.id || ''
  );
  const [customInput, setCustomInput] = useState<string>('');
  const [selectedPreset, setSelectedPreset] = useState<RaisePresetKey>('default');
  const [localError, setLocalError] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<'bid' | 'player' | 'summary' | 'stack'>('bid');
  const [auctionClockSeconds, setAuctionClockSeconds] = useState<number>(0);
  const [portraitLoadFailed, setPortraitLoadFailed] = useState<boolean>(false);

  const canActAsHost = isHost || Boolean(room.rules.allBiddersCanHost);
  const isLobbyLocked = room.status === 'lobby';

  useEffect(() => {
    if (assignedTeamId) {
      setActiveTeamId(assignedTeamId);
    }
  }, [assignedTeamId]);

  useEffect(() => {
    const updateClock = () => {
      if (room.status === 'live' && room.auctionEndDeadlineMs > 0) {
        setAuctionClockSeconds(Math.max(0, Math.floor((room.auctionEndDeadlineMs - Date.now()) / 1000)));
      } else {
        setAuctionClockSeconds(0);
      }
    };
    updateClock();
    const t = window.setInterval(updateClock, 1000);
    return () => window.clearInterval(t);
  }, [room.status, room.auctionEndDeadlineMs]);

  const currentPlayer = useMemo(
    () => (isLobbyLocked ? null : room.players.find((p) => p.id === room.currentPlayerId) || null),
    [room.players, room.currentPlayerId, isLobbyLocked]
  );

  const currentLotNumber = useMemo(() => {
    if (!currentPlayer) return 0;
    const idx = room.players.findIndex((p) => p.id === currentPlayer.id);
    return idx >= 0 ? idx + 1 : 0;
  }, [room.players, currentPlayer]);

  const selectedTeam = useMemo(
    () => room.teams.find((t) => t.id === activeTeamId) || room.teams[0],
    [room.teams, activeTeamId]
  );

  const playersMap = useMemo(
    () => new Map(room.players.map((p) => [p.id, p])),
    [room.players]
  );

  const isFootball = room.players.some((p) => p.sport === 'football');

  const selectedSquadPlayers = useMemo(() => {
    if (!selectedTeam) return [];
    return selectedTeam.squad
      .map((id) => playersMap.get(id))
      .filter((p): p is AuctionPlayer => Boolean(p));
  }, [selectedTeam, playersMap]);

  const roleCounts = useMemo(() => {
    const counts = { batters: 0, bowlers: 0, allRounders: 0, wicketkeepers: 0 };
    for (const p of selectedSquadPlayers) {
      counts[mapRoleToBucket(p.role)] += 1;
    }
    return counts;
  }, [selectedSquadPlayers]);

  const xiLimit = Math.min(room.rules.playingXISize || 11, room.rules.minSquadSize || 11, 11);
  const extrasLimit = Math.max(0, room.rules.maxSquadSize - xiLimit);
  const acquiredExtras = Math.max(0, selectedSquadPlayers.length - xiLimit);

  const soldCount = useMemo(
    () => room.players.filter((p) => p.status === 'sold').length,
    [room.players]
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

  const currentIncrement = currentPlayer
    ? getMinIncrementForBid(room.currentBid, room.rules, currentPlayer.category)
    : 10 * LAKH;

  // Reset staged amount to room's default next minimum bid whenever lot or winning bid changes
  useEffect(() => {
    if (nextValidBid > 0) {
      setCustomInput(formatIndianCommas(nextValidBid));
      setSelectedPreset('default');
      setLocalError(null);
    }
  }, [nextValidBid, currentPlayer?.id, room.bidSequence]);

  const reserveInfo = selectedTeam
    ? calculateReservedPurse(selectedTeam, room.rules, playersMap)
    : { slotsStillRequired: 0, reservedAmount: 0, maxAllowedBid: 0, overseasCount: 0 };

  const highestTeam = room.teams.find((t) => t.id === room.highestBidderTeamId) || null;
  const secondarySummaryTeam =
    room.teams.find((t) => t.id !== (highestTeam?.id || selectedTeam?.id)) || selectedTeam || room.teams[0];

  const timerAccent =
    room.lotStatus !== 'bidding'
      ? 'border-slate-700 bg-slate-900/70 text-slate-400'
      : remainingSeconds <= 3
        ? 'border-red-500/60 bg-red-950/60 text-red-400'
        : remainingSeconds <= 5
          ? 'border-orange-500/60 bg-orange-950/50 text-orange-400'
          : remainingSeconds <= 10
            ? 'border-amber-500/50 bg-amber-950/40 text-amber-300'
            : 'border-emerald-500/50 bg-emerald-950/40 text-emerald-400';

  const handleSelectDefaultPreset = () => {
    if (!currentPlayer || nextValidBid <= 0) return;
    setLocalError(null);
    onClearFeedback();
    setSelectedPreset('default');
    setCustomInput(formatIndianCommas(nextValidBid));
  };

  const handleSelectRaisePreset = (presetKey: Exclude<RaisePresetKey, 'default' | 'custom'>, delta: number) => {
    if (!currentPlayer) return;
    setLocalError(null);
    onClearFeedback();

    const parsedCurrent = parseCustomBidInput(customInput);
    const baseAnchor = hasHighestBidder ? room.currentBid : currentPlayer.basePrice;

    let nextAmount: number;
    if (selectedPreset === presetKey && parsedCurrent && parsedCurrent >= nextValidBid) {
      nextAmount = parsedCurrent + delta;
    } else {
      const candidate = baseAnchor + delta;
      nextAmount = candidate >= nextValidBid ? candidate : nextValidBid + delta;
    }

    setSelectedPreset(presetKey);
    setCustomInput(formatIndianCommas(nextAmount));
  };

  const submitBid = (amountToPlace: number, bidType: 'quick' | 'custom' | 'host') => {
    if (!selectedTeam || !currentPlayer) return;
    setLocalError(null);
    onClearFeedback();

    const check = validateBidSubmission({
      room,
      teamId: selectedTeam.id,
      bidderId: participantId,
      amount: amountToPlace,
      bidType,
    });

    if (!check.valid) {
      setLocalError(check.reason || 'Bid cannot be placed.');
      return;
    }

    onPlaceBid({
      teamId: selectedTeam.id,
      amount: amountToPlace,
      bidType,
      bidderName: canActAsHost ? `${selectedTeam.ownerName} (${participantName})` : participantName,
    });
  };

  const handlePlaceStagedBid = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!selectedTeam || !currentPlayer) return;

    const parsedAmount = parseCustomBidInput(customInput);
    const effectiveAmount = parsedAmount ?? nextValidBid;
    const isExactDefault = selectedPreset === 'default' && effectiveAmount === nextValidBid;

    submitBid(
      effectiveAmount,
      isExactDefault ? (canActAsHost ? 'host' : 'quick') : canActAsHost ? 'host' : 'custom'
    );
  };

  const togglePlayerInXI = (playerId: string) => {
    if (!selectedTeam || !onSendCommand) return;
    const currentXI = selectedTeam.startingXI || [];
    const exists = currentXI.includes(playerId);
    const nextXI = exists
      ? currentXI.filter((id) => id !== playerId)
      : currentXI.length < xiLimit
        ? [...currentXI, playerId]
        : currentXI;
    onSendCommand('set_lineup', {
      teamId: selectedTeam.id,
      startingXI: nextXI,
      captainId: selectedTeam.captainId,
      viceCaptainId: selectedTeam.viceCaptainId,
    });
  };

  const setLineupRole = (playerId: string, role: 'C' | 'VC') => {
    if (!selectedTeam || !onSendCommand) return;
    const ensureXI = selectedTeam.startingXI.includes(playerId)
      ? selectedTeam.startingXI
      : [...selectedTeam.startingXI, playerId].slice(0, xiLimit);
    onSendCommand('set_lineup', {
      teamId: selectedTeam.id,
      startingXI: ensureXI,
      captainId: role === 'C' ? playerId : selectedTeam.captainId === playerId ? undefined : selectedTeam.captainId,
      viceCaptainId: role === 'VC' ? playerId : selectedTeam.viceCaptainId === playerId ? undefined : selectedTeam.viceCaptainId,
    });
  };

  const parsedStagedBid = parseCustomBidInput(customInput) ?? nextValidBid;
  const isHoldingHighest = Boolean(
    selectedTeam && room.highestBidderTeamId === selectedTeam.id && room.lotStatus === 'bidding'
  );
  const canBidNow =
    room.status === 'live' &&
    room.lotStatus === 'bidding' &&
    Boolean(currentPlayer) &&
    Boolean(selectedTeam) &&
    !isHoldingHighest;

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

  const wishlistIds = selectedTeam ? room.wishlistByTeam?.[selectedTeam.id] || [] : [];
  const isCurrentWishlisted = currentPlayer ? wishlistIds.includes(currentPlayer.id) : false;

  // Stat labels tailored cleanly to Cricket vs Football
  const statOneVal = currentPlayer ? `${currentPlayer.stats.matches}` : '--';
  const statOneLabel = 'Matches Played';
  const statTwoVal = currentPlayer ? `${currentPlayer.stats.runs}` : '--';
  const statTwoLabel = currentPlayer?.sport === 'football' ? 'Total Goals' : 'Total Runs';
  const isPrimaryBowler =
    currentPlayer?.role === 'Bowler' || currentPlayer?.role === 'Defender' || currentPlayer?.role === 'Goalkeeper';
  const statThreeVal = currentPlayer
    ? isPrimaryBowler
      ? `${currentPlayer.stats.wickets}`
      : `${currentPlayer.stats.average}`
    : '--';
  const statThreeLabel =
    currentPlayer?.sport === 'football'
      ? isPrimaryBowler
        ? 'Clean Sheets'
        : 'Assists Index'
      : isPrimaryBowler
        ? 'Total Wickets'
        : 'Batting Average';

  return (
    <div className="max-w-[1380px] mx-auto space-y-5 pb-16 md:pb-8">
      {/* Compact Active Team & Purse Bar */}
      <div className="rounded-2xl border border-slate-800 bg-[#0B1221] px-4 py-3.5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {selectedTeam && (
              <TeamCrest
                shortCode={selectedTeam.shortCode}
                primaryColor={selectedTeam.primaryColor}
                secondaryColor={selectedTeam.secondaryColor}
              />
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-display font-bold text-white truncate">
                  {selectedTeam?.name || 'Select Team'}
                </span>
                {room.rules.aiOpponentsEnabled && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400 whitespace-nowrap">
                    <Cpu className="w-3.5 h-3.5" />
                    <span>AI Opponents Active</span>
                  </span>
                )}
                {room.status === 'live' && room.auctionEndDeadlineMs > 0 && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-mono-tabular font-medium text-amber-300 whitespace-nowrap">
                    <Clock className="w-3.5 h-3.5" />
                    <span>{formatClockMMSS(auctionClockSeconds)}</span>
                  </span>
                )}
              </div>
              <div className="text-xs text-slate-400 font-mono-tabular mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span>
                  Purse{' '}
                  <strong className="text-emerald-400">
                    {formatCurrency(selectedTeam?.remainingPurse || 0, room.rules.currency)}
                  </strong>
                </span>
                <span className="text-slate-600" aria-hidden="true">·</span>
                <span>
                  Squad {selectedTeam?.squad.length || 0}/{room.rules.maxSquadSize} (Min {room.rules.minSquadSize})
                </span>
                <span className="text-slate-600" aria-hidden="true">·</span>
                <span>
                  Max Bid{' '}
                  <strong className="text-amber-300">
                    {formatShortCurrency(reserveInfo.maxAllowedBid, room.rules.currency)}
                  </strong>
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {canActAsHost && room.status === 'live' && onSendCommand && (
              <>
                {room.lotStatus === 'bidding' ? (
                  <button
                    type="button"
                    onClick={() => onSendCommand('pause_timer')}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-300 hover:bg-amber-500/20 min-h-[40px] whitespace-nowrap shrink-0"
                  >
                    <Pause className="w-3.5 h-3.5" />
                    <span>Pause</span>
                  </button>
                ) : room.lotStatus === 'paused' ? (
                  <button
                    type="button"
                    onClick={() => onSendCommand('resume_timer')}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-3 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-400 min-h-[40px] whitespace-nowrap shrink-0"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>Resume</span>
                  </button>
                ) : null}
              </>
            )}

            {(canActAsHost || !assignedTeamId) && (
              <div className="flex items-center gap-2">
                <label htmlFor="active-team-select" className="text-xs text-slate-400 whitespace-nowrap">
                  Bidding Team:
                </label>
                <select
                  id="active-team-select"
                  value={activeTeamId}
                  onChange={(e) => {
                    setActiveTeamId(e.target.value);
                    onSelectTeam?.(e.target.value);
                    setLocalError(null);
                  }}
                  className="rounded-xl border border-slate-700 bg-[#060B18] px-3 py-2 text-xs font-medium text-white min-h-[40px]"
                >
                  {room.teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({formatShortCurrency(t.remainingPurse, room.rules.currency)})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>

        {/* Clean Unboxed Role Targets Strip */}
        {selectedTeam && room.rules.roleQuotas && (
          <div className="pt-2.5 border-t border-slate-800/80 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-mono-tabular text-slate-300">
            <span className="font-sans font-semibold text-slate-400">Role Targets:</span>
            <span className={roleCounts.batters >= room.rules.roleQuotas.batters ? 'text-emerald-400 font-semibold' : ''}>
              {isFootball ? 'FWD' : 'BAT'} {roleCounts.batters}/{room.rules.roleQuotas.batters}
            </span>
            <span className="text-slate-600" aria-hidden="true">·</span>
            <span className={roleCounts.bowlers >= room.rules.roleQuotas.bowlers ? 'text-emerald-400 font-semibold' : ''}>
              {isFootball ? 'DEF' : 'BWL'} {roleCounts.bowlers}/{room.rules.roleQuotas.bowlers}
            </span>
            <span className="text-slate-600" aria-hidden="true">·</span>
            <span className={roleCounts.allRounders >= room.rules.roleQuotas.allRounders ? 'text-emerald-400 font-semibold' : ''}>
              {isFootball ? 'MID' : 'AR'} {roleCounts.allRounders}/{room.rules.roleQuotas.allRounders}
            </span>
            <span className="text-slate-600" aria-hidden="true">·</span>
            <span className={roleCounts.wicketkeepers >= room.rules.roleQuotas.wicketkeepers ? 'text-emerald-400 font-semibold' : ''}>
              {isFootball ? 'GK' : 'WK'} {roleCounts.wicketkeepers}/{room.rules.roleQuotas.wicketkeepers}
            </span>
            <span className="text-slate-600" aria-hidden="true">·</span>
            <span className="text-amber-300">
              Extras {acquiredExtras}/{extrasLimit} · XI {selectedTeam.startingXI?.length || 0}/{xiLimit}
            </span>
          </div>
        )}
      </div>

      {/* Responsive Mobile & Tablet Tab Switcher */}
      <div className="grid grid-cols-4 lg:hidden items-center gap-1 p-1 rounded-2xl bg-[#0B1221] border border-slate-800">
        {(
          [
            { id: 'bid', label: 'Live Bid' },
            { id: 'player', label: 'Player Card' },
            { id: 'summary', label: 'Summary' },
            { id: 'stack', label: `Stack (${selectedSquadPlayers.length})` },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setMobileTab(tab.id)}
            className={`py-2.5 px-2 rounded-xl text-[11px] font-semibold transition-colors min-h-[44px] whitespace-nowrap truncate ${
              mobileTab === tab.id ? 'bg-amber-400 text-slate-950 font-bold' : 'text-slate-300 hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {isLobbyLocked ? (
        <div className="rounded-3xl border border-slate-800 bg-[#0B1221] p-8 sm:p-10 text-center space-y-4">
          <div className="mx-auto w-14 h-14 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 flex items-center justify-center text-emerald-400">
            <Lock className="w-6 h-6" />
          </div>
          <h2 className="text-xl sm:text-2xl font-display font-bold text-white">
            Mystery Player Pool Locked ({room.players.length} Players)
          </h2>
          <p className="text-xs sm:text-sm text-slate-400 max-w-md mx-auto">
            Players stay hidden before the auction starts so every franchise enters blind.{' '}
            {canActAsHost
              ? 'Start the auction now to reveal Lot #1 and enter the live bidding stage.'
              : 'Waiting for the auction to start and reveal Lot #1.'}
          </p>
          {canActAsHost && onSendCommand && (
            <button
              type="button"
              onClick={() => onSendCommand('start_auction', { playerId: room.currentPlayerId })}
              className="inline-flex items-center gap-2 rounded-xl bg-amber-400 px-6 py-3.5 text-sm font-display font-extrabold text-slate-950 hover:bg-amber-300 transition-colors min-h-[48px] whitespace-nowrap"
            >
              <Play className="w-4 h-4 fill-current" />
              <span>Start Auction &amp; Reveal Lot #1</span>
            </button>
          )}
        </div>
      ) : (
        /* 3-Panel Broadcast Showcase Matching Reference UI across Desktop & Responsive Mobile Tabs */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
          {/* PANEL 1 (LEFT): Player Showcase Portrait Card */}
          <div className={`lg:col-span-4 ${mobileTab === 'player' ? 'block' : 'hidden lg:block'}`}>
            <div className="relative h-full min-h-[540px] rounded-3xl overflow-hidden border border-slate-800 bg-[#0B1221] flex flex-col justify-between shadow-xl">
              {/* Full-bleed Player Portrait + Dark Atmospheric Gradient Fallback */}
              <div className="absolute inset-0 bg-gradient-to-br from-emerald-950 via-[#0B1221] to-[#060B18]">
                {!portraitLoadFailed && (
                  <img
                    src={playerShowcaseImg}
                    alt={currentPlayer ? `${currentPlayer.name} portrait` : 'Auction Player Portrait'}
                    referrerPolicy="no-referrer"
                    onError={() => setPortraitLoadFailed(true)}
                    className="w-full h-full object-cover object-top"
                  />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-[#050914] via-[#050914]/45 to-[#050914]/65" />
              </div>

              {/* Top Overlay Header */}
              <div className="relative z-10 flex items-center justify-between px-5 pt-5">
                <div className="text-xs font-medium text-slate-200">
                  <span className="font-semibold text-white">Player Auction</span>
                  {currentPlayer && (
                    <>
                      <span className="mx-1.5 text-slate-400" aria-hidden="true">·</span>
                      <span className="text-slate-300">{currentPlayer.category}</span>
                    </>
                  )}
                </div>

                {currentPlayer && selectedTeam && onSendCommand && (
                  <button
                    type="button"
                    onClick={() =>
                      onSendCommand('toggle_wishlist', {
                        teamId: selectedTeam.id,
                        playerId: currentPlayer.id,
                      })
                    }
                    className={`inline-flex items-center gap-1.5 rounded-full backdrop-blur-md px-3 py-1.5 text-xs font-semibold transition-colors min-h-[36px] whitespace-nowrap shrink-0 ${
                      isCurrentWishlisted
                        ? 'bg-amber-400 text-slate-950'
                        : 'bg-white/15 border border-white/25 text-white hover:bg-white/25'
                    }`}
                  >
                    <Star className={`w-3.5 h-3.5 ${isCurrentWishlisted ? 'fill-slate-950' : ''}`} />
                    <span>{isCurrentWishlisted ? 'Saved' : 'Target'}</span>
                  </button>
                )}
              </div>

              {/* Left Floating Stacked Metric Cards (Charcoal, Crisp White, Frosted Glass) */}
              <div className="relative z-10 px-5 py-4 flex flex-col gap-3 w-44">
                <div className="rounded-2xl bg-[#070B14]/90 border border-white/10 p-3.5 text-white shadow-lg">
                  <div className="w-7 h-7 rounded-full bg-white text-slate-950 flex items-center justify-center mb-2">
                    <Trophy className="w-3.5 h-3.5" />
                  </div>
                  <div className="text-xl font-mono-tabular font-extrabold leading-none">{statOneVal}</div>
                  <div className="mt-1 text-[11px] text-slate-300">{statOneLabel}</div>
                </div>

                <div className="rounded-2xl bg-white text-slate-950 p-3.5 shadow-lg">
                  <div className="w-7 h-7 rounded-full bg-slate-950 text-white flex items-center justify-center mb-2">
                    <Zap className="w-3.5 h-3.5" />
                  </div>
                  <div className="text-xl font-mono-tabular font-extrabold leading-none">{statTwoVal}</div>
                  <div className="mt-1 text-[11px] text-slate-600 font-medium">{statTwoLabel}</div>
                </div>

                <div className="rounded-2xl backdrop-blur-md bg-white/15 border border-white/25 p-3.5 text-white shadow-lg">
                  <div className="w-7 h-7 rounded-full bg-white text-slate-950 flex items-center justify-center mb-2">
                    <Star className="w-3.5 h-3.5" />
                  </div>
                  <div className="text-xl font-mono-tabular font-extrabold leading-none">{statThreeVal}</div>
                  <div className="mt-1 text-[11px] text-slate-200">{statThreeLabel}</div>
                </div>
              </div>

              {/* Bottom Player Identity + Rating Card + CTA */}
              <div className="relative z-10 px-5 pb-5 pt-2 space-y-4">
                <div className="flex items-end justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h2 className="text-2xl sm:text-3xl font-display font-extrabold text-white leading-tight break-words">
                      {currentPlayer ? currentPlayer.name : 'Standby'}
                    </h2>
                    {currentPlayer && (
                      <p className="mt-1.5 text-xs text-slate-300 leading-relaxed line-clamp-2">
                        {currentPlayer.country} · {currentPlayer.role} · {currentPlayer.battingStyle} · Base{' '}
                        <span className="font-mono-tabular text-white font-semibold">
                          {formatShortCurrency(currentPlayer.basePrice, room.rules.currency)}
                        </span>
                      </p>
                    )}
                  </div>

                  {currentPlayer && (
                    <div className="rounded-2xl bg-white text-slate-950 p-2.5 text-center shadow-xl shrink-0 min-w-[96px]">
                      <div className="mx-auto w-7 h-7 rounded-full bg-emerald-500/15 text-emerald-700 flex items-center justify-center mb-1">
                        <Award className="w-4 h-4" />
                      </div>
                      <div className="text-[10px] font-semibold text-slate-500">Auction MVP</div>
                      <div className="text-xl font-mono-tabular font-extrabold leading-tight">
                        {currentPlayer.rating}
                      </div>
                      <button
                        type="button"
                        onClick={() => setMobileTab('summary')}
                        className="mt-1 w-full rounded-full bg-[#3D154B] px-2.5 py-1 text-[10px] font-semibold text-white hover:bg-[#521D64] transition-colors whitespace-nowrap"
                      >
                        Bid Feed
                      </button>
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setMobileTab('summary');
                    const el = document.getElementById('my-squad-stack-section');
                    el?.scrollIntoView({ behavior: 'smooth' });
                  }}
                  className="w-full min-h-[48px] rounded-2xl bg-gradient-to-r from-rose-500 via-amber-400 to-emerald-400 px-5 py-3 text-sm font-display font-extrabold text-slate-950 hover:brightness-105 active:scale-[0.99] transition-all shadow-lg whitespace-nowrap"
                >
                  My Stack ({selectedSquadPlayers.length}/{room.rules.maxSquadSize}) &amp; Squad XI
                </button>
              </div>
            </div>
          </div>

          {/* PANEL 2 (CENTER): Live Auction & One-Tap Quick Raise Bidding Stage */}
          <div className={`lg:col-span-4 ${mobileTab === 'bid' ? 'block' : 'hidden lg:block'}`}>
            <div className="h-full rounded-3xl border border-slate-800 bg-[#0B1221] p-5 flex flex-col justify-between gap-4 shadow-xl">
              {/* Top Lot Header */}
              <div className="text-center space-y-1">
                <div className="inline-flex items-center justify-center gap-2 text-xs font-bold tracking-wider uppercase text-white">
                  {room.lotStatus === 'bidding' && (
                    <span className="w-2 h-2 rounded-full bg-red-500" aria-hidden="true" />
                  )}
                  <span>
                    {room.lotStatus === 'bidding'
                      ? 'Live Auction'
                      : room.lotStatus === 'paused'
                        ? 'Timer Paused'
                        : room.lotStatus === 'sold_reveal'
                          ? 'Player Sold'
                          : room.lotStatus === 'unsold_reveal'
                            ? 'Player Unsold'
                            : 'Auction Standby'}
                  </span>
                </div>
                <div className="text-xs font-mono-tabular text-slate-400">
                  Lot #{currentLotNumber || 1} of {room.players.length}
                </div>
              </div>

              {/* Player Mini Identity Bar + Prominent Timer Capsule */}
              <div className="rounded-2xl border border-slate-800 bg-[#0E172A] p-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-14 h-14 rounded-xl overflow-hidden bg-slate-900 border border-slate-700 shrink-0">
                    {!portraitLoadFailed ? (
                      <img
                        src={playerShowcaseImg}
                        alt={currentPlayer?.name || 'Player'}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover object-top"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-xs font-bold text-slate-400">
                        {currentPlayer?.name?.slice(0, 2).toUpperCase() || 'PL'}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="w-4 h-4 rounded-full bg-emerald-500 text-slate-950 inline-flex items-center justify-center shrink-0">
                        <Check className="w-2.5 h-2.5 stroke-[3]" />
                      </span>
                      <span className="text-[11px] text-slate-400 truncate">
                        {currentPlayer ? `${currentPlayer.role} · ${currentPlayer.country}` : 'Waiting'}
                      </span>
                    </div>
                    <h3 className="text-lg font-display font-bold text-white leading-tight truncate mt-0.5">
                      {currentPlayer ? currentPlayer.name : 'No Active Player'}
                    </h3>
                    {currentPlayer && (
                      <div className="text-[11px] font-mono-tabular text-slate-400">
                        Base {formatShortCurrency(currentPlayer.basePrice, room.rules.currency)}
                      </div>
                    )}
                  </div>
                </div>

                {/* Vertical/Compact High-Contrast Countdown Display */}
                <div className={`rounded-xl border px-3 py-2 text-center font-mono-tabular shrink-0 min-w-[74px] ${timerAccent}`}>
                  <div className="text-[9px] font-semibold tracking-wider uppercase opacity-80">Timer</div>
                  <div className="text-xl font-extrabold leading-tight">
                    {room.lotStatus === 'bidding' || room.lotStatus === 'paused'
                      ? formatClockMMSS(remainingSeconds)
                      : room.lotStatus === 'awaiting_hammer'
                        ? '00:00'
                        : '--:--'}
                  </div>
                </div>
              </div>

              {/* Current Bid Showcase Card (Gold Tabular Figure + Bidding Team) */}
              <div className="rounded-2xl border border-amber-500/45 bg-[#0E1629] p-4 text-center space-y-1.5">
                <div className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
                  {hasHighestBidder ? 'Current Bid' : 'Opening Base Price'}
                </div>
                <div className="text-4xl sm:text-[42px] leading-none font-mono-tabular font-extrabold text-amber-400 tracking-tight py-1">
                  {currentPlayer ? formatShortCurrency(room.currentBid, room.rules.currency).toUpperCase() : '—'}
                </div>
                <div className="text-xs text-slate-300">
                  Bidding Team:{' '}
                  <strong className="text-white font-semibold">
                    {highestTeam ? highestTeam.name : 'Opening Floor'}
                  </strong>
                </div>
                {currentPlayer && (
                  <div className="text-[11px] font-mono-tabular text-emerald-400">
                    Next Min Bid: {formatShortCurrency(nextValidBid, room.rules.currency)} (+{formatShortCurrency(currentIncrement, room.rules.currency)})
                  </div>
                )}
              </div>

              {/* Feedback Banner */}
              {(localError || bidFeedback) && (
                <div
                  className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-xs ${
                    localError || bidFeedback?.type === 'rejected'
                      ? 'border-red-500/40 bg-red-950/60 text-red-200'
                      : 'border-emerald-500/40 bg-emerald-950/60 text-emerald-200'
                  }`}
                >
                  {localError || bidFeedback?.type === 'rejected' ? (
                    <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  )}
                  <span className="leading-snug">{localError || bidFeedback?.message}</span>
                </div>
              )}

              {/* Bidding Action Area */}
              {isSnakeMode ? (
                <div className="space-y-3">
                  <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
                    <div className="font-bold text-amber-300">
                      Snake Draft Round {room.snakeDraftRound} · Pick #{room.snakeDraftPickIndex + 1}
                    </div>
                    <div className="text-slate-200 mt-0.5">
                      Turn: <strong>{snakeTurnTeam?.name}</strong>
                    </div>
                  </div>
                  {currentPlayer && (canActAsHost || snakeTurnTeam?.id === selectedTeam?.id) && onSendCommand && (
                    <button
                      type="button"
                      onClick={() =>
                        onSendCommand('snake_draft_pick', {
                          teamId: snakeTurnTeam?.id,
                          playerId: currentPlayer.id,
                        })
                      }
                      className="w-full min-h-[52px] rounded-2xl bg-amber-400 px-5 py-3 text-sm font-display font-extrabold text-slate-950 hover:bg-amber-300"
                    >
                      Draft {currentPlayer.name} ({formatShortCurrency(currentPlayer.basePrice, room.rules.currency)})
                    </button>
                  )}
                </div>
              ) : room.rules.biddingStyle === 'verbal' && !canActAsHost ? (
                <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-xs text-amber-200">
                  <strong>Verbal Table Bidding Active:</strong> Call your bids aloud in the room. Winning bids update live on your screen.
                </div>
              ) : (
                <form onSubmit={handlePlaceStagedBid} className="space-y-3">
                  {/* Default Set Option + Helper Header */}
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-slate-300">Quick-bidding preset or custom value</span>
                    <button
                      type="button"
                      disabled={!currentPlayer}
                      onClick={handleSelectDefaultPreset}
                      className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-mono-tabular font-bold transition-colors whitespace-nowrap shrink-0 ${
                        selectedPreset === 'default'
                          ? 'border-emerald-400 bg-emerald-500/20 text-emerald-300'
                          : 'border-slate-700 bg-[#060B18] text-slate-300 hover:border-slate-500'
                      }`}
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Default ({formatShortCurrency(nextValidBid, room.rules.currency)})</span>
                    </button>
                  </div>

                  {/* 6 Quick-Raise Preset Chips: 10L, 20L, 50L, 1 CR, 5 CR, 10 CR */}
                  <div className="grid grid-cols-3 gap-2">
                    {QUICK_RAISE_PRESETS.map((chip) => {
                      const isActive = selectedPreset === chip.key;
                      return (
                        <button
                          key={chip.key}
                          type="button"
                          disabled={!currentPlayer}
                          onClick={() => handleSelectRaisePreset(chip.key, chip.value)}
                          className={`min-h-[44px] rounded-xl border px-2 py-2 text-xs font-mono-tabular font-bold transition-all active:scale-[0.98] whitespace-nowrap ${
                            isActive
                              ? chip.highlightClass || 'border-amber-400 bg-amber-500/20 text-amber-300'
                              : chip.key === '10cr'
                                ? 'border-fuchsia-500/45 bg-[#1B1028] text-fuchsia-200 hover:border-fuchsia-400'
                                : chip.key === '1cr' || chip.key === '5cr' || chip.key === '50l'
                                  ? 'border-amber-500/35 bg-[#111829] text-amber-200 hover:border-amber-400'
                                  : 'border-dashed border-slate-600 bg-[#0B1325] text-slate-200 hover:border-slate-400'
                          } disabled:opacity-40`}
                        >
                          +{chip.label}
                        </button>
                      );
                    })}
                  </div>

                  {/* Custom Manual Value Input */}
                  {(room.rules.allowCustomBid || canActAsHost) && (
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-mono-tabular text-slate-400">
                          ₹
                        </span>
                        <input
                          id="custom-bid-input"
                          type="text"
                          inputMode="decimal"
                          value={customInput}
                          onChange={(e) => {
                            setSelectedPreset('custom');
                            setCustomInput(e.target.value);
                            setLocalError(null);
                          }}
                          placeholder="Enter bid (e.g. 2.5 Cr or 75 L)"
                          className="w-full min-h-[44px] rounded-xl border border-slate-700 bg-[#060B18] pl-7 pr-3 py-2 text-sm font-mono-tabular font-bold text-white placeholder:text-slate-600 focus:border-amber-400 focus:outline-none"
                        />
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-[10px] text-slate-400">BID VALUE</div>
                        <div className="text-xs font-mono-tabular font-bold text-amber-300">
                          {formatShortCurrency(parsedStagedBid, room.rules.currency)}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Big Gold Primary CTA Button */}
                  <button
                    type="submit"
                    disabled={!canBidNow}
                    className="w-full min-h-[54px] rounded-full bg-gradient-to-r from-amber-400 to-amber-500 px-5 py-3 text-sm sm:text-base font-display font-extrabold text-slate-950 hover:from-amber-300 hover:to-amber-400 active:scale-[0.99] disabled:opacity-45 disabled:cursor-not-allowed transition-all shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2 whitespace-nowrap"
                  >
                    <Gavel className="w-4 h-4 shrink-0" />
                    <span>
                      {isHoldingHighest
                        ? `LEADING BID (${formatShortCurrency(room.currentBid, room.rules.currency)})`
                        : currentPlayer
                          ? `PLACE BID · ${formatShortCurrency(parsedStagedBid, room.rules.currency).toUpperCase()}`
                          : 'WAITING FOR PLAYER'}
                    </span>
                  </button>

                  <div className="text-center text-[11px] text-slate-400">
                    {isHoldingHighest
                      ? `${selectedTeam?.name} currently holds the highest bid`
                      : selectedPreset === 'default'
                        ? 'Default Next Valid Bid ready'
                        : `Quick Raise staged · Tap Place Bid to confirm`}
                  </div>
                </form>
              )}
            </div>
          </div>

          {/* PANEL 3 (RIGHT): Auction Summary, Team Purses, Live Bidding History & Sold Summary */}
          <div className={`lg:col-span-4 ${mobileTab === 'summary' ? 'block' : 'hidden lg:block'}`}>
            <div className="h-full rounded-3xl border border-slate-800 bg-[#0B1221] p-5 flex flex-col justify-between gap-4 shadow-xl">
              {/* Top Header */}
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-display font-bold text-white">Auction Summary</h3>
                <span className="text-xs text-slate-400 font-mono-tabular">{room.teams.length} Teams</span>
              </div>

              {/* 2x2 Colored Franchise Purse Grid */}
              <div className="grid grid-cols-2 gap-2.5 max-h-[205px] overflow-y-auto pr-0.5">
                {room.teams.map((t) => {
                  const isSelected = t.id === selectedTeam?.id;
                  const canSwitch = canActAsHost || !assignedTeamId;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      disabled={!canSwitch}
                      onClick={() => {
                        if (!canSwitch) return;
                        setActiveTeamId(t.id);
                        onSelectTeam?.(t.id);
                        setLocalError(null);
                      }}
                      className={`rounded-2xl border p-3 text-left transition-all ${
                        isSelected
                          ? 'ring-1 ring-amber-400/70'
                          : canSwitch
                            ? 'hover:border-slate-600'
                            : 'cursor-default'
                      }`}
                      style={{
                        borderColor: isSelected ? undefined : `${t.primaryColor}55`,
                        backgroundColor: `${t.primaryColor}14`,
                      }}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <TeamCrest
                          shortCode={t.shortCode}
                          primaryColor={t.primaryColor}
                          secondaryColor={t.secondaryColor}
                          size="sm"
                        />
                        <span className="text-xs font-semibold text-slate-200 truncate">
                          {t.shortCode} {isSelected ? '· You' : ''}
                        </span>
                      </div>
                      <div className="mt-2 text-base font-mono-tabular font-extrabold text-amber-300 truncate">
                        {formatShortCurrency(t.remainingPurse, room.rules.currency).toUpperCase()}
                      </div>
                      <div className="text-[10px] font-mono-tabular text-slate-400 mt-0.5">
                        Squad {t.squad.length}/{room.rules.maxSquadSize}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Live Bidding History Feed */}
              <div className="flex-1 min-h-[180px] flex flex-col">
                <div className="flex items-center justify-between mb-2.5">
                  <span className="text-[11px] font-bold tracking-wider uppercase text-slate-300">
                    Live Bidding History
                  </span>
                  <span className="text-[11px] font-mono-tabular text-slate-400">
                    {room.currentLotBids.length} {room.currentLotBids.length === 1 ? 'bid' : 'bids'}
                  </span>
                </div>

                {room.currentLotBids.length === 0 ? (
                  <div className="flex-1 rounded-2xl border border-slate-800 bg-[#0E172A] p-4 flex items-center justify-center text-center text-xs text-slate-500">
                    No bids yet for {currentPlayer?.name || 'current lot'}. Tap Place Bid to open.
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[210px] overflow-y-auto pr-0.5">
                    {room.currentLotBids.map((bid, idx) => {
                      const bidTeam = room.teams.find((tm) => tm.id === bid.teamId);
                      const timeText = new Date(bid.timestamp).toLocaleTimeString([], {
                        hour: 'numeric',
                        minute: '2-digit',
                      });
                      return (
                        <div
                          key={bid.id}
                          className={`rounded-2xl border px-3.5 py-2.5 flex items-center justify-between gap-3 ${
                            idx === 0
                              ? 'border-emerald-500/60 bg-emerald-500/10'
                              : 'border-slate-800 bg-[#0E172A]'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <TeamCrest
                              shortCode={bidTeam?.shortCode || bid.teamName.slice(0, 2).toUpperCase()}
                              primaryColor={bid.teamColor}
                              secondaryColor={bidTeam?.secondaryColor}
                              size="sm"
                            />
                            <div className="min-w-0">
                              <div className="text-xs font-semibold text-white truncate">
                                {bid.teamName} bid
                              </div>
                              <div className="text-sm font-mono-tabular font-extrabold text-amber-300">
                                {formatShortCurrency(bid.amount, room.rules.currency).toUpperCase()}
                              </div>
                            </div>
                          </div>
                          <div className="text-right shrink-0 flex flex-col items-end gap-1">
                            {idx === 0 && (
                              <span className="w-5 h-5 rounded-full bg-emerald-500 text-slate-950 inline-flex items-center justify-center">
                                <Check className="w-3 h-3 stroke-[3]" />
                              </span>
                            )}
                            <span className="text-[10px] font-mono-tabular text-slate-400">{timeText}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Bottom Crisp White Players Sold & Budget Summary Card */}
              <div className="rounded-2xl bg-white text-slate-950 px-4 py-3.5 shadow-lg flex items-center justify-between gap-2">
                {highestTeam || selectedTeam ? (
                  <TeamCrest
                    shortCode={(highestTeam || selectedTeam)!.shortCode}
                    primaryColor={(highestTeam || selectedTeam)!.primaryColor}
                    secondaryColor={(highestTeam || selectedTeam)!.secondaryColor}
                    size="sm"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-lg bg-slate-200" />
                )}

                <div className="text-center min-w-0">
                  <div className="text-[10px] font-bold tracking-wider uppercase text-slate-500">
                    Players Sold
                  </div>
                  <div className="text-2xl font-mono-tabular font-extrabold text-slate-950 leading-tight">
                    {soldCount}/{room.players.length}
                  </div>
                  <div className="text-[11px] font-medium text-slate-600 font-mono-tabular truncate">
                    Budget Left: {formatShortCurrency(selectedTeam?.remainingPurse || 0, room.rules.currency)}
                  </div>
                </div>

                {secondarySummaryTeam ? (
                  <TeamCrest
                    shortCode={secondarySummaryTeam.shortCode}
                    primaryColor={secondarySummaryTeam.primaryColor}
                    secondaryColor={secondarySummaryTeam.secondaryColor}
                    size="sm"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-lg bg-slate-200" />
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* My Acquired Stack & Final Playing XI Selector (Desktop Below + Mobile Stack Tab) */}
      {selectedTeam && (
        <div
          id="my-squad-stack-section"
          className={`rounded-3xl border border-slate-800 bg-[#0B1221] p-5 space-y-3 ${
            mobileTab === 'stack' ? 'block' : 'hidden lg:block'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-emerald-400" />
              <h3 className="text-sm font-display font-bold text-white">
                {selectedTeam.name} — Acquired Stack ({selectedSquadPlayers.length}/{room.rules.maxSquadSize})
              </h3>
            </div>
            <span className="text-xs font-mono-tabular text-amber-300 font-semibold">
              Final Playing XI: {selectedTeam.startingXI?.length || 0}/{xiLimit} · Extras:{' '}
              {Math.max(0, selectedSquadPlayers.length - (selectedTeam.startingXI?.length || 0))}
            </span>
          </div>

          <p className="text-xs text-slate-400">
            Acquire up to {room.rules.maxSquadSize} players (including +{extrasLimit} free-choice extras), then select your {xiLimit} starters, Captain (C), and Vice-Captain (VC) below.
          </p>

          {selectedSquadPlayers.length === 0 ? (
            <div className="rounded-2xl border border-slate-800 bg-[#060B18] p-5 text-center text-xs text-slate-500">
              No players won in your stack yet. Winning bids add players directly here.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-80 overflow-y-auto pr-1">
              {selectedSquadPlayers.map((p) => {
                const inXI = selectedTeam.startingXI?.includes(p.id);
                const isC = selectedTeam.captainId === p.id;
                const isVC = selectedTeam.viceCaptainId === p.id;
                return (
                  <div
                    key={p.id}
                    className={`flex flex-wrap items-center justify-between gap-2 rounded-2xl border px-3.5 py-2.5 text-xs ${
                      inXI
                        ? 'border-emerald-500/40 bg-emerald-500/10'
                        : 'border-slate-800 bg-[#060B18]'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="font-bold text-white flex items-center gap-1.5">
                        <span className="truncate">{p.name}</span>
                        {isC && <span className="text-[10px] font-mono-tabular text-amber-300">(C)</span>}
                        {isVC && <span className="text-[10px] font-mono-tabular text-emerald-300">(VC)</span>}
                      </div>
                      <div className="text-[11px] text-slate-400 font-mono-tabular">
                        {p.role} · {formatShortCurrency(p.soldPrice || p.basePrice, room.rules.currency)}
                      </div>
                    </div>
                    {onSendCommand && (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => togglePlayerInXI(p.id)}
                          className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold min-h-[32px] whitespace-nowrap ${
                            inXI
                              ? 'border-emerald-400 bg-emerald-500 text-slate-950'
                              : 'border-slate-700 text-slate-300 hover:border-slate-500'
                          }`}
                        >
                          {inXI ? 'Playing XI' : 'Extra'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setLineupRole(p.id, 'C')}
                          className={`rounded-lg border px-2 py-1 text-[10px] font-bold min-h-[32px] ${
                            isC
                              ? 'border-amber-400 bg-amber-400 text-slate-950'
                              : 'border-slate-700 text-slate-300'
                          }`}
                        >
                          C
                        </button>
                        <button
                          type="button"
                          onClick={() => setLineupRole(p.id, 'VC')}
                          className={`rounded-lg border px-2 py-1 text-[10px] font-bold min-h-[32px] ${
                            isVC
                              ? 'border-emerald-400 bg-emerald-400 text-slate-950'
                              : 'border-slate-700 text-slate-300'
                          }`}
                        >
                          VC
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Target Wishlist Strip (When Items Starred) */}
      {selectedTeam && wishlistIds.length > 0 && !isLobbyLocked && (
        <div className="rounded-2xl border border-slate-800 bg-[#0B1221] p-4 space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-amber-300">
            <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
            <span>Target Wishlist ({wishlistIds.length})</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {wishlistIds.map((pid) => {
              const p = playersMap.get(pid);
              if (!p) return null;
              return (
                <div
                  key={pid}
                  className="flex items-center justify-between text-xs rounded-xl bg-[#060B18] px-3 py-2 border border-slate-800"
                >
                  <span className="text-white font-medium truncate">{p.name}</span>
                  <span className="font-mono-tabular text-slate-400 shrink-0 ml-2">
                    {p.status === 'sold'
                      ? `Sold ${formatShortCurrency(p.soldPrice || 0, room.rules.currency)}`
                      : formatShortCurrency(p.basePrice, room.rules.currency)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
