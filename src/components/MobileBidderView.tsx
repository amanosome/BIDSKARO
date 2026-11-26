import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Cpu,
  Gavel,
  Layers,
  Lock,
  ShieldAlert,
  Star,
  TrendingUp,
  Users,
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
  onOpenHostControls,
  onPlaceBid,
  onLeaveRoom,
}) => {
  const [activeTeamId, setActiveTeamId] = useState<string>(
    assignedTeamId || room.teams[0]?.id || ''
  );
  const [customInput, setCustomInput] = useState<string>('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<'bid' | 'stack' | 'squads' | 'history'>('bid');
  const [auctionClockSeconds, setAuctionClockSeconds] = useState<number>(0);

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

  useEffect(() => {
    if (nextValidBid > 0) {
      setCustomInput(formatIndianCommas(nextValidBid));
      setLocalError(null);
    }
  }, [nextValidBid, currentPlayer?.id]);

  const reserveInfo = selectedTeam
    ? calculateReservedPurse(selectedTeam, room.rules, playersMap)
    : { slotsStillRequired: 0, reservedAmount: 0, maxAllowedBid: 0, overseasCount: 0 };

  const highestTeam = room.teams.find((t) => t.id === room.highestBidderTeamId);

  const timerColor =
    room.lotStatus !== 'bidding'
      ? 'text-slate-400'
      : remainingSeconds <= 1
        ? 'text-red-400 animate-urgent-blink'
        : remainingSeconds <= 3
          ? 'text-red-400'
          : remainingSeconds <= 5
            ? 'text-orange-400'
            : remainingSeconds <= 10
              ? 'text-amber-400'
              : 'text-emerald-400';

  const handleQuickBid = () => {
    if (!selectedTeam || !currentPlayer) return;
    setLocalError(null);
    onClearFeedback();
    const check = validateBidSubmission({
      room,
      teamId: selectedTeam.id,
      bidderId: participantId,
      amount: nextValidBid,
      bidType: canActAsHost ? 'host' : 'quick',
    });
    if (!check.valid) {
      setLocalError(check.reason || 'Bid cannot be placed.');
      return;
    }
    onPlaceBid({
      teamId: selectedTeam.id,
      amount: nextValidBid,
      bidType: canActAsHost ? 'host' : 'quick',
      bidderName: canActAsHost ? `${selectedTeam.ownerName} (${participantName})` : participantName,
    });
  };

  const adjustCustomAmount = (delta: number) => {
    setLocalError(null);
    const parsed = parseCustomBidInput(customInput);
    const base = parsed && parsed >= nextValidBid ? parsed : hasHighestBidder ? room.currentBid : 0;
    const nextVal = Math.max(nextValidBid, base + delta);
    setCustomInput(formatIndianCommas(nextVal));
  };

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTeam || !currentPlayer) return;
    setLocalError(null);
    onClearFeedback();

    const parsedAmount = parseCustomBidInput(customInput);
    if (parsedAmount === null) {
      setLocalError('Enter a valid amount (e.g. 2,75,00,000 or 2.75 Cr or 75 L).');
      return;
    }

    const check = validateBidSubmission({
      room,
      teamId: selectedTeam.id,
      bidderId: participantId,
      amount: parsedAmount,
      bidType: 'custom',
    });
    if (!check.valid) {
      setLocalError(check.reason || 'Invalid custom bid.');
      return;
    }

    onPlaceBid({
      teamId: selectedTeam.id,
      amount: parsedAmount,
      bidType: 'custom',
      bidderName: canActAsHost ? `${selectedTeam.ownerName} (${participantName})` : participantName,
    });
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

  const parsedPreview = parseCustomBidInput(customInput);
  const canBidNow =
    room.status === 'live' &&
    room.lotStatus === 'bidding' &&
    Boolean(currentPlayer) &&
    Boolean(selectedTeam) &&
    room.highestBidderTeamId !== selectedTeam?.id;

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

  return (
    <div className="max-w-6xl mx-auto space-y-5 pb-20 md:pb-6">
      {/* Team Bar & Host/Bidder Switcher */}
      <div className="rounded-xl border border-slate-800 bg-[#0D1526] p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-4">
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
                <span className="text-sm font-bold text-white truncate">
                  {selectedTeam?.name || 'Select Team'}
                </span>
                {selectedTeam?.isLocked && (
                  <span className="text-xs font-medium text-red-400">Locked</span>
                )}
                {room.rules.aiOpponentsEnabled && (
                  <span className="inline-flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                    <Cpu className="w-3 h-3" />
                    AI Opponents Active
                  </span>
                )}
                {room.status === 'live' && room.auctionEndDeadlineMs > 0 && (
                  <span className="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-mono-tabular font-semibold text-amber-300">
                    <Clock className="w-3 h-3" />
                    Room Left: {formatClockMMSS(auctionClockSeconds)}
                  </span>
                )}
              </div>
              <div className="text-xs text-slate-400 font-mono-tabular mt-0.5">
                Purse:{' '}
                <span className="text-emerald-400 font-semibold">
                  {formatCurrency(selectedTeam?.remainingPurse || 0, room.rules.currency)}
                </span>
                <span className="mx-1.5 text-slate-600">·</span>
                Squad: {selectedTeam?.squad.length || 0}/{room.rules.maxSquadSize} (Min {room.rules.minSquadSize})
                <span className="mx-1.5 text-slate-600">·</span>
                Max Bid:{' '}
                <span className="text-amber-300">
                  {formatShortCurrency(reserveInfo.maxAllowedBid, room.rules.currency)}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {canActAsHost && onOpenHostControls && (
              <button
                type="button"
                onClick={onOpenHostControls}
                className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-300 hover:bg-amber-500/20"
              >
                Host Controls
              </button>
            )}
            {onLeaveRoom && (
              <button
                type="button"
                onClick={onLeaveRoom}
                className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-300 hover:bg-red-500/20"
              >
                Leave Room
              </button>
            )}
            {(canActAsHost || !assignedTeamId) && (
              <div className="flex items-center gap-2">
                <label className="text-xs text-slate-400 whitespace-nowrap">
                  {canActAsHost ? 'Bid as Team:' : 'Your Team:'}
                </label>
                <select
                  value={activeTeamId}
                  onChange={(e) => {
                    setActiveTeamId(e.target.value);
                    onSelectTeam?.(e.target.value);
                    setLocalError(null);
                  }}
                  className="rounded-lg border border-slate-700 bg-[#060B18] px-3 py-2 text-xs font-medium text-white min-h-[40px]"
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

        {/* Squad Role Quota Tracker & +Extras Progress */}
        {selectedTeam && room.rules.roleQuotas && (
          <div className="pt-2.5 border-t border-slate-800/80 flex flex-wrap items-center gap-2 text-[11px] font-mono-tabular">
            <span className="text-slate-400 font-sans font-semibold mr-1">Role Targets:</span>
            <span
              className={`rounded-md border px-2 py-0.5 ${
                roleCounts.batters >= room.rules.roleQuotas.batters
                  ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300'
                  : 'border-slate-700 bg-[#060B18] text-slate-300'
              }`}
            >
              {isFootball ? 'FWD' : 'BAT'} {roleCounts.batters}/{room.rules.roleQuotas.batters}
            </span>
            <span
              className={`rounded-md border px-2 py-0.5 ${
                roleCounts.bowlers >= room.rules.roleQuotas.bowlers
                  ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300'
                  : 'border-slate-700 bg-[#060B18] text-slate-300'
              }`}
            >
              {isFootball ? 'DEF' : 'BWL'} {roleCounts.bowlers}/{room.rules.roleQuotas.bowlers}
            </span>
            <span
              className={`rounded-md border px-2 py-0.5 ${
                roleCounts.allRounders >= room.rules.roleQuotas.allRounders
                  ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300'
                  : 'border-slate-700 bg-[#060B18] text-slate-300'
              }`}
            >
              {isFootball ? 'MID' : 'AR'} {roleCounts.allRounders}/{room.rules.roleQuotas.allRounders}
            </span>
            <span
              className={`rounded-md border px-2 py-0.5 ${
                roleCounts.wicketkeepers >= room.rules.roleQuotas.wicketkeepers
                  ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300'
                  : 'border-slate-700 bg-[#060B18] text-slate-300'
              }`}
            >
              {isFootball ? 'GK' : 'WK'} {roleCounts.wicketkeepers}/{room.rules.roleQuotas.wicketkeepers}
            </span>
            <span className="rounded-md border border-amber-500/35 bg-amber-500/10 px-2 py-0.5 text-amber-300">
              Free-Choice Extras: {acquiredExtras}/{extrasLimit} · XI: {selectedTeam.startingXI?.length || 0}/{xiLimit}
            </span>
          </div>
        )}
      </div>

      {/* Mobile Tab Switcher */}
      <div className="flex md:hidden items-center gap-1 p-1 rounded-xl bg-[#0D1526] border border-slate-800">
        {(['bid', 'stack', 'squads', 'history'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setMobileTab(tab)}
            className={`flex-1 py-2.5 rounded-lg text-[11px] font-semibold transition-colors min-h-[44px] ${
              mobileTab === tab ? 'bg-emerald-500 text-slate-950' : 'text-slate-300'
            }`}
          >
            {tab === 'bid'
              ? 'Live Bid'
              : tab === 'stack'
                ? `My Stack (${selectedSquadPlayers.length})`
                : tab === 'squads'
                  ? 'Teams'
                  : 'History'}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Primary Bidding Console */}
        <div className={`lg:col-span-7 space-y-4 ${mobileTab !== 'bid' ? 'hidden md:block' : ''}`}>
          {isLobbyLocked ? (
            <div className="rounded-2xl border border-slate-800 bg-[#0D1526] p-8 text-center space-y-3">
              <div className="mx-auto w-12 h-12 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 flex items-center justify-center text-emerald-400">
                <Lock className="w-6 h-6" />
              </div>
              <h2 className="text-xl font-display font-bold text-white">
                Mystery Player Pool Locked ({room.players.length} Players)
              </h2>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                Players remain hidden before the auction starts so every franchise enters blind.{' '}
                {canActAsHost
                  ? 'As host/bidder, you can open Host Controls or start the auction now to reveal Lot #1.'
                  : 'Waiting for auction start to reveal Lot #1.'}
              </p>
              {canActAsHost && onSendCommand && (
                <button
                  type="button"
                  onClick={() => onSendCommand('start_auction', { playerId: room.currentPlayerId })}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-3 text-xs font-bold text-slate-950 hover:bg-emerald-400"
                >
                  Start Auction &amp; Reveal Lot #1
                </button>
              )}
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-800 bg-[#0D1526] p-5 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 text-xs font-medium text-slate-400">
                    <span>CURRENT PLAYER · {currentPlayer?.category || 'Waiting'}</span>
                    {currentPlayer && selectedTeam && onSendCommand && (
                      <button
                        type="button"
                        onClick={() =>
                          onSendCommand('toggle_wishlist', {
                            teamId: selectedTeam.id,
                            playerId: currentPlayer.id,
                          })
                        }
                        className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] border ${
                          isCurrentWishlisted
                            ? 'border-amber-400 bg-amber-500/20 text-amber-300'
                            : 'border-slate-700 text-slate-400 hover:text-white'
                        }`}
                      >
                        <Star className={`w-3 h-3 ${isCurrentWishlisted ? 'fill-amber-400 text-amber-400' : ''}`} />
                        <span>{isCurrentWishlisted ? 'Wishlisted' : 'Star Target'}</span>
                      </button>
                    )}
                  </div>
                  <h2 className="mt-1 text-2xl sm:text-3xl font-display font-extrabold tracking-tight text-white">
                    {currentPlayer ? currentPlayer.name.toUpperCase() : 'NO ACTIVE PLAYER'}
                  </h2>
                  {currentPlayer && (
                    <p className="mt-1 text-xs text-slate-300">
                      {currentPlayer.country} · {currentPlayer.role} · {currentPlayer.battingStyle}
                      <span className="text-slate-500"> · </span>
                      Base {formatCurrency(currentPlayer.basePrice, room.rules.currency)}
                    </p>
                  )}
                </div>

                <div className="text-right shrink-0">
                  <div className="text-[11px] font-medium text-slate-400">TIMER</div>
                  <div className={`text-4xl sm:text-5xl font-mono-tabular font-extrabold ${timerColor}`}>
                    {room.lotStatus === 'bidding' || room.lotStatus === 'paused'
                      ? `${remainingSeconds}s`
                      : room.lotStatus === 'awaiting_hammer'
                        ? '0s'
                        : '--'}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {room.lotStatus === 'paused'
                      ? 'PAUSED'
                      : room.lotStatus === 'awaiting_hammer'
                        ? 'AWAITING HAMMER'
                        : room.lotStatus === 'sold_reveal'
                          ? 'SOLD'
                          : room.lotStatus === 'unsold_reveal'
                            ? 'UNSOLD'
                            : room.lotStatus === 'bidding'
                              ? `Reset: ${room.rules.resetTimerSeconds}s`
                              : 'STANDBY'}
                  </div>
                </div>
              </div>

              {/* Current Bid & Next Minimum Bid */}
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-800/80">
                <div className="rounded-xl bg-[#060B18] border border-slate-800 p-3.5">
                  <div className="text-[11px] font-medium text-slate-400">
                    {hasHighestBidder ? 'CURRENT BID' : 'OPENING BASE PRICE'}
                  </div>
                  <div className="mt-1 text-xl sm:text-2xl font-mono-tabular font-extrabold text-white">
                    {currentPlayer ? formatCurrency(room.currentBid, room.rules.currency) : '—'}
                  </div>
                  <div className="mt-1 text-xs truncate">
                    {highestTeam ? (
                      <span className="font-semibold text-amber-400">
                        Held by {highestTeam.name}
                      </span>
                    ) : (
                      <span className="text-slate-500">No bids placed yet</span>
                    )}
                  </div>
                </div>

                <div className="rounded-xl bg-[#060B18] border border-slate-800 p-3.5">
                  <div className="text-[11px] font-medium text-slate-400">NEXT MINIMUM BID</div>
                  <div className="mt-1 text-xl sm:text-2xl font-mono-tabular font-extrabold text-emerald-400">
                    {currentPlayer ? formatCurrency(nextValidBid, room.rules.currency) : '—'}
                  </div>
                  <div className="mt-1 text-xs text-slate-400 font-mono-tabular">
                    Min Increment: +{formatCurrency(currentIncrement, room.rules.currency)}
                  </div>
                </div>
              </div>

              {/* Validation / Server Feedback */}
              {(localError || bidFeedback) && (
                <div
                  className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-xs ${
                    localError || bidFeedback?.type === 'rejected'
                      ? 'border-red-500/40 bg-red-950/50 text-red-200'
                      : 'border-emerald-500/40 bg-emerald-950/50 text-emerald-200'
                  }`}
                >
                  {localError || bidFeedback?.type === 'rejected' ? (
                    <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  )}
                  <span>{localError || bidFeedback?.message}</span>
                </div>
              )}

              {/* Highest Bidder Banner */}
              {room.highestBidderTeamId === selectedTeam?.id && room.lotStatus === 'bidding' && (
                <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-xs font-semibold text-amber-300 flex items-center justify-between">
                  <span>You currently hold the highest bid for {currentPlayer?.name}.</span>
                  <span className="font-mono-tabular">{formatShortCurrency(room.currentBid, room.rules.currency)}</span>
                </div>
              )}

              {/* Snake Draft Pick Action OR Verbal Mode Banner OR Standard Quick/Custom Bid */}
              {isSnakeMode ? (
                <div className="space-y-3 pt-2 border-t border-slate-800/80">
                  <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5 text-xs flex items-center justify-between">
                    <div>
                      <div className="font-bold text-amber-300">
                        SNAKE DRAFT ROUND {room.snakeDraftRound} · PICK #{room.snakeDraftPickIndex + 1}
                      </div>
                      <div className="text-slate-200 mt-0.5">
                        Turn: <strong>{snakeTurnTeam?.name}</strong>
                      </div>
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
                      className="w-full min-h-[52px] rounded-xl bg-emerald-500 px-5 py-3 text-sm font-display font-extrabold text-slate-950 hover:bg-emerald-400"
                    >
                      DRAFT {currentPlayer.name.toUpperCase()} FOR {snakeTurnTeam?.shortCode} ({formatShortCurrency(currentPlayer.basePrice, room.rules.currency)})
                    </button>
                  )}
                </div>
              ) : room.rules.biddingStyle === 'verbal' && !canActAsHost ? (
                <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-xs text-amber-200">
                  <strong>Verbal Table Bidding Active:</strong> Call your bids aloud in the room. The auctioneer records the winning team &amp; price directly onto the Big Screen.
                </div>
              ) : (
                <>
                  {(room.rules.allowQuickBid || canActAsHost) && (
                    <div className="space-y-1.5">
                      <div className="text-[11px] font-semibold tracking-wide text-slate-400">
                        OPTION A · QUICK BID
                      </div>
                      <button
                        type="button"
                        disabled={!canBidNow}
                        onClick={handleQuickBid}
                        className="w-full min-h-[54px] rounded-xl bg-emerald-500 px-5 py-3.5 text-base font-display font-extrabold text-slate-950 hover:bg-emerald-400 active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2.5"
                      >
                        <Gavel className="w-5 h-5" />
                        <span>
                          {currentPlayer
                            ? `BID ${formatCurrency(nextValidBid, room.rules.currency).toUpperCase()}`
                            : 'WAITING FOR NEXT PLAYER'}
                        </span>
                      </button>
                    </div>
                  )}

                  {(room.rules.allowCustomBid || canActAsHost) && (
                    <form onSubmit={handleCustomSubmit} className="space-y-3 pt-3 border-t border-slate-800/80">
                      <div className="flex items-center justify-between">
                        <label
                          htmlFor="custom-bid-input"
                          className="text-[11px] font-semibold tracking-wide text-slate-300"
                        >
                          OPTION B · ENTER YOUR BID AMOUNT
                        </label>
                        {parsedPreview && (
                          <span className="text-xs font-mono-tabular text-amber-300 font-semibold">
                            = {formatCurrency(parsedPreview, room.rules.currency)}
                          </span>
                        )}
                      </div>

                      <div className="flex flex-col sm:flex-row gap-2.5">
                        <div className="relative flex-1">
                          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-mono-tabular text-slate-400">
                            ₹
                          </span>
                          <input
                            id="custom-bid-input"
                            type="text"
                            inputMode="decimal"
                            value={customInput}
                            onChange={(e) => {
                              setCustomInput(e.target.value);
                              setLocalError(null);
                            }}
                            placeholder="2,50,00,000 or 2.5 Cr"
                            className="w-full min-h-[48px] rounded-xl border border-slate-700 bg-[#060B18] pl-8 pr-4 py-2.5 text-base font-mono-tabular font-bold text-white placeholder:text-slate-600 focus:border-amber-400 focus:outline-none"
                          />
                        </div>
                        <button
                          type="submit"
                          disabled={!canBidNow}
                          className="min-h-[48px] rounded-xl border border-amber-500/50 bg-amber-500 px-5 py-2.5 text-sm font-display font-extrabold text-slate-950 hover:bg-amber-400 active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed transition-all whitespace-nowrap shrink-0"
                        >
                          SUBMIT CUSTOM BID
                        </button>
                      </div>

                      <div className="grid grid-cols-4 gap-2">
                        {[
                          { label: '+10 LAKH', val: 10 * LAKH },
                          { label: '+25 LAKH', val: 25 * LAKH },
                          { label: '+50 LAKH', val: 50 * LAKH },
                          { label: '+1 CRORE', val: 1 * CRORE },
                        ].map((chip) => (
                          <button
                            key={chip.label}
                            type="button"
                            disabled={!currentPlayer}
                            onClick={() => adjustCustomAmount(chip.val)}
                            className="min-h-[44px] rounded-lg border border-slate-700 bg-[#060B18] px-2 py-2 text-xs font-mono-tabular font-semibold text-slate-200 hover:border-emerald-500/50 hover:text-emerald-300 active:scale-[0.98] transition-colors"
                          >
                            {chip.label}
                          </button>
                        ))}
                      </div>
                    </form>
                  )}
                </>
              )}
            </div>
          )}

          {/* Increment Table Visibility */}
          {room.rules.showIncrementTableToBidders && (
            <div className="rounded-xl border border-slate-800 bg-[#0D1526] p-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-300 mb-2.5">
                <TrendingUp className="w-4 h-4 text-emerald-400" />
                <span>Configured Bid Increment Rules</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                {room.rules.incrementTable.map((tier) => (
                  <div
                    key={tier.id}
                    className="flex items-center justify-between rounded-lg bg-[#060B18] border border-slate-800/80 px-3 py-2 font-mono-tabular"
                  >
                    <span className="text-slate-400">
                      {formatShortCurrency(tier.minBid, room.rules.currency)} –{' '}
                      {tier.maxBid === null ? 'Above' : formatShortCurrency(tier.maxBid, room.rules.currency)}
                    </span>
                    <span className="font-bold text-emerald-400">
                      +{formatShortCurrency(tier.increment, room.rules.currency)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Acquired Bidder Stack & Final Playing XI Selector (Desktop + Mobile Stack Tab) */}
          {selectedTeam && (
            <div
              className={`rounded-2xl border border-slate-800 bg-[#0D1526] p-5 space-y-3 ${
                mobileTab === 'stack' ? 'block' : 'hidden md:block'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-sm font-bold text-white">
                    {selectedTeam.name} — Acquired Stack ({selectedSquadPlayers.length}/{room.rules.maxSquadSize})
                  </h3>
                </div>
                <span className="text-xs font-mono-tabular text-amber-300 font-semibold">
                  Final Playing XI: {selectedTeam.startingXI?.length || 0}/{xiLimit} · Extras:{' '}
                  {Math.max(0, selectedSquadPlayers.length - (selectedTeam.startingXI?.length || 0))}
                </span>
              </div>

              <p className="text-[11px] text-slate-400">
                Acquire up to {room.rules.maxSquadSize} players (including +{extrasLimit} free-choice extras), then toggle your {xiLimit} starters below. Unfilled squads are randomly auto-completed if timer ends.
              </p>

              {selectedSquadPlayers.length === 0 ? (
                <div className="rounded-xl border border-slate-800 bg-[#060B18] p-5 text-center text-xs text-slate-500">
                  No players won in your stack yet. Winning bids add players directly here.
                </div>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {selectedSquadPlayers.map((p) => {
                    const inXI = selectedTeam.startingXI?.includes(p.id);
                    const isC = selectedTeam.captainId === p.id;
                    const isVC = selectedTeam.viceCaptainId === p.id;
                    return (
                      <div
                        key={p.id}
                        className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs ${
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
                            {p.role} · Bought {formatShortCurrency(p.soldPrice || p.basePrice, room.rules.currency)}
                          </div>
                        </div>
                        {onSendCommand && (
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => togglePlayerInXI(p.id)}
                              className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold ${
                                inXI
                                  ? 'border-emerald-400 bg-emerald-500 text-slate-950'
                                  : 'border-slate-700 text-slate-300 hover:border-slate-500'
                              }`}
                            >
                              {inXI ? 'Playing XI' : 'Extra / Bench'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setLineupRole(p.id, 'C')}
                              className={`rounded-lg border px-2 py-1 text-[10px] font-bold ${
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
                              className={`rounded-lg border px-2 py-1 text-[10px] font-bold ${
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
        </div>

        {/* Side Column: Squads & Live Bid History */}
        <div className={`lg:col-span-5 space-y-4 ${mobileTab === 'bid' ? 'hidden md:block' : ''}`}>
          {/* Live Lot Bid Feed */}
          <div className={`rounded-xl border border-slate-800 bg-[#0D1526] p-4 ${mobileTab === 'squads' || mobileTab === 'stack' ? 'hidden md:block' : ''}`}>
            <h3 className="text-sm font-semibold text-white mb-3">
              Accepted Bids on Current Lot ({room.currentLotBids.length})
            </h3>
            {room.currentLotBids.length === 0 ? (
              <p className="text-xs text-slate-500 py-4 text-center">
                No accepted bids yet for {currentPlayer?.name || 'current lot'}.
              </p>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {room.currentLotBids.map((bid, idx) => (
                  <div
                    key={bid.id}
                    className={`flex items-center justify-between rounded-lg border px-3 py-2 text-xs ${
                      idx === 0
                        ? 'border-amber-500/40 bg-amber-500/10'
                        : 'border-slate-800 bg-[#060B18]'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: bid.teamColor }}
                      />
                      <div className="truncate">
                        <span className="font-semibold text-white">{bid.teamName}</span>
                        <span className="text-slate-400"> · {bid.bidderName}</span>
                      </div>
                    </div>
                    <span className="font-mono-tabular font-bold text-emerald-300 shrink-0 ml-2">
                      {formatCurrency(bid.amount, room.rules.currency)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* All Teams Purse & Squad Tracker */}
          <div className={`rounded-xl border border-slate-800 bg-[#0D1526] p-4 ${mobileTab === 'history' ? 'hidden md:block' : ''}`}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Users className="w-4 h-4 text-emerald-400" />
                <span>Franchise Purses ({room.teams.length})</span>
              </h3>
              <span className="text-[11px] text-slate-400">
                Min {room.rules.minSquadSize} · Max {room.rules.maxSquadSize}
              </span>
            </div>
            <div className="space-y-2.5">
              {room.teams.map((t) => {
                const pct = Math.max(0, Math.min(100, (t.remainingPurse / t.initialPurse) * 100));
                return (
                  <div
                    key={t.id}
                    className={`rounded-lg border p-3 ${
                      t.id === activeTeamId
                        ? 'border-emerald-500/40 bg-[#060B18]'
                        : 'border-slate-800 bg-[#060B18]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-semibold text-white truncate">
                        {t.name} {t.id === activeTeamId ? '(You)' : ''}
                      </span>
                      <span className="font-mono-tabular font-bold text-emerald-400 shrink-0">
                        {formatCurrency(t.remainingPurse, room.rules.currency)}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${pct}%`, backgroundColor: t.primaryColor }}
                      />
                    </div>
                    <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-400 font-mono-tabular">
                      <span>
                        Squad: {t.squad.length}/{room.rules.maxSquadSize} (XI: {t.startingXI?.length || 0})
                      </span>
                      <span>Spent: {formatShortCurrency(t.amountSpent, room.rules.currency)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {currentPlayer && !isLobbyLocked && (
            <div className="rounded-xl border border-slate-800 bg-[#0D1526] p-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-300 mb-2">
                <ShieldAlert className="w-4 h-4 text-amber-400" />
                <span>Player Career &amp; Historical Metrics</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs font-mono-tabular">
                <div className="rounded-lg bg-[#060B18] p-2.5 border border-slate-800">
                  <div className="text-[10px] text-slate-400">MATCHES</div>
                  <div className="text-sm font-bold text-white">{currentPlayer.stats.matches}</div>
                </div>
                <div className="rounded-lg bg-[#060B18] p-2.5 border border-slate-800">
                  <div className="text-[10px] text-slate-400">
                    {currentPlayer.sport === 'football' ? 'GOALS / xG' : 'RUNS / SR'}
                  </div>
                  <div className="text-sm font-bold text-white">
                    {currentPlayer.stats.runs} · {currentPlayer.stats.strikeRate}
                  </div>
                </div>
                <div className="rounded-lg bg-[#060B18] p-2.5 border border-slate-800">
                  <div className="text-[10px] text-slate-400">
                    {currentPlayer.sport === 'football' ? 'AST / CS' : 'WKTS / ECON'}
                  </div>
                  <div className="text-sm font-bold text-white">
                    {currentPlayer.sport === 'football'
                      ? `${currentPlayer.stats.average} / ${currentPlayer.stats.wickets}`
                      : `${currentPlayer.stats.wickets} · ${currentPlayer.stats.economy || '—'}`}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Target Wishlist */}
          {selectedTeam && wishlistIds.length > 0 && !isLobbyLocked && (
            <div className="rounded-xl border border-slate-800 bg-[#0D1526] p-4 space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-amber-300">
                <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                <span>Your Target Wishlist ({wishlistIds.length})</span>
              </div>
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {wishlistIds.map((pid) => {
                  const p = playersMap.get(pid);
                  if (!p) return null;
                  return (
                    <div key={pid} className="flex items-center justify-between text-xs rounded-lg bg-[#060B18] px-3 py-1.5 border border-slate-800">
                      <span className="text-white font-medium truncate">{p.name}</span>
                      <span className="font-mono-tabular text-slate-400 shrink-0 ml-2">
                        {p.status === 'sold' ? `Sold (${formatShortCurrency(p.soldPrice || 0, room.rules.currency)})` : formatShortCurrency(p.basePrice, room.rules.currency)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

