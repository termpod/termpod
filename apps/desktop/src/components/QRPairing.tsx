import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { RELAY_URL } from '@termpod/shared';

interface QRPairingProps {
  sessionId: string | null;
  onClose: () => void;
}

export function QRPairing({ sessionId, onClose }: QRPairingProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [copied, setCopied] = useState(false);

  const pairingUrl = sessionId
    ? `termpod://pair?relay=${RELAY_URL.production}&session=${sessionId}`
    : null;

  useEffect(() => {
    if (!canvasRef.current || !pairingUrl) {
      return;
    }

    QRCode.toCanvas(canvasRef.current, pairingUrl, {
      width: 200,
      margin: 2,
      color: { dark: '#c0caf5', light: '#1a1b26' },
    });
  }, [pairingUrl]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleCopy = () => {
    if (sessionId) {
      navigator.clipboard.writeText(sessionId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (!sessionId) {
    return null;
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel qr-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>Share Session</span>
          <button className="modal-close" onClick={onClose} aria-label="Close">&times;</button>
        </div>
        <canvas ref={canvasRef} className="qr-canvas" />
        <p className="qr-hint">Scan with Termpod mobile to connect</p>
        <div className="qr-session-id">
          <code>{sessionId}</code>
          <button className="qr-copy" onClick={handleCopy}>
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>
    </div>
  );
}
