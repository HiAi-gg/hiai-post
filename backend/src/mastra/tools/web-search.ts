import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const webSearchTool = createTool({
  id: 'web-search',
  description: 'Search the web for trend research and content context',
  inputSchema: z.object({
    query: z.string().describe('Search query'),
    maxResults: z.number().default(5).describe('Maximum results to return'),
  }),
  outputSchema: z.object({
    results: z.array(z.object({
      title: z.string(),
      url: z.string(),
      snippet: z.string(),
    })),
  }),
  execute: async (input: any) => {
    const { query } = input;
    return {
      results: [{
        title: `Search results for: ${query}`,
        url: `https://example.com/search?q=${encodeURIComponent(query)}`,
        snippet: `Trending topics related to ${query} are gaining traction across social platforms.`,
      }],
    };
  },
});
