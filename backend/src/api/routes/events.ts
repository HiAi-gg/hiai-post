import { Elysia } from "elysia";
import { logger } from "../../lib/logger.js";

interface SSEClient {
  id: string;
  controller: ReadableStreamDefaultController;
  tenantId?: string;
  lastHeartbeat: number;
}

const clients = new Map<string, SSEClient>();
const HEARTBEAT_INTERVAL = 30_000; // 30 seconds
const CLIENT_TIMEOUT = 90_000; // 90 seconds without heartbeat response

/**
 * Broadcast an event to all SSE clients for a given tenant.
 */
export function broadcastEvent(tenantId: string, event: string, data: unknown): void {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  const encoder = new TextEncoder();
  const encoded = encoder.encode(message);

  for (const [, client] of clients) {
    if (client.tenantId && client.tenantId !== tenantId) continue;
    try {
      client.controller.enqueue(encoded);
    } catch {
      clients.delete(client.id);
    }
  }
}

/**
 * Send heartbeat to all connected clients and clean up stale ones.
 */
function sendHeartbeats(): void {
  const now = Date.now();
  const encoder = new TextEncoder();
  const heartbeat = encoder.encode(`: heartbeat\n\n`);

  for (const [id, client] of clients) {
    if (now - client.lastHeartbeat > CLIENT_TIMEOUT) {
      try {
        client.controller.close();
      } catch {
        /* already closed */
      }
      clients.delete(id);
      logger.debug({ clientId: id }, "SSE client timed out");
      continue;
    }
    try {
      client.controller.enqueue(heartbeat);
      client.lastHeartbeat = now;
    } catch {
      clients.delete(id);
    }
  }
}

// Start heartbeat interval
const heartbeatTimer = setInterval(sendHeartbeats, HEARTBEAT_INTERVAL);

// Clean up on module unload (best effort)
if (typeof process !== "undefined") {
  process.on("beforeExit", () => clearInterval(heartbeatTimer));
}

/**
 * SSE event stream routes.
 */
export function eventRoutes() {
  return (
    new Elysia({ prefix: "/api/v1" })
      .get("/events", ({ query }) => {
        const tenantId = (query as Record<string, string>).tenantId as string | undefined;
        const clientId = crypto.randomUUID();

        const stream = new ReadableStream({
          start(controller) {
            const encoder = new TextEncoder();

            // Send initial connection event
            controller.enqueue(
              encoder.encode(
                `event: connected\ndata: ${JSON.stringify({ clientId, timestamp: new Date().toISOString() })}\n\n`
              )
            );

            clients.set(clientId, {
              id: clientId,
              controller,
              tenantId,
              lastHeartbeat: Date.now(),
            });

            logger.info({ clientId, tenantId }, "SSE client connected");
          },
          cancel() {
            clients.delete(clientId);
            logger.info({ clientId }, "SSE client disconnected");
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
          },
        });
      })

      // Stats endpoint for debugging
      .get("/events/stats", () => {
        return {
          connectedClients: clients.size,
          clients: Array.from(clients.values()).map((c) => ({
            id: c.id,
            tenantId: c.tenantId,
            connectedFor: `${Math.round((Date.now() - c.lastHeartbeat) / 1000)}s ago (last heartbeat)`,
          })),
        };
      })
  );
}
