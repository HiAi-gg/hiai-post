import { describe, it, expect, beforeAll } from 'bun:test';

// Set required env vars before importing config-dependent modules
beforeAll(() => {
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  process.env.BETTER_AUTH_SECRET = 'test-secret-key-min-32-characters-long';
  process.env.TOKEN_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  process.env.MINIO_SECRET_KEY = 'test-minio-secret';
});

describe('Encryption', () => {
  it('encrypts and decrypts round-trip', async () => {
    const { encryptToken, decryptToken } = await import('../lib/encryption.js');
    const original = 'test-secret-token-123';
    const encrypted = await encryptToken(original);
    const decrypted = await decryptToken(encrypted);
    expect(decrypted).toBe(original);
  });
  it('handles empty string', async () => {
    const { encryptToken, decryptToken } = await import('../lib/encryption.js');
    const encrypted = await encryptToken('');
    const decrypted = await decryptToken(encrypted);
    expect(decrypted).toBe('');
  });
  it('produces different ciphertext for same input', async () => {
    const { encryptToken } = await import('../lib/encryption.js');
    const a = await encryptToken('test');
    const b = await encryptToken('test');
    expect(a).not.toBe(b); // Different IVs
  });
  it('encrypted value is not plaintext', async () => {
    const { encryptToken } = await import('../lib/encryption.js');
    const encrypted = await encryptToken('my-secret');
    expect(encrypted).not.toBe('my-secret');
    expect(encrypted.length).toBeGreaterThan(0);
  });
});
