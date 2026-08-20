/**
 * TEMPORARY local social-post writer adapter.
 *
 * hiai-kit has NO `content.post` capability yet, so `social_post`
 * generation uses the pre-existing "local writer capability" — the mastra
 * `content-generate` workflow (which drives the existing `writer` agent).
 * This adapter is an explicit, documented fallback ONLY for social posts;
 * article generation always goes through hiai-kit `content.article`.
 *
 * Once the peer implements `content.post`, this adapter is deleted and the
 * writer service routes social_post through the hiai-kit capability client.
 * No new agent framework is introduced here — the existing mastra workflow
 * is reused as-is through the same entry point the `/api/v1/posts/generate`
 * route already uses (`workflow.createRun().start({ inputData })`).
 *
 * The module is lazy-imported by services/writer.ts so unit tests of the
 * writer service never evaluate `@mastra/core` (they inject a fake port).
 *
 * Typing: the run/result types are DERIVED from the mastra workflow itself
 * (`Awaited<ReturnType<typeof contentGenerateWorkflow.createRun>>` and
 * `Awaited<ReturnType<Run["start"]>>`) instead of `as any`, and the
 * workflow OUTPUT is additionally validated at runtime against
 * `workflowOutputSchema` — the workflow's generic output type is too
 * fragile to trust end-to-end (steps are composed with internal casts), so
 * the zod schema is the authoritative contract here.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { contentGenerateWorkflow } from "../mastra/workflows/content-generate.js";

export interface LocalSocialWriterInput {
  topic: string;
  tone?: string;
  language?: string;
  instruction?: string;
  context?: string;
}

/** One platform variant produced by the content-generate workflow. */
export interface LocalSocialPostVariant {
  platform: string;
  content: string;
  hashtags: string[];
  maxLength?: number;
}

export interface LocalSocialWriterOutput {
  title: string;
  bodyText: string;
  bodyJson: { variants: LocalSocialPostVariant[]; backend: string };
  backend: "local:content-generate";
  correlationId: string;
}

/**
 * Runtime contract for the content-generate workflow output (the zod
 * `PolishOutput` shape). The workflow's TypeScript output type is inferred
 * through a fragile generic chain (internal `as any` step casts in
 * content-generate.ts), so this schema is the authoritative validation of
 * what the adapter consumes.
 */
const workflowOutputSchema = z.object({
  title: z.string().optional(),
  posts: z.array(
    z.object({
      platform: z.string(),
      content: z.string(),
      hashtags: z.array(z.string()),
      maxLength: z.number().optional(),
    })
  ),
});
type WorkflowOutput = z.infer<typeof workflowOutputSchema>;

// The narrowest types the mastra workflow API offers without casts: the run
// instance returned by `createRun()` and the `WorkflowResult` its `start()`
// resolves with (a discriminated union on `status`).
type ContentGenerateRun = Awaited<ReturnType<typeof contentGenerateWorkflow.createRun>>;
type ContentGenerateResult = Awaited<ReturnType<ContentGenerateRun["start"]>>;

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Run the existing mastra content-generate workflow for a social post.
 * Resolves with the joined platform variants (bodyText) plus the structured
 * variants (bodyJson) so the UI can render platform-native copies.
 */
export async function localMastraSocialWriter(
  input: LocalSocialWriterInput
): Promise<LocalSocialWriterOutput> {
  const correlationId = randomUUID();
  const prompt = [
    input.instruction ? `Instruction: ${input.instruction}` : null,
    `Topic: ${input.topic}`,
    input.tone ? `Tone: ${input.tone}` : null,
    input.language ? `Language: ${input.language}` : null,
    input.context ? `Context:\n${input.context}` : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");

  const run = await contentGenerateWorkflow.createRun();
  const result: ContentGenerateResult = await run.start({ inputData: { input: prompt } });

  if (result.status !== "success") {
    const detail =
      result.status === "failed"
        ? messageOf(result.error)
        : `workflow ended with status '${result.status}'`;
    throw new Error(`content-generate workflow failed: ${detail}`);
  }

  // Validate the runtime output — never trust the inferred generic shape.
  const parsed = workflowOutputSchema.safeParse(result.result);
  if (!parsed.success) {
    throw new Error(
      `content-generate workflow returned an unexpected shape: ${parsed.error.message}`
    );
  }
  const { title, posts }: WorkflowOutput = parsed.data;
  const bodyText = posts
    .map(
      (v) => `[${v.platform}]\n${v.content}${v.hashtags.length ? `\n${v.hashtags.join(" ")}` : ""}`
    )
    .join("\n\n---\n\n");

  return {
    title: title ?? input.topic,
    bodyText,
    bodyJson: { variants: posts, backend: "local:content-generate" },
    backend: "local:content-generate",
    correlationId,
  };
}
