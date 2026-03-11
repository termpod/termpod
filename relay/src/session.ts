import { DurableObject } from 'cloudflare:workers';
import type {
  HelloMessage,
  ClientMessage,
  ClientInfo,
  ClientRole,
  SignalingMessage,
  SessionCreatedMessage,
} from '@termpod/protocol';
import { Channel } from '@termpod/protocol';
import { verifyJWT } from './jwt';

const MAX_MESSAGE_SIZE = 64 * 1024; // 64KB
const SCROLLBACK_BUFFER_SIZE = 512 * 1024; // 512KB

/**
 * Ring buffer for terminal scrollback. Stores raw terminal data in a
 * fixed-size ArrayBuffer. When full, old data is overwritten from the start.
 */
class ScrollbackBuffer {
  private buffer: Uint8Array;
  private writePos = 0;
  private totalWritten = 0;

  constructor(size: number = SCROLLBACK_BUFFER_SIZE) {
    this.buffer = new Uint8Array(size);
  }

  append(data: Uint8Array): void {
    const len = data.length;

    if (len >= this.buffer.length) {
      // Data larger than buffer — keep only the tail
      this.buffer.set(data.subarray(data.length - this.buffer.length));
      this.writePos = 0;
      this.totalWritten += len;

      return;
    }

    const remaining = this.buffer.length - this.writePos;

    if (len <= remaining) {
      this.buffer.set(data, this.writePos);
      this.writePos += len;
    } else {
      // Split write: fill end, wrap to start
      this.buffer.set(data.subarray(0, remaining), this.writePos);
      this.buffer.set(data.subarray(remaining), 0);
      this.writePos = len - remaining;
    }

    this.totalWritten += len;
  }

  /** Returns all buffered data in order (oldest first). */
  getAll(): Uint8Array {
    const used = Math.min(this.totalWritten, this.buffer.length);

    if (used === 0) {
      return new Uint8Array(0);
    }

    if (this.totalWritten <= this.buffer.length) {
      // Buffer hasn't wrapped yet
      return this.buffer.slice(0, this.writePos);
    }

    // Buffer has wrapped — read from writePos to end, then start to writePos
    const result = new Uint8Array(this.buffer.length);
    const tailLen = this.buffer.length - this.writePos;
    result.set(this.buffer.subarray(this.writePos), 0);
    result.set(this.buffer.subarray(0, this.writePos), tailLen);

    return result;
  }

  clear(): void {
    this.writePos = 0;
    this.totalWritten = 0;
  }
}

// WebSocket tags store client metadata as JSON so it survives hibernation
interface ClientTag {
  clientId: string;
  role: ClientRole;
  device: string;
  userId: string;
  connectedAt: string;
  readonly?: boolean;
}

function setTag(ws: WebSocket, tag: ClientTag): void {
  (ws as unknown as { serializeAttachment: (v: unknown) => void }).serializeAttachment(tag);
}

function getTag(ws: WebSocket): ClientTag | null {
  const tag = (ws as unknown as { deserializeAttachment: () => unknown }).deserializeAttachment();

  return tag as ClientTag | null;
}

export class TerminalSession extends DurableObject {
  private ptyCols = 120;
  private ptyRows = 40;
  private jwtSecret: string | null = null;
  private scrollback = new ScrollbackBuffer();
  /** Store complete 0xE1 frames for share viewer scrollback replay. */
  private shareFrames: ArrayBuffer[] = [];
  private shareFramesSize = 0;

  private async getOwner(): Promise<string | null> {
    return (await this.ctx.storage.get<string>('ownerUserId')) ?? null;
  }

  private async setOwner(userId: string | null): Promise<void> {
    if (userId) {
      await this.ctx.storage.put('ownerUserId', userId);
    } else {
      await this.ctx.storage.delete('ownerUserId');
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/ws') {
      // Store JWT secret for first-message auth validation
      const secret = request.headers.get('X-JWT-Secret');

      if (secret) {
        this.jwtSecret = secret;
      }

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      // Legacy clients pass X-User-Id (validated by Worker from URL token).
      // New clients send auth as their first WebSocket message.
      const isShareReadonly = request.headers.get('X-Share-Readonly') === '1';
      const userId = request.headers.get('X-User-Id');

      if (isShareReadonly) {
        // Share token viewer — skip ownership, assign readonly directly
        (server as unknown as { serializeAttachment: (v: unknown) => void }).serializeAttachment({
          shareReadonly: true,
          pendingHello: true,
        });
      } else if (userId) {
        // Legacy flow: ownership check, then wait for hello
        const owner = await this.getOwner();

        if (!owner) {
          await this.setOwner(userId);
        } else if (owner !== userId) {
          return new Response('Forbidden', { status: 403 });
        }

        (server as unknown as { serializeAttachment: (v: unknown) => void }).serializeAttachment({
          userId,
          pendingHello: true,
        });
      } else {
        // New flow: client must send auth message first
        (server as unknown as { serializeAttachment: (v: unknown) => void }).serializeAttachment({
          pendingAuth: true,
        });
      }

      this.ctx.acceptWebSocket(server);

      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === '/owner' && request.method === 'GET') {
      const owner = await this.getOwner();

      return Response.json({ owner });
    }

    if (url.pathname === '/kick-readonly' && request.method === 'POST') {
      const json = JSON.stringify({ type: 'share_revoked' });

      for (const ws of this.ctx.getWebSockets()) {
        const tag = getTag(ws);

        if (tag?.readonly) {
          ws.send(json);
          ws.close(1000, 'share revoked');
        }
      }

      return Response.json({ ok: true });
    }

    if (url.pathname === '/close' && request.method === 'POST') {
      const json = JSON.stringify({ type: 'session_closed' });

      for (const ws of this.ctx.getWebSockets()) {
        ws.send(json);
        ws.close(1000, 'session deleted');
      }

      // Clear owner and scrollback so the session can be reused
      this.scrollback.clear();
      this.shareFrames = [];
      this.shareFramesSize = 0;
      await this.setOwner(null);

      return new Response(JSON.stringify({ ok: true }));
    }

    return new Response('Not found', { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    // Enforce message size limit
    const size = typeof message === 'string' ? message.length : message.byteLength;

    if (size > MAX_MESSAGE_SIZE) {
      ws.close(1009, 'Message too large');

      return;
    }

    // Check if this socket is pending auth
    const attachment = (ws as unknown as { deserializeAttachment: () => unknown }).deserializeAttachment() as Record<string, unknown> | null;

    if (attachment?.pendingAuth) {
      await this.handleAuth(ws, message);

      return;
    }

    if (typeof message === 'string') {
      let parsed: ClientMessage | SessionCreatedMessage;

      try {
        parsed = JSON.parse(message);
      } catch {
        ws.close(1008, 'Invalid JSON');

        return;
      }

      this.handleControlMessage(ws, parsed);

      return;
    }

    const data = new Uint8Array(message);
    const channel = data[0];

    if (channel === Channel.TERMINAL_DATA) {
      const senderTag = getTag(ws);
      const senderRole = senderTag?.role ?? 'unknown';

      if (senderRole === 'desktop') {
        // Append terminal output to scrollback buffer (strip channel byte)
        this.scrollback.append(data.subarray(1));
        // Send plaintext only to authenticated viewers, not readonly share viewers
        // (share viewers receive 0xE1 encrypted frames instead)
        this.broadcastToNonReadonlyViewers(ws, message);
      } else if (senderRole === 'viewer' && !senderTag?.readonly) {
        // Viewer input -> send to desktop only (readonly viewers blocked)
        this.broadcastToRole(ws, 'desktop', message);
      }
      // Unknown roles and readonly viewers are silently dropped
    } else if (channel === Channel.TERMINAL_RESIZE) {
      const senderTag = getTag(ws);

      // Only desktop can resize
      if (senderTag?.role !== 'desktop') {
        return;
      }

      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      this.ptyCols = view.getUint16(1, false);
      this.ptyRows = view.getUint16(3, false);

      this.broadcastJson(ws, {
        type: 'pty_resize',
        cols: this.ptyCols,
        rows: this.ptyRows,
      });
    } else if (channel === 0xe1) {
      // Share-encrypted frame — forward only to readonly (share) viewers
      const senderTag = getTag(ws);

      if (senderTag?.role === 'desktop') {
        // Buffer complete frame for scrollback replay to new share viewers
        const frameCopy = (message as ArrayBuffer).slice(0);
        this.shareFrames.push(frameCopy);
        this.shareFramesSize += frameCopy.byteLength;

        // Evict oldest frames if over 512KB
        while (this.shareFramesSize > SCROLLBACK_BUFFER_SIZE && this.shareFrames.length > 0) {
          const evicted = this.shareFrames.shift()!;
          this.shareFramesSize -= evicted.byteLength;
        }

        for (const sock of this.ctx.getWebSockets()) {
          if (sock === ws) continue;

          const tag = getTag(sock);

          if (tag?.readonly) {
            sock.send(message);
          }
        }
      }
    } else if (channel === 0xe0) {
      // E2E encrypted frame — forward without inspecting contents
      const senderTag = getTag(ws);
      const senderRole = senderTag?.role ?? 'unknown';

      if (senderRole === 'desktop') {
        this.broadcastToRole(ws, 'viewer', message);
      } else if (senderRole === 'viewer') {
        this.broadcastToRole(ws, 'desktop', message);
      }
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const tag = getTag(ws);

    if (tag) {
      this.broadcastJson(ws, {
        type: 'client_left',
        clientId: tag.clientId,
        role: tag.role,
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
        role: tag.role,
        reason: 'error',
      });
    }
  }

  private async handleAuth(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') {
      ws.close(1008, 'Expected auth message');

      return;
    }

    let parsed: { type: string; token?: string };

    try {
      parsed = JSON.parse(message);
    } catch {
      ws.close(1008, 'Invalid JSON');

      return;
    }

    if (parsed.type !== 'auth' || !parsed.token) {
      ws.close(1008, 'Expected auth message');

      return;
    }

    if (!this.jwtSecret) {
      ws.close(1011, 'Server configuration error');

      return;
    }

    const payload = await verifyJWT(parsed.token, this.jwtSecret);

    if (!payload || payload.type !== 'access') {
      ws.close(1008, 'Invalid or expired token');

      return;
    }

    const userId = payload.sub;

    // First connection sets the owner; subsequent connections must match
    const owner = await this.getOwner();

    if (!owner) {
      await this.setOwner(userId);
    } else if (owner !== userId) {
      ws.close(1008, 'Forbidden');

      return;
    }

    // Auth successful — transition to pendingHello state
    (ws as unknown as { serializeAttachment: (v: unknown) => void }).serializeAttachment({
      userId,
      pendingHello: true,
    });

    ws.send(JSON.stringify({ type: 'auth_ok' }));
  }

  private handleControlMessage(ws: WebSocket, msg: ClientMessage | SessionCreatedMessage): void {
    // Handle E2E key exchange messages (not in typed union)
    const rawType = (msg as unknown as Record<string, unknown>).type;

    if (rawType === 'key_exchange') {
      if (getTag(ws)?.role === 'desktop') {
        this.broadcastToRole(ws, 'viewer', JSON.stringify(msg));
      }

      return;
    }

    if (rawType === 'key_exchange_ack') {
      if (getTag(ws)?.role === 'viewer') {
        this.broadcastToRole(ws, 'desktop', JSON.stringify(msg));
      }

      return;
    }

    if (rawType === 'transport_preference') {
      if (getTag(ws)?.role === 'viewer') {
        this.broadcastToRole(ws, 'desktop', JSON.stringify(msg));
      }

      return;
    }

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
        // Only viewers can request sessions
        if (getTag(ws)?.role === 'viewer') {
          this.forwardToRole(ws, 'desktop', msg as unknown as Record<string, unknown>);
        }
        break;

      case 'session_created':
        // Only desktop can announce session creation
        if (getTag(ws)?.role === 'desktop') {
          this.forwardToRole(ws, 'viewer', msg as unknown as Record<string, unknown>);
        }
        break;

      case 'scrollback_request': {
        // Viewer requests encrypted scrollback — forward to desktop with viewer's clientId
        const tag = getTag(ws);

        if (tag?.role === 'viewer' && !tag.readonly) {
          this.forwardToRole(ws, 'desktop', {
            ...(msg as unknown as Record<string, unknown>),
            fromClientId: tag.clientId,
          });
        }
        break;
      }

      case 'encrypted_scrollback_chunk':
      case 'scrollback_complete': {
        // Desktop sends encrypted scrollback to a specific viewer
        if (getTag(ws)?.role === 'desktop') {
          const toClientId = (msg as unknown as Record<string, unknown>).toClientId as string;

          if (toClientId) {
            this.forwardToClient(toClientId, msg as unknown as Record<string, unknown>);
          }
        }
        break;
      }
    }
  }

  private handleHello(ws: WebSocket, msg: HelloMessage): void {
    // Server assigns the role: first desktop connection is the owner/desktop,
    // all others are viewers. The client's claimed role is used only as a hint
    // for the initial desktop connection.
    const allSockets = this.ctx.getWebSockets();

    const existingDesktop = allSockets.some((sock) => {
      if (sock === ws) {
        return false;
      }

      const t = getTag(sock);

      return t?.role === 'desktop';
    });

    // Retrieve attachment stored during WS accept
    const pending = (ws as unknown as { deserializeAttachment: () => { userId?: string; shareReadonly?: boolean } }).deserializeAttachment();

    const assignedRole: ClientRole = pending?.shareReadonly
      ? 'viewer'
      : (!existingDesktop && msg.role === 'desktop') ? 'desktop' : 'viewer';

    const tag: ClientTag = {
      clientId: msg.clientId,
      role: assignedRole,
      device: msg.device,
      userId: pending?.userId ?? '',
      connectedAt: new Date().toISOString(),
      readonly: pending?.shareReadonly ?? false,
    };

    setTag(ws, tag);

    const clientInfos: ClientInfo[] = [];

    for (const sock of allSockets) {
      const t = getTag(sock);

      if (t && t.clientId) {
        clientInfos.push({
          clientId: t.clientId,
          role: t.role,
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
        assignedRole,
      }),
    );

    // Replay scrollback to viewers before sending ready
    if (assignedRole === 'viewer') {
      if (tag.readonly && this.shareFrames.length > 0) {
        // Replay stored 0xE1 frames — viewer decrypts with the key from the URL fragment
        for (const frame of this.shareFrames) {
          ws.send(frame);
        }
      } else if (tag.readonly) {
        // No share-encrypted frames buffered — send plaintext scrollback as fallback
        this.sendScrollbackChunks(ws, this.scrollback.getAll());
      }
      // Authenticated viewers: no plaintext scrollback — they request E2E-encrypted
      // scrollback from the desktop after key exchange completes
    }

    ws.send(JSON.stringify({ type: 'ready' }));

    this.broadcastJson(ws, {
      type: 'client_joined',
      clientId: msg.clientId,
      role: assignedRole,
      device: msg.device,
    });
  }

  private sendScrollbackChunks(ws: WebSocket, data: Uint8Array): void {
    if (data.length === 0) return;

    const CHUNK_SIZE = 32 * 1024;
    let offset = 0;

    while (offset < data.length) {
      const end = Math.min(offset + CHUNK_SIZE, data.length);
      const chunk = data.subarray(offset, end);
      const frame = new Uint8Array(5 + chunk.length);
      const view = new DataView(frame.buffer);
      frame[0] = 0x02; // SCROLLBACK_CHUNK
      view.setUint32(1, offset, false);
      frame.set(chunk, 5);
      ws.send(frame.buffer);
      offset = end;
    }
  }

  private broadcastToNonReadonlyViewers(sender: WebSocket, message: string | ArrayBuffer): void {
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === sender) continue;

      const tag = getTag(ws);

      if (tag?.role === 'viewer' && !tag.readonly) {
        ws.send(message);
      }
    }
  }

  private broadcastToRole(sender: WebSocket, targetRole: ClientRole, message: string | ArrayBuffer): void {
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

  private forwardToRole(_sender: WebSocket, targetRole: ClientRole, msg: Record<string, unknown>): void {
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

  private forwardToClient(targetClientId: string, msg: Record<string, unknown>): void {
    const json = JSON.stringify(msg);

    for (const ws of this.ctx.getWebSockets()) {
      const tag = getTag(ws);

      if (tag?.clientId === targetClientId) {
        ws.send(json);

        return;
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
