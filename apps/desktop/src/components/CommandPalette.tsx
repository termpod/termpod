import { useCallback, useEffect, useRef, useState } from 'react';
import { getResolvedBindings, formatShortcut } from '../hooks/useKeybindings';

interface CommandPaletteProps {
  onClose: () => void;
  onExecute: (id: string) => void;
}

export function CommandPalette({ onClose, onExecute }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const commands = getResolvedBindings();

  const filtered = query
    ? commands.filter((cmd) => {
        const q = query.toLowerCase();
        const label = cmd.label.toLowerCase();
        const category = cmd.category.toLowerCase();
        return label.includes(q) || category.includes(q);
      })
    : commands;

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Scroll selected item into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const item = list.children[selectedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          if (filtered[selectedIndex]) {
            onExecute(filtered[selectedIndex].id);
          }
          break;
      }
    },
    [filtered, selectedIndex, onClose, onExecute],
  );

  return (
    <div className="cp-overlay" onClick={onClose}>
      <div className="cp-container" onClick={(e) => e.stopPropagation()}>
        <div className="cp-input-wrap">
          <span className="cp-input-icon">&gt;</span>
          <input
            ref={inputRef}
            className="cp-input"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command..."
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        <div className="cp-list" ref={listRef}>
          {filtered.length === 0 && <div className="cp-empty">No matching commands</div>}
          {filtered.map((cmd, i) => (
            <button
              key={cmd.id}
              className={`cp-item ${i === selectedIndex ? 'cp-item-selected' : ''}`}
              onClick={() => onExecute(cmd.id)}
              onMouseEnter={() => setSelectedIndex(i)}
              type="button"
            >
              <span className="cp-item-category">{cmd.category}</span>
              <span className="cp-item-label">{cmd.label}</span>
              <kbd className="cp-item-shortcut">{formatShortcut(cmd.shortcut)}</kbd>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
