/**
 * Postiz integration configuration — publication-intent boundary settings.
 *
 * Values come from the central env schema (backend/src/lib/config.ts):
 * `POSTIZ_API_URL`, `POSTIZ_API_KEY`, `POSTIZ_TIMEOUT_MS`. The API key is an
 * OPTIONAL credential; without URL + key the client reports `NOT_CONFIGURED`
 * and never fabricates a live result. The key is never logged — use
 * `postizConfigSummary` for any log output.
 */
import { getConfig } from "../../lib/config.js";

export interface PostizConfig {
  /** Base URL of the Postiz deployment, no trailing slash. Empty when unset. */
  url: string;
  /** Postiz API key (Bearer). Empty when unset. */
  apiKey: string;
  /** Per-request timeout in ms (AbortSignal.timeout). */
  timeoutMs: number;
  /** True only when URL + API key are both configured. */
  enabled: boolean;
}

export function postizConfig(): PostizConfig {
  const cfg = getConfig();
  const url = cfg.POSTIZ_API_URL.replace(/\/+$/, "");
  const apiKey = cfg.POSTIZ_API_KEY || "";
  return {
    url,
    apiKey,
    timeoutMs: cfg.POSTIZ_TIMEOUT_MS,
    enabled: Boolean(url && apiKey),
  };
}

/** Log-safe projection — never includes the API key value. */
export function postizConfigSummary(config: PostizConfig): {
  url: string;
  timeoutMs: number;
  enabled: boolean;
  hasApiKey: boolean;
} {
  return {
    url: config.url,
    timeoutMs: config.timeoutMs,
    enabled: config.enabled,
    hasApiKey: Boolean(config.apiKey),
  };
}
