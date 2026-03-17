import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

const BASE = 'https://relay.test';

function uid(): string {
  return crypto.randomUUID().slice(0, 8);
}

function email(tag = uid()): string {
  return `test-${tag}@integration.example.com`;
}

async function signup(
  e = email(),
  password = 'testpass123',
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await SELF.fetch(`${BASE}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: e, password }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function login(
  e: string,
  password = 'testpass123',
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await SELF.fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: e, password }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

// --- Signup ---

describe('POST /auth/signup', () => {
  it('creates account and returns 201 with tokens', async () => {
    const { status, body } = await signup(email());
    expect(status).toBe(201);
    expect(typeof body.accessToken).toBe('string');
    expect(typeof body.refreshToken).toBe('string');
    // Tokens should be non-empty JWTs (three dot-separated parts)
    expect((body.accessToken as string).split('.').length).toBe(3);
    expect((body.refreshToken as string).split('.').length).toBe(3);
  });

  it('returns 400 when email is missing', async () => {
    const res = await SELF.fetch(`${BASE}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'testpass123' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body.error).toBe('string');
  });

  it('returns 400 when password is missing', async () => {
    const res = await SELF.fetch(`${BASE}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email() }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when password is shorter than 8 characters', async () => {
    const res = await SELF.fetch(`${BASE}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email(), password: 'short' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when email format is invalid', async () => {
    const res = await SELF.fetch(`${BASE}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email', password: 'testpass123' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 409 for duplicate signup on same email', async () => {
    const e = email();
    const first = await signup(e);
    expect(first.status).toBe(201);

    const second = await signup(e);
    expect(second.status).toBe(409);
  });

  it('includes CORS headers in response', async () => {
    const res = await SELF.fetch(`${BASE}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email(), password: 'testpass123' }),
    });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('handles OPTIONS preflight', async () => {
    const res = await SELF.fetch(`${BASE}/auth/signup`, { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});

// --- Login ---

describe('POST /auth/login', () => {
  it('returns 200 with tokens on valid credentials', async () => {
    const e = email();
    await signup(e);
    const { status, body } = await login(e);
    expect(status).toBe(200);
    expect(typeof body.accessToken).toBe('string');
    expect(typeof body.refreshToken).toBe('string');
  });

  it('returns 401 on wrong password', async () => {
    const e = email();
    await signup(e);
    const { status } = await login(e, 'wrongpassword');
    expect(status).toBe(401);
  });

  it('returns 401 on non-existent user', async () => {
    const { status } = await login('nobody-' + uid() + '@integration.example.com');
    expect(status).toBe(401);
  });

  it('returns 400 when email is missing', async () => {
    const res = await SELF.fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'testpass123' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when password is missing', async () => {
    const res = await SELF.fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'someone@example.com' }),
    });
    expect(res.status).toBe(400);
  });

  it('access token from login is valid for authenticated routes', async () => {
    const e = email();
    await signup(e);
    const { body } = await login(e);
    const token = body.accessToken as string;

    const res = await SELF.fetch(`${BASE}/devices`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    // Should be 200, not 401
    expect(res.status).toBe(200);
  });
});

// --- Token Refresh ---

describe('POST /auth/refresh', () => {
  it('returns new access and refresh tokens for a valid refresh token', async () => {
    const e = email();
    const { body: signupBody } = await signup(e);
    const refreshToken = signupBody.refreshToken as string;

    const res = await SELF.fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body.accessToken).toBe('string');
    expect(typeof body.refreshToken).toBe('string');
    // Both should be valid 3-part JWTs
    expect((body.accessToken as string).split('.').length).toBe(3);
    expect((body.refreshToken as string).split('.').length).toBe(3);
  });

  it('returns 401 for an invalid refresh token', async () => {
    const res = await SELF.fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: 'invalid.token.here' }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 401 when access token is used instead of refresh token', async () => {
    const e = email();
    const { body } = await signup(e);
    const accessToken = body.accessToken as string;

    const res = await SELF.fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: accessToken }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 when refresh token is missing', async () => {
    const res = await SELF.fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('new access token from refresh works for authenticated routes', async () => {
    const e = email();
    const { body: signupBody } = await signup(e);
    const refreshToken = signupBody.refreshToken as string;

    const refreshRes = await SELF.fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    const { accessToken } = (await refreshRes.json()) as { accessToken: string };

    const devRes = await SELF.fetch(`${BASE}/devices`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(devRes.status).toBe(200);
  });
});

// --- Password Reset ---

describe('POST /auth/forgot-password', () => {
  it('returns 503 when RESEND_API_KEY is not configured', async () => {
    // In integration tests, RESEND_API_KEY is not set, so this should return 503
    const res = await SELF.fetch(`${BASE}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email() }),
    });
    expect(res.status).toBe(503);
  });

  it('returns 400 for invalid email format', async () => {
    const res = await SELF.fetch(`${BASE}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing email', async () => {
    const res = await SELF.fetch(`${BASE}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /auth/reset-password', () => {
  it('returns 400 for invalid 6-digit code format (letters)', async () => {
    const res = await SELF.fetch(`${BASE}/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email(), code: 'abcdef', password: 'newpass123' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for code shorter than 6 digits', async () => {
    const res = await SELF.fetch(`${BASE}/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email(), code: '12345', password: 'newpass123' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing email', async () => {
    const res = await SELF.fetch(`${BASE}/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: '123456', password: 'newpass123' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for password too short', async () => {
    const res = await SELF.fetch(`${BASE}/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email(), code: '123456', password: 'short' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for wrong code on existing account', async () => {
    const e = email();
    await signup(e);

    const res = await SELF.fetch(`${BASE}/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: e, code: '000000', password: 'newpass123' }),
    });
    // Code never requested so reset_code is null → invalid/expired
    expect(res.status).toBe(400);
  });
});

// --- Auth Gating ---

describe('Auth gating on protected routes', () => {
  it('GET /devices returns 401 without token', async () => {
    const res = await SELF.fetch(`${BASE}/devices`);
    expect(res.status).toBe(401);
  });

  it('GET /devices returns 401 with malformed token', async () => {
    const res = await SELF.fetch(`${BASE}/devices`, {
      headers: { Authorization: 'Bearer not.a.valid.jwt' },
    });
    expect(res.status).toBe(401);
  });

  it('GET /devices returns 401 with wrong JWT_SECRET signed token', async () => {
    // Sign a token with a different secret — signature won't verify
    const fakeHeader = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const fakePayload = btoa(
      JSON.stringify({
        sub: 'test@example.com',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 900,
        type: 'access',
      }),
    )
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const fakeToken = `${fakeHeader}.${fakePayload}.invalidsignature`;

    const res = await SELF.fetch(`${BASE}/devices`, {
      headers: { Authorization: `Bearer ${fakeToken}` },
    });
    expect(res.status).toBe(401);
  });

  it('GET /subscription returns 401 without token', async () => {
    const res = await SELF.fetch(`${BASE}/subscription`);
    expect(res.status).toBe(401);
  });

  it('GET /turn-credentials returns 401 without token', async () => {
    const res = await SELF.fetch(`${BASE}/turn-credentials`);
    expect(res.status).toBe(401);
  });

  it('authenticated request works after signup', async () => {
    const e = email();
    const { body } = await signup(e);
    const token = body.accessToken as string;

    const res = await SELF.fetch(`${BASE}/devices`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });
});
