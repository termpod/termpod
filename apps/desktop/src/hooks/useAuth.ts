import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { RELAY_URL } from '@termpod/shared';

const RELAY_BASE = import.meta.env.VITE_RELAY_URL || RELAY_URL.production;
const RELAY_HTTP = RELAY_BASE.replace('ws://', 'http://').replace('wss://', 'https://');
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

  return fetch(`${RELAY_HTTP}${path}`, { ...fetchOptions, headers });
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
        const body = await res.json() as { error: string };
        throw new Error(body.error || 'Signup failed');
      }

      const { accessToken, refreshToken } = await res.json() as {
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

      const { accessToken, refreshToken } = await res.json() as {
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

    const body = await res.json() as { accessToken: string; refreshToken: string };
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

export function getRelayHttp(): string {
  return RELAY_HTTP;
}
