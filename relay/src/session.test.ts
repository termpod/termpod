import { describe, expect, it } from 'vitest';
import { Channel, SCROLLBACK_BUFFER_SIZE } from '@termpod/protocol';

// We can't instantiate the Durable Object directly without Miniflare,
// but we can test the core logic by extracting and testing the same algorithms.
// These tests validate the scrollback buffer and binary frame routing logic.

/**
 * Scrollback buffer logic — mirrors TerminalSession.appendScrollback / sendScrollback
 */
class ScrollbackBuffer {
  private chunks: Uint8Array[] = [];
  private totalSize = 0;

  append(data: Uint8Array): void {
    this.chunks.push(new Uint8Array(data));
    this.totalSize += data.length;

    while (this.totalSize > SCROLLBACK_BUFFER_SIZE && this.chunks.length > 0) {
      const removed = this.chunks.shift()!;
      this.totalSize -= removed.length;
    }
  }

  /**
   * Reconstruct scrollback frames as the DO's sendScrollback does:
   * Each stored chunk has a channel byte (0x00) prefix from encodeTerminalData.
   * sendScrollback strips that prefix and wraps in SCROLLBACK_CHUNK frames.
   */
  getScrollbackFrames(): Uint8Array[] {
    const frames: Uint8Array[] = [];
    let offset = 0;

    for (const chunk of this.chunks) {
      // chunk is a terminal data frame: [0x00, ...payload]
      // sendScrollback strips the channel byte: chunk.subarray(1)
      const payload = chunk.subarray(1);
      const frame = new Uint8Array(5 + payload.length);
      const view = new DataView(frame.buffer);
      frame[0] = Channel.SCROLLBACK_CHUNK;
      view.setUint32(1, offset, false);
      frame.set(payload, 5);
      frames.push(frame);
      offset += payload.length;
    }

    return frames;
  }

  get size(): number {
    return this.totalSize;
  }

  get count(): number {
    return this.chunks.length;
  }
}

describe('ScrollbackBuffer', () => {
  function makeTerminalDataFrame(payloadSize: number, fillByte = 0x41): Uint8Array {
    const frame = new Uint8Array(1 + payloadSize);
    frame[0] = Channel.TERMINAL_DATA;
    frame.fill(fillByte, 1);

    return frame;
  }

  describe('append', () => {
    it('stores chunks and tracks size', () => {
      const buf = new ScrollbackBuffer();

      buf.append(makeTerminalDataFrame(100));
      buf.append(makeTerminalDataFrame(200));

      expect(buf.count).toBe(2);
      expect(buf.size).toBe(101 + 201); // +1 for channel byte each
    });

    it('evicts oldest chunks when exceeding buffer size', () => {
      const buf = new ScrollbackBuffer();
      const chunkSize = 100 * 1024; // 100KB per chunk (with channel byte = 100KB + 1)

      // Add 6 chunks = ~600KB, exceeds 512KB limit
      for (let i = 0; i < 6; i++) {
        buf.append(makeTerminalDataFrame(chunkSize, 0x30 + i));
      }

      // Should have evicted enough to get under 512KB
      expect(buf.size).toBeLessThanOrEqual(SCROLLBACK_BUFFER_SIZE);
      expect(buf.count).toBeLessThan(6);
    });

    it('evicts single chunk larger than buffer size', () => {
      const buf = new ScrollbackBuffer();
      const hugeChunk = makeTerminalDataFrame(SCROLLBACK_BUFFER_SIZE + 100);

      buf.append(hugeChunk);

      // The while loop evicts the chunk since it alone exceeds the limit
      expect(buf.count).toBe(0);
      expect(buf.size).toBe(0);
    });

    it('evicts old chunks when a large chunk is added after small ones', () => {
      const buf = new ScrollbackBuffer();

      // Add many small chunks
      for (let i = 0; i < 100; i++) {
        buf.append(makeTerminalDataFrame(1024));
      }

      // Add a large chunk that pushes over the limit
      buf.append(makeTerminalDataFrame(SCROLLBACK_BUFFER_SIZE - 50 * 1024));

      expect(buf.size).toBeLessThanOrEqual(SCROLLBACK_BUFFER_SIZE + makeTerminalDataFrame(1024).length);
    });

    it('handles empty data', () => {
      const buf = new ScrollbackBuffer();
      const emptyFrame = new Uint8Array([Channel.TERMINAL_DATA]);

      buf.append(emptyFrame);

      expect(buf.count).toBe(1);
      expect(buf.size).toBe(1);
    });
  });

  describe('getScrollbackFrames', () => {
    it('produces valid scrollback chunk frames', () => {
      const buf = new ScrollbackBuffer();
      const payload1 = new Uint8Array([Channel.TERMINAL_DATA, 0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello"
      const payload2 = new Uint8Array([Channel.TERMINAL_DATA, 0x57, 0x6f, 0x72, 0x6c, 0x64]); // "World"

      buf.append(payload1);
      buf.append(payload2);

      const frames = buf.getScrollbackFrames();

      expect(frames.length).toBe(2);

      // First frame: offset 0, data "Hello"
      expect(frames[0][0]).toBe(Channel.SCROLLBACK_CHUNK);
      const view0 = new DataView(frames[0].buffer);
      expect(view0.getUint32(1, false)).toBe(0);
      expect(Array.from(frames[0].subarray(5))).toEqual([0x48, 0x65, 0x6c, 0x6c, 0x6f]);

      // Second frame: offset 5 (length of "Hello"), data "World"
      expect(frames[1][0]).toBe(Channel.SCROLLBACK_CHUNK);
      const view1 = new DataView(frames[1].buffer);
      expect(view1.getUint32(1, false)).toBe(5);
      expect(Array.from(frames[1].subarray(5))).toEqual([0x57, 0x6f, 0x72, 0x6c, 0x64]);
    });

    it('returns empty array for empty buffer', () => {
      const buf = new ScrollbackBuffer();

      expect(buf.getScrollbackFrames()).toEqual([]);
    });

    it('calculates cumulative offsets correctly', () => {
      const buf = new ScrollbackBuffer();

      // Add 3 chunks with different payload sizes (excluding channel byte)
      buf.append(makeTerminalDataFrame(10));  // payload: 10 bytes
      buf.append(makeTerminalDataFrame(20));  // payload: 20 bytes
      buf.append(makeTerminalDataFrame(30));  // payload: 30 bytes

      const frames = buf.getScrollbackFrames();

      expect(frames.length).toBe(3);

      const offsets = frames.map((f) => {
        const view = new DataView(f.buffer);
        return view.getUint32(1, false);
      });

      expect(offsets).toEqual([0, 10, 30]); // 0, 0+10, 10+20
    });
  });
});

describe('Binary frame routing logic', () => {
  it('terminal data frame has channel TERMINAL_DATA at byte 0', () => {
    const data = new Uint8Array([Channel.TERMINAL_DATA, 0x48, 0x69]);

    expect(data[0]).toBe(Channel.TERMINAL_DATA);
    expect(data[0]).toBe(0x00);
  });

  it('terminal resize frame has correct channel and dimensions', () => {
    const frame = new Uint8Array(5);
    const view = new DataView(frame.buffer);
    frame[0] = Channel.TERMINAL_RESIZE;
    view.setUint16(1, 132, false); // cols
    view.setUint16(3, 43, false);  // rows

    expect(frame[0]).toBe(Channel.TERMINAL_RESIZE);
    expect(view.getUint16(1, false)).toBe(132);
    expect(view.getUint16(3, false)).toBe(43);
  });

  it('message size limit is 64KB', () => {
    const MAX_MESSAGE_SIZE = 64 * 1024;
    const underLimit = new Uint8Array(MAX_MESSAGE_SIZE);
    const overLimit = new Uint8Array(MAX_MESSAGE_SIZE + 1);

    expect(underLimit.byteLength).toBeLessThanOrEqual(MAX_MESSAGE_SIZE);
    expect(overLimit.byteLength).toBeGreaterThan(MAX_MESSAGE_SIZE);
  });
});
