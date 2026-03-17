import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface ShareDialogProps {
  shareUrl: string;
  expiresAt: string;
  onClose: () => void;
}

export function ShareDialog({ shareUrl, expiresAt, onClose }: ShareDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose],
  );

  const handleCopy = useCallback(() => {
    invoke('copy_to_clipboard', { text: shareUrl });
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [shareUrl]);

  const remaining = getTimeRemaining(expiresAt);

  return (
    <div className="modal-overlay" onClick={onClose} onKeyDown={handleKeyDown}>
      <div className="sd" onClick={(e) => e.stopPropagation()}>
        <div className="sd-header">
          <div className="sd-icon">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M6 10l4-4M6.5 6.5L5.1 5.1a2 2 0 010-2.83l.7-.7a2 2 0 012.83 0L10 2.9M9.5 9.5l1.4 1.4a2 2 0 010 2.83l-.7.7a2 2 0 01-2.83 0L6 13.1"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <div>
            <div className="sd-title">Session Shared</div>
            <div className="sd-subtitle">Read-only access &middot; expires {remaining}</div>
          </div>
        </div>

        <div className="sd-link-row">
          <input
            ref={inputRef}
            className="sd-input"
            type="text"
            value={shareUrl}
            readOnly
            onClick={(e) => (e.target as HTMLInputElement).select()}
          />
          <button
            className={`sd-copy ${copied ? 'sd-copy-done' : ''}`}
            onClick={handleCopy}
            type="button"
          >
            {copied ? (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path
                  d="M3.5 7.5l2 2 5-5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <rect
                  x="4.5"
                  y="4.5"
                  width="7"
                  height="7"
                  rx="1.5"
                  stroke="currentColor"
                  strokeWidth="1.2"
                />
                <path
                  d="M9.5 4.5V3a1.5 1.5 0 00-1.5-1.5H3A1.5 1.5 0 001.5 3v5A1.5 1.5 0 003 9.5h1.5"
                  stroke="currentColor"
                  strokeWidth="1.2"
                />
              </svg>
            )}
          </button>
        </div>

        <div className="sd-footer">
          <button className="sd-done" onClick={onClose} type="button">
            Done
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
