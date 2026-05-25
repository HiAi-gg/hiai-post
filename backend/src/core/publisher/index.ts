/**
 * Publisher registry — maps platform enum to adapter, provides unified publish() interface.
 */

import { publishToInstagram, type InstagramPublishOptions } from './instagram.js';
import { publishToTikTok, type TikTokPublishOptions } from './tiktok.js';
import { publishToX, type XPublishOptions } from './x.js';
import { publishToLinkedIn, type LinkedInPublishOptions } from './linkedin.js';
import { publishToFacebook, type FacebookPublishOptions } from './facebook.js';
import { publishToTelegram, type TelegramPublishOptions } from './telegram.js';
import { publishToThreads, type ThreadsPublishOptions } from './threads.js';
import { publishToPinterest, type PinterestPublishOptions } from './pinterest.js';
import { logger } from '../../lib/logger.js';

export type SupportedPlatform =
  | 'instagram'
  | 'tiktok'
  | 'x'
  | 'linkedin'
  | 'facebook'
  | 'telegram'
  | 'threads'
  | 'pinterest';

export interface PublishRequest {
  platform: SupportedPlatform;
  content: string;
  mediaUrl?: string;
  mediaType?: string;
  // Platform-specific credentials
  credentials: Record<string, string>;
  // Additional platform-specific options
  options?: Record<string, unknown>;
}

export interface PublishResponse {
  success: boolean;
  postId?: string;
  postIds?: string[];
  error?: string;
  platform: SupportedPlatform;
}

/**
 * Publish content to a single platform.
 */
export async function publish(request: PublishRequest): Promise<PublishResponse> {
  const { platform, content, mediaUrl, mediaType, credentials, options } = request;

  logger.info({ platform, contentLength: content.length }, 'Publishing to platform');

  try {
    switch (platform) {
      case 'instagram': {
        const result = await publishToInstagram({
          accessToken: credentials.accessToken,
          instagramAccountId: credentials.accountId,
          content,
          mediaUrl,
          mediaType: mediaType as InstagramPublishOptions['mediaType'],
          carouselItems: options?.carouselItems as InstagramPublishOptions['carouselItems'],
        });
        return { ...result, platform };
      }

      case 'tiktok': {
        const result = await publishToTikTok({
          accessToken: credentials.accessToken,
          openId: credentials.openId,
          videoUrl: mediaUrl || '',
          title: (options?.title as string) || content.slice(0, 150),
          description: content,
          hashtags: options?.hashtags as string[],
          privacyLevel: options?.privacyLevel as TikTokPublishOptions['privacyLevel'],
        });
        return { ...result, platform };
      }

      case 'x': {
        const result = await publishToX({
          accessToken: credentials.accessToken,
          content,
          mediaUrls: mediaUrl ? [mediaUrl] : undefined,
          replyToTweetId: options?.replyTo as string,
          threadItems: options?.threadItems as string[],
        });
        return {
          success: result.success,
          postId: result.tweetId,
          postIds: result.tweetIds,
          error: result.error,
          platform,
        };
      }

      case 'linkedin': {
        const result = await publishToLinkedIn({
          accessToken: credentials.accessToken,
          personUrn: credentials.personUrn,
          content,
          mediaUrl,
          title: options?.title as string,
          description: options?.description as string,
        });
        return { ...result, platform };
      }

      case 'facebook': {
        const result = await publishToFacebook({
          accessToken: credentials.accessToken,
          pageId: credentials.pageId,
          content,
          mediaUrl,
          link: options?.link as string,
          scheduledPublishTime: options?.scheduledPublishTime as number,
        });
        return { ...result, platform };
      }

      case 'telegram': {
        const result = await publishToTelegram({
          botToken: credentials.botToken,
          chatId: credentials.chatId,
          content,
          mediaUrl,
          mediaType: mediaType as TelegramPublishOptions['mediaType'],
          parseMode: (options?.parseMode as TelegramPublishOptions['parseMode']) || 'Markdown',
          replyMarkup: options?.replyMarkup as Record<string, unknown>,
        });
        return {
          success: result.success,
          postId: result.messageId?.toString(),
          error: result.error,
          platform,
        };
      }

      case 'threads': {
        const result = await publishToThreads({
          accessToken: credentials.accessToken,
          userId: credentials.accountId || credentials.userId,
          text: content,
          mediaUrls: mediaUrl ? [mediaUrl] : undefined,
        });
        return { ...result, platform };
      }

      case 'pinterest': {
        const result = await publishToPinterest({
          accessToken: credentials.accessToken,
          boardId: credentials.boardId || (options?.boardId as string) || '',
          title: (options?.title as string) || content.slice(0, 100),
          description: content,
          imageUrl: mediaUrl || '',
          link: options?.link as string,
        });
        return { ...result, platform };
      }

      default:
        return {
          success: false,
          error: `Unsupported platform: ${platform}`,
          platform,
        };
    }
  } catch (error) {
    logger.error({ error, platform }, 'Publish failed');
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      platform,
    };
  }
}

/**
 * Publish to multiple platforms concurrently.
 */
export async function publishToMultiple(
  requests: PublishRequest[]
): Promise<PublishResponse[]> {
  const results = await Promise.allSettled(
    requests.map((request) => publish(request))
  );

  return results.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value;
    }
    return {
      success: false,
      error: result.reason?.message || 'Publish failed',
      platform: requests[index].platform,
    };
  });
}

/**
 * Get platform display name.
 */
export function getPlatformDisplayName(platform: SupportedPlatform): string {
  const names: Record<SupportedPlatform, string> = {
    instagram: 'Instagram',
    tiktok: 'TikTok',
    x: 'X (Twitter)',
    linkedin: 'LinkedIn',
    facebook: 'Facebook',
    telegram: 'Telegram',
    threads: 'Threads',
    pinterest: 'Pinterest',
  };
  return names[platform] || platform;
}

/**
 * Get all supported platforms.
 */
export function getSupportedPlatforms(): SupportedPlatform[] {
  return ['instagram', 'tiktok', 'x', 'linkedin', 'facebook', 'telegram', 'threads', 'pinterest'];
}
