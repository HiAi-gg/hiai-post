const THREADS_AUTH_URL = "https://threads.net/oauth/authorize";
const THREADS_TOKEN_URL = "https://graph.threads.net/oauth/access_token";

export interface ThreadsOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/**
 * Generate Threads OAuth authorization URL.
 */
export function getThreadsAuthUrl(config: ThreadsOAuthConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: "threads_basic,threads_content_publish,threads_manage_insights",
    response_type: "code",
    state,
  });
  return `${THREADS_AUTH_URL}?${params}`;
}

/**
 * Exchange authorization code for access token.
 */
export async function exchangeThreadsCode(
  config: ThreadsOAuthConfig,
  code: string
): Promise<{ accessToken: string; userId: string; expiresAt: Date }> {
  const params = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "authorization_code",
    redirect_uri: config.redirectUri,
    code,
  });

  const response = await fetch(THREADS_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`Threads token exchange failed: ${response.status}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    user_id: string;
    expires_in: number;
  };

  return {
    accessToken: data.access_token,
    userId: data.user_id.toString(),
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  };
}

/**
 * Get Threads user profile.
 */
export async function getThreadsProfile(accessToken: string, userId: string) {
  const response = await fetch(
    `https://graph.threads.net/v1.0/${userId}?fields=id,username,name,threads_profile_picture_url&access_token=${accessToken}`,
    { signal: AbortSignal.timeout(10000) }
  );

  if (!response.ok) throw new Error(`Threads profile fetch failed: ${response.status}`);
  return response.json();
}
