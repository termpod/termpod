import { useCallback, useEffect, useRef, useState } from 'react';
import type { Settings, CursorStyle, NewTabCwd, TerminalTheme, FontSmoothing, FontWeight } from '../hooks/useSettings';
import { THEMES } from '../hooks/useSettings';

type SettingsTab = 'appearance' | 'terminal' | 'behavior' | 'account';

interface SettingsPanelProps {
  settings: Settings;
  defaults: Settings;
  onUpdate: (patch: Partial<Settings>) => void;
  onReset: () => void;
  onClose: () => void;
  onOpenKeybindings?: () => void;
  email?: string | null;
  onLogout?: () => void;
}

const FONT_OPTIONS = [
  'Menlo, monospace',
  'Monaco, monospace',
  'SF Mono, monospace',
  'Fira Code, monospace',
  'JetBrains Mono, monospace',
  'Source Code Pro, monospace',
  'Cascadia Code, monospace',
  'IBM Plex Mono, monospace',
  'Hack, monospace',
  'Inconsolata, monospace',
];

const CURSOR_OPTIONS: { value: CursorStyle; label: string }[] = [
  { value: 'block', label: 'Block' },
  { value: 'underline', label: 'Line' },
  { value: 'bar', label: 'Bar' },
];

const FONT_WEIGHT_OPTIONS: { value: FontWeight; label: string }[] = [
  { value: '300', label: 'Light' },
  { value: 'normal', label: 'Regular' },
  { value: '500', label: 'Medium' },
  { value: '700', label: 'Bold' },
];

const FONT_SMOOTHING_OPTIONS: { value: FontSmoothing; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'antialiased', label: 'Antialiased' },
  { value: 'none', label: 'None' },
];

const TAB_ICONS: Record<SettingsTab, React.ReactNode> = {
  appearance: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 1.75v12.5" />
      <path d="M8 1.75a6.25 6.25 0 0 0 0 12.5" fill="currentColor" />
    </svg>
  ),
  terminal: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" />
      <path d="M5 6.5l2.5 2L5 10.5" />
      <path d="M9 10.5h2" />
    </svg>
  ),
  behavior: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6.86 2.57a1.25 1.25 0 0 1 2.28 0l.58 1.3a1.25 1.25 0 0 0 .94.68l1.42.21c1.04.15 1.46 1.44.7 2.18l-1.03 1a1.25 1.25 0 0 0-.36 1.1l.24 1.42c.18 1.04-.91 1.83-1.84 1.34l-1.27-.67a1.25 1.25 0 0 0-1.16 0l-1.27.67c-.93.49-2.02-.3-1.84-1.34l.24-1.42a1.25 1.25 0 0 0-.36-1.1l-1.03-1c-.76-.74-.34-2.03.7-2.18l1.42-.2a1.25 1.25 0 0 0 .94-.69l.58-1.3z" />
    </svg>
  ),
  account: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="5.5" r="2.75" />
      <path d="M2.75 14.25c0-2.9 2.35-5.25 5.25-5.25s5.25 2.35 5.25 5.25" />
    </svg>
  ),
};

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'behavior', label: 'Behavior' },
  { id: 'account', label: 'Account' },
];

export function SettingsPanel({ settings, defaults, onUpdate, onReset, onClose, onOpenKeybindings, email, onLogout }: SettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('appearance');
  const [shellInput, setShellInput] = useState(settings.shellPath);
  const [shellValid, setShellValid] = useState<boolean | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  }, [onClose]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    modalRef.current?.focus();
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const validateShell = (path: string) => {
    const trimmed = path.trim();
    if (!trimmed || !trimmed.startsWith('/')) {
      setShellValid(false);
      if (!trimmed) setShellInput(settings.shellPath);
      return;
    }
    setShellValid(true);
    onUpdate({ shellPath: trimmed });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={modalRef}
        className="modal-panel sp-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Settings"
        tabIndex={-1}
      >
        {/* Sidebar */}
        <nav className="sp-sidebar">
          <div className="sp-sidebar-title">Settings</div>
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={`sp-tab ${activeTab === tab.id ? 'sp-tab-active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <span className="sp-tab-icon">{TAB_ICONS[tab.id]}</span>
              <span>{tab.label}</span>
            </button>
          ))}
          <div className="sp-sidebar-spacer" />
          <button className="sp-tab sp-tab-reset" onClick={onReset}>
            <span className="sp-tab-icon">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2.75 3v3.5h3.5" />
                <path d="M2.75 6.5A5.25 5.25 0 1 1 3.6 10" />
              </svg>
            </span>
            <span>Reset All</span>
          </button>
        </nav>

        {/* Content */}
        <div className="sp-content">
          <div className="sp-content-header">
            <h2 className="sp-content-title">{TABS.find((t) => t.id === activeTab)?.label}</h2>
            <button className="modal-close" onClick={onClose} aria-label="Close">&times;</button>
          </div>

          <div className="sp-content-body">
            {activeTab === 'appearance' && (
              <>
                {/* Theme */}
                <ThemeSection
                  themes={THEMES}
                  selected={settings.theme}
                  onSelect={(key) => onUpdate({ theme: key })}
                />

                {/* Cursor */}
                <div className="sp-group-label">Cursor</div>
                <div className="sp-group">
                  <SettingRow label="Style">
                    <SegmentedControl
                      options={CURSOR_OPTIONS}
                      value={settings.cursorStyle}
                      onChange={(v) => onUpdate({ cursorStyle: v })}
                    />
                  </SettingRow>
                  <div className="sp-separator" />
                  <SettingRow label="Blink">
                    <NativeToggle
                      value={settings.cursorBlink}
                      onChange={(v) => onUpdate({ cursorBlink: v })}
                    />
                  </SettingRow>
                </div>

                {/* Display */}
                <div className="sp-group-label">Display</div>
                <div className="sp-group">
                  <SettingRow label="Line Height" badge={settings.lineHeight.toFixed(2)}>
                    <input
                      className="sp-range"
                      type="range"
                      min={0.8}
                      max={1.6}
                      step={0.05}
                      value={settings.lineHeight}
                      onChange={(e) => onUpdate({ lineHeight: Number(e.target.value) })}
                    />
                  </SettingRow>
                  <div className="sp-separator" />
                  <SettingRow label="Window Padding" badge={`${settings.windowPadding}px`}>
                    <input
                      className="sp-range"
                      type="range"
                      min={0}
                      max={32}
                      step={2}
                      value={settings.windowPadding}
                      onChange={(e) => onUpdate({ windowPadding: Number(e.target.value) })}
                    />
                  </SettingRow>
                  <div className="sp-separator" />
                  <SettingRow label="Window Opacity" badge={`${Math.round(settings.backgroundOpacity * 100)}`}>
                    <input
                      className="sp-range"
                      type="range"
                      min={30}
                      max={100}
                      step={1}
                      value={Math.round(settings.backgroundOpacity * 100)}
                      onChange={(e) => onUpdate({ backgroundOpacity: Number(e.target.value) / 100 })}
                    />
                  </SettingRow>
                  <div className="sp-separator" />
                  <SettingRow label="Window Blur Radius" badge={`${settings.blurRadius}`}>
                    <input
                      className="sp-range"
                      type="range"
                      min={0}
                      max={20}
                      step={1}
                      value={settings.blurRadius}
                      onChange={(e) => onUpdate({ blurRadius: Number(e.target.value) })}
                    />
                  </SettingRow>
                </div>
              </>
            )}

            {activeTab === 'terminal' && (
              <>
                {/* Font */}
                <div className="sp-group-label">Font</div>
                <div className="sp-group">
                  <SettingRow label="Family">
                    <FontPicker
                      value={settings.fontFamily}
                      options={FONT_OPTIONS}
                      onChange={(v) => onUpdate({ fontFamily: v })}
                    />
                  </SettingRow>
                  <div className="sp-separator" />
                  <SettingRow label="Size" badge={`${settings.fontSize}px`}>
                    <input
                      className="sp-range"
                      type="range"
                      min={10}
                      max={24}
                      value={settings.fontSize}
                      onChange={(e) => onUpdate({ fontSize: Number(e.target.value) })}
                    />
                  </SettingRow>
                  <div className="sp-separator" />
                  <SettingRow label="Weight">
                    <SegmentedControl
                      options={FONT_WEIGHT_OPTIONS}
                      value={settings.fontWeight}
                      onChange={(v) => onUpdate({ fontWeight: v })}
                    />
                  </SettingRow>
                  <div className="sp-separator" />
                  <SettingRow label="Smoothing">
                    <SegmentedControl
                      options={FONT_SMOOTHING_OPTIONS}
                      value={settings.fontSmoothing}
                      onChange={(v) => onUpdate({ fontSmoothing: v })}
                    />
                  </SettingRow>
                  <div className="sp-separator" />
                  <SettingRow label="Draw Bold in Bold Font">
                    <NativeToggle
                      value={settings.drawBoldInBold}
                      onChange={(v) => onUpdate({ drawBoldInBold: v })}
                    />
                  </SettingRow>
                </div>

                {/* Font preview */}
                <div
                  className="sp-font-preview"
                  style={{
                    fontFamily: settings.fontFamily,
                    fontSize: `${settings.fontSize}px`,
                    fontWeight: settings.fontWeight === 'normal' ? 400 : Number(settings.fontWeight),
                    lineHeight: settings.lineHeight,
                    WebkitFontSmoothing: settings.fontSmoothing === 'antialiased' ? 'antialiased' : settings.fontSmoothing === 'none' ? 'none' : 'auto',
                    background: THEMES[settings.theme]?.background ?? '#1a1b26',
                    color: THEMES[settings.theme]?.foreground ?? '#c0caf5',
                  }}
                >
                  <div>
                    <span style={{ color: THEMES[settings.theme]?.green }}>~/termpod</span>
                    <span style={{ color: THEMES[settings.theme]?.foreground }}> $ echo &quot;Hello, world!&quot;</span>
                  </div>
                  <div style={{ color: THEMES[settings.theme]?.foreground }}>Hello, world!</div>
                </div>

                {/* Shell */}
                <div className="sp-group-label">Shell</div>
                <div className="sp-group">
                  <SettingRow label="Path">
                    <div className="sp-input-wrap">
                      <input
                        className={`sp-input ${shellValid === false ? 'sp-input-error' : ''}`}
                        type="text"
                        value={shellInput}
                        onChange={(e) => {
                          setShellInput(e.target.value);
                          setShellValid(null);
                        }}
                        onBlur={() => validateShell(shellInput)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        }}
                        spellCheck={false}
                        placeholder="/bin/zsh"
                      />
                      {shellValid === false && (
                        <span className="sp-input-hint">Must start with /</span>
                      )}
                    </div>
                  </SettingRow>
                  <div className="sp-separator" />
                  <SettingRow label="Scrollback" badge={settings.scrollbackLines.toLocaleString()}>
                    <input
                      className="sp-range"
                      type="range"
                      min={1000}
                      max={50000}
                      step={1000}
                      value={settings.scrollbackLines}
                      onChange={(e) => onUpdate({ scrollbackLines: Number(e.target.value) })}
                    />
                  </SettingRow>
                  <div className="sp-separator" />
                  <SettingRow label="Bell Sound">
                    <NativeToggle
                      value={settings.bellEnabled}
                      onChange={(v) => onUpdate({ bellEnabled: v })}
                    />
                  </SettingRow>
                </div>
              </>
            )}

            {activeTab === 'behavior' && (
              <>
                <div className="sp-group-label">Tabs</div>
                <div className="sp-group">
                  <SettingRow label="New Tab Directory">
                    <SegmentedControl
                      options={[
                        { value: 'home' as NewTabCwd, label: 'Home' },
                        { value: 'current' as NewTabCwd, label: 'Current' },
                        { value: 'custom' as NewTabCwd, label: 'Custom' },
                      ]}
                      value={settings.newTabCwd}
                      onChange={(v) => onUpdate({ newTabCwd: v })}
                    />
                  </SettingRow>
                  {settings.newTabCwd === 'custom' && (
                    <>
                      <div className="sp-separator" />
                      <SettingRow label="Custom Path">
                        <input
                          className="sp-input"
                          type="text"
                          value={settings.customTabCwdPath}
                          onChange={(e) => onUpdate({ customTabCwdPath: e.target.value })}
                          placeholder="/path/to/directory"
                          spellCheck={false}
                        />
                      </SettingRow>
                    </>
                  )}
                  <div className="sp-separator" />
                  <SettingRow label="Close Window on Last Tab">
                    <NativeToggle
                      value={settings.closeWindowOnLastTab}
                      onChange={(v) => onUpdate({ closeWindowOnLastTab: v })}
                    />
                  </SettingRow>
                  <div className="sp-separator" />
                  <SettingRow label="Pin Prompt to Bottom">
                    <NativeToggle
                      value={settings.promptAtBottom}
                      onChange={(v) => onUpdate({ promptAtBottom: v })}
                    />
                  </SettingRow>
                </div>

                {onOpenKeybindings && (
                  <>
                    <div className="sp-group-label">Keyboard</div>
                    <div className="sp-group">
                      <button
                        className="sp-nav-row"
                        onClick={() => {
                          onClose();
                          onOpenKeybindings();
                        }}
                      >
                        <span className="sp-nav-row-label">Keyboard Shortcuts</span>
                        <span className="sp-nav-row-chevron">&#x203A;</span>
                      </button>
                    </div>
                  </>
                )}
              </>
            )}

            {activeTab === 'account' && (
              <>
                <div className="sp-group-label">Account</div>
                <div className="sp-group">
                  <SettingRow label="Signed In As">
                    <span className="sp-account-value">{email || 'Not signed in'}</span>
                  </SettingRow>
                  {onLogout && (
                    <>
                      <div className="sp-separator" />
                      <div className="sp-row sp-row-center">
                        <button className="sp-danger-btn" onClick={onLogout}>
                          Sign Out
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Sub-components ---

function SettingRow({ label, badge, children }: {
  label: string;
  badge?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="sp-row">
      <div className="sp-row-label">
        <span>{label}</span>
        {badge && <span className="sp-row-badge">{badge}</span>}
      </div>
      <div className="sp-row-control">{children}</div>
    </div>
  );
}

function NativeToggle({ value, onChange }: {
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      className={`sp-toggle ${value ? 'sp-toggle-on' : ''}`}
      onClick={() => onChange(!value)}
      role="switch"
      aria-checked={value}
    >
      <span className="sp-toggle-thumb" />
    </button>
  );
}

function SegmentedControl<T extends string>({ options, value, onChange }: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="sp-segmented">
      {options.map((opt) => (
        <button
          key={opt.value}
          className={`sp-segmented-item ${value === opt.value ? 'sp-segmented-active' : ''}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

const LIGHT_THEMES = new Set(['github-light', 'catppuccin-latte', 'solarized-light', 'one-light', 'rose-pine-dawn']);

function isLightTheme(key: string): boolean {
  return LIGHT_THEMES.has(key);
}

function ThemeCard({ themeKey, theme, selected, onSelect }: {
  themeKey: string;
  theme: TerminalTheme;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className={`sp-theme-card ${selected ? 'sp-theme-active' : ''}`}
      onClick={onSelect}
      title={theme.name}
    >
      <div
        className="sp-theme-preview"
        style={{ background: theme.background }}
      >
        <span style={{ color: theme.green }}>$</span>
        <span style={{ color: theme.foreground }}> echo </span>
        <span style={{ color: theme.yellow }}>hello</span>
      </div>
      <span className="sp-theme-name">{theme.name}</span>
    </button>
  );
}

function ThemeSection({ themes, selected, onSelect }: {
  themes: Record<string, TerminalTheme>;
  selected: string;
  onSelect: (key: string) => void;
}) {
  const dark = Object.entries(themes).filter(([k]) => !isLightTheme(k));
  const light = Object.entries(themes).filter(([k]) => isLightTheme(k));

  return (
    <>
      <div className="sp-group-label">Dark Themes</div>
      <div className="sp-theme-grid">
        {dark.map(([key, theme]) => (
          <ThemeCard key={key} themeKey={key} theme={theme} selected={selected === key} onSelect={() => onSelect(key)} />
        ))}
      </div>
      <div className="sp-group-label">Light Themes</div>
      <div className="sp-theme-grid">
        {light.map(([key, theme]) => (
          <ThemeCard key={key} themeKey={key} theme={theme} selected={selected === key} onSelect={() => onSelect(key)} />
        ))}
      </div>
    </>
  );
}

function FontPicker({ value, options, onChange }: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const displayName = (font: string) => font.split(',')[0].trim();

  const filtered = options.filter((f) =>
    displayName(f).toLowerCase().includes(query.toLowerCase()),
  );

  useEffect(() => {
    if (!open) return;

    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };

    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      setHighlightIdx(-1);
    }
  }, [open]);

  useEffect(() => {
    if (highlightIdx < 0 || !listRef.current) return;
    const items = listRef.current.children;
    items[highlightIdx]?.scrollIntoView({ block: 'nearest' });
  }, [highlightIdx]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightIdx((i) => Math.min(i + 1, filtered.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightIdx((i) => Math.max(i - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (highlightIdx >= 0 && filtered[highlightIdx]) {
          onChange(filtered[highlightIdx]);
          setOpen(false);
          setQuery('');
        }
        break;
      case 'Escape':
        setOpen(false);
        setQuery('');
        break;
    }
  };

  return (
    <div className="sp-font-picker" ref={containerRef}>
      <button
        className="sp-font-trigger"
        onClick={() => setOpen(!open)}
        style={{ fontFamily: value }}
        type="button"
      >
        <span className="sp-font-trigger-name">{displayName(value)}</span>
        <span className="sp-font-trigger-chevron">{open ? '\u25B4' : '\u25BE'}</span>
      </button>

      {open && (
        <div className="sp-font-dropdown">
          <div className="sp-font-search">
            <input
              ref={inputRef}
              className="sp-font-search-input"
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setHighlightIdx(0);
              }}
              onKeyDown={handleKeyDown}
              placeholder="Search fonts..."
              spellCheck={false}
            />
          </div>

          <div className="sp-font-list" ref={listRef}>
            {filtered.length === 0 ? (
              <div className="sp-font-empty">No matching fonts</div>
            ) : (
              filtered.map((font, i) => (
                <button
                  key={font}
                  className={`sp-font-item ${font === value ? 'sp-font-selected' : ''} ${i === highlightIdx ? 'sp-font-highlighted' : ''}`}
                  onClick={() => {
                    onChange(font);
                    setOpen(false);
                    setQuery('');
                  }}
                  style={{ fontFamily: font }}
                  type="button"
                >
                  <span className="sp-font-item-name">{displayName(font)}</span>
                  <span className="sp-font-item-sample" style={{ fontFamily: font }}>
                    AaBb 0Oo {'{}'}
                  </span>
                  {font === value && <span className="sp-font-check">&#x2713;</span>}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
