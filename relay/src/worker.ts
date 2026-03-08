import { signJWT, verifyJWT } from './jwt';

export { TerminalSession } from './session';
export { User } from './user';

interface Env {
  TERMINAL_SESSION: DurableObjectNamespace;
  USER: DurableObjectNamespace;
  JWT_SECRET: string;
}

// Origin: * is acceptable here — auth uses Bearer tokens (not cookies),
// so a malicious site cannot forge cross-origin requests with the user's credentials.
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

function corsJson(data: unknown, init?: ResponseInit): Response {
  const res = Response.json(data, init);

  for (const [k, v] of Object.entries({ ...CORS_HEADERS, ...SECURITY_HEADERS })) {
    res.headers.set(k, v);
  }

  return res;
}

function corsResponse(status: number): Response {
  const headers = { ...CORS_HEADERS, ...SECURITY_HEADERS };

  return new Response(null, { status, headers });
}

async function requireAuth(request: Request, env: Env): Promise<string | Response> {
  const auth = request.headers.get('Authorization');

  if (!auth?.startsWith('Bearer ')) {
    return corsJson({ error: 'Missing authorization' }, { status: 401 });
  }

  const token = auth.slice(7);
  const payload = await verifyJWT(token, env.JWT_SECRET);

  if (!payload || payload.type !== 'access') {
    return corsJson({ error: 'Invalid or expired token' }, { status: 401 });
  }

  return payload.sub; // userId (email)
}

function getUserDO(env: Env, email: string): DurableObjectStub {
  const id = env.USER.idFromName(email.toLowerCase());

  return env.USER.get(id);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return corsResponse(204);
    }

    try {
      return await handleRequest(request, env);
    } catch (err) {
      console.error('Unhandled error:', err);

      return corsJson({ error: 'Internal server error' }, { status: 500 });
    }
  },
};

async function handleRequest(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // --- Public auth routes ---

    if (url.pathname === '/auth/signup' && request.method === 'POST') {
      return handleSignup(request, env);
    }

    if (url.pathname === '/auth/login' && request.method === 'POST') {
      return handleLogin(request, env);
    }

    if (url.pathname === '/auth/refresh' && request.method === 'POST') {
      return handleRefresh(request, env);
    }

    // --- Authenticated routes ---

    // Device routes
    if (url.pathname === '/devices' && (request.method === 'GET' || request.method === 'POST')) {
      return handleDevices(request, env);
    }

    const deviceActionMatch = url.pathname.match(/^\/devices\/([^/]+)\/(heartbeat|offline)$/);

    if (deviceActionMatch && request.method === 'POST') {
      return handleDeviceAction(request, env, deviceActionMatch[1], deviceActionMatch[2]);
    }

    const deviceDeleteMatch = url.pathname.match(/^\/devices\/([^/]+)$/);

    if (deviceDeleteMatch && request.method === 'DELETE') {
      return handleDeviceDelete(request, env, deviceDeleteMatch[1]);
    }

    // Session routes
    const deviceSessionsMatch = url.pathname.match(/^\/devices\/([^/]+)\/sessions$/);

    if (deviceSessionsMatch) {
      return handleDeviceSessions(request, env, deviceSessionsMatch[1]);
    }

    const sessionDeleteMatch = url.pathname.match(/^\/sessions\/([^/]+)$/);

    if (sessionDeleteMatch && request.method === 'DELETE') {
      return handleSessionDelete(request, env, sessionDeleteMatch[1]);
    }

    if (sessionDeleteMatch && request.method === 'PATCH') {
      return handleSessionUpdate(request, env, sessionDeleteMatch[1]);
    }

    // Pending session request routes
    const requestSessionMatch = url.pathname.match(/^\/devices\/([^/]+)\/request-session$/);

    if (requestSessionMatch && request.method === 'POST') {
      return handleRequestSession(request, env, requestSessionMatch[1]);
    }

    const pendingRequestsMatch = url.pathname.match(/^\/devices\/([^/]+)\/pending-requests$/);

    if (pendingRequestsMatch) {
      return handlePendingRequests(request, env, pendingRequestsMatch[1]);
    }

    // WebSocket upgrade for terminal sessions
    const wsMatch = url.pathname.match(/^\/sessions\/([^/]+)\/ws$/);

    if (wsMatch) {
      return handleWebSocket(request, env, wsMatch[1]);
    }

    return corsJson({ error: 'Not found' }, { status: 404 });
}

// --- Auth handlers ---

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function handleSignup(request: Request, env: Env): Promise<Response> {
  const { email, password } = (await request.json()) as { email: string; password: string };

  if (!email || !password || password.length < 8) {
    return corsJson({ error: 'Email and password (min 8 chars) required' }, { status: 400 });
  }

  if (!EMAIL_REGEX.test(email)) {
    return corsJson({ error: 'Invalid email format' }, { status: 400 });
  }

  const stub = getUserDO(env, email);
  const res = await stub.fetch(
    new Request('http://internal/signup', {
      method: 'POST',
      body: JSON.stringify({ email: email.toLowerCase(), password }),
    }),
  );

  if (!res.ok) {
    const body = await res.json() as { error: string };

    return corsJson(body, { status: res.status });
  }

  // Auto-login after signup
  const accessToken = await signJWT(email.toLowerCase(), env.JWT_SECRET, 'access');
  const refreshToken = await signJWT(email.toLowerCase(), env.JWT_SECRET, 'refresh');

  return corsJson({ accessToken, refreshToken }, { status: 201 });
}

async function handleLogin(request: Request, env: Env): Promise<Response> {
  const { email, password } = (await request.json()) as { email: string; password: string };

  if (!email || !password) {
    return corsJson({ error: 'Email and password required' }, { status: 400 });
  }

  const stub = getUserDO(env, email);
  const res = await stub.fetch(
    new Request('http://internal/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),
  );

  if (!res.ok) {
    return corsJson({ error: 'Invalid credentials' }, { status: 401 });
  }

  const accessToken = await signJWT(email.toLowerCase(), env.JWT_SECRET, 'access');
  const refreshToken = await signJWT(email.toLowerCase(), env.JWT_SECRET, 'refresh');

  return corsJson({ accessToken, refreshToken });
}

async function handleRefresh(request: Request, env: Env): Promise<Response> {
  const { refreshToken } = (await request.json()) as { refreshToken: string };

  if (!refreshToken) {
    return corsJson({ error: 'Refresh token required' }, { status: 400 });
  }

  const payload = await verifyJWT(refreshToken, env.JWT_SECRET);

  if (!payload || payload.type !== 'refresh') {
    return corsJson({ error: 'Invalid refresh token' }, { status: 401 });
  }

  // Verify user still exists before issuing new tokens
  const stub = getUserDO(env, payload.sub);
  const existsRes = await stub.fetch(new Request('http://internal/exists'));

  if (!existsRes.ok) {
    return corsJson({ error: 'Invalid refresh token' }, { status: 401 });
  }

  const accessToken = await signJWT(payload.sub, env.JWT_SECRET, 'access');
  const newRefreshToken = await signJWT(payload.sub, env.JWT_SECRET, 'refresh');

  return corsJson({ accessToken, refreshToken: newRefreshToken });
}

// --- Device handlers ---

async function handleDevices(request: Request, env: Env): Promise<Response> {
  const userIdOrError = await requireAuth(request, env);

  if (userIdOrError instanceof Response) {
    return userIdOrError;
  }

  const stub = getUserDO(env, userIdOrError);

  if (request.method === 'GET') {
    const res = await stub.fetch(new Request('http://internal/devices'));

    return corsJson(await res.json());
  }

  // POST — register device
  const body = await request.json();
  const res = await stub.fetch(
    new Request('http://internal/devices', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  );

  return corsJson(await res.json(), { status: res.status });
}

async function handleDeviceAction(
  request: Request,
  env: Env,
  deviceId: string,
  action: string,
): Promise<Response> {
  const userIdOrError = await requireAuth(request, env);

  if (userIdOrError instanceof Response) {
    return userIdOrError;
  }

  const stub = getUserDO(env, userIdOrError);
  const res = await stub.fetch(
    new Request(`http://internal/devices/${deviceId}/${action}`, { method: 'POST' }),
  );

  return corsJson(await res.json());
}

async function handleDeviceDelete(
  request: Request,
  env: Env,
  deviceId: string,
): Promise<Response> {
  const userIdOrError = await requireAuth(request, env);

  if (userIdOrError instanceof Response) {
    return userIdOrError;
  }

  const stub = getUserDO(env, userIdOrError);
  const res = await stub.fetch(
    new Request(`http://internal/devices/${deviceId}`, { method: 'DELETE' }),
  );

  return corsJson(await res.json());
}

// --- Session handlers ---

async function handleDeviceSessions(
  request: Request,
  env: Env,
  deviceId: string,
): Promise<Response> {
  const userIdOrError = await requireAuth(request, env);

  if (userIdOrError instanceof Response) {
    return userIdOrError;
  }

  const stub = getUserDO(env, userIdOrError);

  if (request.method === 'GET') {
    const res = await stub.fetch(
      new Request(`http://internal/devices/${deviceId}/sessions`),
    );

    return corsJson(await res.json());
  }

  // POST — register session
  const body = await request.json();
  const res = await stub.fetch(
    new Request(`http://internal/devices/${deviceId}/sessions`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  );

  return corsJson(await res.json(), { status: res.status });
}

async function handleSessionDelete(
  request: Request,
  env: Env,
  sessionId: string,
): Promise<Response> {
  const userIdOrError = await requireAuth(request, env);

  if (userIdOrError instanceof Response) {
    return userIdOrError;
  }

  const stub = getUserDO(env, userIdOrError);
  const res = await stub.fetch(
    new Request(`http://internal/sessions/${sessionId}`, { method: 'DELETE' }),
  );

  // Notify connected clients that the session is closed
  const sessionDOId = env.TERMINAL_SESSION.idFromName(sessionId);
  const sessionStub = env.TERMINAL_SESSION.get(sessionDOId);
  await sessionStub.fetch(new Request('http://internal/close', { method: 'POST' })).catch(() => {});

  return corsJson(await res.json());
}

async function handleSessionUpdate(
  request: Request,
  env: Env,
  sessionId: string,
): Promise<Response> {
  const userIdOrError = await requireAuth(request, env);

  if (userIdOrError instanceof Response) {
    return userIdOrError;
  }

  const stub = getUserDO(env, userIdOrError);
  const res = await stub.fetch(
    new Request(`http://internal/sessions/${sessionId}`, {
      method: 'PATCH',
      body: request.body,
    }),
  );

  return corsJson(await res.json(), { status: res.status });
}

// --- Pending session request handlers ---

async function handleRequestSession(
  request: Request,
  env: Env,
  deviceId: string,
): Promise<Response> {
  const userIdOrError = await requireAuth(request, env);

  if (userIdOrError instanceof Response) {
    return userIdOrError;
  }

  const stub = getUserDO(env, userIdOrError);
  const body = await request.json();
  const res = await stub.fetch(
    new Request(`http://internal/devices/${deviceId}/request-session`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  );

  return corsJson(await res.json(), { status: res.status });
}

async function handlePendingRequests(
  request: Request,
  env: Env,
  deviceId: string,
): Promise<Response> {
  const userIdOrError = await requireAuth(request, env);

  if (userIdOrError instanceof Response) {
    return userIdOrError;
  }

  const stub = getUserDO(env, userIdOrError);

  if (request.method === 'GET') {
    const res = await stub.fetch(
      new Request(`http://internal/devices/${deviceId}/pending-requests`),
    );

    return corsJson(await res.json());
  }

  if (request.method === 'DELETE') {
    const res = await stub.fetch(
      new Request(`http://internal/devices/${deviceId}/pending-requests`, { method: 'DELETE' }),
    );

    return corsJson(await res.json());
  }

  return corsJson({ error: 'Method not allowed' }, { status: 405 });
}

// --- WebSocket handler ---

async function handleWebSocket(request: Request, env: Env, sessionId: string): Promise<Response> {
  const upgradeHeader = request.headers.get('Upgrade');

  if (upgradeHeader !== 'websocket') {
    return corsJson({ error: 'Expected WebSocket' }, { status: 426 });
  }

  const headers = new Headers(request.headers);

  // Support both legacy (URL token) and new (first-message) auth flows.
  // Legacy: token in URL query param → validate here, pass userId to DO.
  // New: no URL token → DO handles first-message auth.
  const url = new URL(request.url);
  const urlToken = url.searchParams.get('token');

  if (urlToken) {
    const payload = await verifyJWT(urlToken, env.JWT_SECRET);

    if (!payload || payload.type !== 'access') {
      return corsJson({ error: 'Invalid or expired token' }, { status: 401 });
    }

    headers.set('X-User-Id', payload.sub);
  }

  // Always pass JWT secret so DO can handle first-message auth for new clients
  headers.set('X-JWT-Secret', env.JWT_SECRET);

  const id = env.TERMINAL_SESSION.idFromName(sessionId);
  const stub = env.TERMINAL_SESSION.get(id);

  return stub.fetch(new Request('http://internal/ws', { headers }));
}
