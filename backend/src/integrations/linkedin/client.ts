/**
 * LinkedIn OAuth integration — Marketing API.
 * OAuth: https://www.linkedin.com/oauth/v2/authorization
 * Token: https://www.linkedin.com/oauth/v2/accessToken
 * API: https://api.linkedin.com/v2/
 * Scopes: w_member_social,r_liteprofile,r_emailaddress
 */

import { logger } from "../../lib/logger.js";

const LINKEDIN_AUTH_URL = "https://www.linkedin.com/oauth/v2/authorization";
const LINKEDIN_TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const LINKEDIN_API_URL = "https://api.linkedin.com/v2";

export interface LinkedInOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface LinkedInTokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date;
  scope?: string;
}

export interface LinkedInProfile {
  sub: string;
  name?: string;
  givenName?: string;
  familyName?: string;
  email?: string;
  picture?: string;
  personUrn: string;
}

export interface LinkedInPublishResult {
  success: boolean;
  postId?: string;
  error?: string;
}

export interface LinkedInPublishOptions {
  accessToken: string;
  personUrn: string;
  content: string;
  mediaUrl?: string;
  title?: string;
  description?: string;
}

export function getLinkedInAuthUrl(config: LinkedInOAuthConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: "w_member_social,r_liteprofile,r_emailaddress",
    response_type: "code",
    state,
  });
  return `${LINKEDIN_AUTH_URL}?${params}`;
}

export async function exchangeLinkedInCode(
  config: LinkedInOAuthConfig,
  code: string
): Promise<LinkedInTokenResponse> {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });

  const response = await fetch(LINKEDIN_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const err = await response.text();
    logger.error({ status: response.status, error: err }, "LinkedIn token exchange failed");
    throw new Error(`LinkedIn token exchange failed: ${response.status}`);
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

export async function refreshLinkedInToken(
  config: LinkedInOAuthConfig,
  refreshToken: string
): Promise<LinkedInTokenResponse> {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });

  const response = await fetch(LINKEDIN_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const err = await response.text();
    logger.error({ status: response.status, error: err }, "LinkedIn token refresh failed");
    throw new Error(`LinkedIn token refresh failed: ${response.status}`);
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

export async function getLinkedInUserProfile(accessToken: string): Promise<LinkedInProfile> {
  const meRes = await fetch(`${LINKEDIN_API_URL}/me`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "X-Restli-Protocol-Version": "2.0.0",
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!meRes.ok) {
    throw new Error(`LinkedIn profile fetch failed: ${meRes.status}`);
  }

  const me = (await meRes.json()) as {
    id?: string;
    localizedFirstName?: string;
    localizedLastName?: string;
    profilePicture?: { displayImage?: string };
  };

  const personUrn = me.id ? `urn:li:person:${me.id}` : "";

  // Fetch email
  let email = "";
  const emailRes = await fetch(
    `${LINKEDIN_API_URL}/emailAddress?q=members&projection=(elements*(handle~))`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "X-Restli-Protocol-Version": "2.0.0",
      },
      signal: AbortSignal.timeout(10000),
    }
  );

  if (emailRes.ok) {
    const emailData = (await emailRes.json()) as {
      elements?: Array<{ "handle~"?: { emailAddress?: string } }>;
    };
    email = emailData.elements?.[0]?.["handle~"]?.emailAddress || "";
  }

  return {
    sub: me.id || "",
    name: `${me.localizedFirstName || ""} ${me.localizedLastName || ""}`.trim(),
    givenName: me.localizedFirstName,
    familyName: me.localizedLastName,
    email,
    picture: me.profilePicture?.displayImage,
    personUrn,
  };
}

export async function publishLinkedInPost(
  options: LinkedInPublishOptions
): Promise<LinkedInPublishResult> {
  try {
    const { accessToken, personUrn, content, mediaUrl, title, description } = options;

    let imageUrn: string | undefined;

    if (mediaUrl) {
      const registerRes = await fetch(`${LINKEDIN_API_URL}/assets?action=registerUpload`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "X-Restli-Protocol-Version": "2.0.0",
        },
        body: JSON.stringify({
          registerUploadRequest: {
            recipes: ["urn:li:digitalmediaRecipe:feedshare-image"],
            owner: personUrn,
            serviceRelationships: [
              { relationshipType: "OWNER", identifier: "urn:li:userGeneratedContent" },
            ],
          },
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (registerRes.ok) {
        const registerData = (await registerRes.json()) as {
          value?: {
            uploadMechanism?: {
              "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"?: { uploadUrl: string };
            };
            asset?: string;
          };
        };
        const uploadUrl =
          registerData.value?.uploadMechanism?.[
            "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"
          ]?.uploadUrl;
        const registeredUrn = registerData.value?.asset;

        if (uploadUrl && registeredUrn) {
          const mediaFetch = await fetch(mediaUrl, { signal: AbortSignal.timeout(30000) });
          if (mediaFetch.ok) {
            const blob = await mediaFetch.blob();
            await fetch(uploadUrl, {
              method: "PUT",
              headers: { "Content-Type": "application/octet-stream" },
              body: blob,
              signal: AbortSignal.timeout(60000),
            });
          }
          imageUrn = registeredUrn;
        }
      }
    }

    const body: Record<string, unknown> = {
      author: personUrn,
      lifecycleState: "PUBLISHED",
      specificContent: {
        "com.linkedin.ugc.ShareContent": {
          shareCommentary: { text: content },
          shareMediaCategory: imageUrn ? "IMAGE" : "NONE",
        },
      },
      visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
    };

    if (imageUrn) {
      const shareContent = (body.specificContent as Record<string, unknown>)[
        "com.linkedin.ugc.ShareContent"
      ] as Record<string, unknown>;
      shareContent.media = [
        {
          status: "READY",
          description: { text: description || title || "" },
          media: imageUrn,
          title: { text: title || "" },
        },
      ];
    }

    const response = await fetch(`${LINKEDIN_API_URL}/ugcPosts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const err = await response.text();
      logger.error({ status: response.status, error: err }, "LinkedIn publish failed");
      return { success: false, error: `LinkedIn API error: ${response.status}` };
    }

    const postId = response.headers.get("x-restli-id") || undefined;
    return { success: true, postId };
  } catch (error) {
    logger.error({ error }, "LinkedIn publish failed");
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
