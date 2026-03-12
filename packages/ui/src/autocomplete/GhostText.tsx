import { useEffect, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import type { Terminal as XTerm } from '@xterm/xterm';

interface GhostTextProps {
  terminal: XTerm | null;
  text: string | null;
  foregroundColor?: string;
  opacity?: number;
}

/**
 * GhostText - Renders faded inline autocomplete suggestions
 *
 * Positions text directly after the cursor using xterm's character
 * measurements and renders with a semi-transparent color.
 */
export function GhostText({
  terminal,
  text,
  foregroundColor = '#808080',
  opacity = 0.5,
}: GhostTextProps) {
  const [screenElement, setScreenElement] = useState<HTMLElement | null>(null);

  // Find the xterm screen element when terminal is ready
  useEffect(() => {
    if (!terminal) {
      setScreenElement(null);
      return;
    }

    const timer = setTimeout(() => {
      const xtermElement = terminal.element;
      if (xtermElement) {
        const screen = xtermElement.querySelector('.xterm-screen') as HTMLElement;
        setScreenElement(screen);
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [terminal]);

  // Calculate position synchronously during render
  const position = useMemo(() => {
    if (!terminal || !text) return null;

    const buffer = terminal.buffer.active;
    const cursorX = buffer.cursorX;
    const cursorY = buffer.cursorY;

    const core = (terminal as any)._core;
    const dimensions = core?._renderService?.dimensions;

    if (!dimensions) return null;

    const cellWidth = dimensions.css.cell.width;
    const cellHeight = dimensions.css.cell.height;

    const x = cursorX * cellWidth;
    const y = cursorY * cellHeight;

    return { x, y, cellHeight };
  }, [terminal, text]);

  if (!text || !position || !screenElement) {
    return null;
  }

  const ghost = (
    <span
      data-ghost-text="true"
      style={{
        position: 'absolute',
        left: position.x,
        top: position.y,
        pointerEvents: 'none',
        zIndex: 1000,
        margin: 0,
        padding: 0,
        whiteSpace: 'pre',
        lineHeight: `${position.cellHeight}px`,
        height: `${position.cellHeight}px`,
        fontFamily: terminal?.options.fontFamily || 'monospace',
        fontSize: `${terminal?.options.fontSize || 14}px`,
        fontWeight: String(terminal?.options.fontWeight || 'normal'),
        letterSpacing: 'normal',
        color: foregroundColor,
        opacity: opacity,
        textRendering: 'optimizeLegibility',
        fontVariantLigatures: 'normal',
      }}
    >
      {text}
    </span>
  );

  return createPortal(ghost, screenElement);
}
