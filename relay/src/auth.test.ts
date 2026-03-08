import { describe, expect, it } from 'vitest';
import { generateToken, hashPassword, validateToken, verifyPassword } from './auth.js';

describe('generateToken', () => {
  it('generates a 64-char hex string', () => {
    const token = generateToken();

    expect(token.length).toBe(64);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('generates unique tokens', () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generateToken()));

    expect(tokens.size).toBe(100);
  });
});

describe('validateToken', () => {
  it('returns true for matching tokens', () => {
    const token = generateToken();

    expect(validateToken(token, token)).toBe(true);
  });

  it('returns false for different tokens', () => {
    const a = generateToken();
    const b = generateToken();

    expect(validateToken(a, b)).toBe(false);
  });

  it('returns false for different length tokens', () => {
    expect(validateToken('short', 'muchlongerstring')).toBe(false);
  });

  it('returns false for empty vs non-empty', () => {
    expect(validateToken('', 'abc')).toBe(false);
  });
});

describe('hashPassword / verifyPassword', () => {
  it('verifies a correct password', async () => {
    const { hash, salt } = await hashPassword('my-secure-password');
    const valid = await verifyPassword('my-secure-password', hash, salt);

    expect(valid).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const { hash, salt } = await hashPassword('my-secure-password');
    const valid = await verifyPassword('wrong-password', hash, salt);

    expect(valid).toBe(false);
  });

  it('produces different hashes for same password (random salt)', async () => {
    const result1 = await hashPassword('same-password');
    const result2 = await hashPassword('same-password');

    expect(result1.salt).not.toBe(result2.salt);
    expect(result1.hash).not.toBe(result2.hash);
  });

  it('produces hex strings for hash and salt', async () => {
    const { hash, salt } = await hashPassword('test');

    expect(hash).toMatch(/^[0-9a-f]+$/);
    expect(salt).toMatch(/^[0-9a-f]+$/);
    expect(salt.length).toBe(32); // 16 bytes = 32 hex chars
  });

  it('handles unicode passwords', async () => {
    const { hash, salt } = await hashPassword('pässwörd-日本語');
    const valid = await verifyPassword('pässwörd-日本語', hash, salt);

    expect(valid).toBe(true);
  });

  it('handles empty password', async () => {
    const { hash, salt } = await hashPassword('');
    const valid = await verifyPassword('', hash, salt);

    expect(valid).toBe(true);

    const invalid = await verifyPassword('not-empty', hash, salt);
    expect(invalid).toBe(false);
  });
});
