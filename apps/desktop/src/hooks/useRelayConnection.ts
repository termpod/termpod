import { useCallback, useEffect, useRef, useState } from 'react';
import {
  PROTOCOL_VERSION,
  Channel,
  encodeTerminalData,
  encodeTerminalResize,
  decodeBinaryFrame,
  generateKeyPair,
  deriveSessionKey,
  encryptFrame,
  decryptFrame,
} from '@termpod/protocol';
import type { RelayMessage, E2ESession } from '@termpod/protocol';
import { RELAY_URL, RECONNECT } from '@termpod/shared';
import { getAccessToken, getValidAccessToken } from './useAuth';
import { getSettingsSnapshot } from './useSettings';

export type RelayStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

export interface ConnectedDevice {
  clientId: string;
  device: string;
  transport: 'relay' | 'local' | 'webrtc';
  connectedAt: string;
}

export interface MergedDevice {
  device: string;
  transports: string[];
  connectedAt: string;
}

interface RelaySession {
  sessionId: string;
}

interface UseRelayConnectionOptions {
  onViewerInput?: (data: string) => void;
  onStatusChange?: (status: RelayStatus) => void;
  onViewerJoined?: (clientId: string) => void;
  onViewerLeft?: () => void;
  onViewerResize?: (cols: number, rows: number) => void;
  onSignaling?: (msg: Record<string, unknown>) => void;
  onCreateSessionRequest?: (requestId: string) => void;
  onSessionClosed?: () => void;
}

function getRelayBase(): string {
  const custom = getSettingsSnapshot().relayUrl?.trim();
  return custom || import.meta.env.VITE_RELAY_URL || RELAY_URL.production;
}
const PING_INTERVAL = 30_000;

export function useRelayConnection(options: UseRelayConnectionOptions = {}) {
  const [status, setStatus] = useState<RelayStatus>('disconnected');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [viewers, setViewers] = useState(0);
  const [connectedDevices, setConnectedDevices] = useState<ConnectedDevice[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const connectingRef = useRef(false);
  const intentionalCloseRef = useRef(false);
  const sessionRef = useRef<RelaySession | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const reconnectDelayRef = useRef<number>(RECONNECT.initialDelay);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const clientIdRef = useRef<string>(crypto.randomUUID());
  const e2eRef = useRef<E2ESession | null>(null);
  const e2eKeyPairRef = useRef<{ publicKeyJwk: JsonWebKey; privateKey: CryptoKey } | null>(null);
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

    const wsUrl = `${getRelayBase()}/sessions/${session.sessionId}/ws`;
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;
    intentionalCloseRef.current = false;

    ws.onopen = () => {
      connectingRef.current = false;
      reconnectDelayRef.current = RECONNECT.initialDelay;

      // Send auth as first message (token is NOT in the URL)
      const token = getAccessToken();

      if (token) {
        ws.send(JSON.stringify({ type: 'auth', token }));
      }
    };

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        const raw = new Uint8Array(event.data);

        // Handle E2E encrypted frames
        if (raw[0] === Channel.ENCRYPTED && e2eRef.current) {
          decryptFrame(e2eRef.current, raw.subarray(1))
            .then((plaintext) => {
              const inner = decodeBinaryFrame(plaintext);

              if (inner.channel === Channel.TERMINAL_DATA) {
                optionsRef.current.onViewerInput?.(new TextDecoder().decode(inner.data));
              }
            })
            .catch((err) => {
              console.error('[Relay] E2E decrypt failed:', err);
            });

          return;
        }

        const frame = decodeBinaryFrame(raw);

        if (frame.channel === Channel.TERMINAL_DATA) {
          optionsRef.current.onViewerInput?.(new TextDecoder().decode(frame.data));
        }

        return;
      }

      const raw = JSON.parse(event.data) as Record<string, unknown>;

      // Handle E2E key exchange (not in RelayMessage type union)
      if (raw.type === 'key_exchange_ack') {
        if (e2eKeyPairRef.current && raw.publicKey) {
          deriveSessionKey(
            e2eKeyPairRef.current.privateKey,
            raw.publicKey as JsonWebKey,
            session.sessionId,
          ).then((e2eSession) => {
            e2eRef.current = e2eSession;
            console.log('[Relay] E2E encryption active for session', session.sessionId);
          }).catch((err) => {
            console.error('[Relay] E2E key derivation failed:', err);
          });
        }

        return;
      }

      const msg = raw as unknown as RelayMessage;

      switch (msg.type) {
        case 'auth_ok':
          // Auth confirmed — send hello and start ping
          ws.send(JSON.stringify({
            type: 'hello',
            version: PROTOCOL_VERSION,
            role: 'desktop',
            device: 'macos',
            clientId: clientIdRef.current,
          }));

          pingIntervalRef.current = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
            }
          }, PING_INTERVAL);

          // Initiate E2E key exchange
          e2eRef.current = null;
          generateKeyPair().then((kp) => {
            e2eKeyPairRef.current = kp;

            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                type: 'key_exchange',
                publicKey: kp.publicKeyJwk,
                sessionId: session.sessionId,
              }));
            }
          });
          break;

        case 'ready':
          updateStatus('connected');
          break;

        case 'client_joined':
          if (msg.role === 'viewer') {
            setViewers((v) => v + 1);
            setConnectedDevices((prev) => [
              ...prev.filter((d) => d.clientId !== msg.clientId),
              { clientId: msg.clientId, device: msg.device, transport: 'relay', connectedAt: new Date().toISOString() },
            ]);
            optionsRef.current.onViewerJoined?.(msg.clientId);
          }
          break;

        case 'client_left':
          setViewers((v) => Math.max(0, v - 1));
          if ('clientId' in msg) {
            setConnectedDevices((prev) => prev.filter((d) => d.clientId !== (msg as { clientId: string }).clientId));
          }
          optionsRef.current.onViewerLeft?.();
          break;

        case 'session_info':
          setViewers(msg.clients.filter((c) => c.role === 'viewer').length);
          setConnectedDevices(
            msg.clients
              .filter((c) => c.role === 'viewer')
              .map((c) => ({ clientId: c.clientId, device: c.device, transport: 'relay' as const, connectedAt: c.connectedAt })),
          );
          break;

        case 'pty_resize':
          if ('cols' in msg && 'rows' in msg) {
            optionsRef.current.onViewerResize?.(msg.cols as number, msg.rows as number);
          }
          break;

        case 'webrtc_offer':
        case 'webrtc_answer':
        case 'webrtc_ice':
          optionsRef.current.onSignaling?.(msg as unknown as Record<string, unknown>);
          break;

        case 'create_session_request':
          if ('requestId' in msg) {
            optionsRef.current.onCreateSessionRequest?.(
              (msg as unknown as { requestId: string }).requestId,
            );
          }
          break;

        case 'session_closed':
          intentionalCloseRef.current = true;
          optionsRef.current.onSessionClosed?.();
          break;
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
      connectingRef.current = false;
      stopPing();

      if (!intentionalCloseRef.current && sessionRef.current) {
        updateStatus('reconnecting');

        reconnectTimeoutRef.current = setTimeout(async () => {
          const s = sessionRef.current;

          if (s) {
            reconnectDelayRef.current = Math.min(
              reconnectDelayRef.current * RECONNECT.backoffMultiplier,
              RECONNECT.maxDelay,
            );
            // Ensure token is fresh before reconnecting
            await getValidAccessToken();
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
    if (!ptySizeRef.current || !connectingRef.current) {
      return;
    }

    const relaySessionId = crypto.randomUUID();
    const session: RelaySession = { sessionId: relaySessionId };
    sessionRef.current = session;
    setSessionId(relaySessionId);

    connectWebSocketRef.current(session);
  }, []);

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
    e2eRef.current = null;
    e2eKeyPairRef.current = null;

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
    setConnectedDevices([]);
    updateStatus('disconnected');
  }, [updateStatus, stopPing]);

  const sendTerminalData = useCallback((data: Uint8Array | number[]) => {
    const ws = wsRef.current;

    if (ws?.readyState === WebSocket.OPEN) {
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
      const plainFrame = encodeTerminalData(bytes);

      if (e2eRef.current) {
        encryptFrame(e2eRef.current, plainFrame).then((encrypted) => {
          if (ws.readyState === WebSocket.OPEN) {
            const frame = new Uint8Array(1 + encrypted.length);
            frame[0] = Channel.ENCRYPTED;
            frame.set(encrypted, 1);
            ws.send(frame);
          }
        });
      } else {
        ws.send(plainFrame);
      }
    }
  }, []);

  const sendResize = useCallback((cols: number, rows: number) => {
    const ws = wsRef.current;

    if (ws?.readyState === WebSocket.OPEN) {
      const plainFrame = encodeTerminalResize(cols, rows);

      if (e2eRef.current) {
        encryptFrame(e2eRef.current, plainFrame).then((encrypted) => {
          if (ws.readyState === WebSocket.OPEN) {
            const frame = new Uint8Array(1 + encrypted.length);
            frame[0] = Channel.ENCRYPTED;
            frame.set(encrypted, 1);
            ws.send(frame);
          }
        });
      } else {
        ws.send(plainFrame);
      }
    }
  }, []);

  const sendSignaling = useCallback((msg: Record<string, unknown>) => {
    const ws = wsRef.current;

    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  const sendSessionCreated = useCallback(
    (requestId: string, sessionId: string, name: string, cwd: string, ptyCols: number, ptyRows: number) => {
      const ws = wsRef.current;

      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'session_created',
          requestId,
          sessionId,
          name,
          cwd,
          ptyCols,
          ptyRows,
        }));
      }
    },
    [],
  );

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
    connectedDevices,
    clientId: clientIdRef.current,
    connect,
    disconnect,
    sendTerminalData,
    sendResize,
    sendSignaling,
    sendSessionCreated,
  };
}
