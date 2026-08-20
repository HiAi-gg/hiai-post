/**
 * JSON-RPC 2.0 (MCP transport) envelope helpers.
 *
 * The MCP endpoint speaks JSON-RPC 2.0 over HTTP (POST /api/v1/mcp) with
 * these conventions:
 *   - results are `{ jsonrpc: "2.0", id, result }`;
 *   - protocol errors are `{ jsonrpc: "2.0", id, error: { code, message, data? } }`
 *     with the standard JSON-RPC codes (-32700 parse, -32600 invalid request,
 *     -32601 method not found, -32602 invalid params, -32000 server error);
 *   - notifications (no `id`, e.g. `notifications/initialized`) return
 *     HTTP 202 with an empty body.
 *
 * Tool execution failures are NOT protocol errors: MCP servers return them
 * as a tool result with `isError: true` so the calling model can read the
 * failure. Each request/tool call carries a `correlationId` for tracing.
 */

/** MCP protocol version this server implements and negotiates with. */
export const MCP_PROTOCOL_VERSION = "2024-11-05";

/** MCP `initialize` server info. */
export const MCP_SERVER_INFO = { name: "hiai-post-mcp", version: "1.0.0" } as const;

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcRequest {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

/** Returns `true` for non-null plain objects (JSON-RPC params/result shapes). */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function resultEnvelope(id: unknown, result: unknown): Record<string, unknown> {
  return { jsonrpc: "2.0", id, result };
}

export function errorEnvelope(
  id: unknown,
  code: number,
  message: string,
  data?: unknown
): Record<string, unknown> {
  const error: JsonRpcError = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: "2.0", id, error };
}

/** Standard JSON-RPC error codes (spec section 5.1). */
export const JsonRpcErrorCode = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  SERVER_ERROR: -32000,
} as const;

export type JsonRpcErrorCode = (typeof JsonRpcErrorCode)[keyof typeof JsonRpcErrorCode];
