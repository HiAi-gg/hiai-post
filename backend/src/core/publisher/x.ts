/**
 * X (Twitter) publisher — publish tweets and threads via API v2.
 */

import { logger } from '../../lib/logger.js';

export interface XPublishOptions {
  accessToken: string;
  content: string;
  mediaUrls?: string[];
  replyToTweetId?: string;
  threadItems?: string[]; // For thread publishing
}

interface XPublishResult {
  success: boolean;
  tweetId?: string;
  tweetIds?: string[]; // For threads
  error?: string;
}

/**
 * Upload media to X.
 */
async function uploadMedia(
  accessToken: string,
  mediaUrl: string
): Promise<string> {
  // Download the media first
  const mediaResponse = await fetch(mediaUrl, {
    signal: AbortSignal.timeout(30000),
  });
  if (!mediaResponse.ok) {
    throw new Error(`Failed to download media: ${mediaResponse.status}`);
  }

  const mediaBlob = await mediaResponse.blob();
  const formData = new FormData();
  formData.append('media', mediaBlob);

  const uploadResponse = await fetch(
    'https://upload.twitter.com/1.1/media/upload.json',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: formData,
      signal: AbortSignal.timeout(60000),
    }
  );

  if (!uploadResponse.ok) {
    const error = await uploadResponse.text();
    throw new Error(`Media upload failed: ${error}`);
  }

  const data = (await uploadResponse.json()) as { media_id_string: string };
  return data.media_id_string;
}

/**
 * Post a single tweet.
 */
async function postTweet(
  accessToken: string,
  text: string,
  options: { mediaIds?: string[]; replyTo?: string } = {}
): Promise<string> {
  const body: Record<string, unknown> = {
    text,
  };

  if (options.mediaIds?.length) {
    body.media = { media_ids: options.mediaIds };
  }

  if (options.replyTo) {
    body.reply = { in_reply_to_tweet_id: options.replyTo };
  }

  const response = await fetch('https://api.twitter.com/2/tweets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Tweet failed: ${error}`);
  }

  const data = (await response.json()) as { data?: { id?: string } };
  if (!data.data?.id) {
    throw new Error('Tweet ID not returned');
  }

  return data.data.id;
}

/**
 * Publish to X — single tweet or thread.
 */
export async function publishToX(
  options: XPublishOptions
): Promise<XPublishResult> {
  try {
    const { accessToken, content, mediaUrls, replyToTweetId, threadItems } =
      options;

    // Thread publishing
    if (threadItems?.length) {
      const tweetIds: string[] = [];
      let previousTweetId: string | undefined;

      for (const threadContent of threadItems) {
        // Upload media for this tweet if available
        let mediaIds: string[] | undefined;
        if (mediaUrls?.length && tweetIds.length === 0) {
          // Only attach media to first tweet
          mediaIds = await Promise.all(
            mediaUrls.map((url) => uploadMedia(accessToken, url))
          );
        }

        const tweetId = await postTweet(accessToken, threadContent, {
          mediaIds,
          replyTo: previousTweetId,
        });

        tweetIds.push(tweetId);
        previousTweetId = tweetId;

        // Small delay between thread tweets to avoid rate limits
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      return { success: true, tweetIds };
    }

    // Single tweet
    let mediaIds: string[] | undefined;
    if (mediaUrls?.length) {
      mediaIds = await Promise.all(
        mediaUrls.map((url) => uploadMedia(accessToken, url))
      );
    }

    const tweetId = await postTweet(accessToken, content, {
      mediaIds,
      replyTo: replyToTweetId,
    });

    return { success: true, tweetId };
  } catch (error) {
    logger.error({ error }, 'X publish failed');
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
