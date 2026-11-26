export type LeagueId =
  | 'CUSTOM'
  | 'IPL'
  | 'WPL'
  | 'SA20'
  | 'BBL'
  | 'CPL'
  | 'ILT20'
  | 'THE_HUNDRED'
  | 'PSL'
  | 'EPL'
  | 'LA_LIGA'
  | 'SERIE_A'
  | 'BUNDESLIGA'
  | 'UCL';

export type SportType = 'cricket' | 'football';

export type BuildingMode = 'auction' | 'snake_draft';

export type BiddingStyle = 'in_app' | 'verbal';

export type StackMode = 'lifetime' | 'season_only';

export type PlayMode = 'friends' | 'ai';

export type CurrencyCode = 'INR' | 'USD' | 'GBP' | 'AUD' | 'AED';

export type PlayerRole =
  | 'Batter'
  | 'Bowler'
  | 'All-Rounder'
  | 'Wicketkeeper'
  | 'Forward'
  | 'Midfielder'
  | 'Defender'
  | 'Goalkeeper';

export type PlayerCategory =
  | 'Marquee'
  | 'Capped Batter'
  | 'Capped Bowler'
  | 'Capped All-Rounder'
  | 'Wicketkeeper'
  | 'Uncapped'
  | 'Attacker'
  | 'Midfield Engine'
  | 'Defender / GK';

export interface PlayerStats {
  matches: number;
  runs: number; // Goals for football
  average: number; // Assists for football
  strikeRate: number; // Rating / xG index
  highestScore: string;
  fiftiesHundreds: string;
  wickets: number; // Clean sheets / tackles
  economy: number;
  bestBowling: string;
}

export interface AuctionPlayer {
  id: string;
  name: string;
  country: string;
  isOverseas: boolean;
  sport?: SportType;
  role: PlayerRole;
  category: PlayerCategory;
  leagueTags: LeagueId[];
  seasonsActive: string[];
  realTeamCode?: string;
  basePrice: number; // In INR rupees
  historicalPeakPrice?: string;
  historicalNote?: string;
  battingStyle: string;
  bowlingStyle: string;
  rating: number; // 1-100 tactical rating
  fantasyPoints?: number;
  stats: PlayerStats;
  status: 'upcoming' | 'bidding' | 'sold' | 'unsold';
  soldPrice?: number;
  soldToTeamId?: string;
  soldToTeamName?: string;
  soldTimestamp?: number;
}

export interface BidIncrementTier {
  id: string;
  minBid: number;
  maxBid: number | null;
  increment: number;
}

export interface CategoryRuleOverride {
  category: PlayerCategory;
  minIncrement: number;
  maxBidCap?: number | null;
}

export interface RoleQuotas {
  batters: number;
  bowlers: number;
  allRounders: number;
  wicketkeepers: number;
}

export interface AuctionRules {
  currency: CurrencyCode;
  buildingMode: BuildingMode;
  biddingStyle: BiddingStyle;
  stackMode: StackMode; // 'lifetime' (keep stacks across seasons) | 'season_only'
  playMode: PlayMode; // 'friends' (invite code multiplayer) | 'ai' (vs AI franchises)
  defaultTeamPurse: number;
  maxTeamPurse: number;
  initialTimerSeconds: 5 | 10 | 15 | 20;
  resetTimerSeconds: number;
  maxAuctionDurationMinutes: number; // 0 = unlimited, default e.g. 20 mins
  matchesPerTeamPerSeason: number; // Default 14 league matches per team per season
  standardRetentionLimit: number; // Default 4 players retained
  runnerUpRetentionLimit: number; // Default 5 players retained
  championRetentionLimit: number; // Default 6 players retained
  incrementTable: BidIncrementTier[];
  categoryOverrides: CategoryRuleOverride[];
  minBidFloor: number;
  maxBidCap: number | null;
  allowCustomBid: boolean;
  allowQuickBid: boolean;
  autoUnsoldOnExpire: boolean;
  manualClosingMode: boolean;
  antiSnipingEnabled: boolean;
  antiSnipingWindowSeconds: number;
  minSquadSize: number; // Host sets 5..18
  maxSquadSize: number; // Up to 18 (e.g. 11 Playing XI + 7 Extras)
  playingXISize: number; // Default 11 (or min(11, minSquadSize))
  roleQuotas: RoleQuotas; // e.g. 4 BAT, 4 BWL, 2 AR, 1 WK when 11+
  maxOverseasPlayers: number;
  reservePerEmptySlot: number;
  rtmEnabled: boolean;
  impactPlayerRule: boolean;
  aiOpponentsEnabled: boolean; // Solo bidder vs AI franchises
  allBiddersCanHost: boolean; // Bidder is also host & host is also bidder
  showBidderNameOnBigScreen: boolean;
  showIncrementTableToBidders: boolean;
  hostCanBid: boolean;
  hostCanEditRulesLive: boolean;
  rulesLocked: boolean;
  lockRulesAfterCreate?: boolean;
  marqueeSelectionMode?: 'auto_all' | 'custom';
  startingMarqueePlayerIds?: string[];
  marqueeMarkupPercent?: number;
  tournamentMode?: 'full_season' | 'single_match';
}

export interface Team {
  id: string;
  name: string;
  shortCode: string;
  primaryColor: string;
  secondaryColor: string;
  ownerName: string;
  initialPurse: number;
  remainingPurse: number;
  amountSpent: number;
  squad: string[];
  startingXI: string[];
  captainId?: string;
  viceCaptainId?: string;
  fantasyPoints: number;
  rtmCardsRemaining: number;
  isLocked: boolean;
}

export interface BidRecord {
  id: string;
  sequence: number;
  playerId: string;
  playerName: string;
  teamId: string;
  teamName: string;
  teamShortCode: string;
  teamColor: string;
  bidderId: string;
  bidderName: string;
  amount: number;
  bidType: 'quick' | 'custom' | 'host' | 'verbal' | 'snake';
  timestamp: number;
}

export interface AuctionEventLog {
  id: string;
  timestamp: number;
  type:
    | 'room_created'
    | 'rules_updated'
    | 'lot_started'
    | 'bid_accepted'
    | 'timer_control'
    | 'sold'
    | 'unsold'
    | 'undo'
    | 'participant_joined'
    | 'participant_left'
    | 'fantasy'
    | 'reauction';
  message: string;
  actor: string;
}

export interface Participant {
  id: string;
  name: string;
  role: 'host' | 'bidder' | 'spectator';
  teamId?: string;
  connectedAt: number;
  lastSeenAt: number;
}

export type LotStatus = 'idle' | 'bidding' | 'paused' | 'awaiting_hammer' | 'sold_reveal' | 'unsold_reveal';

export interface UndoSnapshot {
  description: string;
  players: AuctionPlayer[];
  teams: Team[];
  currentPlayerId: string | null;
  lotStatus: LotStatus;
  currentBid: number;
  highestBidderTeamId: string | null;
  highestBidderName: string | null;
  bidSequence: number;
  currentLotBids: BidRecord[];
  timerRemainingAtPause: number;
  snakeDraftPickIndex: number;
}

export interface TradeBinListing {
  id: string;
  playerId: string;
  teamId: string;
  askingPrice: number;
  note?: string;
  createdAt: number;
}

export interface TeamStanding {
  teamId: string;
  teamName: string;
  shortCode: string;
  primaryColor: string;
  played: number;
  won: number;
  lost: number;
  points: number;
  nrr: number;
  isChampion?: boolean;
  isRunnerUp?: boolean;
}

export interface SeasonPlayoffMatch {
  id: string;
  stage: 'SF1' | 'SF2' | 'FINAL';
  label: string;
  teamAId: string;
  teamBId: string;
  matchResult?: VirtualMatchResult;
}

export interface SeasonRecord {
  seasonNumber: number;
  seasonLabel: string;
  championTeamId: string;
  championTeamName: string;
  runnerUpTeamId: string;
  runnerUpTeamName: string;
  standings: TeamStanding[];
  playoffs: SeasonPlayoffMatch[];
}

export interface AuctionRoomState {
  roomCode: string;
  roomName: string;
  leagueId: LeagueId;
  seasonYear: string;
  seasonNumber: number;
  hostId: string;
  hostName: string;
  isDemo: boolean;
  status: 'lobby' | 'live' | 'completed';
  bigScreenPublished: boolean;
  rules: AuctionRules;
  teams: Team[];
  players: AuctionPlayer[];
  currentPlayerId: string | null;
  lotStatus: LotStatus;
  currentBid: number;
  highestBidderTeamId: string | null;
  highestBidderName: string | null;
  bidSequence: number;
  currentLotBids: BidRecord[];
  allBids: BidRecord[];
  timerDeadlineMs: number;
  timerRemainingAtPause: number;
  auctionEndDeadlineMs: number;
  snakeDraftRound: number;
  snakeDraftPickIndex: number;
  wishlistByTeam: Record<string, string[]>;
  tradeBin: TradeBinListing[];
  matchweekNumber: number;
  virtualMatches: VirtualMatchResult[];
  seasonMatches: VirtualMatchResult[];
  seasonStandings: TeamStanding[];
  seasonPlayoffs: SeasonPlayoffMatch[];
  seasonChampionTeamId?: string | null;
  seasonRunnerUpTeamId?: string | null;
  retentionsByTeam: Record<string, string[]>;
  seasonHistory: SeasonRecord[];
  lastOutcome: {
    status: 'sold' | 'unsold';
    playerName: string;
    playerRole: PlayerRole;
    amount: number;
    teamName?: string;
    teamShortCode?: string;
    teamColor?: string;
    timestamp: number;
  } | null;
  participants: Participant[];
  eventLog: AuctionEventLog[];
  undoStackCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface VirtualMatchResult {
  id: string;
  fixtureNumber: number;
  stage?: 'LEAGUE' | 'SF1' | 'SF2' | 'FINAL';
  teamAId: string;
  teamAName: string;
  teamAShortCode: string;
  teamAColor: string;
  teamAScore: string;
  teamBId: string;
  teamBName: string;
  teamBShortCode: string;
  teamBColor: string;
  teamBScore: string;
  winnerTeamId: string;
  winnerTeamName: string;
  marginText: string;
  motmPlayerName: string;
  motmPerformance: string;
  timestamp: number;
}

export interface AuthUserPublic {
  id: string;
  email: string;
  name: string;
  role: 'owner' | 'user';
  createdAt: number;
}

export interface LeaderboardEntry {
  id: string;
  roomCode: string;
  leagueId: LeagueId;
  seasonYear: string;
  teamName: string;
  teamShortCode: string;
  teamColor: string;
  ownerName: string;
  playersCount: number;
  purseSpent: number;
  purseRemaining: number;
  squadPowerScore: number;
  fantasyPoints?: number;
  valueEfficiency: number;
  topSignings: string[];
  updatedAt: number;
}

export interface BidValidationResult {
  valid: boolean;
  reason?: string;
  nextMinimumBid?: number;
}
