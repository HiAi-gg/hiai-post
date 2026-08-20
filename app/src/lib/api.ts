import { createApi } from "@hiai/ui";

/**
 * API client routed through the SvelteKit proxy (same origin).
 *
 * `createApi` prefixes every call with its base URL; an empty base makes
 * `api.get("/api/v1/posts")` resolve to the frontend origin's own
 * `/api/v1/*` proxy routes. Those proxies inject the existing Better Auth
 * session (`Authorization: Bearer`) and resolved workspace (`X-Tenant-Id`)
 * server-side, so browser calls reach the backend protected routes with
 * the user's session — instead of failing with 401/400 as direct
 * cross-origin calls to the backend URL do.
 */
export const api = createApi("");
