import { describe, expect, it } from 'vitest';
import {
  Channel,
  SCROLLBACK_BUFFER_SIZE,
  encodeTerminalData,
  decodeBinaryFrame,
} from '@termpod/protocol';

/**
 * End-to-end scrollback test: simulates the full lifecycle of terminal data
 * flowing through the Session DO's scrollback buffer.
 *
 * Flow: Desktop encodes terminal data → Session DO stores in scrollback →
 * New viewer connects → DO reconstructs scrollback frames → Viewer decodes.
 *
 * This mirrors the exact logic in session.ts appendScrollback() + sendScrollback().
 */

class ScrollbackBuffer {
  private chunks: Uint8Array[] = [];
  private totalSize = 0;

  /** Store a terminal data frame (as received from WebSocket) */
  append(frame: Uint8Array): void {
    this.chunks.push(new Uint8Array(frame));
    this.totalSize += frame.length;

    while (this.totalSize > SCROLLBACK_BUFFER_SIZE && this.chunks.length > 0) {
      const removed = this.chunks.shift()!;
      this.totalSize -= removed.length;
    }
  }

  /**
   * Reconstruct scrollback for a new viewer.
   * Mirrors session.ts sendScrollback() exactly:
   * - Each chunk is a terminal data frame: [0x00, ...payload]
   * - Strip the channel byte (subarray(1)) to get raw terminal output
   * - Wrap in scrollback chunk frame: [0x02, offset:u32, ...payload]
   */
  buildScrollbackFrames(): ArrayBuffer[] {
    const frames: ArrayBuffer[] = [];
    let offset = 0;

    for (const chunk of this.chunks) {
      const payload = chunk.subarray(1); // strip channel byte
      const frame = new Uint8Array(5 + payload.length);
      const view = new DataView(frame.buffer);
      frame[0] = Channel.SCROLLBACK_CHUNK;
      view.setUint32(1, offset, false);
      frame.set(payload, 5);
      frames.push(frame.buffer);
      offset += payload.length;
    }

    return frames;
  }

  get size(): number {
    return this.totalSize;
  }
}

describe('Scrollback end-to-end: encode → store → reconstruct → decode', () => {
  it('single chunk round-trip', () => {
    const buffer = new ScrollbackBuffer();
    const text = 'Hello, terminal!';
    const textBytes = new TextEncoder().encode(text);

    // Desktop sends terminal data
    const frame = encodeTerminalData(textBytes);
    buffer.append(frame);

    // Viewer connects, receives scrollback
    const scrollbackFrames = buffer.buildScrollbackFrames();
    expect(scrollbackFrames.length).toBe(1);

    // Viewer decodes scrollback
    const decoded = decodeBinaryFrame(new Uint8Array(scrollbackFrames[0]));
    expect(decoded.channel).toBe(Channel.SCROLLBACK_CHUNK);

    if (decoded.channel === Channel.SCROLLBACK_CHUNK) {
      expect(decoded.offset).toBe(0);
      expect(new TextDecoder().decode(decoded.data)).toBe(text);
    }
  });

  it('multiple chunks with correct cumulative offsets', () => {
    const buffer = new ScrollbackBuffer();
    const messages = ['Line 1\r\n', 'Line 2\r\n', 'Line 3\r\n'];

    for (const msg of messages) {
      buffer.append(encodeTerminalData(new TextEncoder().encode(msg)));
    }

    const scrollbackFrames = buffer.buildScrollbackFrames();
    expect(scrollbackFrames.length).toBe(3);

    // Verify offsets are cumulative
    let expectedOffset = 0;
    const reconstructed: string[] = [];

    for (const frame of scrollbackFrames) {
      const decoded = decodeBinaryFrame(new Uint8Array(frame));
      expect(decoded.channel).toBe(Channel.SCROLLBACK_CHUNK);

      if (decoded.channel === Channel.SCROLLBACK_CHUNK) {
        expect(decoded.offset).toBe(expectedOffset);
        const text = new TextDecoder().decode(decoded.data);
        reconstructed.push(text);
        expectedOffset += decoded.data.length;
      }
    }

    expect(reconstructed).toEqual(messages);
  });

  it('reconstructed text matches original when concatenated', () => {
    const buffer = new ScrollbackBuffer();
    const originalParts = [
      '\x1b[32m$ \x1b[0mls -la\r\n',
      'total 42\r\n',
      'drwxr-xr-x  5 user  staff  160 Jun  1 12:00 .\r\n',
      '\x1b[32m$ \x1b[0m',
    ];

    for (const part of originalParts) {
      buffer.append(encodeTerminalData(new TextEncoder().encode(part)));
    }

    const scrollbackFrames = buffer.buildScrollbackFrames();
    let fullText = '';

    for (const frame of scrollbackFrames) {
      const decoded = decodeBinaryFrame(new Uint8Array(frame));

      if (decoded.channel === Channel.SCROLLBACK_CHUNK) {
        fullText += new TextDecoder().decode(decoded.data);
      }
    }

    expect(fullText).toBe(originalParts.join(''));
  });

  it('binary data (non-UTF8) round-trips correctly', () => {
    const buffer = new ScrollbackBuffer();
    const binaryData = new Uint8Array(256);

    for (let i = 0; i < 256; i++) {
      binaryData[i] = i;
    }

    buffer.append(encodeTerminalData(binaryData));

    const scrollbackFrames = buffer.buildScrollbackFrames();
    const decoded = decodeBinaryFrame(new Uint8Array(scrollbackFrames[0]));

    if (decoded.channel === Channel.SCROLLBACK_CHUNK) {
      expect(decoded.data).toEqual(binaryData);
    }
  });

  it('eviction preserves most recent data', () => {
    const buffer = new ScrollbackBuffer();
    const chunkPayloadSize = 100 * 1024; // 100KB payload per chunk

    // Fill with 6 chunks (~600KB), exceeding 512KB limit
    for (let i = 0; i < 6; i++) {
      const payload = new Uint8Array(chunkPayloadSize);
      payload.fill(0x30 + i); // '0', '1', '2', '3', '4', '5'
      buffer.append(encodeTerminalData(payload));
    }

    expect(buffer.size).toBeLessThanOrEqual(SCROLLBACK_BUFFER_SIZE);

    const scrollbackFrames = buffer.buildScrollbackFrames();

    // The most recent chunks should be preserved
    const lastFrame = scrollbackFrames[scrollbackFrames.length - 1];
    const decoded = decodeBinaryFrame(new Uint8Array(lastFrame));

    if (decoded.channel === Channel.SCROLLBACK_CHUNK) {
      // Last chunk should be filled with 0x35 ('5')
      expect(decoded.data[0]).toBe(0x35);
    }
  });

  it('empty scrollback produces no frames', () => {
    const buffer = new ScrollbackBuffer();
    const frames = buffer.buildScrollbackFrames();

    expect(frames.length).toBe(0);
  });

  it('many small writes accumulate correctly', () => {
    const buffer = new ScrollbackBuffer();
    const charCount = 1000;

    // Simulate character-by-character typing
    for (let i = 0; i < charCount; i++) {
      const ch = String.fromCharCode(65 + (i % 26)); // A-Z repeating
      buffer.append(encodeTerminalData(new TextEncoder().encode(ch)));
    }

    const scrollbackFrames = buffer.buildScrollbackFrames();
    let fullText = '';

    for (const frame of scrollbackFrames) {
      const decoded = decodeBinaryFrame(new Uint8Array(frame));

      if (decoded.channel === Channel.SCROLLBACK_CHUNK) {
        fullText += new TextDecoder().decode(decoded.data);
      }
    }

    expect(fullText.length).toBe(charCount);
    expect(fullText[0]).toBe('A');
    expect(fullText[25]).toBe('Z');
    expect(fullText[26]).toBe('A');
  });

  it('offsets are contiguous (no gaps or overlaps)', () => {
    const buffer = new ScrollbackBuffer();
    const sizes = [10, 50, 100, 1, 200, 5];

    for (const size of sizes) {
      const payload = new Uint8Array(size);
      payload.fill(0x41);
      buffer.append(encodeTerminalData(payload));
    }

    const scrollbackFrames = buffer.buildScrollbackFrames();
    let expectedOffset = 0;

    for (const frame of scrollbackFrames) {
      const decoded = decodeBinaryFrame(new Uint8Array(frame));

      if (decoded.channel === Channel.SCROLLBACK_CHUNK) {
        expect(decoded.offset).toBe(expectedOffset);
        expectedOffset += decoded.data.length;
      }
    }

    // Final offset should equal total payload bytes
    expect(expectedOffset).toBe(sizes.reduce((a, b) => a + b, 0));
  });
});
