import { invoke } from '@tauri-apps/api/core';

export interface IPty {
  pid: number | null;
  cols: number;
  rows: number;
  onData: (cb: (data: Uint8Array) => void) => void;
  onExit: (cb: (exit: { exitCode: number }) => void) => void;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: () => void;
}

interface SpawnOptions {
  cols?: number;
  rows?: number;
  cwd?: string;
  env?: Record<string, string>;
}

export function spawn(file: string, args: string[], options?: SpawnOptions): IPty {
  const dataListeners: ((data: Uint8Array) => void)[] = [];
  const exitListeners: ((exit: { exitCode: number }) => void)[] = [];

  let cols = options?.cols ?? 120;
  let rows = options?.rows ?? 40;
  let pid: number | null = null;
  let dead = false;

  const init = invoke<number>('pty_spawn', {
    file,
    args,
    cols,
    rows,
    cwd: options?.cwd ?? null,
    env: options?.env ?? {},
  }).then((id) => {
    pid = id;
    startReadLoop(id);
    startWait(id);
    return id;
  });

  function startReadLoop(id: number) {
    (async () => {
      try {
        for (;;) {
          const data = await invoke<number[]>('pty_read', { pid: id });
          const bytes = new Uint8Array(data);
          for (const cb of dataListeners) {
            cb(bytes);
          }
        }
      } catch (e) {
        if (typeof e === 'string' && e.includes('EOF')) {
          return;
        }
        // Read loop ended (PTY closed or error)
      }
    })();
  }

  function startWait(id: number) {
    (async () => {
      try {
        const exitCode = await invoke<number>('pty_exitstatus', { pid: id });
        dead = true;
        for (const cb of exitListeners) {
          cb({ exitCode });
        }
      } catch {
        // PTY already dead
      }
    })();
  }

  return {
    get pid() {
      return pid;
    },
    get cols() {
      return cols;
    },
    get rows() {
      return rows;
    },

    onData(cb) {
      dataListeners.push(cb);
    },

    onExit(cb) {
      exitListeners.push(cb);
    },

    write(data: string) {
      if (dead) return;
      init.then((id) => {
        invoke('pty_write', { pid: id, data }).catch((e) => {
          console.error('PTY write error:', e);
        });
      });
    },

    resize(newCols: number, newRows: number) {
      cols = newCols;
      rows = newRows;
      init.then((id) => {
        invoke('pty_resize', { pid: id, cols: newCols, rows: newRows }).catch((e) => {
          console.error('PTY resize error:', e);
        });
      });
    },

    kill() {
      dead = true;
      init.then((id) => {
        invoke('pty_kill', { pid: id }).catch(() => {});
      });
    },
  };
}
