import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getConfig } from "../../lib/config.js";

const DALLE3_TIMEOUT_MS = 30_000;
const DALLE3_ENDPOINT = "https://api.openai.com/v1/images/generations";

// DALL·E 3 only supports a fixed set of image dimensions. When the caller
// supplies a size that isn't on the list we map to the closest valid aspect
// ratio and fall back to 1024x1024 for ambiguous inputs.
const DALLE3_VALID_SIZES = ["1024x1024", "1024x1792", "1792x1024"] as const;
type Dalle3Size = (typeof DALLE3_VALID_SIZES)[number];

const STYLE_TO_DALLE: Record<
  "realistic" | "illustration" | "abstract" | "minimalist",
  "natural" | "vivid"
> = {
  realistic: "natural",
  illustration: "vivid",
  abstract: "vivid",
  minimalist: "natural",
};

function mapSize(width: number, height: number): Dalle3Size {
  const targetRatio = width / height;
  let best: Dalle3Size = "1024x1024";
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const size of DALLE3_VALID_SIZES) {
    const [w, h] = size.split("x").map(Number);
    const ratio = w / h;
    const diff = Math.abs(ratio - targetRatio);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = size;
    }
  }
  return best;
}

interface Dalle3Response {
  created: number;
  data: Array<{
    url?: string;
    b64_json?: string;
    revised_prompt?: string;
  }>;
}

interface PlaceholderArgs {
  prompt: string;
  width: number;
  height: number;
}

function placeholderUrl({ prompt, width, height }: PlaceholderArgs): string {
  return `https://placehold.co/${width}x${height}?text=${encodeURIComponent(prompt.slice(0, 50))}`;
}

export const imageGenTool = createTool({
  id: "image-gen",
  description:
    "Generate images for social media posts via DALL·E 3 (falls back to placehold.co when OPENAI_API_KEY is unset)",
  inputSchema: z.object({
    prompt: z.string().describe("Image description"),
    style: z.enum(["realistic", "illustration", "abstract", "minimalist"]).default("realistic"),
    width: z.number().default(1080),
    height: z.number().default(1080),
  }),
  outputSchema: z.object({
    imageUrl: z.string(),
    width: z.number(),
    height: z.number(),
    provider: z.enum(["dalle3", "placeholder"]),
  }),
  execute: async (input: any) => {
    const { prompt, width, height } = input;
    const style: "realistic" | "illustration" | "abstract" | "minimalist" =
      input.style ?? "realistic";

    // Read config lazily so missing env vars don't crash module load.
    const apiKey = getConfig().OPENAI_API_KEY;
    if (!apiKey) {
      return {
        imageUrl: placeholderUrl({ prompt, width, height }),
        width,
        height,
        provider: "placeholder" as const,
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DALLE3_TIMEOUT_MS);

    try {
      const response = await fetch(DALLE3_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "dall-e-3",
          prompt,
          n: 1,
          size: mapSize(width, height),
          style: STYLE_TO_DALLE[style] ?? "vivid",
          response_format: "url",
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        console.error(
          `[image-gen] DALL·E 3 request failed (${response.status}): ${errorText.slice(0, 500)}`
        );
        return {
          imageUrl: placeholderUrl({ prompt, width, height }),
          width,
          height,
          provider: "placeholder" as const,
        };
      }

      const json = (await response.json()) as Dalle3Response;
      const first = json.data?.[0];
      const imageUrl =
        first?.url ?? (first?.b64_json ? `data:image/png;base64,${first.b64_json}` : null);

      if (!imageUrl) {
        console.error("[image-gen] DALL·E 3 returned no image data");
        return {
          imageUrl: placeholderUrl({ prompt, width, height }),
          width,
          height,
          provider: "placeholder" as const,
        };
      }

      return {
        imageUrl,
        width,
        height,
        provider: "dalle3" as const,
      };
    } catch (err) {
      const reason =
        err instanceof Error && err.name === "AbortError"
          ? `timeout after ${DALLE3_TIMEOUT_MS}ms`
          : err instanceof Error
            ? err.message
            : String(err);
      console.error(`[image-gen] DALL·E 3 call failed: ${reason}`);
      return {
        imageUrl: placeholderUrl({ prompt, width, height }),
        width,
        height,
        provider: "placeholder" as const,
      };
    } finally {
      clearTimeout(timeout);
    }
  },
});
