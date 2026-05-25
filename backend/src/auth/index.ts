import { betterAuth } from 'better-auth';
import { getConfig } from '../lib/config.js';
import { logger } from '../lib/logger.js';

const cfg = getConfig();

export const auth = betterAuth({
  secret: cfg.BETTER_AUTH_SECRET,
  baseURL: cfg.BETTER_AUTH_URL,
  database: {
    url: cfg.DATABASE_URL,
    type: 'postgresql',
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24,      // 1 day
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5, // 5 min
    },
  },
  emailAndPassword: {
    enabled: true,
  },
  advanced: {
    database: {
      generateId: () => crypto.randomUUID(),
    },
  },
});

logger.info('Better Auth initialized for hiai-post');
