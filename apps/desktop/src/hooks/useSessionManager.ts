import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { spawn } from 'tauri-pty';
import type { IPty } from 'tauri-pty';
import { invoke } from '@tauri-apps/api/core';
import { DEFAULT_SHELL, DEFAULT_PTY_SIZE } from '@termpod/shared';
import type { TerminalHandle } from '@termpod/ui';

export type PtyDataListener = (data: Uint8Array | number[]) => void;

export interface TerminalSession {
  id: string;
  name: string;
  cwd: string;
  pty: IPty;
  termRef: React.RefObject<TerminalHandle | null>;
  dataListeners: Set<PtyDataListener>;
  createdAt: number;
  exited: boolean;
  closing: boolean;
  exitCode?: number;
}

interface SessionStore {
  sessions: TerminalSession[];
  activeId: string | null;
}

let nextId = 1;

function generateSessionId(): string {
  return `session-${nextId++}`;
}

function nameFromCwd(cwd: string): string {
  const parts = cwd.split('/').filter(Boolean);

  return parts[parts.length - 1] || 'shell';
}

export function useSessionManager() {
  const storeRef = useRef<SessionStore>({ sessions: [], activeId: null });
  const listenersRef = useRef<Set<() => void>>(new Set());

  const emit = useCallback(() => {
    for (const listener of listenersRef.current) {
      listener();
    }
  }, []);

  const getSnapshot = useCallback(() => storeRef.current, []);

  const subscribe = useCallback(
    (listener: () => void) => {
      listenersRef.current.add(listener);

      return () => {
        listenersRef.current.delete(listener);
      };
    },
    [],
  );

  const store = useSyncExternalStore(subscribe, getSnapshot);

  const updateStore = useCallback(
    (updater: (prev: SessionStore) => SessionStore) => {
      storeRef.current = updater(storeRef.current);
      emit();
    },
    [emit],
  );

  // Poll cwd for all active sessions via macOS proc_pidinfo
  useEffect(() => {
    const interval = setInterval(async () => {
      const sessions = storeRef.current.sessions;
      let changed = false;

      for (const session of sessions) {
        if (session.exited) {
          continue;
        }

        const pid = session.pty.pid;

        if (!pid) {
          continue;
        }

        const cwd = await invoke<string | null>('get_pid_cwd', { pid });

        if (cwd && cwd !== session.cwd) {
          session.cwd = cwd;
          session.name = nameFromCwd(cwd);
          changed = true;
        }
      }

      if (changed) {
        updateStore((prev) => ({
          ...prev,
          sessions: prev.sessions.map((s) => {
            const live = sessions.find((ls) => ls.id === s.id);

            return live ? { ...s, cwd: live.cwd, name: live.name } : s;
          }),
        }));
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [updateStore]);

  const createSession = useCallback(
    async (cwd?: string) => {
      const id = generateSessionId();
      const sessionCwd = cwd || await invoke<string>('get_home_dir');

      const pty = spawn(DEFAULT_SHELL, [], {
        cols: DEFAULT_PTY_SIZE.cols,
        rows: DEFAULT_PTY_SIZE.rows,
        cwd: sessionCwd,
      });

      const termRef = { current: null } as React.RefObject<TerminalHandle | null>;

      const dataListeners = new Set<PtyDataListener>();

      const session: TerminalSession = {
        id,
        name: nameFromCwd(sessionCwd),
        cwd: sessionCwd,
        pty,
        termRef,
        dataListeners,
        createdAt: Date.now(),
        exited: false,
        closing: false,
      };

      pty.onData((data) => {
        if (session.closing) {
          return;
        }

        session.termRef.current?.write(data);

        for (const listener of dataListeners) {
          listener(data);
        }
      });

      pty.onExit(({ exitCode }) => {
        if (session.closing) {
          return;
        }

        updateStore((prev) => ({
          ...prev,
          sessions: prev.sessions.map((s) =>
            s.id === id ? { ...s, exited: true, exitCode } : s,
          ),
        }));
        session.termRef.current?.write(`\r\n[Process exited with code ${exitCode}]\r\n`);
      });

      updateStore((prev) => ({
        sessions: [...prev.sessions, session],
        activeId: id,
      }));

      return session;
    },
    [updateStore],
  );

  const closeSession = useCallback(
    (id: string): { wasLast: boolean } => {
      const session = storeRef.current.sessions.find((s) => s.id === id);

      if (!session) {
        return { wasLast: false };
      }

      const wasLast = storeRef.current.sessions.length === 1;

      session.closing = true;

      // Phase 1: Hide the panel and switch active tab (panel stays in DOM but hidden)
      updateStore((prev) => {
        let newActiveId = prev.activeId;

        if (prev.activeId === id) {
          const remaining = prev.sessions.filter((s) => s.id !== id);
          const idx = prev.sessions.findIndex((s) => s.id === id);
          newActiveId = remaining[Math.min(idx, remaining.length - 1)]?.id ?? null;
        }

        return {
          sessions: prev.sessions.map((s) =>
            s.id === id ? { ...s, closing: true } : s,
          ),
          activeId: newActiveId,
        };
      });

      // Phase 2: Kill PTY and remove from DOM after browser paints the hidden state
      setTimeout(() => {
        if (!session.exited) {
          session.pty.kill();
        }

        updateStore((prev) => ({
          ...prev,
          sessions: prev.sessions.filter((s) => s.id !== id),
        }));
      }, 50);

      return { wasLast };
    },
    [updateStore],
  );

  const switchSession = useCallback(
    (id: string) => {
      updateStore((prev) => ({ ...prev, activeId: id }));
    },
    [updateStore],
  );

  const renameSession = useCallback(
    (id: string, name: string) => {
      updateStore((prev) => ({
        ...prev,
        sessions: prev.sessions.map((s) => (s.id === id ? { ...s, name } : s)),
      }));
    },
    [updateStore],
  );

  const focusActive = useCallback(() => {
    const { sessions: s, activeId: id } = storeRef.current;
    const active = s.find((sess) => sess.id === id);
    active?.termRef.current?.focus();
  }, []);

  const activeSession = store.sessions.find((s) => s.id === store.activeId) ?? null;

  return {
    sessions: store.sessions,
    activeId: store.activeId,
    activeSession,
    createSession,
    closeSession,
    switchSession,
    focusActive,
    renameSession,
  };
}
