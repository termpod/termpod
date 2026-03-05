import { useCallback, useEffect, useRef, useState } from 'react';
import {
  PROTOCOL_VERSION,
  Channel,
  encodeTerminalData,
  encodeTerminalResize,
  decodeBinaryFrame,
} from '@termpod/protocol';
import type { RelayMessage } from '@termpod/protocol';
import { RELAY_URL, RECONNECT } from '@termpod/shared';

export type RelayStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

interface RelaySession {
  sessionId: string;
  token: string;
  wsUrl: string;
}

interface UseRelayConnectionOptions {
  onViewerInput?: (data: string) => void;
  onStatusChange?: (status: RelayStatus) => void;
  onViewerJoined?: () => void;
}

const RELAY_BASE = import.meta.env.VITE_RELAY_URL || RELAY_URL.production;
const RELAY_HTTP = RELAY_BASE.replace('ws://', 'http://').replace('wss://', 'https://');
const PING_INTERVAL = 30_000;

export function useRelayConnection(options: UseRelayConnectionOptions = {}) {
  const [status, setStatus] = useState<RelayStatus>('disconnected');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [viewers, setViewers] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const connectingRef = useRef(false);
  const intentionalCloseRef = useRef(false);
  const sessionRef = useRef<RelaySession | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const reconnectDelayRef = useRef<number>(RECONNECT.initialDelay);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Use a ref for connectWebSocket so onclose can always call the latest version
  const connectWebSocketRef = useRef<(session: RelaySession) => void>(() => {});

  const updateStatus = useCallback((s: RelayStatus) => {
    setStatus(s);
    optionsRef.current.onStatusChange?.(s);
  }, []);

  const stopPing = useCallback(() => {
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = undefined;
    }
  }, []);

  // Define connectWebSocket as a regular function, store in ref
  connectWebSocketRef.current = (session: RelaySession) => {
    // Close any existing WebSocket to prevent duplicate connections
    if (wsRef.current) {
      wsRef.current.onmessage = null;
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.close();
      wsRef.current = null;
    }

    const wsUrl = `${RELAY_BASE}/sessions/${session.sessionId}/ws`;
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;
    intentionalCloseRef.current = false;

    ws.onopen = () => {
      connectingRef.current = false;
      reconnectDelayRef.current = RECONNECT.initialDelay;

      ws.send(JSON.stringify({
        type: 'hello',
        version: PROTOCOL_VERSION,
        role: 'desktop',
        device: 'macos',
        clientId: crypto.randomUUID(),
      }));

      pingIntervalRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
        }
      }, PING_INTERVAL);
    };

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        const frame = decodeBinaryFrame(new Uint8Array(event.data));

        if (frame.channel === Channel.TERMINAL_DATA) {
          optionsRef.current.onViewerInput?.(new TextDecoder().decode(frame.data));
        }

        return;
      }

      const msg = JSON.parse(event.data) as RelayMessage;

      switch (msg.type) {
        case 'ready':
          updateStatus('connected');
          break;

        case 'client_joined':
          if (msg.role === 'viewer') {
            setViewers((v) => v + 1);
            optionsRef.current.onViewerJoined?.();
          }
          break;

        case 'client_left':
          setViewers((v) => Math.max(0, v - 1));
          break;

        case 'session_info':
          setViewers(msg.clients.filter((c) => c.role === 'viewer').length);
          break;
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
      connectingRef.current = false;
      stopPing();

      if (!intentionalCloseRef.current && sessionRef.current) {
        updateStatus('reconnecting');

        reconnectTimeoutRef.current = setTimeout(() => {
          const s = sessionRef.current;

          if (s) {
            reconnectDelayRef.current = Math.min(
              reconnectDelayRef.current * RECONNECT.backoffMultiplier,
              RECONNECT.maxDelay,
            );
            connectWebSocketRef.current(s);
          }
        }, reconnectDelayRef.current);
      } else {
        updateStatus('disconnected');
      }
    };

    ws.onerror = () => {
      // onclose will fire after onerror
    };
  };

  const ptySizeRef = useRef<{ cols: number; rows: number } | null>(null);

  const createSession = useCallback(async () => {
    const ptySize = ptySizeRef.current;

    if (!ptySize) {
      return;
    }

    try {
      const res = await fetch(`${RELAY_HTTP}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ptySize }),
      });

      if (!res.ok) {
        throw new Error(`Failed to create session: ${res.status}`);
      }

      if (!connectingRef.current) {
        return;
      }

      const session = (await res.json()) as RelaySession;
      sessionRef.current = session;
      setSessionId(session.sessionId);

      connectWebSocketRef.current(session);
    } catch (err) {
      console.error('Relay connection failed:', err);

      if (connectingRef.current) {
        updateStatus('reconnecting');

        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectDelayRef.current = Math.min(
            reconnectDelayRef.current * RECONNECT.backoffMultiplier,
            RECONNECT.maxDelay,
          );
          createSession();
        }, reconnectDelayRef.current);
      }
    }
  }, [updateStatus]);

  const connect = useCallback(async (ptySize: { cols: number; rows: number }) => {
    if (wsRef.current || connectingRef.current) {
      return;
    }

    connectingRef.current = true;
    ptySizeRef.current = ptySize;
    reconnectDelayRef.current = RECONNECT.initialDelay;
    updateStatus('connecting');

    await createSession();
  }, [updateStatus, createSession]);

  const disconnect = useCallback(() => {
    intentionalCloseRef.current = true;
    connectingRef.current = false;
    stopPing();

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    sessionRef.current = null;
    setSessionId(null);
    setViewers(0);
    updateStatus('disconnected');
  }, [updateStatus, stopPing]);

  const sendTerminalData = useCallback((data: Uint8Array | number[]) => {
    const ws = wsRef.current;

    if (ws?.readyState === WebSocket.OPEN) {
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
      ws.send(encodeTerminalData(bytes));
    }
  }, []);

  const sendResize = useCallback((cols: number, rows: number) => {
    const ws = wsRef.current;

    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(encodeTerminalResize(cols, rows));
    }
  }, []);

  useEffect(() => {
    return () => {
      intentionalCloseRef.current = true;
      connectingRef.current = false;
      stopPing();

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }

      wsRef.current?.close();
    };
  }, [stopPing]);

  return {
    status,
    sessionId,
    viewers,
    connect,
    disconnect,
    sendTerminalData,
    sendResize,
  };
}
