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

  // Standard Webhooks secret is base64-encoded with a known prefix
  let secretBytes: Uint8Array;

  try {
    secretBytes = base64Decode(stripWebhookSecretPrefix(secret));
  } catch {
    return null;
  }

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

function stripWebhookSecretPrefix(secret: string): string {
  if (secret.startsWith('whsec_')) {
    return secret.slice(6);
  }

  if (secret.startsWith('polar_whs_')) {
    return secret.slice(10);
  }

  return secret;
}

function base64Decode(str: string): Uint8Array {
  // Add padding if missing — some providers omit trailing '='
  const padded = str.length % 4 === 0 ? str : str + '='.repeat(4 - (str.length % 4));
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}
