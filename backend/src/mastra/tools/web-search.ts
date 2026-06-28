import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { config } from "@/lib/config";

const TAVILY_ENDPOINT = "https://api.tavily.com/search";
const TAVILY_TIMEOUT_MS = 10_000;

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
}

interface TavilyResponse {
  results?: TavilyResult[];
}

export const webSearchTool = createTool({
  id: "web-search",
  description: "Search the web for trend research and content context",
  inputSchema: z.object({
    query: z.string().describe("Search query"),
    maxResults: z.number().default(5).describe("Maximum results to return"),
  }),
  outputSchema: z.object({
    results: z.array(
      z.object({
        title: z.string(),
        url: z.string(),
        snippet: z.string(),
      })
    ),
  }),
  execute: async (input: any) => {
    const { query, maxResults } = input;

    if (!config.TAVILY_API_KEY) {
      console.warn("[web-search] TAVILY_API_KEY not set — returning empty results");
      return { results: [] };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TAVILY_TIMEOUT_MS);

    try {
      const response = await fetch(TAVILY_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          api_key: config.TAVILY_API_KEY,
          query,
          max_results: maxResults,
          include_answer: false,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        console.error(`[web-search] Tavily returned HTTP ${response.status}`);
        return { results: [] };
      }

      const data = (await response.json()) as TavilyResponse;
      const results = (data.results ?? []).map((r) => ({
        title: r.title ?? "",
        url: r.url ?? "",
        snippet: r.content ?? "",
      }));

      return { results };
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        console.error(`[web-search] Tavily request timed out after ${TAVILY_TIMEOUT_MS}ms`);
      } else {
        console.error("[web-search] Tavily request failed:", err);
      }
      return { results: [] };
    } finally {
      clearTimeout(timeout);
    }
  },
});
