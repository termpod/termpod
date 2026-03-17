import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { signJWT } from './jwt';

const BASE = 'https://relay.test';
const JWT_SECRET = 'test-jwt-secret-for-integration-tests';

function uid(): string {
  return crypto.randomUUID().slice(0, 8);
}

function uniqueEmail(): string {
  return `device-ws-test-${uid()}@integration.example.com`;
}

function uniqueDeviceId(): string {
  return `device-${uid()}`;
}

async function createUserAndGetToken(email = uniqueEmail()): Promise<{ token: string; email: string }> {
  const res = await SELF.fetch(`${BASE}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'testpass123' }),
  });
  const { accessToken } = (await res.json()) as { accessToken: string };
  return { token: accessToken, email };
}

async function registerDevice(token: string, deviceId = uniqueDeviceId()): Promise<string> {
  await SELF.fetch(`${BASE}/devices`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: deviceId,
      name: 'Test Mac',
      deviceType: 'desktop',
      platform: 'macos',
    }),
  });
  return deviceId;
}

async function connectDeviceWs(
  deviceId: string,
  token?: string,
): Promise<{ ws: WebSocket; resp: Response }> {
  const url = token
    ? `${BASE}/devices/${deviceId}/ws?token=${token}`
    : `${BASE}/devices/${deviceId}/ws`;

  const resp = await SELF.fetch(url, {
    headers: { Upgrade: 'websocket' },
  });

  if (resp.webSocket) {
    resp.webSocket.accept();
  }

  return { ws: resp.webSocket as WebSocket, resp };
}

function nextMessage(ws: WebSocket): Promise<string | ArrayBuffer> {
  return new Promise((resolve, reject) => {
    ws.addEventListener('message', (e) => resolve(e.data), { once: true });
    ws.addEventListener('close', (e) => reject(new Error(`WS closed: ${e.code} ${e.reason}`)), {
      once: true,
    });
    ws.addEventListener('error', () => reject(new Error('WS error')), { once: true });
  });
}

function waitForClose(ws: WebSocket): Promise<CloseEvent> {
  return new Promise((resolve) => {
    ws.addEventListener('close', (e) => resolve(e as CloseEvent), { once: true });
  });
}

function parseMessage(raw: string | ArrayBuffer): Record<string, unknown> {
  if (typeof raw !== 'string') {
    throw new Error('Expected string message');
  }
  return JSON.parse(raw) as Record<string, unknown>;
}

async function doFullDeviceHandshake(
  ws: WebSocket,
  token: string,
  role: 'desktop' | 'viewer' = 'desktop',
): Promise<{ authOk: Record<string, unknown>; helloOk: Record<string, unknown> }> {
  ws.send(JSON.stringify({ type: 'auth', token }));
  const authOk = parseMessage(await nextMessage(ws));

  ws.send(
    JSON.stringify({
      type: 'hello',
      clientId: `client-${uid()}`,
      role,
      device: 'test-device',
    }),
  );

  const helloOk = parseMessage(await nextMessage(ws));
  return { authOk, helloOk };
}

// --- No token in URL ---

describe('Device WS: no token in URL', () => {
  it('returns 401 HTTP response when no ?token= provided', async () => {
    const deviceId = uniqueDeviceId();
    const { resp } = await connectDeviceWs(deviceId);
    // Worker rejects before WS upgrade — should be a plain HTTP 401 response
    expect(resp.status).toBe(401);
    expect(resp.webSocket).toBeNull();
  });
});

// --- Invalid token in URL ---

describe('Device WS: invalid token in URL', () => {
  it('returns 401 for a malformed token', async () => {
    const deviceId = uniqueDeviceId();
    const { resp } = await connectDeviceWs(deviceId, 'not.a.valid.jwt');
    expect(resp.status).toBe(401);
    expect(resp.webSocket).toBeNull();
  });

  it('returns 401 for a token signed with wrong secret', async () => {
    const deviceId = uniqueDeviceId();
    const badToken = await signJWT('user@example.com', 'wrong-secret');
    const { resp } = await connectDeviceWs(deviceId, badToken);
    expect(resp.status).toBe(401);
    expect(resp.webSocket).toBeNull();
  });

  it('returns 401 for a refresh token (not access)', async () => {
    const deviceId = uniqueDeviceId();
    const refreshToken = await signJWT('user@example.com', JWT_SECRET, 'refresh');
    const { resp } = await connectDeviceWs(deviceId, refreshToken);
    expect(resp.status).toBe(401);
    expect(resp.webSocket).toBeNull();
  });
});

// --- Valid routing + first-message auth ---

describe('Device WS: valid routing and first-message auth', () => {
  it('accepts WS upgrade and returns auth_ok after valid auth message', async () => {
    const { token, email } = await createUserAndGetToken();
    const deviceId = await registerDevice(token);
    const { ws, resp } = await connectDeviceWs(deviceId, token);

    expect(resp.status).toBe(101);
    expect(ws).not.toBeNull();

    ws.send(JSON.stringify({ type: 'auth', token }));
    const msg = parseMessage(await nextMessage(ws));

    expect(msg.type).toBe('auth_ok');

    ws.close();

    void email; // used for uniqueness
  });

  it('closes with 1008 when first message is not an auth message', async () => {
    const { token } = await createUserAndGetToken();
    const deviceId = await registerDevice(token);
    const { ws } = await connectDeviceWs(deviceId, token);

    ws.send(JSON.stringify({ type: 'hello', clientId: 'x', role: 'desktop', device: 'test' }));

    const closeEvent = await waitForClose(ws);
    expect(closeEvent.code).toBe(1008);
  });

  it('closes with 1008 when first-message token is invalid', async () => {
    const { token } = await createUserAndGetToken();
    const deviceId = await registerDevice(token);
    const { ws } = await connectDeviceWs(deviceId, token);

    ws.send(JSON.stringify({ type: 'auth', token: 'bad.token.here' }));

    const closeEvent = await waitForClose(ws);
    expect(closeEvent.code).toBe(1008);
  });

  it('closes with 1008 when auth message has no token field', async () => {
    const { token } = await createUserAndGetToken();
    const deviceId = await registerDevice(token);
    const { ws } = await connectDeviceWs(deviceId, token);

    ws.send(JSON.stringify({ type: 'auth' }));

    const closeEvent = await waitForClose(ws);
    expect(closeEvent.code).toBe(1008);
  });
});

// --- Full flow: auth → hello → hello_ok ---

describe('Device WS: full handshake', () => {
  it('completes auth → hello → hello_ok', async () => {
    const { token } = await createUserAndGetToken();
    const deviceId = await registerDevice(token);
    const { ws } = await connectDeviceWs(deviceId, token);

    const { authOk, helloOk } = await doFullDeviceHandshake(ws, token, 'desktop');

    expect(authOk.type).toBe('auth_ok');
    expect(helloOk.type).toBe('hello_ok');
    expect(Array.isArray(helloOk.clients)).toBe(true);

    ws.close();
  });

  it('hello_ok includes clients list', async () => {
    const { token } = await createUserAndGetToken();
    const deviceId = await registerDevice(token);
    const { ws } = await connectDeviceWs(deviceId, token);

    ws.send(JSON.stringify({ type: 'auth', token }));
    parseMessage(await nextMessage(ws)); // auth_ok

    ws.send(
      JSON.stringify({
        type: 'hello',
        clientId: 'desktop-client-1',
        role: 'desktop',
        device: 'test-mac',
      }),
    );

    const helloOk = parseMessage(await nextMessage(ws));
    expect(helloOk.type).toBe('hello_ok');
    expect(Array.isArray(helloOk.clients)).toBe(true);

    ws.close();
  });

  it('hello is ignored until auth is complete', async () => {
    const { token } = await createUserAndGetToken();
    const deviceId = await registerDevice(token);
    const { ws } = await connectDeviceWs(deviceId, token);

    // Send hello before auth — should be treated as a non-auth first message and close
    ws.send(JSON.stringify({ type: 'hello', clientId: 'x', role: 'desktop', device: 'test' }));

    const closeEvent = await waitForClose(ws);
    expect(closeEvent.code).toBe(1008);
  });
});

// --- User mismatch ---

describe('Device WS: user mismatch', () => {
  it('closes with 1008 when token belongs to a different user than the DO owner', async () => {
    // User A creates an account — their User DO is keyed by email A
    const { token: tokenA, email: emailA } = await createUserAndGetToken();
    const deviceIdA = await registerDevice(tokenA);

    // User B creates a separate account — their User DO is keyed by email B
    const { token: tokenB } = await createUserAndGetToken();

    // Connect to user A's DO using user A's URL token (routes to A's DO)
    // but send user B's JWT as the first-message auth
    // The worker routes based on URL token → user A's DO
    // User A's DO checks profile email vs JWT sub → mismatch
    const { ws } = await connectDeviceWs(deviceIdA, tokenA);
    ws.send(JSON.stringify({ type: 'auth', token: tokenB }));

    const closeEvent = await waitForClose(ws);
    expect(closeEvent.code).toBe(1008);
    expect(closeEvent.reason).toBe('User mismatch');

    void emailA; // used for DO routing
  });

  it('same user token in URL and first-message succeeds', async () => {
    const { token } = await createUserAndGetToken();
    const deviceId = await registerDevice(token);
    const { ws } = await connectDeviceWs(deviceId, token);

    ws.send(JSON.stringify({ type: 'auth', token }));
    const msg = parseMessage(await nextMessage(ws));

    expect(msg.type).toBe('auth_ok');

    ws.close();
  });
});

// --- Unregistered device ---

describe('Device WS: unregistered device', () => {
  it('can still upgrade WS with valid token for non-existent device', async () => {
    // The worker only validates the URL token for DO routing.
    // The DO itself does not check if the device exists before accepting the WS.
    // Auth proceeds normally — device existence is not a WS gate.
    const { token } = await createUserAndGetToken();
    const nonExistentDeviceId = uniqueDeviceId();
    const { ws, resp } = await connectDeviceWs(nonExistentDeviceId, token);

    expect(resp.status).toBe(101);
    expect(ws).not.toBeNull();

    ws.send(JSON.stringify({ type: 'auth', token }));
    const msg = parseMessage(await nextMessage(ws));
    expect(msg.type).toBe('auth_ok');

    ws.close();
  });
});

// --- Binary messages ignored ---

describe('Device WS: binary messages', () => {
  it('silently drops binary messages after auth (device WS is JSON-only)', async () => {
    const { token } = await createUserAndGetToken();
    const deviceId = await registerDevice(token);
    const { ws } = await connectDeviceWs(deviceId, token);

    await doFullDeviceHandshake(ws, token, 'desktop');

    // Binary data should be silently dropped — no close, no error message
    ws.send(new Uint8Array([0x10, 0x00, 0x01]).buffer);

    // Send a ping after binary to verify socket is still alive
    ws.send(JSON.stringify({ type: 'ping' }));

    // Connection should still be alive (no close event before ping echoes or times out)
    // Since device WS doesn't implement ping/pong, just verify we don't get a close
    let closed = false;
    ws.addEventListener('close', () => {
      closed = true;
    });

    // Give a tick for any close to fire
    await new Promise((r) => setTimeout(r, 50));
    expect(closed).toBe(false);

    ws.close();
  });
});
