export interface RequestRateLimitRule {
  key: string;
  max: number;
  windowMs: number;
}

const MINUTE = 60_000;
const FIVE_MINUTES = 5 * MINUTE;

const userRoutePolicies: Array<{
  match: (path: string, method: string) => boolean;
  rule: RequestRateLimitRule;
}> = [
  {
    match: (path, method) => path === '/signup' && method === 'POST',
    rule: { key: 'auth.signup', max: 5, windowMs: FIVE_MINUTES },
  },
  {
    match: (path, method) => path === '/login' && method === 'POST',
    rule: { key: 'auth.login', max: 20, windowMs: FIVE_MINUTES },
  },
  {
    match: (path, method) => path === '/devices' && method === 'GET',
    rule: { key: 'devices.list', max: 120, windowMs: MINUTE },
  },
  {
    match: (path, method) => path === '/devices' && method === 'POST',
    rule: { key: 'devices.register', max: 20, windowMs: MINUTE },
  },
  {
    match: (path, method) => /^\/devices\/[^/]+\/heartbeat$/.test(path) && method === 'POST',
    rule: { key: 'devices.heartbeat', max: 20, windowMs: MINUTE },
  },
  {
    match: (path, method) => /^\/devices\/[^/]+\/offline$/.test(path) && method === 'POST',
    rule: { key: 'devices.offline', max: 20, windowMs: MINUTE },
  },
  {
    match: (path, method) => /^\/devices\/[^/]+\/ws$/.test(path),
    rule: { key: 'devices.ws', max: 30, windowMs: MINUTE },
  },
  {
    match: (path, method) => /^\/devices\/[^/]+\/sessions$/.test(path) && method === 'GET',
    rule: { key: 'sessions.list', max: 120, windowMs: MINUTE },
  },
  {
    match: (path, method) => /^\/devices\/[^/]+\/sessions$/.test(path) && method === 'POST',
    rule: { key: 'sessions.register', max: 60, windowMs: MINUTE },
  },
  {
    match: (path, method) =>
      /^\/sessions\/[^/]+$/.test(path) && (method === 'DELETE' || method === 'PATCH'),
    rule: { key: 'sessions.mutate', max: 60, windowMs: MINUTE },
  },
  {
    match: (path, method) => /^\/devices\/[^/]+\/request-session$/.test(path) && method === 'POST',
    rule: { key: 'sessions.request', max: 30, windowMs: MINUTE },
  },
  {
    match: (path, method) => /^\/devices\/[^/]+\/pending-requests$/.test(path) && method === 'GET',
    rule: { key: 'sessions.pending.list', max: 120, windowMs: MINUTE },
  },
  {
    match: (path, method) =>
      /^\/devices\/[^/]+\/pending-requests$/.test(path) && method === 'DELETE',
    rule: { key: 'sessions.pending.clear', max: 30, windowMs: MINUTE },
  },
  {
    match: (path, method) =>
      /^\/sessions\/[^/]+\/share$/.test(path) && (method === 'POST' || method === 'DELETE'),
    rule: { key: 'sessions.share', max: 20, windowMs: MINUTE },
  },
  {
    match: (path, method) => path === '/validate-share-token' && method === 'POST',
    rule: { key: 'share.validate', max: 240, windowMs: MINUTE },
  },
  {
    match: (path, method) => path === '/check-session-access' && method === 'POST',
    rule: { key: 'sessions.access', max: 240, windowMs: MINUTE },
  },
  {
    match: (path, method) => path === '/exists' && method === 'GET',
    rule: { key: 'auth.exists', max: 120, windowMs: MINUTE },
  },
  {
    match: (path, method) => path === '/subscription' && method === 'GET',
    rule: { key: 'subscription.get', max: 60, windowMs: MINUTE },
  },
];

const internalPolicies: Record<string, RequestRateLimitRule> = {
  'auth.refresh': { key: 'auth.refresh', max: 12, windowMs: MINUTE },
  'auth.forgot_password': { key: 'auth.forgot_password', max: 1, windowMs: MINUTE },
  'turn.credentials': { key: 'turn.credentials', max: 6, windowMs: MINUTE },
};

export function getUserRouteRateLimitRule(
  path: string,
  method: string,
): RequestRateLimitRule | null {
  const normalizedMethod = method.toUpperCase();

  for (const policy of userRoutePolicies) {
    if (policy.match(path, normalizedMethod)) {
      return policy.rule;
    }
  }

  return null;
}

export function getInternalRateLimitRule(name: string): RequestRateLimitRule | null {
  return internalPolicies[name] ?? null;
}

export function getTerminalSessionRouteRateLimitRule(
  path: string,
  method: string,
): RequestRateLimitRule | null {
  if (path === '/ws' && method.toUpperCase() === 'GET') {
    return { key: 'session.ws', max: 30, windowMs: MINUTE };
  }

  return null;
}
