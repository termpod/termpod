import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSyncExternalStore } from 'react';
import type { TerminalTheme } from '../hooks/useSettings';
import { THEMES } from '../hooks/useSettings';
import { getCustomThemesSnapshot, subscribeCustomThemes } from '../lib/configStore';

interface ThemePickerProps {
  selected: string;
  onSelect: (key: string) => void;
  onClose: () => void;
}

const LIGHT_THEMES = new Set([
  'github-light',
  'catppuccin-latte',
  'solarized-light',
  'one-light',
  'rose-pine-dawn',
  'ayu-light',
  'night-owl-light',
  'everforest-light',
  'tokyo-night-light',
  'kanagawa-lotus',
  'gruvbox-light',
  'poimandres-light',
  'moonlight-light',
  'paper',
  'winter-light',
  'horizon-light',
  'vitesse-light',
  'termpod-light',
]);

interface ThemeEntry {
  key: string;
  theme: TerminalTheme;
}

function groupThemes(
  allThemes: Record<string, TerminalTheme>,
  filter: string,
): { dark: ThemeEntry[]; light: ThemeEntry[]; custom: ThemeEntry[] } {
  const q = filter.toLowerCase();
  const dark: ThemeEntry[] = [];
  const light: ThemeEntry[] = [];
  const custom: ThemeEntry[] = [];

  for (const [key, theme] of Object.entries(allThemes)) {
    if (q && !theme.name.toLowerCase().includes(q)) {
      continue;
    }

    const entry = { key, theme };

    if (key.startsWith('custom:')) {
      custom.push(entry);
    } else if (LIGHT_THEMES.has(key)) {
      light.push(entry);
    } else {
      dark.push(entry);
    }
  }

  return { dark, light, custom };
}

function flatList(groups: {
  dark: ThemeEntry[];
  light: ThemeEntry[];
  custom: ThemeEntry[];
}): ThemeEntry[] {
  return [...groups.dark, ...groups.light, ...groups.custom];
}

export function resolveTheme(
  key: string,
  customThemes: Record<string, TerminalTheme>,
): TerminalTheme {
  return THEMES[key] ?? customThemes[key] ?? THEMES['tokyo-night'];
}

export function ThemePicker({ selected, onSelect, onClose }: ThemePickerProps) {
  const [query, setQuery] = useState('');
  const [hoveredKey, setHoveredKey] = useState(selected);
  const [originalTheme] = useState(selected);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const customThemeMap = useSyncExternalStore(subscribeCustomThemes, getCustomThemesSnapshot);
  const allThemes = useMemo(() => ({ ...THEMES, ...customThemeMap }), [customThemeMap]);

  const groups = groupThemes(allThemes, query);
  const flat = flatList(groups);
  const previewTheme = allThemes[hoveredKey] ?? allThemes[selected] ?? THEMES['tokyo-night'];

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const scrollToItem = useCallback((key: string) => {
    const el = itemRefs.current.get(key);
    el?.scrollIntoView({ block: 'nearest' });
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (query) {
          setQuery('');
        } else {
          onSelect(originalTheme);
          onClose();
        }
        return;
      }

      if (e.key === 'Enter') {
        onSelect(hoveredKey);
        onClose();
        return;
      }

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const idx = flat.findIndex((t) => t.key === hoveredKey);
        let next: number;
        if (e.key === 'ArrowDown') {
          next = idx < flat.length - 1 ? idx + 1 : 0;
        } else {
          next = idx > 0 ? idx - 1 : flat.length - 1;
        }
        const nextKey = flat[next].key;
        setHoveredKey(nextKey);
        scrollToItem(nextKey);
      }
    },
    [flat, hoveredKey, onClose, onSelect, originalTheme, query, scrollToItem],
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="tp-container" onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        {/* Sidebar - theme list */}
        <div className="tp-sidebar">
          <div className="tp-search">
            <svg
              className="tp-search-icon"
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <circle cx="6" cy="6" r="4.5" />
              <path d="M9.5 9.5L13 13" />
            </svg>
            <input
              ref={searchRef}
              className="tp-search-input"
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                const g = groupThemes(allThemes, e.target.value);
                const f = flatList(g);
                if (f.length > 0 && !f.some((t) => t.key === hoveredKey)) {
                  setHoveredKey(f[0].key);
                }
              }}
              placeholder="Search themes..."
              spellCheck={false}
            />
          </div>

          <div className="tp-list" ref={listRef}>
            {groups.dark.length > 0 && (
              <>
                <div className="tp-group-label">Dark</div>
                {groups.dark.map((entry) => (
                  <ThemeListItem
                    key={entry.key}
                    entry={entry}
                    isSelected={selected === entry.key}
                    isHovered={hoveredKey === entry.key}
                    onHover={() => setHoveredKey(entry.key)}
                    onClick={() => {
                      onSelect(entry.key);
                      onClose();
                    }}
                    ref={(el) => {
                      if (el) {
                        itemRefs.current.set(entry.key, el);
                      } else {
                        itemRefs.current.delete(entry.key);
                      }
                    }}
                  />
                ))}
              </>
            )}
            {groups.light.length > 0 && (
              <>
                <div className="tp-group-label">Light</div>
                {groups.light.map((entry) => (
                  <ThemeListItem
                    key={entry.key}
                    entry={entry}
                    isSelected={selected === entry.key}
                    isHovered={hoveredKey === entry.key}
                    onHover={() => setHoveredKey(entry.key)}
                    onClick={() => {
                      onSelect(entry.key);
                      onClose();
                    }}
                    ref={(el) => {
                      if (el) {
                        itemRefs.current.set(entry.key, el);
                      } else {
                        itemRefs.current.delete(entry.key);
                      }
                    }}
                  />
                ))}
              </>
            )}
            {groups.custom.length > 0 && (
              <>
                <div className="tp-group-label">Custom</div>
                {groups.custom.map((entry) => (
                  <ThemeListItem
                    key={entry.key}
                    entry={entry}
                    isSelected={selected === entry.key}
                    isHovered={hoveredKey === entry.key}
                    onHover={() => setHoveredKey(entry.key)}
                    onClick={() => {
                      onSelect(entry.key);
                      onClose();
                    }}
                    ref={(el) => {
                      if (el) {
                        itemRefs.current.set(entry.key, el);
                      } else {
                        itemRefs.current.delete(entry.key);
                      }
                    }}
                  />
                ))}
              </>
            )}
            {flat.length === 0 && <div className="tp-empty">No matching themes</div>}
          </div>
        </div>

        {/* Preview */}
        <div className="tp-preview" style={{ background: previewTheme.background }}>
          <div className="tp-preview-header">
            <div className="tp-preview-dots">
              <span className="tp-dot" style={{ background: '#ff5f57' }} />
              <span className="tp-dot" style={{ background: '#febc2e' }} />
              <span className="tp-dot" style={{ background: '#28c840' }} />
            </div>
            <span className="tp-preview-title" style={{ color: previewTheme.foreground }}>
              {previewTheme.name}
            </span>
            <div className="tp-preview-dots" style={{ visibility: 'hidden' }}>
              <span className="tp-dot" />
              <span className="tp-dot" />
              <span className="tp-dot" />
            </div>
          </div>

          <div className="tp-preview-body" style={{ color: previewTheme.foreground }}>
            <PreviewLine>
              <span style={{ color: previewTheme.green }}>swapnil</span>
              <span style={{ color: previewTheme.foreground }}> in </span>
              <span style={{ color: previewTheme.cyan }}>~/projects/termpod</span>
              <span style={{ color: previewTheme.magenta }}> (main)</span>
            </PreviewLine>
            <PreviewLine>
              <span style={{ color: previewTheme.yellow }}>$</span>
              <span> git log --oneline -5</span>
            </PreviewLine>
            <PreviewLine>
              <span style={{ color: previewTheme.yellow }}>a1b2c3d</span>
              <span> Add theme picker with live preview</span>
            </PreviewLine>
            <PreviewLine>
              <span style={{ color: previewTheme.yellow }}>e4f5g6h</span>
              <span> Fix WebSocket reconnection logic</span>
            </PreviewLine>
            <PreviewLine>
              <span style={{ color: previewTheme.yellow }}>i7j8k9l</span>
              <span> Implement multi-tab sessions</span>
            </PreviewLine>
            <PreviewLine />
            <PreviewLine>
              <span style={{ color: previewTheme.yellow }}>$</span>
              <span> cat src/app.ts</span>
            </PreviewLine>
            <PreviewLine>
              <span style={{ color: previewTheme.magenta }}>import</span>
              <span> {'{ '}</span>
              <span style={{ color: previewTheme.red }}>createApp</span>
              <span>{' }'}</span>
              <span style={{ color: previewTheme.magenta }}> from</span>
              <span style={{ color: previewTheme.green }}> &apos;./core&apos;</span>
              <span>;</span>
            </PreviewLine>
            <PreviewLine>
              <span style={{ color: previewTheme.magenta }}>import</span>
              <span> {'{ '}</span>
              <span style={{ color: previewTheme.red }}>connectRelay</span>
              <span>{' }'}</span>
              <span style={{ color: previewTheme.magenta }}> from</span>
              <span style={{ color: previewTheme.green }}> &apos;./relay&apos;</span>
              <span>;</span>
            </PreviewLine>
            <PreviewLine />
            <PreviewLine>
              <span style={{ color: previewTheme.cyan }}>const</span>
              <span> app = </span>
              <span style={{ color: previewTheme.blue }}>createApp</span>
              <span>{'({'}</span>
            </PreviewLine>
            <PreviewLine>
              <span> port: </span>
              <span style={{ color: previewTheme.yellow }}>3000</span>
              <span>,</span>
            </PreviewLine>
            <PreviewLine>
              <span> debug: </span>
              <span style={{ color: previewTheme.red }}>true</span>
              <span>,</span>
            </PreviewLine>
            <PreviewLine>
              <span>{'});'}</span>
            </PreviewLine>
            <PreviewLine />
            <PreviewLine>
              <span style={{ color: previewTheme.brightBlack }}>// Connect to relay server</span>
            </PreviewLine>
            <PreviewLine>
              <span style={{ color: previewTheme.blue }}>connectRelay</span>
              <span>(app, </span>
              <span style={{ color: previewTheme.green }}>&apos;wss://relay.termpod.dev&apos;</span>
              <span>);</span>
            </PreviewLine>
            <PreviewLine />
            <PreviewLine>
              <span style={{ color: previewTheme.yellow }}>$</span>
              <span style={{ color: previewTheme.cursor }}> _</span>
            </PreviewLine>
          </div>

          {/* Color palette bar */}
          <div className="tp-preview-palette">
            {[
              previewTheme.black,
              previewTheme.red,
              previewTheme.green,
              previewTheme.yellow,
              previewTheme.blue,
              previewTheme.magenta,
              previewTheme.cyan,
              previewTheme.white,
              previewTheme.brightBlack,
              previewTheme.brightRed,
              previewTheme.brightGreen,
              previewTheme.brightYellow,
              previewTheme.brightBlue,
              previewTheme.brightMagenta,
              previewTheme.brightCyan,
              previewTheme.brightWhite,
            ].map((color, i) => (
              <span key={i} className="tp-palette-swatch" style={{ background: color }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewLine({ children }: { children?: React.ReactNode }) {
  return <div className="tp-preview-line">{children || '\u00A0'}</div>;
}

const ThemeListItem = forwardRef<
  HTMLButtonElement,
  {
    entry: ThemeEntry;
    isSelected: boolean;
    isHovered: boolean;
    onHover: () => void;
    onClick: () => void;
  }
>(({ entry, isSelected, isHovered, onHover, onClick }, ref) => {
  const { theme } = entry;
  const swatches = [theme.red, theme.green, theme.yellow, theme.blue, theme.magenta, theme.cyan];

  return (
    <button
      ref={ref}
      className={`tp-item ${isHovered ? 'tp-item-hovered' : ''} ${isSelected ? 'tp-item-selected' : ''}`}
      onMouseEnter={onHover}
      onClick={onClick}
    >
      <span
        className="tp-item-color"
        style={{ background: theme.background, borderColor: theme.brightBlack }}
      />
      <span className="tp-item-name">{theme.name}</span>
      <div className="tp-item-swatches">
        {swatches.map((c, i) => (
          <span key={i} className="tp-item-swatch" style={{ background: c }} />
        ))}
      </div>
      {isSelected && (
        <svg
          className="tp-item-check"
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 7.5l3 3 5-6" />
        </svg>
      )}
    </button>
  );
});
