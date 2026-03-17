export function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);

  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function validateToken(provided: string, stored: string): boolean {
  if (provided.length !== stored.length) {
    return false;
  }

  const encoder = new TextEncoder();
  const a = encoder.encode(provided);
  const b = encoder.encode(stored);

  return crypto.subtle.timingSafeEqual(a, b);
}

// Password hashing with PBKDF2

const PBKDF2_ITERATIONS = 100_000;

export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);

  const key = await deriveKey(password, salt);
  const hashBuffer = (await crypto.subtle.exportKey('raw', key)) as ArrayBuffer;

  return {
    hash: bufToHex(new Uint8Array(hashBuffer)),
    salt: bufToHex(salt),
  };
}

export async function verifyPassword(
  password: string,
  storedHash: string,
  storedSalt: string,
): Promise<boolean> {
  const salt = hexToBuf(storedSalt);
  const key = await deriveKey(password, salt);
  const hashBuffer = (await crypto.subtle.exportKey('raw', key)) as ArrayBuffer;
  const computed = bufToHex(new Uint8Array(hashBuffer));

  const encoder = new TextEncoder();

  return crypto.subtle.timingSafeEqual(encoder.encode(computed), encoder.encode(storedHash));
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey'],
  );

  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    true,
    ['sign'],
  );
}

function bufToHex(buf: Uint8Array): string {
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBuf(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);

  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }

  return bytes;
}
