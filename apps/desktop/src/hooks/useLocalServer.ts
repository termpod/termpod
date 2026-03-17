import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  generateKeyPair,
  deriveSessionKey,
  encryptFrame,
  decryptFrame,
  Channel,
  decodeBinaryFrame,
} from '@termpod/protocol';
import type { E2ESession } from '@termpod/protocol';
import type { ConnectedDevice } from './useRelayConnection';
import { setLocalAuthSecret } from './localAuthSecret';
import { sendLocalAuthSecretToRelay } from './useDeviceWS';

export interface LocalServerInfo {
  port: number;
  addresses: string[];
  authSecret: string;
}

interface ViewerEvent {
  clientId: string;
  device: string;
  sessionId: string;
}

interface InputEvent {
  sessionId: string;
  data: number[];
}

interface ResizeEvent {
  sessionId: string;
  cols: number;
  rows: number;
}

interface CreateSessionEvent {
  requestId: string;
  clientId: string;
}

interface DeleteSessionEvent {
  sessionId: string;
  clientId: string;
}

interface EncryptedInputEvent {
  sessionId: string;
  data: number[];
}

interface KeyExchangeEvent {
  clientId: string;
  json: string;
}

// Per-client E2E session state for local connections
const localE2ESessions = new Map<string, E2ESession>();
const pendingKeyPairs = new Map<string, { publicKeyJwk: JsonWebKey; privateKey: CryptoKey }>();

interface UseLocalServerOptions {
  sessionId: string | null;
  onViewerInput?: (data: string) => void;
  onViewerJoined?: () => void;
  onViewerLeft?: () => void;
  onViewerResize?: (cols: number, rows: number) => void;
  onCreateSessionRequest?: (requestId: string, clientId: string) => void;
  onDeleteSession?: (sessionId: string) => void;
}

export function useLocalServer(options: UseLocalServerOptions) {
  const [serverInfo, setServerInfo] = useState<LocalServerInfo | null>(null);
  const [localViewers, setLocalViewers] = useState(0);
  const [localDevices, setLocalDevices] = useState<ConnectedDevice[]>([]);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    let cancelled = false;

    invoke<LocalServerInfo>('start_local_server')
      .then((info) => {
        if (!cancelled) {
          console.log('[LocalServer] Started on port', info.port, 'addresses:', info.addresses);
          setLocalAuthSecret(info.authSecret);
          setServerInfo(info);

          // If the Device WS is already connected, push the secret now
          // (handles the race where hello_ok fired before the server started)
          sendLocalAuthSecretToRelay();
        }
      })
      .catch((err) => {
        // Server might already be running — that's fine
        console.warn('[LocalServer] Start:', err);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Listen for events from the Rust local WS server
  useEffect(() => {
    const unlisten: (() => void)[] = [];

    listen<ViewerEvent>('local-ws-viewer-joined', (event) => {
      const sid = optionsRef.current.sessionId;

      if (event.payload.sessionId === sid) {
        setLocalViewers((v) => v + 1);
        setLocalDevices((prev) => [
          ...prev.filter((d) => d.clientId !== event.payload.clientId),
          {
            clientId: event.payload.clientId,
            device: event.payload.device,
            transport: 'local',
            connectedAt: new Date().toISOString(),
          },
        ]);
        optionsRef.current.onViewerJoined?.();

        // Initiate E2E key exchange with the new viewer
        generateKeyPair().then((kp) => {
          pendingKeyPairs.set(event.payload.clientId, kp);
          invoke('local_server_send_to_client', {
            clientId: event.payload.clientId,
            json: JSON.stringify({
              type: 'key_exchange',
              publicKey: kp.publicKeyJwk,
              sessionId: sid,
            }),
          }).catch(() => {});
        });
      }
    }).then((fn) => unlisten.push(fn));

    listen<ViewerEvent>('local-ws-viewer-left', (event) => {
      const sid = optionsRef.current.sessionId;

      if (event.payload.sessionId === sid) {
        setLocalViewers((v) => Math.max(0, v - 1));
        setLocalDevices((prev) => prev.filter((d) => d.clientId !== event.payload.clientId));
        localE2ESessions.delete(event.payload.clientId);
        pendingKeyPairs.delete(event.payload.clientId);
        optionsRef.current.onViewerLeft?.();
      }
    }).then((fn) => unlisten.push(fn));

    listen<InputEvent>('local-ws-input', (event) => {
      const sid = optionsRef.current.sessionId;

      if (event.payload.sessionId === sid) {
        // Reject plaintext frames when any local E2E session is active (prevent downgrade attack)
        if (localE2ESessions.size > 0) {
          console.warn('[LocalServer] Rejecting plaintext frame — E2E encryption is active');
          return;
        }

        const bytes = new Uint8Array(event.payload.data);
        optionsRef.current.onViewerInput?.(new TextDecoder().decode(bytes));
      }
    }).then((fn) => unlisten.push(fn));

    listen<ResizeEvent>('local-ws-resize', (event) => {
      const sid = optionsRef.current.sessionId;

      if (event.payload.sessionId === sid) {
        optionsRef.current.onViewerResize?.(event.payload.cols, event.payload.rows);
      }
    }).then((fn) => unlisten.push(fn));

    listen<CreateSessionEvent>('local-ws-create-session', (event) => {
      optionsRef.current.onCreateSessionRequest?.(event.payload.requestId, event.payload.clientId);
    }).then((fn) => unlisten.push(fn));

    listen<DeleteSessionEvent>('local-ws-delete-session', (event) => {
      optionsRef.current.onDeleteSession?.(event.payload.sessionId);
    }).then((fn) => unlisten.push(fn));

    // Handle E2E key exchange ack from local viewers
    listen<KeyExchangeEvent>('local-ws-key-exchange', (event) => {
      const { clientId, json } = event.payload;

      try {
        const msg = JSON.parse(json);

        if (msg.type === 'key_exchange_ack' && msg.publicKey) {
          const kp = pendingKeyPairs.get(clientId);

          if (kp) {
            const sid = msg.sessionId || optionsRef.current.sessionId || '';
            deriveSessionKey(kp.privateKey, msg.publicKey, sid)
              .then((e2eSession) => {
                localE2ESessions.set(clientId, e2eSession);
                pendingKeyPairs.delete(clientId);
                console.log('[LocalServer] E2E encryption active for local viewer', clientId);
              })
              .catch((err) => {
                console.error('[LocalServer] E2E key derivation failed:', err);
              });
          }
        }
      } catch {
        // Ignore malformed JSON
      }
    }).then((fn) => unlisten.push(fn));

    // Handle E2E encrypted input from local viewers
    listen<EncryptedInputEvent>('local-ws-encrypted-input', (event) => {
      const sid = optionsRef.current.sessionId;

      if (event.payload.sessionId === sid) {
        const encrypted = new Uint8Array(event.payload.data);

        // Find the E2E session for this viewer (try all local sessions)
        for (const [, e2eSession] of localE2ESessions) {
          decryptFrame(e2eSession, encrypted)
            .then((plaintext) => {
              const inner = decodeBinaryFrame(plaintext);

              if (inner.channel === Channel.TERMINAL_DATA) {
                optionsRef.current.onViewerInput?.(new TextDecoder().decode(inner.data));
              } else if (inner.channel === Channel.TERMINAL_RESIZE) {
                optionsRef.current.onViewerResize?.(inner.cols, inner.rows);
              }
            })
            .catch(() => {
              // Wrong key — try next session or silently drop
            });
        }
      }
    }).then((fn) => unlisten.push(fn));

    return () => {
      for (const fn of unlisten) {
        fn();
      }
    };
  }, []);

  const broadcastTerminalData = useCallback((sessionId: string, data: Uint8Array | number[]) => {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);

    if (localE2ESessions.size > 0) {
      // Encrypt the terminal data and broadcast as 0xE0 multiplexed frame
      const plainFrame = new Uint8Array(1 + bytes.length);
      plainFrame[0] = Channel.TERMINAL_DATA;
      plainFrame.set(bytes, 1);

      // Use first available E2E session (all local viewers share same key)
      const e2eSession = localE2ESessions.values().next().value;

      if (e2eSession) {
        encryptFrame(e2eSession, plainFrame)
          .then((encrypted) => {
            // Build multiplexed frame: [0xE0][sid_len][sid][encrypted_data]
            const sidBytes = new TextEncoder().encode(sessionId);
            const frame = new Uint8Array(2 + sidBytes.length + encrypted.length);
            frame[0] = 0xe0;
            frame[1] = sidBytes.length;
            frame.set(sidBytes, 2);
            frame.set(encrypted, 2 + sidBytes.length);
            invoke('local_server_broadcast_raw', { sessionId, data: Array.from(frame) }).catch(
              () => {},
            );
          })
          .catch((err) => {
            console.error('[LocalServer] E2E encryption failed — dropping frame:', err);
          });
      }
    } else {
      // No E2E sessions established yet — drop terminal data rather than sending plaintext.
      // Terminal output will only be sent after key exchange completes and E2E is active.
      // Viewers receive encrypted scrollback after key exchange anyway.
    }
  }, []);

  const sendControl = useCallback((sessionId: string, json: string) => {
    invoke('local_server_send_control', { sessionId, json }).catch(() => {});
  }, []);

  const sendToClient = useCallback((clientId: string, json: string) => {
    invoke('local_server_send_to_client', { clientId, json }).catch(() => {});
  }, []);

  return {
    serverInfo,
    localViewers,
    localDevices,
    broadcastTerminalData,
    sendControl,
    sendToClient,
  };
}
