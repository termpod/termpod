import { useEffect, useRef, useState, useMemo } from 'react';
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
  const canvasRef = useRef<HTMLCanvasElement>(null);
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

    return { x, y };
  }, [terminal, text]);

  // Draw on canvas when text/position changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !text || !position) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const fontSize = terminal?.options.fontSize || 14;
    const fontFamily = terminal?.options.fontFamily || 'monospace';
    const fontWeight = terminal?.options.fontWeight || 'normal';

    ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
    const metrics = ctx.measureText(text);

    const padding = 2;
    canvas.width = Math.ceil(metrics.width) + padding * 2;
    canvas.height = Math.ceil(fontSize * 1.2);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
    ctx.fillStyle = foregroundColor;
    ctx.globalAlpha = opacity;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, padding, canvas.height / 2);
  }, [text, position, terminal, foregroundColor, opacity]);

  if (!text || !position || !screenElement) {
    return null;
  }

  const canvas = (
    <canvas
      ref={canvasRef}
      data-ghost-text="true"
      style={{
        position: 'absolute',
        left: position.x,
        top: position.y,
        pointerEvents: 'none',
        zIndex: 1000,
        opacity: opacity,
        mixBlendMode: 'normal',
        background: 'transparent',
      }}
    />
  );

  return createPortal(canvas, screenElement);
}
