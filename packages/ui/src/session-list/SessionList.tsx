import type { Session } from '@termpod/shared';

export interface SessionListProps {
  sessions: Session[];
  activeSessionId?: string;
  onSelect: (sessionId: string) => void;
  onCreate: () => void;
}

export function SessionList({ sessions, activeSessionId, onSelect, onCreate }: SessionListProps) {
  return (
    <div className="session-list">
      <div className="session-list-header">
        <h3>Sessions</h3>
        <button onClick={onCreate} type="button">+</button>
      </div>
      <ul>
        {sessions.map((session) => (
          <li
            key={session.sessionId}
            className={session.sessionId === activeSessionId ? 'active' : ''}
          >
            <button onClick={() => onSelect(session.sessionId)} type="button">
              <span className="session-name">{session.name}</span>
              <span className={`session-status ${session.status}`} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
