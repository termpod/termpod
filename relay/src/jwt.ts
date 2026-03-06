const ALGORITHM = { name: 'HMAC', hash: 'SHA-256' };
const TOKEN_EXPIRY = 15 * 60; // 15 minutes
const REFRESH_EXPIRY = 30 * 24 * 60 * 60; // 30 days

interface JWTPayload {
  sub: string; // userId (email)
  iat: number;
  exp: number;
  type: 'access' | 'refresh';
}

function base64url(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const str = btoa(String.fromCharCode(...bytes));

  return str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

async function getKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder();

  return crypto.subtle.importKey('raw', enc.encode(secret), ALGORITHM, false, ['sign', 'verify']);
}

export async function signJWT(
  userId: string,
  secret: string,
  type: 'access' | 'refresh' = 'access',
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + (type === 'access' ? TOKEN_EXPIRY : REFRESH_EXPIRY);

  const header = base64url(new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const payload = base64url(
    new TextEncoder().encode(JSON.stringify({ sub: userId, iat: now, exp, type })),
  );

  const data = `${header}.${payload}`;
  const key = await getKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));

  return `${data}.${base64url(sig)}`;
}

export async function verifyJWT(
  token: string,
  secret: string,
): Promise<JWTPayload | null> {
  const parts = token.split('.');

  if (parts.length !== 3) {
    return null;
  }

  const [header, payload, signature] = parts;
  const key = await getKey(secret);

  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    base64urlDecode(signature),
    new TextEncoder().encode(`${header}.${payload}`),
  );

  if (!valid) {
    return null;
  }

  const decoded = JSON.parse(new TextDecoder().decode(base64urlDecode(payload))) as JWTPayload;

  if (decoded.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }

  return decoded;
}
