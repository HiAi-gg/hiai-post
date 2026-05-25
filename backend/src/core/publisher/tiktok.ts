/**
 * TikTok publisher — publish videos via TikTok Content Posting API.
 */

import { logger } from '../../lib/logger.js';

export interface TikTokPublishOptions {
  accessToken: string;
  openId: string;
  videoUrl: string;
  title: string;
  description?: string;
  hashtags?: string[];
  privacyLevel?: 'PUBLIC_TO_EVERYONE' | 'MUTUAL_FOLLOW_FRIENDS' | 'FOLLOWER_OF_CREATOR' | 'SELF_ONLY';
}

interface TikTokPublishResult {
  success: boolean;
  publishId?: string;
  error?: string;
}

/**
 * Check TikTok publish status.
 */
export async function getTikTokPublishStatus(
  accessToken: string,
  publishId: string
): Promise<{ status: string; error?: string }> {
  try {
    const response = await fetch(
      `https://open.tiktokapis.com/v2/post/publish/status/fetch/?publish_id=${publishId}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10000),
      }
    );
    if (!response.ok) {
      return { status: 'unknown', error: `Status check failed: ${response.status}` };
    }
    const data = (await response.json()) as { data?: { status?: string; fail_reason?: string } };
    return { status: data.data?.status || 'unknown', error: data.data?.fail_reason };
  } catch (error) {
    return { status: 'unknown', error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Publish a video to TikTok.
 */
export async function publishToTikTok(
  options: TikTokPublishOptions
): Promise<TikTokPublishResult> {
  try {
    const {
      accessToken,
      openId,
      videoUrl,
      title,
      description,
      hashtags,
      privacyLevel,
    } = options;

    // Step 1: Initialize video upload
    const initResponse = await fetch(
      'https://open.tiktokapis.com/v2/post/publish/video/init/',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
        },
        body: JSON.stringify({
          post_info: {
            title: title.slice(0, 150),
            description: description || title,
            hashtags: hashtags?.map((tag) => ({ name: tag.replace('#', '') })) || [],
            privacy_level: privacyLevel || 'PUBLIC_TO_EVERYONE',
            disable_duet: false,
            disable_comment: false,
            disable_stitch: false,
          },
          source_info: {
            source: 'FILE_UPLOAD',
            video_url: videoUrl,
          },
        }),
        signal: AbortSignal.timeout(30000),
      }
    );

    if (!initResponse.ok) {
      const errorText = await initResponse.text();
      logger.error({ status: initResponse.status, error: errorText }, 'TikTok init failed');
      return {
        success: false,
        error: `TikTok API error: ${initResponse.status}`,
      };
    }

    const initData = (await initResponse.json()) as {
      data?: { publish_id?: string; upload_url?: string };
      error?: { code?: string; message?: string };
    };

    if (initData.error?.code) {
      return {
        success: false,
        error: initData.error.message || 'TikTok publish failed',
      };
    }

    const publishId = initData.data?.publish_id;

    // If direct URL upload was used, the video is now being processed
    if (publishId) {
      // Step 2: Check publish status
      const statusResponse = await fetch(
        `https://open.tiktokapis.com/v2/post/publish/status/fetch/?publish_id=${publishId}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          signal: AbortSignal.timeout(10000),
        }
      );

      if (statusResponse.ok) {
        const statusData = (await statusResponse.json()) as {
          data?: { status?: string };
        };
        logger.info(
          { publishId, status: statusData.data?.status },
          'TikTok publish status'
        );
      }
    }

    return { success: true, publishId };
  } catch (error) {
    logger.error({ error }, 'TikTok publish failed');
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
