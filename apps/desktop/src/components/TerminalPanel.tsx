import { useCallback, useEffect, useRef } from 'react';
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
  fontSize?: number;
  fontFamily?: string;
  onRelayChange?: (info: RelayInfo) => void;
}

export function TerminalPanel({ session, visible, fontSize, fontFamily, onRelayChange }: TerminalPanelProps) {
  const relay = useRelayBridge(session.exited ? null : session);
  const onRelayChangeRef = useRef(onRelayChange);
  onRelayChangeRef.current = onRelayChange;

  useEffect(() => {
    onRelayChangeRef.current?.({
      status: relay.status,
      viewers: relay.viewers,
      sessionId: relay.sessionId,
    });
  }, [relay.status, relay.viewers, relay.sessionId]);

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

  const active = visible && !session.closing;

  useEffect(() => {
    if (!active) {
      return;
    }

    const timer = setTimeout(() => {
      session.termRef.current?.focus();
    }, 16);

    return () => clearTimeout(timer);
  }, [active, session.termRef]);

  return (
    <div
      className="terminal-panel"
      style={{
        visibility: active ? 'visible' : 'hidden',
        pointerEvents: active ? 'auto' : 'none',
      }}
    >
      <Terminal ref={session.termRef} onData={handleData} onResize={handleResize} fontSize={fontSize} fontFamily={fontFamily} />
    </div>
  );
}
