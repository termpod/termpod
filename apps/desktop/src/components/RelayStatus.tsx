import type { RelayStatus as RelayStatusType } from '../hooks/useRelayConnection';

interface RelayStatusProps {
  status: RelayStatusType;
  viewers: number;
  sessionId: string | null;
  onShare?: () => void;
}

const STATUS_COLORS: Record<RelayStatusType, string> = {
  disconnected: '#888',
  connecting: '#f0a030',
  reconnecting: '#f0a030',
  connected: '#50c878',
  error: '#e05050',
};

export function RelayStatus({ status, viewers, sessionId, onShare }: RelayStatusProps) {
  const label = status === 'connected' && sessionId
    ? `Sharing (${viewers} viewer${viewers !== 1 ? 's' : ''})`
    : status;

  return (
    <div className="relay-status" role="status" aria-live="polite" aria-label={`Connection: ${label}`}>
      <span
        className="relay-dot"
        style={{ backgroundColor: STATUS_COLORS[status] }}
        aria-hidden="true"
      />
      <span className="relay-label">{label}</span>
      {status === 'connected' && (
        <button className="relay-share" onClick={onShare} aria-label="Share session via QR code">
          QR Code
        </button>
      )}
    </div>
  );
}
