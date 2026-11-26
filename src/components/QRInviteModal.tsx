import React, { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Check, Copy, Monitor, Smartphone, X } from 'lucide-react';
import { AuctionRoomState } from '../shared/auctionTypes';

interface QRInviteModalProps {
  room: AuctionRoomState;
  onClose: () => void;
}

export const QRInviteModal: React.FC<QRInviteModalProps> = ({ room, onClose }) => {
  const [selectedTeamId, setSelectedTeamId] = useState<string>(room.teams[0]?.id || '');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const mobileJoinUrl = `${origin}/?room=${encodeURIComponent(room.roomCode)}&view=bidder${
    selectedTeamId ? `&team=${encodeURIComponent(selectedTeamId)}` : ''
  }`;
  const bigScreenUrl = `${origin}/?room=${encodeURIComponent(room.roomCode)}&view=tv`;

  const copyText = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(null), 1800);
    } catch {
      // ignore clipboard errors
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm overflow-y-auto">
      <div className="w-full max-w-2xl rounded-2xl border border-slate-800 bg-[#0D1526] shadow-2xl my-8">
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <div>
            <h2 className="text-lg font-display font-bold text-white">
              BidsKaro Room Invitations &amp; QR Join
            </h2>
            <p className="text-xs text-slate-400">
              Room Code: <span className="font-mono-tabular font-bold text-emerald-400">{room.roomCode}</span> · Scan from any phone to join immediately
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

        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Mobile Bidder QR */}
          <div className="rounded-xl border border-slate-800 bg-[#060B18] p-5 flex flex-col items-center text-center space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-emerald-400">
              <Smartphone className="w-4 h-4" />
              <span>Team Owner Mobile QR</span>
            </div>

            <div className="w-full">
              <label className="block text-[11px] text-slate-400 mb-1 text-left">
                Assign Team for Direct Link
              </label>
              <select
                value={selectedTeamId}
                onChange={(e) => setSelectedTeamId(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-[#0D1526] px-3 py-2 text-xs text-white"
              >
                <option value="">Any Available Team</option>
                {room.teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.ownerName})
                  </option>
                ))}
              </select>
            </div>

            <div className="rounded-xl bg-white p-3.5 shadow-inner">
              <QRCodeSVG value={mobileJoinUrl} size={172} level="M" />
            </div>

            <div className="w-full space-y-2">
              <div className="rounded-lg border border-slate-800 bg-[#0D1526] px-3 py-2 text-[11px] font-mono-tabular text-slate-300 truncate">
                {mobileJoinUrl}
              </div>
              <button
                type="button"
                onClick={() => copyText(mobileJoinUrl, 'mobile')}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-500 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-400 transition-colors"
              >
                {copiedKey === 'mobile' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedKey === 'mobile' ? 'Copied Mobile Invite Link' : 'Copy Team Invite Link'}</span>
              </button>
            </div>
          </div>

          {/* Big Screen TV QR */}
          <div className="rounded-xl border border-slate-800 bg-[#060B18] p-5 flex flex-col items-center text-center space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-amber-400">
              <Monitor className="w-4 h-4" />
              <span>Big Screen TV Broadcast</span>
            </div>
            <p className="text-xs text-slate-400">
              Open on a projector, smart TV, or secondary monitor for live synchronized auction visuals.
            </p>
            <div className="rounded-xl bg-white p-3.5 shadow-inner">
              <QRCodeSVG value={bigScreenUrl} size={172} level="M" />
            </div>
            <div className="w-full space-y-2">
              <div className="rounded-lg border border-slate-800 bg-[#0D1526] px-3 py-2 text-[11px] font-mono-tabular text-slate-300 truncate">
                {bigScreenUrl}
              </div>
              <button
                type="button"
                onClick={() => copyText(bigScreenUrl, 'tv')}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 py-2 text-xs font-bold text-amber-300 hover:bg-amber-500/20 transition-colors"
              >
                {copiedKey === 'tv' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedKey === 'tv' ? 'Copied Big Screen URL' : 'Copy Big Screen URL'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
