import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { db } from '../../db/index.js';
import { posts } from '../../db/schema.js';
import { eq, and, gte, sql } from 'drizzle-orm';

export const duplicateCheckStep = createStep({
  id: 'duplicate-check',
  description: 'Three-tier deduplication: title overlap, semantic similarity, template match',
  inputSchema: z.object({
    title: z.string(),
    content: z.string(),
    hashtags: z.array(z.string()),
    platform: z.string(),
    tone: z.string(),
    language: z.string(),
    topic: z.string(),
    tenantId: z.string().optional(),
  }),
  outputSchema: z.object({
    isDuplicate: z.boolean(),
    reason: z.string().optional(),
    title: z.string(),
    content: z.string(),
    hashtags: z.array(z.string()),
    platform: z.string(),
    tone: z.string(),
    language: z.string(),
    topic: z.string(),
  }),
  execute: async ({ inputData }) => {
    const { title, content, tenantId } = inputData;

    if (!tenantId) return { ...inputData, isDuplicate: false };

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // Tier 1: Title word overlap (Jaccard similarity > 0.7)
    const recentPosts = await db
      .select({ contentText: posts.contentText })
      .from(posts)
      .where(
        and(
          eq(posts.tenantId, tenantId),
          gte(posts.createdAt, sevenDaysAgo)
        )
      )
      .limit(100);

    const titleWords = new Set(
      title
        .toLowerCase()
        .replace(/[^\w\s]/g, '')
        .split(/\s+/)
        .filter((w: string) => w.length > 2)
    );

    for (const recent of recentPosts) {
      if (!recent.contentText) continue;
      const recentWords = new Set(
        recent.contentText
          .toLowerCase()
          .replace(/[^\w\s]/g, '')
          .split(/\s+/)
          .filter((w: string) => w.length > 2)
      );

      if (titleWords.size === 0 || recentWords.size === 0) continue;

      const intersection = new Set(
        [...titleWords].filter((w) => recentWords.has(w))
      );
      const union = new Set([...titleWords, ...recentWords]);
      const jaccard = intersection.size / union.size;

      if (jaccard > 0.7) {
        return {
          ...inputData,
          isDuplicate: true,
          reason: `Title overlap with recent post (${(jaccard * 100).toFixed(0)}% similarity)`,
        };
      }
    }

    // Tier 2: Content substring check (> 50% of content matches an existing post)
    const contentNormalized = content
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .trim();

    if (contentNormalized.length > 100) {
      const contentChunks = [];
      for (let i = 0; i < contentNormalized.length; i += 200) {
        contentChunks.push(contentNormalized.slice(i, i + 200));
      }

      for (const recent of recentPosts) {
        if (!recent.contentText) continue;
        const recentContent = recent.contentText
          .toLowerCase()
          .replace(/[^\w\s]/g, '')
          .trim();

        let matchCount = 0;
        for (const chunk of contentChunks) {
          if (recentContent.includes(chunk)) matchCount++;
        }

        const matchRatio = matchCount / contentChunks.length;
        if (matchRatio > 0.5) {
          return {
            ...inputData,
            isDuplicate: true,
            reason: `Content ${Math.round(matchRatio * 100)}% matches existing post`,
          };
        }
      }
    }

    // Tier 3: Semantic similarity via pgvector
    // Only if embedding column exists and has data
    try {
      const result = await db.execute(sql`
        SELECT id, content_text, 1 - (embedding <=> (SELECT embedding FROM posts WHERE tenant_id = ${tenantId} ORDER BY created_at DESC LIMIT 1)) as similarity
        FROM posts
        WHERE tenant_id = ${tenantId}
          AND embedding IS NOT NULL
          AND created_at > NOW() - INTERVAL '30 days'
        ORDER BY similarity DESC
        LIMIT 1
      `);

      const rows = result as unknown as Array<{ similarity?: number; content_text?: string }>;
      const row = rows[0];
      if (row?.similarity && row.similarity > 0.85) {
        const preview = row.content_text?.slice(0, 50) || 'unknown';
        return {
          ...inputData,
          isDuplicate: true,
          reason: `Semantically similar to "${preview}..." (${(row.similarity * 100).toFixed(0)}% similarity)`,
        };
      }
    } catch {
      // pgvector not available or embedding column missing — skip semantic check
    }

    return { ...inputData, isDuplicate: false };
  },
});
