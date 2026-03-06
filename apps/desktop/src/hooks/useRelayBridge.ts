import { useEffect, useRef } from 'react';
import { useRelayConnection } from './useRelayConnection';
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
    onViewerJoined: () => {
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
    },
    onViewerResize: (cols, rows) => {
      const s = sessionRef.current;

      if (s && !s.exited) {
        s.pty.resize(cols, rows);
      }
    },
  });

  const { connect, disconnect, sendTerminalData, sendResize } = relay;

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
      sendTerminalData(data);
    };

    session.dataListeners.add(listener);

    return () => {
      session.dataListeners.delete(listener);
      disconnect();
    };
  }, [session?.id, session?.exited, connect, disconnect, sendTerminalData]);

  return { ...relay, sendResize };
}
