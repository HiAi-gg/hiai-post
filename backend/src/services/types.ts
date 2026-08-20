/**
 * Shared context passed from route handlers into the product-foundation
 * services. tenantId is ALWAYS the principal-derived value stashed by
 * tenantGuard (ctx.tenantId) — services never accept a tenant id from
 * request input.
 */
export interface ServiceContext {
  tenantId: string;
  userId: string;
}

export interface PaginationInput {
  page: number;
  limit: number;
}

export interface Paginated<T> {
  data: T[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}
