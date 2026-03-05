export function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);

  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function validateToken(provided: string, stored: string): boolean {
  if (provided.length !== stored.length) {
    return false;
  }

  const encoder = new TextEncoder();
  const a = encoder.encode(provided);
  const b = encoder.encode(stored);

  return crypto.subtle.timingSafeEqual(a, b);
}
