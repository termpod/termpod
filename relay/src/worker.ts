import { Toucan } from 'toucan-js';
import { signJWT, verifyJWT } from './jwt';

export { TerminalSession } from './session';
export { User } from './user';

interface Env {
  TERMINAL_SESSION: DurableObjectNamespace;
  USER: DurableObjectNamespace;
  JWT_SECRET: string;
  GITHUB_TOKEN: string;
  TURN_KEY_ID: string;
  TURN_KEY_API_TOKEN: string;
  SENTRY_DSN?: string;
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

async function corsJsonFromUpstream(res: Response): Promise<Response> {
  const body = await res.json();
  return corsJsonWithRetryAfter(body, res);
}

function corsJsonWithRetryAfter(body: unknown, res: Response, status = res.status): Response {
  const response = corsJson(body, { status });
  const retryAfter = res.headers.get('Retry-After');

  if (retryAfter) {
    response.headers.set('Retry-After', retryAfter);
  }

  return response;
}

async function consumeUserRateLimit(
  env: Env,
  email: string,
  name: string,
  scope?: string,
): Promise<Response | null> {
  const stub = getUserDO(env, email);
  const res = await stub.fetch(
    new Request('http://internal/rate-limit', {
      method: 'POST',
      body: JSON.stringify({ name, scope }),
    }),
  );

  if (res.ok) {
    return null;
  }

  if (res.status === 429) {
    return corsJsonFromUpstream(res);
  }

  console.error('Rate-limit check failed:', name, res.status);
  return corsJson({ error: 'Internal server error' }, { status: 500 });
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
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return corsResponse(204);
    }

    const sentry = env.SENTRY_DSN
      ? new Toucan({ dsn: env.SENTRY_DSN, context: ctx, request })
      : null;

    try {
      return await handleRequest(request, env);
    } catch (err) {
      sentry?.captureException(err);
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

  // Share token routes
  const shareMatch = url.pathname.match(/^\/sessions\/([^/]+)\/share$/);

  if (shareMatch) {
    return handleSessionShare(request, env, shareMatch[1]);
  }

  // Web viewer: /share/:sessionId/:token (public)
  const viewerMatch = url.pathname.match(/^\/share\/([^/]+)\/([^/]+)$/);

  if (viewerMatch && request.method === 'GET') {
    // Validate token before serving the page
    const valid = await validateShareToken(env, viewerMatch[2], viewerMatch[1]);

    if (!valid) {
      return new Response(buildExpiredHtml(), {
        status: 410,
        headers: { 'Content-Type': 'text/html; charset=utf-8', ...SECURITY_HEADERS },
      });
    }

    return serveWebViewer(url.origin, viewerMatch[1], viewerMatch[2]);
  }

  // TURN credentials for WebRTC
  if (url.pathname === '/turn-credentials' && request.method === 'GET') {
    return handleTurnCredentials(request, env);
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
    return corsJsonFromUpstream(res);
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
    return corsJsonFromUpstream(res);
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

  const limited = await consumeUserRateLimit(env, payload.sub, 'auth.refresh');

  if (limited) {
    return limited;
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

    return corsJsonFromUpstream(res);
  }

  // POST — register device
  const body = await request.json();
  const res = await stub.fetch(
    new Request('http://internal/devices', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  );

  return corsJsonFromUpstream(res);
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

  return corsJsonFromUpstream(res);
}

async function handleDeviceDelete(request: Request, env: Env, deviceId: string): Promise<Response> {
  const userIdOrError = await requireAuth(request, env);

  if (userIdOrError instanceof Response) {
    return userIdOrError;
  }

  const stub = getUserDO(env, userIdOrError);
  const res = await stub.fetch(
    new Request(`http://internal/devices/${deviceId}`, { method: 'DELETE' }),
  );

  return corsJsonFromUpstream(res);
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
    const res = await stub.fetch(new Request(`http://internal/devices/${deviceId}/sessions`));

    return corsJsonFromUpstream(res);
  }

  // POST — register session
  const body = await request.json();
  const res = await stub.fetch(
    new Request(`http://internal/devices/${deviceId}/sessions`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  );

  return corsJsonFromUpstream(res);
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

  return corsJsonFromUpstream(res);
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

  return corsJsonFromUpstream(res);
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

  return corsJsonFromUpstream(res);
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

    return corsJsonFromUpstream(res);
  }

  if (request.method === 'DELETE') {
    const res = await stub.fetch(
      new Request(`http://internal/devices/${deviceId}/pending-requests`, { method: 'DELETE' }),
    );

    return corsJsonFromUpstream(res);
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
    for (const platform of Object.values(
      latestJson.platforms as Record<string, { url?: string }>,
    )) {
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

// --- TURN credentials handler ---

async function handleTurnCredentials(request: Request, env: Env): Promise<Response> {
  const userId = await requireAuth(request, env);

  if (userId instanceof Response) {
    return userId;
  }

  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) {
    return corsJson({ error: 'TURN not configured' }, { status: 503 });
  }

  const limited = await consumeUserRateLimit(env, userId, 'turn.credentials');

  if (limited) {
    return limited;
  }

  const res = await fetch(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ttl: 86400 }),
    },
  );

  if (!res.ok) {
    const body = await res.text();
    console.error('TURN credential generation failed:', res.status, body);
    return corsJson(
      { error: 'Failed to generate TURN credentials', upstream: res.status, detail: body },
      { status: 502 },
    );
  }

  const data = (await res.json()) as { iceServers: unknown };

  return corsJson({ iceServers: data.iceServers });
}

// --- Device WebSocket handler ---

async function handleDeviceWebSocket(
  request: Request,
  env: Env,
  deviceId: string,
): Promise<Response> {
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

  // Extract userId for DO routing only — actual auth is always via first-message in the DO.
  // This avoids leaking the JWT in URL query strings to logs/proxies.
  const auth = request.headers.get('Authorization');
  let userId: string | null = null;

  if (auth?.startsWith('Bearer ')) {
    const token = auth.slice(7);
    const payload = await verifyJWT(token, env.JWT_SECRET);

    if (payload?.type === 'access') {
      userId = payload.sub;
    }
  }

  // Fallback: extract userId from URL token for routing (but do NOT mark as authenticated)
  if (!userId) {
    const url = new URL(request.url);
    const urlToken = url.searchParams.get('token');

    if (urlToken) {
      const payload = await verifyJWT(urlToken, env.JWT_SECRET);

      if (payload?.type === 'access') {
        userId = payload.sub;
      }
    }
  }

  if (!userId) {
    return corsJson({ error: 'Authentication required' }, { status: 401 });
  }

  const stub = getUserDO(env, userId);

  return stub.fetch(new Request(`http://internal/devices/${deviceId}/ws`, { headers }));
}

// --- WebSocket handler ---

// --- Share handlers ---

async function handleSessionShare(
  request: Request,
  env: Env,
  sessionId: string,
): Promise<Response> {
  const userIdOrError = await requireAuth(request, env);

  if (userIdOrError instanceof Response) {
    return userIdOrError;
  }

  const stub = getUserDO(env, userIdOrError);

  if (request.method === 'POST') {
    const res = await stub.fetch(
      new Request(`http://internal/sessions/${sessionId}/share`, { method: 'POST' }),
    );
    const body = (await res.json()) as Record<string, unknown>;

    if (!res.ok) {
      return corsJsonWithRetryAfter(body, res);
    }

    // Build the share URL: /share/:sessionId/:token
    const shareUrl = `${new URL(request.url).origin}/share/${sessionId}/${body.token}`;

    return corsJson({ ...body, shareUrl }, { status: 201 });
  }

  if (request.method === 'DELETE') {
    const res = await stub.fetch(
      new Request(`http://internal/sessions/${sessionId}/share`, { method: 'DELETE' }),
    );
    const body = await res.json();

    // Kick all readonly share viewers from the session
    const sessionDOId = env.TERMINAL_SESSION.idFromName(sessionId);
    const sessionStub = env.TERMINAL_SESSION.get(sessionDOId);
    await sessionStub.fetch(new Request('http://internal/kick-readonly', { method: 'POST' }));

    return corsJsonWithRetryAfter(body, res);
  }

  return corsJson({ error: 'Method not allowed' }, { status: 405 });
}

async function validateShareToken(env: Env, token: string, sessionId: string): Promise<boolean> {
  // Look up the session owner from the TerminalSession DO, then validate
  // the share token against that user's DO.
  const sessionDOId = env.TERMINAL_SESSION.idFromName(sessionId);
  const sessionStub = env.TERMINAL_SESSION.get(sessionDOId);

  const ownerRes = await sessionStub.fetch(new Request('http://internal/owner'));

  if (!ownerRes.ok) {
    return false;
  }

  const { owner } = (await ownerRes.json()) as { owner: string | null };

  if (!owner) {
    return false;
  }

  const userStub = getUserDO(env, owner);
  const validateRes = await userStub.fetch(
    new Request('http://internal/validate-share-token', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),
  );

  if (!validateRes.ok) {
    return false;
  }

  const result = (await validateRes.json()) as { valid: boolean; sessionId?: string };

  return result.valid && result.sessionId === sessionId;
}

function serveWebViewer(origin: string, sessionId: string, shareToken: string): Response {
  const wsUrl = origin.replace(/^http/, 'ws');
  const html = buildViewerHtml(wsUrl, sessionId, shareToken);

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      ...SECURITY_HEADERS,
      'X-Frame-Options': 'SAMEORIGIN',
    },
  });
}

// --- WebSocket handlers ---

async function handleWebSocket(request: Request, env: Env, sessionId: string): Promise<Response> {
  const upgradeHeader = request.headers.get('Upgrade');

  if (upgradeHeader !== 'websocket') {
    return corsJson({ error: 'Expected WebSocket' }, { status: 426 });
  }

  const headers = new Headers(request.headers);

  const url = new URL(request.url);
  const shareToken = url.searchParams.get('share_token');

  if (shareToken) {
    // Share token auth — validate via all User DOs (broadcast check)
    const valid = await validateShareToken(env, shareToken, sessionId);

    if (!valid) {
      return corsJson({ error: 'Invalid or expired share token' }, { status: 401 });
    }

    // Mark as readonly share viewer — bypass ownership check
    headers.set('X-Share-Readonly', '1');
  } else {
    // Support both legacy (URL token) and new (first-message) auth flows.
    // Legacy: token in URL query param → validate here, pass userId to DO.
    // New: no URL token → DO handles first-message auth.
    const urlToken = url.searchParams.get('token');

    if (urlToken) {
      const payload = await verifyJWT(urlToken, env.JWT_SECRET);

      if (!payload || payload.type !== 'access') {
        return corsJson({ error: 'Invalid or expired token' }, { status: 401 });
      }

      headers.set('X-User-Id', payload.sub);
    }
  }

  // Always pass JWT secret so DO can handle first-message auth for new clients
  headers.set('X-JWT-Secret', env.JWT_SECRET);

  const id = env.TERMINAL_SESSION.idFromName(sessionId);
  const stub = env.TERMINAL_SESSION.get(id);

  return stub.fetch(new Request('http://internal/ws', { headers }));
}

// --- Web Viewer ---

function buildViewerHtml(wsUrl: string, sessionId: string, shareToken: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>TermPod — Shared Session</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.min.css" integrity="sha384-tStR1zLfWgsiXCF3IgfB3lBa8KmBe/lG287CL9WCeKgQYcp1bjb4/+mwN6oti4Co" crossorigin="anonymous">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { height: 100%; background: #1a1b26; color: #c0caf5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    #app { display: flex; flex-direction: column; height: 100%; }
    #header { display: flex; align-items: center; justify-content: space-between; padding: 8px 16px; background: rgba(255,255,255,0.03); border-bottom: 1px solid rgba(255,255,255,0.06); flex-shrink: 0; }
    #header h1 { font-size: 13px; font-weight: 600; opacity: 0.7; }
    #status { font-size: 11px; padding: 3px 8px; border-radius: 10px; background: rgba(255,255,255,0.06); }
    #status.connected { color: #9ece6a; }
    #status.disconnected { color: #f7768e; }
    #status.connecting { color: #e0af68; }
    #terminal-container { flex: 1; padding: 8px; overflow: hidden; }
    #readonly-banner { text-align: center; padding: 4px; font-size: 11px; color: rgba(255,255,255,0.35); background: rgba(255,255,255,0.02); border-top: 1px solid rgba(255,255,255,0.04); flex-shrink: 0; }
  </style>
</head>
<body>
  <div id="app">
    <div id="header">
      <h1>TermPod</h1>
      <span id="status" class="connecting">Connecting...</span>
    </div>
    <div id="terminal-container"></div>
    <div id="readonly-banner">Read-only session viewer</div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.min.js" integrity="sha384-J4qzUjBl1FxyLsl/kQPQIOeINsmp17OHYXDOMpMxlKX53ZfYsL+aWHpgArvOuof9" crossorigin="anonymous"></script>
  <script src="https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/lib/addon-fit.min.js" integrity="sha384-XGqKrV8Jrukp1NITJbOEHwg01tNkuXr6uB6YEj69ebpYU3v7FvoGgEg23C1Gcehk" crossorigin="anonymous"></script>
  <script>
    (function() {
      var container = document.getElementById('terminal-container');
      var statusEl = document.getElementById('status');

      // Share E2E decryption
      var shareKey = null;
      var recvCounter = 0;
      var sessionId = ${JSON.stringify(sessionId)};

      function base64UrlDecode(str) {
        var padded = str.replace(/-/g, '+').replace(/_/g, '/');
        var binary = atob(padded);
        var bytes = new Uint8Array(binary.length);
        for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
      }

      // Extract key from URL fragment
      var hash = window.location.hash;
      if (hash) {
        var match = hash.match(/key=([A-Za-z0-9_-]+)/);
        if (match) {
          var rawKey = base64UrlDecode(match[1]);
          crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM', length: 256 }, false, ['decrypt'])
            .then(function(k) { shareKey = k; })
            .catch(function() {});
        }
      }

      function decryptShareFrame(data) {
        if (!shareKey || data.length < 13 + 16) return Promise.resolve(null);
        var nonce = data.slice(1, 13);
        var ciphertext = data.slice(13);
        var aad = new TextEncoder().encode(sessionId);
        return crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: nonce, additionalData: aad, tagLength: 128 },
          shareKey, ciphertext
        ).then(function(plain) {
          recvCounter++;
          return new Uint8Array(plain);
        }).catch(function() { return null; });
      }

      var term = new Terminal({
        cursorBlink: false,
        cursorStyle: 'block',
        disableStdin: true,
        fontSize: 14,
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
        theme: {
          background: '#1a1b26',
          foreground: '#c0caf5',
          cursor: '#c0caf5',
          selectionBackground: '#33467c',
          black: '#15161e', red: '#f7768e', green: '#9ece6a', yellow: '#e0af68',
          blue: '#7aa2f7', magenta: '#bb9af7', cyan: '#7dcfff', white: '#a9b1d6',
          brightBlack: '#414868', brightRed: '#f7768e', brightGreen: '#9ece6a',
          brightYellow: '#e0af68', brightBlue: '#7aa2f7', brightMagenta: '#bb9af7',
          brightCyan: '#7dcfff', brightWhite: '#c0caf5',
        },
      });

      var fitAddon = new FitAddon.FitAddon();
      term.loadAddon(fitAddon);
      term.open(container);
      fitAddon.fit();

      window.addEventListener('resize', function() { fitAddon.fit(); });
      new ResizeObserver(function() { fitAddon.fit(); }).observe(container);

      var ws = null;
      var reconnectTimer = null;
      var terminated = false;

      function setStatus(text, cls) {
        statusEl.textContent = text;
        statusEl.className = cls;
      }

      function connect() {
        var url = ${JSON.stringify(wsUrl)} + '/sessions/' + ${JSON.stringify(sessionId)} + '/ws?share_token=' + ${JSON.stringify(shareToken)};
        ws = new WebSocket(url);
        ws.binaryType = 'arraybuffer';

        ws.onopen = function() {
          setStatus('Connected', 'connected');
          ws.send(JSON.stringify({
            type: 'hello',
            clientId: 'share-' + Math.random().toString(36).slice(2, 10),
            role: 'viewer',
            device: 'web',
          }));
        };

        ws.onmessage = function(event) {
          if (event.data instanceof ArrayBuffer) {
            var data = new Uint8Array(event.data);
            if (data[0] === 0xe1) {
              // Share-encrypted frame — decrypt and display
              decryptShareFrame(data).then(function(plain) {
                if (plain) term.write(plain);
              });
            } else if (data[0] === 0x00) {
              // Plaintext terminal data (fallback if no E2E)
              if (!shareKey) term.write(data.slice(1));
            } else if (data[0] === 0x02) {
              // Scrollback chunk: [0x02][offset:4][data]
              term.write(data.slice(5));
            }
          } else {
            try {
              var msg = JSON.parse(event.data);
              if (msg.type === 'pty_resize') {
                term.resize(msg.cols, msg.rows);
              } else if (msg.type === 'session_closed') {
                terminated = true;
                setStatus('Session ended', 'disconnected');
                term.write('\\r\\n  Session has ended.\\r\\n');
              } else if (msg.type === 'share_revoked') {
                terminated = true;
                setStatus('Sharing stopped', 'disconnected');
                term.write('\\r\\n  The session owner has stopped sharing.\\r\\n');
              }
            } catch(e) {}
          }
        };

        ws.onclose = function() {
          if (terminated) return;
          setStatus('Disconnected', 'disconnected');
          scheduleReconnect();
        };

        ws.onerror = function() {
          setStatus('Connection error', 'disconnected');
        };
      }

      function scheduleReconnect() {
        if (reconnectTimer) return;
        reconnectTimer = setTimeout(function() {
          reconnectTimer = null;
          setStatus('Reconnecting...', 'connecting');
          connect();
        }, 3000);
      }

      connect();
    })();
  </script>
</body>
</html>`;
}

function buildExpiredHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>TermPod — Link Expired</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { height: 100%; background: #1a1b26; color: #c0caf5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; display: flex; align-items: center; justify-content: center; }
    .msg { text-align: center; }
    h1 { font-size: 20px; margin-bottom: 8px; }
    p { font-size: 14px; color: rgba(192, 202, 245, 0.5); }
  </style>
</head>
<body>
  <div class="msg">
    <h1>Link Expired</h1>
    <p>This shared session link is no longer valid.</p>
  </div>
</body>
</html>`;
}
