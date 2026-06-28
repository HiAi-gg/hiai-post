/**
 * Elysia type augmentation — adds tenantId and userId to context.
 *
 * This file declares the types that tenant.ts and auth.ts middleware
 * derive into the Elysia context, so routes can destructure them
 * without TypeScript errors.
 */

import "elysia";

declare module "elysia" {
  interface ElysiaCustomContext {
    tenantId: string;
    userId: string;
  }
}
