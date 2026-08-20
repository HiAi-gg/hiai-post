declare global {
  namespace App {
    interface Locals {
      /**
       * Better Auth session token extracted from the request cookies by
       * `hooks.server.ts`. Injected as `Authorization: Bearer` on proxied
       * backend calls (see `src/lib/server/bridge.ts`).
       */
      sessionToken?: string;
      /**
       * Workspace (tenant) id resolved by `hooks.server.ts` — either the
       * request's own `X-Tenant-Id` or the `HIAI_TENANT_ID` deployment
       * setting. Forwarded to the backend so protected routes are scoped
       * to a valid tenant.
       */
      tenantId?: string;
    }
  }
}

/**
 * Vite `?raw` imports embed a file's contents as a plain string at build
 * time. The audit route uses this to bundle the canonical
 * `audit-report.md` from the monorepo root — no runtime filesystem reads.
 */
declare module "*?raw" {
  const content: string;
  export default content;
}

export {};
