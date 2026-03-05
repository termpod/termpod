import { DurableObject } from 'cloudflare:workers';
import type {
  HelloMessage,
  ClientMessage,
  ClientRole,
  DeviceType,
  ClientInfo,
} from '@termpod/protocol';
import { SCROLLBACK_BUFFER_SIZE, Channel } from '@termpod/protocol';

interface ConnectedClient {
  clientId: string;
  role: ClientRole;
  device: DeviceType;
  connectedAt: string;
}

export class TerminalSession extends DurableObject {
  private clients: Map<WebSocket, ConnectedClient> = new Map();
  private scrollback: Uint8Array[] = [];
  private scrollbackSize = 0;
  private sessionName = '';
  private cwd = '';
  private ptyCols = 120;
  private ptyRows = 40;

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/ws') {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      this.ctx.acceptWebSocket(server);

      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response('Not found', { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message === 'string') {
      this.handleControlMessage(ws, JSON.parse(message) as ClientMessage);

      return;
    }

    const data = new Uint8Array(message);
    const channel = data[0];

    if (channel === Channel.TERMINAL_DATA) {
      this.appendScrollback(data);
      this.broadcast(ws, message);
    } else if (channel === Channel.TERMINAL_RESIZE) {
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      this.ptyCols = view.getUint16(1, false);
      this.ptyRows = view.getUint16(3, false);

      this.broadcastJson(ws, {
        type: 'pty_resize',
        cols: this.ptyCols,
        rows: this.ptyRows,
      });
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    const client = this.clients.get(ws);

    if (client) {
      this.clients.delete(ws);
      this.broadcastJson(ws, {
        type: 'client_left',
        clientId: client.clientId,
        reason: 'closed',
      });
    }
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    const client = this.clients.get(ws);

    if (client) {
      this.clients.delete(ws);
      this.broadcastJson(ws, {
        type: 'client_left',
        clientId: client.clientId,
        reason: 'error',
      });
    }
  }

  private handleControlMessage(ws: WebSocket, msg: ClientMessage): void {
    switch (msg.type) {
      case 'hello':
        this.handleHello(ws, msg);
        break;

      case 'ping':
        ws.send(
          JSON.stringify({
            type: 'pong',
            timestamp: msg.timestamp,
            serverTime: Date.now(),
          }),
        );
        break;
    }
  }

  private handleHello(ws: WebSocket, msg: HelloMessage): void {
    const client: ConnectedClient = {
      clientId: msg.clientId,
      role: msg.role,
      device: msg.device,
      connectedAt: new Date().toISOString(),
    };

    this.clients.set(ws, client);

    const clientInfos: ClientInfo[] = Array.from(this.clients.values()).map((c) => ({
      clientId: c.clientId,
      role: c.role,
      device: c.device,
      connectedAt: c.connectedAt,
    }));

    ws.send(
      JSON.stringify({
        type: 'session_info',
        sessionId: this.ctx.id.toString(),
        name: this.sessionName,
        cwd: this.cwd,
        ptySize: { cols: this.ptyCols, rows: this.ptyRows },
        createdAt: new Date().toISOString(),
        clients: clientInfos,
      }),
    );

    // Send scrollback to new viewers
    if (msg.role === 'viewer') {
      this.sendScrollback(ws);
    }

    ws.send(JSON.stringify({ type: 'ready' }));

    this.broadcastJson(ws, {
      type: 'client_joined',
      clientId: msg.clientId,
      role: msg.role,
      device: msg.device,
    });
  }

  private appendScrollback(data: Uint8Array): void {
    this.scrollback.push(new Uint8Array(data));
    this.scrollbackSize += data.length;

    while (this.scrollbackSize > SCROLLBACK_BUFFER_SIZE && this.scrollback.length > 0) {
      const removed = this.scrollback.shift()!;
      this.scrollbackSize -= removed.length;
    }
  }

  private sendScrollback(ws: WebSocket): void {
    let offset = 0;

    for (const chunk of this.scrollback) {
      const frame = new Uint8Array(5 + chunk.length - 1);
      const view = new DataView(frame.buffer);
      frame[0] = Channel.SCROLLBACK_CHUNK;
      view.setUint32(1, offset, false);
      frame.set(chunk.subarray(1), 5); // strip channel byte from stored data
      ws.send(frame.buffer);
      offset += chunk.length - 1;
    }
  }

  private broadcast(sender: WebSocket, message: string | ArrayBuffer): void {
    for (const [ws] of this.clients) {
      if (ws !== sender) {
        ws.send(message);
      }
    }
  }

  private broadcastJson(sender: WebSocket, data: Record<string, unknown>): void {
    const json = JSON.stringify(data);

    for (const [ws] of this.clients) {
      if (ws !== sender) {
        ws.send(json);
      }
    }
  }
}
