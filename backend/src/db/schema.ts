import {
  pgTable,
  uuid,
  text,
  integer,
  real,
  timestamp,
  jsonb,
  boolean,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ─── Tenants ─────────────────────────────────────────────
export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  email: text('email'),
  status: text('status').notNull().default('active'), // active/suspended/pending
  settings: jsonb('settings').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// ─── Social Accounts ─────────────────────────────────────
export const socialAccounts = pgTable(
  'social_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    platform: text('platform').notNull(), // instagram/tiktok/x/linkedin/facebook/telegram/threads/pinterest
    accountId: text('account_id').notNull(),
    username: text('username'),
    displayName: text('display_name'),
    avatarUrl: text('avatar_url'),
    accessTokenEncrypted: text('access_token_encrypted'),
    refreshTokenEncrypted: text('refresh_token_encrypted'),
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
    scopes: jsonb('scopes').default([]),
    status: text('status').notNull().default('active'), // active/expired/revoked
    connectedAt: timestamp('connected_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('social_accounts_tenant_platform_account_idx').on(
      table.tenantId,
      table.platform,
      table.accountId,
    ),
    index('social_accounts_tenant_idx').on(table.tenantId),
  ],
);

// ─── Posts ────────────────────────────────────────────────
export const posts = pgTable(
  'posts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    socialAccountId: uuid('social_account_id').references(() => socialAccounts.id, {
      onDelete: 'set null',
    }),
    contentText: text('content_text'),
    contentJson: jsonb('content_json'), // Tipex rich text
    mediaUrls: jsonb('media_urls').default([]),
    platform: text('platform'),
    status: text('status').notNull().default('draft'), // draft/scheduled/publishing/published/failed
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    platformPostId: text('platform_post_id'),
    errorMessage: text('error_message'),
    contentHash: text('content_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('posts_tenant_idx').on(table.tenantId),
    index('posts_status_idx').on(table.status),
    index('posts_scheduled_idx').on(table.scheduledAt),
  ],
);

// ─── Content Plans ────────────────────────────────────────
export const contentPlans = pgTable(
  'content_plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    date: timestamp('date', { withTimezone: true }).notNull(),
    slotTime: text('slot_time'), // e.g. "09:00", "14:30"
    postId: uuid('post_id').references(() => posts.id, { onDelete: 'set null' }),
    campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'set null' }),
    status: text('status').notNull().default('planned'), // planned/draft/published
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('content_plans_tenant_date_idx').on(table.tenantId, table.date),
  ],
);

// ─── Campaigns ────────────────────────────────────────────
export const campaigns = pgTable(
  'campaigns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    startDate: timestamp('start_date', { withTimezone: true }),
    endDate: timestamp('end_date', { withTimezone: true }),
    status: text('status').notNull().default('draft'), // draft/active/completed/paused
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('campaigns_tenant_idx').on(table.tenantId)],
);

// ─── Post Templates ───────────────────────────────────────
export const postTemplates = pgTable(
  'post_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    platform: text('platform'),
    contentText: text('content_text'),
    aiPrompt: text('ai_prompt'),
    variables: jsonb('variables').default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('post_templates_tenant_idx').on(table.tenantId)],
);

// ─── Post Analytics ───────────────────────────────────────
export const postAnalytics = pgTable(
  'post_analytics',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    platform: text('platform').notNull(),
    impressions: integer('impressions').default(0),
    reach: integer('reach').default(0),
    engagementRate: real('engagement_rate').default(0),
    likes: integer('likes').default(0),
    comments: integer('comments').default(0),
    shares: integer('shares').default(0),
    clicks: integer('clicks').default(0),
    saves: integer('saves').default(0),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('post_analytics_post_idx').on(table.postId),
    index('post_analytics_fetched_idx').on(table.fetchedAt),
  ],
);

// ─── Audit Logs ───────────────────────────────────────────
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
    actorId: text('actor_id'),
    action: text('action').notNull(),
    resource: text('resource'),
    resourceId: text('resource_id'),
    metadata: jsonb('metadata').default({}),
    ipAddress: text('ip_address'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('audit_logs_tenant_idx').on(table.tenantId),
    index('audit_logs_created_idx').on(table.createdAt),
  ],
);

// ─── Relations ────────────────────────────────────────────
export const tenantsRelations = relations(tenants, ({ many }) => ({
  socialAccounts: many(socialAccounts),
  posts: many(posts),
  contentPlans: many(contentPlans),
  campaigns: many(campaigns),
  postTemplates: many(postTemplates),
  auditLogs: many(auditLogs),
}));

export const socialAccountsRelations = relations(socialAccounts, ({ one, many }) => ({
  tenant: one(tenants, { fields: [socialAccounts.tenantId], references: [tenants.id] }),
  posts: many(posts),
}));

export const postsRelations = relations(posts, ({ one, many }) => ({
  tenant: one(tenants, { fields: [posts.tenantId], references: [tenants.id] }),
  socialAccount: one(socialAccounts, {
    fields: [posts.socialAccountId],
    references: [socialAccounts.id],
  }),
  analytics: many(postAnalytics),
  contentPlan: one(contentPlans),
}));

export const contentPlansRelations = relations(contentPlans, ({ one }) => ({
  tenant: one(tenants, { fields: [contentPlans.tenantId], references: [tenants.id] }),
  post: one(posts, { fields: [contentPlans.postId], references: [posts.id] }),
  campaign: one(campaigns, { fields: [contentPlans.campaignId], references: [campaigns.id] }),
}));

export const campaignsRelations = relations(campaigns, ({ one, many }) => ({
  tenant: one(tenants, { fields: [campaigns.tenantId], references: [tenants.id] }),
  contentPlans: many(contentPlans),
}));

export const postTemplatesRelations = relations(postTemplates, ({ one }) => ({
  tenant: one(tenants, { fields: [postTemplates.tenantId], references: [tenants.id] }),
}));

export const postAnalyticsRelations = relations(postAnalytics, ({ one }) => ({
  post: one(posts, { fields: [postAnalytics.postId], references: [posts.id] }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  tenant: one(tenants, { fields: [auditLogs.tenantId], references: [tenants.id] }),
}));
