import { useCallback, useEffect, useRef, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';

interface AboutModalProps {
  onClose: () => void;
}

export function AboutModal({ onClose }: AboutModalProps) {
  const [version, setVersion] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getVersion().then(setVersion);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onClose]);

  const handleOpenLink = useCallback((url: string) => {
    invoke('open_url', { url });
  }, []);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="about" ref={panelRef} onClick={(e) => e.stopPropagation()}>
        {/* App icon */}
        <div className="about-icon">
          <svg viewBox="0 0 256 256" fill="none">
            <path
              d="M145.712 128L84.08 173.827L75 161.647L120.25 128L75 94.353L84.08 82.173L145.712 128Z"
              fill="white"
            />
            <path d="M190 156.99H138.856V172.176H190V156.99Z" fill="white" />
          </svg>
        </div>

        {/* App name + version */}
        <div className="about-title">TermPod</div>
        <div className="about-version">
          {version && (
            <>
              <span className="about-version-label">v{version}</span>
              <span className="about-version-dot">&middot;</span>
            </>
          )}
          <span className="about-version-label">macOS</span>
        </div>

        {/* Tagline */}
        <div className="about-tagline">Your terminal, everywhere.</div>

        {/* Separator */}
        <div className="about-sep" />

        {/* Links */}
        <div className="about-links">
          <button
            type="button"
            className="about-link"
            onClick={() => handleOpenLink('https://termpod.dev')}
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="8" cy="8" r="6.5" />
              <path d="M1.5 8h13M8 1.5c-2 2-3 4-3 6.5s1 4.5 3 6.5c2-2 3-4 3-6.5s-1-4.5-3-6.5" />
            </svg>
            Website
          </button>
          <button
            type="button"
            className="about-link"
            onClick={() => handleOpenLink('https://github.com/termpod/termpod')}
          >
            <svg viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 .2A8 8 0 0 0 5.47 15.79c.4.07.55-.17.55-.38l-.01-1.49c-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.42 7.42 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48l-.01 2.2c0 .21.15.46.55.38A8.01 8.01 0 0 0 8 .2Z" />
            </svg>
            GitHub
          </button>
          <button
            type="button"
            className="about-link"
            onClick={() => handleOpenLink('https://github.com/termpod/termpod/releases')}
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M8 2v8M5 7l3 3 3-3M3 12v1.5h10V12" />
            </svg>
            Releases
          </button>
        </div>

        {/* Footer */}
        <div className="about-footer">
          <span className="about-copyright">&copy; {new Date().getFullYear()} TermPod</span>
          <button
            type="button"
            className="about-footer-link"
            onClick={() => handleOpenLink('https://github.com/termpod/termpod/blob/main/LICENSE')}
          >
            MIT License
          </button>
        </div>
      </div>
    </div>
  );
}
