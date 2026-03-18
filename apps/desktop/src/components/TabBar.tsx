import { useCallback, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { TerminalSession } from '../hooks/useSessionManager';
import type { RelayStatus as RelayStatusType, MergedDevice } from '../hooks/useRelayConnection';
import { folderIcon } from '@termpod/shared';
import type { TabIcon } from '@termpod/shared';

interface TabBarProps {
  sessions: TerminalSession[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onCreate: () => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  relayStatus: RelayStatusType;
  connectedDevices: MergedDevice[];
  onToggleDevices?: () => void;
  devicesPanelOpen?: boolean;
}

export function TabBar({
  sessions,
  activeId,
  onSelect,
  onClose,
  onCreate,
  onReorder,
  relayStatus,
  connectedDevices,
  onToggleDevices,
  devicesPanelOpen,
}: TabBarProps) {
  const handleDrag = useCallback((e: React.MouseEvent) => {
    // Only drag if clicking directly on the tab-bar (not on child buttons/tabs)
    if (e.target === e.currentTarget) {
      e.preventDefault();
      getCurrentWindow().startDragging();
    }
  }, []);

  const tabsRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{
    index: number;
    startX: number;
    offsetX: number;
    active: boolean;
  } | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);
  const [dropSide, setDropSide] = useState<'left' | 'right'>('left');
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;

  const getTabIndexAtX = useCallback((clientX: number): number | null => {
    const container = tabsRef.current;
    if (!container) return null;

    const tabs = Array.from(container.querySelectorAll('.tab'));
    for (let i = 0; i < tabs.length; i++) {
      const rect = tabs[i].getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right) {
        return i;
      }
    }

    if (tabs.length > 0) {
      const lastRect = tabs[tabs.length - 1].getBoundingClientRect();
      if (clientX > lastRect.right) return tabs.length - 1;
      const firstRect = tabs[0].getBoundingClientRect();
      if (clientX < firstRect.left) return 0;
    }

    return null;
  }, []);

  const removeGhost = useCallback(() => {
    if (ghostRef.current) {
      ghostRef.current.remove();
      ghostRef.current = null;
    }
  }, []);

  const handleTabMouseDown = useCallback(
    (index: number, e: React.MouseEvent) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest('.tab-close')) return;

      const tabEl = e.currentTarget as HTMLElement;
      const rect = tabEl.getBoundingClientRect();
      dragState.current = {
        index,
        startX: e.clientX,
        offsetX: e.clientX - rect.left,
        active: false,
      };

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const ds = dragState.current;
        if (!ds) return;

        if (!ds.active && Math.abs(moveEvent.clientX - ds.startX) < 5) return;

        if (!ds.active) {
          ds.active = true;
          document.body.style.cursor = 'grabbing';

          // Create floating ghost clone
          const ghost = tabEl.cloneNode(true) as HTMLDivElement;
          ghost.className = 'tab-ghost';
          ghost.style.width = `${rect.width}px`;
          ghost.style.height = `${rect.height}px`;
          document.body.appendChild(ghost);
          ghostRef.current = ghost;
        }

        // Position ghost at cursor
        if (ghostRef.current) {
          ghostRef.current.style.left = `${moveEvent.clientX - ds.offsetX}px`;
          ghostRef.current.style.top = `${rect.top}px`;
        }

        setDragging(ds.index);
        const targetIndex = getTabIndexAtX(moveEvent.clientX);
        if (targetIndex !== null) {
          setDropTarget(targetIndex);
          setDropSide(targetIndex > ds.index ? 'right' : 'left');
        }
      };

      const handleMouseUp = (upEvent: MouseEvent) => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        removeGhost();

        const ds = dragState.current;
        if (ds?.active) {
          const targetIndex = getTabIndexAtX(upEvent.clientX);
          if (targetIndex !== null && targetIndex !== ds.index) {
            onReorderRef.current(ds.index, targetIndex);
          }
          // Focus the dragged tab at its new position
          onSelectRef.current(sessionsRef.current[ds.index].id);
        }

        dragState.current = null;
        setDragging(null);
        setDropTarget(null);
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [getTabIndexAtX, removeGhost],
  );

  return (
    <div className="tab-bar" onMouseDown={handleDrag} data-tauri-drag-region>
      <div
        className={`tabs ${dragging !== null ? 'tabs-dragging' : ''}`}
        ref={tabsRef}
        role="tablist"
        aria-label="Terminal sessions"
      >
        {sessions.map((session, index) => (
          <Tab
            key={session.id}
            session={session}
            isActive={session.id === activeId}
            isDragging={dragging === index}
            isDropTarget={dropTarget === index && dragging !== null && dragging !== index}
            dropSide={dropSide}
            onSelect={onSelect}
            onClose={onClose}
            onMouseDown={(e) => handleTabMouseDown(index, e)}
          />
        ))}
      </div>
      <button
        className="tab-new"
        onClick={onCreate}
        type="button"
        aria-label="New session (Cmd+T)"
        title="New session (Cmd+T)"
      >
        +
      </button>
      <RelayDot
        status={relayStatus}
        connectedDevices={connectedDevices}
        onClick={onToggleDevices}
        active={devicesPanelOpen}
      />
    </div>
  );
}

interface TabProps {
  session: TerminalSession;
  isActive: boolean;
  isDragging: boolean;
  isDropTarget: boolean;
  dropSide: 'left' | 'right';
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onMouseDown: (e: React.MouseEvent) => void;
}

function Tab({
  session,
  isActive,
  isDragging,
  isDropTarget,
  dropSide,
  onSelect,
  onClose,
  onMouseDown,
}: TabProps) {
  const handleClose = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onClose(session.id);
    },
    [onClose, session.id],
  );

  const dropClass = isDropTarget
    ? dropSide === 'right'
      ? 'tab-drop-target-right'
      : 'tab-drop-target'
    : '';

  return (
    <button
      className={`tab ${isActive ? 'tab-active' : ''} ${session.exited ? 'tab-exited' : ''} ${isDragging ? 'tab-dragging' : ''} ${dropClass}`}
      onClick={() => onSelect(session.id)}
      onMouseDown={onMouseDown}
      type="button"
      role="tab"
      aria-selected={isActive}
      aria-label={session.name}
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
      aria-hidden="true"
    >
      <path d={icon.svgPath} />
    </svg>
  );
}

const STATUS_COLORS: Record<RelayStatusType, string> = {
  disconnected: '#888',
  connecting: '#f0a030',
  reconnecting: '#f0a030',
  connected: '#50c878',
  error: '#e05050',
  gated: '#8b8fa3',
};

const STATUS_LABELS: Record<RelayStatusType, string> = {
  disconnected: 'Offline',
  connecting: 'Connecting',
  reconnecting: 'Reconnecting',
  connected: 'Connected',
  error: 'Connection error',
  gated: 'Free Plan',
};

function RelayDot({
  status,
  connectedDevices,
  onClick,
  active,
}: {
  status: RelayStatusType;
  connectedDevices: MergedDevice[];
  onClick?: () => void;
  active?: boolean;
}) {
  const count = connectedDevices.length;

  return (
    <button
      className={`relay-dot-inline${active ? ' relay-dot-active' : ''}`}
      role="status"
      type="button"
      aria-label={`Relay: ${STATUS_LABELS[status]}${count > 0 ? `, ${count} viewers` : ''}. Click to toggle connected devices panel.`}
      title={`${STATUS_LABELS[status]}${count > 0 ? ` — ${count} viewer${count > 1 ? 's' : ''}` : ''}`}
      onClick={onClick}
    >
      <span
        className="relay-dot"
        style={{ backgroundColor: STATUS_COLORS[status] }}
        aria-hidden="true"
      />
      <span className="relay-label">{STATUS_LABELS[status]}</span>
      {count > 0 && <span className="relay-viewers">{count}</span>}
    </button>
  );
}
