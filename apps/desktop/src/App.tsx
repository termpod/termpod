import { useCallback, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useSessionManager } from './hooks/useSessionManager';
import { useRelayBridge } from './hooks/useRelayBridge';
import { TabBar } from './components/TabBar';
import { TerminalPanel } from './components/TerminalPanel';
import { RelayStatus } from './components/RelayStatus';

export function App() {
  const {
    sessions,
    activeId,
    activeSession,
    createSession,
    closeSession,
    switchSession,
  } = useSessionManager();

  const relay = useRelayBridge(activeSession);

  // Create initial session on mount
  useEffect(() => {
    if (sessions.length === 0) {
      createSession();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for Tauri menu events
  const handleMenuEvent = useCallback(
    (menuId: string) => {
      switch (menuId) {
        case 'new_tab':
          createSession();
          break;

        case 'close_tab':
          if (activeId) {
            closeSession(activeId);
          }
          break;

        case 'next_tab': {
          const idx = sessions.findIndex((s) => s.id === activeId);
          const next = sessions[(idx + 1) % sessions.length];

          if (next) {
            switchSession(next.id);
          }
          break;
        }

        case 'prev_tab': {
          const idx = sessions.findIndex((s) => s.id === activeId);
          const prev = sessions[(idx - 1 + sessions.length) % sessions.length];

          if (prev) {
            switchSession(prev.id);
          }
          break;
        }

        default:
          if (menuId.startsWith('tab_')) {
            const tabIdx = parseInt(menuId.slice(4), 10) - 1;

            if (tabIdx < sessions.length) {
              switchSession(sessions[tabIdx].id);
            }
          }
      }
    },
    [activeId, sessions, createSession, closeSession, switchSession],
  );

  useEffect(() => {
    const unlisten = listen<string>('menu-event', (event) => {
      handleMenuEvent(event.payload);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [handleMenuEvent]);

  return (
    <div className="app">
      <TabBar
        sessions={sessions}
        activeId={activeId}
        onSelect={switchSession}
        onClose={closeSession}
        onCreate={() => createSession()}
      />
      <RelayStatus status={relay.status} viewers={relay.viewers} sessionId={relay.sessionId} />
      <div className="terminal-area">
        {sessions.map((session) => (
          <TerminalPanel
            key={session.id}
            session={session}
            visible={session.id === activeId}
          />
        ))}
      </div>
    </div>
  );
}
