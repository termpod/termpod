import { useEffect, useRef } from 'react';
import { useRelayConnection } from './useRelayConnection';
import { useLocalServer } from './useLocalServer';
import { useWebRTC } from './useWebRTC';
import type { TerminalSession } from './useSessionManager';

export function useRelayBridge(session: TerminalSession | null) {
  const sessionRef = useRef(session);
  sessionRef.current = session;

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
      const s = sessionRef.current;

      if (s && !s.exited) {
        const term = s.termRef.current;
        const cols = term?.cols ?? 120;
        const rows = term?.rows ?? 40;

        s.pty.resize(cols - 1, rows);

        setTimeout(() => {
          s.pty.resize(cols, rows);
        }, 50);
      }

      // Initiate WebRTC offer to the new viewer
      if (clientId) {
        webrtc.initiateOffer(clientId).catch(() => {});
      }
    },
    onViewerResize: (cols, rows) => {
      const s = sessionRef.current;

      if (s && !s.exited) {
        s.pty.resize(cols, rows);
      }
    },
    onSignaling: (msg) => {
      webrtc.handleSignaling(msg).catch((err) => {
        console.warn('[WebRTC] Signaling error:', err);
      });
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
      // Same nudge-resize for local viewers
      const s = sessionRef.current;

      if (s && !s.exited) {
        const term = s.termRef.current;
        const cols = term?.cols ?? 120;
        const rows = term?.rows ?? 40;

        s.pty.resize(cols - 1, rows);

        setTimeout(() => {
          s.pty.resize(cols, rows);
        }, 50);
      }
    },
    onViewerResize: (cols, rows) => {
      const s = sessionRef.current;

      if (s && !s.exited) {
        s.pty.resize(cols, rows);
      }
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
  };
}
