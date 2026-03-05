import { useCallback, useRef, useState } from 'react';

const PROTOCOL_VERSION = 1;
const CHANNEL_TERMINAL_DATA = 0x00;
const CHANNEL_SCROLLBACK_CHUNK = 0x02;
const PING_INTERVAL = 30_000;
const RECONNECT_INITIAL = 1000;
const RECONNECT_MAX = 30000;
const RECONNECT_MULTIPLIER = 2;

// Production relay; override via env for local dev
const RELAY_BASE = process.env.EXPO_PUBLIC_RELAY_URL || 'wss://termpod-relay.iamswap.workers.dev';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

interface DetectedPrompt {
  tool: string;
  detail: string;
}

// Simple ANSI stripper
function stripAnsi(text: string): string {
  return text
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '')
    .replace(/\x1b[()][A-Z0-9]/g, '');
}

const PROMPT_PATTERNS = [
  /Do you want to allow\s+(\w+)[\s:]+(.+?)[\s?]*\?/i,
  /Allow\s+(\w+)[\s:]+(.+?)[\s?]*\?/i,
  /^\s*(Read|Write|Edit|Bash|Glob|Grep|WebFetch|WebSearch|NotebookEdit)\s+[─-]\s+(.+)/m,
];

function encodeTerminalData(data: Uint8Array): ArrayBuffer {
  const frame = new Uint8Array(1 + data.length);
  frame[0] = CHANNEL_TERMINAL_DATA;
  frame.set(data, 1);
  return frame.buffer;
}

function decodeBinaryFrame(data: Uint8Array): { channel: number; data: Uint8Array } {
  return { channel: data[0], data: data.subarray(1) };
}

export interface PtySize {
  cols: number;
  rows: number;
}

export function useRelay() {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [prompt, setPrompt] = useState<DetectedPrompt | null>(null);
  const [ptySize, setPtySize] = useState<PtySize | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const activeSessionRef = useRef<string | null>(null);
  const intentionalCloseRef = useRef(false);
  const reconnectDelayRef = useRef(RECONNECT_INITIAL);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const onDataRef = useRef<((data: Uint8Array) => void) | null>(null);
  const onResizeRef = useRef<((cols: number, rows: number) => void) | null>(null);
  const promptBufferRef = useRef('');

  const stopPing = useCallback(() => {
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = undefined;
    }
  }, []);

  const feedPromptDetector = useCallback((data: Uint8Array) => {
    const text = new TextDecoder().decode(data);
    promptBufferRef.current += text;

    if (promptBufferRef.current.length > 4096) {
      promptBufferRef.current = promptBufferRef.current.slice(-2048);
    }

    const clean = stripAnsi(promptBufferRef.current);

    // Check if resolved
    if (/Allowed|Denied|Skipped/i.test(clean.slice(-200))) {
      setPrompt(null);
      promptBufferRef.current = '';
      return;
    }

    for (const pattern of PROMPT_PATTERNS) {
      const match = clean.match(pattern);

      if (match) {
        setPrompt({ tool: match[1], detail: match[2].trim() });
        break;
      }
    }
  }, []);

  const openWebSocket = useCallback((sessionId: string) => {
    // Close existing
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.close();
    }

    const ws = new WebSocket(`${RELAY_BASE}/sessions/${sessionId}/ws`);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;
    intentionalCloseRef.current = false;

    ws.onopen = () => {
      reconnectDelayRef.current = RECONNECT_INITIAL;

      ws.send(JSON.stringify({
        type: 'hello',
        version: PROTOCOL_VERSION,
        role: 'viewer',
        device: 'iphone',
        clientId: `expo-${Math.random().toString(36).slice(2, 10)}`,
      }));

      pingIntervalRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
        }
      }, PING_INTERVAL);
    };

    ws.onmessage = (event: MessageEvent) => {
      if (event.data instanceof ArrayBuffer) {
        const frame = decodeBinaryFrame(new Uint8Array(event.data));

        if (frame.channel === CHANNEL_TERMINAL_DATA) {
          onDataRef.current?.(frame.data);
          feedPromptDetector(frame.data);
        } else if (frame.channel === CHANNEL_SCROLLBACK_CHUNK) {
          // Scrollback frames have a 4-byte offset header after the channel byte
          const termData = frame.data.subarray(4);
          onDataRef.current?.(termData);
          feedPromptDetector(termData);
        }

        return;
      }

      try {
        const msg = JSON.parse(event.data as string);

        switch (msg.type) {
          case 'session_info':
            if (msg.ptySize) {
              setPtySize({ cols: msg.ptySize.cols, rows: msg.ptySize.rows });
              // Synchronously notify terminal BEFORE scrollback arrives
              onResizeRef.current?.(msg.ptySize.cols, msg.ptySize.rows);
            }
            break;
          case 'ready':
            setStatus('connected');
            break;
          case 'pty_resize':
            if (msg.cols && msg.rows) {
              setPtySize({ cols: msg.cols, rows: msg.rows });
              onResizeRef.current?.(msg.cols, msg.rows);
            }
            break;
          case 'session_ended':
            intentionalCloseRef.current = true;
            setStatus('disconnected');
            break;
        }
      } catch {
        // ignore
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
      stopPing();

      if (!intentionalCloseRef.current && activeSessionRef.current) {
        setStatus('reconnecting');

        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectDelayRef.current = Math.min(
            reconnectDelayRef.current * RECONNECT_MULTIPLIER,
            RECONNECT_MAX,
          );

          const sid = activeSessionRef.current;

          if (sid) {
            openWebSocket(sid);
          }
        }, reconnectDelayRef.current);
      } else {
        setStatus('disconnected');
      }
    };

    ws.onerror = () => {};
  }, [stopPing, feedPromptDetector]);

  const connect = useCallback((sessionId: string) => {
    activeSessionRef.current = sessionId;
    reconnectDelayRef.current = RECONNECT_INITIAL;
    promptBufferRef.current = '';
    setPrompt(null);
    setStatus('connecting');
    openWebSocket(sessionId);
  }, [openWebSocket]);

  const disconnect = useCallback(() => {
    intentionalCloseRef.current = true;
    activeSessionRef.current = null;
    stopPing();

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }

    wsRef.current?.close();
    wsRef.current = null;
    setStatus('disconnected');
    setPrompt(null);
  }, [stopPing]);

  const sendInput = useCallback((data: string) => {
    const ws = wsRef.current;

    if (ws?.readyState === WebSocket.OPEN) {
      const encoded = new TextEncoder().encode(data);
      ws.send(encodeTerminalData(encoded));
    }
  }, []);

  const setOnData = useCallback((handler: (data: Uint8Array) => void) => {
    onDataRef.current = handler;
  }, []);

  const setOnResize = useCallback((handler: (cols: number, rows: number) => void) => {
    onResizeRef.current = handler;
  }, []);

  return {
    status,
    prompt,
    ptySize,
    connect,
    disconnect,
    sendInput,
    setOnData,
    setOnResize,
  };
}
