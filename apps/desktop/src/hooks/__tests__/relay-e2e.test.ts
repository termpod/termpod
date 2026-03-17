import { describe, expect, it } from 'vitest';
import {
  generateKeyPair,
  deriveSessionKey,
  encryptFrame,
  decryptFrame,
  encodeTerminalData,
  encodeTerminalResize,
  decodeBinaryFrame,
  Channel,
} from '@termpod/protocol';
import type { E2ESession } from '@termpod/protocol';

/**
 * Simulates the desktop + viewer E2E session setup:
 * 1. Both sides generate ECDH key pairs
 * 2. Exchange public keys (via key_exchange / key_exchange_ack messages)
 * 3. Both derive the same AES-256-GCM session key
 */
async function createE2ESessionPair(sessionId: string) {
  const desktop = await generateKeyPair();
  const viewer = await generateKeyPair();

  const desktopSession = await deriveSessionKey(desktop.privateKey, viewer.publicKeyJwk, sessionId);

  const viewerSession = await deriveSessionKey(viewer.privateKey, desktop.publicKeyJwk, sessionId);

  return { desktop, viewer, desktopSession, viewerSession };
}

/**
 * Wraps an encrypted payload in the 0xE0 frame format, matching
 * what sendTerminalData / sendResize produce.
 */
function wrapEncryptedFrame(encrypted: Uint8Array): Uint8Array {
  const frame = new Uint8Array(1 + encrypted.length);
  frame[0] = Channel.ENCRYPTED;
  frame.set(encrypted, 1);

  return frame;
}

describe('E2E key exchange flow simulation', () => {
  it('completes full key exchange and encrypts/decrypts terminal data', async () => {
    const sessionId = 'test-session-001';

    // Step 1: Desktop generates key pair (happens on auth_ok)
    const desktopKP = await generateKeyPair();

    // Step 2: Desktop sends key_exchange message
    const keyExchangeMsg = {
      type: 'key_exchange',
      publicKey: desktopKP.publicKeyJwk,
      sessionId,
    };
    expect(keyExchangeMsg.type).toBe('key_exchange');
    expect(keyExchangeMsg.publicKey.kty).toBe('EC');
    expect(keyExchangeMsg.publicKey.crv).toBe('P-256');

    // Step 3: Viewer generates key pair and sends key_exchange_ack
    const viewerKP = await generateKeyPair();
    const keyExchangeAck = {
      type: 'key_exchange_ack',
      publicKey: viewerKP.publicKeyJwk,
    };

    // Step 4: Desktop receives ack and derives session key
    const desktopSession = await deriveSessionKey(
      desktopKP.privateKey,
      keyExchangeAck.publicKey,
      sessionId,
    );

    // Step 5: Viewer also derives session key
    const viewerSession = await deriveSessionKey(
      viewerKP.privateKey,
      keyExchangeMsg.publicKey,
      sessionId,
    );

    // Step 6: Desktop encrypts terminal data, viewer decrypts
    const termData = new TextEncoder().encode('ls -la\r\n');
    const plainFrame = encodeTerminalData(termData);
    const encrypted = await encryptFrame(desktopSession, plainFrame);
    const decrypted = await decryptFrame(viewerSession, encrypted);

    expect(decrypted).toEqual(plainFrame);

    // Verify the inner frame decodes correctly
    const decoded = decodeBinaryFrame(decrypted);
    expect(decoded.channel).toBe(Channel.TERMINAL_DATA);

    if (decoded.channel === Channel.TERMINAL_DATA) {
      expect(new TextDecoder().decode(decoded.data)).toBe('ls -la\r\n');
    }
  });

  it('viewer input round-trips through E2E encryption', async () => {
    const { desktopSession, viewerSession } = await createE2ESessionPair('input-test');

    // Viewer sends encrypted input to desktop
    const input = new TextEncoder().encode('cd /home\n');
    const plainFrame = encodeTerminalData(input);
    const encrypted = await encryptFrame(viewerSession, plainFrame);
    const decrypted = await decryptFrame(desktopSession, encrypted);

    const decoded = decodeBinaryFrame(decrypted);
    expect(decoded.channel).toBe(Channel.TERMINAL_DATA);

    if (decoded.channel === Channel.TERMINAL_DATA) {
      expect(new TextDecoder().decode(decoded.data)).toBe('cd /home\n');
    }
  });
});

describe('encrypted terminal data frame wrapping', () => {
  it('produces [0xE0][encrypted] frame format for terminal data', async () => {
    const { desktopSession } = await createE2ESessionPair('wrap-test');

    const termData = new Uint8Array([0x41, 0x42, 0x43]); // "ABC"
    const plainFrame = encodeTerminalData(termData);
    const encrypted = await encryptFrame(desktopSession, plainFrame);

    // Simulate what sendTerminalData does
    const wsFrame = wrapEncryptedFrame(encrypted);

    expect(wsFrame[0]).toBe(Channel.ENCRYPTED);
    expect(wsFrame[0]).toBe(0xe0);
    expect(wsFrame.length).toBe(1 + encrypted.length);

    // The encrypted portion starts at byte 1
    expect(wsFrame.subarray(1)).toEqual(encrypted);
  });

  it('decodeBinaryFrame parses the 0xE0 wrapper correctly', async () => {
    const { desktopSession } = await createE2ESessionPair('decode-wrap-test');

    const plainFrame = encodeTerminalData(new Uint8Array([0x48, 0x69]));
    const encrypted = await encryptFrame(desktopSession, plainFrame);
    const wsFrame = wrapEncryptedFrame(encrypted);

    const decoded = decodeBinaryFrame(wsFrame);
    expect(decoded.channel).toBe(Channel.ENCRYPTED);

    if (decoded.channel === Channel.ENCRYPTED) {
      // nonce is first 12 bytes of the encrypted payload
      expect(decoded.nonce.length).toBe(12);
      // ciphertext follows the nonce
      expect(decoded.ciphertext.length).toBeGreaterThan(0);
    }
  });
});

describe('encrypted resize frame wrapping', () => {
  it('produces [0xE0][encrypted] frame format for resize', async () => {
    const { desktopSession, viewerSession } = await createE2ESessionPair('resize-test');

    const resizeFrame = encodeTerminalResize(120, 40);
    const encrypted = await encryptFrame(desktopSession, resizeFrame);
    const wsFrame = wrapEncryptedFrame(encrypted);

    expect(wsFrame[0]).toBe(Channel.ENCRYPTED);

    // Viewer decrypts the inner payload
    const decrypted = await decryptFrame(viewerSession, wsFrame.subarray(1));
    const decoded = decodeBinaryFrame(decrypted);

    expect(decoded.channel).toBe(Channel.TERMINAL_RESIZE);

    if (decoded.channel === Channel.TERMINAL_RESIZE) {
      expect(decoded.cols).toBe(120);
      expect(decoded.rows).toBe(40);
    }
  });
});

describe('decrypting incoming 0xE0 frames', () => {
  it('simulates ws.onmessage handling of encrypted viewer input', async () => {
    const { desktopSession, viewerSession } = await createE2ESessionPair('onmessage-test');

    // Viewer encrypts terminal input and wraps in 0xE0 frame
    const input = new TextEncoder().encode('q');
    const plainFrame = encodeTerminalData(input);
    const encrypted = await encryptFrame(viewerSession, plainFrame);
    const wsFrame = wrapEncryptedFrame(encrypted);

    // Simulate desktop's onmessage handler:
    // 1. Check if first byte is 0xE0
    const raw = wsFrame;
    expect(raw[0]).toBe(Channel.ENCRYPTED);

    // 2. Strip the 0xE0 channel byte and decrypt
    const decrypted = await decryptFrame(desktopSession, raw.subarray(1));

    // 3. Decode inner frame
    const inner = decodeBinaryFrame(decrypted);
    expect(inner.channel).toBe(Channel.TERMINAL_DATA);

    if (inner.channel === Channel.TERMINAL_DATA) {
      const text = new TextDecoder().decode(inner.data);
      expect(text).toBe('q');
    }
  });

  it('handles encrypted resize from viewer', async () => {
    const { desktopSession, viewerSession } = await createE2ESessionPair('resize-recv-test');

    const resizeFrame = encodeTerminalResize(80, 24);
    const encrypted = await encryptFrame(viewerSession, resizeFrame);
    const wsFrame = wrapEncryptedFrame(encrypted);

    // Desktop decrypts
    const decrypted = await decryptFrame(desktopSession, wsFrame.subarray(1));
    const inner = decodeBinaryFrame(decrypted);

    expect(inner.channel).toBe(Channel.TERMINAL_RESIZE);

    if (inner.channel === Channel.TERMINAL_RESIZE) {
      expect(inner.cols).toBe(80);
      expect(inner.rows).toBe(24);
    }
  });
});

describe('unencrypted fallback when no E2E session', () => {
  it('sends plain terminal data when e2eRef is null', () => {
    const e2eSession: E2ESession | null = null;
    const data = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]);
    const plainFrame = encodeTerminalData(data);

    // When e2eRef.current is null, sendTerminalData sends the plain frame
    if (e2eSession) {
      // This branch would encrypt — should not execute
      expect.unreachable('Should not reach encryption branch');
    }

    // Plain frame has channel byte + data
    expect(plainFrame[0]).toBe(Channel.TERMINAL_DATA);
    expect(plainFrame.subarray(1)).toEqual(data);
  });

  it('sends plain resize when e2eRef is null', () => {
    const e2eSession: E2ESession | null = null;
    const plainFrame = encodeTerminalResize(100, 30);

    if (e2eSession) {
      expect.unreachable('Should not reach encryption branch');
    }

    expect(plainFrame[0]).toBe(Channel.TERMINAL_RESIZE);

    const view = new DataView(plainFrame.buffer);
    expect(view.getUint16(1, false)).toBe(100);
    expect(view.getUint16(3, false)).toBe(30);
  });
});

describe('E2E state reset on disconnect', () => {
  it('clearing e2eRef and e2eKeyPairRef prevents encryption', async () => {
    const { desktopSession } = await createE2ESessionPair('disconnect-test');

    // Simulate active session
    let e2eRef: E2ESession | null = desktopSession;
    let e2eKeyPairRef: { publicKeyJwk: JsonWebKey; privateKey: CryptoKey } | null = {
      publicKeyJwk: { kty: 'EC' },
      privateKey: desktopSession.key,
    };

    expect(e2eRef).not.toBeNull();
    expect(e2eKeyPairRef).not.toBeNull();

    // Simulate disconnect() — clears both refs
    e2eRef = null;
    e2eKeyPairRef = null;

    expect(e2eRef).toBeNull();
    expect(e2eKeyPairRef).toBeNull();

    // After disconnect, data should be sent unencrypted (plain frame)
    const data = new Uint8Array([0x41]);
    const frame = e2eRef
      ? await encryptFrame(e2eRef, encodeTerminalData(data))
      : encodeTerminalData(data);

    expect(frame[0]).toBe(Channel.TERMINAL_DATA);
  });
});

describe('key_exchange message format', () => {
  it('matches the expected JSON structure for relay', async () => {
    const kp = await generateKeyPair();
    const sessionId = 'abc-123-def';

    const msg = {
      type: 'key_exchange',
      publicKey: kp.publicKeyJwk,
      sessionId,
    };

    // Verify structure
    expect(msg).toHaveProperty('type', 'key_exchange');
    expect(msg).toHaveProperty('sessionId', sessionId);
    expect(msg.publicKey).toHaveProperty('kty', 'EC');
    expect(msg.publicKey).toHaveProperty('crv', 'P-256');
    expect(msg.publicKey).toHaveProperty('x');
    expect(msg.publicKey).toHaveProperty('y');

    // Verify it serializes to valid JSON
    const json = JSON.stringify(msg);
    const parsed = JSON.parse(json);
    expect(parsed.type).toBe('key_exchange');
    expect(parsed.publicKey.kty).toBe('EC');
    expect(parsed.publicKey.crv).toBe('P-256');
    expect(typeof parsed.publicKey.x).toBe('string');
    expect(typeof parsed.publicKey.y).toBe('string');
  });

  it('public key only contains public components (no d parameter)', async () => {
    const kp = await generateKeyPair();

    // The JWK should not contain the private key component
    expect(kp.publicKeyJwk.d).toBeUndefined();
    expect(kp.publicKeyJwk.x).toBeDefined();
    expect(kp.publicKeyJwk.y).toBeDefined();
  });
});

describe('key_exchange_ack handling', () => {
  it('derives session key from ack with valid public key', async () => {
    const desktopKP = await generateKeyPair();
    const viewerKP = await generateKeyPair();
    const sessionId = 'ack-test-session';

    // Simulate receiving key_exchange_ack
    const ackMsg = {
      type: 'key_exchange_ack',
      publicKey: viewerKP.publicKeyJwk,
    };

    // Desktop derives session key (what the onmessage handler does)
    const session = await deriveSessionKey(desktopKP.privateKey, ackMsg.publicKey, sessionId);

    expect(session.key).toBeDefined();
    expect(session.sendCounter).toBe(0);
    expect(session.recvCounter).toBe(0);
    expect(session.sessionId).toBe(sessionId);
    expect(session.verificationCode).toBeDefined();
    expect(session.verificationCode).toMatch(/^\d{6}$/);
  });

  it('rejects ack with invalid public key', async () => {
    const desktopKP = await generateKeyPair();
    const sessionId = 'bad-ack-test';

    // Invalid JWK — wrong curve parameters
    const badPublicKey: JsonWebKey = {
      kty: 'EC',
      crv: 'P-256',
      x: 'invalid-base64',
      y: 'also-invalid',
    };

    await expect(deriveSessionKey(desktopKP.privateKey, badPublicKey, sessionId)).rejects.toThrow();
  });

  it('ack without publicKey field is handled gracefully', () => {
    // Simulate receiving ack without publicKey
    const ackMsg = { type: 'key_exchange_ack' };

    // The hook checks `raw.publicKey` before calling deriveSessionKey
    const hasPublicKey = 'publicKey' in ackMsg && ackMsg.publicKey;
    expect(hasPublicKey).toBeFalsy();
  });
});
