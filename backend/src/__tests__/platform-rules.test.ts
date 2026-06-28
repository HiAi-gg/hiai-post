import { describe, it, expect } from 'vitest';
import { platformRules, getPlatformRule, validateContent } from '../lib/platform-rules.js';

describe('Platform Rules', () => {
  it('telegram-post: max 3500 chars, markdown allowed', () => {
    const rule = platformRules['telegram-post'];
    expect(rule.maxLength).toBe(3500);
    expect(rule.markdownAllowed).toBe(true);
  });
  it('linkedin-post: max 2800 chars, no markdown', () => {
    const rule = platformRules['linkedin-post'];
    expect(rule.maxLength).toBe(2800);
    expect(rule.markdownAllowed).toBe(false);
  });
  it('twitter-thread: max 275 chars per tweet', () => {
    const rule = platformRules['twitter-thread'];
    expect(rule.maxLength).toBe(275);
  });
  it('instagram-caption: max 2000 chars, no markup', () => {
    const rule = platformRules['instagram-caption'];
    expect(rule.maxLength).toBe(2000);
    expect(rule.markdownAllowed).toBe(false);
  });
  it('tiktok-script: max 15-60s duration', () => {
    const rule = platformRules['tiktok-script'];
    expect(rule.format).toBe('script');
  });
  it('getPlatformRule returns correct rule', () => {
    const rule = getPlatformRule('telegram-post');
    expect(rule.maxLength).toBe(3500);
  });
  it('validateContent rejects content over limit', () => {
    const longContent = 'a'.repeat(4000);
    const result = validateContent('telegram-post', longContent);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
  it('validateContent accepts valid content with emoji and hashtags', () => {
    const validContent = 'Check out our new product! 🎉🔥✨ #new #launch';
    const result = validateContent('telegram-post', validContent);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });
  it('validateContent rejects content with too few emoji', () => {
    const noEmoji = 'Check out our new product! #new';
    const result = validateContent('telegram-post', noEmoji);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('emoji'))).toBe(true);
  });
});
