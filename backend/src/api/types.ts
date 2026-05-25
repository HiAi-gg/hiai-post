/**
 * Shared context types for Elysia routes.
 *
 * Elysia's `.derive()` return types don't always propagate across
 * file boundaries. These types provide a manual override.
 */

export interface TenantContext {
  tenantId: string;
}

export interface AuthContext {
  userId: string;
}

export type RouteContext = TenantContext & AuthContext;
