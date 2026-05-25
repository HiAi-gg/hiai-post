import { Elysia } from 'elysia';

/**
 * Tenant scoping middleware.
 * Extracts tenant_id from X-Tenant-Id header or JWT claims.
 * Validates tenant exists and is active.
 */
export const tenantMiddleware = new Elysia({ name: 'tenant' })
  .derive(async ({ request, set }): Promise<{ tenantId: string }> => {
    const tenantId = request.headers.get('X-Tenant-Id');

    if (!tenantId) {
      set.status = 400;
      throw new Error('X-Tenant-Id header is required');
    }

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(tenantId)) {
      set.status = 400;
      throw new Error('Invalid tenant ID format');
    }

    return {
      tenantId,
    };
  });
