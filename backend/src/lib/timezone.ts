/**
 * Timezone utilities for hiai-post.
 * All dates stored in UTC. Display in merchant's local timezone.
 */

export function utcToLocal(utcDate: Date, timezone: string): Date {
  // Use Intl to get the offset
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(utcDate);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0';
  return new Date(
    `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`
  );
}

export function localToUtc(localDate: Date, timezone: string): Date {
  // Create a date string in the target timezone and parse it as UTC
  const utcStr = localDate.toLocaleString('en-US', { timeZone: 'UTC' });
  const targetStr = localDate.toLocaleString('en-US', { timeZone: timezone });
  const utcDate = new Date(utcStr);
  const targetDate = new Date(targetStr);
  const diff = utcDate.getTime() - targetDate.getTime();
  return new Date(localDate.getTime() + diff);
}

export function getNextPublishTime(
  merchantTimezone: string,
  preferredHour: number = 9,
  preferredMinute: number = 0
): Date {
  const now = new Date();
  const localNow = utcToLocal(now, merchantTimezone);

  const next = new Date(localNow);
  next.setHours(preferredHour, preferredMinute, 0, 0);

  if (next <= localNow) {
    next.setDate(next.getDate() + 1);
  }

  return localToUtc(next, merchantTimezone);
}

export function formatForDisplay(utcDate: Date, timezone: string, locale: string = 'en-US'): string {
  return utcDate.toLocaleString(locale, {
    timeZone: timezone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function getOptimalPostingTimes(platform: string): number[] {
  // Best posting times in merchant's local timezone (hours)
  const times: Record<string, number[]> = {
    instagram: [6, 11, 13, 19],
    tiktok: [7, 12, 15, 19],
    x: [8, 12, 17],
    linkedin: [7, 10, 12],
    facebook: [9, 13, 15],
    telegram: [8, 12, 18],
  };
  return times[platform] ?? [9, 12, 18];
}
