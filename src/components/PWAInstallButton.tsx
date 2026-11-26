import React, { useState } from 'react';
import { Download, Smartphone, WifiOff } from 'lucide-react';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC<{ variant?: 'compact' | 'full' }> = ({ variant = 'compact' }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  const handleClick = async () => {
    if (isInstallable) {
      await install();
    } else {
      setShowGuide(true);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className={
          variant === 'full'
            ? 'inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-2.5 text-sm font-semibold text-emerald-300 hover:bg-emerald-500/20 transition-colors whitespace-nowrap shrink-0 min-h-[44px]'
            : 'inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-200 hover:border-emerald-500/50 hover:text-emerald-300 transition-colors whitespace-nowrap shrink-0'
        }
      >
        <Download className="w-4 h-4" />
        <span>{isIOS ? 'Install App (iOS)' : 'Install App'}</span>
      </button>

      {showGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-slate-800 bg-[#0D1526] p-6 shadow-2xl">
            <div className="flex items-center gap-3 text-emerald-400">
              <Smartphone className="w-6 h-6" />
              <h3 className="text-lg font-bold text-white">Install BidsKaro App</h3>
            </div>
            <p className="mt-3 text-sm text-slate-300 leading-relaxed">
              {isIOS
                ? 'Tap the Share button in Safari, then scroll down and select "Add to Home Screen" to run BidsKaro as a full-screen mobile app.'
                : 'Install BidsKaro directly to your phone or desktop via your browser menu ("Install BidsKaro" or "Add to Home Screen") for instant full-screen auction bidding.'}
            </p>
            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="mt-5 w-full rounded-lg bg-emerald-500 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400 transition-colors"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-950/90 px-3.5 py-2 text-xs font-medium text-amber-200 shadow-lg backdrop-blur-md">
      <WifiOff className="w-4 h-4 text-amber-400" />
      <span>Offline Mode — Reconnecting when network returns</span>
    </div>
  );
};
