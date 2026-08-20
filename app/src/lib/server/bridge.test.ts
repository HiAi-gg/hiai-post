import { describe, expect, it } from "vitest";
import {
  type BridgeLocals,
  buildUpstreamHeaders,
  isAuthenticatedRequest,
  resolveTenantId,
  SESSION_COOKIE,
} from "./bridge";

describe("resolveTenantId", () => {
  it("prefers the explicit X-Tenant-Id header", () => {
    expect(
      resolveTenantId(
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222"
      )
    ).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("falls back to the HIAI_TENANT_ID env value", () => {
    expect(resolveTenantId(null, "11111111-1111-4111-8111-111111111111")).toBe(
      "11111111-1111-4111-8111-111111111111"
    );
  });

  it("returns undefined when nothing is configured", () => {
    expect(resolveTenantId(undefined, undefined)).toBeUndefined();
    expect(resolveTenantId("", "")).toBeUndefined();
  });
});

describe("buildUpstreamHeaders", () => {
  const locals: BridgeLocals = {
    sessionToken: "sess-123",
    tenantId: "11111111-1111-4111-8111-111111111111",
  };

  function makeIncoming(): Headers {
    const headers = new Headers();
    headers.set("cookie", `${SESSION_COOKIE}=sess-123`);
    headers.set("content-type", "application/json");
    headers.set("content-length", "42");
    headers.set("host", "localhost:50301");
    headers.set("accept-encoding", "gzip");
    headers.set("connection", "keep-alive");
    return headers;
  }

  it("injects Authorization Bearer + X-Tenant-Id for proxied API calls", () => {
    const headers = buildUpstreamHeaders(makeIncoming(), locals, {
      injectSession: true,
      injectTenant: true,
    });
    expect(headers.get("authorization")).toBe("Bearer sess-123");
    expect(headers.get("x-tenant-id")).toBe(locals.tenantId);
  });

  it("strips hop-by-hop and framing headers", () => {
    const headers = buildUpstreamHeaders(makeIncoming(), locals, {
      injectSession: true,
      injectTenant: true,
    });
    expect(headers.get("content-length")).toBeNull();
    expect(headers.get("host")).toBeNull();
    expect(headers.get("accept-encoding")).toBeNull();
    expect(headers.get("connection")).toBeNull();
    expect(headers.get("cookie")).toBe(`${SESSION_COOKIE}=sess-123`);
    expect(headers.get("content-type")).toBe("application/json");
  });

  it("does not inject auth headers when the session is missing", () => {
    const headers = buildUpstreamHeaders(makeIncoming(), {}, { injectSession: true });
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("x-tenant-id")).toBeNull();
  });

  it("never overrides an existing Authorization header", () => {
    const incoming = makeIncoming();
    incoming.set("authorization", "Bearer admin-jwt");
    const headers = buildUpstreamHeaders(incoming, locals, {
      injectSession: true,
      injectTenant: true,
    });
    expect(headers.get("authorization")).toBe("Bearer admin-jwt");
    expect(headers.get("x-tenant-id")).toBe(locals.tenantId);
  });

  it("keeps tenant injection off for the auth proxy", () => {
    const headers = buildUpstreamHeaders(makeIncoming(), locals);
    expect(headers.get("x-tenant-id")).toBeNull();
    expect(headers.get("authorization")).toBeNull();
  });
});

describe("isAuthenticatedRequest", () => {
  function makeRequest(authorization?: string): Request {
    const headers = new Headers();
    if (authorization !== undefined) headers.set("authorization", authorization);
    return new Request("http://localhost/", { headers });
  }

  it("returns true when locals carry the session token", () => {
    expect(isAuthenticatedRequest(makeRequest(), { sessionToken: "sess-123" })).toBe(true);
  });

  it("returns true when the request has an Authorization header", () => {
    expect(isAuthenticatedRequest(makeRequest("Bearer admin-jwt"), {})).toBe(true);
  });

  it("returns false for anonymous requests", () => {
    expect(isAuthenticatedRequest(makeRequest(), {})).toBe(false);
  });

  it("ignores empty or whitespace-only Authorization headers", () => {
    expect(isAuthenticatedRequest(makeRequest(""), {})).toBe(false);
    expect(isAuthenticatedRequest(makeRequest("   "), {})).toBe(false);
  });
});
