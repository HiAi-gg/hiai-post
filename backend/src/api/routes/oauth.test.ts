/**
 * Tests for the OAuth callback routes.
 *
 * Provider callbacks arrive as a plain browser redirect — no
 * `Authorization: Bearer` and no `X-Tenant-Id` header. The callback must be
 * reachable in that shape while still validating the signed one-time state
 * and deriving tenant/user identity from it (not from request headers).
 *
 * Run with: npx vitest run src/api/routes/oauth.test.ts
 */

import { Elysia } from "elysia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();

vi.mock("../../lib/config.js", () => ({
  config: {
    BETTER_AUTH_URL: "http://localhost:50300",
    BETTER_AUTH_SECRET: "x".repeat(48),
    OAUTH_STATE_SECRET: "a".repeat(48),
    TOKEN_ENCRYPTION_KEY: "b".repeat(64),
    INSTAGRAM_APP_ID: "ig-id",
    INSTAGRAM_APP_SECRET: "ig-secret",
    META_APP_ID: "meta-id",
    META_APP_SECRET: "meta-secret",
    X_CLIENT_ID: "x-id",
    X_CLIENT_SECRET: "x-secret",
    LINKEDIN_CLIENT_ID: "li-id",
    LINKEDIN_CLIENT_SECRET: "li-secret",
    TIKTOK_CLIENT_KEY: "tt-key",
    TIKTOK_CLIENT_SECRET: "tt-secret",
    THREADS_APP_ID: "",
    THREADS_APP_SECRET: "",
    PINTEREST_APP_ID: "pin-id",
    PINTEREST_APP_SECRET: "pin-secret",
    YOUTUBE_CLIENT_ID: "yt-id",
    YOUTUBE_CLIENT_SECRET: "yt-secret",
  },
  getConfig: () => ({
    BETTER_AUTH_URL: "http://localhost:50300",
    BETTER_AUTH_SECRET: "x".repeat(48),
    NODE_ENV: "test",
  }),
}));

vi.mock("../../lib/logger.js", () => {
  const childLogger = {
    warn: () => {},
    error: () => {},
    info: () => {},
    debug: () => {},
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

vi.mock("../../lib/redis.js", () => ({
  redis: {
    setex: async (key: string, _ttl: number, value: string) => {
      store.set(key, value);
    },
    getdel: async (key: string) => {
      const v = store.get(key) ?? null;
      store.delete(key);
      return v;
    },
    incr: async () => 1,
    pexpire: async () => 1,
    pttl: async () => 60000,
  },
  config: { BETTER_AUTH_SECRET: "x".repeat(48) },
  logger: {
    child: () => ({ warn: () => {}, error: () => {}, info: () => {} }),
    warn: () => {},
    error: () => {},
    info: () => {},
  },
}));

vi.mock("../../lib/db.js", () => {
  const returningMock = vi.fn(async () => [{ id: "acct-1", platform: "x", username: "testuser" }]);
  const valuesMock = vi.fn(() => ({ returning: returningMock }));
  const insertMock = vi.fn(() => ({ values: valuesMock }));
  return {
    db: { insert: insertMock },
    checkDbHealth: async () => true,
    withTransaction: async (fn: (tx: any) => Promise<unknown>) => fn({}),
  };
});

vi.mock("../../lib/encryption.js", () => ({
  encryptToken: (token: string) => `enc:${token}`,
  decryptToken: (token: string) => token.replace(/^enc:/, ""),
  encrypt: (plaintext: string) => `enc:${plaintext}`,
  decrypt: (ciphertext: string) => ciphertext.replace(/^enc:/, ""),
}));

import { generateState } from "../../lib/oauth-state.js";
import { oauthCallbackRoutes } from "./oauth.js";

const { db } = await import("../../lib/db.js");

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const tokenExchangeBodies: Array<Record<string, string>> = [];

const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  if (url.includes("/oauth2/token")) {
    const body = Object.fromEntries(new URLSearchParams(String(init?.body ?? "")));
    tokenExchangeBodies.push(body as Record<string, string>);
    return jsonResponse(200, {
      access_token: "x-access-token",
      refresh_token: "x-refresh-token",
      expires_in: 7200,
      scope: "tweet.read tweet.write users.read offline.access",
    });
  }
  if (url.includes("users/me")) {
    return jsonResponse(200, { data: { id: "98765", username: "testuser", name: "Test User" } });
  }
  return jsonResponse(404, { error: "unexpected url" });
});

describe("oauth callback routes (public, state-derived identity)", () => {
  const app = new Elysia().use(oauthCallbackRoutes);

  beforeEach(() => {
    store.clear();
    tokenExchangeBodies.length = 0;
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("accepts a callback with NO Bearer/X-Tenant headers and uses state-derived tenant/user", async () => {
    const { state } = await generateState({
      platform: "x",
      tenantId: "11111111-1111-4111-8111-111111111111",
      userId: "user-state-1",
      pkce: true,
    });

    const res = await app.handle(
      new Request(
        `http://localhost/api/v1/oauth/x/callback?code=the-auth-code&state=${encodeURIComponent(state)}`
      )
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    // Tenant/user came from the signed state, not request headers.
    const inserted = (db.insert as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(inserted).toBeDefined();
    const values = (
      (db.insert as ReturnType<typeof vi.fn>).mock.results[0].value as {
        values: ReturnType<typeof vi.fn>;
      }
    ).values;
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "11111111-1111-4111-8111-111111111111",
        platform: "x",
        accountId: "98765",
        username: "testuser",
        accessTokenEncrypted: "enc:x-access-token",
      })
    );

    // PKCE verifier must be the stored one, not a hardcoded string.
    expect(tokenExchangeBodies).toHaveLength(1);
    expect(tokenExchangeBodies[0].code_verifier).toBeDefined();
    expect(tokenExchangeBodies[0].code_verifier).not.toBe("challenge");
  });

  it("rejects a callback with an invalid state (state validation preserved)", async () => {
    const res = await app.handle(
      new Request("http://localhost/api/v1/oauth/instagram/callback?code=abc&state=forged.state")
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid or expired state parameter");
    expect(tokenExchangeBodies).toHaveLength(0);
  });

  it("rejects a callback whose state platform does not match", async () => {
    const { state } = await generateState({
      platform: "instagram",
      tenantId: "11111111-1111-4111-8111-111111111111",
    });
    const res = await app.handle(
      new Request(
        `http://localhost/api/v1/oauth/x/callback?code=abc&state=${encodeURIComponent(state)}`
      )
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("State platform mismatch");
  });

  it("rejects a callback without an authorization code", async () => {
    const res = await app.handle(
      new Request("http://localhost/api/v1/oauth/x/callback?state=anything")
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Missing authorization code");
  });

  it("rejects an X callback whose state has no stored PKCE verifier", async () => {
    // Legacy flow state (pre-PKCE storage) — no verifier recorded.
    const { state } = await generateState({
      platform: "x",
      tenantId: "11111111-1111-4111-8111-111111111111",
      pkce: false,
    });
    const res = await app.handle(
      new Request(
        `http://localhost/api/v1/oauth/x/callback?code=abc&state=${encodeURIComponent(state)}`
      )
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Missing PKCE verifier");
    expect(tokenExchangeBodies).toHaveLength(0);
  });

  it("rejects a callback whose state has no tenant binding", async () => {
    const { state } = await generateState({ platform: "linkedin" });
    const res = await app.handle(
      new Request(
        `http://localhost/api/v1/oauth/linkedin/callback?code=abc&state=${encodeURIComponent(state)}`
      )
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid or expired state parameter");
  });
});
