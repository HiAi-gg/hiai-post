import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

/**
 * SSR proxy for backend data API endpoints.
 *
 * Page server load functions call `fetch('/api/v1/...')` which SvelteKit
 * resolves against the frontend origin. Without this proxy the fetch
 * returns 404 and the page renders as 500.
 *
 * Forward the request to the hiai-post API backend so cookies and headers
 * pass through, then pipe the response back. Mirrors the auth proxy at
 * `src/routes/api/auth/[...path]/+server.ts`.
 */
const API_BASE = process.env.API_URL || "http://localhost:50300";

function buildHeaders(request: Request): Headers {
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  headers.delete("host");
  return headers;
}

async function proxy(request: Request, params: { path?: string }): Promise<Response> {
  const path = params.path ?? "";
  const url = new URL(request.url);
  const targetUrl = `${API_BASE}/api/v1/${path}${url.search}`;

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
    console.error("[api/v1 proxy] upstream unreachable:", error);
    return json({ error: "Failed to proxy API request" }, { status: 502 });
  }
}

export const GET: RequestHandler = async ({ request, params }) => proxy(request, params);
export const POST: RequestHandler = async ({ request, params }) => proxy(request, params);
export const PUT: RequestHandler = async ({ request, params }) => proxy(request, params);
export const PATCH: RequestHandler = async ({ request, params }) => proxy(request, params);
export const DELETE: RequestHandler = async ({ request, params }) => proxy(request, params);
export const OPTIONS: RequestHandler = async ({ request, params }) => proxy(request, params);
