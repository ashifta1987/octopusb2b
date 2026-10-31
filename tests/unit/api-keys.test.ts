import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { generateApiKey, hashApiKey, parseApiKey, signAccessToken, verifyAccessToken, TOKEN_TTL_SECONDS } from '@/lib/api/keys';

describe('API keys', () => {
  it('generates prefixed keys and stores only the sha256 hex', () => {
    const k = generateApiKey('test');
    expect(k.key).toMatch(/^oct_test_[0-9a-f]{48}$/);
    expect(k.hash).toBe(crypto.createHash('sha256').update(k.key).digest('hex'));
    expect(k.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(k.prefix).toBe(k.key.slice(0, 13));
    expect(generateApiKey('live').key.startsWith('oct_live_')).toBe(true);
  });
  it('hash is deterministic and distinct per key', () => {
    expect(hashApiKey('oct_test_abc')).toBe(hashApiKey('oct_test_abc'));
    expect(hashApiKey('oct_test_abc')).not.toBe(hashApiKey('oct_test_abd'));
  });
  it('parses the mode and rejects malformed keys', () => {
    expect(parseApiKey(generateApiKey('live').key)).toEqual({ mode: 'live' });
    expect(parseApiKey('oct_prod_' + 'a'.repeat(48))).toBeNull();
    expect(parseApiKey('oct_test_short')).toBeNull();
    expect(parseApiKey('sk_test_' + 'a'.repeat(48))).toBeNull();
  });
});

describe('access tokens (client credentials)', () => {
  const secret = 'signing-secret';
  const claims = { sub: 'cli_1', cid: 'c-uuid', kid: 'k-uuid', org: 'org-uuid', scopes: ['catalog:read'], mode: 'test' as const };

  it('signs and verifies, expiring after 1 hour', () => {
    const now = 1_800_000_000;
    const { token, claims: c } = signAccessToken(claims, secret, now);
    expect(c.exp - c.iat).toBe(TOKEN_TTL_SECONDS);
    expect(TOKEN_TTL_SECONDS).toBe(3600);
    expect(verifyAccessToken(token, secret, now + 10)?.org).toBe('org-uuid');
    expect(verifyAccessToken(token, secret, now + 3600)).toBeNull();
  });
  it('rejects tampering, wrong secret and garbage', () => {
    const { token } = signAccessToken(claims, secret);
    const [h, b, s] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(b, 'base64url').toString()), org: 'other-org' })).toString('base64url');
    expect(verifyAccessToken(`${h}.${forged}.${s}`, secret)).toBeNull();
    expect(verifyAccessToken(token, 'wrong')).toBeNull();
    expect(verifyAccessToken('a.b', secret)).toBeNull();
    expect(verifyAccessToken(token, '')).toBeNull();
  });
  it('refuses to sign without a secret', () => {
    expect(() => signAccessToken(claims, '')).toThrow();
  });
});
