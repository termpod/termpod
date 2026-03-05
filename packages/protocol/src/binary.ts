import { Channel, type ChannelId } from './constants.js';

export function encodeTerminalData(data: Uint8Array): Uint8Array {
  const frame = new Uint8Array(1 + data.length);
  frame[0] = Channel.TERMINAL_DATA;
  frame.set(data, 1);

  return frame;
}

export function encodeTerminalResize(cols: number, rows: number): Uint8Array {
  const frame = new Uint8Array(5);
  const view = new DataView(frame.buffer);
  frame[0] = Channel.TERMINAL_RESIZE;
  view.setUint16(1, cols, false);
  view.setUint16(3, rows, false);

  return frame;
}

export function encodeScrollbackChunk(offset: number, data: Uint8Array): Uint8Array {
  const frame = new Uint8Array(5 + data.length);
  const view = new DataView(frame.buffer);
  frame[0] = Channel.SCROLLBACK_CHUNK;
  view.setUint32(1, offset, false);
  frame.set(data, 5);

  return frame;
}

export interface TerminalDataFrame {
  channel: typeof Channel.TERMINAL_DATA;
  data: Uint8Array;
}

export interface TerminalResizeFrame {
  channel: typeof Channel.TERMINAL_RESIZE;
  cols: number;
  rows: number;
}

export interface ScrollbackChunkFrame {
  channel: typeof Channel.SCROLLBACK_CHUNK;
  offset: number;
  data: Uint8Array;
}

export type BinaryFrame = TerminalDataFrame | TerminalResizeFrame | ScrollbackChunkFrame;

export function decodeBinaryFrame(frame: Uint8Array): BinaryFrame {
  const channelId = frame[0] as ChannelId;
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);

  switch (channelId) {
    case Channel.TERMINAL_DATA:
      return {
        channel: Channel.TERMINAL_DATA,
        data: frame.subarray(1),
      };

    case Channel.TERMINAL_RESIZE:
      return {
        channel: Channel.TERMINAL_RESIZE,
        cols: view.getUint16(1, false),
        rows: view.getUint16(3, false),
      };

    case Channel.SCROLLBACK_CHUNK:
      return {
        channel: Channel.SCROLLBACK_CHUNK,
        offset: view.getUint32(1, false),
        data: frame.subarray(5),
      };

    default: {
      const unknown: number = channelId;
      throw new Error(`Unknown channel: 0x${unknown.toString(16).padStart(2, '0')}`);
    }
  }
}
