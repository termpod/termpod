import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow, Effect, EffectState } from '@tauri-apps/api/window';
import { useSessionManager, nameFromCwd } from './hooks/useSessionManager';
import { useSettings, THEMES, themeToAppStyles, isLightColor } from './hooks/useSettings';
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
import { CommandPalette } from './components/CommandPalette';
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
    updateSessionCwd,
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
  const [showCommandPalette, setShowCommandPalette] = useState(false);
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

    if (wasLast) {
      createSession({ shell: settings.shellPath });
      return;
    }

    setTimeout(focusActive, 50);
  }, [closeSession, focusActive, device, createSession, settings]);

  // Auto-close tab when shell exits (e.g. ctrl+d)
  onSessionExitRef.current = handleCloseSession;

  // Sync processName changes (from polling) to the relay
  const prevProcessRef = useRef<Map<string, string | null>>(new Map());

  useEffect(() => {
    for (const session of sessions) {
      const prev = prevProcessRef.current.get(session.id);

      if (session.processName !== prev) {
        prevProcessRef.current.set(session.id, session.processName ?? null);
        const relayInfo = relayMapRef.current.get(session.id);

        if (relayInfo?.sessionId) {
          device.updateSession(relayInfo.sessionId, { processName: session.processName });
        }
      }
    }
  }, [sessions, device]);

  // Sync session list to local server for Bonjour-based discovery
  useEffect(() => {
    const localSessions: { id: string; name: string; cwd: string; processName: string | null; ptyCols: number; ptyRows: number }[] = [];

    for (const s of sessions) {
      if (s.exited || s.closing) continue;
      const relayInfo = relayMapRef.current.get(s.id);
      if (!relayInfo?.sessionId) continue;

      localSessions.push({
        id: relayInfo.sessionId,
        name: s.name,
        cwd: s.cwd,
        processName: s.processName ?? null,
        ptyCols: s.pty.cols ?? 120,
        ptyRows: s.pty.rows ?? 40,
      });
    }

    invoke('update_local_sessions', { sessions: localSessions }).catch(() => {});
  }, [sessions, relayMap]);

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

  // When the window is reopened (e.g. dock icon click after close), create a tab if empty
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;

  useEffect(() => {
    const unlisten = listen('app-reopen', () => {
      if (sessionsRef.current.length === 0) {
        createSession({ shell: settings.shellPath });
      }
    });

    return () => { unlisten.then((fn) => fn()); };
  }, [createSession, settings.shellPath]);

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

      case 'duplicate_tab':
        createSession({
          shell: settings.shellPath,
          cwd: activeSession?.cwd,
        });
        break;

      case 'close_other_tabs':
        if (activeId) {
          const toClose = sessions.filter((s) => s.id !== activeId);
          for (const s of toClose) {
            handleCloseSession(s.id);
          }
        }
        break;

      case 'clear':
        if (activeSession) {
          activeSession.termRef.current?.clear();

          if (settings.promptAtBottom) {
            activeSession.pty.write('\x0c');
          }
        }
        break;

      case 'clear_screen':
        if (activeSession) {
          // Send form-feed (Ctrl+L equivalent) to shell for soft clear
          activeSession.pty.write('\x0c');
        }
        break;

      case 'find':
        if (activeSession) {
          activeSession.termRef.current?.openSearch();
        }
        break;

      case 'find_next':
        if (activeSession) {
          activeSession.termRef.current?.findNext();
        }
        break;

      case 'find_prev':
        if (activeSession) {
          activeSession.termRef.current?.findPrevious();
        }
        break;

      case 'select_all':
        if (activeSession) {
          activeSession.termRef.current?.selectAll();
        }
        break;

      case 'zoom_in':
        updateSettings({ fontSize: Math.min(settings.fontSize + 1, 32) });
        break;

      case 'zoom_out':
        updateSettings({ fontSize: Math.max(settings.fontSize - 1, 8) });
        break;

      case 'zoom_reset':
        updateSettings({ fontSize: settingsDefaults.fontSize });
        break;

      case 'scroll_top':
        if (activeSession) {
          activeSession.termRef.current?.scrollToTop();
        }
        break;

      case 'scroll_bottom':
        if (activeSession) {
          activeSession.termRef.current?.scrollToBottom();
        }
        break;

      case 'command_palette':
        setShowCommandPalette((v) => !v);
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
  // Use capture phase so we intercept before xterm processes keys
  const bindingsRef = useRef(bindings);
  bindingsRef.current = bindings;

  // Shortcuts that should fire even when a text input is focused
  const GLOBAL_SHORTCUT_IDS = new Set([
    'new_tab', 'close_tab', 'duplicate_tab', 'next_tab', 'prev_tab',
    'close_other_tabs', 'command_palette', 'settings', 'keybindings',
    'zoom_in', 'zoom_out', 'zoom_reset', 'find',
  ]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';

      for (const kb of bindingsRef.current) {
        if (matchesShortcut(e, kb.shortcut)) {
          // Skip terminal-only shortcuts when user is typing in an input
          if (inInput && !GLOBAL_SHORTCUT_IDS.has(kb.id)) {
            return;
          }

          e.preventDefault();
          e.stopPropagation();
          menuHandlerRef.current(kb.id);
          return;
        }
      }
    };

    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, []);

  const opacity = settings.backgroundOpacity;
  const baseTheme = THEMES[settings.theme] ?? THEMES['tokyo-night'];
  const appThemeStyles = useMemo(
    () => themeToAppStyles(baseTheme, opacity),
    [settings.theme, opacity],
  );

  const terminalTheme = useMemo(() => {
    const light = isLightColor(baseTheme.background);
    const c = light ? '0, 0, 0' : '255, 255, 255';
    return {
      ...baseTheme,
      scrollbarSliderBackground: `rgba(${c}, 0.12)`,
      scrollbarSliderHoverBackground: `rgba(${c}, 0.25)`,
      scrollbarSliderActiveBackground: `rgba(${c}, 0.35)`,
    };
  }, [settings.theme]);

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
            fontWeight={settings.fontWeight}
            fontSmoothing={settings.fontSmoothing}
            fontLigatures={settings.fontLigatures}
            drawBoldInBold={settings.drawBoldInBold}
            windowPadding={settings.windowPadding}
            cursorStyle={settings.cursorStyle}
            cursorBlink={settings.cursorBlink}
            lineHeight={settings.lineHeight}
            promptAtBottom={settings.promptAtBottom}
            theme={terminalTheme}
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
            onDeleteSession={(relaySessionId) => {
              // Find local session by relay session ID and close it
              for (const [localId, info] of relayMapRef.current.entries()) {
                if (info.sessionId === relaySessionId) {
                  handleCloseSession(localId);
                  break;
                }
              }
            }}
            onSessionClosed={() => handleCloseSession(session.id)}
            onCwdChange={(cwd) => {
              updateSessionCwd(session.id, cwd);
              const relayInfo = relayMapRef.current.get(session.id);

              if (relayInfo?.sessionId) {
                device.updateSession(relayInfo.sessionId, { name: nameFromCwd(cwd), cwd });
              }
            }}
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
      {showCommandPalette && (
        <CommandPalette
          onClose={() => { setShowCommandPalette(false); setTimeout(focusActive, 50); }}
          onExecute={(id) => { setShowCommandPalette(false); menuHandlerRef.current(id); }}
        />
      )}
    </div>
  );
}
