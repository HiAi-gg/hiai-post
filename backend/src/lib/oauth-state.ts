/**
 * OAuth state store — generates and validates signed state parameters
 * to prevent OAuth CSRF attacks (CWE-352).
 *
 * Pattern: state = base64url(JSON{csrf, ts, sig}) where sig = HMAC-SHA256(payload, secret)
 * Server stores: csrf -> state in Redis with 10-minute TTL.
 * Callback validates: HMAC matches, csrf matches Redis value, then deletes key.
 *
 * Requires env: OAUTH_STATE_SECRET (>= 32 bytes random)
 * Falls back to BETTER_AUTH_SECRET if OAUTH_STATE_SECRET is not set.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { redis } from './redis.js';
import { config } from './config.js';
import { logger } from './logger.js';

const log = logger.child({ module: 'oauth-state' });

const STATE_TTL_SECONDS = 600; // 10 minutes
const STATE_KEY_PREFIX = 'oauth:state:';

function getSecret(): string {
  const secret = config.OAUTH_STATE_SECRET || config.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) {
    log.warn(
      'OAUTH_STATE_SECRET is missing or too short (< 32 chars). Using BETTER_AUTH_SECRET fallback. Set OAUTH_STATE_SECRET in production.'
    );
  }
  return secret || 'dev-only-insecure-secret-do-not-use-in-prod-32+chars';
}

function sign(payload: string): string {
  return createHmac('sha256', getSecret()).update(payload).digest('base64url');
}

function verifySig(payload: string, sig: string): boolean {
  const expected = sign(payload);
  if (expected.length !== sig.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
  } catch {
    return false;
  }
}

function b64urlEncode(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64url');
}

function b64urlDecode(s: string): string {
  return Buffer.from(s, 'base64url').toString('utf8');
}

export interface OAuthState {
  /** Random CSRF token to bind in Redis */
  csrf: string;
  /** Unix ms when state was generated */
  ts: number;
  /** Tenant ID that initiated the flow (optional) */
  tenantId?: string;
  /** Platform (e.g. "instagram", "x") */
  platform: string;
}

export interface GenerateResult {
  /** State string to embed in the authorization URL */
  state: string;
  /** CSRF token to verify in the callback */
  csrf: string;
}

/**
 * Generate a signed OAuth state and store its CSRF token in Redis.
 * The returned `state` should be appended to the authorization URL.
 * The `csrf` token is also returned so callers can verify it themselves
 * if they prefer; otherwise validateState() handles it.
 */
export async function generateState(opts: { platform: string; tenantId?: string }): Promise<GenerateResult> {
  const csrf = randomBytes(32).toString('base64url');
  const payload: OAuthState = {
    csrf,
    ts: Date.now(),
    tenantId: opts.tenantId,
    platform: opts.platform,
  };
  const encoded = b64urlEncode(JSON.stringify(payload));
  const sig = sign(encoded);
  const state = `${encoded}.${sig}`;

  // Bind csrf -> state in Redis with TTL
  try {
    await redis.setex(`${STATE_KEY_PREFIX}${csrf}`, STATE_TTL_SECONDS, state);
  } catch (err) {
    log.error({ err }, 'Failed to store OAuth state in Redis');
    throw new Error('Failed to generate OAuth state');
  }

  return { state, csrf };
}

/**
 * Validate an OAuth state returned to the callback.
 * - Verifies HMAC signature
 * - Verifies csrf token was previously stored
 * - Deletes the stored state (one-time use)
 * - Returns the parsed payload (including tenantId) on success
 * - Returns null on any failure
 */
export async function validateState(state: string | null | undefined): Promise<OAuthState | null> {
  if (!state || typeof state !== 'string') return null;

  const parts = state.split('.');
  if (parts.length !== 2) return null;

  const [encoded, sig] = parts;
  if (!encoded || !sig) return null;

  // 1. Verify HMAC
  if (!verifySig(encoded, sig)) {
    log.warn('OAuth state HMAC verification failed');
    return null;
  }

  // 2. Decode payload
  let payload: OAuthState;
  try {
    payload = JSON.parse(b64urlDecode(encoded)) as OAuthState;
  } catch {
    return null;
  }

  if (!payload.csrf || !payload.ts || !payload.platform) return null;

  // 3. Check timestamp (defense-in-depth even though Redis TTL handles expiry)
  if (Date.now() - payload.ts > STATE_TTL_SECONDS * 1000) return null;

  // 4. Verify csrf in Redis (one-time use via GETDEL)
  let stored: string | null = null;
  try {
    stored = await redis.getdel(`${STATE_KEY_PREFIX}${payload.csrf}`);
  } catch (err) {
    log.error({ err }, 'Failed to read OAuth state from Redis');
    return null;
  }

  if (!stored) {
    log.warn({ platform: payload.platform }, 'OAuth state not found in Redis (expired or already used)');
    return null;
  }

  if (stored !== state) {
    log.warn({ platform: payload.platform }, 'OAuth state mismatch (possible tampering)');
    return null;
  }

  return payload;
}
