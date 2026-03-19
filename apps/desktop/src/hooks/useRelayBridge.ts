import { useEffect, useMemo, useRef } from 'react';
import { useRelayConnection } from './useRelayConnection';
import { useLocalServer } from './useLocalServer';
import { useWebRTC } from './useWebRTC';
import type { TerminalSession } from './useSessionManager';

interface UseRelayBridgeOptions {
  onCreateSessionRequest?: (
    requestId: string,
    source: 'relay' | 'local' | 'webrtc',
    localClientId?: string,
  ) => void;
  onSessionClosed?: () => void;
  onDeleteSession?: (relaySessionId: string) => void;
  getSessionsList?: () => Record<string, unknown>[];
  /** Send WebRTC signaling via device WS instead of per-session relay WS. */
  deviceSendSignaling?: (msg: Record<string, unknown>) => void;
  /** Device WS clientId — used as fromClientId in WebRTC signaling so replies route correctly. */
  deviceClientId?: string;
  /** Multiplexed WebRTC input from iOS — route to correct session's PTY. */
  onWebRTCMuxInput?: (sessionId: string, data: string) => void;
  /** Multiplexed WebRTC resize from iOS — route to correct session. */
  onWebRTCMuxResize?: (sessionId: string, cols: number, rows: number) => void;
  /** Shared callback to get the connected WebRTC's mux send functions.
   *  Called on every PTY data event so all sessions can use the single connected WebRTC. */
  getSharedWebRTC?: () => {
    sendTerminalData: (sessionId: string, data: Uint8Array | number[]) => void;
    sendResize: (sessionId: string, cols: number, rows: number) => void;
    isConnected: boolean;
  } | null;
  /** Whether the user is allowed to send terminal data via relay (Pro/trial/self-hosted). */
  isRelayAllowed?: boolean;
}

export function useRelayBridge(
  session: TerminalSession | null,
  bridgeOptions?: UseRelayBridgeOptions,
) {
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const bridgeOptionsRef = useRef(bridgeOptions);
  bridgeOptionsRef.current = bridgeOptions;

  // Track actual PTY size (may differ from desktop xterm when a mobile viewer is connected)
  const ptySizeRef = useRef<{ cols: number; rows: number } | null>(null);

  const relay = useRelayConnection({
    onViewerInput: (data) => {
      const s = sessionRef.current;

      if (s && !s.exited) {
        s.pty.write(data);
      }
    },
    onViewerJoined: (clientId) => {
      // Nudge-resize: briefly change PTY size to trigger SIGWINCH,
      // causing TUI apps (Claude Code, vim, etc.) to fully redraw.
      // Use current PTY size (which may be mobile-sized), not desktop xterm size.
      const s = sessionRef.current;

      if (s && !s.exited) {
        const term = s.termRef.current;
        const current = ptySizeRef.current ?? { cols: term?.cols ?? 120, rows: term?.rows ?? 40 };

        s.pty.resize(current.cols - 1, current.rows);

        setTimeout(() => {
          s.pty.resize(current.cols, current.rows);
        }, 50);
      }

      // Initiate WebRTC offer to the new viewer — but only if device-level
      // signaling isn't handling it (device WS triggers its own offer via App.tsx)
      if (clientId && !bridgeOptionsRef.current?.deviceSendSignaling) {
        webrtc.initiateOffer(clientId).catch(() => {});
      }
    },
    onViewerLeft: () => {
      // If no more viewers, revert PTY and xterm to desktop dimensions
      if (relay.viewers <= 1 && localServer.localViewers === 0 && !webrtcConnectedRef.current) {
        const s = sessionRef.current;

        if (s && !s.exited) {
          const term = s.termRef.current;
          ptySizeRef.current = null;
          term?.unlockSize();
          // After unlockSize, xterm re-fits to container and we resize PTY to match
          const cols = term?.cols ?? 120;
          const rows = term?.rows ?? 40;
          s.pty.resize(cols, rows);
        }
      }
    },
    onViewerResize: (cols, rows) => {
      const s = sessionRef.current;

      if (s && !s.exited) {
        const term = s.termRef.current;
        const nextRows = rows > 0 ? rows : (term?.rows ?? 40);
        ptySizeRef.current = { cols, rows: nextRows };
        s.pty.resize(cols, nextRows);
        term?.lockSize();
        term?.resize(cols, nextRows);
      }
    },
    onSignaling: (msg) => {
      webrtc.handleSignaling(msg).catch((err) => {
        console.warn('[WebRTC] Signaling error:', err);
      });
    },
    onCreateSessionRequest: (requestId) => {
      bridgeOptionsRef.current?.onCreateSessionRequest?.(requestId, 'relay');
    },
    onSessionClosed: () => {
      bridgeOptionsRef.current?.onSessionClosed?.();
    },
    isRelayAllowed: bridgeOptions?.isRelayAllowed,
  });

  const {
    connect,
    disconnect,
    appendScrollback,
    sendShareFrame,
    sendTerminalData,
    sendResize,
    sendSignaling,
    sendControl,
  } = relay;

  // Keep sessionId in a ref so the PTY data listener always has the current value
  const relaySessionIdRef = useRef(relay.sessionId);
  relaySessionIdRef.current = relay.sessionId;

  // Ref to avoid stale closure in PTY data listener
  const webrtcConnectedRef = useRef(false);

  const localServer = useLocalServer({
    sessionId: relay.sessionId,
    onViewerInput: (data) => {
      const s = sessionRef.current;

      if (s && !s.exited) {
        s.pty.write(data);
      }
    },
    onViewerJoined: () => {
      // No nudge-resize for local viewers — the mobile client sends its
      // own dimensions which triggers SIGWINCH for TUI redraw.
    },
    onViewerLeft: () => {
      // If no more viewers, revert PTY and xterm to desktop dimensions
      if (relay.viewers === 0 && localServer.localViewers <= 1 && !webrtcConnectedRef.current) {
        const s = sessionRef.current;

        if (s && !s.exited) {
          const term = s.termRef.current;
          ptySizeRef.current = null;
          term?.unlockSize();
          const cols = term?.cols ?? 120;
          const rows = term?.rows ?? 40;
          s.pty.resize(cols, rows);
        }
      }
    },
    onViewerResize: (cols, rows) => {
      const s = sessionRef.current;

      if (s && !s.exited) {
        const term = s.termRef.current;
        const nextRows = rows > 0 ? rows : (term?.rows ?? 40);
        ptySizeRef.current = { cols, rows: nextRows };
        s.pty.resize(cols, nextRows);
        term?.lockSize();
        term?.resize(cols, nextRows);
      }
    },
    onCreateSessionRequest: (requestId, clientId) => {
      bridgeOptionsRef.current?.onCreateSessionRequest?.(requestId, 'local', clientId);
    },
    onDeleteSession: (sessionId) => {
      bridgeOptionsRef.current?.onDeleteSession?.(sessionId);
    },
  });

  const webrtc = useWebRTC({
    // Legacy non-multiplexed input (for backward compat with old iOS clients)
    onViewerInput: (data) => {
      const s = sessionRef.current;

      if (s && !s.exited) {
        s.pty.write(data);
      }
    },
    // Legacy non-multiplexed resize
    onViewerResize: (cols, rows) => {
      const s = sessionRef.current;

      if (s && !s.exited) {
        const term = s.termRef.current;
        const nextRows = rows > 0 ? rows : (term?.rows ?? 40);
        ptySizeRef.current = { cols, rows: nextRows };
        s.pty.resize(cols, nextRows);
        term?.lockSize();
        term?.resize(cols, nextRows);
      }
    },
    // Multiplexed input — route to correct session via App.tsx callback
    onMuxViewerInput: (sessionId, data) => {
      bridgeOptionsRef.current?.onWebRTCMuxInput?.(sessionId, data);
    },
    // Multiplexed resize — route to correct session via App.tsx callback
    onMuxViewerResize: (sessionId, cols, rows) => {
      bridgeOptionsRef.current?.onWebRTCMuxResize?.(sessionId, cols, rows);
    },
    onControlMessage: (msg) => {
      const type = msg.type as string;

      if (type === 'list_sessions') {
        const sessions = bridgeOptionsRef.current?.getSessionsList?.() ?? [];
        return { type: 'sessions_list', sessions };
      }

      if (type === 'create_session_request' && msg.requestId) {
        bridgeOptionsRef.current?.onCreateSessionRequest?.(msg.requestId as string, 'webrtc');
      }

      if (type === 'delete_session' && msg.sessionId) {
        bridgeOptionsRef.current?.onDeleteSession?.(msg.sessionId as string);
      }
    },
    onStatusChange: (status) => {
      if (status === 'failed' || status === 'idle') {
        // WebRTC disconnected — restore desktop size if no other viewers
        if (relay.viewers === 0 && localServer.localViewers === 0) {
          const s = sessionRef.current;

          if (s && !s.exited) {
            const term = s.termRef.current;
            ptySizeRef.current = null;
            term?.unlockSize();
            const cols = term?.cols ?? 120;
            const rows = term?.rows ?? 40;
            s.pty.resize(cols, rows);
          }
        }
      }
    },
    sendSignaling: bridgeOptionsRef.current?.deviceSendSignaling ?? sendSignaling,
    localClientId: bridgeOptionsRef.current?.deviceClientId ?? relay.clientId,
  });

  // Keep refs in sync on every render so the PTY listener reads fresh values
  webrtcConnectedRef.current = webrtc.isConnected;
  const isRelayAllowedRef = useRef(bridgeOptions?.isRelayAllowed ?? true);
  isRelayAllowedRef.current = bridgeOptions?.isRelayAllowed ?? true;
  const localViewersRef = useRef(localServer.localViewers);
  localViewersRef.current = localServer.localViewers;

  useEffect(() => {
    if (!session || session.exited) {
      return;
    }

    // Get actual terminal size from xterm, fall back to PTY defaults
    const term = session.termRef.current;
    const cols = term?.cols ?? 120;
    const rows = term?.rows ?? 40;

    connect({ cols, rows });

    const listener = (data: Uint8Array | number[]) => {
      const sid = relaySessionIdRef.current;

      // Always buffer scrollback locally (needed for viewer join on any transport)
      appendScrollback(data);

      // Always send share frames via relay (share viewers are relay-only)
      sendShareFrame(data);

      const hasLocal = localViewersRef.current > 0;
      const sharedWrtc = bridgeOptionsRef.current?.getSharedWebRTC?.();
      const hasWebRTC = sharedWrtc?.isConnected || webrtcConnectedRef.current;

      // Send via Local if viewers present
      if (hasLocal && sid) {
        localServer.broadcastTerminalData(sid, data);
      }

      // Send via WebRTC if connected
      if (hasWebRTC && sid) {
        if (sharedWrtc?.isConnected) {
          sharedWrtc.sendTerminalData(sid, data);
        } else if (webrtcConnectedRef.current) {
          webrtc.sendTerminalData(sid, data);
        }
      }

      // Always send via relay when allowed — viewers may be relay-only
      // (e.g. transport override, or local/WebRTC unavailable on their end).
      // The viewer-side shouldAcceptData filter prevents duplicate processing.
      if (isRelayAllowedRef.current) {
        sendTerminalData(data);
      }
    };

    session.dataListeners.add(listener);

    return () => {
      session.dataListeners.delete(listener);
      disconnect();
      webrtc.close();
    };
  }, [
    session?.id,
    session?.exited,
    connect,
    disconnect,
    appendScrollback,
    sendShareFrame,
    sendTerminalData,
  ]);

  // Combine connected devices from all transports, merging entries that represent
  // the same physical device (e.g. an iPhone connected via relay + local + WebRTC).
  // Group by device type and collect all transports per device.
  const webrtcConnectedAt = useRef(new Date().toISOString());
  const allConnectedDevices = useMemo(() => {
    // Filter out 'macos' entries — the desktop should not show itself as a connected device
    const raw = [
      ...relay.connectedDevices.filter((d) => d.device !== 'macos'),
      ...localServer.localDevices.filter((d) => d.device !== 'macos'),
    ];

    if (webrtc.isConnected) {
      // Infer WebRTC peer's device type from relay's client list (the peer
      // always connects via relay first before upgrading to WebRTC).
      const peerDevice =
        relay.connectedDevices.find((d) => d.device !== 'macos')?.device ?? 'unknown';
      raw.push({
        clientId: 'webrtc-peer',
        device: peerDevice,
        transport: 'webrtc' as const,
        connectedAt: webrtcConnectedAt.current,
      });
    }

    // Merge by device type — collect transports per unique device
    const byDevice = new Map<
      string,
      { device: string; transports: string[]; connectedAt: string }
    >();

    for (const d of raw) {
      const existing = byDevice.get(d.device);

      if (existing) {
        if (!existing.transports.includes(d.transport)) {
          existing.transports.push(d.transport);
        }
        // Keep earliest connectedAt
        if (d.connectedAt < existing.connectedAt) {
          existing.connectedAt = d.connectedAt;
        }
      } else {
        byDevice.set(d.device, {
          device: d.device,
          transports: [d.transport],
          connectedAt: d.connectedAt,
        });
      }
    }

    return [...byDevice.values()];
  }, [relay.connectedDevices, localServer.localDevices, webrtc.isConnected]);

  return {
    ...relay,
    sendResize,
    sendControl,
    localServerInfo: localServer.serverInfo,
    localViewers: localServer.localViewers,
    webrtcStatus: webrtc.status,
    webrtcIsConnected: webrtc.isConnected,
    webrtcSendTerminalData: webrtc.sendTerminalData,
    webrtcSendResize: webrtc.sendResize,
    allConnectedDevices,
    sendToLocalClient: localServer.sendToClient,
    sendLocalControl: localServer.sendControl,
    sendWebRTCControl: webrtc.sendControlMessage,
    handleWebRTCSignaling: webrtc.handleSignaling,
    initiateWebRTCOffer: webrtc.initiateOffer,
  };
}
