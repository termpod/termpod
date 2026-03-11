import { describe, it, expect, vi } from 'vitest';
import { BlockTracker } from './blocks';

describe('BlockTracker', () => {
  it('creates a block on A marker', () => {
    const tracker = new BlockTracker();
    tracker.handleBoundary({ marker: 'A', line: 0 });

    const blocks = tracker.getBlocks();
    expect(blocks).toHaveLength(1);
    expect(blocks[0].promptLine).toBe(0);
    expect(blocks[0].complete).toBe(false);
  });

  it('tracks full A → B → C → D lifecycle', () => {
    const tracker = new BlockTracker();
    tracker.handleBoundary({ marker: 'A', line: 0 });
    tracker.handleBoundary({ marker: 'B', line: 0 });
    tracker.handleBoundary({ marker: 'C', line: 1 });
    tracker.handleBoundary({ marker: 'D', line: 5, exitCode: 0 });

    const block = tracker.current();
    expect(block).not.toBeNull();
    expect(block!.inputLine).toBe(0);
    expect(block!.outputLine).toBe(1);
    expect(block!.endLine).toBe(5);
    expect(block!.exitCode).toBe(0);
    expect(block!.complete).toBe(true);
    expect(block!.endTime).toBeGreaterThan(0);
  });

  it('tracks non-zero exit codes', () => {
    const tracker = new BlockTracker();
    tracker.handleBoundary({ marker: 'A', line: 0 });
    tracker.handleBoundary({ marker: 'C', line: 1 });
    tracker.handleBoundary({ marker: 'D', line: 3, exitCode: 127 });

    expect(tracker.current()!.exitCode).toBe(127);
  });

  it('tracks multiple blocks', () => {
    const tracker = new BlockTracker();
    tracker.handleBoundary({ marker: 'A', line: 0 });
    tracker.handleBoundary({ marker: 'D', line: 2, exitCode: 0 });
    tracker.handleBoundary({ marker: 'A', line: 3 });
    tracker.handleBoundary({ marker: 'D', line: 5, exitCode: 1 });

    const blocks = tracker.getBlocks();
    expect(blocks).toHaveLength(2);
    expect(blocks[0].exitCode).toBe(0);
    expect(blocks[1].exitCode).toBe(1);
  });

  it('ignores B/C/D without a preceding A', () => {
    const tracker = new BlockTracker();
    tracker.handleBoundary({ marker: 'B', line: 0 });
    tracker.handleBoundary({ marker: 'C', line: 1 });
    tracker.handleBoundary({ marker: 'D', line: 2, exitCode: 0 });

    expect(tracker.getBlocks()).toHaveLength(0);
  });

  it('ignores markers after block is complete', () => {
    const tracker = new BlockTracker();
    tracker.handleBoundary({ marker: 'A', line: 0 });
    tracker.handleBoundary({ marker: 'D', line: 2, exitCode: 0 });
    tracker.handleBoundary({ marker: 'C', line: 3 });

    expect(tracker.current()!.outputLine).toBeUndefined();
  });

  it('calls onChange callback', () => {
    const onChange = vi.fn();
    const tracker = new BlockTracker(onChange);
    tracker.handleBoundary({ marker: 'A', line: 0 });

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('clears all blocks', () => {
    const onChange = vi.fn();
    const tracker = new BlockTracker(onChange);
    tracker.handleBoundary({ marker: 'A', line: 0 });
    tracker.clear();

    expect(tracker.getBlocks()).toHaveLength(0);
    expect(tracker.current()).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('assigns unique ids to blocks', () => {
    const tracker = new BlockTracker();
    tracker.handleBoundary({ marker: 'A', line: 0 });
    tracker.handleBoundary({ marker: 'A', line: 5 });

    const blocks = tracker.getBlocks();
    expect(blocks[0].id).not.toBe(blocks[1].id);
  });
});
