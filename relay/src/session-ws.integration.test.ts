import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { signJWT } from './jwt';

const BASE = 'https://relay.test';
const JWT_SECRET = 'test-jwt-secret-for-integration-tests';

function uid(): string {
  return crypto.randomUUID().slice(0, 8);
}

function uniqueEmail(): string {
  return `session-ws-test-${uid()}@integration.example.com`;
}

function uniqueSessionId(): string {
  return `session-${uid()}`;
}

async function createUserAndGetToken(email = uniqueEmail()): Promise<string> {
  const res = await SELF.fetch(`${BASE}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'testpass123' }),
  });
  const { accessToken } = (await res.json()) as { accessToken: string };
  return accessToken;
}

async function connectSessionWs(sessionId: string): Promise<{ ws: WebSocket; resp: Response }> {
  const resp = await SELF.fetch(`${BASE}/sessions/${sessionId}/ws`, {
    headers: { Upgrade: 'websocket' },
  });
  const ws = resp.webSocket!;
  ws.accept();
  return { ws, resp };
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

async function sendAuth(ws: WebSocket, token: string): Promise<void> {
  ws.send(JSON.stringify({ type: 'auth', token }));
}

async function doFullHandshake(
  ws: WebSocket,
  token: string,
  role: 'desktop' | 'viewer' = 'desktop',
): Promise<{ authOk: Record<string, unknown>; ready: Record<string, unknown> }> {
  await sendAuth(ws, token);
  const authOk = parseMessage(await nextMessage(ws));

  ws.send(
    JSON.stringify({
      type: 'hello',
      clientId: `client-${uid()}`,
      role,
      device: 'test-device',
    }),
  );

  // Expect session_info then ready
  const sessionInfo = parseMessage(await nextMessage(ws));
  expect(sessionInfo.type).toBe('session_info');

  const ready = parseMessage(await nextMessage(ws));
  return { authOk, ready };
}

// --- No auth message ---

describe('Session WS: no auth message', () => {
  it('closes when non-auth message sent as first message', async () => {
    const sessionId = uniqueSessionId();
    const { ws } = await connectSessionWs(sessionId);

    ws.send(JSON.stringify({ type: 'hello', clientId: 'x', role: 'desktop', device: 'test' }));

    const closeEvent = await waitForClose(ws);
    expect(closeEvent.code).toBe(1008);
  });

  it('closes when binary sent as first message', async () => {
    const sessionId = uniqueSessionId();
    const { ws } = await connectSessionWs(sessionId);

    ws.send(new Uint8Array([0x00, 0x01, 0x02]).buffer);

    const closeEvent = await waitForClose(ws);
    expect(closeEvent.code).toBe(1008);
  });
});

// --- Invalid JWT ---

describe('Session WS: invalid JWT', () => {
  it('closes with 1008 on invalid token', async () => {
    const sessionId = uniqueSessionId();
    const { ws } = await connectSessionWs(sessionId);

    ws.send(JSON.stringify({ type: 'auth', token: 'not.a.valid.jwt' }));

    const closeEvent = await waitForClose(ws);
    expect(closeEvent.code).toBe(1008);
  });

  it('closes with 1008 on token signed with wrong secret', async () => {
    const sessionId = uniqueSessionId();
    const { ws } = await connectSessionWs(sessionId);

    const badToken = await signJWT('user@example.com', 'wrong-secret');
    ws.send(JSON.stringify({ type: 'auth', token: badToken }));

    const closeEvent = await waitForClose(ws);
    expect(closeEvent.code).toBe(1008);
  });

  it('closes with 1008 on refresh token (not access)', async () => {
    const sessionId = uniqueSessionId();
    const { ws } = await connectSessionWs(sessionId);

    const refreshToken = await signJWT('user@example.com', JWT_SECRET, 'refresh');
    ws.send(JSON.stringify({ type: 'auth', token: refreshToken }));

    const closeEvent = await waitForClose(ws);
    expect(closeEvent.code).toBe(1008);
  });

  it('closes with 1008 when auth message has no token field', async () => {
    const sessionId = uniqueSessionId();
    const { ws } = await connectSessionWs(sessionId);

    ws.send(JSON.stringify({ type: 'auth' }));

    const closeEvent = await waitForClose(ws);
    expect(closeEvent.code).toBe(1008);
  });
});

// --- Valid auth → auth_ok ---

describe('Session WS: valid auth', () => {
  it('responds with auth_ok on valid JWT', async () => {
    const email = uniqueEmail();
    const token = await createUserAndGetToken(email);
    const sessionId = uniqueSessionId();
    const { ws } = await connectSessionWs(sessionId);

    await sendAuth(ws, token);
    const msg = parseMessage(await nextMessage(ws));

    expect(msg.type).toBe('auth_ok');
    ws.close();
  });
});

// --- Full flow: auth → hello → ready ---

describe('Session WS: full handshake', () => {
  it('completes auth → hello → session_info → ready', async () => {
    const token = await createUserAndGetToken();
    const sessionId = uniqueSessionId();
    const { ws } = await connectSessionWs(sessionId);

    const { authOk, ready } = await doFullHandshake(ws, token, 'desktop');

    expect(authOk.type).toBe('auth_ok');
    expect(ready.type).toBe('ready');

    ws.close();
  });

  it('session_info includes assigned role and clients list', async () => {
    const token = await createUserAndGetToken();
    const sessionId = uniqueSessionId();
    const { ws } = await connectSessionWs(sessionId);

    await sendAuth(ws, token);
    parseMessage(await nextMessage(ws)); // auth_ok

    ws.send(
      JSON.stringify({
        type: 'hello',
        clientId: 'test-client-1',
        role: 'desktop',
        device: 'test-device',
      }),
    );

    const sessionInfo = parseMessage(await nextMessage(ws));
    expect(sessionInfo.type).toBe('session_info');
    expect(sessionInfo.assignedRole).toBe('desktop');
    expect(Array.isArray(sessionInfo.clients)).toBe(true);

    ws.close();
  });
});

// --- Subscription gate (self-hosted → always pro) ---

describe('Session WS: subscription gate', () => {
  it('self-hosted relay lets free users connect (no POLAR_WEBHOOK_SECRET in test env)', async () => {
    // Test environment has no POLAR_WEBHOOK_SECRET → self-hosted mode → gate bypassed
    const token = await createUserAndGetToken();
    const sessionId = uniqueSessionId();
    const { ws } = await connectSessionWs(sessionId);

    await sendAuth(ws, token);
    const msg = parseMessage(await nextMessage(ws));

    // Should succeed — self-hosted relays bypass the pro gate
    expect(msg.type).toBe('auth_ok');

    ws.close();
  });
});

// --- Ownership: second user rejected ---

describe('Session WS: ownership enforcement', () => {
  it('first user becomes owner, second user with different JWT is rejected', async () => {
    const tokenA = await createUserAndGetToken();
    const emailB = uniqueEmail();
    const tokenB = await createUserAndGetToken(emailB);
    const sessionId = uniqueSessionId();

    // User A connects and claims the session
    const { ws: wsA } = await connectSessionWs(sessionId);
    const { authOk } = await doFullHandshake(wsA, tokenA, 'desktop');
    expect(authOk.type).toBe('auth_ok');

    // User B tries to connect to the same session
    const { ws: wsB } = await connectSessionWs(sessionId);
    wsB.send(JSON.stringify({ type: 'auth', token: tokenB }));

    const closeEvent = await waitForClose(wsB);
    expect(closeEvent.code).toBe(1008);
    expect(closeEvent.reason).toBe('Forbidden');

    wsA.close();
  });

  it('same user can connect twice to the same session', async () => {
    const token = await createUserAndGetToken();
    const sessionId = uniqueSessionId();

    // First connection as desktop
    const { ws: wsA } = await connectSessionWs(sessionId);
    const { authOk } = await doFullHandshake(wsA, token, 'desktop');
    expect(authOk.type).toBe('auth_ok');

    // Same user as viewer
    const { ws: wsB } = await connectSessionWs(sessionId);
    await sendAuth(wsB, token);
    const authOk2 = parseMessage(await nextMessage(wsB));
    expect(authOk2.type).toBe('auth_ok');

    wsA.close();
    wsB.close();
  });

  it('second client gets viewer role when desktop is already connected', async () => {
    const token = await createUserAndGetToken();
    const sessionId = uniqueSessionId();

    // Desktop connects first
    const { ws: wsDesktop } = await connectSessionWs(sessionId);
    await doFullHandshake(wsDesktop, token, 'desktop');

    // Viewer connects second
    const { ws: wsViewer } = await connectSessionWs(sessionId);
    await sendAuth(wsViewer, token);
    parseMessage(await nextMessage(wsViewer)); // auth_ok

    wsViewer.send(
      JSON.stringify({
        type: 'hello',
        clientId: 'viewer-client',
        role: 'viewer',
        device: 'iphone',
      }),
    );

    const sessionInfo = parseMessage(await nextMessage(wsViewer));
    expect(sessionInfo.type).toBe('session_info');
    expect(sessionInfo.assignedRole).toBe('viewer');

    wsDesktop.close();
    wsViewer.close();
  });
});

// --- Ping/pong ---

describe('Session WS: ping/pong', () => {
  it('responds to ping with pong after handshake', async () => {
    const token = await createUserAndGetToken();
    const sessionId = uniqueSessionId();
    const { ws } = await connectSessionWs(sessionId);

    await doFullHandshake(ws, token, 'desktop');

    const ts = Date.now();
    ws.send(JSON.stringify({ type: 'ping', timestamp: ts }));

    const pong = parseMessage(await nextMessage(ws));
    expect(pong.type).toBe('pong');
    expect(pong.timestamp).toBe(ts);

    ws.close();
  });
});
