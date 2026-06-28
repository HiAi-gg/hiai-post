import type { PublishQueue } from "./queue.js";
import { checkLimit, incrementCounter } from "./rate-limiter.js";
import { getNextRetryTime, shouldRetry } from "./retry.js";

export interface PublishResult {
  success: boolean;
  platformPostId?: string;
  error?: string;
}

export interface PublisherAdapter {
  platform: string;
  publish(
    postId: string,
    content: string,
    metadata: Record<string, unknown>
  ): Promise<PublishResult>;
}

const adapters = new Map<string, PublisherAdapter>();

export function registerPublisher(adapter: PublisherAdapter): void {
  adapters.set(adapter.platform, adapter);
}

export function getPublisher(platform: string): PublisherAdapter | undefined {
  return adapters.get(platform);
}

interface PostRecord {
  id: string;
  tenantId: string;
  platform: string;
  contentText: string;
  mediaUrls: string[];
  retryCount: number;
  socialAccountId: string;
}

interface PostStore {
  getById(postId: string): Promise<PostRecord | null>;
  updateStatus(postId: string, status: string, data?: Record<string, unknown>): Promise<void>;
  incrementRetry(postId: string): Promise<number>;
}

interface TenantStore {
  getAllTenantIds(): Promise<string[]>;
}

export class Publisher {
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(
    private queue: PublishQueue,
    private postStore: PostStore,
    private tenantStore: TenantStore
  ) {}

  start(intervalMs: number = 60_000): void {
    if (this.intervalId) return;

    this.intervalId = setInterval(() => {
      this.tick().catch((err) => {
        console.error("[Publisher] tick error:", err);
      });
    }, intervalMs);

    console.log(`[Publisher] started, interval=${intervalMs}ms`);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log("[Publisher] stopped");
    }
  }

  async tick(): Promise<void> {
    const tenantIds = await this.tenantStore.getAllTenantIds();

    for (const tenantId of tenantIds) {
      const items = await this.queue.dequeue(tenantId, 10);

      for (const item of items) {
        await this.publishPost(item.postId, tenantId);
      }
    }
  }

  private async publishPost(postId: string, tenantId: string): Promise<void> {
    const post = await this.postStore.getById(postId);
    if (!post) {
      console.warn(`[Publisher] post ${postId} not found, skipping`);
      return;
    }

    const adapter = adapters.get(post.platform);
    if (!adapter) {
      console.error(`[Publisher] no adapter for platform: ${post.platform}`);
      await this.handleFailure(post, `No publisher adapter for ${post.platform}`);
      return;
    }

    if (!(await checkLimit(post.platform))) {
      console.log(`[Publisher] rate limited for ${post.platform}, re-enqueueing`);
      const nextTime = getNextRetryTime(post.retryCount);
      await this.queue.enqueue(postId, tenantId, nextTime);
      return;
    }

    try {
      await this.postStore.updateStatus(postId, "publishing");

      const result = await adapter.publish(postId, post.contentText, {
        mediaUrls: post.mediaUrls,
        socialAccountId: post.socialAccountId,
      });

      if (result.success) {
        await this.postStore.updateStatus(postId, "published", {
          publishedAt: new Date(),
          platformPostId: result.platformPostId,
        });
        incrementCounter(post.platform);
        console.log(`[Publisher] published ${postId} to ${post.platform}`);
      } else {
        await this.handleFailure(post, result.error || "Unknown error");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.handleFailure(post, message);
    }
  }

  private async handleFailure(post: PostRecord, reason: string): Promise<void> {
    const retryCount = await this.postStore.incrementRetry(post.id);

    if (shouldRetry(retryCount)) {
      const nextTime = getNextRetryTime(retryCount);
      await this.queue.enqueue(post.id, post.tenantId, nextTime);
      console.log(
        `[Publisher] retry ${post.id} attempt ${retryCount} at ${nextTime.toISOString()}`
      );
    } else {
      await this.queue.moveToDeadLetter(post.id, post.tenantId, reason, retryCount);
      await this.postStore.updateStatus(post.id, "failed", { errorMessage: reason });
      console.error(
        `[Publisher] post ${post.id} failed permanently after ${retryCount} attempts: ${reason}`
      );
    }
  }
}
