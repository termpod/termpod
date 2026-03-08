import { signJWT, verifyJWT } from './jwt';

export { TerminalSession } from './session';
export { User } from './user';

interface Env {
  TERMINAL_SESSION: DurableObjectNamespace;
  USER: DurableObjectNamespace;
  JWT_SECRET: string;
  GITHUB_TOKEN: string;
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

    // --- Public update proxy ---

    if (url.pathname === '/updates/latest.json' && request.method === 'GET') {
      return handleUpdateLatest(env, url.origin);
    }

    const updateDownloadMatch = url.pathname.match(/^\/updates\/download\/(.+)$/);

    if (updateDownloadMatch && request.method === 'GET') {
      return handleUpdateDownload(env, updateDownloadMatch[1]);
    }

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

    // Device WebSocket (control plane + signaling)
    const deviceWsMatch = url.pathname.match(/^\/devices\/([^/]+)\/ws$/);

    if (deviceWsMatch) {
      return handleDeviceWebSocket(request, env, deviceWsMatch[1]);
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

// --- Update proxy handlers ---

const GITHUB_REPO = 'termpod/termpod';
const GITHUB_API = 'https://api.github.com';

async function handleUpdateLatest(env: Env, origin: string): Promise<Response> {
  const releaseRes = await fetch(`${GITHUB_API}/repos/${GITHUB_REPO}/releases/latest`, {
    headers: {
      Authorization: `token ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'termpod-relay',
    },
  });

  if (!releaseRes.ok) {
    return corsResponse(204);
  }

  const release = (await releaseRes.json()) as {
    assets: Array<{ name: string; url: string }>;
  };

  const latestAsset = release.assets.find((a) => a.name === 'latest.json');

  if (!latestAsset) {
    return corsResponse(204);
  }

  const assetRes = await fetch(latestAsset.url, {
    headers: {
      Authorization: `token ${env.GITHUB_TOKEN}`,
      Accept: 'application/octet-stream',
      'User-Agent': 'termpod-relay',
    },
  });

  if (!assetRes.ok) {
    return corsResponse(204);
  }

  const latestJson = (await assetRes.json()) as Record<string, unknown>;

  // Rewrite download URLs to proxy through this worker

  if (latestJson.platforms && typeof latestJson.platforms === 'object') {
    for (const platform of Object.values(latestJson.platforms as Record<string, { url?: string }>)) {
      if (platform.url) {
        const filename = platform.url.split('/').pop();
        platform.url = `${origin}/updates/download/${filename}`;
      }
    }
  }

  // Also handle flat format (url at top level)
  if (typeof latestJson.url === 'string') {
    const filename = (latestJson.url as string).split('/').pop();
    latestJson.url = `${origin}/updates/download/${filename}`;
  }

  const res = Response.json(latestJson);

  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    res.headers.set(k, v);
  }

  res.headers.set('Cache-Control', 'public, max-age=300');

  return res;
}

async function handleUpdateDownload(env: Env, filename: string): Promise<Response> {
  // Validate filename to prevent path traversal
  if (filename.includes('/') || filename.includes('..')) {
    return corsJson({ error: 'Invalid filename' }, { status: 400 });
  }

  const releaseRes = await fetch(`${GITHUB_API}/repos/${GITHUB_REPO}/releases/latest`, {
    headers: {
      Authorization: `token ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'termpod-relay',
    },
  });

  if (!releaseRes.ok) {
    return corsJson({ error: 'Release not found' }, { status: 404 });
  }

  const release = (await releaseRes.json()) as {
    assets: Array<{ name: string; url: string; content_type: string }>;
  };

  const asset = release.assets.find((a) => a.name === filename);

  if (!asset) {
    return corsJson({ error: 'Asset not found' }, { status: 404 });
  }

  const assetRes = await fetch(asset.url, {
    headers: {
      Authorization: `token ${env.GITHUB_TOKEN}`,
      Accept: 'application/octet-stream',
      'User-Agent': 'termpod-relay',
    },
  });

  if (!assetRes.ok) {
    return corsJson({ error: 'Download failed' }, { status: 502 });
  }

  const headers = new Headers(CORS_HEADERS);
  headers.set('Content-Type', asset.content_type || 'application/octet-stream');
  headers.set('Content-Disposition', `attachment; filename="${filename}"`);
  headers.set('Cache-Control', 'public, max-age=3600');

  return new Response(assetRes.body, { headers });
}

// --- Device WebSocket handler ---

async function handleDeviceWebSocket(request: Request, env: Env, deviceId: string): Promise<Response> {
  const upgradeHeader = request.headers.get('Upgrade');

  if (upgradeHeader !== 'websocket') {
    return corsJson({ error: 'Expected WebSocket' }, { status: 426 });
  }

  // Validate device ID format
  if (!deviceId || deviceId.length > 64) {
    return corsJson({ error: 'Invalid device ID' }, { status: 400 });
  }

  // Auth: first-message flow (DO handles JWT validation)
  // We still need the userId to route to the correct User DO.
  // Try to extract from Authorization header or URL token for routing.
  const headers = new Headers(request.headers);
  headers.set('X-JWT-Secret', env.JWT_SECRET);

  // Try Authorization header for DO routing
  const auth = request.headers.get('Authorization');
  let userId: string | null = null;

  if (auth?.startsWith('Bearer ')) {
    const token = auth.slice(7);
    const payload = await verifyJWT(token, env.JWT_SECRET);

    if (payload?.type === 'access') {
      userId = payload.sub;
      headers.set('X-User-Id', userId);
    }
  }

  // Try URL token as fallback
  if (!userId) {
    const url = new URL(request.url);
    const urlToken = url.searchParams.get('token');

    if (urlToken) {
      const payload = await verifyJWT(urlToken, env.JWT_SECRET);

      if (payload?.type === 'access') {
        userId = payload.sub;
        headers.set('X-User-Id', userId);
      }
    }
  }

  // If we couldn't determine the user from headers/URL, the DO will handle
  // first-message auth. But we need a userId to route to the correct DO.
  // For first-message auth, the client must provide a userId hint.
  if (!userId) {
    // Check for userId query param (used for routing only, auth still via first message)
    const url = new URL(request.url);
    userId = url.searchParams.get('userId');

    if (!userId) {
      return corsJson({ error: 'Authentication required' }, { status: 401 });
    }
  }

  const stub = getUserDO(env, userId);

  return stub.fetch(new Request(`http://internal/devices/${deviceId}/ws`, { headers }));
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
