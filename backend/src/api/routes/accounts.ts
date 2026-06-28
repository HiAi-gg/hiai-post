import { and, eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { socialAccounts } from "../../db/schema.js";
import { db } from "../../lib/db.js";
import { logger } from "../../lib/logger.js";
import { authMiddleware } from "../middleware/auth.js";
import { requireAdmin, requireViewer } from "../middleware/rbac.js";
import { createRateLimiter } from "../middleware/rateLimiter.js";
import { tenantMiddleware } from "../middleware/tenant.js";

const _log = logger.child({ module: "accounts-route" });

export const accountsRoutes = new Elysia({ prefix: "/api/v1/accounts" })
  .use(createRateLimiter("authenticated"))
  .use(authMiddleware)
  .use(tenantMiddleware)
  // Viewer by default for read ops
  .use(requireViewer())
  // List connected social accounts
  .get("/", async (ctx: any) => {
    const tenantId = (ctx as any).tenantId;
    const accounts = await db
      .select({
        id: socialAccounts.id,
        platform: socialAccounts.platform,
        accountId: socialAccounts.accountId,
        username: socialAccounts.username,
        displayName: socialAccounts.displayName,
        avatarUrl: socialAccounts.avatarUrl,
        status: socialAccounts.status,
        connectedAt: socialAccounts.connectedAt,
      })
      .from(socialAccounts)
      .where(eq(socialAccounts.tenantId, tenantId));

    return { accounts };
  })
  // Get single account
  .get("/:id", async (ctx: any) => {
    const { params, set } = ctx;
    const tenantId = (ctx as any).tenantId;
    const [account] = await db
      .select({
        id: socialAccounts.id,
        platform: socialAccounts.platform,
        accountId: socialAccounts.accountId,
        username: socialAccounts.username,
        displayName: socialAccounts.displayName,
        avatarUrl: socialAccounts.avatarUrl,
        status: socialAccounts.status,
        tokenExpiresAt: socialAccounts.tokenExpiresAt,
        scopes: socialAccounts.scopes,
        connectedAt: socialAccounts.connectedAt,
      })
      .from(socialAccounts)
      .where(and(eq(socialAccounts.id, params.id), eq(socialAccounts.tenantId, tenantId)))
      .limit(1);

    if (!account) {
      set.status = 404;
      return { error: "Account not found" };
    }
    return { account };
  })
  // Disconnect is destructive — admin+
  .use(requireAdmin())
  // Disconnect account
  .delete("/:id", async ({ params, tenantId, set }: any) => {
    const [deleted] = await db
      .delete(socialAccounts)
      .where(and(eq(socialAccounts.id, params.id), eq(socialAccounts.tenantId, tenantId)))
      .returning({ id: socialAccounts.id });

    if (!deleted) {
      set.status = 404;
      return { error: "Account not found" };
    }
    return { success: true, message: "Account disconnected" };
  });
