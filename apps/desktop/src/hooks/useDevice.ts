import { useCallback, useEffect, useRef, useState } from 'react';
import { authFetch } from './useAuth';

const HEARTBEAT_INTERVAL = 60_000; // 60 seconds
const POLL_INTERVAL = 30_000; // 30 seconds — backup only, primary path is push-based WS
const DEVICE_ID_KEY = 'termpod-device-id';

function getOrCreateDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);

  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }

  return id;
}

async function deviceFetch(path: string, method = 'GET', body?: unknown): Promise<Response> {
  return authFetch(path, {
    method,
    body: body ? JSON.stringify(body) : undefined,
  });
}

interface PendingSession {
  sessionId: string;
  name: string;
  cwd: string;
  ptyCols: number;
  ptyRows: number;
}

export function useDevice(isAuthenticated: boolean, onCreateSessionRequest?: () => void) {
  const [deviceId] = useState(getOrCreateDeviceId);
  const [registered, setRegistered] = useState(false);
  const registeredRef = useRef(false);
  const pendingRef = useRef<PendingSession[]>([]);
  const onCreateRef = useRef(onCreateSessionRequest);
  onCreateRef.current = onCreateSessionRequest;

  // Flush any queued session registrations
  const flushPending = useCallback(async () => {
    const pending = pendingRef.current;
    pendingRef.current = [];

    for (const p of pending) {
      // Only send non-sensitive fields — real name/cwd delivered E2E encrypted via Device WS
      await deviceFetch(`/devices/${deviceId}/sessions`, 'POST', {
        id: p.sessionId,
        ptyCols: p.ptyCols,
        ptyRows: p.ptyRows,
      }).catch(() => {});
    }
  }, [deviceId]);

  // Register device on login
  useEffect(() => {
    if (!isAuthenticated) {
      setRegistered(false);
      registeredRef.current = false;
      return;
    }

    const hostname = navigator.userAgent.includes('Mac') ? 'Mac' : 'Desktop';

    deviceFetch('/devices', 'POST', {
      id: deviceId,
      name: hostname,
      deviceType: 'desktop',
      platform: 'macos',
    })
      .then((res) => {
        if (res.ok) {
          registeredRef.current = true;
          setRegistered(true);
          flushPending();
        }
      })
      .catch(() => {});

    // Poll for pending remote session creation requests
    const pollPending = async () => {
      try {
        const res = await deviceFetch(`/devices/${deviceId}/pending-requests`);

        if (res.ok) {
          const { requests } = (await res.json()) as { requests: { id: string }[] };

          if (requests.length > 0) {
            await deviceFetch(`/devices/${deviceId}/pending-requests`, 'DELETE');

            for (const _req of requests) {
              onCreateRef.current?.();
            }
          }
        }
      } catch {
        // ignore
      }
    };

    const heartbeatInterval = setInterval(() => {
      deviceFetch(`/devices/${deviceId}/heartbeat`, 'POST').catch(() => {});
    }, HEARTBEAT_INTERVAL);

    const pollInterval = setInterval(pollPending, POLL_INTERVAL);

    // Poll immediately after registration
    pollPending();

    return () => {
      clearInterval(heartbeatInterval);
      clearInterval(pollInterval);
      deviceFetch(`/devices/${deviceId}/offline`, 'POST').catch(() => {});
    };
  }, [isAuthenticated, deviceId, flushPending]);

  const registerSession = useCallback(
    async (sessionId: string, name: string, cwd: string, ptyCols: number, ptyRows: number) => {
      if (!registeredRef.current) {
        pendingRef.current.push({ sessionId, name, cwd, ptyCols, ptyRows });
        return;
      }

      // Only send non-sensitive fields — real name/cwd delivered E2E encrypted via Device WS
      await deviceFetch(`/devices/${deviceId}/sessions`, 'POST', {
        id: sessionId,
        ptyCols,
        ptyRows,
      });
    },
    [deviceId],
  );

  const updateSession = useCallback(
    async (
      _sessionId: string,
      _updates: { name?: string; cwd?: string; processName?: string | null },
    ) => {
      // No-op: session metadata is delivered E2E encrypted via Device WS (encrypted_control).
      // The relay only stores non-sensitive fields (ID, dimensions) in SQLite.
    },
    [],
  );

  const removeSession = useCallback(async (sessionId: string) => {
    await deviceFetch(`/sessions/${sessionId}`, 'DELETE');
  }, []);

  return {
    deviceId,
    registered,
    registerSession,
    updateSession,
    removeSession,
  };
}
