import { Elysia } from 'elysia';
import { redis } from '../../lib/redis.js';
import { logger } from '../../lib/logger.js';

interface RateLimitConfig {
  windowMs: number;
  max: number;
  keyPrefix: string;
}

const DEFAULT_CONFIGS: Record<string, RateLimitConfig> = {
  auth: { windowMs: 15 * 60 * 1000, max: 5, keyPrefix: 'rl:auth' },
  public: { windowMs: 60 * 1000, max: 100, keyPrefix: 'rl:public' },
  authenticated: { windowMs: 60 * 1000, max: 300, keyPrefix: 'rl:authn' },
  publish: { windowMs: 60 * 1000, max: 20, keyPrefix: 'rl:publish' },
  generate: { windowMs: 60 * 60 * 1000, max: 50, keyPrefix: 'rl:generate' },
};

function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return request.headers.get('x-real-ip') ?? 'unknown';
}

export function createRateLimiter(tier: keyof typeof DEFAULT_CONFIGS) {
  const config = DEFAULT_CONFIGS[tier] ?? DEFAULT_CONFIGS.public;

  return new Elysia({ name: `rate-limit-${tier}` })
    .derive(async ({ request, set }) => {
      const clientIp = getClientIp(request);
      const key = `${config.keyPrefix}:${clientIp}`;

      try {
        const current = await redis.incr(key);
        if (current === 1) {
          await redis.pexpire(key, config.windowMs);
        }

        const ttl = await redis.pttl(key);
        const remaining = Math.max(0, config.max - current);

        // Add rate limit headers
        const headers: Record<string, string> = {
          'X-RateLimit-Limit': String(config.max),
          'X-RateLimit-Remaining': String(remaining),
          'X-RateLimit-Reset': String(Math.ceil((Date.now() + ttl) / 1000)),
        };

        if (current > config.max) {
          set.status = 429;
          (set as any).headers = {
            ...(set as any).headers,
            ...headers,
            'Retry-After': String(Math.ceil(ttl / 1000)),
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
