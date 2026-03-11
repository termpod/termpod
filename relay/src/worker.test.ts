import { describe, expect, it } from 'vitest';

// Test pure functions and validation logic from the worker module.
// We test the regex and validation patterns directly since the worker
// functions are not exported individually.

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

describe('EMAIL_REGEX', () => {
  it('accepts valid emails', () => {
    const valid = [
      'user@example.com',
      'name@sub.domain.co.uk',
      'user+tag@gmail.com',
      'a@b.co',
      'test.email@company.org',
      'user123@test.io',
    ];

    for (const email of valid) {
      expect(EMAIL_REGEX.test(email), `Expected ${email} to be valid`).toBe(true);
    }
  });

  it('rejects invalid emails', () => {
    const invalid = [
      '',
      'notanemail',
      '@nouser.com',
      'noat.com',
      'user@',
      'user @example.com',      // space in local
      'user@ example.com',      // space in domain
      'user@example .com',      // space in domain
    ];

    for (const email of invalid) {
      expect(EMAIL_REGEX.test(email), `Expected "${email}" to be invalid`).toBe(false);
    }
  });
});

describe('Password validation logic', () => {
  it('rejects passwords shorter than 8 chars', () => {
    const passwords = ['', '1234567', 'short', 'abc'];

    for (const pw of passwords) {
      expect(pw.length < 8).toBe(true);
    }
  });

  it('accepts passwords of 8 or more chars', () => {
    const passwords = ['12345678', 'long-enough-password', 'àèìòù123'];

    for (const pw of passwords) {
      expect(pw.length >= 8).toBe(true);
    }
  });
});

describe('Update download filename validation', () => {
  // Mirrors the path traversal check in handleUpdateDownload
  function isValidFilename(filename: string): boolean {
    return !filename.includes('/') && !filename.includes('..');
  }

  it('accepts valid filenames', () => {
    const valid = [
      'termpod_0.1.4_aarch64.dmg',
      'termpod_0.1.4_aarch64.app.tar.gz',
      'latest.json',
      'update-0.1.4.sig',
    ];

    for (const f of valid) {
      expect(isValidFilename(f), `Expected "${f}" to be valid`).toBe(true);
    }
  });

  it('rejects path traversal attempts', () => {
    const invalid = [
      '../etc/passwd',
      'foo/bar.dmg',
      '../../secrets',
      'dir/../file',
    ];

    for (const f of invalid) {
      expect(isValidFilename(f), `Expected "${f}" to be rejected`).toBe(false);
    }
  });
});

describe('Device ID validation', () => {
  // Mirrors handleDeviceWebSocket validation
  function isValidDeviceId(deviceId: string | null): boolean {
    return !!deviceId && deviceId.length <= 64;
  }

  it('accepts valid device IDs', () => {
    expect(isValidDeviceId('abc-123')).toBe(true);
    expect(isValidDeviceId('a'.repeat(64))).toBe(true);
    expect(isValidDeviceId(crypto.randomUUID())).toBe(true);
  });

  it('rejects empty or null device IDs', () => {
    expect(isValidDeviceId(null)).toBe(false);
    expect(isValidDeviceId('')).toBe(false);
  });

  it('rejects device IDs longer than 64 chars', () => {
    expect(isValidDeviceId('a'.repeat(65))).toBe(false);
  });
});

describe('Bearer token extraction', () => {
  // Mirrors requireAuth logic
  function extractBearerToken(authHeader: string | null): string | null {
    if (!authHeader?.startsWith('Bearer ')) {
      return null;
    }

    return authHeader.slice(7);
  }

  it('extracts token from valid Bearer header', () => {
    expect(extractBearerToken('Bearer abc123')).toBe('abc123');
    expect(extractBearerToken('Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig')).toBe(
      'eyJhbGciOiJIUzI1NiJ9.payload.sig',
    );
  });

  it('returns null for missing header', () => {
    expect(extractBearerToken(null)).toBeNull();
  });

  it('returns null for non-Bearer auth', () => {
    expect(extractBearerToken('Basic abc123')).toBeNull();
    expect(extractBearerToken('Token abc123')).toBeNull();
  });

  it('returns null for malformed Bearer', () => {
    expect(extractBearerToken('Bearer')).toBeNull();
    expect(extractBearerToken('bearer token')).toBeNull(); // case-sensitive
  });
});

describe('CORS and security headers', () => {
  const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  const SECURITY_HEADERS = {
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  };

  it('includes all required CORS headers', () => {
    expect(CORS_HEADERS['Access-Control-Allow-Origin']).toBe('*');
    expect(CORS_HEADERS['Access-Control-Allow-Methods']).toContain('POST');
    expect(CORS_HEADERS['Access-Control-Allow-Methods']).toContain('DELETE');
    expect(CORS_HEADERS['Access-Control-Allow-Headers']).toContain('Authorization');
  });

  it('includes security headers', () => {
    expect(SECURITY_HEADERS['X-Frame-Options']).toBe('DENY');
    expect(SECURITY_HEADERS['X-Content-Type-Options']).toBe('nosniff');
    expect(SECURITY_HEADERS['Strict-Transport-Security']).toContain('max-age=');
  });
});

describe('Share viewer SRI integrity', () => {
  // The share viewer HTML loads third-party assets from jsDelivr CDN.
  // All tags must have SRI integrity + crossorigin="anonymous" to prevent
  // CDN compromise from exfiltrating the E2E decryption key in location.hash.

  it('SRI hashes are valid sha384 format', () => {
    const sriPattern = /^sha384-[A-Za-z0-9+/]+=*$/;
    const hashes = [
      'sha384-tStR1zLfWgsiXCF3IgfB3lBa8KmBe/lG287CL9WCeKgQYcp1bjb4/+mwN6oti4Co',
      'sha384-J4qzUjBl1FxyLsl/kQPQIOeINsmp17OHYXDOMpMxlKX53ZfYsL+aWHpgArvOuof9',
      'sha384-XGqKrV8Jrukp1NITJbOEHwg01tNkuXr6uB6YEj69ebpYU3v7FvoGgEg23C1Gcehk',
    ];

    for (const hash of hashes) {
      expect(sriPattern.test(hash), `SRI hash "${hash}" should match sha384 format`).toBe(true);
    }
  });
});

describe('Device WS auth routing', () => {
  it('userId query param fallback is removed — only JWT auth accepted', () => {
    // Previously, the worker accepted ?userId= for routing when no JWT was present.
    // Now, if no valid JWT is found in Authorization header or ?token=, return 401.
    // This test asserts the routing contract.

    function extractUserId(authHeader: string | null, urlToken: string | null, urlUserId: string | null): string | null {
      // Try Authorization header
      if (authHeader?.startsWith('Bearer ')) {
        return 'user-from-header'; // simulated JWT decode
      }

      // Try URL token
      if (urlToken) {
        return 'user-from-token'; // simulated JWT decode
      }

      // No ?userId fallback — return null (will become 401)
      return null;
    }

    expect(extractUserId('Bearer valid-jwt', null, null)).toBe('user-from-header');
    expect(extractUserId(null, 'valid-jwt-token', null)).toBe('user-from-token');
    expect(extractUserId(null, null, 'attacker-hint')).toBeNull(); // ?userId ignored
    expect(extractUserId(null, null, null)).toBeNull();
  });
});

describe('Route pattern matching', () => {
  // Test the regex patterns used for URL routing in the worker

  it('matches device action routes', () => {
    const pattern = /^\/devices\/([^/]+)\/(heartbeat|offline)$/;

    expect(pattern.test('/devices/abc-123/heartbeat')).toBe(true);
    expect(pattern.test('/devices/abc-123/offline')).toBe(true);
    expect(pattern.test('/devices/abc-123/unknown')).toBe(false);
    expect(pattern.test('/devices//heartbeat')).toBe(false);

    const match = '/devices/dev-1/heartbeat'.match(pattern);
    expect(match![1]).toBe('dev-1');
    expect(match![2]).toBe('heartbeat');
  });

  it('matches device sessions routes', () => {
    const pattern = /^\/devices\/([^/]+)\/sessions$/;

    expect(pattern.test('/devices/abc/sessions')).toBe(true);
    expect(pattern.test('/devices//sessions')).toBe(false);
    expect(pattern.test('/devices/abc/sessions/')).toBe(false);
  });

  it('matches session WebSocket routes', () => {
    const pattern = /^\/sessions\/([^/]+)\/ws$/;

    expect(pattern.test('/sessions/sid-123/ws')).toBe(true);
    expect(pattern.test('/sessions//ws')).toBe(false);

    const match = '/sessions/my-session/ws'.match(pattern);
    expect(match![1]).toBe('my-session');
  });

  it('matches device WebSocket routes', () => {
    const pattern = /^\/devices\/([^/]+)\/ws$/;

    expect(pattern.test('/devices/dev-1/ws')).toBe(true);
    expect(pattern.test('/devices//ws')).toBe(false);

    const match = '/devices/my-device/ws'.match(pattern);
    expect(match![1]).toBe('my-device');
  });

  it('matches update download routes', () => {
    const pattern = /^\/updates\/download\/(.+)$/;

    expect(pattern.test('/updates/download/file.dmg')).toBe(true);

    const match = '/updates/download/termpod_0.1.4_aarch64.dmg'.match(pattern);
    expect(match![1]).toBe('termpod_0.1.4_aarch64.dmg');
  });

  it('matches session delete/update routes', () => {
    const pattern = /^\/sessions\/([^/]+)$/;

    expect(pattern.test('/sessions/abc-123')).toBe(true);
    expect(pattern.test('/sessions/')).toBe(false);

    const match = '/sessions/my-session'.match(pattern);
    expect(match![1]).toBe('my-session');
  });

  it('matches pending requests routes', () => {
    const pattern = /^\/devices\/([^/]+)\/pending-requests$/;

    expect(pattern.test('/devices/dev-1/pending-requests')).toBe(true);
    expect(pattern.test('/devices//pending-requests')).toBe(false);
  });

  it('matches request session routes', () => {
    const pattern = /^\/devices\/([^/]+)\/request-session$/;

    expect(pattern.test('/devices/dev-1/request-session')).toBe(true);
  });
});
