import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from '@termpod/ui';
import type { TerminalHandle } from '@termpod/ui';
import { QuickActions } from '@termpod/ui';
import {
  PROTOCOL_VERSION,
  Channel,
  encodeTerminalData,
  decodeBinaryFrame,
} from '@termpod/protocol';
import type { RelayMessage } from '@termpod/protocol';
import type { ConnectionStatus } from '@termpod/shared';
import { RELAY_URL, RECONNECT } from '@termpod/shared';

const RELAY_BASE = RELAY_URL.development;
const PING_INTERVAL = 30_000;

export function App() {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [sessionId, setSessionId] = useState('');
  const [connected, setConnected] = useState(false);
  const termRef = useRef<TerminalHandle>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pendingDataRef = useRef<Uint8Array[]>([]);
  const termReadyRef = useRef(false);
  const intentionalCloseRef = useRef(false);
  const activeSessionIdRef = useRef<string | null>(null);
  const reconnectDelayRef = useRef<number>(RECONNECT.initialDelay);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

  const writeToTerminal = useCallback((data: Uint8Array) => {
    if (termReadyRef.current && termRef.current) {
      termRef.current.write(data);
    } else {
      pendingDataRef.current.push(data);
    }
  }, []);

  const sendToRelay = useCallback((data: string) => {
    const ws = wsRef.current;

    if (ws?.readyState === WebSocket.OPEN) {
      const encoded = new TextEncoder().encode(data);
      ws.send(encodeTerminalData(encoded));
    }
  }, []);

  const handleData = useCallback((data: string) => {
    sendToRelay(data);
  }, [sendToRelay]);

  const handleQuickAction = useCallback((value: string) => {
    sendToRelay(value);
  }, [sendToRelay]);

  const onTerminalReady = useCallback(() => {
    termReadyRef.current = true;

    for (const data of pendingDataRef.current) {
      termRef.current?.write(data);
    }

    pendingDataRef.current = [];
    termRef.current?.focus();
  }, []);

  const stopPing = useCallback(() => {
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = undefined;
    }
  }, []);

  const openWebSocket = useCallback((id: string) => {
    const ws = new WebSocket(`${RELAY_BASE}/sessions/${id}/ws`);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;
    intentionalCloseRef.current = false;

    ws.onopen = () => {
      reconnectDelayRef.current = RECONNECT.initialDelay;

      ws.send(JSON.stringify({
        type: 'hello',
        version: PROTOCOL_VERSION,
        role: 'viewer',
        device: 'iphone',
        clientId: `mobile-${crypto.randomUUID().slice(0, 8)}`,
      }));

      pingIntervalRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
        }
      }, PING_INTERVAL);
    };

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        const frame = decodeBinaryFrame(new Uint8Array(event.data));

        if (frame.channel === Channel.TERMINAL_DATA) {
          writeToTerminal(frame.data);
        } else if (frame.channel === Channel.SCROLLBACK_CHUNK) {
          writeToTerminal(frame.data);
        }

        return;
      }

      const msg = JSON.parse(event.data) as RelayMessage;

      switch (msg.type) {
        case 'ready':
          setStatus('connected');
          break;

        case 'session_ended':
          intentionalCloseRef.current = true;
          setStatus('disconnected');
          termRef.current?.write('\r\n[Session ended]\r\n');
          break;
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
      stopPing();

      if (!intentionalCloseRef.current && activeSessionIdRef.current) {
        setStatus('reconnecting');
        termRef.current?.write('\r\n[Reconnecting...]\r\n');

        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectDelayRef.current = Math.min(
            reconnectDelayRef.current * RECONNECT.backoffMultiplier,
            RECONNECT.maxDelay,
          );

          const sid = activeSessionIdRef.current;

          if (sid) {
            openWebSocket(sid);
          }
        }, reconnectDelayRef.current);
      } else {
        setStatus('disconnected');
      }
    };

    ws.onerror = () => {
      // onclose will handle reconnect
    };
  }, [writeToTerminal, stopPing]);

  const connectToSession = useCallback((id: string) => {
    if (wsRef.current) {
      intentionalCloseRef.current = true;
      wsRef.current.close();
    }

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }

    activeSessionIdRef.current = id;
    reconnectDelayRef.current = RECONNECT.initialDelay;
    pendingDataRef.current = [];
    termReadyRef.current = false;
    setStatus('connecting');
    setConnected(true);

    openWebSocket(id);
  }, [openWebSocket]);

  // Check URL params for auto-connect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const session = params.get('session');

    if (session) {
      setSessionId(session);
      connectToSession(session);
    }
  }, [connectToSession]);

  useEffect(() => {
    return () => {
      intentionalCloseRef.current = true;
      stopPing();

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }

      wsRef.current?.close();
    };
  }, [stopPing]);

  const handleConnect = () => {
    const id = sessionId.trim();

    if (id) {
      connectToSession(id);
    }
  };

  const handleDisconnect = () => {
    intentionalCloseRef.current = true;
    activeSessionIdRef.current = null;
    stopPing();

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }

    wsRef.current?.close();
    setConnected(false);
    setStatus('disconnected');
    termReadyRef.current = false;
    pendingDataRef.current = [];
  };

  if (!connected) {
    return (
      <div className="app">
        <div className="connect-screen">
          <h1 className="connect-title">Termpod</h1>
          <p className="connect-subtitle">Connect to a terminal session</p>
          <div className="connect-form">
            <input
              className="connect-input"
              type="text"
              placeholder="Session ID"
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
            />
            <button
              className="connect-btn"
              onClick={handleConnect}
              disabled={status === 'connecting'}
            >
              {status === 'connecting' ? 'Connecting...' : 'Connect'}
            </button>
          </div>
          <p className="connect-hint">
            Scan the QR code in the desktop app or paste the session ID
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="status-bar">
        <span className={`status-dot ${status}`} />
        <span className="status-text">{status}</span>
        <button className="disconnect-btn" onClick={handleDisconnect}>
          Disconnect
        </button>
      </div>
      <div className="terminal-container">
        <Terminal ref={termRef} onData={handleData} fontSize={13} onReady={onTerminalReady} />
      </div>
      <QuickActions onAction={handleQuickAction} />
    </div>
  );
}
