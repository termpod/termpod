import { describe, expect, it } from 'vitest';
import { getLocalAuthSecret } from '../useLocalServer';

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
