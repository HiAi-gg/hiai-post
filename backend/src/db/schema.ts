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
export const tenantRole = pgEnum("tenant_role", ["viewer", "editor", "admin", "owner"]);
export type TenantRole = (typeof tenantRole.enumValues)[number];

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
    invitedBy: text("invited_by").references(() => user.id, { onDelete: "set null" }),
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

// ─── Projects ─────────────────────────────────────────────
// Shared product foundation: projects group brands and content items.
// Every row is tenant-scoped; tenantId always comes from the authenticated
// principal (tenantGuard), never from request input.
// The `*Context`-style columns (defaultLanguage, targetAudience, tone,
// contentGuidelines, businessContext, references) form the project's brand
// context — the structured briefing the Writer folds into generation
// prompts. All are optional; `references` is a bounded jsonb array of
// reference links (no separate table needed).
export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    defaultLanguage: text("default_language"),
    targetAudience: text("target_audience"),
    tone: text("tone"),
    contentGuidelines: text("content_guidelines"),
    businessContext: text("business_context"),
    references: jsonb("references").default([]),
    status: text("status").notNull().default("active"), // active/archived
    settings: jsonb("settings").default({}),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("projects_tenant_idx").on(table.tenantId)]
);

// ─── Brands ───────────────────────────────────────────────
// Brands may hang off a project (projectId) or exist tenant-wide.
// Same brand-context columns as projects; `voice` is the brand's
// tone/voice (the project-level equivalent is `tone`).
export const brands = pgTable(
  "brands",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    description: text("description"),
    voice: text("voice"),
    defaultLanguage: text("default_language"),
    targetAudience: text("target_audience"),
    contentGuidelines: text("content_guidelines"),
    businessContext: text("business_context"),
    references: jsonb("references").default([]),
    avatarUrl: text("avatar_url"),
    settings: jsonb("settings").default({}),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("brands_tenant_idx").on(table.tenantId),
    index("brands_project_idx").on(table.projectId),
  ]
);

// ─── Content Items (explicit approval state) ──────────────
// A content item carries an explicit approval status governed by the
// approval state machine in backend/src/services/approval.ts:
//   draft → in_review → approved
//              ↓
//         changes_requested → in_review
// approved is terminal. History lives in content_item_revisions.
export const contentItemStatus = pgEnum("content_item_status", [
  "draft",
  "in_review",
  "approved",
  "changes_requested",
]);
export type ContentItemStatus = (typeof contentItemStatus.enumValues)[number];

/**
 * Where a content item entered the system. `source` is derived from the
 * acting surface at creation time (never trusted from client input):
 *   web        → interactive web UI (session principals)
 *   api        → machine principals (admin JWT bridge / hpk_ API key) on the
 *                REST surface
 *   chatgpt    → MCP / ChatGPT Work API tools (machine principals)
 *   automation → scheduled/automated jobs (future surface)
 *   webhook    → inbound webhooks (future surface)
 *   import     → bulk imports (future surface)
 */
export const contentSource = pgEnum("content_source", [
  "web",
  "api",
  "chatgpt",
  "automation",
  "webhook",
  "import",
]);
export type ContentSource = (typeof contentSource.enumValues)[number];

export const contentItems = pgTable(
  "content_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    brandId: uuid("brand_id").references(() => brands.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    status: contentItemStatus("status").notNull().default("draft"),
    bodyText: text("body_text"),
    bodyJson: jsonb("body_json"),
    // How the item entered the system (see `contentSource` above). Set from
    // the acting surface at creation; never from request input.
    source: contentSource("source").notNull().default("web"),
    // Pointer to the item's current revision. `content_item_revisions` is
    // immutable append-only history; this number identifies the live
    // snapshot (revision (contentItemId, revisionNumber) is unique).
    // Advanced by createRevision and restoreRevision in the same
    // transaction; initialised to 1 on creation.
    currentRevisionNumber: integer("current_revision_number").notNull().default(1),
    // Last feedback attached by `request changes` (cleared on approval).
    reviewNote: text("review_note"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("content_items_tenant_idx").on(table.tenantId),
    index("content_items_project_idx").on(table.projectId),
    index("content_items_brand_idx").on(table.brandId),
    index("content_items_status_idx").on(table.status),
  ]
);

// ─── API Keys (machine auth) ──────────────────────────────
// Tenant-scoped machine credentials for the Work API surface (MCP + bearer
// routes). NEVER stores the plaintext key — only a SHA-256 hash of the full
// `hpk_<secret>` value plus a short visible `prefix` for identification.
// Scopes are product-level capabilities (see services/apiKeys.ts), expiry is
// optional, and `revokedAt` tombstones a key without deleting history.
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // Visible identifier: "hpk_" + first 8 chars of the secret. NOT a secret.
    prefix: text("prefix").notNull(),
    // SHA-256 hex digest of the full "hpk_<secret>" value. The only stored
    // representation of the credential — never the plaintext.
    keyHash: text("key_hash").notNull(),
    // Product-level scopes, e.g. ["writer:generate", "content:read"].
    scopes: jsonb("scopes").notNull().default([]),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("api_keys_key_hash_idx").on(table.keyHash),
    index("api_keys_tenant_idx").on(table.tenantId),
  ]
);

// ─── Content Item Revisions ───────────────────────────────
// Immutable append-only history. Restoring a revision copies its snapshot
// onto the content item AND appends a new revision (history is preserved,
// never rewritten). tenantId is denormalized so revision queries can be
// tenant-scoped without a join.
export const contentItemRevisions = pgTable(
  "content_item_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contentItemId: uuid("content_item_id")
      .notNull()
      .references(() => contentItems.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    revisionNumber: integer("revision_number").notNull(),
    title: text("title").notNull(),
    bodyText: text("body_text"),
    bodyJson: jsonb("body_json"),
    changeNote: text("change_note"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("content_item_revisions_item_number_idx").on(
      table.contentItemId,
      table.revisionNumber
    ),
    index("content_item_revisions_tenant_idx").on(table.tenantId),
  ]
);

// ─── Relations ────────────────────────────────────────────
export const tenantsRelations = relations(tenants, ({ many }) => ({
  socialAccounts: many(socialAccounts),
  posts: many(posts),
  contentPlans: many(contentPlans),
  campaigns: many(campaigns),
  postTemplates: many(postTemplates),
  auditLogs: many(auditLogs),
  members: many(tenantMembers),
  projects: many(projects),
  brands: many(brands),
  contentItems: many(contentItems),
  contentItemRevisions: many(contentItemRevisions),
  apiKeys: many(apiKeys),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  tenant: one(tenants, { fields: [projects.tenantId], references: [tenants.id] }),
  createdBy: one(user, { fields: [projects.createdBy], references: [user.id] }),
  brands: many(brands),
  contentItems: many(contentItems),
}));

export const brandsRelations = relations(brands, ({ one, many }) => ({
  tenant: one(tenants, { fields: [brands.tenantId], references: [tenants.id] }),
  project: one(projects, { fields: [brands.projectId], references: [projects.id] }),
  createdBy: one(user, { fields: [brands.createdBy], references: [user.id] }),
  contentItems: many(contentItems),
}));

export const contentItemsRelations = relations(contentItems, ({ one, many }) => ({
  tenant: one(tenants, { fields: [contentItems.tenantId], references: [tenants.id] }),
  project: one(projects, { fields: [contentItems.projectId], references: [projects.id] }),
  brand: one(brands, { fields: [contentItems.brandId], references: [brands.id] }),
  createdBy: one(user, { fields: [contentItems.createdBy], references: [user.id] }),
  updatedBy: one(user, { fields: [contentItems.updatedBy], references: [user.id] }),
  revisions: many(contentItemRevisions),
}));

export const contentItemRevisionsRelations = relations(contentItemRevisions, ({ one }) => ({
  contentItem: one(contentItems, {
    fields: [contentItemRevisions.contentItemId],
    references: [contentItems.id],
  }),
  tenant: one(tenants, { fields: [contentItemRevisions.tenantId], references: [tenants.id] }),
  createdBy: one(user, { fields: [contentItemRevisions.createdBy], references: [user.id] }),
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

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  tenant: one(tenants, { fields: [apiKeys.tenantId], references: [tenants.id] }),
  createdBy: one(user, { fields: [apiKeys.createdBy], references: [user.id] }),
}));
