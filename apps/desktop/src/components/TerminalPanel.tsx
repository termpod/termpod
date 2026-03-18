import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Terminal } from '@termpod/ui';
import type { TerminalThemeColors } from '@termpod/ui';
import type { PtySize } from '@termpod/protocol';
import type { BlockBoundary } from '@termpod/shared';
import { AutocompleteEngine } from '@termpod/shared';
import {
  getRemoteEntriesRefreshPayload,
  getRemoteSuggestionsBootstrapPayload,
} from '../remoteSuggestions';
import type { TerminalSession } from '../hooks/useSessionManager';
import { useRelayBridge } from '../hooks/useRelayBridge';
import type { RelayStatus, MergedDevice } from '../hooks/useRelayConnection';

export interface RelayInfo {
  status: RelayStatus;
  viewers: number;
  connectedDevices: MergedDevice[];
  sessionId: string | null;
  sendSessionCreated?: (
    requestId: string,
    sessionId: string,
    name: string,
    cwd: string,
    ptyCols: number,
    ptyRows: number,
  ) => void;
  sendToLocalClient?: (clientId: string, json: string) => void;
  sendLocalControl?: (sessionId: string, json: string) => void;
  sendWebRTCControl?: (msg: Record<string, unknown>) => void;
  handleWebRTCSignaling?: (msg: Record<string, unknown>) => Promise<void>;
  initiateWebRTCOffer?: (remoteClientId: string) => Promise<void>;
  /** Whether this session's WebRTC DataChannel is connected. */
  webrtcIsConnected?: boolean;
  /** Send multiplexed terminal data through this session's WebRTC. */
  webrtcSendTerminalData?: (sessionId: string, data: Uint8Array | number[]) => void;
  /** Send multiplexed resize through this session's WebRTC. */
  webrtcSendResize?: (sessionId: string, cols: number, rows: number) => void;
  /** Set share E2E crypto session (for encrypted share viewer frames). */
  setShareCrypto?: (session: import('@termpod/protocol').ShareCryptoSession | null) => void;
}

interface TerminalPanelProps {
  session: TerminalSession;
  visible: boolean;
  onTermReady?: (sessionId: string) => void;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string;
  fontSmoothing?: string;
  fontLigatures?: boolean;
  drawBoldInBold?: boolean;
  windowPadding?: number;
  cursorStyle?: 'block' | 'underline' | 'bar';
  cursorBlink?: boolean;
  lineHeight?: number;
  promptAtBottom?: boolean;
  copyOnSelect?: boolean;
  macOptionIsMeta?: boolean;
  altClickMoveCursor?: boolean;
  wordSeparators?: string;
  theme?: TerminalThemeColors;
  bellEnabled?: boolean;
  notifyOnBell?: boolean;
  notifyLongRunningCommand?: boolean;
  longRunningThreshold?: number;
  backgroundOpacity?: number;
  scrollbarVisibility?: 'always' | 'when-scrolling' | 'never';
  // Autocomplete settings
  autocompleteEnabled?: boolean;
  onRelayChange?: (info: RelayInfo) => void;
  onSessionRegistered?: (relaySessionId: string) => void;
  onCreateSessionRequest?: (
    requestId: string,
    source: 'relay' | 'local' | 'webrtc',
    localClientId?: string,
  ) => void;
  onDeleteSession?: (relaySessionId: string) => void;
  onSessionClosed?: () => void;
  onCwdChange?: (cwd: string) => void;
  onSaveWorkflow?: (command: string) => void;
  getSessionsList?: () => Record<string, unknown>[];
  deviceSendSignaling?: (msg: Record<string, unknown>) => void;
  deviceClientId?: string;
  /** Multiplexed WebRTC input from iOS — route to correct session's PTY. */
  onWebRTCMuxInput?: (sessionId: string, data: string) => void;
  /** Multiplexed WebRTC resize from iOS — route to correct session. */
  onWebRTCMuxResize?: (sessionId: string, cols: number, rows: number) => void;
  /** Shared callback to find connected WebRTC for multi-session mux sending. */
  getSharedWebRTC?: () => {
    sendTerminalData: (sessionId: string, data: Uint8Array | number[]) => void;
    sendResize: (sessionId: string, cols: number, rows: number) => void;
    isConnected: boolean;
  } | null;
  /** Whether the user is allowed to send terminal data via relay (Pro/trial/self-hosted). */
  isRelayAllowed?: boolean;
}

export function TerminalPanel({
  session,
  visible,
  onTermReady,
  fontSize,
  fontFamily,
  fontWeight,
  fontSmoothing,
  fontLigatures,
  drawBoldInBold,
  windowPadding,
  cursorStyle,
  cursorBlink,
  lineHeight,
  promptAtBottom,
  copyOnSelect,
  macOptionIsMeta,
  altClickMoveCursor,
  wordSeparators,
  theme,
  bellEnabled,
  notifyOnBell,
  notifyLongRunningCommand,
  longRunningThreshold = 30,
  backgroundOpacity,
  scrollbarVisibility,
  autocompleteEnabled = true,
  onRelayChange,
  onSessionRegistered,
  onCreateSessionRequest,
  onDeleteSession,
  onSessionClosed,
  onCwdChange,
  onSaveWorkflow,
  getSessionsList,
  deviceSendSignaling,
  deviceClientId,
  onWebRTCMuxInput,
  onWebRTCMuxResize,
  getSharedWebRTC,
  isRelayAllowed,
}: TerminalPanelProps) {
  const isSshSession = (session.processName ?? '').toLowerCase() === 'ssh';
  const commandStartTimeRef = useRef<number | null>(null);
  const remoteEntriesRef = useRef<string[]>([]);
  const remoteBootstrapDoneRef = useRef(false);
  const oscBufferRef = useRef('');
  const lastRemoteEntriesRefreshAtRef = useRef(0);
  const suppressNextSshRefreshRef = useRef(false);
  const sshInputLineRef = useRef('');

  // Initialize autocomplete engine
  const [autocompleteEngine] = useState(() => {
    const engine = new AutocompleteEngine(
      {
        enabled: autocompleteEnabled,
        ghostTextEnabled: false, // Disable ghost text
        popupEnabled: true, // Enable popup instead
      },
      async (path: string) => {
        return await invoke<string>('read_file', { path });
      },
    );

    engine.setPathEntryLister(async (path: string) => {
      return await invoke<string[]>('list_directory_entries', { path });
    });

    return engine;
  });
  const onTermReadyRef = useRef(onTermReady);
  onTermReadyRef.current = onTermReady;
  const onCreateSessionRequestRef = useRef(onCreateSessionRequest);
  onCreateSessionRequestRef.current = onCreateSessionRequest;
  const onDeleteSessionRef = useRef(onDeleteSession);
  onDeleteSessionRef.current = onDeleteSession;
  const onSessionClosedRef = useRef(onSessionClosed);
  onSessionClosedRef.current = onSessionClosed;
  const onCwdChangeRef = useRef(onCwdChange);
  onCwdChangeRef.current = onCwdChange;

  const getSessionsListRef = useRef(getSessionsList);
  getSessionsListRef.current = getSessionsList;

  const deviceSendSignalingRef = useRef(deviceSendSignaling);
  deviceSendSignalingRef.current = deviceSendSignaling;

  const onWebRTCMuxInputRef = useRef(onWebRTCMuxInput);
  onWebRTCMuxInputRef.current = onWebRTCMuxInput;
  const onWebRTCMuxResizeRef = useRef(onWebRTCMuxResize);
  onWebRTCMuxResizeRef.current = onWebRTCMuxResize;
  const getSharedWebRTCRef = useRef(getSharedWebRTC);
  getSharedWebRTCRef.current = getSharedWebRTC;

  const relay = useRelayBridge(session.exited ? null : session, {
    onCreateSessionRequest: (requestId, source, localClientId) => {
      onCreateSessionRequestRef.current?.(requestId, source, localClientId);
    },
    onDeleteSession: (relaySessionId) => {
      onDeleteSessionRef.current?.(relaySessionId);
    },
    onSessionClosed: () => {
      onSessionClosedRef.current?.();
    },
    getSessionsList: () => getSessionsListRef.current?.() ?? [],
    deviceSendSignaling: deviceSendSignaling
      ? (msg) => deviceSendSignalingRef.current?.(msg)
      : undefined,
    deviceClientId,
    onWebRTCMuxInput: (sessionId, data) => onWebRTCMuxInputRef.current?.(sessionId, data),
    onWebRTCMuxResize: (sessionId, cols, rows) =>
      onWebRTCMuxResizeRef.current?.(sessionId, cols, rows),
    getSharedWebRTC: () => getSharedWebRTCRef.current?.() ?? null,
    isRelayAllowed,
  });
  const onRelayChangeRef = useRef(onRelayChange);
  onRelayChangeRef.current = onRelayChange;
  const onSessionRegisteredRef = useRef(onSessionRegistered);
  onSessionRegisteredRef.current = onSessionRegistered;

  useEffect(() => {
    onRelayChangeRef.current?.({
      status: relay.status,
      viewers: relay.viewers,
      connectedDevices: relay.allConnectedDevices,
      sessionId: relay.sessionId,
      sendSessionCreated: relay.sendSessionCreated,
      sendToLocalClient: relay.sendToLocalClient,
      sendLocalControl: relay.sendLocalControl,
      sendWebRTCControl: relay.sendWebRTCControl,
      handleWebRTCSignaling: relay.handleWebRTCSignaling,
      initiateWebRTCOffer: relay.initiateWebRTCOffer,
      webrtcIsConnected: relay.webrtcIsConnected,
      webrtcSendTerminalData: relay.webrtcSendTerminalData,
      webrtcSendResize: relay.webrtcSendResize,
      setShareCrypto: relay.setShareCrypto,
    });
  }, [
    relay.status,
    relay.viewers,
    relay.allConnectedDevices,
    relay.sessionId,
    relay.sendSessionCreated,
    relay.sendToLocalClient,
    relay.sendLocalControl,
    relay.sendWebRTCControl,
    relay.handleWebRTCSignaling,
    relay.initiateWebRTCOffer,
    relay.webrtcIsConnected,
    relay.webrtcSendTerminalData,
    relay.webrtcSendResize,
    relay.setShareCrypto,
  ]);

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
      if (isSshSession) {
        if (data === '\x04') {
          // Ctrl+D often exits ssh.
          suppressNextSshRefreshRef.current = true;
        } else if (data === '\r' || data === '\n' || data === '\x1b[13;2u') {
          const cmd = sshInputLineRef.current.trim();
          if (cmd === 'exit' || cmd === 'logout') {
            suppressNextSshRefreshRef.current = true;
          }
          sshInputLineRef.current = '';
        } else if (data === '\x7f' || data === '\b') {
          sshInputLineRef.current = sshInputLineRef.current.slice(0, -1);
        } else if (!data.startsWith('\x1b')) {
          for (const ch of data) {
            if (ch >= ' ' && ch !== '\x7f') {
              sshInputLineRef.current += ch;
            }
          }
        }
      } else {
        sshInputLineRef.current = '';
      }

      if (!session.exited) {
        session.pty.write(data);
      }
    },
    [isSshSession, session.pty, session.exited],
  );

  const handleCwdChange = useCallback(
    (cwd: string) => {
      autocompleteEngine.setCurrentDirectory(cwd);
      onCwdChangeRef.current?.(cwd);
    },
    [autocompleteEngine],
  );

  const handleBlockBoundary = useCallback(
    (boundary: BlockBoundary) => {
      session.blockTracker.handleBoundary(boundary);

      // Track command start for long-running command notifications
      if (boundary.marker === 'C') {
        commandStartTimeRef.current = Date.now();
      } else if (
        boundary.marker === 'D' &&
        notifyLongRunningCommand &&
        commandStartTimeRef.current
      ) {
        const elapsed = (Date.now() - commandStartTimeRef.current) / 1000;
        commandStartTimeRef.current = null;

        if (elapsed >= longRunningThreshold && !document.hasFocus()) {
          new Notification('Command Finished', {
            body: `Completed in ${Math.round(elapsed)}s (${session.name || 'Terminal'})`,
          });
        }
      }

      if (!isSshSession || !autocompleteEnabled) {
        return;
      }

      // Refresh SSH directory context whenever a new prompt starts.
      if (boundary.marker === 'A') {
        if (suppressNextSshRefreshRef.current) {
          suppressNextSshRefreshRef.current = false;
          return;
        }

        const now = Date.now();
        if (now - lastRemoteEntriesRefreshAtRef.current > 1200) {
          lastRemoteEntriesRefreshAtRef.current = now;
          session.pty.write(getRemoteEntriesRefreshPayload());
        }
      }
    },
    [
      autocompleteEnabled,
      isSshSession,
      notifyLongRunningCommand,
      longRunningThreshold,
      session.blockTracker,
      session.name,
      session.pty,
    ],
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

  // Pre-brighten text colors to compensate for CSS opacity on the terminal.
  // Background stays as-is (dimmed by opacity → vibrancy shows through).
  // Text colors are boosted so after opacity they appear at original brightness.
  const adjustedTheme = useMemo(() => {
    if (!theme || !backgroundOpacity || backgroundOpacity >= 1) return theme;

    const terminalOpacity = 1 - (1 - backgroundOpacity) * 0.6;
    const factor = 1 / terminalOpacity;
    const boost = (hex: string) => {
      const n = parseInt(hex.slice(1), 16);
      const r = Math.min(255, Math.round(((n >> 16) & 255) * factor));
      const g = Math.min(255, Math.round(((n >> 8) & 255) * factor));
      const b = Math.min(255, Math.round((n & 255) * factor));
      return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    };

    return {
      ...theme,
      foreground: boost(theme.foreground),
      cursor: boost(theme.cursor),
      selectionBackground: theme.selectionBackground,
      black: theme.black ? boost(theme.black) : undefined,
      red: theme.red ? boost(theme.red) : undefined,
      green: theme.green ? boost(theme.green) : undefined,
      yellow: theme.yellow ? boost(theme.yellow) : undefined,
      blue: theme.blue ? boost(theme.blue) : undefined,
      magenta: theme.magenta ? boost(theme.magenta) : undefined,
      cyan: theme.cyan ? boost(theme.cyan) : undefined,
      white: theme.white ? boost(theme.white) : undefined,
      brightBlack: theme.brightBlack ? boost(theme.brightBlack) : undefined,
      brightRed: theme.brightRed ? boost(theme.brightRed) : undefined,
      brightGreen: theme.brightGreen ? boost(theme.brightGreen) : undefined,
      brightYellow: theme.brightYellow ? boost(theme.brightYellow) : undefined,
      brightBlue: theme.brightBlue ? boost(theme.brightBlue) : undefined,
      brightMagenta: theme.brightMagenta ? boost(theme.brightMagenta) : undefined,
      brightCyan: theme.brightCyan ? boost(theme.brightCyan) : undefined,
      brightWhite: theme.brightWhite ? boost(theme.brightWhite) : undefined,
    };
  }, [theme, backgroundOpacity]);

  const handleReady = useCallback(() => {
    onTermReadyRef.current?.(session.id);
  }, [session.id]);

  // Load shell history when session starts
  useEffect(() => {
    if (!autocompleteEnabled) return;
    if (isSshSession) {
      autocompleteEngine.getHistoryIndex().clear();
      autocompleteEngine.setCurrentDirectory(null);
      return;
    }

    const loadHistory = async () => {
      try {
        const home = await invoke<string>('get_home_dir');
        const historyPaths = [
          `${home}/.zsh_history`,
          `${home}/.bash_history`,
          `${home}/.local/share/fish/fish_history`,
        ];

        for (const path of historyPaths) {
          try {
            await autocompleteEngine.loadHistory(path);
          } catch {
            // File doesn't exist, skip
          }
        }
      } catch (error) {
        console.warn('Failed to load shell history:', error);
      }
    };

    loadHistory();
  }, [autocompleteEnabled, autocompleteEngine, isSshSession]);

  // SSH mode: disable local filesystem context suggestions.
  useEffect(() => {
    if (isSshSession) {
      autocompleteEngine.setPathEntryLister(async () => remoteEntriesRef.current);
      autocompleteEngine.setCurrentDirectory('__remote__');
      return;
    }

    autocompleteEngine.setPathEntryLister(async (path: string) => {
      return await invoke<string[]>('list_directory_entries', { path });
    });
  }, [autocompleteEngine, isSshSession]);

  // SSH mode: ingest remote history/path context via custom OSC 135 payloads.
  useEffect(() => {
    if (!isSshSession || !autocompleteEnabled) {
      return;
    }

    const decodeAndApply = (kind: string, encoded: string) => {
      try {
        const decoded = atob(encoded);

        if (kind === 'hist') {
          autocompleteEngine.parseHistory(decoded);
          return;
        }

        if (kind === 'entries') {
          remoteEntriesRef.current = decoded
            .split('\n')
            .map((v) => v.trim())
            .filter(Boolean);
          autocompleteEngine.setCurrentDirectory('__remote__');
        }
      } catch {
        // ignore invalid payloads
      }
    };

    const parseOsc = () => {
      let buf = oscBufferRef.current;

      while (true) {
        const start = buf.indexOf('\x1b]135;');
        if (start === -1) break;

        const bel = buf.indexOf('\x07', start + 6);
        const st = buf.indexOf('\x1b\\', start + 6);
        const end = bel === -1 ? st : st === -1 ? bel : Math.min(bel, st);

        if (end === -1) break;

        const payload = buf.slice(start + 6, end);
        const semi = payload.indexOf(';');
        if (semi > 0) {
          const kind = payload.slice(0, semi);
          const encoded = payload.slice(semi + 1);
          decodeAndApply(kind, encoded);
        }

        buf = buf.slice(end + (buf[end] === '\x07' ? 1 : 2));
      }

      // Prevent unbounded growth without dropping in-flight OSC payloads.
      // If we are in the middle of a long OSC 135 message, keep from its start.
      // Otherwise trim old noise aggressively.
      const maxBuf = 1024 * 1024; // 1MB cap
      if (buf.length > maxBuf) {
        const activeStart = buf.indexOf('\x1b]135;');
        if (activeStart >= 0) {
          buf = buf.slice(activeStart);
          if (buf.length > maxBuf) {
            // Extremely large malformed payload; keep tail only.
            buf = buf.slice(-maxBuf);
          }
        } else {
          buf = buf.slice(-16384);
        }
      }

      oscBufferRef.current = buf;
    };

    const onData = (data: Uint8Array | number[]) => {
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
      oscBufferRef.current += new TextDecoder().decode(bytes);
      parseOsc();
    };

    session.dataListeners.add(onData);

    if (!remoteBootstrapDoneRef.current) {
      remoteBootstrapDoneRef.current = true;
      session.pty.write(getRemoteSuggestionsBootstrapPayload());
      lastRemoteEntriesRefreshAtRef.current = Date.now();
    }

    return () => {
      session.dataListeners.delete(onData);
    };
  }, [autocompleteEnabled, autocompleteEngine, isSshSession, session]);

  // Update autocomplete engine when enabled state changes
  useEffect(() => {
    autocompleteEngine.setEnabled(autocompleteEnabled);
  }, [autocompleteEnabled, autocompleteEngine]);

  const active = visible && !session.closing;

  const focusTerminal = useCallback(() => {
    // Blur any focused button/input so xterm can receive focus
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
      document.activeElement.blur();
    }

    session.termRef.current?.focus();
  }, [session.termRef]);

  useEffect(() => {
    if (!active) {
      return;
    }

    if (session.termReady) {
      session.termRef.current?.refresh();
      focusTerminal();
      return;
    }

    // Terminal not ready yet — poll until it is, then focus
    let cancelled = false;

    const check = () => {
      if (cancelled) return;

      if (session.termReady) {
        session.termRef.current?.refresh();
        focusTerminal();
        return;
      }

      requestAnimationFrame(check);
    };

    requestAnimationFrame(check);

    return () => {
      cancelled = true;
    };
  }, [active, session, focusTerminal]);

  return (
    <div
      className={`terminal-panel${backgroundOpacity !== undefined && backgroundOpacity < 1 ? ' transparent' : ''}`}
      style={{
        visibility: active ? 'visible' : 'hidden',
        pointerEvents: active ? 'auto' : 'none',
      }}
      onMouseDown={active ? focusTerminal : undefined}
    >
      <Terminal
        ref={session.termRef}
        onData={handleData}
        onResize={handleResize}
        onCwdChange={handleCwdChange}
        onBlockBoundary={handleBlockBoundary}
        onSaveWorkflow={onSaveWorkflow}
        onReady={handleReady}
        onBell={
          bellEnabled
            ? () => {
                if (notifyOnBell && !document.hasFocus()) {
                  new Notification('Terminal Bell', { body: session.name || 'Terminal' });
                }
              }
            : undefined
        }
        fontSize={fontSize}
        fontFamily={fontFamily}
        fontWeight={fontWeight}
        fontSmoothing={fontSmoothing}
        fontLigatures={fontLigatures}
        drawBoldInBold={drawBoldInBold}
        cursorStyle={cursorStyle}
        cursorBlink={cursorBlink}
        lineHeight={lineHeight}
        padding={windowPadding}
        promptAtBottom={promptAtBottom}
        copyOnSelect={copyOnSelect}
        macOptionIsMeta={macOptionIsMeta}
        altClickMoveCursor={altClickMoveCursor}
        wordSeparators={wordSeparators}
        theme={adjustedTheme}
        scrollbarVisibility={scrollbarVisibility}
        onOpenUrl={(url) => invoke('open_url', { url })}
        blockDecorationsMode={isSshSession ? 'off' : 'full'}
        autocompleteEnabled={autocompleteEnabled}
        autocompleteEngine={autocompleteEngine}
      />
    </div>
  );
}
