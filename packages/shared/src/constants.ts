export const DEFAULT_PTY_SIZE = { cols: 120, rows: 40 };
export const DEFAULT_SHELL = '/bin/zsh';

export const RELAY_URL = {
  production: 'wss://relay.termpod.dev',
  development: 'ws://localhost:8787',
} as const;

export const RECONNECT = {
  initialDelay: 1000,
  maxDelay: 30000,
  backoffMultiplier: 2,
} as const;

export const PAIRING_TOKEN_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

export const LOCAL_SERVER_SERVICE_TYPE = '_termpod._tcp';
export const LOCAL_SERVER_SERVICE_DOMAIN = 'local.';

export const WEBRTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
} as const;
