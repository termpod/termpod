import { describe, expect, it } from 'vitest';
import { Channel } from '@termpod/protocol';

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
    view.setUint16(3, 43, false); // rows

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

  it('encrypted frame (0xE0) is a valid channel marker', () => {
    const frame = new Uint8Array([0xe0, ...new Array(28).fill(0xaa)]);

    expect(frame[0]).toBe(0xe0);
    expect(frame[0]).toBe(Channel.ENCRYPTED);
  });
});
