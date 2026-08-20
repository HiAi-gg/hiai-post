/**
 * ChatGPT plugin manifest — served at /.well-known/ai-plugin.json.
 *
 * Honest claim: machine auth (`hpk_<key>` bearer credentials, verified by
 * SHA-256 against tenant-scoped api_keys rows) is implemented and covered by
 * integration tests, so this manifest DOES declare service_http bearer auth
 * and points at the canonical OpenAPI spec (/api/v1/openapi.json) that only
 * describes routes actually mounted in the production composition.
 */
export const aiPluginManifest = {
  schema_version: "v1",
  name_for_human: "hiai-post Work API",
  name_for_model: "hiai_post_work_api",
  description_for_human:
    "Generate and manage AI-written content, carousels, revisions and approvals inside your hiai-post workspace.",
  description_for_model:
    "hiai-post content workspace API. Create an API key in the hiai-post dashboard (Bearer hpk_<key>) to authorize. Tools: writer_generate, writer_rewrite, carousel_generate, carousel_get, carousel_regenerate, carousel_regenerate_slide, carousel_submit_review, carousel_request_changes, carousel_approve, content_get, content_list, content_submit_review, content_request_changes, content_approve, project_list, project_get (over the /api/v1/mcp JSON-RPC endpoint), plus the REST routes in the OpenAPI spec. Everything is scoped to the tenant that issued the key.",
  auth: {
    type: "service_http",
    authorization_type: "bearer",
    verification_tokens: {},
    instructions:
      "Users must create a machine API key in hiai-post (admin → API keys). Credentials look like hpk_<secret>. Send it as `Authorization: Bearer hpk_<secret>`. A key can only access the tenant that issued it.",
  },
  api: { type: "openapi", url: "/api/v1/openapi.json" },
  logo_url: null,
  contact_email: "",
  legal_info_url: "",
} as const;
