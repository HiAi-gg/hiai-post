import type { Redis } from "ioredis";

const QUEUE_PREFIX = "publish_queue:";
const DEAD_LETTER_PREFIX = "dead_letter:";

export interface QueueItem {
  postId: string;
  tenantId: string;
  scheduledAt: number;
}

export interface DeadLetterItem extends QueueItem {
  reason: string;
  failedAt: number;
  attempts: number;
}

export class PublishQueue {
  constructor(private redis: Redis) {}

  private queueKey(tenantId: string): string {
    return `${QUEUE_PREFIX}${tenantId}`;
  }

  private deadLetterKey(tenantId: string): string {
    return `${DEAD_LETTER_PREFIX}${tenantId}`;
  }

  private itemKey(postId: string, tenantId: string): string {
    return `${tenantId}:${postId}`;
  }

  async enqueue(postId: string, tenantId: string, scheduledAt: Date): Promise<void> {
    const score = scheduledAt.getTime();
    const member = this.itemKey(postId, tenantId);
    await this.redis.zadd(this.queueKey(tenantId), score, member);
  }

  async dequeue(tenantId: string, count: number = 10): Promise<QueueItem[]> {
    const now = Date.now();
    const key = this.queueKey(tenantId);
    const members = await this.redis.zrangebyscore(key, 0, now, "LIMIT", 0, count);

    if (members.length === 0) return [];

    const items: QueueItem[] = [];
    for (const member of members) {
      const [tid, pid] = member.split(":");
      const score = await this.redis.zscore(key, member);
      if (score) {
        items.push({ postId: pid, tenantId: tid, scheduledAt: Number(score) });
      }
      await this.redis.zrem(key, member);
    }

    return items;
  }

  async remove(postId: string, tenantId: string): Promise<void> {
    await this.redis.zrem(this.queueKey(tenantId), this.itemKey(postId, tenantId));
  }

  async getCount(tenantId: string): Promise<number> {
    return this.redis.zcard(this.queueKey(tenantId));
  }

  async getScheduled(tenantId: string): Promise<QueueItem[]> {
    const key = this.queueKey(tenantId);
    const members = await this.redis.zrange(key, 0, -1, "WITHSCORES");
    const items: QueueItem[] = [];

    for (let i = 0; i < members.length; i += 2) {
      const [tid, pid] = members[i].split(":");
      items.push({
        postId: pid,
        tenantId: tid,
        scheduledAt: Number(members[i + 1]),
      });
    }

    return items.sort((a, b) => a.scheduledAt - b.scheduledAt);
  }

  async moveToDeadLetter(
    postId: string,
    tenantId: string,
    reason: string,
    attempts: number
  ): Promise<void> {
    await this.remove(postId, tenantId);
    const item: DeadLetterItem = {
      postId,
      tenantId,
      scheduledAt: Date.now(),
      reason,
      failedAt: Date.now(),
      attempts,
    };
    await this.redis.zadd(this.deadLetterKey(tenantId), Date.now(), JSON.stringify(item));
  }

  async listDeadLetters(tenantId: string): Promise<DeadLetterItem[]> {
    const key = this.deadLetterKey(tenantId);
    const members = await this.redis.zrange(key, 0, -1);
    return members.map((m) => JSON.parse(m) as DeadLetterItem);
  }

  async retryDeadLetter(postId: string, tenantId: string): Promise<boolean> {
    const key = this.deadLetterKey(tenantId);
    const members = await this.redis.zrange(key, 0, -1);

    for (const member of members) {
      const item = JSON.parse(member) as DeadLetterItem;
      if (item.postId === postId) {
        await this.redis.zrem(key, member);
        await this.enqueue(postId, tenantId, new Date());
        return true;
      }
    }

    return false;
  }
}
