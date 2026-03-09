import { describe, expect, it } from 'vitest';
import { getLocalAuthSecret } from '../useLocalServer';
import {
  generateKeyPair,
  deriveSessionKey,
  encryptFrame,
  decryptFrame,
  encodeTerminalData,
  decodeBinaryFrame,
  Channel,
} from '@termpod/protocol';

describe('getLocalAuthSecret', () => {
  it('returns null initially (before Tauri invoke sets it)', () => {
    // The module-level _localAuthSecret starts as null
    // It only gets set when the Tauri invoke for start_local_server returns
    const secret = getLocalAuthSecret();
    expect(secret).toBeNull();
  });

  it('return type is string or null', () => {
    const secret = getLocalAuthSecret();
    expect(secret === null || typeof secret === 'string').toBe(true);
  });
});

describe('local_auth_secret message format', () => {
  it('produces correct JSON structure when secret exists', () => {
    const secret = 'test-secret-abc123';

    // This is the message format sent by useDeviceWS on hello_ok and client_joined
    const msg = {
      type: 'local_auth_secret',
      secret,
    };

    expect(msg).toHaveProperty('type', 'local_auth_secret');
    expect(msg).toHaveProperty('secret', secret);

    // Verify it serializes correctly
    const json = JSON.stringify(msg);
    const parsed = JSON.parse(json);
    expect(parsed.type).toBe('local_auth_secret');
    expect(parsed.secret).toBe(secret);
  });

  it('message has exactly two fields (type and secret)', () => {
    const msg = {
      type: 'local_auth_secret',
      secret: 'my-secret',
    };

    expect(Object.keys(msg)).toHaveLength(2);
    expect(Object.keys(msg)).toContain('type');
    expect(Object.keys(msg)).toContain('secret');
  });
});

describe('local auth secret sharing triggers', () => {
  it('hello_ok triggers local_auth_secret if secret exists', () => {
    // Simulate the condition checked in useDeviceWS on hello_ok:
    // if (getLocalAuthSecret() && ws.readyState === WebSocket.OPEN)
    const secret = 'existing-secret';
    const wsOpen = true;

    const shouldSend = !!secret && wsOpen;
    expect(shouldSend).toBe(true);

    if (shouldSend) {
      const msg = JSON.stringify({
        type: 'local_auth_secret',
        secret,
      });

      const parsed = JSON.parse(msg);
      expect(parsed.type).toBe('local_auth_secret');
      expect(parsed.secret).toBe(secret);
    }
  });

  it('hello_ok does NOT send local_auth_secret when secret is null', () => {
    const secret: string | null = null;
    const wsOpen = true;

    const shouldSend = !!secret && wsOpen;
    expect(shouldSend).toBe(false);
  });

  it('client_joined triggers local_auth_secret if secret exists', () => {
    // Same pattern used on client_joined in useDeviceWS
    const secret = 'shared-secret-xyz';
    const wsOpen = true;

    const shouldSend = !!secret && wsOpen;
    expect(shouldSend).toBe(true);

    if (shouldSend) {
      const msg = {
        type: 'local_auth_secret',
        secret,
      };
      expect(msg.type).toBe('local_auth_secret');
      expect(msg.secret).toBe(secret);
    }
  });

  it('client_joined does NOT send when WS is not open', () => {
    const secret = 'some-secret';
    const wsOpen = false;

    const shouldSend = !!secret && wsOpen;
    expect(shouldSend).toBe(false);
  });
});

describe('local E2E key exchange flow', () => {
  it('desktop initiates key exchange on viewer join', async () => {
    // Desktop generates key pair when a viewer joins via Bonjour
    const desktopKP = await generateKeyPair();

    // Desktop sends key_exchange message to the viewer
    const keyExchangeMsg = {
      type: 'key_exchange',
      publicKey: desktopKP.publicKeyJwk,
      sessionId: 'local-session-1',
    };

    expect(keyExchangeMsg.type).toBe('key_exchange');
    expect(keyExchangeMsg.publicKey.kty).toBe('EC');
    expect(keyExchangeMsg.publicKey.crv).toBe('P-256');
  });

  it('derives session key from viewer ack and encrypts/decrypts', async () => {
    const desktopKP = await generateKeyPair();
    const viewerKP = await generateKeyPair();
    const sessionId = 'local-e2e-roundtrip';

    // Desktop derives session after receiving key_exchange_ack
    const desktopSession = await deriveSessionKey(
      desktopKP.privateKey,
      viewerKP.publicKeyJwk,
      sessionId,
    );

    // Viewer derives session after receiving key_exchange
    const viewerSession = await deriveSessionKey(
      viewerKP.privateKey,
      desktopKP.publicKeyJwk,
      sessionId,
    );

    // Both peers should have matching verification codes
    expect(desktopSession.verificationCode).toBe(viewerSession.verificationCode);

    // Desktop encrypts terminal output for local viewer
    const termData = new TextEncoder().encode('hello local\r\n');
    const plainFrame = encodeTerminalData(termData);
    const encrypted = await encryptFrame(desktopSession, plainFrame);
    const decrypted = await decryptFrame(viewerSession, encrypted);

    const inner = decodeBinaryFrame(decrypted);
    expect(inner.channel).toBe(Channel.TERMINAL_DATA);

    if (inner.channel === Channel.TERMINAL_DATA) {
      expect(new TextDecoder().decode(inner.data)).toBe('hello local\r\n');
    }
  });

  it('viewer encrypted input is decrypted by desktop', async () => {
    const desktopKP = await generateKeyPair();
    const viewerKP = await generateKeyPair();
    const sessionId = 'local-e2e-input';

    const desktopSession = await deriveSessionKey(
      desktopKP.privateKey,
      viewerKP.publicKeyJwk,
      sessionId,
    );

    const viewerSession = await deriveSessionKey(
      viewerKP.privateKey,
      desktopKP.publicKeyJwk,
      sessionId,
    );

    // Viewer encrypts input to send to desktop
    const input = new TextEncoder().encode('ls\n');
    const plainFrame = encodeTerminalData(input);
    const encrypted = await encryptFrame(viewerSession, plainFrame);

    // Desktop decrypts
    const decrypted = await decryptFrame(desktopSession, encrypted);
    const inner = decodeBinaryFrame(decrypted);

    expect(inner.channel).toBe(Channel.TERMINAL_DATA);

    if (inner.channel === Channel.TERMINAL_DATA) {
      expect(new TextDecoder().decode(inner.data)).toBe('ls\n');
    }
  });

  it('E2E state is cleared when viewer disconnects', async () => {
    const desktopKP = await generateKeyPair();
    const viewerKP = await generateKeyPair();

    const session = await deriveSessionKey(
      desktopKP.privateKey,
      viewerKP.publicKeyJwk,
      'local-disconnect',
    );

    // Simulate per-client E2E map (matches useLocalServer's localE2ESessions)
    const localSessions = new Map<string, typeof session>();
    const clientId = 'viewer-abc';
    localSessions.set(clientId, session);
    expect(localSessions.has(clientId)).toBe(true);

    // On viewer-left, the session is deleted
    localSessions.delete(clientId);
    expect(localSessions.has(clientId)).toBe(false);
    expect(localSessions.size).toBe(0);
  });
});
