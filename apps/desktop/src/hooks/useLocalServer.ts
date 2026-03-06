import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export interface LocalServerInfo {
  port: number;
  addresses: string[];
}

interface ViewerEvent {
  clientId: string;
  device: string;
  sessionId: string;
}

interface InputEvent {
  sessionId: string;
  data: number[];
}

interface ResizeEvent {
  sessionId: string;
  cols: number;
  rows: number;
}

interface UseLocalServerOptions {
  sessionId: string | null;
  onViewerInput?: (data: string) => void;
  onViewerJoined?: () => void;
  onViewerLeft?: () => void;
  onViewerResize?: (cols: number, rows: number) => void;
}

export function useLocalServer(options: UseLocalServerOptions) {
  const [serverInfo, setServerInfo] = useState<LocalServerInfo | null>(null);
  const [localViewers, setLocalViewers] = useState(0);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    let cancelled = false;

    invoke<LocalServerInfo>('start_local_server')
      .then((info) => {
        if (!cancelled) {
          console.log('[LocalServer] Started on port', info.port, 'addresses:', info.addresses);
          setServerInfo(info);
        }
      })
      .catch((err) => {
        // Server might already be running — that's fine
        console.warn('[LocalServer] Start:', err);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Listen for events from the Rust local WS server
  useEffect(() => {
    const unlisten: (() => void)[] = [];

    listen<ViewerEvent>('local-ws-viewer-joined', (event) => {
      const sid = optionsRef.current.sessionId;

      if (event.payload.sessionId === sid) {
        setLocalViewers((v) => v + 1);
        optionsRef.current.onViewerJoined?.();
      }
    }).then((fn) => unlisten.push(fn));

    listen<ViewerEvent>('local-ws-viewer-left', (event) => {
      const sid = optionsRef.current.sessionId;

      if (event.payload.sessionId === sid) {
        setLocalViewers((v) => Math.max(0, v - 1));
        optionsRef.current.onViewerLeft?.();
      }
    }).then((fn) => unlisten.push(fn));

    listen<InputEvent>('local-ws-input', (event) => {
      const sid = optionsRef.current.sessionId;

      if (event.payload.sessionId === sid) {
        const bytes = new Uint8Array(event.payload.data);
        optionsRef.current.onViewerInput?.(new TextDecoder().decode(bytes));
      }
    }).then((fn) => unlisten.push(fn));

    listen<ResizeEvent>('local-ws-resize', (event) => {
      const sid = optionsRef.current.sessionId;

      if (event.payload.sessionId === sid) {
        optionsRef.current.onViewerResize?.(event.payload.cols, event.payload.rows);
      }
    }).then((fn) => unlisten.push(fn));

    return () => {
      for (const fn of unlisten) {
        fn();
      }
    };
  }, []);

  const broadcastTerminalData = useCallback(
    (sessionId: string, data: Uint8Array | number[]) => {
      const bytes = data instanceof Uint8Array ? Array.from(data) : data;
      invoke('local_server_broadcast', { sessionId, data: bytes }).catch(() => {});
    },
    [],
  );

  const sendControl = useCallback(
    (sessionId: string, json: string) => {
      invoke('local_server_send_control', { sessionId, json }).catch(() => {});
    },
    [],
  );

  return {
    serverInfo,
    localViewers,
    broadcastTerminalData,
    sendControl,
  };
}
