import { describe, expect, it } from 'vitest';

/**
 * Tests for User DO validation logic and SQLite query contracts.
 * These validate the rules enforced by the User DO without needing
 * actual SQLite or Durable Object infrastructure.
 */

// --- Device validation (mirrors handleRegisterDevice) ---

describe('Device registration validation', () => {
  const VALID_PLATFORMS = ['macos', 'iphone', 'ipad', 'browser'];
  const VALID_DEVICE_TYPES = ['desktop', 'mobile'];

  interface DeviceInput {
    id: string;
    name: string;
    deviceType: string;
    platform: string;
  }

  function validateDevice(body: Partial<DeviceInput>): string | null {
    if (!body.id || body.id.length > 64) {
      return 'Invalid device ID';
    }

    if (!body.name || body.name.length > 255) {
      return 'Invalid device name';
    }

    if (!VALID_PLATFORMS.includes(body.platform ?? '')) {
      return 'Invalid platform';
    }

    if (!VALID_DEVICE_TYPES.includes(body.deviceType ?? '')) {
      return 'Invalid device type';
    }

    return null;
  }

  it('accepts valid device registration', () => {
    expect(validateDevice({
      id: crypto.randomUUID(),
      name: 'My MacBook',
      deviceType: 'desktop',
      platform: 'macos',
    })).toBeNull();
  });

  it('accepts all valid platforms', () => {
    for (const platform of VALID_PLATFORMS) {
      expect(validateDevice({
        id: 'dev-1', name: 'test', deviceType: 'desktop', platform,
      })).toBeNull();
    }
  });

  it('rejects empty device ID', () => {
    expect(validateDevice({ id: '', name: 'test', deviceType: 'desktop', platform: 'macos' }))
      .toBe('Invalid device ID');
  });

  it('rejects device ID longer than 64 chars', () => {
    expect(validateDevice({ id: 'x'.repeat(65), name: 'test', deviceType: 'desktop', platform: 'macos' }))
      .toBe('Invalid device ID');
  });

  it('accepts device ID of exactly 64 chars', () => {
    expect(validateDevice({ id: 'x'.repeat(64), name: 'test', deviceType: 'desktop', platform: 'macos' }))
      .toBeNull();
  });

  it('rejects empty device name', () => {
    expect(validateDevice({ id: 'dev-1', name: '', deviceType: 'desktop', platform: 'macos' }))
      .toBe('Invalid device name');
  });

  it('rejects device name longer than 255 chars', () => {
    expect(validateDevice({ id: 'dev-1', name: 'x'.repeat(256), deviceType: 'desktop', platform: 'macos' }))
      .toBe('Invalid device name');
  });

  it('rejects unknown platform', () => {
    expect(validateDevice({ id: 'dev-1', name: 'test', deviceType: 'desktop', platform: 'windows' }))
      .toBe('Invalid platform');
  });

  it('rejects unknown device type', () => {
    expect(validateDevice({ id: 'dev-1', name: 'test', deviceType: 'tablet', platform: 'macos' }))
      .toBe('Invalid device type');
  });

  it('rejects missing fields', () => {
    expect(validateDevice({})).toBe('Invalid device ID');
    expect(validateDevice({ id: 'dev-1' })).toBe('Invalid device name');
  });
});

// --- Session validation (mirrors handleRegisterSession + handleUpdateSession) ---

describe('Session registration validation', () => {
  interface SessionInput {
    id: string;
    name?: string;
    cwd?: string;
    processName?: string | null;
    ptyCols?: number;
    ptyRows?: number;
  }

  function validateSession(body: Partial<SessionInput>): string | null {
    if (!body.id || body.id.length > 64) {
      return 'Invalid session ID';
    }

    if (body.name !== undefined && body.name.length > 255) {
      return 'Session name too long';
    }

    if (body.cwd !== undefined && body.cwd.length > 4096) {
      return 'CWD too long';
    }

    return null;
  }

  it('accepts valid session', () => {
    expect(validateSession({ id: 'sess-1', name: 'shell', cwd: '/Users/dev' })).toBeNull();
  });

  it('rejects empty session ID', () => {
    expect(validateSession({ id: '' })).toBe('Invalid session ID');
  });

  it('rejects session ID longer than 64 chars', () => {
    expect(validateSession({ id: 'x'.repeat(65) })).toBe('Invalid session ID');
  });

  it('accepts session ID of exactly 64 chars', () => {
    expect(validateSession({ id: 'x'.repeat(64) })).toBeNull();
  });

  it('rejects session name longer than 255 chars', () => {
    expect(validateSession({ id: 'sess-1', name: 'x'.repeat(256) })).toBe('Session name too long');
  });

  it('accepts session name of exactly 255 chars', () => {
    expect(validateSession({ id: 'sess-1', name: 'x'.repeat(255) })).toBeNull();
  });

  it('rejects CWD longer than 4096 chars', () => {
    expect(validateSession({ id: 'sess-1', cwd: '/'.repeat(4097) })).toBe('CWD too long');
  });

  it('allows omitted optional fields (defaults applied)', () => {
    expect(validateSession({ id: 'sess-1' })).toBeNull();
  });
});

describe('Session update validation', () => {
  interface SessionUpdate {
    name?: string;
    cwd?: string;
    processName?: string | null;
  }

  function validateSessionUpdate(body: SessionUpdate): string | null {
    if (body.name !== undefined && typeof body.name === 'string' && body.name.length > 255) {
      return 'Session name too long';
    }

    if (body.cwd !== undefined && typeof body.cwd === 'string' && body.cwd.length > 4096) {
      return 'CWD too long';
    }

    if (body.processName !== undefined && body.processName !== null &&
        typeof body.processName === 'string' && body.processName.length > 255) {
      return 'Process name too long';
    }

    return null;
  }

  it('accepts valid partial update', () => {
    expect(validateSessionUpdate({ name: 'vim' })).toBeNull();
    expect(validateSessionUpdate({ cwd: '/home/user' })).toBeNull();
    expect(validateSessionUpdate({ processName: 'nvim' })).toBeNull();
  });

  it('accepts null processName (clearing)', () => {
    expect(validateSessionUpdate({ processName: null })).toBeNull();
  });

  it('rejects long process name', () => {
    expect(validateSessionUpdate({ processName: 'x'.repeat(256) })).toBe('Process name too long');
  });

  it('accepts empty update (no-op)', () => {
    expect(validateSessionUpdate({})).toBeNull();
  });
});

// --- Device deduplication logic ---

describe('Device deduplication', () => {
  interface Device {
    id: string;
    platform: string;
    isOnline: boolean;
    lastSeenAt: string | null;
    createdAt: string;
  }

  /**
   * Mirrors handleListDevices() dedup SQL:
   * Keep only the most recently seen device per platform.
   * Then mark stale (>90s) devices as offline.
   */
  function deduplicateDevices(devices: Device[]): Device[] {
    // Group by platform, keep the one with the most recent lastSeenAt (then createdAt)
    const byPlatform = new Map<string, Device>();

    for (const d of devices) {
      const existing = byPlatform.get(d.platform);

      if (!existing) {
        byPlatform.set(d.platform, d);
        continue;
      }

      // Compare: prefer more recently seen, then more recently created
      const existingTime = existing.lastSeenAt ?? existing.createdAt;
      const newTime = d.lastSeenAt ?? d.createdAt;

      if (newTime > existingTime) {
        byPlatform.set(d.platform, d);
      }
    }

    return Array.from(byPlatform.values());
  }

  function markStaleOffline(devices: Device[], staleThresholdMs: number): Device[] {
    const threshold = new Date(Date.now() - staleThresholdMs).toISOString();

    return devices.map((d) => {
      if (d.isOnline && d.lastSeenAt && d.lastSeenAt < threshold) {
        return { ...d, isOnline: false };
      }

      return d;
    });
  }

  it('keeps one device per platform', () => {
    const devices: Device[] = [
      { id: 'old-mac', platform: 'macos', isOnline: false, lastSeenAt: '2024-01-01T00:00:00Z', createdAt: '2024-01-01T00:00:00Z' },
      { id: 'new-mac', platform: 'macos', isOnline: true, lastSeenAt: '2024-06-01T00:00:00Z', createdAt: '2024-06-01T00:00:00Z' },
      { id: 'iphone', platform: 'iphone', isOnline: true, lastSeenAt: '2024-06-01T00:00:00Z', createdAt: '2024-06-01T00:00:00Z' },
    ];

    const result = deduplicateDevices(devices);

    expect(result.length).toBe(2);
    expect(result.find((d) => d.platform === 'macos')!.id).toBe('new-mac');
    expect(result.find((d) => d.platform === 'iphone')!.id).toBe('iphone');
  });

  it('prefers device with more recent lastSeenAt', () => {
    const devices: Device[] = [
      { id: 'a', platform: 'macos', isOnline: false, lastSeenAt: '2024-06-01T12:00:00Z', createdAt: '2024-01-01T00:00:00Z' },
      { id: 'b', platform: 'macos', isOnline: true, lastSeenAt: '2024-06-01T06:00:00Z', createdAt: '2024-06-01T00:00:00Z' },
    ];

    const result = deduplicateDevices(devices);
    expect(result[0].id).toBe('a'); // more recent lastSeenAt wins
  });

  it('does not deduplicate across different platforms', () => {
    const devices: Device[] = [
      { id: 'mac-1', platform: 'macos', isOnline: true, lastSeenAt: '2024-06-01T00:00:00Z', createdAt: '2024-06-01T00:00:00Z' },
      { id: 'iphone-1', platform: 'iphone', isOnline: true, lastSeenAt: '2024-06-01T00:00:00Z', createdAt: '2024-06-01T00:00:00Z' },
      { id: 'ipad-1', platform: 'ipad', isOnline: false, lastSeenAt: '2024-06-01T00:00:00Z', createdAt: '2024-06-01T00:00:00Z' },
    ];

    const result = deduplicateDevices(devices);
    expect(result.length).toBe(3);
  });

  it('marks devices offline after 90 seconds without heartbeat', () => {
    const now = Date.now();
    const devices: Device[] = [
      { id: 'fresh', platform: 'macos', isOnline: true, lastSeenAt: new Date(now - 30_000).toISOString(), createdAt: '2024-01-01T00:00:00Z' },
      { id: 'stale', platform: 'iphone', isOnline: true, lastSeenAt: new Date(now - 100_000).toISOString(), createdAt: '2024-01-01T00:00:00Z' },
      { id: 'already-offline', platform: 'ipad', isOnline: false, lastSeenAt: new Date(now - 200_000).toISOString(), createdAt: '2024-01-01T00:00:00Z' },
    ];

    const result = markStaleOffline(devices, 90_000);

    expect(result.find((d) => d.id === 'fresh')!.isOnline).toBe(true);
    expect(result.find((d) => d.id === 'stale')!.isOnline).toBe(false);
    expect(result.find((d) => d.id === 'already-offline')!.isOnline).toBe(false);
  });
});

// --- Rate limiting (mirrors handleLogin) ---

describe('Login rate limiting', () => {
  const MAX_ATTEMPTS = 5;
  const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

  interface LoginAttempt {
    attemptedAt: number;
  }

  function shouldRateLimit(attempts: LoginAttempt[], now: number): boolean {
    const windowStart = now - WINDOW_MS;
    const recentAttempts = attempts.filter((a) => a.attemptedAt >= windowStart);

    return recentAttempts.length >= MAX_ATTEMPTS;
  }

  function cleanupOldAttempts(attempts: LoginAttempt[], now: number): LoginAttempt[] {
    const windowStart = now - WINDOW_MS;

    return attempts.filter((a) => a.attemptedAt >= windowStart);
  }

  it('allows first 5 attempts', () => {
    const now = Date.now();
    const attempts: LoginAttempt[] = [];

    for (let i = 0; i < 5; i++) {
      expect(shouldRateLimit(attempts, now)).toBe(false);
      attempts.push({ attemptedAt: now - (4 - i) * 1000 });
    }
  });

  it('blocks 6th attempt within window', () => {
    const now = Date.now();
    const attempts = Array.from({ length: 5 }, (_, i) => ({
      attemptedAt: now - i * 1000,
    }));

    expect(shouldRateLimit(attempts, now)).toBe(true);
  });

  it('allows attempts after window expires', () => {
    const now = Date.now();
    const oldAttempts = Array.from({ length: 5 }, (_, i) => ({
      attemptedAt: now - WINDOW_MS - (i + 1) * 1000, // all outside window
    }));

    expect(shouldRateLimit(oldAttempts, now)).toBe(false);
  });

  it('cleans up old attempts correctly', () => {
    const now = Date.now();
    const attempts = [
      { attemptedAt: now - WINDOW_MS - 1000 }, // old, should be removed
      { attemptedAt: now - WINDOW_MS + 1000 }, // recent, should stay
      { attemptedAt: now - 1000 },              // recent, should stay
    ];

    const cleaned = cleanupOldAttempts(attempts, now);
    expect(cleaned.length).toBe(2);
  });

  it('mixed old and new attempts — only counts recent', () => {
    const now = Date.now();
    const attempts = [
      // 3 old (outside window)
      { attemptedAt: now - WINDOW_MS - 3000 },
      { attemptedAt: now - WINDOW_MS - 2000 },
      { attemptedAt: now - WINDOW_MS - 1000 },
      // 4 recent (inside window)
      { attemptedAt: now - 4000 },
      { attemptedAt: now - 3000 },
      { attemptedAt: now - 2000 },
      { attemptedAt: now - 1000 },
    ];

    expect(shouldRateLimit(attempts, now)).toBe(false); // 4 < 5
    attempts.push({ attemptedAt: now });
    expect(shouldRateLimit(attempts, now)).toBe(true);  // 5 >= 5
  });
});

// --- sessions_updated bulk replace logic ---

describe('sessions_updated validation', () => {
  interface SessionUpdate {
    id: string;
    name?: string;
    cwd?: string;
    processName?: string | null;
    ptyCols?: number;
    ptyRows?: number;
  }

  function filterValidSessions(sessions: unknown): SessionUpdate[] {
    if (!Array.isArray(sessions)) {
      return [];
    }

    return sessions.filter((s) => {
      return s && typeof s === 'object' &&
        typeof s.id === 'string' &&
        s.id.length > 0 &&
        s.id.length <= 64;
    });
  }

  it('filters out sessions with invalid IDs', () => {
    const input = [
      { id: 'valid-1', name: 'shell' },
      { id: '', name: 'empty-id' },
      { id: 'x'.repeat(65), name: 'too-long' },
      { id: 'valid-2', name: 'bash' },
      { name: 'missing-id' },
      null,
      42,
    ];

    const result = filterValidSessions(input);
    expect(result.length).toBe(2);
    expect(result[0].id).toBe('valid-1');
    expect(result[1].id).toBe('valid-2');
  });

  it('returns empty for non-array input', () => {
    expect(filterValidSessions(null)).toEqual([]);
    expect(filterValidSessions('not-array')).toEqual([]);
    expect(filterValidSessions(42)).toEqual([]);
    expect(filterValidSessions(undefined)).toEqual([]);
  });

  it('accepts all valid sessions', () => {
    const input = [
      { id: 'sess-1', name: 'shell', cwd: '/home', ptyCols: 80, ptyRows: 24 },
      { id: 'sess-2', name: 'vim', cwd: '/project', processName: 'nvim' },
    ];

    expect(filterValidSessions(input).length).toBe(2);
  });
});

// --- Device offline cleanup ---

describe('Device offline behavior', () => {
  it('going offline should clean up sessions for that device', () => {
    // Mirrors handleOffline: DELETE sessions WHERE device_id = ?
    interface Session {
      id: string;
      deviceId: string;
    }

    const sessions: Session[] = [
      { id: 's1', deviceId: 'dev-1' },
      { id: 's2', deviceId: 'dev-1' },
      { id: 's3', deviceId: 'dev-2' },
    ];

    const offlineDeviceId = 'dev-1';
    const remaining = sessions.filter((s) => s.deviceId !== offlineDeviceId);

    expect(remaining.length).toBe(1);
    expect(remaining[0].id).toBe('s3');
  });

  it('registering a device clears its stale sessions', () => {
    // Mirrors handleRegisterDevice: DELETE sessions WHERE device_id = ?
    interface Session {
      id: string;
      deviceId: string;
    }

    const sessions: Session[] = [
      { id: 'stale-1', deviceId: 'dev-1' },
      { id: 'stale-2', deviceId: 'dev-1' },
      { id: 'other', deviceId: 'dev-2' },
    ];

    const registeringDeviceId = 'dev-1';
    const afterCleanup = sessions.filter((s) => s.deviceId !== registeringDeviceId);

    expect(afterCleanup.length).toBe(1);
    // After cleanup, new sessions would be registered fresh
  });

  it('registering cleans up offline devices of same platform', () => {
    // Mirrors: DELETE FROM devices WHERE id != ? AND platform = ? AND is_online = 0
    interface Device {
      id: string;
      platform: string;
      isOnline: boolean;
    }

    const devices: Device[] = [
      { id: 'new-mac', platform: 'macos', isOnline: true },
      { id: 'old-mac-1', platform: 'macos', isOnline: false },
      { id: 'old-mac-2', platform: 'macos', isOnline: false },
      { id: 'iphone-1', platform: 'iphone', isOnline: false }, // different platform, kept
    ];

    const registeringId = 'new-mac';
    const registeringPlatform = 'macos';

    const remaining = devices.filter((d) => {
      if (d.id === registeringId) {
        return true;
      }

      if (d.platform === registeringPlatform && !d.isOnline) {
        return false;
      }

      return true;
    });

    expect(remaining.length).toBe(2);
    expect(remaining.map((d) => d.id)).toEqual(['new-mac', 'iphone-1']);
  });
});
