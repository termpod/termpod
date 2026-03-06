import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Terminal } from '@termpod/ui';
import type { TerminalThemeColors } from '@termpod/ui';
import type { PtySize } from '@termpod/protocol';
import type { TerminalSession } from '../hooks/useSessionManager';
import { useRelayBridge } from '../hooks/useRelayBridge';
import type { RelayStatus } from '../hooks/useRelayConnection';

export interface RelayInfo {
  status: RelayStatus;
  viewers: number;
  sessionId: string | null;
  sendSessionCreated?: (requestId: string, sessionId: string, name: string, cwd: string, ptyCols: number, ptyRows: number) => void;
  sendToLocalClient?: (clientId: string, json: string) => void;
}

interface TerminalPanelProps {
  session: TerminalSession;
  visible: boolean;
  fontSize?: number;
  fontFamily?: string;
  cursorStyle?: 'block' | 'underline' | 'bar';
  cursorBlink?: boolean;
  lineHeight?: number;
  theme?: TerminalThemeColors;
  bellEnabled?: boolean;
  backgroundOpacity?: number;
  onRelayChange?: (info: RelayInfo) => void;
  onSessionRegistered?: (relaySessionId: string) => void;
  onCreateSessionRequest?: (requestId: string, source: 'relay' | 'local', localClientId?: string) => void;
  onSessionClosed?: () => void;
}

export function TerminalPanel({ session, visible, fontSize, fontFamily, cursorStyle, cursorBlink, lineHeight, theme, bellEnabled, backgroundOpacity, onRelayChange, onSessionRegistered, onCreateSessionRequest, onSessionClosed }: TerminalPanelProps) {
  const onCreateSessionRequestRef = useRef(onCreateSessionRequest);
  onCreateSessionRequestRef.current = onCreateSessionRequest;
  const onSessionClosedRef = useRef(onSessionClosed);
  onSessionClosedRef.current = onSessionClosed;

  const relay = useRelayBridge(session.exited ? null : session, {
    onCreateSessionRequest: (requestId, source, localClientId) => {
      onCreateSessionRequestRef.current?.(requestId, source, localClientId);
    },
    onSessionClosed: () => {
      onSessionClosedRef.current?.();
    },
  });
  const onRelayChangeRef = useRef(onRelayChange);
  onRelayChangeRef.current = onRelayChange;
  const onSessionRegisteredRef = useRef(onSessionRegistered);
  onSessionRegisteredRef.current = onSessionRegistered;

  useEffect(() => {
    onRelayChangeRef.current?.({
      status: relay.status,
      viewers: relay.viewers,
      sessionId: relay.sessionId,
      sendSessionCreated: relay.sendSessionCreated,
      sendToLocalClient: relay.sendToLocalClient,
    });
  }, [relay.status, relay.viewers, relay.sessionId, relay.sendSessionCreated, relay.sendToLocalClient]);

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

    const terminalOpacity = 1 - (1 - backgroundOpacity) * 0.35;
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

  const active = visible && !session.closing;

  useEffect(() => {
    if (!active) {
      return;
    }

    const timer = setTimeout(() => {
      session.termRef.current?.focus();
    }, 16);

    return () => clearTimeout(timer);
  }, [active, session.termRef]);

  return (
    <div
      className={`terminal-panel${backgroundOpacity !== undefined && backgroundOpacity < 1 ? ' transparent' : ''}`}
      style={{
        visibility: active ? 'visible' : 'hidden',
        pointerEvents: active ? 'auto' : 'none',
      }}
    >
      <Terminal
        ref={session.termRef}
        onData={handleData}
        onResize={handleResize}
        onBell={bellEnabled ? () => { /* system bell */ } : undefined}
        fontSize={fontSize}
        fontFamily={fontFamily}
        cursorStyle={cursorStyle}
        cursorBlink={cursorBlink}
        lineHeight={lineHeight}
        theme={adjustedTheme}
      />
    </div>
  );
}
