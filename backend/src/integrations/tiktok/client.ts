/**
 * TikTok OAuth integration — TikTok Login Kit + Content Posting API.
 * OAuth: https://www.tiktok.com/v2/auth/authorize/
 * Token: https://open.tiktokapis.com/v2/oauth/token/
 * API: https://open.tiktokapis.com/v2/
 * Scopes: user.info.basic,video.publish,video.list
 */

import { logger } from "../../lib/logger.js";

const TIKTOK_AUTH_URL = "https://www.tiktok.com/v2/auth/authorize/";
const TIKTOK_TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
const TIKTOK_API_URL = "https://open.tiktokapis.com/v2";

export interface TikTokOAuthConfig {
  clientKey: string;
  clientSecret: string;
  redirectUri: string;
}

export interface TikTokTokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date;
  openId?: string;
  scope?: string;
}

export interface TikTokProfile {
  openId: string;
  unionId?: string;
  displayName?: string;
  avatarUrl?: string;
  bioDescription?: string;
}

export interface TikTokPublishResult {
  success: boolean;
  publishId?: string;
  error?: string;
}

export interface TikTokPublishOptions {
  accessToken: string;
  openId: string;
  title: string;
  description?: string;
  videoUrl: string;
  hashtags?: string[];
  privacyLevel?:
    | "PUBLIC_TO_EVERYONE"
    | "MUTUAL_FOLLOW_FRIENDS"
    | "FOLLOWER_OF_CREATOR"
    | "SELF_ONLY";
}

export function getTikTokAuthUrl(config: TikTokOAuthConfig, state: string): string {
  const params = new URLSearchParams({
    client_key: config.clientKey,
    redirect_uri: config.redirectUri,
    scope: "user.info.basic,video.publish,video.list",
    response_type: "code",
    state,
  });
  return `${TIKTOK_AUTH_URL}?${params}`;
}

export async function exchangeTikTokCode(
  config: TikTokOAuthConfig,
  code: string
): Promise<TikTokTokenResponse> {
  const params = new URLSearchParams({
    client_key: config.clientKey,
    client_secret: config.clientSecret,
    grant_type: "authorization_code",
    redirect_uri: config.redirectUri,
    code,
  });

  const response = await fetch(TIKTOK_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const err = await response.text();
    logger.error({ status: response.status, error: err }, "TikTok token exchange failed");
    throw new Error(`TikTok token exchange failed: ${response.status}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    open_id?: string;
    scope?: string;
    token_type?: string;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
    openId: data.open_id,
    scope: data.scope,
  };
}

export async function refreshTikTokToken(
  config: TikTokOAuthConfig,
  refreshToken: string
): Promise<TikTokTokenResponse> {
  const params = new URLSearchParams({
    client_key: config.clientKey,
    client_secret: config.clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const response = await fetch(TIKTOK_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const err = await response.text();
    logger.error({ status: response.status, error: err }, "TikTok token refresh failed");
    throw new Error(`TikTok token refresh failed: ${response.status}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope?: string;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
    scope: data.scope,
  };
}

export async function getTikTokUserProfile(accessToken: string): Promise<TikTokProfile> {
  const response = await fetch(
    `${TIKTOK_API_URL}/user/info/?fields=open_id,union_id,display_name,avatar_url,bio_description`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10000),
    }
  );

  if (!response.ok) {
    throw new Error(`TikTok profile fetch failed: ${response.status}`);
  }

  const data = (await response.json()) as {
    data?: {
      user?: {
        open_id: string;
        union_id?: string;
        display_name?: string;
        avatar_url?: string;
        bio_description?: string;
      };
    };
  };

  const user = data.data?.user;
  if (!user) {
    throw new Error("TikTok user not found");
  }

  return {
    openId: user.open_id,
    unionId: user.union_id,
    displayName: user.display_name,
    avatarUrl: user.avatar_url,
    bioDescription: user.bio_description,
  };
}

export async function publishTikTokVideo(
  options: TikTokPublishOptions
): Promise<TikTokPublishResult> {
  try {
    const { accessToken, openId, title, description, videoUrl, hashtags, privacyLevel } = options;

    const response = await fetch(`${TIKTOK_API_URL}/post/publish/video/init/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({
        post_info: {
          title: title.slice(0, 150),
          description: description || title,
          hashtags: hashtags?.map((t) => ({ name: t.replace("#", "") })) || [],
          privacy_level: privacyLevel || "PUBLIC_TO_EVERYONE",
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false,
        },
        source_info: {
          source: "FILE_UPLOAD",
          video_url: videoUrl,
        },
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const err = await response.text();
      logger.error({ status: response.status, error: err }, "TikTok video init failed");
      return { success: false, error: `TikTok API error: ${response.status}` };
    }

    const data = (await response.json()) as {
      data?: { publish_id?: string };
      error?: { code?: string; message?: string };
    };

    if (data.error?.code) {
      return { success: false, error: data.error.message || "TikTok publish failed" };
    }

    return { success: true, publishId: data.data?.publish_id };
  } catch (error) {
    logger.error({ error }, "TikTok publish failed");
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
