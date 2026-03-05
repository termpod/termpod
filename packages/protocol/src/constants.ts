export const PROTOCOL_VERSION = 1;

export const Channel = {
  TERMINAL_DATA: 0x00,
  TERMINAL_RESIZE: 0x01,
  SCROLLBACK_CHUNK: 0x02,
} as const;

export type ChannelId = (typeof Channel)[keyof typeof Channel];

export const MAX_FRAME_SIZE = 64 * 1024; // 64KB
export const SCROLLBACK_BUFFER_SIZE = 100 * 1024; // 100KB
