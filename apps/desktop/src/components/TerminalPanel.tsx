import { useCallback, useEffect, useMemo, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Terminal } from '@termpod/ui';
import type { TerminalThemeColors } from '@termpod/ui';
import type { PtySize } from '@termpod/protocol';
import type { TerminalSession } from '../hooks/useSessionManager';
import { useRelayBridge } from '../hooks/useRelayBridge';
import type { RelayStatus, MergedDevice } from '../hooks/useRelayConnection';

export interface RelayInfo {
  status: RelayStatus;
  viewers: number;
  connectedDevices: MergedDevice[];
  sessionId: string | null;
  sendSessionCreated?: (requestId: string, sessionId: string, name: string, cwd: string, ptyCols: number, ptyRows: number) => void;
  sendToLocalClient?: (clientId: string, json: string) => void;
  sendLocalControl?: (sessionId: string, json: string) => void;
  sendWebRTCControl?: (msg: Record<string, unknown>) => void;
  handleWebRTCSignaling?: (msg: Record<string, unknown>) => Promise<void>;
  initiateWebRTCOffer?: (remoteClientId: string) => Promise<void>;
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
  backgroundOpacity?: number;
  onRelayChange?: (info: RelayInfo) => void;
  onSessionRegistered?: (relaySessionId: string) => void;
  onCreateSessionRequest?: (requestId: string, source: 'relay' | 'local' | 'webrtc', localClientId?: string) => void;
  onDeleteSession?: (relaySessionId: string) => void;
  onSessionClosed?: () => void;
  onCwdChange?: (cwd: string) => void;
  getSessionsList?: () => Record<string, unknown>[];
  deviceSendSignaling?: (msg: Record<string, unknown>) => void;
  deviceClientId?: string;
}

export function TerminalPanel({ session, visible, onTermReady, fontSize, fontFamily, fontWeight, fontSmoothing, fontLigatures, drawBoldInBold, windowPadding, cursorStyle, cursorBlink, lineHeight, promptAtBottom, copyOnSelect, macOptionIsMeta, altClickMoveCursor, wordSeparators, theme, bellEnabled, notifyOnBell, backgroundOpacity, onRelayChange, onSessionRegistered, onCreateSessionRequest, onDeleteSession, onSessionClosed, onCwdChange, getSessionsList, deviceSendSignaling, deviceClientId }: TerminalPanelProps) {
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
    deviceSendSignaling: deviceSendSignaling ? (msg) => deviceSendSignalingRef.current?.(msg) : undefined,
    deviceClientId,
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
    });
  }, [relay.status, relay.viewers, relay.allConnectedDevices, relay.sessionId, relay.sendSessionCreated, relay.sendToLocalClient, relay.sendLocalControl, relay.sendWebRTCControl, relay.handleWebRTCSignaling, relay.initiateWebRTCOffer]);

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

  const handleCwdChange = useCallback(
    (cwd: string) => {
      onCwdChangeRef.current?.(cwd);
    },
    [],
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

    return () => { cancelled = true; };
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
        onReady={handleReady}
        onBell={bellEnabled ? () => {
          if (notifyOnBell && !document.hasFocus()) {
            new Notification('Terminal Bell', { body: session.name || 'Terminal' });
          }
        } : undefined}
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
        onOpenUrl={(url) => invoke('open_url', { url })}
      />
    </div>
  );
}
