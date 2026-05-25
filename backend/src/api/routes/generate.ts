/**
 * Generate route — AI content generation endpoint.
 */

import { Elysia, t } from 'elysia';
import { getMastra } from '../../mastra/index.js';
import { contentGenerateWorkflow } from '../../mastra/workflows/content-generate.js';
import { db } from '../../db/index.js';
import { posts } from '../../db/schema.js';
import { logger } from '../../lib/logger.js';
import { z } from 'zod';

const generateRequestSchema = z.object({
  topic: z.string().min(1).max(500),
  language: z.string().min(2).max(5).default('en'),
  platforms: z
    .array(z.string())
    .min(1)
    .max(9),
  tone: z.string().default('professional'),
  additionalContext: z.string().max(2000).optional(),
});

export function generateRoutes() {
  return new Elysia({ prefix: '/api/v1' })
    .post('/posts/generate', async ({ body, set }) => {
      try {
        const validated = generateRequestSchema.parse(body);

        const workflow = contentGenerateWorkflow;
        const run = await workflow.createRun();
        const result = await (run as any).start({
          inputData: {
            topic: validated.topic,
            language: validated.language,
            platforms: validated.platforms,
            tone: validated.tone,
            additionalContext: validated.additionalContext,
          },
        });

        if (result.status !== 'success') {
          set.status = 500;
          return {
            error: 'Content generation failed',
            details: result.status === 'error' ? result.error : 'Unknown error',
          };
        }

        const { posts: generatedPosts, isDuplicate } = result.result;

        if (isDuplicate) {
          set.status = 409;
          return {
            error: 'Duplicate content detected',
            message: 'Similar content was recently published. Please modify your topic.',
          };
        }

        return {
          success: true,
          posts: generatedPosts,
          count: generatedPosts.length,
        };
      } catch (err) {
        set.status = 500;
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ error: message }, 'Generate endpoint error');
        return { error: message };
      }
    })

    .post('/posts/:id/optimize', async ({ params, body, set }) => {
      try {
        const { content, platform } = body as { content: string; platform: string };
        if (!content || !platform) {
          set.status = 400;
          return { error: 'content and platform are required' };
        }

        const mastra = getMastra();
        const agent = mastra.getAgent('optimizer');
        const result = await agent.generate(
          `Optimize this ${platform} post for better engagement:\n\n"${content}"\n\nReturn JSON with: content (string), hashtags (array), improvements (array of strings describing what was improved).`
        );

        try {
          const parsed = JSON.parse(result.text);
          return {
            id: params.id,
            optimizedContent: parsed.content || content,
            hashtags: parsed.hashtags || [],
            improvements: parsed.improvements || [],
          };
        } catch {
          return {
            id: params.id,
            optimizedContent: result.text.slice(0, 2200),
            hashtags: [],
            improvements: ['Content polished'],
          };
        }
      } catch (err) {
        set.status = 500;
        const message = err instanceof Error ? err.message : String(err);
        return { error: message };
      }
    });
}
