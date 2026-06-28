/**
 * Facebook OAuth integration — Graph API v19.0.
 * OAuth: https://www.facebook.com/v19.0/dialog/oauth
 * Token: https://graph.facebook.com/v19.0/oauth/access_token
 * API: https://graph.facebook.com/v19.0/
 * Scopes: pages_manage_posts,pages_read_engagement,pages_show_list
 */

import { logger } from "../../lib/logger.js";

const FACEBOOK_AUTH_URL = "https://www.facebook.com/v19.0/dialog/oauth";
const FACEBOOK_TOKEN_URL = "https://graph.facebook.com/v19.0/oauth/access_token";
const FACEBOOK_GRAPH_URL = "https://graph.facebook.com/v19.0";

export interface FacebookOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface FacebookTokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date;
}

export interface FacebookProfile {
  id: string;
  name?: string;
  picture?: string;
  pages?: Array<{
    id: string;
    name: string;
    accessToken?: string;
    category?: string;
  }>;
}

export interface FacebookPublishResult {
  success: boolean;
  postId?: string;
  error?: string;
}

export interface FacebookPublishOptions {
  accessToken: string;
  pageId: string;
  message: string;
  mediaUrl?: string;
  link?: string;
  scheduledPublishTime?: number;
}

export function getFacebookAuthUrl(config: FacebookOAuthConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: "pages_manage_posts,pages_read_engagement,pages_show_list",
    response_type: "code",
    state,
  });
  return `${FACEBOOK_AUTH_URL}?${params}`;
}

export async function exchangeFacebookCode(
  config: FacebookOAuthConfig,
  code: string
): Promise<FacebookTokenResponse> {
  const params = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "authorization_code",
    redirect_uri: config.redirectUri,
    code,
  });

  const response = await fetch(FACEBOOK_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const err = await response.text();
    logger.error({ status: response.status, error: err }, "Facebook token exchange failed");
    throw new Error(`Facebook token exchange failed: ${response.status}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in?: number;
  };

  return {
    accessToken: data.access_token,
    expiresAt: data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000)
      : new Date(Date.now() + 3600_000),
  };
}

export async function refreshFacebookToken(
  config: FacebookOAuthConfig,
  refreshToken: string
): Promise<FacebookTokenResponse> {
  const response = await fetch(
    `${FACEBOOK_TOKEN_URL}?grant_type=fb_exchange_token&client_id=${config.clientId}&client_secret=${config.clientSecret}&fb_exchange_token=${refreshToken}`,
    { method: "GET", signal: AbortSignal.timeout(15000) }
  );

  if (!response.ok) {
    const err = await response.text();
    logger.error({ status: response.status, error: err }, "Facebook token refresh failed");
    throw new Error(`Facebook token refresh failed: ${response.status}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in?: number;
  };

  return {
    accessToken: data.access_token,
    expiresAt: data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000)
      : new Date(Date.now() + 3600_000),
  };
}

export async function getFacebookUserProfile(accessToken: string): Promise<FacebookProfile> {
  const meRes = await fetch(
    `${FACEBOOK_GRAPH_URL}/me?fields=id,name,picture&access_token=${accessToken}`,
    {
      signal: AbortSignal.timeout(10000),
    }
  );

  if (!meRes.ok) {
    throw new Error(`Facebook profile fetch failed: ${meRes.status}`);
  }

  const me = (await meRes.json()) as {
    id: string;
    name?: string;
    picture?: { data?: { url?: string } };
  };

  // Fetch pages the user manages
  const pagesRes = await fetch(
    `${FACEBOOK_GRAPH_URL}/me/accounts?fields=id,name,access_token,category&access_token=${accessToken}`,
    { signal: AbortSignal.timeout(10000) }
  );

  const profile: FacebookProfile = {
    id: me.id,
    name: me.name,
    picture: me.picture?.data?.url,
  };

  if (pagesRes.ok) {
    const pagesData = (await pagesRes.json()) as {
      data?: Array<{
        id: string;
        name: string;
        access_token?: string;
        category?: string;
      }>;
    };
    profile.pages = pagesData.data?.map((p) => ({
      id: p.id,
      name: p.name,
      accessToken: p.access_token,
      category: p.category,
    }));
  }

  return profile;
}

export async function publishFacebookPagePost(
  options: FacebookPublishOptions
): Promise<FacebookPublishResult> {
  try {
    const { accessToken, pageId, message, mediaUrl, link, scheduledPublishTime } = options;

    // Video post
    if (mediaUrl?.match(/\.(mp4|mov|avi|webm)$/i)) {
      const params = new URLSearchParams({
        file_url: mediaUrl,
        description: message,
        access_token: accessToken,
      });

      const response = await fetch(`${FACEBOOK_GRAPH_URL}/${pageId}/videos`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params,
        signal: AbortSignal.timeout(120000),
      });

      if (!response.ok) {
        const err = await response.text();
        logger.error({ status: response.status, error: err }, "Facebook video upload failed");
        return { success: false, error: `Facebook API error: ${response.status}` };
      }

      const data = (await response.json()) as { id: string };
      return { success: true, postId: data.id };
    }

    // Photo post
    if (mediaUrl) {
      const params = new URLSearchParams({
        url: mediaUrl,
        caption: message,
        access_token: accessToken,
      });

      const response = await fetch(`${FACEBOOK_GRAPH_URL}/${pageId}/photos`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params,
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        const err = await response.text();
        logger.error({ status: response.status, error: err }, "Facebook photo upload failed");
        return { success: false, error: `Facebook API error: ${response.status}` };
      }

      const data = (await response.json()) as { id: string };
      return { success: true, postId: data.id };
    }

    // Text / link post
    const feedParams = new URLSearchParams({
      message,
      access_token: accessToken,
    });

    if (link) {
      feedParams.append("link", link);
    }

    if (scheduledPublishTime) {
      feedParams.append("scheduled_publish_time", String(scheduledPublishTime));
      feedParams.append("published", "false");
    }

    const response = await fetch(`${FACEBOOK_GRAPH_URL}/${pageId}/feed`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: feedParams,
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const err = await response.text();
      logger.error({ status: response.status, error: err }, "Facebook publish failed");
      return { success: false, error: `Facebook API error: ${response.status}` };
    }

    const data = (await response.json()) as { id: string };
    return { success: true, postId: data.id };
  } catch (error) {
    logger.error({ error }, "Facebook publish failed");
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
