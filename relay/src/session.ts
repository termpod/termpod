import { DurableObject } from 'cloudflare:workers';
import type {
  HelloMessage,
  ClientMessage,
  ClientInfo,
  SignalingMessage,
  SessionCreatedMessage,
} from '@termpod/protocol';
import { SCROLLBACK_BUFFER_SIZE, Channel } from '@termpod/protocol';

// WebSocket tags store client metadata as JSON so it survives hibernation
interface ClientTag {
  clientId: string;
  role: string;
  device: string;
  connectedAt: string;
}

function setTag(ws: WebSocket, tag: ClientTag): void {
  // Cloudflare WebSocket tags are attached via serializeAttachment
  (ws as unknown as { serializeAttachment: (v: unknown) => void }).serializeAttachment(tag);
}

function getTag(ws: WebSocket): ClientTag | null {
  const tag = (ws as unknown as { deserializeAttachment: () => unknown }).deserializeAttachment();

  return tag as ClientTag | null;
}

export class TerminalSession extends DurableObject {
  private scrollback: Uint8Array[] = [];
  private scrollbackSize = 0;
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

    if (url.pathname === '/close' && request.method === 'POST') {
      const json = JSON.stringify({ type: 'session_closed' });

      for (const ws of this.ctx.getWebSockets()) {
        ws.send(json);
        ws.close(1000, 'session deleted');
      }

      return new Response(JSON.stringify({ ok: true }));
    }

    return new Response('Not found', { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message === 'string') {
      this.handleControlMessage(ws, JSON.parse(message) as ClientMessage | SessionCreatedMessage);

      return;
    }

    const data = new Uint8Array(message);
    const channel = data[0];

    if (channel === Channel.TERMINAL_DATA) {
      const senderTag = getTag(ws);
      const senderRole = senderTag?.role ?? 'unknown';

      if (senderRole === 'desktop') {
        // Desktop terminal output → store in scrollback, send to viewers only
        this.appendScrollback(data);
        this.broadcastToRole(ws, 'viewer', message);
      } else {
        // Viewer input → send to desktop only
        this.broadcastToRole(ws, 'desktop', message);
      }
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

  async webSocketClose(ws: WebSocket): Promise<void> {
    const tag = getTag(ws);

    if (tag) {
      this.broadcastJson(ws, {
        type: 'client_left',
        clientId: tag.clientId,
        reason: 'closed',
      });
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    const tag = getTag(ws);

    if (tag) {
      this.broadcastJson(ws, {
        type: 'client_left',
        clientId: tag.clientId,
        reason: 'error',
      });
    }
  }

  private handleControlMessage(ws: WebSocket, msg: ClientMessage | SessionCreatedMessage): void {
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

      case 'webrtc_offer':
      case 'webrtc_answer':
      case 'webrtc_ice':
        this.forwardSignaling(ws, msg as SignalingMessage);
        break;

      case 'create_session_request':
        // Forward from viewer → desktop
        this.forwardToRole(ws, 'desktop', msg as unknown as Record<string, unknown>);
        break;

      case 'session_created':
        // Forward from desktop → all viewers
        this.forwardToRole(ws, 'viewer', msg as unknown as Record<string, unknown>);
        break;
    }
  }

  private handleHello(ws: WebSocket, msg: HelloMessage): void {
    const tag: ClientTag = {
      clientId: msg.clientId,
      role: msg.role,
      device: msg.device,
      connectedAt: new Date().toISOString(),
    };

    setTag(ws, tag);

    // Build client list from all connected WebSockets
    const allSockets = this.ctx.getWebSockets();
    const clientInfos: ClientInfo[] = [];

    for (const sock of allSockets) {
      const t = getTag(sock);

      if (t) {
        clientInfos.push({
          clientId: t.clientId,
          role: t.role as ClientInfo['role'],
          device: t.device as ClientInfo['device'],
          connectedAt: t.connectedAt,
        });
      }
    }

    ws.send(
      JSON.stringify({
        type: 'session_info',
        sessionId: this.ctx.id.toString(),
        name: '',
        cwd: '',
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
      frame.set(chunk.subarray(1), 5);
      ws.send(frame.buffer);
      offset += chunk.length - 1;
    }
  }

  private broadcast(sender: WebSocket, message: string | ArrayBuffer): void {
    for (const ws of this.ctx.getWebSockets()) {
      if (ws !== sender) {
        ws.send(message);
      }
    }
  }

  private broadcastToRole(sender: WebSocket, targetRole: string, message: string | ArrayBuffer): void {
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === sender) {
        continue;
      }

      const tag = getTag(ws);

      if (tag?.role === targetRole) {
        ws.send(message);
      }
    }
  }

  private broadcastJson(sender: WebSocket, data: Record<string, unknown>): void {
    const json = JSON.stringify(data);

    for (const ws of this.ctx.getWebSockets()) {
      if (ws !== sender) {
        ws.send(json);
      }
    }
  }

  private forwardToRole(_sender: WebSocket, targetRole: string, msg: Record<string, unknown>): void {
    const json = JSON.stringify(msg);

    for (const ws of this.ctx.getWebSockets()) {
      if (ws === _sender) {
        continue;
      }

      const tag = getTag(ws);

      if (tag?.role === targetRole) {
        ws.send(json);
      }
    }
  }

  private forwardSignaling(_sender: WebSocket, msg: SignalingMessage): void {
    const json = JSON.stringify(msg);

    for (const ws of this.ctx.getWebSockets()) {
      const tag = getTag(ws);

      if (tag?.clientId === msg.toClientId) {
        ws.send(json);

        return;
      }
    }
  }
}
