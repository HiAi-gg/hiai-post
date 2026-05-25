import { logger } from '../../lib/logger.js';

export interface PinterestPublishOptions {
  accessToken: string;
  boardId: string;
  title: string;
  description: string;
  imageUrl: string;
  link?: string;
}

export async function publishToPinterest(options: PinterestPublishOptions): Promise<{ success: boolean; pinId?: string; error?: string }> {
  try {
    const { accessToken, boardId, title, description, imageUrl, link } = options;

    const res = await fetch('https://api.pinterest.com/v5/pins', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        board_id: boardId,
        title: title.slice(0, 100),
        description: description.slice(0, 500),
        media_source: { source_type: 'image_url', url: imageUrl },
        link: link || undefined,
      }),
    });

    const data = await res.json();
    if (data.id) return { success: true, pinId: data.id };
    return { success: false, error: data.message || data.error || 'Pin creation failed' };
  } catch (error) {
    logger.error({ error }, 'Pinterest publish failed');
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
