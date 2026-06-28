import type { Redis } from "ioredis";

const DEAD_LETTER_PREFIX = "dead_letter:";

export interface DeadLetterItem {
  postId: string;
  tenantId: string;
  reason: string;
  failedAt: number;
  attempts: number;
}

export class DeadLetterQueue {
  constructor(private redis: Redis) {}

  private key(tenantId: string): string {
    return `${DEAD_LETTER_PREFIX}${tenantId}`;
  }

  async moveToDeadLetter(
    postId: string,
    tenantId: string,
    reason: string,
    attempts: number
  ): Promise<void> {
    const item: DeadLetterItem = {
      postId,
      tenantId,
      reason,
      failedAt: Date.now(),
      attempts,
    };
    await this.redis.zadd(this.key(tenantId), Date.now(), JSON.stringify(item));
  }

  async listDeadLetters(tenantId: string): Promise<DeadLetterItem[]> {
    const members = await this.redis.zrange(this.key(tenantId), 0, -1);
    return members.map((m) => JSON.parse(m) as DeadLetterItem);
  }

  async retryDeadLetter(postId: string, tenantId: string): Promise<boolean> {
    const key = this.key(tenantId);
    const members = await this.redis.zrange(key, 0, -1);

    for (const member of members) {
      const item = JSON.parse(member) as DeadLetterItem;
      if (item.postId === postId) {
        await this.redis.zrem(key, member);
        return true;
      }
    }

    return false;
  }

  async remove(postId: string, tenantId: string): Promise<void> {
    const key = this.key(tenantId);
    const members = await this.redis.zrange(key, 0, -1);
    for (const member of members) {
      const item = JSON.parse(member) as DeadLetterItem;
      if (item.postId === postId) {
        await this.redis.zrem(key, member);
        return;
      }
    }
  }

  async getCount(tenantId: string): Promise<number> {
    return this.redis.zcard(this.key(tenantId));
  }
}
