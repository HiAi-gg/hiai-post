const PINTEREST_AUTH_URL = "https://www.pinterest.com/oauth/";
const PINTEREST_TOKEN_URL = "https://api.pinterest.com/v5/oauth/token";

export interface PinterestOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/**
 * Generate Pinterest OAuth authorization URL.
 */
export function getPinterestAuthUrl(config: PinterestOAuthConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: "boards:read,pins:read,pins:write",
    response_type: "code",
    state,
  });
  return `${PINTEREST_AUTH_URL}?${params}`;
}

/**
 * Exchange authorization code for access token.
 */
export async function exchangePinterestCode(
  config: PinterestOAuthConfig,
  code: string
): Promise<{ accessToken: string; refreshToken?: string; expiresAt?: Date }> {
  const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");

  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
  });

  const response = await fetch(PINTEREST_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`Pinterest token exchange failed: ${response.status}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : undefined,
  };
}

/**
 * Get Pinterest user profile and boards.
 */
export async function getPinterestProfile(accessToken: string) {
  const response = await fetch("https://api.pinterest.com/v5/user_account", {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) throw new Error(`Pinterest profile fetch failed: ${response.status}`);
  return response.json();
}

/**
 * Get user's Pinterest boards.
 */
export async function getPinterestBoards(accessToken: string) {
  const response = await fetch("https://api.pinterest.com/v5/boards?page_size=25", {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) throw new Error(`Pinterest boards fetch failed: ${response.status}`);
  const data = (await response.json()) as { items?: Array<{ id: string; name: string }> };
  return data.items ?? [];
}
