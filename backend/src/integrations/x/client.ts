/**
 * X (Twitter) OAuth integration — API v2 with PKCE.
 * OAuth: https://twitter.com/i/oauth2/authorize
 * Token: https://api.x.com/2/oauth2/token
 * API: https://api.twitter.com/2/
 * Scopes: tweet.read,tweet.write,users.read,offline.access
 */

import { encryptToken } from '../../lib/encryption.js';
import { logger } from '../../lib/logger.js';

const X_AUTH_URL = 'https://twitter.com/i/oauth2/authorize';
const X_TOKEN_URL = 'https://api.x.com/2/oauth2/token';
const X_API_URL = 'https://api.twitter.com/2';

export interface XOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface XTokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date;
  scope?: string;
}

export interface XProfile {
  id: string;
  name: string;
  username: string;
  profileImageUrl?: string;
  description?: string;
  verified?: boolean;
}

export interface XPublishResult {
  success: boolean;
  tweetId?: string;
  error?: string;
}

export interface XPublishOptions {
  accessToken: string;
  text: string;
  mediaIds?: string[];
  replyToTweetId?: string;
}

export function getXAuthUrl(config: XOAuthConfig, state: string, codeChallenge: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: 'tweet.read,tweet.write,users.read,offline.access',
    response_type: 'code',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'plain',
  });
  return `${X_AUTH_URL}?${params}`;
}

export async function exchangeXCode(
  config: XOAuthConfig,
  code: string,
  codeVerifier: string,
): Promise<XTokenResponse> {
  const params = new URLSearchParams({
    client_id: config.clientId,
    grant_type: 'authorization_code',
    redirect_uri: config.redirectUri,
    code,
    code_verifier: codeVerifier,
  });

  const response = await fetch(X_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const err = await response.text();
    logger.error({ status: response.status, error: err }, 'X token exchange failed');
    throw new Error(`X token exchange failed: ${response.status}`);
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

export async function refreshXToken(
  config: XOAuthConfig,
  refreshToken: string,
): Promise<XTokenResponse> {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: config.clientId,
  });

  const response = await fetch(X_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const err = await response.text();
    logger.error({ status: response.status, error: err }, 'X token refresh failed');
    throw new Error(`X token refresh failed: ${response.status}`);
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

export async function getXUserProfile(accessToken: string): Promise<XProfile> {
  const response = await fetch(`${X_API_URL}/users/me?user.fields=profile_image_url,description,verified`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(`X profile fetch failed: ${response.status}`);
  }

  const data = (await response.json()) as {
    data?: {
      id: string;
      name: string;
      username: string;
      profile_image_url?: string;
      description?: string;
      verified?: boolean;
    };
  };

  if (!data.data) {
    throw new Error('X user not found');
  }

  return {
    id: data.data.id,
    name: data.data.name,
    username: data.data.username,
    profileImageUrl: data.data.profile_image_url,
    description: data.data.description,
    verified: data.data.verified,
  };
}

export async function publishXTweet(
  options: XPublishOptions,
): Promise<XPublishResult> {
  try {
    const { accessToken, text, mediaIds, replyToTweetId } = options;

    const body: Record<string, unknown> = { text };

    if (mediaIds?.length) {
      body.media = { media_ids: mediaIds };
    }

    if (replyToTweetId) {
      body.reply = { in_reply_to_tweet_id: replyToTweetId };
    }

    const response = await fetch(`${X_API_URL}/tweets`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const err = await response.text();
      logger.error({ status: response.status, error: err }, 'X tweet failed');
      return { success: false, error: `X API error: ${response.status}` };
    }

    const data = (await response.json()) as { data?: { id?: string } };
    return { success: true, tweetId: data.data?.id };
  } catch (error) {
    logger.error({ error }, 'X publish failed');
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
