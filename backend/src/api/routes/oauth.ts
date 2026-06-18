import { Elysia } from 'elysia';
import { config as appConfig } from '../../lib/config.js';
import { db } from '../../lib/db.js';
import { socialAccounts } from '../../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { tenantMiddleware } from '../middleware/tenant.js';
import { authMiddleware } from '../middleware/auth.js';
import { createRateLimiter } from '../middleware/rateLimiter.js';
import { encryptToken } from '../../lib/encryption.js';
import { generateState, validateState } from '../../lib/oauth-state.js';
import { logger } from '../../lib/logger.js';

const log = logger.child({ module: 'oauth-route' });

interface OAuthConfig {
  authUrl: string;
  tokenUrl: string;
  scopes: string[];
}

const OAUTH_CONFIGS: Record<string, OAuthConfig> = {
  instagram: {
    authUrl: 'https://api.instagram.com/oauth/authorize',
    tokenUrl: 'https://api.instagram.com/oauth/access_token',
    scopes: ['instagram_basic', 'instagram_content_publish', 'instagram_manage_insights'],
  },
  facebook: {
    authUrl: 'https://www.facebook.com/v19.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v19.0/oauth/access_token',
    scopes: ['pages_manage_posts', 'pages_read_engagement', 'pages_show_list'],
  },
  x: {
    authUrl: 'https://x.com/i/oauth2/authorize',
    tokenUrl: 'https://api.x.com/2/oauth2/token',
    scopes: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'],
  },
  linkedin: {
    authUrl: 'https://www.linkedin.com/oauth/v2/authorization',
    tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
    scopes: ['w_member_social', 'r_liteprofile', 'r_emailaddress'],
  },
  tiktok: {
    authUrl: 'https://www.tiktok.com/v2/auth/authorize/',
    tokenUrl: 'https://open.tiktokapis.com/v2/oauth/token/',
    scopes: ['user.info.basic', 'video.publish', 'video.list'],
  },
  threads: {
    authUrl: 'https://threads.net/oauth/authorize',
    tokenUrl: 'https://graph.threads.net/oauth/access_token',
    scopes: ['threads_basic', 'threads_content_publish', 'threads_manage_insights'],
  },
  pinterest: {
    authUrl: 'https://www.pinterest.com/oauth/',
    tokenUrl: 'https://api.pinterest.com/v5/oauth/token',
    scopes: ['boards:read', 'pins:read', 'pins:write'],
  },
  youtube: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: [
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube.force-ssl',
      'https://www.googleapis.com/auth/youtube.readonly',
    ],
  },
};

function getClientId(platform: string): string {
  const map: Record<string, string> = {
    instagram: appConfig.INSTAGRAM_APP_ID,
    facebook: appConfig.META_APP_ID,
    x: appConfig.X_CLIENT_ID,
    linkedin: appConfig.LINKEDIN_CLIENT_ID,
    tiktok: appConfig.TIKTOK_CLIENT_KEY,
    threads: appConfig.THREADS_APP_ID || appConfig.INSTAGRAM_APP_ID,
    pinterest: appConfig.PINTEREST_APP_ID,
    youtube: appConfig.YOUTUBE_CLIENT_ID,
  };
  return map[platform] || '';
}

function getClientSecret(platform: string): string {
  const map: Record<string, string> = {
    instagram: appConfig.INSTAGRAM_APP_SECRET,
    facebook: appConfig.META_APP_SECRET,
    x: appConfig.X_CLIENT_SECRET,
    linkedin: appConfig.LINKEDIN_CLIENT_SECRET,
    tiktok: appConfig.TIKTOK_CLIENT_SECRET,
    threads: appConfig.THREADS_APP_SECRET || appConfig.INSTAGRAM_APP_SECRET,
    pinterest: appConfig.PINTEREST_APP_SECRET,
    youtube: appConfig.YOUTUBE_CLIENT_SECRET,
  };
  return map[platform] || '';
}

export const oauthRoutes = new Elysia({ prefix: '/api/v1/oauth' })
  .use(createRateLimiter('authenticated') as any)
  .use(authMiddleware)
  .use(tenantMiddleware)
  .get("/:platform/connect", async ({ params, set, tenantId }: any) => {
    const platformConfig = OAUTH_CONFIGS[params.platform];
    if (!platformConfig) {
      set.status = 400;
      return { error: `Unsupported platform: ${params.platform}` };
    }

    const clientId = getClientId(params.platform);
    if (!clientId) {
      set.status = 500;
      return { error: `Platform ${params.platform} not configured` };
    }

    const redirectUri = `${appConfig.BETTER_AUTH_URL}/api/v1/oauth/${params.platform}/callback`;
    const { state } = await generateState({
      platform: params.platform,
      tenantId,
    });

    const authUrl = new URL(platformConfig.authUrl);
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('scope', platformConfig.scopes.join(','));
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('response_type', 'code');

    if (params.platform === 'x') {
      authUrl.searchParams.set('code_challenge', state);
      authUrl.searchParams.set('code_challenge_method', 'plain');
    }

    return { authUrl: authUrl.toString(), state };
  })
  .get('/:platform/callback', async ({ params, query, tenantId, set }: any) => {
    const code = query.code as string;
    if (!code) {
      set.status = 400;
      return { error: 'Missing authorization code' };
    }

    const stateParam = query.state as string;
    const statePayload = await validateState(stateParam);
    if (!statePayload) {
      log.warn({ platform: params.platform }, 'OAuth callback rejected: invalid state');
      set.status = 400;
      return { error: 'Invalid or expired state parameter' };
    }
    if (statePayload.platform !== params.platform) {
      log.warn(
        { expected: params.platform, got: statePayload.platform },
        'OAuth callback rejected: state platform mismatch'
      );
      set.status = 400;
      return { error: 'State platform mismatch' };
    }
    if (statePayload.tenantId && tenantId && statePayload.tenantId !== tenantId) {
      log.warn(
        { stateTenant: statePayload.tenantId, sessionTenant: tenantId },
        'OAuth callback rejected: tenant mismatch'
      );
      set.status = 403;
      return { error: 'Tenant mismatch' };
    }

    const platformConfig = OAUTH_CONFIGS[params.platform];
    if (!platformConfig) {
      set.status = 400;
      return { error: `Unsupported platform: ${params.platform}` };
    }

    const clientId = getClientId(params.platform);
    const clientSecret = getClientSecret(params.platform);
    const redirectUri = `${appConfig.BETTER_AUTH_URL}/api/v1/oauth/${params.platform}/callback`;

    try {
      // Exchange code for token
      const body: Record<string, string> = {
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      };

      if (params.platform === 'x') {
        body.code_verifier = 'challenge';
      }

      const tokenResponse = await fetch(platformConfig.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(body),
        signal: AbortSignal.timeout(10000),
      });

      if (!tokenResponse.ok) {
        const err = await tokenResponse.text();
        log.error({ err, platform: params.platform }, 'Token exchange failed');
        set.status = 400;
        return { error: 'Failed to exchange authorization code' };
      }

      const tokenData = (await tokenResponse.json()) as Record<string, unknown>;
      const accessToken = tokenData.access_token as string;
      const refreshToken = tokenData.refresh_token as string | undefined;
      const expiresIn = tokenData.expires_in as number | undefined;
      const scope = tokenData.scope as string | undefined;

      // Fetch user info from platform
      let accountId = '';
      let username = '';
      let displayName = '';
      let avatarUrl = '';

      if (params.platform === 'instagram' || params.platform === 'facebook') {
        const meRes = await fetch(`https://graph.facebook.com/me?fields=id,name,picture`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(10000),
        });
        if (meRes.ok) {
          const me = (await meRes.json()) as Record<string, unknown>;
          accountId = String(me.id);
          displayName = String(me.name || '');
        }
      } else if (params.platform === 'x') {
        const meRes = await fetch('https://api.x.com/2/users/me', {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(10000),
        });
        if (meRes.ok) {
          const me = (await meRes.json()) as { data?: Record<string, unknown> };
          accountId = String(me.data?.id || '');
          username = String(me.data?.username || '');
          displayName = String(me.data?.name || '');
        }
      } else if (params.platform === 'linkedin') {
        const meRes = await fetch('https://api.linkedin.com/v2/me', {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(10000),
        });
        if (meRes.ok) {
          const me = (await meRes.json()) as Record<string, unknown>;
          accountId = String(me.id || '');
          displayName = `${me.localizedFirstName || ''} ${me.localizedLastName || ''}`.trim();
        }
      } else if (params.platform === 'youtube') {
        const meRes = await fetch(
          'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
          {
            headers: { Authorization: `Bearer ${accessToken}` },
            signal: AbortSignal.timeout(10000),
          }
        );
        if (meRes.ok) {
          const me = (await meRes.json()) as {
            items?: Array<{
              id: string;
              snippet?: {
                title?: string;
                customUrl?: string;
                thumbnails?: { default?: { url?: string } };
              };
            }>;
          };
          const channel = me.items?.[0];
          if (channel) {
            accountId = channel.id;
            displayName = String(channel.snippet?.title || '');
            username = String(channel.snippet?.customUrl || '');
            avatarUrl = String(channel.snippet?.thumbnails?.default?.url || '');
          }
        }
      }

      // Encrypt tokens and store
      const [account] = await db
        .insert(socialAccounts)
        .values({
          tenantId,
          platform: params.platform,
          accountId,
          username,
          displayName,
          avatarUrl,
          accessTokenEncrypted: encryptToken(accessToken),
          refreshTokenEncrypted: refreshToken ? encryptToken(refreshToken) : null,
          tokenExpiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
          scopes: scope ? scope.split(' ') : platformConfig.scopes,
          status: 'active',
        })
        .returning();

      log.info({ platform: params.platform, accountId }, 'Social account connected');
      return { success: true, account: { id: account.id, platform: account.platform, username: account.username } };
    } catch (err) {
      log.error({ err, platform: params.platform }, 'OAuth callback error');
      set.status = 500;
      return { error: 'Failed to complete OAuth flow' };
    }
  });
