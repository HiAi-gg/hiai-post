/**
 * Instagram publisher — publish content via Instagram Graph API.
 */

import { config } from '../../lib/config.js';
import { logger } from '../../lib/logger.js';

export interface InstagramPublishOptions {
  accessToken: string;
  instagramAccountId: string;
  content: string;
  mediaUrl?: string;
  mediaType?: 'IMAGE' | 'VIDEO' | 'CAROUSEL' | 'STORY' | 'REEL';
  carouselItems?: Array<{ url: string; type: 'IMAGE' | 'VIDEO' }>;
}

interface InstagramPublishResult {
  success: boolean;
  postId?: string;
  error?: string;
}

/**
 * Create a media container for Instagram.
 */
async function createMediaContainer(
  accountId: string,
  accessToken: string,
  options: {
    imageUrl?: string;
    videoUrl?: string;
    caption?: string;
    isCarouselItem?: boolean;
    mediaType?: string;
  }
): Promise<string> {
  const params = new URLSearchParams({
    access_token: accessToken,
  });

  if (options.imageUrl) {
    params.append('image_url', options.imageUrl);
  }
  if (options.videoUrl) {
    params.append('video_url', options.videoUrl);
  }
  if (options.caption && !options.isCarouselItem) {
    params.append('caption', options.caption);
  }
  if (options.mediaType) {
    params.append('media_type', options.mediaType);
  }

  const response = await fetch(
    `https://graph.facebook.com/v19.0/${accountId}/media?${params}`,
    {
      method: 'POST',
      signal: AbortSignal.timeout(30000),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Instagram media container creation failed: ${error}`);
  }

  const data = (await response.json()) as { id: string };
  return data.id;
}

/**
 * Publish a media container.
 */
async function publishMediaContainer(
  accountId: string,
  accessToken: string,
  containerId: string
): Promise<string> {
  const response = await fetch(
    `https://graph.facebook.com/v19.0/${accountId}/media_publish`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        creation_id: containerId,
        access_token: accessToken,
      }),
      signal: AbortSignal.timeout(30000),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Instagram publish failed: ${error}`);
  }

  const data = (await response.json()) as { id: string };
  return data.id;
}

/**
 * Wait for media container to be ready.
 */
async function waitForContainer(
  containerId: string,
  accessToken: string,
  maxWaitMs = 60000
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    const response = await fetch(
      `https://graph.facebook.com/v19.0/${containerId}?fields=status_code&access_token=${accessToken}`,
      { signal: AbortSignal.timeout(10000) }
    );

    if (!response.ok) break;

    const data = (await response.json()) as { status_code?: string };
    if (data.status_code === 'FINISHED') return;
    if (data.status_code === 'ERROR') {
      throw new Error('Instagram media processing failed');
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

/**
 * Publish content to Instagram.
 */
export async function publishToInstagram(
  options: InstagramPublishOptions
): Promise<InstagramPublishResult> {
  try {
    const { accessToken, instagramAccountId, content, mediaUrl, mediaType } =
      options;

    if (!mediaUrl && mediaType !== 'CAROUSEL') {
      return {
        success: false,
        error: 'Instagram requires media (image or video)',
      };
    }

    // Single image post
    if (mediaType === 'IMAGE' || !mediaType) {
      const containerId = await createMediaContainer(
        instagramAccountId,
        accessToken,
        {
          imageUrl: mediaUrl,
          caption: content,
        }
      );

      await waitForContainer(containerId, accessToken);
      const postId = await publishMediaContainer(
        instagramAccountId,
        accessToken,
        containerId
      );

      return { success: true, postId };
    }

    // Video / Reel
    if (mediaType === 'VIDEO' || mediaType === 'REEL') {
      const containerId = await createMediaContainer(
        instagramAccountId,
        accessToken,
        {
          videoUrl: mediaUrl,
          caption: content,
          mediaType: mediaType === 'REEL' ? 'REELS' : 'VIDEO',
        }
      );

      await waitForContainer(containerId, accessToken, 120000);
      const postId = await publishMediaContainer(
        instagramAccountId,
        accessToken,
        containerId
      );

      return { success: true, postId };
    }

    // Carousel
    if (mediaType === 'CAROUSEL' && options.carouselItems?.length) {
      const itemIds = await Promise.all(
        options.carouselItems.map((item) =>
          createMediaContainer(instagramAccountId, accessToken, {
            imageUrl: item.type === 'IMAGE' ? item.url : undefined,
            videoUrl: item.type === 'VIDEO' ? item.url : undefined,
            isCarouselItem: true,
          })
        )
      );

      // Wait for all items
      await Promise.all(
        itemIds.map((id) => waitForContainer(id, accessToken))
      );

      // Create carousel container
      const carouselParams = new URLSearchParams({
        media_type: 'CAROUSEL',
        children: itemIds.join(','),
        caption: content,
        access_token: accessToken,
      });

      const carouselResponse = await fetch(
        `https://graph.facebook.com/v19.0/${instagramAccountId}/media`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: carouselParams,
          signal: AbortSignal.timeout(30000),
        }
      );

      if (!carouselResponse.ok) {
        const error = await carouselResponse.text();
        throw new Error(`Carousel creation failed: ${error}`);
      }

      const carouselData = (await carouselResponse.json()) as { id: string };
      await waitForContainer(carouselData.id, accessToken);
      const postId = await publishMediaContainer(
        instagramAccountId,
        accessToken,
        carouselData.id
      );

      return { success: true, postId };
    }

    return { success: false, error: 'Unsupported media type' };
  } catch (error) {
    logger.error({ error }, 'Instagram publish failed');
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
