import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';
import {
  AuctionPlayer,
  AuctionRoomState,
  AuctionRules,
  AuthUserPublic,
  BidRecord,
  LeaderboardEntry,
  LeagueId,
  Participant,
  PlayerRole,
  SeasonPlayoffMatch,
  SeasonRecord,
  Team,
  TeamStanding,
  TradeBinListing,
  UndoSnapshot,
  VirtualMatchResult,
} from './src/shared/auctionTypes';
import { CRORE, formatCurrency, LAKH } from './src/shared/currency';
import {
  calculateReservedPurse,
  computeDefaultRoleQuotas,
  computeScaledBasePrice,
  DEFAULT_AUCTION_RULES,
  DEFAULT_INCREMENT_TABLE,
  getNextValidBid,
  getTeamRetentionLimit,
  validateBidSubmission,
} from './src/shared/rulesEngine';
import { DEMO_FIVE_TEAMS, getLeagueById } from './src/data/leagues';
import { buildPlayersForLeague } from './src/data/players';

const PORT = Number(process.env.PORT) || 3000;
const STORE_PATH = path.resolve(process.cwd(), '.bidskaro-store.json');
const AUTH_SECRET = process.env.AUTH_SECRET || crypto.randomBytes(32).toString('hex');

interface AuthUserRecord {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  salt: string;
  role: 'owner' | 'user';
  createdAt: number;
}

interface ServerRoomInternal {
  state: AuctionRoomState;
  undoStack: UndoSnapshot[];
  recentBidRequestIds: Set<string>;
  nextAiThinkAtMs?: number;
  autoAdvanceAtMs?: number;
}

interface PersistedStore {
  rooms: Record<string, AuctionRoomState>;
  leaderboard: LeaderboardEntry[];
  users?: AuthUserRecord[];
}

const rooms = new Map<string, ServerRoomInternal>();
const roomClients = new Map<string, Set<WebSocket>>();
const wsMeta = new Map<WebSocket, { roomCode: string; participantId: string }>();
let leaderboard: LeaderboardEntry[] = [];
let users: AuthUserRecord[] = [];

function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashPassword(password, salt), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

function signAuthToken(user: AuthUserRecord): string {
  const payload = Buffer.from(
    JSON.stringify({
      sub: user.id,
      email: user.email,
      role: user.role,
      exp: Date.now() + 7 * 24 * 3600 * 1000,
    })
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyAuthToken(token: string): { sub: string; email: string; role: 'owner' | 'user'; exp: number } | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('base64url');
  const actualBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (actualBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(actualBuf, expectedBuf)) {
    return null;
  }
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as {
      sub: string;
      email: string;
      role: 'owner' | 'user';
      exp: number;
    };
    if (!data.sub || typeof data.exp !== 'number' || data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

function toPublicUser(u: AuthUserRecord): AuthUserPublic {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    createdAt: u.createdAt,
  };
}

function getAuthUserFromReq(req: express.Request): AuthUserRecord | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  const claims = verifyAuthToken(token);
  if (!claims) return null;
  return users.find((u) => u.id === claims.sub) || null;
}

function normalizeEmail(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[crypto.randomInt(0, chars.length)];
  }
  return rooms.has(code) ? generateRoomCode() : code;
}

function makeId(prefix = 'id'): string {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}`;
}

function buildSeedLeaderboard(): LeaderboardEntry[] {
  const now = Date.now();
  return [
    {
      id: 'lb-seed-1',
      roomCode: 'IPL25M',
      leagueId: 'IPL',
      seasonYear: '2025',
      teamName: 'Mumbai Mavericks',
      teamShortCode: 'MM',
      teamColor: '#004BA0',
      ownerName: 'Aarav Mehta',
      playersCount: 18,
      purseSpent: 178 * CRORE,
      purseRemaining: 22 * CRORE,
      squadPowerScore: 94.2,
      valueEfficiency: 91,
      topSignings: ['Jasprit Bumrah (₹22 Cr)', 'Suryakumar Yadav (₹18.5 Cr)', 'Yuvraj Singh (₹14.5 Cr)'],
      updatedAt: now - 3600_000,
    },
    {
      id: 'lb-seed-2',
      roomCode: 'IPL25M',
      leagueId: 'IPL',
      seasonYear: '2025',
      teamName: 'Chennai Chargers',
      teamShortCode: 'CC',
      teamColor: '#FDB913',
      ownerName: 'Karthik Sundaram',
      playersCount: 17,
      purseSpent: 184 * CRORE,
      purseRemaining: 16 * CRORE,
      squadPowerScore: 92.8,
      valueEfficiency: 89,
      topSignings: ['MS Dhoni (₹15 Cr)', 'Rashid Khan (₹20.5 Cr)', 'Ravindra Jadeja (₹17 Cr)'],
      updatedAt: now - 7200_000,
    },
    {
      id: 'lb-seed-3',
      roomCode: 'WPL25F',
      leagueId: 'WPL',
      seasonYear: '2025',
      teamName: 'Mumbai Indians Women',
      teamShortCode: 'MIW',
      teamColor: '#004BA0',
      ownerName: 'Neha Sharma',
      playersCount: 16,
      purseSpent: 168 * CRORE,
      purseRemaining: 32 * CRORE,
      squadPowerScore: 91.5,
      valueEfficiency: 93,
      topSignings: ['Nat Sciver-Brunt (₹18 Cr)', 'Harmanpreet Kaur (₹16 Cr)', 'Amelia Kerr (₹12.5 Cr)'],
      updatedAt: now - 10800_000,
    },
    {
      id: 'lb-seed-4',
      roomCode: 'IPL25M',
      leagueId: 'IPL',
      seasonYear: '2025',
      teamName: 'Bengaluru Blasters',
      teamShortCode: 'BB',
      teamColor: '#EC1C24',
      ownerName: 'Vikram Nair',
      playersCount: 16,
      purseSpent: 191 * CRORE,
      purseRemaining: 9 * CRORE,
      squadPowerScore: 90.4,
      valueEfficiency: 85,
      topSignings: ['Virat Kohli (₹25 Cr)', 'Josh Hazlewood (₹14 Cr)', 'Phil Salt (₹12.5 Cr)'],
      updatedAt: now - 14400_000,
    },
    {
      id: 'lb-seed-5',
      roomCode: 'IPL25M',
      leagueId: 'IPL',
      seasonYear: '2025',
      teamName: 'Kolkata Knights',
      teamShortCode: 'KK',
      teamColor: '#3A225D',
      ownerName: 'Ananya Chatterjee',
      playersCount: 17,
      purseSpent: 174 * CRORE,
      purseRemaining: 26 * CRORE,
      squadPowerScore: 89.7,
      valueEfficiency: 90,
      topSignings: ['Sunil Narine (₹16.5 Cr)', 'Andre Russell (₹15 Cr)', 'Mitchell Starc (₹21 Cr)'],
      updatedAt: now - 18000_000,
    },
  ];
}

function createRoomState(options: {
  roomCode?: string;
  roomName: string;
  leagueId: LeagueId;
  seasonYear: string;
  hostId: string;
  hostName: string;
  isDemo?: boolean;
  rules?: Partial<AuctionRules>;
  customTeams?: Array<{
    id?: string;
    name: string;
    shortCode: string;
    primaryColor: string;
    secondaryColor: string;
    ownerName: string;
    initialPurse?: number;
  }>;
}): AuctionRoomState {
  const league = getLeagueById(options.leagueId);
  const now = Date.now();
  const minSquad = Math.max(5, Math.min(18, options.rules?.minSquadSize ?? 11));
  const maxSquad = Math.max(minSquad, Math.min(18, options.rules?.maxSquadSize ?? 18));
  const playingXISize = Math.min(11, options.rules?.playingXISize ?? Math.min(11, minSquad));

  const resolvedPlayMode =
    options.rules?.playMode ??
    (options.rules?.aiOpponentsEnabled === false ? 'friends' : 'ai');
  const resolvedAiEnabled =
    options.rules?.aiOpponentsEnabled ?? resolvedPlayMode === 'ai';

  const baseRules: AuctionRules = {
    ...DEFAULT_AUCTION_RULES,
    incrementTable: DEFAULT_INCREMENT_TABLE.map((t) => ({ ...t })),
    defaultTeamPurse: league.defaultPurse,
    maxTeamPurse: Math.max(league.defaultPurse, options.rules?.defaultTeamPurse ?? 200 * CRORE),
    maxOverseasPlayers: league.defaultMaxOverseas,
    reservePerEmptySlot: league.defaultBaseReserve,
    ...options.rules,
    stackMode: options.rules?.stackMode ?? 'lifetime',
    playMode: resolvedPlayMode,
    matchesPerTeamPerSeason: Math.max(4, Math.min(28, options.rules?.matchesPerTeamPerSeason ?? 14)),
    standardRetentionLimit: options.rules?.standardRetentionLimit ?? 4,
    runnerUpRetentionLimit: options.rules?.runnerUpRetentionLimit ?? 5,
    championRetentionLimit: options.rules?.championRetentionLimit ?? 6,
    minSquadSize: minSquad,
    maxSquadSize: maxSquad,
    playingXISize,
    roleQuotas: options.rules?.roleQuotas || computeDefaultRoleQuotas(minSquad),
    allBiddersCanHost: options.rules?.allBiddersCanHost ?? true,
    hostCanBid: options.rules?.hostCanBid ?? true,
    aiOpponentsEnabled: resolvedAiEnabled,
    maxAuctionDurationMinutes: options.rules?.maxAuctionDurationMinutes ?? 20,
  };

  if (options.isDemo) {
    baseRules.initialTimerSeconds = 10;
    baseRules.resetTimerSeconds = options.rules?.resetTimerSeconds ?? 15;
    baseRules.defaultTeamPurse = 200 * CRORE;
    baseRules.maxTeamPurse = 200 * CRORE;
    baseRules.minSquadSize = 11;
    baseRules.maxSquadSize = 18;
    baseRules.playingXISize = 11;
    baseRules.roleQuotas = computeDefaultRoleQuotas(11);
    baseRules.maxAuctionDurationMinutes = 20;
    baseRules.stackMode = 'lifetime';
    baseRules.playMode = 'ai';
    baseRules.aiOpponentsEnabled = true;
    baseRules.allBiddersCanHost = true;
    baseRules.allowCustomBid = true;
    baseRules.allowQuickBid = true;
    baseRules.hostCanBid = true;
  }

  const teamPresets = options.customTeams?.length
    ? options.customTeams
    : options.isDemo
      ? DEMO_FIVE_TEAMS.map((t) => ({
          id: t.id,
          name: t.name,
          shortCode: t.shortCode,
          primaryColor: t.primaryColor,
          secondaryColor: t.secondaryColor,
          ownerName: t.defaultOwner,
          initialPurse: baseRules.defaultTeamPurse,
        }))
      : league.franchises.slice(0, options.leagueId === 'IPL' ? 10 : 5).map((t) => ({
          id: t.id,
          name: t.name,
          shortCode: t.shortCode,
          primaryColor: t.primaryColor,
          secondaryColor: t.secondaryColor,
          ownerName: t.defaultOwner,
          initialPurse: baseRules.defaultTeamPurse,
        }));

  const teams: Team[] = teamPresets.map((t, idx) => {
    const purse = Math.min(t.initialPurse ?? baseRules.defaultTeamPurse, baseRules.maxTeamPurse);
    return {
      id: t.id || `team-${idx + 1}`,
      name: t.name,
      shortCode: t.shortCode.slice(0, 5).toUpperCase(),
      primaryColor: t.primaryColor,
      secondaryColor: t.secondaryColor,
      ownerName: t.ownerName || 'Franchise Owner',
      initialPurse: purse,
      remainingPurse: purse,
      amountSpent: 0,
      squad: [],
      startingXI: [],
      fantasyPoints: 0,
      rtmCardsRemaining: league.seasons[0]?.rtmCards ?? 2,
      isLocked: false,
    };
  });

  // Exact formula: teams * maxSquadSize + maxSquadSize, with base prices scaled to team purse
  const players = buildPlayersForLeague(
    options.leagueId,
    teams.length,
    baseRules.maxSquadSize,
    baseRules.defaultTeamPurse,
    baseRules.minBidFloor
  );
  const code = options.roomCode || generateRoomCode();
  const initialStandings: TeamStanding[] = teams.map((t) => ({
    teamId: t.id,
    teamName: t.name,
    shortCode: t.shortCode,
    primaryColor: t.primaryColor,
    played: 0,
    won: 0,
    lost: 0,
    points: 0,
    nrr: 0,
  }));

  return {
    roomCode: code,
    roomName: options.roomName,
    leagueId: options.leagueId,
    seasonYear: options.seasonYear || league.seasons[0]?.year || '2025',
    seasonNumber: 1,
    hostId: options.hostId,
    hostName: options.hostName || 'Auction Host',
    isDemo: Boolean(options.isDemo),
    status: 'lobby',
    bigScreenPublished: true,
    rules: baseRules,
    teams,
    players,
    currentPlayerId: players[0]?.id ?? null,
    lotStatus: 'idle',
    currentBid: 0,
    highestBidderTeamId: null,
    highestBidderName: null,
    bidSequence: 0,
    currentLotBids: [],
    allBids: [],
    timerDeadlineMs: 0,
    timerRemainingAtPause: baseRules.initialTimerSeconds * 1000,
    auctionEndDeadlineMs: 0,
    snakeDraftRound: 1,
    snakeDraftPickIndex: 0,
    wishlistByTeam: {},
    tradeBin: [],
    matchweekNumber: 0,
    virtualMatches: [],
    seasonMatches: [],
    seasonStandings: initialStandings,
    seasonPlayoffs: [],
    seasonChampionTeamId: null,
    seasonRunnerUpTeamId: null,
    retentionsByTeam: {},
    seasonHistory: [],
    lastOutcome: null,
    participants: [
      {
        id: options.hostId,
        name: options.hostName || 'Auction Host',
        role: 'host',
        teamId: teams[0]?.id,
        connectedAt: now,
        lastSeenAt: now,
      },
    ],
    eventLog: [
      {
        id: makeId('evt'),
        timestamp: now,
        type: 'room_created',
        message: `${options.roomName} created (${teams.length} teams · ${players.length} mystery players · ${baseRules.stackMode === 'lifetime' ? 'Lifetime Stacks' : 'Season-Only'} · ${formatCurrency(baseRules.defaultTeamPurse, baseRules.currency)} purse)`,
        actor: options.hostName || 'Host',
      },
    ],
    undoStackCount: 0,
    createdAt: now,
    updatedAt: now,
  };
}

// Mask players before the auction begins so nobody sees players pre-auction
function sanitizeRoomForClient(state: AuctionRoomState): AuctionRoomState {
  if (state.status !== 'lobby') {
    return state;
  }
  return {
    ...state,
    players: state.players.map((p, idx) => ({
      ...p,
      name: `Mystery Player #${idx + 1}`,
      country: 'Hidden Until Start',
      historicalPeakPrice: undefined,
      historicalNote: undefined,
      battingStyle: 'Hidden',
      bowlingStyle: 'Hidden',
    })),
  };
}

let saveTimer: NodeJS.Timeout | null = null;
function schedulePersist() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      const obj: PersistedStore = {
        rooms: Object.fromEntries(Array.from(rooms.entries()).map(([k, v]) => [k, v.state])),
        leaderboard,
        users,
      };
      fs.writeFileSync(STORE_PATH, JSON.stringify(obj, null, 2));
    } catch (err) {
      console.error('Failed to persist store:', err);
    }
  }, 400);
}

function loadStore() {
  try {
    if (fs.existsSync(STORE_PATH)) {
      const raw = JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8')) as PersistedStore;
      if (Array.isArray(raw.users)) {
        users = raw.users;
      }
      if (raw.rooms) {
        for (const [code, rawState] of Object.entries(raw.rooms)) {
          const minSq = Math.max(5, Math.min(18, rawState.rules?.minSquadSize ?? 11));
          const maxSq = Math.max(minSq, Math.min(18, rawState.rules?.maxSquadSize ?? 18));
          const expectedPoolCount = (rawState.teams?.length || 5) * maxSq + maxSq;
          const players =
            Array.isArray(rawState.players) && rawState.players.length >= expectedPoolCount
              ? rawState.players
              : buildPlayersForLeague(rawState.leagueId || 'CUSTOM', rawState.teams?.length || 5, maxSq);

          const state: AuctionRoomState = {
            ...rawState,
            seasonNumber: typeof rawState.seasonNumber === 'number' ? rawState.seasonNumber : 1,
            players,
            rules: {
              ...DEFAULT_AUCTION_RULES,
              ...rawState.rules,
              stackMode: rawState.rules?.stackMode ?? 'lifetime',
              playMode: rawState.rules?.playMode ?? (rawState.rules?.aiOpponentsEnabled === false ? 'friends' : 'ai'),
              matchesPerTeamPerSeason: rawState.rules?.matchesPerTeamPerSeason ?? 14,
              standardRetentionLimit: rawState.rules?.standardRetentionLimit ?? 4,
              runnerUpRetentionLimit: rawState.rules?.runnerUpRetentionLimit ?? 5,
              championRetentionLimit: rawState.rules?.championRetentionLimit ?? 6,
              minSquadSize: minSq,
              maxSquadSize: maxSq,
              playingXISize: Math.min(11, rawState.rules?.playingXISize ?? Math.min(11, minSq)),
              roleQuotas: rawState.rules?.roleQuotas || computeDefaultRoleQuotas(minSq),
            },
            teams: (rawState.teams || []).map((t) => ({
              ...t,
              startingXI: Array.isArray(t.startingXI) ? t.startingXI : [],
              fantasyPoints: typeof t.fantasyPoints === 'number' ? t.fantasyPoints : 0,
            })),
            auctionEndDeadlineMs: typeof rawState.auctionEndDeadlineMs === 'number' ? rawState.auctionEndDeadlineMs : 0,
            snakeDraftRound: typeof rawState.snakeDraftRound === 'number' ? rawState.snakeDraftRound : 1,
            snakeDraftPickIndex: typeof rawState.snakeDraftPickIndex === 'number' ? rawState.snakeDraftPickIndex : 0,
            wishlistByTeam: rawState.wishlistByTeam || {},
            tradeBin: Array.isArray(rawState.tradeBin) ? rawState.tradeBin : [],
            matchweekNumber: typeof rawState.matchweekNumber === 'number' ? rawState.matchweekNumber : 0,
            virtualMatches: Array.isArray(rawState.virtualMatches) ? rawState.virtualMatches : [],
            seasonMatches: Array.isArray(rawState.seasonMatches) ? rawState.seasonMatches : [],
            seasonStandings:
              Array.isArray(rawState.seasonStandings) && rawState.seasonStandings.length > 0
                ? rawState.seasonStandings
                : (rawState.teams || []).map((t) => ({
                    teamId: t.id,
                    teamName: t.name,
                    shortCode: t.shortCode,
                    primaryColor: t.primaryColor,
                    played: 0,
                    won: 0,
                    lost: 0,
                    points: 0,
                    nrr: 0,
                  })),
            seasonPlayoffs: Array.isArray(rawState.seasonPlayoffs) ? rawState.seasonPlayoffs : [],
            seasonChampionTeamId: rawState.seasonChampionTeamId ?? null,
            seasonRunnerUpTeamId: rawState.seasonRunnerUpTeamId ?? null,
            retentionsByTeam: rawState.retentionsByTeam || {},
            seasonHistory: Array.isArray(rawState.seasonHistory) ? rawState.seasonHistory : [],
          };
          rooms.set(code, {
            state,
            undoStack: [],
            recentBidRequestIds: new Set(),
          });
        }
      }
      leaderboard = Array.isArray(raw.leaderboard) && raw.leaderboard.length > 0 ? raw.leaderboard : buildSeedLeaderboard();
    } else {
      leaderboard = buildSeedLeaderboard();
    }
  } catch {
    leaderboard = buildSeedLeaderboard();
  }

  // Ensure default 5-team DEMO5 room is always available
  if (!rooms.has('DEMO5')) {
    const demoState = createRoomState({
      roomCode: 'DEMO5',
      roomName: 'BidsKaro 5-Team Championship Demo',
      leagueId: 'CUSTOM',
      seasonYear: '2025',
      hostId: 'host-demo',
      hostName: 'Demo Auctioneer',
      isDemo: true,
    });
    rooms.set('DEMO5', {
      state: demoState,
      undoStack: [],
      recentBidRequestIds: new Set(),
    });
    schedulePersist();
  }
}

loadStore();

function updateLeaderboardFromRoom(state: AuctionRoomState) {
  const playersById = new Map(state.players.map((p) => [p.id, p]));
  for (const team of state.teams) {
    if (team.squad.length === 0) continue;
    const squadPlayers = team.squad
      .map((id) => playersById.get(id))
      .filter((p): p is AuctionPlayer => Boolean(p));

    const totalRating = squadPlayers.reduce((acc, p) => acc + (p.rating || 80), 0);
    const avgRating = squadPlayers.length > 0 ? totalRating / squadPlayers.length : 0;
    const balanceBonus = Math.min(10, (team.squad.length / Math.max(1, state.rules.minSquadSize)) * 10);
    const virtualBonus = Math.min(6, (team.fantasyPoints || 0) / 120);
    const squadPowerScore = Number((avgRating * 0.88 + balanceBonus + virtualBonus).toFixed(1));
    const purseSpent = team.amountSpent;
    const valueEfficiency = purseSpent > 0
      ? Math.min(99, Math.round((totalRating / (purseSpent / CRORE)) * 6.5))
      : 80;

    const topSignings = [...squadPlayers]
      .sort((a, b) => (b.soldPrice || 0) - (a.soldPrice || 0))
      .slice(0, 3)
      .map((p) => `${p.name} (${formatCurrency(p.soldPrice || 0, state.rules.currency)})`);

    const entryId = `lb-${state.roomCode}-${team.id}`;
    const entry: LeaderboardEntry = {
      id: entryId,
      roomCode: state.roomCode,
      leagueId: state.leagueId,
      seasonYear: state.seasonYear,
      teamName: team.name,
      teamShortCode: team.shortCode,
      teamColor: team.primaryColor,
      ownerName: team.ownerName,
      playersCount: team.squad.length,
      purseSpent,
      purseRemaining: team.remainingPurse,
      squadPowerScore,
      fantasyPoints: team.fantasyPoints || 0,
      valueEfficiency,
      topSignings,
      updatedAt: Date.now(),
    };

    const idx = leaderboard.findIndex((e) => e.id === entryId);
    if (idx >= 0) {
      leaderboard[idx] = entry;
    } else {
      leaderboard.unshift(entry);
    }
  }
  leaderboard.sort((a, b) => b.squadPowerScore - a.squadPowerScore);
  leaderboard = leaderboard.slice(0, 50);
}

function broadcastRoom(roomCode: string) {
  const internal = rooms.get(roomCode);
  if (!internal) return;
  const clients = roomClients.get(roomCode);
  internal.state.undoStackCount = internal.undoStack.length;
  internal.state.updatedAt = Date.now();
  if (clients && clients.size > 0) {
    const payload = JSON.stringify({
      type: 'room_state',
      serverTimeMs: Date.now(),
      room: sanitizeRoomForClient(internal.state),
    });
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
    }
  }
  schedulePersist();
}

function pushUndoSnapshot(internal: ServerRoomInternal, description: string) {
  const s = internal.state;
  const snap: UndoSnapshot = {
    description,
    players: s.players.map((p) => ({ ...p, stats: { ...p.stats } })),
    teams: s.teams.map((t) => ({ ...t, squad: [...t.squad], startingXI: [...t.startingXI] })),
    currentPlayerId: s.currentPlayerId,
    lotStatus: s.lotStatus,
    currentBid: s.currentBid,
    highestBidderTeamId: s.highestBidderTeamId,
    highestBidderName: s.highestBidderName,
    bidSequence: s.bidSequence,
    currentLotBids: s.currentLotBids.map((b) => ({ ...b })),
    timerRemainingAtPause:
      s.lotStatus === 'bidding'
        ? Math.max(1000, s.timerDeadlineMs - Date.now())
        : s.timerRemainingAtPause,
    snakeDraftPickIndex: s.snakeDraftPickIndex,
  };
  internal.undoStack.push(snap);
  if (internal.undoStack.length > 25) {
    internal.undoStack.shift();
  }
  s.undoStackCount = internal.undoStack.length;
}

function getCurrentSnakeTurnTeamId(state: AuctionRoomState): string | null {
  if (!state.teams.length) return null;
  const n = state.teams.length;
  const idx = state.snakeDraftPickIndex;
  const round = Math.floor(idx / n);
  const posInRound = idx % n;
  const teamIndex = round % 2 === 0 ? posInRound : n - 1 - posInRound;
  return state.teams[teamIndex]?.id ?? null;
}

function addEvent(
  state: AuctionRoomState,
  type: AuctionRoomState['eventLog'][number]['type'],
  message: string,
  actor: string
) {
  state.eventLog.unshift({
    id: makeId('evt'),
    timestamp: Date.now(),
    type,
    message,
    actor,
  });
  if (state.eventLog.length > 120) {
    state.eventLog.length = 120;
  }
}

function shuffleWithCrypto<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy;
}

function countRolesInSquad(
  squadIds: string[],
  playersMap: Map<string, AuctionPlayer>
): { bat: number; bwl: number; ar: number; wk: number } {
  let bat = 0;
  let bwl = 0;
  let ar = 0;
  let wk = 0;
  for (const id of squadIds) {
    const p = playersMap.get(id);
    if (!p) continue;
    if (p.role === 'Batter' || p.role === 'Forward') bat += 1;
    else if (p.role === 'Bowler' || p.role === 'Defender') bwl += 1;
    else if (p.role === 'All-Rounder' || p.role === 'Midfielder') ar += 1;
    else if (p.role === 'Wicketkeeper' || p.role === 'Goalkeeper') wk += 1;
  }
  return { bat, bwl, ar, wk };
}

function autoPickPlayingXIForTeam(team: Team, state: AuctionRoomState, playersMap: Map<string, AuctionPlayer>) {
  const xiCap = Math.min(state.rules.playingXISize || 11, team.squad.length);
  if (xiCap <= 0) {
    team.startingXI = [];
    return;
  }

  // Keep valid existing picks first
  const validExisting = (team.startingXI || []).filter((id) => team.squad.includes(id));
  if (validExisting.length >= xiCap) {
    team.startingXI = validExisting.slice(0, xiCap);
  } else {
    const selected = new Set<string>(validExisting);
    const squadPlayers = team.squad
      .map((id) => playersMap.get(id))
      .filter((p): p is AuctionPlayer => Boolean(p))
      .sort((a, b) => (b.rating || 80) - (a.rating || 80));

    const quotas = state.rules.roleQuotas || computeDefaultRoleQuotas(state.rules.minSquadSize);
    const roleGoals: Array<{ match: (r: PlayerRole) => boolean; target: number }> = [
      { match: (r) => r === 'Wicketkeeper' || r === 'Goalkeeper', target: quotas.wicketkeepers },
      { match: (r) => r === 'All-Rounder' || r === 'Midfielder', target: quotas.allRounders },
      { match: (r) => r === 'Batter' || r === 'Forward', target: quotas.batters },
      { match: (r) => r === 'Bowler' || r === 'Defender', target: quotas.bowlers },
    ];

    for (const goal of roleGoals) {
      let have = 0;
      for (const sid of selected) {
        const sp = playersMap.get(sid);
        if (sp && goal.match(sp.role)) have += 1;
      }
      for (const p of squadPlayers) {
        if (selected.size >= xiCap || have >= goal.target) break;
        if (!selected.has(p.id) && goal.match(p.role)) {
          selected.add(p.id);
          have += 1;
        }
      }
    }

    for (const p of squadPlayers) {
      if (selected.size >= xiCap) break;
      if (!selected.has(p.id)) {
        selected.add(p.id);
      }
    }
    team.startingXI = Array.from(selected).slice(0, xiCap);
  }

  const xiRanked = team.startingXI
    .map((id) => playersMap.get(id))
    .filter((p): p is AuctionPlayer => Boolean(p))
    .sort((a, b) => (b.rating || 80) - (a.rating || 80));

  if (!team.captainId || !team.startingXI.includes(team.captainId)) {
    team.captainId = xiRanked[0]?.id;
  }
  if (!team.viceCaptainId || !team.startingXI.includes(team.viceCaptainId) || team.viceCaptainId === team.captainId) {
    team.viceCaptainId = xiRanked[1]?.id || xiRanked[0]?.id;
  }
}

function simulateSingleHeadToHeadMatch(
  state: AuctionRoomState,
  teamA: Team,
  teamB: Team,
  fixtureNumber: number,
  stage: 'LEAGUE' | 'SF1' | 'SF2' | 'FINAL',
  playersById: Map<string, AuctionPlayer>
): { match: VirtualMatchResult; nrrDeltaA: number; nrrDeltaB: number } {
  const isFootball = state.players[0]?.sport === 'football';
  const calcStrength = (team: Team) => {
    const xiIds = team.startingXI.length > 0 ? team.startingXI : team.squad.slice(0, 11);
    const xi = xiIds.map((id) => playersById.get(id)).filter((p): p is AuctionPlayer => Boolean(p));
    let sum = 0;
    for (const p of xi) {
      const mult = p.id === team.captainId ? 1.35 : p.id === team.viceCaptainId ? 1.2 : 1;
      sum += (p.rating || 78) * mult;
    }
    const counts = countRolesInSquad(xiIds, playersById);
    const quotas = state.rules.roleQuotas || computeDefaultRoleQuotas(state.rules.minSquadSize);
    const balanceBonus =
      (counts.bat >= quotas.batters ? 25 : counts.bat * 5) +
      (counts.bwl >= quotas.bowlers ? 25 : counts.bwl * 5) +
      (counts.ar >= quotas.allRounders ? 18 : counts.ar * 6) +
      (counts.wk >= quotas.wicketkeepers ? 14 : 0);
    return { xi, strength: sum + balanceBonus + crypto.randomInt(-38, 46) };
  };

  const aEval = calcStrength(teamA);
  const bEval = calcStrength(teamB);
  const winner = aEval.strength >= bEval.strength ? teamA : teamB;
  const loser = winner.id === teamA.id ? teamB : teamA;
  const winnerEval = winner.id === teamA.id ? aEval : bEval;
  const diff = Math.abs(Math.round(aEval.strength - bEval.strength));

  let teamAScore = '';
  let teamBScore = '';
  let marginText = '';
  let nrrDeltaA = 0;
  let nrrDeltaB = 0;

  if (isFootball) {
    const loserGoals = crypto.randomInt(0, 3);
    const winGoals = loserGoals + Math.max(1, Math.min(3, Math.ceil(diff / 35)));
    const aGoals = winner.id === teamA.id ? winGoals : loserGoals;
    const bGoals = winner.id === teamB.id ? winGoals : loserGoals;
    teamAScore = String(aGoals);
    teamBScore = String(bGoals);
    marginText = `${winner.name} won ${teamAScore}–${teamBScore}`;
    nrrDeltaA = Number(((aGoals - bGoals) * 0.25).toFixed(3));
    nrrDeltaB = -nrrDeltaA;
  } else {
    const baseRuns = 162 + crypto.randomInt(0, 38);
    const marginRuns = Math.max(4, Math.min(48, Math.round(diff * 0.45) + crypto.randomInt(1, 10)));
    const aRuns = winner.id === teamA.id ? baseRuns : Math.max(125, baseRuns - marginRuns);
    const bRuns = winner.id === teamB.id ? baseRuns : Math.max(125, baseRuns - marginRuns);
    const aWkts = crypto.randomInt(3, 9);
    const bWkts = crypto.randomInt(4, 10);
    teamAScore = `${aRuns}/${aWkts} (20.0)`;
    teamBScore = `${bRuns}/${bWkts} (20.0)`;
    marginText =
      crypto.randomInt(0, 2) === 0
        ? `${winner.name} won by ${Math.abs(aRuns - bRuns)} runs`
        : `${winner.name} won by ${crypto.randomInt(2, 7)} wickets`;
    nrrDeltaA = Number(((aRuns - bRuns) / 20).toFixed(3));
    nrrDeltaB = -nrrDeltaA;
  }

  const starPool = [...winnerEval.xi].sort((x, y) => (y.rating || 80) - (x.rating || 80));
  const motm = starPool[crypto.randomInt(0, Math.max(1, Math.min(3, starPool.length)))] || winnerEval.xi[0];
  const motmPerformance = isFootball
    ? `${crypto.randomInt(1, 3)}G · ${crypto.randomInt(0, 2)}A`
    : motm?.role === 'Bowler'
      ? `${crypto.randomInt(3, 5)}/${crypto.randomInt(14, 29)} (4.0 ov)`
      : `${crypto.randomInt(54, 98)}* (${crypto.randomInt(31, 52)} balls)`;

  winner.fantasyPoints = (winner.fantasyPoints || 0) + 120;
  loser.fantasyPoints = (loser.fantasyPoints || 0) + 35;

  return {
    match: {
      id: makeId('vm'),
      fixtureNumber,
      stage,
      teamAId: teamA.id,
      teamAName: teamA.name,
      teamAShortCode: teamA.shortCode,
      teamAColor: teamA.primaryColor,
      teamAScore,
      teamBId: teamB.id,
      teamBName: teamB.name,
      teamBShortCode: teamB.shortCode,
      teamBColor: teamB.primaryColor,
      teamBScore,
      winnerTeamId: winner.id,
      winnerTeamName: winner.name,
      marginText,
      motmPlayerName: motm?.name || winner.ownerName,
      motmPerformance,
      timestamp: Date.now(),
    },
    nrrDeltaA,
    nrrDeltaB,
  };
}

function ensureSeasonStandings(state: AuctionRoomState): TeamStanding[] {
  const existingMap = new Map((state.seasonStandings || []).map((s) => [s.teamId, s]));
  state.seasonStandings = state.teams.map((t) => {
    const prev = existingMap.get(t.id);
    if (prev) {
      return {
        ...prev,
        teamName: t.name,
        shortCode: t.shortCode,
        primaryColor: t.primaryColor,
      };
    }
    return {
      teamId: t.id,
      teamName: t.name,
      shortCode: t.shortCode,
      primaryColor: t.primaryColor,
      played: 0,
      won: 0,
      lost: 0,
      points: 0,
      nrr: 0,
    };
  });
  return state.seasonStandings;
}

function sortSeasonStandings(standings: TeamStanding[]): TeamStanding[] {
  return [...standings].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.nrr !== a.nrr) return b.nrr - a.nrr;
    return b.won - a.won;
  });
}

function pickBalancedRoundPairs(
  teams: Team[],
  standings: TeamStanding[],
  targetMatchesPerTeam: number
): Array<[Team, Team]> {
  const standingById = new Map(standings.map((s) => [s.teamId, s]));
  const eligible = teams
    .filter((t) => (standingById.get(t.id)?.played ?? 0) < targetMatchesPerTeam)
    .sort((a, b) => (standingById.get(a.id)?.played ?? 0) - (standingById.get(b.id)?.played ?? 0));

  const used = new Set<string>();
  const pairs: Array<[Team, Team]> = [];
  for (let i = 0; i < eligible.length; i++) {
    const tA = eligible[i];
    if (used.has(tA.id)) continue;
    // Find an unused partner, adding slight random offset so opponents vary across rounds
    const remaining = eligible.filter((cand) => cand.id !== tA.id && !used.has(cand.id));
    if (remaining.length === 0) break;
    const tB = remaining[crypto.randomInt(0, remaining.length)];
    used.add(tA.id);
    used.add(tB.id);
    pairs.push([tA, tB]);
  }
  return pairs;
}

function simulateSeasonLeagueRounds(
  state: AuctionRoomState,
  roundsCount: number | 'all',
  actorName: string
): VirtualMatchResult[] {
  if (state.teams.length < 2) return [];
  const playersById = new Map(state.players.map((p) => [p.id, p]));
  for (const team of state.teams) {
    autoPickPlayingXIForTeam(team, state, playersById);
  }

  let standings = ensureSeasonStandings(state);
  const targetMatches = Math.max(2, state.rules.matchesPerTeamPerSeason || 14);
  const maxIterations = roundsCount === 'all' ? targetMatches * 3 : Math.max(1, roundsCount);
  const newMatches: VirtualMatchResult[] = [];

  for (let round = 0; round < maxIterations; round++) {
    const pairs = pickBalancedRoundPairs(state.teams, standings, targetMatches);
    if (pairs.length === 0) break;

    for (const [teamA, teamB] of pairs) {
      const fixtureNum = state.seasonMatches.length + newMatches.length + 1;
      const { match, nrrDeltaA, nrrDeltaB } = simulateSingleHeadToHeadMatch(
        state,
        teamA,
        teamB,
        fixtureNum,
        'LEAGUE',
        playersById
      );
      newMatches.push(match);

      const stA = standings.find((s) => s.teamId === teamA.id);
      const stB = standings.find((s) => s.teamId === teamB.id);
      if (stA) {
        stA.played += 1;
        if (match.winnerTeamId === teamA.id) {
          stA.won += 1;
          stA.points += 2;
        } else {
          stA.lost += 1;
        }
        stA.nrr = Number((((stA.nrr * (stA.played - 1)) + nrrDeltaA) / stA.played).toFixed(3));
      }
      if (stB) {
        stB.played += 1;
        if (match.winnerTeamId === teamB.id) {
          stB.won += 1;
          stB.points += 2;
        } else {
          stB.lost += 1;
        }
        stB.nrr = Number((((stB.nrr * (stB.played - 1)) + nrrDeltaB) / stB.played).toFixed(3));
      }
    }
    state.matchweekNumber += 1;
  }

  if (newMatches.length > 0) {
    state.seasonMatches = [...newMatches, ...state.seasonMatches];
    state.virtualMatches = [...newMatches, ...state.virtualMatches].slice(0, 40);
    state.seasonStandings = sortSeasonStandings(standings);
    updateLeaderboardFromRoom(state);
    addEvent(
      state,
      'fantasy',
      `Season ${state.seasonNumber}: Simulated ${newMatches.length} league match(es) (${state.seasonStandings[0]?.teamName} leads table with ${state.seasonStandings[0]?.points} pts).`,
      actorName
    );
  }
  return newMatches;
}

function buildDefaultRetentionsForRoom(state: AuctionRoomState): Record<string, string[]> {
  const playersById = new Map(state.players.map((p) => [p.id, p]));
  const map: Record<string, string[]> = {};
  for (const team of state.teams) {
    const cap = getTeamRetentionLimit(state, team.id);
    if (cap <= 0) {
      map[team.id] = [];
      continue;
    }
    const existing = (state.retentionsByTeam?.[team.id] || []).filter((id) => team.squad.includes(id));
    if (existing.length > 0) {
      map[team.id] = existing.slice(0, cap);
      continue;
    }
    const sortedSquad = [...team.squad].sort((a, b) => {
      const pa = playersById.get(a);
      const pb = playersById.get(b);
      return (pb?.rating || 80) - (pa?.rating || 80);
    });
    map[team.id] = sortedSquad.slice(0, cap);
  }
  return map;
}

function simulateSeasonPlayoffsAndCrown(state: AuctionRoomState, actorName: string): { ok: boolean; error?: string } {
  if (state.teams.length < 2) {
    return { ok: false, error: 'At least 2 teams are required for Playoffs.' };
  }
  if (state.seasonChampionTeamId) {
    return { ok: false, error: `Season ${state.seasonNumber} Final is already completed.` };
  }

  // Finish any remaining league matches toward matchesPerTeamPerSeason first
  simulateSeasonLeagueRounds(state, 'all', actorName);

  const playersById = new Map(state.players.map((p) => [p.id, p]));
  for (const team of state.teams) {
    autoPickPlayingXIForTeam(team, state, playersById);
  }

  const sorted = sortSeasonStandings(ensureSeasonStandings(state));
  const playoffs: SeasonPlayoffMatch[] = [];
  const playoffResults: VirtualMatchResult[] = [];
  let finalistA: Team | undefined;
  let finalistB: Team | undefined;

  if (state.teams.length >= 4) {
    const t1 = state.teams.find((t) => t.id === sorted[0]?.teamId);
    const t2 = state.teams.find((t) => t.id === sorted[1]?.teamId);
    const t3 = state.teams.find((t) => t.id === sorted[2]?.teamId);
    const t4 = state.teams.find((t) => t.id === sorted[3]?.teamId);
    if (!t1 || !t2 || !t3 || !t4) {
      return { ok: false, error: 'Could not resolve Top 4 playoff seeds.' };
    }

    const sf1Res = simulateSingleHeadToHeadMatch(
      state,
      t1,
      t4,
      state.seasonMatches.length + 1,
      'SF1',
      playersById
    );
    const sf2Res = simulateSingleHeadToHeadMatch(
      state,
      t2,
      t3,
      state.seasonMatches.length + 2,
      'SF2',
      playersById
    );
    playoffResults.push(sf1Res.match, sf2Res.match);
    playoffs.push(
      {
        id: makeId('po'),
        stage: 'SF1',
        label: 'Semi-Final 1 (#1 vs #4)',
        teamAId: t1.id,
        teamBId: t4.id,
        matchResult: sf1Res.match,
      },
      {
        id: makeId('po'),
        stage: 'SF2',
        label: 'Semi-Final 2 (#2 vs #3)',
        teamAId: t2.id,
        teamBId: t3.id,
        matchResult: sf2Res.match,
      }
    );

    finalistA = state.teams.find((t) => t.id === sf1Res.match.winnerTeamId);
    finalistB = state.teams.find((t) => t.id === sf2Res.match.winnerTeamId);
  } else {
    finalistA = state.teams.find((t) => t.id === sorted[0]?.teamId);
    finalistB = state.teams.find((t) => t.id === sorted[1]?.teamId);
  }

  if (!finalistA || !finalistB) {
    return { ok: false, error: 'Could not determine Finalists.' };
  }

  const finalRes = simulateSingleHeadToHeadMatch(
    state,
    finalistA,
    finalistB,
    state.seasonMatches.length + playoffResults.length + 1,
    'FINAL',
    playersById
  );
  playoffResults.push(finalRes.match);
  playoffs.push({
    id: makeId('po'),
    stage: 'FINAL',
    label: `Season ${state.seasonNumber} Grand Final`,
    teamAId: finalistA.id,
    teamBId: finalistB.id,
    matchResult: finalRes.match,
  });

  const championId = finalRes.match.winnerTeamId;
  const runnerUpId = championId === finalistA.id ? finalistB.id : finalistA.id;
  const championTeam = state.teams.find((t) => t.id === championId)!;
  const runnerUpTeam = state.teams.find((t) => t.id === runnerUpId)!;

  championTeam.fantasyPoints = (championTeam.fantasyPoints || 0) + 250;
  runnerUpTeam.fantasyPoints = (runnerUpTeam.fantasyPoints || 0) + 120;

  state.seasonChampionTeamId = championId;
  state.seasonRunnerUpTeamId = runnerUpId;
  state.seasonPlayoffs = playoffs;
  state.seasonMatches = [...playoffResults.reverse(), ...state.seasonMatches];
  state.virtualMatches = [...playoffResults, ...state.virtualMatches].slice(0, 40);
  state.seasonStandings = sorted.map((st) => ({
    ...st,
    isChampion: st.teamId === championId,
    isRunnerUp: st.teamId === runnerUpId,
  }));

  state.retentionsByTeam = buildDefaultRetentionsForRoom(state);

  const historyEntry: SeasonRecord = {
    seasonNumber: state.seasonNumber,
    seasonLabel: `${state.seasonYear} (Season ${state.seasonNumber})`,
    championTeamId: championTeam.id,
    championTeamName: championTeam.name,
    runnerUpTeamId: runnerUpTeam.id,
    runnerUpTeamName: runnerUpTeam.name,
    standings: state.seasonStandings.map((s) => ({ ...s })),
    playoffs: playoffs.map((p) => ({ ...p })),
  };
  state.seasonHistory = [
    historyEntry,
    ...(state.seasonHistory || []).filter((h) => h.seasonNumber !== state.seasonNumber),
  ];

  updateLeaderboardFromRoom(state);
  addEvent(
    state,
    'fantasy',
    `CHAMPION CROWNED (Season ${state.seasonNumber}): ${championTeam.name} beat ${runnerUpTeam.name} in the Final! Retention Perks: Winner up to ${state.rules.championRetentionLimit}, Runner-Up up to ${state.rules.runnerUpRetentionLimit}, Others up to ${state.rules.standardRetentionLimit}.`,
    actorName
  );
  return { ok: true };
}

function startNextSeasonAuction(internal: ServerRoomInternal, actorName: string) {
  const s = internal.state;
  const playersById = new Map(s.players.map((p) => [p.id, p]));
  const isLifetime = s.rules.stackMode === 'lifetime';

  const retentionSource = isLifetime
    ? buildDefaultRetentionsForRoom(s)
    : Object.fromEntries(s.teams.map((t) => [t.id, [] as string[]]));

  const retainedAllIds = new Set<string>();
  const nextRetentionsByTeam: Record<string, string[]> = {};

  for (const team of s.teams) {
    const cap = getTeamRetentionLimit(s, team.id);
    const chosen = (retentionSource[team.id] || [])
      .filter((id) => team.squad.includes(id))
      .slice(0, cap);
    nextRetentionsByTeam[team.id] = chosen;
    for (const id of chosen) retainedAllIds.add(id);
  }

  let releasedCount = 0;
  let retainedCount = 0;

  // Release all unretained players back to upcoming with purse-scaled base prices
  for (const p of s.players) {
    p.fantasyPoints = 0;
    if (retainedAllIds.has(p.id)) {
      retainedCount += 1;
      continue;
    }
    if (p.status === 'sold' || p.status === 'unsold' || p.status === 'bidding') {
      releasedCount += 1;
    }
    p.status = 'upcoming';
    p.soldPrice = undefined;
    p.soldToTeamId = undefined;
    p.soldToTeamName = undefined;
    p.soldTimestamp = undefined;
    p.basePrice = computeScaledBasePrice(p.basePrice, s.rules.defaultTeamPurse, s.rules.minBidFloor);
  }

  // Update each team's squad & next-season purse
  for (const team of s.teams) {
    const keptIds = nextRetentionsByTeam[team.id] || [];
    const basePurse = team.initialPurse || s.rules.defaultTeamPurse;
    const minReserveLeft = Math.max(0, s.rules.minSquadSize - keptIds.length) * s.rules.reservePerEmptySlot;
    const maxAllowedRetentionSpend = Math.max(0, basePurse - minReserveLeft);

    let retentionSpent = 0;
    for (const pid of keptIds) {
      const p = playersById.get(pid);
      if (!p) continue;
      const fairCost = Math.min(
        p.soldPrice || computeScaledBasePrice(p.basePrice, basePurse, s.rules.minBidFloor),
        Math.round(basePurse * 0.14)
      );
      const boundedCost = Math.min(fairCost, Math.max(0, maxAllowedRetentionSpend - retentionSpent));
      p.status = 'sold';
      p.soldToTeamId = team.id;
      p.soldToTeamName = team.name;
      p.soldPrice = boundedCost;
      retentionSpent += boundedCost;
    }

    team.squad = [...keptIds];
    team.startingXI = keptIds.slice(0, Math.min(s.rules.playingXISize || 11, keptIds.length));
    team.captainId = team.startingXI[0];
    team.viceCaptainId = team.startingXI[1] || team.startingXI[0];
    team.amountSpent = retentionSpent;
    team.remainingPurse = Math.max(0, basePurse - retentionSpent);
    team.fantasyPoints = 0;
  }

  // Ensure pool meets teams * max + max with purse-scaled base prices
  const expectedCount = s.teams.length * s.rules.maxSquadSize + s.rules.maxSquadSize;
  if (s.players.length < expectedCount) {
    const freshPool = buildPlayersForLeague(
      s.leagueId,
      s.teams.length,
      s.rules.maxSquadSize,
      s.rules.defaultTeamPurse,
      s.rules.minBidFloor
    );
    const existingNames = new Set(s.players.map((p) => p.name.toLowerCase()));
    for (const fp of freshPool) {
      if (s.players.length >= expectedCount) break;
      if (!existingNames.has(fp.name.toLowerCase())) {
        s.players.push(fp);
        existingNames.add(fp.name.toLowerCase());
      }
    }
  }

  s.seasonNumber = (s.seasonNumber || 1) + 1;
  if (/^\d{4}$/.test(s.seasonYear)) {
    s.seasonYear = String(Number(s.seasonYear) + 1);
  }
  s.status = 'lobby';
  s.lotStatus = 'idle';
  s.rules.rulesLocked = false;
  s.currentPlayerId = s.players.find((p) => p.status === 'upcoming')?.id ?? null;
  s.currentBid = 0;
  s.highestBidderTeamId = null;
  s.highestBidderName = null;
  s.currentLotBids = [];
  s.timerDeadlineMs = 0;
  s.auctionEndDeadlineMs = 0;
  s.tradeBin = [];
  s.matchweekNumber = 0;
  s.seasonMatches = [];
  s.seasonPlayoffs = [];
  s.seasonChampionTeamId = null;
  s.seasonRunnerUpTeamId = null;
  s.retentionsByTeam = {};
  s.seasonStandings = s.teams.map((t) => ({
    teamId: t.id,
    teamName: t.name,
    shortCode: t.shortCode,
    primaryColor: t.primaryColor,
    played: 0,
    won: 0,
    lost: 0,
    points: 0,
    nrr: 0,
  }));
  s.lastOutcome = null;
  internal.undoStack = [];
  s.undoStackCount = 0;

  addEvent(
    s,
    'room_created',
    isLifetime
      ? `SEASON ${s.seasonNumber} LAUNCHED (Lifetime Stacks): Retained ${retainedCount} players (6 Winner / 5 Runner-Up / 4 Standard), released ${releasedCount} players with purse-scaled base prices.`
      : `SEASON ${s.seasonNumber} LAUNCHED (Season-Only Reset): All squads cleared & ${s.players.length} players reset with purse-scaled base prices.`,
    actorName
  );
  updateLeaderboardFromRoom(s);
}

function runVirtualMatchRound(state: AuctionRoomState, actorName: string): VirtualMatchResult[] {
  return simulateSeasonLeagueRounds(state, 1, actorName);
}

function autoCompleteRoomTeamsAndFinish(internal: ServerRoomInternal, reason: string) {
  const s = internal.state;
  if (s.status === 'completed') return;

  // 1. Settle active bid if present
  if (s.lotStatus === 'bidding' && s.highestBidderTeamId && s.currentBid > 0) {
    resolveHammerSold(internal, reason);
  }

  const playersById = new Map(s.players.map((p) => [p.id, p]));
  let pool = shuffleWithCrypto(s.players.filter((p) => p.status === 'upcoming' || p.status === 'unsold'));
  const quotas = s.rules.roleQuotas || computeDefaultRoleQuotas(s.rules.minSquadSize);

  const takePlayerForTeam = (team: Team, predicate: (p: AuctionPlayer) => boolean): boolean => {
    const idx = pool.findIndex((p) => predicate(p) && p.status !== 'sold');
    if (idx < 0) return false;
    const picked = pool[idx];
    pool.splice(idx, 1);

    const price = Math.min(picked.basePrice, Math.max(0, team.remainingPurse));
    picked.status = 'sold';
    picked.soldPrice = price;
    picked.soldToTeamId = team.id;
    picked.soldToTeamName = team.name;
    picked.soldTimestamp = Date.now();
    team.remainingPurse = Math.max(0, team.remainingPurse - price);
    team.amountSpent += price;
    team.squad.push(picked.id);
    return true;
  };

  let assignedCount = 0;
  for (const team of s.teams) {
    const counts = countRolesInSquad(team.squad, playersById);
    const neededRoles: Array<{ need: number; fn: (p: AuctionPlayer) => boolean }> = [
      { need: Math.max(0, quotas.wicketkeepers - counts.wk), fn: (p) => p.role === 'Wicketkeeper' || p.role === 'Goalkeeper' },
      { need: Math.max(0, quotas.allRounders - counts.ar), fn: (p) => p.role === 'All-Rounder' || p.role === 'Midfielder' },
      { need: Math.max(0, quotas.batters - counts.bat), fn: (p) => p.role === 'Batter' || p.role === 'Forward' },
      { need: Math.max(0, quotas.bowlers - counts.bwl), fn: (p) => p.role === 'Bowler' || p.role === 'Defender' },
    ];

    for (const reqRole of neededRoles) {
      for (let i = 0; i < reqRole.need; i++) {
        if (team.squad.length >= s.rules.maxSquadSize) break;
        if (takePlayerForTeam(team, reqRole.fn)) assignedCount += 1;
      }
    }

    while (team.squad.length < s.rules.minSquadSize && pool.length > 0) {
      if (takePlayerForTeam(team, () => true)) {
        assignedCount += 1;
      } else {
        break;
      }
    }
  }

  for (const team of s.teams) {
    autoPickPlayingXIForTeam(team, s, playersById);
  }

  s.status = 'completed';
  s.lotStatus = 'idle';
  s.timerDeadlineMs = 0;
  s.auctionEndDeadlineMs = 0;

  if (assignedCount > 0) {
    addEvent(
      s,
      'sold',
      `${reason}: Randomly auto-assigned ${assignedCount} player(s) to incomplete squads & locked Playing XI rosters.`,
      'Auto Arbitrator'
    );
  } else {
    addEvent(s, 'sold', `${reason}: Auction completed & Playing XI squads finalized.`, 'Auto Arbitrator');
  }

  if (s.virtualMatches.length === 0) {
    runVirtualMatchRound(s, 'Auto Virtual League');
  } else {
    updateLeaderboardFromRoom(s);
  }
}

function resolveHammerSold(internal: ServerRoomInternal, actorName: string): { ok: boolean; error?: string } {
  const s = internal.state;
  const player = s.players.find((p) => p.id === s.currentPlayerId);
  if (!player) return { ok: false, error: 'No active player on the block.' };
  if (!s.highestBidderTeamId || s.currentBid <= 0) {
    return { ok: false, error: 'No valid bid exists. Mark the player UNSOLD instead.' };
  }
  const team = s.teams.find((t) => t.id === s.highestBidderTeamId);
  if (!team) return { ok: false, error: 'Highest bidder team not found.' };
  if (team.remainingPurse < s.currentBid) {
    return { ok: false, error: 'Team purse is insufficient for this hammer price.' };
  }

  pushUndoSnapshot(internal, `Sold ${player.name} to ${team.name}`);

  player.status = 'sold';
  player.soldPrice = s.currentBid;
  player.soldToTeamId = team.id;
  player.soldToTeamName = team.name;
  player.soldTimestamp = Date.now();

  team.remainingPurse -= s.currentBid;
  team.amountSpent += s.currentBid;
  team.squad.push(player.id);

  s.lotStatus = 'sold_reveal';
  s.timerDeadlineMs = 0;
  s.lastOutcome = {
    status: 'sold',
    playerName: player.name,
    playerRole: player.role,
    amount: s.currentBid,
    teamName: team.name,
    teamShortCode: team.shortCode,
    teamColor: team.primaryColor,
    timestamp: Date.now(),
  };

  addEvent(
    s,
    'sold',
    `SOLD! ${player.name} sold to ${team.name} for ${formatCurrency(s.currentBid, s.rules.currency)}`,
    actorName
  );
  updateLeaderboardFromRoom(s);
  return { ok: true };
}

function resolveHammerUnsold(internal: ServerRoomInternal, actorName: string): { ok: boolean; error?: string } {
  const s = internal.state;
  const player = s.players.find((p) => p.id === s.currentPlayerId);
  if (!player) return { ok: false, error: 'No active player on the block.' };

  pushUndoSnapshot(internal, `Marked ${player.name} UNSOLD`);

  player.status = 'unsold';
  player.soldPrice = undefined;
  player.soldToTeamId = undefined;
  player.soldToTeamName = undefined;

  s.lotStatus = 'unsold_reveal';
  s.timerDeadlineMs = 0;
  s.lastOutcome = {
    status: 'unsold',
    playerName: player.name,
    playerRole: player.role,
    amount: player.basePrice,
    timestamp: Date.now(),
  };

  addEvent(s, 'unsold', `UNSOLD: ${player.name} went unsold at base ${formatCurrency(player.basePrice, s.rules.currency)}`, actorName);
  return { ok: true };
}

function startLotForPlayer(internal: ServerRoomInternal, playerId: string | null, actorName: string): { ok: boolean; error?: string } {
  const s = internal.state;
  let target: AuctionPlayer | undefined;
  if (playerId) {
    target = s.players.find((p) => p.id === playerId && p.status !== 'sold');
  } else {
    target = s.players.find((p) => p.status === 'upcoming');
  }
  if (!target) {
    return { ok: false, error: 'No upcoming players remaining in the catalog.' };
  }

  for (const p of s.players) {
    if (p.status === 'bidding') p.status = 'upcoming';
  }

  const now = Date.now();
  target.status = 'bidding';
  s.status = 'live';
  s.rules.rulesLocked = true;
  if (s.auctionEndDeadlineMs === 0 && s.rules.maxAuctionDurationMinutes > 0) {
    s.auctionEndDeadlineMs = now + s.rules.maxAuctionDurationMinutes * 60_000;
  }
  s.currentPlayerId = target.id;
  s.lotStatus = 'bidding';
  s.currentBid = target.basePrice;
  s.highestBidderTeamId = null;
  s.highestBidderName = null;
  s.currentLotBids = [];
  s.lastOutcome = null;
  s.timerDeadlineMs = now + s.rules.initialTimerSeconds * 1000;
  s.timerRemainingAtPause = s.rules.initialTimerSeconds * 1000;
  internal.nextAiThinkAtMs = now + 1300;

  addEvent(
    s,
    'lot_started',
    `On the block: ${target.name} (${target.role} · Base ${formatCurrency(target.basePrice, s.rules.currency)}) — ${s.rules.initialTimerSeconds}s timer`,
    actorName
  );
  return { ok: true };
}

function trySubmitAiOpponentBid(internal: ServerRoomInternal, now: number): boolean {
  const s = internal.state;
  if (
    s.status !== 'live' ||
    s.lotStatus !== 'bidding' ||
    s.rules.buildingMode !== 'auction' ||
    !s.rules.aiOpponentsEnabled
  ) {
    return false;
  }
  const player = s.players.find((p) => p.id === s.currentPlayerId);
  if (!player || now >= s.timerDeadlineMs - 400) return false;

  // Identify teams actively represented by connected non-spectator humans
  const nonHostHumans = s.participants.filter(
    (p) => p.role === 'bidder' && p.teamId && p.id !== s.hostId
  );
  const humanTeamIds = new Set(nonHostHumans.map((p) => p.teamId!));

  // If only host / solo user is active, protect the team the host/user placed the latest human bid for or team[0]
  if (humanTeamIds.size === 0) {
    const primaryHuman = s.participants.find((p) => p.role !== 'spectator' && p.teamId);
    if (primaryHuman?.teamId) humanTeamIds.add(primaryHuman.teamId);
  }

  const aiCandidates = s.teams.filter(
    (t) =>
      !humanTeamIds.has(t.id) &&
      !t.isLocked &&
      t.id !== s.highestBidderTeamId &&
      t.squad.length < s.rules.maxSquadSize
  );
  if (aiCandidates.length === 0) return false;

  const playersMap = new Map(s.players.map((p) => [p.id, p]));
  const quotas = s.rules.roleQuotas || computeDefaultRoleQuotas(s.rules.minSquadSize);
  const hasHighest = Boolean(s.highestBidderTeamId && s.currentBid > 0);
  const nextBid = getNextValidBid(s.currentBid, hasHighest, player.basePrice, s.rules, player.category);

  // Shuffle AI candidates so different franchises jump in dynamically
  const ordered = shuffleWithCrypto(aiCandidates);
  for (const aiTeam of ordered) {
    const counts = countRolesInSquad(aiTeam.squad, playersMap);
    const needsRole =
      ((player.role === 'Batter' || player.role === 'Forward') && counts.bat < quotas.batters) ||
      ((player.role === 'Bowler' || player.role === 'Defender') && counts.bwl < quotas.bowlers) ||
      ((player.role === 'All-Rounder' || player.role === 'Midfielder') && counts.ar < quotas.allRounders) ||
      ((player.role === 'Wicketkeeper' || player.role === 'Goalkeeper') && counts.wk < quotas.wicketkeepers);

    const ratingBoost = 1 + Math.max(0, (player.rating || 80) - 72) * 0.28;
    const roleMultiplier = needsRole ? 1.35 : 0.92;
    const ceiling = Math.round((player.basePrice * ratingBoost * roleMultiplier) / (5 * LAKH)) * (5 * LAKH);

    const reserve = calculateReservedPurse(aiTeam, s.rules, playersMap);
    if (player.isOverseas && reserve.overseasCount >= s.rules.maxOverseasPlayers) continue;
    if (nextBid > reserve.maxAllowedBid || nextBid > Math.max(player.basePrice * 2, ceiling)) continue;

    // Submit authoritative AI bid
    pushUndoSnapshot(internal, `AI Bid ${formatCurrency(nextBid, s.rules.currency)} by ${aiTeam.name}`);
    s.bidSequence += 1;
    s.currentBid = nextBid;
    s.highestBidderTeamId = aiTeam.id;
    s.highestBidderName = `${aiTeam.ownerName} (AI)`;

    const bidRecord: BidRecord = {
      id: makeId('bid'),
      sequence: s.bidSequence,
      playerId: player.id,
      playerName: player.name,
      teamId: aiTeam.id,
      teamName: aiTeam.name,
      teamShortCode: aiTeam.shortCode,
      teamColor: aiTeam.primaryColor,
      bidderId: `ai-${aiTeam.id}`,
      bidderName: `${aiTeam.ownerName} (AI)`,
      amount: nextBid,
      bidType: 'quick',
      timestamp: now,
    };

    s.currentLotBids.unshift(bidRecord);
    s.allBids.unshift(bidRecord);
    if (s.allBids.length > 300) s.allBids.length = 300;

    const resetSec = s.rules.resetTimerSeconds;
    s.timerDeadlineMs = now + resetSec * 1000;
    s.timerRemainingAtPause = resetSec * 1000;

    addEvent(
      s,
      'bid_accepted',
      `#${bidRecord.sequence} ${aiTeam.name} (AI) bid ${formatCurrency(nextBid, s.rules.currency)} for ${player.name} — Timer reset to ${resetSec}s`,
      `${aiTeam.ownerName} (AI)`
    );
    return true;
  }
  return false;
}

// Authoritative server timer + AI opponent + Auto SOLD/UNSOLD + Max Auction Duration monitor
setInterval(() => {
  const now = Date.now();
  for (const [code, internal] of rooms.entries()) {
    const s = internal.state;

    // 1. Overall Auction Max Duration check
    if (s.status === 'live' && s.auctionEndDeadlineMs > 0 && now >= s.auctionEndDeadlineMs) {
      autoCompleteRoomTeamsAndFinish(internal, 'Auction Max Time Expired');
      broadcastRoom(code);
      continue;
    }

    // 2. Active lot countdown expiry -> Auto SOLD (highest bid) or Auto UNSOLD (no bid)
    if (s.status === 'live' && s.lotStatus === 'bidding' && s.timerDeadlineMs > 0 && now >= s.timerDeadlineMs) {
      if (s.highestBidderTeamId && s.currentBid > 0) {
        resolveHammerSold(internal, 'Auto Highest Bid');
        internal.autoAdvanceAtMs = now + 2400;
        broadcastRoom(code);
      } else {
        resolveHammerUnsold(internal, 'Auto No-Bid');
        internal.autoAdvanceAtMs = now + 2400;
        broadcastRoom(code);
      }
      continue;
    }

    // 2b. Auto advance after sold/unsold reveal animation (~2.4s)
    if ((s.lotStatus === 'sold_reveal' || s.lotStatus === 'unsold_reveal') && internal.autoAdvanceAtMs && now >= internal.autoAdvanceAtMs) {
      internal.autoAdvanceAtMs = undefined;
      const nextUpcoming = s.players.find((p) => p.status === 'upcoming');
      if (nextUpcoming) {
        startLotForPlayer(internal, nextUpcoming.id, 'Auto Queue');
      } else {
        autoCompleteRoomTeamsAndFinish(internal, 'All Players Auctioned');
      }
      broadcastRoom(code);
      continue;
    }

    // 3. Single-bidder vs AI auto-bidding loop
    if (
      s.status === 'live' &&
      s.lotStatus === 'bidding' &&
      s.rules.aiOpponentsEnabled &&
      (!internal.nextAiThinkAtMs || now >= internal.nextAiThinkAtMs)
    ) {
      internal.nextAiThinkAtMs = now + 1600 + crypto.randomInt(0, 1200);
      if (trySubmitAiOpponentBid(internal, now)) {
        broadcastRoom(code);
      }
    }
  }
}, 250);

async function bootstrap() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // Health
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, serverTimeMs: Date.now(), activeRooms: rooms.size });
  });

  // Auth status (safe public check if owner already claimed)
  app.get('/api/auth/status', (_req, res) => {
    res.json({
      hasOwner: users.some((u) => u.role === 'owner'),
      ownerEmailConfigured: Boolean(process.env.OWNER_EMAIL),
    });
  });

  // Register customer/user account with Email + Password only
  app.post('/api/auth/register', (req, res) => {
    const body = req.body || {};
    const email = normalizeEmail(body.email);
    const password = typeof body.password === 'string' ? body.password : '';
    const name = typeof body.name === 'string' && body.name.trim()
      ? body.name.trim().slice(0, 48)
      : 'BidsKaro Player';

    if (!isValidEmail(email)) {
      res.status(400).json({ error: 'Please enter a valid email address.' });
      return;
    }
    if (password.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters.' });
      return;
    }
    if (users.some((u) => u.email === email)) {
      res.status(409).json({ error: 'An account with this email already exists. Please sign in.' });
      return;
    }

    const configuredOwnerEmail = normalizeEmail(process.env.OWNER_EMAIL);
    const role: 'owner' | 'user' =
      configuredOwnerEmail && configuredOwnerEmail === email ? 'owner' : 'user';

    const salt = crypto.randomBytes(16).toString('hex');
    const record: AuthUserRecord = {
      id: makeId('usr'),
      email,
      name,
      passwordHash: hashPassword(password, salt),
      salt,
      role,
      createdAt: Date.now(),
    };
    users.push(record);
    schedulePersist();

    const token = signAuthToken(record);
    res.status(201).json({ token, user: toPublicUser(record) });
  });

  // Sign in with Email + Password
  app.post('/api/auth/login', (req, res) => {
    const body = req.body || {};
    const email = normalizeEmail(body.email);
    const password = typeof body.password === 'string' ? body.password : '';

    if (!isValidEmail(email) || !password) {
      res.status(400).json({ error: 'Email and password are required.' });
      return;
    }
    const found = users.find((u) => u.email === email);
    if (!found || !verifyPassword(password, found.salt, found.passwordHash)) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }
    const configuredOwnerEmail = normalizeEmail(process.env.OWNER_EMAIL);
    if (configuredOwnerEmail && configuredOwnerEmail === email && found.role !== 'owner') {
      found.role = 'owner';
      schedulePersist();
    }
    const token = signAuthToken(found);
    res.json({ token, user: toPublicUser(found) });
  });

  // First-run App Owner initialization (or matching OWNER_EMAIL) to unlock Google Drive Vault
  app.post('/api/auth/claim-owner', (req, res) => {
    const body = req.body || {};
    const email = normalizeEmail(body.email);
    const password = typeof body.password === 'string' ? body.password : '';
    const name = typeof body.name === 'string' && body.name.trim()
      ? body.name.trim().slice(0, 48)
      : 'App Owner';

    if (!isValidEmail(email) || password.length < 6) {
      res.status(400).json({ error: 'Valid email and password (min 6 characters) are required.' });
      return;
    }

    const configuredOwnerEmail = normalizeEmail(process.env.OWNER_EMAIL);
    const ownerExists = users.some((u) => u.role === 'owner');
    if (configuredOwnerEmail && configuredOwnerEmail !== email) {
      res.status(403).json({ error: 'This email does not match the configured App Owner email.' });
      return;
    }
    if (!configuredOwnerEmail && ownerExists) {
      res.status(403).json({ error: 'An App Owner account is already configured. Sign in with your owner credentials.' });
      return;
    }

    const existing = users.find((u) => u.email === email);
    if (existing) {
      if (!verifyPassword(password, existing.salt, existing.passwordHash)) {
        res.status(401).json({ error: 'Incorrect password for existing account.' });
        return;
      }
      existing.role = 'owner';
      schedulePersist();
      res.json({ token: signAuthToken(existing), user: toPublicUser(existing) });
      return;
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const ownerRecord: AuthUserRecord = {
      id: makeId('own'),
      email,
      name,
      passwordHash: hashPassword(password, salt),
      salt,
      role: 'owner',
      createdAt: Date.now(),
    };
    users.push(ownerRecord);
    schedulePersist();
    res.status(201).json({ token: signAuthToken(ownerRecord), user: toPublicUser(ownerRecord) });
  });

  app.get('/api/auth/me', (req, res) => {
    const user = getAuthUserFromReq(req);
    if (!user) {
      res.status(401).json({ error: 'Not authenticated.' });
      return;
    }
    res.json({ user: toPublicUser(user) });
  });

  app.post('/api/auth/logout', (_req, res) => {
    res.json({ ok: true });
  });

  // List active/recent rooms
  app.get('/api/rooms', (_req, res) => {
    const list = Array.from(rooms.values())
      .map((r) => ({
        roomCode: r.state.roomCode,
        roomName: r.state.roomName,
        leagueId: r.state.leagueId,
        seasonYear: r.state.seasonYear,
        status: r.state.status,
        isDemo: r.state.isDemo,
        teamsCount: r.state.teams.length,
        playersTotal: r.state.players.length,
        playersSold: r.state.players.filter((p) => p.status === 'sold').length,
        participantsCount: r.state.participants.length,
        defaultPurse: r.state.rules.defaultTeamPurse,
        currency: r.state.rules.currency,
        createdAt: r.state.createdAt,
      }))
      .sort((a, b) => b.createdAt - a.createdAt);
    res.json({ rooms: list });
  });

  // Create room
  app.post('/api/rooms', (req, res) => {
    const body = req.body || {};
    const leagueId = (body.leagueId as LeagueId) || 'CUSTOM';
    const roomName = typeof body.roomName === 'string' && body.roomName.trim()
      ? body.roomName.trim().slice(0, 80)
      : 'BidsKaro Live Auction';
    const hostName = typeof body.hostName === 'string' && body.hostName.trim()
      ? body.hostName.trim().slice(0, 48)
      : 'Auction Host';
    const hostId = typeof body.hostId === 'string' && body.hostId.trim()
      ? body.hostId.trim()
      : makeId('host');
    const seasonYear = typeof body.seasonYear === 'string' ? body.seasonYear : '2025';
    const isDemo = Boolean(body.isDemo);

    const state = createRoomState({
      roomName,
      leagueId,
      seasonYear,
      hostId,
      hostName,
      isDemo,
      rules: body.rules,
      customTeams: Array.isArray(body.teams) ? body.teams : undefined,
    });

    rooms.set(state.roomCode, {
      state,
      undoStack: [],
      recentBidRequestIds: new Set(),
    });
    schedulePersist();
    res.status(201).json({ room: sanitizeRoomForClient(state), hostId, serverTimeMs: Date.now() });
  });

  // Reset or retrieve 5-team demo room
  app.post('/api/rooms/DEMO5/reset', (_req, res) => {
    const existing = rooms.get('DEMO5');
    const hostId = existing?.state.hostId || 'host-demo';
    const fresh = createRoomState({
      roomCode: 'DEMO5',
      roomName: 'BidsKaro 5-Team Championship Demo',
      leagueId: 'CUSTOM',
      seasonYear: '2025',
      hostId,
      hostName: 'Demo Auctioneer',
      isDemo: true,
    });
    rooms.set('DEMO5', {
      state: fresh,
      undoStack: [],
      recentBidRequestIds: new Set(),
    });
    broadcastRoom('DEMO5');
    res.json({ room: sanitizeRoomForClient(fresh), serverTimeMs: Date.now() });
  });



  // Get room state
  app.get('/api/rooms/:code', (req, res) => {
    const code = req.params.code.toUpperCase().trim();
    const internal = rooms.get(code);
    if (!internal) {
      res.status(404).json({ error: 'Auction room not found.' });
      return;
    }
    res.json({ room: sanitizeRoomForClient(internal.state), serverTimeMs: Date.now() });
  });

  // Join room as participant (bidder / spectator / host)
  app.post('/api/rooms/:code/join', (req, res) => {
    const code = req.params.code.toUpperCase().trim();
    const internal = rooms.get(code);
    if (!internal) {
      res.status(404).json({ error: 'Auction room not found.' });
      return;
    }
    const body = req.body || {};
    const participantId = typeof body.participantId === 'string' && body.participantId.trim()
      ? body.participantId.trim()
      : makeId('user');
    const name = typeof body.name === 'string' && body.name.trim()
      ? body.name.trim().slice(0, 48)
      : 'Team Owner';
    const role: Participant['role'] =
      body.role === 'host' && (participantId === internal.state.hostId || internal.state.rules.allBiddersCanHost)
        ? 'host'
        : body.role === 'spectator'
          ? 'spectator'
          : 'bidder';
    const teamId = typeof body.teamId === 'string' ? body.teamId : undefined;

    if (role === 'bidder' && teamId) {
      const teamExists = internal.state.teams.some((t) => t.id === teamId);
      if (!teamExists) {
        res.status(400).json({ error: 'Selected team does not exist in this room.' });
        return;
      }
    }

    const now = Date.now();
    const existingIdx = internal.state.participants.findIndex((p) => p.id === participantId);
    const participant: Participant = {
      id: participantId,
      name,
      role,
      teamId,
      connectedAt: existingIdx >= 0 ? internal.state.participants[existingIdx].connectedAt : now,
      lastSeenAt: now,
    };

    if (existingIdx >= 0) {
      internal.state.participants[existingIdx] = participant;
    } else {
      internal.state.participants.push(participant);
      const assignedTeam = internal.state.teams.find((t) => t.id === teamId);
      addEvent(
        internal.state,
        'participant_joined',
        `${name} joined as ${role}${assignedTeam ? ` (${assignedTeam.name})` : ''}`,
        name
      );
    }

    broadcastRoom(code);
    res.json({ participant, room: sanitizeRoomForClient(internal.state), serverTimeMs: Date.now() });
  });

  // Leave room endpoint
  app.post('/api/rooms/:code/leave', (req, res) => {
    const code = req.params.code.toUpperCase().trim();
    const internal = rooms.get(code);
    if (!internal) {
      res.status(404).json({ error: 'Auction room not found.' });
      return;
    }
    const pid = typeof req.body?.participantId === 'string' ? req.body.participantId : '';
    if (pid) {
      const pIdx = internal.state.participants.findIndex((p) => p.id === pid);
      if (pIdx >= 0) {
        const [rem] = internal.state.participants.splice(pIdx, 1);
        addEvent(internal.state, 'participant_left', `${rem?.name || 'Participant'} left the auction.`, rem?.name || 'User');
      }
      if (pid === internal.state.hostId) {
        const next = internal.state.participants.find((p) => p.role !== 'spectator') || internal.state.participants[0];
        if (next) {
          internal.state.hostId = next.id;
          next.role = 'host';
        }
      }
      broadcastRoom(code);
    }
    res.json({ ok: true });
  });

  // Leaderboard
  app.get('/api/leaderboard', (_req, res) => {
    res.json({ leaderboard });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`).pathname;
    if (pathname === '/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  wss.on('connection', (ws) => {
    ws.on('message', (rawData) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(rawData.toString());
      } catch {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON payload.' }));
        return;
      }

      const type = String(msg.type || '');
      const roomCode = typeof msg.roomCode === 'string' ? msg.roomCode.toUpperCase().trim() : '';

      if (type === 'join_room') {
        const internal = rooms.get(roomCode);
        if (!internal) {
          ws.send(JSON.stringify({ type: 'error', message: 'Auction room not found.' }));
          return;
        }
        const participantId = typeof msg.participantId === 'string' ? msg.participantId : makeId('user');
        const prev = wsMeta.get(ws);
        if (prev && prev.roomCode !== roomCode) {
          roomClients.get(prev.roomCode)?.delete(ws);
        }
        if (!roomClients.has(roomCode)) roomClients.set(roomCode, new Set());
        roomClients.get(roomCode)!.add(ws);
        wsMeta.set(ws, { roomCode, participantId });

        if (typeof msg.name === 'string' && msg.name.trim()) {
          const existingIdx = internal.state.participants.findIndex((p) => p.id === participantId);
          const role: Participant['role'] =
            msg.role === 'host' && (participantId === internal.state.hostId || internal.state.rules.allBiddersCanHost)
              ? 'host'
              : msg.role === 'spectator'
                ? 'spectator'
                : 'bidder';
          const pObj: Participant = {
            id: participantId,
            name: msg.name.trim().slice(0, 48),
            role,
            teamId:
              typeof msg.teamId === 'string'
                ? msg.teamId
                : existingIdx >= 0
                  ? internal.state.participants[existingIdx].teamId
                  : undefined,
            connectedAt: existingIdx >= 0 ? internal.state.participants[existingIdx].connectedAt : Date.now(),
            lastSeenAt: Date.now(),
          };
          if (existingIdx >= 0) {
            internal.state.participants[existingIdx] = pObj;
          } else {
            internal.state.participants.push(pObj);
          }
        }

        ws.send(
          JSON.stringify({
            type: 'room_state',
            serverTimeMs: Date.now(),
            room: sanitizeRoomForClient(internal.state),
          })
        );
        return;
      }

      if (type === 'leave_room') {
        const internal = rooms.get(roomCode);
        if (internal) {
          const participantId = typeof msg.participantId === 'string' ? msg.participantId : '';
          const pIdx = internal.state.participants.findIndex((p) => p.id === participantId);
          if (pIdx >= 0) {
            const [rem] = internal.state.participants.splice(pIdx, 1);
            addEvent(internal.state, 'participant_left', `${rem?.name || 'Participant'} left the auction.`, rem?.name || 'User');
          }
          if (participantId === internal.state.hostId) {
            const next = internal.state.participants.find((p) => p.role !== 'spectator') || internal.state.participants[0];
            if (next) {
              internal.state.hostId = next.id;
              next.role = 'host';
            } else if (msg.autoFinish === true) {
              autoCompleteRoomTeamsAndFinish(internal, 'Host Left & Room Auto-Finished');
            }
          }
          roomClients.get(roomCode)?.delete(ws);
          wsMeta.delete(ws);
          broadcastRoom(roomCode);
        }
        ws.send(JSON.stringify({ type: 'room_left', ok: true }));
        return;
      }

      const meta = wsMeta.get(ws);
      const activeCode = roomCode || meta?.roomCode || '';
      const internal = rooms.get(activeCode);
      if (!internal) {
        ws.send(JSON.stringify({ type: 'error', message: 'Room not found or not joined.' }));
        return;
      }

      const actorId = typeof msg.participantId === 'string' ? msg.participantId : meta?.participantId || '';
      const actorParticipant = internal.state.participants.find((p) => p.id === actorId);
      const isHost =
        actorId === internal.state.hostId ||
        actorParticipant?.role === 'host' ||
        (internal.state.rules.allBiddersCanHost && actorParticipant?.role !== 'spectator') ||
        Boolean(internal.state.isDemo && msg.asHost === true);

      if (type === 'place_bid') {
        const teamId = String(msg.teamId || '');
        const amount = Number(msg.amount);
        const bidType = msg.bidType === 'custom' ? 'custom' : msg.bidType === 'host' ? 'host' : 'quick';
        const expectedSequence = typeof msg.expectedSequence === 'number' ? msg.expectedSequence : undefined;
        const bidRequestId = typeof msg.bidRequestId === 'string' ? msg.bidRequestId : undefined;

        const validation = validateBidSubmission({
          room: internal.state,
          teamId,
          bidderId: actorId,
          amount,
          bidType,
          expectedSequence,
          bidRequestId,
          recentRequestIds: internal.recentBidRequestIds,
          nowMs: Date.now(),
        });

        if (!validation.valid) {
          ws.send(
            JSON.stringify({
              type: 'bid_rejected',
              reason: validation.reason,
              nextMinimumBid: validation.nextMinimumBid,
              bidRequestId,
            })
          );
          return;
        }

        if (bidRequestId) {
          internal.recentBidRequestIds.add(bidRequestId);
          if (internal.recentBidRequestIds.size > 500) {
            const first = internal.recentBidRequestIds.values().next().value;
            if (first) internal.recentBidRequestIds.delete(first);
          }
        }

        const player = internal.state.players.find((p) => p.id === internal.state.currentPlayerId)!;
        const team = internal.state.teams.find((t) => t.id === teamId)!;
        const bidderName = typeof msg.bidderName === 'string' && msg.bidderName.trim()
          ? msg.bidderName.trim().slice(0, 40)
          : actorParticipant?.name || team.ownerName;

        // Track active human team preference for single-bidder vs AI mode
        if (actorParticipant && !actorParticipant.teamId) {
          actorParticipant.teamId = team.id;
        }

        pushUndoSnapshot(internal, `Bid ${formatCurrency(amount, internal.state.rules.currency)} by ${team.name}`);

        internal.state.bidSequence += 1;
        internal.state.currentBid = amount;
        internal.state.highestBidderTeamId = team.id;
        internal.state.highestBidderName = bidderName;

        const bidRecord: BidRecord = {
          id: makeId('bid'),
          sequence: internal.state.bidSequence,
          playerId: player.id,
          playerName: player.name,
          teamId: team.id,
          teamName: team.name,
          teamShortCode: team.shortCode,
          teamColor: team.primaryColor,
          bidderId: actorId,
          bidderName,
          amount,
          bidType,
          timestamp: Date.now(),
        };

        internal.state.currentLotBids.unshift(bidRecord);
        internal.state.allBids.unshift(bidRecord);
        if (internal.state.allBids.length > 300) {
          internal.state.allBids.length = 300;
        }

        const resetSec = internal.state.rules.resetTimerSeconds;
        internal.state.timerDeadlineMs = Date.now() + resetSec * 1000;
        internal.state.timerRemainingAtPause = resetSec * 1000;
        internal.nextAiThinkAtMs = Date.now() + 1600 + crypto.randomInt(0, 1000);

        addEvent(
          internal.state,
          'bid_accepted',
          `#${bidRecord.sequence} ${team.name} bid ${formatCurrency(amount, internal.state.rules.currency)} for ${player.name} (${bidType}) — Timer reset to ${resetSec}s`,
          bidderName
        );

        ws.send(JSON.stringify({ type: 'bid_accepted', bid: bidRecord }));
        broadcastRoom(activeCode);
        return;
      }

      if (type === 'toggle_wishlist') {
        const teamId = String(msg.teamId || '');
        const playerId = String(msg.playerId || '');
        if (!teamId || !playerId) return;
        const current = internal.state.wishlistByTeam[teamId] || [];
        const exists = current.includes(playerId);
        internal.state.wishlistByTeam[teamId] = exists
          ? current.filter((id) => id !== playerId)
          : [...current, playerId];
        broadcastRoom(activeCode);
        return;
      }

      if (type === 'snake_draft_pick') {
        const s = internal.state;
        if (s.rules.buildingMode !== 'snake_draft') {
          ws.send(JSON.stringify({ type: 'error', message: 'Room is not in Snake Draft mode.' }));
          return;
        }
        const turnTeamId = getCurrentSnakeTurnTeamId(s);
        const requestedTeamId = String(msg.teamId || turnTeamId || '');
        if (!isHost && requestedTeamId !== turnTeamId) {
          ws.send(JSON.stringify({ type: 'error', message: 'Wait for your snake draft turn.' }));
          return;
        }
        const team = s.teams.find((t) => t.id === (turnTeamId || requestedTeamId));
        const playerId = String(msg.playerId || s.currentPlayerId || '');
        const player = s.players.find((p) => p.id === playerId && p.status !== 'sold');
        if (!team || !player) {
          ws.send(JSON.stringify({ type: 'error', message: 'Player or team unavailable for Snake Draft pick.' }));
          return;
        }
        if (team.squad.length >= s.rules.maxSquadSize) {
          ws.send(JSON.stringify({ type: 'error', message: `${team.name} squad is full.` }));
          return;
        }
        if (team.remainingPurse < player.basePrice) {
          ws.send(JSON.stringify({ type: 'error', message: `${team.name} has insufficient purse for ${player.name}.` }));
          return;
        }

        pushUndoSnapshot(internal, `Snake Draft Pick: ${player.name} -> ${team.name}`);
        player.status = 'sold';
        player.soldPrice = player.basePrice;
        player.soldToTeamId = team.id;
        player.soldToTeamName = team.name;
        player.soldTimestamp = Date.now();

        team.remainingPurse -= player.basePrice;
        team.amountSpent += player.basePrice;
        team.squad.push(player.id);

        s.status = 'live';
        if (s.auctionEndDeadlineMs === 0 && s.rules.maxAuctionDurationMinutes > 0) {
          s.auctionEndDeadlineMs = Date.now() + s.rules.maxAuctionDurationMinutes * 60_000;
        }
        s.bidSequence += 1;
        const pickRecord: BidRecord = {
          id: makeId('bid'),
          sequence: s.bidSequence,
          playerId: player.id,
          playerName: player.name,
          teamId: team.id,
          teamName: team.name,
          teamShortCode: team.shortCode,
          teamColor: team.primaryColor,
          bidderId: actorId,
          bidderName: team.ownerName,
          amount: player.basePrice,
          bidType: 'snake',
          timestamp: Date.now(),
        };
        s.allBids.unshift(pickRecord);
        s.snakeDraftPickIndex += 1;
        s.snakeDraftRound = Math.floor(s.snakeDraftPickIndex / Math.max(1, s.teams.length)) + 1;

        const nextUpcoming = s.players.find((p) => p.status === 'upcoming');
        s.currentPlayerId = nextUpcoming?.id ?? null;
        s.lotStatus = 'sold_reveal';
        s.lastOutcome = {
          status: 'sold',
          playerName: player.name,
          playerRole: player.role,
          amount: player.basePrice,
          teamName: team.name,
          teamShortCode: team.shortCode,
          teamColor: team.primaryColor,
          timestamp: Date.now(),
        };
        addEvent(
          s,
          'sold',
          `SNAKE DRAFT R${s.snakeDraftRound}: ${team.name} drafted ${player.name} (${formatCurrency(player.basePrice, s.rules.currency)})`,
          team.ownerName
        );
        updateLeaderboardFromRoom(s);
        broadcastRoom(activeCode);
        return;
      }

      if (type === 'set_lineup') {
        const s = internal.state;
        const teamId = String(msg.teamId || '');
        const team = s.teams.find((t) => t.id === teamId);
        if (!team) return;
        const maxXI = Math.min(s.rules.playingXISize || 11, 11);
        const xi = Array.isArray(msg.startingXI)
          ? msg.startingXI.filter((id): id is string => typeof id === 'string' && team.squad.includes(id))
          : team.startingXI;
        team.startingXI = xi.slice(0, maxXI);
        if (typeof msg.captainId === 'string' && team.squad.includes(msg.captainId)) {
          team.captainId = msg.captainId;
        }
        if (typeof msg.viceCaptainId === 'string' && team.squad.includes(msg.viceCaptainId)) {
          team.viceCaptainId = msg.viceCaptainId;
        }
        addEvent(s, 'fantasy', `${team.name} updated Final Playing ${maxXI} (${team.startingXI.length}/${maxXI})`, team.ownerName);
        broadcastRoom(activeCode);
        return;
      }

      if (type === 'claim_waiver') {
        const s = internal.state;
        const teamId = String(msg.teamId || '');
        const playerId = String(msg.playerId || '');
        const team = s.teams.find((t) => t.id === teamId);
        const player = s.players.find((p) => p.id === playerId && (p.status === 'unsold' || p.status === 'upcoming'));
        if (!team || !player) {
          ws.send(JSON.stringify({ type: 'error', message: 'Free agent not available for waiver claim.' }));
          return;
        }
        if (team.squad.length >= s.rules.maxSquadSize) {
          ws.send(JSON.stringify({ type: 'error', message: `${team.name} squad is already at maximum size.` }));
          return;
        }
        if (team.remainingPurse < player.basePrice) {
          ws.send(JSON.stringify({ type: 'error', message: `${team.name} needs ${formatCurrency(player.basePrice, s.rules.currency)} to claim ${player.name}.` }));
          return;
        }
        pushUndoSnapshot(internal, `Waiver Claim: ${player.name} -> ${team.name}`);
        player.status = 'sold';
        player.soldPrice = player.basePrice;
        player.soldToTeamId = team.id;
        player.soldToTeamName = team.name;
        player.soldTimestamp = Date.now();
        team.remainingPurse -= player.basePrice;
        team.amountSpent += player.basePrice;
        team.squad.push(player.id);
        addEvent(
          s,
          'fantasy',
          `WAIVER CLAIM: ${team.name} signed free agent ${player.name} for ${formatCurrency(player.basePrice, s.rules.currency)}`,
          team.ownerName
        );
        updateLeaderboardFromRoom(s);
        broadcastRoom(activeCode);
        return;
      }

      if (type === 'play_virtual_match') {
        const s = internal.state;
        const actorName = actorParticipant?.name || s.hostName;
        runVirtualMatchRound(s, actorName);
        broadcastRoom(activeCode);
        return;
      }

      if (type === 'list_trade_bin') {
        const s = internal.state;
        const teamId = String(msg.teamId || '');
        const playerId = String(msg.playerId || '');
        const team = s.teams.find((t) => t.id === teamId);
        const player = s.players.find((p) => p.id === playerId && team?.squad.includes(p.id));
        if (!team || !player) {
          ws.send(JSON.stringify({ type: 'error', message: 'Select a valid player from your squad to list in the Trade Bin.' }));
          return;
        }
        const already = s.tradeBin.some((tb) => tb.playerId === playerId);
        if (already) {
          ws.send(JSON.stringify({ type: 'error', message: `${player.name} is already listed in the Trade Bin.` }));
          return;
        }
        const defaultAsk = player.soldPrice || player.basePrice;
        const askingPrice = Number(msg.askingPrice) > 0 ? Number(msg.askingPrice) : defaultAsk;
        const listing: TradeBinListing = {
          id: makeId('tb'),
          playerId: player.id,
          teamId: team.id,
          askingPrice,
          note: typeof msg.note === 'string' ? msg.note.trim().slice(0, 80) : undefined,
          createdAt: Date.now(),
        };
        s.tradeBin.unshift(listing);
        addEvent(
          s,
          'fantasy',
          `TRADE BIN: ${team.name} listed ${player.name} for ${formatCurrency(askingPrice, s.rules.currency)}`,
          actorParticipant?.name || team.ownerName
        );
        broadcastRoom(activeCode);
        return;
      }

      if (type === 'remove_trade_bin') {
        const s = internal.state;
        const listingId = String(msg.listingId || '');
        const before = s.tradeBin.length;
        s.tradeBin = s.tradeBin.filter((tb) => tb.id !== listingId);
        if (s.tradeBin.length !== before) {
          broadcastRoom(activeCode);
        }
        return;
      }

      if (type === 'accept_trade_bin') {
        const s = internal.state;
        const listingId = String(msg.listingId || '');
        const buyerTeamId = String(msg.buyerTeamId || '');
        const swapPlayerId = typeof msg.swapPlayerId === 'string' && msg.swapPlayerId ? msg.swapPlayerId : '';
        const listing = s.tradeBin.find((tb) => tb.id === listingId);
        if (!listing) {
          ws.send(JSON.stringify({ type: 'error', message: 'Trade Bin listing no longer exists.' }));
          return;
        }
        const sellerTeam = s.teams.find((t) => t.id === listing.teamId);
        const buyerTeam = s.teams.find((t) => t.id === buyerTeamId);
        const targetPlayer = s.players.find((p) => p.id === listing.playerId);
        const swapPlayer = swapPlayerId ? s.players.find((p) => p.id === swapPlayerId) : undefined;

        if (!sellerTeam || !buyerTeam || sellerTeam.id === buyerTeam.id || !targetPlayer || !sellerTeam.squad.includes(targetPlayer.id)) {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid Trade Bin transfer.' }));
          return;
        }
        if (!swapPlayer && buyerTeam.squad.length >= s.rules.maxSquadSize) {
          ws.send(JSON.stringify({ type: 'error', message: `${buyerTeam.name} is at max squad (${s.rules.maxSquadSize}). Choose a swap player instead.` }));
          return;
        }
        if (swapPlayer && !buyerTeam.squad.includes(swapPlayer.id)) {
          ws.send(JSON.stringify({ type: 'error', message: 'Swap player must belong to acquiring team.' }));
          return;
        }

        const netCash = swapPlayer
          ? Math.max(0, listing.askingPrice - (swapPlayer.soldPrice || swapPlayer.basePrice))
          : listing.askingPrice;

        if (buyerTeam.remainingPurse < netCash) {
          ws.send(JSON.stringify({ type: 'error', message: `${buyerTeam.name} needs ${formatCurrency(netCash, s.rules.currency)} to acquire ${targetPlayer.name}.` }));
          return;
        }

        pushUndoSnapshot(internal, `Trade Bin: ${targetPlayer.name} -> ${buyerTeam.name}`);
        sellerTeam.squad = sellerTeam.squad.filter((id) => id !== targetPlayer.id);
        sellerTeam.startingXI = sellerTeam.startingXI.filter((id) => id !== targetPlayer.id);
        buyerTeam.squad.push(targetPlayer.id);
        targetPlayer.soldToTeamId = buyerTeam.id;
        targetPlayer.soldToTeamName = buyerTeam.name;
        targetPlayer.soldPrice = listing.askingPrice;

        if (swapPlayer) {
          buyerTeam.squad = buyerTeam.squad.filter((id) => id !== swapPlayer.id);
          buyerTeam.startingXI = buyerTeam.startingXI.filter((id) => id !== swapPlayer.id);
          sellerTeam.squad.push(swapPlayer.id);
          swapPlayer.soldToTeamId = sellerTeam.id;
          swapPlayer.soldToTeamName = sellerTeam.name;
        }

        buyerTeam.remainingPurse -= netCash;
        buyerTeam.amountSpent += netCash;
        sellerTeam.remainingPurse += netCash;

        s.tradeBin = s.tradeBin.filter((tb) => tb.id !== listing.id);
        addEvent(
          s,
          'fantasy',
          `TRADE BIN DEAL: ${buyerTeam.name} acquired ${targetPlayer.name}${swapPlayer ? ` (swapped ${swapPlayer.name})` : ''} from ${sellerTeam.name} for ${formatCurrency(netCash, s.rules.currency)}`,
          actorParticipant?.name || buyerTeam.ownerName
        );
        updateLeaderboardFromRoom(s);
        broadcastRoom(activeCode);
        return;
      }

      if (type === 'set_team_retentions') {
        const s = internal.state;
        const teamId = String(msg.teamId || '');
        const team = s.teams.find((t) => t.id === teamId);
        if (!team) return;
        const limit = getTeamRetentionLimit(s, team.id);
        const ids = Array.isArray(msg.playerIds)
          ? msg.playerIds.filter((id): id is string => typeof id === 'string' && team.squad.includes(id)).slice(0, limit)
          : [];
        s.retentionsByTeam[team.id] = ids;
        addEvent(
          s,
          'fantasy',
          `${team.name} set ${ids.length}/${limit} Season Retention pick(s)`,
          actorParticipant?.name || team.ownerName
        );
        broadcastRoom(activeCode);
        return;
      }

      // Host / Mutual Bidder-Host controls
      if (!isHost) {
        ws.send(JSON.stringify({ type: 'error', message: 'Only a host or bidder can perform this control.' }));
        return;
      }

      const actorName = actorParticipant?.name || internal.state.hostName;
      const s = internal.state;

      switch (type) {
        case 'start_auction': {
          s.status = 'live';
          s.rules.rulesLocked = true;
          if (s.rules.maxAuctionDurationMinutes > 0 && s.auctionEndDeadlineMs === 0) {
            s.auctionEndDeadlineMs = Date.now() + s.rules.maxAuctionDurationMinutes * 60_000;
          }
          const targetId = typeof msg.playerId === 'string' ? msg.playerId : s.currentPlayerId;
          const res = startLotForPlayer(internal, targetId, actorName);
          if (!res.ok) {
            ws.send(JSON.stringify({ type: 'error', message: res.error }));
            return;
          }
          broadcastRoom(activeCode);
          break;
        }
        case 'start_lot': {
          const targetId = typeof msg.playerId === 'string' ? msg.playerId : null;
          const res = startLotForPlayer(internal, targetId, actorName);
          if (!res.ok) {
            ws.send(JSON.stringify({ type: 'error', message: res.error }));
            return;
          }
          broadcastRoom(activeCode);
          break;
        }
        case 'pause_timer': {
          if (s.lotStatus === 'bidding') {
            s.timerRemainingAtPause = Math.max(1000, s.timerDeadlineMs - Date.now());
            s.lotStatus = 'paused';
            addEvent(s, 'timer_control', `Timer paused at ${Math.ceil(s.timerRemainingAtPause / 1000)}s`, actorName);
            broadcastRoom(activeCode);
          }
          break;
        }
        case 'resume_timer': {
          if (s.lotStatus === 'paused') {
            const rem = Math.max(2000, s.timerRemainingAtPause || s.rules.initialTimerSeconds * 1000);
            s.timerDeadlineMs = Date.now() + rem;
            s.lotStatus = 'bidding';
            addEvent(s, 'timer_control', `Timer resumed (${Math.ceil(rem / 1000)}s remaining)`, actorName);
            broadcastRoom(activeCode);
          }
          break;
        }
        case 'extend_timer': {
          const addSec = Number(msg.seconds) || 5;
          if (s.lotStatus === 'bidding') {
            s.timerDeadlineMs = Math.max(Date.now(), s.timerDeadlineMs) + addSec * 1000;
          } else if (s.lotStatus === 'paused') {
            s.timerRemainingAtPause += addSec * 1000;
          } else if (s.lotStatus === 'awaiting_hammer') {
            s.lotStatus = 'bidding';
            s.timerDeadlineMs = Date.now() + addSec * 1000;
          }
          addEvent(s, 'timer_control', `Extended timer by +${addSec}s`, actorName);
          broadcastRoom(activeCode);
          break;
        }
        case 'reset_timer': {
          const resetSec = Number(msg.seconds) || s.rules.resetTimerSeconds;
          if (s.lotStatus === 'bidding' || s.lotStatus === 'paused' || s.lotStatus === 'awaiting_hammer') {
            s.lotStatus = 'bidding';
            s.timerDeadlineMs = Date.now() + resetSec * 1000;
            s.timerRemainingAtPause = resetSec * 1000;
            addEvent(s, 'timer_control', `Reset timer to ${resetSec}s`, actorName);
            broadcastRoom(activeCode);
          }
          break;
        }
        case 'close_bidding_manual': {
          if (s.lotStatus === 'bidding' || s.lotStatus === 'paused') {
            s.lotStatus = 'awaiting_hammer';
            s.timerDeadlineMs = 0;
            addEvent(s, 'timer_control', 'Bidding closed manually. Ready for SOLD / UNSOLD confirmation.', actorName);
            broadcastRoom(activeCode);
          }
          break;
        }
        case 'mark_sold': {
          const res = resolveHammerSold(internal, actorName);
          if (!res.ok) {
            ws.send(JSON.stringify({ type: 'error', message: res.error }));
            return;
          }
          broadcastRoom(activeCode);
          break;
        }
        case 'mark_unsold': {
          const res = resolveHammerUnsold(internal, actorName);
          if (!res.ok) {
            ws.send(JSON.stringify({ type: 'error', message: res.error }));
            return;
          }
          broadcastRoom(activeCode);
          break;
        }
        case 'undo_last_action': {
          const snap = internal.undoStack.pop();
          if (!snap) {
            ws.send(JSON.stringify({ type: 'error', message: 'Nothing to undo.' }));
            return;
          }
          s.players = snap.players;
          s.teams = snap.teams;
          s.currentPlayerId = snap.currentPlayerId;
          s.lotStatus = snap.lotStatus === 'bidding' ? 'paused' : snap.lotStatus;
          s.currentBid = snap.currentBid;
          s.highestBidderTeamId = snap.highestBidderTeamId;
          s.highestBidderName = snap.highestBidderName;
          s.bidSequence = snap.bidSequence;
          s.currentLotBids = snap.currentLotBids;
          s.timerRemainingAtPause = snap.timerRemainingAtPause;
          s.snakeDraftPickIndex = snap.snakeDraftPickIndex;
          s.snakeDraftRound = Math.floor(s.snakeDraftPickIndex / Math.max(1, s.teams.length)) + 1;
          s.lastOutcome = null;
          s.undoStackCount = internal.undoStack.length;
          addEvent(s, 'undo', `UNDO: Reverted "${snap.description}"`, actorName);
          updateLeaderboardFromRoom(s);
          broadcastRoom(activeCode);
          break;
        }
        case 'verbal_sell': {
          const teamId = String(msg.teamId || '');
          const amount = Number(msg.amount);
          const team = s.teams.find((t) => t.id === teamId);
          const player = s.players.find((p) => p.id === (typeof msg.playerId === 'string' ? msg.playerId : s.currentPlayerId));
          if (!team || !player) {
            ws.send(JSON.stringify({ type: 'error', message: 'Select a valid player and team for verbal sale.' }));
            return;
          }
          if (!Number.isFinite(amount) || amount < player.basePrice || amount > team.remainingPurse) {
            ws.send(JSON.stringify({ type: 'error', message: 'Verbal sale amount must be between base price and remaining team purse.' }));
            return;
          }
          if (team.squad.length >= s.rules.maxSquadSize) {
            ws.send(JSON.stringify({ type: 'error', message: `${team.name} squad is already full.` }));
            return;
          }
          pushUndoSnapshot(internal, `Verbal Sale: ${player.name} to ${team.name}`);
          s.status = 'live';
          s.bidSequence += 1;
          s.currentBid = amount;
          s.highestBidderTeamId = team.id;
          s.highestBidderName = `${team.ownerName} (Verbal)`;
          const bidRecord: BidRecord = {
            id: makeId('bid'),
            sequence: s.bidSequence,
            playerId: player.id,
            playerName: player.name,
            teamId: team.id,
            teamName: team.name,
            teamShortCode: team.shortCode,
            teamColor: team.primaryColor,
            bidderId: actorId,
            bidderName: `${team.ownerName} (Verbal Table)`,
            amount,
            bidType: 'verbal',
            timestamp: Date.now(),
          };
          s.currentLotBids.unshift(bidRecord);
          s.allBids.unshift(bidRecord);
          player.status = 'sold';
          player.soldPrice = amount;
          player.soldToTeamId = team.id;
          player.soldToTeamName = team.name;
          player.soldTimestamp = Date.now();
          team.remainingPurse -= amount;
          team.amountSpent += amount;
          team.squad.push(player.id);
          s.lotStatus = 'sold_reveal';
          s.timerDeadlineMs = 0;
          s.lastOutcome = {
            status: 'sold',
            playerName: player.name,
            playerRole: player.role,
            amount,
            teamName: team.name,
            teamShortCode: team.shortCode,
            teamColor: team.primaryColor,
            timestamp: Date.now(),
          };
          addEvent(
            s,
            'sold',
            `VERBAL SOLD: ${player.name} assigned to ${team.name} for ${formatCurrency(amount, s.rules.currency)}`,
            actorName
          );
          updateLeaderboardFromRoom(s);
          broadcastRoom(activeCode);
          break;
        }
        case 'nominate_reauction': {
          const playerId = String(msg.playerId || '');
          const player = s.players.find((p) => p.id === playerId && p.status === 'unsold');
          if (!player) {
            ws.send(JSON.stringify({ type: 'error', message: 'Only unsold players can be nominated for re-auction.' }));
            return;
          }
          const reducedBase = Math.max(10 * LAKH, Math.round((player.basePrice * 0.5) / (5 * LAKH)) * (5 * LAKH));
          player.basePrice = reducedBase;
          player.status = 'upcoming';
          addEvent(
            s,
            'reauction',
            `RE-AUCTION: ${player.name} re-entered at reduced base price ${formatCurrency(reducedBase, s.rules.currency)}`,
            actorName
          );
          if (msg.startImmediately) {
            startLotForPlayer(internal, player.id, actorName);
          }
          broadcastRoom(activeCode);
          break;
        }
        case 'execute_trade': {
          const fromTeamId = String(msg.fromTeamId || '');
          const toTeamId = String(msg.toTeamId || '');
          const givePlayerId = String(msg.givePlayerId || '');
          const receivePlayerId = typeof msg.receivePlayerId === 'string' && msg.receivePlayerId ? msg.receivePlayerId : '';
          const cashAdjustment = Number(msg.cashAdjustment || 0);

          const teamA = s.teams.find((t) => t.id === fromTeamId);
          const teamB = s.teams.find((t) => t.id === toTeamId);
          const pA = s.players.find((p) => p.id === givePlayerId);
          const pB = receivePlayerId ? s.players.find((p) => p.id === receivePlayerId) : undefined;

          if (!teamA || !teamB || teamA.id === teamB.id || !pA || !teamA.squad.includes(pA.id)) {
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid trade parameters.' }));
            return;
          }
          if (pB && !teamB.squad.includes(pB.id)) {
            ws.send(JSON.stringify({ type: 'error', message: 'Target player does not belong to receiving team.' }));
            return;
          }
          if (teamB.remainingPurse - cashAdjustment < 0 || teamA.remainingPurse + cashAdjustment < 0) {
            ws.send(JSON.stringify({ type: 'error', message: 'Insufficient purse for trade cash adjustment.' }));
            return;
          }

          pushUndoSnapshot(internal, `Trade ${pA.name}${pB ? ` <-> ${pB.name}` : ''}`);
          teamA.squad = teamA.squad.filter((id) => id !== pA.id);
          teamA.startingXI = teamA.startingXI.filter((id) => id !== pA.id);
          teamB.squad.push(pA.id);
          pA.soldToTeamId = teamB.id;
          pA.soldToTeamName = teamB.name;

          if (pB) {
            teamB.squad = teamB.squad.filter((id) => id !== pB.id);
            teamB.startingXI = teamB.startingXI.filter((id) => id !== pB.id);
            teamA.squad.push(pB.id);
            pB.soldToTeamId = teamA.id;
            pB.soldToTeamName = teamA.name;
          }

          teamA.remainingPurse += cashAdjustment;
          teamB.remainingPurse -= cashAdjustment;

          addEvent(
            s,
            'fantasy',
            `TRADE: ${teamA.name} sent ${pA.name}${pB ? ` for ${pB.name}` : ''} to ${teamB.name}`,
            actorName
          );
          updateLeaderboardFromRoom(s);
          broadcastRoom(activeCode);
          break;
        }
        case 'simulate_matchweek': {
          s.matchweekNumber += 1;
          const playersById = new Map(s.players.map((p) => [p.id, p]));
          for (const p of s.players) {
            if (p.status === 'sold') {
              const basePts = Math.round((p.rating || 80) * 0.45);
              const variance = crypto.randomInt(-8, 28);
              const mwPts = Math.max(8, basePts + variance);
              p.fantasyPoints = (p.fantasyPoints || 0) + mwPts;
            }
          }
          for (const team of s.teams) {
            const xi = team.startingXI.length > 0 ? team.startingXI : team.squad.slice(0, 11);
            let totalTeamPts = 0;
            for (const pid of xi) {
              const plr = playersById.get(pid);
              if (!plr) continue;
              const mult = pid === team.captainId ? 2 : pid === team.viceCaptainId ? 1.5 : 1;
              totalTeamPts += Math.round((plr.fantasyPoints || 0) * mult);
            }
            team.fantasyPoints = totalTeamPts;
          }
          addEvent(s, 'fantasy', `Matchweek ${s.matchweekNumber} simulated! Fantasy standings updated (C 2x · VC 1.5x).`, actorName);
          updateLeaderboardFromRoom(s);
          broadcastRoom(activeCode);
          break;
        }
        case 'simulate_season_round': {
          const roundsArg = msg.rounds === 'all' ? 'all' : Math.max(1, Number(msg.rounds) || 1);
          simulateSeasonLeagueRounds(s, roundsArg, actorName);
          broadcastRoom(activeCode);
          break;
        }
        case 'simulate_playoffs': {
          const res = simulateSeasonPlayoffsAndCrown(s, actorName);
          if (!res.ok) {
            ws.send(JSON.stringify({ type: 'error', message: res.error }));
            return;
          }
          broadcastRoom(activeCode);
          break;
        }
        case 'start_next_season': {
          startNextSeasonAuction(internal, actorName);
          broadcastRoom(activeCode);
          break;
        }
        case 'update_rules': {
          const nextRules = msg.rules as Partial<AuctionRules>;
          if (!nextRules) return;
          if (s.rules.rulesLocked && !s.rules.hostCanEditRulesLive) {
            ws.send(JSON.stringify({ type: 'error', message: 'Rules are locked after auction start.' }));
            return;
          }
          const prevMax = s.rules.maxSquadSize;
          const prevPurse = s.rules.defaultTeamPurse;
          const nextMin = Math.max(5, Math.min(18, nextRules.minSquadSize ?? s.rules.minSquadSize));
          const nextMax = Math.max(nextMin, Math.min(18, nextRules.maxSquadSize ?? s.rules.maxSquadSize));
          const nextPlayMode = nextRules.playMode ?? (nextRules.aiOpponentsEnabled === false ? 'friends' : nextRules.aiOpponentsEnabled === true ? 'ai' : s.rules.playMode);
          const nextAi = nextRules.aiOpponentsEnabled ?? (nextPlayMode === 'ai');
          s.rules = {
            ...s.rules,
            ...nextRules,
            playMode: nextPlayMode,
            aiOpponentsEnabled: nextAi,
            minSquadSize: nextMin,
            maxSquadSize: nextMax,
            playingXISize: Math.min(11, nextRules.playingXISize ?? Math.min(11, nextMin)),
          };
          // Rebuild/rescale lobby player pool if still in lobby and squad/purse changed
          if (s.status === 'lobby' && (nextMax !== prevMax || s.rules.defaultTeamPurse !== prevPurse)) {
            s.players = buildPlayersForLeague(
              s.leagueId,
              s.teams.length,
              nextMax,
              s.rules.defaultTeamPurse,
              s.rules.minBidFloor
            );
            s.currentPlayerId = s.players[0]?.id ?? null;
          }
          addEvent(s, 'rules_updated', `Auction rules updated (Timer: ${s.rules.initialTimerSeconds}s · ${s.rules.stackMode === 'lifetime' ? 'Lifetime' : 'Season-Only'} · ${s.rules.playMode === 'friends' ? 'Friends Invite' : 'VS AI'})`, actorName);
          broadcastRoom(activeCode);
          break;
        }
        case 'update_team': {
          const teamId = String(msg.teamId || '');
          const patch = msg.patch as Partial<Team>;
          const team = s.teams.find((t) => t.id === teamId);
          if (!team || !patch) return;
          if (typeof patch.name === 'string' && patch.name.trim()) team.name = patch.name.trim().slice(0, 48);
          if (typeof patch.shortCode === 'string' && patch.shortCode.trim()) team.shortCode = patch.shortCode.trim().slice(0, 5).toUpperCase();
          if (typeof patch.ownerName === 'string' && patch.ownerName.trim()) team.ownerName = patch.ownerName.trim().slice(0, 48);
          if (typeof patch.isLocked === 'boolean') team.isLocked = patch.isLocked;
          if (typeof patch.initialPurse === 'number' && patch.initialPurse >= team.amountSpent) {
            team.initialPurse = Math.min(patch.initialPurse, s.rules.maxTeamPurse);
            team.remainingPurse = team.initialPurse - team.amountSpent;
          }
          addEvent(s, 'rules_updated', `Team "${team.name}" configuration updated`, actorName);
          broadcastRoom(activeCode);
          break;
        }
        case 'add_custom_player': {
          const p = msg.player as Partial<AuctionPlayer>;
          if (!p || !p.name || typeof p.name !== 'string') return;
          const newPlayer: AuctionPlayer = {
            id: makeId('plr'),
            name: p.name.trim().slice(0, 60),
            country: typeof p.country === 'string' ? p.country.trim() : 'India',
            isOverseas: Boolean(p.isOverseas),
            role: p.role || 'All-Rounder',
            category: p.category || 'Marquee',
            leagueTags: [s.leagueId],
            seasonsActive: [s.seasonYear],
            basePrice: Number(p.basePrice) > 0 ? Number(p.basePrice) : 50 * LAKH,
            battingStyle: p.battingStyle || 'Right-Hand Bat',
            bowlingStyle: p.bowlingStyle || 'Right-Arm Medium',
            rating: Number(p.rating) || 85,
            stats: p.stats || {
              matches: 25,
              runs: 540,
              average: 28.4,
              strikeRate: 142.5,
              highestScore: '78*',
              fiftiesHundreds: '4 / 0',
              wickets: 12,
              economy: 8.1,
              bestBowling: '3/22',
            },
            status: 'upcoming',
          };
          s.players.unshift(newPlayer);
          addEvent(s, 'rules_updated', `Added custom player ${newPlayer.name} (${formatCurrency(newPlayer.basePrice, s.rules.currency)})`, actorName);
          broadcastRoom(activeCode);
          break;
        }
        case 'toggle_big_screen_publish': {
          s.bigScreenPublished = !s.bigScreenPublished;
          addEvent(s, 'rules_updated', `Big Screen display ${s.bigScreenPublished ? 'published' : 'unpublished'}`, actorName);
          broadcastRoom(activeCode);
          break;
        }
        case 'complete_auction': {
          autoCompleteRoomTeamsAndFinish(internal, `Completed by ${actorName}`);
          broadcastRoom(activeCode);
          break;
        }
        default:
          break;
      }
    });

    ws.on('close', () => {
      const meta = wsMeta.get(ws);
      if (meta) {
        roomClients.get(meta.roomCode)?.delete(ws);
        wsMeta.delete(ws);
      }
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR === 'true' ? false : { server },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`BidsKaro live auction server running on http://0.0.0.0:${PORT}`);
  });
}

bootstrap();
