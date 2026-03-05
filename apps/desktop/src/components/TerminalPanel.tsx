import { useCallback, useEffect } from 'react';
import { Terminal } from '@termpod/ui';
import type { PtySize } from '@termpod/protocol';
import type { TerminalSession } from '../hooks/useSessionManager';

interface TerminalPanelProps {
  session: TerminalSession;
  visible: boolean;
}

export function TerminalPanel({ session, visible }: TerminalPanelProps) {
  const handleData = useCallback(
    (data: string) => {
      if (!session.exited) {
        session.pty.write(data);
      }
    },
    [session.pty, session.exited],
  );

  const handleResize = useCallback(
    (size: PtySize) => {
      if (!session.exited) {
        session.pty.resize(size.cols, size.rows);
      }
    },
    [session.pty, session.exited],
  );

  useEffect(() => {
    if (visible) {
      session.termRef.current?.focus();
    }
  }, [visible, session.termRef]);

  return (
    <div
      className="terminal-panel"
      style={{ display: visible ? 'flex' : 'none', flex: 1 }}
    >
      <Terminal ref={session.termRef} onData={handleData} onResize={handleResize} />
    </div>
  );
}
