import { useEffect, useRef } from 'react';
import { useRelayConnection } from './useRelayConnection';
import { useLocalServer } from './useLocalServer';
import { useWebRTC } from './useWebRTC';
import type { TerminalSession } from './useSessionManager';

interface UseRelayBridgeOptions {
  onCreateSessionRequest?: (requestId: string, source: 'relay' | 'local' | 'webrtc', localClientId?: string) => void;
  onSessionClosed?: () => void;
  onDeleteSession?: (relaySessionId: string) => void;
  getSessionsList?: () => Record<string, unknown>[];
}

export function useRelayBridge(session: TerminalSession | null, bridgeOptions?: UseRelayBridgeOptions) {
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

      // Initiate WebRTC offer to the new viewer
      if (clientId) {
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
    onViewerResize: (cols, _rows) => {
      const s = sessionRef.current;

      if (s && !s.exited) {
        const term = s.termRef.current;
        const currentRows = term?.rows ?? 40;
        ptySizeRef.current = { cols, rows: currentRows };
        s.pty.resize(cols, currentRows);
        term?.lockSize();
        term?.resize(cols, currentRows);
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
  });

  const { connect, disconnect, sendTerminalData, sendResize, sendSignaling } = relay;

  // Keep sessionId in a ref so the PTY data listener always has the current value
  const relaySessionIdRef = useRef(relay.sessionId);
  relaySessionIdRef.current = relay.sessionId;

  // Refs to avoid stale closures in PTY data listener
  const localViewersRef = useRef(0);
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
    onViewerResize: (cols, _rows) => {
      const s = sessionRef.current;

      if (s && !s.exited) {
        const term = s.termRef.current;
        const currentRows = term?.rows ?? 40;
        ptySizeRef.current = { cols, rows: currentRows };
        s.pty.resize(cols, currentRows);
        term?.lockSize();
        term?.resize(cols, currentRows);
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
    onViewerInput: (data) => {
      const s = sessionRef.current;

      if (s && !s.exited) {
        s.pty.write(data);
      }
    },
    onViewerResize: (cols, _rows) => {
      const s = sessionRef.current;

      if (s && !s.exited) {
        const term = s.termRef.current;
        const currentRows = term?.rows ?? 40;
        ptySizeRef.current = { cols, rows: currentRows };
        s.pty.resize(cols, currentRows);
        term?.lockSize();
        term?.resize(cols, currentRows);
      }
    },
    onControlMessage: (msg) => {
      const type = msg.type as string;

      if (type === 'list_sessions') {
        const sessions = bridgeOptionsRef.current?.getSessionsList?.() ?? [];
        return { type: 'sessions_list', sessions };
      }

      if (type === 'create_session_request' && msg.requestId) {
        bridgeOptionsRef.current?.onCreateSessionRequest?.(
          msg.requestId as string,
          'webrtc',
        );
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
    sendSignaling,
    localClientId: relay.clientId,
  });

  // Keep refs in sync on every render so the PTY listener reads fresh values
  localViewersRef.current = localServer.localViewers;
  webrtcConnectedRef.current = webrtc.isConnected;

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
      const hasP2PViewers = localViewersRef.current > 0 || webrtcConnectedRef.current;

      // Skip relay when P2P viewers are connected — they get data directly.
      // Relay WS stays open for control messages, signaling, and as a fallback.
      if (!hasP2PViewers) {
        sendTerminalData(data);
      }

      // Broadcast to local WS viewers
      const sid = relaySessionIdRef.current;
      if (sid) {
        localServer.broadcastTerminalData(sid, data);
      }

      // Send via WebRTC if connected
      if (webrtcConnectedRef.current) {
        webrtc.sendTerminalData(data);
      }
    };

    session.dataListeners.add(listener);

    return () => {
      session.dataListeners.delete(listener);
      disconnect();
      webrtc.close();
    };
  }, [session?.id, session?.exited, connect, disconnect, sendTerminalData]);

  return {
    ...relay,
    sendResize,
    localServerInfo: localServer.serverInfo,
    localViewers: localServer.localViewers,
    webrtcStatus: webrtc.status,
    sendToLocalClient: localServer.sendToClient,
    sendLocalControl: localServer.sendControl,
    sendWebRTCControl: webrtc.sendControlMessage,
  };
}
