import { useEffect, useRef, useCallback, useImperativeHandle, forwardRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import type { PtySize } from '@termpod/protocol';

import '@xterm/xterm/css/xterm.css';

export interface TerminalHandle {
  write: (data: string | Uint8Array) => void;
  clear: () => void;
  focus: () => void;
  openSearch: () => void;
  closeSearch: () => void;
  readonly cols: number;
  readonly rows: number;
}

export interface TerminalProps {
  onData?: (data: string) => void;
  onResize?: (size: PtySize) => void;
  onTitleChange?: (title: string) => void;
  onReady?: () => void;
  fontSize?: number;
  fontFamily?: string;
}

const SEARCH_DECORATIONS = {
  matchBackground: '#3d59a1',
  matchBorder: '#3d59a1',
  matchOverviewRuler: '#3d59a1',
  activeMatchBackground: '#ff9e64',
  activeMatchBorder: '#ff9e64',
  activeMatchColorOverviewRuler: '#ff9e64',
};

export const Terminal = forwardRef<TerminalHandle, TerminalProps>(
  ({ onData, onResize, onTitleChange, onReady, fontSize = 14, fontFamily = 'Menlo, monospace' }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const terminalRef = useRef<XTerm | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const searchAddonRef = useRef<SearchAddon | null>(null);
    const [searchVisible, setSearchVisible] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const searchInputRef = useRef<HTMLInputElement>(null);

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
      openSearch: () => {
        setSearchVisible(true);
      },
      closeSearch: () => {
        setSearchVisible(false);
        searchAddonRef.current?.clearDecorations();
        setSearchQuery('');

        terminalRef.current?.focus();
      },
      get cols() {
        return terminalRef.current?.cols ?? 120;
      },
      get rows() {
        return terminalRef.current?.rows ?? 40;
      },
    }));

    // Focus search input when search becomes visible
    useEffect(() => {
      if (searchVisible) {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    }, [searchVisible]);

    const handleSearchNext = useCallback(() => {
      if (!searchQuery || !searchAddonRef.current) {
        return;
      }

      searchAddonRef.current.findNext(searchQuery, { decorations: SEARCH_DECORATIONS });
    }, [searchQuery]);

    const handleSearchPrev = useCallback(() => {
      if (!searchQuery || !searchAddonRef.current) {
        return;
      }

      searchAddonRef.current.findPrevious(searchQuery, { decorations: SEARCH_DECORATIONS });
    }, [searchQuery]);

    const handleSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSearchVisible(false);
        searchAddonRef.current?.clearDecorations();
        setSearchQuery('');

        terminalRef.current?.focus();
      } else if (e.key === 'Enter') {
        if (e.shiftKey) {
          handleSearchPrev();
        } else {
          handleSearchNext();
        }
      }
    }, [handleSearchNext, handleSearchPrev]);

    // Trigger search as user types
    useEffect(() => {
      if (!searchAddonRef.current || !searchVisible) {
        return;
      }

      if (!searchQuery) {
        searchAddonRef.current.clearDecorations();

        return;
      }

      searchAddonRef.current.findNext(searchQuery, { decorations: SEARCH_DECORATIONS });
    }, [searchQuery, searchVisible]);

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
      const searchAddon = new SearchAddon();
      term.loadAddon(fitAddon);
      term.loadAddon(searchAddon);
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
      searchAddonRef.current = searchAddon;

      // Clipboard: Cmd+C copies selection (or sends SIGINT if no selection)
      term.attachCustomKeyEventHandler((event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'c' && event.type === 'keydown') {
          const selection = term.getSelection();

          if (selection) {
            navigator.clipboard.writeText(selection);
            term.clearSelection();
            return false;
          }
        }

        // Cmd+F opens search
        if (event.metaKey && event.key === 'f' && event.type === 'keydown') {
          setSearchVisible(true);
          return false;
        }

        return true;
      });

      if (onData) {
        term.onData(onData);
      }

      if (onTitleChange) {
        term.onTitleChange(onTitleChange);
      }

      onReady?.();

      const resizeObserver = new ResizeObserver(handleResize);
      resizeObserver.observe(containerRef.current);

      return () => {
        resizeObserver.disconnect();
        term.dispose();
        terminalRef.current = null;
        fitAddonRef.current = null;
        searchAddonRef.current = null;
      };
    }, [fontSize, fontFamily, onData, onTitleChange, onReady, handleResize]);

    return (
      <div style={{ width: '100%', height: '100%', position: 'relative' }}>
        {searchVisible && (
          <div className="terminal-search-bar">
            <input
              ref={searchInputRef}
              className="terminal-search-input"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search..."
              spellCheck={false}
            />
            <button className="terminal-search-btn" onClick={handleSearchPrev} type="button" title="Previous (Shift+Enter)">
              &#x25B2;
            </button>
            <button className="terminal-search-btn" onClick={handleSearchNext} type="button" title="Next (Enter)">
              &#x25BC;
            </button>
            <button
              className="terminal-search-btn"
              onClick={() => {
                setSearchVisible(false);
                searchAddonRef.current?.clearDecorations();
                setSearchQuery('');
        
                terminalRef.current?.focus();
              }}
              type="button"
              title="Close (Esc)"
            >
              &times;
            </button>
          </div>
        )}
        <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      </div>
    );
  },
);

Terminal.displayName = 'Terminal';
