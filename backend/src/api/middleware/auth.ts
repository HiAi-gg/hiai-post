import { Elysia } from 'elysia';
import { getConfig } from '../../lib/config.js';
import { logger } from '../../lib/logger.js';

const cfg = getConfig();

interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

export const authMiddleware = new Elysia({ name: 'auth' })
  .derive(async ({ request, set }): Promise<{ user: AuthUser }> => {
    const authHeader = request.headers.get('Authorization');

    if (!authHeader?.startsWith('Bearer ')) {
      set.status = 401;
      throw new Error('Missing or invalid Authorization header');
    }

    const token = authHeader.slice(7);

    // Verify via Better Auth session token
    try {
      const response = await fetch(`${cfg.BETTER_AUTH_URL}/api/auth/get-session`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Cookie: `better-auth.session_token=${token}`,
        },
      });

      if (!response.ok) {
        set.status = 401;
        throw new Error('Invalid session');
      }

      const data = (await response.json()) as { user?: AuthUser; session?: { userId: string } };
      if (!data.user) {
        set.status = 401;
        throw new Error('No user in session');
      }

      return {
        user: data.user,
      };
    } catch (err) {
      logger.debug({ err }, 'Auth verification failed');
      set.status = 401;
      throw new Error('Authentication failed');
    }
  });
