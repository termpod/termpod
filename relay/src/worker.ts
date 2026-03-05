import { generateToken } from './auth';

export { TerminalSession } from './session';

interface Env {
  TERMINAL_SESSION: DurableObjectNamespace;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function corsJson(data: unknown, init?: ResponseInit): Response {
  const res = Response.json(data, init);

  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    res.headers.set(k, v);
  }

  return res;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    if (url.pathname === '/sessions' && request.method === 'POST') {
      return handleCreateSession(request, env);
    }

    if (url.pathname === '/sessions' && request.method === 'GET') {
      return handleListSessions(request, env);
    }

    const wsMatch = url.pathname.match(/^\/sessions\/([^/]+)\/ws$/);

    if (wsMatch) {
      return handleWebSocket(request, env, wsMatch[1]);
    }

    if (url.pathname === '/auth/pair' && request.method === 'POST') {
      return handlePair(request, env);
    }

    return new Response('Not found', { status: 404 });
  },
};

async function handleCreateSession(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as { name?: string; ptySize?: { cols: number; rows: number } };
  const sessionId = crypto.randomUUID();
  const token = generateToken();

  return corsJson(
    {
      sessionId,
      token,
      tokenExpiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      wsUrl: `wss://relay.termpod.dev/sessions/${sessionId}/ws`,
    },
    { status: 201 },
  );
}

async function handleListSessions(_request: Request, _env: Env): Promise<Response> {
  // TODO: Implement session listing with storage
  return corsJson({ sessions: [] });
}

async function handleWebSocket(request: Request, env: Env, sessionId: string): Promise<Response> {
  const upgradeHeader = request.headers.get('Upgrade');

  if (upgradeHeader !== 'websocket') {
    return new Response('Expected WebSocket', { status: 426 });
  }

  const id = env.TERMINAL_SESSION.idFromName(sessionId);
  const stub = env.TERMINAL_SESSION.get(id);

  return stub.fetch(new Request(`http://internal/ws`, { headers: request.headers }));
}

async function handlePair(request: Request, _env: Env): Promise<Response> {
  // TODO: Implement token validation
  const body = (await request.json()) as { token: string };

  return corsJson({
    sessionId: 'placeholder',
    viewerToken: generateToken(),
    wsUrl: 'wss://relay.termpod.dev/sessions/placeholder/ws',
  });
}
