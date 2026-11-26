import React, { useEffect, useState } from 'react';
import { Lock, Mail, ShieldCheck, UserPlus, X } from 'lucide-react';
import { AuthUserPublic } from '../shared/auctionTypes';
import {
  claimOwnerAccount,
  fetchAuthStatus,
  loginWithEmail,
  registerWithEmail,
} from '../services/authService';

interface AuthModalProps {
  initialMode?: 'login' | 'register' | 'owner';
  onClose: () => void;
  onAuthenticated: (user: AuthUserPublic) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  initialMode = 'login',
  onClose,
  onAuthenticated,
}) => {
  const [mode, setMode] = useState<'login' | 'register' | 'owner'>(initialMode);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [hasOwner, setHasOwner] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAuthStatus().then((st) => setHasOwner(st.hasOwner)).catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      let user: AuthUserPublic;
      if (mode === 'login') {
        user = await loginWithEmail({ email, password });
      } else if (mode === 'register') {
        user = await registerWithEmail({
          name: name.trim() || email.split('@')[0] || 'Franchise Owner',
          email,
          password,
        });
      } else {
        user = await claimOwnerAccount({
          name: name.trim() || 'App Owner',
          email,
          password,
        });
      }
      onAuthenticated(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-[#0D1526] shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <div>
            <h2 className="text-lg font-display font-bold text-white">
              {mode === 'login'
                ? 'Sign In to BidsKaro'
                : mode === 'register'
                  ? 'Create BidsKaro Account'
                  : 'App Owner Setup'}
            </h2>
            <p className="text-xs text-slate-400">
              Email &amp; Password access for auctions, squads &amp; leaderboard.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 pt-4">
          <div className="flex gap-1 rounded-xl bg-[#060B18] border border-slate-800 p-1 text-xs font-semibold">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError(null);
              }}
              className={`flex-1 py-2 rounded-lg transition-colors ${
                mode === 'login' ? 'bg-emerald-500 text-slate-950' : 'text-slate-300'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setError(null);
              }}
              className={`flex-1 py-2 rounded-lg transition-colors ${
                mode === 'register' ? 'bg-emerald-500 text-slate-950' : 'text-slate-300'
              }`}
            >
              Create Account
            </button>
            {!hasOwner && (
              <button
                type="button"
                onClick={() => {
                  setMode('owner');
                  setError(null);
                }}
                className={`flex-1 py-2 rounded-lg transition-colors ${
                  mode === 'owner' ? 'bg-amber-500 text-slate-950' : 'text-amber-300'
                }`}
              >
                App Owner
              </button>
            )}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {(mode === 'register' || mode === 'owner') && (
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Full Name</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={mode === 'owner' ? 'App Owner Name' : 'e.g. Aarav Mehta'}
                className="w-full rounded-lg border border-slate-700 bg-[#060B18] px-3.5 py-2.5 text-sm text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Email Address</label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-lg border border-slate-700 bg-[#060B18] pl-10 pr-3.5 py-2.5 text-sm text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              Password {mode !== 'login' ? '(min 6 characters)' : ''}
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-lg border border-slate-700 bg-[#060B18] pl-10 pr-3.5 py-2.5 text-sm text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          {mode === 'owner' && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-[11px] text-amber-200 leading-relaxed">
              Initializes the single App Owner account with administrator privileges.
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-500/40 bg-red-950/50 px-3 py-2 text-xs text-red-200">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-emerald-500 py-3 text-sm font-bold text-slate-950 hover:bg-emerald-400 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            {mode === 'login' ? (
              <Lock className="w-4 h-4" />
            ) : mode === 'register' ? (
              <UserPlus className="w-4 h-4" />
            ) : (
              <ShieldCheck className="w-4 h-4" />
            )}
            <span>
              {loading
                ? 'Please wait...'
                : mode === 'login'
                  ? 'Sign In'
                  : mode === 'register'
                    ? 'Create Account'
                    : 'Claim App Owner Account'}
            </span>
          </button>
        </form>
      </div>
    </div>
  );
};
