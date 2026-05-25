/**
 * Facebook publisher — publish posts via Facebook Graph API.
 */

import { logger } from '../../lib/logger.js';

export interface FacebookPublishOptions {
  accessToken: string;
  pageId: string;
  content: string;
  mediaUrl?: string;
  link?: string;
  scheduledPublishTime?: number; // Unix timestamp
}

interface FacebookPublishResult {
  success: boolean;
  postId?: string;
  error?: string;
}

/**
 * Upload a photo to a Facebook page.
 */
async function uploadPhoto(
  pageId: string,
  accessToken: string,
  imageUrl: string,
  caption: string
): Promise<string> {
  const response = await fetch(
    `https://graph.facebook.com/v19.0/${pageId}/photos`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        url: imageUrl,
        caption,
        access_token: accessToken,
      }),
      signal: AbortSignal.timeout(30000),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Facebook photo upload failed: ${error}`);
  }

  const data = (await response.json()) as { id: string };
  return data.id;
}

/**
 * Upload a video to a Facebook page.
 */
async function uploadVideo(
  pageId: string,
  accessToken: string,
  videoUrl: string,
  description: string
): Promise<string> {
  const response = await fetch(
    `https://graph.facebook.com/v19.0/${pageId}/videos`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        file_url: videoUrl,
        description,
        access_token: accessToken,
      }),
      signal: AbortSignal.timeout(120000),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Facebook video upload failed: ${error}`);
  }

  const data = (await response.json()) as { id: string };
  return data.id;
}

/**
 * Publish to Facebook.
 */
export async function publishToFacebook(
  options: FacebookPublishOptions
): Promise<FacebookPublishResult> {
  try {
    const { accessToken, pageId, content, mediaUrl, link, scheduledPublishTime } =
      options;

    // Video post
    if (mediaUrl && mediaUrl.match(/\.(mp4|mov|avi|webm)$/i)) {
      const videoId = await uploadVideo(pageId, accessToken, mediaUrl, content);
      return { success: true, postId: videoId };
    }

    // Photo post
    if (mediaUrl) {
      const photoId = await uploadPhoto(
        pageId,
        accessToken,
        mediaUrl,
        content
      );
      return { success: true, postId: photoId };
    }

    // Text/link post
    const params = new URLSearchParams({
      message: content,
      access_token: accessToken,
    });

    if (link) {
      params.append('link', link);
    }

    if (scheduledPublishTime) {
      params.append(
        'scheduled_publish_time',
        scheduledPublishTime.toString()
      );
      params.append('published', 'false');
    }

    const response = await fetch(
      `https://graph.facebook.com/v19.0/${pageId}/feed`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params,
        signal: AbortSignal.timeout(15000),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      logger.error({ status: response.status, error }, 'Facebook publish failed');
      return {
        success: false,
        error: `Facebook API error: ${response.status}`,
      };
    }

    const data = (await response.json()) as { id: string };
    return { success: true, postId: data.id };
  } catch (error) {
    logger.error({ error }, 'Facebook publish failed');
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
