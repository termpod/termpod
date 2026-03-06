import { DurableObject } from 'cloudflare:workers';
import { hashPassword, verifyPassword } from './auth';

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

export class User extends DurableObject {
  private initialized = false;

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
    `);

    this.initialized = true;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    this.ensureSchema();

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
    const { password } = (await request.json()) as { password: string };

    const rows = this.ctx.storage.sql
      .exec('SELECT password_hash, salt FROM profile LIMIT 1')
      .toArray();

    if (rows.length === 0) {
      return Response.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    const { password_hash, salt } = rows[0] as { password_hash: string; salt: string };
    const valid = await verifyPassword(password, password_hash, salt);

    if (!valid) {
      return Response.json({ error: 'Invalid credentials' }, { status: 401 });
    }

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
        'SELECT id, device_id, name, cwd, pty_cols, pty_rows, created_at FROM sessions WHERE device_id = ? ORDER BY created_at',
        deviceId,
      )
      .toArray();

    const sessions: SessionInfo[] = rows.map((r) => ({
      id: r.id as string,
      deviceId: r.device_id as string,
      name: r.name as string,
      cwd: r.cwd as string,
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

  private async handleCheckSessionAccess(request: Request): Promise<Response> {
    const { sessionId } = (await request.json()) as { sessionId: string };

    const rows = this.ctx.storage.sql
      .exec('SELECT id FROM sessions WHERE id = ?', sessionId)
      .toArray();

    return Response.json({ allowed: rows.length > 0 });
  }
}
