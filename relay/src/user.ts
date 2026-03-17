import { DurableObject } from 'cloudflare:workers';
import { hashPassword, verifyPassword } from './auth';
import { verifyJWT } from './jwt';
import {
  getInternalRateLimitRule,
  getUserRouteRateLimitRule,
  type RequestRateLimitRule,
} from './rate-limit';
import type { Plan, SubscriptionStatus } from './subscription';

/** Subset of Worker env bindings needed by the User DO (alarm emails, etc.) */
interface UserEnv {
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  POLAR_WEBHOOK_SECRET?: string;
  [key: string]: unknown;
}

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
  ptyCols: number;
  ptyRows: number;
  createdAt: string;
  // name, cwd, processName are E2E encrypted — never stored or returned by relay
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

  return tag && typeof tag === 'object' && 'clientId' in (tag as Record<string, unknown>)
    ? (tag as DeviceClientTag)
    : null;
}

// Minimum interval between sessions_updated writes per device (ms)
const SESSIONS_UPDATE_MIN_INTERVAL = 3_000;

interface RateLimitWindow {
  count: number;
  resetAt: number;
}

export class User extends DurableObject<UserEnv> {
  private initialized = false;
  private jwtSecret: string | null = null;
  /** Last sessions_updated write timestamp per device ID */
  private lastSessionsUpdate = new Map<string, number>();
  /** Last heartbeat write timestamp per device ID */
  private lastHeartbeat = new Map<string, number>();
  /** Fixed-window request counters keyed by rate-limit rule + scope */
  private requestWindows = new Map<string, RateLimitWindow>();

  private ensureSchema(): void {
    if (this.initialized) {
      return;
    }

    // Check if schema already exists (read-only — no write cost)
    const tables = this.ctx.storage.sql
      .exec("SELECT name FROM sqlite_master WHERE type='table'")
      .toArray()
      .map((r) => r.name as string);

    if (!tables.includes('profile')) {
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

        CREATE TABLE IF NOT EXISTS share_tokens (
          token TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          expires_at TEXT NOT NULL
        );
      `);
    }

    // Migrate: add process_name column if missing (table was created before this column existed)
    if (tables.includes('sessions')) {
      const cols = this.ctx.storage.sql
        .exec('PRAGMA table_info(sessions)')
        .toArray()
        .map((r) => r.name as string);

      if (!cols.includes('process_name')) {
        this.ctx.storage.sql.exec('ALTER TABLE sessions ADD COLUMN process_name TEXT DEFAULT NULL');
      }
    }

    // Migrate: add reset_code columns to profile if missing
    if (tables.includes('profile')) {
      const profileCols = this.ctx.storage.sql
        .exec('PRAGMA table_info(profile)')
        .toArray()
        .map((r) => r.name as string);

      if (!profileCols.includes('reset_code')) {
        this.ctx.storage.sql.exec('ALTER TABLE profile ADD COLUMN reset_code TEXT DEFAULT NULL');
        this.ctx.storage.sql.exec(
          'ALTER TABLE profile ADD COLUMN reset_code_expires_at INTEGER DEFAULT NULL',
        );
      }

      // Migrate: add reset attempt tracking
      if (!profileCols.includes('reset_attempts')) {
        this.ctx.storage.sql.exec(
          'ALTER TABLE profile ADD COLUMN reset_attempts INTEGER DEFAULT 0',
        );
      }

      // Migrate: add subscription columns
      if (!profileCols.includes('plan')) {
        this.ctx.storage.sql.exec(
          "ALTER TABLE profile ADD COLUMN plan TEXT NOT NULL DEFAULT 'free'",
        );
        this.ctx.storage.sql.exec(
          'ALTER TABLE profile ADD COLUMN trial_ends_at INTEGER DEFAULT NULL',
        );
        this.ctx.storage.sql.exec(
          'ALTER TABLE profile ADD COLUMN plan_expires_at INTEGER DEFAULT NULL',
        );
        this.ctx.storage.sql.exec(
          'ALTER TABLE profile ADD COLUMN polar_customer_id TEXT DEFAULT NULL',
        );
        this.ctx.storage.sql.exec(
          'ALTER TABLE profile ADD COLUMN cancel_at_period_end INTEGER DEFAULT 0',
        );
      }
    }

    this.initialized = true;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    this.ensureSchema();

    if (path === '/rate-limit' && request.method === 'POST') {
      return this.handleConsumeRateLimit(request);
    }

    const rateLimitResponse = this.applyRouteRateLimit(path, request.method);

    if (rateLimitResponse) {
      return rateLimitResponse;
    }

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

    if (path === '/forgot-password' && request.method === 'POST') {
      return this.handleForgotPassword();
    }

    if (path === '/reset-password' && request.method === 'POST') {
      return this.handleResetPassword(request);
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

    // Share token routes
    const shareMatch = path.match(/^\/sessions\/([^/]+)\/share$/);

    if (shareMatch && request.method === 'POST') {
      return this.handleCreateShareToken(shareMatch[1], request);
    }

    if (shareMatch && request.method === 'DELETE') {
      return this.handleRevokeShareToken(shareMatch[1]);
    }

    if (path === '/validate-share-token' && request.method === 'POST') {
      return this.handleValidateShareToken(request);
    }

    // Access check
    if (path === '/check-session-access' && request.method === 'POST') {
      return this.handleCheckSessionAccess(request);
    }

    if (path === '/exists' && request.method === 'GET') {
      return this.handleExists();
    }

    // Subscription routes
    if (path === '/subscription' && request.method === 'GET') {
      return this.handleGetSubscription();
    }

    if (path === '/subscription' && request.method === 'PATCH') {
      return this.handleUpdateSubscription(request);
    }

    return new Response('Not found', { status: 404 });
  }

  private applyRouteRateLimit(path: string, method: string): Response | null {
    const rule = getUserRouteRateLimitRule(path, method);

    if (!rule) {
      return null;
    }

    return this.consumeRateLimit(rule, path);
  }

  private consumeRateLimit(rule: RequestRateLimitRule, scope = ''): Response | null {
    const now = Date.now();
    const key = scope ? `${rule.key}:${scope}` : rule.key;

    if (this.requestWindows.size > 128) {
      for (const [windowKey, window] of this.requestWindows) {
        if (window.resetAt <= now) {
          this.requestWindows.delete(windowKey);
        }
      }
    }

    const existing = this.requestWindows.get(key);

    if (!existing || existing.resetAt <= now) {
      this.requestWindows.set(key, { count: 1, resetAt: now + rule.windowMs });
      return null;
    }

    if (existing.count >= rule.max) {
      const retryAfter = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));

      return Response.json(
        { error: 'Too many requests. Try again later.', retryAfter },
        {
          status: 429,
          headers: { 'Retry-After': String(retryAfter) },
        },
      );
    }

    existing.count += 1;
    return null;
  }

  private async handleConsumeRateLimit(request: Request): Promise<Response> {
    const { name, scope } = (await request.json()) as { name?: string; scope?: string };

    if (!name) {
      return Response.json({ error: 'Rate limit name required' }, { status: 400 });
    }

    const rule = getInternalRateLimitRule(name);

    if (!rule) {
      return Response.json({ error: 'Unknown rate limit' }, { status: 404 });
    }

    const limited = this.consumeRateLimit(rule, scope);

    if (limited) {
      return limited;
    }

    return Response.json({ ok: true });
  }

  // --- Auth ---

  private async handleSignup(request: Request): Promise<Response> {
    const { email, password } = (await request.json()) as { email: string; password: string };

    const existing = this.ctx.storage.sql.exec('SELECT email FROM profile LIMIT 1').toArray();

    if (existing.length > 0) {
      return Response.json({ error: 'Account already exists' }, { status: 409 });
    }

    const { hash, salt } = await hashPassword(password);
    const trialEndsAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7-day trial

    this.ctx.storage.sql.exec(
      'INSERT INTO profile (email, password_hash, salt, created_at, trial_ends_at) VALUES (?, ?, ?, ?, ?)',
      email,
      hash,
      salt,
      new Date().toISOString(),
      trialEndsAt,
    );

    // Schedule trial expiry warning email 1 day before trial ends.
    // DO alarms support only one alarm at a time — the warning alarm
    // will reschedule itself to fire again at exact expiry.
    const warningAt = trialEndsAt - 24 * 60 * 60 * 1000;

    await this.ctx.storage.setAlarm(warningAt);

    return Response.json({ ok: true });
  }

  private async handleLogin(request: Request): Promise<Response> {
    // Rate limiting: max 5 failed attempts per 15-minute window
    const windowStart = new Date(Date.now() - 15 * 60 * 1000).toISOString();

    this.ctx.storage.sql.exec('DELETE FROM login_attempts WHERE attempted_at < ?', windowStart);

    const recentFailures = this.ctx.storage.sql
      .exec('SELECT COUNT(*) as cnt FROM login_attempts WHERE attempted_at >= ?', windowStart)
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

  private handleForgotPassword(): Response {
    const rows = this.ctx.storage.sql.exec('SELECT email FROM profile LIMIT 1').toArray();

    if (rows.length === 0) {
      // Return success regardless — prevent email enumeration
      return Response.json({ code: null });
    }

    // Generate 6-digit numeric code
    const code = String(
      Math.floor(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000)),
    ).padStart(6, '0');
    const expiresAt = Date.now() + 60 * 60 * 1000; // 1 hour

    this.ctx.storage.sql.exec(
      'UPDATE profile SET reset_code = ?, reset_code_expires_at = ?, reset_attempts = 0',
      code,
      expiresAt,
    );

    return Response.json({ code });
  }

  private async handleResetPassword(request: Request): Promise<Response> {
    const { code, password } = (await request.json()) as { code: string; password: string };

    if (!code || !password || password.length < 8) {
      return Response.json({ error: 'Code and password (min 8 chars) required' }, { status: 400 });
    }

    const rows = this.ctx.storage.sql
      .exec('SELECT reset_code, reset_code_expires_at, reset_attempts FROM profile LIMIT 1')
      .toArray();

    if (rows.length === 0) {
      return Response.json({ error: 'Invalid or expired code' }, { status: 400 });
    }

    const { reset_code, reset_code_expires_at, reset_attempts } = rows[0] as {
      reset_code: string | null;
      reset_code_expires_at: number | null;
      reset_attempts: number;
    };

    if (!reset_code || !reset_code_expires_at) {
      return Response.json({ error: 'Invalid or expired code' }, { status: 400 });
    }

    // Invalidate code after 5 failed attempts (prevents brute-force on 6-digit code)
    if (reset_attempts >= 5) {
      this.ctx.storage.sql.exec(
        'UPDATE profile SET reset_code = NULL, reset_code_expires_at = NULL, reset_attempts = 0',
      );

      return Response.json(
        { error: 'Too many failed attempts. Request a new code.' },
        { status: 400 },
      );
    }

    if (Date.now() > reset_code_expires_at) {
      this.ctx.storage.sql.exec(
        'UPDATE profile SET reset_code = NULL, reset_code_expires_at = NULL, reset_attempts = 0',
      );

      return Response.json({ error: 'Code has expired' }, { status: 400 });
    }

    // Constant-time comparison
    const encoder = new TextEncoder();

    if (!crypto.subtle.timingSafeEqual(encoder.encode(code), encoder.encode(reset_code))) {
      // Increment attempt counter on wrong code
      this.ctx.storage.sql.exec('UPDATE profile SET reset_attempts = reset_attempts + 1');

      return Response.json({ error: 'Invalid or expired code' }, { status: 400 });
    }

    const { hash, salt } = await hashPassword(password);

    this.ctx.storage.sql.exec(
      'UPDATE profile SET password_hash = ?, salt = ?, reset_code = NULL, reset_code_expires_at = NULL, reset_attempts = 0',
      hash,
      salt,
    );

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

    // Mark devices as offline if they haven't sent a heartbeat in 180 seconds
    const staleThreshold = new Date(Date.now() - 180_000).toISOString();
    this.ctx.storage.sql.exec(
      'UPDATE devices SET is_online = 0 WHERE is_online = 1 AND last_seen_at < ?',
      staleThreshold,
    );

    const rows = this.ctx.storage.sql
      .exec(
        'SELECT id, name, device_type, platform, is_online, last_seen_at, created_at FROM devices ORDER BY created_at',
      )
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

    const selfHosted = request.headers.get('X-Self-Hosted') === '1';

    // Free tier: max 1 desktop device on hosted relay
    if (!selfHosted && body.deviceType === 'desktop' && this.getEffectivePlan() === 'free') {
      const existing = this.ctx.storage.sql
        .exec("SELECT id FROM devices WHERE device_type = 'desktop' AND id != ?", body.id)
        .toArray();

      if (existing.length > 0) {
        return Response.json(
          {
            error: 'Free plan allows 1 desktop device. Upgrade to Pro for unlimited devices.',
            code: 'UPGRADE_REQUIRED',
          },
          { status: 403 },
        );
      }
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
    // Skip redundant writes — only update if >30s since last heartbeat write
    const now = Date.now();
    const last = this.lastHeartbeat.get(deviceId) ?? 0;

    if (now - last >= 30_000) {
      this.lastHeartbeat.set(deviceId, now);
      this.ctx.storage.sql.exec(
        'UPDATE devices SET is_online = 1, last_seen_at = ? WHERE id = ?',
        new Date().toISOString(),
        deviceId,
      );
    }

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
    // Only return non-sensitive fields — real metadata delivered E2E encrypted via Device WS
    const rows = this.ctx.storage.sql
      .exec(
        'SELECT id, device_id, pty_cols, pty_rows, created_at FROM sessions WHERE device_id = ? ORDER BY created_at',
        deviceId,
      )
      .toArray();

    const sessions = rows.map((r) => ({
      id: r.id as string,
      deviceId: r.device_id as string,
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

    // Store only non-sensitive fields — real name/cwd/processName delivered E2E encrypted via Device WS
    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO sessions (id, device_id, name, cwd, pty_cols, pty_rows, created_at) VALUES (?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM sessions WHERE id = ?), ?))',
      body.id,
      deviceId,
      'encrypted',
      '',
      body.ptyCols ?? 120,
      body.ptyRows ?? 40,
      body.id,
      new Date().toISOString(),
    );

    return Response.json({ ok: true, sessionId: body.id }, { status: 201 });
  }

  private async handleUpdateSession(_sessionId: string, _request: Request): Promise<Response> {
    // Session metadata (name, cwd, processName) is delivered E2E encrypted via Device WS.
    // This endpoint no longer accepts sensitive field updates to prevent plaintext leakage.
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
    this.ctx.storage.sql.exec('DELETE FROM pending_session_requests WHERE device_id = ?', deviceId);

    return Response.json({ ok: true });
  }

  private handleExists(): Response {
    const rows = this.ctx.storage.sql.exec('SELECT email FROM profile LIMIT 1').toArray();

    if (rows.length === 0) {
      return Response.json({ exists: false }, { status: 404 });
    }

    return Response.json({ exists: true });
  }

  // --- Subscription ---

  getEffectivePlan(): Plan {
    const rows = this.ctx.storage.sql
      .exec('SELECT plan, trial_ends_at, plan_expires_at FROM profile LIMIT 1')
      .toArray();

    if (rows.length === 0) {
      return 'free';
    }

    const { plan, trial_ends_at, plan_expires_at } = rows[0] as {
      plan: string;
      trial_ends_at: number | null;
      plan_expires_at: number | null;
    };

    const now = Date.now();

    // Active trial
    if (trial_ends_at && now < trial_ends_at) {
      return 'pro';
    }

    // Active paid plan
    if (plan === 'pro' && (!plan_expires_at || now < plan_expires_at)) {
      return 'pro';
    }

    return 'free';
  }

  private handleGetSubscription(): Response {
    const rows = this.ctx.storage.sql
      .exec(
        'SELECT plan, trial_ends_at, plan_expires_at, polar_customer_id, cancel_at_period_end FROM profile LIMIT 1',
      )
      .toArray();

    if (rows.length === 0) {
      return Response.json({ error: 'Account not found' }, { status: 404 });
    }

    const row = rows[0] as {
      plan: string;
      trial_ends_at: number | null;
      plan_expires_at: number | null;
      polar_customer_id: string | null;
      cancel_at_period_end: number;
    };

    const status: SubscriptionStatus = {
      plan: row.plan as Plan,
      trialEndsAt: row.trial_ends_at,
      planExpiresAt: row.plan_expires_at,
      cancelAtPeriodEnd: row.cancel_at_period_end === 1,
      polarCustomerId: row.polar_customer_id,
      selfHosted: false,
    };

    return Response.json({ ...status, effectivePlan: this.getEffectivePlan() });
  }

  private async handleUpdateSubscription(request: Request): Promise<Response> {
    const body = (await request.json()) as {
      plan?: Plan;
      planExpiresAt?: number | null;
      cancelAtPeriodEnd?: boolean;
      polarCustomerId?: string | null;
    };

    const sets: string[] = [];
    const params: unknown[] = [];

    if (body.plan !== undefined) {
      sets.push('plan = ?');
      params.push(body.plan);
    }

    if (body.planExpiresAt !== undefined) {
      sets.push('plan_expires_at = ?');
      params.push(body.planExpiresAt);
    }

    if (body.cancelAtPeriodEnd !== undefined) {
      sets.push('cancel_at_period_end = ?');
      params.push(body.cancelAtPeriodEnd ? 1 : 0);
    }

    if (body.polarCustomerId !== undefined) {
      sets.push('polar_customer_id = ?');
      params.push(body.polarCustomerId);
    }

    if (sets.length > 0) {
      this.ctx.storage.sql.exec(`UPDATE profile SET ${sets.join(', ')}`, ...params);
    }

    return Response.json({ ok: true });
  }

  private async handleCheckSessionAccess(request: Request): Promise<Response> {
    const { sessionId } = (await request.json()) as { sessionId: string };

    const rows = this.ctx.storage.sql
      .exec('SELECT id FROM sessions WHERE id = ?', sessionId)
      .toArray();

    return Response.json({ allowed: rows.length > 0 });
  }

  // --- Share tokens ---

  private handleCreateShareToken(sessionId: string, request?: Request): Response {
    const selfHosted = request?.headers.get('X-Self-Hosted') === '1';

    // Free tier: share links not available (unless self-hosted)
    if (!selfHosted && this.getEffectivePlan() === 'free') {
      return Response.json(
        {
          error: 'Share links require a Pro plan. Upgrade to share sessions.',
          code: 'UPGRADE_REQUIRED',
        },
        { status: 403 },
      );
    }

    // Verify session belongs to this user
    const rows = this.ctx.storage.sql
      .exec('SELECT id FROM sessions WHERE id = ?', sessionId)
      .toArray();

    if (rows.length === 0) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }

    // Revoke any existing token for this session
    this.ctx.storage.sql.exec('DELETE FROM share_tokens WHERE session_id = ?', sessionId);

    // Generate random token
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const token = Array.from(bytes, (b) => b.toString(36).padStart(2, '0'))
      .join('')
      .slice(0, 32);

    const now = new Date();
    const expires = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours

    this.ctx.storage.sql.exec(
      'INSERT INTO share_tokens (token, session_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
      token,
      sessionId,
      now.toISOString(),
      expires.toISOString(),
    );

    return Response.json({ token, sessionId, expiresAt: expires.toISOString() }, { status: 201 });
  }

  private handleRevokeShareToken(sessionId: string): Response {
    this.ctx.storage.sql.exec('DELETE FROM share_tokens WHERE session_id = ?', sessionId);

    return Response.json({ ok: true });
  }

  private async handleValidateShareToken(request: Request): Promise<Response> {
    const { token } = (await request.json()) as { token: string };

    if (!token) {
      return Response.json({ valid: false }, { status: 400 });
    }

    const rows = this.ctx.storage.sql
      .exec('SELECT session_id, expires_at FROM share_tokens WHERE token = ?', token)
      .toArray();

    if (rows.length === 0) {
      return Response.json({ valid: false }, { status: 404 });
    }

    const row = rows[0];
    const expiresAt = new Date(row.expires_at as string);

    if (expiresAt < new Date()) {
      // Clean up expired token
      this.ctx.storage.sql.exec('DELETE FROM share_tokens WHERE token = ?', token);

      return Response.json({ valid: false, reason: 'expired' }, { status: 410 });
    }

    return Response.json({ valid: true, sessionId: row.session_id });
  }

  // --- Device WebSocket ---

  private handleDeviceWsUpgrade(request: Request, deviceId: string): Response {
    const secret = request.headers.get('X-JWT-Secret');

    if (secret) {
      this.jwtSecret = secret;
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Check if Worker already validated the token
    const userId = request.headers.get('X-User-Id');

    if (userId) {
      // Verify the authenticated user matches this DO's owner
      const ownerRows = this.ctx.storage.sql.exec('SELECT email FROM profile LIMIT 1').toArray();

      if (ownerRows.length === 0 || (ownerRows[0].email as string) !== userId) {
        return Response.json({ error: 'User mismatch' }, { status: 403 });
      }

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

    const attachment = (
      ws as unknown as { deserializeAttachment: () => unknown }
    ).deserializeAttachment() as Record<string, unknown> | null;

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

    // If desktop disconnects, mark device offline and clean up sessions
    if (tag.role === 'desktop') {
      this.ctx.storage.sql.exec(
        'UPDATE devices SET is_online = 0, last_seen_at = ? WHERE id = ?',
        new Date().toISOString(),
        tag.targetDeviceId,
      );
      this.ctx.storage.sql.exec('DELETE FROM sessions WHERE device_id = ?', tag.targetDeviceId);
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

  private async handleWsAuth(
    ws: WebSocket,
    message: string,
    targetDeviceId: string,
  ): Promise<void> {
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

    // Verify the authenticated user matches this DO's owner
    const ownerRows = this.ctx.storage.sql.exec('SELECT email FROM profile LIMIT 1').toArray();

    if (ownerRows.length === 0 || (ownerRows[0].email as string) !== payload.sub) {
      ws.close(1008, 'User mismatch');

      return;
    }

    (ws as unknown as { serializeAttachment: (v: unknown) => void }).serializeAttachment({
      userId: payload.sub,
      targetDeviceId,
      pendingHello: true,
    });

    ws.send(JSON.stringify({ type: 'auth_ok' }));
  }

  private handleWsHello(
    ws: WebSocket,
    msg: Record<string, unknown>,
    attachment: Record<string, unknown>,
  ): void {
    const clientId = (msg.clientId as string) || crypto.randomUUID();
    const role = (msg.role as string) === 'desktop' ? ('desktop' as const) : ('viewer' as const);
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
        ws.send(
          JSON.stringify({
            type: 'pong',
            timestamp: msg.timestamp,
            serverTime: Date.now(),
          }),
        );
        break;

      case 'list_sessions':
        this.handleWsListSessions(ws, tag);
        break;

      case 'sessions_updated':
        // Desktop sends non-sensitive session data (IDs + dimensions) — update SQLite
        if (tag.role === 'desktop') {
          this.handleWsSessionsUpdated(ws, tag, msg);
        }
        break;

      // --- Device-level E2E key exchange ---

      case 'device_key_exchange':
        // Desktop sends E2E public key to viewers
        if (tag.role === 'desktop') {
          this.forwardToDeviceRole(tag.targetDeviceId, ws, 'viewer', msg);
        }
        break;

      case 'device_key_exchange_ack':
        // Viewer sends E2E public key back to desktop (add fromClientId for multi-viewer tracking)
        if (tag.role === 'viewer') {
          this.forwardToDeviceRole(tag.targetDeviceId, ws, 'desktop', {
            ...msg,
            fromClientId: tag.clientId,
          });
        }
        break;

      case 'encrypted_control':
        // Forward encrypted envelope — relay cannot read the payload
        if (msg.toClientId) {
          this.forwardToClient(msg.toClientId as string, { ...msg, fromClientId: tag.clientId });
        } else if (tag.role === 'desktop') {
          this.forwardToDeviceRole(tag.targetDeviceId, ws, 'viewer', {
            ...msg,
            fromClientId: tag.clientId,
          });
        } else if (tag.role === 'viewer') {
          this.forwardToDeviceRole(tag.targetDeviceId, ws, 'desktop', {
            ...msg,
            fromClientId: tag.clientId,
          });
        }
        break;

      // --- Session-level E2E key exchange (TerminalSession DO) ---

      case 'key_exchange':
        // Desktop sends E2E public key to viewers
        if (tag.role === 'desktop') {
          this.forwardToDeviceRole(tag.targetDeviceId, ws, 'viewer', msg);
        }
        break;

      case 'key_exchange_ack':
        // Viewer sends E2E public key back to desktop
        if (tag.role === 'viewer') {
          this.forwardToDeviceRole(tag.targetDeviceId, ws, 'desktop', msg);
        }
        break;

      case 'local_auth_secret':
        // Desktop shares local auth secret with viewers (for Bonjour auth)
        if (tag.role === 'desktop') {
          this.forwardToDeviceRole(tag.targetDeviceId, ws, 'viewer', msg);
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

    // Only return non-sensitive fields — real metadata delivered E2E encrypted via encrypted_control
    const rows = this.ctx.storage.sql
      .exec(
        'SELECT id, device_id, pty_cols, pty_rows, created_at FROM sessions WHERE device_id = ? ORDER BY created_at',
        tag.targetDeviceId,
      )
      .toArray();

    const sessions = rows.map((r) => ({
      id: r.id as string,
      deviceId: r.device_id as string,
      ptyCols: r.pty_cols as number,
      ptyRows: r.pty_rows as number,
      createdAt: r.created_at as string,
    }));

    ws.send(JSON.stringify({ type: 'sessions_list', sessions }));
  }

  private handleWsSessionsUpdated(
    ws: WebSocket,
    tag: DeviceClientTag,
    msg: Record<string, unknown>,
  ): void {
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

    // Rate limit: skip SQLite writes if updated too recently (still broadcast to viewers)
    const now = Date.now();
    const lastUpdate = this.lastSessionsUpdate.get(tag.targetDeviceId) ?? 0;
    const shouldWrite = now - lastUpdate >= SESSIONS_UPDATE_MIN_INTERVAL;

    if (shouldWrite) {
      this.lastSessionsUpdate.set(tag.targetDeviceId, now);

      // Upsert sessions and delete stale ones (avoids DELETE-all + re-INSERT)
      const incomingIds = new Set<string>();

      for (const s of sessions) {
        if (!s.id || typeof s.id !== 'string' || s.id.length > 64) {
          continue;
        }

        incomingIds.add(s.id);

        this.ctx.storage.sql.exec(
          `INSERT INTO sessions (id, device_id, name, cwd, process_name, pty_cols, pty_rows, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             pty_cols = excluded.pty_cols,
             pty_rows = excluded.pty_rows`,
          s.id,
          tag.targetDeviceId,
          'encrypted', // real name is E2E encrypted
          '', // real cwd is E2E encrypted
          null, // real processName is E2E encrypted
          s.ptyCols ?? 120,
          s.ptyRows ?? 40,
          new Date().toISOString(),
        );
      }

      // Delete sessions that are no longer in the list
      const existing = this.ctx.storage.sql
        .exec('SELECT id FROM sessions WHERE device_id = ?', tag.targetDeviceId)
        .toArray();

      for (const row of existing) {
        if (!incomingIds.has(row.id as string)) {
          this.ctx.storage.sql.exec('DELETE FROM sessions WHERE id = ?', row.id as string);
        }
      }
    }

    // NOTE: Desktop sends E2E encrypted session metadata directly to viewers via encrypted_control.
    // The relay no longer broadcasts sessions_updated — it only stores non-sensitive fields in SQLite.
  }

  // --- Device WS helpers ---

  private broadcastToDevice(
    deviceId: string,
    sender: WebSocket,
    msg: Record<string, unknown>,
  ): void {
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

  private forwardToDeviceRole(
    deviceId: string,
    sender: WebSocket,
    targetRole: string,
    msg: Record<string, unknown>,
  ): void {
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

  // --- Trial expiry alarm ---

  async alarm(): Promise<void> {
    this.ensureSchema();

    // Self-hosted relays don't send trial emails
    if (!this.env.POLAR_WEBHOOK_SECRET) {
      return;
    }

    if (!this.env.RESEND_API_KEY) {
      return;
    }

    const rows = this.ctx.storage.sql
      .exec('SELECT email, plan, trial_ends_at FROM profile LIMIT 1')
      .toArray();

    if (rows.length === 0) {
      return;
    }

    const { email, plan, trial_ends_at } = rows[0] as {
      email: string;
      plan: string;
      trial_ends_at: number | null;
    };

    if (!trial_ends_at) {
      return;
    }

    // Don't email users who already upgraded
    if (plan === 'pro') {
      return;
    }

    const now = Date.now();

    if (now < trial_ends_at) {
      // Trial hasn't expired yet — this is the warning alarm (1 day before)
      await this.sendTrialEmail(
        email,
        'Your TermPod trial ends tomorrow',
        buildTrialWarningEmail(),
      );

      // Schedule the expiry alarm for when the trial actually ends
      await this.ctx.storage.setAlarm(trial_ends_at);

      return;
    }

    // Trial has expired
    await this.sendTrialEmail(email, 'Your TermPod trial has ended', buildTrialExpiredEmail());
  }

  private async sendTrialEmail(to: string, subject: string, html: string): Promise<void> {
    const apiKey = this.env.RESEND_API_KEY;

    if (!apiKey) {
      return;
    }

    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.env.EMAIL_FROM || 'TermPod <noreply@email.termpod.dev>',
          to: [to],
          subject,
          html,
        }),
      });
    } catch {
      // Email delivery is best-effort — don't crash the alarm
      console.error(`Failed to send trial email to ${to}`);
    }
  }
}

// --- Trial email templates ---

function emailShell(subtitle: string, title: string, content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#0A0A0A;font-family:'IBM Plex Mono',-apple-system,BlinkMacSystemFont,'Segoe UI',monospace;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0A0A0A;">
    <tr>
      <td align="center" style="padding:48px 16px;">
        <!-- Logo -->
        <table width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;">
          <tr>
            <td style="padding:0 0 32px;">
              <span style="font-size:22px;font-weight:700;color:#C9A962;font-family:'IBM Plex Mono',Menlo,monospace;">&gt;_</span>
              <span style="font-size:18px;font-weight:700;letter-spacing:3px;color:#FFFFFF;font-family:'IBM Plex Mono',Menlo,monospace;">&nbsp;TERMPOD</span>
            </td>
          </tr>
        </table>
        <!-- Card -->
        <table width="480" cellpadding="0" cellspacing="0" style="background:#111111;border:1px solid #333333;max-width:480px;width:100%;">
          <tr>
            <td style="padding:40px 36px 36px;">
              <p style="margin:0 0 6px;font-size:11px;font-weight:600;letter-spacing:3px;color:#555555;text-transform:uppercase;">${subtitle}</p>
              <p style="margin:0 0 28px;font-size:22px;font-weight:700;color:#FFFFFF;line-height:1.3;">${title}</p>
              ${content}
            </td>
          </tr>
        </table>
        <!-- Footer -->
        <table width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;">
          <tr>
            <td style="padding:24px 0 0;text-align:center;">
              <p style="margin:0;font-size:11px;color:#555555;">TermPod &mdash; Your Mac terminal, in your pocket.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildTrialWarningEmail(): string {
  const content = `
              <p style="margin:0 0 20px;font-size:14px;color:#999999;line-height:1.6;">Your 7-day Pro trial ends <strong style="color:#C9A962;">tomorrow</strong>. After that, your account moves to the Free plan.</p>
              <p style="margin:0 0 16px;font-size:14px;color:#999999;line-height:1.6;">Upgrade now to keep:</p>
              <table cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
                <tr><td style="padding:5px 0;font-size:13px;color:#999999;"><span style="color:#C9A962;">&#x2713;</span>&nbsp;&nbsp;Relay access (connect from anywhere)</td></tr>
                <tr><td style="padding:5px 0;font-size:13px;color:#999999;"><span style="color:#C9A962;">&#x2713;</span>&nbsp;&nbsp;Unlimited devices</td></tr>
                <tr><td style="padding:5px 0;font-size:13px;color:#999999;"><span style="color:#C9A962;">&#x2713;</span>&nbsp;&nbsp;Session sharing via links</td></tr>
                <tr><td style="padding:5px 0;font-size:13px;color:#999999;"><span style="color:#C9A962;">&#x2713;</span>&nbsp;&nbsp;TURN relay for P2P fallback</td></tr>
              </table>
              <div style="text-align:center;margin:0 0 28px;">
                <a href="https://termpod.dev/pricing" style="display:inline-block;background:#C9A962;color:#0A0A0A;font-size:12px;font-weight:600;letter-spacing:2px;text-decoration:none;padding:14px 36px;text-transform:uppercase;">UPGRADE TO PRO</a>
              </div>
              <p style="margin:0;font-size:12px;color:#555555;line-height:1.5;">Local P2P and WebRTC connections are always free.</p>`;

  return emailShell('Trial ending soon', 'Your trial ends tomorrow', content);
}

function buildTrialExpiredEmail(): string {
  const content = `
              <p style="margin:0 0 20px;font-size:14px;color:#999999;line-height:1.6;">Your 7-day Pro trial has ended. Your account is now on the <strong style="color:#FFFFFF;">Free</strong> plan.</p>
              <p style="margin:0 0 16px;font-size:14px;color:#999999;line-height:1.6;">Here's what you're missing:</p>
              <table cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
                <tr><td style="padding:5px 0;font-size:13px;color:#555555;"><span style="color:#555555;">&#x2717;</span>&nbsp;&nbsp;Relay access (connect from anywhere)</td></tr>
                <tr><td style="padding:5px 0;font-size:13px;color:#555555;"><span style="color:#555555;">&#x2717;</span>&nbsp;&nbsp;Unlimited devices (now limited to 1)</td></tr>
                <tr><td style="padding:5px 0;font-size:13px;color:#555555;"><span style="color:#555555;">&#x2717;</span>&nbsp;&nbsp;Session sharing via links</td></tr>
                <tr><td style="padding:5px 0;font-size:13px;color:#555555;"><span style="color:#555555;">&#x2717;</span>&nbsp;&nbsp;TURN relay for P2P fallback</td></tr>
              </table>
              <div style="text-align:center;margin:0 0 28px;">
                <a href="https://termpod.dev/pricing" style="display:inline-block;background:#C9A962;color:#0A0A0A;font-size:12px;font-weight:600;letter-spacing:2px;text-decoration:none;padding:14px 36px;text-transform:uppercase;">UPGRADE TO PRO</a>
              </div>
              <p style="margin:0 0 10px;font-size:12px;color:#555555;line-height:1.5;">Local P2P and WebRTC still work perfectly on the same network.</p>
              <p style="margin:0;font-size:12px;color:#555555;line-height:1.5;">You can also <a href="https://termpod.dev/docs/self-hosting" style="color:#C9A962;text-decoration:none;">self-host the relay</a> for free.</p>`;

  return emailShell('Trial ended', 'Your trial has ended', content);
}
