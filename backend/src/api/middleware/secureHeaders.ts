/**
 * Secure HTTP headers middleware for Elysia (hi-ai post flavor).
 *
 * Mirrors hiai-obsee/middleware/secure-headers.ts with allowances for
 * the SvelteKit frontend embedding media (img-src data: https:) and
 * SSE event streams (connect-src 'self').
 */
import { Elysia } from "elysia";
import { getConfig } from "../../lib/config.js";

const IS_PROD = getConfig().NODE_ENV === "production";

const DEFAULT_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https: blob:",
  "font-src 'self' data:",
  "connect-src 'self' ws: wss:",
  "media-src 'self' https: blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  // In production, upgrade any insecure requests
  ...(IS_PROD ? ["upgrade-insecure-requests"] : []),
].join("; ");

const PERMISSIONS_POLICY = [
  "accelerometer=()",
  "camera=()",
  "geolocation=()",
  "gyroscope=()",
  "magnetometer=()",
  "microphone=()",
  "payment=()",
  "usb=()",
].join(", ");

export const secureHeadersPlugin = new Elysia({ name: "secure-headers" }).onAfterHandle(
  ({ set }) => {
    const h = set.headers as Record<string, string>;

    if (!h["Content-Security-Policy"]) h["Content-Security-Policy"] = DEFAULT_CSP;
    h["X-Content-Type-Options"] = "nosniff";
    h["X-Frame-Options"] = "DENY";
    h["Referrer-Policy"] = "strict-origin-when-cross-origin";
    h["Permissions-Policy"] = PERMISSIONS_POLICY;
    h["Cross-Origin-Opener-Policy"] = "same-origin";
    h["Cross-Origin-Resource-Policy"] = "same-site";
    h["X-Permitted-Cross-Domain-Policies"] = "none";
    h["X-DNS-Prefetch-Control"] = "off";

    if (IS_PROD) {
      h["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains; preload";
    }
  }
);
