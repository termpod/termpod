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
  });

  const { connect, disconnect, sendTerminalData } = relay;

  useEffect(() => {
    if (!session || session.exited) {
      return;
    }

    connect({ cols: 120, rows: 40 });

    const listener = (data: Uint8Array | number[]) => {
      sendTerminalData(data);
    };

    session.dataListeners.add(listener);

    return () => {
      session.dataListeners.delete(listener);
      disconnect();
    };
  }, [session?.id, session?.exited, connect, disconnect, sendTerminalData]);

  return relay;
}
