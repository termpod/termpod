import { describe, expect, it } from 'vitest';
import { Channel } from './constants.js';
import {
  decodeBinaryFrame,
  encodeScrollbackChunk,
  encodeTerminalData,
  encodeTerminalResize,
} from './binary.js';

describe('encodeTerminalData', () => {
  it('encodes data with channel byte prefix', () => {
    const data = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello"
    const frame = encodeTerminalData(data);

    expect(frame[0]).toBe(Channel.TERMINAL_DATA);
    expect(frame.slice(1)).toEqual(data);
    expect(frame.length).toBe(1 + data.length);
  });

  it('handles empty data', () => {
    const frame = encodeTerminalData(new Uint8Array(0));

    expect(frame.length).toBe(1);
    expect(frame[0]).toBe(Channel.TERMINAL_DATA);
  });

  it('handles large payloads', () => {
    const data = new Uint8Array(64 * 1024);
    data.fill(0xab);
    const frame = encodeTerminalData(data);

    expect(frame.length).toBe(1 + 64 * 1024);
    expect(frame[0]).toBe(Channel.TERMINAL_DATA);
    expect(frame[1]).toBe(0xab);
    expect(frame[frame.length - 1]).toBe(0xab);
  });
});

describe('encodeTerminalResize', () => {
  it('encodes cols and rows as big-endian uint16', () => {
    const frame = encodeTerminalResize(80, 24);

    expect(frame.length).toBe(5);
    expect(frame[0]).toBe(Channel.TERMINAL_RESIZE);

    const view = new DataView(frame.buffer);
    expect(view.getUint16(1, false)).toBe(80);
    expect(view.getUint16(3, false)).toBe(24);
  });

  it('handles max uint16 values', () => {
    const frame = encodeTerminalResize(65535, 65535);
    const view = new DataView(frame.buffer);

    expect(view.getUint16(1, false)).toBe(65535);
    expect(view.getUint16(3, false)).toBe(65535);
  });

  it('handles zero dimensions', () => {
    const frame = encodeTerminalResize(0, 0);
    const view = new DataView(frame.buffer);

    expect(view.getUint16(1, false)).toBe(0);
    expect(view.getUint16(3, false)).toBe(0);
  });
});

describe('encodeScrollbackChunk', () => {
  it('encodes offset and data correctly', () => {
    const data = new Uint8Array([1, 2, 3, 4]);
    const frame = encodeScrollbackChunk(1024, data);

    expect(frame.length).toBe(5 + data.length);
    expect(frame[0]).toBe(Channel.SCROLLBACK_CHUNK);

    const view = new DataView(frame.buffer);
    expect(view.getUint32(1, false)).toBe(1024);
    expect(frame.slice(5)).toEqual(data);
  });

  it('handles zero offset', () => {
    const data = new Uint8Array([0xff]);
    const frame = encodeScrollbackChunk(0, data);
    const view = new DataView(frame.buffer);

    expect(view.getUint32(1, false)).toBe(0);
  });

  it('handles large offset near uint32 max', () => {
    const frame = encodeScrollbackChunk(0xfffffffe, new Uint8Array(0));
    const view = new DataView(frame.buffer);

    expect(view.getUint32(1, false)).toBe(0xfffffffe);
  });
});

describe('decodeBinaryFrame', () => {
  it('decodes terminal data frame', () => {
    const data = new Uint8Array([0x48, 0x69]);
    const frame = encodeTerminalData(data);
    const decoded = decodeBinaryFrame(frame);

    expect(decoded.channel).toBe(Channel.TERMINAL_DATA);
    if (decoded.channel === Channel.TERMINAL_DATA) {
      expect(decoded.data).toEqual(data);
    }
  });

  it('decodes terminal resize frame', () => {
    const frame = encodeTerminalResize(120, 40);
    const decoded = decodeBinaryFrame(frame);

    expect(decoded.channel).toBe(Channel.TERMINAL_RESIZE);
    if (decoded.channel === Channel.TERMINAL_RESIZE) {
      expect(decoded.cols).toBe(120);
      expect(decoded.rows).toBe(40);
    }
  });

  it('decodes scrollback chunk frame', () => {
    const data = new Uint8Array([10, 20, 30]);
    const frame = encodeScrollbackChunk(5000, data);
    const decoded = decodeBinaryFrame(frame);

    expect(decoded.channel).toBe(Channel.SCROLLBACK_CHUNK);
    if (decoded.channel === Channel.SCROLLBACK_CHUNK) {
      expect(decoded.offset).toBe(5000);
      expect(decoded.data).toEqual(data);
    }
  });

  it('throws on unknown channel', () => {
    const frame = new Uint8Array([0xff, 0x00]);

    expect(() => decodeBinaryFrame(frame)).toThrow('Unknown channel: 0xff');
  });

  it('round-trips terminal data', () => {
    const original = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      original[i] = i;
    }

    const encoded = encodeTerminalData(original);
    const decoded = decodeBinaryFrame(encoded);

    expect(decoded.channel).toBe(Channel.TERMINAL_DATA);
    if (decoded.channel === Channel.TERMINAL_DATA) {
      expect(decoded.data).toEqual(original);
    }
  });

  it('round-trips resize', () => {
    const encoded = encodeTerminalResize(200, 50);
    const decoded = decodeBinaryFrame(encoded);

    expect(decoded.channel).toBe(Channel.TERMINAL_RESIZE);
    if (decoded.channel === Channel.TERMINAL_RESIZE) {
      expect(decoded.cols).toBe(200);
      expect(decoded.rows).toBe(50);
    }
  });

  it('round-trips scrollback chunk', () => {
    const data = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const encoded = encodeScrollbackChunk(999999, data);
    const decoded = decodeBinaryFrame(encoded);

    expect(decoded.channel).toBe(Channel.SCROLLBACK_CHUNK);
    if (decoded.channel === Channel.SCROLLBACK_CHUNK) {
      expect(decoded.offset).toBe(999999);
      expect(decoded.data).toEqual(data);
    }
  });

  it('handles frame from a subarray (non-zero byteOffset)', () => {
    const data = new Uint8Array([0x41, 0x42]);
    const encoded = encodeTerminalData(data);

    // Simulate receiving as part of a larger buffer (like from WebSocket)
    const largerBuffer = new Uint8Array(10 + encoded.length);
    largerBuffer.set(encoded, 10);
    const subFrame = largerBuffer.subarray(10, 10 + encoded.length);

    const decoded = decodeBinaryFrame(subFrame);
    expect(decoded.channel).toBe(Channel.TERMINAL_DATA);
    if (decoded.channel === Channel.TERMINAL_DATA) {
      expect(decoded.data).toEqual(data);
    }
  });

  it('handles resize frame from a subarray', () => {
    const encoded = encodeTerminalResize(132, 43);

    const largerBuffer = new Uint8Array(20 + encoded.length);
    largerBuffer.set(encoded, 20);
    const subFrame = largerBuffer.subarray(20, 20 + encoded.length);

    const decoded = decodeBinaryFrame(subFrame);
    expect(decoded.channel).toBe(Channel.TERMINAL_RESIZE);
    if (decoded.channel === Channel.TERMINAL_RESIZE) {
      expect(decoded.cols).toBe(132);
      expect(decoded.rows).toBe(43);
    }
  });
});
