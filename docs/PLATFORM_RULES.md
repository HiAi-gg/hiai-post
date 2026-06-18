# Platform Content Rules

Auto-generated reference from `backend/src/lib/platform-rules.ts`.

Each platform has specific constraints for content length, formatting, emoji usage, hashtags, and media requirements. This file is the **single source of truth** — the `platform-rules.ts` module exports `PlatformRule` objects consumed by the AI content workflow, post editor validation, and the backend content validator.

---

## Rule Structure

```typescript
interface PlatformRule {
  maxLength: number;
  markdownAllowed: boolean;
  emojiRange: [number, number];      // [min, max]
  hashtagRange: [number, number];    // [min, max]
  mediaRequired: boolean;
  format: 'text' | 'thread' | 'script' | 'article';
  threadMaxChars?: number;            // for thread-type platforms
  scriptDurationRange?: [number, number];  // seconds, for video scripts
  notes: string[];
}
```

---

## Platform Rules Table

### Character Limits & Content Format

| Platform | Max Length | Format | Markdown | Media Required |
|----------|-----------|--------|----------|---------------|
| Telegram Post | 3,500 | text | Yes | No |
| LinkedIn Post | 2,800 | text | No | No |
| X (Twitter) Post | 280 | text | No | No |
| Twitter Thread | 275/tweet | thread | No | No |
| Threads Post | 500 | text | No | No |
| Instagram Caption | 2,000 | text | No | **Yes** |
| Instagram Reel Script | 5,000 | script | No | **Yes** |
| TikTok Script | 4,000 | script | No | **Yes** |
| YouTube Shorts Script | 3,000 | script | No | **Yes** |
| YouTube Long Script | 50,000 | script | Yes | **Yes** |
| Pinterest Pin | 500 | text | No | **Yes** |
| Blog Long-Form | 10,000 | article | Yes | No |

### Emoji Limits

| Platform | Min Emoji | Max Emoji |
|----------|-----------|-----------|
| Telegram Post | 3 | 7 |
| LinkedIn Post | 0 | 4 |
| X (Twitter) Post | 0 | 3 |
| Twitter Thread | 0 | 2 |
| Threads Post | 0 | 5 |
| Instagram Caption | 4 | 10 |
| Instagram Reel Script | 0 | 3 |
| TikTok Script | 0 | 3 |
| YouTube Shorts Script | 0 | 3 |
| YouTube Long Script | 0 | 5 |
| Pinterest Pin | 0 | 3 |
| Blog Long-Form | 0 | 5 |

### Hashtag Limits

| Platform | Min Hashtags | Max Hashtags |
|----------|-------------|-------------|
| Telegram Post | 0 | 3 |
| LinkedIn Post | 3 | 5 |
| X (Twitter) Post | 0 | 3 |
| Twitter Thread | 0 | 2 (last tweet only) |
| Threads Post | 0 | 5 |
| Instagram Caption | 10 | 20 |
| Instagram Reel Script | 0 | 5 |
| TikTok Script | 3 | 7 |
| YouTube Shorts Script | 3 | 5 |
| YouTube Long Script | 5 | 10 |
| Pinterest Pin | 0 | 10 |
| Blog Long-Form | 0 | 5 |

### Media Requirements

| Platform | Media Required | Notes |
|----------|---------------|-------|
| Instagram Caption | Yes | Post requires image(s) or video |
| Instagram Reel Script | Yes | Reel requires video content |
| TikTok Script | Yes | Video required (vertical 9:16) |
| YouTube Shorts Script | Yes | Vertical video (15-60s) |
| YouTube Long Script | Yes | Video required (5-15 min) |
| Pinterest Pin | Yes | Image required |
| All others | No | Media optional |

### Script Duration Ranges

| Platform | Min Duration | Max Duration |
|----------|-------------|-------------|
| Instagram Reel Script | 30s | 60s |
| TikTok Script | 15s | 60s |
| YouTube Shorts Script | 15s | 60s |
| YouTube Long Script | 5 min (300s) | 15 min (900s) |

---

## Platform-Specific Notes

### Telegram Post
- Supports Markdown: `**bold**`, `_italic_`, `` `code` ``
- Hashtags go at the end of the post
- Supports inline links: `[text](url)`
- No nested lists — flat structure only

### LinkedIn Post
- No markdown — LinkedIn renders plain text only
- Use line breaks for readability
- Hashtags at the end, not inline
- Raw URL at the end (LinkedIn auto-previews)
- First 2 lines are critical — they appear before "see more"

### X (Twitter) Post
- 280 character limit (including t.co link expansion: links count as 23 chars)
- No markdown
- First 2 lines are critical for engagement
- Thread by replying to own tweet

### Twitter Thread
- Per-tweet limit: 275 chars (280 minus thread number)
- Format: `"1/N\n\nContent"`
- Thread number counts toward char limit
- Hashtags only in the last tweet
- End last tweet with CTA or key takeaway

### Threads Post
- Max 500 characters
- Links are clickable
- Repost and quote features available
- Cross-post from Instagram

### Instagram Caption
- No markdown, no bold, no links in caption
- Hashtags: mix of popular (100k+) and niche (<10k)
- Put hashtags in first comment or after 5 line breaks
- First sentence is the hook — appears before "more"
- Use emoji as visual separators between paragraphs

### Instagram Reel Script
- Structure: Hook (0-3s) → Build (3-40s) → Payoff (40-55s) → CTA (55-60s)
- `[VISUAL: description]` markers for each shot
- Hook must grab attention in first 1.5 seconds
- Text overlay suggestions with `[TEXT ON SCREEN: ...]`
- Trending audio suggestion in `[SOUND: ...]` marker

### TikTok Script
- Pattern interrupt hook in first 1-2 seconds
- `[SOUND: trending audio or voiceover]` markers
- `[VISUAL: shot description]` for each cut
- Text overlays with `[TEXT ON SCREEN: ...]`
- End with question or CTA for engagement
- Fast-paced editing — new visual every 2-3 seconds

### YouTube Shorts Script
- `[TEXT-ON-SCREEN: ...]` for key points
- `[VISUAL: ...]` for each shot
- Vertical format (9:16)
- Hook in first 2 seconds
- Loop-friendly ending (connects back to start)

### YouTube Long Script
- Numbered chapters with timestamps
- `[VISUAL: ...]` and `[B-ROLL: ...]` markers for each section
- Structure: Intro hook (0-30s) → Problem (30s-2min) → Solution (2-8min) → Summary (8-10min) → CTA
- Include chapter timestamps in description
- Suggest thumbnail concept in notes

### Pinterest Pin
- Pinterest REQUIRES an image
- Title: 100 characters max
- Description: 500 characters max
- Alt text for accessibility
- Link to source/landing page
- Rich Pins for auto-metadata

### Blog Long-Form
- Full Markdown with `##` headers
- Include meta description (160 chars)
- Suggest featured image alt text
- Internal link suggestions where relevant
- Clear CTA at the end

---

## Validation Rules

The `validateContent()` function checks:
1. **Max length** — content must not exceed platform limit
2. **Markdown** — if platform does not support markdown, check for markdown patterns (`**`, `__`, `~~`, `` ` ``, `[text](url)`, `# header`)
3. **Emoji count** — must be within platform range (uses Unicode emoji regex)
4. **Hashtag count** — must be within platform range (matches `#\w+` pattern)

```typescript
const result = validateContent('instagram-caption', 'Your post content here');
// Returns: { valid: boolean, errors: string[] }
```
