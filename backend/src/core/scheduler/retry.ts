const MAX_RETRIES = 3;

const BACKOFF_DELAYS_MS = [
  60_000, // 1 minute
  300_000, // 5 minutes
  900_000, // 15 minutes
];

export function shouldRetry(retryCount: number): boolean {
  return retryCount < MAX_RETRIES;
}

export function getNextRetryTime(retryCount: number): Date {
  const delayIndex = Math.min(retryCount, BACKOFF_DELAYS_MS.length - 1);
  const delay = BACKOFF_DELAYS_MS[delayIndex];
  return new Date(Date.now() + delay);
}

export function getMaxRetries(): number {
  return MAX_RETRIES;
}
