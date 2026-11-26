import {
  AuctionPlayer,
  AuctionRoomState,
  AuctionRules,
  BidIncrementTier,
  BidValidationResult,
  PlayerCategory,
  RoleQuotas,
  Team,
} from './auctionTypes';
import { CRORE, formatCurrency, LAKH } from './currency';

export const DEFAULT_INCREMENT_TABLE: BidIncrementTier[] = [
  { id: 'tier-1', minBid: 0, maxBid: 50 * LAKH, increment: 10 * LAKH },
  { id: 'tier-2', minBid: 50 * LAKH, maxBid: 1 * CRORE, increment: 10 * LAKH },
  { id: 'tier-3', minBid: 1 * CRORE, maxBid: 5 * CRORE, increment: 25 * LAKH },
  { id: 'tier-4', minBid: 5 * CRORE, maxBid: 10 * CRORE, increment: 50 * LAKH },
  { id: 'tier-5', minBid: 10 * CRORE, maxBid: null, increment: 1 * CRORE },
];

export function computeDefaultRoleQuotas(minSquadSize: number): RoleQuotas {
  if (minSquadSize >= 11) {
    return { batters: 4, bowlers: 4, allRounders: 2, wicketkeepers: 1 };
  }
  if (minSquadSize <= 5) {
    return { batters: 2, bowlers: 2, allRounders: 1, wicketkeepers: 0 };
  }
  const bat = Math.max(2, Math.round(minSquadSize * 0.36));
  const bwl = Math.max(2, Math.round(minSquadSize * 0.36));
  const wk = minSquadSize >= 7 ? 1 : 0;
  const ar = Math.max(1, minSquadSize - bat - bwl - wk);
  return { batters: bat, bowlers: bwl, allRounders: ar, wicketkeepers: wk };
}

export const DEFAULT_AUCTION_RULES: AuctionRules = {
  currency: 'INR',
  buildingMode: 'auction',
  biddingStyle: 'in_app',
  stackMode: 'lifetime',
  playMode: 'ai',
  defaultTeamPurse: 200 * CRORE,
  maxTeamPurse: 200 * CRORE,
  initialTimerSeconds: 10,
  resetTimerSeconds: 15,
  maxAuctionDurationMinutes: 20,
  matchesPerTeamPerSeason: 14,
  standardRetentionLimit: 4,
  runnerUpRetentionLimit: 5,
  championRetentionLimit: 6,
  incrementTable: DEFAULT_INCREMENT_TABLE,
  categoryOverrides: [],
  minBidFloor: 10 * LAKH,
  maxBidCap: null,
  allowCustomBid: true,
  allowQuickBid: true,
  autoUnsoldOnExpire: true,
  manualClosingMode: false,
  antiSnipingEnabled: true,
  antiSnipingWindowSeconds: 5,
  minSquadSize: 11,
  maxSquadSize: 18,
  playingXISize: 11,
  roleQuotas: { batters: 4, bowlers: 4, allRounders: 2, wicketkeepers: 1 },
  maxOverseasPlayers: 8,
  reservePerEmptySlot: 10 * LAKH,
  rtmEnabled: true,
  impactPlayerRule: true,
  aiOpponentsEnabled: true,
  allBiddersCanHost: true,
  showBidderNameOnBigScreen: true,
  showIncrementTableToBidders: true,
  hostCanBid: true,
  hostCanEditRulesLive: false,
  rulesLocked: true,
  lockRulesAfterCreate: true,
  marqueeSelectionMode: 'auto_all',
  startingMarqueePlayerIds: [],
  marqueeMarkupPercent: 10,
  tournamentMode: 'full_season',
};

/**
 * Automatically scales a player's base price proportionally to the room's team purse size
 * (baseline 200 Crore), rounded cleanly to 5 Lakh steps and floored safely.
 */
export function computeScaledBasePrice(
  rawBasePriceIn200Cr: number,
  teamPurse: number,
  minBidFloor = 10 * LAKH
): number {
  const safePurse = Math.max(10 * CRORE, teamPurse || 200 * CRORE);
  const ratio = safePurse / (200 * CRORE);
  const step = safePurse < 50 * CRORE ? 1 * LAKH : 5 * LAKH;
  const effectiveFloor = Math.max(
    step,
    Math.min(minBidFloor, Math.round((safePurse * 0.005) / step) * step)
  );
  const scaled = Math.round((rawBasePriceIn200Cr * ratio) / step) * step;
  return Math.max(effectiveFloor, scaled);
}

/**
 * Computes Marquee player price as Highest Team Player Price + 15% (default markup),
 * rounded cleanly to valid bid increment steps and safely bounded to room purse.
 */
export function computeMarqueePrice(
  highestTeamPlayerPrice: number,
  fallbackBasePrice: number,
  teamPurse: number,
  minBidFloor = 10 * LAKH,
  markupPercent = 15
): number {
  const safePurse = Math.max(10 * CRORE, teamPurse || 200 * CRORE);
  const step = safePurse < 50 * CRORE ? 1 * LAKH : 5 * LAKH;
  const reference = Math.max(highestTeamPlayerPrice || 0, fallbackBasePrice || minBidFloor);
  const withMarkup = Math.round((reference * (1 + markupPercent / 100)) / step) * step;
  const safeCeiling = Math.max(minBidFloor, Math.round((safePurse * 0.25) / step) * step);
  return Math.max(minBidFloor, Math.min(safeCeiling, withMarkup));
}

/**
 * Retention limit per team when moving between lifetime seasons:
 * - Champion: up to 6 players
 * - Runner-Up: up to 5 players
 * - All other teams: up to 4 players
 * - Season-Only stacks: 0 retained players
 */
export function getTeamRetentionLimit(
  room: Pick<AuctionRoomState, 'rules' | 'seasonChampionTeamId' | 'seasonRunnerUpTeamId'>,
  teamId: string
): number {
  if (room.rules.stackMode === 'season_only') return 0;
  if (room.seasonChampionTeamId && room.seasonChampionTeamId === teamId) {
    return room.rules.championRetentionLimit ?? 6;
  }
  if (room.seasonRunnerUpTeamId && room.seasonRunnerUpTeamId === teamId) {
    return room.rules.runnerUpRetentionLimit ?? 5;
  }
  return room.rules.standardRetentionLimit ?? 4;
}

export function getMinIncrementForBid(
  currentBid: number,
  rules: AuctionRules,
  category?: PlayerCategory
): number {
  if (category && rules.categoryOverrides?.length) {
    const override = rules.categoryOverrides.find((c) => c.category === category);
    if (override && override.minIncrement > 0) {
      // Respect override as floor if higher than tier, or direct rule
      const tierInc = findTierIncrement(currentBid, rules.incrementTable);
      return Math.max(override.minIncrement, tierInc);
    }
  }
  return findTierIncrement(currentBid, rules.incrementTable);
}

function findTierIncrement(currentBid: number, tiers: BidIncrementTier[]): number {
  const sorted = [...tiers].sort((a, b) => a.minBid - b.minBid);
  for (const tier of sorted) {
    const aboveMin = currentBid >= tier.minBid;
    const belowMax = tier.maxBid === null || currentBid < tier.maxBid;
    if (aboveMin && belowMax) {
      return Math.max(1 * LAKH, tier.increment);
    }
  }
  return sorted[sorted.length - 1]?.increment ?? 10 * LAKH;
}

export function getNextValidBid(
  currentBid: number,
  hasHighestBidder: boolean,
  playerBasePrice: number,
  rules: AuctionRules,
  category?: PlayerCategory
): number {
  if (!hasHighestBidder || currentBid === 0) {
    return Math.max(playerBasePrice, rules.minBidFloor);
  }
  const inc = getMinIncrementForBid(currentBid, rules, category);
  return currentBid + inc;
}

export function calculateReservedPurse(team: Team, rules: AuctionRules, playersMap: Map<string, AuctionPlayer>): {
  slotsStillRequired: number;
  reservedAmount: number;
  maxAllowedBid: number;
  overseasCount: number;
} {
  const currentCount = team.squad.length;
  const slotsAfterThisBuy = currentCount + 1;
  const slotsStillRequired = Math.max(0, rules.minSquadSize - slotsAfterThisBuy);
  const reservedAmount = slotsStillRequired * rules.reservePerEmptySlot;
  const maxAllowedBid = Math.max(0, team.remainingPurse - reservedAmount);

  let overseasCount = 0;
  for (const pid of team.squad) {
    const p = playersMap.get(pid);
    if (p?.isOverseas) overseasCount += 1;
  }

  return {
    slotsStillRequired,
    reservedAmount,
    maxAllowedBid,
    overseasCount,
  };
}

export function validateBidSubmission(params: {
  room: AuctionRoomState;
  teamId: string;
  bidderId: string;
  amount: number;
  bidType: 'quick' | 'custom' | 'host';
  expectedSequence?: number;
  bidRequestId?: string;
  recentRequestIds?: Set<string>;
  nowMs?: number;
}): BidValidationResult {
  const {
    room,
    teamId,
    bidderId,
    amount,
    bidType,
    expectedSequence,
    bidRequestId,
    recentRequestIds,
    nowMs = Date.now(),
  } = params;

  if (!room) {
    return { valid: false, reason: 'Auction room does not exist.' };
  }

  if (bidRequestId && recentRequestIds?.has(bidRequestId)) {
    return { valid: false, reason: 'Duplicate bid submission detected.' };
  }

  if (room.status !== 'live') {
    return { valid: false, reason: 'The auction is no longer active.' };
  }

  if (room.lotStatus === 'paused') {
    return { valid: false, reason: 'Auction is currently paused by the host.' };
  }

  if (room.lotStatus !== 'bidding') {
    return { valid: false, reason: 'Bidding is closed for this player.' };
  }

  const player = room.players.find((p) => p.id === room.currentPlayerId);
  if (!player) {
    return { valid: false, reason: 'No player is currently on the auction block.' };
  }

  if (nowMs > room.timerDeadlineMs) {
    return { valid: false, reason: 'The countdown timer has expired.' };
  }

  const isHostActor =
    bidderId === room.hostId ||
    room.rules.allBiddersCanHost ||
    Boolean(room.participants.find((p) => p.id === bidderId)?.role === 'host');
  const participant = room.participants.find((p) => p.id === bidderId);
  if (!isHostActor && !participant) {
    return { valid: false, reason: 'You are not registered as a participant in this room.' };
  }

  if (bidderId === room.hostId && !room.rules.hostCanBid) {
    return { valid: false, reason: 'Host bidding is disabled in auction rules.' };
  }

  if (!isHostActor && participant?.role !== 'bidder' && participant?.role !== 'host') {
    return { valid: false, reason: 'Spectators cannot submit bids.' };
  }

  const team = room.teams.find((t) => t.id === teamId);
  if (!team) {
    return { valid: false, reason: 'Selected team was not found in this room.' };
  }

  if (!isHostActor && participant?.teamId && participant.teamId !== teamId) {
    return { valid: false, reason: `You are assigned to another team and cannot bid for ${team.name}.` };
  }

  if (team.isLocked) {
    return { valid: false, reason: `${team.name} is currently locked by the host.` };
  }

  if (bidType === 'custom' && !room.rules.allowCustomBid && !isHostActor) {
    return { valid: false, reason: 'Custom manual bidding is disabled by the host.' };
  }

  if (bidType === 'quick' && !room.rules.allowQuickBid && !isHostActor) {
    return { valid: false, reason: 'Quick bidding is disabled by the host.' };
  }

  if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(amount)) {
    return { valid: false, reason: 'Please enter a valid monetary amount.' };
  }

  if (
    expectedSequence !== undefined &&
    expectedSequence !== room.bidSequence &&
    amount <= room.currentBid
  ) {
    return { valid: false, reason: 'Another team has already placed a higher bid.' };
  }

  if (room.highestBidderTeamId === team.id) {
    return { valid: false, reason: `${team.name} already holds the highest bid.` };
  }

  const hasHighest = Boolean(room.highestBidderTeamId && room.currentBid > 0);
  const nextMin = getNextValidBid(
    room.currentBid,
    hasHighest,
    player.basePrice,
    room.rules,
    player.category
  );

  if (hasHighest && amount <= room.currentBid) {
    return {
      valid: false,
      reason: 'Another team has already placed a higher bid.',
      nextMinimumBid: nextMin,
    };
  }

  if (amount < nextMin) {
    return {
      valid: false,
      reason: `Your bid must be at least ${formatCurrency(nextMin, room.rules.currency)}.`,
      nextMinimumBid: nextMin,
    };
  }

  // Validate increment alignment if custom bid
  const minInc = getMinIncrementForBid(room.currentBid, room.rules, player.category);
  const baseUnit = Math.min(minInc, 5 * LAKH);
  if (amount % baseUnit !== 0) {
    return {
      valid: false,
      reason: `Your bid must follow the auction increment rules (multiples of ${formatCurrency(baseUnit, room.rules.currency)}).`,
      nextMinimumBid: nextMin,
    };
  }

  // Category or global max bid cap
  const categoryOverride = room.rules.categoryOverrides?.find((c) => c.category === player.category);
  const effectiveCap = categoryOverride?.maxBidCap ?? room.rules.maxBidCap;
  if (effectiveCap && amount > effectiveCap) {
    return {
      valid: false,
      reason: `Bid exceeds the maximum allowed bid cap of ${formatCurrency(effectiveCap, room.rules.currency)}.`,
      nextMinimumBid: nextMin,
    };
  }

  if (amount > team.remainingPurse) {
    return {
      valid: false,
      reason: 'Your bid exceeds your remaining team budget.',
      nextMinimumBid: nextMin,
    };
  }

  if (team.squad.length >= room.rules.maxSquadSize) {
    return {
      valid: false,
      reason: `${team.name} has already reached the maximum squad size of ${room.rules.maxSquadSize} players.`,
    };
  }

  const playersMap = new Map(room.players.map((p) => [p.id, p]));
  const reserve = calculateReservedPurse(team, room.rules, playersMap);

  if (player.isOverseas && reserve.overseasCount >= room.rules.maxOverseasPlayers) {
    return {
      valid: false,
      reason: `${team.name} has reached the overseas player limit (${room.rules.maxOverseasPlayers}).`,
    };
  }

  if (amount > reserve.maxAllowedBid) {
    return {
      valid: false,
      reason: `Insufficient budget after reserving ${formatCurrency(reserve.reservedAmount, room.rules.currency)} for ${reserve.slotsStillRequired} mandatory minimum squad slot(s). Max bid: ${formatCurrency(reserve.maxAllowedBid, room.rules.currency)}.`,
      nextMinimumBid: nextMin,
    };
  }

  return { valid: true, nextMinimumBid: nextMin };
}
