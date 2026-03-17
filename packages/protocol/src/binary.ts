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

export interface MuxTerminalDataFrame {
  channel: typeof Channel.MUX_TERMINAL_DATA;
  sessionId: string;
  data: Uint8Array;
}

export interface MuxTerminalDataCompressedFrame {
  channel: typeof Channel.MUX_TERMINAL_DATA_COMPRESSED;
  sessionId: string;
  data: Uint8Array; // raw deflate compressed
}

export interface MuxTerminalResizeFrame {
  channel: typeof Channel.MUX_TERMINAL_RESIZE;
  sessionId: string;
  cols: number;
  rows: number;
}

export interface EncryptedFrame {
  channel: typeof Channel.ENCRYPTED;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
}

export interface ShareEncryptedFrame {
  channel: typeof Channel.SHARE_ENCRYPTED;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
}

export type BinaryFrame =
  | TerminalDataFrame
  | TerminalResizeFrame
  | ScrollbackChunkFrame
  | MuxTerminalDataFrame
  | MuxTerminalDataCompressedFrame
  | MuxTerminalResizeFrame
  | EncryptedFrame
  | ShareEncryptedFrame;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encodeMuxTerminalData(sessionId: string, data: Uint8Array): Uint8Array {
  const sidBytes = encoder.encode(sessionId);
  const frame = new Uint8Array(1 + 1 + sidBytes.length + data.length);
  frame[0] = Channel.MUX_TERMINAL_DATA;
  frame[1] = sidBytes.length;
  frame.set(sidBytes, 2);
  frame.set(data, 2 + sidBytes.length);

  return frame;
}

export function encodeMuxTerminalResize(sessionId: string, cols: number, rows: number): Uint8Array {
  const sidBytes = encoder.encode(sessionId);
  const frame = new Uint8Array(1 + 1 + sidBytes.length + 4);
  const view = new DataView(frame.buffer);
  frame[0] = Channel.MUX_TERMINAL_RESIZE;
  frame[1] = sidBytes.length;
  frame.set(sidBytes, 2);
  view.setUint16(2 + sidBytes.length, cols, false);
  view.setUint16(2 + sidBytes.length + 2, rows, false);

  return frame;
}

export function encodeMuxTerminalDataCompressed(
  sessionId: string,
  compressedData: Uint8Array,
): Uint8Array {
  const sidBytes = encoder.encode(sessionId);
  const frame = new Uint8Array(1 + 1 + sidBytes.length + compressedData.length);
  frame[0] = Channel.MUX_TERMINAL_DATA_COMPRESSED;
  frame[1] = sidBytes.length;
  frame.set(sidBytes, 2);
  frame.set(compressedData, 2 + sidBytes.length);

  return frame;
}

export function decodeMuxFrame(
  frame: Uint8Array,
): MuxTerminalDataFrame | MuxTerminalDataCompressedFrame | MuxTerminalResizeFrame | null {
  if (frame.length < 2) {
    return null;
  }

  const channel = frame[0];
  if (
    channel !== Channel.MUX_TERMINAL_DATA &&
    channel !== Channel.MUX_TERMINAL_RESIZE &&
    channel !== Channel.MUX_TERMINAL_DATA_COMPRESSED
  ) {
    return null;
  }

  const sidLen = frame[1];
  if (sidLen === 0 || frame.length < 2 + sidLen) {
    return null;
  }

  const sessionId = decoder.decode(frame.subarray(2, 2 + sidLen));
  const payloadStart = 2 + sidLen;

  if (channel === Channel.MUX_TERMINAL_DATA) {
    return {
      channel: Channel.MUX_TERMINAL_DATA,
      sessionId,
      data: frame.subarray(payloadStart),
    };
  }

  if (channel === Channel.MUX_TERMINAL_DATA_COMPRESSED) {
    return {
      channel: Channel.MUX_TERMINAL_DATA_COMPRESSED,
      sessionId,
      data: frame.subarray(payloadStart),
    };
  }

  if (frame.length < payloadStart + 4) {
    return null;
  }

  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);

  return {
    channel: Channel.MUX_TERMINAL_RESIZE,
    sessionId,
    cols: view.getUint16(payloadStart, false),
    rows: view.getUint16(payloadStart + 2, false),
  };
}

const NONCE_SIZE = 12;

export function encodeEncryptedFrame(nonce: Uint8Array, ciphertext: Uint8Array): Uint8Array {
  const frame = new Uint8Array(1 + nonce.length + ciphertext.length);
  frame[0] = Channel.ENCRYPTED;
  frame.set(nonce, 1);
  frame.set(ciphertext, 1 + nonce.length);

  return frame;
}

export function decodeEncryptedFrame(frame: Uint8Array): EncryptedFrame | null {
  // [0xE0][nonce:12][ciphertext+tag]
  if (frame.length < 1 + NONCE_SIZE + 16) {
    return null;
  }

  return {
    channel: Channel.ENCRYPTED,
    nonce: frame.subarray(1, 1 + NONCE_SIZE),
    ciphertext: frame.subarray(1 + NONCE_SIZE),
  };
}

export function encodeShareEncryptedFrame(nonce: Uint8Array, ciphertext: Uint8Array): Uint8Array {
  const frame = new Uint8Array(1 + nonce.length + ciphertext.length);
  frame[0] = Channel.SHARE_ENCRYPTED;
  frame.set(nonce, 1);
  frame.set(ciphertext, 1 + nonce.length);

  return frame;
}

export function decodeShareEncryptedFrame(frame: Uint8Array): ShareEncryptedFrame | null {
  if (frame.length < 1 + NONCE_SIZE + 16) {
    return null;
  }

  return {
    channel: Channel.SHARE_ENCRYPTED,
    nonce: frame.subarray(1, 1 + NONCE_SIZE),
    ciphertext: frame.subarray(1 + NONCE_SIZE),
  };
}

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

    case Channel.MUX_TERMINAL_DATA:
    case Channel.MUX_TERMINAL_DATA_COMPRESSED:
    case Channel.MUX_TERMINAL_RESIZE: {
      const muxFrame = decodeMuxFrame(frame);
      if (!muxFrame) {
        throw new Error(
          `Invalid mux frame for channel: 0x${channelId.toString(16).padStart(2, '0')}`,
        );
      }

      return muxFrame;
    }

    case Channel.ENCRYPTED: {
      const encFrame = decodeEncryptedFrame(frame);
      if (!encFrame) {
        throw new Error('Invalid encrypted frame');
      }

      return encFrame;
    }

    case Channel.SHARE_ENCRYPTED: {
      const shareFrame = decodeShareEncryptedFrame(frame);
      if (!shareFrame) {
        throw new Error('Invalid share-encrypted frame');
      }

      return shareFrame;
    }

    default: {
      const unknown: number = channelId;
      throw new Error(`Unknown channel: 0x${unknown.toString(16).padStart(2, '0')}`);
    }
  }
}
