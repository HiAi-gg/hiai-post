import { marked } from "marked";
import auditReport from "../../../../audit-report.md?raw";
import type { PageServerLoad } from "./$types";

/**
 * Renders the canonical `audit-report.md` (monorepo root) as HTML.
 *
 * The markdown is embedded into this module at build time via Vite's `?raw`
 * import — there are no filesystem reads at runtime — and the route is
 * prerendered, so the final HTML is fully generated during `vite build`.
 *
 * SECURITY: `marked` does NOT sanitize HTML by default. That is acceptable
 * here only because the sole input is this trusted, repo-pinned static
 * file; this route never parses user or request data.
 */
export const prerender = true;

export const load: PageServerLoad = () => ({
  html: marked.parse(auditReport, { async: false }),
});
