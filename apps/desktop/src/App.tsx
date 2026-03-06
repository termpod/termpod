import { useCallback, useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useSessionManager } from './hooks/useSessionManager';
import { useSettings } from './hooks/useSettings';
import { useAuth } from './hooks/useAuth';
import { useDevice } from './hooks/useDevice';
import { TabBar } from './components/TabBar';
import { TerminalPanel } from './components/TerminalPanel';
import type { RelayInfo } from './components/TerminalPanel';
import { RelayStatus } from './components/RelayStatus';
import { QRPairing } from './components/QRPairing';
import { SettingsPanel } from './components/SettingsPanel';
import { LoginScreen } from './components/LoginScreen';

export function App() {
  const auth = useAuth();
  const createSessionRef = useRef<(() => void) | null>(null);
  const device = useDevice(auth.isAuthenticated, () => createSessionRef.current?.());

  const {
    sessions,
    activeId,
    activeSession,
    createSession,
    closeSession,
    switchSession,
    focusActive,
  } = useSessionManager();

  const { settings, update: updateSettings, reset: resetSettings, defaults: settingsDefaults } = useSettings();

  // Wire up remote session creation callback
  createSessionRef.current = () => createSession({ shell: settings.shellPath });
  const [showQR, setShowQR] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const initializedRef = useRef(false);
  const [relayMap, setRelayMap] = useState<Map<string, RelayInfo>>(new Map());

  const handleCloseSession = useCallback((id: string) => {
    const { wasLast } = closeSession(id);

    if (wasLast) {
      getCurrentWindow().close();
      return;
    }

    setTimeout(focusActive, 50);
  }, [closeSession, focusActive]);

  const activeRelay = activeId ? relayMap.get(activeId) : null;

  const handleRelayChange = useCallback((sessionId: string, info: RelayInfo) => {
    setRelayMap((prev) => {
      const next = new Map(prev);
      next.set(sessionId, info);
      return next;
    });
  }, []);

  // Create initial session on mount (only when authenticated)
  useEffect(() => {
    if (!auth.isAuthenticated || initializedRef.current) {
      return;
    }

    initializedRef.current = true;
    createSession({ shell: settings.shellPath });
  }, [auth.isAuthenticated]); // eslint-disable-line react-hooks/exhaustive-deps

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
        createSession({ shell: settings.shellPath });
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

      case 'settings':
        setShowSettings((v) => !v);
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

  if (!auth.isAuthenticated) {
    return (
      <LoginScreen
        onLogin={auth.login}
        onSignup={auth.signup}
        loading={auth.loading}
        error={auth.error}
      />
    );
  }

  return (
    <div className="app">
      <TabBar
        sessions={sessions}
        activeId={activeId}
        onSelect={switchSession}
        onClose={handleCloseSession}
        onCreate={() => createSession({ shell: settings.shellPath })}
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
            fontSize={settings.fontSize}
            fontFamily={settings.fontFamily}
            onRelayChange={(info) => handleRelayChange(session.id, info)}
            onSessionRegistered={(relaySessionId) => {
              const term = session.termRef.current;
              device.registerSession(
                relaySessionId,
                session.name,
                session.cwd,
                term?.cols ?? 120,
                term?.rows ?? 40,
              );
            }}
          />
        ))}
      </div>
      {showQR && (
        <QRPairing sessionId={activeRelay?.sessionId ?? null} onClose={() => setShowQR(false)} />
      )}
      {showSettings && (
        <SettingsPanel
          settings={settings}
          defaults={settingsDefaults}
          onUpdate={updateSettings}
          onReset={resetSettings}
          onClose={() => setShowSettings(false)}
          email={auth.email}
          onLogout={auth.logout}
        />
      )}
    </div>
  );
}
