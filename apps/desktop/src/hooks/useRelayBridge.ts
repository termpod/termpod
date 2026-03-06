import { useEffect, useRef } from 'react';
import { useRelayConnection } from './useRelayConnection';
import { useLocalServer } from './useLocalServer';
import { useWebRTC } from './useWebRTC';
import type { TerminalSession } from './useSessionManager';

interface UseRelayBridgeOptions {
  onCreateSessionRequest?: (requestId: string, source: 'relay' | 'local', localClientId?: string) => void;
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
      // If no more viewers, revert PTY to desktop xterm dimensions
      if (relay.viewers <= 1 && localServer.localViewers === 0) {
        const s = sessionRef.current;

        if (s && !s.exited) {
          const term = s.termRef.current;
          const cols = term?.cols ?? 120;
          const rows = term?.rows ?? 40;
          ptySizeRef.current = null;
          s.pty.resize(cols, rows);
        }
      }
    },
    onViewerResize: (cols, rows) => {
      const s = sessionRef.current;

      if (s && !s.exited) {
        ptySizeRef.current = { cols, rows };
        s.pty.resize(cols, rows);
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
  });

  const { connect, disconnect, sendTerminalData, sendResize, sendSignaling } = relay;

  // Keep sessionId in a ref so the PTY data listener always has the current value
  const relaySessionIdRef = useRef(relay.sessionId);
  relaySessionIdRef.current = relay.sessionId;

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
      // If no more viewers, revert PTY to desktop xterm dimensions
      if (relay.viewers === 0 && localServer.localViewers <= 1) {
        const s = sessionRef.current;

        if (s && !s.exited) {
          const term = s.termRef.current;
          const cols = term?.cols ?? 120;
          const rows = term?.rows ?? 40;
          ptySizeRef.current = null;
          s.pty.resize(cols, rows);
        }
      }
    },
    onViewerResize: (cols, rows) => {
      const s = sessionRef.current;

      if (s && !s.exited) {
        ptySizeRef.current = { cols, rows };
        s.pty.resize(cols, rows);
      }
    },
    onCreateSessionRequest: (requestId, clientId) => {
      bridgeOptionsRef.current?.onCreateSessionRequest?.(requestId, 'local', clientId);
    },
  });

  const webrtc = useWebRTC({
    onViewerInput: (data) => {
      const s = sessionRef.current;

      if (s && !s.exited) {
        s.pty.write(data);
      }
    },
    sendSignaling,
    localClientId: relay.clientId,
  });

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
      // Send to relay (always, for scrollback and non-P2P viewers)
      sendTerminalData(data);

      // Also broadcast to local WS viewers
      const sid = relaySessionIdRef.current;
      if (sid) {
        localServer.broadcastTerminalData(sid, data);
      }

      // Also send via WebRTC if connected
      if (webrtc.isConnected) {
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
  };
}
