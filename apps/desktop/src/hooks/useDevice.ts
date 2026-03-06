import { useCallback, useEffect, useRef, useState } from 'react';
import { getAccessToken, getRelayHttp } from './useAuth';

const HEARTBEAT_INTERVAL = 30_000; // 30 seconds
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
  const token = getAccessToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  return fetch(`${getRelayHttp()}${path}`, {
    method,
    headers,
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

export function useDevice(isAuthenticated: boolean) {
  const [deviceId] = useState(getOrCreateDeviceId);
  const [registered, setRegistered] = useState(false);
  const heartbeatRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const registeredRef = useRef(false);
  const pendingRef = useRef<PendingSession[]>([]);

  // Flush any queued session registrations
  const flushPending = useCallback(async () => {
    const pending = pendingRef.current;
    pendingRef.current = [];

    for (const p of pending) {
      await deviceFetch(`/devices/${deviceId}/sessions`, 'POST', {
        id: p.sessionId,
        name: p.name,
        cwd: p.cwd,
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

    // Start heartbeat
    heartbeatRef.current = setInterval(() => {
      deviceFetch(`/devices/${deviceId}/heartbeat`, 'POST').catch(() => {});
    }, HEARTBEAT_INTERVAL);

    return () => {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
      }

      // Mark device offline on cleanup
      deviceFetch(`/devices/${deviceId}/offline`, 'POST').catch(() => {});
    };
  }, [isAuthenticated, deviceId, flushPending]);

  const registerSession = useCallback(
    async (sessionId: string, name: string, cwd: string, ptyCols: number, ptyRows: number) => {
      if (!registeredRef.current) {
        // Queue for later — device registration hasn't completed yet
        pendingRef.current.push({ sessionId, name, cwd, ptyCols, ptyRows });

        return;
      }

      await deviceFetch(`/devices/${deviceId}/sessions`, 'POST', {
        id: sessionId,
        name,
        cwd,
        ptyCols,
        ptyRows,
      });
    },
    [deviceId],
  );

  const removeSession = useCallback(
    async (sessionId: string) => {
      await deviceFetch(`/sessions/${sessionId}`, 'DELETE');
    },
    [],
  );

  return {
    deviceId,
    registered,
    registerSession,
    removeSession,
  };
}
