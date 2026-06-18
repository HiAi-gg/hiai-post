import { z } from 'zod';

// Pagination
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type PaginationInput = z.infer<typeof paginationSchema>;

// ID param
export const idParamSchema = z.object({
  id: z.string().uuid(),
});

// Platform enum
export const platformEnum = z.enum([
  'instagram',
  'tiktok',
  'x',
  'linkedin',
  'facebook',
  'telegram',
  'threads',
  'pinterest',
  'youtube',
  'youtube-shorts',
  'youtube-long',
]);

// Post status enum
export const postStatusEnum = z.enum([
  'draft',
  'scheduled',
  'publishing',
  'published',
  'failed',
]);

// Create post
export const createPostSchema = z.object({
  socialAccountId: z.string().uuid().optional(),
  contentText: z.string().min(1).max(10000),
  contentJson: z.any().optional(),
  mediaUrls: z.array(z.string().url()).max(10).default([]),
  platform: platformEnum.optional(),
  scheduledAt: z.string().datetime().optional(),
});

// Update post
export const updatePostSchema = z.object({
  contentText: z.string().min(1).max(10000).optional(),
  contentJson: z.any().optional(),
  mediaUrls: z.array(z.string().url()).max(10).optional(),
  platform: platformEnum.optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
  socialAccountId: z.string().uuid().nullable().optional(),
});

// Schedule post
export const schedulePostSchema = z.object({
  scheduledAt: z.string().datetime(),
});

// Create social account
export const createSocialAccountSchema = z.object({
  platform: platformEnum,
  code: z.string().optional(), // OAuth code
  redirectUri: z.string().url().optional(),
  botToken: z.string().optional(), // Telegram
});

// Content plan
export const createContentPlanSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  date: z.string().datetime(),
  slotTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  postId: z.string().uuid().optional(),
  campaignId: z.string().uuid().optional(),
});

// Campaign
export const createCampaignSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

// Template
export const createTemplateSchema = z.object({
  name: z.string().min(1).max(200),
  platform: platformEnum.optional(),
  contentText: z.string().max(10000).optional(),
  aiPrompt: z.string().max(5000).optional(),
  variables: z.array(z.string()).default([]),
});

// Generate post
export const generatePostSchema = z.object({
  topic: z.string().min(3).max(500),
  platforms: z.array(platformEnum).min(1).max(6),
  tone: z.enum(['professional', 'casual', 'humorous', 'inspirational']).default('professional'),
  language: z.string().min(2).max(5).default('en'),
  includeHashtags: z.boolean().default(true),
  includeEmoji: z.boolean().default(true),
});

// Analytics date range
export const analyticsDateRangeSchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
});

// Bulk schedule posts in a campaign
export const bulkScheduleCampaignSchema = z.object({
  postIds: z.array(z.string().uuid()).min(1).max(50),
  startDate: z.string().datetime(),
  intervalMinutes: z.number().int().min(1).max(1440),
});
