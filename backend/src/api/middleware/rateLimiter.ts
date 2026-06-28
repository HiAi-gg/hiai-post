import { Elysia } from 'elysia';
import { redis } from '../../lib/redis.js';
import { logger } from '../../lib/logger.js';

interface RateLimitConfig {
  windowMs: number;
  max: number;
  endpoint: string;
}

const DEFAULT_CONFIGS: Record<string, RateLimitConfig> = {
  auth: { windowMs: 15 * 60 * 1000, max: 5, endpoint: 'auth' },
  public: { windowMs: 60 * 1000, max: 100, endpoint: 'public' },
  authenticated: { windowMs: 60 * 1000, max: 300, endpoint: 'authenticated' },
  publish: { windowMs: 60 * 1000, max: 20, endpoint: 'publish' },
  generate: { windowMs: 60 * 60 * 1000, max: 50, endpoint: 'generate' },
};

function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return request.headers.get('x-real-ip') ?? 'unknown';
}

/**
 * Extract tenant ID from the auth context.
 *
 * Tries, in order:
 *   1. X-Tenant-Id header (matches `tenantMiddleware` contract).
 *   2. `tenant_id` claim from a Bearer JWT (HS256, no signature verification
 *      here — this is best-effort and used only for rate-limit key partitioning,
 *      not for authorization).
 *
 * Returns `null` when no tenant context is available (e.g. unauthenticated /
 * pre-login endpoints). Callers MUST treat `null` as "fall back to global
 * rate limiting by IP".
 */
function extractTenantId(request: Request): string | null {
  const headerTenant = request.headers.get('X-Tenant-Id');
  if (headerTenant) return headerTenant;

  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.slice(7);
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf8');
    const payload = JSON.parse(payloadJson) as { tenant_id?: unknown; tenantId?: unknown };
    const claim = payload.tenant_id ?? payload.tenantId;
    return typeof claim === 'string' && claim.length > 0 ? claim : null;
  } catch {
    return null;
  }
}

interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
  retryAfterSeconds: number;
}

/**
 * Atomically increment a single rate-limit bucket and return the decision.
 * Sets the TTL on first hit.
 */
async function bumpBucket(
  bucketKey: string,
  windowMs: number,
  max: number,
): Promise<RateLimitDecision> {
  const current = await redis.incr(bucketKey);
  if (current === 1) {
    await redis.pexpire(bucketKey, windowMs);
  }

  const ttl = await redis.pttl(bucketKey);
  // Defensive: pttl can return -1 (no expiry) or -2 (no key) in rare races.
  const safeTtlMs = ttl > 0 ? ttl : windowMs;
  const remaining = Math.max(0, max - current);

  return {
    allowed: current <= max,
    limit: max,
    remaining,
    resetSeconds: Math.ceil((Date.now() + safeTtlMs) / 1000),
    retryAfterSeconds: Math.ceil(safeTtlMs / 1000),
  };
}

export function createRateLimiter(tier: keyof typeof DEFAULT_CONFIGS) {
  const config = DEFAULT_CONFIGS[tier] ?? DEFAULT_CONFIGS.public;

  return new Elysia({ name: `rate-limit-${tier}` })
    .derive(async ({ request, set }) => {
      const tenantId = extractTenantId(request);
      const clientIp = getClientIp(request);

      // Per-tenant bucket: `ratelimit:{tenant_id}:{endpoint}`
      // Global bucket (fallback when no tenant context): `ratelimit:{endpoint}:{ip}`
      const tenantKey = tenantId ? `ratelimit:${tenantId}:${config.endpoint}` : null;
      const globalKey = `ratelimit:${config.endpoint}:${clientIp}`;

      try {
        // The active bucket is the tenant one when available; the global one
        // always runs as a second-line guard so an unauthenticated flood from
        // a single IP can't bypass limits even if tenant scoping is later added.
        const primaryDecision = tenantKey
          ? await bumpBucket(tenantKey, config.windowMs, config.max)
          : await bumpBucket(globalKey, config.windowMs, config.max);

        // Always count the global bucket too — it serves as a safety net even
        // for tenant-scoped requests, and keeps the existing global limit
        // semantics for legacy callers.
        const globalDecision =
          tenantKey !== null
            ? await bumpBucket(globalKey, config.windowMs, config.max)
            : null;

        const worstDecision: RateLimitDecision =
          globalDecision && !globalDecision.allowed
            ? globalDecision
            : primaryDecision;

        const headers: Record<string, string> = {
          'X-RateLimit-Limit': String(worstDecision.limit),
          'X-RateLimit-Remaining': String(worstDecision.remaining),
          'X-RateLimit-Reset': String(worstDecision.resetSeconds),
          ...(tenantKey ? { 'X-RateLimit-Tenant': tenantId! } : {}),
        };

        if (!worstDecision.allowed) {
          set.status = 429;
          (set as any).headers = {
            ...(set as any).headers,
            ...headers,
            'Retry-After': String(worstDecision.retryAfterSeconds),
          };
          throw new Error('Rate limit exceeded');
        }

        return { rateLimitHeaders: headers };
      } catch (err: any) {
        if (err?.message === 'Rate limit exceeded') throw err;
        // Fail-open: if Redis is down, allow the request
        logger.warn({ err }, 'Rate limiter failed, allowing request');
        return { rateLimitHeaders: {} };
      }
    });
}
