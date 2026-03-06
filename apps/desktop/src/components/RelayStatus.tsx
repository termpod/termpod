import type { RelayStatus as RelayStatusType } from '../hooks/useRelayConnection';

interface RelayStatusProps {
  status: RelayStatusType;
}

const STATUS_COLORS: Record<RelayStatusType, string> = {
  disconnected: '#888',
  connecting: '#f0a030',
  reconnecting: '#f0a030',
  connected: '#50c878',
  error: '#e05050',
};

const STATUS_LABELS: Record<RelayStatusType, string> = {
  disconnected: 'Offline',
  connecting: 'Connecting',
  reconnecting: 'Reconnecting',
  connected: 'Connected',
  error: 'Connection error',
};

export function RelayStatus({ status }: RelayStatusProps) {
  return (
    <div className="relay-status" role="status" aria-live="polite" aria-label={`Relay: ${STATUS_LABELS[status]}`}>
      <span
        className="relay-dot"
        style={{ backgroundColor: STATUS_COLORS[status] }}
        aria-hidden="true"
      />
      <span className="relay-label">{STATUS_LABELS[status]}</span>
    </div>
  );
}
