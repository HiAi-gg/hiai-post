/**
 * YouTube publisher — publishes YouTube videos via YouTube Data API v3.
 *
 * Two semantic adapters are exported:
 *   - `publishToYouTubeShorts` — vertical 9:16, ≤60s, defaults to public privacy,
 *     injects `#Shorts` into the title so the upload is classified as a Short.
 *   - `publishToYouTubeLong` — standard long-form, defaults to private privacy,
 *     supports category, thumbnail, and made-for-kids flags.
 *
 * Both share a low-level `publishToYouTube` function (still exported for
 * backward compatibility) that takes an explicit `kind` discriminator.
 *
 * Auth: OAuth 2.0 with `youtube.upload` scope (see
 * `backend/src/integrations/youtube/client.ts`). Tokens are encrypted with
 * AES-256-GCM before storage in `social_accounts` and decrypted at the
 * route layer — the publisher itself only sees plaintext access tokens.
 */

import { logger } from '../../lib/logger.js';
import {
  fetchVideoFromUrl,
  getYouTubeDefaultPrivacy,
  getYouTubeUploadStatus,
  inferYouTubeVideoKind,
  setYouTubeThumbnail,
  uploadYouTubeVideo,
  type YouTubeUploadResult,
  type YouTubeVideoKind,
} from '../../integrations/youtube/client.js';

export type { YouTubeVideoKind, YouTubeUploadResult };

interface YouTubeBaseOptions {
  accessToken: string;
  videoUrl: string;
  title: string;
  description: string;
  tags?: string[];
  categoryId?: string;
  privacyStatus?: 'public' | 'unlisted' | 'private';
  madeForKids?: boolean;
  thumbnailUrl?: string;
  defaultLanguage?: string;
}

/**
 * Generic options — used by `publishToYouTube` and as the internal
 * representation of the kind-specific adapters.
 */
export interface YouTubePublishOptions extends YouTubeBaseOptions {
  kind?: YouTubeVideoKind;
  durationSeconds?: number;
}

export interface YouTubeShortsPublishOptions extends YouTubeBaseOptions {
  /**
   * Optional override for the duration the publisher uses purely for
   * telemetry / validation. YouTube itself enforces the 60-second limit
   * at the API level.
   */
  durationSeconds?: number;
}

export interface YouTubeLongPublishOptions extends YouTubeBaseOptions {}

export interface YouTubePublishResult {
  success: boolean;
  videoId?: string;
  status?: string;
  uploadStatus?: YouTubeUploadResult['uploadStatus'];
  kind?: YouTubeVideoKind;
  error?: string;
}

function ensureShortsFriendlyTitle(title: string, kind: YouTubeVideoKind): string {
  if (kind !== 'short') return title;
  const trimmed = title.trim();
  if (trimmed.toLowerCase().includes('#shorts')) return trimmed.slice(0, 100);
  return `${trimmed} #Shorts`.slice(0, 100);
}

async function applyThumbnailIfPresent(
  accessToken: string,
  videoId: string,
  thumbnailUrl: string | undefined
): Promise<void> {
  if (!thumbnailUrl) return;
  try {
    const thumbRes = await fetch(thumbnailUrl, { signal: AbortSignal.timeout(60000) });
    if (!thumbRes.ok) {
      logger.warn(
        { status: thumbRes.status, thumbnailUrl },
        'YouTube thumbnail fetch failed, skipping'
      );
      return;
    }
    const imageBuffer = await thumbRes.arrayBuffer();
    const rawType = thumbRes.headers.get('content-type') ?? 'image/jpeg';
    const mimeType: 'image/jpeg' | 'image/png' =
      rawType.includes('png') ? 'image/png' : 'image/jpeg';
    await setYouTubeThumbnail({
      accessToken,
      videoId,
      imageBuffer,
      mimeType,
    });
  } catch (thumbErr) {
    logger.warn({ err: thumbErr }, 'YouTube thumbnail upload failed, continuing');
  }
}

/**
 * Generic YouTube publisher. Existing callers continue to use this with
 * either an explicit `kind` or a `durationSeconds` value (≤60 → short,
 * >60 → long). New callers should prefer the kind-specific adapters below.
 */
export async function publishToYouTube(
  options: YouTubePublishOptions
): Promise<YouTubePublishResult> {
  const {
    accessToken,
    videoUrl,
    title,
    description,
    tags,
    categoryId,
    privacyStatus,
    madeForKids,
    thumbnailUrl,
    durationSeconds,
    defaultLanguage,
    kind,
  } = options;

  if (!videoUrl) {
    return { success: false, error: 'videoUrl is required for YouTube upload' };
  }

  try {
    const resolvedKind: YouTubeVideoKind =
      kind ?? (durationSeconds !== undefined ? inferYouTubeVideoKind(durationSeconds) : 'long');

    const { buffer, mimeType } = await fetchVideoFromUrl(videoUrl);

    const effectivePrivacy = privacyStatus ?? getYouTubeDefaultPrivacy(resolvedKind);

    const upload = await uploadYouTubeVideo({
      accessToken,
      videoBuffer: buffer,
      mimeType,
      kind: resolvedKind,
      metadata: {
        title: ensureShortsFriendlyTitle(title, resolvedKind),
        description,
        tags,
        categoryId,
        privacyStatus: effectivePrivacy,
        madeForKids,
        defaultLanguage,
      },
    });

    await applyThumbnailIfPresent(accessToken, upload.videoId, thumbnailUrl);

    return {
      success: true,
      videoId: upload.videoId,
      status: upload.status,
      uploadStatus: upload.uploadStatus,
      kind: resolvedKind,
    };
  } catch (error) {
    logger.error({ err: error, kind: options.kind }, 'YouTube publish failed');
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Publish a YouTube Short (≤60s, vertical 9:16). Enforces:
 *   - `kind = 'short'` (cannot be overridden by caller)
 *   - default `privacyStatus = 'public'` (overrideable)
 *   - automatic `#Shorts` suffix in the title when missing
 *   - default YouTube category `22` (People & Blogs) when not provided
 *
 * The `thumbnailUrl` option is accepted but rarely used — YouTube requires
 * the channel to be verified before custom thumbnails are allowed on Shorts.
 */
export async function publishToYouTubeShorts(
  options: YouTubeShortsPublishOptions
): Promise<YouTubePublishResult> {
  return publishToYouTube({
    ...options,
    kind: 'short',
  });
}

/**
 * Publish a standard long-form YouTube video. Enforces:
 *   - `kind = 'long'` (cannot be overridden by caller)
 *   - default `privacyStatus = 'private'` (overrideable)
 *   - supports `categoryId`, `madeForKids`, custom `thumbnailUrl`, and
 *     `defaultLanguage` from the YouTube Data API.
 */
export async function publishToYouTubeLong(
  options: YouTubeLongPublishOptions
): Promise<YouTubePublishResult> {
  return publishToYouTube({
    ...options,
    kind: 'long',
  });
}

/**
 * Poll the YouTube Data API for the current processing status of a video.
 * Useful for cron jobs that monitor long-form uploads.
 */
export async function getYouTubePublishStatus(
  accessToken: string,
  videoId: string
): Promise<YouTubeUploadResult> {
  return getYouTubeUploadStatus(accessToken, videoId);
}
