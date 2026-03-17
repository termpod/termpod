export type Plan = 'free' | 'pro';

export interface SubscriptionStatus {
  plan: Plan;
  trialEndsAt: number | null;
  planExpiresAt: number | null;
  cancelAtPeriodEnd: boolean;
  polarCustomerId: string | null;
  selfHosted: boolean;
}

const TIMESTAMP_TOLERANCE = 5 * 60; // 5 minutes in seconds

export async function verifyPolarWebhook(
  request: Request,
  secret: string,
): Promise<Record<string, unknown> | null> {
  const webhookId = request.headers.get('webhook-id');
  const timestamp = request.headers.get('webhook-timestamp');
  const signature = request.headers.get('webhook-signature');

  if (!webhookId || !timestamp || !signature) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  const ts = parseInt(timestamp, 10);

  if (isNaN(ts) || Math.abs(now - ts) > TIMESTAMP_TOLERANCE) {
    return null;
  }

  const body = await request.text();
  const signedContent = `${webhookId}.${timestamp}.${body}`;

  // Standard Webhooks secret is base64-encoded, prefixed with "whsec_"
  const secretBytes = base64Decode(secret.startsWith('whsec_') ? secret.slice(6) : secret);

  const key = await crypto.subtle.importKey(
    'raw',
    secretBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedContent));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));

  // Signature header can contain multiple signatures: "v1,<base64> v1,<base64>"
  const signatures = signature.split(' ');

  for (const sig of signatures) {
    const parts = sig.split(',');

    if (parts.length < 2 || parts[0] !== 'v1') {
      continue;
    }

    if (parts[1] === expected) {
      try {
        return JSON.parse(body) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
  }

  return null;
}

function base64Decode(str: string): Uint8Array {
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}
