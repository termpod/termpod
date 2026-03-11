import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow, Effect, EffectState } from '@tauri-apps/api/window';
import { useSessionManager, nameFromCwd } from './hooks/useSessionManager';
import { useSettings, THEMES, themeToAppStyles, isLightColor } from './hooks/useSettings';
import { useAuth } from './hooks/useAuth';
import { useDevice } from './hooks/useDevice';
import { TabBar } from './components/TabBar';
import { TerminalPanel } from './components/TerminalPanel';
import type { RelayInfo } from './components/TerminalPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { ConnectedDevicesPanel } from './components/ConnectedDevicesPanel';
import { LoginScreen } from './components/LoginScreen';
import { FullDiskAccessBanner } from './components/FullDiskAccessBanner';
import { UpdateBanner } from './components/UpdateBanner';
import { useUpdater } from './hooks/useUpdater';
import { KeybindingsPanel } from './components/KeybindingsPanel';
import { CommandPalette } from './components/CommandPalette';
import { useKeybindings, matchesShortcut } from './hooks/useKeybindings';
import { useDeviceWS } from './hooks/useDeviceWS';
import { enable as enableAutostart, disable as disableAutostart } from '@tauri-apps/plugin-autostart';

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
    markTermReady,
    renameSession,
    reorderSessions,
    updateSessionCwd,
    onSessionExitRef,
  } = useSessionManager();

  const { settings, update: updateSettings, reset: resetSettings, defaults: settingsDefaults } = useSettings();
  const updater = useUpdater();

  // Wire up remote session creation callback (legacy polling fallback)
  createSessionRef.current = () => {
    const win = getCurrentWindow();
    win.show();
    win.setFocus();
    createSession({ shell: settings.shellPath });
  };

  // Helper: build sessions list for P2P/relay control messages
  const getSessionsListRef = useRef<() => Record<string, unknown>[]>(() => []);

  // Helper: handle delete session by relay ID
  const handleDeleteSessionByRelayIdRef = useRef<(relaySessionId: string) => void>(() => {});

  // Device-level WebSocket to relay (control plane + signaling)
  const deviceWS = useDeviceWS(device.deviceId, device.registered, {
    onCreateSessionRequest: (requestId) => {
      // Device WS create session request — create and respond via device WS
      (async () => {
        const win = getCurrentWindow();
        win.show();
        win.setFocus();

        const newSession = await createSession({ shell: settings.shellPath });

        if (!newSession) {
          return;
        }

        // Wait for relay session ID to be assigned
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
        deviceWS.sendSessionCreated({
          requestId,
          sessionId: relayInfo.sessionId,
          name: newSession.name,
          cwd: newSession.cwd,
          ptyCols: term?.cols ?? 120,
          ptyRows: term?.rows ?? 40,
        });
      })();
    },
    onDeleteSession: (sessionId) => {
      handleDeleteSessionByRelayIdRef.current(sessionId);
    },
    getSessionsList: () => getSessionsListRef.current(),
    onSignaling: (msg) => {
      // Forward WebRTC signaling from device WS to all active sessions' WebRTC handlers
      for (const info of relayMapRef.current.values()) {
        info.handleWebRTCSignaling?.(msg).catch(() => {});
      }
    },
    onClientJoined: (clientId, clientDevice) => {
      // When a mobile viewer connects via device WS, initiate WebRTC offer
      // through the first active session's relay bridge
      console.log('[DeviceWS] client_joined:', clientId, clientDevice);
      if (clientDevice === 'macos') return; // Don't offer to other desktops
      console.log('[DeviceWS] Initiating WebRTC offer to', clientId);
      let offered = false;
      for (const info of relayMapRef.current.values()) {
        if (info.sessionId && info.initiateWebRTCOffer) {
          console.log('[DeviceWS] Using session', info.sessionId, 'for WebRTC offer');
          info.initiateWebRTCOffer(clientId).catch((e) => console.error('[DeviceWS] WebRTC offer failed:', e));
          offered = true;
          break; // Only need one WebRTC connection
        }
      }
      if (!offered) {
        console.warn('[DeviceWS] No active session found for WebRTC offer');
      }
    },
  });

  // Handle push-based session creation requests from mobile (via per-session transports)
  const handleCreateSessionRequest = useCallback(
    async (requestId: string, source: 'relay' | 'local' | 'webrtc', localClientId?: string) => {
      const win = getCurrentWindow();
      win.show();
      win.setFocus();

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
        // Respond via device WS — works for both WebRTC and relay sources.
        // WebRTC is per-session so the new session won't have a WebRTC connection;
        // device WS is device-level and the relay broadcasts to all viewers.
        deviceWS.sendSessionCreated({
          requestId,
          sessionId: relayInfo.sessionId,
          name: newSession.name,
          cwd: newSession.cwd,
          ptyCols: term?.cols ?? 120,
          ptyRows: term?.rows ?? 40,
        });
      }
    },
    [createSession, settings.shellPath, deviceWS.sendSessionCreated],
  );

  const [showSettings, setShowSettings] = useState(false);
  const [showKeybindings, setShowKeybindings] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showDevicesPanel, setShowDevicesPanel] = useState(false);
  const [confirmClose, setConfirmClose] = useState<{ sessionId: string; processName: string } | null>(null);
  const { bindings } = useKeybindings();
  const initializedRef = useRef(false);
  const [relayMap, setRelayMap] = useState<Map<string, RelayInfo>>(new Map());
  const relayMapRef = useRef(relayMap);
  relayMapRef.current = relayMap;

  // Shared WebRTC: find the connected WebRTC's mux send functions.
  // Called by each session's PTY listener so all sessions can send through
  // the single connected WebRTC DataChannel with session multiplexing.
  const getSharedWebRTC = useCallback(() => {
    for (const info of relayMapRef.current.values()) {
      if (info.webrtcIsConnected && info.webrtcSendTerminalData) {
        return {
          sendTerminalData: info.webrtcSendTerminalData,
          sendResize: info.webrtcSendResize!,
          isConnected: true,
        };
      }
    }
    return null;
  }, []);

  // Route multiplexed WebRTC input from iOS to the correct session's PTY
  const handleWebRTCMuxInput = useCallback((sessionId: string, data: string) => {
    for (const [localId, info] of relayMapRef.current.entries()) {
      if (info.sessionId === sessionId) {
        const session = sessions.find((s) => s.id === localId);
        if (session && !session.exited) {
          session.pty.write(data);
        }
        break;
      }
    }
  }, [sessions]);

  // Route multiplexed WebRTC resize from iOS to the correct session
  const handleWebRTCMuxResize = useCallback((sessionId: string, cols: number, rows: number) => {
    for (const [localId, info] of relayMapRef.current.entries()) {
      if (info.sessionId === sessionId) {
        const session = sessions.find((s) => s.id === localId);
        if (session && !session.exited) {
          const term = session.termRef.current;
          const currentRows = term?.rows ?? 40;
          session.pty.resize(cols, currentRows);
          term?.lockSize();
          term?.resize(cols, currentRows);
        }
        break;
      }
    }
  }, [sessions]);

  const handleCloseSession = useCallback((id: string, skipConfirm = false) => {
    // Confirm before closing a tab with a running process
    if (!skipConfirm && settings.confirmCloseRunningProcess) {
      const session = sessions.find((s) => s.id === id);
      if (session && !session.exited && session.processName) {
        setConfirmClose({ sessionId: id, processName: session.processName });
        return;
      }
    }

    // Notify P2P viewers and unregister session from relay before closing
    const relayInfo = relayMapRef.current.get(id);

    if (relayInfo?.sessionId) {
      const closedMsg = JSON.stringify({ type: 'session_closed', sessionId: relayInfo.sessionId });
      relayInfo.sendLocalControl?.(relayInfo.sessionId, closedMsg);
      relayInfo.sendWebRTCControl?.({ type: 'session_closed', sessionId: relayInfo.sessionId });
      deviceWS.sendSessionClosed(relayInfo.sessionId);
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
  }, [closeSession, focusActive, device, deviceWS, createSession, settings, sessions]);

  // Auto-close tab when shell exits (e.g. ctrl+d)
  onSessionExitRef.current = (id: string) => {
    if (settings.notifyOnProcessExit && !document.hasFocus()) {
      const session = sessions.find((s) => s.id === id);
      new Notification('Process Exited', {
        body: session?.processName || session?.name || 'Terminal',
      });
    }
    handleCloseSession(id);
  };

  // Sync launch-at-login with system autostart
  useEffect(() => {
    if (settings.launchAtLogin) {
      enableAutostart().catch(() => {});
    } else {
      disableAutostart().catch(() => {});
    }
  }, [settings.launchAtLogin]);

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

  // Build sessions list (shared by local server, device WS, and P2P control messages)
  const buildSessionsList = useCallback(() => {
    const list: { id: string; name: string; cwd: string; processName: string | null; ptyCols: number; ptyRows: number }[] = [];

    for (const s of sessions) {
      if (s.exited || s.closing) continue;
      const relayInfo = relayMapRef.current.get(s.id);
      if (!relayInfo?.sessionId) continue;

      list.push({
        id: relayInfo.sessionId,
        name: s.name,
        cwd: s.cwd,
        processName: s.processName ?? null,
        ptyCols: s.pty.cols ?? 120,
        ptyRows: s.pty.rows ?? 40,
      });
    }

    return list;
  }, [sessions]);

  // Wire up refs for device WS callbacks
  getSessionsListRef.current = buildSessionsList;

  handleDeleteSessionByRelayIdRef.current = (relaySessionId: string) => {
    for (const [localId, info] of relayMapRef.current.entries()) {
      if (info.sessionId === relaySessionId) {
        handleCloseSession(localId);
        break;
      }
    }
  };

  // Sync session list to local server + device WS
  useEffect(() => {
    const localSessions = buildSessionsList();

    invoke('update_local_sessions', { sessions: localSessions }).catch(() => {});

    // Also push to device WS so relay SQLite stays in sync and mobile viewers get updates
    deviceWS.sendSessionsUpdated(localSessions);
  }, [sessions, relayMap, buildSessionsList, deviceWS.sendSessionsUpdated]);

  const activeRelay = activeId ? relayMap.get(activeId) : null;

  const sessionDevices = useMemo(() => {
    return sessions
      .filter((s) => !s.exited && !s.closing)
      .map((s) => {
        const info = relayMap.get(s.id);
        return {
          sessionName: s.name,
          sessionId: info?.sessionId ?? null,
          relayStatus: info?.status ?? ('disconnected' as const),
          devices: info?.connectedDevices ?? [],
        };
      });
  }, [sessions, relayMap]);

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

  const resolveNewTabCwd = useCallback(() => {
    if (settings.newTabCwd === 'current') return activeSession?.cwd;
    if (settings.newTabCwd === 'custom' && settings.customTabCwdPath) return settings.customTabCwdPath;
    return undefined; // home (default in createSession)
  }, [settings.newTabCwd, settings.customTabCwdPath, activeSession?.cwd]);

  // Global listener for local (Bonjour) session creation requests when no sessions exist.
  // When sessions exist, the per-panel useLocalServer listener handles these instead.
  useEffect(() => {
    const unlisten = listen<{ requestId: string; clientId: string }>('local-ws-create-session', (event) => {
      if (sessionsRef.current.length === 0) {
        handleCreateSessionRequest(event.payload.requestId, 'local', event.payload.clientId);
      }
    });

    return () => { unlisten.then((fn) => fn()); };
  }, [handleCreateSessionRequest]);

  // Listen for Tauri menu events
  const menuHandlerRef = useRef((_menuId: string) => {});

  menuHandlerRef.current = (menuId: string) => {
    switch (menuId) {
      case 'new_tab':
        createSession({
          shell: settings.shellPath,
          cwd: resolveNewTabCwd(),
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

      case 'rename_tab':
        if (activeId && activeSession) {
          const newName = window.prompt('Rename tab:', activeSession.name);
          if (newName !== null && newName.trim()) {
            renameSession(activeId, newName.trim());
          }
        }
        break;

      case 'check_updates':
        updater.manualCheckForUpdate();
        break;

      case 'termpod_help':
        invoke('open_url', { url: 'https://termpod.dev/docs' });
        break;

      case 'report_issue':
        invoke('open_url', { url: 'https://github.com/anthropics/termpod/issues' });
        break;

      default:
        if (menuId.startsWith('theme_')) {
          const themeKey = menuId.slice(6);
          if (THEMES[themeKey]) {
            updateSettings({ theme: themeKey });
          }
        } else if (menuId.startsWith('tab_')) {
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
    if (settings.blurRadius > 0) {
      const effect = settings.blurRadius >= 10
        ? Effect.Sidebar
        : settings.blurRadius >= 4
          ? Effect.UnderWindowBackground
          : Effect.HudWindow;
      win.setEffects({ effects: [effect], state: EffectState.FollowsWindowActiveState });
    } else {
      win.clearEffects();
    }
  }, [settings.blurRadius, settings.backgroundOpacity]);

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
          cwd: resolveNewTabCwd(),
        })}
        onReorder={reorderSessions}
        relayStatus={activeRelay?.status ?? 'disconnected'}
        connectedDevices={activeRelay?.connectedDevices ?? []}
        onToggleDevices={() => setShowDevicesPanel((v) => !v)}
        devicesPanelOpen={showDevicesPanel}
      />
      <UpdateBanner {...updater} />
      <FullDiskAccessBanner />
      <div className="terminal-area">
        {sessions.map((session) => (
          <TerminalPanel
            key={session.id}
            session={session}
            visible={session.id === activeId}
            onTermReady={markTermReady}
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
            copyOnSelect={settings.copyOnSelect}
            macOptionIsMeta={settings.macOptionIsMeta}
            altClickMoveCursor={settings.altClickMoveCursor}
            wordSeparators={settings.wordSeparators}
            theme={terminalTheme}
            bellEnabled={settings.bellEnabled}
            notifyOnBell={settings.notifyOnBell}
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
            getSessionsList={() => {
              const list: Record<string, unknown>[] = [];
              for (const s of sessions) {
                if (s.exited || s.closing) continue;
                const info = relayMapRef.current.get(s.id);
                if (!info?.sessionId) continue;
                list.push({
                  id: info.sessionId,
                  name: s.name,
                  cwd: s.cwd,
                  processName: s.processName ?? null,
                  ptyCols: s.pty.cols ?? 120,
                  ptyRows: s.pty.rows ?? 40,
                });
              }
              return list;
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
            deviceSendSignaling={deviceWS.sendSignaling}
            deviceClientId={deviceWS.clientId}
            onWebRTCMuxInput={handleWebRTCMuxInput}
            onWebRTCMuxResize={handleWebRTCMuxResize}
            getSharedWebRTC={getSharedWebRTC}
            onCwdChange={(cwd) => {
              updateSessionCwd(session.id, cwd);
              const relayInfo = relayMapRef.current.get(session.id);

              if (relayInfo?.sessionId) {
                device.updateSession(relayInfo.sessionId, { name: nameFromCwd(cwd), cwd });
              }
            }}
          />
        ))}
        {showDevicesPanel && (
          <ConnectedDevicesPanel
            sessionDevices={sessionDevices}
            onClose={() => { setShowDevicesPanel(false); setTimeout(focusActive, 50); }}
          />
        )}
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
      {confirmClose && (
        <ConfirmDialog
          processName={confirmClose.processName}
          onConfirm={() => { const id = confirmClose.sessionId; setConfirmClose(null); handleCloseSession(id, true); }}
          onCancel={() => { setConfirmClose(null); setTimeout(focusActive, 50); }}
        />
      )}
    </div>
  );
}

function ConfirmDialog({ processName, onConfirm, onCancel }: { processName: string; onConfirm: () => void; onCancel: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        onConfirm();
      }
    };

    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onConfirm, onCancel]);

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-title">
          Do you want to close this tab?
        </div>
        <div className="confirm-message">
          <span className="confirm-process">{processName}</span> is still running.
        </div>
        <div className="confirm-actions">
          <button type="button" className="confirm-btn confirm-btn-cancel" onClick={onCancel}>
            Cancel
          </button>
          <button ref={closeRef} type="button" className="confirm-btn confirm-btn-close" onClick={onConfirm}>
            Close Tab
          </button>
        </div>
      </div>
    </div>
  );
}
