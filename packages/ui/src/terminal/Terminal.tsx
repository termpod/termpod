import { useEffect, useRef, useCallback, useImperativeHandle, forwardRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import { UnicodeGraphemesAddon } from '@xterm/addon-unicode-graphemes';
import type { PtySize } from '@termpod/protocol';

import '@xterm/xterm/css/xterm.css';

export interface TerminalHandle {
  write: (data: string | Uint8Array) => void;
  clear: () => void;
  focus: () => void;
  fit: () => void;
  openSearch: () => void;
  closeSearch: () => void;
  readonly cols: number;
  readonly rows: number;
}

export interface TerminalThemeColors {
  background: string;
  foreground: string;
  cursor: string;
  selectionBackground: string;
  black?: string;
  red?: string;
  green?: string;
  yellow?: string;
  blue?: string;
  magenta?: string;
  cyan?: string;
  white?: string;
  brightBlack?: string;
  brightRed?: string;
  brightGreen?: string;
  brightYellow?: string;
  brightBlue?: string;
  brightMagenta?: string;
  brightCyan?: string;
  brightWhite?: string;
}

export interface TerminalProps {
  onData?: (data: string) => void;
  onResize?: (size: PtySize) => void;
  onTitleChange?: (title: string) => void;
  onBell?: () => void;
  onReady?: () => void;
  fontSize?: number;
  fontFamily?: string;
  scrollbackLines?: number;
  cursorStyle?: 'block' | 'underline' | 'bar';
  cursorBlink?: boolean;
  lineHeight?: number;
  theme?: TerminalThemeColors;
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
  ({ onData, onResize, onTitleChange, onBell, onReady, fontSize = 14, fontFamily = 'Menlo, monospace', scrollbackLines = 5000, cursorStyle = 'block', cursorBlink = true, lineHeight = 1.0, theme }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const terminalRef = useRef<XTerm | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const searchAddonRef = useRef<SearchAddon | null>(null);
    const [searchVisible, setSearchVisible] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const searchInputRef = useRef<HTMLInputElement>(null);

    // Store callbacks in refs so the xterm instance never needs to be
    // destroyed just because a callback reference changed.
    const onDataRef = useRef(onData);
    onDataRef.current = onData;
    const onResizeRef = useRef(onResize);
    onResizeRef.current = onResize;
    const onTitleChangeRef = useRef(onTitleChange);
    onTitleChangeRef.current = onTitleChange;
    const onBellRef = useRef(onBell);
    onBellRef.current = onBell;
    const onReadyRef = useRef(onReady);
    onReadyRef.current = onReady;

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
      fit: () => {
        try {
          fitAddonRef.current?.fit();
        } catch {
          // ignore fit errors (e.g. 0-dimension container)
        }
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

    // Create the xterm instance once. Only recreate on font/scrollback changes.
    useEffect(() => {
      if (!containerRef.current) {
        return;
      }

      const term = new XTerm({
        fontSize,
        fontFamily,
        scrollback: scrollbackLines,
        cursorBlink,
        cursorStyle,
        lineHeight,
        allowProposedApi: true,
        theme: theme ?? {
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

      const unicodeAddon = new UnicodeGraphemesAddon();
      term.loadAddon(unicodeAddon);
      term.unicode.activeVersion = '15';

      term.open(containerRef.current);

      try {
        const webgl = new WebglAddon();
        webgl.onContextLoss(() => webgl.dispose());
        term.loadAddon(webgl);
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

      // Use refs for callbacks so they always call the latest version
      term.onData((data) => onDataRef.current?.(data));
      term.onTitleChange((title) => onTitleChangeRef.current?.(title));
      term.onBell(() => onBellRef.current?.());

      onReadyRef.current?.();

      const resizeObserver = new ResizeObserver((entries) => {
        if (!fitAddonRef.current || !terminalRef.current) {
          return;
        }

        const entry = entries[0];
        if (!entry || entry.contentRect.width === 0 || entry.contentRect.height === 0) {
          return;
        }

        try {
          fitAddonRef.current.fit();
        } catch {
          return;
        }
        onResizeRef.current?.({ cols: terminalRef.current.cols, rows: terminalRef.current.rows });
      });
      resizeObserver.observe(containerRef.current);

      return () => {
        resizeObserver.disconnect();
        term.dispose();
        terminalRef.current = null;
        fitAddonRef.current = null;
        searchAddonRef.current = null;
      };
    }, [fontSize, fontFamily, scrollbackLines]); // eslint-disable-line react-hooks/exhaustive-deps

    // Apply appearance changes dynamically without recreating the terminal
    useEffect(() => {
      const term = terminalRef.current;
      if (!term) return;

      term.options.cursorBlink = cursorBlink;
      term.options.cursorStyle = cursorStyle;
      term.options.lineHeight = lineHeight;

      if (theme) {
        term.options.theme = theme;
      }
    }, [cursorBlink, cursorStyle, lineHeight, theme]);

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
