import React, { useEffect, useRef, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import type { Suggestion } from '@termpod/shared';
import type { Terminal as XTerm } from '@xterm/xterm';

interface AutocompletePopupProps {
  terminal: XTerm | null;
  suggestions: Suggestion[];
  selectedIndex: number;
  onSelectedIndexChange: (index: number) => void;
  onSelect: (suggestion: Suggestion) => void;
  onClose: () => void;
}

/**
 * AutocompletePopup - Dropdown menu for command suggestions
 *
 * Shows context-aware completions with icons and descriptions.
 * Positioned above the cursor like VS Code's IntelliSense.
 */
export function AutocompletePopup({
  terminal,
  suggestions,
  selectedIndex,
  onSelectedIndexChange,
  onSelect,
  onClose,
}: AutocompletePopupProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const enterSelectArmedRef = useRef(false);

  // Mount popup to body to avoid xterm/canvas stacking context clipping.
  useEffect(() => {
    setPortalRoot(document.body);
  }, []);

  // Reset Enter-to-select arming whenever suggestion set changes.
  useEffect(() => {
    enterSelectArmedRef.current = false;
  }, [suggestions]);

  // Calculate fixed viewport position.
  const position = useMemo(() => {
    if (!terminal || suggestions.length === 0) return null;

    const buffer = terminal.buffer.active;
    const cursorX = buffer.cursorX;
    const cursorY = buffer.cursorY;

    const core = (terminal as any)._core;
    const dimensions = core?._renderService?.dimensions;

    if (!dimensions) return null;

    const cellWidth = dimensions.css.cell.width;
    const cellHeight = dimensions.css.cell.height;
    const termRect = terminal.element?.getBoundingClientRect();
    if (!termRect) return null;

    const longestText = suggestions.reduce((max, s) => Math.max(max, s.text.length), 0);
    const longestDescription = suggestions.reduce(
      (max, s) => Math.max(max, s.description?.length ?? 0),
      0,
    );
    const contentChars = Math.max(longestText, longestDescription);
    const estimatedWidth = Math.round(contentChars * cellWidth + 64);
    const popupWidth = Math.min(420, Math.max(220, estimatedWidth));
    const rowHeight = 28;
    const popupHeight = suggestions.length * rowHeight + 8;

    const cursorLeft = termRect.left + cursorX * cellWidth;
    const cursorTop = termRect.top + cursorY * cellHeight;

    const left = Math.min(Math.max(8, cursorLeft + 2), window.innerWidth - popupWidth - 8);
    const aboveTop = cursorTop - popupHeight - 6;
    const belowTop = cursorTop + cellHeight + 6;
    const top =
      aboveTop >= 8 ? aboveTop : Math.min(belowTop, Math.max(8, window.innerHeight - popupHeight - 8));

    return { left, top, width: popupWidth };
  }, [terminal, suggestions]);

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (suggestions.length === 0) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          e.stopPropagation();
          enterSelectArmedRef.current = true;
          onSelectedIndexChange((selectedIndex + 1) % suggestions.length);
          break;
        case 'ArrowUp':
          e.preventDefault();
          e.stopPropagation();
          enterSelectArmedRef.current = true;
          onSelectedIndexChange((selectedIndex - 1 + suggestions.length) % suggestions.length);
          break;
        case 'Escape':
          e.stopPropagation();
          enterSelectArmedRef.current = false;
          onClose();
          break;
        case 'Enter':
          if (
            enterSelectArmedRef.current &&
            selectedIndex >= 0 &&
            selectedIndex < suggestions.length
          ) {
            e.preventDefault();
            e.stopPropagation();
            onSelect(suggestions[selectedIndex]);
            enterSelectArmedRef.current = false;
          }
          break;
        case 'Tab':
          if (selectedIndex >= 0 && selectedIndex < suggestions.length) {
            e.preventDefault();
            e.stopPropagation();
            onSelect(suggestions[selectedIndex]);
            enterSelectArmedRef.current = false;
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [suggestions, selectedIndex, onSelectedIndexChange, onSelect, onClose]);

  // Handle clicks outside to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    window.addEventListener('click', handleClickOutside);
    return () => window.removeEventListener('click', handleClickOutside);
  }, [onClose]);

  if (!position || suggestions.length === 0 || !portalRoot) {
    return null;
  }

  const popup = (
    <div
      ref={containerRef}
      style={{
        position: 'fixed',
        left: position.left,
        top: position.top,
        width: position.width,
        zIndex: 2147483000,
        pointerEvents: 'auto',
        backgroundColor: 'rgba(12, 16, 26, 0.96)',
        border: '1px solid rgba(96, 115, 160, 0.5)',
        borderRadius: '8px',
        boxShadow: '0 12px 30px rgba(0, 8, 20, 0.5)',
        backdropFilter: 'blur(8px)',
        maxWidth: '320px',
        minWidth: '220px',
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#d7e2ff',
        overflow: 'hidden',
      }}
    >
      {suggestions.map((suggestion, index) => (
        <div
          key={suggestion.text + index}
          onMouseDown={(e) => {
            e.preventDefault();
            onSelectedIndexChange(index);
            onSelect(suggestion);
          }}
          onMouseEnter={() => onSelectedIndexChange(index)}
          style={{
            padding: '5px 8px',
            cursor: 'pointer',
            backgroundColor: index === selectedIndex ? 'rgba(84, 125, 214, 0.25)' : 'transparent',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            borderBottom:
              index < suggestions.length - 1 ? '1px solid rgba(65, 84, 128, 0.35)' : 'none',
          }}
        >
          <SuggestionIcon type={suggestion.type} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {highlightMatch(suggestion.text, suggestion.text)}
            </div>
            {suggestion.description && index === selectedIndex && (
              <div
                style={{
                  fontSize: '10px',
                  color: '#9cb2e8',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {suggestion.description}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );

  return createPortal(popup, portalRoot);
}

/**
 * Icon component for different suggestion types
 */
function SuggestionIcon({ type }: { type: Suggestion['type'] }) {
  const icons: Record<string, string> = {
    history: 'H',
    file: 'F',
    command: 'C',
  };

  return (
    <span
      style={{
        fontSize: '10px',
        width: '16px',
        height: '16px',
        lineHeight: '16px',
        textAlign: 'center',
        borderRadius: '999px',
        border: '1px solid rgba(120, 145, 202, 0.6)',
        color: '#a9c0f7',
        flexShrink: 0,
      }}
    >
      {icons[type] || '•'}
    </span>
  );
}

/**
 * Highlight the matching portion of the suggestion
 */
function highlightMatch(text: string, match: string): React.ReactElement {
  return <>{text}</>;
}
