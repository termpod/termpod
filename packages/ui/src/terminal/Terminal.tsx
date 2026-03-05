import { useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { WebLinksAddon } from '@xterm/addon-web-links';
import type { PtySize } from '@termpod/protocol';

import '@xterm/xterm/css/xterm.css';

export interface TerminalHandle {
  write: (data: string | Uint8Array) => void;
  clear: () => void;
  focus: () => void;
}

export interface TerminalProps {
  onData?: (data: string) => void;
  onResize?: (size: PtySize) => void;
  onTitleChange?: (title: string) => void;
  fontSize?: number;
  fontFamily?: string;
}

export const Terminal = forwardRef<TerminalHandle, TerminalProps>(
  ({ onData, onResize, onTitleChange, fontSize = 14, fontFamily = 'Menlo, monospace' }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const terminalRef = useRef<XTerm | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);

    useImperativeHandle(ref, () => ({
      write: (data: string | Uint8Array) => {
        terminalRef.current?.write(data);
      },
      clear: () => {
        terminalRef.current?.clear();
      },
      focus: () => {
        terminalRef.current?.focus();
      },
    }));

    const handleResize = useCallback(() => {
      const fit = fitAddonRef.current;
      const term = terminalRef.current;

      if (!fit || !term) {
        return;
      }

      fit.fit();
      onResize?.({ cols: term.cols, rows: term.rows });
    }, [onResize]);

    useEffect(() => {
      if (!containerRef.current) {
        return;
      }

      const term = new XTerm({
        fontSize,
        fontFamily,
        cursorBlink: true,
        allowProposedApi: true,
        theme: {
          background: '#1a1b26',
          foreground: '#c0caf5',
          cursor: '#c0caf5',
          selectionBackground: '#33467c',
        },
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.loadAddon(new WebLinksAddon());

      term.open(containerRef.current);

      try {
        term.loadAddon(new WebglAddon());
      } catch {
        // WebGL not available, fall back to canvas renderer
      }

      fitAddon.fit();
      terminalRef.current = term;
      fitAddonRef.current = fitAddon;

      if (onData) {
        term.onData(onData);
      }

      if (onTitleChange) {
        term.onTitleChange(onTitleChange);
      }

      const resizeObserver = new ResizeObserver(handleResize);
      resizeObserver.observe(containerRef.current);

      return () => {
        resizeObserver.disconnect();
        term.dispose();
        terminalRef.current = null;
        fitAddonRef.current = null;
      };
    }, [fontSize, fontFamily, onData, onTitleChange, handleResize]);

    return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
  },
);

Terminal.displayName = 'Terminal';
