import { createHash } from 'node:crypto';

/**
 * Generate an idempotency key from social account ID and content.
 * Prevents duplicate posts from being published.
 */
export function generateIdempotencyKey(socialAccountId: string, content: string): string {
  const contentHash = createHash('sha256').update(content).digest('hex').slice(0, 16);
  return `${socialAccountId}:${contentHash}`;
}

/**
 * Verify an idempotency key matches expected values.
 */
export function verifyIdempotencyKey(
  key: string,
  socialAccountId: string,
  content: string
): boolean {
  const expected = generateIdempotencyKey(socialAccountId, content);
  return key === expected;
}

/**
 * Generate a short hash for deduplication checks.
 */
export function contentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 32);
}
