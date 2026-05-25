import { describe, it, expect, mock } from 'bun:test';
import { PublishQueue } from '../core/scheduler/queue.js';

function createMockRedis() {
  return {
    zadd: mock(() => Promise.resolve(1)),
    zrangebyscore: mock(() => Promise.resolve([])),
    zrange: mock(() => Promise.resolve([])),
    zrem: mock(() => Promise.resolve(1)),
    zcard: mock(() => Promise.resolve(0)),
    zscore: mock(() => Promise.resolve(null)),
    multi: mock(() => ({
      incr: mock(function(this: any) { return this; }),
      pexpire: mock(function(this: any) { return this; }),
      exec: mock(() => Promise.resolve([])),
    })),
  } as any;
}

describe('PublishQueue', () => {
  it('enqueue calls redis.zadd with correct key and score', async () => {
    const redis = createMockRedis();
    const queue = new PublishQueue(redis);
    const now = new Date('2026-05-23T12:00:00Z');

    await queue.enqueue('post-1', 'tenant-1', now);

    expect(redis.zadd).toHaveBeenCalledWith(
      'publish_queue:tenant-1',
      now.getTime(),
      'tenant-1:post-1'
    );
  });

  it('dequeue returns empty array when no items ready', async () => {
    const redis = createMockRedis();
    redis.zrangebyscore.mockResolvedValue([]);
    const queue = new PublishQueue(redis);

    const items = await queue.dequeue('tenant-1');

    expect(items).toEqual([]);
    expect(redis.zrangebyscore).toHaveBeenCalledWith(
      'publish_queue:tenant-1',
      0,
      expect.any(Number),
      'LIMIT',
      0,
      10
    );
  });

  it('remove calls redis.zrem with correct key', async () => {
    const redis = createMockRedis();
    const queue = new PublishQueue(redis);

    await queue.remove('post-1', 'tenant-1');

    expect(redis.zrem).toHaveBeenCalledWith(
      'publish_queue:tenant-1',
      'tenant-1:post-1'
    );
  });

  it('getCount calls redis.zcard', async () => {
    const redis = createMockRedis();
    redis.zcard.mockResolvedValue(5);
    const queue = new PublishQueue(redis);

    const count = await queue.getCount('tenant-1');

    expect(count).toBe(5);
    expect(redis.zcard).toHaveBeenCalledWith('publish_queue:tenant-1');
  });

  it('getScheduled returns sorted items', async () => {
    const redis = createMockRedis();
    redis.zrange.mockResolvedValue([
      'tenant-1:post-2', '2000',
      'tenant-1:post-1', '1000',
    ]);
    const queue = new PublishQueue(redis);

    const items = await queue.getScheduled('tenant-1');

    expect(items).toHaveLength(2);
    expect(items[0].postId).toBe('post-1');
    expect(items[0].scheduledAt).toBe(1000);
    expect(items[1].postId).toBe('post-2');
    expect(items[1].scheduledAt).toBe(2000);
  });

  it('moveToDeadLetter removes from queue and adds to dead letter', async () => {
    const redis = createMockRedis();
    const queue = new PublishQueue(redis);

    await queue.moveToDeadLetter('post-1', 'tenant-1', 'max retries', 3);

    // Should remove from queue
    expect(redis.zrem).toHaveBeenCalled();
    // Should add to dead letter set
    expect(redis.zadd).toHaveBeenCalledWith(
      'dead_letter:tenant-1',
      expect.any(Number),
      expect.stringContaining('"postId":"post-1"')
    );
  });

  it('listDeadLetters parses JSON items', async () => {
    const redis = createMockRedis();
    const item = { postId: 'p1', tenantId: 't1', reason: 'fail', failedAt: 1000, attempts: 3 };
    redis.zrange.mockResolvedValue([JSON.stringify(item)]);
    const queue = new PublishQueue(redis);

    const items = await queue.listDeadLetters('tenant-1');

    expect(items).toHaveLength(1);
    expect(items[0].postId).toBe('p1');
    expect(items[0].reason).toBe('fail');
  });

  it('retryDeadLetter removes from dead letter and re-enqueues', async () => {
    const redis = createMockRedis();
    const item = { postId: 'p1', tenantId: 't1', reason: 'fail', failedAt: 1000, attempts: 3 };
    redis.zrange.mockResolvedValue([JSON.stringify(item)]);
    const queue = new PublishQueue(redis);

    const result = await queue.retryDeadLetter('p1', 'tenant-1');

    expect(result).toBe(true);
    expect(redis.zrem).toHaveBeenCalled();
    expect(redis.zadd).toHaveBeenCalled(); // re-enqueue
  });

  it('retryDeadLetter returns false if post not found', async () => {
    const redis = createMockRedis();
    redis.zrange.mockResolvedValue([]);
    const queue = new PublishQueue(redis);

    const result = await queue.retryDeadLetter('nonexistent', 'tenant-1');

    expect(result).toBe(false);
  });
});
