import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';

// Set required env vars BEFORE importing modules that read config at load time.
// These env vars are read by src/lib/config.ts when getConfig() is called during module init.
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.BETTER_AUTH_SECRET ??= 'test-secret-key-min-32-characters-long';
process.env.TOKEN_ENCRYPTION_KEY ??= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.MINIO_SECRET_KEY ??= 'test-minio-secret';
process.env.HIAI_ADMIN_JWT_SECRET ??= 'shared-admin-jwt-secret-32chars-please';

const { verifyAdminJwt } = await import('../src/api/middleware/auth.js');

const SECRET = 'shared-admin-jwt-secret-32chars-please';

/** HS256 helper kept local so we don't depend on hiai-admin in unit tests. */
function mintLocalHs256(
  claims: { sub?: string; email?: string; role?: string; name?: string; iat?: number; exp?: number },
  secret: string,
  nowSec = Math.floor(Date.now() / 1000),
): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256' }), 'utf8').toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      iat: nowSec,
      exp: nowSec + 3600,
      ...claims,
    }),
    'utf8',
  ).toString('base64url');
  const sig = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

describe('verifyAdminJwt (INT-POST cross-service auth bridge)', () => {
  it('verifies a valid HS256 token minted with the same secret', () => {
    const token = mintLocalHs256(
      { sub: 'u1', email: 'admin@example.com', role: 'super_admin' },
      SECRET,
    );
    const claims = verifyAdminJwt(token, SECRET);
    expect(claims).not.toBeNull();
    expect(claims?.sub).toBe('u1');
    expect(claims?.email).toBe('admin@example.com');
    expect(claims?.role).toBe('super_admin');
  });

  it('rejects a token signed with a different secret', () => {
    const token = mintLocalHs256(
      { sub: 'u1', email: 'admin@example.com', role: 'super_admin' },
      'wrong-secret',
    );
    expect(verifyAdminJwt(token, SECRET)).toBeNull();
  });

  it('rejects a malformed token (not 3 parts)', () => {
    expect(verifyAdminJwt('not-a-jwt', SECRET)).toBeNull();
    expect(verifyAdminJwt('a.b', SECRET)).toBeNull();
    expect(verifyAdminJwt('a.b.c.d', SECRET)).toBeNull();
  });

  it('rejects an expired token', () => {
    const issued = 1_700_000_000_000;
    const expiredAtSec = Math.floor(issued / 1000) - 60; // expired 1 min ago
    const header = Buffer.from(JSON.stringify({ alg: 'HS256' }), 'utf8').toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        sub: 'u1',
        email: 'a@b.c',
        role: 'admin',
        iat: expiredAtSec - 3600,
        exp: expiredAtSec,
      }),
      'utf8',
    ).toString('base64url');
    const sig = createHmac('sha256', SECRET)
      .update(`${header}.${payload}`)
      .digest('base64url');
    expect(verifyAdminJwt(`${header}.${payload}.${sig}`, SECRET)).toBeNull();
  });

  it('rejects a non-HS256 alg', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'HS512' }), 'utf8').toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: 'u1' }), 'utf8').toString('base64url');
    const sig = createHmac('sha256', SECRET)
      .update(`${header}.${payload}`)
      .digest('base64url');
    expect(verifyAdminJwt(`${header}.${payload}.${sig}`, SECRET)).toBeNull();
  });

  it('returns null when secret is empty', () => {
    const token = mintLocalHs256(
      { sub: 'u1', email: 'a@b.c', role: 'admin' },
      SECRET,
    );
    expect(verifyAdminJwt(token, '')).toBeNull();
  });

  it('returns null when signature length differs', () => {
    const token = mintLocalHs256({ sub: 'u1', email: 'a@b.c', role: 'admin' }, SECRET);
    const [h, p] = token.split('.');
    expect(verifyAdminJwt(`${h}.${p}.AAAA`, SECRET)).toBeNull();
  });
});
