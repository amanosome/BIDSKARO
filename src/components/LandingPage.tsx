import React, { Suspense, lazy, useMemo, useState } from 'react';
import {
  ArrowRight,
  Gavel,
  Lock,
  LogOut,
  Monitor,
  ShieldCheck,
  Tv,
  Users,
} from 'lucide-react';
import { AuthUserPublic, LeagueId, PlayMode, SportType } from '../shared/auctionTypes';
import { LEAGUES } from '../data/leagues';
import { BidsKaroLogo, TeamCrest } from './BidsKaroLogo';
import { PWAInstallButton } from './PWAInstallButton';
import heroStadiumImg from '../assets/images/hero_stadium_auction_1795655418949.jpg';
import gavelSpotlightImg from '../assets/images/auction_gavel_spotlight_1795655417958.jpg';

const AuctionResultsView = lazy(() =>
  import('./AuctionResultsView').then((m) => ({ default: m.AuctionResultsView }))
);

interface LandingPageProps {
  authUser: AuthUserPublic | null;
  onOpenAuth: (mode?: 'login' | 'register' | 'owner') => void;
  onLogout: () => void;
  onOpenCreateRoom: (leagueId?: LeagueId, seasonYear?: string, playMode?: PlayMode) => void;
  onJoinRoom: (roomCode: string, role: 'bidder' | 'spectator' | 'tv', name: string, teamId?: string) => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({
  authUser,
  onOpenAuth,
  onLogout,
  onOpenCreateRoom,
  onJoinRoom,
}) => {
  const [sportFilter, setSportFilter] = useState<'all' | SportType>('all');
  const [selectedLeagueId, setSelectedLeagueId] = useState<LeagueId>('IPL');
  const [tvInviteCode, setTvInviteCode] = useState<string>('');
  const activeLeague = useMemo(
    () => LEAGUES.find((l) => l.id === selectedLeagueId) || LEAGUES[0],
    [selectedLeagueId]
  );
  const [selectedYear, setSelectedYear] = useState<string>(activeLeague.seasons[0]?.year || '2025');
  const activeSeason = useMemo(
    () => activeLeague.seasons.find((s) => s.year === selectedYear) || activeLeague.seasons[0],
    [activeLeague, selectedYear]
  );

  const [joinCode, setJoinCode] = useState('');
  const [joinName, setJoinName] = useState(authUser?.name || 'Franchise Owner');
  const [joinMode, setJoinMode] = useState<'bidder' | 'tv' | 'spectator'>('bidder');
  const [joinError, setJoinError] = useState<string | null>(null);

  const isOwner = authUser?.role === 'owner';

  const handleSelectLeague = (id: LeagueId) => {
    setSelectedLeagueId(id);
    const next = LEAGUES.find((l) => l.id === id);
    if (next?.seasons[0]) {
      setSelectedYear(next.seasons[0].year);
    }
  };

  const visibleLeagues = useMemo(
    () =>
      sportFilter === 'all'
        ? LEAGUES
        : LEAGUES.filter((l) => (l.sport || 'cricket') === sportFilter || l.id === 'CUSTOM'),
    [sportFilter]
  );

  const handleTVInvitePreview = (e: React.FormEvent) => {
    e.preventDefault();
    const code = tvInviteCode.trim().toUpperCase();
    if (!code) return;
    onJoinRoom(code, 'tv', 'Big Screen TV');
  };

  const handleJoinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = joinCode.trim().toUpperCase();
    if (!code) {
      setJoinError('Enter a valid 5–6 character room code.');
      return;
    }
    setJoinError(null);
    onJoinRoom(code, joinMode, joinName.trim() || authUser?.name || 'Franchise Owner');
  };

  return (
    <div className="min-h-screen bg-[#060B18] text-slate-100">
      {/* Strict 3-Zone Top Bar */}
      <header className="sticky top-0 z-40 border-b border-slate-800/80 bg-[#060B18]/90 backdrop-blur-md">
        <div className="max-w-[1240px] mx-auto px-6 h-16 flex items-center justify-between gap-6">
          <a href="#top" className="whitespace-nowrap shrink-0">
            <BidsKaroLogo size="md" />
          </a>

          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-300">
            <a href="#tv-preview" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
              TV Preview
            </a>
            <a href="#leagues" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
              IPL Seasons &amp; Leagues
            </a>
            <a href="#leaderboard" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
              Leaderboard
            </a>

          </nav>

          <div className="flex items-center gap-2.5 shrink-0">
            {authUser ? (
              <div className="flex items-center gap-2">
                <span className="hidden sm:inline-flex items-center gap-1.5 text-xs text-slate-300 border border-slate-800 bg-[#0D1526] rounded-lg px-2.5 py-1.5">
                  {isOwner && <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />}
                  <span className="truncate max-w-[140px]">{authUser.name}</span>
                </span>
                <button
                  type="button"
                  onClick={onLogout}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-[#0D1526] px-2.5 py-2 text-xs font-medium text-slate-300 hover:border-slate-500 whitespace-nowrap"
                  title="Sign out"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Sign Out</span>
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => onOpenAuth('login')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#0D1526] px-3 py-2 text-xs font-semibold text-slate-200 hover:border-emerald-500/50 transition-colors whitespace-nowrap shrink-0"
              >
                <Lock className="w-3.5 h-3.5 text-emerald-400" />
                <span>Sign In</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => onOpenCreateRoom('IPL', '2025', 'friends')}
              className="rounded-lg bg-emerald-500 px-3.5 py-2 text-xs sm:text-sm font-bold text-slate-950 hover:bg-emerald-400 transition-colors whitespace-nowrap shrink-0"
            >
              Create Auction Room
            </button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section id="top" className="relative overflow-hidden border-b border-slate-800/80">
        <div className="absolute inset-0">
          <img
            src={heroStadiumImg}
            alt="BidsKaro Floodlit Cricket Auction Arena"
            referrerPolicy="no-referrer"
            fetchPriority="high"
            decoding="async"
            className="w-full h-full object-cover opacity-30"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-[#060B18] via-[#060B18]/85 to-[#060B18]/60" />
        </div>

        <div className="relative max-w-[1240px] mx-auto px-6 py-16 lg:py-24 grid grid-cols-1 lg:grid-cols-12 gap-10 items-stretch">
          <div className="lg:col-span-7 flex flex-col justify-center space-y-6">
            <div className="text-xs font-semibold tracking-widest text-amber-400 uppercase">
              BIDSKARO · CRICKET &amp; FOOTBALL LIVE AUCTION PLATFORM
            </div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-display font-extrabold tracking-tight text-white leading-[1.08] max-w-2xl">
              BID SMART. BUILD YOUR TEAM.
            </h1>
            <p className="text-base sm:text-lg text-slate-300 max-w-xl leading-relaxed">
              Real Franchises &amp; Real Players across IPL, WPL, SA20, EPL &amp; UCL. Play with Friends by Invite Code or Solo vs AI, choose Lifetime League Stacks or Season-Only Stacks, trade players in the Trade Bin, and battle a 14-Match Yearly Season → Top 4 Semi-Finals → Championship Final.
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => onOpenCreateRoom('IPL', '2025', 'friends')}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-3.5 text-sm font-display font-extrabold text-slate-950 hover:bg-emerald-400 transition-colors shadow-lg shadow-emerald-500/20"
              >
                <Users className="w-4 h-4" />
                <span>Play with Friends (Invite Code)</span>
              </button>

              <button
                type="button"
                onClick={() => onOpenCreateRoom('IPL', '2025', 'ai')}
                className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-5 py-3.5 text-sm font-display font-extrabold text-slate-950 hover:bg-amber-400 transition-colors shadow-lg shadow-amber-500/20"
              >
                <Gavel className="w-4 h-4" />
                <span>Play Solo with AI</span>
              </button>

              <PWAInstallButton variant="full" />
            </div>

            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-400 pt-2">
              <span>Lifetime (6/5/4 Retentions) or Season-Only</span>
              <span aria-hidden="true">·</span>
              <span>14-Match Season &amp; Top 4 Playoffs</span>
              <span aria-hidden="true">·</span>
              <span>Inter-Team Trade Bin</span>
              <span aria-hidden="true">·</span>
              <span>Purse-Scaled Base Prices</span>
            </div>
          </div>

          {/* Right Spotlight Card */}
          <div className="lg:col-span-5 rounded-2xl border border-slate-800 bg-[#0D1526]/90 backdrop-blur-md overflow-hidden flex flex-col justify-between">
            <div className="relative h-44 bg-[#060B18]">
              <img
                src={gavelSpotlightImg}
                alt="BidsKaro Auctioneer Gavel"
                referrerPolicy="no-referrer"
                loading="lazy"
                decoding="async"
                className="w-full h-full object-cover opacity-85"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#0D1526] via-transparent to-transparent" />
              <div className="absolute bottom-3 left-5 text-xs font-semibold text-amber-300">
                Live Franchise Purse Showcase · ₹200 Cr
              </div>
            </div>
            <div className="p-5 space-y-4">
              <div className="space-y-2">
                {[
                  { name: 'Mumbai Mavericks', code: 'MM', color: '#004BA0', purse: '₹200 Crore' },
                  { name: 'Delhi Dynamos', code: 'DD', color: '#0078BC', purse: '₹200 Crore' },
                  { name: 'Chennai Chargers', code: 'CC', color: '#FDB913', purse: '₹200 Crore' },
                  { name: 'Bengaluru Blasters', code: 'BB', color: '#EC1C24', purse: '₹200 Crore' },
                  { name: 'Kolkata Knights', code: 'KK', color: '#3A225D', purse: '₹200 Crore' },
                ].map((t) => (
                  <div
                    key={t.code}
                    className="flex items-center justify-between text-xs py-1.5 border-b border-slate-800/70 last:border-0"
                  >
                    <div className="flex items-center gap-2.5">
                      <TeamCrest shortCode={t.code} primaryColor={t.color} size="sm" />
                      <span className="font-semibold text-white">{t.name}</span>
                    </div>
                    <span className="font-mono-tabular font-bold text-emerald-400">{t.purse}</span>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => onOpenCreateRoom('IPL', '2025', 'friends')}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-[#060B18] py-2.5 text-xs font-semibold text-slate-200 hover:border-emerald-500/50"
                >
                  <Users className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Friends Room</span>
                </button>
                <button
                  type="button"
                  onClick={() => onOpenCreateRoom('IPL', '2025', 'ai')}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-[#060B18] py-2.5 text-xs font-semibold text-slate-200 hover:border-amber-500/50"
                >
                  <Gavel className="w-3.5 h-3.5 text-amber-400" />
                  <span>Solo vs AI</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Dedicated TV / Big Screen Preview by Invite Code */}
      <section id="tv-preview" className="max-w-[1240px] mx-auto px-6 py-10 border-b border-slate-800/80">
        <div className="rounded-2xl border border-amber-500/35 bg-gradient-to-r from-[#0D1526] via-[#0B1427] to-[#0D1526] p-6 sm:p-8 grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
          <div className="lg:col-span-7 space-y-2">
            <div className="inline-flex items-center gap-2 text-xs font-semibold text-amber-400">
              <Tv className="w-4 h-4" />
              <span>SMART TV &amp; PROJECTOR BIG SCREEN MODE</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-display font-bold text-white">
              Preview Any Auction on TV / Big Screen by Invite Code
            </h2>
            <p className="text-sm text-slate-300">
              Open a live spectator broadcast on a Smart TV or projector using just the Invite Code. Players remain mystery-locked until the host opens the auction.
            </p>
          </div>
          <form onSubmit={handleTVInvitePreview} className="lg:col-span-5 flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              required
              value={tvInviteCode}
              onChange={(e) => setTvInviteCode(e.target.value.toUpperCase())}
              placeholder="Enter Invite Code"
              className="flex-1 rounded-xl border border-slate-700 bg-[#060B18] px-4 py-3 text-base font-mono-tabular font-bold text-amber-300 uppercase tracking-wider focus:border-amber-400 focus:outline-none"
            />
            <button
              type="submit"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-5 py-3 text-sm font-display font-extrabold text-slate-950 hover:bg-amber-400 transition-colors whitespace-nowrap shrink-0"
            >
              <Monitor className="w-4 h-4" />
              <span>Open Big Screen TV</span>
            </button>
          </form>
        </div>
      </section>

      {/* Multi-League & All IPL Historical Seasons Explorer */}
      <section id="leagues" className="max-w-[1240px] mx-auto px-6 py-16 space-y-8 border-b border-slate-800/80">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-xs font-semibold text-emerald-400">ALL IPL SEASONS &amp; GLOBAL CRICKET / FOOTBALL LEAGUES</div>
            <h2 className="mt-1 text-3xl font-display font-bold text-white">
              Simulate Any IPL Season, WPL, EPL, UCL &amp; Global Draft
            </h2>
            <p className="mt-1.5 text-sm text-slate-400 max-w-2xl">
              Select a league and season below. Players stay hidden inside a mystery pool sized automatically at Teams × Max Squad + Max Squad (e.g. 5 × 18 + 18 = 108 players) until the auction begins.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onOpenCreateRoom(selectedLeagueId, selectedYear)}
            className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-5 py-2.5 text-xs sm:text-sm font-bold text-slate-950 hover:bg-amber-400 transition-colors shrink-0"
          >
            <span>Start {activeLeague.shortName} {selectedYear} Room</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>

        {/* Sport Filter & League Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {visibleLeagues.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => handleSelectLeague(l.id)}
                className={`rounded-lg border px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
                  selectedLeagueId === l.id
                    ? 'border-emerald-500 bg-emerald-500/15 text-emerald-300'
                    : 'border-slate-800 bg-[#0D1526] text-slate-300 hover:border-slate-700'
                }`}
              >
                {l.shortName}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 rounded-lg bg-[#0D1526] p-1 border border-slate-800">
            {([
              { id: 'all', label: 'All Sports' },
              { id: 'cricket', label: 'Cricket' },
              { id: 'football', label: 'Football' },
            ] as const).map((sp) => (
              <button
                key={sp.id}
                type="button"
                onClick={() => setSportFilter(sp.id)}
                className={`px-3 py-1.5 rounded text-xs font-semibold ${
                  sportFilter === sp.id ? 'bg-emerald-500 text-slate-950' : 'text-slate-300'
                }`}
              >
                {sp.label}
              </button>
            ))}
          </div>
        </div>

        {/* Selected League Season Details */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          <div className="lg:col-span-7 rounded-2xl border border-slate-800 bg-[#0D1526] p-6 space-y-5">
            <div>
              <h3 className="text-xl font-display font-bold text-white">
                {activeLeague.name} ({activeLeague.country})
              </h3>
              <p className="text-xs text-slate-400 mt-1">{activeLeague.description}</p>
            </div>

            <div>
              <div className="text-[11px] font-semibold text-slate-400 mb-2">SELECT HISTORICAL SEASON</div>
              <div className="flex flex-wrap gap-2">
                {activeLeague.seasons.map((s) => (
                  <button
                    key={s.year}
                    type="button"
                    onClick={() => setSelectedYear(s.year)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-mono-tabular font-bold transition-colors ${
                      selectedYear === s.year
                        ? 'border-amber-400 bg-amber-500/15 text-amber-300'
                        : 'border-slate-800 bg-[#060B18] text-slate-300 hover:border-slate-600'
                    }`}
                  >
                    {s.year}
                  </button>
                ))}
              </div>
            </div>

            {activeSeason && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                <div className="rounded-xl border border-slate-800 bg-[#060B18] p-3.5">
                  <div className="text-[11px] text-slate-400">SEASON CHAMPION</div>
                  <div className="mt-1 text-sm font-bold text-white">{activeSeason.champion}</div>
                  <div className="text-[11px] text-slate-400">Runner-up: {activeSeason.runnerUp}</div>
                </div>
                <div className="rounded-xl border border-slate-800 bg-[#060B18] p-3.5">
                  <div className="text-[11px] text-slate-400">HIGHEST AUCTION BUY</div>
                  <div className="mt-1 text-sm font-bold text-amber-300">
                    {activeSeason.highestBuy.player} · {activeSeason.highestBuy.price}
                  </div>
                  <div className="text-[11px] text-slate-400">Signed by {activeSeason.highestBuy.team}</div>
                </div>
                <div className="rounded-xl border border-slate-800 bg-[#060B18] p-3.5">
                  <div className="text-[11px] text-orange-400 font-semibold">ORANGE CAP / GOLDEN BOOT</div>
                  <div className="mt-1 text-sm font-bold text-white">
                    {activeSeason.orangeCap.player} ({activeSeason.orangeCap.team})
                  </div>
                  <div className="text-[11px] font-mono-tabular text-slate-300">
                    {activeSeason.orangeCap.runs} · Index {activeSeason.orangeCap.sr}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-800 bg-[#060B18] p-3.5">
                  <div className="text-[11px] text-purple-400 font-semibold">PURPLE CAP / GOLDEN GLOVE</div>
                  <div className="mt-1 text-sm font-bold text-white">
                    {activeSeason.purpleCap.player} ({activeSeason.purpleCap.team})
                  </div>
                  <div className="text-[11px] font-mono-tabular text-slate-300">
                    {activeSeason.purpleCap.wickets} · Econ {activeSeason.purpleCap.econ}
                  </div>
                </div>
              </div>
            )}

            {activeSeason && (
              <div className="text-xs text-slate-300 border-t border-slate-800 pt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
                <span>Type: <strong className="text-white">{activeSeason.auctionType}</strong></span>
                <span>·</span>
                <span>RTM Cards: <strong className="font-mono-tabular text-emerald-400">{activeSeason.rtmCards}</strong></span>
                <span>·</span>
                <span>Overseas Cap: <strong className="font-mono-tabular text-white">{activeSeason.overseasCap}</strong></span>
                <span>·</span>
                <span>Squad: <strong className="font-mono-tabular text-white">5–18 (11 Play)</strong></span>
              </div>
            )}
          </div>

          {/* League Franchises */}
          <div className="lg:col-span-5 rounded-2xl border border-slate-800 bg-[#0D1526] p-6 flex flex-col justify-between space-y-4">
            <div>
              <h3 className="text-base font-bold text-white mb-3">
                {activeLeague.shortName} Franchises ({activeLeague.franchises.length})
              </h3>
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {activeLeague.franchises.map((f) => (
                  <div
                    key={f.id}
                    className="flex items-center justify-between rounded-lg border border-slate-800 bg-[#060B18] px-3 py-2"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <TeamCrest shortCode={f.shortCode} primaryColor={f.primaryColor} secondaryColor={f.secondaryColor} size="sm" />
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-white truncate">{f.name}</div>
                        <div className="text-[11px] text-slate-400">{f.defaultOwner}</div>
                      </div>
                    </div>
                    {typeof f.titles === 'number' && (
                      <span className="text-[11px] font-mono-tabular text-amber-300 shrink-0">
                        {f.titles} {f.titles === 1 ? 'Title' : 'Titles'}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onOpenCreateRoom(selectedLeagueId, selectedYear)}
              className="w-full rounded-xl bg-emerald-500 py-3 text-xs font-bold text-slate-950 hover:bg-emerald-400 transition-colors"
            >
              Simulate {activeLeague.shortName} {selectedYear} Live Auction
            </button>
          </div>
        </div>
      </section>

      {/* Join Active Auction Room */}
      <section id="join" className="max-w-[1240px] mx-auto px-6 py-16 border-b border-slate-800/80">
        <div className="rounded-2xl border border-slate-800 bg-[#0D1526] p-6 sm:p-8 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          <div className="lg:col-span-6 space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400">
              <Users className="w-4 h-4" />
              <span>MUTUAL BIDDER &amp; HOST ROOM JOINING</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-display font-bold text-white">
              Join a Live Auction Room by Code
            </h2>
            <p className="text-sm text-slate-300 leading-relaxed">
              Enter a room code shared by your auction host to join live bidding. Every Team Bidder also shares Host controls, and solo players compete directly against AI Franchise Directors.
            </p>
          </div>

          <form onSubmit={handleJoinSubmit} className="lg:col-span-6 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Room Code</label>
                <input
                  type="text"
                  required
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  placeholder="Enter Room Code"
                  className="w-full rounded-lg border border-slate-700 bg-[#060B18] px-3.5 py-2.5 text-sm font-mono-tabular font-bold text-emerald-300 uppercase"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Your Name</label>
                <input
                  type="text"
                  required
                  value={joinName}
                  onChange={(e) => setJoinName(e.target.value)}
                  placeholder="Franchise Owner"
                  className="w-full rounded-lg border border-slate-700 bg-[#060B18] px-3.5 py-2.5 text-sm text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {([
                { id: 'bidder', label: 'Team Bidder / Host' },
                { id: 'tv', label: 'Big Screen TV' },
                { id: 'spectator', label: 'Spectator' },
              ] as const).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setJoinMode(m.id)}
                  className={`py-2.5 rounded-lg border text-xs font-semibold transition-colors ${
                    joinMode === m.id
                      ? 'border-emerald-500 bg-emerald-500/15 text-emerald-300'
                      : 'border-slate-700 bg-[#060B18] text-slate-300'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {joinError && <p className="text-xs text-red-400">{joinError}</p>}

            <button
              type="submit"
              className="w-full rounded-xl bg-emerald-500 py-3 text-sm font-bold text-slate-950 hover:bg-emerald-400 transition-colors"
            >
              Join Auction Room
            </button>
          </form>
        </div>
      </section>



      {/* Global Leaderboard Rankings */}
      <section id="leaderboard" className="max-w-[1240px] mx-auto px-6 py-16">
        <Suspense
          fallback={
            <div className="rounded-2xl border border-slate-800 bg-[#0D1526] p-8 text-center text-xs text-slate-400">
              Loading Global Franchise Leaderboard...
            </div>
          }
        >
          <AuctionResultsView room={null} />
        </Suspense>
      </section>

      {/* Quiet Editorial Footer */}
      <footer className="border-t border-slate-800/80 bg-[#050914]">
        <div className="max-w-[1240px] mx-auto px-6 py-8 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-400">
          <div className="flex items-center gap-3">
            <BidsKaroLogo size="sm" />
            <span>·</span>
            <span>BID SMART. BUILD YOUR TEAM.</span>
          </div>
          <div className="flex items-center gap-5">
            <a href="#leagues" className="hover:text-white">IPL &amp; Leagues</a>
            <a href="#leaderboard" className="hover:text-white">Leaderboard</a>
            {!authUser && (
              <button type="button" onClick={() => onOpenAuth('login')} className="hover:text-white">
                Email Sign In
              </button>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
};
