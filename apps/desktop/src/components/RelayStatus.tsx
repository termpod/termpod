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
  connected: '#50c878',
  error: '#e05050',
};

export function RelayStatus({ status, viewers, sessionId, onShare }: RelayStatusProps) {
  return (
    <div className="relay-status">
      <span
        className="relay-dot"
        style={{ backgroundColor: STATUS_COLORS[status] }}
      />
      <span className="relay-label">
        {status === 'connected' && sessionId
          ? `Sharing (${viewers} viewer${viewers !== 1 ? 's' : ''})`
          : status}
      </span>
      {status === 'connected' && (
        <button className="relay-share" onClick={onShare}>
          QR Code
        </button>
      )}
    </div>
  );
}
