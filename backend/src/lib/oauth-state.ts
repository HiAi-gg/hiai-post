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
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { redis } from "./redis.js";

const log = logger.child({ module: "oauth-state" });

const STATE_TTL_SECONDS = 600; // 10 minutes
const STATE_KEY_PREFIX = "oauth:state:";

function getSecret(): string {
  const secret = config.OAUTH_STATE_SECRET || config.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) {
    log.warn(
      "OAUTH_STATE_SECRET is missing or too short (< 32 chars). Using BETTER_AUTH_SECRET fallback. Set OAUTH_STATE_SECRET in production."
    );
  }
  return secret || "dev-only-insecure-secret-do-not-use-in-prod-32+chars";
}

function sign(payload: string): string {
  return createHmac("sha256", getSecret()).update(payload).digest("base64url");
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
  return Buffer.from(s, "utf8").toString("base64url");
}

function b64urlDecode(s: string): string {
  return Buffer.from(s, "base64url").toString("utf8");
}

export interface OAuthState {
  /** Random CSRF token to bind in Redis */
  csrf: string;
  /** Unix ms when state was generated */
  ts: number;
  /** Tenant ID that initiated the flow (optional) */
  tenantId?: string;
  /** User ID that initiated the flow (optional) */
  userId?: string;
  /** Platform (e.g. "instagram", "x") */
  platform: string;
}

export interface GenerateOptions {
  platform: string;
  tenantId?: string;
  userId?: string;
  /**
   * Generate and store a random PKCE `code_verifier` for the flow (X/Twitter).
   * The verifier is kept server-side in the same one-time Redis record as the
   * state and is returned to the caller so the connect route can build the
   * `code_challenge`. It is never embedded in the state string.
   */
  pkce?: boolean;
}

export interface GenerateResult {
  /** State string to embed in the authorization URL */
  state: string;
  /** CSRF token to verify in the callback */
  csrf: string;
  /** PKCE `code_verifier` (only when `pkce: true` was requested) */
  pkceVerifier?: string;
}

/** Validated state payload plus any server-stored PKCE verifier. */
export interface ValidatedState extends OAuthState {
  /** PKCE `code_verifier` recovered from the one-time Redis record */
  pkceVerifier?: string;
}

/**
 * Derive the S256 PKCE `code_challenge` for a verifier, per RFC 7636:
 * challenge = base64url(sha256(verifier)).
 */
export function createPkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/**
 * Generate a signed OAuth state and store its CSRF token in Redis.
 * The returned `state` should be appended to the authorization URL.
 * The `csrf` token is also returned so callers can verify it themselves
 * if they prefer; otherwise validateState() handles it.
 *
 * When `pkce: true` a random `code_verifier` is generated and stored in the
 * same one-time Redis record as the state so the callback can replay it into
 * the token exchange (X/Twitter require PKCE).
 */
export async function generateState(opts: GenerateOptions): Promise<GenerateResult> {
  const csrf = randomBytes(32).toString("base64url");
  const pkceVerifier = opts.pkce ? randomBytes(32).toString("base64url") : undefined;
  const payload: OAuthState = {
    csrf,
    ts: Date.now(),
    tenantId: opts.tenantId,
    userId: opts.userId,
    platform: opts.platform,
  };
  const encoded = b64urlEncode(JSON.stringify(payload));
  const sig = sign(encoded);
  const state = `${encoded}.${sig}`;

  // Bind csrf -> { state, verifier? } in Redis with TTL
  try {
    await redis.setex(
      `${STATE_KEY_PREFIX}${csrf}`,
      STATE_TTL_SECONDS,
      JSON.stringify(pkceVerifier ? { state, verifier: pkceVerifier } : { state })
    );
  } catch (err) {
    log.error({ err }, "Failed to store OAuth state in Redis");
    throw new Error("Failed to generate OAuth state");
  }

  return { state, csrf, pkceVerifier };
}

/**
 * Validate an OAuth state returned to the callback.
 * - Verifies HMAC signature
 * - Verifies csrf token was previously stored
 * - Deletes the stored state (one-time use)
 * - Returns the parsed payload (including tenantId/userId and any stored
 *   PKCE verifier) on success
 * - Returns null on any failure
 */
export async function validateState(
  state: string | null | undefined
): Promise<ValidatedState | null> {
  if (!state || typeof state !== "string") return null;

  const parts = state.split(".");
  if (parts.length !== 2) return null;

  const [encoded, sig] = parts;
  if (!encoded || !sig) return null;

  // 1. Verify HMAC
  if (!verifySig(encoded, sig)) {
    log.warn("OAuth state HMAC verification failed");
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
    log.error({ err }, "Failed to read OAuth state from Redis");
    return null;
  }

  if (!stored) {
    log.warn(
      { platform: payload.platform },
      "OAuth state not found in Redis (expired or already used)"
    );
    return null;
  }

  // 5. Recover the stored value. New records are JSON `{ state, verifier? }`;
  //    legacy records (pre-PKCE) are the raw state string.
  let storedState = stored;
  let pkceVerifier: string | undefined;
  try {
    const parsed = JSON.parse(stored) as { state?: string; verifier?: string };
    if (parsed && typeof parsed === "object" && typeof parsed.state === "string") {
      storedState = parsed.state;
      pkceVerifier = parsed.verifier;
    }
  } catch {
    // Not JSON — legacy raw state string, keep `stored` as-is.
  }

  if (storedState !== state) {
    log.warn({ platform: payload.platform }, "OAuth state mismatch (possible tampering)");
    return null;
  }

  return { ...payload, pkceVerifier };
}
