/**
 * E2E encryption for share viewers.
 *
 * The desktop generates a random AES-256-GCM key and includes it in the
 * share URL fragment (#key=base64url). The relay never sees the fragment,
 * so it cannot decrypt share-encrypted frames (channel 0xE1).
 *
 * Frame format: [0xE1][nonce:12][ciphertext+tag]
 * Nonce: counter-based (monotonically increasing)
 * AAD: session ID (UTF-8)
 */

const NONCE_SIZE = 12;
const TAG_SIZE = 16;

const subtle = globalThis.crypto.subtle;
const encoder = new TextEncoder();

export interface ShareCryptoSession {
  key: CryptoKey;
  sendCounter: number;
  recvCounter: number;
  sessionId: string;
}

export async function generateShareKey(): Promise<{ key: CryptoKey; keyBase64: string }> {
  const key = await subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );

  const rawKey = await subtle.exportKey('raw', key);
  const keyBase64 = base64UrlEncode(new Uint8Array(rawKey));

  return { key, keyBase64 };
}

export async function importShareKey(keyBase64: string): Promise<CryptoKey> {
  const rawKey = base64UrlDecode(keyBase64);

  return subtle.importKey(
    'raw',
    rawKey as Uint8Array<ArrayBuffer>,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export function createShareCryptoSession(key: CryptoKey, sessionId: string): ShareCryptoSession {
  return { key, sendCounter: 0, recvCounter: 0, sessionId };
}

function counterToNonce(counter: number): Uint8Array {
  const nonce = new Uint8Array(NONCE_SIZE);
  const view = new DataView(nonce.buffer);
  view.setUint32(4, Math.floor(counter / 0x100000000), false);
  view.setUint32(8, counter >>> 0, false);

  return nonce;
}

function nonceToCounter(nonce: Uint8Array): number {
  const view = new DataView(nonce.buffer, nonce.byteOffset, nonce.byteLength);
  const high = view.getUint32(4, false);
  const low = view.getUint32(8, false);

  return high * 0x100000000 + low;
}

export async function encryptShareFrame(
  session: ShareCryptoSession,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  const nonce = counterToNonce(session.sendCounter++);
  const aad = encoder.encode(session.sessionId);

  const ciphertext = await subtle.encrypt(
    { name: 'AES-GCM', iv: nonce as Uint8Array<ArrayBuffer>, additionalData: aad, tagLength: TAG_SIZE * 8 },
    session.key,
    plaintext as Uint8Array<ArrayBuffer>,
  );

  const result = new Uint8Array(NONCE_SIZE + ciphertext.byteLength);
  result.set(nonce, 0);
  result.set(new Uint8Array(ciphertext), NONCE_SIZE);

  return result;
}

export async function decryptShareFrame(
  session: ShareCryptoSession,
  encrypted: Uint8Array,
): Promise<Uint8Array> {
  if (encrypted.length < NONCE_SIZE + TAG_SIZE) {
    throw new Error('Share-encrypted frame too short');
  }

  const nonce = encrypted.subarray(0, NONCE_SIZE);
  const ciphertext = encrypted.subarray(NONCE_SIZE);
  const receivedCounter = nonceToCounter(nonce);

  if (receivedCounter < session.recvCounter) {
    throw new Error(`Replayed share frame: counter ${receivedCounter}, expected >= ${session.recvCounter}`);
  }

  const aad = encoder.encode(session.sessionId);

  const plaintext = await subtle.decrypt(
    { name: 'AES-GCM', iv: nonce as Uint8Array<ArrayBuffer>, additionalData: aad, tagLength: TAG_SIZE * 8 },
    session.key,
    ciphertext as Uint8Array<ArrayBuffer>,
  );

  session.recvCounter = receivedCounter + 1;

  return new Uint8Array(plaintext);
}

function base64UrlEncode(data: Uint8Array): string {
  const str = String.fromCharCode(...data);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}
