import { useCallback } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { TerminalSession } from '../hooks/useSessionManager';
import { folderIcon } from '@termpod/shared';
import type { TabIcon } from '@termpod/shared';

interface TabBarProps {
  sessions: TerminalSession[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onCreate: () => void;
}

export function TabBar({ sessions, activeId, onSelect, onClose, onCreate }: TabBarProps) {
  const handleDrag = useCallback((e: React.MouseEvent) => {
    // Only drag if clicking directly on the tab-bar (not on child buttons/tabs)
    if (e.target === e.currentTarget) {
      e.preventDefault();
      getCurrentWindow().startDragging();
    }
  }, []);

  return (
    <div className="tab-bar" onMouseDown={handleDrag} data-tauri-drag-region>
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
      <TabIconView icon={session.icon ?? folderIcon} />
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

function TabIconView({ icon }: { icon: TabIcon }) {
  return (
    <svg
      className="tab-icon"
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill={icon.color}
      aria-label={icon.title}
    >
      <path d={icon.svgPath} />
    </svg>
  );
}
