import { useCallback, useEffect, useRef, useState } from 'react';
import { RECONNECT, RELAY_URL } from '@termpod/shared';
import { getAccessToken, getValidAccessToken } from './useAuth';
import { getSettingsSnapshot } from './useSettings';
import { getLocalAuthSecret } from './localAuthSecret';
import {
  generateKeyPair,
  deriveSessionKey,
  encryptFrame,
  decryptFrame,
  type E2EKeyPair,
  type E2ESession,
} from '@termpod/protocol';

const PING_INTERVAL = 30_000;

// Module-level refs for sendLocalAuthSecretToRelay
let _deviceWS: WebSocket | null = null;
let _e2eSessions: Map<string, E2ESession> | null = null;
let _deviceId: string | null = null;
let _keyPair: E2EKeyPair | null = null;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64urlEncode(data: Uint8Array): string {
  const binary = Array.from(data, (b) => String.fromCharCode(b)).join('');
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - (str.length % 4)) % 4);
  const binary = atob(padded);
  return new Uint8Array(Array.from(binary, (c) => c.charCodeAt(0)));
}

async function sendEncrypted(ws: WebSocket, e2eSessions: Map<string, E2ESession>, msg: Record<string, unknown>, toClientId?: string): Promise<void> {
  const plaintext = encoder.encode(JSON.stringify(msg));

  if (toClientId) {
    // Send to specific viewer
    const session = e2eSessions.get(toClientId);

    if (session) {
      const encrypted = await encryptFrame(session, plaintext);
      ws.send(JSON.stringify({ type: 'encrypted_control', payload: base64urlEncode(encrypted), toClientId }));
    }
  } else {
    // Broadcast to all viewers
    for (const [clientId, session] of e2eSessions) {
      const encrypted = await encryptFrame(session, plaintext);
      ws.send(JSON.stringify({ type: 'encrypted_control', payload: base64urlEncode(encrypted), toClientId: clientId }));
    }
  }
}

/** Called by useLocalServer when the local server finishes starting and the auth secret is available. */
export function sendLocalAuthSecretToRelay(): void {
  const secret = getLocalAuthSecret();

  if (secret && _deviceWS?.readyState === WebSocket.OPEN && _e2eSessions && _e2eSessions.size > 0) {
    sendEncrypted(_deviceWS, _e2eSessions, { type: 'local_auth_secret', secret });
  }
}

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
 *
 * All sensitive messages are E2E encrypted (ECDH P-256 + AES-256-GCM).
 */
export function useDeviceWS(deviceId: string | null, isAuthenticated: boolean, options: DeviceWSOptions = {}) {
  const [status, setStatus] = useState<DeviceWSStatus>('disconnected');
  const wsRef = useRef<WebSocket | null>(null);
  const intentionalCloseRef = useRef(false);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const reconnectDelayRef = useRef<number>(RECONNECT.initialDelay);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const clientIdRef = useRef(crypto.randomUUID());
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // E2E state: one session per connected viewer
  const keyPairRef = useRef<E2EKeyPair | null>(null);
  const e2eSessionsRef = useRef<Map<string, E2ESession>>(new Map());
  // Queue messages until E2E is established with at least one viewer
  const pendingEncryptedRef = useRef<{ msg: Record<string, unknown>; toClientId?: string }[]>([]);

  const connectRef = useRef<() => void>(() => {});

  const stopPing = useCallback(() => {
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = undefined;
    }
  }, []);

  const flushPendingEncrypted = useCallback(async (ws: WebSocket, sessions: Map<string, E2ESession>) => {
    const pending = pendingEncryptedRef.current;
    pendingEncryptedRef.current = [];

    for (const { msg, toClientId } of pending) {
      if (ws.readyState === WebSocket.OPEN) {
        await sendEncrypted(ws, sessions, msg, toClientId);
      }
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

    // Reset E2E state on reconnect
    keyPairRef.current = null;
    e2eSessionsRef.current = new Map();
    _e2eSessions = e2eSessionsRef.current;
    _keyPair = null;
    pendingEncryptedRef.current = [];

    const token = getAccessToken();
    const wsUrl = `${getRelayBase()}/devices/${deviceId}/ws${token ? `?token=${encodeURIComponent(token)}` : ''}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    _deviceWS = ws;
    _deviceId = deviceId;
    intentionalCloseRef.current = false;

    ws.onopen = () => {
      reconnectDelayRef.current = RECONNECT.initialDelay;

      // Send auth as first message — DO validates JWT before accepting hello
      const token = getAccessToken();

      if (token) {
        ws.send(JSON.stringify({ type: 'auth', token }));
      }
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
          // Auth accepted — now send hello to complete handshake
          ws.send(JSON.stringify({
            type: 'hello',
            role: 'desktop',
            device: 'macos',
            clientId: clientIdRef.current,
            version: 1,
          }));
          break;

        case 'hello_ok':
          setStatus('connected');

          // Start keepalive ping
          pingIntervalRef.current = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
            }
          }, PING_INTERVAL);

          // Generate E2E key pair for device-level encryption
          generateKeyPair().then((kp) => {
            keyPairRef.current = kp;
            _keyPair = kp;

            // Send public key to any existing viewers
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                type: 'device_key_exchange',
                publicKey: kp.publicKeyJwk,
                deviceId,
              }));
            }
          });
          break;

        case 'device_key_exchange_ack': {
          // Viewer responded with their public key
          const fromClientId = msg.fromClientId as string;
          const peerKey = msg.publicKey as JsonWebKey;
          const kp = keyPairRef.current;

          if (kp && peerKey && fromClientId && deviceId) {
            deriveSessionKey(kp.privateKey, peerKey, deviceId).then(async (e2e) => {
              e2eSessionsRef.current.set(fromClientId, e2e);
              _e2eSessions = e2eSessionsRef.current;

              // Flush queued messages to this viewer
              if (ws.readyState === WebSocket.OPEN) {
                await flushPendingEncrypted(ws, e2eSessionsRef.current);

                // Send local auth secret now that E2E is established
                const secret = getLocalAuthSecret();

                if (secret) {
                  await sendEncrypted(ws, e2eSessionsRef.current, { type: 'local_auth_secret', secret }, fromClientId);
                }
              }
            });
          }
          break;
        }

        case 'encrypted_control': {
          // Viewer sent an encrypted message — decrypt and dispatch
          const fromClientId = msg.fromClientId as string;
          const payload = msg.payload as string;
          const session = e2eSessionsRef.current.get(fromClientId);

          if (session && payload) {
            const encrypted = base64urlDecode(payload);
            decryptFrame(session, encrypted).then((plaintext) => {
              const inner = JSON.parse(decoder.decode(plaintext)) as Record<string, unknown>;
              const innerType = inner.type as string;

              switch (innerType) {
                case 'create_session_request':
                  if (inner.requestId) {
                    optionsRef.current.onCreateSessionRequest?.(inner.requestId as string);
                  }
                  break;

                case 'delete_session':
                  if (inner.sessionId) {
                    optionsRef.current.onDeleteSession?.(inner.sessionId as string);
                  }
                  break;

                case 'webrtc_offer':
                case 'webrtc_answer':
                case 'webrtc_ice':
                  optionsRef.current.onSignaling?.(inner);
                  break;
              }
            }).catch(() => {});
          }
          break;
        }

        case 'client_joined':
          optionsRef.current.onClientJoined?.(
            msg.clientId as string,
            msg.device as string,
          );

          // Re-send key exchange to new viewer so they can set up E2E
          if (keyPairRef.current && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'device_key_exchange',
              publicKey: keyPairRef.current.publicKeyJwk,
              deviceId,
            }));
          }
          break;

        case 'client_left': {
          const leftClientId = msg.clientId as string;
          e2eSessionsRef.current.delete(leftClientId);
          _e2eSessions = e2eSessionsRef.current;
          optionsRef.current.onClientLeft?.(leftClientId);
          break;
        }

        case 'list_sessions':
          // Mobile requested session list — this shouldn't normally happen
          break;

        case 'pong':
          break;
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
      _deviceWS = null;
      _e2eSessions = null;
      _keyPair = null;
      stopPing();

      // Reset E2E state
      keyPairRef.current = null;
      e2eSessionsRef.current = new Map();
      pendingEncryptedRef.current = [];

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
      _deviceWS = null;
      _e2eSessions = null;
      _keyPair = null;
      setStatus('disconnected');
    };
  }, [isAuthenticated, deviceId, stopPing]);

  /** Send sessions_updated — non-sensitive fields go plaintext (for relay SQLite), sensitive fields encrypted */
  const sendSessionsUpdated = useCallback((sessions: Record<string, unknown>[]) => {
    const ws = wsRef.current;

    if (ws?.readyState !== WebSocket.OPEN) {
      return;
    }

    // Plaintext: only IDs and dimensions (relay needs these for SQLite routing)
    ws.send(JSON.stringify({
      type: 'sessions_updated',
      sessions: sessions.map((s) => ({
        id: s.id,
        ptyCols: s.ptyCols,
        ptyRows: s.ptyRows,
      })),
    }));

    // Encrypted: full session metadata
    const e2e = e2eSessionsRef.current;

    if (e2e.size > 0) {
      sendEncrypted(ws, e2e, { type: 'sessions_updated', sessions });
    } else {
      pendingEncryptedRef.current.push({ msg: { type: 'sessions_updated', sessions } });
    }
  }, []);

  /** Send session_created response to mobile viewer (encrypted) */
  const sendSessionCreated = useCallback((msg: Record<string, unknown>) => {
    const ws = wsRef.current;

    if (ws?.readyState !== WebSocket.OPEN) {
      return;
    }

    const e2e = e2eSessionsRef.current;
    const toClientId = msg.toClientId as string | undefined;

    if (e2e.size > 0) {
      sendEncrypted(ws, e2e, { type: 'session_created', ...msg }, toClientId);
    } else {
      pendingEncryptedRef.current.push({ msg: { type: 'session_created', ...msg }, toClientId });
    }
  }, []);

  /** Send session_closed notification (encrypted) */
  const sendSessionClosed = useCallback((sessionId: string) => {
    const ws = wsRef.current;

    if (ws?.readyState !== WebSocket.OPEN) {
      return;
    }

    const e2e = e2eSessionsRef.current;

    if (e2e.size > 0) {
      sendEncrypted(ws, e2e, { type: 'session_closed', sessionId });
    } else {
      pendingEncryptedRef.current.push({ msg: { type: 'session_closed', sessionId } });
    }
  }, []);

  /** Send lightweight session property change (encrypted) */
  const sendSessionPropertyChanged = useCallback((sessionId: string, updates: Record<string, unknown>) => {
    const ws = wsRef.current;

    if (ws?.readyState !== WebSocket.OPEN) {
      return;
    }

    const e2e = e2eSessionsRef.current;

    if (e2e.size > 0) {
      sendEncrypted(ws, e2e, { type: 'session_property_changed', sessionId, ...updates });
    } else {
      pendingEncryptedRef.current.push({ msg: { type: 'session_property_changed', sessionId, ...updates } });
    }
  }, []);

  /** Send WebRTC signaling message (encrypted) */
  const sendSignaling = useCallback((msg: Record<string, unknown>) => {
    const ws = wsRef.current;

    if (ws?.readyState !== WebSocket.OPEN) {
      return;
    }

    const e2e = e2eSessionsRef.current;
    const toClientId = msg.toClientId as string | undefined;

    if (e2e.size > 0) {
      sendEncrypted(ws, e2e, msg, toClientId);
    } else {
      pendingEncryptedRef.current.push({ msg, toClientId });
    }
  }, []);

  return {
    status,
    clientId: clientIdRef.current,
    sendSessionsUpdated,
    sendSessionCreated,
    sendSessionClosed,
    sendSessionPropertyChanged,
    sendSignaling,
  };
}
