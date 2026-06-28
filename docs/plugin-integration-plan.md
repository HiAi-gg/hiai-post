# hiai-post Plugin Integration + Dual Mode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make hiai-post work in dual mode — standalone (own SvelteKit shell with sidebar/header) and as a plugin within hiai-admin (pages rendered inside admin layout, no own chrome). Hardens the backend with OAuth token refresh and dead-letter queue processing.

**Architecture:** hiai-post exports a plugin manifest for hiai-admin. In standalone mode, it uses its own layout with AdminSidebar/AdminHeader from @hiai/ui. In unified mode, hiai-admin renders hiai-post pages inside its own layout. The backend (Elysia :50300) is always standalone.

**Tech Stack:** Svelte 5.55+, SvelteKit 2.60+, Elysia 1.4.28+, @hiai/ui, Mastra 1.36+, Better Auth

**Design Spec:** `docs/superpowers/specs/2026-05-25-hiai-ecosystem-design.md` — Sections 2.3, 4.2, 4.5

**Prerequisite:** Plans 1 (@hiai/ui) and 2 (hiai-admin plugin system) must be complete.

**Source Documents (preserved verbatim below):**

1. `docs/superpowers/plans/2026-05-25-hiai-post-plugin-integration.md` (Part A — plugin manifest, @hiai/ui migration, route integration)
2. `docs/superpowers/plans/2026-05-25-hiai-post-dual-mode.md` (Part B — dual-mode layout, backend hardening workers)

---

# Part A — hiai-post Plugin Integration
---



> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make hiai-post work in dual mode — standalone (own SvelteKit shell with sidebar/header) and as a plugin within hiai-admin (pages rendered inside admin layout, no own chrome).

**Architecture:** hiai-post exports a plugin manifest for hiai-admin. In standalone mode, it uses its own layout with AdminSidebar/AdminHeader from @hiai/ui. In unified mode, hiai-admin renders hiai-post pages inside its own layout. The backend (Elysia :50300) is always standalone.

**Tech Stack:** Svelte 5.55+, SvelteKit 2.60+, Elysia 1.4.28+, @hiai/ui, Mastra 1.36+

**Design Spec:** `docs/superpowers/specs/2026-05-25-hiai-ecosystem-design.md` — Sections 2.3, 4.2

**Prerequisite:** Plans 1 (@hiai/ui) and 2 (hiai-admin plugin system) must be complete.

---

## File Structure

```
projects/hiai-post/app/src/
├── lib/
│   ├── components/
│   │   ├── PostEditor.svelte           # EXISTS — keep as-is
│   │   ├── Calendar.svelte             # EXISTS — keep as-is
│   │   ├── UpcomingPosts.svelte        # EXISTS — keep as-is
│   │   ├── PlatformCard.svelte         # EXISTS — keep as-is
│   │   ├── PlatformPreview.svelte      # EXISTS — keep as-is
│   │   ├── ConnectAccountModal.svelte  # EXISTS — keep as-is
│   │   ├── AnalyticsChart.svelte       # EXISTS — keep as-is
│   │   ├── TemplateEditor.svelte       # EXISTS — keep as-is
│   │   └── editor/
│   │       ├── TipexEditor.svelte      # EXISTS — migrate to @hiai/ui
│   │       └── EditorToolbar.svelte    # EXISTS — migrate to @hiai/ui
│   ├── stores/
│   │   ├── auth.svelte.ts              # EXISTS — migrate to @hiai/ui re-export
│   │   ├── accounts.svelte.ts          # EXISTS — keep (post-specific)
│   │   └── posts.svelte.ts             # EXISTS — keep (post-specific)
│   ├── api.ts                          # EXISTS — migrate to createApi from @hiai/ui
│   └── plugin.ts                       # NEW — plugin manifest export for hiai-admin
├── routes/
│   ├── +layout.svelte                  # MODIFY — dual-mode layout
│   ├── +layout.server.ts               # EXISTS — keep
│   ├── +page.svelte                    # EXISTS — keep (redirect)
│   ├── dashboard/
│   │   ├── +page.svelte                # EXISTS — keep
│   │   └── +page.server.ts             # EXISTS — keep
│   ├── posts/                          # EXISTS — keep all
│   ├── accounts/                       # EXISTS — keep all
│   ├── campaigns/                      # EXISTS — keep all
│   ├── content-plans/                  # EXISTS — keep all
│   ├── templates/                      # EXISTS — keep all
│   └── analytics/                      # EXISTS — keep all
```

---

### Task 1: Migrate to @hiai/ui shared components

**Files:**
- Modify: `projects/hiai-post/app/package.json`
- Modify: `projects/hiai-post/app/src/lib/api.ts`
- Modify: `projects/hiai-post/app/src/lib/stores/auth.svelte.ts`
- Remove: `projects/hiai-post/app/src/lib/components/editor/TipexEditor.svelte` (replaced by @hiai/ui)
- Remove: `projects/hiai-post/app/src/lib/components/editor/EditorToolbar.svelte` (replaced by @hiai/ui)

- [ ] **Step 1: Add @hiai/ui dependency**

Read `projects/hiai-post/app/package.json` and add `"@hiai/ui": "workspace:*"` to dependencies.

- [ ] **Step 2: Replace api.ts with createApi wrapper**

```typescript
// projects/hiai-post/app/src/lib/api.ts
import { createApi } from '@hiai/ui';

const API_BASE = typeof window !== 'undefined' ? '' : (process.env.API_URL || 'http://localhost:50300');
export const api = createApi(API_BASE);
```

- [ ] **Step 3: Replace auth store with @hiai/ui re-export**

```typescript
// projects/hiai-post/app/src/lib/stores/auth.svelte.ts
export { authStore, type User } from '@hiai/ui';
```

- [ ] **Step 4: Update editor imports**

In `PostEditor.svelte`, change:
```typescript
// Before:
import TipexEditor from './editor/TipexEditor.svelte';
// After:
import { TipexEditor } from '@hiai/ui';
```

- [ ] **Step 5: Verify build**

```bash
cd /mnt/ai_data/projects/hiai-post/app && bunx tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 6: Run tests**

```bash
cd /mnt/ai_data/projects/hiai-post && bun test
```
Expected: 33 pass / 0 fail

- [ ] **Step 7: Commit**

```bash
git add projects/hiai-post/
git commit -m "refactor(hiai-post): migrate to @hiai/ui shared package"
```

---

### Task 2: Implement dual-mode layout

**Files:**
- Modify: `projects/hiai-post/app/src/routes/+layout.svelte`
- Modify: `projects/hiai-post/app/src/routes/+layout.server.ts`
- Modify: `projects/hiai-post/app/src/routes/dashboard/+page.server.ts`

- [ ] **Step 1: Add mode detection to server layout**

```typescript
// projects/hiai-post/app/src/routes/+layout.server.ts
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ fetch }) => {
  const mode = process.env.PUBLIC_HIAI_MODE ?? 'standalone';

  let user = null;
  try {
    const res = await fetch('/api/auth/session');
    if (res.ok) {
      const session = await res.json();
      user = session.user ?? null;
    }
  } catch {}

  return { user, mode };
};
```

- [ ] **Step 2: Modify root layout for dual mode**

```svelte
<!-- projects/hiai-post/app/src/routes/+layout.svelte -->
<script lang="ts">
  import '../app.css';
  import type { Snippet } from 'svelte';

  let { children, data }: { children: Snippet; data: { mode: string } } = $props();

  const isStandalone = $derived(data.mode === 'standalone');
</script>

<svelte:head>
  <title>HiAi Post</title>
  <meta name="description" content="Social media content planning and publishing" />
</svelte:head>

{#if isStandalone}
  <!-- Standalone mode: render children directly, dashboard layout handles chrome -->
  {@render children()}
{:else}
  <!-- Unified mode: children are rendered inside hiai-admin's layout -->
  {@render children()}
{/if}
```

- [ ] **Step 3: Modify dashboard layout for standalone mode**

The dashboard and other pages currently have no sidebar/header. In standalone mode, we need to wrap them with @hiai/ui's AdminSidebar and AdminHeader.

Create a new layout group for standalone mode:

```svelte
<!-- projects/hiai-post/app/src/routes/(standalone)/+layout.svelte -->
<script lang="ts">
  import { AdminSidebar, AdminHeader, ThemeToggle, sidebarStore } from '@hiai/ui';
  import type { Snippet } from 'svelte';

  let { data, children }: { data: { user: unknown }; children: Snippet } = $props();

  const navGroups = [
    {
      label: 'Social Media',
      items: [
        { label: 'Dashboard', href: '/dashboard', icon: '📊' },
        { label: 'Posts', href: '/posts', icon: '📝' },
        { label: 'Accounts', href: '/accounts', icon: '👤' },
        { label: 'Campaigns', href: '/campaigns', icon: '📢' },
        { label: 'Content Plans', href: '/content-plans', icon: '📅' },
        { label: 'Templates', href: '/templates', icon: '📋' },
        { label: 'Analytics', href: '/analytics', icon: '📈' },
      ],
    },
  ];
</script>

<div class="flex h-screen overflow-hidden bg-background">
  <AdminSidebar
    {navGroups}
    collapsed={sidebarStore.collapsed}
    onToggle={() => sidebarStore.toggle()}
    appName="hiai-post"
  />

  <div class="flex flex-1 flex-col overflow-hidden">
    <AdminHeader user={data.user} onToggleSidebar={() => sidebarStore.toggle()}>
      {#snippet actions()}
        <ThemeToggle />
      {/snippet}
    </AdminHeader>

    <main class="flex-1 overflow-y-auto p-6">
      {@render children()}
    </main>
  </div>
</div>
```

- [ ] **Step 4: Move dashboard pages under (standalone) group**

Move existing pages into a `(standalone)` route group for standalone mode. In unified mode, hiai-admin renders these pages through its plugin system.

Actually, a simpler approach: keep all pages at their current paths. The `(standalone)/+layout.svelte` wraps them with sidebar/header only when mode is standalone. When mode is unified, hiai-admin's layout provides the chrome.

Create a conditional wrapper in the root layout instead:

```svelte
<!-- projects/hiai-post/app/src/routes/+layout.svelte -->
<script lang="ts">
  import '../app.css';
  import type { Snippet } from 'svelte';
  import { AdminSidebar, AdminHeader, ThemeToggle, sidebarStore } from '@hiai/ui';

  let { children, data }: { children: Snippet; data: { mode: string; user: unknown } } = $props();

  const isStandalone = $derived(data.mode === 'standalone');

  const navGroups = [
    {
      label: 'Social Media',
      items: [
        { label: 'Dashboard', href: '/dashboard', icon: '📊' },
        { label: 'Posts', href: '/posts', icon: '📝' },
        { label: 'Accounts', href: '/accounts', icon: '👤' },
        { label: 'Campaigns', href: '/campaigns', icon: '📢' },
        { label: 'Content Plans', href: '/content-plans', icon: '📅' },
        { label: 'Templates', href: '/templates', icon: '📋' },
        { label: 'Analytics', href: '/analytics', icon: '📈' },
      ],
    },
  ];
</script>

<svelte:head>
  <title>HiAi Post</title>
  <meta name="description" content="Social media content planning and publishing" />
</svelte:head>

{#if isStandalone}
  <div class="flex h-screen overflow-hidden bg-background">
    <AdminSidebar
      {navGroups}
      collapsed={sidebarStore.collapsed}
      onToggle={() => sidebarStore.toggle()}
      appName="hiai-post"
    />

    <div class="flex flex-1 flex-col overflow-hidden">
      <AdminHeader user={data.user} onToggleSidebar={() => sidebarStore.toggle()}>
        {#snippet actions()}
          <ThemeToggle />
        {/snippet}
      </AdminHeader>

      <main class="flex-1 overflow-y-auto p-6">
        {@render children()}
      </main>
    </div>
  </div>
{:else}
  <!-- Unified mode: hiai-admin provides the shell -->
  {@render children()}
{/if}
```

- [ ] **Step 5: Verify build**

```bash
cd /mnt/ai_data/projects/hiai-post/app && bunx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add projects/hiai-post/
git commit -m "feat(hiai-post): implement dual-mode layout (standalone/unified)"
```

---

### Task 3: Export plugin manifest for hiai-admin

**Files:**
- Create: `projects/hiai-post/app/src/lib/plugin.ts`

- [ ] **Step 1: Create plugin manifest**

This manifest is consumed by hiai-admin to register hiai-post as a plugin.

```typescript
// projects/hiai-post/app/src/lib/plugin.ts

/**
 * hiai-post plugin manifest for hiai-admin unified mode.
 * Import this in hiai-admin's plugin registry.
 */
export const hiaiPostPlugin = {
  id: 'hiai-post',
  name: 'Social Media',
  version: '1.0.0',
  icon: '📱',
  description: 'Social media content planning and publishing',

  navGroups: [
    {
      label: 'Social Media',
      items: [
        { label: 'Dashboard', href: '/dashboard', icon: '📊' },
        { label: 'Posts', href: '/posts', icon: '📝' },
        { label: 'Accounts', href: '/accounts', icon: '👤' },
        { label: 'Campaigns', href: '/campaigns', icon: '📢' },
        { label: 'Content Plans', href: '/content-plans', icon: '📅' },
        { label: 'Templates', href: '/templates', icon: '📋' },
        { label: 'Analytics', href: '/analytics', icon: '📈' },
      ],
    },
  ],

  proxy: {
    prefix: '/api/social',
    target: process.env.HIAI_POST_API_URL || 'http://localhost:50300',
  },
} as const;
```

- [ ] **Step 2: Commit**

```bash
git add projects/hiai-post/app/src/lib/plugin.ts
git commit -m "feat(hiai-post): export plugin manifest for hiai-admin"
```

---

### Task 4: Backend hardening — OAuth token refresh

**Files:**
- Create: `projects/hiai-post/backend/src/workers/oauth-refresh.ts`
- Modify: `projects/hiai-post/backend/src/lib/redis.ts` (add token refresh queue)

- [ ] **Step 1: Read existing OAuth implementation**

Read `projects/hiai-post/backend/src/api/routes/oauth.ts` and `projects/hiai-post/backend/src/modules/` to understand current token storage.

- [ ] **Step 2: Create OAuth token refresh worker**

```typescript
// projects/hiai-post/backend/src/workers/oauth-refresh.ts

import { db } from '../lib/db.js';
import { socialAccounts } from '../db/schema.js';
import { eq, lt, and } from 'drizzle-orm';
import { logger } from '../lib/logger.js';
import { decrypt, encrypt } from '../lib/encryption.js';

const log = logger.child({ module: 'oauth-refresh' });

const REFRESH_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000; // refresh 5 min before expiry

export async function startOAuthRefreshWorker(): Promise<void> {
  log.info('Starting OAuth token refresh worker');

  setInterval(async () => {
    try {
      const now = new Date();
      const soonExpiry = new Date(now.getTime() + TOKEN_EXPIRY_BUFFER_MS);

      // Find accounts with tokens expiring soon
      const expiringAccounts = await db
        .select()
        .from(socialAccounts)
        .where(
          and(
            eq(socialAccounts.status, 'active'),
            lt(socialAccounts.tokenExpiresAt, soonExpiry),
          ),
        );

      for (const account of expiringAccounts) {
        try {
          await refreshToken(account);
        } catch (err) {
          log.error({ accountId: account.id, error: String(err) }, 'Failed to refresh token');
        }
      }
    } catch (err) {
      log.error({ error: String(err) }, 'OAuth refresh worker error');
    }
  }, REFRESH_INTERVAL_MS);
}

async function refreshToken(account: {
  id: string;
  platform: string;
  refreshToken: string;
}): Promise<void> {
  const refreshToken = decrypt(account.refreshToken);

  // Platform-specific refresh logic
  let newAccessToken: string;
  let newRefreshToken: string | null = null;
  let expiresAt: Date;

  switch (account.platform) {
    case 'instagram':
    case 'facebook': {
      // Meta token refresh
      const res = await fetch(
        `https://graph.facebook.com/v19.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${process.env.FB_APP_ID}&client_secret=${process.env.FB_APP_SECRET}&fb_exchange_token=${refreshToken}`,
      );
      const data = await res.json();
      newAccessToken = data.access_token;
      expiresAt = new Date(Date.now() + data.expires_in * 1000);
      break;
    }
    case 'linkedin': {
      // LinkedIn token refresh
      const res = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: process.env.LINKEDIN_CLIENT_ID!,
          client_secret: process.env.LINKEDIN_CLIENT_SECRET!,
        }),
      });
      const data = await res.json();
      newAccessToken = data.access_token;
      newRefreshToken = data.refresh_token ?? null;
      expiresAt = new Date(Date.now() + data.expires_in * 1000);
      break;
    }
    case 'x':
    case 'x-post': {
      // X (Twitter) token refresh
      const res = await fetch('https://api.x.com/2/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: process.env.X_CLIENT_ID!,
        }),
      });
      const data = await res.json();
      newAccessToken = data.access_token;
      newRefreshToken = data.refresh_token ?? null;
      expiresAt = new Date(Date.now() + data.expires_in * 1000);
      break;
    }
    default:
      log.warn({ platform: account.platform }, 'No refresh logic for platform');
      return;
  }

  // Update database
  const updateData: Record<string, unknown> = {
    accessToken: encrypt(newAccessToken),
    tokenExpiresAt: expiresAt,
    updatedAt: new Date(),
  };
  if (newRefreshToken) {
    updateData.refreshToken = encrypt(newRefreshToken);
  }

  await db
    .update(socialAccounts)
    .set(updateData)
    .where(eq(socialAccounts.id, account.id));

  log.info({ accountId: account.id, platform: account.platform }, 'Token refreshed');
}
```

- [ ] **Step 3: Register worker in backend startup**

Read `projects/hiai-post/backend/src/api/index.ts` and add the worker call after `app.listen()`:

```typescript
import { startOAuthRefreshWorker } from '../workers/oauth-refresh.js';

// After app.listen():
await startOAuthRefreshWorker();
```

- [ ] **Step 4: Commit**

```bash
git add projects/hiai-post/backend/src/workers/ projects/hiai-post/backend/src/api/index.ts
git commit -m "feat(hiai-post): add OAuth token refresh worker"
```

---

### Task 5: Backend hardening — dead-letter queue processing

**Files:**
- Create: `projects/hiai-post/backend/src/workers/dead-letter.ts`
- Modify: `projects/hiai-post/backend/src/lib/redis.ts`

- [ ] **Step 1: Read existing queue implementation**

Read `projects/hiai-post/backend/src/lib/redis.ts` to understand the current dead-letter queue structure.

- [ ] **Step 2: Create dead-letter worker**

```typescript
// projects/hiai-post/backend/src/workers/dead-letter.ts

import { db } from '../lib/db.js';
import { posts } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { logger } from '../lib/logger.js';
import { getDeadLetterPosts, removeDeadLetterPost, enqueuePost } from '../lib/redis.js';

const log = logger.child({ module: 'dead-letter' });

const PROCESS_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_RETRIES = 3;

export async function startDeadLetterWorker(): Promise<void> {
  log.info('Starting dead-letter queue worker');

  setInterval(async () => {
    try {
      const deadPosts = await getDeadLetterPosts();

      for (const entry of deadPosts) {
        try {
          const { postId, retryCount = 0, lastError } = entry;

          if (retryCount >= MAX_RETRIES) {
            log.warn({ postId, retryCount, lastError }, 'Post exceeded max retries, marking as failed');
            await db
              .update(posts)
              .set({ status: 'failed', errorMessage: `Exceeded ${MAX_RETRIES} retries: ${lastError}` })
              .where(eq(posts.id, postId));
            await removeDeadLetterPost(postId);
            continue;
          }

          // Re-enqueue with incremented retry count
          const post = await db.select().from(posts).where(eq(posts.id, postId)).limit(1);
          if (!post[0] || post[0].status === 'published') {
            await removeDeadLetterPost(postId);
            continue;
          }

          const scheduledAt = post[0].scheduledAt ?? new Date();
          await enqueuePost(post[0].tenantId, postId, scheduledAt);
          await removeDeadLetterPost(postId);

          log.info({ postId, retryCount: retryCount + 1 }, 'Re-enqueued post from dead-letter');
        } catch (err) {
          log.error({ postId: entry.postId, error: String(err) }, 'Failed to process dead-letter entry');
        }
      }
    } catch (err) {
      log.error({ error: String(err) }, 'Dead-letter worker error');
    }
  }, PROCESS_INTERVAL_MS);
}
```

- [ ] **Step 3: Register worker in backend startup**

```typescript
// In projects/hiai-post/backend/src/api/index.ts — add:
import { startDeadLetterWorker } from '../workers/dead-letter.js';
await startDeadLetterWorker();
```

- [ ] **Step 4: Commit**

```bash
git add projects/hiai-post/backend/src/workers/ projects/hiai-post/backend/src/api/index.ts
git commit -m "feat(hiai-post): add dead-letter queue processing worker"
```

---

### Task 6: Feature — Mastra content generation workflows

**Files:**
- Create: `projects/hiai-post/backend/src/ai/workflows/generate-post.ts`
- Create: `projects/hiai-post/backend/src/ai/workflows/repurpose-post.ts`
- Create: `projects/hiai-post/backend/src/ai/agents/content-writer.ts`
- Modify: `projects/hiai-post/backend/src/api/routes/generate.ts`

- [ ] **Step 1: Read existing generate route**

Read `projects/hiai-post/backend/src/api/routes/generate.ts` and any existing Mastra setup.

- [ ] **Step 2: Create content writer agent**

```typescript
// projects/hiai-post/backend/src/ai/agents/content-writer.ts

import { Agent } from '@mastra/core/agent';
import { createMastra } from '../mastra.js';

export function createContentWriterAgent() {
  const mastra = createMastra();

  return new Agent({
    name: 'content-writer',
    instructions: `You are a social media content writer. Generate engaging, platform-appropriate content.

Rules:
- Instagram: Visual-first, hashtags, 2200 char max
- X/Twitter: Concise, 280 char max, threads for longer content
- LinkedIn: Professional, thought leadership, 3000 char max
- TikTok: Trend-aware, casual, 2200 char max
- Facebook: Conversational, community-focused
- Telegram: Direct, informative, 4096 char max
- Pinterest: Keyword-rich descriptions, 500 char max

Always include relevant hashtags. Match the tone to the platform.`,
    model: mastra.llm,
  });
}
```

- [ ] **Step 3: Create generate-post workflow**

```typescript
// projects/hiai-post/backend/src/ai/workflows/generate-post.ts

import { Workflow, Step } from '@mastra/core/workflows';
import { z } from 'zod';

const generatePostInput = z.object({
  topic: z.string(),
  platforms: z.array(z.string()),
  tone: z.enum(['professional', 'casual', 'humorous', 'inspirational']).default('casual'),
  includeHashtags: z.boolean().default(true),
  maxLength: z.number().optional(),
});

const generatePostOutput = z.object({
  content: z.string(),
  hashtags: z.array(z.string()),
  platform: z.string(),
  charCount: z.number(),
});

export function createGeneratePostWorkflow() {
  const workflow = new Workflow({
    name: 'generate-post',
    triggerSchema: generatePostInput,
  });

  const generateStep = new Step({
    id: 'generate-content',
    outputSchema: generatePostOutput,
    execute: async ({ context }) => {
      const { topic, platforms, tone, includeHashtags, maxLength } = context.triggerData;
      const platform = platforms[0]; // Generate for first platform
      const limit = maxLength ?? 2200;

      // Use LLM to generate content
      const prompt = `Write a ${tone} social media post about "${topic}" for ${platform}.
${includeHashtags ? 'Include relevant hashtags.' : 'No hashtags.'}
Maximum ${limit} characters.

Return only the post content, nothing else.`;

      // The actual LLM call happens via Mastra's agent system
      return {
        content: prompt, // Placeholder — will be replaced by agent call
        hashtags: [],
        platform,
        charCount: 0,
      };
    },
  });

  workflow.step(generateStep).commit();
  return workflow;
}
```

- [ ] **Step 4: Commit**

```bash
git add projects/hiai-post/backend/src/ai/
git commit -m "feat(hiai-post): add Mastra content generation workflows"
```

---

### Task 7: Feature — cross-platform analytics comparison

**Files:**
- Create: `projects/hiai-post/backend/src/modules/analytics/cross-platform.ts`
- Modify: `projects/hiai-post/backend/src/api/routes/analytics.ts`

- [ ] **Step 1: Read existing analytics route**

Read `projects/hiai-post/backend/src/api/routes/analytics.ts`.

- [ ] **Step 2: Create cross-platform analytics module**

```typescript
// projects/hiai-post/backend/src/modules/analytics/cross-platform.ts

import { db } from '../../lib/db.js';
import { posts, postAnalytics } from '../../db/schema.js';
import { eq, and, gte, lte, sql } from 'drizzle-orm';

export interface PlatformMetrics {
  platform: string;
  totalPosts: number;
  publishedPosts: number;
  totalLikes: number;
  totalShares: number;
  totalComments: number;
  totalImpressions: number;
  engagementRate: number;
  bestTimeToPost: string; // "HH:MM" format
  topPostId: string | null;
}

export async function getCrossPlatformMetrics(
  tenantId: string,
  startDate: Date,
  endDate: Date,
): Promise<PlatformMetrics[]> {
  const results = await db
    .select({
      platform: posts.platform,
      totalPosts: sql<number>`count(*)::int`,
      publishedPosts: sql<number>`count(case when ${posts.status} = 'published' then 1 end)::int`,
      totalLikes: sql<number>`coalesce(sum(${postAnalytics.likes}), 0)::int`,
      totalShares: sql<number>`coalesce(sum(${postAnalytics.shares}), 0)::int`,
      totalComments: sql<number>`coalesce(sum(${postAnalytics.comments}), 0)::int`,
      totalImpressions: sql<number>`coalesce(sum(${postAnalytics.impressions}), 0)::int`,
    })
    .from(posts)
    .leftJoin(postAnalytics, eq(posts.id, postAnalytics.postId))
    .where(
      and(
        eq(posts.tenantId, tenantId),
        gte(posts.createdAt, startDate),
        lte(posts.createdAt, endDate),
      ),
    )
    .groupBy(posts.platform);

  return results.map((r) => ({
    ...r,
    engagementRate:
      r.totalImpressions > 0
        ? ((r.totalLikes + r.totalShares + r.totalComments) / r.totalImpressions) * 100
        : 0,
    bestTimeToPost: '12:00', // TODO: compute from historical data
    topPostId: null, // TODO: find top post per platform
  }));
}
```

- [ ] **Step 3: Add endpoint to analytics route**

Read `projects/hiai-post/backend/src/api/routes/analytics.ts` and add:

```typescript
import { getCrossPlatformMetrics } from '../../modules/analytics/cross-platform.js';

// Add to analyticsRoutes:
.get('/api/v1/analytics/cross-platform', async ({ tenantId, query }) => {
  const startDate = new Date(query.start as string || Date.now() - 30 * 86400000);
  const endDate = new Date(query.end as string || Date.now());
  return getCrossPlatformMetrics(tenantId, startDate, endDate);
})
```

- [ ] **Step 4: Commit**

```bash
git add projects/hiai-post/backend/src/modules/analytics/ projects/hiai-post/backend/src/api/routes/analytics.ts
git commit -m "feat(hiai-post): add cross-platform analytics comparison"
```

---

### Task 8: Final verification

- [ ] **Step 1: Verify TypeScript compiles**

```bash
cd /mnt/ai_data/projects/hiai-post/app && bunx tsc --noEmit
cd /mnt/ai_data/projects/hiai-post/backend && bunx tsc --noEmit
```
Expected: 0 errors in both

- [ ] **Step 2: Run all tests**

```bash
cd /mnt/ai_data/projects/hiai-post && bun test
```
Expected: 33+ pass / 0 fail

- [ ] **Step 3: Verify standalone mode works**

```bash
cd /mnt/ai_data/projects/hiai-post && PUBLIC_HIAI_MODE=standalone bun run --filter hiai-post-frontend dev
```
Expected: sidebar with "Social Media" nav group visible

- [ ] **Step 4: Verify plugin manifest exports correctly**

```bash
bun -e "const m = await import('./projects/hiai-post/app/src/lib/plugin.ts'); console.log(JSON.stringify(m.hiaiPostPlugin, null, 2));"
```
Expected: valid plugin manifest with id, name, navGroups, proxy

- [ ] **Step 5: Commit any fixes**

```bash
git add -A && git commit -m "fix(hiai-post): verification fixes"
```

---


# Part B — hiai-post Dual Mode + Backend Hardening


> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make hiai-post work in dual mode — standalone (own SvelteKit shell) and unified (pages loaded inside hiai-admin via plugin system). Also harden the backend with OAuth token refresh and dead-letter queue processing.

**Architecture:** hiai-post app/src/lib/plugin.ts exports a plugin manifest consumed by hiai-admin. In standalone mode, the app uses its own layout with AdminSidebar/AdminHeader from @hiai/ui. In unified mode, pages are loaded by hiai-admin's catch-all route. Backend always runs independently on :50300.

**Tech Stack:** Svelte 5.55+, SvelteKit 2.60+, Elysia 1.4.28+, Mastra 1.36+, @hiai/ui, Better Auth

**Design Spec:** `docs/superpowers/specs/2026-05-25-hiai-ecosystem-design.md` — Sections 4.2, 4.5

**Prerequisite:** Plans 1 (@hiai/ui) and 2 (hiai-admin plugin system) must be complete.

---

## File Structure

```
projects/hiai-post/
├── app/src/
│   ├── lib/
│   │   ├── plugin.ts                   # NEW — plugin manifest export
│   │   ├── config.ts                   # NEW — mode detection + API URL config
│   │   ├── components/
│   │   │   └── LayoutShell.svelte      # NEW — standalone layout wrapper
│   │   └── stores/
│   │       ├── auth.svelte.ts          # MODIFY — re-export from @hiai/ui
│   │       └── ...
│   └── routes/
│       ├── +layout.svelte              # MODIFY — use LayoutShell in standalone mode
│       ├── +layout.server.ts           # MODIFY — pass mode to layout
│       └── ...                         # All other routes unchanged
├── backend/src/
│   ├── workers/
│   │   ├── oauth-refresh.ts            # NEW — periodic OAuth token refresh
│   │   └── dead-letter.ts              # NEW — dead-letter queue processor
│   └── api/
│       └── index.ts                    # MODIFY — register workers
└── docker-compose.yml                  # EXISTS — no changes
```

---

### Task 1: Migrate to @hiai/ui (prerequisite)

This is covered by Plan 1, Task 11. Once complete, hiai-post uses:
- `@hiai/ui` for AdminSidebar, AdminHeader, TipexEditor, auth store, notifications, api client
- Local components remain: PostEditor, Calendar, UpcomingPosts, PlatformCard, PlatformPreview, ConnectAccountModal, AnalyticsChart, TemplateEditor, accounts store, posts store

- [ ] **Step 1: Verify @hiai/ui migration is complete**

Check that `projects/hiai-post/app/package.json` has `"@hiai/ui": "workspace:*"` and local api.ts, auth store, editor components are replaced with @hiai/ui imports.

- [ ] **Step 2: Verify build**

```bash
cd /mnt/ai_data/projects/hiai-post/app && bunx tsc --noEmit
```
Expected: 0 errors

---

### Task 2: Create plugin manifest export

**Files:**
- Create: `projects/hiai-post/app/src/lib/plugin.ts`

- [ ] **Step 1: Create plugin manifest**

```typescript
// projects/hiai-post/app/src/lib/plugin.ts
import type { HiAiPlugin } from '@hiai/ui'; // or from hiai-admin's types

/**
 * hiai-post plugin manifest.
 * Consumed by hiai-admin's plugin registry.
 */
export const hiaiPostPlugin = {
  id: 'hiai-post',
  name: 'Social Media',
  version: '1.0.0',
  icon: '📱',
  description: 'Social media content planning and publishing with AI',

  navGroups: [
    {
      label: 'Social Media',
      items: [
        { label: 'Dashboard', href: '/social/dashboard', icon: '📊' },
        { label: 'Accounts', href: '/social/accounts', icon: '🔗' },
        { label: 'Posts', href: '/social/posts', icon: '📝' },
        { label: 'Campaigns', href: '/social/campaigns', icon: '🎯' },
        { label: 'Content Plans', href: '/social/content-plans', icon: '📋' },
        { label: 'Templates', href: '/social/templates', icon: '📄' },
        { label: 'Analytics', href: '/social/analytics', icon: '📈' },
      ],
    },
  ],

  proxy: {
    prefix: '/api/social',
    target: 'http://localhost:50300',
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add projects/hiai-post/app/src/lib/plugin.ts
git commit -m "feat(hiai-post): export plugin manifest for hiai-admin"
```

---

### Task 3: Create config with mode detection

**Files:**
- Create: `projects/hiai-post/app/src/lib/config.ts`

- [ ] **Step 1: Create config module**

```typescript
// projects/hiai-post/app/src/lib/config.ts

export type AppMode = 'standalone' | 'unified';

export const config = {
  mode: (import.meta.env.PUBLIC_HIAI_MODE ?? 'standalone') as AppMode,
  apiBaseUrl: import.meta.env.PUBLIC_API_URL ?? 'http://localhost:50300',
};

export function isStandalone(): boolean {
  return config.mode === 'standalone';
}

export function isUnified(): boolean {
  return config.mode === 'unified';
}
```

- [ ] **Step 2: Commit**

```bash
git add projects/hiai-post/app/src/lib/config.ts
git commit -m "feat(hiai-post): add config with standalone/unified mode detection"
```

---

### Task 4: Create LayoutShell for standalone mode

**Files:**
- Create: `projects/hiai-post/app/src/lib/components/LayoutShell.svelte`
- Modify: `projects/hiai-post/app/src/routes/+layout.svelte`
- Modify: `projects/hiai-post/app/src/routes/+layout.server.ts`

- [ ] **Step 1: Create LayoutShell component**

```svelte
<!-- projects/hiai-post/app/src/lib/components/LayoutShell.svelte -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { AdminSidebar, AdminHeader, ThemeToggle, notifications } from '@hiai/ui';

  let { user, children }: { user: unknown; children: Snippet } = $props();

  const navGroups = [
    {
      label: 'Social Media',
      items: [
        { label: 'Dashboard', href: '/dashboard', icon: '📊' },
        { label: 'Accounts', href: '/accounts', icon: '🔗' },
        { label: 'Posts', href: '/posts', icon: '📝' },
        { label: 'Campaigns', href: '/campaigns', icon: '🎯' },
        { label: 'Content Plans', href: '/content-plans', icon: '📋' },
        { label: 'Templates', href: '/templates', icon: '📄' },
        { label: 'Analytics', href: '/analytics', icon: '📈' },
      ],
    },
  ];

  let sidebarCollapsed = $state(false);
</script>

<div class="flex h-screen overflow-hidden bg-background">
  <AdminSidebar {navGroups} collapsed={sidebarCollapsed} appName="hiai-post" />

  <div class="flex flex-1 flex-col overflow-hidden">
    <AdminHeader {user} onToggleSidebar={() => (sidebarCollapsed = !sidebarCollapsed)}>
      {#snippet actions()}
        <ThemeToggle />
      {/snippet}
    </AdminHeader>

    <main class="flex-1 overflow-y-auto p-6">
      {@render children()}
    </main>
  </div>
</div>

<!-- Notification toasts -->
{#if notifications.items.length > 0}
  <div class="fixed bottom-4 right-4 z-50 space-y-2">
    {#each notifications.items as notification (notification.id)}
      <div class="rounded-lg border bg-card p-4 shadow-lg max-w-sm">
        <p class="text-sm font-medium">{notification.title}</p>
        {#if notification.message}
          <p class="text-xs text-muted-foreground mt-1">{notification.message}</p>
        {/if}
      </div>
    {/each}
  </div>
{/if}
```

- [ ] **Step 2: Update root layout server to pass mode**

```typescript
// projects/hiai-post/app/src/routes/+layout.server.ts
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ fetch }) => {
  let user = null;
  try {
    const res = await fetch('/api/auth/session');
    if (res.ok) {
      const session = await res.json();
      user = session.user ?? null;
    }
  } catch {}

  return {
    user,
    mode: import.meta.env.PUBLIC_HIAI_MODE ?? 'standalone',
  };
};
```

- [ ] **Step 3: Update root layout to use LayoutShell in standalone mode**

```svelte
<!-- projects/hiai-post/app/src/routes/+layout.svelte -->
<script lang="ts">
  import '../app.css';
  import type { Snippet } from 'svelte';
  import LayoutShell from '$lib/components/LayoutShell.svelte';

  let { data, children }: { data: { user: unknown; mode: string }; children: Snippet } = $props();
</script>

{#if data.mode === 'standalone'}
  <LayoutShell user={data.user}>
    {@render children()}
  </LayoutShell>
{:else}
  <!-- Unified mode: hiai-admin provides the shell, just render content -->
  {@render children()}
{/if}
```

- [ ] **Step 4: Verify build**

```bash
cd /mnt/ai_data/projects/hiai-post/app && bunx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add projects/hiai-post/app/
git commit -m "feat(hiai-post): implement dual-mode layout with LayoutShell"
```

---

### Task 5: Backend — OAuth token refresh worker

**Files:**
- Create: `projects/hiai-post/backend/src/workers/oauth-refresh.ts`
- Modify: `projects/hiai-post/backend/src/api/index.ts`

- [ ] **Step 1: Read existing OAuth code**

Read `projects/hiai-post/backend/src/modules/oauth/` or `projects/hiai-post/backend/src/api/routes/oauth.ts` to understand token storage.

- [ ] **Step 2: Create OAuth refresh worker**

```typescript
// projects/hiai-post/backend/src/workers/oauth-refresh.ts
import { logger } from '../lib/logger.js';
import { db } from '../lib/db.js';
import { socialAccounts } from '../db/schema.js';
import { eq, lt, and, isNotNull } from 'drizzle-orm';

const log = logger.child({ module: 'oauth-refresh' });

const REFRESH_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000; // refresh 5 min before expiry

export function startOAuthRefreshWorker(): void {
  log.info('Starting OAuth token refresh worker');

  setInterval(async () => {
    try {
      const now = new Date();
      const soonExpiry = new Date(now.getTime() + TOKEN_EXPIRY_BUFFER_MS);

      // Find accounts with tokens expiring soon
      const expiringAccounts = await db
        .select()
        .from(socialAccounts)
        .where(
          and(
            isNotNull(socialAccounts.refreshTokenEncrypted),
            lt(socialAccounts.tokenExpiresAt, soonExpiry),
          ),
        );

      for (const account of expiringAccounts) {
        try {
          await refreshToken(account);
        } catch (err) {
          log.error({ accountId: account.id, platform: account.platform, error: String(err) }, 'Token refresh failed');
        }
      }

      if (expiringAccounts.length > 0) {
        log.info({ count: expiringAccounts.length }, 'OAuth refresh cycle complete');
      }
    } catch (err) {
      log.error({ error: String(err) }, 'OAuth refresh worker error');
    }
  }, REFRESH_INTERVAL_MS);
}

async function refreshToken(account: { id: string; platform: string; refreshTokenEncrypted: string }) {
  // Decrypt refresh token
  const { decrypt } = await import('../lib/encryption.js');
  const refreshToken = decrypt(account.refreshTokenEncrypted);

  let tokenResponse: { access_token: string; refresh_token?: string; expires_in: number };

  switch (account.platform) {
    case 'instagram':
    case 'facebook':
      tokenResponse = await refreshMetaToken(refreshToken);
      break;
    case 'x':
    case 'x-post':
      tokenResponse = await refreshXTokens(refreshToken);
      break;
    case 'linkedin':
      tokenResponse = await refreshLinkedInToken(refreshToken);
      break;
    default:
      log.warn({ platform: account.platform }, 'No refresh strategy for platform');
      return;
  }

  const { encrypt } = await import('../lib/encryption.js');
  const expiresAt = new Date(Date.now() + tokenResponse.expires_in * 1000);

  await db
    .update(socialAccounts)
    .set({
      accessTokenEncrypted: encrypt(tokenResponse.access_token),
      refreshTokenEncrypted: tokenResponse.refresh_token ? encrypt(tokenResponse.refresh_token) : account.refreshTokenEncrypted,
      tokenExpiresAt: expiresAt,
      updatedAt: new Date(),
    })
    .where(eq(socialAccounts.id, account.id));

  log.info({ accountId: account.id, platform: account.platform, expiresAt }, 'Token refreshed');
}

async function refreshMetaToken(refreshToken: string) {
  const res = await fetch(
    `https://graph.facebook.com/v19.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${process.env.META_APP_ID}&client_secret=${process.env.META_APP_SECRET}&fb_exchange_token=${refreshToken}`,
  );
  if (!res.ok) throw new Error(`Meta refresh failed: ${res.status}`);
  const data = await res.json();
  return { access_token: data.access_token, refresh_token: undefined, expires_in: data.expires_in };
}

async function refreshXTokens(refreshToken: string) {
  const res = await fetch('https://api.x.com/2/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: process.env.X_CLIENT_ID!,
    }),
  });
  if (!res.ok) throw new Error(`X refresh failed: ${res.status}`);
  return res.json();
}

async function refreshLinkedInToken(refreshToken: string) {
  const res = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: process.env.LINKEDIN_CLIENT_ID!,
      client_secret: process.env.LINKEDIN_CLIENT_SECRET!,
    }),
  });
  if (!res.ok) throw new Error(`LinkedIn refresh failed: ${res.status}`);
  return res.json();
}
```

- [ ] **Step 3: Register worker in backend startup**

Read `projects/hiai-post/backend/src/api/index.ts` and add after `app.listen()`:

```typescript
import { startOAuthRefreshWorker } from '../workers/oauth-refresh.js';
startOAuthRefreshWorker();
```

- [ ] **Step 4: Commit**

```bash
git add projects/hiai-post/backend/src/workers/oauth-refresh.ts projects/hiai-post/backend/src/api/index.ts
git commit -m "feat(hiai-post): add OAuth token refresh worker"
```

---

### Task 6: Backend — dead-letter queue processor

**Files:**
- Create: `projects/hiai-post/backend/src/workers/dead-letter.ts`
- Modify: `projects/hiai-post/backend/src/api/index.ts`

- [ ] **Step 1: Read existing queue/dead-letter code**

Read `projects/hiai-post/backend/src/lib/redis.ts` to understand the dead-letter queue implementation.

- [ ] **Step 2: Create dead-letter processor**

```typescript
// projects/hiai-post/backend/src/workers/dead-letter.ts
import { logger } from '../lib/logger.js';
import { db } from '../lib/db.js';
import { publishQueue } from '../db/schema.js';
import { eq, and, lt } from 'drizzle-orm';

const log = logger.child({ module: 'dead-letter' });

const PROCESS_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_RETRIES = 3;

export function startDeadLetterProcessor(): void {
  log.info('Starting dead-letter queue processor');

  setInterval(async () => {
    try {
      // Find failed items eligible for retry
      const failedItems = await db
        .select()
        .from(publishQueue)
        .where(
          and(
            eq(publishQueue.status, 'failed'),
            lt(publishQueue.retryCount, MAX_RETRIES),
          ),
        )
        .limit(50);

      for (const item of failedItems) {
        try {
          // Increment retry count and requeue
          await db
            .update(publishQueue)
            .set({
              status: 'pending',
              retryCount: item.retryCount + 1,
              scheduledAt: new Date(Date.now() + item.retryCount * 60000), // exponential backoff
              errorMessage: null,
              updatedAt: new Date(),
            })
            .where(eq(publishQueue.id, item.id));

          log.info({ itemId: item.id, retryCount: item.retryCount + 1 }, 'Requeued failed item');
        } catch (err) {
          log.error({ itemId: item.id, error: String(err) }, 'Failed to requeue item');
        }
      }

      // Mark items that exceeded max retries as dead
      const deadItems = await db
        .update(publishQueue)
        .set({ status: 'dead', updatedAt: new Date() })
        .where(
          and(
            eq(publishQueue.status, 'failed'),
            lt(publishQueue.retryCount, MAX_RETRIES + 1),
          ),
        )
        .returning();

      if (deadItems.length > 0) {
        log.warn({ count: deadItems.length }, 'Moved items to dead-letter status');
      }
    } catch (err) {
      log.error({ error: String(err) }, 'Dead-letter processor error');
    }
  }, PROCESS_INTERVAL_MS);
}
```

- [ ] **Step 3: Register worker in backend startup**

```typescript
import { startDeadLetterProcessor } from '../workers/dead-letter.js';
startDeadLetterProcessor();
```

- [ ] **Step 4: Commit**

```bash
git add projects/hiai-post/backend/src/workers/dead-letter.ts projects/hiai-post/backend/src/api/index.ts
git commit -m "feat(hiai-post): add dead-letter queue processor"
```

---

### Task 7: Backend — cross-platform analytics

**Files:**
- Create: `projects/hiai-post/backend/src/modules/analytics/cross-platform.ts`
- Modify: `projects/hiai-post/backend/src/api/routes/analytics.ts`

- [ ] **Step 1: Create cross-platform analytics module**

```typescript
// projects/hiai-post/backend/src/modules/analytics/cross-platform.ts
import { db } from '../../lib/db.js';
import { posts, postAnalytics } from '../../db/schema.js';
import { eq, and, gte, lte, sql, desc } from 'drizzle-orm';

export interface PlatformMetrics {
  platform: string;
  totalPosts: number;
  publishedPosts: number;
  totalLikes: number;
  totalShares: number;
  totalComments: number;
  totalImpressions: number;
  engagementRate: number;
  bestPostingTimes: string[];
  topPost: { id: string; content: string; engagement: number } | null;
}

export async function getCrossPlatformMetrics(
  tenantId: string,
  startDate: Date,
  endDate: Date,
): Promise<PlatformMetrics[]> {
  const results = await db
    .select({
      platform: posts.platform,
      totalPosts: sql<number>`count(*)::int`,
      publishedPosts: sql<number>`count(*) filter (where ${posts.status} = 'published')::int`,
      totalLikes: sql<number>`coalesce(sum(${postAnalytics.likes}), 0)::int`,
      totalShares: sql<number>`coalesce(sum(${postAnalytics.shares}), 0)::int`,
      totalComments: sql<number>`coalesce(sum(${postAnalytics.comments}), 0)::int`,
      totalImpressions: sql<number>`coalesce(sum(${postAnalytics.impressions}), 0)::int`,
    })
    .from(posts)
    .leftJoin(postAnalytics, eq(posts.id, postAnalytics.postId))
    .where(
      and(
        eq(posts.tenantId, tenantId),
        gte(posts.createdAt, startDate),
        lte(posts.createdAt, endDate),
      ),
    )
    .groupBy(posts.platform);

  return results.map((r) => ({
    platform: r.platform,
    totalPosts: r.totalPosts,
    publishedPosts: r.publishedPosts,
    totalLikes: r.totalLikes,
    totalShares: r.totalShares,
    totalComments: r.totalComments,
    totalImpressions: r.totalImpressions,
    engagementRate: r.totalImpressions > 0
      ? ((r.totalLikes + r.totalShares + r.totalComments) / r.totalImpressions) * 100
      : 0,
    bestPostingTimes: [], // TODO: compute from historical data
    topPost: null, // TODO: fetch top post per platform
  }));
}
```

- [ ] **Step 2: Add endpoint to analytics routes**

Read `projects/hiai-post/backend/src/api/routes/analytics.ts` and add:

```typescript
import { getCrossPlatformMetrics } from '../../modules/analytics/cross-platform.js';

// Add to existing analytics routes:
.get('/analytics/cross-platform', async ({ query, set }) => {
  const tenantId = query.tenant_id as string;
  if (!tenantId) { set.status = 400; return { error: 'tenant_id required' }; }

  const startDate = new Date(query.start as string || Date.now() - 30 * 86400000);
  const endDate = new Date(query.end as string || Date.now());

  return getCrossPlatformMetrics(tenantId, startDate, endDate);
})
```

- [ ] **Step 3: Commit**

```bash
git add projects/hiai-post/backend/src/modules/analytics/ projects/hiai-post/backend/src/api/routes/analytics.ts
git commit -m "feat(hiai-post): add cross-platform analytics endpoint"
```

---

### Task 8: Final verification

- [ ] **Step 1: Verify hiai-post compiles**

```bash
cd /mnt/ai_data/projects/hiai-post/app && bunx tsc --noEmit
cd /mnt/ai_data/projects/hiai-post/backend && bunx tsc --noEmit
```
Expected: 0 errors in both

- [ ] **Step 2: Run all tests**

```bash
cd /mnt/ai_data/projects/hiai-post && bun test
```
Expected: 33 pass / 0 fail

- [ ] **Step 3: Verify plugin manifest exports**

```bash
cd /mnt/ai_data/projects/hiai-post/app && bun -e "const m = await import('./src/lib/plugin.ts'); console.log(JSON.stringify(m.hiaiPostPlugin, null, 2));"
```
Expected: plugin manifest with id, name, navGroups, proxy

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore(hiai-post): final verification cleanup"
```
