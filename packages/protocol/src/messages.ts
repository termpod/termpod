export type ClientRole = 'desktop' | 'viewer';
export type DeviceType = 'macos' | 'iphone' | 'ipad' | 'browser';
export type DisconnectReason = 'closed' | 'timeout' | 'error';
export type SessionEndReason = 'pty_exit' | 'desktop_disconnected';
export type ErrorCode = 'AUTH_FAILED' | 'SESSION_NOT_FOUND' | 'RATE_LIMITED' | 'INTERNAL';

export interface PtySize {
  cols: number;
  rows: number;
}

export interface ClientInfo {
  clientId: string;
  role: ClientRole;
  device: DeviceType;
  connectedAt: string;
}

// Client -> Relay

export interface HelloMessage {
  type: 'hello';
  version: number;
  role: ClientRole;
  device: DeviceType;
  clientId: string;
}

export interface InputLockRequestMessage {
  type: 'input_lock_request';
  clientId: string;
}

export interface InputLockReleaseMessage {
  type: 'input_lock_release';
  clientId: string;
}

export interface PingMessage {
  type: 'ping';
  timestamp: number;
}

export type ClientMessage =
  | HelloMessage
  | InputLockRequestMessage
  | InputLockReleaseMessage
  | PingMessage;

// Relay -> Client

export interface SessionInfoMessage {
  type: 'session_info';
  sessionId: string;
  name: string;
  cwd: string;
  ptySize: PtySize;
  createdAt: string;
  clients: ClientInfo[];
}

export interface ReadyMessage {
  type: 'ready';
}

export interface ClientJoinedMessage {
  type: 'client_joined';
  clientId: string;
  role: ClientRole;
  device: DeviceType;
}

export interface ClientLeftMessage {
  type: 'client_left';
  clientId: string;
  reason: DisconnectReason;
}

export interface PtyResizeMessage {
  type: 'pty_resize';
  cols: number;
  rows: number;
}

export interface InputLockGrantedMessage {
  type: 'input_lock_granted';
  clientId: string;
}

export interface InputLockDeniedMessage {
  type: 'input_lock_denied';
  reason: string;
  holder: string;
}

export interface SessionEndedMessage {
  type: 'session_ended';
  reason: SessionEndReason;
  exitCode?: number;
}

export interface PongMessage {
  type: 'pong';
  timestamp: number;
  serverTime: number;
}

export interface ErrorMessage {
  type: 'error';
  code: ErrorCode;
  message: string;
}

export type RelayMessage =
  | SessionInfoMessage
  | ReadyMessage
  | ClientJoinedMessage
  | ClientLeftMessage
  | PtyResizeMessage
  | InputLockGrantedMessage
  | InputLockDeniedMessage
  | SessionEndedMessage
  | PongMessage
  | ErrorMessage;

export type ControlMessage = ClientMessage | RelayMessage;
