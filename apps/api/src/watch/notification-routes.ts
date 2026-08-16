// Observability — notification center routes (roadmap/observability/, WP4.3, D-OB19).
//
//   GET  /api/notifications           (filter unread/severity/date, paged)
//   POST /api/notifications/:id/read
//   POST /api/notifications/read-all
//   GET  /api/notifications/stream    (SSE live push — see notifications.ts's module doc for why this
//                                       is a dedicated app-level stream rather than a piggyback)
//
// Thin: query-string coercion here, validation via the shared zod, then delegate to
// {@link NotificationRepository} / {@link NotificationHub}.

import type { NotificationListQuery, NotificationReadAllResult } from "@mcp-token-footprint/shared";
import { notificationListQuerySchema } from "@mcp-token-footprint/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { NotificationHub, NotificationRepository } from "./notifications.js";

/** Comment-only SSE keepalive (a `:`-prefixed line) — invisible to `EventSource.onmessage`, so the
 *  client never has to filter a synthetic event out of the notification stream (unlike the run stream,
 *  which carries a real `{type:"ping"}` payload for its `Last-Event-ID` resume machinery; this stream
 *  has no resume cursor — the bell always re-fetches its page on open). */
const SSE_HEARTBEAT_MS = 15_000;

export async function registerNotificationRoutes(
  app: FastifyInstance,
  repository: NotificationRepository,
  hub: NotificationHub,
): Promise<void> {
  app.get("/api/notifications", async (request) => {
    const query = parseListQuery(request.query as Record<string, unknown>);
    return repository.list(query);
  });

  // Registered BEFORE `/:id/read` only matters if a literal id could collide with a route segment —
  // it can't here (different path shape), but kept adjacent for readability.
  app.post("/api/notifications/read-all", async (): Promise<NotificationReadAllResult> => {
    const count = repository.markAllRead();
    return { count };
  });

  app.post("/api/notifications/:id/read", async (request) => {
    const { id } = request.params as { id: string };
    return repository.markRead(id);
  });

  app.get("/api/notifications/stream", async (request, reply) => {
    streamNotifications(request, reply, hub);
  });
}

/** Coerce raw (string) query params into the typed shape, then validate — a malformed `severity` or an
 *  out-of-range `limit` is a ZodError -> 400 via the central handler, same as every other route. */
function parseListQuery(query: Record<string, unknown>): NotificationListQuery {
  const raw = {
    unread: query.unread === undefined ? undefined : query.unread === "true",
    severity: typeof query.severity === "string" ? query.severity : undefined,
    since: typeof query.since === "string" ? query.since : undefined,
    until: typeof query.until === "string" ? query.until : undefined,
    limit: query.limit === undefined ? undefined : Number(query.limit),
    offset: query.offset === undefined ? undefined : Number(query.offset),
  };
  return notificationListQuerySchema.parse(raw);
}

/**
 * Live push: attaches a {@link NotificationHub} listener and forwards every notification created after
 * connect as a `data:` SSE frame. No history replay (the bell loads its page via `GET /api/notifications`
 * on open) and no resume cursor — a reconnect just re-attaches and keeps receiving new ones, which is
 * correct here since nothing is lost (the client already has everything up to its last GET). Mirrors the
 * hijack/heartbeat/disconnect-cleanup discipline the run/suite/thread streams use.
 */
function streamNotifications(request: FastifyRequest, reply: FastifyReply, hub: NotificationHub): void {
  reply.hijack();
  reply.raw.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  // Flush the headers NOW — otherwise Node buffers the head until the first body write (up to a full
  // heartbeat interval away) and a connecting client hangs waiting for the response to even start.
  reply.raw.flushHeaders();

  const heartbeat = setInterval(() => {
    if (reply.raw.writableEnded) return;
    reply.raw.write(": ping\n\n");
  }, SSE_HEARTBEAT_MS);

  const unsubscribe = hub.subscribe((notification) => {
    if (reply.raw.writableEnded) return;
    reply.raw.write(`data: ${JSON.stringify(notification)}\n\n`);
  });

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
    if (!reply.raw.writableEnded) reply.raw.end();
  };

  request.raw.on("close", close);
}
