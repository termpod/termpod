import { useCallback, useEffect, useRef, useState } from 'react';
import { RECONNECT, RELAY_URL } from '@termpod/shared';
import { getAccessToken, getValidAccessToken } from './useAuth';
import { getSettingsSnapshot } from './useSettings';

const PING_INTERVAL = 30_000;

function getRelayBase(): string {
  const custom = getSettingsSnapshot().relayUrl?.trim();
  return custom || import.meta.env.VITE_RELAY_URL || RELAY_URL.production;
}

export type DeviceWSStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

interface DeviceWSOptions {
  /** Handle create_session_request from mobile viewer */
  onCreateSessionRequest?: (requestId: string) => void;
  /** Handle delete_session from mobile viewer */
  onDeleteSession?: (sessionId: string) => void;
  /** Handle list_sessions — return current sessions list */
  getSessionsList?: () => Record<string, unknown>[];
  /** Handle WebRTC signaling from mobile */
  onSignaling?: (msg: Record<string, unknown>) => void;
  /** Handle client joined (mobile connected to device WS) */
  onClientJoined?: (clientId: string, device: string) => void;
  /** Handle client left */
  onClientLeft?: (clientId: string) => void;
}

/**
 * Persistent device-level WebSocket to the relay's User DO.
 * Used for control messages (list/create/delete sessions),
 * WebRTC signaling, and heartbeat (replaces HTTP polling).
 */
export function useDeviceWS(deviceId: string | null, isAuthenticated: boolean, options: DeviceWSOptions = {}) {
  const [status, setStatus] = useState<DeviceWSStatus>('disconnected');
  const wsRef = useRef<WebSocket | null>(null);
  const intentionalCloseRef = useRef(false);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const reconnectDelayRef = useRef(RECONNECT.initialDelay);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const clientIdRef = useRef(crypto.randomUUID());
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const connectRef = useRef<() => void>(() => {});

  const stopPing = useCallback(() => {
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = undefined;
    }
  }, []);

  connectRef.current = () => {
    if (!deviceId) {
      return;
    }

    // Close any existing connection
    if (wsRef.current) {
      wsRef.current.onmessage = null;
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.close();
      wsRef.current = null;
    }

    const token = getAccessToken();
    const wsUrl = `${getRelayBase()}/devices/${deviceId}/ws${token ? `?token=${encodeURIComponent(token)}` : ''}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    intentionalCloseRef.current = false;

    ws.onopen = () => {
      reconnectDelayRef.current = RECONNECT.initialDelay;

      // Send hello immediately — auth is via URL token
      ws.send(JSON.stringify({
        type: 'hello',
        role: 'desktop',
        device: 'macos',
        clientId: clientIdRef.current,
        version: 1,
      }));
    };

    ws.onmessage = (event) => {
      if (typeof event.data !== 'string') {
        return; // Device WS is JSON-only
      }

      let msg: Record<string, unknown>;

      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      const type = msg.type as string;

      switch (type) {
        case 'auth_ok':
          // No-op: auth is now via URL token, hello sent on open
          break;

        case 'hello_ok':
          setStatus('connected');

          // Start keepalive ping
          pingIntervalRef.current = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
            }
          }, PING_INTERVAL);
          break;

        case 'client_joined':
          optionsRef.current.onClientJoined?.(
            msg.clientId as string,
            msg.device as string,
          );
          break;

        case 'client_left':
          optionsRef.current.onClientLeft?.(msg.clientId as string);
          break;

        case 'list_sessions':
          // Mobile requested session list — this shouldn't normally happen
          // (User DO responds from SQLite), but handle as fallback
          break;

        case 'create_session_request':
          if (msg.requestId) {
            optionsRef.current.onCreateSessionRequest?.(msg.requestId as string);
          }
          break;

        case 'delete_session':
          if (msg.sessionId) {
            optionsRef.current.onDeleteSession?.(msg.sessionId as string);
          }
          break;

        case 'webrtc_offer':
        case 'webrtc_answer':
        case 'webrtc_ice':
          optionsRef.current.onSignaling?.(msg);
          break;
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
      stopPing();

      if (!intentionalCloseRef.current && deviceId) {
        setStatus('reconnecting');

        reconnectTimeoutRef.current = setTimeout(async () => {
          reconnectDelayRef.current = Math.min(
            reconnectDelayRef.current * RECONNECT.backoffMultiplier,
            RECONNECT.maxDelay,
          );
          await getValidAccessToken();
          connectRef.current();
        }, reconnectDelayRef.current);
      } else {
        setStatus('disconnected');
      }
    };

    ws.onerror = () => {
      // onclose fires after onerror
    };

    setStatus('connecting');
  };

  // Connect when authenticated and device is registered
  useEffect(() => {
    if (!isAuthenticated || !deviceId) {
      return;
    }

    connectRef.current();

    return () => {
      intentionalCloseRef.current = true;
      stopPing();

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }

      wsRef.current?.close();
      wsRef.current = null;
      setStatus('disconnected');
    };
  }, [isAuthenticated, deviceId, stopPing]);

  /** Send sessions_updated to relay (updates SQLite + broadcasts to mobile viewers) */
  const sendSessionsUpdated = useCallback((sessions: Record<string, unknown>[]) => {
    const ws = wsRef.current;

    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'sessions_updated', sessions }));
    }
  }, []);

  /** Send session_created response to mobile viewer */
  const sendSessionCreated = useCallback((msg: Record<string, unknown>) => {
    const ws = wsRef.current;

    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'session_created', ...msg }));
    }
  }, []);

  /** Send session_closed notification */
  const sendSessionClosed = useCallback((sessionId: string) => {
    const ws = wsRef.current;

    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'session_closed', sessionId }));
    }
  }, []);

  /** Send WebRTC signaling message */
  const sendSignaling = useCallback((msg: Record<string, unknown>) => {
    const ws = wsRef.current;

    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  return {
    status,
    clientId: clientIdRef.current,
    sendSessionsUpdated,
    sendSessionCreated,
    sendSessionClosed,
    sendSignaling,
  };
}
