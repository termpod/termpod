import { useCallback, useEffect, useRef, useState } from 'react';
import type { RelayStatus, MergedDevice } from '../hooks/useRelayConnection';

interface SessionDevices {
  sessionName: string;
  sessionId: string | null;
  relayStatus: RelayStatus;
  devices: MergedDevice[];
}

interface ConnectedDevicesPanelProps {
  sessionDevices: SessionDevices[];
  onClose: () => void;
}

const STATUS_COLORS: Record<RelayStatus, string> = {
  disconnected: 'var(--text-muted)',
  connecting: 'var(--warning)',
  reconnecting: 'var(--warning)',
  connected: 'var(--success)',
  error: 'var(--error)',
};

const STATUS_LABELS: Record<RelayStatus, string> = {
  disconnected: 'Offline',
  connecting: 'Connecting...',
  reconnecting: 'Reconnecting...',
  connected: 'Connected',
  error: 'Error',
};

const DEVICE_LABELS: Record<string, string> = {
  iphone: 'iPhone',
  ipad: 'iPad',
  macos: 'Mac',
  browser: 'Browser',
  unknown: 'Unknown',
};

const TRANSPORT_LABELS: Record<string, string> = {
  relay: 'Relay',
  local: 'Local',
  webrtc: 'P2P',
};

const TRANSPORT_COLORS: Record<string, string> = {
  relay: 'var(--accent)',
  local: 'var(--success)',
  webrtc: '#c084fc',
};

function formatDuration(isoTimestamp: string): string {
  const diff = Date.now() - new Date(isoTimestamp).getTime();
  const seconds = Math.floor(diff / 1000);

  if (seconds < 60) {
    return 'just now';
  }

  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours < 24) {
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function DeviceIcon({ device }: { device: string }) {
  switch (device) {
    case 'iphone':
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <rect x="4" y="1" width="8" height="14" rx="2" stroke="currentColor" strokeWidth="1.2" />
          <line
            x1="7"
            y1="12.5"
            x2="9"
            y2="12.5"
            stroke="currentColor"
            strokeWidth="1"
            strokeLinecap="round"
          />
        </svg>
      );

    case 'ipad':
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.2" />
          <circle cx="8" cy="12" r="0.8" fill="currentColor" />
        </svg>
      );

    case 'macos':
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <rect
            x="1.5"
            y="2"
            width="13"
            height="9"
            rx="1.5"
            stroke="currentColor"
            strokeWidth="1.2"
          />
          <path d="M5 13h6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          <path d="M8 11v2" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      );

    default:
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.2" />
          <circle cx="8" cy="8" r="2" fill="currentColor" />
        </svg>
      );
  }
}

function DeviceRow({ device }: { device: MergedDevice }) {
  const [, setTick] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

  useEffect(() => {
    intervalRef.current = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(intervalRef.current);
  }, []);

  return (
    <div className="cdp-device-row">
      <div className="cdp-device-icon">
        <DeviceIcon device={device.device} />
      </div>
      <div className="cdp-device-info">
        <div className="cdp-device-name">{DEVICE_LABELS[device.device] ?? device.device}</div>
        <div className="cdp-device-transports">
          {device.transports.map((t) => (
            <span
              key={t}
              className="cdp-transport-badge"
              style={{
                color: TRANSPORT_COLORS[t] ?? 'var(--text-muted)',
                background: `color-mix(in srgb, ${TRANSPORT_COLORS[t] ?? 'var(--text-muted)'} 12%, transparent)`,
              }}
            >
              {TRANSPORT_LABELS[t] ?? t}
            </span>
          ))}
        </div>
        <div className="cdp-device-meta">{formatDuration(device.connectedAt)}</div>
      </div>
    </div>
  );
}

export function ConnectedDevicesPanel({ sessionDevices, onClose }: ConnectedDevicesPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

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
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const totalDevices = sessionDevices.reduce((sum, s) => sum + s.devices.length, 0);
  const hasMultipleSessions = sessionDevices.length > 1;

  return (
    <div className="cdp-panel" ref={panelRef}>
      <div className="cdp-header">
        <span className="cdp-title">Connected Devices</span>
        <button className="cdp-close-btn" onClick={onClose} aria-label="Close">
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

      <div className="cdp-body">
        {sessionDevices.map((session, idx) => (
          <div key={session.sessionId ?? idx} className="cdp-session-group">
            {hasMultipleSessions && (
              <div className="cdp-session-header">
                <span className="cdp-session-name">{session.sessionName}</span>
              </div>
            )}

            <div className="cdp-status-row">
              <span
                className="cdp-status-dot"
                style={{ backgroundColor: STATUS_COLORS[session.relayStatus] }}
              />
              <span className="cdp-status-label">{STATUS_LABELS[session.relayStatus]}</span>
            </div>

            {session.devices.length > 0 ? (
              <div className="cdp-device-list">
                {session.devices.map((device) => (
                  <DeviceRow key={device.device} device={device} />
                ))}
              </div>
            ) : (
              <div className="cdp-empty-session">No viewers</div>
            )}

            {hasMultipleSessions && idx < sessionDevices.length - 1 && (
              <div className="cdp-divider" />
            )}
          </div>
        ))}

        {sessionDevices.length === 0 && (
          <div className="cdp-empty">
            <div className="cdp-empty-icon">
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                <rect
                  x="4"
                  y="6"
                  width="24"
                  height="16"
                  rx="3"
                  stroke="var(--text-muted)"
                  strokeWidth="1.5"
                />
                <path
                  d="M10 26h12"
                  stroke="var(--text-muted)"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
                <path d="M16 22v4" stroke="var(--text-muted)" strokeWidth="1.5" />
                <circle
                  cx="24"
                  cy="10"
                  r="4"
                  fill="var(--bg-primary)"
                  stroke="var(--text-muted)"
                  strokeWidth="1.5"
                />
                <path
                  d="M23 10h2"
                  stroke="var(--text-muted)"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <span className="cdp-empty-text">No devices connected</span>
            <span className="cdp-empty-hint">Open TermPod on your iPhone or iPad to connect</span>
          </div>
        )}

        {totalDevices > 0 && (
          <div className="cdp-summary">
            {totalDevices} device{totalDevices !== 1 ? 's' : ''} connected
          </div>
        )}
      </div>
    </div>
  );
}
