import { Elysia } from 'elysia';
import { z } from 'zod';
import { db } from '../../lib/db.js';
import { socialAccounts } from '../../db/schema.js';
import { and, eq } from 'drizzle-orm';
import { tenantMiddleware } from '../middleware/tenant.js';
import { authMiddleware } from '../middleware/auth.js';
import { createRateLimiter } from '../middleware/rateLimiter.js';
import { config as appConfig } from '../../lib/config.js';
import { decryptToken, encryptToken } from '../../lib/encryption.js';
import { logger } from '../../lib/logger.js';
import {
  exchangeYouTubeCode,
  fetchVideoFromUrl,
  getYouTubeAuthUrl,
  getYouTubeChannel,
  getYouTubeDefaultPrivacy,
  inferYouTubeVideoKind,
  refreshYouTubeToken,
  setYouTubeThumbnail,
  uploadYouTubeVideo,
  type YouTubeOAuthConfig,
  type YouTubeVideoKind,
} from '../../integrations/youtube/client.js';

const log = logger.child({ module: 'youtube-route' });

const connectSchema = z.object({
  state: z.string().optional(),
});

const uploadSchema = z.object({
  socialAccountId: z.string().uuid(),
  videoUrl: z.string().url(),
  title: z.string().min(1).max(100),
  description: z.string().max(5000).default(''),
  tags: z.array(z.string().max(500)).max(500).default([]),
  categoryId: z.string().max(20).optional(),
  privacyStatus: z.enum(['public', 'unlisted', 'private']).optional(),
  madeForKids: z.boolean().default(false),
  defaultLanguage: z.string().max(10).optional(),
  thumbnailUrl: z.string().url().optional(),
  durationSeconds: z.number().int().min(1).optional(),
  kind: z.enum(['short', 'long']).optional(),
});

const statusSchema = z.object({
  socialAccountId: z.string().uuid(),
  videoId: z.string().min(1).max(64),
});

function getOAuthConfig(): YouTubeOAuthConfig | null {
  if (!appConfig.YOUTUBE_CLIENT_ID || !appConfig.YOUTUBE_CLIENT_SECRET) {
    return null;
  }
  return {
    clientId: appConfig.YOUTUBE_CLIENT_ID,
    clientSecret: appConfig.YOUTUBE_CLIENT_SECRET,
    redirectUri: `${appConfig.BETTER_AUTH_URL}/api/v1/oauth/youtube/callback`,
  };
}

function getRedirectUri(): string {
  return `${appConfig.BETTER_AUTH_URL}/api/v1/oauth/youtube/callback`;
}

async function getDecryptedAccessToken(
  tenantId: string,
  socialAccountId: string
): Promise<{ accessToken: string; accountId: string } | null> {
  const [account] = await db
    .select()
    .from(socialAccounts)
    .where(
      and(
        eq(socialAccounts.id, socialAccountId),
        eq(socialAccounts.tenantId, tenantId),
        eq(socialAccounts.platform, 'youtube')
      )
    )
    .limit(1);

  if (!account || !account.accessTokenEncrypted) {
    return null;
  }

  const oauthConfig = getOAuthConfig();
  let accessToken: string;
  try {
    accessToken = decryptToken(account.accessTokenEncrypted);
  } catch (err) {
    log.error({ err, socialAccountId }, 'Failed to decrypt YouTube access token');
    return null;
  }

  if (
    account.tokenExpiresAt &&
    account.tokenExpiresAt.getTime() - Date.now() < 5 * 60 * 1000 &&
    account.refreshTokenEncrypted &&
    oauthConfig
  ) {
    try {
      const refreshed = await refreshYouTubeToken(oauthConfig, decryptToken(account.refreshTokenEncrypted));
      accessToken = refreshed.accessToken;
      await db
        .update(socialAccounts)
        .set({
          accessTokenEncrypted: encryptToken(refreshed.accessToken),
          tokenExpiresAt: refreshed.expiresAt,
          updatedAt: new Date(),
        })
        .where(eq(socialAccounts.id, socialAccountId));
    } catch (err) {
      log.error({ err, socialAccountId }, 'YouTube token refresh failed');
    }
  }

  return { accessToken, accountId: account.accountId };
}

export const youtubeRoutes = new Elysia({ prefix: '/api/v1/youtube' })
  .use(createRateLimiter('authenticated') as any)
  .use(authMiddleware)
  .use(tenantMiddleware)
  .get('/connect', ({ query, set }: any) => {
    const oauthConfig = getOAuthConfig();
    if (!oauthConfig) {
      set.status = 500;
      return { error: 'YouTube OAuth not configured' };
    }
    const { state } = connectSchema.parse(query);
    const authUrl = getYouTubeAuthUrl(oauthConfig, state ?? crypto.randomUUID());
    return { authUrl, state: state ?? null };
  })
  .get('/callback', async ({ query, tenantId, set }: any) => {
    const code = query.code as string | undefined;
    if (!code) {
      set.status = 400;
      return { error: 'Missing authorization code' };
    }

    const oauthConfig = getOAuthConfig();
    if (!oauthConfig) {
      set.status = 500;
      return { error: 'YouTube OAuth not configured' };
    }

    try {
      const tokens = await exchangeYouTubeCode(oauthConfig, code);
      const channel = await getYouTubeChannel(tokens.accessToken).catch(() => null);

      const [account] = await db
        .insert(socialAccounts)
        .values({
          tenantId,
          platform: 'youtube',
          accountId: channel?.channelId ?? 'pending',
          username: channel?.title ?? null,
          displayName: channel?.title ?? null,
          avatarUrl: channel?.thumbnailUrl ?? null,
          accessTokenEncrypted: encryptToken(tokens.accessToken),
          refreshTokenEncrypted: tokens.refreshToken ? encryptToken(tokens.refreshToken) : null,
          tokenExpiresAt: tokens.expiresAt,
          scopes: tokens.scope ? tokens.scope.split(' ') : [
            'https://www.googleapis.com/auth/youtube.upload',
            'https://www.googleapis.com/auth/youtube.force-ssl',
            'https://www.googleapis.com/auth/youtube.readonly',
          ],
          status: 'active',
        })
        .returning();

      log.info({ accountId: account.id, channelId: channel?.channelId }, 'YouTube account connected');
      return {
        success: true,
        account: {
          id: account.id,
          platform: account.platform,
          channelId: channel?.channelId,
          title: channel?.title,
        },
      };
    } catch (err) {
      log.error({ err }, 'YouTube OAuth callback failed');
      set.status = 500;
      return { error: 'Failed to complete YouTube OAuth flow' };
    }
  })
  .post('/upload', async ({ body, tenantId, set }: any) => {
    const input = uploadSchema.parse(body);

    const creds = await getDecryptedAccessToken(tenantId, input.socialAccountId);
    if (!creds) {
      set.status = 404;
      return { error: 'YouTube social account not found' };
    }

    const kind: YouTubeVideoKind =
      input.kind ?? (input.durationSeconds !== undefined ? inferYouTubeVideoKind(input.durationSeconds) : 'long');

    try {
      const { buffer, mimeType } = await fetchVideoFromUrl(input.videoUrl);

      const upload = await uploadYouTubeVideo({
        accessToken: creds.accessToken,
        videoBuffer: buffer,
        mimeType,
        kind,
        metadata: {
          title: kind === 'short' && !input.title.toLowerCase().includes('#shorts')
            ? `${input.title} #Shorts`.slice(0, 100)
            : input.title,
          description: input.description,
          tags: input.tags,
          categoryId: input.categoryId,
          privacyStatus: input.privacyStatus ?? getYouTubeDefaultPrivacy(kind),
          madeForKids: input.madeForKids,
          defaultLanguage: input.defaultLanguage,
        },
      });

      if (input.thumbnailUrl) {
        try {
          const thumbRes = await fetch(input.thumbnailUrl, { signal: AbortSignal.timeout(60000) });
          if (thumbRes.ok) {
            const imageBuffer = await thumbRes.arrayBuffer();
            const rawType = thumbRes.headers.get('content-type') ?? 'image/jpeg';
            const thumbMime: 'image/jpeg' | 'image/png' =
              rawType.includes('png') ? 'image/png' : 'image/jpeg';
            await setYouTubeThumbnail({
              accessToken: creds.accessToken,
              videoId: upload.videoId,
              imageBuffer,
              mimeType: thumbMime,
            });
          }
        } catch (thumbErr) {
          log.warn({ err: thumbErr, videoId: upload.videoId }, 'YouTube thumbnail upload failed, continuing');
        }
      }

      return {
        success: true,
        videoId: upload.videoId,
        status: upload.status,
        uploadStatus: upload.uploadStatus,
        kind,
        videoUrl: `https://youtu.be/${upload.videoId}`,
      };
    } catch (err) {
      log.error({ err, tenantId, socialAccountId: input.socialAccountId }, 'YouTube upload failed');
      set.status = 500;
      return {
        success: false,
        error: err instanceof Error ? err.message : 'YouTube upload failed',
      };
    }
  })
  .get('/status', async ({ query, tenantId, set }: any) => {
    const input = statusSchema.parse(query);
    const creds = await getDecryptedAccessToken(tenantId, input.socialAccountId);
    if (!creds) {
      set.status = 404;
      return { error: 'YouTube social account not found' };
    }

    try {
      const res = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=status,processingDetails,snippet&id=${encodeURIComponent(input.videoId)}`,
        {
          headers: { Authorization: `Bearer ${creds.accessToken}` },
          signal: AbortSignal.timeout(10000),
        }
      );
      if (!res.ok) {
        set.status = res.status;
        return { error: `YouTube status check failed: ${res.status}` };
      }
      const data = (await res.json()) as {
        items?: Array<{
          id: string;
          snippet?: { title?: string; publishedAt?: string };
          status?: { uploadStatus?: string; privacyStatus?: string; failureReason?: string };
          processingDetails?: { processingStatus?: string };
        }>;
      };
      const item = data.items?.[0];
      if (!item) {
        set.status = 404;
        return { error: 'YouTube video not found' };
      }
      return {
        videoId: item.id,
        title: item.snippet?.title,
        publishedAt: item.snippet?.publishedAt,
        uploadStatus: item.status?.uploadStatus,
        privacyStatus: item.status?.privacyStatus,
        processingStatus: item.processingDetails?.processingStatus,
        failureReason: item.status?.failureReason,
        videoUrl: `https://youtu.be/${item.id}`,
      };
    } catch (err) {
      log.error({ err, videoId: input.videoId }, 'YouTube status check failed');
      set.status = 500;
      return { error: err instanceof Error ? err.message : 'Status check failed' };
    }
  })
  .get('/channel', async ({ query, tenantId, set }: any) => {
    const socialAccountId = query.socialAccountId as string | undefined;
    if (!socialAccountId) {
      set.status = 400;
      return { error: 'socialAccountId is required' };
    }
    const creds = await getDecryptedAccessToken(tenantId, socialAccountId);
    if (!creds) {
      set.status = 404;
      return { error: 'YouTube social account not found' };
    }
    try {
      const channel = await getYouTubeChannel(creds.accessToken);
      return { channel };
    } catch (err) {
      log.error({ err, socialAccountId }, 'YouTube channel fetch failed');
      set.status = 500;
      return { error: err instanceof Error ? err.message : 'Channel fetch failed' };
    }
  });

export { getRedirectUri as getYouTubeRedirectUri };
