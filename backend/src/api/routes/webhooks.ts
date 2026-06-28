import { createHash, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { z } from "zod";
import { posts } from "../../db/schema.js";
import { getConfig } from "../../lib/config.js";
import { db } from "../../lib/db.js";
import { logger } from "../../lib/logger.js";

const log = logger.child({ module: "webhooks-route" });

// Zod schema for the hiai-store product event payload.
const storeProductWebhookSchema = z.object({
  tenantId: z.string().uuid(),
  productId: z.string().min(1).max(200),
  productName: z.string().min(1).max(500),
  productUrl: z.string().url(),
  productImage: z.string().url().optional(),
  platform: z.string().min(1).max(50),
});

type StoreProductWebhook = z.infer<typeof storeProductWebhookSchema>;

/**
 * Verify the X-Webhook-Secret header against the configured shared secret.
 * Uses constant-time comparison to avoid timing side channels.
 */
function verifyWebhookSecret(provided: string | null, expected: string): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Build the draft post body from a hiai-store product event.
 * Format mirrors what content-generate produces for a product launch:
 * headline + product link + image + hashtags.
 */
function buildDraftContent(input: StoreProductWebhook): string {
  const lines: string[] = [];
  lines.push(`New: ${input.productName}`);
  lines.push("");
  lines.push(`Shop now: ${input.productUrl}`);
  return lines.join("\n");
}

export const webhooksRoutes = new Elysia({ prefix: "/api/v1/webhooks" })
  // hiai-store product event → draft post
  .post("/store-product", async ({ body, request, set }: any) => {
    const cfg = getConfig();
    const secret = cfg.HIAI_STORE_WEBHOOK_SECRET;

    if (!secret) {
      log.error("HIAI_STORE_WEBHOOK_SECRET is not configured; rejecting webhook");
      set.status = 503;
      return { error: "Webhook receiver is not configured" };
    }

    const provided = request.headers.get("X-Webhook-Secret");
    if (!verifyWebhookSecret(provided, secret)) {
      log.warn({ ip: request.headers.get("x-forwarded-for") }, "Invalid webhook secret");
      set.status = 401;
      return { error: "Invalid webhook signature" };
    }

    const input = storeProductWebhookSchema.parse(body);

    // Idempotency: avoid creating duplicate drafts if hiai-store retries.
    // We hash on (tenantId, productId, platform) so re-posts for a different
    // platform still create a new draft.
    const dedupHash = createHash("sha256")
      .update(`${input.tenantId}:${input.productId}:${input.platform}`)
      .digest("hex")
      .slice(0, 16);

    const [existing] = await db
      .select({ id: posts.id })
      .from(posts)
      .where(and(eq(posts.tenantId, input.tenantId), eq(posts.contentHash, dedupHash)))
      .limit(1);

    if (existing) {
      log.info(
        { tenantId: input.tenantId, productId: input.productId, postId: existing.id },
        "Webhook already processed; returning existing draft"
      );
      set.status = 200;
      return { post: { id: existing.id }, deduplicated: true };
    }

    const contentText = buildDraftContent(input);
    const mediaUrls = input.productImage ? [input.productImage] : [];
    const contentJson = {
      source: "hiai-store-webhook",
      productId: input.productId,
      productUrl: input.productUrl,
      platform: input.platform,
    };

    const [post] = await db
      .insert(posts)
      .values({
        tenantId: input.tenantId,
        contentText,
        contentJson,
        mediaUrls,
        platform: input.platform,
        status: "draft",
        contentHash: dedupHash,
      })
      .returning();

    log.info(
      {
        tenantId: input.tenantId,
        productId: input.productId,
        platform: input.platform,
        postId: post.id,
      },
      "Created draft post from hiai-store webhook"
    );

    set.status = 201;
    return { post };
  });
