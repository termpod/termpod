import { useEffect, useRef, useCallback, useImperativeHandle, forwardRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
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
  resize: (cols: number, rows: number) => void;
  lockSize: () => void;
  unlockSize: () => void;
  openSearch: () => void;
  closeSearch: () => void;
  findNext: () => void;
  findPrevious: () => void;
  refresh: () => void;
  scrollToTop: () => void;
  scrollToBottom: () => void;
  selectAll: () => void;
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
  scrollbarSliderBackground?: string;
  scrollbarSliderHoverBackground?: string;
  scrollbarSliderActiveBackground?: string;
}

export interface TerminalProps {
  onData?: (data: string) => void;
  onResize?: (size: PtySize) => void;
  onTitleChange?: (title: string) => void;
  onCwdChange?: (cwd: string) => void;
  onBell?: () => void;
  onReady?: () => void;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string;
  fontSmoothing?: string;
  fontLigatures?: boolean;
  drawBoldInBold?: boolean;
  scrollbackLines?: number;
  cursorStyle?: 'block' | 'underline' | 'bar';
  cursorBlink?: boolean;
  lineHeight?: number;
  padding?: number;
  promptAtBottom?: boolean;
  copyOnSelect?: boolean;
  macOptionIsMeta?: boolean;
  altClickMoveCursor?: boolean;
  wordSeparators?: string;
  theme?: TerminalThemeColors;
  onOpenUrl?: (url: string) => void;
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
  ({ onData, onResize, onTitleChange, onCwdChange, onBell, onReady, fontSize = 14, fontFamily = 'Menlo, monospace', fontWeight = 'normal', fontSmoothing = 'antialiased', fontLigatures = false, drawBoldInBold = true, scrollbackLines = 5000, cursorStyle = 'block', cursorBlink = true, lineHeight = 1.0, padding = 0, promptAtBottom = false, copyOnSelect = false, macOptionIsMeta = false, altClickMoveCursor = true, wordSeparators, theme, onOpenUrl }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const terminalRef = useRef<XTerm | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const searchAddonRef = useRef<SearchAddon | null>(null);
    const sizeLockedRef = useRef(false);
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
    const onCwdChangeRef = useRef(onCwdChange);
    onCwdChangeRef.current = onCwdChange;
    const onBellRef = useRef(onBell);
    onBellRef.current = onBell;
    const onReadyRef = useRef(onReady);
    onReadyRef.current = onReady;
    const onOpenUrlRef = useRef(onOpenUrl);
    onOpenUrlRef.current = onOpenUrl;
    const promptAtBottomRef = useRef(promptAtBottom);
    promptAtBottomRef.current = promptAtBottom;
    const copyOnSelectRef = useRef(copyOnSelect);
    copyOnSelectRef.current = copyOnSelect;

    const searchQueryRef = useRef(searchQuery);
    const kittyKeyboardStackRef = useRef<number[]>([]);
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
    searchQueryRef.current = searchQuery;

    // Matches cursor-home followed by erase display/scrollback/to-end:
    //   \x1b[H\x1b[J  — zsh Ctrl+L (cursor home + erase to end)
    //   \x1b[H\x1b[2J — clear command (cursor home + erase display)
    //   \x1b[H\x1b[3J — erase scrollback
    const CLEAR_RE = /\x1b\[H\x1b\[[023]?J/g;

    useImperativeHandle(ref, () => ({
      write: (data: string | Uint8Array) => {
        const term = terminalRef.current;
        if (!term) return;

        if (promptAtBottomRef.current && term.rows > 1) {
          const str = typeof data === 'string'
            ? data
            : new TextDecoder().decode(data instanceof Uint8Array ? data : new Uint8Array(data));

          CLEAR_RE.lastIndex = 0;

          if (CLEAR_RE.test(str)) {
            CLEAR_RE.lastIndex = 0;
            const padding = '\n'.repeat(term.rows - 1);
            term.write(str.replace(CLEAR_RE, `$&${padding}`));
            return;
          }
        }

        term.write(data);
      },
      clear: () => {
        terminalRef.current?.clear();
      },
      focus: () => {
        terminalRef.current?.focus();
      },
      fit: () => {
        if (sizeLockedRef.current) return;
        try {
          fitAddonRef.current?.fit();
        } catch {
          // ignore fit errors (e.g. 0-dimension container)
        }
      },
      resize: (cols: number, rows: number) => {
        terminalRef.current?.resize(cols, rows);
      },
      lockSize: () => {
        sizeLockedRef.current = true;
      },
      unlockSize: () => {
        sizeLockedRef.current = false;
        try {
          fitAddonRef.current?.fit();
        } catch {
          // ignore
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
      findNext: () => {
        if (searchQueryRef.current && searchAddonRef.current) {
          searchAddonRef.current.findNext(searchQueryRef.current, { decorations: SEARCH_DECORATIONS });
        }
      },
      findPrevious: () => {
        if (searchQueryRef.current && searchAddonRef.current) {
          searchAddonRef.current.findPrevious(searchQueryRef.current, { decorations: SEARCH_DECORATIONS });
        }
      },
      refresh: () => {
        const term = terminalRef.current;
        if (!term) return;
        term.clearTextureAtlas();
        try {
          fitAddonRef.current?.fit();
        } catch {
          // ignore
        }
      },
      scrollToTop: () => {
        terminalRef.current?.scrollToTop();
      },
      scrollToBottom: () => {
        terminalRef.current?.scrollToBottom();
      },
      selectAll: () => {
        terminalRef.current?.selectAll();
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

    const handleContextMenu = useCallback((e: ReactMouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ x: e.clientX, y: e.clientY });
    }, []);

    const closeContextMenu = useCallback(() => {
      setContextMenu(null);
    }, []);

    const handleCopy = useCallback(() => {
      const selection = terminalRef.current?.getSelection();

      if (selection) {
        navigator.clipboard.writeText(selection);
        terminalRef.current?.clearSelection();
      }

      setContextMenu(null);
      terminalRef.current?.focus();
    }, []);

    const handlePaste = useCallback(async () => {
      setContextMenu(null);

      try {
        const text = await navigator.clipboard.readText();

        if (text) {
          onDataRef.current?.(text);
        }
      } catch {
        // clipboard access denied
      }

      terminalRef.current?.focus();
    }, []);

    const handleSelectAll = useCallback(() => {
      terminalRef.current?.selectAll();
      setContextMenu(null);
    }, []);

    const handleClearTerminal = useCallback(() => {
      terminalRef.current?.clear();
      setContextMenu(null);
      terminalRef.current?.focus();
    }, []);

    const handleContextSearch = useCallback(() => {
      setContextMenu(null);
      setSearchVisible(true);
    }, []);

    // Close context menu on click outside or scroll
    useEffect(() => {
      if (!contextMenu) return;

      const close = () => setContextMenu(null);
      window.addEventListener('click', close);
      window.addEventListener('scroll', close, true);
      window.addEventListener('blur', close);

      return () => {
        window.removeEventListener('click', close);
        window.removeEventListener('scroll', close, true);
        window.removeEventListener('blur', close);
      };
    }, [contextMenu]);

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

      const baseTheme = theme ?? {
        background: '#1a1b26',
        foreground: '#c0caf5',
        cursor: '#c0caf5',
        selectionBackground: '#33467c',
      };

      const xtermWeight = fontWeight === 'normal' ? 'normal' : fontWeight;

      const term = new XTerm({
        fontSize,
        fontFamily,
        fontWeight: xtermWeight as any,
        fontWeightBold: (drawBoldInBold ? 'bold' : xtermWeight) as any,
        scrollback: scrollbackLines,
        cursorBlink,
        cursorStyle,
        lineHeight,
        macOptionIsMeta,
        altClickMovesCursor: altClickMoveCursor,
        wordSeparator: wordSeparators,
        allowProposedApi: true,
        theme: baseTheme,
      });

      const fitAddon = new FitAddon();
      const searchAddon = new SearchAddon();
      term.loadAddon(fitAddon);
      term.loadAddon(searchAddon);
      term.loadAddon(new WebLinksAddon((event, uri) => {
        if (event.metaKey) {
          onOpenUrlRef.current?.(uri);
        }
      }));

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

      // Rebuild the WebGL texture atlas after fonts finish loading so that
      // both normal and bold weights use the correct font face.
      document.fonts.ready.then(() => {
        if (terminalRef.current === term) {
          term.clearTextureAtlas();
        }
      });

      // Second clear after initial content has rendered — covers cases where
      // bold glyphs were cached before the first clear ran.
      const fontFixTimer = setTimeout(() => {
        if (terminalRef.current === term) {
          term.clearTextureAtlas();
        }
      }, 500);

      fitAddon.fit();

      // Push the initial prompt to the bottom of the viewport (Warp-style)
      if (promptAtBottom && term.rows > 1) {
        term.write('\n'.repeat(term.rows - 1));
      }

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

        // Shift+Enter: send CSI u encoding so apps like Claude Code interpret it as newline
        // Block all event types (keydown, keypress, keyup) to prevent xterm also sending \r
        if (event.shiftKey && event.key === 'Enter') {
          if (event.type === 'keydown') {
            onDataRef.current?.('\x1b[13;2u');
          }

          return false;
        }

        // macOS-native cursor navigation (works without macOptionIsMeta)
        if (event.type === 'keydown') {
          // Cmd+Left → Home (start of line)
          if (event.metaKey && event.key === 'ArrowLeft') {
            onDataRef.current?.('\x1b[H');
            return false;
          }

          // Cmd+Right → End (end of line)
          if (event.metaKey && event.key === 'ArrowRight') {
            onDataRef.current?.('\x1b[F');
            return false;
          }

          // Option+Left → word back (Alt+B)
          if (event.altKey && event.key === 'ArrowLeft') {
            onDataRef.current?.('\x1bb');
            return false;
          }

          // Option+Right → word forward (Alt+F)
          if (event.altKey && event.key === 'ArrowRight') {
            onDataRef.current?.('\x1bf');
            return false;
          }

          // Option+Delete → delete word back
          if (event.altKey && event.key === 'Backspace') {
            onDataRef.current?.('\x1b\x7f');
            return false;
          }
        }

        return true;
      });

      // Use refs for callbacks so they always call the latest version
      term.onData((data) => onDataRef.current?.(data));
      term.onTitleChange((title) => onTitleChangeRef.current?.(title));

      // Copy on select: auto-copy to clipboard when text is selected
      term.onSelectionChange(() => {
        if (!copyOnSelectRef.current) return;
        const selection = term.getSelection();
        if (selection) {
          navigator.clipboard.writeText(selection);
        }
      });

      // OSC 7: shell reports current working directory (emitted by zsh on macOS by default)
      // Format: file://hostname/path/to/dir
      term.parser.registerOscHandler(7, (data) => {
        try {
          const url = new URL(data);
          const cwd = decodeURIComponent(url.pathname);

          if (cwd) {
            onCwdChangeRef.current?.(cwd);
          }
        } catch {
          // Not a valid URL, ignore
        }

        return false;
      });

      // Kitty keyboard protocol support (progressive enhancement)
      // Apps like Claude Code push this mode to get modifier info on keys like Enter.
      // We track the mode stack and respond to queries so the app knows we support it.
      // Ref is used so the key event handler can read the current state.
      const kittyKeyboardStack: number[] = [];
      kittyKeyboardStackRef.current = kittyKeyboardStack;

      // CSI > flags u — push keyboard mode
      term.parser.registerCsiHandler({ prefix: '>', final: 'u' }, (params) => {
        const flags = params[0] ?? 0;
        kittyKeyboardStack.push(typeof flags === 'number' ? flags : 0);
        return true;
      });

      // CSI < count u — pop keyboard mode
      term.parser.registerCsiHandler({ prefix: '<', final: 'u' }, (params) => {
        const count = (typeof params[0] === 'number' && params[0] > 0) ? params[0] : 1;

        for (let i = 0; i < count && kittyKeyboardStack.length > 0; i++) {
          kittyKeyboardStack.pop();
        }

        return true;
      });

      // CSI ? u — query current keyboard mode, respond with CSI ? flags u
      term.parser.registerCsiHandler({ prefix: '?', final: 'u' }, () => {
        const flags = kittyKeyboardStack.length > 0
          ? kittyKeyboardStack[kittyKeyboardStack.length - 1]
          : 0;
        onDataRef.current?.(`\x1b[?${flags}u`);
        return true;
      });

      term.onBell(() => onBellRef.current?.());

      onReadyRef.current?.();

      const resizeObserver = new ResizeObserver((entries) => {
        if (!fitAddonRef.current || !terminalRef.current || sizeLockedRef.current) {
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
        clearTimeout(fontFixTimer);
        resizeObserver.disconnect();
        term.dispose();
        terminalRef.current = null;
        fitAddonRef.current = null;
        searchAddonRef.current = null;
      };
    }, [fontSize, fontFamily, fontWeight, drawBoldInBold, scrollbackLines, promptAtBottom]); // eslint-disable-line react-hooks/exhaustive-deps

    // Apply appearance changes dynamically without recreating the terminal
    useEffect(() => {
      const term = terminalRef.current;
      if (!term) return;

      term.options.cursorBlink = cursorBlink;
      term.options.cursorStyle = cursorStyle;
      term.options.lineHeight = lineHeight;
      term.options.macOptionIsMeta = macOptionIsMeta;
      term.options.altClickMovesCursor = altClickMoveCursor;
      if (wordSeparators !== undefined) {
        term.options.wordSeparator = wordSeparators;
      }

      if (theme) {
        term.options.theme = theme;
      }
    }, [cursorBlink, cursorStyle, lineHeight, macOptionIsMeta, altClickMoveCursor, wordSeparators, theme]);

    // Apply padding to xterm's scrollable element and re-fit
    useEffect(() => {
      const el = containerRef.current?.querySelector<HTMLElement>('.xterm-scrollable-element');
      if (el) {
        el.style.padding = padding ? `${padding}px` : '';
      }

      if (fitAddonRef.current && terminalRef.current && !sizeLockedRef.current) {
        try {
          fitAddonRef.current.fit();
          onResizeRef.current?.({ cols: terminalRef.current.cols, rows: terminalRef.current.rows });
        } catch { /* ignore */ }
      }
    }, [padding]);

    // Apply font smoothing and ligatures via CSS on the terminal container
    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;

      const smoothingMap: Record<string, string> = {
        auto: 'auto',
        antialiased: 'antialiased',
        none: 'none',
      };
      el.style.setProperty('-webkit-font-smoothing', smoothingMap[fontSmoothing] ?? 'auto');
      el.style.fontVariantLigatures = fontLigatures ? 'normal' : 'none';
    }, [fontSmoothing, fontLigatures]);

    const hasSelection = contextMenu ? !!terminalRef.current?.getSelection() : false;

    return (
      <div style={{ width: '100%', height: '100%', position: 'relative' }} onContextMenu={handleContextMenu}>
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
        {contextMenu && (
          <div
            className="terminal-context-menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <button className="terminal-context-menu-item" onClick={handleCopy} disabled={!hasSelection}>
              <span className="terminal-context-menu-label">Copy</span>
              <span className="terminal-context-menu-shortcut">&#8984;C</span>
            </button>
            <button className="terminal-context-menu-item" onClick={handlePaste}>
              <span className="terminal-context-menu-label">Paste</span>
              <span className="terminal-context-menu-shortcut">&#8984;V</span>
            </button>
            <div className="terminal-context-menu-separator" />
            <button className="terminal-context-menu-item" onClick={handleSelectAll}>
              <span className="terminal-context-menu-label">Select All</span>
              <span className="terminal-context-menu-shortcut">&#8984;A</span>
            </button>
            <div className="terminal-context-menu-separator" />
            <button className="terminal-context-menu-item" onClick={handleClearTerminal}>
              <span className="terminal-context-menu-label">Clear Terminal</span>
              <span className="terminal-context-menu-shortcut">&#8984;K</span>
            </button>
            <button className="terminal-context-menu-item" onClick={handleContextSearch}>
              <span className="terminal-context-menu-label">Find...</span>
              <span className="terminal-context-menu-shortcut">&#8984;F</span>
            </button>
          </div>
        )}
        <div ref={containerRef} style={{
          position: 'absolute',
          inset: 0,
          bottom: padding || 0,
        }} />
      </div>
    );
  },
);

Terminal.displayName = 'Terminal';
