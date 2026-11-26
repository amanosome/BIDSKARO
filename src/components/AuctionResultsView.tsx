import React, { useEffect, useState } from 'react';
import { Award, Check, Download, Play, Share2, Swords, Trophy } from 'lucide-react';
import { AuctionRoomState, LeaderboardEntry } from '../shared/auctionTypes';
import { formatCurrency, formatShortCurrency } from '../shared/currency';
import { TeamCrest } from './BidsKaroLogo';
import { YearlySeasonAndTradePanel } from './YearlySeasonAndTradePanel';

interface AuctionResultsViewProps {
  room?: AuctionRoomState | null;
  onSendCommand?: (type: string, payload?: Record<string, unknown>) => boolean;
}

export const AuctionResultsView: React.FC<AuctionResultsViewProps> = ({ room, onSendCommand }) => {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loadingLb, setLoadingLb] = useState(true);
  const [copiedSummary, setCopiedSummary] = useState(false);

  useEffect(() => {
    let active = true;
    fetch('/api/leaderboard')
      .then((r) => r.json())
      .then((data) => {
        if (active && Array.isArray(data.leaderboard)) {
          setLeaderboard(data.leaderboard);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoadingLb(false);
      });
    return () => {
      active = false;
    };
  }, [room?.updatedAt, room?.status, room?.virtualMatches?.length]);

  const soldPlayers = room ? room.players.filter((p) => p.status === 'sold') : [];
  const unsoldPlayers = room ? room.players.filter((p) => p.status === 'unsold') : [];
  const topBuy = [...soldPlayers].sort((a, b) => (b.soldPrice || 0) - (a.soldPrice || 0))[0];
  const xiLimit = room ? Math.min(room.rules.playingXISize || 11, room.rules.minSquadSize || 11, 11) : 11;
  const virtualMatches = room?.virtualMatches || [];

  const shareText = room
    ? `BidsKaro Auction Results — ${room.roomName} (${room.leagueId} ${room.seasonYear}): ${soldPlayers.length} players sold${
        topBuy ? `, Top Buy: ${topBuy.name} (${formatCurrency(topBuy.soldPrice || 0, room.rules.currency)} to ${topBuy.soldToTeamName})` : ''
      }. Join Room ${room.roomCode}: ${window.location.origin}${window.location.pathname}?room=${room.roomCode}`
    : 'BidsKaro — Bid Smart. Build Your Team. Check out the live cricket auction leaderboard!';

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'BidsKaro Auction Results',
          text: shareText,
          url: window.location.href,
        });
        return;
      } catch {
        // fallback to clipboard
      }
    }
    try {
      await navigator.clipboard.writeText(shareText);
      setCopiedSummary(true);
      window.setTimeout(() => setCopiedSummary(false), 2000);
    } catch {
      // ignore
    }
  };

  const handleExportCSV = () => {
    if (!room) return;
    const rows = [
      ['Player', 'Country', 'Role', 'Category', 'Status', 'Base Price', 'Sold Price', 'Team'],
      ...room.players.map((p) => [
        p.name,
        p.country,
        p.role,
        p.category,
        p.status.toUpperCase(),
        String(p.basePrice),
        String(p.soldPrice || 0),
        p.soldToTeamName || '-',
      ]),
    ];
    const csv = rows.map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bidskaro-${room.roomCode}-results.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-8">
      {/* Room Results Section */}
      {room && (
        <section className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
            <div>
              <h2 className="text-2xl font-display font-bold text-white">
                Auction Results &amp; Final Playing XI Summary
              </h2>
              <p className="text-sm text-slate-400">
                {room.roomName} · {soldPlayers.length} Sold · {unsoldPlayers.length} Unsold
                {room.status === 'completed' ? ' · Auction Completed' : ''}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              {onSendCommand && (
                <button
                  type="button"
                  onClick={() => onSendCommand('play_virtual_match')}
                  className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400 transition-colors"
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span>Play Virtual Match</span>
                </button>
              )}
              <button
                type="button"
                onClick={handleShare}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-400 transition-colors"
              >
                {copiedSummary ? <Check className="w-4 h-4" /> : <Share2 className="w-4 h-4" />}
                <span>{copiedSummary ? 'Copied Share Summary' : 'Share Results'}</span>
              </button>
              <a
                href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-[#0D1526] px-3.5 py-2 text-xs font-semibold text-slate-200 hover:border-emerald-500/40"
              >
                WhatsApp
              </a>
              <a
                href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-[#0D1526] px-3.5 py-2 text-xs font-semibold text-slate-200 hover:border-emerald-500/40"
              >
                Share on X
              </a>
              <button
                type="button"
                onClick={handleExportCSV}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-[#0D1526] px-3.5 py-2 text-xs font-semibold text-slate-200 hover:border-amber-500/40"
              >
                <Download className="w-4 h-4" />
                <span>Export CSV</span>
              </button>
            </div>
          </div>

          {topBuy && (
            <div className="rounded-xl border border-amber-500/30 bg-[#0D1526] p-5 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <Award className="w-8 h-8 text-amber-400 shrink-0" />
                <div>
                  <div className="text-xs font-semibold text-amber-300">MOST EXPENSIVE SIGNING</div>
                  <div className="text-xl font-display font-bold text-white">
                    {topBuy.name} <span className="text-slate-400 font-normal text-sm">→ {topBuy.soldToTeamName}</span>
                  </div>
                </div>
              </div>
              <div className="text-2xl font-mono-tabular font-extrabold text-emerald-400">
                {formatCurrency(topBuy.soldPrice || 0, room.rules.currency)}
              </div>
            </div>
          )}

          {/* Franchise Squad Breakdown */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {room.teams.map((team) => {
              const roster = room.players.filter((p) => team.squad.includes(p.id));
              const xiIds = new Set(
                team.startingXI && team.startingXI.length > 0
                  ? team.startingXI
                  : team.squad.slice(0, xiLimit)
              );
              return (
                <div key={team.id} className="rounded-xl border border-slate-800 bg-[#0D1526] p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <TeamCrest
                        shortCode={team.shortCode}
                        primaryColor={team.primaryColor}
                        secondaryColor={team.secondaryColor}
                        size="sm"
                      />
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-white truncate">{team.name}</div>
                        <div className="text-[11px] text-slate-400 truncate">Owner: {team.ownerName}</div>
                      </div>
                    </div>
                    <div className="text-right font-mono-tabular shrink-0">
                      <div className="text-xs font-bold text-emerald-400">
                        {formatShortCurrency(team.remainingPurse, room.rules.currency)} left
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {roster.length}/{room.rules.maxSquadSize} · XI {xiIds.size}/{xiLimit}
                      </div>
                    </div>
                  </div>

                  {roster.length === 0 ? (
                    <p className="text-xs text-slate-500 py-3 border-t border-slate-800/80">
                      No players acquired yet.
                    </p>
                  ) : (
                    <div className="divide-y divide-slate-800/60 border-t border-slate-800/80 max-h-56 overflow-y-auto">
                      {roster.map((p) => {
                        const inXI = xiIds.has(p.id);
                        const isC = team.captainId === p.id;
                        const isVC = team.viceCaptainId === p.id;
                        return (
                          <div key={p.id} className="py-2 flex items-center justify-between text-xs gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span
                                  className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${
                                    inXI
                                      ? 'bg-emerald-500/20 text-emerald-300'
                                      : 'bg-slate-800 text-slate-400'
                                  }`}
                                >
                                  {inXI ? 'XI' : 'EXTRA'}
                                </span>
                                <span className="font-medium text-white truncate">{p.name}</span>
                                {isC && <span className="text-[10px] text-amber-300 font-bold">(C)</span>}
                                {isVC && <span className="text-[10px] text-emerald-300 font-bold">(VC)</span>}
                              </div>
                              <span className="text-[10px] text-slate-400 font-mono-tabular">
                                {p.role} · M:{p.stats.matches} · {p.sport === 'football' ? 'G' : 'R'}:{p.stats.runs} · SR:{p.stats.strikeRate} · {p.sport === 'football' ? 'CS' : 'W'}:{p.stats.wickets}
                              </span>
                            </div>
                            <span className="font-mono-tabular font-semibold text-amber-300 shrink-0">
                              {formatShortCurrency(p.soldPrice || 0, room.rules.currency)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Virtual Match Arena & Tournament Simulator */}
          <div className="rounded-2xl border border-slate-800 bg-[#0D1526] p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <Swords className="w-5 h-5 text-amber-400" />
                <div>
                  <h3 className="text-lg font-display font-bold text-white">
                    Virtual Match Simulator (Drafted Playing XI Arena)
                  </h3>
                  <p className="text-xs text-slate-400">
                    Simulate head-to-head fixtures using each franchise&apos;s Final Playing {xiLimit} ratings, Captain (2x), &amp; Vice-Captain (1.5x).
                  </p>
                </div>
              </div>
              {onSendCommand && (
                <button
                  type="button"
                  onClick={() => onSendCommand('play_virtual_match')}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-xs font-bold text-slate-950 hover:bg-emerald-400"
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span>Play Virtual Match Round</span>
                </button>
              )}
            </div>

            {virtualMatches.length === 0 ? (
              <div className="rounded-xl border border-slate-800 bg-[#060B18] p-6 text-center text-xs text-slate-400">
                No virtual matches simulated yet. Click <strong>Play Virtual Match Round</strong> to simulate fixtures between your teams and update rankings.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {virtualMatches.slice(0, 8).map((m) => (
                  <div
                    key={m.id}
                    className="rounded-xl border border-slate-800 bg-[#060B18] p-4 space-y-2.5"
                  >
                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span className="font-mono-tabular font-semibold">MATCH #{m.fixtureNumber}</span>
                      <span className="font-semibold text-emerald-400">{m.marginText}</span>
                    </div>

                    <div className="grid grid-cols-2 gap-3 items-center">
                      <div className="flex items-center gap-2 min-w-0">
                        <TeamCrest shortCode={m.teamAShortCode} primaryColor={m.teamAColor} size="sm" />
                        <div className="min-w-0">
                          <div className={`text-xs font-bold truncate ${m.winnerTeamId === m.teamAId ? 'text-amber-300' : 'text-white'}`}>
                            {m.teamAName}
                          </div>
                          <div className="text-sm font-mono-tabular font-extrabold text-white">
                            {m.teamAScore}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-end gap-2 min-w-0 text-right">
                        <div className="min-w-0">
                          <div className={`text-xs font-bold truncate ${m.winnerTeamId === m.teamBId ? 'text-amber-300' : 'text-white'}`}>
                            {m.teamBName}
                          </div>
                          <div className="text-sm font-mono-tabular font-extrabold text-white">
                            {m.teamBScore}
                          </div>
                        </div>
                        <TeamCrest shortCode={m.teamBShortCode} primaryColor={m.teamBColor} size="sm" />
                      </div>
                    </div>

                    <div className="border-t border-slate-800/80 pt-2 text-[11px] text-slate-300 flex items-center justify-between gap-2">
                      <span className="truncate">
                        MOTM: <strong className="text-amber-300">{m.motmPlayerName}</strong>
                      </span>
                      <span className="font-mono-tabular text-slate-400 shrink-0">{m.motmPerformance}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {onSendCommand && (
            <YearlySeasonAndTradePanel
              room={room}
              isHost={true}
              onSendCommand={onSendCommand}
            />
          )}
        </section>
      )}

      {/* Global Leaderboard Rankings */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Trophy className="w-5 h-5 text-amber-400" />
            <h2 className="text-xl font-display font-bold text-white">
              BidsKaro Global Franchise Leaderboard
            </h2>
          </div>
          <span className="text-xs text-slate-400">
            Ranked by Squad Tactical Power, Virtual Matches &amp; Purse Efficiency
          </span>
        </div>

        <div className="rounded-xl border border-slate-800 bg-[#0D1526] overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 bg-[#091122]">
                <th className="py-3 px-4 font-semibold">Rank</th>
                <th className="py-3 px-4 font-semibold">Franchise &amp; Owner</th>
                <th className="py-3 px-4 font-semibold">League</th>
                <th className="py-3 px-4 font-semibold text-right">Squad</th>
                <th className="py-3 px-4 font-semibold text-right">Purse Spent</th>
                <th className="py-3 px-4 font-semibold text-right">Power Score</th>
                <th className="py-3 px-4 font-semibold">Marquee Signings</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {loadingLb ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400">
                    Loading leaderboard rankings...
                  </td>
                </tr>
              ) : (
                leaderboard.slice(0, 12).map((entry, idx) => (
                  <tr key={entry.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-3 px-4 font-mono-tabular font-bold text-amber-400">
                      #{idx + 1}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2.5">
                        <TeamCrest
                          shortCode={entry.teamShortCode}
                          primaryColor={entry.teamColor}
                          size="sm"
                        />
                        <div>
                          <div className="font-semibold text-white">{entry.teamName}</div>
                          <div className="text-[11px] text-slate-400">{entry.ownerName}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-slate-300">
                      {entry.leagueId} {entry.seasonYear}
                      <span className="text-slate-500"> · {entry.roomCode}</span>
                    </td>
                    <td className="py-3 px-4 text-right font-mono-tabular text-white">
                      {entry.playersCount}
                    </td>
                    <td className="py-3 px-4 text-right font-mono-tabular text-emerald-400">
                      {formatShortCurrency(entry.purseSpent, 'INR')}
                    </td>
                    <td className="py-3 px-4 text-right font-mono-tabular font-bold text-amber-300">
                      {entry.squadPowerScore}
                    </td>
                    <td className="py-3 px-4 text-slate-300 max-w-xs truncate">
                      {entry.topSignings.join(', ')}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
