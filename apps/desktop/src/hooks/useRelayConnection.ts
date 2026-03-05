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

export type RelayStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

interface RelaySession {
  sessionId: string;
  token: string;
  wsUrl: string;
}

interface UseRelayConnectionOptions {
  onViewerInput?: (data: string) => void;
  onStatusChange?: (status: RelayStatus) => void;
}

const RELAY_BASE = RELAY_URL.development;
const RELAY_HTTP = RELAY_BASE.replace('ws://', 'http://').replace('wss://', 'https://');

export function useRelayConnection(options: UseRelayConnectionOptions = {}) {
  const [status, setStatus] = useState<RelayStatus>('disconnected');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [viewers, setViewers] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const connectingRef = useRef(false);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const reconnectDelayRef = useRef<number>(RECONNECT.initialDelay);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const updateStatus = useCallback((s: RelayStatus) => {
    setStatus(s);
    optionsRef.current.onStatusChange?.(s);
  }, []);

  const connect = useCallback(async (ptySize: { cols: number; rows: number }) => {
    if (wsRef.current || connectingRef.current) {
      return;
    }

    connectingRef.current = true;
    updateStatus('connecting');

    try {
      const res = await fetch(`${RELAY_HTTP}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ptySize }),
      });

      if (!res.ok) {
        throw new Error(`Failed to create session: ${res.status}`);
      }

      // Check if we were disconnected while awaiting
      if (!connectingRef.current) {
        return;
      }

      const session = (await res.json()) as RelaySession;
      setSessionId(session.sessionId);

      const wsUrl = `${RELAY_BASE}/sessions/${session.sessionId}/ws`;
      const ws = new WebSocket(wsUrl);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectDelayRef.current = RECONNECT.initialDelay;
        ws.send(JSON.stringify({
          type: 'hello',
          version: PROTOCOL_VERSION,
          role: 'desktop',
          device: 'macos',
          clientId: crypto.randomUUID(),
        }));
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
        updateStatus('disconnected');
      };

      ws.onerror = () => {
        wsRef.current = null;
        connectingRef.current = false;
        updateStatus('error');
      };
    } catch (err) {
      console.error('Relay connection failed:', err);
      connectingRef.current = false;
      updateStatus('error');
    }
  }, [updateStatus]);

  const disconnect = useCallback(() => {
    connectingRef.current = false;

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setSessionId(null);
    setViewers(0);
    updateStatus('disconnected');
  }, [updateStatus]);

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
      connectingRef.current = false;

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }

      wsRef.current?.close();
    };
  }, []);

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
