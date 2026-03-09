import { describe, expect, it } from 'vitest';
import { Channel } from './constants.js';
import {
  decodeBinaryFrame,
  decodeEncryptedFrame,
  decodeMuxFrame,
  encodeEncryptedFrame,
  encodeMuxTerminalData,
  encodeMuxTerminalResize,
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

describe('encodeMuxTerminalData', () => {
  it('encodes session ID and data into mux frame', () => {
    const sessionId = 'abc-123';
    const data = new Uint8Array([0x48, 0x69]); // "Hi"
    const frame = encodeMuxTerminalData(sessionId, data);

    expect(frame[0]).toBe(Channel.MUX_TERMINAL_DATA);
    expect(frame[1]).toBe(7); // "abc-123" is 7 bytes
    expect(frame.length).toBe(1 + 1 + 7 + 2);
  });

  it('handles empty data payload', () => {
    const sessionId = 'sess';
    const frame = encodeMuxTerminalData(sessionId, new Uint8Array(0));

    expect(frame[0]).toBe(Channel.MUX_TERMINAL_DATA);
    expect(frame[1]).toBe(4);
    expect(frame.length).toBe(1 + 1 + 4);
  });

  it('handles long session IDs', () => {
    const sessionId = 'a'.repeat(200);
    const data = new Uint8Array([1]);
    const frame = encodeMuxTerminalData(sessionId, data);

    expect(frame[0]).toBe(Channel.MUX_TERMINAL_DATA);
    expect(frame[1]).toBe(200);
    expect(frame.length).toBe(1 + 1 + 200 + 1);
  });

  it('handles UUID-style session IDs', () => {
    const sessionId = '550e8400-e29b-41d4-a716-446655440000';
    const data = new Uint8Array([0xff, 0xfe]);
    const frame = encodeMuxTerminalData(sessionId, data);

    expect(frame[0]).toBe(Channel.MUX_TERMINAL_DATA);
    expect(frame[1]).toBe(36);
    expect(frame.length).toBe(1 + 1 + 36 + 2);
  });

  it('handles single-character session ID', () => {
    const frame = encodeMuxTerminalData('x', new Uint8Array([0x01]));

    expect(frame[1]).toBe(1);
    expect(frame.length).toBe(1 + 1 + 1 + 1);
  });
});

describe('encodeMuxTerminalResize', () => {
  it('encodes session ID, cols, and rows', () => {
    const sessionId = 'sess-1';
    const frame = encodeMuxTerminalResize(sessionId, 80, 24);

    expect(frame[0]).toBe(Channel.MUX_TERMINAL_RESIZE);
    expect(frame[1]).toBe(6);
    expect(frame.length).toBe(1 + 1 + 6 + 4);

    const view = new DataView(frame.buffer);
    expect(view.getUint16(2 + 6, false)).toBe(80);
    expect(view.getUint16(2 + 6 + 2, false)).toBe(24);
  });

  it('handles max uint16 dimensions', () => {
    const frame = encodeMuxTerminalResize('s', 65535, 65535);
    const view = new DataView(frame.buffer);

    expect(view.getUint16(2 + 1, false)).toBe(65535);
    expect(view.getUint16(2 + 1 + 2, false)).toBe(65535);
  });

  it('handles zero dimensions', () => {
    const frame = encodeMuxTerminalResize('s', 0, 0);
    const view = new DataView(frame.buffer);

    expect(view.getUint16(2 + 1, false)).toBe(0);
    expect(view.getUint16(2 + 1 + 2, false)).toBe(0);
  });
});

describe('decodeMuxFrame', () => {
  it('decodes a mux terminal data frame', () => {
    const frame = encodeMuxTerminalData('sess-1', new Uint8Array([0x41, 0x42]));
    const decoded = decodeMuxFrame(frame);

    expect(decoded).not.toBeNull();
    expect(decoded!.channel).toBe(Channel.MUX_TERMINAL_DATA);
    if (decoded!.channel === Channel.MUX_TERMINAL_DATA) {
      expect(decoded!.sessionId).toBe('sess-1');
      expect(decoded!.data).toEqual(new Uint8Array([0x41, 0x42]));
    }
  });

  it('decodes a mux terminal resize frame', () => {
    const frame = encodeMuxTerminalResize('sess-2', 120, 40);
    const decoded = decodeMuxFrame(frame);

    expect(decoded).not.toBeNull();
    expect(decoded!.channel).toBe(Channel.MUX_TERMINAL_RESIZE);
    if (decoded!.channel === Channel.MUX_TERMINAL_RESIZE) {
      expect(decoded!.sessionId).toBe('sess-2');
      expect(decoded!.cols).toBe(120);
      expect(decoded!.rows).toBe(40);
    }
  });

  it('returns null for frame too short', () => {
    expect(decodeMuxFrame(new Uint8Array([0x10]))).toBeNull();
    expect(decodeMuxFrame(new Uint8Array([]))).toBeNull();
  });

  it('returns null for zero sid_len', () => {
    const frame = new Uint8Array([0x10, 0x00, 0x41]);

    expect(decodeMuxFrame(frame)).toBeNull();
  });

  it('returns null for sid_len exceeding frame length', () => {
    const frame = new Uint8Array([0x10, 0x0a, 0x41]); // sid_len=10 but only 1 byte of sid

    expect(decodeMuxFrame(frame)).toBeNull();
  });

  it('returns null for non-mux channel', () => {
    const frame = new Uint8Array([0x00, 0x03, 0x41, 0x42, 0x43]);

    expect(decodeMuxFrame(frame)).toBeNull();
  });

  it('returns null for resize frame with truncated payload', () => {
    // Channel + sid_len + sid + only 2 bytes of resize payload (needs 4)
    const frame = new Uint8Array([0x11, 0x01, 0x73, 0x00, 0x50]);

    expect(decodeMuxFrame(frame)).toBeNull();
  });

  it('handles mux data frame with empty payload', () => {
    const frame = encodeMuxTerminalData('test', new Uint8Array(0));
    const decoded = decodeMuxFrame(frame);

    expect(decoded).not.toBeNull();
    if (decoded!.channel === Channel.MUX_TERMINAL_DATA) {
      expect(decoded!.sessionId).toBe('test');
      expect(decoded!.data.length).toBe(0);
    }
  });

  it('handles frame from a subarray (non-zero byteOffset)', () => {
    const original = encodeMuxTerminalData('sid', new Uint8Array([0xaa, 0xbb]));
    const largerBuffer = new Uint8Array(16 + original.length);
    largerBuffer.set(original, 16);
    const subFrame = largerBuffer.subarray(16, 16 + original.length);

    const decoded = decodeMuxFrame(subFrame);

    expect(decoded).not.toBeNull();
    if (decoded!.channel === Channel.MUX_TERMINAL_DATA) {
      expect(decoded!.sessionId).toBe('sid');
      expect(decoded!.data).toEqual(new Uint8Array([0xaa, 0xbb]));
    }
  });

  it('handles resize frame from a subarray (non-zero byteOffset)', () => {
    const original = encodeMuxTerminalResize('sid', 132, 43);
    const largerBuffer = new Uint8Array(20 + original.length);
    largerBuffer.set(original, 20);
    const subFrame = largerBuffer.subarray(20, 20 + original.length);

    const decoded = decodeMuxFrame(subFrame);

    expect(decoded).not.toBeNull();
    if (decoded!.channel === Channel.MUX_TERMINAL_RESIZE) {
      expect(decoded!.sessionId).toBe('sid');
      expect(decoded!.cols).toBe(132);
      expect(decoded!.rows).toBe(43);
    }
  });
});

describe('mux round-trips', () => {
  it('round-trips mux terminal data', () => {
    const sessionId = '550e8400-e29b-41d4-a716-446655440000';
    const data = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      data[i] = i;
    }

    const encoded = encodeMuxTerminalData(sessionId, data);
    const decoded = decodeMuxFrame(encoded);

    expect(decoded).not.toBeNull();
    expect(decoded!.channel).toBe(Channel.MUX_TERMINAL_DATA);
    if (decoded!.channel === Channel.MUX_TERMINAL_DATA) {
      expect(decoded!.sessionId).toBe(sessionId);
      expect(decoded!.data).toEqual(data);
    }
  });

  it('round-trips mux terminal resize', () => {
    const sessionId = 'my-session';
    const encoded = encodeMuxTerminalResize(sessionId, 200, 50);
    const decoded = decodeMuxFrame(encoded);

    expect(decoded).not.toBeNull();
    expect(decoded!.channel).toBe(Channel.MUX_TERMINAL_RESIZE);
    if (decoded!.channel === Channel.MUX_TERMINAL_RESIZE) {
      expect(decoded!.sessionId).toBe(sessionId);
      expect(decoded!.cols).toBe(200);
      expect(decoded!.rows).toBe(50);
    }
  });

  it('round-trips mux data via decodeBinaryFrame', () => {
    const data = new Uint8Array([0xde, 0xad]);
    const encoded = encodeMuxTerminalData('sess', data);
    const decoded = decodeBinaryFrame(encoded);

    expect(decoded.channel).toBe(Channel.MUX_TERMINAL_DATA);
    if (decoded.channel === Channel.MUX_TERMINAL_DATA) {
      expect(decoded.sessionId).toBe('sess');
      expect(decoded.data).toEqual(data);
    }
  });

  it('round-trips mux resize via decodeBinaryFrame', () => {
    const encoded = encodeMuxTerminalResize('sess', 80, 24);
    const decoded = decodeBinaryFrame(encoded);

    expect(decoded.channel).toBe(Channel.MUX_TERMINAL_RESIZE);
    if (decoded.channel === Channel.MUX_TERMINAL_RESIZE) {
      expect(decoded.sessionId).toBe('sess');
      expect(decoded.cols).toBe(80);
      expect(decoded.rows).toBe(24);
    }
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

  it('decodes mux terminal data frame', () => {
    const data = new Uint8Array([0x01, 0x02, 0x03]);
    const frame = encodeMuxTerminalData('session-abc', data);
    const decoded = decodeBinaryFrame(frame);

    expect(decoded.channel).toBe(Channel.MUX_TERMINAL_DATA);
    if (decoded.channel === Channel.MUX_TERMINAL_DATA) {
      expect(decoded.sessionId).toBe('session-abc');
      expect(decoded.data).toEqual(data);
    }
  });

  it('decodes mux terminal resize frame', () => {
    const frame = encodeMuxTerminalResize('session-xyz', 160, 48);
    const decoded = decodeBinaryFrame(frame);

    expect(decoded.channel).toBe(Channel.MUX_TERMINAL_RESIZE);
    if (decoded.channel === Channel.MUX_TERMINAL_RESIZE) {
      expect(decoded.sessionId).toBe('session-xyz');
      expect(decoded.cols).toBe(160);
      expect(decoded.rows).toBe(48);
    }
  });

  it('throws on invalid mux frame with zero sid_len', () => {
    const frame = new Uint8Array([0x10, 0x00]);

    expect(() => decodeBinaryFrame(frame)).toThrow('Invalid mux frame');
  });

  it('throws on unknown channel', () => {
    const frame = new Uint8Array([0xff, 0x00]);

    expect(() => decodeBinaryFrame(frame)).toThrow('Unknown channel: 0xff');
  });

  it('decodes encrypted frame', () => {
    const nonce = new Uint8Array(12);
    nonce.fill(0xaa);
    const ciphertext = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x12, 0x13]);
    const frame = encodeEncryptedFrame(nonce, ciphertext);
    const decoded = decodeBinaryFrame(frame);

    expect(decoded.channel).toBe(Channel.ENCRYPTED);
    if (decoded.channel === Channel.ENCRYPTED) {
      expect(decoded.nonce).toEqual(nonce);
      expect(decoded.ciphertext).toEqual(ciphertext);
    }
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

  it('handles mux data frame from a subarray', () => {
    const encoded = encodeMuxTerminalData('test-sid', new Uint8Array([0xcc]));

    const largerBuffer = new Uint8Array(8 + encoded.length);
    largerBuffer.set(encoded, 8);
    const subFrame = largerBuffer.subarray(8, 8 + encoded.length);

    const decoded = decodeBinaryFrame(subFrame);
    expect(decoded.channel).toBe(Channel.MUX_TERMINAL_DATA);
    if (decoded.channel === Channel.MUX_TERMINAL_DATA) {
      expect(decoded.sessionId).toBe('test-sid');
      expect(decoded.data).toEqual(new Uint8Array([0xcc]));
    }
  });

  it('handles mux resize frame from a subarray', () => {
    const encoded = encodeMuxTerminalResize('test-sid', 100, 30);

    const largerBuffer = new Uint8Array(12 + encoded.length);
    largerBuffer.set(encoded, 12);
    const subFrame = largerBuffer.subarray(12, 12 + encoded.length);

    const decoded = decodeBinaryFrame(subFrame);
    expect(decoded.channel).toBe(Channel.MUX_TERMINAL_RESIZE);
    if (decoded.channel === Channel.MUX_TERMINAL_RESIZE) {
      expect(decoded.sessionId).toBe('test-sid');
      expect(decoded.cols).toBe(100);
      expect(decoded.rows).toBe(30);
    }
  });
});

describe('encodeEncryptedFrame', () => {
  it('encodes nonce and ciphertext with channel prefix', () => {
    const nonce = new Uint8Array(12);
    nonce[0] = 0x01;
    nonce[11] = 0x0c;
    const ciphertext = new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff,
      0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0x00, 0xab]);
    const frame = encodeEncryptedFrame(nonce, ciphertext);

    expect(frame[0]).toBe(Channel.ENCRYPTED);
    expect(frame[0]).toBe(0xe0);
    expect(frame.length).toBe(1 + 12 + ciphertext.length);
    expect(frame.subarray(1, 13)).toEqual(nonce);
    expect(frame.subarray(13)).toEqual(ciphertext);
  });
});

describe('decodeEncryptedFrame', () => {
  it('round-trips encoded encrypted frame', () => {
    const nonce = new Uint8Array(12);
    nonce.fill(0x42);
    const ciphertext = new Uint8Array(32);
    ciphertext.fill(0xde);

    const frame = encodeEncryptedFrame(nonce, ciphertext);
    const decoded = decodeEncryptedFrame(frame);

    expect(decoded).not.toBeNull();
    expect(decoded!.channel).toBe(Channel.ENCRYPTED);
    expect(decoded!.nonce).toEqual(nonce);
    expect(decoded!.ciphertext).toEqual(ciphertext);
  });

  it('returns null for frame too short', () => {
    // Needs at least 1 (channel) + 12 (nonce) + 16 (tag) = 29 bytes
    const tooShort = new Uint8Array(28);
    tooShort[0] = Channel.ENCRYPTED;

    expect(decodeEncryptedFrame(tooShort)).toBeNull();
  });

  it('handles minimum valid frame (empty plaintext, just tag)', () => {
    const nonce = new Uint8Array(12);
    const tag = new Uint8Array(16); // GCM tag with no ciphertext
    const frame = encodeEncryptedFrame(nonce, tag);
    const decoded = decodeEncryptedFrame(frame);

    expect(decoded).not.toBeNull();
    expect(decoded!.nonce.length).toBe(12);
    expect(decoded!.ciphertext.length).toBe(16);
  });
});
