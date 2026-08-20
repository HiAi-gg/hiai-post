/**
 * Unit tests for the Writer application service (Phase 3 foundation).
 *
 * Runs against the in-memory fake db with the external capability boundary
 * MOCKED (fake hiai-kit capability client + fake local social writer) — no
 * network, no LLM, no mastra. Covers:
 *   - article  → hiai-kit `content.article` path (input mapping, persistence)
 *   - social_post → TEMPORARY local fallback path (explicit adapter boundary)
 *   - tenant isolation (cross-tenant project → 400 VALIDATION; cross-tenant
 *     rewrite target → 404 NOT_FOUND)
 *   - rewrite preserves prior revisions (append-only revision history)
 *   - error normalization (HiaiKitError envelope with correlationId,
 *     local-writer failure → 502 INTERNAL, validation → 400 VALIDATION)
 *
 * Run with: npx vitest run src/__tests__/services/writer.test.ts
 */
import { describe, expect, it, vi } from "vitest";

// Env + module mocks BEFORE service imports evaluate (config validator
// exits on missing env; lib/db + lib/logger are pulled in transitively).
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

import { HiaiKitError } from "../../integrations/hiai-kit/errors.js";
import { NotFoundError, toErrorEnvelope, ValidationError } from "../../services/errors.js";
import { listRevisions } from "../../services/revisions.js";
import {
  generateWriterContent,
  rewriteWriterContent,
  toWriterErrorEnvelope,
} from "../../services/writer.js";
import { makeFakeDb } from "../helpers/fake-db.js";

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROJECT_A = "11111111-1111-4111-8111-111111111111";
const PROJECT_B = "22222222-2222-4222-8222-222222222222";

const ctxA = { tenantId: TENANT_A, userId: "user-1" };
const ctxB = { tenantId: TENANT_B, userId: "user-2" };

function fakeHiaiKit(overrides: Partial<Record<"contentArticle", ReturnType<typeof vi.fn>>> = {}) {
  const contentArticle = vi.fn(async () => ({
    runId: "run-article-1",
    capabilityId: "content.article",
    status: "completed" as const,
    output: {
      intent: "article",
      artifact: { outline: ["Intro", "Body"] },
      formatted: "# Launch announcement\n\nBody copy.",
      generatedAt: new Date().toISOString(),
    },
    artifacts: [],
    sources: [],
    warnings: [],
    errors: [],
  }));
  return { contentArticle: overrides.contentArticle ?? contentArticle };
}

function fakeSocialWriter(
  output: { title?: string; posts?: unknown[] } = {}
): ReturnType<typeof vi.fn> {
  return vi.fn(async () => ({
    title: output.title ?? "Social post",
    bodyText: "[instagram]\nCheck out the launch!\n#launch\n\n---\n\n[x]\nLaunching now!\n#launch",
    bodyJson: {
      variants: [
        { platform: "instagram", content: "Check out the launch!", hashtags: ["#launch"] },
        { platform: "x", content: "Launching now!", hashtags: ["#launch"] },
      ],
    },
    backend: "local:content-generate",
    correlationId: "local-correlation-1",
  }));
}

describe("writer service — generate (article → hiai-kit)", () => {
  it("runs hiai-kit content.article, persists item + revision #1, tenant-scoped", async () => {
    const db = makeFakeDb();
    db._tables.projects = [
      { id: PROJECT_A, tenantId: TENANT_A, name: "Q3", description: "summer" },
    ];
    const hiaiKit = fakeHiaiKit();

    const result = await generateWriterContent(
      ctxA,
      {
        projectId: PROJECT_A,
        contentType: "article",
        topic: "Q3 launch recap",
        tone: "executive",
      },
      { db: db as any, hiaiKit }
    );

    expect(hiaiKit.contentArticle).toHaveBeenCalledWith({
      topic: "Q3 launch recap",
      outcome: "draft",
      tone: "executive",
    });

    expect(result.backend).toBe("hiai-kit:content.article");
    expect(result.correlationId).toBe("run-article-1");
    expect(result.item).toMatchObject({
      tenantId: TENANT_A,
      projectId: PROJECT_A,
      title: "Q3 launch recap",
      bodyText: "# Launch announcement\n\nBody copy.",
    });
    expect(result.item.bodyJson).toMatchObject({
      contentType: "article",
      backend: "hiai-kit:content.article",
      correlationId: "run-article-1",
      intent: "article",
    });
    expect(result.revision).toMatchObject({ revisionNumber: 1, contentItemId: result.item.id });
  });

  it("persists the truthful creation source (default web; override via deps)", async () => {
    const db = makeFakeDb();
    const hiaiKit = fakeHiaiKit();

    // Default: no source passed → "web".
    const web = await generateWriterContent(
      ctxA,
      { contentType: "article", topic: "t" },
      { db: db as any, hiaiKit }
    );
    expect(web.item.source).toBe("web");
    expect(web.item.currentRevisionNumber).toBe(1);

    // MCP / machine surface passes the source explicitly.
    const chatgpt = await generateWriterContent(
      ctxA,
      { contentType: "article", topic: "t" },
      { db: db as any, hiaiKit, source: "chatgpt" }
    );
    expect(chatgpt.item.source).toBe("chatgpt");
  });

  it("maps an unknown tone to the hiai-kit neutral default", async () => {
    const db = makeFakeDb();
    const hiaiKit = fakeHiaiKit();
    await generateWriterContent(
      ctxA,
      { contentType: "article", topic: "t", tone: "funny" },
      { db: db as any, hiaiKit }
    );
    expect(hiaiKit.contentArticle).toHaveBeenCalledWith(
      expect.objectContaining({ tone: "neutral" })
    );
  });

  it("rejects a cross-tenant project reference (400 VALIDATION)", async () => {
    const db = makeFakeDb();
    db._tables.projects = [{ id: PROJECT_B, tenantId: TENANT_B, name: "Other" }];
    await expect(
      generateWriterContent(
        ctxA,
        { contentType: "article", topic: "t", projectId: PROJECT_B },
        { db: db as any, hiaiKit: fakeHiaiKit() }
      )
    ).rejects.toThrow(ValidationError);
  });

  it("normalizes a failed hiai-kit run to a 502 envelope with correlation id", async () => {
    const db = makeFakeDb();
    const hiaiKit = fakeHiaiKit({
      contentArticle: vi.fn(async () => ({
        runId: "run-failed-1",
        capabilityId: "content.article",
        status: "failed" as const,
        output: null,
        artifacts: [],
        sources: [],
        warnings: [],
        errors: [{ code: "provider_config_missing", message: "no model key" }],
      })),
    });

    try {
      await generateWriterContent(
        ctxA,
        { contentType: "article", topic: "t" },
        { db: db as any, hiaiKit }
      );
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(HiaiKitError);
      const mapped = toWriterErrorEnvelope(err)!;
      expect(mapped.status).toBe(502);
      expect(mapped.envelope).toMatchObject({
        error: "HIAI_KIT_ERROR",
        message: expect.stringContaining("no model key"),
        correlationId: "run-failed-1",
      });
    }
  });
});

describe("writer service — generate (social_post → local fallback adapter)", () => {
  it("runs the local writer (temporary fallback) and persists the item", async () => {
    const db = makeFakeDb();
    const socialWriter = fakeSocialWriter();

    const result = await generateWriterContent(
      ctxA,
      {
        contentType: "social_post",
        topic: "Launch day",
        tone: "casual",
        language: "en",
        instruction: "make it punchy",
        context: "Product: hiai-post",
      },
      { db: db as any, socialWriter }
    );

    expect(socialWriter).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: "Launch day",
        tone: "casual",
        language: "en",
        instruction: "make it punchy",
        context: expect.stringContaining("hiai-post"),
      })
    );
    expect(result.backend).toBe("local:content-generate");
    expect(result.correlationId).toBe("local-correlation-1");
    expect(result.item).toMatchObject({
      tenantId: TENANT_A,
      title: "Social post",
      status: "draft",
    });
    expect(result.item.bodyJson).toMatchObject({
      contentType: "social_post",
      backend: "local:content-generate",
    });
    expect(result.revision).toMatchObject({ revisionNumber: 1 });
  });

  it("resolves project context through the existing project service", async () => {
    const db = makeFakeDb();
    db._tables.projects = [
      { id: PROJECT_A, tenantId: TENANT_A, name: "Q3", description: "summer" },
    ];
    const socialWriter = fakeSocialWriter();

    await generateWriterContent(
      ctxA,
      { contentType: "social_post", topic: "t", projectId: PROJECT_A },
      { db: db as any, socialWriter }
    );

    const arg = socialWriter.mock.calls[0][0];
    expect(arg.context).toContain("Q3");
    expect(arg.context).toContain("summer");
  });

  it("normalizes a local writer failure to a 502 INTERNAL envelope", async () => {
    const db = makeFakeDb();
    const socialWriter = vi.fn(async () => {
      throw new Error("model unreachable");
    });

    try {
      await generateWriterContent(
        ctxA,
        { contentType: "social_post", topic: "t" },
        { db: db as any, socialWriter }
      );
      expect.unreachable("should have thrown");
    } catch (err) {
      const mapped = toWriterErrorEnvelope(err)!;
      expect(mapped.status).toBe(502);
      expect(mapped.envelope).toMatchObject({
        code: "INTERNAL",
        error: expect.stringContaining("model unreachable"),
      });
    }
  });
});

describe("writer service — validation", () => {
  it("rejects an invalid body with a 400 VALIDATION envelope + details", async () => {
    const db = makeFakeDb();
    try {
      await generateWriterContent(
        ctxA,
        { contentType: "article", topic: "" },
        { db: db as any, hiaiKit: fakeHiaiKit() }
      );
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      const envelope = toErrorEnvelope(err);
      expect(envelope).toMatchObject({ error: "Validation failed", code: "VALIDATION" });
      expect(envelope.details).toBeDefined();
    }
  });

  it("rejects an unknown content type", async () => {
    const db = makeFakeDb();
    await expect(
      generateWriterContent(ctxA, { contentType: "tiktok", topic: "t" }, { db: db as any })
    ).rejects.toThrow(ValidationError);
  });
});

describe("writer service — rewrite preserves history", () => {
  it("appends a revision (prior revisions preserved) and updates the working copy", async () => {
    const db = makeFakeDb();
    const socialWriter = vi
      .fn()
      .mockResolvedValueOnce({
        title: "First take",
        bodyText: "[instagram]\nv1\n#launch",
        bodyJson: { variants: [{ platform: "instagram", content: "v1", hashtags: ["#launch"] }] },
        backend: "local:content-generate",
        correlationId: "c1",
      })
      .mockResolvedValueOnce({
        title: "Second take",
        bodyText: "[instagram]\nv2\n#launch",
        bodyJson: { variants: [{ platform: "instagram", content: "v2", hashtags: ["#launch"] }] },
        backend: "local:content-generate",
        correlationId: "c2",
      });

    const created = await generateWriterContent(
      ctxA,
      { contentType: "social_post", topic: "First take" },
      { db: db as any, socialWriter }
    );

    const rewritten = await rewriteWriterContent(
      ctxA,
      { contentItemId: created.item.id, instruction: "tighten the hook" },
      { db: db as any, socialWriter }
    );

    expect(rewritten.revision.revisionNumber).toBe(2);
    expect(rewritten.item.title).toBe("Second take");
    expect(rewritten.item.bodyJson.contentType).toBe("social_post");
    expect(rewritten.item.bodyJson.correlationId).toBe("c2");

    const revisions = await listRevisions(ctxA, created.item.id, db as any);
    expect(revisions).toHaveLength(2);
    // History is preserved — revision #1 is untouched.
    expect(revisions.map((r) => r.revisionNumber)).toEqual([2, 1]);
    expect(revisions[1]).toMatchObject({ revisionNumber: 1, title: "First take" });
    expect(rewritten.revision.changeNote).toContain("tighten the hook");
  });

  it("rewrites an article through hiai-kit using the stored content type", async () => {
    const db = makeFakeDb();
    const hiaiKit = fakeHiaiKit();
    const created = await generateWriterContent(
      ctxA,
      { contentType: "article", topic: "Original title" },
      { db: db as any, hiaiKit }
    );

    const rewritten = await rewriteWriterContent(
      ctxA,
      { contentItemId: created.item.id, instruction: "add an FAQ section" },
      { db: db as any, hiaiKit }
    );

    expect(hiaiKit.contentArticle).toHaveBeenCalledWith(
      expect.objectContaining({ topic: "Original title", outcome: "draft" })
    );
    expect(rewritten.backend).toBe("hiai-kit:content.article");
    expect(rewritten.revision.revisionNumber).toBe(2);
  });

  it("returns 404 NOT_FOUND when rewriting another tenant's item", async () => {
    const db = makeFakeDb();
    const socialWriter = fakeSocialWriter();
    const created = await generateWriterContent(
      ctxA,
      { contentType: "social_post", topic: "secret" },
      { db: db as any, socialWriter }
    );

    await expect(
      rewriteWriterContent(
        ctxB,
        { contentItemId: created.item.id, instruction: "steal it" },
        { db: db as any, socialWriter }
      )
    ).rejects.toThrow(NotFoundError);
  });
});
