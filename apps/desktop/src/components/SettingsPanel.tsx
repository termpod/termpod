import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type {
  Settings,
  CursorStyle,
  NewTabCwd,
  FontSmoothing,
  FontWeight,
  ScrollbarVisibility,
  DefaultEditor,
} from '../hooks/useSettings';
import { THEMES } from '../hooks/useSettings';
import { ThemePicker, resolveTheme } from './ThemePicker';
import { getCustomThemesSnapshot, subscribeCustomThemes } from '../lib/configStore';
import { resolveRelayUrl } from '../hooks/useAuth';
import type { TerminalProfile } from '../hooks/useProfiles';

type SettingsTab = 'appearance' | 'terminal' | 'behavior' | 'account';

interface SubscriptionInfo {
  isPro: boolean;
  isOnTrial: boolean;
  trialDaysLeft: number;
  selfHosted: boolean;
  cancelAtPeriodEnd?: boolean;
}

interface SettingsPanelProps {
  settings: Settings;
  defaults: Settings;
  onUpdate: (patch: Partial<Settings>) => void;
  onReset: () => void;
  onClose: () => void;
  onOpenKeybindings?: () => void;
  email?: string | null;
  onLogout?: () => void;
  subscription?: SubscriptionInfo | null;
  profiles?: TerminalProfile[];
  defaultProfileId?: string | null;
  onAddProfile?: (profile: Omit<TerminalProfile, 'id'>) => void;
  onUpdateProfile?: (id: string, patch: Partial<Omit<TerminalProfile, 'id'>>) => void;
  onRemoveProfile?: (id: string) => void;
  onSetDefaultProfile?: (id: string | null) => void;
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

const SCROLLBAR_VISIBILITY_OPTIONS: { value: ScrollbarVisibility; label: string }[] = [
  { value: 'always', label: 'Always' },
  { value: 'when-scrolling', label: 'When Scrolling' },
  { value: 'never', label: 'Never' },
];

const TAB_ICONS: Record<SettingsTab, React.ReactNode> = {
  appearance: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect x="2" y="2" width="14" height="14" rx="3" fill="url(#appearance-grad)" />
      <path d="M9 3v12" stroke="rgba(255,255,255,0.9)" strokeWidth="1.2" />
      <path d="M9 3a6 6 0 0 1 0 12" fill="rgba(255,255,255,0.25)" />
      <defs>
        <linearGradient id="appearance-grad" x1="2" y1="2" x2="16" y2="16">
          <stop stopColor="#5AC8FA" />
          <stop offset="1" stopColor="#007AFF" />
        </linearGradient>
      </defs>
    </svg>
  ),
  terminal: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect x="2" y="3" width="14" height="12" rx="2.5" fill="url(#terminal-grad)" />
      <path
        d="M5.5 7.5l2.5 1.75L5.5 11"
        stroke="#fff"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M9.5 11h3" stroke="#fff" strokeWidth="1.3" strokeLinecap="round" />
      <defs>
        <linearGradient id="terminal-grad" x1="2" y1="3" x2="16" y2="15">
          <stop stopColor="#34C759" />
          <stop offset="1" stopColor="#248A3D" />
        </linearGradient>
      </defs>
    </svg>
  ),
  behavior: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect x="2" y="2" width="14" height="14" rx="3" fill="url(#behavior-grad)" />
      <circle cx="9" cy="9" r="2.5" stroke="#fff" strokeWidth="1.3" />
      <path
        d="M9 4v1.5M9 12.5V14M4 9h1.5M12.5 9H14M5.46 5.46l1.06 1.06M11.48 11.48l1.06 1.06M5.46 12.54l1.06-1.06M11.48 6.52l1.06-1.06"
        stroke="#fff"
        strokeWidth="1"
        strokeLinecap="round"
      />
      <defs>
        <linearGradient id="behavior-grad" x1="2" y1="2" x2="16" y2="16">
          <stop stopColor="#8E8E93" />
          <stop offset="1" stopColor="#636366" />
        </linearGradient>
      </defs>
    </svg>
  ),
  account: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect x="2" y="2" width="14" height="14" rx="3" fill="url(#account-grad)" />
      <circle cx="9" cy="7" r="2.5" stroke="#fff" strokeWidth="1.2" />
      <path
        d="M4.5 15c0-2.5 2-4.5 4.5-4.5s4.5 2 4.5 4.5"
        stroke="#fff"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <defs>
        <linearGradient id="account-grad" x1="2" y1="2" x2="16" y2="16">
          <stop stopColor="#5856D6" />
          <stop offset="1" stopColor="#AF52DE" />
        </linearGradient>
      </defs>
    </svg>
  ),
};

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'behavior', label: 'Behavior' },
  { id: 'account', label: 'Account' },
];

export function SettingsPanel({
  settings,
  defaults,
  onUpdate,
  onReset,
  onClose,
  onOpenKeybindings,
  email,
  onLogout,
  subscription,
  profiles = [],
  defaultProfileId = null,
  onAddProfile,
  onUpdateProfile,
  onRemoveProfile,
  onSetDefaultProfile,
}: SettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('appearance');
  const [shellInput, setShellInput] = useState(settings.shellPath);
  const [shellValid, setShellValid] = useState<boolean | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose],
  );

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
                <path
                  d="M5.5 5.5v2.5H8"
                  stroke="#fff"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M5.5 8A3.75 3.75 0 1 1 6.2 11"
                  stroke="#fff"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                />
                <defs>
                  <linearGradient id="reset-grad" x1="2" y1="2" x2="16" y2="16">
                    <stop stopColor="#FF9500" />
                    <stop offset="1" stopColor="#FF3B30" />
                  </linearGradient>
                </defs>
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
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              >
                <path d="M2 2l8 8M10 2l-8 8" />
              </svg>
            </button>
          </div>

          <div className="sp-content-body">
            {activeTab === 'appearance' && (
              <>
                <ThemeSelector
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
                  <SettingRow
                    label="Opacity"
                    badge={`${Math.round(settings.backgroundOpacity * 100)}%`}
                  >
                    <input
                      className="sp-range"
                      type="range"
                      min={30}
                      max={100}
                      step={1}
                      value={Math.round(settings.backgroundOpacity * 100)}
                      onChange={(e) =>
                        onUpdate({ backgroundOpacity: Number(e.target.value) / 100 })
                      }
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
                  <div className="sp-separator" />
                  <SettingRow label="Scrollbar Visibility">
                    <SegmentedControl
                      options={SCROLLBAR_VISIBILITY_OPTIONS}
                      value={settings.scrollbarVisibility}
                      onChange={(v) => onUpdate({ scrollbarVisibility: v })}
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
                  <div className="sp-separator" />
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
                </div>

                {/* Font preview */}
                <FontPreview settings={settings} />

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
                </div>

                <div className="sp-group-label">Input</div>
                <div className="sp-group">
                  <SettingRow label="Option as Meta Key">
                    <NativeToggle
                      value={settings.macOptionIsMeta}
                      onChange={(v) => onUpdate({ macOptionIsMeta: v })}
                    />
                  </SettingRow>
                  <div className="sp-separator" />
                  <SettingRow label="Copy on Select">
                    <NativeToggle
                      value={settings.copyOnSelect}
                      onChange={(v) => onUpdate({ copyOnSelect: v })}
                    />
                  </SettingRow>
                  <div className="sp-separator" />
                  <SettingRow label="Alt-Click Moves Cursor">
                    <NativeToggle
                      value={settings.altClickMoveCursor}
                      onChange={(v) => onUpdate({ altClickMoveCursor: v })}
                    />
                  </SettingRow>
                  <div className="sp-separator" />
                  <SettingRow label="Word Separators">
                    <input
                      className="sp-input"
                      type="text"
                      value={settings.wordSeparators}
                      onChange={(e) => onUpdate({ wordSeparators: e.target.value })}
                      spellCheck={false}
                      style={{ fontFamily: 'monospace', fontSize: '12px' }}
                    />
                  </SettingRow>
                  <div className="sp-separator" />
                  <SettingRow label="Autocomplete">
                    <NativeToggle
                      value={settings.autocompleteEnabled}
                      onChange={(v) => onUpdate({ autocompleteEnabled: v })}
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
                  <SettingRow label="Restore Tabs on Restart">
                    <NativeToggle
                      value={settings.restoreSessions}
                      onChange={(v) => onUpdate({ restoreSessions: v })}
                    />
                  </SettingRow>
                  <div className="sp-separator" />
                  <SettingRow label="Close Window on Last Tab">
                    <NativeToggle
                      value={settings.closeWindowOnLastTab}
                      onChange={(v) => onUpdate({ closeWindowOnLastTab: v })}
                    />
                  </SettingRow>
                  <div className="sp-separator" />
                  <SettingRow label="Confirm Close Running Process">
                    <NativeToggle
                      value={settings.confirmCloseRunningProcess}
                      onChange={(v) => onUpdate({ confirmCloseRunningProcess: v })}
                    />
                  </SettingRow>
                </div>

                <div className="sp-group-label">Display</div>
                <div className="sp-group">
                  <SettingRow label="Pin Prompt to Bottom">
                    <NativeToggle
                      value={settings.promptAtBottom}
                      onChange={(v) => onUpdate({ promptAtBottom: v })}
                    />
                  </SettingRow>
                </div>

                <div className="sp-group-label">Notifications</div>
                <div className="sp-group">
                  <SettingRow label="Bell Sound">
                    <NativeToggle
                      value={settings.bellEnabled}
                      onChange={(v) => onUpdate({ bellEnabled: v })}
                    />
                  </SettingRow>
                  <div className="sp-separator" />
                  <SettingRow label="Notify on Bell">
                    <NativeToggle
                      value={settings.notifyOnBell}
                      onChange={(v) => onUpdate({ notifyOnBell: v })}
                    />
                  </SettingRow>
                  <div className="sp-separator" />
                  <SettingRow label="Notify on Process Exit">
                    <NativeToggle
                      value={settings.notifyOnProcessExit}
                      onChange={(v) => onUpdate({ notifyOnProcessExit: v })}
                    />
                  </SettingRow>
                  <div className="sp-separator" />
                  <SettingRow label="Notify on Long-Running Command">
                    <NativeToggle
                      value={settings.notifyLongRunningCommand}
                      onChange={(v) => onUpdate({ notifyLongRunningCommand: v })}
                    />
                  </SettingRow>
                  {settings.notifyLongRunningCommand && (
                    <>
                      <div className="sp-separator" />
                      <SettingRow label="Long-Running Threshold (seconds)">
                        <input
                          type="number"
                          className="sp-input"
                          value={settings.longRunningThreshold}
                          min={5}
                          max={600}
                          step={5}
                          onChange={(e) =>
                            onUpdate({
                              longRunningThreshold: Math.max(5, parseInt(e.target.value, 10) || 30),
                            })
                          }
                        />
                      </SettingRow>
                    </>
                  )}
                </div>

                <div className="sp-group-label">Editor</div>
                <div className="sp-group">
                  <SettingRow label="Open Files With">
                    <SegmentedControl
                      options={[
                        { value: 'auto' as DefaultEditor, label: 'Auto' },
                        { value: 'cursor' as DefaultEditor, label: 'Cursor' },
                        { value: 'vscode' as DefaultEditor, label: 'VS Code' },
                        { value: 'sublime' as DefaultEditor, label: 'Sublime' },
                        { value: 'custom' as DefaultEditor, label: 'Custom' },
                      ]}
                      value={settings.defaultEditor}
                      onChange={(v) => onUpdate({ defaultEditor: v })}
                    />
                  </SettingRow>
                  {settings.defaultEditor === 'custom' && (
                    <>
                      <div className="sp-separator" />
                      <SettingRow label="Command">
                        <input
                          className="sp-input"
                          type="text"
                          value={settings.customEditorCommand}
                          onChange={(e) => onUpdate({ customEditorCommand: e.target.value })}
                          placeholder="e.g. zed, nano, emacs"
                          spellCheck={false}
                        />
                      </SettingRow>
                    </>
                  )}
                </div>

                <div className="sp-group-label">Dropdown Terminal</div>
                <div className="sp-group">
                  <SettingRow label="Enable Dropdown Mode">
                    <NativeToggle
                      value={settings.dropdownEnabled}
                      onChange={(v) => onUpdate({ dropdownEnabled: v })}
                    />
                  </SettingRow>
                  {settings.dropdownEnabled && (
                    <>
                      <div className="sp-separator" />
                      <SettingRow label="Hotkey">
                        <HotkeyInput
                          value={settings.dropdownHotkey}
                          onChange={(v) => onUpdate({ dropdownHotkey: v })}
                        />
                      </SettingRow>
                      <div className="sp-separator" />
                      <SettingRow label="Height">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <input
                            type="range"
                            min={20}
                            max={80}
                            step={5}
                            value={settings.dropdownHeight}
                            onChange={(e) =>
                              onUpdate({ dropdownHeight: parseInt(e.target.value, 10) })
                            }
                            style={{ flex: 1 }}
                          />
                          <span className="sp-value-label">{settings.dropdownHeight}%</span>
                        </div>
                      </SettingRow>
                    </>
                  )}
                </div>

                <div className="sp-group-label">System</div>
                <div className="sp-group">
                  <SettingRow label="Launch at Login">
                    <NativeToggle
                      value={settings.launchAtLogin}
                      onChange={(v) => onUpdate({ launchAtLogin: v })}
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
                        <svg
                          className="sp-nav-row-chevron"
                          width="7"
                          height="12"
                          viewBox="0 0 7 12"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M1 1l5 5-5 5" />
                        </svg>
                      </button>
                    </div>
                  </>
                )}

                <div className="sp-group-label">Profiles</div>
                <ProfilesSection
                  profiles={profiles}
                  defaultProfileId={defaultProfileId}
                  settings={settings}
                  onAdd={onAddProfile}
                  onUpdate={onUpdateProfile}
                  onRemove={onRemoveProfile}
                  onSetDefault={onSetDefaultProfile}
                />
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

                {subscription && (
                  <>
                    <div className="sp-group-label">Plan</div>
                    <div className="sp-group">
                      <SettingRow label="Current Plan">
                        <span
                          className="sp-account-value"
                          style={{
                            color: subscription.isPro
                              ? '#9ece6a'
                              : subscription.isOnTrial
                                ? '#e0af68'
                                : undefined,
                          }}
                        >
                          {subscription.selfHosted
                            ? /localhost|127\.0\.0\.1/.test(resolveRelayUrl())
                              ? 'Local Dev'
                              : 'Self-Hosted'
                            : subscription.isPro
                              ? 'Pro'
                              : subscription.isOnTrial
                                ? `Trial (${subscription.trialDaysLeft}d left)`
                                : 'Free'}
                        </span>
                      </SettingRow>
                      {!subscription.selfHosted && (
                        <>
                          <div className="sp-separator" />
                          <SettingRow label="Relay">
                            <span
                              className="sp-account-value"
                              style={{
                                color: subscription.isPro ? '#9ece6a' : 'var(--text-muted)',
                              }}
                            >
                              {subscription.isPro ? 'Active' : 'Disabled (Pro required)'}
                            </span>
                          </SettingRow>
                        </>
                      )}
                      {subscription.cancelAtPeriodEnd && subscription.isPro && (
                        <>
                          <div className="sp-separator" />
                          <SettingRow label="Status">
                            <span className="sp-account-value" style={{ color: '#e0af68' }}>
                              Cancels at period end
                            </span>
                          </SettingRow>
                        </>
                      )}
                      {!subscription.selfHosted && (
                        <>
                          <div className="sp-separator" />
                          <div className="sp-row sp-row-center">
                            {subscription.isPro && !subscription.isOnTrial ? (
                              <button
                                className="sp-action-btn"
                                onClick={() =>
                                  invoke('open_url', { url: 'https://polar.sh/termpod/portal' })
                                }
                              >
                                Manage Subscription
                              </button>
                            ) : (
                              <button
                                className="sp-action-btn"
                                onClick={() => {
                                  const params = email
                                    ? `?customer_email=${encodeURIComponent(email)}`
                                    : '';
                                  invoke('open_url', {
                                    url: `https://termpod.dev/pricing${params}`,
                                  });
                                }}
                              >
                                {subscription.isOnTrial
                                  ? 'Upgrade — Keep Pro After Trial'
                                  : 'Upgrade to Pro'}
                              </button>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </>
                )}

                <div className="sp-group-label">Relay Server</div>
                <div className="sp-group">
                  <SettingRow label="Custom URL">
                    <input
                      className="sp-input"
                      type="text"
                      value={settings.relayUrl}
                      onChange={(e) => onUpdate({ relayUrl: e.target.value })}
                      placeholder="wss://relay.termpod.dev"
                      spellCheck={false}
                    />
                  </SettingRow>
                </div>
                <div className="sp-hint">
                  Leave empty to use the default relay server. Changes take effect on next
                  connection.
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

function SettingRow({
  label,
  badge,
  children,
}: {
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

function NativeToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
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

function HotkeyInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [recording, setRecording] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (!recording) return;
      e.preventDefault();
      e.stopPropagation();

      if (e.key === 'Escape') {
        setRecording(false);
        return;
      }

      const parts: string[] = [];
      if (e.ctrlKey) parts.push('Ctrl');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');
      if (e.metaKey) parts.push('Super');

      const ignore = new Set(['Control', 'Alt', 'Shift', 'Meta']);
      if (!ignore.has(e.key) && e.key.length > 0) {
        const keyLabel = e.key === '`' ? '`' : e.key.length === 1 ? e.key.toUpperCase() : e.key;
        parts.push(keyLabel);
        onChange(parts.join('+'));
        setRecording(false);
      }
    },
    [recording, onChange],
  );

  return (
    <button
      ref={ref}
      className={`sp-hotkey-input ${recording ? 'sp-hotkey-input-recording' : ''}`}
      onClick={() => {
        setRecording(true);
        ref.current?.focus();
      }}
      onBlur={() => setRecording(false)}
      onKeyDown={handleKeyDown}
    >
      {recording ? 'Press keys…' : value || 'Click to set'}
    </button>
  );
}

function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
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

function ThemeSelector({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (key: string) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const customThemes = useSyncExternalStore(subscribeCustomThemes, getCustomThemesSnapshot);
  const theme = resolveTheme(selected, customThemes);
  const swatches = [theme.red, theme.green, theme.yellow, theme.blue, theme.magenta, theme.cyan];

  return (
    <>
      <div className="sp-group-label">Theme</div>
      <div className="sp-group">
        <button className="sp-theme-selector" onClick={() => setPickerOpen(true)}>
          <div className="sp-theme-selector-preview" style={{ background: theme.background }}>
            <div className="sp-theme-selector-line">
              <span style={{ color: theme.green }}>~</span>
              <span style={{ color: theme.foreground }}> </span>
              <span style={{ color: theme.cyan }}>git</span>
              <span style={{ color: theme.foreground }}> status</span>
            </div>
            <div className="sp-theme-selector-line">
              <span style={{ color: theme.yellow }}> M</span>
              <span style={{ color: theme.foreground }}> src/</span>
              <span style={{ color: theme.blue }}>app.ts</span>
            </div>
          </div>
          <div className="sp-theme-selector-info">
            <span className="sp-theme-selector-name">{theme.name}</span>
            <div className="sp-theme-selector-swatches">
              {swatches.map((c, i) => (
                <span key={i} className="sp-theme-selector-swatch" style={{ background: c }} />
              ))}
            </div>
          </div>
          <svg
            className="sp-theme-selector-chevron"
            width="7"
            height="12"
            viewBox="0 0 7 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M1 1l5 5-5 5" />
          </svg>
        </button>
      </div>
      {pickerOpen && (
        <ThemePicker selected={selected} onSelect={onSelect} onClose={() => setPickerOpen(false)} />
      )}
    </>
  );
}

function FontPicker({
  value,
  options,
  onChange,
}: {
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
        <svg
          className="sp-font-trigger-chevron"
          width="8"
          height="5"
          viewBox="0 0 8 5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
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
                    <svg
                      className="sp-font-check"
                      width="14"
                      height="14"
                      viewBox="0 0 14 14"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
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

function ProfileRow({
  profile,
  isDefault,
  onUpdate,
  onRemove,
  onSetDefault,
}: {
  profile: TerminalProfile;
  isDefault: boolean;
  onUpdate: (patch: Partial<Omit<TerminalProfile, 'id'>>) => void;
  onRemove: () => void;
  onSetDefault: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [nameInput, setNameInput] = useState(profile.name);
  const [shellInput, setShellInput] = useState(profile.shell);
  const [cwdInput, setCwdInput] = useState(profile.cwd);
  const [envText, setEnvText] = useState(
    Object.entries(profile.env)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n'),
  );

  const commitName = () => {
    const v = nameInput.trim();
    if (v) onUpdate({ name: v });
    else setNameInput(profile.name);
  };

  const commitShell = () => {
    onUpdate({ shell: shellInput.trim() });
  };

  const commitCwd = () => {
    onUpdate({ cwd: cwdInput.trim() });
  };

  const commitEnv = () => {
    const env: Record<string, string> = {};
    for (const line of envText.split('\n')) {
      const eq = line.indexOf('=');
      if (eq > 0) {
        const k = line.slice(0, eq).trim();
        const v = line.slice(eq + 1).trim();
        if (k) env[k] = v;
      }
    }
    onUpdate({ env });
  };

  return (
    <div className="sp-profile-row">
      <div className="sp-profile-header">
        <button
          type="button"
          className="sp-profile-expand"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          <svg
            width="7"
            height="12"
            viewBox="0 0 7 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              transform: expanded ? 'rotate(90deg)' : undefined,
              transition: 'transform 0.15s',
            }}
          >
            <path d="M1 1l5 5-5 5" />
          </svg>
          <span className="sp-profile-name">{profile.name}</span>
          {isDefault && <span className="sp-profile-default-badge">default</span>}
        </button>
        <div className="sp-profile-actions">
          {!isDefault && (
            <button type="button" className="sp-profile-btn" onClick={onSetDefault}>
              Set Default
            </button>
          )}
          <button type="button" className="sp-profile-btn sp-profile-btn-danger" onClick={onRemove}>
            Delete
          </button>
        </div>
      </div>
      {expanded && (
        <div className="sp-profile-fields">
          <div className="sp-profile-field">
            <label className="sp-profile-field-label">Name</label>
            <input
              className="sp-input"
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
              spellCheck={false}
            />
          </div>
          <div className="sp-profile-field">
            <label className="sp-profile-field-label">Shell</label>
            <input
              className="sp-input"
              type="text"
              value={shellInput}
              onChange={(e) => setShellInput(e.target.value)}
              onBlur={commitShell}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
              spellCheck={false}
              placeholder="/bin/zsh"
            />
          </div>
          <div className="sp-profile-field">
            <label className="sp-profile-field-label">Working Directory</label>
            <input
              className="sp-input"
              type="text"
              value={cwdInput}
              onChange={(e) => setCwdInput(e.target.value)}
              onBlur={commitCwd}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
              spellCheck={false}
              placeholder="~/projects/myapp"
            />
          </div>
          <div className="sp-profile-field">
            <label className="sp-profile-field-label">
              Environment Variables
              <span className="sp-profile-field-hint"> (KEY=VALUE, one per line)</span>
            </label>
            <textarea
              className="sp-input sp-profile-env-textarea"
              value={envText}
              onChange={(e) => setEnvText(e.target.value)}
              onBlur={commitEnv}
              spellCheck={false}
              rows={3}
              placeholder={'NODE_ENV=development\nAPI_URL=http://localhost:3000'}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function ProfilesSection({
  profiles,
  defaultProfileId,
  settings,
  onAdd,
  onUpdate,
  onRemove,
  onSetDefault,
}: {
  profiles: TerminalProfile[];
  defaultProfileId: string | null;
  settings: Settings;
  onAdd?: (profile: Omit<TerminalProfile, 'id'>) => void;
  onUpdate?: (id: string, patch: Partial<Omit<TerminalProfile, 'id'>>) => void;
  onRemove?: (id: string) => void;
  onSetDefault?: (id: string | null) => void;
}) {
  return (
    <div className="sp-profiles-group">
      {profiles.length === 0 ? (
        <div className="sp-profiles-empty">
          No profiles yet. Profiles let you open tabs with custom shells, directories, and
          environment variables.
        </div>
      ) : (
        profiles.map((p) => (
          <ProfileRow
            key={p.id}
            profile={p}
            isDefault={p.id === defaultProfileId}
            onUpdate={(patch) => onUpdate?.(p.id, patch)}
            onRemove={() => onRemove?.(p.id)}
            onSetDefault={() => onSetDefault?.(p.id)}
          />
        ))
      )}
      {onAdd && (
        <button
          type="button"
          className="sp-profiles-add-btn"
          onClick={() =>
            onAdd({
              name: `Profile ${profiles.length + 1}`,
              shell: settings.shellPath,
              cwd: '',
              env: {},
            })
          }
        >
          + Add Profile
        </button>
      )}
    </div>
  );
}

function FontPreview({ settings }: { settings: Settings }) {
  const customThemes = useSyncExternalStore(subscribeCustomThemes, getCustomThemesSnapshot);
  const theme = resolveTheme(settings.theme, customThemes);
  const fg = theme.foreground;
  const smoothingMap: Record<string, string> = {
    auto: 'auto',
    antialiased: 'antialiased',
    none: 'none',
  };

  return (
    <div
      className="sp-font-preview"
      style={
        {
          fontFamily: settings.fontFamily,
          fontSize: `${settings.fontSize}px`,
          fontWeight: settings.fontWeight === 'normal' ? 400 : Number(settings.fontWeight),
          lineHeight: settings.lineHeight,
          WebkitFontSmoothing: smoothingMap[settings.fontSmoothing] ?? 'auto',
          fontVariantLigatures: settings.fontLigatures ? 'normal' : 'none',
          background: theme.background,
          color: fg,
        } as React.CSSProperties
      }
    >
      <div>
        <span style={{ color: theme.blue }}>~/termpod</span>{' '}
        <span style={{ color: theme.brightBlack }}>on</span>{' '}
        <span style={{ color: theme.magenta }}>main</span>
      </div>
      <div>
        <span style={{ color: theme.green }}>❯</span> git log --oneline -3
      </div>
      <div>
        <span style={{ color: theme.yellow }}>15cd883</span> Add theme picker with live preview
      </div>
      <div>
        <span style={{ color: theme.yellow }}>670d45b</span> Add Cmd+click to open links
      </div>
      <div>
        <span style={{ color: theme.yellow }}>9e4c212</span> Refine context menu to match macOS
      </div>
      <div>&nbsp;</div>
      <div>
        <span style={{ color: theme.green }}>❯</span>{' '}
        <span style={{ color: theme.cyan }}>echo</span>{' '}
        {settings.fontLigatures ? '<=> != ===' : '"Hello, world!"'}
      </div>
      <div>{settings.fontLigatures ? '<=> != ===' : 'Hello, world!'}</div>
    </div>
  );
}
