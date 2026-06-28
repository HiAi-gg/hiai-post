import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";

const ExtractParamsOutput = z.object({
  topic: z.string(),
  tone: z.string().default("professional"),
  platforms: z.array(z.string()).default(["instagram", "x", "linkedin"]),
  language: z.string().default("en"),
});

const ContentWriteOutput = z.object({
  title: z.string(),
  content: z.string(),
  hashtags: z.array(z.string()),
  platform: z.string(),
  tone: z.string(),
  language: z.string(),
  topic: z.string(),
});

const PlatformFormatOutput = z.object({
  variants: z.array(
    z.object({
      platform: z.string(),
      content: z.string(),
      hashtags: z.array(z.string()),
      maxLength: z.number(),
    })
  ),
  title: z.string(),
  topic: z.string(),
  language: z.string(),
});

const PolishOutput = z.object({
  posts: z.array(
    z.object({
      platform: z.string(),
      content: z.string(),
      hashtags: z.array(z.string()),
      maxLength: z.number(),
    })
  ),
  title: z.string(),
  topic: z.string(),
  language: z.string(),
});

function getPlatformRules(platform: string): string {
  const rules: Record<string, string> = {
    instagram: "NO markdown. 4-10 emoji. 10-20 hashtags at end. Visual-first.",
    x: "280 chars max. 0-2 emoji. 2-3 hashtags.",
    linkedin: "NO markdown. Professional. 0-4 emoji. 3-5 hashtags.",
    tiktok: "Short, punchy. Pattern interrupt hook. 0-3 emoji.",
    facebook: "Conversational. 1-3 emoji.",
    telegram: "**Bold** markup. 3-7 emoji. 0-3 hashtags. Max 3500 chars.",
  };
  return rules[platform] || "Standard social media post.";
}

const extractParamsStep = createStep({
  id: "extract-params",
  description: "Extract topic, tone, platforms from user input",
  inputSchema: z.object({ input: z.string() }),
  outputSchema: ExtractParamsOutput,
  execute: async ({ inputData, mastra }) => {
    const agent = mastra?.getAgent("writer");
    if (!agent) {
      return {
        topic: inputData.input,
        tone: "professional",
        platforms: ["instagram", "x", "linkedin"],
        language: "en",
      };
    }
    const result = await agent.generate(
      `Extract topic, tone, platforms, language from: "${inputData.input}". Return JSON: {topic, tone, platforms[], language}`
    );
    try {
      const parsed = JSON.parse(result.text);
      return {
        topic: parsed.topic || inputData.input,
        tone: parsed.tone || "professional",
        platforms: parsed.platforms || ["instagram", "x", "linkedin"],
        language: parsed.language || "en",
      };
    } catch {
      return {
        topic: inputData.input,
        tone: "professional",
        platforms: ["instagram", "x", "linkedin"],
        language: "en",
      };
    }
  },
});

const contentWriteStep = createStep({
  id: "content-write",
  description: "Generate base content",
  inputSchema: ExtractParamsOutput.extend({ searchContext: z.string().optional() }),
  outputSchema: ContentWriteOutput,
  execute: async ({ inputData, mastra }) => {
    const agent = mastra?.getAgent("writer");
    if (!agent) {
      return {
        title: inputData.topic,
        content: `Check out: ${inputData.topic}`,
        hashtags: ["#update"],
        platform: "instagram",
        tone: inputData.tone,
        language: inputData.language,
        topic: inputData.topic,
      };
    }
    const result = await agent.generate(
      `Write a social media post about: "${inputData.topic}". Tone: ${inputData.tone}. Language: ${inputData.language}. Return JSON: {title, content, hashtags[]}`
    );
    try {
      const parsed = JSON.parse(result.text);
      return {
        title: parsed.title || inputData.topic,
        content: parsed.content || "",
        hashtags: parsed.hashtags || ["#update"],
        platform: "instagram",
        tone: inputData.tone,
        language: inputData.language,
        topic: inputData.topic,
      };
    } catch {
      return {
        title: inputData.topic,
        content: result.text.slice(0, 2000),
        hashtags: ["#update"],
        platform: "instagram",
        tone: inputData.tone,
        language: inputData.language,
        topic: inputData.topic,
      };
    }
  },
});

const duplicateCheckStep = createStep({
  id: "duplicate-check",
  description: "Check for duplicate content",
  inputSchema: ContentWriteOutput,
  outputSchema: ContentWriteOutput.extend({
    isDuplicate: z.boolean(),
    reason: z.string().optional(),
  }),
  execute: async ({ inputData }) => {
    return { ...inputData, isDuplicate: false };
  },
});

const platformFormatStep = createStep({
  id: "platform-format",
  description: "Adapt content per platform",
  inputSchema: ContentWriteOutput.extend({
    isDuplicate: z.boolean(),
    reason: z.string().optional(),
    platforms: z.array(z.string()),
  }),
  outputSchema: PlatformFormatOutput,
  execute: async ({ inputData, mastra }) => {
    const agent = mastra?.getAgent("writer");
    const PLATFORM_LIMITS: Record<string, number> = {
      instagram: 2200,
      x: 280,
      linkedin: 3000,
      tiktok: 2200,
      facebook: 63206,
      telegram: 4096,
    };
    const variants = await Promise.allSettled(
      inputData.platforms.map(async (platform) => {
        const maxLength = PLATFORM_LIMITS[platform] || 2000;
        if (!agent)
          return {
            platform,
            content: inputData.content.slice(0, maxLength),
            hashtags: inputData.hashtags.slice(0, platform === "x" ? 2 : 5),
            maxLength,
          };
        const result = await agent.generate(
          `Adapt for ${platform}:\n"${inputData.content}"\nRules: ${getPlatformRules(platform)}\nMax: ${maxLength} chars\nReturn JSON: {content, hashtags[]}`
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
      title: inputData.title,
      topic: inputData.topic,
      language: inputData.language,
    };
  },
});

const polishOutputStep = createStep({
  id: "polish-output",
  description: "Final cleanup",
  inputSchema: PlatformFormatOutput,
  outputSchema: PolishOutput,
  execute: async ({ inputData }) => {
    return {
      posts: inputData.variants.map((v) => ({
        ...v,
        content: v.content
          .replace(/\u2014/g, "-")
          .replace(/\u201c|\u201d/g, '"')
          .replace(/\u2018|\u2019/g, "'"),
      })),
      title: inputData.title,
      topic: inputData.topic,
      language: inputData.language,
    };
  },
});

export const contentGenerateWorkflow = createWorkflow({
  id: "content-generate",
  inputSchema: z.object({ input: z.string() }),
  outputSchema: PolishOutput,
})
  .then(extractParamsStep)
  .then(contentWriteStep)
  .then(duplicateCheckStep)
  .then(platformFormatStep as any)
  .then(polishOutputStep as any)
  .commit();
