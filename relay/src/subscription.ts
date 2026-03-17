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

  // Polar SDK passes the raw secret as UTF-8 to Standard Webhooks' base64 pipeline,
  // so the effective HMAC key is the raw UTF-8 bytes of the secret (after prefix strip).
  // Standard Webhooks (whsec_) secrets are base64-encoded HMAC keys.
  let secretBytes: Uint8Array;

  try {
    secretBytes = decodeWebhookSecret(secret);
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

function decodeWebhookSecret(secret: string): Uint8Array {
  // Standard Webhooks (whsec_): base64-encoded HMAC key
  if (secret.startsWith('whsec_')) {
    return base64Decode(secret.slice(6));
  }

  // Polar (polar_whs_): raw UTF-8 bytes used as HMAC key
  // Polar's SDK does Buffer.from(secret, 'utf-8').toString('base64') then passes
  // to Standard Webhooks which base64-decodes it back — net effect is UTF-8 bytes.
  return new TextEncoder().encode(secret);
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
