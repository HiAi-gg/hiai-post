/**
 * API key service — tenant-scoped machine credentials for the Work API
 * surface (MCP + bearer routes).
 *
 * Security contract:
 *   - Only a SHA-256 hex digest of the FULL `hpk_<secret>` value is ever
 *     persisted (`key_hash`). The plaintext key is returned EXACTLY ONCE at
 *     creation and never stored, logged, or exposed again.
 *   - A short visible `prefix` (`hpk_` + first 8 chars of the secret) is
 *     stored for identification in listings / logs.
 *   - Keys carry product-level `scopes` (see `API_KEY_SCOPES`), an optional
 *     `expiresAt`, and are tombstoned with `revokedAt` (rows are kept for
 *     auditability — history is never rewritten).
 *   - Tenant scope comes exclusively from `ctx.tenantId`; a key row's tenant
 *     is the ONLY tenant its bearer can ever act in (enforced by authGuard →
 *     tenantGuard, which ignore client-supplied tenant headers for machine
 *     principals).
 *
 * Role floor derivation (`apiKeyRoleForScopes`) feeds the SAME RBAC context
 * (`ctx.tenantRole`) the Writer/Carousel routes consume, so an API-key
 * principal satisfies `requireViewer/Editor/Admin/Owner` appropriately while
 * fine-grained tool scopes are enforced separately by the MCP tool layer.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { z } from "zod";
import { apiKeys, type TenantRole } from "../db/schema.js";
import { db as defaultDb } from "../lib/db.js";
import { NotFoundError, ValidationError } from "./errors.js";
import type { ServiceContext } from "./types.js";

type Db = Pick<PgDatabase<any, any, any>, "select" | "insert" | "update" | "delete">;

// ---------------------------------------------------------------------------
// Scopes & key format
// ---------------------------------------------------------------------------

/** Recognizable prefix for every machine credential. */
export const API_KEY_PREFIX = "hpk_";

/**
 * Product-level scopes. Fine-grained capability gates (enforced by the MCP
 * tool layer) plus `*` (all scopes) and `api-keys:admin` (key management).
 */
export const API_KEY_SCOPES = [
  "writer:generate",
  "writer:rewrite",
  "carousel:generate",
  "carousel:read",
  "carousel:regenerate",
  "content:read",
  "content:submit_review",
  "content:request_changes",
  "content:approve",
  "api-keys:admin",
] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

/** Allowed scope values in `create` input (known scopes plus the wildcard). */
export const API_KEY_SCOPE_VALUES = [...API_KEY_SCOPES, "*"] as const;

/** Scopes that grant write-level (editor+) access within the tenant. */
const WRITE_SCOPES: ReadonlySet<string> = new Set([
  "writer:generate",
  "writer:rewrite",
  "carousel:generate",
  "carousel:regenerate",
  "content:submit_review",
  "content:request_changes",
]);

/**
 * Map a key's scopes to the minimum RBAC role floor stashed on
 * `ctx.tenantRole` (the SAME context Writer/Carousel RBAC guards consume):
 *   - `*` / `api-keys:admin` → owner
 *   - `content:approve`      → admin
 *   - any write scope        → editor
 *   - read-only              → viewer
 */
export function apiKeyRoleForScopes(scopes: readonly string[]): TenantRole {
  const set = new Set(scopes);
  if (set.has("*") || set.has("api-keys:admin")) return "owner";
  if (set.has("content:approve")) return "admin";
  for (const scope of WRITE_SCOPES) {
    if (set.has(scope)) return "editor";
  }
  return "viewer";
}

/** True when the key's scopes satisfy a required scope (`*` grants all). */
export function hasScope(scopes: readonly string[] | null | undefined, required: string): boolean {
  if (!scopes) return true; // admin-JWT principals carry no scope list = all
  if (scopes.includes("*")) return true;
  return scopes.includes(required);
}

/** SHA-256 hex digest of the full key — the ONLY stored representation. */
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export interface GeneratedApiKey {
  /** Full credential `hpk_<secret>` — returned exactly once, never stored. */
  key: string;
  /** Visible prefix: `hpk_` + first 8 chars of the secret. */
  prefix: string;
  keyHash: string;
}

/** Generate a new credential. 32 random bytes → base64url (43 chars). */
export function generateApiKey(): GeneratedApiKey {
  const secret = randomBytes(32).toString("base64url");
  const key = `${API_KEY_PREFIX}${secret}`;
  return { key, prefix: `${API_KEY_PREFIX}${secret.slice(0, 8)}`, keyHash: hashApiKey(key) };
}

// ---------------------------------------------------------------------------
// Runtime-validated contracts
// ---------------------------------------------------------------------------

export const createApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  scopes: z.array(z.enum(API_KEY_SCOPE_VALUES)).min(1).max(16),
  expiresAt: z.string().datetime().optional(),
});
export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;

// ---------------------------------------------------------------------------
// Service surface
// ---------------------------------------------------------------------------

function withDb(db?: Db): Db {
  return (db as any) ?? defaultDb;
}

/** Fields safe to return in listings — never the hash or the plaintext. */
export type ApiKeyListItem = Omit<typeof apiKeys.$inferSelect, "keyHash">;

function toListItem(row: typeof apiKeys.$inferSelect): ApiKeyListItem {
  const { keyHash: _keyHash, ...rest } = row;
  return rest;
}

/**
 * Create a tenant-scoped API key. Returns the FULL key exactly once; only
 * the hash + prefix are persisted. `scopes` must be non-empty and drawn
 * from the known set (or `["*"]`).
 */
export async function createApiKey(
  ctx: ServiceContext,
  input: unknown,
  db?: Db
): Promise<{ key: string; item: ApiKeyListItem }> {
  const d = withDb(db);
  const parsed = createApiKeySchema.safeParse(input);
  if (!parsed.success) throw new ValidationError("Validation failed", parsed.error.flatten());
  const { key, prefix, keyHash } = generateApiKey();
  const expiresAt = parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null;

  const [row] = await d
    .insert(apiKeys)
    .values({
      tenantId: ctx.tenantId,
      name: parsed.data.name,
      prefix,
      keyHash,
      scopes: parsed.data.scopes,
      createdBy: ctx.userId,
      expiresAt,
    })
    .returning();

  return { key, item: toListItem(row) };
}

/** List the tenant's keys (hash and plaintext are never exposed). */
export async function listApiKeys(ctx: ServiceContext, db?: Db): Promise<ApiKeyListItem[]> {
  const d = withDb(db);
  const rows = await d
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.tenantId, ctx.tenantId))
    .orderBy(desc(apiKeys.createdAt));
  return rows.map(toListItem);
}

/** Revoke a key (tombstone). Row + hash history are retained for audit. */
export async function revokeApiKey(
  ctx: ServiceContext,
  id: string,
  db?: Db
): Promise<ApiKeyListItem> {
  const d = withDb(db);
  const [row] = await d
    .update(apiKeys)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(apiKeys.id, id), eq(apiKeys.tenantId, ctx.tenantId)))
    .returning();
  if (!row) throw new NotFoundError("API key not found");
  return toListItem(row);
}

/**
 * Resolve a bearer credential to its key row for authentication. Returns
 * `null` for unknown / revoked / expired keys — callers must respond 401 and
 * MUST NOT distinguish the failure reason (no state leakage).
 */
export async function resolveApiKeyForAuth(
  rawKey: string,
  db?: Db
): Promise<typeof apiKeys.$inferSelect | null> {
  if (!rawKey.startsWith(API_KEY_PREFIX)) return null;
  const d = withDb(db);
  const hash = hashApiKey(rawKey);
  const [row] = await d.select().from(apiKeys).where(eq(apiKeys.keyHash, hash)).limit(1);
  if (!row) return null;
  if (row.revokedAt) return null;
  if (row.expiresAt && new Date(row.expiresAt).getTime() <= Date.now()) return null;
  return row;
}

/**
 * Best-effort `last_used_at` bump. Fire-and-forget from the auth path — a
 * failure must never fail the request. Callers should throttle to at most
 * one update per key per ~minute (using the row read during resolution).
 */
export async function touchApiKey(id: string, db?: Db): Promise<void> {
  const d = withDb(db);
  try {
    await d
      .update(apiKeys)
      .set({ lastUsedAt: new Date(), updatedAt: new Date() })
      .where(eq(apiKeys.id, id));
  } catch {
    // Never let a last-used bookkeeping failure break authentication.
  }
}

/** True when the last-use timestamp is stale enough to warrant an update. */
export function shouldTouchKey(row: { lastUsedAt?: Date | string | null } | null): boolean {
  if (!row?.lastUsedAt) return true;
  return Date.now() - new Date(row.lastUsedAt).getTime() > 60_000;
}
