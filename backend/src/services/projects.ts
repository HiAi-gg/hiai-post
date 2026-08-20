/**
 * Project / Brand service — tenant-scoped CRUD + context retrieval for the
 * shared product foundation.
 *
 * Every query filters on `ctx.tenantId` (the principal-derived tenant from
 * tenantGuard). Project and brand ids from request input are only used as
 * lookup keys WITHIN the tenant — never trusted for scoping. Cross-tenant
 * rows are indistinguishable from "not found" (404), which avoids leaking
 * existence across tenants.
 */
import { and, count, desc, eq, sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { brandSchema, projectSchema } from "../api/validation/schemas.js";
import { brands, contentItems, projects } from "../db/schema.js";
import { db as defaultDb } from "../lib/db.js";
import { NotFoundError, ValidationError } from "./errors.js";
import type { Paginated, PaginationInput, ServiceContext } from "./types.js";

type Db = Pick<PgDatabase<any, any, any>, "select" | "insert" | "update" | "delete">;

export interface ProjectInput {
  name: string;
  description?: string | null;
  defaultLanguage?: string | null;
  targetAudience?: string | null;
  tone?: string | null;
  contentGuidelines?: string | null;
  businessContext?: string | null;
  references?: Array<Record<string, unknown>>;
  status?: "active" | "archived";
  settings?: Record<string, unknown>;
}

export interface BrandInput {
  name: string;
  description?: string | null;
  voice?: string | null;
  defaultLanguage?: string | null;
  targetAudience?: string | null;
  contentGuidelines?: string | null;
  businessContext?: string | null;
  references?: Array<Record<string, unknown>>;
  avatarUrl?: string | null;
  settings?: Record<string, unknown>;
}

function parseProject(input: unknown): ProjectInput {
  const parsed = projectSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError("Validation failed", parsed.error.flatten());
  return parsed.data;
}

function parseProjectPartial(input: unknown): Partial<ProjectInput> {
  const parsed = projectSchema.partial().safeParse(input);
  if (!parsed.success) throw new ValidationError("Validation failed", parsed.error.flatten());
  return parsed.data;
}

function parseBrand(input: unknown): BrandInput {
  const parsed = brandSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError("Validation failed", parsed.error.flatten());
  return parsed.data;
}

function parseBrandPartial(input: unknown): Partial<BrandInput> {
  const parsed = brandSchema.partial().safeParse(input);
  if (!parsed.success) throw new ValidationError("Validation failed", parsed.error.flatten());
  return parsed.data;
}

function withDb(db?: Db) {
  return (db as any) ?? defaultDb;
}

export async function listProjects(
  ctx: ServiceContext,
  input: PaginationInput,
  db?: Db
): Promise<Paginated<any>> {
  const d = withDb(db);
  const { page, limit } = input;
  const where = eq(projects.tenantId, ctx.tenantId);

  const [{ total }] = await d.select({ total: count() }).from(projects).where(where);

  const data = await d
    .select()
    .from(projects)
    .where(where)
    .orderBy(desc(projects.createdAt))
    .limit(limit)
    .offset((page - 1) * limit);

  return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

export async function createProject(ctx: ServiceContext, input: unknown, db?: Db): Promise<any> {
  const d = withDb(db);
  const data = parseProject(input);
  const [project] = await d
    .insert(projects)
    .values({
      tenantId: ctx.tenantId,
      name: data.name,
      description: data.description ?? null,
      defaultLanguage: data.defaultLanguage ?? null,
      targetAudience: data.targetAudience ?? null,
      tone: data.tone ?? null,
      contentGuidelines: data.contentGuidelines ?? null,
      businessContext: data.businessContext ?? null,
      references: data.references ?? [],
      status: data.status ?? "active",
      settings: data.settings ?? {},
      createdBy: ctx.userId,
    })
    .returning();
  return project;
}

export async function getProject(ctx: ServiceContext, id: string, db?: Db): Promise<any> {
  const d = withDb(db);
  const [project] = await d
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.tenantId, ctx.tenantId)))
    .limit(1);
  if (!project) throw new NotFoundError("Project not found");
  return project;
}

export async function updateProject(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  db?: Db
): Promise<any> {
  const d = withDb(db);
  const data = parseProjectPartial(input);
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (data.name !== undefined) set.name = data.name;
  if (data.description !== undefined) set.description = data.description ?? null;
  if (data.defaultLanguage !== undefined) set.defaultLanguage = data.defaultLanguage ?? null;
  if (data.targetAudience !== undefined) set.targetAudience = data.targetAudience ?? null;
  if (data.tone !== undefined) set.tone = data.tone ?? null;
  if (data.contentGuidelines !== undefined) set.contentGuidelines = data.contentGuidelines ?? null;
  if (data.businessContext !== undefined) set.businessContext = data.businessContext ?? null;
  if (data.references !== undefined) set.references = data.references ?? [];
  if (data.status !== undefined) set.status = data.status;
  if (data.settings !== undefined) set.settings = data.settings ?? {};

  const [project] = await d
    .update(projects)
    .set(set)
    .where(and(eq(projects.id, id), eq(projects.tenantId, ctx.tenantId)))
    .returning();
  if (!project) throw new NotFoundError("Project not found");
  return project;
}

export async function deleteProject(ctx: ServiceContext, id: string, db?: Db): Promise<void> {
  const d = withDb(db);
  const [deleted] = await d
    .delete(projects)
    .where(and(eq(projects.id, id), eq(projects.tenantId, ctx.tenantId)))
    .returning({ id: projects.id });
  if (!deleted) throw new NotFoundError("Project not found");
}

/**
 * Project context: the project plus its brands and a content summary.
 * Used to hydrate a workspace/project header without extra round-trips.
 */
export async function getProjectContext(
  ctx: ServiceContext,
  projectId: string,
  db?: Db
): Promise<any> {
  const d = withDb(db);
  const project = await getProject(ctx, projectId, d);

  const projectBrands = await d
    .select()
    .from(brands)
    .where(and(eq(brands.projectId, projectId), eq(brands.tenantId, ctx.tenantId)))
    .orderBy(desc(brands.createdAt));

  const [{ total }] = await d
    .select({ total: count() })
    .from(contentItems)
    .where(and(eq(contentItems.projectId, projectId), eq(contentItems.tenantId, ctx.tenantId)));

  const byStatus = await d
    .select({ status: contentItems.status, total: sql<number>`count(*)::int` })
    .from(contentItems)
    .where(and(eq(contentItems.projectId, projectId), eq(contentItems.tenantId, ctx.tenantId)))
    .groupBy(contentItems.status);

  return {
    project,
    brands: projectBrands,
    content: {
      total,
      byStatus: Object.fromEntries(
        byStatus.map((r: { status: string; total: number }) => [r.status, r.total])
      ),
    },
  };
}

// ─── Brands ───────────────────────────────────────────────

export async function listBrands(
  ctx: ServiceContext,
  input: { projectId?: string } & PaginationInput,
  db?: Db
): Promise<Paginated<any>> {
  const d = withDb(db);
  const { page, limit, projectId } = input;
  const conditions = [eq(brands.tenantId, ctx.tenantId)];
  if (projectId) conditions.push(eq(brands.projectId, projectId));
  const where = and(...conditions);

  const [{ total }] = await d.select({ total: count() }).from(brands).where(where);

  const data = await d
    .select()
    .from(brands)
    .where(where)
    .orderBy(desc(brands.createdAt))
    .limit(limit)
    .offset((page - 1) * limit);

  return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

/**
 * Create a brand. `projectId` is bound by the route (path param), never taken
 * from the body — and even then it is validated to exist within the tenant.
 */
export async function createBrand(
  ctx: ServiceContext,
  input: unknown,
  opts: { projectId?: string } = {},
  db?: Db
): Promise<any> {
  const d = withDb(db);
  const data = parseBrand(input);
  if (opts.projectId) {
    const project = await getProject(ctx, opts.projectId, d);
    if (!project) throw new NotFoundError("Project not found");
  }
  const [brand] = await d
    .insert(brands)
    .values({
      tenantId: ctx.tenantId,
      projectId: opts.projectId ?? null,
      name: data.name,
      description: data.description ?? null,
      voice: data.voice ?? null,
      defaultLanguage: data.defaultLanguage ?? null,
      targetAudience: data.targetAudience ?? null,
      contentGuidelines: data.contentGuidelines ?? null,
      businessContext: data.businessContext ?? null,
      references: data.references ?? [],
      avatarUrl: data.avatarUrl ?? null,
      settings: data.settings ?? {},
      createdBy: ctx.userId,
    })
    .returning();
  return brand;
}

export async function getBrand(
  ctx: ServiceContext,
  id: string,
  opts: { projectId?: string } = {},
  db?: Db
): Promise<any> {
  const d = withDb(db);
  const where = opts.projectId
    ? and(
        eq(brands.id, id),
        eq(brands.projectId, opts.projectId),
        eq(brands.tenantId, ctx.tenantId)
      )
    : and(eq(brands.id, id), eq(brands.tenantId, ctx.tenantId));

  const [brand] = await d.select().from(brands).where(where).limit(1);
  if (!brand) throw new NotFoundError("Brand not found");
  return brand;
}

export async function updateBrand(
  ctx: ServiceContext,
  id: string,
  input: unknown,
  opts: { projectId?: string } = {},
  db?: Db
): Promise<any> {
  const d = withDb(db);
  const data = parseBrandPartial(input);
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (data.name !== undefined) set.name = data.name;
  if (data.description !== undefined) set.description = data.description ?? null;
  if (data.voice !== undefined) set.voice = data.voice ?? null;
  if (data.defaultLanguage !== undefined) set.defaultLanguage = data.defaultLanguage ?? null;
  if (data.targetAudience !== undefined) set.targetAudience = data.targetAudience ?? null;
  if (data.contentGuidelines !== undefined) set.contentGuidelines = data.contentGuidelines ?? null;
  if (data.businessContext !== undefined) set.businessContext = data.businessContext ?? null;
  if (data.references !== undefined) set.references = data.references ?? [];
  if (data.avatarUrl !== undefined) set.avatarUrl = data.avatarUrl ?? null;
  if (data.settings !== undefined) set.settings = data.settings ?? {};

  const where = opts.projectId
    ? and(
        eq(brands.id, id),
        eq(brands.projectId, opts.projectId),
        eq(brands.tenantId, ctx.tenantId)
      )
    : and(eq(brands.id, id), eq(brands.tenantId, ctx.tenantId));

  const [brand] = await d.update(brands).set(set).where(where).returning();
  if (!brand) throw new NotFoundError("Brand not found");
  return brand;
}

export async function deleteBrand(
  ctx: ServiceContext,
  id: string,
  opts: { projectId?: string } = {},
  db?: Db
): Promise<void> {
  const d = withDb(db);
  const where = opts.projectId
    ? and(
        eq(brands.id, id),
        eq(brands.projectId, opts.projectId),
        eq(brands.tenantId, ctx.tenantId)
      )
    : and(eq(brands.id, id), eq(brands.tenantId, ctx.tenantId));

  const [deleted] = await d.delete(brands).where(where).returning({ id: brands.id });
  if (!deleted) throw new NotFoundError("Brand not found");
}

/** Shared guard for cross-tenant reference validation (used by content service). */
export async function assertProjectInTenant(
  ctx: ServiceContext,
  projectId: string,
  db?: Db
): Promise<void> {
  const d = withDb(db);
  const [project] = await d
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.tenantId, ctx.tenantId)))
    .limit(1);
  if (!project) throw new ValidationError("projectId does not exist in this tenant");
}

export async function assertBrandInTenant(
  ctx: ServiceContext,
  brandId: string,
  db?: Db
): Promise<void> {
  const d = withDb(db);
  const [brand] = await d
    .select({ id: brands.id })
    .from(brands)
    .where(and(eq(brands.id, brandId), eq(brands.tenantId, ctx.tenantId)))
    .limit(1);
  if (!brand) throw new ValidationError("brandId does not exist in this tenant");
}
