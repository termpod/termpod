export const DEFAULT_PTY_SIZE = { cols: 120, rows: 40 };
export const DEFAULT_SHELL = '/bin/zsh';

export const RELAY_URL = {
  production: 'wss://termpod.swapnil.dev',
  development: 'ws://localhost:8787',
} as const;

export const RECONNECT = {
  initialDelay: 1000,
  maxDelay: 30000,
  backoffMultiplier: 2,
} as const;

export const PAIRING_TOKEN_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
