/**
 * Platform content rules — SINGLE SOURCE OF TRUTH for all platform constraints.
 * Used by: content-write step, platform-format step, duplicate-check, post editor, validation.
 */

export interface PlatformRule {
  maxLength: number;
  markdownAllowed: boolean;
  emojiRange: [number, number]; // [min, max]
  hashtagRange: [number, number];
  mediaRequired: boolean;
  format: 'text' | 'thread' | 'script' | 'article';
  threadMaxChars?: number; // for thread-type platforms
  scriptDurationRange?: [number, number]; // seconds, for video scripts
  notes: string[];
}

export type Platform =
  | 'telegram-post'
  | 'linkedin-post'
  | 'twitter-thread'
  | 'x-post'
  | 'threads-post'
  | 'pinterest-pin'
  | 'instagram-caption'
  | 'instagram-reel-script'
  | 'tiktok-script'
  | 'youtube-shorts-script'
  | 'youtube-long-script'
  | 'blog-long';

export const platformRules: Record<Platform, PlatformRule> = {
  'telegram-post': {
    maxLength: 3500,
    markdownAllowed: true, // Telegram supports **bold**, _italic_, `code`
    emojiRange: [3, 7],
    hashtagRange: [0, 3],
    mediaRequired: false,
    format: 'text',
    notes: [
      'Markdown bold: **text**',
      'Hashtags go at the end of the post',
      'Telegram supports inline links [text](url)',
      'No nested lists — flat structure only',
    ],
  },

  'linkedin-post': {
    maxLength: 2800,
    markdownAllowed: false, // LinkedIn strips markdown
    emojiRange: [0, 4],
    hashtagRange: [3, 5],
    mediaRequired: false,
    format: 'text',
    notes: [
      'No markdown — LinkedIn renders plain text only',
      'Use line breaks for readability',
      'Hashtags at the end, not inline',
      'Raw URL at the end (LinkedIn auto-previews)',
      'First 2 lines are critical — they appear before "see more"',
    ],
  },

  'twitter-thread': {
    maxLength: 275, // per tweet, leave room for thread numbering
    markdownAllowed: false,
    emojiRange: [0, 2], // per tweet
    hashtagRange: [0, 2], // last tweet only
    mediaRequired: false,
    format: 'thread',
    threadMaxChars: 275,
    notes: [
      'Each tweet max 275 chars (280 minus thread number)',
      'Format: "1/N\\n\\nContent"',
      'Thread number counts toward char limit',
      'Hashtags only in the last tweet',
      'End last tweet with CTA or key takeaway',
    ],
  },

  'instagram-caption': {
    maxLength: 2000,
    markdownAllowed: false, // Instagram strips all formatting
    emojiRange: [4, 10],
    hashtagRange: [10, 20],
    mediaRequired: true, // Instagram REQUIRES media
    format: 'text',
    notes: [
      'No markdown, no bold, no links in caption',
      'Hashtags: mix of popular (100k+) and niche (<10k)',
      'Put hashtags in first comment or after 5 line breaks',
      'First sentence is the hook — appears before "more"',
      'Use emoji as visual separators between paragraphs',
    ],
  },

  'instagram-reel-script': {
    maxLength: 5000, // script text, not caption
    markdownAllowed: false,
    emojiRange: [0, 3],
    hashtagRange: [0, 5],
    mediaRequired: true,
    format: 'script',
    scriptDurationRange: [30, 60],
    notes: [
      'Structure: Hook (0-3s) → Build (3-40s) → Payoff (40-55s) → CTA (55-60s)',
      '[VISUAL: description] markers for each shot',
      'Hook must grab attention in first 1.5 seconds',
      'Text overlay suggestions with [TEXT ON SCREEN: ...]',
      'Trending audio suggestion in [SOUND: ...] marker',
    ],
  },

  'tiktok-script': {
    maxLength: 4000,
    markdownAllowed: false,
    emojiRange: [0, 3],
    hashtagRange: [3, 7],
    mediaRequired: true,
    format: 'script',
    scriptDurationRange: [15, 60],
    notes: [
      'Pattern interrupt hook in first 1-2 seconds',
      '[SOUND: trending audio or voiceover] markers',
      '[VISUAL: shot description] for each cut',
      'Text overlays with [TEXT ON SCREEN: ...]',
      'End with question or CTA for engagement',
      'Fast-paced editing — new visual every 2-3 seconds',
    ],
  },

  'youtube-shorts-script': {
    maxLength: 3000,
    markdownAllowed: false,
    emojiRange: [0, 3],
    hashtagRange: [3, 5],
    mediaRequired: true,
    format: 'script',
    scriptDurationRange: [15, 60],
    notes: [
      '[TEXT-ON-SCREEN: ...] for key points',
      '[VISUAL: ...] for each shot',
      'Vertical format (9:16)',
      'Hook in first 2 seconds',
      'Loop-friendly ending (connects back to start)',
    ],
  },

  'youtube-long-script': {
    maxLength: 50000, // long-form script
    markdownAllowed: true,
    emojiRange: [0, 5],
    hashtagRange: [5, 10],
    mediaRequired: true,
    format: 'script',
    scriptDurationRange: [300, 900], // 5-15 minutes
    notes: [
      'Numbered chapters with timestamps',
      '[VISUAL: ...] and [B-ROLL: ...] markers for each section',
      'Intro hook (0-30s) → Problem (30s-2min) → Solution (2-8min) → Summary (8-10min) → CTA',
      'Include chapter timestamps in description',
      'Suggest thumbnail concept in notes',
    ],
  },

  'blog-long': {
    maxLength: 10000,
    markdownAllowed: true,
    emojiRange: [0, 5],
    hashtagRange: [0, 5],
    mediaRequired: false,
    format: 'article',
    notes: [
      'Full Markdown with ## headers',
      'Include meta description (160 chars)',
      'Suggest featured image alt text',
      'Internal link suggestions where relevant',
      'Clear CTA at the end',
    ],
  },

  'x-post': {
    maxLength: 280,
    markdownAllowed: false,
    emojiRange: [0, 3],
    hashtagRange: [0, 3],
    mediaRequired: false,
    format: 'text',
    notes: [
      '280 character limit',
      'Links count as 23 characters (t.co)',
      'Media: images, GIFs, videos supported',
      'First 2 lines are critical for engagement',
      'Thread by replying to own tweet',
    ],
  },

  'threads-post': {
    maxLength: 500,
    markdownAllowed: false,
    emojiRange: [0, 5],
    hashtagRange: [0, 5],
    mediaRequired: false,
    format: 'text',
    notes: [
      'Threads supports text + media posts',
      'Max 500 characters',
      'Links are clickable',
      'Repost and quote features available',
      'Cross-post from Instagram',
    ],
  },

  'pinterest-pin': {
    maxLength: 500,
    markdownAllowed: false,
    emojiRange: [0, 3],
    hashtagRange: [0, 10],
    mediaRequired: true,
    format: 'text',
    notes: [
      'Pinterest REQUIRES an image',
      'Title: 100 characters max',
      'Description: 500 characters max',
      'Alt text for accessibility',
      'Link to source/landing page',
      'Rich Pins for auto-metadata',
    ],
  },
};

/**
 * Get platform rule by platform name.
 */
export function getPlatformRule(platform: Platform): PlatformRule {
  const rule = platformRules[platform];
  if (!rule) {
    throw new Error(`Unknown platform: ${platform}`);
  }
  return rule;
}

/**
 * Get all available platforms.
 */
export function getAllPlatforms(): Platform[] {
  return Object.keys(platformRules) as Platform[];
}

/**
 * Validate content against platform rules.
 */
export function validateContent(
  platform: Platform,
  content: string
): { valid: boolean; errors: string[] } {
  const rule = getPlatformRule(platform);
  const errors: string[] = [];

  if (content.length > rule.maxLength) {
    errors.push(
      `Content exceeds max length: ${content.length}/${rule.maxLength} chars`
    );
  }

  if (!rule.markdownAllowed) {
    const markdownPatterns = /\*\*|__|~~|`{1,3}|\[.+\]\(.+\)|^#{1,6}\s/m;
    if (markdownPatterns.test(content)) {
      errors.push('Content contains markdown but platform does not support it');
    }
  }

  // Count emoji (rough heuristic)
  const emojiRegex =
    /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2702}-\u{27B0}\u{24C2}-\u{1F251}]/gu;
  const emojiCount = (content.match(emojiRegex) || []).length;
  if (emojiCount < rule.emojiRange[0]) {
    errors.push(
      `Too few emoji: ${emojiCount}/${rule.emojiRange[0]} minimum`
    );
  }
  if (emojiCount > rule.emojiRange[1]) {
    errors.push(
      `Too many emoji: ${emojiCount}/${rule.emojiRange[1]} maximum`
    );
  }

  // Count hashtags
  const hashtagCount = (content.match(/#\w+/g) || []).length;
  if (hashtagCount < rule.hashtagRange[0]) {
    errors.push(
      `Too few hashtags: ${hashtagCount}/${rule.hashtagRange[0]} minimum`
    );
  }
  if (hashtagCount > rule.hashtagRange[1]) {
    errors.push(
      `Too many hashtags: ${hashtagCount}/${rule.hashtagRange[1]} maximum`
    );
  }

  return { valid: errors.length === 0, errors };
}
