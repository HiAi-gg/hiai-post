/**
 * Unit tests for the content/revision/approval services (Phase 3 shared
 * product foundation). Run with an in-memory fake db — no module mocks, no
 * database. Covers:
 *   - tenant isolation (cross-tenant rows are 404 NOT_FOUND, lists are empty)
 *   - revisions preserved (append-only; restore copies + appends, never rewrites)
 *   - approval state machine transitions (valid + invalid → 409 INVALID_TRANSITION)
 *   - validation / error envelopes
 *   - hiai-observe instrumentation: content.create + content.<approval action>
 *     start/success/failure events (observeCall wrapper), no-op when unconfigured
 *
 * Run with: npx vitest run src/__tests__/services/content.test.ts
 */
import { afterEach, describe, expect, it, vi } from "vitest";

// Env + module mocks BEFORE the service imports evaluate: services import
// lib/db.js at module scope, which pulls in config.ts → logger.ts; without
// these the config validator calls process.exit(1).
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

import { approveContent, requestChanges, submitForReview } from "../../services/approval.js";
import { createContentItem, getContentItem, listContentItems } from "../../services/content.js";
import {
  ConflictError,
  NotFoundError,
  toErrorEnvelope,
  ValidationError,
} from "../../services/errors.js";
import { createRevision, listRevisions, restoreRevision } from "../../services/revisions.js";
import { makeFakeDb } from "../helpers/fake-db.js";

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROJECT_A = "11111111-1111-4111-8111-111111111111";
const PROJECT_B = "22222222-2222-4222-8222-222222222222";

const ctxA = { tenantId: TENANT_A, userId: "user-1" };
const ctxB = { tenantId: TENANT_B, userId: "user-2" };

describe("content service — create", () => {
  it("creates an item scoped to the principal tenant and snapshots revision #1", async () => {
    const db = makeFakeDb();
    const item = await createContentItem(
      ctxA,
      { title: "Launch post", bodyText: "Hello world" },
      db as any
    );

    expect(item.tenantId).toBe(TENANT_A);
    expect(item.title).toBe("Launch post");
    expect(item.status).toBe("draft");
    expect(item.source).toBe("web"); // default provenance
    expect(item.currentRevisionNumber).toBe(1);

    const revs = await listRevisions(ctxA, item.id, db as any);
    expect(revs).toHaveLength(1);
    expect(revs[0]).toMatchObject({
      contentItemId: item.id,
      tenantId: TENANT_A,
      revisionNumber: 1,
      title: "Launch post",
      bodyText: "Hello world",
    });
  });

  it("records the truthful creation source (web/api/chatgpt/…) on the item", async () => {
    const db = makeFakeDb();
    const item = await createContentItem(ctxA, { title: "Imported", source: "chatgpt" }, db as any);
    expect(item.source).toBe("chatgpt");

    const apiItem = await createContentItem(ctxA, { title: "Api", source: "api" }, db as any);
    expect(apiItem.source).toBe("api");

    // Invalid provenance is rejected (400 VALIDATION).
    await expect(
      createContentItem(ctxA, { title: "bad", source: "not-a-source" }, db as any)
    ).rejects.toThrow(ValidationError);
  });

  it("validates cross-tenant project references (400 VALIDATION)", async () => {
    const db = makeFakeDb();
    // Project B exists in the fake db but belongs to TENANT_B.
    db._tables.projects = [{ id: PROJECT_B, tenantId: TENANT_B, name: "Other" }];

    await expect(
      createContentItem(ctxA, { title: "x", projectId: PROJECT_B }, db as any)
    ).rejects.toThrow(ValidationError);
  });

  it("rejects missing title (400 VALIDATION envelope)", async () => {
    const db = makeFakeDb();
    try {
      await createContentItem(ctxA, { title: "" }, db as any);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      const envelope = toErrorEnvelope(err);
      expect(envelope).toMatchObject({ error: "Validation failed", code: "VALIDATION" });
      expect(envelope.details).toBeDefined();
    }
  });
});

describe("content service — tenant isolation", () => {
  it("returns 404 NOT_FOUND for another tenant's item", async () => {
    const db = makeFakeDb();
    const item = await createContentItem(ctxA, { title: "secret" }, db as any);

    await expect(getContentItem(ctxB, item.id, db as any)).rejects.toThrow(NotFoundError);
  });

  it("lists only the principal tenant's items", async () => {
    const db = makeFakeDb();
    await createContentItem(ctxA, { title: "A1" }, db as any);
    await createContentItem(ctxB, { title: "B1" }, db as any);

    const { data, pagination } = await listContentItems(ctxA, { page: 1, limit: 20 }, db as any);
    expect(data).toHaveLength(1);
    expect(data[0].title).toBe("A1");
    expect(pagination.total).toBe(1);
  });

  it("filters by status and paginates", async () => {
    const db = makeFakeDb();
    await createContentItem(ctxA, { title: "one" }, db as any);
    await createContentItem(ctxA, { title: "two" }, db as any);

    const { data } = await listContentItems(
      ctxA,
      { page: 1, limit: 1, status: "draft" },
      db as any
    );
    expect(data).toHaveLength(1);
    const { data: page2 } = await listContentItems(
      ctxA,
      { page: 2, limit: 1, status: "draft" },
      db as any
    );
    expect(page2).toHaveLength(1);
  });
});

describe("revision service — history preserved", () => {
  it("appends revisions with increasing numbers", async () => {
    const db = makeFakeDb();
    const item = await createContentItem(ctxA, { title: "v1", bodyText: "draft" }, db as any);

    const rev2 = await createRevision(
      ctxA,
      item.id,
      { title: "v2", bodyText: "updated", changeNote: "feedback" },
      db as any
    );
    expect(rev2.revisionNumber).toBe(2);
    expect(rev2.bodyText).toBe("updated");
    expect(rev2.changeNote).toBe("feedback");

    const revs = await listRevisions(ctxA, item.id, db as any);
    expect(revs).toHaveLength(2);
    expect(revs.map((r) => r.revisionNumber)).toEqual([2, 1]);
    // The original revision is untouched.
    expect(revs[1]).toMatchObject({ revisionNumber: 1, bodyText: "draft" });
  });

  it("createRevision advances the item's currentRevisionNumber pointer", async () => {
    const db = makeFakeDb();
    const item = await createContentItem(ctxA, { title: "v1", bodyText: "draft" }, db as any);
    expect(item.currentRevisionNumber).toBe(1);

    await createRevision(ctxA, item.id, { bodyText: "v2 body" }, db as any);
    const after = await getContentItem(ctxA, item.id, db as any);
    expect(after.currentRevisionNumber).toBe(2);

    await createRevision(ctxA, item.id, { bodyText: "v3 body" }, db as any);
    const after2 = await getContentItem(ctxA, item.id, db as any);
    expect(after2.currentRevisionNumber).toBe(3);
  });

  it("restore copies the snapshot onto the item and appends (never rewrites history)", async () => {
    const db = makeFakeDb();
    const item = await createContentItem(ctxA, { title: "v1", bodyText: "original" }, db as any);
    await createRevision(ctxA, item.id, { title: "v2", bodyText: "changed" }, db as any);

    const revsBefore = await listRevisions(ctxA, item.id, db as any);
    expect(revsBefore).toHaveLength(2);

    // Restore revision #1 → item returns to "original", a NEW revision is appended.
    const restored = await restoreRevision(ctxA, item.id, revsBefore[1].id, db as any);
    expect(restored.item).toMatchObject({ title: "v1", bodyText: "original" });
    expect(restored.item.currentRevisionNumber).toBe(3);

    const revsAfter = await listRevisions(ctxA, item.id, db as any);
    expect(revsAfter).toHaveLength(3);
    expect(revsAfter[0]).toMatchObject({ revisionNumber: 3, bodyText: "original" });
    // History is preserved — revisions #1 and #2 are still there, unchanged.
    expect(revsAfter.map((r) => r.revisionNumber)).toEqual([3, 2, 1]);
    expect(revsAfter[2]).toMatchObject({ revisionNumber: 1, bodyText: "original" });
    expect(revsAfter[1]).toMatchObject({ revisionNumber: 2, bodyText: "changed" });
  });

  it("restore is tenant-scoped — another tenant's revision is a 404", async () => {
    const db = makeFakeDb();
    const item = await createContentItem(ctxA, { title: "a" }, db as any);
    const revs = await listRevisions(ctxA, item.id, db as any);

    await expect(restoreRevision(ctxB, item.id, revs[0].id, db as any)).rejects.toThrow(
      NotFoundError
    );
    // History untouched.
    expect(await listRevisions(ctxA, item.id, db as any)).toHaveLength(1);
  });

  it("rejects revision access across tenants (404)", async () => {
    const db = makeFakeDb();
    const item = await createContentItem(ctxA, { title: "a" }, db as any);
    await expect(listRevisions(ctxB, item.id, db as any)).rejects.toThrow(NotFoundError);
  });
});

describe("approval state machine", () => {
  it("draft → in_review → approved", async () => {
    const db = makeFakeDb();
    const item = await createContentItem(ctxA, { title: "post" }, db as any);

    const reviewed = await submitForReview(ctxA, item.id, db as any);
    expect(reviewed.status).toBe("in_review");

    const approved = await approveContent(ctxA, item.id, db as any);
    expect(approved.status).toBe("approved");
  });

  it("in_review → changes_requested → in_review (with note)", async () => {
    const db = makeFakeDb();
    const item = await createContentItem(ctxA, { title: "post" }, db as any);
    await submitForReview(ctxA, item.id, db as any);

    const requested = await requestChanges(ctxA, item.id, "tone down the hype", db as any);
    expect(requested.status).toBe("changes_requested");
    expect(requested.reviewNote).toBe("tone down the hype");

    const resubmitted = await submitForReview(ctxA, item.id, db as any);
    expect(resubmitted.status).toBe("in_review");
  });

  it("rejects invalid transitions with 409 INVALID_TRANSITION", async () => {
    const db = makeFakeDb();
    const item = await createContentItem(ctxA, { title: "post" }, db as any);

    // draft → approve is not allowed.
    await expect(approveContent(ctxA, item.id, db as any)).rejects.toThrow(ConflictError);
    try {
      await approveContent(ctxA, item.id, db as any);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConflictError);
      const envelope = toErrorEnvelope(err);
      expect(envelope).toMatchObject({
        error: "Cannot 'approve' from status 'draft'",
        code: "INVALID_TRANSITION",
      });
    }

    // approved is terminal.
    await submitForReview(ctxA, item.id, db as any);
    await approveContent(ctxA, item.id, db as any);
    await expect(submitForReview(ctxA, item.id, db as any)).rejects.toThrow(ConflictError);
    await expect(approveContent(ctxA, item.id, db as any)).rejects.toThrow(ConflictError);
  });

  it("approval is tenant-scoped (other tenant → 404)", async () => {
    const db = makeFakeDb();
    const item = await createContentItem(ctxA, { title: "post" }, db as any);
    await expect(submitForReview(ctxB, item.id, db as any)).rejects.toThrow(NotFoundError);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// hiai-observe instrumentation (observeCall around content.create + approval)
// ───────────────────────────────────────────────────────────────────────────

/** Parse the OTLP log record of the Nth fetch call into flat key → string attrs. */
function parseObserveAttrs(
  fetchMock: ReturnType<typeof vi.fn>,
  index: number
): Record<string, string> {
  const [calledUrl, init] = fetchMock.mock.calls[index] as [string, RequestInit];
  expect(calledUrl).toContain("/v1/logs");
  const payload = JSON.parse(String(init.body)) as {
    resourceLogs: Array<{ scopeLogs: Array<{ logRecords: Array<Record<string, unknown>> }> }>;
  };
  const record = payload.resourceLogs[0].scopeLogs[0].logRecords[0];
  return Object.fromEntries(
    ((record.attributes ?? []) as Array<{ key: string; value: { stringValue?: string } }>).map(
      (a) => [a.key, a.value.stringValue ?? ""]
    )
  );
}

function configuredObserve() {
  process.env.HIAI_OBSERVE_URL = "http://observe.test:8001";
  process.env.HIAI_OBSERVE_API_KEY = "observe-test-key";
  process.env.HIAI_OBSERVE_PROJECT = "proj-test";
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.HIAI_OBSERVE_URL;
  delete process.env.HIAI_OBSERVE_API_KEY;
  delete process.env.HIAI_OBSERVE_PROJECT;
  delete process.env.HIAI_OBSERVE_TIMEOUT_MS;
});

describe("content observability (hiai-observe)", () => {
  it("emits content.create start + success with sanitized metadata", async () => {
    configuredObserve();
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const db = makeFakeDb();

    const item = await createContentItem(
      ctxA,
      { title: "Launch", bodyText: "hi", source: "chatgpt" },
      db as any
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(item.status).toBe("draft");
    expect(fetchMock).toHaveBeenCalledTimes(2); // start + success only
    const startAttrs = parseObserveAttrs(fetchMock, 0);
    const successAttrs = parseObserveAttrs(fetchMock, 1);
    expect(startAttrs["event.kind"]).toBe("content");
    expect(startAttrs["event.operation"]).toBe("content.create");
    expect(startAttrs["event.outcome"]).toBe("start");
    expect(successAttrs["event.outcome"]).toBe("success");
    expect(successAttrs["metadata.contentItemId"]).toBe(item.id);
    expect(successAttrs["metadata.status"]).toBe("draft");
    expect(successAttrs["metadata.source"]).toBe("chatgpt");
    expect(successAttrs["tenant.id"]).toBe(TENANT_A);
    expect(successAttrs["user.id"]).toBe("user-1");
    // start and success share the correlation id.
    expect(successAttrs["correlation.id"]).toBe(startAttrs["correlation.id"]);
  });

  it("emits content.approve start + success (toStatus metadata)", async () => {
    configuredObserve();
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const db = makeFakeDb();
    const item = await createContentItem(ctxA, { title: "Review me" }, db as any);
    // Force into in_review (draft → approve would be an invalid transition).
    db._tables.content_items = [{ ...item, status: "in_review" }];
    fetchMock.mockClear();

    const approved = await approveContent(ctxA, item.id, db as any);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(approved.status).toBe("approved");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const startAttrs = parseObserveAttrs(fetchMock, 0);
    const successAttrs = parseObserveAttrs(fetchMock, 1);
    expect(startAttrs["event.operation"]).toBe("content.approve");
    expect(startAttrs["metadata.contentItemId"]).toBe(item.id);
    expect(successAttrs["event.outcome"]).toBe("success");
    expect(successAttrs["metadata.toStatus"]).toBe("approved");
  });

  it("emits content.approve start + failure for an invalid transition", async () => {
    configuredObserve();
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const db = makeFakeDb();
    const item = await createContentItem(ctxA, { title: "Draft" }, db as any); // status: draft
    fetchMock.mockClear();

    await expect(approveContent(ctxA, item.id, db as any)).rejects.toThrow(ConflictError);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const failAttrs = parseObserveAttrs(fetchMock, 1);
    expect(failAttrs["event.operation"]).toBe("content.approve");
    expect(failAttrs["event.outcome"]).toBe("failure");
    expect(failAttrs["error.code"]).toBe("INVALID_TRANSITION");
    expect(failAttrs["metadata.contentItemId"]).toBe(item.id);
  });
});
