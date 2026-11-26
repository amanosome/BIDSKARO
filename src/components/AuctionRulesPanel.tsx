import React, { useState } from 'react';
import { Check, Lock, Plus, RotateCcw, ShieldCheck, Trash2, Unlock } from 'lucide-react';
import {
  AuctionRoomState,
  AuctionRules,
  BidIncrementTier,
  CurrencyCode,
  PlayerCategory,
  Team,
} from '../shared/auctionTypes';
import { CRORE, formatCurrency, LAKH } from '../shared/currency';
import { computeDefaultRoleQuotas, DEFAULT_INCREMENT_TABLE } from '../shared/rulesEngine';

interface AuctionRulesPanelProps {
  room: AuctionRoomState;
  isHost: boolean;
  onSaveRules: (rules: Partial<AuctionRules>) => void;
  onUpdateTeam: (teamId: string, patch: Partial<Team>) => void;
  onConfirmAndStart: () => void;
}

const CATEGORIES: PlayerCategory[] = [
  'Marquee',
  'Capped Batter',
  'Capped Bowler',
  'Capped All-Rounder',
  'Wicketkeeper',
  'Uncapped',
];

export const AuctionRulesPanel: React.FC<AuctionRulesPanelProps> = ({
  room,
  isHost,
  onSaveRules,
  onUpdateTeam,
  onConfirmAndStart,
}) => {
  const [draft, setDraft] = useState<AuctionRules>(() => ({
    ...room.rules,
    incrementTable: room.rules.incrementTable.map((t) => ({ ...t })),
    categoryOverrides: room.rules.categoryOverrides.map((c) => ({ ...c })),
  }));
  const [savedNotice, setSavedNotice] = useState(false);

  const isLockedForEdit = draft.rulesLocked && !draft.hostCanEditRulesLive;

  const commitRules = (next: AuctionRules) => {
    setDraft(next);
    if (isHost) {
      onSaveRules(next);
      setSavedNotice(true);
      window.setTimeout(() => setSavedNotice(false), 1800);
    }
  };

  const handleTierChange = (id: string, field: keyof BidIncrementTier, rawVal: string) => {
    const numLakhs = Number(rawVal);
    const updated = draft.incrementTable.map((tier) => {
      if (tier.id !== id) return tier;
      if (field === 'maxBid') {
        return { ...tier, maxBid: rawVal === '' ? null : Math.max(0, numLakhs * LAKH) };
      }
      if (field === 'minBid') {
        return { ...tier, minBid: Math.max(0, numLakhs * LAKH) };
      }
      if (field === 'increment') {
        return { ...tier, increment: Math.max(1 * LAKH, numLakhs * LAKH) };
      }
      return tier;
    });
    setDraft({ ...draft, incrementTable: updated });
  };

  const addTier = () => {
    const last = draft.incrementTable[draft.incrementTable.length - 1];
    const nextMin = last?.maxBid ?? (last ? last.minBid + 5 * CRORE : 0);
    const newTier: BidIncrementTier = {
      id: `tier-${Date.now()}`,
      minBid: nextMin,
      maxBid: null,
      increment: 1 * CRORE,
    };
    const prevUpdated = draft.incrementTable.map((t, i) =>
      i === draft.incrementTable.length - 1 && t.maxBid === null
        ? { ...t, maxBid: nextMin }
        : t
    );
    setDraft({ ...draft, incrementTable: [...prevUpdated, newTier] });
  };

  const removeTier = (id: string) => {
    if (draft.incrementTable.length <= 1) return;
    setDraft({
      ...draft,
      incrementTable: draft.incrementTable.filter((t) => t.id !== id),
    });
  };

  const setCategoryOverride = (category: PlayerCategory, minIncLakhs: number) => {
    const existing = draft.categoryOverrides.filter((c) => c.category !== category);
    if (minIncLakhs > 0) {
      existing.push({ category, minIncrement: minIncLakhs * LAKH });
    }
    setDraft({ ...draft, categoryOverrides: existing });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <h2 className="text-2xl font-display font-bold tracking-tight text-white">
            Auction Rules Configuration
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Configure team purses, countdown timers, increment slabs, squad caps, and host controls.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {draft.rulesLocked ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-300">
              <Lock className="w-3.5 h-3.5" />
              Rules Locked ({draft.hostCanEditRulesLive ? 'Live Host Overrides Audited' : 'Read Only'})
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400">
              <Unlock className="w-3.5 h-3.5" />
              Editable Before Start
            </span>
          )}
          {isHost && (
            <button
              type="button"
              disabled={isLockedForEdit}
              onClick={() => commitRules(draft)}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50 transition-colors"
            >
              <Check className="w-4 h-4" />
              <span>{savedNotice ? 'Saved to Room' : 'Save Rules'}</span>
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* A & K: Team Purse, Max Purse & Currency */}
          <section className="rounded-xl border border-slate-800 bg-[#0D1526] p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-white">
                A &amp; K. Team Purse, Maximum Purse &amp; Currency
              </h3>
              <span className="text-xs font-mono-tabular text-emerald-400">
                Default: {formatCurrency(draft.defaultTeamPurse, draft.currency)}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Currency</label>
                <select
                  disabled={!isHost || isLockedForEdit}
                  value={draft.currency}
                  onChange={(e) => setDraft({ ...draft, currency: e.target.value as CurrencyCode })}
                  className="w-full rounded-lg border border-slate-700 bg-[#060B18] px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                >
                  <option value="INR">INR — Indian Rupees (₹)</option>
                  <option value="USD">USD — US Dollars ($)</option>
                  <option value="GBP">GBP — British Pounds (£)</option>
                  <option value="AUD">AUD — Australian Dollars (A$)</option>
                  <option value="AED">AED — UAE Dirham</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">
                  Default Purse per Team (in Crores)
                </label>
                <input
                  type="number"
                  min={10}
                  max={1000}
                  disabled={!isHost || isLockedForEdit}
                  value={Math.round(draft.defaultTeamPurse / CRORE)}
                  onChange={(e) => {
                    const cr = Math.max(10, Number(e.target.value) || 200);
                    setDraft({
                      ...draft,
                      defaultTeamPurse: cr * CRORE,
                      maxTeamPurse: Math.max(draft.maxTeamPurse, cr * CRORE),
                    });
                  }}
                  className="w-full rounded-lg border border-slate-700 bg-[#060B18] px-3 py-2 text-sm font-mono-tabular text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">
                  Maximum Purse Cap (in Crores)
                </label>
                <input
                  type="number"
                  min={10}
                  max={2000}
                  disabled={!isHost || isLockedForEdit}
                  value={Math.round(draft.maxTeamPurse / CRORE)}
                  onChange={(e) => {
                    const cr = Math.max(10, Number(e.target.value) || 200);
                    setDraft({ ...draft, maxTeamPurse: cr * CRORE });
                  }}
                  className="w-full rounded-lg border border-slate-700 bg-[#060B18] px-3 py-2 text-sm font-mono-tabular text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Individual team budgets */}
            <div className="pt-2 border-t border-slate-800/80">
              <div className="text-xs font-medium text-slate-400 mb-2">Individual Team Purses</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {room.teams.map((team) => (
                  <div
                    key={team.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-[#060B18] px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-white truncate">{team.name}</div>
                      <div className="text-[11px] text-slate-400 font-mono-tabular">
                        Rem: {formatCurrency(team.remainingPurse, draft.currency)}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <input
                        type="number"
                        min={10}
                        max={Math.round(draft.maxTeamPurse / CRORE)}
                        disabled={!isHost}
                        defaultValue={Math.round(team.initialPurse / CRORE)}
                        onBlur={(e) => {
                          const val = Math.max(10, Number(e.target.value) || 200);
                          onUpdateTeam(team.id, { initialPurse: val * CRORE });
                        }}
                        className="w-16 rounded border border-slate-700 bg-[#0D1526] px-2 py-1 text-right text-xs font-mono-tabular text-white"
                      />
                      <span className="text-xs text-slate-400">Cr</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* B, C, G, H, I: Auction Timer & Reset Configuration */}
          <section className="rounded-xl border border-slate-800 bg-[#0D1526] p-5 space-y-4">
            <h3 className="text-base font-semibold text-white">
              B, C, G, H &amp; I. Auction Timer, Reset &amp; Anti-Sniping
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <div className="text-xs font-medium text-slate-400 mb-2">
                  Initial Auction Timer (per new player)
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {([5, 10, 15, 20] as const).map((sec) => (
                    <button
                      key={sec}
                      type="button"
                      disabled={!isHost || isLockedForEdit}
                      onClick={() => setDraft({ ...draft, initialTimerSeconds: sec })}
                      className={`py-2.5 rounded-lg border text-xs font-mono-tabular font-bold transition-colors ${
                        draft.initialTimerSeconds === sec
                          ? 'border-emerald-500 bg-emerald-500/20 text-emerald-300'
                          : 'border-slate-700 bg-[#060B18] text-slate-300 hover:border-slate-600'
                      }`}
                    >
                      {sec} SEC
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs font-medium text-slate-400 mb-2">
                  Reset Countdown After Every Valid Bid (Default 15s)
                </div>
                <div className="flex items-center gap-2">
                  {[10, 15, 20].map((sec) => (
                    <button
                      key={sec}
                      type="button"
                      disabled={!isHost || isLockedForEdit}
                      onClick={() => setDraft({ ...draft, resetTimerSeconds: sec })}
                      className={`flex-1 py-2.5 rounded-lg border text-xs font-mono-tabular font-bold transition-colors ${
                        draft.resetTimerSeconds === sec
                          ? 'border-amber-500 bg-amber-500/20 text-amber-300'
                          : 'border-slate-700 bg-[#060B18] text-slate-300 hover:border-slate-600'
                      }`}
                    >
                      {sec} SEC
                    </button>
                  ))}
                  <input
                    type="number"
                    min={5}
                    max={60}
                    disabled={!isHost || isLockedForEdit}
                    value={draft.resetTimerSeconds}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        resetTimerSeconds: Math.max(5, Math.min(60, Number(e.target.value) || 15)),
                      })
                    }
                    className="w-16 rounded-lg border border-slate-700 bg-[#060B18] px-2 py-2.5 text-center text-xs font-mono-tabular text-white"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
              <label className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-[#060B18] px-3 py-2.5 cursor-pointer">
                <span className="text-xs text-slate-200">Automatic UNSOLD on 0s</span>
                <input
                  type="checkbox"
                  disabled={!isHost || isLockedForEdit}
                  checked={draft.autoUnsoldOnExpire}
                  onChange={(e) => setDraft({ ...draft, autoUnsoldOnExpire: e.target.checked })}
                  className="accent-emerald-500 w-4 h-4"
                />
              </label>
              <label className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-[#060B18] px-3 py-2.5 cursor-pointer">
                <span className="text-xs text-slate-200">Manual Player Closing</span>
                <input
                  type="checkbox"
                  disabled={!isHost || isLockedForEdit}
                  checked={draft.manualClosingMode}
                  onChange={(e) => setDraft({ ...draft, manualClosingMode: e.target.checked })}
                  className="accent-emerald-500 w-4 h-4"
                />
              </label>
              <label className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-[#060B18] px-3 py-2.5 cursor-pointer">
                <span className="text-xs text-slate-200">Anti-Sniping Reset</span>
                <input
                  type="checkbox"
                  disabled={!isHost || isLockedForEdit}
                  checked={draft.antiSnipingEnabled}
                  onChange={(e) => setDraft({ ...draft, antiSnipingEnabled: e.target.checked })}
                  className="accent-emerald-500 w-4 h-4"
                />
              </label>
            </div>
          </section>

          {/* D & L: Bid Increment Table + Category Rules */}
          <section className="rounded-xl border border-slate-800 bg-[#0D1526] p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-base font-semibold text-white">
                  D &amp; L. Bid Increment Table &amp; Category Rules
                </h3>
                <p className="text-xs text-slate-400">
                  Values in Lakhs (100 Lakhs = ₹1 Crore). Host can add, edit, or remove tiers.
                </p>
              </div>
              {isHost && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={isLockedForEdit}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        incrementTable: DEFAULT_INCREMENT_TABLE.map((t) => ({ ...t })),
                      })
                    }
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Reset Defaults
                  </button>
                  <button
                    type="button"
                    disabled={isLockedForEdit}
                    onClick={addTier}
                    className="inline-flex items-center gap-1 rounded-lg bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-emerald-300 hover:bg-slate-700"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Level
                  </button>
                </div>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="py-2 pr-3 font-medium">From (Lakhs)</th>
                    <th className="py-2 pr-3 font-medium">To (Lakhs, blank = ∞)</th>
                    <th className="py-2 pr-3 font-medium">Min Increment (Lakhs)</th>
                    <th className="py-2 pr-3 font-medium">Readable Range</th>
                    <th className="py-2 text-right font-medium">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {draft.incrementTable.map((tier) => (
                    <tr key={tier.id}>
                      <td className="py-2 pr-3">
                        <input
                          type="number"
                          min={0}
                          disabled={!isHost || isLockedForEdit}
                          value={Math.round(tier.minBid / LAKH)}
                          onChange={(e) => handleTierChange(tier.id, 'minBid', e.target.value)}
                          className="w-24 rounded border border-slate-700 bg-[#060B18] px-2 py-1 font-mono-tabular text-white"
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <input
                          type="number"
                          min={0}
                          placeholder="∞"
                          disabled={!isHost || isLockedForEdit}
                          value={tier.maxBid === null ? '' : Math.round(tier.maxBid / LAKH)}
                          onChange={(e) => handleTierChange(tier.id, 'maxBid', e.target.value)}
                          className="w-24 rounded border border-slate-700 bg-[#060B18] px-2 py-1 font-mono-tabular text-white"
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <input
                          type="number"
                          min={1}
                          disabled={!isHost || isLockedForEdit}
                          value={Math.round(tier.increment / LAKH)}
                          onChange={(e) => handleTierChange(tier.id, 'increment', e.target.value)}
                          className="w-24 rounded border border-slate-700 bg-[#060B18] px-2 py-1 font-mono-tabular text-emerald-300 font-semibold"
                        />
                      </td>
                      <td className="py-2 pr-3 font-mono-tabular text-slate-300">
                        {formatCurrency(tier.minBid, draft.currency)} –{' '}
                        {tier.maxBid === null ? 'Above' : formatCurrency(tier.maxBid, draft.currency)}
                        <span className="text-slate-500"> · </span>
                        <span className="text-amber-300">
                          +{formatCurrency(tier.increment, draft.currency)}
                        </span>
                      </td>
                      <td className="py-2 text-right">
                        {isHost && (
                          <button
                            type="button"
                            disabled={isLockedForEdit || draft.incrementTable.length <= 1}
                            onClick={() => removeTier(tier.id)}
                            className="p-1.5 text-slate-400 hover:text-red-400 disabled:opacity-30"
                            title="Remove increment level"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 border-t border-slate-800/80">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  Global Minimum Bid Floor (Lakhs)
                </label>
                <input
                  type="number"
                  min={5}
                  disabled={!isHost || isLockedForEdit}
                  value={Math.round(draft.minBidFloor / LAKH)}
                  onChange={(e) =>
                    setDraft({ ...draft, minBidFloor: Math.max(5, Number(e.target.value) || 10) * LAKH })
                  }
                  className="w-full rounded-lg border border-slate-700 bg-[#060B18] px-3 py-2 text-xs font-mono-tabular text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  Optional Global Max Bid Cap (Crores, blank = team purse)
                </label>
                <input
                  type="number"
                  min={1}
                  placeholder="Unlimited (Team Budget)"
                  disabled={!isHost || isLockedForEdit}
                  value={draft.maxBidCap ? Math.round(draft.maxBidCap / CRORE) : ''}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      maxBidCap: e.target.value === '' ? null : Math.max(1, Number(e.target.value)) * CRORE,
                    })
                  }
                  className="w-full rounded-lg border border-slate-700 bg-[#060B18] px-3 py-2 text-xs font-mono-tabular text-white"
                />
              </div>
            </div>

            {/* Category Overrides */}
            <div className="pt-2">
              <div className="text-xs font-medium text-slate-400 mb-2">
                Category Minimum Increment Overrides (Lakhs, 0 = use standard table)
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {CATEGORIES.map((cat) => {
                  const found = draft.categoryOverrides.find((c) => c.category === cat);
                  return (
                    <div
                      key={cat}
                      className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-[#060B18] px-2.5 py-1.5"
                    >
                      <span className="text-[11px] text-slate-300 truncate">{cat}</span>
                      <input
                        type="number"
                        min={0}
                        disabled={!isHost || isLockedForEdit}
                        value={found ? Math.round(found.minIncrement / LAKH) : 0}
                        onChange={(e) => setCategoryOverride(cat, Number(e.target.value) || 0)}
                        className="w-12 rounded border border-slate-700 bg-[#0D1526] px-1.5 py-0.5 text-right text-xs font-mono-tabular text-white"
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          {/* E, F, J, M, N, O: Bidding Modes, Squad Rules, Host Permissions & Display */}
          <section className="rounded-xl border border-slate-800 bg-[#0D1526] p-5 space-y-4">
            <h3 className="text-base font-semibold text-white">
              E, F, J, M, N &amp; O. Squad Quotas (5–18), Max Duration &amp; AI / Mutual Controls
            </h3>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Min Squad (5–18)</label>
                <input
                  type="number"
                  min={5}
                  max={18}
                  disabled={!isHost || isLockedForEdit}
                  value={draft.minSquadSize}
                  onChange={(e) => {
                    const nextMin = Math.max(5, Math.min(18, Number(e.target.value) || 5));
                    setDraft({
                      ...draft,
                      minSquadSize: nextMin,
                      maxSquadSize: Math.max(nextMin, Math.min(18, draft.maxSquadSize)),
                      playingXISize: Math.min(11, nextMin),
                      roleQuotas: computeDefaultRoleQuotas(nextMin),
                    });
                  }}
                  className="w-full rounded-lg border border-slate-700 bg-[#060B18] px-3 py-2 text-xs font-mono-tabular text-white"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Max Squad (≤18)</label>
                <input
                  type="number"
                  min={draft.minSquadSize}
                  max={18}
                  disabled={!isHost || isLockedForEdit}
                  value={draft.maxSquadSize}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      maxSquadSize: Math.max(draft.minSquadSize, Math.min(18, Number(e.target.value) || 18)),
                    })
                  }
                  className="w-full rounded-lg border border-slate-700 bg-[#060B18] px-3 py-2 text-xs font-mono-tabular text-white"
                />
              </div>
              <div>
                <label className="block text-[11px] text-amber-300 mb-1">Max Duration (Min)</label>
                <input
                  type="number"
                  min={0}
                  max={180}
                  disabled={!isHost || isLockedForEdit}
                  value={draft.maxAuctionDurationMinutes}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      maxAuctionDurationMinutes: Math.max(0, Math.min(180, Number(e.target.value) || 0)),
                    })
                  }
                  className="w-full rounded-lg border border-amber-500/40 bg-[#060B18] px-3 py-2 text-xs font-mono-tabular text-amber-300"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Max Overseas</label>
                <input
                  type="number"
                  min={0}
                  max={15}
                  disabled={!isHost || isLockedForEdit}
                  value={draft.maxOverseasPlayers}
                  onChange={(e) => setDraft({ ...draft, maxOverseasPlayers: Math.max(0, Number(e.target.value) || 8) })}
                  className="w-full rounded-lg border border-slate-700 bg-[#060B18] px-3 py-2 text-xs font-mono-tabular text-white"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Reserve / Slot (L)</label>
                <input
                  type="number"
                  min={0}
                  disabled={!isHost || isLockedForEdit}
                  value={Math.round(draft.reservePerEmptySlot / LAKH)}
                  onChange={(e) =>
                    setDraft({ ...draft, reservePerEmptySlot: Math.max(0, Number(e.target.value) || 0) * LAKH })
                  }
                  className="w-full rounded-lg border border-slate-700 bg-[#060B18] px-3 py-2 text-xs font-mono-tabular text-white"
                />
              </div>
            </div>

            {/* Role Quotas Editor */}
            <div className="rounded-lg border border-slate-800 bg-[#060B18] p-3.5 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-white">
                  Required Core Role Quotas (Playing {Math.min(11, draft.minSquadSize)})
                </span>
                <span className="text-[11px] text-emerald-400">
                  +{Math.max(0, draft.maxSquadSize - Math.min(11, draft.minSquadSize))} Free-Choice Extras (Any Role)
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {([
                  { key: 'batters', label: 'Batters (BAT)' },
                  { key: 'bowlers', label: 'Bowlers (BWL)' },
                  { key: 'allRounders', label: 'All-Rounders (AR)' },
                  { key: 'wicketkeepers', label: 'Wicketkeepers (WK)' },
                ] as const).map((item) => (
                  <div key={item.key}>
                    <label className="block text-[10px] text-slate-400 mb-1">{item.label}</label>
                    <input
                      type="number"
                      min={0}
                      max={11}
                      disabled={!isHost || isLockedForEdit}
                      value={draft.roleQuotas?.[item.key] ?? 0}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          roleQuotas: {
                            ...(draft.roleQuotas || computeDefaultRoleQuotas(draft.minSquadSize)),
                            [item.key]: Math.max(0, Number(e.target.value) || 0),
                          },
                        })
                      }
                      className="w-full rounded border border-slate-700 bg-[#0D1526] px-2.5 py-1.5 text-xs font-mono-tabular text-emerald-300"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Play Mode & Stack Mode Controls */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1 border-t border-slate-800/80">
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Play Mode</label>
                <select
                  disabled={!isHost || isLockedForEdit}
                  value={draft.playMode || (draft.aiOpponentsEnabled ? 'ai' : 'friends')}
                  onChange={(e) => {
                    const pm = e.target.value as 'friends' | 'ai';
                    setDraft({ ...draft, playMode: pm, aiOpponentsEnabled: pm === 'ai' });
                  }}
                  className="w-full rounded-lg border border-slate-700 bg-[#060B18] px-3 py-2 text-xs text-white"
                >
                  <option value="friends">Play with Friends (Invite Code)</option>
                  <option value="ai">Play with AI Opponents</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">League Stack Scope</label>
                <select
                  disabled={!isHost || isLockedForEdit}
                  value={draft.stackMode || 'lifetime'}
                  onChange={(e) =>
                    setDraft({ ...draft, stackMode: e.target.value as 'lifetime' | 'season_only' })
                  }
                  className="w-full rounded-lg border border-slate-700 bg-[#060B18] px-3 py-2 text-xs text-white"
                >
                  <option value="lifetime">Lifetime League Stacks (4 / 5 / 6 Retentions)</option>
                  <option value="season_only">Season-Only Stacks (Reset Yearly)</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">League Matches / Season</label>
                <input
                  type="number"
                  min={4}
                  max={28}
                  disabled={!isHost || isLockedForEdit}
                  value={draft.matchesPerTeamPerSeason ?? 14}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      matchesPerTeamPerSeason: Math.max(4, Math.min(28, Number(e.target.value) || 14)),
                    })
                  }
                  className="w-full rounded-lg border border-slate-700 bg-[#060B18] px-3 py-2 text-xs font-mono-tabular text-emerald-300"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              {[
                { key: 'aiOpponentsEnabled', label: 'AI Franchise Opponents (Solo vs AI)' },
                { key: 'allBiddersCanHost', label: 'Mutual Bidder & Host Controls' },
                { key: 'allowCustomBid', label: 'E. Custom Manual Bid Input Enabled' },
                { key: 'allowQuickBid', label: 'F. Quick Bid Button Enabled' },
                { key: 'hostCanBid', label: 'N. Host-as-Bidder Mode Enabled' },
                { key: 'hostCanEditRulesLive', label: 'N. Allow Live Rule Edits During Auction' },
                { key: 'showBidderNameOnBigScreen', label: 'O. Show Bidder Name on Big Screen TV' },
                { key: 'showIncrementTableToBidders', label: 'O. Show Increment Table on Mobile App' },
              ].map((item) => (
                <label
                  key={item.key}
                  className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-[#060B18] px-3 py-2.5 cursor-pointer"
                >
                  <span className="text-xs text-slate-200">{item.label}</span>
                  <input
                    type="checkbox"
                    disabled={!isHost || isLockedForEdit}
                    checked={Boolean(draft[item.key as keyof AuctionRules])}
                    onChange={(e) =>
                      setDraft({ ...draft, [item.key]: e.target.checked })
                    }
                    className="accent-emerald-500 w-4 h-4"
                  />
                </label>
              ))}
            </div>
          </section>
        </div>

        {/* Summary Screen */}
        <aside className="space-y-4">
          <div className="rounded-xl border border-emerald-500/30 bg-[#0D1526] p-6 sticky top-20 space-y-5">
            <div className="flex items-center gap-2.5 text-emerald-400">
              <ShieldCheck className="w-5 h-5" />
              <h3 className="text-base font-display font-bold tracking-wide text-white">
                AUCTION RULES SUMMARY
              </h3>
            </div>

            <dl className="space-y-3 text-sm divide-y divide-slate-800/80">
              <div className="flex justify-between pt-2">
                <dt className="text-slate-400">Team purse</dt>
                <dd className="font-mono-tabular font-semibold text-white">
                  {formatCurrency(draft.defaultTeamPurse, draft.currency)}
                </dd>
              </div>
              <div className="flex justify-between pt-2">
                <dt className="text-slate-400">Initial / Reset timer</dt>
                <dd className="font-mono-tabular font-semibold text-emerald-400">
                  {draft.initialTimerSeconds}s / {draft.resetTimerSeconds}s
                </dd>
              </div>
              <div className="flex justify-between pt-2">
                <dt className="text-slate-400">Max auction duration</dt>
                <dd className="font-mono-tabular font-semibold text-amber-300">
                  {draft.maxAuctionDurationMinutes > 0 ? `${draft.maxAuctionDurationMinutes} mins` : 'Unlimited'}
                </dd>
              </div>
              <div className="flex justify-between pt-2">
                <dt className="text-slate-400">Squad range</dt>
                <dd className="font-mono-tabular font-semibold text-white">
                  {draft.minSquadSize}–{draft.maxSquadSize} ({Math.min(11, draft.minSquadSize)} Play)
                </dd>
              </div>
              <div className="flex justify-between pt-2">
                <dt className="text-slate-400">Core quotas</dt>
                <dd className="font-mono-tabular text-xs font-semibold text-emerald-300">
                  {draft.roleQuotas?.batters ?? 4}B · {draft.roleQuotas?.bowlers ?? 4}BW · {draft.roleQuotas?.allRounders ?? 2}AR · {draft.roleQuotas?.wicketkeepers ?? 1}WK
                </dd>
              </div>
              <div className="flex justify-between pt-2">
                <dt className="text-slate-400">Player pool</dt>
                <dd className="font-mono-tabular font-semibold text-white">
                  {room.teams.length * draft.maxSquadSize + draft.maxSquadSize} ({room.teams.length}×{draft.maxSquadSize}+{draft.maxSquadSize})
                </dd>
              </div>
              <div className="flex justify-between pt-2">
                <dt className="text-slate-400">Play mode</dt>
                <dd className="text-emerald-400 font-semibold">
                  {draft.playMode === 'friends' || !draft.aiOpponentsEnabled ? 'Friends (Invite Code)' : 'Solo vs AI'}
                </dd>
              </div>
              <div className="flex justify-between pt-2">
                <dt className="text-slate-400">League stacks</dt>
                <dd className="text-amber-300 font-semibold">
                  {draft.stackMode === 'season_only'
                    ? 'Season-Only Reset'
                    : 'Lifetime (4 / 5 / 6 Retentions)'}
                </dd>
              </div>
              <div className="flex justify-between pt-2">
                <dt className="text-slate-400">Season format</dt>
                <dd className="font-mono-tabular text-white font-semibold">
                  {draft.matchesPerTeamPerSeason ?? 14} Matches → Top 4 → Final
                </dd>
              </div>
              <div className="flex justify-between pt-2">
                <dt className="text-slate-400">Mutual host / bidder</dt>
                <dd className={draft.allBiddersCanHost ? 'text-emerald-400 font-semibold' : 'text-slate-400'}>
                  {draft.allBiddersCanHost ? 'Enabled' : 'Host Only'}
                </dd>
              </div>
            </dl>

            {isHost && (
              <div className="space-y-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    commitRules(draft);
                    onConfirmAndStart();
                  }}
                  className="w-full rounded-lg bg-emerald-500 py-3 px-4 text-sm font-bold text-slate-950 hover:bg-emerald-400 transition-colors shadow-lg shadow-emerald-500/15"
                >
                  {room.status === 'lobby' ? 'CONFIRM AND START AUCTION' : 'SAVE & RETURN TO LIVE CONSOLE'}
                </button>
                <p className="text-[11px] text-slate-400 text-center">
                  All rule modifications during a live auction are recorded in the room audit log.
                </p>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
};
