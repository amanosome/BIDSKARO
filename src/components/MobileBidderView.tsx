import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Crown,
  Layers,
  Lock,
  Monitor,
  Pause,
  Pencil,
  Play,
  QrCode,
  RotateCcw,
  Star,
} from 'lucide-react';
import { AuctionPlayer, AuctionRoomState, PlayerRole, Team } from '../shared/auctionTypes';
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
  onOpenInvite?: () => void;
  onOpenTV?: () => void;
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
}> = [
  { key: '10l', label: '10L', value: 10 * LAKH },
  { key: '20l', label: '20L', value: 20 * LAKH },
  { key: '50l', label: '50L', value: 50 * LAKH },
  { key: '1cr', label: '1 CR', value: 1 * CRORE },
  { key: '5cr', label: '5 CR', value: 5 * CRORE },
  { key: '10cr', label: '10 CR', value: 10 * CRORE },
];

function formatClockMMSS(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
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
  onOpenInvite,
  onOpenTV,
  onPlaceBid,
}) => {
  const [activeTeamId, setActiveTeamId] = useState<string>(
    assignedTeamId || room.teams[0]?.id || ''
  );
  const [customInput, setCustomInput] = useState<string>('');
  const [selectedPreset, setSelectedPreset] = useState<RaisePresetKey>('default');
  const [localError, setLocalError] = useState<string | null>(null);
  const [auctionClockSeconds, setAuctionClockSeconds] = useState<number>(0);
  const [copiedKey, setCopiedKey] = useState<'room' | 'tv' | null>(null);

  const canActAsHost = isHost || Boolean(room.rules.allBiddersCanHost);
  const isAiDuelMode = room.rules.playMode === 'ai' && room.rules.aiOpponentsEnabled;
  const isLobbyLocked = room.status === 'lobby';

  const handleCopyCode = async (value: string, key: 'room' | 'tv') => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(null), 1600);
    } catch {
      // ignore clipboard errors
    }
  };

  useEffect(() => {
    if (assignedTeamId) {
      setActiveTeamId(assignedTeamId);
    } else if (isAiDuelMode && room.teams[0]?.id) {
      setActiveTeamId(room.teams[0].id);
    }
  }, [assignedTeamId, isAiDuelMode, room.teams]);

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

  const xiLimit = Math.min(room.rules.playingXISize || 11, room.rules.minSquadSize || 11, 11);
  const extrasLimit = Math.max(0, room.rules.maxSquadSize - xiLimit);

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

  // Step-up quick bid amount for the vibrant blue button (mirrors "Bid 1 Cr" / "Bid 2 Cr")
  const stepUpIncrement = currentIncrement >= 1 * CRORE ? currentIncrement : Math.max(currentIncrement, 1 * CRORE);
  const stepUpBid = currentPlayer
    ? hasHighestBidder
      ? nextValidBid + currentIncrement
      : currentPlayer.basePrice + stepUpIncrement
    : 0;

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

  const timerProgressPct = useMemo(() => {
    const maxSec = Math.max(room.rules.resetTimerSeconds || 10, room.rules.initialTimerSeconds || 10, 1);
    if (room.lotStatus !== 'bidding' && room.lotStatus !== 'paused') return 0;
    return Math.min(100, Math.max(0, (remainingSeconds / maxSec) * 100));
  }, [remainingSeconds, room.lotStatus, room.rules.initialTimerSeconds, room.rules.resetTimerSeconds]);

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

  const playersNeededCount = Math.max(0, room.rules.minSquadSize - (selectedTeam?.squad.length || 0));

  const renderTeamSlotGroup = (
    label: string,
    playersInBucket: AuctionPlayer[],
    quotaTarget: number
  ) => {
    const slotCount = Math.max(quotaTarget, playersInBucket.length, 1);
    const rows = Array.from({ length: slotCount }, (_, idx) => playersInBucket[idx] || null);
    return (
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[10px] font-semibold tracking-wider uppercase text-slate-400">
          <span>{label}</span>
          <span className="font-mono-tabular text-slate-500">
            {playersInBucket.length}/{quotaTarget}
          </span>
        </div>
        <div className="space-y-1.5">
          {rows.map((slotPlayer, idx) =>
            slotPlayer ? (
              <div
                key={slotPlayer.id}
                className="rounded-lg border border-slate-200 bg-[#F8FAFC] px-2.5 py-2 flex items-center justify-between gap-2 text-xs"
              >
                <div className="min-w-0">
                  <div className="font-semibold text-slate-900 truncate">{slotPlayer.name}</div>
                  <div className="text-[10px] font-mono-tabular text-slate-500">
                    M:{slotPlayer.stats.matches} · {slotPlayer.sport === 'football' ? 'G' : 'R'}:{slotPlayer.stats.runs} · SR:{slotPlayer.stats.strikeRate}
                  </div>
                </div>
                <span className="font-mono-tabular font-bold text-[#2D62FF] shrink-0">
                  {formatShortCurrency(slotPlayer.soldPrice || slotPlayer.basePrice, room.rules.currency)}
                </span>
              </div>
            ) : (
              <div
                key={`${label}-open-${idx}`}
                className="rounded-lg border border-dashed border-slate-200 bg-[#FAFBFD] px-3 py-2 text-center text-[11px] font-medium text-slate-400"
              >
                Open
              </div>
            )
          )}
        </div>
      </div>
    );
  };

  const renderTeamCard = (team: Team, teamIdx: number) => {
    const isSelected = team.id === selectedTeam?.id;
    const isLeading = team.id === room.highestBidderTeamId;
    const canSwitch = !isAiDuelMode && (canActAsHost || !assignedTeamId);
    const teamPlayers = team.squad
      .map((id) => playersMap.get(id))
      .filter((p): p is AuctionPlayer => Boolean(p));

    const batters = teamPlayers.filter((p) => mapRoleToBucket(p.role) === 'batters');
    const bowlers = teamPlayers.filter((p) => mapRoleToBucket(p.role) === 'bowlers');
    const keepers = teamPlayers.filter((p) => mapRoleToBucket(p.role) === 'wicketkeepers');
    const allRounders = teamPlayers.filter((p) => mapRoleToBucket(p.role) === 'allRounders');

    const teamReserve = calculateReservedPurse(team, room.rules, playersMap);
    const quotas = room.rules.roleQuotas || { batters: 2, bowlers: 1, allRounders: 1, wicketkeepers: 1 };

    return (
      <div
        key={team.id}
        onClick={() => {
          if (!canSwitch) return;
          setActiveTeamId(team.id);
          onSelectTeam?.(team.id);
          setLocalError(null);
        }}
        className={`rounded-2xl bg-white p-4 transition-all ${
          isSelected
            ? 'border-2 border-[#2D62FF] shadow-sm'
            : 'border border-slate-200 shadow-xs'
        } ${canSwitch ? 'cursor-pointer hover:border-slate-300' : ''}`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <span
              className={`text-sm font-display font-bold truncate ${
                isSelected ? 'text-[#2D62FF]' : 'text-slate-900'
              }`}
            >
              {team.name}
            </span>
            {isSelected && <Crown className="w-3.5 h-3.5 text-[#2D62FF] shrink-0" />}
            {isAiDuelMode && teamIdx === 1 && (
              <span className="text-[10px] font-mono-tabular font-semibold text-slate-400 shrink-0">
                (AI)
              </span>
            )}
          </div>
          {isLeading && (
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 shrink-0">
              Leading
            </span>
          )}
        </div>

        <div className="mt-1 flex items-baseline gap-1 font-mono-tabular">
          <span className="text-lg font-extrabold text-slate-950">
            {formatShortCurrency(team.remainingPurse, room.rules.currency)}
          </span>
          <span className="text-xs font-medium text-slate-500">left</span>
        </div>

        <div className="text-[11px] font-mono-tabular text-slate-500 mt-0.5">
          {team.squad.length}/{room.rules.maxSquadSize} players · max bid{' '}
          {formatShortCurrency(teamReserve.maxAllowedBid, room.rules.currency)}
        </div>

        <div className="my-3 border-t border-slate-100" />

        <div className="space-y-3">
          {renderTeamSlotGroup(isFootball ? 'FORWARDS' : 'BATTERS', batters, quotas.batters)}
          {renderTeamSlotGroup(isFootball ? 'DEFENDERS' : 'BOWLERS', bowlers, quotas.bowlers)}
          {renderTeamSlotGroup(isFootball ? 'GOALKEEPER' : 'KEEPER', keepers, quotas.wicketkeepers)}
          {renderTeamSlotGroup(isFootball ? 'MIDFIELDERS' : 'ALL-ROUNDERS', allRounders, quotas.allRounders)}
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-[1320px] mx-auto space-y-4 pb-12 text-slate-900">
      {/* Compact Light Control Strip: Pause/Resume (Host Limited Controls) + Invite & TV Codes */}
      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 flex flex-wrap items-center justify-between gap-2.5 shadow-xs">
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
          <span className="font-display font-bold text-slate-900">
            {selectedTeam?.name || 'Select Team'}
          </span>
          {room.status === 'live' && room.auctionEndDeadlineMs > 0 && (
            <>
              <span className="text-slate-300" aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1 font-mono-tabular text-slate-600">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                <span>{formatClockMMSS(auctionClockSeconds)}</span>
              </span>
            </>
          )}
          <span className="text-slate-300" aria-hidden="true">·</span>
          <span className="font-mono-tabular text-slate-500">
            {room.rules.aiOpponentsEnabled ? '1v1 vs AI' : `${room.teams.length} Teams`}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Limited Host Live Controls: Pause / Resume */}
          {canActAsHost && room.status === 'live' && onSendCommand && (
            <>
              {room.lotStatus === 'bidding' ? (
                <button
                  type="button"
                  onClick={() => onSendCommand('pause_timer')}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-100 min-h-[38px] whitespace-nowrap shrink-0"
                >
                  <Pause className="w-3.5 h-3.5" />
                  <span>Pause</span>
                </button>
              ) : room.lotStatus === 'paused' ? (
                <button
                  type="button"
                  onClick={() => onSendCommand('resume_timer')}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#2D62FF] px-3 py-2 text-xs font-bold text-white hover:bg-[#1E52E8] min-h-[38px] whitespace-nowrap shrink-0"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>Resume</span>
                </button>
              ) : null}
            </>
          )}

          {/* Always-Visible Room Invite Code & TV Big Screen Code */}
          <button
            type="button"
            onClick={() => handleCopyCode(room.roomCode, 'room')}
            title="Copy Room Invite Code"
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-[#F8FAFC] px-3 py-2 text-xs font-mono-tabular font-bold text-slate-800 hover:border-slate-300 min-h-[38px] whitespace-nowrap shrink-0"
          >
            {copiedKey === 'room' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5 text-slate-500" />}
            <span>Invite: {room.roomCode}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (onOpenInvite) {
                onOpenInvite();
              } else {
                const baseUrl =
                  typeof window !== 'undefined'
                    ? `${window.location.origin}${window.location.pathname}`
                    : '';
                handleCopyCode(`${baseUrl}?room=${encodeURIComponent(room.roomCode)}&view=tv`, 'tv');
              }
            }}
            title="View or Copy Big Screen TV Invite Code"
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-[#F8FAFC] px-3 py-2 text-xs font-mono-tabular font-bold text-slate-800 hover:border-[#2D62FF] min-h-[38px] whitespace-nowrap shrink-0"
          >
            <Monitor className="w-3.5 h-3.5 text-[#2D62FF]" />
            <span>{copiedKey === 'tv' ? 'TV Copied' : `TV Code: ${room.roomCode}`}</span>
          </button>

          {onOpenTV && (
            <button
              type="button"
              onClick={onOpenTV}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 min-h-[38px] whitespace-nowrap shrink-0"
            >
              <QrCode className="w-3.5 h-3.5 text-slate-600" />
              <span>Open TV</span>
            </button>
          )}

          {(canActAsHost || !assignedTeamId) && !isAiDuelMode && (
            <select
              id="active-team-select"
              value={activeTeamId}
              onChange={(e) => {
                setActiveTeamId(e.target.value);
                onSelectTeam?.(e.target.value);
                setLocalError(null);
              }}
              className="rounded-xl border border-slate-200 bg-[#F8FAFC] px-3 py-2 text-xs font-semibold text-slate-800 min-h-[38px]"
            >
              {room.teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({formatShortCurrency(t.remainingPurse, room.rules.currency)})
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {isLobbyLocked ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 sm:p-12 text-center space-y-4 shadow-xs">
          <div className="mx-auto w-14 h-14 rounded-2xl border border-slate-200 bg-[#F4F6FA] flex items-center justify-center text-[#2D62FF]">
            <Lock className="w-6 h-6" />
          </div>
          <h2 className="text-xl sm:text-2xl font-display font-bold text-slate-950">
            Mystery Player Pool Locked ({room.players.length} Players)
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 max-w-md mx-auto">
            Players stay hidden before the auction starts so every franchise enters blind.{' '}
            {canActAsHost
              ? 'Start the auction now to reveal Player #1 and open bidding.'
              : 'Waiting for the auction to start.'}
          </p>
          {canActAsHost && onSendCommand && (
            <button
              type="button"
              onClick={() => onSendCommand('start_auction', { playerId: room.currentPlayerId })}
              className="inline-flex items-center gap-2 rounded-xl bg-[#2D62FF] px-6 py-3.5 text-sm font-display font-bold text-white hover:bg-[#1E52E8] transition-colors min-h-[48px] whitespace-nowrap"
            >
              <Play className="w-4 h-4 fill-current" />
              <span>Start Auction &amp; Reveal Lot #1</span>
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* MAIN AUCTION FLOW (Matches Uploaded Reference Screenshot) */}
          <div className="lg:col-span-8 space-y-4">
            {/* 1. Metallic Silver Stage + Dark Floating Player Trading Card */}
            <div className="relative rounded-2xl bg-gradient-to-br from-[#D1D7E0] via-[#E1E6EE] to-[#B7C1CE] p-5 sm:p-8 flex items-center justify-center overflow-hidden border border-slate-300/70 shadow-sm">
              {/* Subtle Geometric Corner Shapes Matching Backdrop */}
              <svg
                className="absolute top-0 left-0 w-36 h-36 text-[#BCC6D3] opacity-65 pointer-events-none"
                viewBox="0 0 120 120"
                fill="currentColor"
                aria-hidden="true"
              >
                <polygon points="0,0 75,0 38,65 0,65" />
                <polygon points="85,0 120,0 120,55 62,55" />
              </svg>
              <svg
                className="absolute bottom-0 right-0 w-40 h-40 text-[#AAB5C4] opacity-55 pointer-events-none"
                viewBox="0 0 120 120"
                fill="currentColor"
                aria-hidden="true"
              >
                <polygon points="35,55 120,55 120,120 10,120" />
              </svg>

              {/* Dark Floating Collectible Player Card */}
              <div className="relative z-10 w-full max-w-[370px] rounded-2xl bg-gradient-to-b from-[#171A23] via-[#11141C] to-[#0A0D13] text-white p-5 sm:p-6 shadow-[0_24px_48px_-12px_rgba(15,23,42,0.55)] border border-white/10">
                {/* Top Card Header: BASE + Role */}
                <div className="flex items-center justify-between gap-2 text-[10px] font-semibold tracking-wider uppercase">
                  <span className="text-slate-400">
                    BASE{' '}
                    <strong className="font-mono-tabular text-white ml-1">
                      {currentPlayer ? formatShortCurrency(currentPlayer.basePrice, room.rules.currency) : '—'}
                    </strong>
                  </span>
                  <div className="flex items-center gap-1.5">
                    {currentPlayer && (
                      <span className="rounded bg-white/10 border border-white/15 px-2 py-0.5 text-[10px] font-bold text-white">
                        {currentPlayer.role.toUpperCase()}
                      </span>
                    )}
                    {currentPlayer && selectedTeam && onSendCommand && (
                      <button
                        type="button"
                        onClick={() =>
                          onSendCommand('toggle_wishlist', {
                            teamId: selectedTeam.id,
                            playerId: currentPlayer.id,
                          })
                        }
                        title={isCurrentWishlisted ? 'Remove from Target Wishlist' : 'Save to Target Wishlist'}
                        className="p-1 rounded hover:bg-white/10 transition-colors"
                      >
                        <Star
                          className={`w-3.5 h-3.5 ${
                            isCurrentWishlisted ? 'fill-amber-400 text-amber-400' : 'text-slate-400'
                          }`}
                        />
                      </button>
                    )}
                  </div>
                </div>

                {/* Big Bold Player Name & Bio Subtitle */}
                <div className="mt-3">
                  <h2 className="text-2xl sm:text-[28px] font-display font-extrabold text-white leading-[1.12] tracking-tight break-words">
                    {currentPlayer ? currentPlayer.name : 'Standby'}
                  </h2>
                  {currentPlayer && (
                    <p className="mt-1.5 text-xs text-slate-400 leading-snug">
                      {currentPlayer.country} · {currentPlayer.battingStyle}
                      {currentPlayer.historicalPeakPrice ? ` · Peak ${currentPlayer.historicalPeakPrice}` : ''}
                    </p>
                  )}
                </div>

                {/* Primary 3 Career Stat Boxes (RUNS / STRIKE RATE / HIGH SCORE) */}
                {currentPlayer && (
                  <>
                    <div className="mt-4 grid grid-cols-3 gap-2">
                      <div className="rounded-xl bg-white/[0.06] border border-white/10 p-2.5 text-center">
                        <div className="text-lg font-mono-tabular font-extrabold text-white leading-none">
                          {currentPlayer.stats.runs}
                        </div>
                        <div className="mt-1 text-[9px] font-semibold tracking-wider uppercase text-slate-400">
                          {currentPlayer.sport === 'football' ? 'GOALS' : 'RUNS'}
                        </div>
                      </div>
                      <div className="rounded-xl bg-white/[0.06] border border-white/10 p-2.5 text-center">
                        <div className="text-lg font-mono-tabular font-extrabold text-white leading-none">
                          {currentPlayer.stats.strikeRate}
                        </div>
                        <div className="mt-1 text-[9px] font-semibold tracking-wider uppercase text-slate-400">
                          {currentPlayer.sport === 'football' ? 'xG INDEX' : 'STRIKE RATE'}
                        </div>
                      </div>
                      <div className="rounded-xl bg-white/[0.06] border border-white/10 p-2.5 text-center">
                        <div className="text-lg font-mono-tabular font-extrabold text-white leading-none">
                          {currentPlayer.stats.highestScore}
                        </div>
                        <div className="mt-1 text-[9px] font-semibold tracking-wider uppercase text-slate-400">
                          {currentPlayer.sport === 'football' ? 'BEST' : 'HIGH SCORE'}
                        </div>
                      </div>
                    </div>

                    {/* Complete Original Career Stats Mini-Grid inside Card */}
                    <div className="mt-2.5 pt-2.5 border-t border-white/10 grid grid-cols-3 gap-1.5 text-center font-mono-tabular text-[10px]">
                      <div className="rounded-lg bg-white/[0.04] px-1.5 py-1">
                        <span className="text-slate-400 block text-[8px] uppercase">
                          {currentPlayer.sport === 'football' ? 'ASSISTS' : 'AVG'}
                        </span>
                        <span className="font-bold text-slate-100">{currentPlayer.stats.average}</span>
                      </div>
                      <div className="rounded-lg bg-white/[0.04] px-1.5 py-1">
                        <span className="text-slate-400 block text-[8px] uppercase">
                          {currentPlayer.sport === 'football' ? 'CLEAN SH' : 'WKTS'}
                        </span>
                        <span className="font-bold text-slate-100">{currentPlayer.stats.wickets}</span>
                      </div>
                      <div className="rounded-lg bg-white/[0.04] px-1.5 py-1">
                        <span className="text-slate-400 block text-[8px] uppercase">
                          {currentPlayer.sport === 'football' ? 'RTG / 90' : 'ECON'}
                        </span>
                        <span className="font-bold text-amber-300">{currentPlayer.stats.economy || '—'}</span>
                      </div>
                      <div className="rounded-lg bg-white/[0.04] px-1.5 py-1">
                        <span className="text-slate-400 block text-[8px] uppercase">50s / 100s</span>
                        <span className="font-bold text-slate-100">{currentPlayer.stats.fiftiesHundreds}</span>
                      </div>
                      <div className="rounded-lg bg-white/[0.04] px-1.5 py-1">
                        <span className="text-slate-400 block text-[8px] uppercase">BEST BWL</span>
                        <span className="font-bold text-slate-100 truncate block">{currentPlayer.stats.bestBowling || '—'}</span>
                      </div>
                      <div className="rounded-lg bg-white/[0.04] px-1.5 py-1">
                        <span className="text-slate-400 block text-[8px] uppercase">MVP</span>
                        <span className="font-bold text-emerald-400">{currentPlayer.rating}</span>
                      </div>
                    </div>

                    <div className="mt-2.5 text-center text-[11px] font-mono-tabular text-slate-400">
                      {currentPlayer.stats.matches} matches
                      {currentPlayer.seasonsActive.length > 0
                        ? ` · ${currentPlayer.seasonsActive.slice(0, 3).join(', ')}`
                        : ` in ${room.seasonYear}`}
                    </div>

                    {/* Bottom Franchise / Season Strip */}
                    <div className="mt-3 rounded-xl bg-[#271024] border border-white/10 px-3.5 py-2.5 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="w-1 h-6 rounded-full bg-pink-500 shrink-0" aria-hidden="true" />
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-white truncate">
                            {currentPlayer.realTeamCode
                              ? `${currentPlayer.realTeamCode} · ${currentPlayer.category}`
                              : currentPlayer.category}
                          </div>
                          <div className="text-[10px] font-mono-tabular text-pink-200/80">
                            {room.leagueId} {room.seasonYear}
                          </div>
                        </div>
                      </div>
                      <span className="text-[10px] font-mono-tabular text-slate-300 shrink-0">
                        {currentPlayer.bowlingStyle}
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* 2. White Bidding Console Card */}
            <div className="rounded-2xl bg-white border border-slate-200 p-4 sm:p-5 shadow-xs space-y-3.5">
              {/* Top Row: Price + Countdown */}
              <div className="flex items-end justify-between gap-4">
                <div>
                  <div className="text-xs font-medium text-slate-500">
                    {hasHighestBidder
                      ? `Current bid · ${highestTeam?.name || 'Leading Team'}`
                      : 'Starts at'}
                  </div>
                  <div className="mt-0.5 text-3xl sm:text-[36px] leading-none font-display font-extrabold text-slate-950 font-mono-tabular tracking-tight">
                    {currentPlayer ? formatShortCurrency(room.currentBid, room.rules.currency) : '—'}
                  </div>
                </div>

                <div className="text-right">
                  <div
                    className={`text-2xl sm:text-3xl font-mono-tabular font-extrabold leading-none ${
                      room.lotStatus === 'bidding' && remainingSeconds <= 3
                        ? 'text-red-600'
                        : room.lotStatus === 'bidding' && remainingSeconds <= 5
                          ? 'text-orange-600'
                          : room.lotStatus === 'paused'
                            ? 'text-amber-600'
                            : 'text-slate-950'
                    }`}
                  >
                    {room.lotStatus === 'bidding' || room.lotStatus === 'paused'
                      ? formatClockMMSS(remainingSeconds)
                      : room.lotStatus === 'awaiting_hammer'
                        ? '0:00'
                        : '--:--'}
                  </div>
                  <div className="mt-1.5 h-1 w-20 ml-auto rounded-full bg-slate-200 overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ${
                        remainingSeconds <= 3 && room.lotStatus === 'bidding'
                          ? 'bg-red-600'
                          : 'bg-slate-950'
                      }`}
                      style={{ width: `${timerProgressPct}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Feedback Banner */}
              {(localError || bidFeedback) && (
                <div
                  className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-xs ${
                    localError || bidFeedback?.type === 'rejected'
                      ? 'border-red-200 bg-red-50 text-red-700'
                      : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  }`}
                >
                  {localError || bidFeedback?.type === 'rejected' ? (
                    <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  )}
                  <span className="leading-snug">{localError || bidFeedback?.message}</span>
                </div>
              )}

              {isSnakeMode ? (
                <div className="space-y-2.5">
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                    <strong>
                      Snake Draft Round {room.snakeDraftRound} · Pick #{room.snakeDraftPickIndex + 1}
                    </strong>{' '}
                    — On the clock: {snakeTurnTeam?.name}
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
                      className="w-full min-h-[48px] rounded-xl bg-[#2D62FF] px-5 py-3 text-sm font-display font-bold text-white hover:bg-[#1E52E8]"
                    >
                      Draft {currentPlayer.name} ({formatShortCurrency(currentPlayer.basePrice, room.rules.currency)})
                    </button>
                  )}
                </div>
              ) : room.rules.biddingStyle === 'verbal' && !canActAsHost ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-900">
                  <strong>Verbal Table Bidding Active:</strong> Call your bids aloud in the room. Winning bids update live.
                </div>
              ) : (
                <>
                  {/* Primary Two-Button Action Row (Black + Royal Blue matching screenshot) */}
                  <div className="grid grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      disabled={!canBidNow}
                      onClick={() =>
                        submitBid(nextValidBid, canActAsHost ? 'host' : 'quick')
                      }
                      className="min-h-[54px] rounded-xl bg-[#0B0F19] hover:bg-[#181F32] text-white px-3 py-2.5 text-center transition-colors disabled:opacity-45 disabled:cursor-not-allowed"
                    >
                      <div className="text-sm sm:text-base font-display font-bold leading-tight">
                        {isHoldingHighest
                          ? 'Leading Bid'
                          : `Bid ${formatShortCurrency(nextValidBid, room.rules.currency)}`}
                      </div>
                      <div className="text-[11px] text-slate-300 mt-0.5">
                        {hasHighestBidder ? 'default increment' : 'open at base price'}
                      </div>
                    </button>

                    <button
                      type="button"
                      disabled={!canBidNow}
                      onClick={() =>
                        submitBid(stepUpBid, canActAsHost ? 'host' : 'quick')
                      }
                      className="min-h-[54px] rounded-xl bg-[#2D62FF] hover:bg-[#1D52EB] text-white px-3 py-2.5 text-center transition-colors disabled:opacity-45 disabled:cursor-not-allowed"
                    >
                      <div className="text-sm sm:text-base font-display font-bold leading-tight">
                        Bid {formatShortCurrency(stepUpBid, room.rules.currency)}
                      </div>
                      <div className="text-[11px] text-blue-100 mt-0.5">
                        open at {formatShortCurrency(stepUpBid, room.rules.currency)}
                      </div>
                    </button>
                  </div>

                  {/* Quick-Raise Increment Chips + Default Option */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      disabled={!currentPlayer}
                      onClick={handleSelectDefaultPreset}
                      className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11px] font-mono-tabular font-semibold transition-colors whitespace-nowrap ${
                        selectedPreset === 'default'
                          ? 'border-[#2D62FF] bg-blue-50 text-[#2D62FF]'
                          : 'border-slate-200 bg-[#F8FAFC] text-slate-700 hover:border-slate-300'
                      }`}
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Default</span>
                    </button>
                    {QUICK_RAISE_PRESETS.map((chip) => {
                      const active = selectedPreset === chip.key;
                      return (
                        <button
                          key={chip.key}
                          type="button"
                          disabled={!currentPlayer}
                          onClick={() => handleSelectRaisePreset(chip.key, chip.value)}
                          className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-mono-tabular font-semibold transition-colors whitespace-nowrap ${
                            active
                              ? 'border-[#2D62FF] bg-[#2D62FF] text-white'
                              : 'border-slate-200 bg-[#F8FAFC] text-slate-700 hover:border-[#2D62FF] hover:text-[#2D62FF]'
                          }`}
                        >
                          +{chip.label}
                        </button>
                      );
                    })}
                  </div>

                  {/* Custom Manual Input + Bid Button (Matches "Type any amount Cr [Bid]") */}
                  {(room.rules.allowCustomBid || canActAsHost) && (
                    <form onSubmit={handlePlaceStagedBid} className="flex items-center gap-2">
                      <div className="flex-1 flex items-center gap-2 rounded-xl border border-slate-200 bg-[#F4F6FA] px-3.5 py-2.5 focus-within:border-[#2D62FF] focus-within:bg-white transition-colors min-h-[44px]">
                        <Pencil className="w-3.5 h-3.5 text-slate-400 shrink-0" />
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
                          placeholder="Type any amount"
                          className="w-full bg-transparent text-sm font-mono-tabular font-semibold text-slate-900 placeholder:text-slate-400 focus:outline-none"
                        />
                        <span className="text-xs font-mono-tabular text-slate-500 shrink-0">
                          {formatShortCurrency(parsedStagedBid, room.rules.currency)}
                        </span>
                      </div>
                      <button
                        type="submit"
                        disabled={!canBidNow}
                        className="min-h-[44px] px-5 rounded-xl bg-[#0B0F19] hover:bg-[#2D62FF] text-white text-xs sm:text-sm font-display font-bold transition-colors disabled:bg-slate-200 disabled:text-slate-400 shrink-0"
                      >
                        Bid
                      </button>
                    </form>
                  )}

                  <div className="text-[11px] text-slate-500">
                    Every bid resets the clock to {room.rules.resetTimerSeconds}s.
                  </div>
                </>
              )}
            </div>

            {/* 3. Three KPI Metric Cards (Purse left / Max you can bid / Players needed) */}
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl bg-white border border-slate-200 p-3.5 shadow-xs">
                <div className="text-[11px] text-slate-500">Purse left</div>
                <div className="mt-1 text-base sm:text-lg font-display font-extrabold font-mono-tabular text-slate-950">
                  {formatShortCurrency(selectedTeam?.remainingPurse || 0, room.rules.currency)}
                </div>
              </div>
              <div className="rounded-xl bg-white border border-slate-200 p-3.5 shadow-xs">
                <div className="text-[11px] text-slate-500">Max you can bid</div>
                <div className="mt-1 text-base sm:text-lg font-display font-extrabold font-mono-tabular text-slate-950">
                  {formatShortCurrency(reserveInfo.maxAllowedBid, room.rules.currency)}
                </div>
              </div>
              <div className="rounded-xl bg-white border border-slate-200 p-3.5 shadow-xs">
                <div className="text-[11px] text-slate-500">Players needed</div>
                <div className="mt-1 text-base sm:text-lg font-display font-extrabold font-mono-tabular text-slate-950">
                  {playersNeededCount}
                </div>
              </div>
            </div>

            {/* 4. Teams Grid with Role Quota Slots (BATTERS / BOWLERS / KEEPER / ALL-ROUNDERS) */}
            <section className="space-y-3 pt-1">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-display font-bold text-slate-950">Teams</h3>
                <span className="text-xs font-mono-tabular text-slate-500">
                  {room.teams.length} {room.teams.length === 1 ? 'Team' : 'Teams'}
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {room.teams.map((t, idx) => renderTeamCard(t, idx))}
              </div>
            </section>
          </div>

          {/* RIGHT SIDEBAR RAIL (Last Bids + Full Original Stats + Acquired Stack XI) */}
          <aside className="lg:col-span-4 space-y-4">
            {/* Last Bids Card (Matches "Last ..." card in screenshot) */}
            <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-display font-bold text-slate-950">Last Bids</h3>
                <span className="text-xs font-mono-tabular text-slate-400">
                  {room.currentLotBids.length} {room.currentLotBids.length === 1 ? 'bid' : 'bids'}
                </span>
              </div>
              {room.currentLotBids.length === 0 ? (
                <div className="text-xs text-slate-500 py-2">Nobody has bid yet</div>
              ) : (
                <div className="space-y-2 max-h-60 overflow-y-auto pr-0.5">
                  {room.currentLotBids.map((bid, idx) => {
                    const bidTeam = room.teams.find((tm) => tm.id === bid.teamId);
                    const timeText = new Date(bid.timestamp).toLocaleTimeString([], {
                      hour: 'numeric',
                      minute: '2-digit',
                    });
                    return (
                      <div
                        key={bid.id}
                        className={`rounded-xl border px-3 py-2 flex items-center justify-between gap-2 ${
                          idx === 0
                            ? 'border-[#2D62FF]/40 bg-blue-50/70'
                            : 'border-slate-200 bg-[#F8FAFC]'
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
                            <div className="text-xs font-semibold text-slate-900 truncate">
                              {bid.teamName}
                            </div>
                            <div className="text-[10px] font-mono-tabular text-slate-400">
                              {timeText}
                            </div>
                          </div>
                        </div>
                        <span className="text-sm font-mono-tabular font-extrabold text-slate-950 shrink-0">
                          {formatShortCurrency(bid.amount, room.rules.currency)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Complete Original Player Career Stats & Historical Profile */}
            {currentPlayer && (
              <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-xs space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-display font-bold text-slate-950">
                    Original Career Stats
                  </h3>
                  <span className="text-xs font-mono-tabular font-bold text-[#2D62FF]">
                    Rating {currentPlayer.rating}/100
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 font-mono-tabular text-xs">
                  <div className="rounded-xl bg-[#F8FAFC] border border-slate-200 p-2.5">
                    <div className="text-[10px] text-slate-500">MATCHES</div>
                    <div className="font-bold text-slate-950 mt-0.5">{currentPlayer.stats.matches}</div>
                  </div>
                  <div className="rounded-xl bg-[#F8FAFC] border border-slate-200 p-2.5">
                    <div className="text-[10px] text-slate-500">
                      {currentPlayer.sport === 'football' ? 'GOALS' : 'RUNS'}
                    </div>
                    <div className="font-bold text-slate-950 mt-0.5">{currentPlayer.stats.runs}</div>
                  </div>
                  <div className="rounded-xl bg-[#F8FAFC] border border-slate-200 p-2.5">
                    <div className="text-[10px] text-slate-500">
                      {currentPlayer.sport === 'football' ? 'ASSISTS' : 'AVERAGE'}
                    </div>
                    <div className="font-bold text-slate-950 mt-0.5">{currentPlayer.stats.average}</div>
                  </div>
                  <div className="rounded-xl bg-[#F8FAFC] border border-slate-200 p-2.5">
                    <div className="text-[10px] text-slate-500">
                      {currentPlayer.sport === 'football' ? 'xG INDEX' : 'STRIKE RATE'}
                    </div>
                    <div className="font-bold text-[#2D62FF] mt-0.5">{currentPlayer.stats.strikeRate}</div>
                  </div>
                  <div className="rounded-xl bg-[#F8FAFC] border border-slate-200 p-2.5">
                    <div className="text-[10px] text-slate-500">
                      {currentPlayer.sport === 'football' ? 'BEST' : 'HIGH SCORE'}
                    </div>
                    <div className="font-bold text-slate-950 mt-0.5">{currentPlayer.stats.highestScore}</div>
                  </div>
                  <div className="rounded-xl bg-[#F8FAFC] border border-slate-200 p-2.5">
                    <div className="text-[10px] text-slate-500">
                      {currentPlayer.sport === 'football' ? 'MILESTONES' : '50s / 100s'}
                    </div>
                    <div className="font-bold text-slate-950 mt-0.5">{currentPlayer.stats.fiftiesHundreds}</div>
                  </div>
                  <div className="rounded-xl bg-[#F8FAFC] border border-slate-200 p-2.5">
                    <div className="text-[10px] text-slate-500">
                      {currentPlayer.sport === 'football' ? 'CLEAN SH' : 'WICKETS'}
                    </div>
                    <div className="font-bold text-slate-950 mt-0.5">{currentPlayer.stats.wickets}</div>
                  </div>
                  <div className="rounded-xl bg-[#F8FAFC] border border-slate-200 p-2.5">
                    <div className="text-[10px] text-slate-500">
                      {currentPlayer.sport === 'football' ? 'RTG / 90' : 'ECONOMY'}
                    </div>
                    <div className="font-bold text-slate-950 mt-0.5">{currentPlayer.stats.economy || '—'}</div>
                  </div>
                  <div className="rounded-xl bg-[#F8FAFC] border border-slate-200 p-2.5">
                    <div className="text-[10px] text-slate-500">
                      {currentPlayer.sport === 'football' ? 'BEST REC' : 'BEST BWL'}
                    </div>
                    <div className="font-bold text-slate-950 mt-0.5 truncate">{currentPlayer.stats.bestBowling || '—'}</div>
                  </div>
                </div>

                <div className="text-[11px] text-slate-600 space-y-1 pt-1 border-t border-slate-100">
                  <div>
                    <span className="text-slate-400">Styles:</span>{' '}
                    <strong className="text-slate-800">{currentPlayer.battingStyle}</strong>
                    {currentPlayer.bowlingStyle ? ` · ${currentPlayer.bowlingStyle}` : ''}
                  </div>
                  {currentPlayer.seasonsActive.length > 0 && (
                    <div className="font-mono-tabular">
                      <span className="font-sans text-slate-400">Seasons:</span>{' '}
                      {currentPlayer.seasonsActive.join(', ')}
                    </div>
                  )}
                  {currentPlayer.historicalPeakPrice && (
                    <div className="font-mono-tabular">
                      <span className="font-sans text-slate-400">Peak Auction:</span>{' '}
                      <strong className="text-slate-900">{currentPlayer.historicalPeakPrice}</strong>
                    </div>
                  )}
                  {currentPlayer.historicalNote && (
                    <p className="text-slate-500 leading-relaxed pt-0.5">
                      {currentPlayer.historicalNote}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* My Acquired Stack & Playing XI Selector */}
            {selectedTeam && (
              <div
                id="my-squad-stack-section"
                className="rounded-2xl bg-white border border-slate-200 p-4 shadow-xs space-y-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <Layers className="w-4 h-4 text-[#2D62FF]" />
                    <h3 className="text-sm font-display font-bold text-slate-950">
                      Squad &amp; Playing XI
                    </h3>
                  </div>
                  <span className="text-[11px] font-mono-tabular text-slate-500">
                    XI {selectedTeam.startingXI?.length || 0}/{xiLimit} · +{extrasLimit} Extras
                  </span>
                </div>

                {selectedSquadPlayers.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-[#FAFBFD] p-4 text-center text-xs text-slate-400">
                    No players acquired yet. Winning bids add players directly here.
                  </div>
                ) : (
                  <div className="space-y-2 max-h-72 overflow-y-auto pr-0.5">
                    {selectedSquadPlayers.map((p) => {
                      const inXI = selectedTeam.startingXI?.includes(p.id);
                      const isC = selectedTeam.captainId === p.id;
                      const isVC = selectedTeam.viceCaptainId === p.id;
                      return (
                        <div
                          key={p.id}
                          className={`rounded-xl border px-3 py-2 text-xs flex items-center justify-between gap-2 ${
                            inXI
                              ? 'border-[#2D62FF]/40 bg-blue-50/50'
                              : 'border-slate-200 bg-[#F8FAFC]'
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="font-bold text-slate-950 flex items-center gap-1">
                              <span className="truncate">{p.name}</span>
                              {isC && <span className="text-[10px] font-mono-tabular text-[#2D62FF]">(C)</span>}
                              {isVC && <span className="text-[10px] font-mono-tabular text-emerald-600">(VC)</span>}
                            </div>
                            <div className="text-[10px] font-mono-tabular text-slate-500">
                              {p.role} · {formatShortCurrency(p.soldPrice || p.basePrice, room.rules.currency)} · M:{p.stats.matches} R:{p.stats.runs}
                            </div>
                          </div>
                          {onSendCommand && (
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={() => togglePlayerInXI(p.id)}
                                className={`rounded-lg border px-2 py-1 text-[10px] font-semibold ${
                                  inXI
                                    ? 'border-[#2D62FF] bg-[#2D62FF] text-white'
                                    : 'border-slate-200 bg-white text-slate-600'
                                }`}
                              >
                                {inXI ? 'XI' : 'Ext'}
                              </button>
                              <button
                                type="button"
                                onClick={() => setLineupRole(p.id, 'C')}
                                className={`rounded-lg border px-1.5 py-1 text-[10px] font-bold ${
                                  isC
                                    ? 'border-amber-400 bg-amber-400 text-slate-950'
                                    : 'border-slate-200 bg-white text-slate-600'
                                }`}
                              >
                                C
                              </button>
                              <button
                                type="button"
                                onClick={() => setLineupRole(p.id, 'VC')}
                                className={`rounded-lg border px-1.5 py-1 text-[10px] font-bold ${
                                  isVC
                                    ? 'border-emerald-500 bg-emerald-500 text-white'
                                    : 'border-slate-200 bg-white text-slate-600'
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

            {/* Target Wishlist Strip */}
            {selectedTeam && wishlistIds.length > 0 && (
              <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-xs space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
                  <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                  <span>Target Wishlist ({wishlistIds.length})</span>
                </div>
                <div className="space-y-1.5">
                  {wishlistIds.map((pid) => {
                    const p = playersMap.get(pid);
                    if (!p) return null;
                    return (
                      <div
                        key={pid}
                        className="flex items-center justify-between text-xs rounded-lg bg-[#F8FAFC] px-3 py-2 border border-slate-200"
                      >
                        <span className="text-slate-900 font-medium truncate">{p.name}</span>
                        <span className="font-mono-tabular text-slate-500 shrink-0 ml-2">
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
          </aside>
        </div>
      )}
    </div>
  );
};
