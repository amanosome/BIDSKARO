import React, { useState } from 'react';
import { X } from 'lucide-react';
import { BiddingStyle, BuildingMode, CurrencyCode, LeagueId, PlayMode, RoleQuotas, StackMode } from '../shared/auctionTypes';
import { CRORE, LAKH } from '../shared/currency';
import { computeDefaultRoleQuotas, computeScaledBasePrice } from '../shared/rulesEngine';
import { DEMO_FIVE_TEAMS, getLeagueById, LEAGUES } from '../data/leagues';
import { createLocalRoom } from '../services/localAuctionEngine';

interface CreateRoomModalProps {
  initialLeagueId?: LeagueId;
  initialSeasonYear?: string;
  initialPlayMode?: PlayMode;
  defaultHostName?: string;
  onClose: () => void;
  onCreated: (roomCode: string, hostId: string, hostName: string) => void;
}

export const CreateRoomModal: React.FC<CreateRoomModalProps> = ({
  initialLeagueId = 'IPL',
  initialSeasonYear = '2025',
  initialPlayMode = 'ai',
  defaultHostName = 'Auction Host',
  onClose,
  onCreated,
}) => {
  const [leagueId, setLeagueId] = useState<LeagueId>(initialLeagueId);
  const league = getLeagueById(leagueId);
  const [seasonYear, setSeasonYear] = useState<string>(
    league.seasons.find((s) => s.year === initialSeasonYear)?.year || league.seasons[0]?.year || '2025'
  );
  const [roomName, setRoomName] = useState<string>(
    leagueId === 'CUSTOM' ? 'BidsKaro Premier Auction' : `${league.shortName} ${seasonYear} Auction`
  );
  const [hostName, setHostName] = useState<string>(defaultHostName);
  const [currency, setCurrency] = useState<CurrencyCode>('INR');
  const [buildingMode, setBuildingMode] = useState<BuildingMode>('auction');
  const [biddingStyle, setBiddingStyle] = useState<BiddingStyle>('in_app');
  const [playMode, setPlayMode] = useState<PlayMode>(initialPlayMode);
  const [stackMode, setStackMode] = useState<StackMode>('lifetime');
  const [matchesPerTeamPerSeason, setMatchesPerTeamPerSeason] = useState<number>(14);
  const [purseCrores, setPurseCrores] = useState<number>(200);
  const [initialTimer, setInitialTimer] = useState<5 | 10 | 15 | 20>(10);
  const [resetTimer, setResetTimer] = useState<number>(15);
  const [maxDurationMinutes, setMaxDurationMinutes] = useState<number>(20);
  const [tournamentMode, setTournamentMode] = useState<'full_season' | 'single_match'>('full_season');
  const [marqueeMarkupPercent, setMarqueeMarkupPercent] = useState<number>(10);
  const [catIncMarquee, setCatIncMarquee] = useState<number>(0);
  const [catIncCappedBatter, setCatIncCappedBatter] = useState<number>(0);
  const [catIncCappedBowler, setCatIncCappedBowler] = useState<number>(0);
  const [catIncCappedAllRounder, setCatIncCappedAllRounder] = useState<number>(0);
  const [catIncWicketkeeper, setCatIncWicketkeeper] = useState<number>(0);
  const [catIncUncapped, setCatIncUncapped] = useState<number>(0);
  const [minIncrementLakhs, setMinIncrementLakhs] = useState<number>(10);
  const [minSquad, setMinSquad] = useState<number>(11);
  const [maxSquad, setMaxSquad] = useState<number>(18);
  const [roleQuotas, setRoleQuotas] = useState<RoleQuotas>(() => computeDefaultRoleQuotas(11));
  const [aiOpponentsEnabled, setAiOpponentsEnabled] = useState<boolean>(initialPlayMode === 'ai');
  const [allBiddersCanHost, setAllBiddersCanHost] = useState<boolean>(true);
  const [allowCustomBid, setAllowCustomBid] = useState<boolean>(true);
  const [allowQuickBid, setAllowQuickBid] = useState<boolean>(true);
  const buildTeamsForMode = (
    targetLeagueId: LeagueId,
    targetPlayMode: PlayMode,
    targetPurseCrores: number,
    targetHostName: string
  ) => {
    const targetLeague = getLeagueById(targetLeagueId);
    const fullPresets =
      targetLeagueId === 'CUSTOM'
        ? DEMO_FIVE_TEAMS
        : targetLeague.franchises.slice(0, targetLeagueId === 'IPL' ? 10 : 5);
    const selectedPresets = targetPlayMode === 'ai' ? fullPresets.slice(0, 2) : fullPresets;
    return selectedPresets.map((t, idx) => ({
      name: t.name,
      shortCode: t.shortCode,
      primaryColor: t.primaryColor,
      secondaryColor: t.secondaryColor,
      ownerName:
        targetPlayMode === 'ai'
          ? idx === 0
            ? targetHostName.trim() || 'You'
            : 'AI Opponent'
          : t.defaultOwner,
      purseCrores: targetPurseCrores,
    }));
  };

  const [teams, setTeams] = useState(() =>
    buildTeamsForMode(leagueId, initialPlayMode, 200, defaultHostName)
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLeagueChange = (nextId: LeagueId) => {
    setLeagueId(nextId);
    const nextLeague = getLeagueById(nextId);
    const nextYear = nextLeague.seasons[0]?.year || '2025';
    setSeasonYear(nextYear);
    setRoomName(nextId === 'CUSTOM' ? 'BidsKaro Premier Auction' : `${nextLeague.shortName} ${nextYear} Auction`);
    setTeams(buildTeamsForMode(nextId, playMode, purseCrores, hostName));
  };

  const handleMinSquadChange = (val: number) => {
    const clampedMin = Math.max(5, Math.min(18, val));
    setMinSquad(clampedMin);
    if (maxSquad < clampedMin) setMaxSquad(clampedMin);
    setRoleQuotas(computeDefaultRoleQuotas(clampedMin));
  };

  const handleMaxSquadChange = (val: number) => {
    const clampedMax = Math.max(minSquad, Math.min(18, val));
    setMaxSquad(clampedMax);
  };

  const totalPoolSize = teams.length * maxSquad + maxSquad;
  const extrasCount = Math.max(0, maxSquad - Math.min(11, minSquad));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const hostId = `host-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const payload = {
      roomName,
      leagueId,
      seasonYear,
      hostId,
      hostName,
      rules: {
        currency,
        buildingMode,
        biddingStyle,
        playMode,
        stackMode,
        matchesPerTeamPerSeason,
        standardRetentionLimit: 4,
        runnerUpRetentionLimit: 5,
        championRetentionLimit: 6,
        defaultTeamPurse: purseCrores * CRORE,
        maxTeamPurse: Math.max(200, purseCrores) * CRORE,
        initialTimerSeconds: initialTimer,
        resetTimerSeconds: resetTimer,
        maxAuctionDurationMinutes: maxDurationMinutes,
        minSquadSize: minSquad,
        maxSquadSize: maxSquad,
        playingXISize: Math.min(11, minSquad),
        roleQuotas,
        aiOpponentsEnabled: playMode === 'ai' ? aiOpponentsEnabled : false,
        allBiddersCanHost,
        hostCanBid: true,
        allowCustomBid,
        allowQuickBid,
        tournamentMode,
        marqueeMarkupPercent,
        categoryOverrides: [
          { category: 'Marquee' as const, minIncrement: catIncMarquee * LAKH },
          { category: 'Capped Batter' as const, minIncrement: catIncCappedBatter * LAKH },
          { category: 'Capped Bowler' as const, minIncrement: catIncCappedBowler * LAKH },
          { category: 'Capped All-Rounder' as const, minIncrement: catIncCappedAllRounder * LAKH },
          { category: 'Wicketkeeper' as const, minIncrement: catIncWicketkeeper * LAKH },
          { category: 'Uncapped' as const, minIncrement: catIncUncapped * LAKH },
        ].filter((c) => c.minIncrement > 0),
        incrementTable: [
          { id: 'tier-1', minBid: 0, maxBid: 50 * LAKH, increment: minIncrementLakhs * LAKH },
          { id: 'tier-2', minBid: 50 * LAKH, maxBid: 1 * CRORE, increment: minIncrementLakhs * LAKH },
          { id: 'tier-3', minBid: 1 * CRORE, maxBid: 5 * CRORE, increment: 25 * LAKH },
          { id: 'tier-4', minBid: 5 * CRORE, maxBid: 10 * CRORE, increment: 50 * LAKH },
          { id: 'tier-5', minBid: 10 * CRORE, maxBid: null, increment: 1 * CRORE },
        ],
      },
      teams: teams.map((t, idx) => ({
        id: `team-${idx + 1}`,
        name: t.name,
        shortCode: t.shortCode,
        primaryColor: t.primaryColor,
        secondaryColor: t.secondaryColor,
        ownerName: t.ownerName,
        initialPurse: t.purseCrores * CRORE,
      })),
    };

    try {
      let createdCode: string | null = null;
      try {
        const res = await fetch('/api/rooms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const ct = res.headers.get('content-type') || '';
        if (res.ok && ct.includes('application/json')) {
          const data = await res.json();
          createdCode = data.room.roomCode;
        } else if (res.status >= 400 && res.status !== 404 && res.status !== 405 && res.status !== 501 && ct.includes('application/json')) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || 'Could not create room.');
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

      if (!createdCode) {
        const localRes = createLocalRoom(payload);
        createdCode = localRes.room.roomCode;
      }
      onCreated(createdCode, hostId, hostName);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create auction room.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm overflow-y-auto">
      <div className="w-full max-w-3xl rounded-2xl border border-slate-800 bg-[#0D1526] shadow-2xl my-8">
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <div>
            <h2 className="text-xl font-display font-bold text-white">Create Custom Auction Room</h2>
            <p className="text-xs text-slate-400">
              Players stay mystery-hidden until start · Pool size: <strong className="text-emerald-400 font-mono-tabular">{teams.length} × {maxSquad} + {maxSquad} = {totalPoolSize} Players</strong>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5 max-h-[80vh] overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">League Preset</label>
              <select
                value={leagueId}
                onChange={(e) => handleLeagueChange(e.target.value as LeagueId)}
                className="w-full rounded-lg border border-slate-700 bg-[#060B18] px-3 py-2.5 text-sm text-white"
              >
                {LEAGUES.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} ({l.shortName})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Season Year</label>
              <select
                value={seasonYear}
                onChange={(e) => setSeasonYear(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-[#060B18] px-3 py-2.5 text-sm text-white"
              >
                {league.seasons.map((s) => (
                  <option key={s.year} value={s.year}>
                    {s.year} — {s.auctionType}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Room Title</label>
              <input
                type="text"
                required
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-[#060B18] px-3 py-2.5 text-sm text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Host / Auctioneer Name</label>
              <input
                type="text"
                required
                value={hostName}
                onChange={(e) => setHostName(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-[#060B18] px-3 py-2.5 text-sm text-white"
              />
            </div>
          </div>

          {/* Play Mode (Friends Invite Code vs AI) & Stack Scope (Lifetime vs Season-Only) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-slate-800 pt-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Play With Friends or AI</label>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { id: 'friends', label: 'Play with Friends', desc: 'Share invite code / QR' },
                  { id: 'ai', label: 'Play with AI', desc: '2 Teams: You vs 1 AI' },
                ] as const).map((pm) => (
                  <button
                    key={pm.id}
                    type="button"
                    onClick={() => {
                      setPlayMode(pm.id);
                      setAiOpponentsEnabled(pm.id === 'ai');
                      setTeams(buildTeamsForMode(leagueId, pm.id, purseCrores, hostName));
                    }}
                    className={`rounded-lg border p-2.5 text-left transition-colors ${
                      playMode === pm.id
                        ? 'border-emerald-500 bg-emerald-500/15 text-emerald-300'
                        : 'border-slate-700 bg-[#060B18] text-slate-300'
                    }`}
                  >
                    <div className="text-xs font-bold">{pm.label}</div>
                    <div className="text-[10px] text-slate-400">{pm.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">League Stack Mode</label>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { id: 'lifetime', label: 'Lifetime Stacks', desc: 'Keep 4 / 5 / 6 per year' },
                  { id: 'season_only', label: 'Season-Only', desc: 'Fresh reset each season' },
                ] as const).map((sm) => (
                  <button
                    key={sm.id}
                    type="button"
                    onClick={() => setStackMode(sm.id)}
                    className={`rounded-lg border p-2.5 text-left transition-colors ${
                      stackMode === sm.id
                        ? 'border-amber-400 bg-amber-500/15 text-amber-300'
                        : 'border-slate-700 bg-[#060B18] text-slate-300'
                    }`}
                  >
                    <div className="text-xs font-bold">{sm.label}</div>
                    <div className="text-[10px] text-slate-400">{sm.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Squad-Building Format & Bidding Style */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-slate-800 pt-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Squad-Building Mode</label>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { id: 'auction', label: 'Live Auction', desc: 'Timer & bidding war' },
                  { id: 'snake_draft', label: 'Snake Draft', desc: '1→N · N→1 turn picks' },
                ] as const).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setBuildingMode(m.id)}
                    className={`rounded-lg border p-2.5 text-left transition-colors ${
                      buildingMode === m.id
                        ? 'border-emerald-500 bg-emerald-500/15 text-emerald-300'
                        : 'border-slate-700 bg-[#060B18] text-slate-300'
                    }`}
                  >
                    <div className="text-xs font-bold">{m.label}</div>
                    <div className="text-[10px] text-slate-400">{m.desc}</div>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Bidding Style</label>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { id: 'in_app', label: 'In-App Mobile', desc: 'Owners bid on phones' },
                  { id: 'verbal', label: 'Verbal / Table', desc: 'Host logs room bids' },
                ] as const).map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setBiddingStyle(s.id)}
                    className={`rounded-lg border p-2.5 text-left transition-colors ${
                      biddingStyle === s.id
                        ? 'border-amber-400 bg-amber-500/15 text-amber-300'
                        : 'border-slate-700 bg-[#060B18] text-slate-300'
                    }`}
                  >
                    <div className="text-xs font-bold">{s.label}</div>
                    <div className="text-[10px] text-slate-400">{s.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Tournament Mode & Marquee Markup */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-slate-800 pt-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Tournament Completion Mode</label>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { id: 'full_season', label: 'Full Season', desc: '14 matches, Playoffs & Champions' },
                  { id: 'single_match', label: 'Play 1 Match', desc: 'Single exhibition match mode' },
                ] as const).map((tm) => (
                  <button
                    key={tm.id}
                    type="button"
                    onClick={() => setTournamentMode(tm.id)}
                    className={`rounded-lg border p-2.5 text-left transition-colors ${
                      tournamentMode === tm.id
                        ? 'border-emerald-500 bg-emerald-500/15 text-emerald-300'
                        : 'border-slate-700 bg-[#060B18] text-slate-300'
                    }`}
                  >
                    <div className="text-xs font-bold">{tm.label}</div>
                    <div className="text-[10px] text-slate-400">{tm.desc}</div>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Marquee Markup % (Min 10% Above 2nd)</label>
              <div className="flex items-center gap-2 bg-[#060B18] border border-slate-700 rounded-lg p-2">
                <input
                  type="number"
                  min={5}
                  max={100}
                  value={marqueeMarkupPercent}
                  onChange={(e) => setMarqueeMarkupPercent(Math.max(5, Number(e.target.value) || 10))}
                  className="w-20 rounded border border-slate-700 bg-[#0D1526] px-2 py-1.5 text-xs font-mono-tabular text-amber-300 text-center"
                />
                <span className="text-xs text-slate-300">% above highest non-marquee player price</span>
              </div>
            </div>
          </div>

          {/* Category Minimum Increment Overrides (Lakhs, 0 = standard) */}
          <div className="rounded-xl border border-slate-800 bg-[#060B18] p-4 space-y-3">
            <div className="text-xs font-bold text-white">Category Minimum Increment Overrides (Lakhs, 0 = standard table)</div>
            <div className="grid grid-cols-2 sm:grid-cols-6 gap-2.5">
              <div>
                <label className="block text-[10px] text-slate-400 mb-1">Marquee (L)</label>
                <input
                  type="number"
                  min={0}
                  max={500}
                  value={catIncMarquee}
                  onChange={(e) => setCatIncMarquee(Math.max(0, Number(e.target.value) || 0))}
                  className="w-full rounded-lg border border-slate-700 bg-[#0D1526] px-2.5 py-1.5 text-xs font-mono-tabular text-amber-300"
                />
              </div>
              <div>
                <label className="block text-[10px] text-slate-400 mb-1">Capped Bat (L)</label>
                <input
                  type="number"
                  min={0}
                  max={500}
                  value={catIncCappedBatter}
                  onChange={(e) => setCatIncCappedBatter(Math.max(0, Number(e.target.value) || 0))}
                  className="w-full rounded-lg border border-slate-700 bg-[#0D1526] px-2.5 py-1.5 text-xs font-mono-tabular text-emerald-300"
                />
              </div>
              <div>
                <label className="block text-[10px] text-slate-400 mb-1">Capped Bowl (L)</label>
                <input
                  type="number"
                  min={0}
                  max={500}
                  value={catIncCappedBowler}
                  onChange={(e) => setCatIncCappedBowler(Math.max(0, Number(e.target.value) || 0))}
                  className="w-full rounded-lg border border-slate-700 bg-[#0D1526] px-2.5 py-1.5 text-xs font-mono-tabular text-emerald-300"
                />
              </div>
              <div>
                <label className="block text-[10px] text-slate-400 mb-1">Capped AR (L)</label>
                <input
                  type="number"
                  min={0}
                  max={500}
                  value={catIncCappedAllRounder}
                  onChange={(e) => setCatIncCappedAllRounder(Math.max(0, Number(e.target.value) || 0))}
                  className="w-full rounded-lg border border-slate-700 bg-[#0D1526] px-2.5 py-1.5 text-xs font-mono-tabular text-emerald-300"
                />
              </div>
              <div>
                <label className="block text-[10px] text-slate-400 mb-1">Wicketkeeper (L)</label>
                <input
                  type="number"
                  min={0}
                  max={500}
                  value={catIncWicketkeeper}
                  onChange={(e) => setCatIncWicketkeeper(Math.max(0, Number(e.target.value) || 0))}
                  className="w-full rounded-lg border border-slate-700 bg-[#0D1526] px-2.5 py-1.5 text-xs font-mono-tabular text-emerald-300"
                />
              </div>
              <div>
                <label className="block text-[10px] text-slate-400 mb-1">Uncapped (L)</label>
                <input
                  type="number"
                  min={0}
                  max={500}
                  value={catIncUncapped}
                  onChange={(e) => setCatIncUncapped(Math.max(0, Number(e.target.value) || 0))}
                  className="w-full rounded-lg border border-slate-700 bg-[#0D1526] px-2.5 py-1.5 text-xs font-mono-tabular text-emerald-300"
                />
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-slate-800 bg-[#060B18] px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-3 text-[11px]">
            <div className="text-slate-300">
              Yearly Season Format: <strong className="text-white">{matchesPerTeamPerSeason} matches/team</strong> → Top 4 Semi-Finals → Final · Retain{' '}
              <strong className="text-emerald-400">4 Std / 5 Runner-Up / 6 Winner</strong>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-slate-400">Matches/Season:</span>
              <input
                type="number"
                min={4}
                max={28}
                value={matchesPerTeamPerSeason}
                onChange={(e) => setMatchesPerTeamPerSeason(Math.max(4, Math.min(28, Number(e.target.value) || 14)))}
                className="w-14 rounded border border-slate-700 bg-[#0D1526] px-2 py-1 text-center font-mono-tabular text-emerald-300"
              />
              <span className="text-amber-300 font-mono-tabular">
                Marquee Base: ₹{Math.round(computeScaledBasePrice(2 * CRORE, purseCrores * CRORE) / LAKH)}L
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 border-t border-slate-800 pt-4">
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">Currency</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
                className="w-full rounded-lg border border-slate-700 bg-[#060B18] px-2.5 py-2 text-xs text-white"
              >
                <option value="INR">INR (₹)</option>
                <option value="USD">USD ($)</option>
                <option value="GBP">GBP (£)</option>
                <option value="AUD">AUD (A$)</option>
                <option value="AED">AED</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">Purse (Crores)</label>
              <input
                type="number"
                min={10}
                max={1000}
                value={purseCrores}
                onChange={(e) => {
                  const val = Math.max(10, Number(e.target.value) || 200);
                  setPurseCrores(val);
                  setTeams((prev) => prev.map((t) => ({ ...t, purseCrores: val })));
                }}
                className="w-full rounded-lg border border-slate-700 bg-[#060B18] px-2.5 py-2 text-xs font-mono-tabular text-white"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">Min Inc (Lakhs)</label>
              <input
                type="number"
                min={5}
                max={100}
                value={minIncrementLakhs}
                onChange={(e) => setMinIncrementLakhs(Math.max(5, Number(e.target.value) || 10))}
                className="w-full rounded-lg border border-slate-700 bg-[#060B18] px-2.5 py-2 text-xs font-mono-tabular text-white"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">Reset (Sec)</label>
              <input
                type="number"
                min={5}
                max={60}
                value={resetTimer}
                onChange={(e) => setResetTimer(Math.max(5, Number(e.target.value) || 15))}
                className="w-full rounded-lg border border-slate-700 bg-[#060B18] px-2.5 py-2 text-xs font-mono-tabular text-white"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-amber-300 mb-1">Max Time (Mins)</label>
              <input
                type="number"
                min={0}
                max={180}
                value={maxDurationMinutes}
                onChange={(e) => setMaxDurationMinutes(Math.max(0, Math.min(180, Number(e.target.value) || 0)))}
                className="w-full rounded-lg border border-amber-500/40 bg-[#060B18] px-2.5 py-2 text-xs font-mono-tabular text-amber-300"
                title="If time expires, incomplete squads randomly auto-fill and auction finishes."
              />
            </div>
          </div>

          {/* Squad Size & Role Quotas (5..18 + 7 Extras) */}
          <div className="rounded-xl border border-slate-800 bg-[#060B18] p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-xs font-bold text-white">Squad Size (5–18) &amp; Role Quotas</div>
                <div className="text-[11px] text-slate-400">
                  Playing XI uses {Math.min(11, minSquad)} players · Up to {extrasCount} free-choice bench extras (any role) up to {maxSquad} max.
                </div>
              </div>
              <span className="text-[11px] font-mono-tabular text-emerald-400">
                Pool: {totalPoolSize} players ({teams.length}×{maxSquad}+{maxSquad})
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-6 gap-2.5">
              <div>
                <label className="block text-[10px] text-slate-400 mb-1">Min Squad (5–18)</label>
                <input
                  type="number"
                  min={5}
                  max={18}
                  value={minSquad}
                  onChange={(e) => handleMinSquadChange(Number(e.target.value) || 5)}
                  className="w-full rounded-lg border border-slate-700 bg-[#0D1526] px-2.5 py-1.5 text-xs font-mono-tabular text-white"
                />
              </div>
              <div>
                <label className="block text-[10px] text-slate-400 mb-1">Max Squad (≤18)</label>
                <input
                  type="number"
                  min={minSquad}
                  max={18}
                  value={maxSquad}
                  onChange={(e) => handleMaxSquadChange(Number(e.target.value) || 18)}
                  className="w-full rounded-lg border border-slate-700 bg-[#0D1526] px-2.5 py-1.5 text-xs font-mono-tabular text-white"
                />
              </div>
              <div>
                <label className="block text-[10px] text-slate-400 mb-1">Batters (BAT)</label>
                <input
                  type="number"
                  min={0}
                  max={11}
                  value={roleQuotas.batters}
                  onChange={(e) => setRoleQuotas({ ...roleQuotas, batters: Math.max(0, Number(e.target.value) || 0) })}
                  className="w-full rounded-lg border border-slate-700 bg-[#0D1526] px-2.5 py-1.5 text-xs font-mono-tabular text-emerald-300"
                />
              </div>
              <div>
                <label className="block text-[10px] text-slate-400 mb-1">Bowlers (BWL)</label>
                <input
                  type="number"
                  min={0}
                  max={11}
                  value={roleQuotas.bowlers}
                  onChange={(e) => setRoleQuotas({ ...roleQuotas, bowlers: Math.max(0, Number(e.target.value) || 0) })}
                  className="w-full rounded-lg border border-slate-700 bg-[#0D1526] px-2.5 py-1.5 text-xs font-mono-tabular text-emerald-300"
                />
              </div>
              <div>
                <label className="block text-[10px] text-slate-400 mb-1">All-Round (AR)</label>
                <input
                  type="number"
                  min={0}
                  max={11}
                  value={roleQuotas.allRounders}
                  onChange={(e) => setRoleQuotas({ ...roleQuotas, allRounders: Math.max(0, Number(e.target.value) || 0) })}
                  className="w-full rounded-lg border border-slate-700 bg-[#0D1526] px-2.5 py-1.5 text-xs font-mono-tabular text-emerald-300"
                />
              </div>
              <div>
                <label className="block text-[10px] text-slate-400 mb-1">Keepers (WK)</label>
                <input
                  type="number"
                  min={0}
                  max={5}
                  value={roleQuotas.wicketkeepers}
                  onChange={(e) => setRoleQuotas({ ...roleQuotas, wicketkeepers: Math.max(0, Number(e.target.value) || 0) })}
                  className="w-full rounded-lg border border-slate-700 bg-[#0D1526] px-2.5 py-1.5 text-xs font-mono-tabular text-emerald-300"
                />
              </div>
            </div>
          </div>

          {/* Visual Timer Selector */}
          <div>
            <div className="text-xs font-medium text-slate-400 mb-2">AUCTION TIMER (Starting Countdown per Lot)</div>
            <div className="grid grid-cols-4 gap-2.5">
              {([5, 10, 15, 20] as const).map((sec) => (
                <button
                  key={sec}
                  type="button"
                  onClick={() => setInitialTimer(sec)}
                  className={`py-2.5 rounded-lg border text-xs font-mono-tabular font-bold transition-colors ${
                    initialTimer === sec
                      ? 'border-emerald-500 bg-emerald-500/20 text-emerald-300'
                      : 'border-slate-700 bg-[#060B18] text-slate-300 hover:border-slate-600'
                  }`}
                >
                  [{sec} SEC]
                </button>
              ))}
            </div>
          </div>

          {/* Feature Toggles */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <label className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-[#060B18] px-3 py-2 text-xs text-slate-200 cursor-pointer">
              <span>Single-Bidder vs AI Opponents Mode</span>
              <input
                type="checkbox"
                checked={aiOpponentsEnabled}
                onChange={(e) => setAiOpponentsEnabled(e.target.checked)}
                className="accent-emerald-500"
              />
            </label>
            <label className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-[#060B18] px-3 py-2 text-xs text-slate-200 cursor-pointer">
              <span>Mutual Bidder &amp; Host Controls</span>
              <input
                type="checkbox"
                checked={allBiddersCanHost}
                onChange={(e) => setAllBiddersCanHost(e.target.checked)}
                className="accent-emerald-500"
              />
            </label>
            <label className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-[#060B18] px-3 py-2 text-xs text-slate-200 cursor-pointer">
              <span>Custom Manual Bid Input</span>
              <input
                type="checkbox"
                checked={allowCustomBid}
                onChange={(e) => setAllowCustomBid(e.target.checked)}
                className="accent-emerald-500"
              />
            </label>
            <label className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-[#060B18] px-3 py-2 text-xs text-slate-200 cursor-pointer">
              <span>Quick Bid Button</span>
              <input
                type="checkbox"
                checked={allowQuickBid}
                onChange={(e) => setAllowQuickBid(e.target.checked)}
                className="accent-emerald-500"
              />
            </label>
          </div>

          {/* Teams Purse Config */}
          <div className="border-t border-slate-800 pt-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-slate-300">
                Franchise Teams &amp; Starting Purses ({teams.length} Teams{playMode === 'ai' ? ' · 1v1 You vs AI' : ''})
              </span>
              <span className="text-[11px] text-slate-400">Edit names, owners, or individual ₹ Crore budgets</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-52 overflow-y-auto pr-1">
              {teams.map((t, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-2 rounded-lg border border-slate-800 bg-[#060B18] p-2.5"
                >
                  <span
                    className="w-3 h-8 rounded-sm shrink-0"
                    style={{ backgroundColor: t.primaryColor }}
                  />
                  <div className="flex-1 min-w-0 space-y-1">
                    <input
                      type="text"
                      value={t.name}
                      onChange={(e) =>
                        setTeams((prev) =>
                          prev.map((item, i) => (i === idx ? { ...item, name: e.target.value } : item))
                        )
                      }
                      className="w-full bg-transparent text-xs font-semibold text-white focus:outline-none border-b border-transparent focus:border-slate-700"
                    />
                    <input
                      type="text"
                      value={t.ownerName}
                      onChange={(e) =>
                        setTeams((prev) =>
                          prev.map((item, i) => (i === idx ? { ...item, ownerName: e.target.value } : item))
                        )
                      }
                      className="w-full bg-transparent text-[11px] text-slate-400 focus:outline-none"
                    />
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <input
                      type="number"
                      min={10}
                      max={1000}
                      value={t.purseCrores}
                      onChange={(e) =>
                        setTeams((prev) =>
                          prev.map((item, i) =>
                            i === idx ? { ...item, purseCrores: Math.max(10, Number(e.target.value) || 200) } : item
                          )
                        )
                      }
                      className="w-16 rounded border border-slate-700 bg-[#0D1526] px-2 py-1 text-right text-xs font-mono-tabular text-emerald-300"
                    />
                    <span className="text-[11px] text-slate-400">Cr</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-red-500/40 bg-red-950/50 px-3 py-2 text-xs text-red-200">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-700 px-4 py-2.5 text-sm font-medium text-slate-300 hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-emerald-500 px-6 py-2.5 text-sm font-bold text-slate-950 hover:bg-emerald-400 disabled:opacity-50 transition-colors"
            >
              {submitting ? 'Creating Room...' : 'Create Auction Room'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
