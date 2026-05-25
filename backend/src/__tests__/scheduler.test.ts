import { describe, it, expect, mock } from 'bun:test';
import { shouldRetry, getNextRetryTime, getMaxRetries } from '../core/scheduler/retry.js';
import { getPlatformLimits } from '../core/scheduler/rate-limiter.js';

describe('Rate Limiter — Platform Limits', () => {
  it('getPlatformLimits returns correct limits for instagram', () => {
    const limits = getPlatformLimits('instagram');
    expect(limits).not.toBeNull();
    expect(limits!.maxRequests).toBe(200);
    expect(limits!.windowMs).toBe(3_600_000); // 1 hour
  });

  it('getPlatformLimits returns correct limits for x', () => {
    const limits = getPlatformLimits('x');
    expect(limits).not.toBeNull();
    expect(limits!.maxRequests).toBe(300);
    expect(limits!.windowMs).toBe(900_000); // 15 min
  });

  it('getPlatformLimits returns correct limits for linkedin', () => {
    const limits = getPlatformLimits('linkedin');
    expect(limits).not.toBeNull();
    expect(limits!.maxRequests).toBe(100);
    expect(limits!.windowMs).toBe(86_400_000); // 1 day
  });

  it('getPlatformLimits returns correct limits for tiktok', () => {
    const limits = getPlatformLimits('tiktok');
    expect(limits).not.toBeNull();
    expect(limits!.maxRequests).toBe(50);
    expect(limits!.windowMs).toBe(3_600_000);
  });

  it('getPlatformLimits returns correct limits for telegram', () => {
    const limits = getPlatformLimits('telegram');
    expect(limits).not.toBeNull();
    expect(limits!.maxRequests).toBe(30);
    expect(limits!.windowMs).toBe(60_000);
  });

  it('getPlatformLimits returns null for unknown platform', () => {
    const limits = getPlatformLimits('unknown');
    expect(limits).toBeNull();
  });
});

describe('Retry Logic', () => {
  it('shouldRetry returns true when retryCount < maxRetries', () => {
    expect(shouldRetry(0)).toBe(true);
    expect(shouldRetry(1)).toBe(true);
    expect(shouldRetry(2)).toBe(true);
  });

  it('shouldRetry returns false when retryCount >= maxRetries', () => {
    expect(shouldRetry(3)).toBe(false);
    expect(shouldRetry(5)).toBe(false);
  });

  it('getNextRetryTime returns increasing delays', () => {
    const before = Date.now();
    const t0 = getNextRetryTime(0);
    const t1 = getNextRetryTime(1);
    const t2 = getNextRetryTime(2);

    // First retry: 1 minute
    expect(t0.getTime()).toBeGreaterThanOrEqual(before + 60_000);
    expect(t0.getTime()).toBeLessThan(before + 61_000);

    // Second retry: 5 minutes
    expect(t1.getTime()).toBeGreaterThanOrEqual(before + 300_000);
    expect(t1.getTime()).toBeLessThan(before + 301_000);

    // Third retry: 15 minutes
    expect(t2.getTime()).toBeGreaterThanOrEqual(before + 900_000);
    expect(t2.getTime()).toBeLessThan(before + 901_000);
  });

  it('getNextRetryTime caps at max backoff for high retry counts', () => {
    const before = Date.now();
    const t10 = getNextRetryTime(10);

    // Should still be 15 minutes (max backoff)
    expect(t10.getTime()).toBeGreaterThanOrEqual(before + 900_000);
    expect(t10.getTime()).toBeLessThan(before + 901_000);
  });

  it('getMaxRetries returns 3', () => {
    expect(getMaxRetries()).toBe(3);
  });
});
