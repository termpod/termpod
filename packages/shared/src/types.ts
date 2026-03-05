import type { PtySize, ClientRole, DeviceType } from '@termpod/protocol';

export interface Session {
  sessionId: string;
  name: string;
  cwd: string;
  ptySize: PtySize;
  createdAt: string;
  lastActivity: string;
  viewerCount: number;
  status: 'active' | 'idle' | 'disconnected';
}

export interface ConnectedClient {
  clientId: string;
  role: ClientRole;
  device: DeviceType;
  connectedAt: string;
}

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
