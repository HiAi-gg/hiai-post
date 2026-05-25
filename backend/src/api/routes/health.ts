import { Elysia } from 'elysia';
import { checkDbHealth } from '../../lib/db.js';
import { checkRedisHealth } from '../../lib/redis.js';

export const healthRoutes = new Elysia()
  .get('/api/v1/health', async ({ set }) => {
    const dbOk = await checkDbHealth();
    const redisOk = await checkRedisHealth();

    const status = dbOk && redisOk ? 'ok' : 'degraded';

    if (status !== 'ok') {
      set.status = 503;
    }

    return {
      status,
      timestamp: new Date().toISOString(),
      services: {
        database: dbOk ? 'connected' : 'disconnected',
        redis: redisOk ? 'connected' : 'disconnected',
      },
    };
  });
