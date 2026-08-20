import type { Handle } from "@sveltejs/kit";
import { resolveTenantId, SESSION_COOKIE } from "$lib/server/bridge";

/**
 * Session ↔ workspace bridge.
 *
 * Extracts the existing Better Auth session cookie from the incoming
 * request and resolves the workspace (tenant) id, exposing both on
 * `event.locals`. The proxy routes (`/api/v1/*`) then propagate them to
 * the backend as `Authorization: Bearer` + `X-Tenant-Id`, so server-side
 * frontend API calls reuse the browser's session — no second auth system.
 */
export const handle: Handle = async ({ event, resolve }) => {
  event.locals.sessionToken = event.cookies.get(SESSION_COOKIE) || undefined;
  event.locals.tenantId = resolveTenantId(
    event.request.headers.get("x-tenant-id"),
    process.env.HIAI_TENANT_ID
  );
  return resolve(event);
};
