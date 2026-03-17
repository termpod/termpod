import { describe, expect, it } from 'vitest';
import { generateKeyPair, deriveSessionKey, encryptFrame, decryptFrame } from './crypto.js';

describe('generateKeyPair', () => {
  it('generates a valid ECDH P-256 key pair', async () => {
    const kp = await generateKeyPair();

    expect(kp.publicKeyJwk).toBeDefined();
    expect(kp.publicKeyJwk.kty).toBe('EC');
    expect(kp.publicKeyJwk.crv).toBe('P-256');
    expect(kp.publicKeyJwk.x).toBeDefined();
    expect(kp.publicKeyJwk.y).toBeDefined();
    expect(kp.privateKey).toBeDefined();
  });

  it('generates unique key pairs each time', async () => {
    const kp1 = await generateKeyPair();
    const kp2 = await generateKeyPair();

    expect(kp1.publicKeyJwk.x).not.toBe(kp2.publicKeyJwk.x);
  });
});

describe('deriveSessionKey', () => {
  it('derives a session key from two key pairs', async () => {
    const desktop = await generateKeyPair();
    const mobile = await generateKeyPair();

    const session = await deriveSessionKey(
      desktop.privateKey,
      mobile.publicKeyJwk,
      'test-session-id',
    );

    expect(session.key).toBeDefined();
    expect(session.sendCounter).toBe(0);
    expect(session.recvCounter).toBe(0);
    expect(session.sessionId).toBe('test-session-id');
  });

  it('derives the same shared secret from both sides', async () => {
    const desktop = await generateKeyPair();
    const mobile = await generateKeyPair();
    const sessionId = 'shared-session';

    const desktopSession = await deriveSessionKey(
      desktop.privateKey,
      mobile.publicKeyJwk,
      sessionId,
    );

    const mobileSession = await deriveSessionKey(
      mobile.privateKey,
      desktop.publicKeyJwk,
      sessionId,
    );

    // Encrypt with desktop, decrypt with mobile
    const plaintext = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]);
    const encrypted = await encryptFrame(desktopSession, plaintext);
    const decrypted = await decryptFrame(mobileSession, encrypted);

    expect(decrypted).toEqual(plaintext);
  });

  it('includes a 6-digit verification code', async () => {
    const desktop = await generateKeyPair();
    const mobile = await generateKeyPair();

    const session = await deriveSessionKey(desktop.privateKey, mobile.publicKeyJwk, 'verify-test');

    expect(session.verificationCode).toBeDefined();
    expect(session.verificationCode).toMatch(/^\d{6}$/);
  });

  it('both peers derive the same verification code', async () => {
    const desktop = await generateKeyPair();
    const mobile = await generateKeyPair();
    const sessionId = 'verify-match';

    const desktopSession = await deriveSessionKey(
      desktop.privateKey,
      mobile.publicKeyJwk,
      sessionId,
    );

    const mobileSession = await deriveSessionKey(
      mobile.privateKey,
      desktop.publicKeyJwk,
      sessionId,
    );

    expect(desktopSession.verificationCode).toBe(mobileSession.verificationCode);
  });

  it('different sessions produce different verification codes', async () => {
    const desktop = await generateKeyPair();
    const mobile = await generateKeyPair();

    const session1 = await deriveSessionKey(
      desktop.privateKey,
      mobile.publicKeyJwk,
      'session-alpha',
    );

    const session2 = await deriveSessionKey(
      desktop.privateKey,
      mobile.publicKeyJwk,
      'session-beta',
    );

    expect(session1.verificationCode).not.toBe(session2.verificationCode);
  });

  it('different key pairs produce different verification codes', async () => {
    const desktop1 = await generateKeyPair();
    const mobile1 = await generateKeyPair();
    const desktop2 = await generateKeyPair();
    const mobile2 = await generateKeyPair();

    const session1 = await deriveSessionKey(
      desktop1.privateKey,
      mobile1.publicKeyJwk,
      'same-session-id',
    );

    const session2 = await deriveSessionKey(
      desktop2.privateKey,
      mobile2.publicKeyJwk,
      'same-session-id',
    );

    expect(session1.verificationCode).not.toBe(session2.verificationCode);
  });

  it('produces different keys for different session IDs', async () => {
    const desktop = await generateKeyPair();
    const mobile = await generateKeyPair();

    const session1 = await deriveSessionKey(desktop.privateKey, mobile.publicKeyJwk, 'session-1');

    const session2 = await deriveSessionKey(desktop.privateKey, mobile.publicKeyJwk, 'session-2');

    // Encrypt with session1, try to decrypt with session2 — should fail
    const plaintext = new Uint8Array([0x01, 0x02, 0x03]);
    const encrypted = await encryptFrame(session1, plaintext);

    await expect(decryptFrame(session2, encrypted)).rejects.toThrow();
  });
});

describe('encryptFrame / decryptFrame', () => {
  async function createSessionPair() {
    const desktop = await generateKeyPair();
    const mobile = await generateKeyPair();
    const sessionId = `session-${Date.now()}`;

    const desktopSession = await deriveSessionKey(
      desktop.privateKey,
      mobile.publicKeyJwk,
      sessionId,
    );

    const mobileSession = await deriveSessionKey(
      mobile.privateKey,
      desktop.publicKeyJwk,
      sessionId,
    );

    return { desktopSession, mobileSession };
  }

  it('round-trips terminal data', async () => {
    const { desktopSession, mobileSession } = await createSessionPair();
    const plaintext = new Uint8Array([0x00, 0x48, 0x65, 0x6c, 0x6c, 0x6f]); // [channel][data]

    const encrypted = await encryptFrame(desktopSession, plaintext);
    const decrypted = await decryptFrame(mobileSession, encrypted);

    expect(decrypted).toEqual(plaintext);
  });

  it('encrypted output is larger than plaintext (nonce + tag)', async () => {
    const { desktopSession } = await createSessionPair();
    const plaintext = new Uint8Array([0x00, 0x41, 0x42]);

    const encrypted = await encryptFrame(desktopSession, plaintext);

    // nonce (12) + ciphertext (3) + tag (16) = 31
    expect(encrypted.length).toBe(12 + plaintext.length + 16);
  });

  it('produces different ciphertext for same plaintext (counter nonce)', async () => {
    const { desktopSession, mobileSession } = await createSessionPair();
    const plaintext = new Uint8Array([0x00, 0x41]);

    const enc1 = await encryptFrame(desktopSession, plaintext);
    const enc2 = await encryptFrame(desktopSession, plaintext);

    // Different nonces → different ciphertext
    expect(enc1).not.toEqual(enc2);

    // Both should decrypt correctly
    const dec1 = await decryptFrame(mobileSession, enc1);
    const dec2 = await decryptFrame(mobileSession, enc2);

    expect(dec1).toEqual(plaintext);
    expect(dec2).toEqual(plaintext);
  });

  it('handles empty plaintext', async () => {
    const { desktopSession, mobileSession } = await createSessionPair();
    const plaintext = new Uint8Array(0);

    const encrypted = await encryptFrame(desktopSession, plaintext);
    const decrypted = await decryptFrame(mobileSession, encrypted);

    expect(decrypted).toEqual(plaintext);
  });

  it('handles large payloads', async () => {
    const { desktopSession, mobileSession } = await createSessionPair();
    const plaintext = new Uint8Array(64 * 1024);
    plaintext.fill(0xab);

    const encrypted = await encryptFrame(desktopSession, plaintext);
    const decrypted = await decryptFrame(mobileSession, encrypted);

    expect(decrypted).toEqual(plaintext);
  });

  it('rejects tampered ciphertext', async () => {
    const { desktopSession, mobileSession } = await createSessionPair();
    const plaintext = new Uint8Array([0x00, 0x48, 0x69]);

    const encrypted = await encryptFrame(desktopSession, plaintext);

    // Tamper with a byte in the ciphertext portion (after nonce)
    encrypted[15] ^= 0xff;

    await expect(decryptFrame(mobileSession, encrypted)).rejects.toThrow();
  });

  it('rejects frame that is too short', async () => {
    const { mobileSession } = await createSessionPair();
    const tooShort = new Uint8Array(20); // Less than nonce (12) + tag (16)

    await expect(decryptFrame(mobileSession, tooShort)).rejects.toThrow(
      'Encrypted frame too short',
    );
  });

  it('increments send counter', async () => {
    const { desktopSession } = await createSessionPair();

    expect(desktopSession.sendCounter).toBe(0);

    await encryptFrame(desktopSession, new Uint8Array([1]));
    expect(desktopSession.sendCounter).toBe(1);

    await encryptFrame(desktopSession, new Uint8Array([2]));
    expect(desktopSession.sendCounter).toBe(2);
  });

  it('increments recv counter', async () => {
    const { desktopSession, mobileSession } = await createSessionPair();

    expect(mobileSession.recvCounter).toBe(0);

    const enc1 = await encryptFrame(desktopSession, new Uint8Array([1]));
    await decryptFrame(mobileSession, enc1);
    expect(mobileSession.recvCounter).toBe(1);

    const enc2 = await encryptFrame(desktopSession, new Uint8Array([2]));
    await decryptFrame(mobileSession, enc2);
    expect(mobileSession.recvCounter).toBe(2);
  });

  it('bidirectional encryption works', async () => {
    const { desktopSession, mobileSession } = await createSessionPair();

    // Desktop → Mobile
    const msg1 = new Uint8Array([0x00, 0x41]); // terminal data "A"
    const enc1 = await encryptFrame(desktopSession, msg1);
    const dec1 = await decryptFrame(mobileSession, enc1);
    expect(dec1).toEqual(msg1);

    // Mobile → Desktop
    const msg2 = new Uint8Array([0x00, 0x42]); // terminal input "B"
    const enc2 = await encryptFrame(mobileSession, msg2);
    const dec2 = await decryptFrame(desktopSession, enc2);
    expect(dec2).toEqual(msg2);
  });

  it('rejects replayed frames', async () => {
    const { desktopSession, mobileSession } = await createSessionPair();

    const plaintext = new Uint8Array([0x00, 0x41]);
    const encrypted = await encryptFrame(desktopSession, plaintext);

    // First decrypt succeeds
    await decryptFrame(mobileSession, encrypted);

    // Replaying the same frame should fail
    await expect(decryptFrame(mobileSession, encrypted)).rejects.toThrow('Replayed frame');
  });

  it('rejects frames with older counter', async () => {
    const { desktopSession, mobileSession } = await createSessionPair();

    const enc1 = await encryptFrame(desktopSession, new Uint8Array([1]));
    const enc2 = await encryptFrame(desktopSession, new Uint8Array([2]));

    // Decrypt frame 2 first (counter 1)
    await decryptFrame(mobileSession, enc2);

    // Frame 1 (counter 0) should be rejected — counter < recvCounter
    await expect(decryptFrame(mobileSession, enc1)).rejects.toThrow('Replayed frame');
  });

  it('accepts frames with gaps in counter', async () => {
    const { desktopSession, mobileSession } = await createSessionPair();

    const enc1 = await encryptFrame(desktopSession, new Uint8Array([1]));
    await encryptFrame(desktopSession, new Uint8Array([2])); // skip this one
    const enc3 = await encryptFrame(desktopSession, new Uint8Array([3]));

    // Decrypt frame 1
    await decryptFrame(mobileSession, enc1);

    // Skip frame 2, decrypt frame 3 — should succeed (counter 2 >= recvCounter 1)
    const dec3 = await decryptFrame(mobileSession, enc3);
    expect(dec3).toEqual(new Uint8Array([3]));
  });
});
