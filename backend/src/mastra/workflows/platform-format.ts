import { createStep } from "@mastra/core/workflows";
import { z } from "zod";

const PLATFORM_LIMITS: Record<string, number> = {
  instagram: 2200,
  x: 280,
  linkedin: 3000,
  tiktok: 2200,
  facebook: 63206,
  telegram: 4096,
};

function getPlatformRules(platform: string): string {
  const rules: Record<string, string> = {
    instagram: "NO markdown. 4-10 emoji. 10-20 hashtags at end.",
    x: "280 chars max. 0-2 emoji. 2-3 hashtags.",
    linkedin: "NO markdown. Professional. 0-4 emoji. 3-5 hashtags.",
    tiktok: "Short, punchy. Pattern interrupt hook.",
    facebook: "Conversational. 1-3 emoji.",
    telegram: "**Bold** markup. 3-7 emoji. 0-3 hashtags.",
  };
  return rules[platform] || "Standard social media post.";
}

export const platformFormatStep = createStep({
  id: "platform-format-single",
  description: "Adapt content to each target platform",
  inputSchema: z.object({
    title: z.string(),
    content: z.string(),
    hashtags: z.array(z.string()),
    platforms: z.array(z.string()),
    language: z.string(),
  }),
  outputSchema: z.object({
    variants: z.array(
      z.object({
        platform: z.string(),
        content: z.string(),
        hashtags: z.array(z.string()),
        maxLength: z.number(),
      })
    ),
  }),
  execute: async ({ inputData, mastra }) => {
    const agent = mastra?.getAgent("writer");
    const variants = await Promise.allSettled(
      inputData.platforms.map(async (platform) => {
        const maxLength = PLATFORM_LIMITS[platform] || 2000;
        if (!agent) {
          return {
            platform,
            content: inputData.content.slice(0, maxLength),
            hashtags: inputData.hashtags.slice(0, platform === "x" ? 2 : 5),
            maxLength,
          };
        }
        const result = await agent.generate(
          `Adapt for ${platform}:\n"${inputData.content}"\nRules: ${getPlatformRules(platform)}\nMax: ${maxLength}\nReturn JSON: {content, hashtags[]}`
        );
        try {
          const p = JSON.parse(result.text);
          return {
            platform,
            content: (p.content || inputData.content).slice(0, maxLength),
            hashtags: p.hashtags || inputData.hashtags,
            maxLength,
          };
        } catch {
          return {
            platform,
            content: inputData.content.slice(0, maxLength),
            hashtags: inputData.hashtags,
            maxLength,
          };
        }
      })
    );
    return {
      variants: variants
        .filter((r): r is PromiseFulfilledResult<any> => r.status === "fulfilled")
        .map((r) => r.value),
    };
  },
});
