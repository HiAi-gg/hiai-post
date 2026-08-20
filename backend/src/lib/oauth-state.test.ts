/**
 * Tests for the OAuth state store (CWE-352 mitigation).
 * Run with: npx vitest run src/lib/oauth-state.test.ts
 */
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();

vi.mock("../lib/config.js", () => ({
  config: { BETTER_AUTH_SECRET: "x".repeat(48) },
  getConfig: () => ({
    BETTER_AUTH_SECRET: "x".repeat(48),
    NODE_ENV: "test",
  }),
}));

vi.mock("../lib/logger.js", () => {
  const childLogger = {
    warn: () => {},
    error: () => {},
    info: () => {},
  };
  const pinoLogger = {
    child: () => childLogger,
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  };
  return {
    logger: pinoLogger,
    getLogger: () => pinoLogger,
  };
});

vi.mock("../lib/redis.js", () => ({
  redis: {
    setex: async (key: string, _ttl: number, value: string) => {
      store.set(key, value);
    },
    getdel: async (key: string) => {
      const v = store.get(key) ?? null;
      store.delete(key);
      return v;
    },
  },
  config: { BETTER_AUTH_SECRET: "x".repeat(48) },
  logger: {
    child: () => ({ warn: () => {}, error: () => {}, info: () => {} }),
    warn: () => {},
    error: () => {},
    info: () => {},
  },
}));

process.env.OAUTH_STATE_SECRET = "a".repeat(48);

const { createPkceChallenge, generateState, validateState } = await import("./oauth-state.js");

describe("oauth-state", () => {
  beforeEach(() => {
    store.clear();
  });

  it("generates a state containing the csrf and platform", async () => {
    const { state, csrf } = await generateState({ platform: "instagram" });
    expect(state).toContain(".");
    expect(csrf.length).toBeGreaterThan(20);
    const dot = state.indexOf(".");
    const payload = JSON.parse(Buffer.from(state.slice(0, dot), "base64url").toString());
    expect(payload.platform).toBe("instagram");
    expect(payload.csrf).toBe(csrf);
    expect(typeof payload.ts).toBe("number");
  });

  it("rejects when state is missing", async () => {
    const result = await validateState(undefined);
    expect(result).toBeNull();
  });

  it("rejects when state is malformed", async () => {
    expect(await validateState("not-a-state")).toBeNull();
    expect(await validateState("only.one.dot.here.too.many")).toBeNull();
    expect(await validateState("")).toBeNull();
  });

  it("rejects when HMAC signature is wrong", async () => {
    const { state } = await generateState({ platform: "x" });
    const tampered = `${state.slice(0, -3)}AAA`;
    expect(await validateState(tampered)).toBeNull();
  });

  it("rejects when state is not in Redis (expired or used)", async () => {
    const { state } = await generateState({ platform: "x" });
    store.clear();
    expect(await validateState(state)).toBeNull();
  });

  it("rejects when csrf was already consumed (one-time use)", async () => {
    const { state } = await generateState({ platform: "linkedin" });
    const first = await validateState(state);
    expect(first?.platform).toBe("linkedin");
    const second = await validateState(state);
    expect(second).toBeNull();
  });

  it("rejects when stored state does not match returned state (tampering)", async () => {
    const { state, csrf } = await generateState({ platform: "tiktok" });
    store.set(`oauth:state:${csrf}`, "garbage.value.here");
    expect(await validateState(state)).toBeNull();
  });

  it("preserves tenantId through round-trip", async () => {
    const { state } = await generateState({ platform: "youtube", tenantId: "tenant-123" });
    const payload = await validateState(state);
    expect(payload?.tenantId).toBe("tenant-123");
    expect(payload?.platform).toBe("youtube");
  });

  it("preserves userId through round-trip", async () => {
    const { state } = await generateState({
      platform: "instagram",
      tenantId: "tenant-123",
      userId: "user-456",
    });
    const payload = await validateState(state);
    expect(payload?.tenantId).toBe("tenant-123");
    expect(payload?.userId).toBe("user-456");
  });

  it("stores a PKCE verifier and returns it on validation (X/Twitter flow)", async () => {
    const { state, csrf, pkceVerifier } = await generateState({
      platform: "x",
      tenantId: "tenant-123",
      pkce: true,
    });
    expect(pkceVerifier).toBeDefined();
    expect(pkceVerifier!.length).toBeGreaterThan(32);

    // Verifier must NOT be embedded in the signed state string itself.
    expect(state).not.toContain(pkceVerifier!);

    // The Redis record is a JSON envelope { state, verifier }.
    const storedRaw = store.get(`oauth:state:${csrf}`);
    expect(storedRaw).toBeDefined();
    const stored = JSON.parse(storedRaw!) as { state: string; verifier?: string };
    expect(stored.state).toBe(state);
    expect(stored.verifier).toBe(pkceVerifier);

    const payload = await validateState(state);
    expect(payload?.platform).toBe("x");
    expect(payload?.pkceVerifier).toBe(pkceVerifier);
  });

  it("does not return a PKCE verifier when the flow did not request one", async () => {
    const { state } = await generateState({ platform: "linkedin", pkce: false });
    const payload = await validateState(state);
    expect(payload?.platform).toBe("linkedin");
    expect(payload?.pkceVerifier).toBeUndefined();
  });

  it("consumes the PKCE verifier one-time together with the state", async () => {
    const { state } = await generateState({ platform: "x", pkce: true });
    const first = await validateState(state);
    expect(first?.pkceVerifier).toBeDefined();
    const second = await validateState(state);
    expect(second).toBeNull();
  });

  it("still accepts a legacy raw-state Redis record (pre-PKCE format)", async () => {
    // Simulate a record written before the { state, verifier } JSON envelope.
    const { state, csrf } = await generateState({ platform: "tiktok" });
    store.set(`oauth:state:${csrf}`, state);
    const payload = await validateState(state);
    expect(payload?.platform).toBe("tiktok");
    expect(payload?.pkceVerifier).toBeUndefined();
  });

  it("rejects a tampered JSON record whose state does not match", async () => {
    const { state, csrf } = await generateState({ platform: "x", pkce: true });
    const forged = JSON.stringify({ state: `${state.slice(0, -3)}AAA`, verifier: "v" });
    store.set(`oauth:state:${csrf}`, forged);
    expect(await validateState(state)).toBeNull();
  });

  it("derives the S256 PKCE challenge per RFC 7636", async () => {
    const verifier = "db8f9c1e-2f6b-4a5d-9c3e-1a2b3c4d5e6f-verifier";
    const expected = createHash("sha256").update(verifier).digest("base64url");
    expect(createPkceChallenge(verifier)).toBe(expected);
    expect(createPkceChallenge(verifier)).not.toBe(verifier);
  });
});
