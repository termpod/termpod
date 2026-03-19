import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { RELAY_URL } from '@termpod/shared';
import { getSettingsSnapshot } from './useSettings';

const CUSTOM_RELAY_URL_KEY = 'termpod-relay-url';
const DEFAULT_RELAY_URL = 'https://relay.termpod.dev';

export function resolveRelayUrl(): string {
  const persisted = localStorage.getItem(CUSTOM_RELAY_URL_KEY)?.trim();
  if (persisted) {
    return persisted;
  }
  const fromSettings = getSettingsSnapshot().relayUrl?.trim();
  if (fromSettings) {
    return fromSettings;
  }
  return (
    (import.meta.env.VITE_RELAY_URL as string | undefined)
      ?.replace(/^wss?:\/\//, 'https://')
      .replace(/\/$/, '') ?? DEFAULT_RELAY_URL
  );
}

export function saveCustomRelayUrl(url: string): void {
  const normalized = url
    .trim()
    .replace(/^wss?:\/\//, 'https://')
    .replace(/\/$/, '');
  if (normalized) {
    localStorage.setItem(CUSTOM_RELAY_URL_KEY, normalized);
  } else {
    localStorage.removeItem(CUSTOM_RELAY_URL_KEY);
  }
}

export function getPersistedCustomRelayUrl(): string {
  return localStorage.getItem(CUSTOM_RELAY_URL_KEY)?.trim() ?? '';
}

function getRelayBase(): string {
  return resolveRelayUrl();
}

function wsToHttp(url: string): string {
  return url.replace('ws://', 'http://').replace('wss://', 'https://');
}
const STORAGE_KEY = 'termpod-auth';

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  email: string | null;
}

interface AuthStore {
  state: AuthState;
  listeners: Set<() => void>;
}

const store: AuthStore = {
  state: loadFromStorage(),
  listeners: new Set(),
};

function loadFromStorage(): AuthState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (raw) {
      return JSON.parse(raw) as AuthState;
    }
  } catch {}

  return { accessToken: null, refreshToken: null, email: null };
}

function saveToStorage(state: AuthState): void {
  if (state.accessToken) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function updateState(next: AuthState): void {
  store.state = next;
  saveToStorage(next);

  for (const listener of store.listeners) {
    listener();
  }
}

async function apiFetch(
  path: string,
  options: RequestInit & { token?: string } = {},
): Promise<Response> {
  const { token, ...fetchOptions } = options;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(fetchOptions.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  return fetch(`${wsToHttp(getRelayBase())}${path}`, { ...fetchOptions, headers });
}

export function useAuth() {
  const subscribe = useCallback((listener: () => void) => {
    store.listeners.add(listener);

    return () => {
      store.listeners.delete(listener);
    };
  }, []);

  const getSnapshot = useCallback(() => store.state, []);
  const state = useSyncExternalStore(subscribe, getSnapshot);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signup = useCallback(async (email: string, password: string) => {
    setLoading(true);
    setError(null);

    try {
      const res = await apiFetch('/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const body = (await res.json()) as { error: string };
        throw new Error(body.error || 'Signup failed');
      }

      const { accessToken, refreshToken } = (await res.json()) as {
        accessToken: string;
        refreshToken: string;
      };

      updateState({ accessToken, refreshToken, email: email.toLowerCase() });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Signup failed');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setLoading(true);
    setError(null);

    try {
      const res = await apiFetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        throw new Error('Invalid email or password');
      }

      const { accessToken, refreshToken } = (await res.json()) as {
        accessToken: string;
        refreshToken: string;
      };

      updateState({ accessToken, refreshToken, email: email.toLowerCase() });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    updateState({ accessToken: null, refreshToken: null, email: null });
  }, []);

  const refresh = useCallback(() => refreshAccessToken(), []);

  return {
    isAuthenticated: !!state.accessToken,
    email: state.email,
    accessToken: state.accessToken,
    loading,
    error,
    signup,
    login,
    logout,
    refresh,
  };
}

async function refreshAccessToken(): Promise<boolean> {
  const { refreshToken } = store.state;

  if (!refreshToken) {
    return false;
  }

  try {
    const res = await apiFetch('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    });

    if (!res.ok) {
      updateState({ accessToken: null, refreshToken: null, email: null });

      return false;
    }

    const body = (await res.json()) as { accessToken: string; refreshToken: string };
    updateState({ ...store.state, accessToken: body.accessToken, refreshToken: body.refreshToken });

    return true;
  } catch {
    return false;
  }
}

// Auto-refresh access token every 12 minutes (token expires in 15 min)
const TOKEN_REFRESH_INTERVAL = 12 * 60 * 1000;
let refreshInterval: ReturnType<typeof setInterval> | undefined;

function startAutoRefresh(): void {
  if (refreshInterval) {
    return;
  }

  refreshInterval = setInterval(() => {
    if (store.state.accessToken) {
      refreshAccessToken();
    }
  }, TOKEN_REFRESH_INTERVAL);
}

function stopAutoRefresh(): void {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = undefined;
  }
}

// Start auto-refresh if we already have a token
if (store.state.accessToken) {
  refreshAccessToken();
  startAutoRefresh();
}

// Listen for state changes to start/stop auto-refresh
store.listeners.add(() => {
  if (store.state.accessToken) {
    startAutoRefresh();
  } else {
    stopAutoRefresh();
  }
});

// Utility for other hooks to get the current token
export function getAccessToken(): string | null {
  return store.state.accessToken;
}

/**
 * Get a valid access token, refreshing if needed.
 * Returns null only if refresh also fails (truly logged out).
 */
export async function getValidAccessToken(): Promise<string | null> {
  const token = store.state.accessToken;

  if (token && !isTokenExpiringSoon(token)) {
    return token;
  }

  const refreshed = await refreshAccessToken();

  return refreshed ? store.state.accessToken : null;
}

function isTokenExpiringSoon(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    const now = Math.floor(Date.now() / 1000);

    return payload.exp - now < 60;
  } catch {
    return true;
  }
}

let refreshPromise: Promise<boolean> | null = null;

/**
 * Fetch wrapper that auto-refreshes on 401 and retries once.
 */
export async function authFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = await getValidAccessToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const url = `${wsToHttp(getRelayBase())}${path}`;
  const res = await fetch(url, { ...options, headers });

  if (res.status !== 401 || !store.state.refreshToken) {
    return res;
  }

  // Deduplicate concurrent refresh attempts
  if (!refreshPromise) {
    refreshPromise = refreshAccessToken().finally(() => {
      refreshPromise = null;
    });
  }

  const refreshed = await refreshPromise;

  if (!refreshed) {
    return res;
  }

  const newToken = store.state.accessToken;
  headers['Authorization'] = `Bearer ${newToken}`;

  return fetch(url, { ...options, headers });
}

export function getRelayHttp(): string {
  return wsToHttp(getRelayBase());
}

// --- Subscription ---

export interface SubscriptionState {
  plan: 'free' | 'pro';
  effectivePlan: 'free' | 'pro';
  trialEndsAt: number | null;
  planExpiresAt: number | null;
  cancelAtPeriodEnd: boolean;
  selfHosted: boolean;
}

interface SubscriptionStore {
  state: SubscriptionState | null;
  listeners: Set<() => void>;
}

const subscriptionStore: SubscriptionStore = {
  state: null,
  listeners: new Set(),
};

function updateSubscriptionState(next: SubscriptionState | null): void {
  subscriptionStore.state = next;

  for (const listener of subscriptionStore.listeners) {
    listener();
  }
}

let lastSubscriptionFetchAt = 0;

async function fetchSubscription(): Promise<void> {
  if (!store.state.accessToken) {
    updateSubscriptionState(null);
    return;
  }

  try {
    const res = await authFetch('/subscription');

    if (!res.ok) {
      return;
    }

    const data = (await res.json()) as SubscriptionState;
    updateSubscriptionState(data);
    lastSubscriptionFetchAt = Date.now();
  } catch {}
}

export function useSubscription() {
  const subscribe = useCallback((listener: () => void) => {
    subscriptionStore.listeners.add(listener);

    return () => {
      subscriptionStore.listeners.delete(listener);
    };
  }, []);

  const getSnapshot = useCallback(() => subscriptionStore.state, []);
  const state = useSyncExternalStore(subscribe, getSnapshot);

  const isPro = state?.effectivePlan === 'pro';
  const isOnTrial = !!(
    state?.trialEndsAt &&
    Date.now() < state.trialEndsAt &&
    state.plan !== 'pro'
  );
  const trialDaysLeft = state?.trialEndsAt
    ? Math.max(0, Math.ceil((state.trialEndsAt - Date.now()) / (24 * 60 * 60 * 1000)))
    : 0;

  return {
    subscription: state,
    isPro,
    isOnTrial,
    trialDaysLeft,
    selfHosted: state?.selfHosted ?? false,
    refetch: fetchSubscription,
  };
}

// Fetch subscription on login, clear on logout
store.listeners.add(() => {
  if (store.state.accessToken) {
    fetchSubscription();
  } else {
    updateSubscriptionState(null);
  }
});

// Fetch on initial load if already authenticated
if (store.state.accessToken) {
  fetchSubscription();
}

// Re-fetch subscription when app regains focus (e.g. user upgraded in browser)
const SUBSCRIPTION_DEBOUNCE = 10_000;

document.addEventListener('visibilitychange', () => {
  if (
    document.visibilityState === 'visible' &&
    store.state.accessToken &&
    Date.now() - lastSubscriptionFetchAt > SUBSCRIPTION_DEBOUNCE
  ) {
    lastSubscriptionFetchAt = Date.now();
    fetchSubscription();
  }
});
