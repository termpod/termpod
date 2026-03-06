import { useEffect, useState } from 'react';
import type { Settings } from '../hooks/useSettings';

interface SettingsPanelProps {
  settings: Settings;
  defaults: Settings;
  onUpdate: (patch: Partial<Settings>) => void;
  onReset: () => void;
  onClose: () => void;
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
];

export function SettingsPanel({ settings, defaults, onUpdate, onReset, onClose, email, onLogout }: SettingsPanelProps) {
  const [shellInput, setShellInput] = useState(settings.shellPath);
  const [shellValid, setShellValid] = useState<boolean | null>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const validateShell = (path: string) => {
    const trimmed = path.trim();
    if (!trimmed) {
      setShellValid(false);
      setShellInput(settings.shellPath);
      return;
    }

    // Basic path validation — must start with /
    if (!trimmed.startsWith('/')) {
      setShellValid(false);
      return;
    }

    setShellValid(true);
    onUpdate({ shellPath: trimmed });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>Settings</span>
          <button className="modal-close" onClick={onClose} aria-label="Close">&times;</button>
        </div>

        <div className="settings-body">
          <div className="settings-group">
            <label className="settings-label">Font</label>
            <div className="settings-row">
              <select
                className="settings-select"
                style={{ flex: 1 }}
                value={settings.fontFamily}
                onChange={(e) => onUpdate({ fontFamily: e.target.value })}
              >
                {FONT_OPTIONS.map((font) => (
                  <option key={font} value={font}>
                    {font.split(',')[0]}
                  </option>
                ))}
              </select>
              <input
                className="settings-range"
                type="range"
                min={10}
                max={24}
                value={settings.fontSize}
                onChange={(e) => onUpdate({ fontSize: Number(e.target.value) })}
              />
              <span className="settings-value">{settings.fontSize}px</span>
            </div>
            <div
              className="settings-font-preview"
              style={{
                fontFamily: settings.fontFamily,
                fontSize: `${settings.fontSize}px`,
              }}
            >
              ~/termpod $ echo &quot;Hello, world!&quot;
            </div>
          </div>

          <div className="settings-group">
            <label className="settings-label">Shell</label>
            <input
              className={`settings-input ${shellValid === false ? 'settings-input-error' : ''}`}
              type="text"
              value={shellInput}
              onChange={(e) => {
                setShellInput(e.target.value);
                setShellValid(null);
              }}
              onBlur={() => validateShell(shellInput)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  (e.target as HTMLInputElement).blur();
                }
              }}
              spellCheck={false}
              placeholder="/bin/zsh"
            />
            {shellValid === false && (
              <span className="settings-hint-error">Path must start with /</span>
            )}
          </div>

          <div className="settings-group">
            <label className="settings-label">Scrollback Lines</label>
            <div className="settings-row">
              <input
                className="settings-range"
                type="range"
                min={1000}
                max={50000}
                step={1000}
                value={settings.scrollbackLines}
                onChange={(e) => onUpdate({ scrollbackLines: Number(e.target.value) })}
              />
              <span className="settings-value">{settings.scrollbackLines.toLocaleString()}</span>
            </div>
          </div>
        </div>

        <div className="settings-divider" />

        <div className="settings-footer">
          {email && (
            <span className="settings-account" title={email}>{email}</span>
          )}
          <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
            {onLogout && (
              <button className="btn-danger" onClick={onLogout}>
                Sign Out
              </button>
            )}
            <button className="btn-secondary" onClick={onReset}>
              Reset Defaults
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
