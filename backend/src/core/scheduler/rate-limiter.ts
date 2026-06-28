import type { Redis } from "ioredis";

const COUNTER_PREFIX = "rate_limit:publish:";

interface PlatformLimit {
  maxRequests: number;
  windowMs: number;
}

const PLATFORM_LIMITS: Record<string, PlatformLimit> = {
  instagram: { maxRequests: 200, windowMs: 3_600_000 }, // 200/hour
  x: { maxRequests: 300, windowMs: 900_000 }, // 300/15min
  linkedin: { maxRequests: 100, windowMs: 86_400_000 }, // 100/day
  tiktok: { maxRequests: 50, windowMs: 3_600_000 }, // 50/hour
  facebook: { maxRequests: 200, windowMs: 3_600_000 }, // 200/hour
  telegram: { maxRequests: 30, windowMs: 60_000 }, // 30/min
};

let redisClient: Redis;

export function initRateLimiter(redis: Redis): void {
  redisClient = redis;
}

function counterKey(platform: string): string {
  return `${COUNTER_PREFIX}${platform}`;
}

export async function checkLimit(platform: string): Promise<boolean> {
  const limit = PLATFORM_LIMITS[platform];
  if (!limit) return true;

  if (!redisClient) return true;

  const key = counterKey(platform);

  // Increment and get the new count atomically
  const count = await redisClient.incr(key);
  if (count === 1) {
    await redisClient.pexpire(key, limit.windowMs);
  }

  // If over limit, decrement back and reject
  if (count > limit.maxRequests) {
    await redisClient.decr(key);
    return false;
  }

  return true;
}

export async function incrementCounter(platform: string): Promise<void> {
  const limit = PLATFORM_LIMITS[platform];
  if (!limit || !redisClient) return;

  const key = counterKey(platform);
  const count = await redisClient.incr(key);
  if (count === 1) {
    await redisClient.pexpire(key, limit.windowMs);
  }
}

export async function getCurrentCount(platform: string): Promise<number> {
  if (!redisClient) return 0;
  const count = await redisClient.get(counterKey(platform));
  return count ? parseInt(count, 10) : 0;
}

export async function isOverLimit(platform: string): Promise<boolean> {
  const limit = PLATFORM_LIMITS[platform];
  if (!limit || !redisClient) return false;

  const count = await getCurrentCount(platform);
  return count >= limit.maxRequests;
}

export function getPlatformLimits(platform: string): PlatformLimit | null {
  return PLATFORM_LIMITS[platform] ?? null;
}
