import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow, Effect, EffectState } from '@tauri-apps/api/window';
import { useSessionManager, nameFromCwd } from './hooks/useSessionManager';
import { useSettings, THEMES, themeToAppStyles, isLightColor } from './hooks/useSettings';
import {
  initCustomThemes,
  getCustomThemesSnapshot,
  subscribeCustomThemes,
} from './lib/configStore';
import { resolveTheme } from './components/ThemePicker';

initCustomThemes();
import { useAuth, useSubscription } from './hooks/useAuth';
import { useDevice } from './hooks/useDevice';
import { TabBar } from './components/TabBar';
import { TerminalPanel } from './components/TerminalPanel';
import type { RelayInfo } from './components/TerminalPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { ConnectedDevicesPanel } from './components/ConnectedDevicesPanel';
import { LoginScreen } from './components/LoginScreen';
import { FullDiskAccessBanner } from './components/FullDiskAccessBanner';
import { UpdateBanner } from './components/UpdateBanner';
import { RelayGatedBanner, TrialExpiringBanner } from './components/RelayGatedBanner';
import { useUpdater } from './hooks/useUpdater';
import { KeybindingsPanel } from './components/KeybindingsPanel';
import { CommandPalette } from './components/CommandPalette';
import { useKeybindings, matchesShortcut } from './hooks/useKeybindings';
import { useDeviceWS } from './hooks/useDeviceWS';
import { getTermifyPayload } from './termify';
import { useWorkflows } from './hooks/useWorkflows';
import { WorkflowsPanel } from './components/WorkflowsPanel';
import { authFetch } from './hooks/useAuth';
import { ShareDialog } from './components/ShareDialog';
import { AboutModal } from './components/AboutModal';
import { OnboardingScreen } from './components/OnboardingScreen';
import {
  useRecording,
  startRecording,
  stopRecording,
  appendOutput,
  isRecording,
} from './hooks/useRecording';
import { generateShareKey, createShareCryptoSession } from '@termpod/protocol';
import {
  enable as enableAutostart,
  disable as disableAutostart,
} from '@tauri-apps/plugin-autostart';
import {
  register as registerShortcut,
  unregister as unregisterShortcut,
} from '@tauri-apps/plugin-global-shortcut';
import { loadSessionState, saveSessionState, saveSessionStateSync } from './lib/sessionState';
import { useProfiles } from './hooks/useProfiles';
import type { TerminalProfile } from './hooks/useProfiles';
import { usePaneLayout, findNeighborPane } from './hooks/usePaneLayout';
import { PaneContainer } from './components/PaneContainer';

export function App() {
  const auth = useAuth();
  const { isPro, isOnTrial, trialDaysLeft, selfHosted, subscription } = useSubscription();
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
    getSessionState,
  } = useSessionManager();

  const {
    settings,
    update: updateSettings,
    reset: resetSettings,
    defaults: settingsDefaults,
  } = useSettings();
  const paneLayout = usePaneLayout();
  const paneLayoutRef = useRef(paneLayout);
  paneLayoutRef.current = paneLayout;
  const updater = useUpdater();
  const customThemes = useSyncExternalStore(subscribeCustomThemes, getCustomThemesSnapshot);

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
          info
            .initiateWebRTCOffer(clientId)
            .catch((e) => console.error('[DeviceWS] WebRTC offer failed:', e));
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

  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const showOnboarding = !onboardingDismissed && !settings.onboardingComplete;
  const [showSettings, setShowSettings] = useState(false);
  const [showKeybindings, setShowKeybindings] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showDevicesPanel, setShowDevicesPanel] = useState(false);
  const [showWorkflows, setShowWorkflows] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [shareMap, setShareMap] = useState<Map<string, { shareUrl: string; expiresAt: string }>>(
    new Map(),
  );
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [confirmShare, setConfirmShare] = useState(false);
  const [confirmClose, setConfirmClose] = useState<{
    sessionId: string;
    processName: string;
  } | null>(null);
  const { bindings } = useKeybindings();
  const {
    workflows,
    add: addWorkflow,
    remove: removeWorkflow,
    edit: editWorkflow,
  } = useWorkflows();
  const recording = useRecording();
  const { profiles, defaultProfileId, addProfile, updateProfile, removeProfile, setDefault } =
    useProfiles();
  const [showProfilePicker, setShowProfilePicker] = useState(false);
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
  const handleWebRTCMuxInput = useCallback(
    (sessionId: string, data: string) => {
      for (const [localId, info] of relayMapRef.current.entries()) {
        if (info.sessionId === sessionId) {
          const session = sessions.find((s) => s.id === localId);
          if (session && !session.exited) {
            session.pty.write(data);
          }
          break;
        }
      }
    },
    [sessions],
  );

  // Route multiplexed WebRTC resize from iOS to the correct session
  const handleWebRTCMuxResize = useCallback(
    (sessionId: string, cols: number, rows: number) => {
      for (const [localId, info] of relayMapRef.current.entries()) {
        if (info.sessionId === sessionId) {
          const session = sessions.find((s) => s.id === localId);
          if (session && !session.exited) {
            const term = session.termRef.current;
            const nextRows = rows > 0 ? rows : (term?.rows ?? 40);
            session.pty.resize(cols, nextRows);
            term?.lockSize();
            term?.resize(cols, nextRows);
          }
          break;
        }
      }
    },
    [sessions],
  );

  const handleCloseSession = useCallback(
    (id: string, skipConfirm = false) => {
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
        const closedMsg = JSON.stringify({
          type: 'session_closed',
          sessionId: relayInfo.sessionId,
        });
        relayInfo.sendLocalControl?.(relayInfo.sessionId, closedMsg);
        relayInfo.sendWebRTCControl?.({ type: 'session_closed', sessionId: relayInfo.sessionId });
        deviceWS.sendSessionClosed(relayInfo.sessionId);
        device.removeSession(relayInfo.sessionId);
      }

      // Clean up share state
      setShareMap((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Map(prev);
        next.delete(id);
        return next;
      });

      // Stop recording if active (discard — session is closing)
      if (isRecording(id)) {
        // Remove the data listener before stopping
        const listener = recordingListenersRef.current.get(id);
        const session = sessions.find((s) => s.id === id);

        if (listener && session) {
          session.dataListeners.delete(listener);
          recordingListenersRef.current.delete(id);
        }

        stopRecording(id);
      }

      // Clean up pane tree entry if this was a tab root
      paneLayoutRef.current.removeTabTree(id);

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
    },
    [closeSession, focusActive, device, deviceWS, createSession, settings, sessions],
  );

  // Auto-close tab when shell exits (e.g. ctrl+d)
  onSessionExitRef.current = (id: string) => {
    if (settings.notifyOnProcessExit && !document.hasFocus()) {
      const session = sessions.find((s) => s.id === id);
      new Notification('Process Exited', {
        body: session?.processName || session?.name || 'Terminal',
      });
    }

    // If this session is a pane in a split, remove it from the tree first
    const result = paneLayoutRef.current.closePane(id);
    if (result.removedFromTree && result.promotedSessionId) {
      paneLayoutRef.current.setFocusedPane(result.promotedSessionId);
    }

    handleCloseSession(id);
  };

  // Recording data listeners: pipe PTY output to the recorder
  const recordingListenersRef = useRef<Map<string, (data: Uint8Array | number[]) => void>>(
    new Map(),
  );

  useEffect(() => {
    for (const session of sessions) {
      if (isRecording(session.id) && !recordingListenersRef.current.has(session.id)) {
        const listener = (data: Uint8Array | number[]) => {
          appendOutput(session.id, data instanceof Uint8Array ? data : new Uint8Array(data));
        };

        session.dataListeners.add(listener);
        recordingListenersRef.current.set(session.id, listener);
      }

      if (!isRecording(session.id) && recordingListenersRef.current.has(session.id)) {
        const listener = recordingListenersRef.current.get(session.id)!;
        session.dataListeners.delete(listener);
        recordingListenersRef.current.delete(session.id);
      }
    }
  }, [sessions, recording]);

  // Sync launch-at-login with system autostart
  useEffect(() => {
    if (settings.launchAtLogin) {
      enableAutostart().catch(() => {});
    } else {
      disableAutostart().catch(() => {});
    }
  }, [settings.launchAtLogin]);

  // Register/unregister global dropdown shortcut
  useEffect(() => {
    if (!settings.dropdownEnabled || !settings.dropdownHotkey) return;

    const hotkey = settings.dropdownHotkey;
    let registered = false;

    registerShortcut(hotkey, () => {
      invoke('toggle_dropdown').catch(console.error);
    })
      .then(() => {
        registered = true;
      })
      .catch(console.error);

    return () => {
      if (registered) {
        unregisterShortcut(hotkey).catch(console.error);
      }
    };
  }, [settings.dropdownEnabled, settings.dropdownHotkey]);

  // Sync processName changes instantly via device WS (no SQL write, just forwarded to viewers)
  const prevProcessRef = useRef<Map<string, string | null>>(new Map());

  useEffect(() => {
    for (const session of sessions) {
      const prev = prevProcessRef.current.get(session.id);

      if (session.processName !== prev) {
        prevProcessRef.current.set(session.id, session.processName ?? null);
        const relayInfo = relayMapRef.current.get(session.id);

        if (relayInfo?.sessionId) {
          // Instant WS push to viewers (no DB write — sessions_updated bulk sync handles persistence)
          deviceWS.sendSessionPropertyChanged(relayInfo.sessionId, {
            processName: session.processName,
          });
        }
      }
    }
  }, [sessions, deviceWS.sendSessionPropertyChanged]);

  // Build sessions list (shared by local server, device WS, and P2P control messages)
  const buildSessionsList = useCallback(() => {
    const list: {
      id: string;
      name: string;
      cwd: string;
      processName: string | null;
      ptyCols: number;
      ptyRows: number;
    }[] = [];

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

  // Sync session list to local server + device WS (debounced to avoid excessive relay writes)
  const sessionsUpdatedTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const lastSentSessionsJsonRef = useRef<string>('');

  useEffect(() => {
    const localSessions = buildSessionsList();

    // Always update local server immediately (no relay cost)
    invoke('update_local_sessions', { sessions: localSessions }).catch(() => {});

    // Debounce relay sync: skip if payload is identical, otherwise wait 5s
    const json = JSON.stringify(localSessions);

    if (json === lastSentSessionsJsonRef.current) {
      return;
    }

    clearTimeout(sessionsUpdatedTimerRef.current);
    sessionsUpdatedTimerRef.current = setTimeout(() => {
      lastSentSessionsJsonRef.current = json;
      deviceWS.sendSessionsUpdated(localSessions);
    }, 5_000);

    return () => clearTimeout(sessionsUpdatedTimerRef.current);
  }, [sessions, buildSessionsList, deviceWS.sendSessionsUpdated]);

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

  // Create initial session (or restore previous sessions) on mount
  useEffect(() => {
    if (!auth.isAuthenticated || initializedRef.current) {
      return;
    }

    initializedRef.current = true;

    (async () => {
      if (settings.restoreSessions) {
        const saved = await loadSessionState();

        if (saved && saved.tabs.length > 0) {
          const created: string[] = [];

          for (const tab of saved.tabs) {
            const session = await createSession({ shell: settings.shellPath, cwd: tab.cwd });
            created.push(session.id);
          }

          // Switch to the previously active tab
          if (saved.activeIndex >= 0 && saved.activeIndex < created.length) {
            switchSession(created[saved.activeIndex]);
          }

          return;
        }
      }

      createSession({ shell: settings.shellPath });
    })();
  }, [auth.isAuthenticated]); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist session state (tabs + cwds) for restore on next launch
  const getSessionStateRef = useRef(getSessionState);
  getSessionStateRef.current = getSessionState;
  const restoreEnabledRef = useRef(settings.restoreSessions);
  restoreEnabledRef.current = settings.restoreSessions;

  useEffect(() => {
    if (!settings.restoreSessions) {
      return;
    }

    saveSessionState(getSessionState());
  }, [sessions, activeId, settings.restoreSessions]); // eslint-disable-line react-hooks/exhaustive-deps

  // Save session state before window closes
  useEffect(() => {
    const unlisten = getCurrentWindow().onCloseRequested(async () => {
      if (restoreEnabledRef.current) {
        await saveSessionStateSync(getSessionStateRef.current());
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

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

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [createSession, settings.shellPath]);

  const resolveNewTabCwd = useCallback(() => {
    if (settings.newTabCwd === 'current') return activeSession?.cwd;
    if (settings.newTabCwd === 'custom' && settings.customTabCwdPath)
      return settings.customTabCwdPath;
    return undefined; // home (default in createSession)
  }, [settings.newTabCwd, settings.customTabCwdPath, activeSession?.cwd]);

  const createSessionFromProfile = useCallback(
    (profileId: string) => {
      const profile = profiles.find((p) => p.id === profileId);
      if (!profile) return;
      createSession({
        shell: profile.shell || settings.shellPath,
        cwd: profile.cwd || undefined,
        env: Object.keys(profile.env).length > 0 ? profile.env : undefined,
      });
    },
    [profiles, createSession, settings.shellPath],
  );

  // Global listener for local (Bonjour) session creation requests when no sessions exist.
  // When sessions exist, the per-panel useLocalServer listener handles these instead.
  useEffect(() => {
    const unlisten = listen<{ requestId: string; clientId: string }>(
      'local-ws-create-session',
      (event) => {
        if (sessionsRef.current.length === 0) {
          handleCreateSessionRequest(event.payload.requestId, 'local', event.payload.clientId);
        }
      },
    );

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [handleCreateSessionRequest]);

  // Listen for Tauri menu events
  const menuHandlerRef = useRef((_menuId: string) => {});

  menuHandlerRef.current = (menuId: string) => {
    switch (menuId) {
      case 'new_tab':
        if (defaultProfileId) {
          createSessionFromProfile(defaultProfileId);
        } else {
          createSession({
            shell: settings.shellPath,
            cwd: resolveNewTabCwd(),
          });
        }
        break;

      case 'new_tab_with_profile':
        if (profiles.length > 0) {
          setShowProfilePicker(true);
        } else {
          createSession({
            shell: settings.shellPath,
            cwd: resolveNewTabCwd(),
          });
        }
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

      case 'termify':
        if (activeSession) {
          activeSession.pty.write(getTermifyPayload());
        }
        break;

      case 'record_session': {
        if (!activeId || !activeSession) break;

        if (isRecording(activeId)) {
          stopRecording(activeId);
        } else {
          const term = activeSession.termRef.current;
          startRecording(activeId, term?.cols ?? 120, term?.rows ?? 40, activeSession.name);
        }
        break;
      }

      case 'share_session': {
        if (!activeId) break;

        // If already shared, show the link dialog
        if (shareMap.has(activeId)) {
          setShowShareDialog(true);
          break;
        }

        // Ask for confirmation before sharing
        setConfirmShare(true);
        break;
      }

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

      case 'export_scrollback':
        if (activeSession) {
          const text = activeSession.termRef.current?.getScrollbackText();
          if (text) {
            (async () => {
              try {
                const { save } = await import('@tauri-apps/plugin-dialog');
                const { writeTextFile } = await import('@tauri-apps/plugin-fs');
                const filePath = await save({
                  defaultPath: `${activeSession.name || 'terminal'}-scrollback.txt`,
                  filters: [{ name: 'Text', extensions: ['txt'] }],
                });
                if (filePath) {
                  await writeTextFile(filePath, text);
                }
              } catch (e) {
                console.error('Failed to export scrollback:', e);
              }
            })();
          }
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

      case 'workflows':
        setShowWorkflows((v) => !v);
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

      case 'about':
        setShowAbout(true);
        break;

      case 'termpod_help':
        invoke('open_url', { url: 'https://termpod.dev/docs' });
        break;

      case 'report_issue':
        invoke('open_url', { url: 'https://github.com/termpod/termpod/issues' });
        break;

      case 'split_right': {
        if (!activeId) break;
        const focusedId = paneLayout.focusedPaneId || activeId;
        const focusedSession = sessions.find((s) => s.id === focusedId);
        createSession({
          shell: settings.shellPath,
          cwd: focusedSession?.cwd,
        }).then((newSession) => {
          if (newSession) {
            paneLayout.splitPane(focusedId, 'horizontal', newSession.id);
          }
        });
        break;
      }

      case 'split_down': {
        if (!activeId) break;
        const focusedId = paneLayout.focusedPaneId || activeId;
        const focusedSession = sessions.find((s) => s.id === focusedId);
        createSession({
          shell: settings.shellPath,
          cwd: focusedSession?.cwd,
        }).then((newSession) => {
          if (newSession) {
            paneLayout.splitPane(focusedId, 'vertical', newSession.id);
          }
        });
        break;
      }

      case 'close_pane': {
        const focusedId = paneLayout.focusedPaneId;
        if (!focusedId || !activeId) break;
        if (!paneLayout.hasSplits(activeId)) {
          // No splits — close the whole tab
          handleCloseSession(activeId);
          break;
        }
        const result = paneLayout.closePane(focusedId);
        if (result.removedFromTree) {
          handleCloseSession(focusedId);
          if (result.promotedSessionId) {
            paneLayout.setFocusedPane(result.promotedSessionId);
            const promoted = sessions.find((s) => s.id === result.promotedSessionId);
            promoted?.termRef.current?.focus();
          }
        }
        break;
      }

      case 'focus_pane_left':
      case 'focus_pane_right':
      case 'focus_pane_up':
      case 'focus_pane_down': {
        if (!activeId) break;
        const direction = menuId.replace('focus_pane_', '') as 'left' | 'right' | 'up' | 'down';
        const currentFocus = paneLayout.focusedPaneId || activeId;
        const tree = paneLayout.getTree(activeId);
        const neighbor = findNeighborPane(tree, currentFocus, direction);
        if (neighbor) {
          paneLayout.setFocusedPane(neighbor);
          const neighborSession = sessions.find((s) => s.id === neighbor);
          neighborSession?.termRef.current?.focus();
        }
        break;
      }

      default:
        if (menuId.startsWith('theme_')) {
          const themeKey = menuId.slice(6);
          if (THEMES[themeKey] || getCustomThemesSnapshot()[themeKey]) {
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
    'new_tab',
    'new_tab_with_profile',
    'close_tab',
    'duplicate_tab',
    'next_tab',
    'prev_tab',
    'close_other_tabs',
    'command_palette',
    'settings',
    'keybindings',
    'zoom_in',
    'zoom_out',
    'zoom_reset',
    'find',
    'split_right',
    'split_down',
    'close_pane',
    'focus_pane_left',
    'focus_pane_right',
    'focus_pane_up',
    'focus_pane_down',
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
  const baseTheme = resolveTheme(settings.theme, customThemes);
  const appThemeStyles = useMemo(
    () => themeToAppStyles(baseTheme, opacity),
    [settings.theme, customThemes, opacity],
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
  }, [settings.theme, customThemes]);

  // Apply/remove macOS vibrancy effect
  useEffect(() => {
    const win = getCurrentWindow();
    if (settings.blurRadius > 0) {
      const effect =
        settings.blurRadius >= 10
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
        onCreate={() =>
          createSession({
            shell: settings.shellPath,
            cwd: resolveNewTabCwd(),
          })
        }
        onReorder={reorderSessions}
        relayStatus={activeRelay?.status ?? 'disconnected'}
        connectedDevices={activeRelay?.connectedDevices ?? []}
        onToggleDevices={() => setShowDevicesPanel((v) => !v)}
        devicesPanelOpen={showDevicesPanel}
      />
      <UpdateBanner {...updater} />
      <RelayGatedBanner visible={!!subscription && !isPro && !selfHosted} />
      <TrialExpiringBanner visible={isOnTrial && trialDaysLeft <= 2} daysLeft={trialDaysLeft} />
      <FullDiskAccessBanner />
      {activeId && shareMap.has(activeId) && (
        <div className="share-bar">
          <div className="share-bar-dot" />
          <span className="share-bar-text">This session is being shared</span>
          <button className="share-bar-link" onClick={() => setShowShareDialog(true)} type="button">
            Copy link
          </button>
          <button
            className="share-bar-stop"
            onClick={() => {
              const relayInfo = relayMapRef.current.get(activeId);
              const relaySessionId = relayInfo?.sessionId;

              if (relaySessionId) {
                authFetch(`/sessions/${relaySessionId}/share`, { method: 'DELETE' }).catch(
                  () => {},
                );
              }

              // Clear share encryption
              relayInfo?.setShareCrypto?.(null);

              setShareMap((prev) => {
                const next = new Map(prev);
                next.delete(activeId);
                return next;
              });
            }}
            type="button"
          >
            Stop sharing
          </button>
        </div>
      )}
      {activeId && isRecording(activeId) && (
        <div className="record-bar">
          <div className="record-bar-dot" />
          <span className="record-bar-text">Recording</span>
          <button className="record-bar-stop" onClick={() => stopRecording(activeId)} type="button">
            Stop &amp; Save
          </button>
        </div>
      )}
      <div className="terminal-area">
        {(() => {
          // Sessions in the active tab's pane tree (may be multiple when split)
          const activeLeafIds = activeId
            ? new Set(paneLayout.getLeafIdsForTab(activeId))
            : new Set<string>();
          const activeHasSplits = activeId ? paneLayout.hasSplits(activeId) : false;

          const renderTerminalPanel = (
            session: (typeof sessions)[number],
            visible: boolean,
            inSplit: boolean,
          ) => (
            <TerminalPanel
              key={session.id}
              session={session}
              visible={visible}
              splitMode={inSplit}
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
              notifyLongRunningCommand={settings.notifyLongRunningCommand}
              longRunningThreshold={settings.longRunningThreshold}
              backgroundOpacity={settings.backgroundOpacity}
              scrollbarVisibility={settings.scrollbarVisibility}
              autocompleteEnabled={settings.autocompleteEnabled}
              defaultEditor={settings.defaultEditor}
              customEditorCommand={settings.customEditorCommand}
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
              isRelayAllowed={isPro || selfHosted}
              onCwdChange={(cwd) => {
                updateSessionCwd(session.id, cwd);
                const relayInfo = relayMapRef.current.get(session.id);
                if (relayInfo?.sessionId) {
                  deviceWS.sendSessionPropertyChanged(relayInfo.sessionId, {
                    name: nameFromCwd(cwd),
                    cwd,
                  });
                }
              }}
              onSaveWorkflow={(command) => {
                addWorkflow(command.split('\n')[0].trim().slice(0, 40), command);
                setShowWorkflows(true);
              }}
            />
          );

          return (
            <>
              {/* Non-active sessions: keep mounted but hidden (preserves xterm/WebGL state) */}
              {sessions
                .filter((s) => !activeLeafIds.has(s.id))
                .map((session) => renderTerminalPanel(session, false, false))}

              {/* Active tab: split pane tree or single pane */}
              {activeId && activeHasSplits ? (
                <PaneContainer
                  node={paneLayout.getTree(activeId)}
                  renderPane={(sessionId, isFocused) => {
                    const session = sessions.find((s) => s.id === sessionId);
                    if (!session) return null;
                    return renderTerminalPanel(session, isFocused, true);
                  }}
                  focusedPaneId={paneLayout.focusedPaneId}
                  onFocusPane={paneLayout.setFocusedPane}
                  onUpdateRatio={paneLayout.updateRatio}
                  onDragEnd={() => {
                    // Fit all terminals in the active tree after drag resize
                    if (!activeId) return;
                    for (const id of paneLayout.getLeafIdsForTab(activeId)) {
                      const s = sessions.find((x) => x.id === id);
                      s?.termRef.current?.fit();
                    }
                  }}
                />
              ) : (
                sessions
                  .filter((s) => activeLeafIds.has(s.id))
                  .map((session) => renderTerminalPanel(session, session.id === activeId, false))
              )}
            </>
          );
        })()}
        {showDevicesPanel && (
          <ConnectedDevicesPanel
            sessionDevices={sessionDevices}
            onClose={() => {
              setShowDevicesPanel(false);
              setTimeout(focusActive, 50);
            }}
          />
        )}
      </div>
      {showSettings && (
        <SettingsPanel
          settings={settings}
          defaults={settingsDefaults}
          onUpdate={updateSettings}
          onReset={resetSettings}
          onClose={() => {
            setShowSettings(false);
            setTimeout(focusActive, 50);
          }}
          onOpenKeybindings={() => setShowKeybindings(true)}
          email={auth.email}
          onLogout={auth.logout}
          subscription={
            subscription
              ? {
                  isPro,
                  isOnTrial,
                  trialDaysLeft,
                  selfHosted,
                  cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
                }
              : null
          }
          profiles={profiles}
          defaultProfileId={defaultProfileId}
          onAddProfile={addProfile}
          onUpdateProfile={updateProfile}
          onRemoveProfile={removeProfile}
          onSetDefaultProfile={setDefault}
        />
      )}
      {showKeybindings && (
        <KeybindingsPanel
          onClose={() => {
            setShowKeybindings(false);
            setTimeout(focusActive, 50);
          }}
        />
      )}
      {showShareDialog && activeId && shareMap.has(activeId) && (
        <ShareDialog
          shareUrl={shareMap.get(activeId)!.shareUrl}
          expiresAt={shareMap.get(activeId)!.expiresAt}
          onClose={() => {
            setShowShareDialog(false);
            setTimeout(focusActive, 50);
          }}
        />
      )}
      {showWorkflows && (
        <WorkflowsPanel
          workflows={workflows}
          onAdd={addWorkflow}
          onRemove={removeWorkflow}
          onEdit={editWorkflow}
          onRun={(command) => {
            if (activeSession) {
              activeSession.pty.write(command + '\n');
              setShowWorkflows(false);
              setTimeout(focusActive, 50);
            }
          }}
          onClose={() => {
            setShowWorkflows(false);
            setTimeout(focusActive, 50);
          }}
        />
      )}
      {showAbout && (
        <AboutModal
          onClose={() => {
            setShowAbout(false);
            setTimeout(focusActive, 50);
          }}
        />
      )}
      {showProfilePicker && (
        <ProfilePickerDialog
          profiles={profiles}
          defaultProfileId={defaultProfileId}
          onSelect={(profileId) => {
            setShowProfilePicker(false);
            createSessionFromProfile(profileId);
            setTimeout(focusActive, 50);
          }}
          onClose={() => {
            setShowProfilePicker(false);
            setTimeout(focusActive, 50);
          }}
        />
      )}
      {showCommandPalette && (
        <CommandPalette
          onClose={() => {
            setShowCommandPalette(false);
            setTimeout(focusActive, 50);
          }}
          onExecute={(id) => {
            setShowCommandPalette(false);
            menuHandlerRef.current(id);
          }}
        />
      )}
      {confirmShare && activeId && (
        <div
          className="modal-overlay"
          onClick={() => {
            setConfirmShare(false);
            setTimeout(focusActive, 50);
          }}
        >
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-title">Share this session?</div>
            <div className="confirm-message">
              Anyone with the link will be able to see your terminal output in real time. The link
              expires in 24 hours.
            </div>
            <div className="confirm-actions">
              <button
                className="confirm-btn confirm-btn-cancel"
                onClick={() => {
                  setConfirmShare(false);
                  setTimeout(focusActive, 50);
                }}
                type="button"
              >
                Cancel
              </button>
              <button
                className="confirm-btn confirm-btn-danger"
                onClick={() => {
                  setConfirmShare(false);
                  const relayInfo = relayMapRef.current.get(activeId);
                  const relaySessionId = relayInfo?.sessionId;

                  if (!relaySessionId) return;

                  const capturedActiveId = activeId;

                  (async () => {
                    const { key, keyBase64 } = await generateShareKey();
                    const res = await authFetch(`/sessions/${relaySessionId}/share`, {
                      method: 'POST',
                    });
                    const body = (await res.json()) as Record<string, unknown>;

                    if (body.shareUrl) {
                      const shareUrl = `${body.shareUrl as string}#key=${keyBase64}`;
                      invoke('copy_to_clipboard', { text: shareUrl });

                      // Activate share encryption on the relay connection
                      const relayInfo = relayMapRef.current.get(capturedActiveId);
                      const cryptoSession = createShareCryptoSession(key, relaySessionId);
                      relayInfo?.setShareCrypto?.(cryptoSession);

                      setShareMap((prev) => {
                        const next = new Map(prev);
                        next.set(capturedActiveId, {
                          shareUrl,
                          expiresAt: body.expiresAt as string,
                        });
                        return next;
                      });
                      setShowShareDialog(true);
                    }
                  })().catch(() => {});
                }}
                type="button"
              >
                Share
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmClose && (
        <ConfirmDialog
          processName={confirmClose.processName}
          onConfirm={() => {
            const id = confirmClose.sessionId;
            setConfirmClose(null);
            handleCloseSession(id, true);
          }}
          onCancel={() => {
            setConfirmClose(null);
            setTimeout(focusActive, 50);
          }}
        />
      )}
      {showOnboarding && (
        <OnboardingScreen
          currentTheme={settings.theme}
          onUpdateSettings={updateSettings}
          onComplete={() => setOnboardingDismissed(true)}
        />
      )}
    </div>
  );
}

function ProfilePickerDialog({
  profiles,
  defaultProfileId,
  onSelect,
  onClose,
}: {
  profiles: TerminalProfile[];
  defaultProfileId: string | null;
  onSelect: (profileId: string) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={dialogRef}
        className="confirm-dialog"
        onClick={(e) => e.stopPropagation()}
        tabIndex={-1}
        style={{ minWidth: 280 }}
      >
        <div className="confirm-title">New Tab with Profile</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
          {profiles.map((p) => (
            <button
              key={p.id}
              type="button"
              className="confirm-btn"
              style={{
                textAlign: 'left',
                justifyContent: 'space-between',
                display: 'flex',
                alignItems: 'center',
              }}
              onClick={() => onSelect(p.id)}
            >
              <span>{p.name}</span>
              {p.id === defaultProfileId && (
                <span style={{ fontSize: 10, opacity: 0.6 }}>default</span>
              )}
            </button>
          ))}
        </div>
        <div className="confirm-actions" style={{ marginTop: 12 }}>
          <button type="button" className="confirm-btn confirm-btn-cancel" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmDialog({
  processName,
  onConfirm,
  onCancel,
}: {
  processName: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
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
        <div className="confirm-title">Do you want to close this tab?</div>
        <div className="confirm-message">
          <span className="confirm-process">{processName}</span> is still running.
        </div>
        <div className="confirm-actions">
          <button type="button" className="confirm-btn confirm-btn-cancel" onClick={onCancel}>
            Cancel
          </button>
          <button
            ref={closeRef}
            type="button"
            className="confirm-btn confirm-btn-close"
            onClick={onConfirm}
          >
            Close Tab
          </button>
        </div>
      </div>
    </div>
  );
}
