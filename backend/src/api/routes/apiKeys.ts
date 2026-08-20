/**
 * API key routes — /api/v1/api-keys
 *
 * Admin-only machine credential management for the Work API surface (MCP +
 * bearer routes). The FULL key is returned exactly once (creation response);
 * listings and revocations only ever expose the visible prefix, never the
 * hash or the plaintext.
 *
 * Guards: auth → tenant → admin+ (creating credentials is a governance
 * action). Tenant scope comes exclusively from `ctx.tenantId`; the created
 * key is bound to that tenant forever. Scopes are validated against the
 * known set by the service (unknown scopes → 400 VALIDATION).
 */
import { Elysia } from "elysia";
import { createApiKey, listApiKeys, revokeApiKey } from "../../services/apiKeys.js";
import { handleServiceError } from "../../services/errors.js";
import { authGuard } from "../middleware/auth.js";
import { createRateLimiter } from "../middleware/rateLimiter.js";
import { requireAdmin } from "../middleware/rbac.js";
import { tenantGuard } from "../middleware/tenant.js";

export const apiKeysRoutes = new Elysia({ prefix: "/api/v1/api-keys" })
  .use(createRateLimiter("authenticated") as any)
  .onBeforeHandle(authGuard)
  .onBeforeHandle(tenantGuard)
  .onBeforeHandle(requireAdmin())
  // Create — returns the full key exactly once (`{ key, apiKey }`).
  .post("/", async ({ body, tenantId, userId, set }: any) => {
    try {
      const { key, item } = await createApiKey({ tenantId, userId }, body);
      set.status = 201;
      return { key, apiKey: item };
    } catch (err) {
      return handleServiceError(set, err);
    }
  })
  // List — prefix + metadata only (no hash, no key).
  .get("/", async ({ tenantId, userId }: any) => {
    const items = await listApiKeys({ tenantId, userId });
    return { items };
  })
  // Revoke — tombstones the key; the row + hash history are retained for audit.
  .post("/:id/revoke", async ({ params, tenantId, userId, set }: any) => {
    try {
      const item = await revokeApiKey({ tenantId, userId }, params.id);
      return { apiKey: item };
    } catch (err) {
      return handleServiceError(set, err);
    }
  });
