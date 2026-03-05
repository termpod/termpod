import { useState } from 'react';

interface QRScannerProps {
  onScan: (sessionId: string) => void;
  onClose: () => void;
}

function parseSessionId(text: string): string | null {
  // Try termpod://pair?session=...
  try {
    const url = new URL(text);

    if (url.protocol === 'termpod:') {
      return url.searchParams.get('session');
    }
  } catch {
    // not a URL
  }

  // Try plain UUID
  const match = text.match(/[a-f0-9-]{36}/);

  return match ? match[0] : null;
}

export function QRScanner({ onScan, onClose }: QRScannerProps) {
  const [error, setError] = useState<string | null>(null);
  const [pasting, setPasting] = useState(false);

  const handlePaste = async () => {
    setPasting(true);
    setError(null);

    try {
      const text = await navigator.clipboard.readText();
      const sessionId = parseSessionId(text);

      if (sessionId) {
        onScan(sessionId);
      } else {
        setError('No session ID found in clipboard');
      }
    } catch {
      setError('Clipboard access denied. Copy the session ID first, then tap Paste.');
    } finally {
      setPasting(false);
    }
  };

  return (
    <div className="qr-scanner-overlay" onClick={onClose}>
      <div className="qr-scanner-modal" onClick={(e) => e.stopPropagation()}>
        <div className="qr-scanner-header">
          <span>Connect to Session</span>
          <button className="qr-scanner-close" onClick={onClose}>&times;</button>
        </div>
        <div className="paste-section">
          <p className="paste-instructions">
            In the desktop app, click <strong>QR Code</strong> then <strong>Copy</strong> to copy the session ID.
          </p>
          <button
            className="paste-btn"
            onClick={handlePaste}
            disabled={pasting}
          >
            {pasting ? 'Reading...' : 'Paste Session ID'}
          </button>
          {error && <p className="qr-scanner-error">{error}</p>}
        </div>
      </div>
    </div>
  );
}
