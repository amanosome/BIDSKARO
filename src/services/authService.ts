import { AuthUserPublic } from '../shared/auctionTypes';

// Strict in-memory auth token store (never saved to localStorage or sessionStorage)
let memoryAuthToken: string | null = null;

export function getAuthToken(): string | null {
  return memoryAuthToken;
}

export function clearAuthToken(): void {
  memoryAuthToken = null;
}

export async function fetchAuthStatus(): Promise<{ hasOwner: boolean; ownerEmailConfigured: boolean }> {
  try {
    const res = await fetch('/api/auth/status');
    if (!res.ok) return { hasOwner: false, ownerEmailConfigured: false };
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) return { hasOwner: false, ownerEmailConfigured: false };
    return (await res.json()) as { hasOwner: boolean; ownerEmailConfigured: boolean };
  } catch {
    return { hasOwner: false, ownerEmailConfigured: false };
  }
}

export async function registerWithEmail(params: {
  name: string;
  email: string;
  password: string;
}): Promise<AuthUserPublic> {
  const res = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Could not create account.');
  }
  memoryAuthToken = data.token;
  return data.user as AuthUserPublic;
}

export async function loginWithEmail(params: {
  email: string;
  password: string;
}): Promise<AuthUserPublic> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Invalid email or password.');
  }
  memoryAuthToken = data.token;
  return data.user as AuthUserPublic;
}

export async function claimOwnerAccount(params: {
  name: string;
  email: string;
  password: string;
}): Promise<AuthUserPublic> {
  const res = await fetch('/api/auth/claim-owner', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Could not initialize App Owner account.');
  }
  memoryAuthToken = data.token;
  return data.user as AuthUserPublic;
}

export async function logoutAuth(): Promise<void> {
  memoryAuthToken = null;
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
}
