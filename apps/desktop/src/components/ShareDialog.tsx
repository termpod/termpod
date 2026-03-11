import { useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface ShareDialogProps {
  shareUrl: string;
  expiresAt: string;
  onStopSharing: () => void;
  onClose: () => void;
}

export function ShareDialog({ shareUrl, expiresAt, onStopSharing, onClose }: ShareDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  }, [onClose]);

  const handleCopy = useCallback(() => {
    invoke('copy_to_clipboard', { text: shareUrl });
  }, [shareUrl]);

  const remaining = getTimeRemaining(expiresAt);

  return (
    <div className="modal-overlay" onClick={onClose} onKeyDown={handleKeyDown}>
      <div className="share-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="share-dialog-title">Session Shared</div>
        <div className="share-dialog-subtitle">
          Anyone with this link can view (read-only). Expires {remaining}.
        </div>
        <div className="share-dialog-link-row">
          <input
            ref={inputRef}
            className="share-dialog-input"
            type="text"
            value={shareUrl}
            readOnly
            onClick={(e) => (e.target as HTMLInputElement).select()}
          />
          <button className="confirm-btn confirm-btn-danger" onClick={handleCopy} type="button">
            Copy
          </button>
        </div>
        <div className="share-dialog-actions">
          <button className="confirm-btn confirm-btn-cancel" onClick={onClose} type="button">
            Done
          </button>
          <button className="share-dialog-stop" onClick={onStopSharing} type="button">
            Stop Sharing
          </button>
        </div>
      </div>
    </div>
  );
}

function getTimeRemaining(expiresAt: string): string {
  const diff = new Date(expiresAt).getTime() - Date.now();

  if (diff <= 0) {
    return 'soon';
  }

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 0) {
    return `in ${hours}h ${mins}m`;
  }

  return `in ${mins}m`;
}
