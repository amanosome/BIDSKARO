import React, { useMemo, useState } from 'react';
import { ArrowLeftRight, Award, Play, RefreshCw, Shield, Star, UserPlus } from 'lucide-react';
import { AuctionPlayer, AuctionRoomState } from '../shared/auctionTypes';
import { CRORE, formatCurrency, formatShortCurrency } from '../shared/currency';
import { TeamCrest } from './BidsKaroLogo';
import { YearlySeasonAndTradePanel } from './YearlySeasonAndTradePanel';

interface SeasonFantasyPanelProps {
  room: AuctionRoomState;
  isHost: boolean;
  assignedTeamId?: string;
  onSendCommand: (type: string, payload?: Record<string, unknown>) => boolean;
}

export const SeasonFantasyPanel: React.FC<SeasonFantasyPanelProps> = ({
  room,
  isHost,
  assignedTeamId,
  onSendCommand,
}) => {
  const [selectedTeamId, setSelectedTeamId] = useState<string>(
    assignedTeamId || room.teams[0]?.id || ''
  );

  // Trade Form State
  const [tradeFromTeamId, setTradeFromTeamId] = useState<string>(room.teams[0]?.id || '');
  const [tradeToTeamId, setTradeToTeamId] = useState<string>(room.teams[1]?.id || room.teams[0]?.id || '');
  const [givePlayerId, setGivePlayerId] = useState<string>('');
  const [receivePlayerId, setReceivePlayerId] = useState<string>('');
  const [cashCrores, setCashCrores] = useState<number>(0);

  const playersMap = useMemo(
    () => new Map(room.players.map((p) => [p.id, p])),
    [room.players]
  );

  const activeTeam = useMemo(
    () => room.teams.find((t) => t.id === selectedTeamId) || room.teams[0],
    [room.teams, selectedTeamId]
  );

  const squadPlayers = useMemo(() => {
    if (!activeTeam) return [];
    return activeTeam.squad
      .map((id) => playersMap.get(id))
      .filter((p): p is AuctionPlayer => Boolean(p));
  }, [activeTeam, playersMap]);

  const freeAgents = useMemo(
    () =>
      room.status === 'lobby'
        ? []
        : room.players.filter((p) => p.status === 'unsold' || p.status === 'upcoming'),
    [room.players, room.status]
  );

  const unsoldPlayers = useMemo(
    () => (room.status === 'lobby' ? [] : room.players.filter((p) => p.status === 'unsold')),
    [room.players, room.status]
  );

  const xiLimit = Math.min(room.rules.playingXISize || 11, room.rules.minSquadSize || 11, 11);

  const standings = useMemo(
    () => [...room.teams].sort((a, b) => (b.fantasyPoints || 0) - (a.fantasyPoints || 0)),
    [room.teams]
  );

  const tradeFromTeam = room.teams.find((t) => t.id === tradeFromTeamId);
  const tradeToTeam = room.teams.find((t) => t.id === tradeToTeamId);

  const toggleStartingXI = (playerId: string) => {
    if (!activeTeam) return;
    const currentXI = activeTeam.startingXI || [];
    const exists = currentXI.includes(playerId);
    const nextXI = exists
      ? currentXI.filter((id) => id !== playerId)
      : currentXI.length < xiLimit
        ? [...currentXI, playerId]
        : currentXI;
    onSendCommand('set_lineup', {
      teamId: activeTeam.id,
      startingXI: nextXI,
      captainId: activeTeam.captainId,
      viceCaptainId: activeTeam.viceCaptainId,
    });
  };

  const setCaptainRole = (playerId: string, role: 'C' | 'VC') => {
    if (!activeTeam) return;
    const ensureXI = activeTeam.startingXI.includes(playerId)
      ? activeTeam.startingXI
      : [...activeTeam.startingXI, playerId].slice(0, xiLimit);

    onSendCommand('set_lineup', {
      teamId: activeTeam.id,
      startingXI: ensureXI,
      captainId: role === 'C' ? playerId : activeTeam.captainId === playerId ? undefined : activeTeam.captainId,
      viceCaptainId: role === 'VC' ? playerId : activeTeam.viceCaptainId === playerId ? undefined : activeTeam.viceCaptainId,
    });
  };

  const handleTradeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!tradeFromTeamId || !tradeToTeamId || !givePlayerId) return;
    onSendCommand('execute_trade', {
      fromTeamId: tradeFromTeamId,
      toTeamId: tradeToTeamId,
      givePlayerId,
      receivePlayerId: receivePlayerId || undefined,
      cashAdjustment: cashCrores * CRORE,
    });
    setGivePlayerId('');
    setReceivePlayerId('');
    setCashCrores(0);
  };

  return (
    <div className="space-y-6">
      {/* Season Fantasy Header & Matchweek Simulator */}
      <div className="rounded-2xl border border-slate-800 bg-[#0D1526] p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-xs font-semibold text-emerald-400">
            SEASON-LONG FANTASY LEAGUE · BIDSKARO ENGINE
          </div>
          <h2 className="mt-1 text-2xl font-display font-bold text-white">
            Starting XI, Captain (2x) / Vice-Captain (1.5x), Trades &amp; Waivers
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Matchweek <strong className="font-mono-tabular text-white">{room.matchweekNumber}</strong> completed · Pick your {xiLimit}-player lineup, assign 2x/1.5x multipliers, claim waivers, or re-auction unsold players.
          </p>
        </div>

        {isHost && (
          <button
            type="button"
            onClick={() => onSendCommand('simulate_matchweek')}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-3 text-xs sm:text-sm font-bold text-slate-950 hover:bg-emerald-400 transition-colors shadow-lg shadow-emerald-500/20"
          >
            <Play className="w-4 h-4 fill-current" />
            <span>Simulate Matchweek {room.matchweekNumber + 1}</span>
          </button>
        )}
      </div>

      {/* Trade Bin + 14-Match Yearly Season & Top 4 Playoffs + 4/5/6 Retentions */}
      <YearlySeasonAndTradePanel
        room={room}
        isHost={isHost}
        assignedTeamId={assignedTeamId}
        onSendCommand={onSendCommand}
      />

      {/* Season Fantasy Leaderboard */}
      <div className="rounded-2xl border border-slate-800 bg-[#0D1526] p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <Award className="w-4 h-4 text-amber-400" />
            <span>Season Fantasy Standings (Matchweek {room.matchweekNumber})</span>
          </h3>
          <span className="text-xs text-slate-400">Captain 2x · Vice-Captain 1.5x</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {standings.map((t, idx) => (
            <div
              key={t.id}
              onClick={() => setSelectedTeamId(t.id)}
              className={`cursor-pointer rounded-xl border p-3.5 transition-colors ${
                t.id === activeTeam?.id
                  ? 'border-emerald-500 bg-emerald-500/10'
                  : 'border-slate-800 bg-[#060B18] hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-mono-tabular text-amber-400 font-bold">#{idx + 1}</span>
                <TeamCrest shortCode={t.shortCode} primaryColor={t.primaryColor} size="sm" />
              </div>
              <div className="mt-2 text-sm font-bold text-white truncate">{t.name}</div>
              <div className="mt-1 flex items-baseline justify-between font-mono-tabular">
                <span className="text-xl font-extrabold text-emerald-400">{t.fantasyPoints || 0}</span>
                <span className="text-[11px] text-slate-400">PTS</span>
              </div>
              <div className="mt-1 text-[11px] text-slate-400">
                XI: {t.startingXI?.length || 0}/{xiLimit} · Rem {formatShortCurrency(t.remainingPurse, room.rules.currency)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Main Grid: Starting XI & C/VC Selector + Trades/Waivers/Re-Auction */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left 7 Cols: Lineup & Multipliers */}
        <div className="lg:col-span-7 rounded-2xl border border-slate-800 bg-[#0D1526] p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-white">
                {activeTeam?.name} — Starting XI &amp; Multipliers
              </h3>
              <p className="text-xs text-slate-400">
                Select up to {xiLimit} starters ({activeTeam?.startingXI?.length || 0}/{xiLimit} chosen). Assign Captain (2x) &amp; Vice-Captain (1.5x).
              </p>
            </div>
            <select
              value={activeTeam?.id || ''}
              onChange={(e) => setSelectedTeamId(e.target.value)}
              className="rounded-lg border border-slate-700 bg-[#060B18] px-3 py-2 text-xs text-white"
            >
              {room.teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          {squadPlayers.length === 0 ? (
            <div className="rounded-xl border border-slate-800 bg-[#060B18] p-8 text-center text-xs text-slate-400">
              No players acquired by {activeTeam?.name} yet. Draft or sign players in Live Auction, Snake Draft, or Waivers below.
            </div>
          ) : (
            <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
              {squadPlayers.map((p) => {
                const inXI = activeTeam?.startingXI?.includes(p.id);
                const isC = activeTeam?.captainId === p.id;
                const isVC = activeTeam?.viceCaptainId === p.id;
                return (
                  <div
                    key={p.id}
                    className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 ${
                      inXI ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-slate-800 bg-[#060B18]'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-white flex items-center gap-2">
                        <span>{p.name}</span>
                        {isC && <span className="text-[10px] font-mono-tabular text-amber-300 font-extrabold">(C · 2x)</span>}
                        {isVC && <span className="text-[10px] font-mono-tabular text-emerald-300 font-extrabold">(VC · 1.5x)</span>}
                      </div>
                      <div className="text-[11px] text-slate-400 font-mono-tabular">
                        {p.role} · Rating {p.rating} · Season Pts: {p.fantasyPoints || 0}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => toggleStartingXI(p.id)}
                        className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold ${
                          inXI
                            ? 'border-emerald-500 bg-emerald-500 text-slate-950'
                            : 'border-slate-700 text-slate-300 hover:border-slate-500'
                        }`}
                      >
                        {inXI ? 'In XI' : 'Bench'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setCaptainRole(p.id, 'C')}
                        className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-bold ${
                          isC
                            ? 'border-amber-400 bg-amber-400 text-slate-950'
                            : 'border-slate-700 text-slate-300 hover:border-amber-400/50'
                        }`}
                      >
                        2x C
                      </button>
                      <button
                        type="button"
                        onClick={() => setCaptainRole(p.id, 'VC')}
                        className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-bold ${
                          isVC
                            ? 'border-emerald-400 bg-emerald-400 text-slate-950'
                            : 'border-slate-700 text-slate-300 hover:border-emerald-400/50'
                        }`}
                      >
                        1.5x VC
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right 5 Cols: Player Trades, Waiver Claims & Unsold Re-Auction */}
        <div className="lg:col-span-5 space-y-5">
          {/* Player Trade Window */}
          {isHost && (
            <form
              onSubmit={handleTradeSubmit}
              className="rounded-2xl border border-slate-800 bg-[#0D1526] p-5 space-y-3"
            >
              <div className="flex items-center gap-2 text-sm font-bold text-white">
                <ArrowLeftRight className="w-4 h-4 text-amber-400" />
                <span>Franchise Player Trade Window</span>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">From Team</label>
                  <select
                    value={tradeFromTeamId}
                    onChange={(e) => {
                      setTradeFromTeamId(e.target.value);
                      setGivePlayerId('');
                    }}
                    className="w-full rounded-lg border border-slate-700 bg-[#060B18] px-2.5 py-2 text-xs text-white"
                  >
                    {room.teams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">To Team</label>
                  <select
                    value={tradeToTeamId}
                    onChange={(e) => {
                      setTradeToTeamId(e.target.value);
                      setReceivePlayerId('');
                    }}
                    className="w-full rounded-lg border border-slate-700 bg-[#060B18] px-2.5 py-2 text-xs text-white"
                  >
                    {room.teams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Send Player</label>
                  <select
                    value={givePlayerId}
                    onChange={(e) => setGivePlayerId(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-[#060B18] px-2.5 py-2 text-xs text-white"
                  >
                    <option value="">Select player...</option>
                    {(tradeFromTeam?.squad || []).map((pid) => {
                      const p = playersMap.get(pid);
                      return p ? (
                        <option key={pid} value={pid}>
                          {p.name}
                        </option>
                      ) : null;
                    })}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Receive Player (Optional)</label>
                  <select
                    value={receivePlayerId}
                    onChange={(e) => setReceivePlayerId(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-[#060B18] px-2.5 py-2 text-xs text-white"
                  >
                    <option value="">Cash Only</option>
                    {(tradeToTeam?.squad || []).map((pid) => {
                      const p = playersMap.get(pid);
                      return p ? (
                        <option key={pid} value={pid}>
                          {p.name}
                        </option>
                      ) : null;
                    })}
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step={0.5}
                  value={cashCrores}
                  onChange={(e) => setCashCrores(Number(e.target.value) || 0)}
                  placeholder="Purse adjustment (Cr)"
                  className="w-36 rounded-lg border border-slate-700 bg-[#060B18] px-2.5 py-2 text-xs font-mono-tabular text-white"
                />
                <span className="text-[11px] text-slate-400">Cr adjustment to From Team</span>
              </div>

              <button
                type="submit"
                disabled={!givePlayerId || tradeFromTeamId === tradeToTeamId}
                className="w-full rounded-lg bg-amber-500 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-40"
              >
                Execute Franchise Trade
              </button>
            </form>
          )}

          {/* Unsold Re-Auction & Waiver Wire */}
          <div className="rounded-2xl border border-slate-800 bg-[#0D1526] p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-bold text-white">
                <UserPlus className="w-4 h-4 text-emerald-400" />
                <span>Waivers &amp; Unsold Re-Auction ({freeAgents.length})</span>
              </div>
              {unsoldPlayers.length > 0 && (
                <span className="text-[11px] text-amber-300 font-mono-tabular">
                  {unsoldPlayers.length} Unsold
                </span>
              )}
            </div>

            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {freeAgents.slice(0, 20).map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-[#060B18] px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-white truncate">
                      {p.name}
                      <span className="text-[11px] text-slate-400 font-normal"> · {p.role}</span>
                    </div>
                    <div className="text-[11px] text-slate-400 font-mono-tabular">
                      {formatCurrency(p.basePrice, room.rules.currency)} · {p.status.toUpperCase()}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {isHost && p.status === 'unsold' && (
                      <button
                        type="button"
                        onClick={() =>
                          onSendCommand('nominate_reauction', {
                            playerId: p.id,
                            startImmediately: true,
                          })
                        }
                        className="inline-flex items-center gap-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-300 hover:bg-amber-500/20"
                        title="Re-auction at 50% reduced base price"
                      >
                        <RefreshCw className="w-3 h-3" />
                        <span>50% Re-Bid</span>
                      </button>
                    )}
                    {activeTeam && (
                      <button
                        type="button"
                        onClick={() =>
                          onSendCommand('claim_waiver', {
                            teamId: activeTeam.id,
                            playerId: p.id,
                          })
                        }
                        className="rounded-lg bg-emerald-500/15 border border-emerald-500/40 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-500/25"
                      >
                        Sign Waiver
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
