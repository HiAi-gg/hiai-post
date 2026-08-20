/**
 * MCP endpoint — POST /api/v1/mcp
 *
 * A thin JSON-RPC 2.0 transport exposing the hiai-post Work API to ChatGPT /
 * any MCP client. Implements `initialize`, `tools/list` and `tools/call`
 * (plus the `notifications/initialized` ping). Tool handlers invoke the
 * EXISTING application services directly (writer, carousels, content,
 * approval) with runtime input validation and normalized errors — no agent
 * internals are reachable.
 *
 * Auth: mounted inside the protected app, so the real auth → tenant →
 * audit chain applies. A LOCAL guard additionally requires a MACHINE
 * principal (Bearer `hpk_<key>` or admin JWT) — browser session tokens are
 * rejected (they belong on the interactive API). Tenant scope is the key's
 * own tenant (`ctx.tenantId`); the client cannot influence it.
 *
 * Protocol conventions (see api/mcp/jsonrpc.ts):
 *   - results   → HTTP 200 `{ jsonrpc: "2.0", id, result }`
 *   - protocol  → HTTP 200 `{ jsonrpc: "2.0", id, error: { code, message, data } }`
 *     errors        (parse errors → HTTP 400)
 *   - tool failures → HTTP 200 tool result with `isError: true` (MCP spec)
 *   - notifications → HTTP 202 empty body
 *   - every tool call carries a `correlationId` in `_meta` / error data.
 */
import { randomUUID } from "node:crypto";
import { Elysia } from "elysia";
import { isHiaiKitError } from "../../integrations/hiai-kit/index.js";
import { observeCall, observeEvent } from "../../lib/observe.js";
import { hasScope } from "../../services/apiKeys.js";
import { DomainError } from "../../services/errors.js";
import type { ServiceContext } from "../../services/types.js";
import {
  errorEnvelope,
  isPlainObject,
  JsonRpcErrorCode,
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_INFO,
  resultEnvelope,
} from "../mcp/jsonrpc.js";
import { findTool, MCP_TOOLS } from "../mcp/tools.js";
import { authGuard } from "../middleware/auth.js";
import { createRateLimiter } from "../middleware/rateLimiter.js";
import { tenantGuard } from "../middleware/tenant.js";

/** Only machine principals (hpk_ API keys / admin JWT) may use the MCP surface. */
function requireMachinePrincipal(ctx: any) {
  const source = ctx.auth?.source;
  if (source === "api-key" || source === "admin-jwt") return;
  ctx.set.status = 401;
  return {
    error: "Machine credential required (Bearer hpk_ API key or admin JWT)",
    code: "MACHINE_AUTH_REQUIRED",
  };
}

interface NormalizedToolError {
  error: string;
  code: string;
  message?: string;
  status?: number;
  details?: unknown;
  correlationId?: string;
}

/** Normalize a thrown value for an MCP `isError` tool result. */
function toToolErrorPayload(err: unknown, correlationId: string): NormalizedToolError {
  if (err instanceof DomainError) {
    return {
      error: err.message,
      code: err.code,
      status: err.status,
      ...(err.details !== undefined ? { details: err.details } : {}),
      correlationId,
    };
  }
  if (isHiaiKitError(err)) {
    return {
      error: err.code,
      message: err.message,
      code: err.code,
      status: err.status,
      correlationId: err.correlationId ?? correlationId,
    };
  }
  return { error: "Internal server error", code: "INTERNAL", correlationId };
}

interface ToolCallParams {
  name?: unknown;
  arguments?: unknown;
}

/** tools/call — dispatch to the registry, enforcing the key's scopes. */
async function callTool(
  params: ToolCallParams,
  principal: { tenantId: string; userId: string; scopes?: string[] }
): Promise<unknown> {
  if (typeof params.name !== "string" || !isPlainObject(params.arguments ?? {})) {
    throw Object.assign(new Error("Invalid params: tool name and arguments object are required"), {
      jsonRpcError: JsonRpcErrorCode.INVALID_PARAMS,
    });
  }
  const tool = findTool(params.name);
  if (!tool) {
    throw Object.assign(new Error(`Unknown tool: ${params.name}`), {
      jsonRpcError: JsonRpcErrorCode.INVALID_PARAMS,
    });
  }

  const correlationId = randomUUID();
  const ctx: ServiceContext = { tenantId: principal.tenantId, userId: principal.userId };

  if (!hasScope(principal.scopes, tool.requiredScope)) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              error: "This API key is not authorized to call this tool",
              code: "INSUFFICIENT_SCOPE",
              requiredScope: tool.requiredScope,
              correlationId,
            },
            null,
            2
          ),
        },
      ],
      isError: true,
      _meta: { correlationId },
    };
  }

  // Runtime input validation BEFORE dispatch — deterministic 400-style
  // VALIDATION errors regardless of the persistence backend.
  const args: Record<string, unknown> = (params.arguments ?? {}) as Record<string, unknown>;
  const validated = tool.argsSchema.safeParse(args);
  if (!validated.success) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              error: "Validation failed",
              code: "VALIDATION",
              details: validated.error?.flatten?.() ?? undefined,
              correlationId,
            },
            null,
            2
          ),
        },
      ],
      isError: true,
      _meta: { correlationId },
    };
  }

  try {
    const payload = await observeCall(
      {
        kind: "mcp",
        operation: `mcp.tools.call:${tool.name}`,
        correlationId,
        tenantId: principal.tenantId,
        userId: principal.userId,
        metadata: { tool: tool.name, requiredScope: tool.requiredScope },
      },
      () => tool.run(ctx, (validated.data ?? args) as Record<string, unknown>)
    );
    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      structuredContent: payload,
      _meta: { correlationId },
    };
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(toToolErrorPayload(err, correlationId), null, 2),
        },
      ],
      isError: true,
      _meta: { correlationId },
    };
  }
}

async function handleMcpRequest(ctx: any): Promise<unknown> {
  // The route is registered with `parse: "none"` so Elysia does NOT consume
  // the body stream; reading the raw text here lets us produce protocol-valid
  // JSON-RPC parse errors instead of Elysia's generic VALIDATION error.
  const request = ctx.request as Request;
  const raw = await request.text();

  let parsed: unknown;
  try {
    parsed = raw.length > 0 ? JSON.parse(raw) : undefined;
  } catch {
    ctx.set.status = 400;
    return errorEnvelope(null, JsonRpcErrorCode.PARSE_ERROR, "Parse error");
  }

  if (!isPlainObject(parsed)) {
    ctx.set.status = 400;
    return errorEnvelope(null, JsonRpcErrorCode.INVALID_REQUEST, "Invalid Request");
  }
  const { jsonrpc, id, method, params } = parsed as {
    jsonrpc?: unknown;
    id?: unknown;
    method?: unknown;
    params?: unknown;
  };
  if (jsonrpc !== "2.0" || typeof method !== "string") {
    ctx.set.status = 400;
    return errorEnvelope(id ?? null, JsonRpcErrorCode.INVALID_REQUEST, "Invalid Request");
  }

  // Notifications (no `id`): acknowledge without a body (JSON-RPC + MCP).
  if (id === undefined) {
    return new Response(null, {
      status: 202,
      headers: { "content-type": "application/json" },
    });
  }

  const principal = {
    tenantId: ctx.tenantId as string,
    userId: (ctx.userId ?? ctx.user?.id) as string,
    scopes: (ctx.auth?.apiKey?.scopes ?? undefined) as string[] | undefined,
  };

  // ── Observability ─────────────────────────────────────────────────────────
  // One request-level event per RPC (start + outcome) carrying a correlation
  // id; tool-level start/success/failure is emitted by callTool via
  // observeCall around the tool dispatch. Notifications (no id) are
  // acknowledged above without events. Telemetry is a no-op when
  // HIAI_OBSERVE_* is unset and can never alter the JSON-RPC responses.
  const correlationId = randomUUID();
  const rpcMeta = {
    method,
    id: typeof id === "string" || typeof id === "number" ? String(id) : "null",
  };
  observeEvent({
    kind: "mcp",
    outcome: "start",
    operation: "mcp.request",
    correlationId,
    tenantId: ctx.tenantId,
    userId: principal.userId,
    message: `mcp ${method} started`,
    metadata: rpcMeta,
  });

  let response: unknown;
  let outcome: "success" | "failure" = "success";
  let errorCode: string | undefined;

  try {
    switch (method) {
      case "initialize":
        response = resultEnvelope(id, {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: MCP_SERVER_INFO,
          instructions:
            "hiai-post Work API. Machine auth: Authorization: Bearer hpk_<key>. Tools operate within the tenant that issued the key.",
        });
        break;
      case "tools/list":
        response = resultEnvelope(id, {
          tools: MCP_TOOLS.map(({ name, description, inputSchema }) => ({
            name,
            description,
            inputSchema,
          })),
        });
        break;
      case "tools/call":
        try {
          const result = await callTool((params ?? {}) as ToolCallParams, principal);
          response = resultEnvelope(id, result);
        } catch (err) {
          outcome = "failure";
          errorCode = "JSON_RPC_ERROR";
          const code =
            (err as { jsonRpcError?: number })?.jsonRpcError ?? JsonRpcErrorCode.INVALID_PARAMS;
          response = errorEnvelope(
            id,
            code,
            err instanceof Error ? err.message : "Invalid params",
            {
              correlationId,
            }
          );
        }
        break;
      case "notifications/initialized":
        response = resultEnvelope(id, { acknowledged: true });
        break;
      default:
        outcome = "failure";
        errorCode = "METHOD_NOT_FOUND";
        response = errorEnvelope(id, JsonRpcErrorCode.METHOD_NOT_FOUND, "Method not found", {
          method,
        });
    }
  } catch (err) {
    // Defensive: any unexpected dispatch failure is still a valid JSON-RPC error.
    outcome = "failure";
    errorCode = "INTERNAL";
    response = errorEnvelope(
      id,
      JsonRpcErrorCode.INVALID_PARAMS,
      err instanceof Error ? err.message : "Internal server error",
      { correlationId }
    );
  }

  observeEvent({
    kind: "mcp",
    outcome,
    operation: "mcp.request",
    correlationId,
    tenantId: ctx.tenantId,
    userId: principal.userId,
    status: outcome === "failure" ? 400 : undefined,
    errorCode,
    message: `mcp ${method} ${outcome === "success" ? "succeeded" : "failed"}`,
    metadata: rpcMeta,
  });
  return response;
}

export const mcpRoutes = new Elysia({ prefix: "/api/v1/mcp" })
  .use(createRateLimiter("mcp") as any)
  .onBeforeHandle(authGuard)
  .onBeforeHandle(tenantGuard)
  .onBeforeHandle(requireMachinePrincipal)
  // `parse: "none"` — the handler needs the RAW body to produce protocol-valid
  // JSON-RPC parse errors (Elysia's default JSON parsing would consume the
  // stream and collapse invalid bodies into a generic VALIDATION error).
  .post("/", handleMcpRequest, { parse: "none" });
