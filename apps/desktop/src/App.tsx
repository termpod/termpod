import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow, Effect, EffectState } from '@tauri-apps/api/window';
import { useSessionManager } from './hooks/useSessionManager';
import { useSettings, THEMES, themeToAppStyles } from './hooks/useSettings';
import type { BlurStyle } from './hooks/useSettings';
import { useAuth } from './hooks/useAuth';
import { useDevice } from './hooks/useDevice';
import { TabBar } from './components/TabBar';
import { TerminalPanel } from './components/TerminalPanel';
import type { RelayInfo } from './components/TerminalPanel';
import { RelayStatus } from './components/RelayStatus';
import { SettingsPanel } from './components/SettingsPanel';
import { LoginScreen } from './components/LoginScreen';
import { FullDiskAccessBanner } from './components/FullDiskAccessBanner';
import { KeybindingsPanel } from './components/KeybindingsPanel';
import { useKeybindings, matchesShortcut } from './hooks/useKeybindings';

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
    onSessionExitRef,
  } = useSessionManager();

  const { settings, update: updateSettings, reset: resetSettings, defaults: settingsDefaults } = useSettings();

  // Wire up remote session creation callback (legacy polling fallback)
  createSessionRef.current = () => createSession({ shell: settings.shellPath });

  // Handle push-based session creation requests from mobile
  const handleCreateSessionRequest = useCallback(
    async (requestId: string, source: 'relay' | 'local', localClientId?: string) => {
      const newSession = await createSession({ shell: settings.shellPath });

      if (!newSession) {
        return;
      }

      // Wait briefly for relay connection to establish and session to register
      const waitForRelay = () =>
        new Promise<RelayInfo | null>((resolve) => {
          let attempts = 0;
          const check = () => {
            const info = relayMapRef.current.get(newSession.id);

            if (info?.sessionId) {
              resolve(info);
              return;
            }

            attempts++;

            if (attempts > 50) {
              resolve(null);
              return;
            }

            setTimeout(check, 100);
          };
          check();
        });

      const relayInfo = await waitForRelay();

      if (!relayInfo?.sessionId) {
        return;
      }

      const term = newSession.termRef.current;
      const response = JSON.stringify({
        type: 'session_created',
        requestId,
        sessionId: relayInfo.sessionId,
        name: newSession.name,
        cwd: newSession.cwd,
        ptyCols: term?.cols ?? 120,
        ptyRows: term?.rows ?? 40,
      });

      if (source === 'local' && localClientId) {
        // Respond directly to the requesting local client
        relayInfo.sendToLocalClient?.(localClientId, response);
      } else {
        // Respond via relay (broadcast to all viewers)
        relayInfo.sendSessionCreated?.(
          requestId,
          relayInfo.sessionId,
          newSession.name,
          newSession.cwd,
          term?.cols ?? 120,
          term?.rows ?? 40,
        );
      }
    },
    [createSession, settings.shellPath],
  );

  const [showSettings, setShowSettings] = useState(false);
  const [showKeybindings, setShowKeybindings] = useState(false);
  const { bindings } = useKeybindings();
  const initializedRef = useRef(false);
  const [relayMap, setRelayMap] = useState<Map<string, RelayInfo>>(new Map());
  const relayMapRef = useRef(relayMap);
  relayMapRef.current = relayMap;

  const handleCloseSession = useCallback((id: string) => {
    // Unregister session from relay before closing
    const relayInfo = relayMapRef.current.get(id);

    if (relayInfo?.sessionId) {
      device.removeSession(relayInfo.sessionId);
    }

    const { wasLast } = closeSession(id);

    if (wasLast && settings.closeWindowOnLastTab) {
      getCurrentWindow().close();
      return;
    }

    setTimeout(focusActive, 50);
  }, [closeSession, focusActive, device]);

  // Auto-close tab when shell exits (e.g. ctrl+d)
  onSessionExitRef.current = handleCloseSession;

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
        createSession({
          shell: settings.shellPath,
          cwd: settings.newTabCwd === 'current' ? activeSession?.cwd : undefined,
        });
        break;

      case 'close_tab':
        if (activeId) {
          handleCloseSession(activeId);
        }
        break;

      case 'clear':
        if (activeSession) {
          activeSession.termRef.current?.clear();
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

      case 'keybindings':
        setShowKeybindings((v) => !v);
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

  // JS-level keybinding listener for custom shortcuts
  const bindingsRef = useRef(bindings);
  bindingsRef.current = bindings;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      for (const kb of bindingsRef.current) {
        if (matchesShortcut(e, kb.shortcut)) {
          e.preventDefault();
          menuHandlerRef.current(kb.id);
          return;
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const opacity = settings.backgroundOpacity;
  const appThemeStyles = useMemo(
    () => themeToAppStyles(THEMES[settings.theme] ?? THEMES['tokyo-night'], opacity),
    [settings.theme, opacity],
  );

  // Apply/remove macOS vibrancy effect
  useEffect(() => {
    const win = getCurrentWindow();
    const blurEffects: Record<BlurStyle, Effect> = {
      none: Effect.HudWindow,
      subtle: Effect.HudWindow,
      medium: Effect.UnderWindowBackground,
      full: Effect.Sidebar,
    };

    if (settings.backgroundOpacity < 1 || settings.backgroundBlur !== 'none') {
      const effect = blurEffects[settings.backgroundBlur];
      win.setEffects({ effects: [effect], state: EffectState.FollowsWindowActiveState });
    } else {
      win.clearEffects();
    }
  }, [settings.backgroundBlur, settings.backgroundOpacity]);

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
    <div className="app" style={appThemeStyles as React.CSSProperties}>
      <TabBar
        sessions={sessions}
        activeId={activeId}
        onSelect={switchSession}
        onClose={handleCloseSession}
        onCreate={() => createSession({
          shell: settings.shellPath,
          cwd: settings.newTabCwd === 'current' ? activeSession?.cwd : undefined,
        })}
      />
      <FullDiskAccessBanner />
      <RelayStatus status={activeRelay?.status ?? 'disconnected'} />
      <div className="terminal-area">
        {sessions.map((session) => (
          <TerminalPanel
            key={session.id}
            session={session}
            visible={session.id === activeId}
            fontSize={settings.fontSize}
            fontFamily={settings.fontFamily}
            cursorStyle={settings.cursorStyle}
            cursorBlink={settings.cursorBlink}
            lineHeight={settings.lineHeight}
            theme={THEMES[settings.theme]}
            bellEnabled={settings.bellEnabled}
            backgroundOpacity={settings.backgroundOpacity}
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
            onCreateSessionRequest={handleCreateSessionRequest}
            onSessionClosed={() => handleCloseSession(session.id)}
          />
        ))}
      </div>
      {showSettings && (
        <SettingsPanel
          settings={settings}
          defaults={settingsDefaults}
          onUpdate={updateSettings}
          onReset={resetSettings}
          onClose={() => { setShowSettings(false); setTimeout(focusActive, 50); }}
          onOpenKeybindings={() => setShowKeybindings(true)}
          email={auth.email}
          onLogout={auth.logout}
        />
      )}
      {showKeybindings && (
        <KeybindingsPanel onClose={() => { setShowKeybindings(false); setTimeout(focusActive, 50); }} />
      )}
    </div>
  );
}
