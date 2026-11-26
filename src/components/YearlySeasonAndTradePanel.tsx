import React, { useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  Award,
  Check,
  Crown,
  Flame,
  PackageOpen,
  Play,
  RefreshCw,
  Shield,
  Tag,
  Trophy,
} from 'lucide-react';
import { AuctionPlayer, AuctionRoomState, TeamStanding } from '../shared/auctionTypes';
import { CRORE, formatCurrency, formatShortCurrency, LAKH } from '../shared/currency';
import { getTeamRetentionLimit } from '../shared/rulesEngine';
import { TeamCrest } from './BidsKaroLogo';

interface YearlySeasonAndTradePanelProps {
  room: AuctionRoomState;
  isHost: boolean;
  assignedTeamId?: string;
  onSendCommand: (type: string, payload?: Record<string, unknown>) => boolean;
}

export const YearlySeasonAndTradePanel: React.FC<YearlySeasonAndTradePanelProps> = ({
  room,
  isHost,
  assignedTeamId,
  onSendCommand,
}) => {
  const [activeTeamId, setActiveTeamId] = useState<string>(assignedTeamId || room.teams[0]?.id || '');
  const [listPlayerId, setListPlayerId] = useState<string>('');
  const [askingCrores, setAskingCrores] = useState<number>(2);
  const [listNote, setListNote] = useState<string>('');
  const [swapSelection, setSwapSelection] = useState<Record<string, string>>({});

  const playersMap = useMemo(() => new Map(room.players.map((p) => [p.id, p])), [room.players]);

  const activeTeam = useMemo(
    () => room.teams.find((t) => t.id === activeTeamId) || room.teams[0],
    [room.teams, activeTeamId]
  );

  const standings = useMemo<TeamStanding[]>(() => {
    if (room.seasonStandings?.length) return room.seasonStandings;
    return room.teams.map((t) => ({
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
  }, [room.seasonStandings, room.teams]);

  const targetMatches = room.rules.matchesPerTeamPerSeason || 14;
  const maxPlayed = standings.reduce((acc, s) => Math.max(acc, s.played), 0);
  const allLeagueMatchesComplete =
    standings.length >= 2 && standings.every((s) => s.played >= targetMatches);

  const championTeam = room.teams.find((t) => t.id === room.seasonChampionTeamId);
  const runnerUpTeam = room.teams.find((t) => t.id === room.seasonRunnerUpTeamId);

  const tradeBinListings = room.tradeBin || [];
  const activeTeamSquadPlayers = useMemo(() => {
    if (!activeTeam) return [];
    return activeTeam.squad
      .map((id) => playersMap.get(id))
      .filter((p): p is AuctionPlayer => Boolean(p));
  }, [activeTeam, playersMap]);

  const activeTeamRetentionLimit = activeTeam ? getTeamRetentionLimit(room, activeTeam.id) : 4;
  const activeTeamRetentions = activeTeam ? room.retentionsByTeam?.[activeTeam.id] || [] : [];

  const handleListToTradeBin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTeam || !listPlayerId) return;
    onSendCommand('list_trade_bin', {
      teamId: activeTeam.id,
      playerId: listPlayerId,
      askingPrice: Math.max(10 * LAKH, Math.round(askingCrores * CRORE)),
      note: listNote.trim() || undefined,
    });
    setListPlayerId('');
    setListNote('');
  };

  const toggleRetentionPick = (playerId: string) => {
    if (!activeTeam || room.rules.stackMode === 'season_only') return;
    const current = room.retentionsByTeam?.[activeTeam.id] || [];
    const exists = current.includes(playerId);
    const next = exists
      ? current.filter((id) => id !== playerId)
      : current.length < activeTeamRetentionLimit
        ? [...current, playerId]
        : current;
    onSendCommand('set_team_retentions', {
      teamId: activeTeam.id,
      playerIds: next,
    });
  };

  return (
    <div className="space-y-6">
      {/* 1. Player Trade Bin Between Teams */}
      <section className="rounded-2xl border border-amber-500/30 bg-[#0D1526] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <PackageOpen className="w-5 h-5 text-amber-400" />
            <div>
              <h3 className="text-lg font-display font-bold text-white">
                Player Trade Bin Between Teams ({tradeBinListings.length} Listed)
              </h3>
              <p className="text-xs text-slate-400">
                Put surplus squad players in the Trade Bin for cash buyouts or direct player swaps between franchises.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-400">Acting Franchise:</span>
            <select
              value={activeTeam?.id || ''}
              onChange={(e) => {
                setActiveTeamId(e.target.value);
                setListPlayerId('');
              }}
              className="rounded-lg border border-slate-700 bg-[#060B18] px-3 py-1.5 text-xs font-semibold text-white"
            >
              {room.teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({formatShortCurrency(t.remainingPurse, room.rules.currency)})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* List a player onto the Trade Bin */}
          <form
            onSubmit={handleListToTradeBin}
            className="lg:col-span-4 rounded-xl border border-slate-800 bg-[#060B18] p-4 space-y-3"
          >
            <div className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
              <Tag className="w-3.5 h-3.5" />
              <span>List {activeTeam?.shortCode || 'Team'} Player to Trade Bin</span>
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Player from Squad</label>
              <select
                value={listPlayerId}
                onChange={(e) => {
                  const pid = e.target.value;
                  setListPlayerId(pid);
                  const plr = playersMap.get(pid);
                  if (plr) {
                    const cr = Number(((plr.soldPrice || plr.basePrice) / CRORE).toFixed(2));
                    setAskingCrores(Math.max(0.2, cr));
                  }
                }}
                className="w-full rounded-lg border border-slate-700 bg-[#0D1526] px-2.5 py-2 text-xs text-white"
              >
                <option value="">Select squad player...</option>
                {activeTeamSquadPlayers
                  .filter((p) => !tradeBinListings.some((tb) => tb.playerId === p.id))
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.role} · R{p.rating})
                    </option>
                  ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Asking Value (Cr)</label>
                <input
                  type="number"
                  step={0.25}
                  min={0.1}
                  value={askingCrores}
                  onChange={(e) => setAskingCrores(Math.max(0.1, Number(e.target.value) || 1))}
                  className="w-full rounded-lg border border-slate-700 bg-[#0D1526] px-2.5 py-2 text-xs font-mono-tabular text-amber-300"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Trade Note</label>
                <input
                  type="text"
                  value={listNote}
                  onChange={(e) => setListNote(e.target.value)}
                  placeholder="Need pace bowler..."
                  className="w-full rounded-lg border border-slate-700 bg-[#0D1526] px-2.5 py-2 text-xs text-white"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={!listPlayerId}
              className="w-full rounded-lg bg-amber-500 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-40 transition-colors"
            >
              Add Player to Trade Bin
            </button>
          </form>

          {/* Active Trade Bin Marketplace */}
          <div className="lg:col-span-8 space-y-2.5">
            {tradeBinListings.length === 0 ? (
              <div className="rounded-xl border border-slate-800 bg-[#060B18] p-8 text-center text-xs text-slate-400">
                The Trade Bin is currently empty. Any franchise can list a player on the left to open inter-team offers or swaps.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-72 overflow-y-auto pr-1">
                {tradeBinListings.map((tb) => {
                  const plr = playersMap.get(tb.playerId);
                  const seller = room.teams.find((t) => t.id === tb.teamId);
                  if (!plr || !seller) return null;
                  const isOwnListing = activeTeam?.id === seller.id;
                  const chosenSwapId = swapSelection[tb.id] || '';
                  return (
                    <div
                      key={tb.id}
                      className="rounded-xl border border-slate-800 bg-[#060B18] p-3.5 space-y-2.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-white truncate">{plr.name}</div>
                          <div className="text-[11px] text-slate-400">
                            {plr.role} · Rating {plr.rating} · From{' '}
                            <span className="text-slate-200 font-semibold">{seller.shortCode}</span>
                          </div>
                        </div>
                        <span className="text-xs font-mono-tabular font-bold text-amber-300 shrink-0">
                          {formatShortCurrency(tb.askingPrice, room.rules.currency)}
                        </span>
                      </div>

                      {tb.note && (
                        <p className="text-[11px] text-slate-400 italic truncate">&ldquo;{tb.note}&rdquo;</p>
                      )}

                      {isOwnListing ? (
                        <button
                          type="button"
                          onClick={() => onSendCommand('remove_trade_bin', { listingId: tb.id })}
                          className="w-full rounded-lg border border-slate-700 py-1.5 text-[11px] font-semibold text-slate-300 hover:border-red-500/50 hover:text-red-300"
                        >
                          Remove from Trade Bin
                        </button>
                      ) : activeTeam ? (
                        <div className="space-y-1.5">
                          <select
                            value={chosenSwapId}
                            onChange={(e) =>
                              setSwapSelection((prev) => ({ ...prev, [tb.id]: e.target.value }))
                            }
                            className="w-full rounded-lg border border-slate-800 bg-[#0D1526] px-2 py-1.5 text-[11px] text-slate-200"
                          >
                            <option value="">Direct Buyout (Purse Only)</option>
                            {activeTeamSquadPlayers.map((sp) => (
                              <option key={sp.id} value={sp.id}>
                                Swap {sp.name} ({sp.role})
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() =>
                              onSendCommand('accept_trade_bin', {
                                listingId: tb.id,
                                buyerTeamId: activeTeam.id,
                                swapPlayerId: chosenSwapId || undefined,
                              })
                            }
                            className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-500 py-1.5 text-[11px] font-bold text-slate-950 hover:bg-emerald-400"
                          >
                            <ArrowLeftRight className="w-3.5 h-3.5" />
                            <span>Acquire for {activeTeam.shortCode}</span>
                          </button>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* 2. Yearly Season Engine: 14-Match League -> Top 4 Semi-Finals -> 2-Team Final */}
      <section className="rounded-2xl border border-slate-800 bg-[#0D1526] p-5 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-emerald-400">
              <Trophy className="w-4 h-4 text-amber-400" />
              <span>
                YEARLY SEASON {room.seasonNumber} ({room.seasonYear}) ·{' '}
                {room.rules.stackMode === 'lifetime' ? 'LIFETIME LEAGUE STACKS' : 'SEASON-ONLY STACKS'}
              </span>
            </div>
            <h3 className="mt-1 text-xl font-display font-bold text-white">
              {targetMatches}-Match League Table → Top 4 Semi-Finals → Championship Final
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Each team plays {targetMatches} league fixtures ({room.teams.length} teams · Top 4 qualify for Semi-Finals · Base prices auto-scaled to {formatShortCurrency(room.rules.defaultTeamPurse, room.rules.currency)} purse).
            </p>
          </div>

          {isHost && (
            <div className="flex flex-wrap items-center gap-2">
              {!allLeagueMatchesComplete && (
                <>
                  <button
                    type="button"
                    onClick={() => onSendCommand('simulate_season_round', { rounds: 1 })}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#060B18] px-3.5 py-2 text-xs font-semibold text-white hover:border-emerald-500/50"
                  >
                    <Play className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Play Round ({maxPlayed}/{targetMatches})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onSendCommand('simulate_season_round', { rounds: 'all' })}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-400"
                  >
                    <Flame className="w-3.5 h-3.5" />
                    <span>Simulate All {targetMatches} Matches</span>
                  </button>
                </>
              )}

              {!room.seasonChampionTeamId && (
                <button
                  type="button"
                  onClick={() => onSendCommand('simulate_playoffs')}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400"
                >
                  <Crown className="w-3.5 h-3.5" />
                  <span>Play Top 4 Semi-Finals &amp; Final</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Points Table */}
        <div className="overflow-x-auto rounded-xl border border-slate-800 bg-[#060B18]">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 bg-[#091122]">
                <th className="py-2.5 px-3 font-semibold">Pos</th>
                <th className="py-2.5 px-3 font-semibold">Franchise</th>
                <th className="py-2.5 px-3 font-semibold text-right">Played</th>
                <th className="py-2.5 px-3 font-semibold text-right">Won</th>
                <th className="py-2.5 px-3 font-semibold text-right">Lost</th>
                <th className="py-2.5 px-3 font-semibold text-right">NRR</th>
                <th className="py-2.5 px-3 font-semibold text-right">Pts</th>
                <th className="py-2.5 px-3 font-semibold text-right">Retention Perk</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {standings.map((st, idx) => {
                const qualifies = idx < Math.min(4, standings.length);
                const retentionCap = getTeamRetentionLimit(room, st.teamId);
                return (
                  <tr
                    key={st.teamId}
                    className={
                      st.isChampion
                        ? 'bg-amber-500/10'
                        : st.isRunnerUp
                          ? 'bg-slate-700/20'
                          : qualifies
                            ? 'bg-emerald-500/5'
                            : ''
                    }
                  >
                    <td className="py-2.5 px-3 font-mono-tabular font-bold text-slate-300">
                      #{idx + 1}
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-2">
                        <TeamCrest shortCode={st.shortCode} primaryColor={st.primaryColor} size="sm" />
                        <span className="font-semibold text-white">{st.teamName}</span>
                        {st.isChampion && (
                          <span className="text-[10px] font-bold text-amber-300 uppercase">Champion</span>
                        )}
                        {st.isRunnerUp && (
                          <span className="text-[10px] font-bold text-slate-300 uppercase">Runner-Up</span>
                        )}
                        {!st.isChampion && !st.isRunnerUp && qualifies && maxPlayed > 0 && (
                          <span className="text-[10px] font-semibold text-emerald-400">Q (Top 4)</span>
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono-tabular text-slate-300">
                      {st.played}/{targetMatches}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono-tabular text-emerald-400 font-semibold">
                      {st.won}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono-tabular text-slate-400">{st.lost}</td>
                    <td className="py-2.5 px-3 text-right font-mono-tabular text-slate-300">
                      {st.nrr >= 0 ? `+${st.nrr.toFixed(2)}` : st.nrr.toFixed(2)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono-tabular font-extrabold text-white">
                      {st.points}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono-tabular text-amber-300">
                      {room.rules.stackMode === 'season_only'
                        ? '0 (Season-Only)'
                        : `Up to ${retentionCap}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Playoffs Bracket Results (Semi-Finals + Final) */}
        {room.seasonPlayoffs && room.seasonPlayoffs.length > 0 && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-bold text-white flex items-center gap-2">
                <Award className="w-4 h-4 text-amber-400" />
                <span>Season {room.seasonNumber} Playoffs Bracket (Top 4 → 2 Finalists)</span>
              </h4>
              {championTeam && runnerUpTeam && (
                <div className="text-xs font-semibold text-amber-300">
                  Winner: {championTeam.name} (6 Retentions) · Runner-Up: {runnerUpTeam.name} (5 Retentions)
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {room.seasonPlayoffs.map((po) => {
                const m = po.matchResult;
                if (!m) return null;
                return (
                  <div
                    key={po.id}
                    className={`rounded-xl border p-4 space-y-2 ${
                      po.stage === 'FINAL'
                        ? 'border-amber-400/50 bg-amber-500/10'
                        : 'border-slate-800 bg-[#060B18]'
                    }`}
                  >
                    <div className="text-[11px] font-bold text-amber-300 uppercase">{po.label}</div>
                    <div className="flex items-center justify-between text-xs">
                      <span className={m.winnerTeamId === m.teamAId ? 'font-bold text-white' : 'text-slate-400'}>
                        {m.teamAName}
                      </span>
                      <span className="font-mono-tabular font-bold text-white">{m.teamAScore}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className={m.winnerTeamId === m.teamBId ? 'font-bold text-white' : 'text-slate-400'}>
                        {m.teamBName}
                      </span>
                      <span className="font-mono-tabular font-bold text-white">{m.teamBScore}</span>
                    </div>
                    <div className="pt-1.5 border-t border-slate-800/80 text-[11px] text-emerald-400 font-semibold">
                      {m.marginText}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Off-Season Retentions & Launch Next Season Auction */}
        {room.seasonChampionTeamId && (
          <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="text-xs font-bold text-emerald-300 uppercase flex items-center gap-1.5">
                  <Shield className="w-4 h-4" />
                  <span>
                    Off-Season Retention &amp; Release Window — Season {room.seasonNumber + 1} Prep
                  </span>
                </div>
                <p className="text-xs text-slate-300 mt-1">
                  {room.rules.stackMode === 'lifetime'
                    ? `Standard franchises retain up to ${room.rules.standardRetentionLimit} players. Season Runner-Up (${runnerUpTeam?.shortCode}) keeps up to ${room.rules.runnerUpRetentionLimit}, and Season Champion (${championTeam?.shortCode}) keeps up to ${room.rules.championRetentionLimit}! All other players release into Season ${room.seasonNumber + 1} auction with purse-scaled base prices.`
                    : `Season-Only Stacks active: all squads reset and every player returns to the Season ${room.seasonNumber + 1} auction pool with purse-scaled base prices.`}
                </p>
              </div>
              {isHost && (
                <button
                  type="button"
                  onClick={() => onSendCommand('start_next_season')}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-3 text-xs sm:text-sm font-bold text-slate-950 hover:bg-emerald-400 shadow-lg shadow-emerald-500/20"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span>Release Unretained &amp; Start Season {room.seasonNumber + 1} Auction</span>
                </button>
              )}
            </div>

            {room.rules.stackMode === 'lifetime' && activeTeam && (
              <div className="space-y-2.5 border-t border-slate-800/80 pt-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-bold text-white">
                    {activeTeam.name} Retention Selection ({activeTeamRetentions.length}/{activeTeamRetentionLimit} Retained)
                    {activeTeam.id === room.seasonChampionTeamId && (
                      <span className="ml-2 text-amber-300">Winner Bonus: Up to 6 Players</span>
                    )}
                    {activeTeam.id === room.seasonRunnerUpTeamId && (
                      <span className="ml-2 text-emerald-300">Runner-Up Bonus: Up to 5 Players</span>
                    )}
                  </div>
                  <select
                    value={activeTeam.id}
                    onChange={(e) => setActiveTeamId(e.target.value)}
                    className="rounded-lg border border-slate-700 bg-[#060B18] px-2.5 py-1.5 text-xs text-white"
                  >
                    {room.teams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} (Max {getTeamRetentionLimit(room, t.id)})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-52 overflow-y-auto pr-1">
                  {activeTeamSquadPlayers.map((p) => {
                    const isRetained = activeTeamRetentions.includes(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => toggleRetentionPick(p.id)}
                        className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                          isRetained
                            ? 'border-emerald-500 bg-emerald-500/15 text-white'
                            : 'border-slate-800 bg-[#060B18] text-slate-300 hover:border-slate-600'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="font-semibold truncate">{p.name}</div>
                          <div className="text-[10px] text-slate-400">
                            {p.role} · Rating {p.rating}
                          </div>
                        </div>
                        <span
                          className={`inline-flex items-center gap-1 text-[10px] font-bold shrink-0 ${
                            isRetained ? 'text-emerald-300' : 'text-slate-500'
                          }`}
                        >
                          {isRetained ? (
                            <>
                              <Check className="w-3 h-3" />
                              RETAIN
                            </>
                          ) : (
                            'RELEASE'
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Past Seasons Hall of Fame */}
        {room.seasonHistory && room.seasonHistory.length > 0 && (
          <div className="border-t border-slate-800 pt-4 space-y-2">
            <div className="text-xs font-bold text-slate-400 uppercase">Championship History</div>
            <div className="flex flex-wrap gap-2.5">
              {room.seasonHistory.map((h) => (
                <div
                  key={h.seasonNumber}
                  className="rounded-lg border border-slate-800 bg-[#060B18] px-3 py-2 text-xs"
                >
                  <span className="font-bold text-amber-300">{h.seasonLabel}:</span>{' '}
                  <span className="text-white font-semibold">{h.championTeamName}</span>{' '}
                  <span className="text-slate-400">def. {h.runnerUpTeamName}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
