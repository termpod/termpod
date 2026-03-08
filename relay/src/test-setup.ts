import { timingSafeEqual } from 'node:crypto';

// Polyfill crypto.subtle.timingSafeEqual (Cloudflare Workers API not in Node.js)
if (!crypto.subtle.timingSafeEqual) {
  (crypto.subtle as Record<string, unknown>).timingSafeEqual = (
    a: ArrayBuffer | Uint8Array,
    b: ArrayBuffer | Uint8Array,
  ): boolean => {
    const bufA = a instanceof Uint8Array ? a : new Uint8Array(a);
    const bufB = b instanceof Uint8Array ? b : new Uint8Array(b);

    if (bufA.length !== bufB.length) {
      return false;
    }

    return timingSafeEqual(bufA, bufB);
  };
}
