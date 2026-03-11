export interface BlockBoundary {
  marker: 'A' | 'B' | 'C' | 'D';
  line: number;
  exitCode?: number;
}

export interface CommandBlock {
  id: string;
  promptLine: number;
  inputLine?: number;
  outputLine?: number;
  endLine?: number;
  exitCode?: number;
  startTime: number;
  endTime?: number;
  complete: boolean;
}

export class BlockTracker {
  private blocks: CommandBlock[] = [];
  private nextId = 1;
  private onChange?: () => void;

  constructor(onChange?: () => void) {
    this.onChange = onChange;
  }

  handleBoundary(boundary: BlockBoundary): void {
    switch (boundary.marker) {
      case 'A': {
        this.blocks.push({
          id: `block-${this.nextId++}`,
          promptLine: boundary.line,
          startTime: Date.now(),
          complete: false,
        });
        break;
      }

      case 'B': {
        const block = this.current();

        if (block && !block.complete) {
          block.inputLine = boundary.line;
        }

        break;
      }

      case 'C': {
        const block = this.current();

        if (block && !block.complete) {
          block.outputLine = boundary.line;
        }

        break;
      }

      case 'D': {
        const block = this.current();

        if (block && !block.complete) {
          block.endLine = boundary.line;
          block.exitCode = boundary.exitCode;
          block.endTime = Date.now();
          block.complete = true;
        }

        break;
      }
    }

    this.onChange?.();
  }

  getBlocks(): readonly CommandBlock[] {
    return this.blocks;
  }

  current(): CommandBlock | null {
    return this.blocks[this.blocks.length - 1] ?? null;
  }

  clear(): void {
    this.blocks = [];
    this.onChange?.();
  }
}
