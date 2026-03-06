import { useCallback, useEffect, useRef, useState } from 'react';
import { useKeybindings, formatShortcut, eventToShortcut, DEFAULT_KEYBINDINGS } from '../hooks/useKeybindings';

interface KeybindingsPanelProps {
  onClose: () => void;
}

export function KeybindingsPanel({ onClose }: KeybindingsPanelProps) {
  const { bindings, updateBinding, resetBinding, resetAll } = useKeybindings();
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [pendingShortcut, setPendingShortcut] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (recordingId) {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === 'Escape') {
        setRecordingId(null);
        setPendingShortcut(null);
        setConflict(null);
        return;
      }

      const shortcut = eventToShortcut(e);
      if (!shortcut) return;

      // Check for conflicts
      const existing = bindings.find(
        (b) => b.id !== recordingId && b.shortcut.toLowerCase() === shortcut.toLowerCase(),
      );

      if (existing) {
        setConflict(existing.label);
        setPendingShortcut(shortcut);
        return;
      }

      setConflict(null);
      setPendingShortcut(null);
      updateBinding(recordingId, shortcut);
      setRecordingId(null);
      return;
    }

    if (e.key === 'Escape') {
      onClose();
    }
  }, [recordingId, bindings, updateBinding, onClose]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [handleKeyDown]);

  const getDefault = (id: string) =>
    DEFAULT_KEYBINDINGS.find((kb) => kb.id === id)?.shortcut ?? '';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={modalRef}
        className="modal-panel kb-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Keyboard Shortcuts"
      >
        <div className="modal-header">
          <span>Keyboard Shortcuts</span>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>

        <div className="kb-list">
          {bindings.map((kb) => (
            <div
              key={kb.id}
              className={`kb-row ${recordingId === kb.id ? 'kb-row-recording' : ''}`}
            >
              <span className="kb-label">{kb.label}</span>

              <div className="kb-shortcut-area">
                {recordingId === kb.id ? (
                  <div className="kb-recording">
                    <span className="kb-recording-text">
                      {pendingShortcut
                        ? formatShortcut(pendingShortcut)
                        : 'Press shortcut...'}
                    </span>
                    {conflict && (
                      <span className="kb-conflict">
                        Already used by {conflict}
                      </span>
                    )}
                  </div>
                ) : (
                  <button
                    className="kb-shortcut-btn"
                    onClick={() => {
                      setRecordingId(kb.id);
                      setPendingShortcut(null);
                      setConflict(null);
                    }}
                    title="Click to reassign"
                  >
                    <kbd className="kb-kbd">{formatShortcut(kb.shortcut)}</kbd>
                  </button>
                )}

                {kb.isCustom && recordingId !== kb.id && (
                  <button
                    className="kb-reset-btn"
                    onClick={() => resetBinding(kb.id)}
                    title={`Reset to ${formatShortcut(getDefault(kb.id))}`}
                    aria-label={`Reset ${kb.label} to default`}
                  >
                    ↺
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="kb-footer">
          <span className="kb-hint">Click a shortcut to reassign. Press Esc to cancel.</span>
          <button className="btn-secondary" onClick={resetAll}>
            Reset All
          </button>
        </div>
      </div>
    </div>
  );
}
