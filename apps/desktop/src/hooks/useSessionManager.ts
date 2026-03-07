import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { spawn } from '../pty';
import type { IPty } from '../pty';
import { invoke } from '@tauri-apps/api/core';
import { DEFAULT_SHELL, DEFAULT_PTY_SIZE, getIconForProcess } from '@termpod/shared';
import type { TabIcon } from '@termpod/shared';
import type { TerminalHandle } from '@termpod/ui';

export type PtyDataListener = (data: Uint8Array | number[]) => void;

export interface TerminalSession {
  id: string;
  name: string;
  cwd: string;
  pty: IPty;
  shellPid: number | null;
  termRef: React.RefObject<TerminalHandle | null>;
  dataListeners: Set<PtyDataListener>;
  pendingData: (Uint8Array | number[])[];
  termReady: boolean;
  createdAt: number;
  exited: boolean;
  closing: boolean;
  exitCode?: number;
  processName: string | null;
  icon: TabIcon | null;
}

interface SessionStore {
  sessions: TerminalSession[];
  activeId: string | null;
}

let nextId = 1;

function generateSessionId(): string {
  return `session-${nextId++}`;
}

let cachedHomeDir: string | null = null;

const homeDirPromise = invoke<string>('get_home_dir').then((dir) => {
  cachedHomeDir = dir;
  return dir;
}).catch(() => null);

export function nameFromCwd(cwd: string): string {
  if (cachedHomeDir && (cwd === cachedHomeDir || cwd === cachedHomeDir + '/')) {
    return '~';
  }

  const parts = cwd.split('/').filter(Boolean);

  return parts[parts.length - 1] || 'shell';
}

export function useSessionManager() {
  const storeRef = useRef<SessionStore>({ sessions: [], activeId: null });
  const listenersRef = useRef<Set<() => void>>(new Set());
  const onSessionExitRef = useRef<((id: string) => void) | null>(null);

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

  // Poll cwd and foreground process for all active sessions
  useEffect(() => {
    // Discover real shell PIDs on first poll and when new sessions appear
    let knownShellPids: number[] = [];

    const discoverShellPids = async () => {
      const pids = await invoke<number[]>('get_shell_children');
      knownShellPids = pids;
      // Assign shell PIDs to sessions that don't have one yet.
      // Sessions are created in order, and shell children appear in PID order,
      // so we match by index of unassigned sessions.
      const sessions = storeRef.current.sessions;
      const unassigned = sessions.filter((s) => !s.shellPid && !s.exited);
      const usedPids = new Set(sessions.map((s) => s.shellPid).filter(Boolean));
      const availablePids = pids.filter((p) => !usedPids.has(p));

      let changed = false;

      for (let i = 0; i < unassigned.length && i < availablePids.length; i++) {
        unassigned[i].shellPid = availablePids[i];
        changed = true;
      }

      return changed;
    };

    const interval = setInterval(async () => {
      const sessions = storeRef.current.sessions;
      let changed = false;

      // Discover shell PIDs for any new sessions
      const hasUnassigned = sessions.some((s) => !s.shellPid && !s.exited);

      if (hasUnassigned) {
        changed = await discoverShellPids();
      }

      for (const session of sessions) {
        if (session.exited || !session.shellPid) {
          continue;
        }

        const pid = session.shellPid;

        const [cwd, processName] = await Promise.all([
          invoke<string | null>('get_pid_cwd', { pid }),
          invoke<string | null>('get_foreground_process', { pid }),
        ]);

        if (cwd && cwd !== session.cwd) {
          session.cwd = cwd;
          session.name = nameFromCwd(cwd);
          changed = true;
        }

        if (processName !== session.processName) {
          session.processName = processName;
          session.icon = processName ? getIconForProcess(processName) : null;
          changed = true;
        }
      }

      if (changed) {
        updateStore((prev) => ({
          ...prev,
          sessions: prev.sessions.map((s) => {
            const live = sessions.find((ls) => ls.id === s.id);

            return live
              ? { ...s, cwd: live.cwd, name: live.name, processName: live.processName, icon: live.icon, shellPid: live.shellPid }
              : s;
          }),
        }));
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [updateStore]);

  const createSession = useCallback(
    async (options?: { cwd?: string; shell?: string }) => {
      const id = generateSessionId();
      const sessionCwd = options?.cwd || cachedHomeDir || await homeDirPromise || '/Users';
      const shell = options?.shell || DEFAULT_SHELL;

      const pty = spawn(shell, ['-l'], {
        cols: DEFAULT_PTY_SIZE.cols,
        rows: DEFAULT_PTY_SIZE.rows,
        cwd: sessionCwd,
        env: { TERM: 'xterm-256color' },
      });

      const termRef = { current: null } as React.RefObject<TerminalHandle | null>;

      const dataListeners = new Set<PtyDataListener>();

      const session: TerminalSession = {
        id,
        name: nameFromCwd(sessionCwd),
        cwd: sessionCwd,
        pty,
        shellPid: null,
        termRef,
        dataListeners,
        pendingData: [],
        termReady: false,
        createdAt: Date.now(),
        exited: false,
        closing: false,
        processName: null,
        icon: null,
      };

      pty.onData((data) => {
        if (session.closing) {
          return;
        }

        if (session.termReady) {
          session.termRef.current?.write(data);
        } else {
          session.pendingData.push(data);
        }

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

        onSessionExitRef.current?.(id);
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

  const updateSessionCwd = useCallback(
    (id: string, cwd: string) => {
      updateStore((prev) => ({
        ...prev,
        sessions: prev.sessions.map((s) =>
          s.id === id ? { ...s, cwd, name: nameFromCwd(cwd) } : s,
        ),
      }));
    },
    [updateStore],
  );

  const reorderSessions = useCallback(
    (fromIndex: number, toIndex: number) => {
      updateStore((prev) => {
        if (fromIndex === toIndex) return prev;
        const next = [...prev.sessions];
        const [moved] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, moved);
        return { ...prev, sessions: next };
      });
    },
    [updateStore],
  );

  const markTermReady = useCallback((id: string) => {
    const session = storeRef.current.sessions.find((s) => s.id === id);

    if (!session || session.termReady) {
      return;
    }

    session.termReady = true;

    // Flush buffered PTY data that arrived before xterm was mounted
    for (const data of session.pendingData) {
      session.termRef.current?.write(data);
    }

    session.pendingData.length = 0;
  }, []);

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
    markTermReady,
    renameSession,
    reorderSessions,
    updateSessionCwd,
    onSessionExitRef,
  };
}
