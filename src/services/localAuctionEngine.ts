import {
  AuctionPlayer,
  AuctionRoomState,
  AuctionRules,
  BidRecord,
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
} from '../shared/auctionTypes';
import { CRORE, formatCurrency, LAKH } from '../shared/currency';
import {
  calculateReservedPurse,
  computeDefaultRoleQuotas,
  computeScaledBasePrice,
  DEFAULT_AUCTION_RULES,
  DEFAULT_INCREMENT_TABLE,
  getNextValidBid,
  getTeamRetentionLimit,
  validateBidSubmission,
} from '../shared/rulesEngine';
import { getLeagueById } from '../data/leagues';
import { buildPlayersForLeague } from '../data/players';

const LOCAL_ROOMS_KEY = 'bidskaro_local_rooms_v1';
const CHANNEL_NAME = 'bidskaro_local_sync_v1';

interface LocalRoomInternal {
  state: AuctionRoomState;
  undoStack: UndoSnapshot[];
  recentBidRequestIds: Set<string>;
  nextAiThinkAtMs?: number;
  autoAdvanceAtMs?: number;
}

const localRooms = new Map<string, LocalRoomInternal>();
const subscribers = new Map<string, Set<(msg: Record<string, unknown>) => void>>();
let syncChannel: BroadcastChannel | null = null;
let loopStarted = false;

function randInt(min: number, maxExclusive: number): number {
  const span = Math.max(1, maxExclusive - min);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const arr = new Uint32Array(1);
    crypto.getRandomValues(arr);
    return min + (arr[0] % span);
  }
  return min + Math.floor(Math.random() * span);
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[randInt(0, chars.length)];
  }
  return localRooms.has(code) ? generateRoomCode() : code;
}

function shuffleArr<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randInt(0, i + 1);
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy;
}

function getChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return null;
  if (!syncChannel) {
    syncChannel = new BroadcastChannel(CHANNEL_NAME);
    syncChannel.onmessage = (event) => {
      const data = event.data as { type?: string; roomCode?: string; state?: AuctionRoomState };
      if (data?.type === 'sync_room' && data.roomCode && data.state) {
        const existing = localRooms.get(data.roomCode);
        if (existing) {
          existing.state = data.state;
        } else {
          localRooms.set(data.roomCode, {
            state: data.state,
            undoStack: [],
            recentBidRequestIds: new Set(),
          });
        }
        emitToSubscribers(data.roomCode, {
          type: 'room_state',
          serverTimeMs: Date.now(),
          room: sanitizeRoomForClient(data.state),
        });
      }
    };
  }
  return syncChannel;
}

function persistLocalRooms() {
  try {
    const obj: Record<string, AuctionRoomState> = {};
    for (const [k, v] of localRooms.entries()) {
      obj[k] = v.state;
    }
    localStorage.setItem(LOCAL_ROOMS_KEY, JSON.stringify(obj));
  } catch {
    // ignore storage quota errors
  }
}

function hydrateLocalRooms() {
  if (localRooms.size > 0) return;
  try {
    const raw = localStorage.getItem(LOCAL_ROOMS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, AuctionRoomState>;
    if (!parsed || typeof parsed !== 'object') return;
    for (const [code, state] of Object.entries(parsed)) {
      if (state && state.roomCode) {
        localRooms.set(code, {
          state,
          undoStack: [],
          recentBidRequestIds: new Set(),
        });
      }
    }
  } catch {
    // ignore parse errors
  }
}

export function sanitizeRoomForClient(state: AuctionRoomState): AuctionRoomState {
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

function emitToSubscribers(code: string, payload: Record<string, unknown>) {
  const subs = subscribers.get(code);
  if (!subs) return;
  for (const fn of subs) {
    try {
      fn(payload);
    } catch {
      // ignore callback error
    }
  }
}

function broadcastLocalRoom(code: string) {
  const internal = localRooms.get(code);
  if (!internal) return;
  internal.state.undoStackCount = internal.undoStack.length;
  internal.state.updatedAt = Date.now();
  persistLocalRooms();
  const sanitized = sanitizeRoomForClient(internal.state);
  emitToSubscribers(code, {
    type: 'room_state',
    serverTimeMs: Date.now(),
    room: sanitized,
  });
  try {
    getChannel()?.postMessage({
      type: 'sync_room',
      roomCode: code,
      state: internal.state,
    });
  } catch {
    // ignore broadcast error
  }
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

function pushUndoSnapshot(internal: LocalRoomInternal, description: string) {
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
    return { xi, strength: sum + balanceBonus + randInt(-38, 46) };
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
    const loserGoals = randInt(0, 3);
    const winGoals = loserGoals + Math.max(1, Math.min(3, Math.ceil(diff / 35)));
    const aGoals = winner.id === teamA.id ? winGoals : loserGoals;
    const bGoals = winner.id === teamB.id ? winGoals : loserGoals;
    teamAScore = String(aGoals);
    teamBScore = String(bGoals);
    marginText = `${winner.name} won ${teamAScore}–${teamBScore}`;
    nrrDeltaA = Number(((aGoals - bGoals) * 0.25).toFixed(3));
    nrrDeltaB = -nrrDeltaA;
  } else {
    const baseRuns = 162 + randInt(0, 38);
    const marginRuns = Math.max(4, Math.min(48, Math.round(diff * 0.45) + randInt(1, 10)));
    const aRuns = winner.id === teamA.id ? baseRuns : Math.max(125, baseRuns - marginRuns);
    const bRuns = winner.id === teamB.id ? baseRuns : Math.max(125, baseRuns - marginRuns);
    const aWkts = randInt(3, 9);
    const bWkts = randInt(4, 10);
    teamAScore = `${aRuns}/${aWkts} (20.0)`;
    teamBScore = `${bRuns}/${bWkts} (20.0)`;
    marginText =
      randInt(0, 2) === 0
        ? `${winner.name} won by ${Math.abs(aRuns - bRuns)} runs`
        : `${winner.name} won by ${randInt(2, 7)} wickets`;
    nrrDeltaA = Number(((aRuns - bRuns) / 20).toFixed(3));
    nrrDeltaB = -nrrDeltaA;
  }

  const starPool = [...winnerEval.xi].sort((x, y) => (y.rating || 80) - (x.rating || 80));
  const motm = starPool[randInt(0, Math.max(1, Math.min(3, starPool.length)))] || winnerEval.xi[0];
  const motmPerformance = isFootball
    ? `${randInt(1, 3)}G · ${randInt(0, 2)}A`
    : motm?.role === 'Bowler'
      ? `${randInt(3, 5)}/${randInt(14, 29)} (4.0 ov)`
      : `${randInt(54, 98)}* (${randInt(31, 52)} balls)`;

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
    const remaining = eligible.filter((cand) => cand.id !== tA.id && !used.has(cand.id));
    if (remaining.length === 0) break;
    const tB = remaining[randInt(0, remaining.length)];
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

  const standings = ensureSeasonStandings(state);
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
    const sf1Res = simulateSingleHeadToHeadMatch(state, t1, t4, state.seasonMatches.length + 1, 'SF1', playersById);
    const sf2Res = simulateSingleHeadToHeadMatch(state, t2, t3, state.seasonMatches.length + 2, 'SF2', playersById);
    playoffResults.push(sf1Res.match, sf2Res.match);
    playoffs.push(
      { id: makeId('po'), stage: 'SF1', label: 'Semi-Final 1 (#1 vs #4)', teamAId: t1.id, teamBId: t4.id, matchResult: sf1Res.match },
      { id: makeId('po'), stage: 'SF2', label: 'Semi-Final 2 (#2 vs #3)', teamAId: t2.id, teamBId: t3.id, matchResult: sf2Res.match }
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

  addEvent(
    state,
    'fantasy',
    `CHAMPION CROWNED (Season ${state.seasonNumber}): ${championTeam.name} beat ${runnerUpTeam.name} in the Final!`,
    actorName
  );
  return { ok: true };
}

function startNextSeasonAuction(internal: LocalRoomInternal, actorName: string) {
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
      ? `SEASON ${s.seasonNumber} LAUNCHED (Lifetime Stacks): Retained ${retainedCount} players, released ${releasedCount} players.`
      : `SEASON ${s.seasonNumber} LAUNCHED (Season-Only Reset): All squads cleared & players reset.`,
    actorName
  );
}

function resolveHammerSold(internal: LocalRoomInternal, actorName: string): { ok: boolean; error?: string } {
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

  addEvent(s, 'sold', `SOLD! ${player.name} sold to ${team.name} for ${formatCurrency(s.currentBid, s.rules.currency)}`, actorName);
  return { ok: true };
}

function resolveHammerUnsold(internal: LocalRoomInternal, actorName: string): { ok: boolean; error?: string } {
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

function startLotForPlayer(internal: LocalRoomInternal, playerId: string | null, actorName: string): { ok: boolean; error?: string } {
  const s = internal.state;
  const target = playerId
    ? s.players.find((p) => p.id === playerId && p.status !== 'sold')
    : s.players.find((p) => p.status === 'upcoming');
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

function autoCompleteRoomTeamsAndFinish(internal: LocalRoomInternal, reason: string) {
  const s = internal.state;
  if (s.status === 'completed') return;

  if (s.lotStatus === 'bidding' && s.highestBidderTeamId && s.currentBid > 0) {
    resolveHammerSold(internal, reason);
  }

  const playersById = new Map(s.players.map((p) => [p.id, p]));
  const pool = shuffleArr(s.players.filter((p) => p.status === 'upcoming' || p.status === 'unsold'));
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
      if (takePlayerForTeam(team, () => true)) assignedCount += 1;
      else break;
    }
  }

  for (const team of s.teams) {
    autoPickPlayingXIForTeam(team, s, playersById);
  }

  s.status = 'completed';
  s.lotStatus = 'idle';
  s.timerDeadlineMs = 0;
  s.auctionEndDeadlineMs = 0;

  addEvent(
    s,
    'sold',
    assignedCount > 0
      ? `${reason}: Randomly auto-assigned ${assignedCount} player(s) to incomplete squads & locked Playing XI rosters.`
      : `${reason}: Auction completed & Playing XI squads finalized.`,
    'Auto Arbitrator'
  );

  if (s.virtualMatches.length === 0) {
    simulateSeasonLeagueRounds(s, 1, 'Auto Virtual League');
  }
}

function trySubmitAiOpponentBid(internal: LocalRoomInternal, now: number): boolean {
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

  const nonHostHumans = s.participants.filter(
    (p) => p.role === 'bidder' && p.teamId && p.id !== s.hostId
  );
  const humanTeamIds = new Set(nonHostHumans.map((p) => p.teamId!));

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

  for (const aiTeam of shuffleArr(aiCandidates)) {
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

function ensureLocalTicker() {
  if (loopStarted || typeof window === 'undefined') return;
  loopStarted = true;
  getChannel();
  window.setInterval(() => {
    const now = Date.now();
    for (const [code, internal] of localRooms.entries()) {
      if (!subscribers.get(code)?.size) continue;
      const s = internal.state;

      if (s.status === 'live' && s.auctionEndDeadlineMs > 0 && now >= s.auctionEndDeadlineMs) {
        autoCompleteRoomTeamsAndFinish(internal, 'Auction Max Time Expired');
        broadcastLocalRoom(code);
        continue;
      }

      if (s.status === 'live' && s.lotStatus === 'bidding' && s.timerDeadlineMs > 0 && now >= s.timerDeadlineMs) {
        if (s.highestBidderTeamId && s.currentBid > 0) {
          resolveHammerSold(internal, 'Auto Highest Bid');
          internal.autoAdvanceAtMs = now + 2400;
          broadcastLocalRoom(code);
        } else {
          resolveHammerUnsold(internal, 'Auto No-Bid');
          internal.autoAdvanceAtMs = now + 2400;
          broadcastLocalRoom(code);
        }
        continue;
      }

      if ((s.lotStatus === 'sold_reveal' || s.lotStatus === 'unsold_reveal') && internal.autoAdvanceAtMs && now >= internal.autoAdvanceAtMs) {
        internal.autoAdvanceAtMs = undefined;
        const nextUpcoming = s.players.find((p) => p.status === 'upcoming');
        if (nextUpcoming) {
          startLotForPlayer(internal, nextUpcoming.id, 'Auto Queue');
        } else {
          autoCompleteRoomTeamsAndFinish(internal, 'All Players Auctioned');
        }
        broadcastLocalRoom(code);
        continue;
      }

      if (
        s.status === 'live' &&
        s.lotStatus === 'bidding' &&
        s.rules.aiOpponentsEnabled &&
        (!internal.nextAiThinkAtMs || now >= internal.nextAiThinkAtMs)
      ) {
        internal.nextAiThinkAtMs = now + 1600 + randInt(0, 1200);
        if (trySubmitAiOpponentBid(internal, now)) {
          broadcastLocalRoom(code);
        }
      }
    }
  }, 250);
}

export function createLocalRoom(body: {
  roomName?: string;
  leagueId?: LeagueId;
  seasonYear?: string;
  hostId?: string;
  hostName?: string;
  roomCode?: string;
  rules?: Partial<AuctionRules>;
  teams?: Array<{
    id?: string;
    name: string;
    shortCode: string;
    primaryColor: string;
    secondaryColor: string;
    ownerName: string;
    initialPurse?: number;
  }>;
}): { room: AuctionRoomState; hostId: string; serverTimeMs: number } {
  hydrateLocalRooms();
  ensureLocalTicker();

  const leagueId = body.leagueId || 'IPL';
  const league = getLeagueById(leagueId);
  const now = Date.now();
  const minSquad = Math.max(5, Math.min(18, body.rules?.minSquadSize ?? 11));
  const maxSquad = Math.max(minSquad, Math.min(18, body.rules?.maxSquadSize ?? 18));
  const playingXISize = Math.min(11, body.rules?.playingXISize ?? Math.min(11, minSquad));

  const resolvedPlayMode =
    body.rules?.playMode ?? (body.rules?.aiOpponentsEnabled === false ? 'friends' : 'ai');
  const resolvedAiEnabled = body.rules?.aiOpponentsEnabled ?? resolvedPlayMode === 'ai';

  const baseRules: AuctionRules = {
    ...DEFAULT_AUCTION_RULES,
    incrementTable: DEFAULT_INCREMENT_TABLE.map((t) => ({ ...t })),
    defaultTeamPurse: league.defaultPurse,
    maxTeamPurse: Math.max(league.defaultPurse, body.rules?.defaultTeamPurse ?? 200 * CRORE),
    maxOverseasPlayers: league.defaultMaxOverseas,
    reservePerEmptySlot: league.defaultBaseReserve,
    ...body.rules,
    stackMode: body.rules?.stackMode ?? 'lifetime',
    playMode: resolvedPlayMode,
    matchesPerTeamPerSeason: Math.max(4, Math.min(28, body.rules?.matchesPerTeamPerSeason ?? 14)),
    standardRetentionLimit: body.rules?.standardRetentionLimit ?? 4,
    runnerUpRetentionLimit: body.rules?.runnerUpRetentionLimit ?? 5,
    championRetentionLimit: body.rules?.championRetentionLimit ?? 6,
    minSquadSize: minSquad,
    maxSquadSize: maxSquad,
    playingXISize,
    roleQuotas: body.rules?.roleQuotas || computeDefaultRoleQuotas(minSquad),
    allBiddersCanHost: body.rules?.allBiddersCanHost ?? true,
    hostCanBid: body.rules?.hostCanBid ?? true,
    aiOpponentsEnabled: resolvedAiEnabled,
    maxAuctionDurationMinutes: body.rules?.maxAuctionDurationMinutes ?? 20,
  };

  const rawTeamPresets = body.teams?.length
    ? body.teams
    : league.franchises.slice(0, leagueId === 'IPL' ? 10 : 5).map((t) => ({
        id: t.id,
        name: t.name,
        shortCode: t.shortCode,
        primaryColor: t.primaryColor,
        secondaryColor: t.secondaryColor,
        ownerName: t.defaultOwner,
        initialPurse: baseRules.defaultTeamPurse,
      }));

  const teamPresets =
    resolvedPlayMode === 'ai'
      ? rawTeamPresets.slice(0, 2).map((t, idx) => ({
          ...t,
          ownerName: idx === 0 ? body.hostName || t.ownerName : 'AI Opponent',
        }))
      : rawTeamPresets;

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

  const players = buildPlayersForLeague(
    leagueId,
    teams.length,
    baseRules.maxSquadSize,
    baseRules.defaultTeamPurse,
    baseRules.minBidFloor
  );
  const code = body.roomCode ? body.roomCode.toUpperCase().trim() : generateRoomCode();
  const hostId = body.hostId?.trim() || makeId('host');
  const hostName = body.hostName?.trim() || 'Auction Host';

  const state: AuctionRoomState = {
    roomCode: code,
    roomName: body.roomName?.trim() || `${league.name} Live Auction`,
    leagueId,
    seasonYear: body.seasonYear || league.seasons[0]?.year || '2025',
    seasonNumber: 1,
    hostId,
    hostName,
    isDemo: code === 'DEMO5',
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
    seasonStandings: teams.map((t) => ({
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
    seasonPlayoffs: [],
    seasonChampionTeamId: null,
    seasonRunnerUpTeamId: null,
    retentionsByTeam: {},
    seasonHistory: [],
    lastOutcome: null,
    participants: [
      {
        id: hostId,
        name: hostName,
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
        message: `${body.roomName || league.name} created (${teams.length} teams · ${players.length} mystery players · Browser Local Mode)`,
        actor: hostName,
      },
    ],
    undoStackCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  localRooms.set(code, {
    state,
    undoStack: [],
    recentBidRequestIds: new Set(),
  });
  broadcastLocalRoom(code);

  return {
    room: sanitizeRoomForClient(state),
    hostId,
    serverTimeMs: now,
  };
}

export function getLocalRoom(code: string): { room: AuctionRoomState; serverTimeMs: number } | null {
  hydrateLocalRooms();
  const normalized = code.toUpperCase().trim();
  let internal = localRooms.get(normalized);
  if (!internal) {
    try {
      const roomName = normalized === 'DEMO5' ? 'BidsKaro 5-Team IPL Demo' : `BidsKaro Room ${normalized}`;
      const leagueId: LeagueId = normalized.includes('WPL') ? 'WPL' : 'IPL';
      createLocalRoom({
        roomName,
        leagueId,
        seasonYear: '2025',
        hostName: 'Auction Host',
        roomCode: normalized,
      });
      internal = localRooms.get(normalized);
    } catch {
      // fallback
    }
  }
  if (!internal) return null;
  return {
    room: sanitizeRoomForClient(internal.state),
    serverTimeMs: Date.now(),
  };
}

export function joinLocalRoom(
  code: string,
  params: { participantId: string; name: string; role: 'bidder' | 'spectator' | 'host'; teamId?: string }
): { room: AuctionRoomState; serverTimeMs: number } | null {
  hydrateLocalRooms();
  const normalized = code.toUpperCase().trim();
  const internal = localRooms.get(normalized);
  if (!internal) return null;

  const existingIdx = internal.state.participants.findIndex((p) => p.id === params.participantId);
  const role: Participant['role'] =
    params.role === 'host' || params.participantId === internal.state.hostId
      ? 'host'
      : params.role === 'spectator'
        ? 'spectator'
        : 'bidder';
  const pObj: Participant = {
    id: params.participantId,
    name: params.name.trim().slice(0, 48) || 'Team Owner',
    role,
    teamId:
      params.teamId ||
      (existingIdx >= 0 ? internal.state.participants[existingIdx].teamId : undefined),
    connectedAt: existingIdx >= 0 ? internal.state.participants[existingIdx].connectedAt : Date.now(),
    lastSeenAt: Date.now(),
  };
  if (existingIdx >= 0) {
    internal.state.participants[existingIdx] = pObj;
  } else {
    internal.state.participants.push(pObj);
  }
  broadcastLocalRoom(normalized);
  return { room: sanitizeRoomForClient(internal.state), serverTimeMs: Date.now() };
}

export function leaveLocalRoom(code: string, participantId: string): void {
  hydrateLocalRooms();
  const normalized = code.toUpperCase().trim();
  const internal = localRooms.get(normalized);
  if (!internal) return;
  const idx = internal.state.participants.findIndex((p) => p.id === participantId);
  if (idx >= 0) {
    const [rem] = internal.state.participants.splice(idx, 1);
    addEvent(internal.state, 'participant_left', `${rem?.name || 'Participant'} left the auction.`, rem?.name || 'User');
    broadcastLocalRoom(normalized);
  }
}

export function subscribeLocalRoom(
  code: string,
  participant: { participantId: string; name: string; role: 'host' | 'bidder' | 'spectator'; teamId?: string },
  onMessage: (msg: Record<string, unknown>) => void
): () => void {
  hydrateLocalRooms();
  ensureLocalTicker();
  const normalized = code.toUpperCase().trim();
  if (!subscribers.has(normalized)) {
    subscribers.set(normalized, new Set());
  }
  subscribers.get(normalized)!.add(onMessage);

  const joined = joinLocalRoom(normalized, participant);
  if (joined) {
    onMessage({
      type: 'room_state',
      serverTimeMs: joined.serverTimeMs,
      room: joined.room,
    });
  }

  return () => {
    subscribers.get(normalized)?.delete(onMessage);
  };
}

export function dispatchLocalCommand(
  code: string,
  participantId: string,
  type: string,
  msg: Record<string, unknown> = {},
  onFeedback?: (msg: Record<string, unknown>) => void
): boolean {
  hydrateLocalRooms();
  const normalized = code.toUpperCase().trim();
  const internal = localRooms.get(normalized);
  if (!internal) return false;

  const s = internal.state;
  const actorParticipant = s.participants.find((p) => p.id === participantId);
  const actorName = actorParticipant?.name || s.hostName;
  const isHost =
    participantId === s.hostId ||
    actorParticipant?.role === 'host' ||
    (s.rules.allBiddersCanHost && actorParticipant?.role !== 'spectator') ||
    msg.asHost === true;

  const emitError = (message: string) => onFeedback?.({ type: 'error', message });

  if (type === 'leave_room') {
    leaveLocalRoom(normalized, participantId);
    return true;
  }

  if (type === 'place_bid') {
    const teamId = String(msg.teamId || '');
    const amount = Number(msg.amount);
    const bidType = msg.bidType === 'custom' ? 'custom' : msg.bidType === 'host' ? 'host' : 'quick';
    const expectedSequence = typeof msg.expectedSequence === 'number' ? msg.expectedSequence : undefined;
    const bidRequestId = typeof msg.bidRequestId === 'string' ? msg.bidRequestId : undefined;

    const validation = validateBidSubmission({
      room: s,
      teamId,
      bidderId: participantId,
      amount,
      bidType,
      expectedSequence,
      bidRequestId,
      recentRequestIds: internal.recentBidRequestIds,
      nowMs: Date.now(),
    });

    if (!validation.valid) {
      onFeedback?.({
        type: 'bid_rejected',
        reason: validation.reason,
        nextMinimumBid: validation.nextMinimumBid,
        bidRequestId,
      });
      return false;
    }

    if (bidRequestId) {
      internal.recentBidRequestIds.add(bidRequestId);
    }

    const player = s.players.find((p) => p.id === s.currentPlayerId)!;
    const team = s.teams.find((t) => t.id === teamId)!;
    const bidderName = typeof msg.bidderName === 'string' && msg.bidderName.trim()
      ? msg.bidderName.trim().slice(0, 40)
      : actorParticipant?.name || team.ownerName;

    if (actorParticipant && !actorParticipant.teamId) {
      actorParticipant.teamId = team.id;
    }

    pushUndoSnapshot(internal, `Bid ${formatCurrency(amount, s.rules.currency)} by ${team.name}`);
    s.bidSequence += 1;
    s.currentBid = amount;
    s.highestBidderTeamId = team.id;
    s.highestBidderName = bidderName;

    const bidRecord: BidRecord = {
      id: makeId('bid'),
      sequence: s.bidSequence,
      playerId: player.id,
      playerName: player.name,
      teamId: team.id,
      teamName: team.name,
      teamShortCode: team.shortCode,
      teamColor: team.primaryColor,
      bidderId: participantId,
      bidderName,
      amount,
      bidType,
      timestamp: Date.now(),
    };

    s.currentLotBids.unshift(bidRecord);
    s.allBids.unshift(bidRecord);
    if (s.allBids.length > 300) s.allBids.length = 300;

    const resetSec = s.rules.resetTimerSeconds;
    s.timerDeadlineMs = Date.now() + resetSec * 1000;
    s.timerRemainingAtPause = resetSec * 1000;
    internal.nextAiThinkAtMs = Date.now() + 1600 + randInt(0, 1000);

    addEvent(s, 'bid_accepted', `#${bidRecord.sequence} ${team.name} bid ${formatCurrency(amount, s.rules.currency)} for ${player.name} — Timer reset to ${resetSec}s`, bidderName);
    onFeedback?.({ type: 'bid_accepted', bid: bidRecord });
    broadcastLocalRoom(normalized);
    return true;
  }

  if (type === 'toggle_wishlist') {
    const teamId = String(msg.teamId || '');
    const playerId = String(msg.playerId || '');
    if (!teamId || !playerId) return false;
    const current = s.wishlistByTeam[teamId] || [];
    s.wishlistByTeam[teamId] = current.includes(playerId)
      ? current.filter((id) => id !== playerId)
      : [...current, playerId];
    broadcastLocalRoom(normalized);
    return true;
  }

  if (type === 'snake_draft_pick') {
    if (s.rules.buildingMode !== 'snake_draft') {
      emitError('Room is not in Snake Draft mode.');
      return false;
    }
    const turnTeamId = getCurrentSnakeTurnTeamId(s);
    const requestedTeamId = String(msg.teamId || turnTeamId || '');
    if (!isHost && requestedTeamId !== turnTeamId) {
      emitError('Wait for your snake draft turn.');
      return false;
    }
    const team = s.teams.find((t) => t.id === (turnTeamId || requestedTeamId));
    const playerId = String(msg.playerId || s.currentPlayerId || '');
    const player = s.players.find((p) => p.id === playerId && p.status !== 'sold');
    if (!team || !player) {
      emitError('Player or team unavailable for Snake Draft pick.');
      return false;
    }
    if (team.squad.length >= s.rules.maxSquadSize || team.remainingPurse < player.basePrice) {
      emitError('Squad full or insufficient purse.');
      return false;
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
    s.allBids.unshift({
      id: makeId('bid'),
      sequence: s.bidSequence,
      playerId: player.id,
      playerName: player.name,
      teamId: team.id,
      teamName: team.name,
      teamShortCode: team.shortCode,
      teamColor: team.primaryColor,
      bidderId: participantId,
      bidderName: team.ownerName,
      amount: player.basePrice,
      bidType: 'snake',
      timestamp: Date.now(),
    });
    s.snakeDraftPickIndex += 1;
    s.snakeDraftRound = Math.floor(s.snakeDraftPickIndex / Math.max(1, s.teams.length)) + 1;
    s.currentPlayerId = s.players.find((p) => p.status === 'upcoming')?.id ?? null;
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
    addEvent(s, 'sold', `SNAKE DRAFT R${s.snakeDraftRound}: ${team.name} drafted ${player.name}`, team.ownerName);
    broadcastLocalRoom(normalized);
    return true;
  }

  if (type === 'set_lineup') {
    const team = s.teams.find((t) => t.id === String(msg.teamId || ''));
    if (!team) return false;
    const maxXI = Math.min(s.rules.playingXISize || 11, 11);
    const xi = Array.isArray(msg.startingXI)
      ? msg.startingXI.filter((id): id is string => typeof id === 'string' && team.squad.includes(id))
      : team.startingXI;
    team.startingXI = xi.slice(0, maxXI);
    if (typeof msg.captainId === 'string' && team.squad.includes(msg.captainId)) team.captainId = msg.captainId;
    if (typeof msg.viceCaptainId === 'string' && team.squad.includes(msg.viceCaptainId)) team.viceCaptainId = msg.viceCaptainId;
    addEvent(s, 'fantasy', `${team.name} updated Final Playing ${maxXI} (${team.startingXI.length}/${maxXI})`, team.ownerName);
    broadcastLocalRoom(normalized);
    return true;
  }

  if (type === 'claim_waiver') {
    const team = s.teams.find((t) => t.id === String(msg.teamId || ''));
    const player = s.players.find((p) => p.id === String(msg.playerId || '') && (p.status === 'unsold' || p.status === 'upcoming'));
    if (!team || !player) {
      emitError('Free agent not available for waiver claim.');
      return false;
    }
    if (team.squad.length >= s.rules.maxSquadSize || team.remainingPurse < player.basePrice) {
      emitError('Squad full or insufficient purse.');
      return false;
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
    addEvent(s, 'fantasy', `WAIVER CLAIM: ${team.name} signed ${player.name}`, team.ownerName);
    broadcastLocalRoom(normalized);
    return true;
  }

  if (type === 'play_virtual_match') {
    simulateSeasonLeagueRounds(s, 1, actorName);
    broadcastLocalRoom(normalized);
    return true;
  }

  if (type === 'list_trade_bin') {
    const team = s.teams.find((t) => t.id === String(msg.teamId || ''));
    const player = s.players.find((p) => p.id === String(msg.playerId || '') && team?.squad.includes(p.id));
    if (!team || !player) {
      emitError('Select a valid player from your squad to list in the Trade Bin.');
      return false;
    }
    if (s.tradeBin.some((tb) => tb.playerId === player.id)) {
      emitError(`${player.name} is already listed in the Trade Bin.`);
      return false;
    }
    const askingPrice = Number(msg.askingPrice) > 0 ? Number(msg.askingPrice) : (player.soldPrice || player.basePrice);
    const listing: TradeBinListing = {
      id: makeId('tb'),
      playerId: player.id,
      teamId: team.id,
      askingPrice,
      note: typeof msg.note === 'string' ? msg.note.trim().slice(0, 80) : undefined,
      createdAt: Date.now(),
    };
    s.tradeBin.unshift(listing);
    addEvent(s, 'fantasy', `TRADE BIN: ${team.name} listed ${player.name} for ${formatCurrency(askingPrice, s.rules.currency)}`, actorName);
    broadcastLocalRoom(normalized);
    return true;
  }

  if (type === 'remove_trade_bin') {
    s.tradeBin = s.tradeBin.filter((tb) => tb.id !== String(msg.listingId || ''));
    broadcastLocalRoom(normalized);
    return true;
  }

  if (type === 'accept_trade_bin') {
    const listing = s.tradeBin.find((tb) => tb.id === String(msg.listingId || ''));
    if (!listing) return false;
    const sellerTeam = s.teams.find((t) => t.id === listing.teamId);
    const buyerTeam = s.teams.find((t) => t.id === String(msg.buyerTeamId || ''));
    const targetPlayer = s.players.find((p) => p.id === listing.playerId);
    const swapPlayer = typeof msg.swapPlayerId === 'string' && msg.swapPlayerId ? s.players.find((p) => p.id === msg.swapPlayerId) : undefined;
    if (!sellerTeam || !buyerTeam || sellerTeam.id === buyerTeam.id || !targetPlayer || !sellerTeam.squad.includes(targetPlayer.id)) {
      emitError('Invalid Trade Bin transfer.');
      return false;
    }
    const netCash = swapPlayer ? Math.max(0, listing.askingPrice - (swapPlayer.soldPrice || swapPlayer.basePrice)) : listing.askingPrice;
    if (buyerTeam.remainingPurse < netCash || (!swapPlayer && buyerTeam.squad.length >= s.rules.maxSquadSize)) {
      emitError('Insufficient purse or squad full.');
      return false;
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
    addEvent(s, 'fantasy', `TRADE BIN DEAL: ${buyerTeam.name} acquired ${targetPlayer.name}`, actorName);
    broadcastLocalRoom(normalized);
    return true;
  }

  if (type === 'set_team_retentions') {
    const team = s.teams.find((t) => t.id === String(msg.teamId || ''));
    if (!team) return false;
    const limit = getTeamRetentionLimit(s, team.id);
    const ids = Array.isArray(msg.playerIds)
      ? msg.playerIds.filter((id): id is string => typeof id === 'string' && team.squad.includes(id)).slice(0, limit)
      : [];
    s.retentionsByTeam[team.id] = ids;
    broadcastLocalRoom(normalized);
    return true;
  }

  if (!isHost) {
    emitError('Only a host or bidder can perform this control.');
    return false;
  }

  switch (type) {
    case 'start_auction': {
      s.status = 'live';
      s.rules.rulesLocked = true;
      if (s.rules.maxAuctionDurationMinutes > 0 && s.auctionEndDeadlineMs === 0) {
        s.auctionEndDeadlineMs = Date.now() + s.rules.maxAuctionDurationMinutes * 60_000;
      }
      const res = startLotForPlayer(internal, typeof msg.playerId === 'string' ? msg.playerId : s.currentPlayerId, actorName);
      if (!res.ok) {
        emitError(res.error || 'Could not start auction.');
        return false;
      }
      broadcastLocalRoom(normalized);
      return true;
    }
    case 'start_lot': {
      const res = startLotForPlayer(internal, typeof msg.playerId === 'string' ? msg.playerId : null, actorName);
      if (!res.ok) {
        emitError(res.error || 'Could not start lot.');
        return false;
      }
      broadcastLocalRoom(normalized);
      return true;
    }
    case 'pause_timer': {
      if (s.lotStatus === 'bidding') {
        s.timerRemainingAtPause = Math.max(1000, s.timerDeadlineMs - Date.now());
        s.lotStatus = 'paused';
        addEvent(s, 'timer_control', `Timer paused at ${Math.ceil(s.timerRemainingAtPause / 1000)}s`, actorName);
        broadcastLocalRoom(normalized);
      }
      return true;
    }
    case 'resume_timer': {
      if (s.lotStatus === 'paused') {
        const rem = Math.max(2000, s.timerRemainingAtPause || s.rules.initialTimerSeconds * 1000);
        s.timerDeadlineMs = Date.now() + rem;
        s.lotStatus = 'bidding';
        addEvent(s, 'timer_control', `Timer resumed (${Math.ceil(rem / 1000)}s remaining)`, actorName);
        broadcastLocalRoom(normalized);
      }
      return true;
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
      broadcastLocalRoom(normalized);
      return true;
    }
    case 'reset_timer': {
      const resetSec = Number(msg.seconds) || s.rules.resetTimerSeconds;
      if (s.lotStatus === 'bidding' || s.lotStatus === 'paused' || s.lotStatus === 'awaiting_hammer') {
        s.lotStatus = 'bidding';
        s.timerDeadlineMs = Date.now() + resetSec * 1000;
        s.timerRemainingAtPause = resetSec * 1000;
        broadcastLocalRoom(normalized);
      }
      return true;
    }
    case 'close_bidding_manual': {
      if (s.lotStatus === 'bidding' || s.lotStatus === 'paused') {
        s.lotStatus = 'awaiting_hammer';
        s.timerDeadlineMs = 0;
        broadcastLocalRoom(normalized);
      }
      return true;
    }
    case 'mark_sold': {
      const res = resolveHammerSold(internal, actorName);
      if (!res.ok) {
        emitError(res.error || 'Could not mark sold.');
        return false;
      }
      broadcastLocalRoom(normalized);
      return true;
    }
    case 'mark_unsold': {
      const res = resolveHammerUnsold(internal, actorName);
      if (!res.ok) {
        emitError(res.error || 'Could not mark unsold.');
        return false;
      }
      broadcastLocalRoom(normalized);
      return true;
    }
    case 'undo_last_action': {
      const snap = internal.undoStack.pop();
      if (!snap) {
        emitError('Nothing to undo.');
        return false;
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
      broadcastLocalRoom(normalized);
      return true;
    }
    case 'verbal_sell': {
      const team = s.teams.find((t) => t.id === String(msg.teamId || ''));
      const player = s.players.find((p) => p.id === (typeof msg.playerId === 'string' ? msg.playerId : s.currentPlayerId));
      const amount = Number(msg.amount);
      if (!team || !player || !Number.isFinite(amount) || amount < player.basePrice || amount > team.remainingPurse || team.squad.length >= s.rules.maxSquadSize) {
        emitError('Invalid verbal sale parameters.');
        return false;
      }
      pushUndoSnapshot(internal, `Verbal Sale: ${player.name} to ${team.name}`);
      s.status = 'live';
      s.bidSequence += 1;
      s.currentBid = amount;
      s.highestBidderTeamId = team.id;
      s.highestBidderName = `${team.ownerName} (Verbal)`;
      const rec: BidRecord = {
        id: makeId('bid'),
        sequence: s.bidSequence,
        playerId: player.id,
        playerName: player.name,
        teamId: team.id,
        teamName: team.name,
        teamShortCode: team.shortCode,
        teamColor: team.primaryColor,
        bidderId: participantId,
        bidderName: `${team.ownerName} (Verbal Table)`,
        amount,
        bidType: 'verbal',
        timestamp: Date.now(),
      };
      s.currentLotBids.unshift(rec);
      s.allBids.unshift(rec);
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
      addEvent(s, 'sold', `VERBAL SOLD: ${player.name} assigned to ${team.name}`, actorName);
      broadcastLocalRoom(normalized);
      return true;
    }
    case 'nominate_reauction': {
      const player = s.players.find((p) => p.id === String(msg.playerId || '') && p.status === 'unsold');
      if (!player) return false;
      player.basePrice = Math.max(10 * LAKH, Math.round((player.basePrice * 0.5) / (5 * LAKH)) * (5 * LAKH));
      player.status = 'upcoming';
      if (msg.startImmediately) startLotForPlayer(internal, player.id, actorName);
      broadcastLocalRoom(normalized);
      return true;
    }
    case 'execute_trade': {
      const teamA = s.teams.find((t) => t.id === String(msg.fromTeamId || ''));
      const teamB = s.teams.find((t) => t.id === String(msg.toTeamId || ''));
      const pA = s.players.find((p) => p.id === String(msg.givePlayerId || ''));
      const pB = typeof msg.receivePlayerId === 'string' && msg.receivePlayerId ? s.players.find((p) => p.id === msg.receivePlayerId) : undefined;
      const cashAdjustment = Number(msg.cashAdjustment || 0);
      if (!teamA || !teamB || teamA.id === teamB.id || !pA || !teamA.squad.includes(pA.id)) return false;
      if (pB && !teamB.squad.includes(pB.id)) return false;
      if (teamB.remainingPurse - cashAdjustment < 0 || teamA.remainingPurse + cashAdjustment < 0) return false;
      pushUndoSnapshot(internal, `Trade ${pA.name}`);
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
      broadcastLocalRoom(normalized);
      return true;
    }
    case 'simulate_matchweek': {
      s.matchweekNumber += 1;
      const playersById = new Map(s.players.map((p) => [p.id, p]));
      for (const p of s.players) {
        if (p.status === 'sold') {
          p.fantasyPoints = (p.fantasyPoints || 0) + Math.max(8, Math.round((p.rating || 80) * 0.45) + randInt(-8, 28));
        }
      }
      for (const team of s.teams) {
        const xi = team.startingXI.length > 0 ? team.startingXI : team.squad.slice(0, 11);
        let total = 0;
        for (const pid of xi) {
          const plr = playersById.get(pid);
          if (!plr) continue;
          const mult = pid === team.captainId ? 2 : pid === team.viceCaptainId ? 1.5 : 1;
          total += Math.round((plr.fantasyPoints || 0) * mult);
        }
        team.fantasyPoints = total;
      }
      broadcastLocalRoom(normalized);
      return true;
    }
    case 'simulate_season_round': {
      const roundsArg = msg.rounds === 'all' ? 'all' : Math.max(1, Number(msg.rounds) || 1);
      simulateSeasonLeagueRounds(s, roundsArg, actorName);
      broadcastLocalRoom(normalized);
      return true;
    }
    case 'simulate_playoffs': {
      const res = simulateSeasonPlayoffsAndCrown(s, actorName);
      if (!res.ok) {
        emitError(res.error || 'Could not simulate playoffs.');
        return false;
      }
      broadcastLocalRoom(normalized);
      return true;
    }
    case 'start_next_season': {
      startNextSeasonAuction(internal, actorName);
      broadcastLocalRoom(normalized);
      return true;
    }
    case 'update_rules': {
      const nextRules = msg.rules as Partial<AuctionRules>;
      if (!nextRules) return false;
      if (s.rules.rulesLocked && !s.rules.hostCanEditRulesLive) {
        emitError('Rules are locked after auction start.');
        return false;
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
      if (s.status === 'lobby' && (nextMax !== prevMax || s.rules.defaultTeamPurse !== prevPurse)) {
        s.players = buildPlayersForLeague(s.leagueId, s.teams.length, nextMax, s.rules.defaultTeamPurse, s.rules.minBidFloor);
        s.currentPlayerId = s.players[0]?.id ?? null;
      }
      broadcastLocalRoom(normalized);
      return true;
    }
    case 'update_team': {
      const patch = msg.patch as Partial<Team>;
      const team = s.teams.find((t) => t.id === String(msg.teamId || ''));
      if (!team || !patch) return false;
      if (typeof patch.name === 'string' && patch.name.trim()) team.name = patch.name.trim().slice(0, 48);
      if (typeof patch.shortCode === 'string' && patch.shortCode.trim()) team.shortCode = patch.shortCode.trim().slice(0, 5).toUpperCase();
      if (typeof patch.ownerName === 'string' && patch.ownerName.trim()) team.ownerName = patch.ownerName.trim().slice(0, 48);
      if (typeof patch.isLocked === 'boolean') team.isLocked = patch.isLocked;
      if (typeof patch.initialPurse === 'number' && patch.initialPurse >= team.amountSpent) {
        team.initialPurse = Math.min(patch.initialPurse, s.rules.maxTeamPurse);
        team.remainingPurse = team.initialPurse - team.amountSpent;
      }
      broadcastLocalRoom(normalized);
      return true;
    }
    case 'add_custom_player': {
      const p = msg.player as Partial<AuctionPlayer>;
      if (!p || !p.name || typeof p.name !== 'string') return false;
      s.players.unshift({
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
      });
      broadcastLocalRoom(normalized);
      return true;
    }
    case 'toggle_big_screen_publish': {
      s.bigScreenPublished = !s.bigScreenPublished;
      broadcastLocalRoom(normalized);
      return true;
    }
    case 'complete_auction': {
      autoCompleteRoomTeamsAndFinish(internal, `Completed by ${actorName}`);
      broadcastLocalRoom(normalized);
      return true;
    }
    default:
      return false;
  }
}
