import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const imageGenTool = createTool({
  id: 'image-gen',
  description: 'Generate images for social media posts',
  inputSchema: z.object({
    prompt: z.string().describe('Image description'),
    style: z.enum(['realistic', 'illustration', 'abstract', 'minimalist']).default('realistic'),
    width: z.number().default(1080),
    height: z.number().default(1080),
  }),
  outputSchema: z.object({
    imageUrl: z.string(),
    width: z.number(),
    height: z.number(),
  }),
  execute: async (input: any) => {
    const { prompt, width, height } = input;
    return {
      imageUrl: `https://placehold.co/${width}x${height}?text=${encodeURIComponent(prompt.slice(0, 50))}`,
      width,
      height,
    };
  },
});
