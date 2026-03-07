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
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect x="2" y="2" width="14" height="14" rx="3" fill="url(#appearance-grad)" />
      <path d="M9 3v12" stroke="rgba(255,255,255,0.9)" strokeWidth="1.2" />
      <path d="M9 3a6 6 0 0 1 0 12" fill="rgba(255,255,255,0.25)" />
      <defs><linearGradient id="appearance-grad" x1="2" y1="2" x2="16" y2="16"><stop stopColor="#5AC8FA" /><stop offset="1" stopColor="#007AFF" /></linearGradient></defs>
    </svg>
  ),
  terminal: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect x="2" y="3" width="14" height="12" rx="2.5" fill="url(#terminal-grad)" />
      <path d="M5.5 7.5l2.5 1.75L5.5 11" stroke="#fff" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.5 11h3" stroke="#fff" strokeWidth="1.3" strokeLinecap="round" />
      <defs><linearGradient id="terminal-grad" x1="2" y1="3" x2="16" y2="15"><stop stopColor="#34C759" /><stop offset="1" stopColor="#248A3D" /></linearGradient></defs>
    </svg>
  ),
  behavior: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect x="2" y="2" width="14" height="14" rx="3" fill="url(#behavior-grad)" />
      <circle cx="9" cy="9" r="2.5" stroke="#fff" strokeWidth="1.3" />
      <path d="M9 4v1.5M9 12.5V14M4 9h1.5M12.5 9H14M5.46 5.46l1.06 1.06M11.48 11.48l1.06 1.06M5.46 12.54l1.06-1.06M11.48 6.52l1.06-1.06" stroke="#fff" strokeWidth="1" strokeLinecap="round" />
      <defs><linearGradient id="behavior-grad" x1="2" y1="2" x2="16" y2="16"><stop stopColor="#8E8E93" /><stop offset="1" stopColor="#636366" /></linearGradient></defs>
    </svg>
  ),
  account: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect x="2" y="2" width="14" height="14" rx="3" fill="url(#account-grad)" />
      <circle cx="9" cy="7" r="2.5" stroke="#fff" strokeWidth="1.2" />
      <path d="M4.5 15c0-2.5 2-4.5 4.5-4.5s4.5 2 4.5 4.5" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" />
      <defs><linearGradient id="account-grad" x1="2" y1="2" x2="16" y2="16"><stop stopColor="#5856D6" /><stop offset="1" stopColor="#AF52DE" /></linearGradient></defs>
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
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <rect x="2" y="2" width="14" height="14" rx="3" fill="url(#reset-grad)" />
                <path d="M5.5 5.5v2.5H8" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M5.5 8A3.75 3.75 0 1 1 6.2 11" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" />
                <defs><linearGradient id="reset-grad" x1="2" y1="2" x2="16" y2="16"><stop stopColor="#FF9500" /><stop offset="1" stopColor="#FF3B30" /></linearGradient></defs>
              </svg>
            </span>
            <span>Reset All</span>
          </button>
        </nav>

        {/* Content */}
        <div className="sp-content">
          <div className="sp-content-header">
            <h2 className="sp-content-title">{TABS.find((t) => t.id === activeTab)?.label}</h2>
            <button className="sp-close-btn" onClick={onClose} aria-label="Close">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M2 2l8 8M10 2l-8 8" />
              </svg>
            </button>
          </div>

          <div className="sp-content-body">
            {activeTab === 'appearance' && (
              <>
                <ThemeSection
                  themes={THEMES}
                  selected={settings.theme}
                  onSelect={(key) => onUpdate({ theme: key })}
                />

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

                <div className="sp-group-label">Window</div>
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
                  <SettingRow label="Padding" badge={`${settings.windowPadding}px`}>
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
                  <SettingRow label="Opacity" badge={`${Math.round(settings.backgroundOpacity * 100)}%`}>
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
                  <SettingRow label="Blur Radius" badge={`${settings.blurRadius}`}>
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
                  <SettingRow label="Ligatures">
                    <NativeToggle
                      value={settings.fontLigatures}
                      onChange={(v) => onUpdate({ fontLigatures: v })}
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
                        <svg className="sp-nav-row-chevron" width="7" height="12" viewBox="0 0 7 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M1 1l5 5-5 5" />
                        </svg>
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
        <svg className="sp-font-trigger-chevron" width="8" height="5" viewBox="0 0 8 5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d={open ? 'M1 4l3-3 3 3' : 'M1 1l3 3 3-3'} />
        </svg>
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
                  {font === value && (
                    <svg className="sp-font-check" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 7.5l3 3 5-6" />
                    </svg>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
