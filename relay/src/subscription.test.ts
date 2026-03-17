import { describe, expect, it } from 'vitest';
import { verifyPolarWebhook } from './subscription';

// --- Helpers ---

function base64Decode(str: string): Uint8Array {
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

async function signWebhook(
  secret: string,
  webhookId: string,
  timestamp: string,
  body: string,
): Promise<string> {
  const secretBytes = base64Decode(secret.startsWith('whsec_') ? secret.slice(6) : secret);
  const key = await crypto.subtle.importKey(
    'raw',
    secretBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${webhookId}.${timestamp}.${body}`),
  );

  return `v1,${btoa(String.fromCharCode(...new Uint8Array(mac)))}`;
}

function makeWebhookRequest(body: string, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/webhooks/polar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body,
  });
}

// Base64-encoded 32-byte secret for tests
const TEST_SECRET_RAW = 'dGVzdHNlY3JldGtleXRoYXRpczMyYnl0ZXNsb25n';
const TEST_SECRET_WHSEC = `whsec_${TEST_SECRET_RAW}`;

// --- verifyPolarWebhook ---

describe('verifyPolarWebhook', () => {
  it('returns null when webhook-id header is missing', async () => {
    const body = JSON.stringify({ type: 'subscription.active' });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = await signWebhook(TEST_SECRET_RAW, 'msg_123', timestamp, body);

    const request = makeWebhookRequest(body, {
      'webhook-timestamp': timestamp,
      'webhook-signature': signature,
    });

    expect(await verifyPolarWebhook(request, TEST_SECRET_RAW)).toBeNull();
  });

  it('returns null when webhook-timestamp header is missing', async () => {
    const body = JSON.stringify({ type: 'subscription.active' });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = await signWebhook(TEST_SECRET_RAW, 'msg_123', timestamp, body);

    const request = makeWebhookRequest(body, {
      'webhook-id': 'msg_123',
      'webhook-signature': signature,
    });

    expect(await verifyPolarWebhook(request, TEST_SECRET_RAW)).toBeNull();
  });

  it('returns null when webhook-signature header is missing', async () => {
    const body = JSON.stringify({ type: 'subscription.active' });
    const timestamp = String(Math.floor(Date.now() / 1000));

    const request = makeWebhookRequest(body, {
      'webhook-id': 'msg_123',
      'webhook-timestamp': timestamp,
    });

    expect(await verifyPolarWebhook(request, TEST_SECRET_RAW)).toBeNull();
  });

  it('returns null when timestamp is too old (>5 min)', async () => {
    const body = JSON.stringify({ type: 'subscription.active' });
    const oldTimestamp = String(Math.floor(Date.now() / 1000) - 6 * 60); // 6 minutes ago
    const signature = await signWebhook(TEST_SECRET_RAW, 'msg_123', oldTimestamp, body);

    const request = makeWebhookRequest(body, {
      'webhook-id': 'msg_123',
      'webhook-timestamp': oldTimestamp,
      'webhook-signature': signature,
    });

    expect(await verifyPolarWebhook(request, TEST_SECRET_RAW)).toBeNull();
  });

  it('returns null when timestamp is too far in the future', async () => {
    const body = JSON.stringify({ type: 'subscription.active' });
    const futureTimestamp = String(Math.floor(Date.now() / 1000) + 6 * 60); // 6 minutes ahead
    const signature = await signWebhook(TEST_SECRET_RAW, 'msg_123', futureTimestamp, body);

    const request = makeWebhookRequest(body, {
      'webhook-id': 'msg_123',
      'webhook-timestamp': futureTimestamp,
      'webhook-signature': signature,
    });

    expect(await verifyPolarWebhook(request, TEST_SECRET_RAW)).toBeNull();
  });

  it('returns null when signature does not match', async () => {
    const body = JSON.stringify({ type: 'subscription.active' });
    const timestamp = String(Math.floor(Date.now() / 1000));

    const request = makeWebhookRequest(body, {
      'webhook-id': 'msg_123',
      'webhook-timestamp': timestamp,
      'webhook-signature': 'v1,aW52YWxpZHNpZ25hdHVyZQ==',
    });

    expect(await verifyPolarWebhook(request, TEST_SECRET_RAW)).toBeNull();
  });

  it('returns parsed payload on valid signature', async () => {
    const payload = { type: 'subscription.active', data: { id: 'sub_123' } };
    const body = JSON.stringify(payload);
    const webhookId = 'msg_abc';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = await signWebhook(TEST_SECRET_RAW, webhookId, timestamp, body);

    const request = makeWebhookRequest(body, {
      'webhook-id': webhookId,
      'webhook-timestamp': timestamp,
      'webhook-signature': signature,
    });

    const result = await verifyPolarWebhook(request, TEST_SECRET_RAW);

    expect(result).toEqual(payload);
  });

  it('handles whsec_ prefix on secret', async () => {
    const payload = { type: 'subscription.active' };
    const body = JSON.stringify(payload);
    const webhookId = 'msg_prefixed';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = await signWebhook(TEST_SECRET_WHSEC, webhookId, timestamp, body);

    const request = makeWebhookRequest(body, {
      'webhook-id': webhookId,
      'webhook-timestamp': timestamp,
      'webhook-signature': signature,
    });

    const result = await verifyPolarWebhook(request, TEST_SECRET_WHSEC);

    expect(result).toEqual(payload);
  });

  it('handles multiple signatures in the header (space-separated)', async () => {
    const payload = { type: 'subscription.updated' };
    const body = JSON.stringify(payload);
    const webhookId = 'msg_multi';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const validSig = await signWebhook(TEST_SECRET_RAW, webhookId, timestamp, body);

    // Put an invalid signature first, valid signature second
    const combinedSignature = `v1,aW52YWxpZHNpZw== ${validSig}`;

    const request = makeWebhookRequest(body, {
      'webhook-id': webhookId,
      'webhook-timestamp': timestamp,
      'webhook-signature': combinedSignature,
    });

    const result = await verifyPolarWebhook(request, TEST_SECRET_RAW);

    expect(result).toEqual(payload);
  });
});

// --- getEffectivePlan logic ---

describe('getEffectivePlan logic', () => {
  /**
   * Mirrors the getEffectivePlan() method in User DO.
   * Extracted as a pure function for testing without DO infrastructure.
   */
  function getEffectivePlan(
    plan: string,
    trialEndsAt: number | null,
    planExpiresAt: number | null,
  ): 'free' | 'pro' {
    const now = Date.now();

    if (trialEndsAt && now < trialEndsAt) {
      return 'pro';
    }

    if (plan === 'pro' && (!planExpiresAt || now < planExpiresAt)) {
      return 'pro';
    }

    return 'free';
  }

  it('returns free when no trial and plan is free', () => {
    expect(getEffectivePlan('free', null, null)).toBe('free');
  });

  it('returns pro during active trial (trialEndsAt in future)', () => {
    const futureTrialEnd = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days from now

    expect(getEffectivePlan('free', futureTrialEnd, null)).toBe('pro');
  });

  it('returns free after trial expires (trialEndsAt in past)', () => {
    const pastTrialEnd = Date.now() - 1000; // 1 second ago

    expect(getEffectivePlan('free', pastTrialEnd, null)).toBe('free');
  });

  it('returns pro when plan is pro and not expired', () => {
    const futureExpiry = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days from now

    expect(getEffectivePlan('pro', null, futureExpiry)).toBe('pro');
  });

  it('returns pro when plan is pro and planExpiresAt is null (no expiry)', () => {
    expect(getEffectivePlan('pro', null, null)).toBe('pro');
  });

  it('returns free when plan is pro but expired', () => {
    const pastExpiry = Date.now() - 1000;

    expect(getEffectivePlan('pro', null, pastExpiry)).toBe('free');
  });

  it('trial takes precedence over free plan (trial active but plan is free)', () => {
    const futureTrialEnd = Date.now() + 3 * 24 * 60 * 60 * 1000; // 3 days from now

    expect(getEffectivePlan('free', futureTrialEnd, null)).toBe('pro');
  });

  it('existing users: null trialEndsAt treated as no trial and returns free', () => {
    expect(getEffectivePlan('free', null, null)).toBe('free');
  });
});

// --- Subscription feature gate logic ---

describe('Subscription feature gates', () => {
  type EffectivePlan = 'free' | 'pro';

  interface DeviceRegistration {
    deviceType: 'desktop' | 'mobile';
    existingDesktopCount: number;
  }

  /**
   * Mirrors the device registration gate in handleRegisterDevice.
   * Returns an error string if blocked, null if allowed.
   */
  function checkDeviceGate(
    effectivePlan: EffectivePlan,
    registration: DeviceRegistration,
    selfHosted: boolean,
  ): string | null {
    if (selfHosted) {
      return null;
    }

    if (
      registration.deviceType === 'desktop' &&
      effectivePlan === 'free' &&
      registration.existingDesktopCount > 0
    ) {
      return 'Free plan allows 1 desktop device. Upgrade to Pro for unlimited devices.';
    }

    return null;
  }

  /**
   * Mirrors the share token gate in handleCreateShareToken.
   * Returns an error string if blocked, null if allowed.
   */
  function checkShareGate(effectivePlan: EffectivePlan, selfHosted: boolean): string | null {
    if (selfHosted) {
      return null;
    }

    if (effectivePlan === 'free') {
      return 'Share links require a Pro plan. Upgrade to share sessions.';
    }

    return null;
  }

  describe('device registration gate', () => {
    it('free tier blocks more than 1 desktop device', () => {
      const result = checkDeviceGate(
        'free',
        { deviceType: 'desktop', existingDesktopCount: 1 },
        false,
      );

      expect(result).not.toBeNull();
      expect(result).toContain('Free plan');
    });

    it('free tier allows 1 desktop device', () => {
      const result = checkDeviceGate(
        'free',
        { deviceType: 'desktop', existingDesktopCount: 0 },
        false,
      );

      expect(result).toBeNull();
    });

    it('free tier allows mobile devices without limit', () => {
      const result = checkDeviceGate(
        'free',
        { deviceType: 'mobile', existingDesktopCount: 5 },
        false,
      );

      expect(result).toBeNull();
    });

    it('pro tier allows unlimited desktop devices', () => {
      const result = checkDeviceGate(
        'pro',
        { deviceType: 'desktop', existingDesktopCount: 10 },
        false,
      );

      expect(result).toBeNull();
    });

    it('self-hosted bypasses device gate', () => {
      const result = checkDeviceGate(
        'free',
        { deviceType: 'desktop', existingDesktopCount: 5 },
        true,
      );

      expect(result).toBeNull();
    });
  });

  describe('share token gate', () => {
    it('free tier blocks share token creation', () => {
      const result = checkShareGate('free', false);

      expect(result).not.toBeNull();
      expect(result).toContain('Pro plan');
    });

    it('pro tier allows share token creation', () => {
      expect(checkShareGate('pro', false)).toBeNull();
    });

    it('self-hosted bypasses share gate', () => {
      expect(checkShareGate('free', true)).toBeNull();
    });
  });
});

// --- Webhook event type handling ---

describe('Webhook event type handling', () => {
  interface SubscriptionUpdate {
    plan?: string;
    planExpiresAt?: number | null;
    cancelAtPeriodEnd?: boolean;
    polarCustomerId?: string | null;
  }

  /**
   * Mirrors the switch statement in handlePolarWebhook.
   * Returns the subscription update payload that would be sent to the User DO,
   * or null if the event type is not handled.
   */
  function getSubscriptionUpdate(
    type: string,
    data: Record<string, unknown>,
  ): SubscriptionUpdate | null {
    const customer = data.customer as Record<string, unknown> | undefined;
    const customerId = (customer?.id as string) ?? null;
    const currentPeriodEnd = data.current_period_end as string | undefined;
    const expiresAt = currentPeriodEnd ? new Date(currentPeriodEnd).getTime() : null;

    switch (type) {
      case 'subscription.active':
      case 'subscription.updated': {
        return {
          plan: 'pro',
          planExpiresAt: expiresAt,
          cancelAtPeriodEnd: data.cancel_at_period_end === true,
          polarCustomerId: customerId,
        };
      }

      case 'subscription.canceled': {
        return { cancelAtPeriodEnd: true };
      }

      case 'subscription.revoked': {
        return {
          plan: 'free',
          planExpiresAt: null,
          cancelAtPeriodEnd: false,
        };
      }

      default:
        return null;
    }
  }

  it('subscription.active sets plan to pro', () => {
    const update = getSubscriptionUpdate('subscription.active', {
      customer: { id: 'cust_123', email: 'user@example.com' },
      current_period_end: '2026-04-17T00:00:00Z',
      cancel_at_period_end: false,
    });

    expect(update).not.toBeNull();
    expect(update!.plan).toBe('pro');
    expect(update!.planExpiresAt).toBe(new Date('2026-04-17T00:00:00Z').getTime());
    expect(update!.cancelAtPeriodEnd).toBe(false);
    expect(update!.polarCustomerId).toBe('cust_123');
  });

  it('subscription.updated sets plan to pro with updated period', () => {
    const update = getSubscriptionUpdate('subscription.updated', {
      customer: { id: 'cust_123', email: 'user@example.com' },
      current_period_end: '2026-05-17T00:00:00Z',
      cancel_at_period_end: true,
    });

    expect(update).not.toBeNull();
    expect(update!.plan).toBe('pro');
    expect(update!.cancelAtPeriodEnd).toBe(true);
  });

  it('subscription.canceled sets cancelAtPeriodEnd', () => {
    const update = getSubscriptionUpdate('subscription.canceled', {
      customer: { id: 'cust_123', email: 'user@example.com' },
    });

    expect(update).toEqual({ cancelAtPeriodEnd: true });
  });

  it('subscription.revoked downgrades to free', () => {
    const update = getSubscriptionUpdate('subscription.revoked', {
      customer: { id: 'cust_123', email: 'user@example.com' },
    });

    expect(update).toEqual({
      plan: 'free',
      planExpiresAt: null,
      cancelAtPeriodEnd: false,
    });
  });

  it('unknown event type returns null', () => {
    const update = getSubscriptionUpdate('checkout.completed', {
      customer: { id: 'cust_123' },
    });

    expect(update).toBeNull();
  });
});
