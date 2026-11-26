import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Award, Clock, Cpu, Gavel, Lock, Maximize2, Radio, ShieldCheck } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { AuctionRoomState } from '../shared/auctionTypes';
import { formatCurrency, formatShortCurrency } from '../shared/currency';
import { BidsKaroLogo, TeamCrest } from './BidsKaroLogo';

interface BigScreenViewProps {
  room: AuctionRoomState;
  remainingSeconds: number;
  connected: boolean;
  onExitTV?: () => void;
}

function formatClockMMSS(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export const BigScreenView: React.FC<BigScreenViewProps> = ({
  room,
  remainingSeconds,
  connected,
  onExitTV,
}) => {
  const isLobbyLocked = room.status === 'lobby';
  const player = isLobbyLocked ? null : room.players.find((p) => p.id === room.currentPlayerId) || null;
  const highestTeam = room.teams.find((t) => t.id === room.highestBidderTeamId) || null;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const phoneJoinUrl = `${origin}/?room=${room.roomCode}&view=bidder`;
  const [auctionClockSeconds, setAuctionClockSeconds] = useState(0);

  useEffect(() => {
    const updateClock = () => {
      if (room.status === 'live' && room.auctionEndDeadlineMs > 0) {
        setAuctionClockSeconds(Math.max(0, Math.floor((room.auctionEndDeadlineMs - Date.now()) / 1000)));
      } else {
        setAuctionClockSeconds(0);
      }
    };
    updateClock();
    const timer = window.setInterval(updateClock, 1000);
    return () => window.clearInterval(timer);
  }, [room.status, room.auctionEndDeadlineMs]);

  const isSnakeMode = room.rules.buildingMode === 'snake_draft';
  const getSnakeTeamAtPick = (pickIdx: number) => {
    if (!room.teams.length) return null;
    const n = room.teams.length;
    const round = Math.floor(pickIdx / n);
    const pos = pickIdx % n;
    const teamIdx = round % 2 === 0 ? pos : n - 1 - pos;
    return room.teams[teamIdx] || null;
  };
  const currentSnakeTeam = isSnakeMode ? getSnakeTeamAtPick(room.snakeDraftPickIndex) : null;
  const upcomingSnakeTeams = isSnakeMode
    ? [1, 2, 3].map((offset) => getSnakeTeamAtPick(room.snakeDraftPickIndex + offset)).filter(Boolean)
    : [];

  const getTimerStyle = () => {
    if (room.lotStatus === 'paused') {
      return { color: 'text-amber-300', ring: 'border-amber-500/40 bg-amber-500/10', label: 'PAUSED' };
    }
    if (room.lotStatus === 'awaiting_hammer') {
      return { color: 'text-amber-400', ring: 'border-amber-500/60 bg-amber-500/20', label: 'AWAITING HAMMER' };
    }
    if (room.lotStatus !== 'bidding') {
      return { color: 'text-slate-400', ring: 'border-slate-700 bg-slate-900', label: 'STANDBY' };
    }
    if (remainingSeconds <= 1) {
      return {
        color: 'text-red-400 animate-urgent-blink',
        ring: 'border-red-500 bg-red-500/20 shadow-lg shadow-red-500/25',
        label: 'FINAL CALL',
      };
    }
    if (remainingSeconds <= 3) {
      return { color: 'text-red-400', ring: 'border-red-500/70 bg-red-500/15', label: 'GOING TWICE' };
    }
    if (remainingSeconds <= 5) {
      return { color: 'text-orange-400', ring: 'border-orange-500/60 bg-orange-500/15', label: 'GOING ONCE' };
    }
    if (remainingSeconds <= 10) {
      return { color: 'text-amber-400', ring: 'border-amber-500/50 bg-amber-500/10', label: 'ACTIVE' };
    }
    return { color: 'text-emerald-400', ring: 'border-emerald-500/50 bg-emerald-500/10', label: 'OPEN BIDDING' };
  };

  const timerStyle = getTimerStyle();

  const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  };

  if (!room.bigScreenPublished) {
    return (
      <div className="min-h-[75vh] flex flex-col items-center justify-center text-center p-8 rounded-2xl border border-slate-800 bg-[#0D1526]">
        <BidsKaroLogo size="lg" />
        <h2 className="mt-6 text-2xl font-display font-bold text-white">
          Big Screen Broadcast Paused by Host
        </h2>
        <p className="mt-2 text-sm text-slate-400 max-w-md">
          The auctioneer has temporarily unpublished the Big Screen TV display. It will resume automatically once published.
        </p>
      </div>
    );
  }

  return (
    <div className="relative rounded-2xl border border-slate-800 bg-[#050914] overflow-hidden shadow-2xl">
      {/* Subtle Stadium Broadcast Header + Invite Code & QR */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 bg-[#091122] px-6 py-3.5">
        <div className="flex items-center gap-4">
          <BidsKaroLogo size="sm" />
          <div className="hidden sm:block text-xs text-slate-400">
            <span className="font-semibold text-white">{room.roomName}</span>
            <span className="mx-2 text-slate-600">·</span>
            <span>{room.leagueId} {room.seasonYear}</span>
            <span className="mx-2 text-slate-600">·</span>
            <span>{isSnakeMode ? 'Snake Draft' : room.rules.biddingStyle === 'verbal' ? 'Verbal Table' : 'Live Auction'}</span>
          </div>
          {room.rules.aiOpponentsEnabled && (
            <span className="hidden xl:inline-flex items-center gap-1 rounded-lg border border-emerald-500/35 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-300">
              <Cpu className="w-3.5 h-3.5" />
              AI Opponents
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {room.status === 'live' && room.auctionEndDeadlineMs > 0 && (
            <div className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-mono-tabular font-bold text-amber-300">
              <Clock className="w-3.5 h-3.5" />
              <span>AUCTION CLOCK {formatClockMMSS(auctionClockSeconds)}</span>
            </div>
          )}

          {/* TV Invite Code + QR Quick Join */}
          <div className="flex items-center gap-2.5 rounded-xl border border-emerald-500/35 bg-[#060B18] px-3 py-1.5">
            <div className="bg-white p-1 rounded">
              <QRCodeSVG value={phoneJoinUrl} size={34} />
            </div>
            <div>
              <div className="text-[10px] text-slate-400 uppercase tracking-wider">Join Invite Code</div>
              <div className="text-sm font-mono-tabular font-extrabold text-emerald-400 tracking-wider">
                {room.roomCode}
              </div>
            </div>
          </div>

          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-300">
            <Radio className={`w-3.5 h-3.5 ${connected ? 'text-emerald-400' : 'text-amber-400'}`} />
            <span className="hidden md:inline">{connected ? 'Live Sync' : 'Reconnecting'}</span>
          </span>
          <button
            type="button"
            onClick={toggleFullScreen}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-emerald-500/50"
          >
            <Maximize2 className="w-3.5 h-3.5" />
            <span>Fullscreen TV</span>
          </button>
          {onExitTV && (
            <button
              type="button"
              onClick={onExitTV}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800"
            >
              Exit TV
            </button>
          )}
        </div>
      </div>

      {/* Snake Draft Turn Order Strip */}
      {isSnakeMode && currentSnakeTeam && (
        <div className="border-b border-slate-800/80 bg-[#0D162C] px-6 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2.5">
            <span className="font-mono-tabular font-bold text-amber-300">
              SNAKE DRAFT ROUND {room.snakeDraftRound} · PICK #{room.snakeDraftPickIndex + 1}
            </span>
            <span className="text-slate-500">·</span>
            <span className="text-white font-semibold">
              On the Clock: <strong className="text-emerald-400">{currentSnakeTeam.name}</strong>
            </span>
          </div>
          {upcomingSnakeTeams.length > 0 && (
            <div className="text-slate-400">
              Next up: {upcomingSnakeTeams.map((t) => t?.shortCode).join(' → ')}
            </div>
          )}
        </div>
      )}

      {/* Main Broadcast Stage */}
      <div className="relative p-6 lg:p-8 grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Left: Player Showcase Card */}
        <div className="lg:col-span-5 rounded-2xl border border-slate-800 bg-[#0B1325] overflow-hidden flex flex-col">
          <div className="relative h-64 sm:h-72 bg-[#060B18] overflow-hidden">
            <img
              src="/src/assets/images/player_batter_portrait_1795655419380.jpg"
              alt={player ? player.name : 'Cricket Auction Player'}
              referrerPolicy="no-referrer"
              className={`w-full h-full object-cover object-top ${isLobbyLocked ? 'opacity-25 blur-sm' : 'opacity-80'}`}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#0B1325] via-[#0B1325]/40 to-transparent" />
            <div className="absolute bottom-4 left-5 right-5">
              {isLobbyLocked ? (
                <div className="space-y-1.5">
                  <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-300">
                    <Lock className="w-3.5 h-3.5" />
                    <span>PRE-AUCTION BLIND VAULT</span>
                  </div>
                  <h1 className="text-2xl sm:text-3xl font-display font-extrabold tracking-tight text-white">
                    MYSTERY PLAYER POOL LOCKED UNTIL START
                  </h1>
                  <p className="text-xs text-slate-300">
                    {room.players.length} Players Staged ({room.teams.length} × {room.rules.maxSquadSize} + {room.rules.maxSquadSize})
                  </p>
                </div>
              ) : (
                <>
                  <div className="text-xs font-medium text-emerald-400">
                    {player ? `${player.category} · ${player.country}` : 'Auction Stage'}
                  </div>
                  <h1 className="mt-1 text-3xl sm:text-4xl font-display font-extrabold tracking-tight text-white">
                    {player ? player.name.toUpperCase() : 'WAITING FOR PLAYER'}
                  </h1>
                  {player && (
                    <p className="mt-1 text-xs text-slate-300">
                      {player.role} · {player.battingStyle} · {player.bowlingStyle}
                    </p>
                  )}
                </>
              )}
            </div>
          </div>

          {!isLobbyLocked && player ? (
            <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
              <div className="grid grid-cols-3 gap-3 font-mono-tabular">
                <div className="rounded-xl border border-slate-800 bg-[#060B18] p-3">
                  <div className="text-[11px] text-slate-400">MATCHES</div>
                  <div className="mt-0.5 text-lg font-bold text-white">{player.stats.matches}</div>
                </div>
                <div className="rounded-xl border border-slate-800 bg-[#060B18] p-3">
                  <div className="text-[11px] text-slate-400">
                    {player.sport === 'football' ? 'GOALS · xG' : 'RUNS · SR'}
                  </div>
                  <div className="mt-0.5 text-lg font-bold text-white">
                    {player.stats.runs} <span className="text-xs text-emerald-400">({player.stats.strikeRate})</span>
                  </div>
                </div>
                <div className="rounded-xl border border-slate-800 bg-[#060B18] p-3">
                  <div className="text-[11px] text-slate-400">
                    {player.sport === 'football' ? 'ASSISTS / CS' : 'WKTS · ECON'}
                  </div>
                  <div className="mt-0.5 text-lg font-bold text-white">
                    {player.sport === 'football'
                      ? `${player.stats.average} / ${player.stats.wickets}`
                      : (
                        <>
                          {player.stats.wickets} <span className="text-xs text-amber-300">({player.stats.economy || '—'})</span>
                        </>
                      )}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between text-xs border-t border-slate-800 pt-3">
                <span className="text-slate-400">
                  Base Price: <strong className="font-mono-tabular text-white">{formatCurrency(player.basePrice, room.rules.currency)}</strong>
                </span>
                {player.historicalPeakPrice && (
                  <span className="text-amber-300 font-medium truncate ml-2">
                    Peak: {player.historicalPeakPrice}
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div className="p-5 flex-1 flex items-center justify-center text-center text-xs text-slate-400">
              {isLobbyLocked
                ? 'Player identities and career metrics remain hidden until the auction starts.'
                : 'Ready for next player nomination.'}
            </div>
          )}
        </div>

        {/* Center/Right: Live Bid Amount, Leading Franchise, Countdown & Accepted Bid History */}
        <div className="lg:col-span-7 flex flex-col justify-between space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-stretch">
            {/* Animated Current Bid & Bidder */}
            <div className="sm:col-span-8 rounded-2xl border border-slate-800 bg-[#0B1325] p-6 flex flex-col justify-between">
              <div>
                <div className="text-xs font-semibold tracking-wider text-slate-400">
                  {highestTeam ? 'CURRENT HIGHEST BID' : 'OPENING BASE PRICE'}
                </div>
                <motion.div
                  key={`${room.bidSequence}-${room.currentBid}`}
                  initial={{ scale: 0.94, opacity: 0.6 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ duration: 0.2 }}
                  className="mt-2 text-4xl sm:text-5xl font-mono-tabular font-extrabold text-emerald-400 tracking-tight"
                >
                  {player ? formatCurrency(room.currentBid, room.rules.currency) : '—'}
                </motion.div>
              </div>

              <div className="mt-6 pt-4 border-t border-slate-800">
                {highestTeam ? (
                  <motion.div
                    key={highestTeam.id + room.bidSequence}
                    initial={{ x: -12, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    transition={{ duration: 0.22 }}
                    className="flex items-center gap-4"
                  >
                    <TeamCrest
                      shortCode={highestTeam.shortCode}
                      primaryColor={highestTeam.primaryColor}
                      secondaryColor={highestTeam.secondaryColor}
                      size="lg"
                    />
                    <div className="min-w-0">
                      <div className="text-xs text-amber-400 font-semibold">CURRENT BIDDER TEAM</div>
                      <div className="text-2xl font-display font-bold text-white truncate">
                        {highestTeam.name}
                      </div>
                      {room.rules.showBidderNameOnBigScreen && room.highestBidderName && (
                        <div className="text-xs text-slate-400">
                          Bidder: <span className="text-slate-200">{room.highestBidderName}</span>
                        </div>
                      )}
                    </div>
                  </motion.div>
                ) : (
                  <div className="flex items-center gap-3 text-slate-400 text-sm">
                    <Gavel className="w-5 h-5 text-slate-500" />
                    <span>Awaiting opening bid from any franchise...</span>
                  </div>
                )}
              </div>
            </div>

            {/* Authoritative Countdown */}
            <div className={`sm:col-span-4 rounded-2xl border p-6 flex flex-col items-center justify-center text-center transition-colors ${timerStyle.ring}`}>
              <div className="text-xs font-semibold tracking-wider text-slate-300">COUNTDOWN</div>
              <div className={`mt-2 text-6xl sm:text-7xl font-mono-tabular font-extrabold ${timerStyle.color}`}>
                {room.lotStatus === 'bidding' || room.lotStatus === 'paused'
                  ? remainingSeconds
                  : room.lotStatus === 'awaiting_hammer'
                    ? 0
                    : '--'}
              </div>
              <div className="mt-2 text-xs font-bold tracking-wide text-slate-200">
                {timerStyle.label}
              </div>
              <div className="mt-1 text-[11px] text-slate-400 font-mono-tabular">
                Reset: {room.rules.resetTimerSeconds}s per bid
              </div>
            </div>
          </div>

          {/* Accepted Bid History (Rejected bids never shown) */}
          <div className="flex-1 rounded-2xl border border-slate-800 bg-[#0B1325] p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-white">
                Accepted Bid History — Live Sequence
              </h3>
              <span className="text-xs font-mono-tabular text-slate-400">
                {room.currentLotBids.length} accepted bid(s)
              </span>
            </div>

            {room.currentLotBids.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-500">
                Live accepted bids will stream here in chronological order.
              </div>
            ) : (
              <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                {room.currentLotBids.slice(0, 8).map((bid, idx) => (
                  <motion.div
                    key={bid.id}
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`flex items-center justify-between rounded-xl border px-4 py-2.5 ${
                      idx === 0
                        ? 'border-emerald-500/40 bg-emerald-500/10'
                        : 'border-slate-800 bg-[#060B18]'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-xs font-mono-tabular text-slate-500">#{bid.sequence}</span>
                      <TeamCrest
                        shortCode={bid.teamShortCode}
                        primaryColor={bid.teamColor}
                        size="sm"
                      />
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-white truncate">{bid.teamName}</div>
                        {room.rules.showBidderNameOnBigScreen && (
                          <div className="text-[11px] text-slate-400 truncate">{bid.bidderName}</div>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0 ml-3">
                      <div className="text-base font-mono-tabular font-bold text-emerald-400">
                        {formatCurrency(bid.amount, room.rules.currency)}
                      </div>
                      <div className="text-[10px] text-slate-400 uppercase">{bid.bidType} bid</div>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* SOLD / UNSOLD Broadcast Overlay Animation */}
        <AnimatePresence>
          {(room.lotStatus === 'sold_reveal' || room.lotStatus === 'unsold_reveal') && room.lastOutcome && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-20 flex items-center justify-center bg-black/85 backdrop-blur-md p-6"
            >
              <motion.div
                initial={{ scale: 0.8, rotate: -3 }}
                animate={{ scale: 1, rotate: 0 }}
                exit={{ scale: 0.9, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 260, damping: 20 }}
                className={`w-full max-w-xl rounded-3xl border-2 p-8 text-center shadow-2xl ${
                  room.lastOutcome.status === 'sold'
                    ? 'border-amber-400 bg-gradient-to-b from-[#131F3A] to-[#060B18]'
                    : 'border-red-500/70 bg-gradient-to-b from-[#231018] to-[#060B18]'
                }`}
              >
                <div className="flex justify-center mb-4">
                  {room.lastOutcome.status === 'sold' ? (
                    <div className="w-16 h-16 rounded-2xl bg-amber-400/20 border border-amber-400 flex items-center justify-center text-amber-300">
                      <Award className="w-9 h-9" />
                    </div>
                  ) : (
                    <div className="w-16 h-16 rounded-2xl bg-red-500/20 border border-red-400 flex items-center justify-center text-red-300">
                      <ShieldCheck className="w-9 h-9" />
                    </div>
                  )}
                </div>

                <div
                  className={`inline-block rounded-lg border px-5 py-1.5 text-2xl font-display font-extrabold tracking-widest ${
                    room.lastOutcome.status === 'sold'
                      ? 'border-emerald-400 text-emerald-300 bg-emerald-500/15'
                      : 'border-red-400 text-red-300 bg-red-500/15'
                  }`}
                >
                  {room.lastOutcome.status === 'sold' ? 'SOLD!' : 'UNSOLD'}
                </div>

                <h2 className="mt-5 text-3xl sm:text-4xl font-display font-extrabold text-white">
                  {room.lastOutcome.playerName}
                </h2>
                <p className="mt-1 text-sm text-slate-300">{room.lastOutcome.playerRole}</p>

                {room.lastOutcome.status === 'sold' ? (
                  <div className="mt-6 space-y-2">
                    <div className="text-4xl font-mono-tabular font-extrabold text-amber-300">
                      {formatCurrency(room.lastOutcome.amount, room.rules.currency)}
                    </div>
                    <div className="text-base font-semibold text-white">
                      Acquired by {room.lastOutcome.teamName} ({room.lastOutcome.teamShortCode})
                    </div>
                  </div>
                ) : (
                  <div className="mt-6 text-sm text-slate-400">
                    Passed without a bid at {formatCurrency(room.lastOutcome.amount, room.rules.currency)} base price
                  </div>
                )}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Bottom Franchise Purse Strip */}
      <div className="border-t border-slate-800 bg-[#091122] px-6 py-3.5">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {room.teams.map((t) => (
            <div
              key={t.id}
              className={`rounded-xl border px-3.5 py-2.5 flex items-center justify-between gap-2 ${
                t.id === room.highestBidderTeamId
                  ? 'border-amber-400 bg-amber-500/10'
                  : 'border-slate-800 bg-[#060B18]'
              }`}
            >
              <div className="min-w-0">
                <div className="text-xs font-bold text-white truncate">{t.name}</div>
                <div className="text-[11px] text-slate-400 font-mono-tabular">
                  {t.squad.length}/{room.rules.maxSquadSize} Players
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-xs font-mono-tabular font-bold text-emerald-400">
                  {formatShortCurrency(t.remainingPurse, room.rules.currency)}
                </div>
                <div className="text-[10px] text-slate-500">LEFT</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
