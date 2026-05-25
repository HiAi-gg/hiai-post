import { logger } from '../lib/logger.js';
import { db } from '../lib/db.js';
import { socialAccounts } from '../db/schema.js';
import { eq, and, lt, isNotNull } from 'drizzle-orm';
import { decryptToken, encryptToken } from '../lib/encryption.js';

const log = logger.child({ module: 'oauth-refresh' });

const REFRESH_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000; // refresh 5 min before expiry
const FETCH_TIMEOUT_MS = 10_000; // 10 seconds

export function startOAuthRefreshWorker(): void {
  log.info('Starting OAuth token refresh worker');

  setInterval(async () => {
    try {
      const now = new Date();
      const soonExpiry = new Date(now.getTime() + TOKEN_EXPIRY_BUFFER_MS);

      const expiringAccounts = await db
        .select()
        .from(socialAccounts)
        .where(
          and(
            isNotNull(socialAccounts.refreshTokenEncrypted),
            lt(socialAccounts.tokenExpiresAt, soonExpiry),
          ),
        );

      if (expiringAccounts.length === 0) return;

      log.info({ count: expiringAccounts.length }, 'Refreshing expiring OAuth tokens');

      for (const account of expiringAccounts) {
        try {
          await refreshToken(account);
        } catch (err) {
          log.error(
            { accountId: account.id, platform: account.platform, error: String(err) },
            'Token refresh failed',
          );
        }
      }
    } catch (err) {
      log.error({ error: String(err) }, 'OAuth refresh worker error');
    }
  }, REFRESH_INTERVAL_MS);
}

async function refreshToken(account: {
  id: string;
  platform: string;
  refreshTokenEncrypted: string | null;
  accessTokenEncrypted: string | null;
}) {
  if (!account.refreshTokenEncrypted) {
    log.warn({ accountId: account.id }, 'No refresh token available');
    return;
  }

  const refreshToken = decryptToken(account.refreshTokenEncrypted);
  let tokenResponse: { access_token: string; refresh_token?: string; expires_in: number };

  switch (account.platform) {
    case 'instagram':
    case 'facebook':
      tokenResponse = await refreshMetaToken(refreshToken);
      break;
    case 'x':
    case 'x-post':
      tokenResponse = await refreshXTokens(refreshToken);
      break;
    case 'linkedin':
      tokenResponse = await refreshLinkedInToken(refreshToken);
      break;
    case 'threads':
      tokenResponse = await refreshMetaToken(refreshToken);
      break;
    case 'pinterest':
      tokenResponse = await refreshPinterestToken(refreshToken);
      break;
    default:
      log.warn({ platform: account.platform }, 'No refresh strategy for platform');
      return;
  }

  const expiresAt = new Date(Date.now() + tokenResponse.expires_in * 1000);

  await db
    .update(socialAccounts)
    .set({
      accessTokenEncrypted: encryptToken(tokenResponse.access_token),
      refreshTokenEncrypted: tokenResponse.refresh_token
        ? encryptToken(tokenResponse.refresh_token)
        : account.refreshTokenEncrypted,
      tokenExpiresAt: expiresAt,
      updatedAt: new Date(),
    })
    .where(eq(socialAccounts.id, account.id));

  log.info(
    { accountId: account.id, platform: account.platform, expiresAt },
    'Token refreshed successfully',
  );
}

/**
 * Fetch with AbortController timeout and rate-limit detection.
 */
async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (res.status === 429) {
      log.warn({ url }, 'Rate limited by platform API (429)');
      throw new Error('Rate limited (429)');
    }
    return res;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Validate that a token response has the required fields.
 */
function validateTokenResponse(data: unknown, platform: string): { access_token: string; refresh_token?: string; expires_in: number } {
  if (!data || typeof data !== 'object') {
    throw new Error(`${platform} refresh returned invalid response: ${JSON.stringify(data)}`);
  }
  const obj = data as Record<string, unknown>;
  if (typeof obj.access_token !== 'string' || !obj.access_token) {
    throw new Error(`${platform} refresh returned no access_token: ${JSON.stringify(data)}`);
  }
  if (typeof obj.expires_in !== 'number') {
    throw new Error(`${platform} refresh returned no expires_in: ${JSON.stringify(data)}`);
  }
  return {
    access_token: obj.access_token as string,
    refresh_token: typeof obj.refresh_token === 'string' ? obj.refresh_token as string : undefined,
    expires_in: obj.expires_in as number,
  };
}

async function refreshMetaToken(refreshToken: string) {
  const res = await fetchWithTimeout(
    `https://graph.facebook.com/v19.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${process.env.META_APP_ID}&client_secret=${process.env.META_APP_SECRET}&fb_exchange_token=${refreshToken}`,
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Meta refresh failed (${res.status}): ${body}`);
  }
  const data = await res.json();
  return validateTokenResponse(data, 'Meta');
}

async function refreshXTokens(refreshToken: string) {
  const res = await fetchWithTimeout('https://api.x.com/2/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: process.env.X_CLIENT_ID!,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`X refresh failed (${res.status}): ${body}`);
  }
  const data = await res.json();
  return validateTokenResponse(data, 'X');
}

async function refreshLinkedInToken(refreshToken: string) {
  const res = await fetchWithTimeout('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: process.env.LINKEDIN_CLIENT_ID!,
      client_secret: process.env.LINKEDIN_CLIENT_SECRET!,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LinkedIn refresh failed (${res.status}): ${body}`);
  }
  const data = await res.json();
  return validateTokenResponse(data, 'LinkedIn');
}

async function refreshPinterestToken(refreshToken: string) {
  const res = await fetchWithTimeout('https://api.pinterest.com/v5/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: process.env.PINTEREST_APP_ID!,
      client_secret: process.env.PINTEREST_APP_SECRET!,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Pinterest refresh failed (${res.status}): ${body}`);
  }
  const data = await res.json();
  return validateTokenResponse(data, 'Pinterest');
}
