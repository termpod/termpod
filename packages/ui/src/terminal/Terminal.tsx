import {
  useEffect,
  useRef,
  useCallback,
  useImperativeHandle,
  forwardRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import { UnicodeGraphemesAddon } from '@xterm/addon-unicode-graphemes';
import type { PtySize } from '@termpod/protocol';
import type { BlockBoundary, Suggestion, AutocompleteEngine } from '@termpod/shared';
import { BlockDecorationManager } from './BlockDecorations';
import { GhostText } from '../autocomplete/GhostText';
import { AutocompletePopup } from '../autocomplete/AutocompletePopup';

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
  onBlockBoundary?: (boundary: BlockBoundary) => void;
  onSaveWorkflow?: (command: string) => void;
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
  scrollbarVisibility?: 'always' | 'when-scrolling' | 'never';
  onOpenUrl?: (url: string) => void;
  // Autocomplete options
  autocompleteEnabled?: boolean;
  autocompleteEngine?: AutocompleteEngine;
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
  (
    {
      onData,
      onResize,
      onTitleChange,
      onCwdChange,
      onBlockBoundary,
      onSaveWorkflow,
      onBell,
      onReady,
      fontSize = 14,
      fontFamily = 'Menlo, monospace',
      fontWeight = 'normal',
      fontSmoothing = 'antialiased',
      fontLigatures = false,
      drawBoldInBold = true,
      scrollbackLines = 5000,
      cursorStyle = 'block',
      cursorBlink = true,
      lineHeight = 1.0,
      padding = 0,
      promptAtBottom = false,
      copyOnSelect = false,
      macOptionIsMeta = false,
      altClickMoveCursor = true,
      wordSeparators,
      theme,
      scrollbarVisibility = 'auto',
      onOpenUrl,
      autocompleteEnabled = true,
      autocompleteEngine,
    },
    ref,
  ) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const terminalRef = useRef<XTerm | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const searchAddonRef = useRef<SearchAddon | null>(null);
    const sizeLockedRef = useRef(false);
    const [searchVisible, setSearchVisible] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const searchInputRef = useRef<HTMLInputElement>(null);

    // Autocomplete state
    const [ghostText, setGhostText] = useState<string | null>(null);
    const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
    const [selectedSuggestion, setSelectedSuggestion] = useState(0);
    const autocompleteEngineRef = useRef<AutocompleteEngine | null>(null);
    const suggestionsRef = useRef<Suggestion[]>([]);
    suggestionsRef.current = suggestions;
    const autocompleteInputRef = useRef<{ buffer: string; cursor: number }>({
      buffer: '',
      cursor: 0,
    });
    const previewAnchorPrefixRef = useRef<string | null>(null);
    const previewSuffixRef = useRef('');
    const ghostTextRef = useRef<string | null>(null);
    ghostTextRef.current = ghostText;

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
    const onBlockBoundaryRef = useRef(onBlockBoundary);
    onBlockBoundaryRef.current = onBlockBoundary;
    const onSaveWorkflowRef = useRef(onSaveWorkflow);
    onSaveWorkflowRef.current = onSaveWorkflow;
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

    const blockDecorationsRef = useRef<BlockDecorationManager | null>(null);

    const searchQueryRef = useRef(searchQuery);
    const kittyKeyboardStackRef = useRef<number[]>([]);
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
    searchQueryRef.current = searchQuery;

    const normalizeCompletionSuffix = useCallback((prefix: string, suffix: string): string => {
      if (!suffix) return suffix;
      // Avoid visual double-space at the completion boundary.
      if (/\s$/.test(prefix) && /^\s/.test(suffix)) {
        return suffix.slice(1);
      }
      return suffix;
    }, []);

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
          const str =
            typeof data === 'string'
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
          searchAddonRef.current.findNext(searchQueryRef.current, {
            decorations: SEARCH_DECORATIONS,
          });
        }
      },
      findPrevious: () => {
        if (searchQueryRef.current && searchAddonRef.current) {
          searchAddonRef.current.findPrevious(searchQueryRef.current, {
            decorations: SEARCH_DECORATIONS,
          });
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

    const handleSearchKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
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
      },
      [handleSearchNext, handleSearchPrev],
    );

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
      term.loadAddon(
        new WebLinksAddon((event, uri) => {
          if (event.metaKey) {
            onOpenUrlRef.current?.(uri);
          }
        }),
      );

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
          // Popup navigation owns Up/Down while suggestions are visible.
          if (
            suggestionsRef.current.length > 0 &&
            !event.metaKey &&
            !event.ctrlKey &&
            !event.altKey &&
            (event.key === 'ArrowUp' || event.key === 'ArrowDown')
          ) {
            return false;
          }

          // Accept ghost text completion with Right Arrow (like fish/zsh autosuggest).
          if (
            !event.metaKey &&
            !event.ctrlKey &&
            !event.altKey &&
            !event.shiftKey &&
            event.key === 'ArrowRight'
          ) {
            const ghost = ghostTextRef.current;
            if (ghost) {
              const { buffer, cursor } = autocompleteInputRef.current;
              const prefix = buffer.slice(0, cursor);
              autocompleteEngineRef.current?.recordAcceptedCommand?.(`${prefix}${ghost}`);
              onDataRef.current?.(ghost);
              previewAnchorPrefixRef.current = null;
              previewSuffixRef.current = '';
              setGhostText(null);
              setSuggestions([]);
              return false;
            }
          }

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

      // OSC 133: Shell integration — FinalTerm semantic prompt markers
      // Emitted by TermPod's shell integration scripts (zsh/bash/fish)
      // Sequence: A (prompt start) → B (prompt end) → C (output start) → D (command finished)
      const blockDecorations = new BlockDecorationManager(
        term,
        (cmd) => {
          onDataRef.current?.(cmd);
        },
        (cmd) => {
          onSaveWorkflowRef.current?.(cmd);
        },
      );
      blockDecorationsRef.current = blockDecorations;

      term.parser.registerOscHandler(133, (data) => {
        const semi = data.indexOf(';');
        const marker = semi === -1 ? data : data.slice(0, semi);

        if (marker !== 'A' && marker !== 'B' && marker !== 'C' && marker !== 'D') {
          return false;
        }

        const line = term.buffer.active.baseY + term.buffer.active.cursorY;
        const exitCode =
          marker === 'D' && semi !== -1 ? parseInt(data.slice(semi + 1), 10) : undefined;
        const cleanExitCode = exitCode !== undefined && !isNaN(exitCode) ? exitCode : undefined;

        blockDecorations.handleMarker(marker as 'A' | 'B' | 'C' | 'D', cleanExitCode);

        onBlockBoundaryRef.current?.({
          marker: marker as 'A' | 'B' | 'C' | 'D',
          line,
          exitCode: cleanExitCode,
        });

        return false;
      });

      // OSC 134: Autocomplete input capture from shell integration
      // Format: input;<base64_buffer>;<cursor_pos> or execute
      term.parser.registerOscHandler(134, (data) => {
        if (!autocompleteEnabled) return false;

        const parts = data.split(';');
        const type = parts[0];

        if (type === 'execute') {
          autocompleteEngineRef.current?.handleExecute();
          autocompleteInputRef.current = { buffer: '', cursor: 0 };
          previewAnchorPrefixRef.current = null;
          previewSuffixRef.current = '';
          setGhostText(null);
          setSuggestions([]);
        } else if (type === 'input' && parts.length >= 3) {
          try {
            const encodedBuffer = parts[1];
            const cursorPos = parseInt(parts[2], 10);
            const buffer = atob(encodedBuffer);

            // Ignore input events generated by our own inline preview updates,
            // so popup suggestions stay stable while navigating with arrows.
            const previewAnchor = previewAnchorPrefixRef.current;
            if (previewAnchor !== null) {
              // During inline preview mode, shell buffer changes are expected.
              // Keep popup list stable by skipping recomputation while the
              // buffer still reflects the same anchored prefix.
              const isPreviewModeInput =
                buffer.startsWith(previewAnchor) && cursorPos >= previewAnchor.length;
              if (isPreviewModeInput) {
                autocompleteInputRef.current = { buffer, cursor: cursorPos };
                return false;
              }

              // User edited input outside preview flow; exit preview mode.
              previewAnchorPrefixRef.current = null;
              previewSuffixRef.current = '';
            }

            autocompleteInputRef.current = { buffer, cursor: cursorPos };

            const prefix = buffer.slice(0, cursorPos);
            autocompleteEngineRef.current?.handleInput(buffer, cursorPos);

            // Update ghost text
            const ghostRaw = autocompleteEngineRef.current?.getGhostText() ?? null;
            const ghost = ghostRaw ? normalizeCompletionSuffix(prefix, ghostRaw) : null;
            setGhostText(ghost);

            // Update suggestions
            const sugs =
              (autocompleteEngineRef.current?.getSuggestions() ?? []).filter(
                (s) => s.text.toLowerCase() !== prefix.toLowerCase(),
              ) ?? [];
            setSuggestions(sugs);
            setSelectedSuggestion(0);

            // If suggestions disappear, clear preview tracking.
            if (sugs.length === 0) {
              previewAnchorPrefixRef.current = null;
              previewSuffixRef.current = '';
            }
          } catch {
            // Invalid base64, ignore
          }
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
        const count = typeof params[0] === 'number' && params[0] > 0 ? params[0] : 1;

        for (let i = 0; i < count && kittyKeyboardStack.length > 0; i++) {
          kittyKeyboardStack.pop();
        }

        return true;
      });

      // CSI ? u — query current keyboard mode, respond with CSI ? flags u
      term.parser.registerCsiHandler({ prefix: '?', final: 'u' }, () => {
        const flags =
          kittyKeyboardStack.length > 0 ? kittyKeyboardStack[kittyKeyboardStack.length - 1] : 0;
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
        blockDecorations.dispose();
        blockDecorationsRef.current = null;
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
    }, [
      cursorBlink,
      cursorStyle,
      lineHeight,
      macOptionIsMeta,
      altClickMoveCursor,
      wordSeparators,
      theme,
    ]);

    // Apply padding to xterm's root element so FitAddon natively accounts for it
    useEffect(() => {
      const el = containerRef.current?.querySelector<HTMLElement>('.xterm');
      const viewportEl = containerRef.current?.querySelector<HTMLElement>('.xterm-viewport');
      // Query the scrollbar element - xterm may create it after initial mount
      let scrollbarEl = containerRef.current?.querySelector<HTMLElement>(
        '.xterm-scrollable-element > .scrollbar',
      );

      if (el) {
        // Only apply padding to left/top/bottom, keep right flush for scrollbar
        el.style.paddingLeft = padding ? `${padding}px` : '';
        el.style.paddingTop = padding ? `${padding}px` : '';
        el.style.paddingBottom = padding ? `${padding}px` : '';
        el.style.paddingRight = '0';
        el.style.boxSizing = 'border-box';
      }

      // Control scrollbar visibility based on promptAtBottom and scrollbarVisibility settings
      // Try to find scrollbar with retries since xterm creates it dynamically
      const applyScrollbarVisibility = () => {
        // Find the vertical scrollbar specifically
        const verticalScrollbarEl = containerRef.current?.querySelector<HTMLElement>(
          '.xterm-scrollable-element > .scrollbar.vertical',
        );

        if (verticalScrollbarEl) {
          // Always hide when prompt-at-bottom is enabled (padding creates scrollable content)
          if (promptAtBottom) {
            verticalScrollbarEl.style.display = 'none';
            verticalScrollbarEl.classList.remove('scrollbar-overlay');
            verticalScrollbarEl.classList.remove('scrollbar-hidden');
          } else if (scrollbarVisibility === 'never') {
            verticalScrollbarEl.style.display = 'none';
            verticalScrollbarEl.classList.remove('scrollbar-overlay');
            verticalScrollbarEl.classList.add('scrollbar-hidden');
          } else if (scrollbarVisibility === 'always') {
            verticalScrollbarEl.style.display = '';
            verticalScrollbarEl.classList.remove('scrollbar-overlay');
            verticalScrollbarEl.classList.remove('scrollbar-hidden');
          } else if (scrollbarVisibility === 'when-scrolling') {
            verticalScrollbarEl.style.display = '';
            verticalScrollbarEl.classList.add('scrollbar-overlay');
            verticalScrollbarEl.classList.remove('scrollbar-hidden');
          }
        }
      };

      // Apply immediately
      applyScrollbarVisibility();

      // Retry after a delay since xterm creates the scrollbar dynamically
      const retryTimer = setTimeout(applyScrollbarVisibility, 500);

      // Apply background to viewport to fill padding area
      if (viewportEl && theme?.background) {
        viewportEl.style.backgroundColor = theme.background;
      }

      if (fitAddonRef.current && terminalRef.current && !sizeLockedRef.current) {
        try {
          fitAddonRef.current.fit();
          onResizeRef.current?.({ cols: terminalRef.current.cols, rows: terminalRef.current.rows });
        } catch {
          /* ignore */
        }
      }

      return () => clearTimeout(retryTimer);
    }, [padding, theme?.background, promptAtBottom, scrollbarVisibility]);

    // Re-apply prompt-at-bottom after padding changes (if enabled)
    useEffect(() => {
      if (promptAtBottom && terminalRef.current && !sizeLockedRef.current) {
        const term = terminalRef.current;
        // Only re-apply if we're at the top (buffer is empty or at start)
        const buffer = term.buffer.active;
        if (buffer.baseY === 0 && buffer.cursorY === 0 && term.rows > 1) {
          term.write('\n'.repeat(term.rows - 1));
        }
      }
    }, [padding, promptAtBottom]);

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

    // Sync autocomplete engine reference
    useEffect(() => {
      autocompleteEngineRef.current = autocompleteEngine ?? null;
    }, [autocompleteEngine]);

    // Handle accepting a suggestion
    const handleAcceptSuggestion = useCallback(
      (suggestion: Suggestion) => {
        previewAnchorPrefixRef.current = null;
        previewSuffixRef.current = '';

        const { buffer, cursor } = autocompleteInputRef.current;
        const prefix = buffer.slice(0, cursor);
        const textToInsert = suggestion.text.slice(prefix.length);

        autocompleteEngineRef.current?.recordAcceptedCommand?.(suggestion.text);

        if (textToInsert) {
          // Send only the missing suffix to the PTY.
          onData?.(textToInsert);
        }

        setGhostText(null);
        setSuggestions([]);
      },
      [onData],
    );

    // Revert any inline preview and close popup.
    const handleCloseSuggestions = useCallback(() => {
      previewAnchorPrefixRef.current = null;
      previewSuffixRef.current = '';
      setGhostText(null);
      setSuggestions([]);
    }, []);

    // While navigating popup suggestions, preview selected completion visually.
    // We intentionally avoid mutating shell buffer on every arrow change since
    // readline echo makes it look like slow typing.
    const handleSuggestionIndexChange = useCallback(
      (index: number) => {
        setSelectedSuggestion(index);

        const suggestion = suggestions[index];
        if (!suggestion) {
          setGhostText(null);
          return;
        }

        const { buffer, cursor } = autocompleteInputRef.current;
        const anchorPrefix = buffer.slice(0, cursor);
        const rawSuffix = suggestion.text.startsWith(anchorPrefix)
          ? suggestion.text.slice(anchorPrefix.length)
          : '';
        const desiredSuffix = normalizeCompletionSuffix(anchorPrefix, rawSuffix);
        setGhostText(desiredSuffix || null);
      },
      [normalizeCompletionSuffix, suggestions],
    );

    const hasSelection = contextMenu ? !!terminalRef.current?.getSelection() : false;

    return (
      <div
        style={{ width: '100%', height: '100%', position: 'relative' }}
        onContextMenu={handleContextMenu}
      >
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
            <button
              className="terminal-search-btn"
              onClick={handleSearchPrev}
              type="button"
              title="Previous (Shift+Enter)"
            >
              &#x25B2;
            </button>
            <button
              className="terminal-search-btn"
              onClick={handleSearchNext}
              type="button"
              title="Next (Enter)"
            >
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
            <button
              className="terminal-context-menu-item"
              onClick={handleCopy}
              disabled={!hasSelection}
            >
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
        {/* Autocomplete ghost text overlay */}
        {autocompleteEnabled && (
          <GhostText
            terminal={terminalRef.current}
            text={ghostText}
            foregroundColor={theme?.foreground || '#c0caf5'}
            opacity={suggestions.length > 0 ? 0.9 : 0.5}
          />
        )}

        {/* Autocomplete popup */}
        {autocompleteEnabled && (
          <AutocompletePopup
            terminal={terminalRef.current}
            suggestions={suggestions}
            selectedIndex={selectedSuggestion}
            onSelectedIndexChange={handleSuggestionIndexChange}
            onSelect={handleAcceptSuggestion}
            onClose={handleCloseSuggestions}
          />
        )}

        <div
          ref={containerRef}
          style={{
            position: 'absolute',
            inset: 0,
          }}
        />
      </div>
    );
  },
);

Terminal.displayName = 'Terminal';
