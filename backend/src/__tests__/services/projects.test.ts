/**
 * Unit tests for the project/brand services (Phase 3 shared product
 * foundation). Run with an in-memory fake db. Covers tenant isolation,
 * project-scoped brand access, context retrieval, and error envelopes.
 *
 * Run with: npx vitest run src/__tests__/services/projects.test.ts
 */
import { describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.BETTER_AUTH_SECRET ??= "test-secret-key-min-32-characters-long";
process.env.TOKEN_ENCRYPTION_KEY ??=
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

vi.mock("../../lib/db.js", () => ({
  db: {},
  checkDbHealth: async () => true,
  withTransaction: async (fn: (tx: any) => Promise<unknown>) => fn({}),
}));

vi.mock("../../lib/logger.js", () => {
  const noop = () => {};
  return {
    logger: { child: () => ({ warn: noop, error: noop, info: noop, debug: noop }), info: noop },
  };
});

import { NotFoundError, ValidationError } from "../../services/errors.js";
import {
  createBrand,
  createProject,
  deleteBrand,
  deleteProject,
  getBrand,
  getProject,
  getProjectContext,
  listBrands,
  listProjects,
  updateBrand,
  updateProject,
} from "../../services/projects.js";
import { makeFakeDb } from "../helpers/fake-db.js";

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const ctxA = { tenantId: TENANT_A, userId: "user-1" };
const ctxB = { tenantId: TENANT_B, userId: "user-2" };

describe("project service — CRUD", () => {
  it("creates a project scoped to the principal tenant", async () => {
    const db = makeFakeDb();
    const project = await createProject(
      ctxA,
      { name: "Q3 Launch", description: "desc" },
      db as any
    );
    expect(project.tenantId).toBe(TENANT_A);
    expect(project.name).toBe("Q3 Launch");
    expect(project.status).toBe("active");
    expect(project.createdBy).toBe("user-1");
  });

  it("lists and paginates projects for the tenant only", async () => {
    const db = makeFakeDb();
    await createProject(ctxA, { name: "A-1" }, db as any);
    await createProject(ctxA, { name: "A-2" }, db as any);
    await createProject(ctxB, { name: "B-1" }, db as any);

    const { data, pagination } = await listProjects(ctxA, { page: 1, limit: 10 }, db as any);
    expect(data).toHaveLength(2);
    expect(pagination.total).toBe(2);

    const { data: page1 } = await listProjects(ctxA, { page: 1, limit: 1 }, db as any);
    const { data: page2 } = await listProjects(ctxA, { page: 2, limit: 1 }, db as any);
    expect(page1).toHaveLength(1);
    expect(page2).toHaveLength(1);
  });

  it("update and delete are tenant-scoped", async () => {
    const db = makeFakeDb();
    const project = await createProject(ctxA, { name: "before" }, db as any);

    const updated = await updateProject(ctxA, project.id, { name: "after" }, db as any);
    expect(updated.name).toBe("after");

    // Cross-tenant update → 404 (not found in this tenant).
    await expect(updateProject(ctxB, project.id, { name: "x" }, db as any)).rejects.toThrow(
      NotFoundError
    );

    await deleteProject(ctxA, project.id, db as any);
    await expect(getProject(ctxA, project.id, db as any)).rejects.toThrow(NotFoundError);
  });

  it("validates project input (400 VALIDATION)", async () => {
    const db = makeFakeDb();
    await expect(createProject(ctxA, { name: "" }, db as any)).rejects.toThrow(ValidationError);
    await expect(createProject(ctxA, { name: 42 }, db as any)).rejects.toThrow(ValidationError);
  });

  it("persists and updates the full brand context (language, audience, tone, guidelines, business context, references)", async () => {
    const db = makeFakeDb();
    const context = {
      description: "Launch program",
      defaultLanguage: "en-US",
      targetAudience: "Product marketers at Series A startups",
      tone: "confident, warm",
      contentGuidelines: "No superlatives. Cite sources. Max 200 words.",
      businessContext: "SaaS brand; sells analytics for social teams",
      references: [{ type: "style-guide", url: "https://example.com/style", title: "Style guide" }],
    };
    const project = await createProject(ctxA, { name: "P", ...context }, db as any);
    expect(project).toMatchObject(context);
    expect(project.references).toEqual(context.references);

    // Partial update must NOT wipe the other context fields.
    const updated = await updateProject(ctxA, project.id, { tone: "punchy" }, db as any);
    expect(updated.tone).toBe("punchy");
    expect(updated.defaultLanguage).toBe("en-US");
    expect(updated.contentGuidelines).toBe(context.contentGuidelines);

    // Explicit null clears a field; references can be cleared with [].
    const cleared = await updateProject(
      ctxA,
      project.id,
      { defaultLanguage: null, references: [] },
      db as any
    );
    expect(cleared.defaultLanguage).toBeNull();
    expect(cleared.references).toEqual([]);
  });
});

describe("brand service — project scoping + tenant isolation", () => {
  it("creates and reads brands under a project", async () => {
    const db = makeFakeDb();
    const project = await createProject(ctxA, { name: "P" }, db as any);
    const brand = await createBrand(
      ctxA,
      { name: "Nike", voice: "bold" },
      { projectId: project.id },
      db as any
    );
    expect(brand.tenantId).toBe(TENANT_A);
    expect(brand.projectId).toBe(project.id);

    const fetched = await getBrand(ctxA, brand.id, { projectId: project.id }, db as any);
    expect(fetched.name).toBe("Nike");

    // Wrong project path → 404 (brand not reachable across projects).
    await expect(
      getBrand(ctxA, brand.id, { projectId: "99999999-9999-4999-8999-999999999999" }, db as any)
    ).rejects.toThrow(NotFoundError);
  });

  it("does not expose another tenant's brand (404)", async () => {
    const db = makeFakeDb();
    const project = await createProject(ctxA, { name: "P" }, db as any);
    const brand = await createBrand(
      ctxA,
      { name: "secret-brand" },
      { projectId: project.id },
      db as any
    );

    await expect(getBrand(ctxB, brand.id, {}, db as any)).rejects.toThrow(NotFoundError);
    const { data } = await listBrands(ctxB, { page: 1, limit: 10 }, db as any);
    expect(data).toHaveLength(0);
  });

  it("rejects a brand for a project outside the tenant (400 VALIDATION)", async () => {
    const db = makeFakeDb();
    const projectB = await createProject(ctxB, { name: "other" }, db as any);
    await expect(
      createBrand(ctxA, { name: "x" }, { projectId: projectB.id }, db as any)
    ).rejects.toThrow(NotFoundError);
  });

  it("update/delete brands under a project are scoped", async () => {
    const db = makeFakeDb();
    const project = await createProject(ctxA, { name: "P" }, db as any);
    const brand = await createBrand(ctxA, { name: "b" }, { projectId: project.id }, db as any);

    const updated = await updateBrand(
      ctxA,
      brand.id,
      { voice: "quirky" },
      { projectId: project.id },
      db as any
    );
    expect(updated.voice).toBe("quirky");

    await deleteBrand(ctxA, brand.id, { projectId: project.id }, db as any);
    await expect(getBrand(ctxA, brand.id, { projectId: project.id }, db as any)).rejects.toThrow(
      NotFoundError
    );
  });

  it("brands carry the brand context columns (defaultLanguage, audience, guidelines, business context, references)", async () => {
    const db = makeFakeDb();
    const project = await createProject(ctxA, { name: "P" }, db as any);
    const brand = await createBrand(
      ctxA,
      {
        name: "Acme",
        voice: "bold",
        defaultLanguage: "de",
        targetAudience: "German-speaking SMBs",
        contentGuidelines: "Humor ok; no emoji",
        businessContext: "B2B tooling",
        references: [
          { type: "brandbook", url: "https://example.com/brandbook", title: "Brandbook" },
        ],
      },
      { projectId: project.id },
      db as any
    );
    expect(brand).toMatchObject({
      voice: "bold",
      defaultLanguage: "de",
      targetAudience: "German-speaking SMBs",
      contentGuidelines: "Humor ok; no emoji",
      businessContext: "B2B tooling",
    });
    expect(brand.references).toHaveLength(1);
  });
});

describe("project context retrieval", () => {
  it("returns project + brands + content summary", async () => {
    const db = makeFakeDb();
    const project = await createProject(ctxA, { name: "P" }, db as any);
    await createBrand(ctxA, { name: "b1" }, { projectId: project.id }, db as any);
    await createBrand(ctxA, { name: "b2" }, { projectId: project.id }, db as any);
    // A brand in another project must NOT leak into this project's context.
    const other = await createProject(ctxA, { name: "Q" }, db as any);
    await createBrand(ctxA, { name: "b-other" }, { projectId: other.id }, db as any);

    const context = await getProjectContext(ctxA, project.id, db as any);
    expect(context.project.name).toBe("P");
    expect(context.brands).toHaveLength(2);
    expect(context.content.total).toBe(0);
    expect(context.content.byStatus).toEqual({});
  });

  it("rejects context retrieval across tenants (404)", async () => {
    const db = makeFakeDb();
    const project = await createProject(ctxA, { name: "P" }, db as any);
    await expect(getProjectContext(ctxB, project.id, db as any)).rejects.toThrow(NotFoundError);
  });
});
