import { DurableObject } from 'cloudflare:workers';
import { hashPassword, verifyPassword } from './auth';
import { verifyJWT } from './jwt';

export interface UserProfile {
  email: string;
  createdAt: string;
}

export interface DeviceInfo {
  id: string;
  name: string;
  deviceType: 'desktop' | 'mobile';
  platform: string;
  isOnline: boolean;
  lastSeenAt: string | null;
  createdAt: string;
}

export interface SessionInfo {
  id: string;
  deviceId: string;
  name: string;
  cwd: string;
  processName: string | null;
  ptyCols: number;
  ptyRows: number;
  createdAt: string;
}

export interface PendingSessionRequest {
  id: string;
  deviceId: string;
  requestedBy: string;
  createdAt: string;
}

// WebSocket tags store client metadata so it survives hibernation
interface DeviceClientTag {
  clientId: string;
  role: 'desktop' | 'viewer';
  device: string;
  userId: string;
  targetDeviceId: string;
  connectedAt: string;
}

function setWsTag(ws: WebSocket, tag: DeviceClientTag): void {
  (ws as unknown as { serializeAttachment: (v: unknown) => void }).serializeAttachment(tag);
}

function getWsTag(ws: WebSocket): DeviceClientTag | null {
  const tag = (ws as unknown as { deserializeAttachment: () => unknown }).deserializeAttachment();

  return (tag && typeof tag === 'object' && 'clientId' in (tag as Record<string, unknown>))
    ? tag as DeviceClientTag
    : null;
}

export class User extends DurableObject {
  private initialized = false;
  private jwtSecret: string | null = null;

  private ensureSchema(): void {
    if (this.initialized) {
      return;
    }

    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS profile (
        email TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        device_type TEXT NOT NULL CHECK(device_type IN ('desktop', 'mobile')),
        platform TEXT NOT NULL,
        is_online INTEGER DEFAULT 0,
        last_seen_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT 'shell',
        cwd TEXT DEFAULT '',
        process_name TEXT DEFAULT NULL,
        pty_cols INTEGER DEFAULT 120,
        pty_rows INTEGER DEFAULT 40,
        created_at TEXT NOT NULL,
        FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS pending_session_requests (
        id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL,
        requested_by TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS login_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        attempted_at TEXT NOT NULL
      );
    `);

    // Migrate: add process_name column if missing (table was created before this column existed)
    const cols = this.ctx.storage.sql
      .exec("PRAGMA table_info(sessions)")
      .toArray()
      .map((r) => r.name as string);

    if (!cols.includes('process_name')) {
      this.ctx.storage.sql.exec('ALTER TABLE sessions ADD COLUMN process_name TEXT DEFAULT NULL');
    }

    this.initialized = true;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    this.ensureSchema();

    // Device WebSocket upgrade
    const deviceWsMatch = path.match(/^\/devices\/([^/]+)\/ws$/);

    if (deviceWsMatch) {
      return this.handleDeviceWsUpgrade(request, deviceWsMatch[1]);
    }

    // Auth routes
    if (path === '/signup' && request.method === 'POST') {
      return this.handleSignup(request);
    }

    if (path === '/login' && request.method === 'POST') {
      return this.handleLogin(request);
    }

    // Device routes
    if (path === '/devices' && request.method === 'GET') {
      return this.handleListDevices();
    }

    if (path === '/devices' && request.method === 'POST') {
      return this.handleRegisterDevice(request);
    }

    const deviceMatch = path.match(/^\/devices\/([^/]+)$/);

    if (deviceMatch && request.method === 'DELETE') {
      return this.handleRemoveDevice(deviceMatch[1]);
    }

    const heartbeatMatch = path.match(/^\/devices\/([^/]+)\/heartbeat$/);

    if (heartbeatMatch && request.method === 'POST') {
      return this.handleHeartbeat(heartbeatMatch[1]);
    }

    const offlineMatch = path.match(/^\/devices\/([^/]+)\/offline$/);

    if (offlineMatch && request.method === 'POST') {
      return this.handleOffline(offlineMatch[1]);
    }

    // Session routes
    const sessionsMatch = path.match(/^\/devices\/([^/]+)\/sessions$/);

    if (sessionsMatch && request.method === 'GET') {
      return this.handleListSessions(sessionsMatch[1]);
    }

    if (sessionsMatch && request.method === 'POST') {
      return this.handleRegisterSession(sessionsMatch[1], request);
    }

    const sessionMatch = path.match(/^\/sessions\/([^/]+)$/);

    if (sessionMatch && request.method === 'DELETE') {
      return this.handleRemoveSession(sessionMatch[1]);
    }

    if (sessionMatch && request.method === 'PATCH') {
      return this.handleUpdateSession(sessionMatch[1], request);
    }

    // Pending session request routes
    const requestSessionMatch = path.match(/^\/devices\/([^/]+)\/request-session$/);

    if (requestSessionMatch && request.method === 'POST') {
      return this.handleRequestSession(requestSessionMatch[1], request);
    }

    const pendingMatch = path.match(/^\/devices\/([^/]+)\/pending-requests$/);

    if (pendingMatch && request.method === 'GET') {
      return this.handleGetPendingRequests(pendingMatch[1]);
    }

    if (pendingMatch && request.method === 'DELETE') {
      return this.handleClearPendingRequests(pendingMatch[1]);
    }

    // Access check
    if (path === '/check-session-access' && request.method === 'POST') {
      return this.handleCheckSessionAccess(request);
    }

    if (path === '/exists' && request.method === 'GET') {
      return this.handleExists();
    }

    return new Response('Not found', { status: 404 });
  }

  // --- Auth ---

  private async handleSignup(request: Request): Promise<Response> {
    const { email, password } = (await request.json()) as { email: string; password: string };

    const existing = this.ctx.storage.sql
      .exec('SELECT email FROM profile LIMIT 1')
      .toArray();

    if (existing.length > 0) {
      return Response.json({ error: 'Account already exists' }, { status: 409 });
    }

    const { hash, salt } = await hashPassword(password);

    this.ctx.storage.sql.exec(
      'INSERT INTO profile (email, password_hash, salt, created_at) VALUES (?, ?, ?, ?)',
      email,
      hash,
      salt,
      new Date().toISOString(),
    );

    return Response.json({ ok: true });
  }

  private async handleLogin(request: Request): Promise<Response> {
    // Rate limiting: max 5 failed attempts per 15-minute window
    const windowStart = new Date(Date.now() - 15 * 60 * 1000).toISOString();

    this.ctx.storage.sql.exec(
      'DELETE FROM login_attempts WHERE attempted_at < ?',
      windowStart,
    );

    const recentFailures = this.ctx.storage.sql
      .exec(
        'SELECT COUNT(*) as cnt FROM login_attempts WHERE attempted_at >= ?',
        windowStart,
      )
      .toArray();

    const failCount = (recentFailures[0]?.cnt as number) ?? 0;

    if (failCount >= 5) {
      return Response.json({ error: 'Too many login attempts. Try again later.' }, { status: 429 });
    }

    const { password } = (await request.json()) as { password: string };

    const rows = this.ctx.storage.sql
      .exec('SELECT password_hash, salt FROM profile LIMIT 1')
      .toArray();

    if (rows.length === 0) {
      this.ctx.storage.sql.exec(
        'INSERT INTO login_attempts (attempted_at) VALUES (?)',
        new Date().toISOString(),
      );

      return Response.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    const { password_hash, salt } = rows[0] as { password_hash: string; salt: string };
    const valid = await verifyPassword(password, password_hash, salt);

    if (!valid) {
      this.ctx.storage.sql.exec(
        'INSERT INTO login_attempts (attempted_at) VALUES (?)',
        new Date().toISOString(),
      );

      return Response.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    // Clear failed attempts on successful login
    this.ctx.storage.sql.exec('DELETE FROM login_attempts');

    return Response.json({ ok: true });
  }

  // --- Devices ---

  private handleListDevices(): Response {
    // Keep only the most recently seen device per platform to avoid duplicates
    // from cleared localStorage generating new device IDs
    this.ctx.storage.sql.exec(`
      DELETE FROM devices WHERE id NOT IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (PARTITION BY platform ORDER BY last_seen_at DESC, created_at DESC) AS rn
          FROM devices
        ) WHERE rn = 1
      )
    `);

    // Mark devices as offline if they haven't sent a heartbeat in 90 seconds
    const staleThreshold = new Date(Date.now() - 90_000).toISOString();
    this.ctx.storage.sql.exec(
      'UPDATE devices SET is_online = 0 WHERE is_online = 1 AND last_seen_at < ?',
      staleThreshold,
    );

    const rows = this.ctx.storage.sql
      .exec('SELECT id, name, device_type, platform, is_online, last_seen_at, created_at FROM devices ORDER BY created_at')
      .toArray();

    const devices: DeviceInfo[] = rows.map((r) => ({
      id: r.id as string,
      name: r.name as string,
      deviceType: r.device_type as 'desktop' | 'mobile',
      platform: r.platform as string,
      isOnline: (r.is_online as number) === 1,
      lastSeenAt: r.last_seen_at as string | null,
      createdAt: r.created_at as string,
    }));

    return Response.json({ devices });
  }

  private async handleRegisterDevice(request: Request): Promise<Response> {
    const body = (await request.json()) as {
      id: string;
      name: string;
      deviceType: 'desktop' | 'mobile';
      platform: string;
    };

    if (!body.id || body.id.length > 64) {
      return Response.json({ error: 'Invalid device ID' }, { status: 400 });
    }

    if (!body.name || body.name.length > 255) {
      return Response.json({ error: 'Invalid device name' }, { status: 400 });
    }

    const VALID_PLATFORMS = ['macos', 'iphone', 'ipad', 'browser'];

    if (!VALID_PLATFORMS.includes(body.platform)) {
      return Response.json({ error: 'Invalid platform' }, { status: 400 });
    }

    if (!['desktop', 'mobile'].includes(body.deviceType)) {
      return Response.json({ error: 'Invalid device type' }, { status: 400 });
    }

    // Clean up stale sessions from previous launches — desktop starts fresh each time
    this.ctx.storage.sql.exec('DELETE FROM sessions WHERE device_id = ?', body.id);

    // Clean up old offline devices of the same platform (e.g. stale entries from cleared localStorage)
    this.ctx.storage.sql.exec(
      'DELETE FROM devices WHERE id != ? AND platform = ? AND is_online = 0',
      body.id,
      body.platform,
    );

    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO devices (id, name, device_type, platform, is_online, last_seen_at, created_at)
       VALUES (?, ?, ?, ?, 1, ?, COALESCE((SELECT created_at FROM devices WHERE id = ?), ?))`,
      body.id,
      body.name,
      body.deviceType,
      body.platform,
      new Date().toISOString(),
      body.id,
      new Date().toISOString(),
    );

    return Response.json({ ok: true }, { status: 201 });
  }

  private handleRemoveDevice(deviceId: string): Response {
    this.ctx.storage.sql.exec('DELETE FROM sessions WHERE device_id = ?', deviceId);
    this.ctx.storage.sql.exec('DELETE FROM devices WHERE id = ?', deviceId);

    return Response.json({ ok: true });
  }

  private handleHeartbeat(deviceId: string): Response {
    this.ctx.storage.sql.exec(
      'UPDATE devices SET is_online = 1, last_seen_at = ? WHERE id = ?',
      new Date().toISOString(),
      deviceId,
    );

    return Response.json({ ok: true });
  }

  private handleOffline(deviceId: string): Response {
    this.ctx.storage.sql.exec(
      'UPDATE devices SET is_online = 0, last_seen_at = ? WHERE id = ?',
      new Date().toISOString(),
      deviceId,
    );

    // Clean up sessions when device goes offline
    this.ctx.storage.sql.exec('DELETE FROM sessions WHERE device_id = ?', deviceId);

    return Response.json({ ok: true });
  }

  // --- Sessions ---

  private handleListSessions(deviceId: string): Response {
    const rows = this.ctx.storage.sql
      .exec(
        'SELECT id, device_id, name, cwd, process_name, pty_cols, pty_rows, created_at FROM sessions WHERE device_id = ? ORDER BY created_at',
        deviceId,
      )
      .toArray();

    const sessions: SessionInfo[] = rows.map((r) => ({
      id: r.id as string,
      deviceId: r.device_id as string,
      name: r.name as string,
      cwd: r.cwd as string,
      processName: (r.process_name as string) ?? null,
      ptyCols: r.pty_cols as number,
      ptyRows: r.pty_rows as number,
      createdAt: r.created_at as string,
    }));

    return Response.json({ sessions });
  }

  private async handleRegisterSession(deviceId: string, request: Request): Promise<Response> {
    const body = (await request.json()) as {
      id: string;
      name?: string;
      cwd?: string;
      ptyCols?: number;
      ptyRows?: number;
    };

    if (!body.id || body.id.length > 64) {
      return Response.json({ error: 'Invalid session ID' }, { status: 400 });
    }

    if (body.name !== undefined && body.name.length > 255) {
      return Response.json({ error: 'Session name too long' }, { status: 400 });
    }

    if (body.cwd !== undefined && body.cwd.length > 4096) {
      return Response.json({ error: 'CWD too long' }, { status: 400 });
    }

    // Verify device exists
    const device = this.ctx.storage.sql
      .exec('SELECT id FROM devices WHERE id = ?', deviceId)
      .toArray();

    if (device.length === 0) {
      return Response.json({ error: 'Device not found' }, { status: 404 });
    }

    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO sessions (id, device_id, name, cwd, pty_cols, pty_rows, created_at) VALUES (?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM sessions WHERE id = ?), ?))',
      body.id,
      deviceId,
      body.name ?? 'shell',
      body.cwd ?? '',
      body.ptyCols ?? 120,
      body.ptyRows ?? 40,
      body.id,
      new Date().toISOString(),
    );

    return Response.json({ ok: true, sessionId: body.id }, { status: 201 });
  }

  private async handleUpdateSession(sessionId: string, request: Request): Promise<Response> {
    const body = (await request.json()) as {
      name?: string;
      cwd?: string;
      processName?: string | null;
    };

    if (body.name !== undefined && typeof body.name === 'string' && body.name.length > 255) {
      return Response.json({ error: 'Session name too long' }, { status: 400 });
    }

    if (body.cwd !== undefined && typeof body.cwd === 'string' && body.cwd.length > 4096) {
      return Response.json({ error: 'CWD too long' }, { status: 400 });
    }

    if (body.processName !== undefined && body.processName !== null && typeof body.processName === 'string' && body.processName.length > 255) {
      return Response.json({ error: 'Process name too long' }, { status: 400 });
    }

    const existing = this.ctx.storage.sql
      .exec('SELECT id FROM sessions WHERE id = ?', sessionId)
      .toArray();

    if (existing.length === 0) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }

    if (body.name !== undefined) {
      this.ctx.storage.sql.exec('UPDATE sessions SET name = ? WHERE id = ?', body.name, sessionId);
    }

    if (body.cwd !== undefined) {
      this.ctx.storage.sql.exec('UPDATE sessions SET cwd = ? WHERE id = ?', body.cwd, sessionId);
    }

    if (body.processName !== undefined) {
      this.ctx.storage.sql.exec('UPDATE sessions SET process_name = ? WHERE id = ?', body.processName, sessionId);
    }

    return Response.json({ ok: true });
  }

  private handleRemoveSession(sessionId: string): Response {
    this.ctx.storage.sql.exec('DELETE FROM sessions WHERE id = ?', sessionId);

    return Response.json({ ok: true });
  }

  // --- Pending Session Requests ---

  private async handleRequestSession(deviceId: string, request: Request): Promise<Response> {
    const body = (await request.json()) as { requestedBy?: string };

    const device = this.ctx.storage.sql
      .exec('SELECT id FROM devices WHERE id = ?', deviceId)
      .toArray();

    if (device.length === 0) {
      return Response.json({ error: 'Device not found' }, { status: 404 });
    }

    const id = crypto.randomUUID();

    this.ctx.storage.sql.exec(
      'INSERT INTO pending_session_requests (id, device_id, requested_by, created_at) VALUES (?, ?, ?, ?)',
      id,
      deviceId,
      body.requestedBy ?? '',
      new Date().toISOString(),
    );

    return Response.json({ ok: true, requestId: id }, { status: 201 });
  }

  private handleGetPendingRequests(deviceId: string): Response {
    const rows = this.ctx.storage.sql
      .exec(
        'SELECT id, device_id, requested_by, created_at FROM pending_session_requests WHERE device_id = ? ORDER BY created_at',
        deviceId,
      )
      .toArray();

    const requests: PendingSessionRequest[] = rows.map((r) => ({
      id: r.id as string,
      deviceId: r.device_id as string,
      requestedBy: r.requested_by as string,
      createdAt: r.created_at as string,
    }));

    return Response.json({ requests });
  }

  private handleClearPendingRequests(deviceId: string): Response {
    this.ctx.storage.sql.exec(
      'DELETE FROM pending_session_requests WHERE device_id = ?',
      deviceId,
    );

    return Response.json({ ok: true });
  }

  private handleExists(): Response {
    const rows = this.ctx.storage.sql
      .exec('SELECT email FROM profile LIMIT 1')
      .toArray();

    if (rows.length === 0) {
      return Response.json({ exists: false }, { status: 404 });
    }

    return Response.json({ exists: true });
  }

  private async handleCheckSessionAccess(request: Request): Promise<Response> {
    const { sessionId } = (await request.json()) as { sessionId: string };

    const rows = this.ctx.storage.sql
      .exec('SELECT id FROM sessions WHERE id = ?', sessionId)
      .toArray();

    return Response.json({ allowed: rows.length > 0 });
  }

  // --- Device WebSocket ---

  private handleDeviceWsUpgrade(request: Request, deviceId: string): Response {
    const secret = request.headers.get('X-JWT-Secret');

    if (secret) {
      this.jwtSecret = secret;
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Check if Worker already validated the token (legacy flow)
    const userId = request.headers.get('X-User-Id');

    if (userId) {
      (server as unknown as { serializeAttachment: (v: unknown) => void }).serializeAttachment({
        userId,
        targetDeviceId: deviceId,
        pendingHello: true,
      });
    } else {
      (server as unknown as { serializeAttachment: (v: unknown) => void }).serializeAttachment({
        targetDeviceId: deviceId,
        pendingAuth: true,
      });
    }

    this.ctx.acceptWebSocket(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') {
      return; // Device WS is JSON-only (no binary terminal data)
    }

    // Enforce size limit
    if (message.length > 64 * 1024) {
      ws.close(1009, 'Message too large');

      return;
    }

    const attachment = (ws as unknown as { deserializeAttachment: () => unknown }).deserializeAttachment() as Record<string, unknown> | null;

    if (attachment?.pendingAuth) {
      await this.handleWsAuth(ws, message, attachment.targetDeviceId as string);

      return;
    }

    let parsed: Record<string, unknown>;

    try {
      parsed = JSON.parse(message);
    } catch {
      ws.close(1008, 'Invalid JSON');

      return;
    }

    // Pending hello — only accept hello messages
    if (attachment?.pendingHello) {
      if (parsed.type === 'hello') {
        this.handleWsHello(ws, parsed, attachment);
      }

      return;
    }

    this.handleWsControlMessage(ws, parsed);
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const tag = getWsTag(ws);

    if (!tag) {
      return;
    }

    // If desktop disconnects, mark device offline and notify viewers
    if (tag.role === 'desktop') {
      this.ctx.storage.sql.exec(
        'UPDATE devices SET is_online = 0, last_seen_at = ? WHERE id = ?',
        new Date().toISOString(),
        tag.targetDeviceId,
      );
    }

    this.broadcastToDevice(tag.targetDeviceId, ws, {
      type: 'client_left',
      clientId: tag.clientId,
      role: tag.role,
      device: tag.device,
    });
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  private async handleWsAuth(ws: WebSocket, message: string, targetDeviceId: string): Promise<void> {
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

    (ws as unknown as { serializeAttachment: (v: unknown) => void }).serializeAttachment({
      userId: payload.sub,
      targetDeviceId,
      pendingHello: true,
    });

    ws.send(JSON.stringify({ type: 'auth_ok' }));
  }

  private handleWsHello(ws: WebSocket, msg: Record<string, unknown>, attachment: Record<string, unknown>): void {
    const clientId = (msg.clientId as string) || crypto.randomUUID();
    const role = (msg.role as string) === 'desktop' ? 'desktop' as const : 'viewer' as const;
    const device = (msg.device as string) || 'unknown';
    const targetDeviceId = attachment.targetDeviceId as string;
    const userId = attachment.userId as string;

    const tag: DeviceClientTag = {
      clientId,
      role,
      device,
      userId,
      targetDeviceId,
      connectedAt: new Date().toISOString(),
    };

    setWsTag(ws, tag);

    // If desktop, mark device online and update heartbeat
    if (role === 'desktop') {
      this.ctx.storage.sql.exec(
        'UPDATE devices SET is_online = 1, last_seen_at = ? WHERE id = ?',
        new Date().toISOString(),
        targetDeviceId,
      );
    }

    // Send current client list for this device
    const clients: { clientId: string; role: string; device: string; connectedAt: string }[] = [];

    for (const sock of this.ctx.getWebSockets()) {
      const t = getWsTag(sock);

      if (t && t.targetDeviceId === targetDeviceId) {
        clients.push({
          clientId: t.clientId,
          role: t.role,
          device: t.device,
          connectedAt: t.connectedAt,
        });
      }
    }

    ws.send(JSON.stringify({ type: 'hello_ok', clients }));

    // Notify other clients of this device
    this.broadcastToDevice(targetDeviceId, ws, {
      type: 'client_joined',
      clientId,
      role,
      device,
    });
  }

  private handleWsControlMessage(ws: WebSocket, msg: Record<string, unknown>): void {
    const tag = getWsTag(ws);

    if (!tag) {
      return;
    }

    const type = msg.type as string;

    switch (type) {
      case 'ping':
        ws.send(JSON.stringify({
          type: 'pong',
          timestamp: msg.timestamp,
          serverTime: Date.now(),
        }));
        break;

      case 'list_sessions':
        this.handleWsListSessions(ws, tag);
        break;

      case 'create_session_request':
        // Forward from viewer to desktop
        if (tag.role === 'viewer') {
          this.forwardToDeviceRole(tag.targetDeviceId, ws, 'desktop', msg);
        }
        break;

      case 'session_created':
        // Forward from desktop to viewers (or to specific requestor)
        if (tag.role === 'desktop') {
          if (msg.toClientId) {
            this.forwardToClient(msg.toClientId as string, msg);
          } else {
            this.forwardToDeviceRole(tag.targetDeviceId, ws, 'viewer', msg);
          }
        }
        break;

      case 'delete_session':
        // Forward to desktop; also remove from SQLite
        if (tag.role === 'viewer') {
          this.forwardToDeviceRole(tag.targetDeviceId, ws, 'desktop', msg);

          if (msg.sessionId) {
            this.ctx.storage.sql.exec('DELETE FROM sessions WHERE id = ?', msg.sessionId as string);
          }
        }
        break;

      case 'session_closed':
        // Forward from desktop to all viewers
        if (tag.role === 'desktop') {
          this.forwardToDeviceRole(tag.targetDeviceId, ws, 'viewer', msg);

          if (msg.sessionId) {
            this.ctx.storage.sql.exec('DELETE FROM sessions WHERE id = ?', msg.sessionId as string);
          }
        }
        break;

      case 'sessions_updated':
        // Desktop sends updated session list — update SQLite and broadcast to viewers
        if (tag.role === 'desktop') {
          this.handleWsSessionsUpdated(ws, tag, msg);
        }
        break;

      case 'webrtc_offer':
      case 'webrtc_answer':
      case 'webrtc_ice':
        this.forwardToClient(msg.toClientId as string, msg);
        break;
    }
  }

  private handleWsListSessions(ws: WebSocket, tag: DeviceClientTag): void {
    this.ensureSchema();

    const rows = this.ctx.storage.sql
      .exec(
        'SELECT id, device_id, name, cwd, process_name, pty_cols, pty_rows, created_at FROM sessions WHERE device_id = ? ORDER BY created_at',
        tag.targetDeviceId,
      )
      .toArray();

    const sessions = rows.map((r) => ({
      id: r.id as string,
      deviceId: r.device_id as string,
      name: r.name as string,
      cwd: r.cwd as string,
      processName: (r.process_name as string) ?? null,
      ptyCols: r.pty_cols as number,
      ptyRows: r.pty_rows as number,
      createdAt: r.created_at as string,
    }));

    ws.send(JSON.stringify({ type: 'sessions_list', sessions }));
  }

  private handleWsSessionsUpdated(ws: WebSocket, tag: DeviceClientTag, msg: Record<string, unknown>): void {
    const sessions = msg.sessions as Array<{
      id: string;
      name: string;
      cwd: string;
      processName?: string | null;
      ptyCols?: number;
      ptyRows?: number;
    }>;

    if (!Array.isArray(sessions)) {
      return;
    }

    // Replace all sessions for this device with the new list
    this.ctx.storage.sql.exec('DELETE FROM sessions WHERE device_id = ?', tag.targetDeviceId);

    for (const s of sessions) {
      if (!s.id || typeof s.id !== 'string' || s.id.length > 64) {
        continue;
      }

      this.ctx.storage.sql.exec(
        'INSERT OR REPLACE INTO sessions (id, device_id, name, cwd, process_name, pty_cols, pty_rows, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        s.id,
        tag.targetDeviceId,
        s.name ?? 'shell',
        s.cwd ?? '',
        s.processName ?? null,
        s.ptyCols ?? 120,
        s.ptyRows ?? 40,
        new Date().toISOString(),
      );
    }

    // Broadcast to viewers of this device
    this.forwardToDeviceRole(tag.targetDeviceId, ws, 'viewer', {
      type: 'sessions_updated',
      sessions,
    });
  }

  // --- Device WS helpers ---

  private broadcastToDevice(deviceId: string, sender: WebSocket, msg: Record<string, unknown>): void {
    const json = JSON.stringify(msg);

    for (const sock of this.ctx.getWebSockets()) {
      if (sock === sender) {
        continue;
      }

      const t = getWsTag(sock);

      if (t?.targetDeviceId === deviceId) {
        sock.send(json);
      }
    }
  }

  private forwardToDeviceRole(deviceId: string, sender: WebSocket, targetRole: string, msg: Record<string, unknown>): void {
    const json = JSON.stringify(msg);

    for (const sock of this.ctx.getWebSockets()) {
      if (sock === sender) {
        continue;
      }

      const t = getWsTag(sock);

      if (t?.targetDeviceId === deviceId && t.role === targetRole) {
        sock.send(json);
      }
    }
  }

  private forwardToClient(clientId: string, msg: Record<string, unknown>): void {
    const json = JSON.stringify(msg);

    for (const sock of this.ctx.getWebSockets()) {
      const t = getWsTag(sock);

      if (t?.clientId === clientId) {
        sock.send(json);

        return;
      }
    }
  }
}
