import { useCallback, useEffect } from 'react';
import { Terminal } from '@termpod/ui';
import type { PtySize } from '@termpod/protocol';
import type { TerminalSession } from '../hooks/useSessionManager';
import { useRelayBridge } from '../hooks/useRelayBridge';
import type { RelayStatus } from '../hooks/useRelayConnection';

export interface RelayInfo {
  status: RelayStatus;
  viewers: number;
  sessionId: string | null;
}

interface TerminalPanelProps {
  session: TerminalSession;
  visible: boolean;
  onRelayChange?: (info: RelayInfo) => void;
}

export function TerminalPanel({ session, visible, onRelayChange }: TerminalPanelProps) {
  const relay = useRelayBridge(session.exited ? null : session);

  useEffect(() => {
    onRelayChange?.({
      status: relay.status,
      viewers: relay.viewers,
      sessionId: relay.sessionId,
    });
  }, [relay.status, relay.viewers, relay.sessionId, onRelayChange]);

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

      relay.sendResize(size.cols, size.rows);
    },
    [session.pty, session.exited, relay.sendResize],
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
