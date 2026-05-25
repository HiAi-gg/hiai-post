import { logger } from '../../lib/logger.js';

export interface ThreadsPublishOptions {
  accessToken: string;
  userId: string;
  text: string;
  mediaUrls?: string[];
  replyToId?: string;
}

export async function publishToThreads(options: ThreadsPublishOptions): Promise<{ success: boolean; postId?: string; error?: string }> {
  try {
    const { accessToken, userId, text, mediaUrls, replyToId } = options;

    // Step 1: Create media container
    let creationId: string;
    if (mediaUrls?.length) {
      const containerRes = await fetch(`https://graph.threads.net/v1.0/${userId}/threads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: mediaUrls[0], text, media_type: 'IMAGE' }),
      });
      const containerData = await containerRes.json();
      if (!containerData.id) return { success: false, error: containerData.error?.message || 'Container creation failed' };
      creationId = containerData.id;
    } else {
      const containerRes = await fetch(`https://graph.threads.net/v1.0/${userId}/threads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, media_type: 'TEXT' }),
      });
      const containerData = await containerRes.json();
      if (!containerData.id) return { success: false, error: containerData.error?.message || 'Container creation failed' };
      creationId = containerData.id;
    }

    // Step 2: Publish
    const publishRes = await fetch(`https://graph.threads.net/v1.0/${userId}/threads_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ creation_id: creationId }),
    });
    const publishData = await publishRes.json();
    if (publishData.id) return { success: true, postId: publishData.id };
    return { success: false, error: publishData.error?.message || 'Publish failed' };
  } catch (error) {
    logger.error({ error }, 'Threads publish failed');
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
