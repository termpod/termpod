import { useCallback } from 'react';
import type { TerminalSession } from '../hooks/useSessionManager';

interface TabBarProps {
  sessions: TerminalSession[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onCreate: () => void;
}

export function TabBar({ sessions, activeId, onSelect, onClose, onCreate }: TabBarProps) {
  return (
    <div className="tab-bar" data-tauri-drag-region>
      <div className="tabs">
        {sessions.map((session) => (
          <Tab
            key={session.id}
            session={session}
            isActive={session.id === activeId}
            onSelect={onSelect}
            onClose={onClose}
          />
        ))}
      </div>
      <button className="tab-new" onClick={onCreate} type="button" aria-label="New session (Cmd+T)" title="New session (Cmd+T)">
        +
      </button>
    </div>
  );
}

interface TabProps {
  session: TerminalSession;
  isActive: boolean;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
}

function Tab({ session, isActive, onSelect, onClose }: TabProps) {
  const handleClose = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onClose(session.id);
    },
    [onClose, session.id],
  );

  return (
    <button
      className={`tab ${isActive ? 'tab-active' : ''} ${session.exited ? 'tab-exited' : ''}`}
      onClick={() => onSelect(session.id)}
      type="button"
    >
      <span className="tab-name">{session.name}</span>
      <span
        className="tab-close"
        onClick={handleClose}
        role="button"
        tabIndex={0}
        aria-label={`Close ${session.name}`}
      >
        &times;
      </span>
    </button>
  );
}
