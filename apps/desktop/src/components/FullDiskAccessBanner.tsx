import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

export function FullDiskAccessBanner() {
  const [hasAccess, setHasAccess] = useState<boolean | null>(null);

  useEffect(() => {
    invoke<boolean>('check_full_disk_access').then(setHasAccess);
  }, []);

  if (hasAccess !== false) {
    return null;
  }

  const handleOpenSettings = async () => {
    await invoke('open_url', {
      url: 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles',
    });
  };

  const handleRecheck = async () => {
    const result = await invoke<boolean>('check_full_disk_access');
    setHasAccess(result);
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
      <button className="fda-dismiss" onClick={handleRecheck} aria-label="Recheck">
        ↻
      </button>
    </div>
  );
}
