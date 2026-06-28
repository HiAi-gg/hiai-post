import { Elysia } from "elysia";
import { auth } from "../../auth/index.js";

/**
 * Better Auth delegation route.
 *
 * Better Auth's `auth.handler` is a standard Web Fetch handler:
 *   (request: Request) => Promise<Response>
 *
 * We mount it under the canonical `/api/auth/*` prefix so all Better Auth
 * endpoints (`/api/auth/session`, `/api/auth/sign-in/email`,
 * `/api/auth/get-session`, etc.) resolve to a single delegating handler.
 * Mirrors the hiai-docs pattern (see projects/hiai-docs/backend/src/api/routes/auth.ts).
 *
 * This route is intentionally mounted OUTSIDE the `protectedApp` chain —
 * auth endpoints must be reachable without a session, and the `apiLogger`
 * already records the request.
 */
export const authRoutes = new Elysia({ prefix: "/api/auth" }).all("/*", ({ request }) =>
  auth.handler(request)
);
