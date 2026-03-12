import type { Terminal as XTerm, IMarker, IDecoration } from '@xterm/xterm';

interface TrackedBlock {
  promptMarker: IMarker;
  inputCol: number;
  outputMarker: IMarker | null;
  endMarker: IMarker | null;
  exitCode?: number;
  complete: boolean;
  separatorDec: IDecoration | null;
  actionsDec: IDecoration | null;
}

export class BlockDecorationManager {
  private term: XTerm;
  private blocks: TrackedBlock[] = [];
  private onRerun?: (command: string) => void;
  private onSaveWorkflow?: (command: string) => void;
  private mode: 'full' | 'minimal';

  constructor(
    term: XTerm,
    onRerun?: (command: string) => void,
    onSaveWorkflow?: (command: string) => void,
    mode: 'full' | 'minimal' = 'full',
  ) {
    this.term = term;
    this.onRerun = onRerun;
    this.onSaveWorkflow = onSaveWorkflow;
    this.mode = mode;
  }

  handleMarker(marker: 'A' | 'B' | 'C' | 'D', exitCode?: number): void {
    switch (marker) {
      case 'A': {
        const m = this.term.registerMarker(0);

        if (!m) {
          return;
        }

        // Check if we're at the top of the terminal (e.g., after clear command)
        const isAtTop = m.line === 0;

        // Full mode adds visual spacing between command blocks.
        if (this.mode === 'full' && this.blocks.length > 0 && !isAtTop) {
          this.term.write('\n');
        }

        const block: TrackedBlock = {
          promptMarker: m,
          inputCol: 0,
          outputMarker: null,
          endMarker: null,
          complete: false,
          separatorDec: null,
          actionsDec: null,
        };

        if (this.mode === 'full' && this.blocks.length > 0 && !isAtTop) {
          this.createSeparator(block);
        }

        this.blocks.push(block);
        break;
      }

      case 'B': {
        const current = this.current();

        if (current && !current.complete) {
          current.inputCol = this.term.buffer.active.cursorX;
        }

        break;
      }

      case 'C': {
        const current = this.current();

        if (current && !current.complete) {
          current.outputMarker = this.term.registerMarker(0);
        }

        break;
      }

      case 'D': {
        const current = this.current();

        if (current && !current.complete) {
          current.endMarker = this.term.registerMarker(0);
          current.exitCode = exitCode;
          current.complete = true;
          if (this.mode === 'full') {
            this.createActions(current);
          }
        }

        break;
      }
    }
  }

  private createSeparator(block: TrackedBlock): void {
    const dec = this.term.registerDecoration({
      marker: block.promptMarker,
      width: this.term.cols,
      height: 1,
      layer: 'bottom',
    });

    if (!dec) {
      return;
    }

    block.separatorDec = dec;

    dec.onRender((el) => {
      if (el.dataset.init) {
        return;
      }

      el.dataset.init = '1';
      el.style.borderTop = '1px solid rgba(255, 255, 255, 0.15)';
      // Center separator in the blank line between blocks
      el.style.transform = 'translateY(50%)';
      el.style.pointerEvents = 'none';
    });
  }

  private createActions(block: TrackedBlock): void {
    const dec = this.term.registerDecoration({
      marker: block.promptMarker,
      width: this.term.cols,
      height: 1,
      layer: 'top',
    });

    if (!dec) {
      return;
    }

    block.actionsDec = dec;
    const success = block.exitCode === 0;

    dec.onRender((el) => {
      if (el.dataset.init) {
        return;
      }

      el.dataset.init = '1';
      el.style.pointerEvents = 'none';
      el.style.overflow = 'visible';

      // Small badge always visible at the right edge
      const badge = document.createElement('span');
      Object.assign(badge.style, {
        position: 'absolute',
        right: '8px',
        top: '50%',
        transform: 'translateY(50%)',
        fontSize: '10px',
        fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
        fontWeight: '500',
        color: success ? 'rgba(80, 200, 120, 0.35)' : 'rgba(247, 118, 142, 0.5)',
        lineHeight: '1',
        pointerEvents: 'auto',
        cursor: 'default',
        padding: '2px',
      });
      badge.textContent = success ? '✓' : '✗';

      // Action bar — hidden, shown on hover
      const bar = document.createElement('div');
      Object.assign(bar.style, {
        position: 'absolute',
        right: '4px',
        top: '50%',
        transform: 'translateY(50%)',
        display: 'flex',
        alignItems: 'center',
        gap: '1px',
        padding: '2px 3px',
        borderRadius: '6px',
        background: 'rgba(30, 32, 48, 0.95)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
        pointerEvents: 'auto',
        opacity: '0',
        transition: 'opacity 0.12s ease',
        zIndex: '10',
      });

      const showBar = () => {
        bar.style.opacity = '1';
        badge.style.opacity = '0';
      };
      const hideBar = () => {
        bar.style.opacity = '0';
        badge.style.opacity = '1';
      };

      badge.addEventListener('mouseenter', showBar);
      bar.addEventListener('mouseenter', showBar);
      bar.addEventListener('mouseleave', hideBar);

      // Exit badge inside bar
      const exitBadge = document.createElement('span');
      Object.assign(exitBadge.style, {
        fontSize: '10px',
        fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
        fontWeight: '600',
        color: success ? '#50c878' : '#f7768e',
        lineHeight: '1',
        padding: '3px 6px',
      });
      exitBadge.textContent = success ? '✓' : `✗ ${block.exitCode}`;
      bar.appendChild(exitBadge);

      // Divider
      const divider = document.createElement('div');
      Object.assign(divider.style, {
        width: '1px',
        height: '12px',
        background: 'rgba(255, 255, 255, 0.08)',
      });
      bar.appendChild(divider);

      // Copy output button
      bar.appendChild(
        this.createButton('Copy', () => {
          this.copyBlockOutput(block);
          copyLabel.textContent = 'Copied!';
          setTimeout(() => {
            copyLabel.textContent = 'Copy';
          }, 1200);
        }),
      );
      const copyLabel = bar.lastElementChild as HTMLButtonElement;

      // Re-run and Save buttons
      const cmd = this.getCommandText(block);

      if (cmd) {
        if (this.onRerun) {
          bar.appendChild(this.createButton('Re-run', () => this.onRerun?.(cmd + '\n')));
        }

        if (this.onSaveWorkflow) {
          bar.appendChild(this.createButton('Save', () => this.onSaveWorkflow?.(cmd)));
        }
      }

      el.appendChild(badge);
      el.appendChild(bar);
    });
  }

  private createButton(label: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = label;
    Object.assign(btn.style, {
      fontSize: '11px',
      fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
      fontWeight: '500',
      padding: '3px 8px',
      border: 'none',
      borderRadius: '4px',
      background: 'transparent',
      color: 'rgba(255, 255, 255, 0.6)',
      cursor: 'pointer',
      lineHeight: '1',
      whiteSpace: 'nowrap',
      transition: 'background 0.1s, color 0.1s',
    });

    btn.addEventListener('mouseenter', () => {
      btn.style.background = 'rgba(255, 255, 255, 0.1)';
      btn.style.color = '#fff';
    });

    btn.addEventListener('mouseleave', () => {
      btn.style.background = 'transparent';
      btn.style.color = 'rgba(255, 255, 255, 0.6)';
    });

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      onClick();
    });

    return btn;
  }

  private copyBlockOutput(block: TrackedBlock): void {
    if (!block.outputMarker || !block.endMarker) {
      return;
    }

    const startLine = block.outputMarker.line;
    const endLine = block.endMarker.line;
    const lines: string[] = [];

    for (let i = startLine; i <= endLine; i++) {
      const bufLine = this.term.buffer.active.getLine(i);

      if (bufLine) {
        lines.push(bufLine.translateToString(true));
      }
    }

    const text = lines.join('\n').trimEnd();

    if (text) {
      navigator.clipboard.writeText(text);
    }
  }

  private getCommandText(block: TrackedBlock): string | null {
    if (!block.outputMarker) {
      return null;
    }

    const promptLine = block.promptMarker.line;
    const outputLine = block.outputMarker.line;
    const lines: string[] = [];

    for (let i = promptLine; i < outputLine; i++) {
      const bufLine = this.term.buffer.active.getLine(i);

      if (bufLine) {
        const text = bufLine.translateToString(true);

        if (i === promptLine && block.inputCol > 0) {
          lines.push(text.slice(block.inputCol));
        } else {
          lines.push(text);
        }
      }
    }

    const command = lines.join('\n').trimEnd();

    return command || null;
  }

  dispose(): void {
    for (const block of this.blocks) {
      block.separatorDec?.dispose();
      block.actionsDec?.dispose();
      block.promptMarker.dispose();
      block.outputMarker?.dispose();
      block.endMarker?.dispose();
    }

    this.blocks = [];
  }

  private current(): TrackedBlock | null {
    return this.blocks[this.blocks.length - 1] ?? null;
  }
}
