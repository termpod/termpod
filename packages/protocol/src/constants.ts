export const PROTOCOL_VERSION = 1;

export const Channel = {
  TERMINAL_DATA: 0x00,
  TERMINAL_RESIZE: 0x01,
  SCROLLBACK_CHUNK: 0x02,
  /** Multiplexed terminal data: [0x10][sid_len][sid][payload] */
  MUX_TERMINAL_DATA: 0x10,
  /** Multiplexed terminal resize: [0x11][sid_len][sid][cols_hi][cols_lo][rows_hi][rows_lo] */
  MUX_TERMINAL_RESIZE: 0x11,
} as const;

export type ChannelId = (typeof Channel)[keyof typeof Channel];

export const MAX_FRAME_SIZE = 64 * 1024; // 64KB
export const SCROLLBACK_BUFFER_SIZE = 512 * 1024; // 512KB — enough for TUI app screen state
