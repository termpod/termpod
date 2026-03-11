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
import { getTerminalSessionRouteRateLimitRule, type RequestRateLimitRule } from './rate-limit';

const MAX_MESSAGE_SIZE = 64 * 1024; // 64KB
const SCROLLBACK_BUFFER_SIZE = 512 * 1024; // 512KB

// WebSocket tags store client metadata as JSON so it survives hibernation
interface ClientTag {
  clientId: string;
  role: ClientRole;
  device: string;
  userId: string;
  connectedAt: string;
  readonly?: boolean;
}

interface RateLimitWindow {
  count: number;
  resetAt: number;
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
  /** Store complete 0xE1 frames for share viewer scrollback replay. */
  private shareFrames: ArrayBuffer[] = [];
  private shareFramesSize = 0;
  /** Fixed-window counters for connection bursts */
  private requestWindows = new Map<string, RateLimitWindow>();

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
    const limited = this.applyRouteRateLimit(url.pathname, request.method);

    if (limited) {
      return limited;
    }

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

      // Clear owner and share frames so the session can be reused
      this.shareFrames = [];
      this.shareFramesSize = 0;
      await this.setOwner(null);

      return new Response(JSON.stringify({ ok: true }));
    }

    return new Response('Not found', { status: 404 });
  }

  private applyRouteRateLimit(path: string, method: string): Response | null {
    const rule = getTerminalSessionRouteRateLimitRule(path, method);

    if (!rule) {
      return null;
    }

    return this.consumeRateLimit(rule);
  }

  private consumeRateLimit(rule: RequestRateLimitRule): Response | null {
    const now = Date.now();
    const existing = this.requestWindows.get(rule.key);

    if (!existing || existing.resetAt <= now) {
      this.requestWindows.set(rule.key, { count: 1, resetAt: now + rule.windowMs });
      return null;
    }

    if (existing.count >= rule.max) {
      const retryAfter = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
      return new Response('Too many requests', {
        status: 429,
        headers: { 'Retry-After': String(retryAfter) },
      });
    }

    existing.count += 1;
    return null;
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
      // Plaintext terminal data is no longer accepted — all terminal data must be E2E encrypted (0xE0).
      // Desktop and iOS never send plaintext frames; they buffer locally until E2E is established.
      console.warn('Rejecting plaintext 0x00 terminal frame — E2E encryption required');
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
      }
      // Authenticated viewers: request E2E-encrypted scrollback from desktop after key exchange.
      // No plaintext scrollback is stored or served by the relay.
    }

    ws.send(JSON.stringify({ type: 'ready' }));

    this.broadcastJson(ws, {
      type: 'client_joined',
      clientId: msg.clientId,
      role: assignedRole,
      device: msg.device,
    });
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
