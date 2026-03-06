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
  onSessionRegistered?: (relaySessionId: string) => void;
}

export function TerminalPanel({ session, visible, fontSize, fontFamily, onRelayChange, onSessionRegistered }: TerminalPanelProps) {
  const relay = useRelayBridge(session.exited ? null : session);
  const onRelayChangeRef = useRef(onRelayChange);
  onRelayChangeRef.current = onRelayChange;
  const onSessionRegisteredRef = useRef(onSessionRegistered);
  onSessionRegisteredRef.current = onSessionRegistered;

  useEffect(() => {
    onRelayChangeRef.current?.({
      status: relay.status,
      viewers: relay.viewers,
      sessionId: relay.sessionId,
    });
  }, [relay.status, relay.viewers, relay.sessionId]);

  // Notify parent when relay session is created (for device registration)
  const registeredRef = useRef<string | null>(null);

  useEffect(() => {
    if (relay.sessionId && relay.sessionId !== registeredRef.current) {
      registeredRef.current = relay.sessionId;
      onSessionRegisteredRef.current?.(relay.sessionId);
    }
  }, [relay.sessionId]);

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
