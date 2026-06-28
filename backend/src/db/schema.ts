import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ─── Tenants ─────────────────────────────────────────────
export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  email: text("email"),
  status: text("status").notNull().default("active"), // active/suspended/pending
  settings: jsonb("settings").default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ─── Social Accounts ─────────────────────────────────────
export const socialAccounts = pgTable(
  "social_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(), // instagram/tiktok/x/linkedin/facebook/telegram/threads/pinterest/youtube/youtube-shorts/youtube-long
    accountId: text("account_id").notNull(),
    username: text("username"),
    displayName: text("display_name"),
    avatarUrl: text("avatar_url"),
    accessTokenEncrypted: text("access_token_encrypted"),
    refreshTokenEncrypted: text("refresh_token_encrypted"),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    scopes: jsonb("scopes").default([]),
    status: text("status").notNull().default("active"), // active/expired/revoked
    connectedAt: timestamp("connected_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("social_accounts_tenant_platform_account_idx").on(
      table.tenantId,
      table.platform,
      table.accountId
    ),
    index("social_accounts_tenant_idx").on(table.tenantId),
  ]
);

// ─── Posts ────────────────────────────────────────────────
export const posts = pgTable(
  "posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    socialAccountId: uuid("social_account_id").references(() => socialAccounts.id, {
      onDelete: "set null",
    }),
    contentText: text("content_text"),
    contentJson: jsonb("content_json"), // Tipex rich text
    mediaUrls: jsonb("media_urls").default([]),
    platform: text("platform"),
    status: text("status").notNull().default("draft"), // draft/scheduled/publishing/published/failed
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    platformPostId: text("platform_post_id"),
    errorMessage: text("error_message"),
    contentHash: text("content_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("posts_tenant_idx").on(table.tenantId),
    index("posts_status_idx").on(table.status),
    index("posts_scheduled_idx").on(table.scheduledAt),
  ]
);

// ─── Content Plans ────────────────────────────────────────
export const contentPlans = pgTable(
  "content_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    date: timestamp("date", { withTimezone: true }).notNull(),
    slotTime: text("slot_time"), // e.g. "09:00", "14:30"
    postId: uuid("post_id").references(() => posts.id, { onDelete: "set null" }),
    campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
    status: text("status").notNull().default("planned"), // planned/draft/published
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("content_plans_tenant_date_idx").on(table.tenantId, table.date)]
);

// ─── Campaigns ────────────────────────────────────────────
export const campaigns = pgTable(
  "campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    startDate: timestamp("start_date", { withTimezone: true }),
    endDate: timestamp("end_date", { withTimezone: true }),
    status: text("status").notNull().default("draft"), // draft/active/completed/paused
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("campaigns_tenant_idx").on(table.tenantId)]
);

// ─── Post Templates ───────────────────────────────────────
export const postTemplates = pgTable(
  "post_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    platform: text("platform"),
    contentText: text("content_text"),
    aiPrompt: text("ai_prompt"),
    variables: jsonb("variables").default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("post_templates_tenant_idx").on(table.tenantId)]
);

// ─── Post Analytics ───────────────────────────────────────
export const postAnalytics = pgTable(
  "post_analytics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(),
    impressions: integer("impressions").default(0),
    reach: integer("reach").default(0),
    engagementRate: real("engagement_rate").default(0),
    likes: integer("likes").default(0),
    comments: integer("comments").default(0),
    shares: integer("shares").default(0),
    clicks: integer("clicks").default(0),
    saves: integer("saves").default(0),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("post_analytics_post_idx").on(table.postId),
    index("post_analytics_fetched_idx").on(table.fetchedAt),
  ]
);

// ─── Tenant Members (RBAC) ───────────────────────────────
// One row per (tenant, user) pair. `role` controls what the user can
// do inside that tenant (see backend/src/api/middleware/rbac.ts).
// The role enum is intentionally small — owner > admin > editor > viewer.
// Tenant creation should always insert an 'owner' row for the creator.
export const tenantRole = pgEnum("tenant_role", [
  "viewer",
  "editor",
  "admin",
  "owner",
]);

export const tenantMembers = pgTable(
  "tenant_members",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: tenantRole("role").notNull().default("viewer"),
    invitedBy: text("invited_by").references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.userId] }),
    index("tenant_members_user_idx").on(table.userId),
    index("tenant_members_tenant_role_idx").on(table.tenantId, table.role),
  ]
);

// ─── Audit Logs ───────────────────────────────────────────
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "set null" }),
    actorId: text("actor_id"),
    // Role at the time of the action. Nullable for pre-RBAC audit rows
    // and for system-triggered actions (cron, webhooks) where there is
    // no human actor.
    role: tenantRole("role"),
    action: text("action").notNull(),
    resource: text("resource"),
    resourceId: text("resource_id"),
    metadata: jsonb("metadata").default({}),
    ipAddress: text("ip_address"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("audit_logs_tenant_idx").on(table.tenantId),
    index("audit_logs_created_idx").on(table.createdAt),
    index("audit_logs_actor_idx").on(table.actorId),
  ]
);

// ─── Better Auth tables ──────────────────────────────────
// Schema required by `betterAuth({ database: drizzleAdapter(...) })`. Names
// must match the keys Better Auth reads (`user`, `session`, `account`,
// `verification`). Field names mirror the Better Auth core (snake_case
// columns map via the second arg to the column builder).
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  name: text("name").notNull(),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Relations ────────────────────────────────────────────
export const tenantsRelations = relations(tenants, ({ many }) => ({
  socialAccounts: many(socialAccounts),
  posts: many(posts),
  contentPlans: many(contentPlans),
  campaigns: many(campaigns),
  postTemplates: many(postTemplates),
  auditLogs: many(auditLogs),
  members: many(tenantMembers),
}));

export const tenantMembersRelations = relations(tenantMembers, ({ one }) => ({
  tenant: one(tenants, { fields: [tenantMembers.tenantId], references: [tenants.id] }),
  user: one(user, { fields: [tenantMembers.userId], references: [user.id] }),
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
