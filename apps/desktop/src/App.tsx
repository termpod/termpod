import { useCallback, useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useSessionManager } from './hooks/useSessionManager';
import { TabBar } from './components/TabBar';
import { TerminalPanel } from './components/TerminalPanel';
import type { RelayInfo } from './components/TerminalPanel';
import { RelayStatus } from './components/RelayStatus';
import { QRPairing } from './components/QRPairing';

export function App() {
  const {
    sessions,
    activeId,
    activeSession,
    createSession,
    closeSession,
    switchSession,
    focusActive,
  } = useSessionManager();

  const [showQR, setShowQR] = useState(false);
  const initializedRef = useRef(false);
  const [relayMap, setRelayMap] = useState<Map<string, RelayInfo>>(new Map());

  const handleCloseSession = (id: string) => {
    const { wasLast } = closeSession(id);

    if (wasLast) {
      getCurrentWindow().close();
      return;
    }

    setTimeout(focusActive, 50);
  };

  const activeRelay = activeId ? relayMap.get(activeId) : null;

  const handleRelayChange = useCallback((sessionId: string, info: RelayInfo) => {
    setRelayMap((prev) => {
      const next = new Map(prev);
      next.set(sessionId, info);
      return next;
    });
  }, []);

  // Create initial session on mount
  useEffect(() => {
    if (initializedRef.current) {
      return;
    }

    initializedRef.current = true;
    createSession();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Clean up relay info for closed sessions
  useEffect(() => {
    setRelayMap((prev) => {
      const sessionIds = new Set(sessions.map((s) => s.id));
      let changed = false;

      for (const key of prev.keys()) {
        if (!sessionIds.has(key)) {
          changed = true;
        }
      }

      if (!changed) {
        return prev;
      }

      const next = new Map(prev);

      for (const key of next.keys()) {
        if (!sessionIds.has(key)) {
          next.delete(key);
        }
      }

      return next;
    });
  }, [sessions]);

  // Listen for Tauri menu events
  const menuHandlerRef = useRef((_menuId: string) => {});

  menuHandlerRef.current = (menuId: string) => {
    switch (menuId) {
      case 'new_tab':
        createSession();
        break;

      case 'close_tab':
        if (activeId) {
          handleCloseSession(activeId);
        }
        break;

      case 'find':
        if (activeSession) {
          activeSession.termRef.current?.openSearch();
        }
        break;

      case 'next_tab': {
        const idx = sessions.findIndex((s) => s.id === activeId);
        const next = sessions[(idx + 1) % sessions.length];

        if (next) {
          switchSession(next.id);
          setTimeout(focusActive, 16);
        }
        break;
      }

      case 'prev_tab': {
        const idx = sessions.findIndex((s) => s.id === activeId);
        const prev = sessions[(idx - 1 + sessions.length) % sessions.length];

        if (prev) {
          switchSession(prev.id);
          setTimeout(focusActive, 16);
        }
        break;
      }

      default:
        if (menuId.startsWith('tab_')) {
          const tabIdx = parseInt(menuId.slice(4), 10) - 1;

          if (tabIdx < sessions.length) {
            switchSession(sessions[tabIdx].id);
            setTimeout(focusActive, 16);
          }
        }
    }
  };

  useEffect(() => {
    const unlisten = listen<string>('menu-event', (event) => {
      menuHandlerRef.current(event.payload);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  return (
    <div className="app">
      <TabBar
        sessions={sessions}
        activeId={activeId}
        onSelect={switchSession}
        onClose={handleCloseSession}
        onCreate={() => createSession()}
      />
      <RelayStatus
        status={activeRelay?.status ?? 'disconnected'}
        viewers={activeRelay?.viewers ?? 0}
        sessionId={activeRelay?.sessionId ?? null}
        onShare={() => setShowQR(true)}
      />
      <div className="terminal-area">
        {sessions.map((session) => (
          <TerminalPanel
            key={session.id}
            session={session}
            visible={session.id === activeId}
            onRelayChange={(info) => handleRelayChange(session.id, info)}
          />
        ))}
      </div>
      {showQR && (
        <QRPairing sessionId={activeRelay?.sessionId ?? null} onClose={() => setShowQR(false)} />
      )}
    </div>
  );
}
