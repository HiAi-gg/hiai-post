import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

/**
 * SSR proxy for Better Auth endpoints.
 *
 * The SvelteKit server-side `fetch('/api/auth/session')` in
 * `src/routes/+layout.server.ts` resolves the relative URL against the
 * frontend origin (this Node server, port 3000 in the container) — which
 * has no `/api/auth/*` route. Without this proxy the SSR call throws
 * `Unable to connect` and the page renders as 500.
 *
 * We forward the request to the hiai-post API backend so cookies and
 * session state stay server-to-server, then pipe the response back. Mirrors
 * the hiai-docs pattern (see projects/hiai-docs/frontend/src/routes/api/[...path]/+server.ts).
 */
const API_BASE = process.env.API_URL || "http://localhost:50300";

function buildHeaders(request: Request): Headers {
  // Copy all request headers so cookies / content-type / x-tenant-id pass through.
  const headers = new Headers(request.headers);
  // Strip hop-by-hop / length headers — fetch will recompute.
  headers.delete("content-length");
  headers.delete("host");
  return headers;
}

async function proxy(request: Request, params: { path?: string }): Promise<Response> {
  const path = params.path ?? "";
  const url = new URL(request.url);
  const targetUrl = `${API_BASE}/api/auth/${path}${url.search}`;

  const headers = buildHeaders(request);

  const init: RequestInit = {
    method: request.method,
    headers,
    credentials: "include",
  };

  if (
    request.method === "POST" ||
    request.method === "PUT" ||
    request.method === "PATCH" ||
    request.method === "DELETE"
  ) {
    // Forward raw bytes — request.text() would UTF-8-decode and corrupt
    // any future binary payloads. JSON bodies are unaffected by this path.
    const body = await request.arrayBuffer();
    if (body.byteLength > 0) {
      init.body = body;
    }
  }

  try {
    const response = await fetch(targetUrl, init);
    const data = await response.arrayBuffer();

    const responseHeaders = new Headers();
    responseHeaders.set("content-type", response.headers.get("content-type") || "application/json");
    const cacheControl = response.headers.get("cache-control");
    if (cacheControl) {
      responseHeaders.set("cache-control", cacheControl);
    }

    // Pass through set-cookie so Better Auth's session cookie is preserved
    // on the frontend origin (browser cookie scoping).
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() === "set-cookie") {
        responseHeaders.append(key, value);
      }
    });

    return new Response(data, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error("[api/auth proxy] upstream unreachable:", error);
    return json({ error: "Failed to proxy auth request" }, { status: 502 });
  }
}

export const GET: RequestHandler = async ({ request, params }) => proxy(request, params);

export const POST: RequestHandler = async ({ request, params }) => proxy(request, params);

export const PUT: RequestHandler = async ({ request, params }) => proxy(request, params);

export const PATCH: RequestHandler = async ({ request, params }) => proxy(request, params);

export const DELETE: RequestHandler = async ({ request, params }) => proxy(request, params);

export const OPTIONS: RequestHandler = async ({ request, params }) => proxy(request, params);
