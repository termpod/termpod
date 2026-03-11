/**
 * E2E encryption for relay transport.
 *
 * Key exchange: ECDH P-256 (Web Crypto API)
 * KDF: HKDF-SHA256 with session ID as info
 * Cipher: AES-256-GCM with counter-based nonces
 *
 * Works in browser, Node 20+, Cloudflare Workers, and Deno.
 */

const NONCE_SIZE = 12;
const TAG_SIZE = 16;
const HKDF_INFO_PREFIX = 'termpod-e2e-';
const VERIFY_INFO_PREFIX = 'termpod-verify-';

const subtle = globalThis.crypto.subtle;
const encoder = new TextEncoder();

export interface E2EKeyPair {
  publicKeyJwk: JsonWebKey;
  privateKey: CryptoKey;
}

export interface E2ESession {
  key: CryptoKey;
  sendCounter: number;
  recvCounter: number;
  sessionId: string;
  verificationCode: string;
}

export async function generateKeyPair(): Promise<E2EKeyPair> {
  const keyPair = await subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  );

  const publicKeyJwk = await subtle.exportKey('jwk', keyPair.publicKey);

  return { publicKeyJwk, privateKey: keyPair.privateKey };
}

export async function deriveSessionKey(
  privateKey: CryptoKey,
  peerPublicKeyJwk: JsonWebKey,
  sessionId: string,
): Promise<E2ESession> {
  const peerPublicKey = await subtle.importKey(
    'jwk',
    peerPublicKeyJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );

  const sharedBits = await subtle.deriveBits(
    { name: 'ECDH', public: peerPublicKey },
    privateKey,
    256,
  );

  // Import shared bits as HKDF base key
  const hkdfKey = await subtle.importKey(
    'raw',
    sharedBits,
    'HKDF',
    false,
    ['deriveKey'],
  );

  // Derive AES-256-GCM key with session ID as context
  const aesKey = await subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(32), // Zero salt — ECDH output is already high-entropy
      info: encoder.encode(`${HKDF_INFO_PREFIX}${sessionId}`),
    },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );

  // Derive verification code from shared secret (separate HKDF info)
  // Both peers get the same code — mismatch indicates MITM
  const hkdfKeyForVerify = await subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveBits']);
  const verifyBits = await subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(32),
      info: encoder.encode(`${VERIFY_INFO_PREFIX}${sessionId}`),
    },
    hkdfKeyForVerify,
    64,
  );
  const verifyNum = new DataView(verifyBits).getUint32(0, false);
  const verificationCode = String(verifyNum % 1_000_000).padStart(6, '0');

  return { key: aesKey, sendCounter: 0, recvCounter: 0, sessionId, verificationCode };
}

function counterToNonce(counter: number): Uint8Array {
  const nonce = new Uint8Array(NONCE_SIZE);
  const view = new DataView(nonce.buffer);
  // Store counter in last 8 bytes (big-endian), first 4 bytes are zero
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

export async function encryptFrame(
  session: E2ESession,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  const nonce = counterToNonce(session.sendCounter++);
  const aad = encoder.encode(session.sessionId);

  const ciphertext = await subtle.encrypt(
    { name: 'AES-GCM', iv: nonce as Uint8Array<ArrayBuffer>, additionalData: aad, tagLength: TAG_SIZE * 8 },
    session.key,
    plaintext as Uint8Array<ArrayBuffer>,
  );

  // [nonce:12][ciphertext+tag]
  const result = new Uint8Array(NONCE_SIZE + ciphertext.byteLength);
  result.set(nonce, 0);
  result.set(new Uint8Array(ciphertext), NONCE_SIZE);

  return result;
}

export async function decryptFrame(
  session: E2ESession,
  encrypted: Uint8Array,
): Promise<Uint8Array> {
  if (encrypted.length < NONCE_SIZE + TAG_SIZE) {
    throw new Error('Encrypted frame too short');
  }

  const nonce = encrypted.subarray(0, NONCE_SIZE);
  const ciphertext = encrypted.subarray(NONCE_SIZE);

  // Validate nonce matches expected counter (replay protection)
  const receivedCounter = nonceToCounter(nonce);

  if (receivedCounter < session.recvCounter) {
    throw new Error(`Replayed frame: received counter ${receivedCounter}, expected >= ${session.recvCounter}`);
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

