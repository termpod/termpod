import { useCallback, useEffect, useRef, useState } from 'react';
import type { PaneNode } from '../hooks/usePaneLayout';

interface PaneContainerProps {
  node: PaneNode;
  renderPane: (sessionId: string, isFocused: boolean) => React.ReactNode;
  focusedPaneId: string | null;
  onFocusPane: (sessionId: string) => void;
  onUpdateRatio: (node: PaneNode, ratio: number) => void;
  onDragEnd?: () => void;
}

export function PaneContainer({
  node,
  renderPane,
  focusedPaneId,
  onFocusPane,
  onUpdateRatio,
  onDragEnd,
}: PaneContainerProps) {
  if (node.type === 'leaf') {
    return (
      <div
        className={`pane-leaf${focusedPaneId === node.sessionId ? ' pane-leaf-focused' : ''}`}
        onMouseDown={() => onFocusPane(node.sessionId)}
      >
        {renderPane(node.sessionId, focusedPaneId === node.sessionId)}
      </div>
    );
  }

  return (
    <SplitPane
      node={node}
      renderPane={renderPane}
      focusedPaneId={focusedPaneId}
      onFocusPane={onFocusPane}
      onUpdateRatio={onUpdateRatio}
      onDragEnd={onDragEnd}
    />
  );
}

interface SplitPaneProps {
  node: PaneNode & { type: 'split' };
  renderPane: (sessionId: string, isFocused: boolean) => React.ReactNode;
  focusedPaneId: string | null;
  onFocusPane: (sessionId: string) => void;
  onUpdateRatio: (node: PaneNode, ratio: number) => void;
  onDragEnd?: () => void;
}

function SplitPane({
  node,
  renderPane,
  focusedPaneId,
  onFocusPane,
  onUpdateRatio,
  onDragEnd,
}: SplitPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  // Keep a live ratio ref so mousemove doesn't need to re-render on each frame
  const ratioRef = useRef(node.ratio);
  // Sync ratioRef when node changes (e.g. from external updateRatio)
  ratioRef.current = node.ratio;

  const isHorizontal = node.direction === 'horizontal';

  const handleDividerMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(true);

      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();

      const onMouseMove = (ev: MouseEvent) => {
        const ratio = isHorizontal
          ? (ev.clientX - rect.left) / rect.width
          : (ev.clientY - rect.top) / rect.height;

        const clamped = Math.max(0.1, Math.min(0.9, ratio));
        ratioRef.current = clamped;
        // Directly update flex values without a React re-render during drag
        const children = container.children;
        if (children.length >= 3) {
          (children[0] as HTMLElement).style.flex = String(clamped);
          (children[2] as HTMLElement).style.flex = String(1 - clamped);
        }
      };

      const onMouseUp = () => {
        setIsDragging(false);
        onUpdateRatio(node, ratioRef.current);
        onDragEnd?.();
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    },
    [isHorizontal, node, onUpdateRatio, onDragEnd],
  );

  // Call fit on all terminals once after drag ends
  useEffect(() => {
    if (!isDragging) return;
    return () => {
      // isDragging just became false — resize will happen via onDragEnd in App
    };
  }, [isDragging]);

  return (
    <div
      ref={containerRef}
      className={`pane-container pane-container-${isHorizontal ? 'horizontal' : 'vertical'}`}
      style={{ pointerEvents: isDragging ? 'none' : undefined }}
    >
      <div
        style={{
          flex: node.ratio,
          overflow: 'hidden',
          position: 'relative',
          minWidth: isHorizontal ? 80 : undefined,
          minHeight: !isHorizontal ? 40 : undefined,
        }}
      >
        <PaneContainer
          node={node.children[0]}
          renderPane={renderPane}
          focusedPaneId={focusedPaneId}
          onFocusPane={onFocusPane}
          onUpdateRatio={onUpdateRatio}
          onDragEnd={onDragEnd}
        />
      </div>
      <div
        className={`pane-divider pane-divider-${isHorizontal ? 'horizontal' : 'vertical'}${isDragging ? ' pane-divider-dragging' : ''}`}
        onMouseDown={handleDividerMouseDown}
        style={{ pointerEvents: 'auto' }}
      />
      <div
        style={{
          flex: 1 - node.ratio,
          overflow: 'hidden',
          position: 'relative',
          minWidth: isHorizontal ? 80 : undefined,
          minHeight: !isHorizontal ? 40 : undefined,
        }}
      >
        <PaneContainer
          node={node.children[1]}
          renderPane={renderPane}
          focusedPaneId={focusedPaneId}
          onFocusPane={onFocusPane}
          onUpdateRatio={onUpdateRatio}
          onDragEnd={onDragEnd}
        />
      </div>
    </div>
  );
}
