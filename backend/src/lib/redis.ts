import Redis from "ioredis";
import { config } from "./config.js";
import { logger } from "./logger.js";

const log = logger.child({ module: "redis" });

export const redis = new Redis(config.REDIS_URL, {
  keyPrefix: "hipost:",
  retryStrategy(times) {
    const delay = Math.min(times * 200, 5000);
    return delay;
  },
  maxRetriesPerRequest: 3,
  lazyConnect: true,
});

redis.on("connect", () => log.info("Redis connected"));
redis.on("error", (err) => log.error({ err }, "Redis error"));

export async function checkRedisHealth(): Promise<boolean> {
  try {
    const pong = await redis.ping();
    return pong === "PONG";
  } catch (err) {
    log.error({ err }, "Redis health check failed");
    return false;
  }
}

export async function connectRedis(): Promise<void> {
  await redis.connect();
}

// Publish queue helpers
export async function enqueuePost(
  tenantId: string,
  postId: string,
  publishAt: Date
): Promise<void> {
  const score = publishAt.getTime();
  await redis.zadd(`publish_queue:${tenantId}`, score, postId);
}

export async function dequeueDuePosts(tenantId: string, now: Date = new Date()): Promise<string[]> {
  const posts = await redis.zrangebyscore(`publish_queue:${tenantId}`, 0, now.getTime());
  if (posts.length > 0) {
    await redis.zremrangebyscore(`publish_queue:${tenantId}`, 0, now.getTime());
  }
  return posts;
}

export async function removeQueuedPost(tenantId: string, postId: string): Promise<void> {
  await redis.zrem(`publish_queue:${tenantId}`, postId);
}

export async function getQueueSize(tenantId: string): Promise<number> {
  return redis.zcard(`publish_queue:${tenantId}`);
}

// Rate limiting helpers for social platforms
export async function checkPlatformRateLimit(
  platform: string,
  windowMs: number,
  maxRequests: number
): Promise<boolean> {
  const key = `ratelimit:${platform}:${Math.floor(Date.now() / windowMs)}`;
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, Math.ceil(windowMs / 1000));
  }
  return count <= maxRequests;
}
