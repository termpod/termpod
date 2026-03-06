import { useCallback, useEffect, useRef, useState } from 'react';
import type { Settings, CursorStyle, NewTabCwd } from '../hooks/useSettings';
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

const CURSOR_OPTIONS: { value: CursorStyle; label: string; icon: string }[] = [
  { value: 'block', label: 'Block', icon: '█' },
  { value: 'underline', label: 'Underline', icon: '▁' },
  { value: 'bar', label: 'Bar', icon: '▏' },
];

const TABS: { id: SettingsTab; label: string; icon: string }[] = [
  { id: 'appearance', label: 'Appearance', icon: '◑' },
  { id: 'terminal', label: 'Terminal', icon: '▸' },
  { id: 'behavior', label: 'Behavior', icon: '⚙' },
  { id: 'account', label: 'Account', icon: '⊙' },
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
              <span className="sp-tab-icon">{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
          <div className="sp-sidebar-spacer" />
          <button className="sp-tab sp-tab-reset" onClick={onReset}>
            <span className="sp-tab-icon">↺</span>
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
                <div className="sp-section">
                  <label className="sp-label">Theme</label>
                  <div className="sp-theme-grid">
                    {Object.entries(THEMES).map(([key, theme]) => (
                      <button
                        key={key}
                        className={`sp-theme-card ${settings.theme === key ? 'sp-theme-active' : ''}`}
                        onClick={() => onUpdate({ theme: key })}
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
                    ))}
                  </div>
                </div>

                {/* Cursor */}
                <div className="sp-section">
                  <label className="sp-label">Cursor Style</label>
                  <div className="sp-cursor-options">
                    {CURSOR_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        className={`sp-cursor-btn ${settings.cursorStyle === opt.value ? 'sp-cursor-active' : ''}`}
                        onClick={() => onUpdate({ cursorStyle: opt.value })}
                      >
                        <span className="sp-cursor-icon">{opt.icon}</span>
                        <span className="sp-cursor-label">{opt.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <ToggleRow
                  label="Cursor Blink"
                  value={settings.cursorBlink}
                  onChange={(v) => onUpdate({ cursorBlink: v })}
                />

                {/* Line Height */}
                <div className="sp-section">
                  <label className="sp-label">Line Height</label>
                  <div className="sp-slider-row">
                    <input
                      className="settings-range"
                      type="range"
                      min={0.8}
                      max={1.6}
                      step={0.05}
                      value={settings.lineHeight}
                      onChange={(e) => onUpdate({ lineHeight: Number(e.target.value) })}
                    />
                    <span className="sp-value">{settings.lineHeight.toFixed(2)}</span>
                  </div>
                </div>
              </>
            )}

            {activeTab === 'terminal' && (
              <>
                {/* Font section card */}
                <div className="sp-card">
                  <div className="sp-card-header">
                    <span className="sp-card-icon">Aa</span>
                    <span className="sp-card-title">Font</span>
                  </div>

                  <FontPicker
                    value={settings.fontFamily}
                    options={FONT_OPTIONS}
                    onChange={(v) => onUpdate({ fontFamily: v })}
                  />

                  <div className="sp-section">
                    <div className="sp-label-row">
                      <label className="sp-label">Size</label>
                      <span className="sp-badge">{settings.fontSize}px</span>
                    </div>
                    <input
                      className="settings-range"
                      type="range"
                      min={10}
                      max={24}
                      value={settings.fontSize}
                      onChange={(e) => onUpdate({ fontSize: Number(e.target.value) })}
                    />
                  </div>

                  {/* Live font preview */}
                  <div
                    className="sp-font-preview"
                    style={{
                      fontFamily: settings.fontFamily,
                      fontSize: `${settings.fontSize}px`,
                      lineHeight: settings.lineHeight,
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
                </div>

                {/* Shell section card */}
                <div className="sp-card">
                  <div className="sp-card-header">
                    <span className="sp-card-icon">&gt;_</span>
                    <span className="sp-card-title">Shell</span>
                  </div>

                  <div className="sp-section">
                    <label className="sp-label">Path</label>
                    <input
                      className={`settings-input sp-full-width ${shellValid === false ? 'settings-input-error' : ''}`}
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
                      <span className="settings-hint-error">Path must start with /</span>
                    )}
                  </div>

                  <div className="sp-section">
                    <div className="sp-label-row">
                      <label className="sp-label">Scrollback Lines</label>
                      <span className="sp-badge">{settings.scrollbackLines.toLocaleString()}</span>
                    </div>
                    <input
                      className="settings-range"
                      type="range"
                      min={1000}
                      max={50000}
                      step={1000}
                      value={settings.scrollbackLines}
                      onChange={(e) => onUpdate({ scrollbackLines: Number(e.target.value) })}
                    />
                  </div>

                  <ToggleRow
                    label="Bell Sound"
                    value={settings.bellEnabled}
                    onChange={(v) => onUpdate({ bellEnabled: v })}
                  />
                </div>
              </>
            )}

            {activeTab === 'behavior' && (
              <>
                {/* New Tab Working Directory */}
                <div className="sp-section">
                  <label className="sp-label">New Tab Working Directory</label>
                  <div className="sp-radio-group">
                    <RadioOption
                      name="newTabCwd"
                      value="home"
                      label="Home directory"
                      description="Always open in ~"
                      checked={settings.newTabCwd === 'home'}
                      onChange={() => onUpdate({ newTabCwd: 'home' as NewTabCwd })}
                    />
                    <RadioOption
                      name="newTabCwd"
                      value="current"
                      label="Current directory"
                      description="Inherit from active tab"
                      checked={settings.newTabCwd === 'current'}
                      onChange={() => onUpdate({ newTabCwd: 'current' as NewTabCwd })}
                    />
                  </div>
                </div>

                <ToggleRow
                  label="Close Window on Last Tab"
                  description="Close the app when the last tab is closed"
                  value={settings.closeWindowOnLastTab}
                  onChange={(v) => onUpdate({ closeWindowOnLastTab: v })}
                />

                {/* Keyboard Shortcuts link */}
                {onOpenKeybindings && (
                  <div className="sp-section">
                    <button
                      className="sp-link-btn"
                      onClick={() => {
                        onClose();
                        onOpenKeybindings();
                      }}
                    >
                      <span>Keyboard Shortcuts</span>
                      <span className="sp-link-arrow">→</span>
                    </button>
                  </div>
                )}
              </>
            )}

            {activeTab === 'account' && (
              <>
                <div className="sp-section">
                  <label className="sp-label">Signed In As</label>
                  <div className="sp-account-email">{email || 'Not signed in'}</div>
                </div>

                {onLogout && (
                  <div className="sp-section">
                    <button className="sp-danger-btn" onClick={onLogout}>
                      Sign Out
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Sub-components ---

function ToggleRow({ label, description, value, onChange }: {
  label: string;
  description?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="sp-section sp-toggle-row">
      <div className="sp-toggle-info">
        <span className="sp-label">{label}</span>
        {description && <span className="sp-description">{description}</span>}
      </div>
      <button
        className={`sp-toggle ${value ? 'sp-toggle-on' : ''}`}
        onClick={() => onChange(!value)}
        role="switch"
        aria-checked={value}
      >
        <span className="sp-toggle-thumb" />
      </button>
    </div>
  );
}

function RadioOption({ name, value, label, description, checked, onChange }: {
  name: string;
  value: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className={`sp-radio-option ${checked ? 'sp-radio-active' : ''}`}>
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        className="sp-radio-input"
      />
      <div className="sp-radio-dot" />
      <div className="sp-radio-content">
        <span className="sp-radio-label">{label}</span>
        <span className="sp-radio-desc">{description}</span>
      </div>
    </label>
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

  // Close on outside click
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

  // Focus input when opened
  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      setHighlightIdx(-1);
    }
  }, [open]);

  // Scroll highlighted item into view
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
        className="sp-font-picker-trigger"
        onClick={() => setOpen(!open)}
        style={{ fontFamily: value }}
        type="button"
      >
        <span className="sp-font-picker-value">{displayName(value)}</span>
        <span className="sp-font-picker-chevron">{open ? '\u25B4' : '\u25BE'}</span>
      </button>

      {open && (
        <div className="sp-font-picker-dropdown">
          <div className="sp-font-picker-search">
            <span className="sp-font-picker-search-icon">&#x1F50D;</span>
            <input
              ref={inputRef}
              className="sp-font-picker-input"
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

          <div className="sp-font-picker-list" ref={listRef}>
            {filtered.length === 0 ? (
              <div className="sp-font-picker-empty">No matching fonts</div>
            ) : (
              filtered.map((font, i) => (
                <button
                  key={font}
                  className={`sp-font-picker-item ${font === value ? 'sp-font-picker-selected' : ''} ${i === highlightIdx ? 'sp-font-picker-highlighted' : ''}`}
                  onClick={() => {
                    onChange(font);
                    setOpen(false);
                    setQuery('');
                  }}
                  style={{ fontFamily: font }}
                  type="button"
                >
                  <span className="sp-font-picker-item-name">{displayName(font)}</span>
                  <span className="sp-font-picker-item-sample" style={{ fontFamily: font }}>
                    AaBb 0Oo {'{}'}
                  </span>
                  {font === value && <span className="sp-font-picker-check">&#x2713;</span>}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
