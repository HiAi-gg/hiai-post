import { Elysia } from 'elysia';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getConfig } from '../../lib/config.js';
import { logger } from '../../lib/logger.js';

const cfg = getConfig();

interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

interface JwtPayload {
  sub?: string;
  email?: string;
  role?: string;
  name?: string;
  iat?: number;
  exp?: number;
}

/**
 * Verify an HS256 JWT minted by an external service (e.g. hiai-admin's
 * `mintBackendToken`). Uses `node:crypto` to avoid pulling `jose` just for
 * symmetric verification. Returns the payload claims on success or `null`
 * if the token is malformed, has a bad signature, or is expired.
 */
export function verifyAdminJwt(token: string, secret: string): JwtPayload | null {
  if (!secret) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signatureB64] = parts;
  const signingInput = `${headerB64}.${payloadB64}`;

  let header: { alg?: string };
  try {
    header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8')) as { alg?: string };
  } catch {
    return null;
  }
  if (header.alg !== 'HS256') return null;

  const expected = createHmac('sha256', secret).update(signingInput).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(signatureB64, 'base64url');
  } catch {
    return null;
  }
  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(provided, expected)) return null;

  let payload: JwtPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as JwtPayload;
  } catch {
    return null;
  }
  if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) return null;

  return payload;
}

function looksLikeJwt(token: string): boolean {
  return token.split('.').length === 3;
}

export const authMiddleware = new Elysia({ name: 'auth' })
  .derive(async ({ request, set }): Promise<{ user: AuthUser }> => {
    const authHeader = request.headers.get('Authorization');

    if (!authHeader?.startsWith('Bearer ')) {
      set.status = 401;
      throw new Error('Missing or invalid Authorization header');
    }

    const token = authHeader.slice(7);

    // Cross-service auth bridge (INT-POST): when an admin-issued HS256 token
    // arrives and the shared secret is configured, verify locally without
    // hitting Better Auth. This is the path hiai-admin's proxy takes.
    if (cfg.HIAI_ADMIN_JWT_SECRET && looksLikeJwt(token)) {
      const claims = verifyAdminJwt(token, cfg.HIAI_ADMIN_JWT_SECRET);
      if (claims?.sub && claims.email && claims.role) {
        return {
          user: {
            id: claims.sub,
            email: claims.email,
            name: claims.name ?? claims.email,
            role: claims.role,
          },
        };
      }
      logger.debug('HS256 admin JWT present but invalid; falling back to session');
    }

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
