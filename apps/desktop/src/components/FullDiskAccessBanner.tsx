import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

const DISMISSED_KEY = 'termpod-fda-banner-dismissed';

export function FullDiskAccessBanner() {
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(DISMISSED_KEY) === '1',
  );

  if (dismissed) {
    return null;
  }

  const handleDismiss = () => {
    localStorage.setItem(DISMISSED_KEY, '1');
    setDismissed(true);
  };

  const handleOpenSettings = async () => {
    await invoke('open_url', {
      url: 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles',
    });
  };

  return (
    <div className="fda-banner">
      <span className="fda-icon">🔒</span>
      <span className="fda-text">
        Grant <strong>Full Disk Access</strong> to avoid permission popups during remote sessions.
      </span>
      <button className="fda-open" onClick={handleOpenSettings}>
        Open Settings
      </button>
      <button className="fda-dismiss" onClick={handleDismiss} aria-label="Dismiss">
        ✕
      </button>
    </div>
  );
}
