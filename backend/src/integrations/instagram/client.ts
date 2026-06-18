/**
 * Instagram OAuth integration — uses Facebook Graph API OAuth under the hood.
 * OAuth: https://www.facebook.com/v19.0/dialog/oauth
 * Token: https://graph.facebook.com/v19.0/oauth/access_token
 * API: https://graph.facebook.com/v19.0/
 * Scopes: instagram_basic,instagram_content_publish,pages_show_list
 */

import { encryptToken } from '../../lib/encryption.js';
import { logger } from '../../lib/logger.js';

const INSTAGRAM_AUTH_URL = 'https://www.facebook.com/v19.0/dialog/oauth';
const INSTAGRAM_TOKEN_URL = 'https://graph.facebook.com/v19.0/oauth/access_token';
const INSTAGRAM_GRAPH_URL = 'https://graph.facebook.com/v19.0';

export interface InstagramOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface InstagramTokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date;
}

export interface InstagramProfile {
  id: string;
  name?: string;
  username?: string;
  picture?: string;
  igBusinessAccount?: {
    id: string;
    name?: string;
    username?: string;
  };
}

export interface InstagramPublishResult {
  success: boolean;
  postId?: string;
  error?: string;
}

export interface InstagramPublishOptions {
  accessToken: string;
  igAccountId: string;
  caption: string;
  mediaUrl?: string;
  mediaType?: 'IMAGE' | 'VIDEO' | 'REELS' | 'CAROUSEL';
  carouselChildren?: string[];
}

export function getInstagramAuthUrl(config: InstagramOAuthConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: 'instagram_basic,instagram_content_publish,pages_show_list',
    response_type: 'code',
    state,
  });
  return `${INSTAGRAM_AUTH_URL}?${params}`;
}

export async function exchangeInstagramCode(
  config: InstagramOAuthConfig,
  code: string,
): Promise<InstagramTokenResponse> {
  const params = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: 'authorization_code',
    redirect_uri: config.redirectUri,
    code,
  });

  const response = await fetch(INSTAGRAM_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const err = await response.text();
    logger.error({ status: response.status, error: err }, 'Instagram token exchange failed');
    throw new Error(`Instagram token exchange failed: ${response.status}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in?: number;
  };

  return {
    accessToken: data.access_token,
    expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : new Date(Date.now() + 3600_000),
  };
}

export async function refreshInstagramToken(
  config: InstagramOAuthConfig,
  refreshToken: string,
): Promise<InstagramTokenResponse> {
  const response = await fetch(
    `${INSTAGRAM_TOKEN_URL}?grant_type=fb_exchange_token&client_id=${config.clientId}&client_secret=${config.clientSecret}&fb_exchange_token=${refreshToken}`,
    { method: 'GET', signal: AbortSignal.timeout(15000) },
  );

  if (!response.ok) {
    const err = await response.text();
    logger.error({ status: response.status, error: err }, 'Instagram token refresh failed');
    throw new Error(`Instagram token refresh failed: ${response.status}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in?: number;
  };

  return {
    accessToken: data.access_token,
    expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : new Date(Date.now() + 3600_000),
  };
}

export async function getInstagramUserProfile(accessToken: string): Promise<InstagramProfile> {
  const response = await fetch(
    `${INSTAGRAM_GRAPH_URL}/me?fields=id,name,picture&access_token=${accessToken}`,
    { signal: AbortSignal.timeout(10000) },
  );

  if (!response.ok) {
    throw new Error(`Instagram profile fetch failed: ${response.status}`);
  }

  const data = (await response.json()) as {
    id: string;
    name?: string;
    picture?: { data?: { url?: string } };
  };

  const profile: InstagramProfile = {
    id: data.id,
    name: data.name,
    picture: data.picture?.data?.url,
  };

  // Try to fetch connected Instagram Business account
  const igRes = await fetch(
    `${INSTAGRAM_GRAPH_URL}/${data.id}?fields=instagram_business_account&access_token=${accessToken}`,
    { signal: AbortSignal.timeout(10000) },
  );

  if (igRes.ok) {
    const igData = (await igRes.json()) as {
      instagram_business_account?: { id: string; name?: string; username?: string };
    };
    if (igData.instagram_business_account) {
      profile.igBusinessAccount = igData.instagram_business_account;
    }
  }

  return profile;
}

export async function publishInstagramPost(
  options: InstagramPublishOptions,
): Promise<InstagramPublishResult> {
  const { accessToken, igAccountId, caption, mediaUrl, mediaType } = options;

  try {
    if (mediaType === 'CAROUSEL' && options.carouselChildren?.length) {
      const carouselParams = new URLSearchParams({
        media_type: 'CAROUSEL',
        children: options.carouselChildren.join(','),
        caption,
        access_token: accessToken,
      });

      const carouselRes = await fetch(`${INSTAGRAM_GRAPH_URL}/${igAccountId}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: carouselParams,
        signal: AbortSignal.timeout(30000),
      });

      if (!carouselRes.ok) {
        const err = await carouselRes.text();
        throw new Error(`Instagram carousel creation failed: ${err}`);
      }

      const container = (await carouselRes.json()) as { id: string };
      const publishRes = await fetch(`${INSTAGRAM_GRAPH_URL}/${igAccountId}/media_publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ creation_id: container.id, access_token: accessToken }),
        signal: AbortSignal.timeout(30000),
      });

      if (!publishRes.ok) {
        const err = await publishRes.text();
        throw new Error(`Instagram carousel publish failed: ${err}`);
      }

      const pubData = (await publishRes.json()) as { id: string };
      return { success: true, postId: pubData.id };
    }

    // Single image, video, or reel
    const mediaParams = new URLSearchParams({
      access_token: accessToken,
      caption,
    });

    if (mediaUrl) {
      if (mediaType === 'REELS') {
        mediaParams.append('media_type', 'REELS');
        mediaParams.append('video_url', mediaUrl);
      } else if (mediaType === 'VIDEO') {
        mediaParams.append('media_type', 'VIDEO');
        mediaParams.append('video_url', mediaUrl);
      } else {
        mediaParams.append('image_url', mediaUrl);
      }
    }

    const containerRes = await fetch(`${INSTAGRAM_GRAPH_URL}/${igAccountId}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: mediaParams,
      signal: AbortSignal.timeout(30000),
    });

    if (!containerRes.ok) {
      const err = await containerRes.text();
      throw new Error(`Instagram media container creation failed: ${err}`);
    }

    const container = (await containerRes.json()) as { id: string };
    const timeout = mediaType === 'REELS' || mediaType === 'VIDEO' ? 120000 : 60000;

    // Poll container status
    const pollStart = Date.now();
    while (Date.now() - pollStart < timeout) {
      const statusRes = await fetch(
        `${INSTAGRAM_GRAPH_URL}/${container.id}?fields=status_code&access_token=${accessToken}`,
        { signal: AbortSignal.timeout(10000) },
      );
      if (statusRes.ok) {
        const statusData = (await statusRes.json()) as { status_code?: string };
        if (statusData.status_code === 'FINISHED') break;
        if (statusData.status_code === 'ERROR') {
          throw new Error('Instagram media processing failed');
        }
      }
      await new Promise((r) => setTimeout(r, 2000));
    }

    const publishRes = await fetch(`${INSTAGRAM_GRAPH_URL}/${igAccountId}/media_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ creation_id: container.id, access_token: accessToken }),
      signal: AbortSignal.timeout(30000),
    });

    if (!publishRes.ok) {
      const err = await publishRes.text();
      throw new Error(`Instagram publish failed: ${err}`);
    }

    const pubData = (await publishRes.json()) as { id: string };
    return { success: true, postId: pubData.id };
  } catch (error) {
    logger.error({ error }, 'Instagram publish failed');
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
