/**
 * hiai-kit integration configuration — server-side settings for the peer
 * hiai-kit backend (capability API + carousel jobs).
 *
 * Values come from the central env schema (backend/src/lib/config.ts):
 * `HIAI_KIT_URL`, `HIAI_KIT_TIMEOUT_MS`, `HIAI_KIT_COOKIE`, `HIAI_KIT_TOKEN`.
 * The cookie/token are OPTIONAL credentials forwarded to hiai-kit as the
 * `Cookie` / `Authorization: Bearer` headers. They are never logged — use
 * `hiaiKitConfigSummary` for any log output.
 */
import { getConfig } from "../../lib/config.js";

export interface HiaiKitClientConfig {
  /** Base URL of the hiai-kit backend, no trailing slash. */
  url: string;
  /** Per-request timeout in ms (AbortSignal.timeout). */
  timeoutMs: number;
  /** Server-side session cookie value, forwarded as the `Cookie` header. */
  cookie?: string;
  /** Bearer token, forwarded as the `Authorization: Bearer …` header. */
  token?: string;
}

export function hiaiKitConfig(): HiaiKitClientConfig {
  const cfg = getConfig();
  return {
    url: cfg.HIAI_KIT_URL.replace(/\/+$/, ""),
    timeoutMs: cfg.HIAI_KIT_TIMEOUT_MS,
    cookie: cfg.HIAI_KIT_COOKIE || undefined,
    token: cfg.HIAI_KIT_TOKEN || undefined,
  };
}

/** Log-safe projection — never includes the cookie or token values. */
export function hiaiKitConfigSummary(config: HiaiKitClientConfig): {
  url: string;
  timeoutMs: number;
  hasCookie: boolean;
  hasToken: boolean;
} {
  return {
    url: config.url,
    timeoutMs: config.timeoutMs,
    hasCookie: Boolean(config.cookie),
    hasToken: Boolean(config.token),
  };
}
