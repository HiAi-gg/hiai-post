import { logger } from "../../lib/logger.js";

const YOUTUBE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const YOUTUBE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const YOUTUBE_UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos";
const YOUTUBE_VIDEO_URL = "https://www.googleapis.com/youtube/v3/videos";
const YOUTUBE_THUMBNAIL_URL = "https://www.googleapis.com/youtube/v3/thumbnails/set";
const YOUTUBE_CHANNEL_URL = "https://www.googleapis.com/youtube/v3/channels";

export type YouTubeVideoKind = "short" | "long";

export interface YouTubeOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface YouTubeTokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date;
  scope?: string;
  tokenType: string;
}

export interface YouTubeVideoMetadata {
  title: string;
  description: string;
  tags?: string[];
  categoryId?: string;
  privacyStatus?: "public" | "unlisted" | "private";
  madeForKids?: boolean;
  defaultLanguage?: string;
}

export interface YouTubeUploadResult {
  videoId: string;
  status: string;
  uploadStatus: "uploading" | "processing" | "processed" | "failed";
}

export function getYouTubeAuthUrl(config: YouTubeOAuthConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
    scope:
      "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.force-ssl https://www.googleapis.com/auth/youtube.readonly",
  });
  return `${YOUTUBE_AUTH_URL}?${params.toString()}`;
}

export async function exchangeYouTubeCode(
  config: YouTubeOAuthConfig,
  code: string
): Promise<YouTubeTokenResponse> {
  const params = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: config.redirectUri,
  });

  const response = await fetch(YOUTUBE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error({ status: response.status, error: errorText }, "YouTube token exchange failed");
    throw new Error(`YouTube token exchange failed: ${response.status}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope?: string;
    token_type: string;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
    scope: data.scope,
    tokenType: data.token_type,
  };
}

export async function refreshYouTubeToken(
  config: YouTubeOAuthConfig,
  refreshToken: string
): Promise<YouTubeTokenResponse> {
  const params = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const response = await fetch(YOUTUBE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`YouTube token refresh failed: ${response.status}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in: number;
    scope?: string;
    token_type: string;
  };

  return {
    accessToken: data.access_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
    scope: data.scope,
    tokenType: data.token_type,
  };
}

export interface YouTubeChannelInfo {
  channelId: string;
  title: string;
  description?: string;
  thumbnailUrl?: string;
  subscriberCount?: number;
  videoCount?: number;
}

export async function getYouTubeChannel(accessToken: string): Promise<YouTubeChannelInfo> {
  const params = new URLSearchParams({
    part: "snippet,statistics",
    mine: "true",
  });

  const response = await fetch(`${YOUTUBE_CHANNEL_URL}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(`YouTube channel fetch failed: ${response.status}`);
  }

  const data = (await response.json()) as {
    items?: Array<{
      id: string;
      snippet?: {
        title: string;
        description?: string;
        thumbnails?: { default?: { url?: string }; medium?: { url?: string } };
      };
      statistics?: { subscriberCount?: string; videoCount?: string };
    }>;
  };

  const item = data.items?.[0];
  if (!item) {
    throw new Error("No YouTube channel found for authenticated user");
  }

  return {
    channelId: item.id,
    title: item.snippet?.title || "",
    description: item.snippet?.description,
    thumbnailUrl: item.snippet?.thumbnails?.default?.url || item.snippet?.thumbnails?.medium?.url,
    subscriberCount: item.statistics?.subscriberCount
      ? Number.parseInt(item.statistics.subscriberCount, 10)
      : undefined,
    videoCount: item.statistics?.videoCount
      ? Number.parseInt(item.statistics.videoCount, 10)
      : undefined,
  };
}

export interface YouTubeUploadOptions {
  accessToken: string;
  videoBuffer: ArrayBuffer;
  mimeType: string;
  metadata: YouTubeVideoMetadata;
  kind: YouTubeVideoKind;
  onProgress?: (bytesUploaded: number, totalBytes: number) => void;
}

export async function uploadYouTubeVideo(
  options: YouTubeUploadOptions
): Promise<YouTubeUploadResult> {
  const { accessToken, videoBuffer, mimeType, metadata, kind } = options;

  const snippet = {
    title: metadata.title.slice(0, 100),
    description: metadata.description.slice(0, 5000),
    tags: (metadata.tags ?? []).slice(0, 500),
    categoryId: metadata.categoryId ?? "22",
    defaultLanguage: metadata.defaultLanguage,
  };

  const status = {
    privacyStatus: metadata.privacyStatus ?? "private",
    madeForKids: metadata.madeForKids ?? false,
    selfDeclaredMadeForKids: metadata.madeForKids ?? false,
    embeddable: true,
    publicStatsViewable: true,
  };

  const videoResource = {
    snippet,
    status,
  };

  const initResponse = await fetch(
    `${YOUTUBE_UPLOAD_URL}?uploadType=resumable&part=snippet,status`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Length": String(videoBuffer.byteLength),
        "X-Upload-Content-Type": mimeType,
      },
      body: JSON.stringify(videoResource),
      signal: AbortSignal.timeout(30000),
    }
  );

  if (!initResponse.ok) {
    const errorText = await initResponse.text();
    logger.error(
      { status: initResponse.status, error: errorText, kind },
      "YouTube resumable init failed"
    );
    throw new Error(`YouTube upload init failed: ${initResponse.status}`);
  }

  const uploadUrl = initResponse.headers.get("Location");
  if (!uploadUrl) {
    throw new Error("YouTube upload init did not return a Location header");
  }

  const uploadRequest = new Request(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": mimeType,
      "Content-Length": String(videoBuffer.byteLength),
    },
    body: videoBuffer,
  });
  const uploadResponse = await fetch(uploadRequest, {
    signal: AbortSignal.timeout(60 * 60 * 1000),
  });

  if (!uploadResponse.ok) {
    const errorText = await uploadResponse.text();
    logger.error(
      { status: uploadResponse.status, error: errorText, kind },
      "YouTube upload failed"
    );
    throw new Error(`YouTube upload failed: ${uploadResponse.status}`);
  }

  const uploaded = (await uploadResponse.json()) as {
    id?: string;
    status?: { uploadStatus?: string; privacyStatus?: string };
  };

  if (!uploaded.id) {
    throw new Error("YouTube upload succeeded but no video ID was returned");
  }

  return {
    videoId: uploaded.id,
    status: uploaded.status?.privacyStatus ?? metadata.privacyStatus ?? "private",
    uploadStatus:
      (uploaded.status?.uploadStatus as YouTubeUploadResult["uploadStatus"]) ?? "processing",
  };
}

export async function fetchVideoFromUrl(
  url: string
): Promise<{ buffer: ArrayBuffer; mimeType: string }> {
  const response = await fetch(url, { signal: AbortSignal.timeout(5 * 60 * 1000) });
  if (!response.ok) {
    throw new Error(`Failed to fetch video from URL: ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const mimeType = response.headers.get("content-type") ?? "video/mp4";
  return { buffer: arrayBuffer, mimeType };
}

export async function getYouTubeUploadStatus(
  accessToken: string,
  videoId: string
): Promise<YouTubeUploadResult> {
  const params = new URLSearchParams({ part: "status,processingDetails" });
  const response = await fetch(`${YOUTUBE_VIDEO_URL}?id=${videoId}&${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(`YouTube status check failed: ${response.status}`);
  }

  const data = (await response.json()) as {
    items?: Array<{
      id: string;
      status?: { uploadStatus?: string; privacyStatus?: string };
    }>;
  };

  const item = data.items?.[0];
  if (!item) {
    throw new Error(`YouTube video ${videoId} not found`);
  }

  return {
    videoId: item.id,
    status: item.status?.privacyStatus ?? "unknown",
    uploadStatus:
      (item.status?.uploadStatus as YouTubeUploadResult["uploadStatus"]) ?? "processing",
  };
}

export interface YouTubeThumbnailOptions {
  accessToken: string;
  videoId: string;
  imageBuffer: ArrayBuffer;
  mimeType: "image/jpeg" | "image/png";
}

export async function setYouTubeThumbnail(options: YouTubeThumbnailOptions): Promise<void> {
  const { accessToken, videoId, imageBuffer, mimeType } = options;

  const initResponse = await fetch(
    `${YOUTUBE_THUMBNAIL_URL}?videoId=${videoId}&uploadType=resumable`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Length": String(imageBuffer.byteLength),
        "X-Upload-Content-Type": mimeType,
      },
      body: JSON.stringify({ videoId }),
      signal: AbortSignal.timeout(15000),
    }
  );

  if (!initResponse.ok) {
    throw new Error(`YouTube thumbnail init failed: ${initResponse.status}`);
  }

  const uploadUrl = initResponse.headers.get("Location");
  if (!uploadUrl) {
    throw new Error("YouTube thumbnail init did not return a Location header");
  }

  const uploadResponse = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": mimeType,
      "Content-Length": String(imageBuffer.byteLength),
    },
    body: imageBuffer,
    signal: AbortSignal.timeout(60000),
  });

  if (!uploadResponse.ok) {
    throw new Error(`YouTube thumbnail upload failed: ${uploadResponse.status}`);
  }
}

export function inferYouTubeVideoKind(durationSeconds: number): YouTubeVideoKind {
  return durationSeconds <= 60 ? "short" : "long";
}

export function getYouTubeDefaultPrivacy(
  kind: YouTubeVideoKind
): "public" | "unlisted" | "private" {
  return kind === "short" ? "public" : "private";
}
