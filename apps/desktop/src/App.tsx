import { useCallback, useEffect, useRef } from 'react';
import { Terminal } from '@termpod/ui';
import type { TerminalHandle } from '@termpod/ui';
import type { PtySize } from '@termpod/protocol';
import { spawn } from 'tauri-pty';
import type { IPty } from 'tauri-pty';
import { DEFAULT_SHELL } from '@termpod/shared';

export function App() {
  const termRef = useRef<TerminalHandle>(null);
  const ptyRef = useRef<IPty | null>(null);

  const handleData = useCallback((data: string) => {
    ptyRef.current?.write(data);
  }, []);

  const handleResize = useCallback((size: PtySize) => {
    ptyRef.current?.resize(size.cols, size.rows);
  }, []);

  useEffect(() => {
    const pty = spawn(DEFAULT_SHELL, [], {
      cols: 120,
      rows: 40,
    });

    ptyRef.current = pty;

    pty.onData((data) => {
      termRef.current?.write(data);
    });

    pty.onExit(({ exitCode }) => {
      termRef.current?.write(`\r\n[Process exited with code ${exitCode}]\r\n`);
    });

    return () => {
      pty.kill();
      ptyRef.current = null;
    };
  }, []);

  return (
    <div className="app">
      <Terminal ref={termRef} onData={handleData} onResize={handleResize} />
    </div>
  );
}
