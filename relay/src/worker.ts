import { signJWT, verifyJWT } from './jwt';

export { TerminalSession } from './session';
export { User } from './user';

interface Env {
  TERMINAL_SESSION: DurableObjectNamespace;
  USER: DurableObjectNamespace;
  JWT_SECRET: string;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function corsJson(data: unknown, init?: ResponseInit): Response {
  const res = Response.json(data, init);

  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    res.headers.set(k, v);
  }

  return res;
}

function corsResponse(status: number): Response {
  return new Response(null, { status, headers: CORS_HEADERS });
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

    // WebSocket upgrade for terminal sessions
    const wsMatch = url.pathname.match(/^\/sessions\/([^/]+)\/ws$/);

    if (wsMatch) {
      return handleWebSocket(request, env, wsMatch[1]);
    }

    return corsJson({ error: 'Not found' }, { status: 404 });
  },
};

// --- Auth handlers ---

async function handleSignup(request: Request, env: Env): Promise<Response> {
  const { email, password } = (await request.json()) as { email: string; password: string };

  if (!email || !password || password.length < 8) {
    return corsJson({ error: 'Email and password (min 8 chars) required' }, { status: 400 });
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

  return corsJson(await res.json());
}

// --- WebSocket handler ---

async function handleWebSocket(request: Request, env: Env, sessionId: string): Promise<Response> {
  const upgradeHeader = request.headers.get('Upgrade');

  if (upgradeHeader !== 'websocket') {
    return corsJson({ error: 'Expected WebSocket' }, { status: 426 });
  }

  // Auth via query param for WebSocket connections
  const url = new URL(request.url);
  const token = url.searchParams.get('token');

  if (token) {
    const payload = await verifyJWT(token, env.JWT_SECRET);

    if (!payload || payload.type !== 'access') {
      return corsJson({ error: 'Invalid token' }, { status: 401 });
    }

    // Valid JWT — allow connection. The desktop creates sessions before registering them,
    // so we can't require the session to exist in the DB yet. Auth is sufficient.
  }

  // Note: if no token is provided, we still allow the connection for backward compatibility.
  // TODO: Make auth required once all clients are updated.

  const id = env.TERMINAL_SESSION.idFromName(sessionId);
  const stub = env.TERMINAL_SESSION.get(id);

  return stub.fetch(new Request('http://internal/ws', { headers: request.headers }));
}
