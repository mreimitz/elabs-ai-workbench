// Assistant — HTTP routes. WP 0.2 landed Claude sign-in (below); WP 1.1 adds the thread / message /
// SSE-stream / stop surface (the second block). Both share the ONE `registerAssistantRoutes` call in
// `index.ts`.
//
// EXTENSION POINT: `registerAssistantRoutes(app, deps)` takes a `deps` bag. Additions stay ADDITIVE so
// parallel WPs don't clash — WP 1.2 adds only `GET /api/assistant/models` (its own block) and may add
// its own `deps` field. Routes stay THIN: parse with the shared zod schemas, delegate to the
// service/manager; typed errors flow through the central error handler (ZodError → 400).
import {
  assistantAuthCancelSchema,
  assistantAuthCompleteSchema,
  assistantFallbackSchema,
  assistantMessageSchema,
  assistantPermissionDecisionSchema,
  assistantRetrySourceSchema,
  assistantStartersQuerySchema,
  assistantThreadCreateSchema,
  assistantThreadUpdateSchema,
  assistantTokenPasteSchema,
  type AssistantStreamFrame,
  type AssistantWorkspaceFileContent,
  type AssistantWorkspaceFilesResponse,
} from "@mcp-token-footprint/shared";
import type {
  AssistantModelsResponse,
  AssistantStartersResponse,
} from "@mcp-token-footprint/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
// WP R1.3 (D-AS22) — the live-workspace read routes reuse the SAME filesystem plumbing +
// path-traversal discipline the skill-workspace edit-loop tools use (`tools/workspace-tools.ts`);
// `isBinary` is `skills/repository.ts`'s own text/binary heuristic (workspace.ts's own binary check is
// deliberately the SAME definition — see that module's `looksBinary` doc — reused here rather than
// duplicated, exactly like `tools/workspace-tools.ts` already does).
import { isBinary } from "../skills/repository.js";
import type { SubscriptionModelSource } from "../providers/subscription-models.js";
import { httpError } from "../utils/errors.js";
import { deriveStarters, type StarterDeps } from "./starters.js";
import type { AssistantAuthService } from "./auth-service.js";
import type { AssistantSessionManager } from "./session-manager.js";
import { readWorkspaceFile, readWorkspaceTree, workspaceRootFor } from "./workspace.js";

export interface AssistantRouteDeps {
  auth: AssistantAuthService;
  /** WP 1.1 — the session engine (threads, messaging, SSE, lifecycle). */
  sessions: AssistantSessionManager;
  // WP 1.2 — the STATIC `GET /api/assistant/models` fallback roster (env-overridable). Used verbatim
  // when no live resolver is wired; otherwise the resolver's list wins (it internally falls back to the
  // same static roster, so the response is always usable).
  models: string[];
  // roadmap/claude-subscription/ follow-up — the LIVE Claude-subscription roster resolver (the SAME one
  // the provider Model dropdown uses), so the dock's model list MATCHES the picker. Optional so existing
  // callers/tests keep working; absent → the static `models` above.
  subscriptionModels?: SubscriptionModelSource;
  /** WP R1.3 (D-AS13/D-AS22) — same value as `AssistantSessionConfig.assistantDataDir`; the base dir
   *  the live-workspace read routes resolve `workspaceRootFor` under. */
  assistantDataDir: string;
  // WP R3.1 — the data-aware `GET /api/assistant/starters` service's dependency bag (D-AS27/D-AS28).
  starters: StarterDeps;
}

export async function registerAssistantRoutes(
  app: FastifyInstance,
  deps: AssistantRouteDeps,
): Promise<void> {
  registerAuthRoutes(app, deps.auth);
  registerThreadRoutes(app, deps.sessions, deps.assistantDataDir);
  // Model roster (see AssistantRouteDeps.models / .subscriptionModels). Registered here where `deps` is
  // in scope (not inside registerAuthRoutes, whose signature is (app, auth)). Prefers the SAME LIVE
  // resolver the provider Model dropdown uses so the dock MATCHES the picker; the resolver already falls
  // back to the static roster internally, so this branch always yields a usable list. `deps.models` (the
  // env-overridable static list) remains the fallback when no resolver is wired.
  app.get("/api/assistant/models", async (): Promise<AssistantModelsResponse> => {
    if (deps.subscriptionModels) {
      const live = await deps.subscriptionModels.resolve();
      if (live.length > 0) return { models: live.map((model) => model.id) };
    }
    return { models: deps.models };
  });
  // WP R3.1 (D-AS27/D-AS28/D-AS29) — session-starter chips: the surface's base catalog plus
  // rule-based conditionals computed from cheap reads. Read-only, deterministic, no LLM. Route stays
  // THIN: parse the query, delegate to `deriveStarters`.
  app.get("/api/assistant/starters", async (request): Promise<AssistantStartersResponse> => {
    const query = assistantStartersQuerySchema.parse(request.query);
    return deriveStarters(deps.starters, query);
  });
}

// ── WP 0.2 — Claude sign-in (D-AS1/D-AS2/D-AS14). NEVER gated by the auth-configured check below. ──
function registerAuthRoutes(app: FastifyInstance, auth: AssistantAuthService): void {
  // Redacted status: signed-in? token age + expiry signal, fallback pointer. Never the token itself.
  app.get("/api/assistant/auth/status", async () => auth.getStatus());

  // PTY sign-in: start (→ authUrl + flowId) · complete (paste the code) · cancel (kill the flow).
  app.post("/api/assistant/auth/oauth/start", async () => auth.startOauth());

  app.post("/api/assistant/auth/oauth/complete", async (request) => {
    const body = assistantAuthCompleteSchema.parse(request.body);
    return auth.completeOauth(body.flowId, body.code);
  });

  app.post("/api/assistant/auth/oauth/cancel", async (request) => {
    const body = assistantAuthCancelSchema.parse(request.body ?? {});
    return auth.cancelOauth(body.flowId);
  });

  // Manual paste path — a `sk-ant-oat01-…` token pasted by the owner; stored encrypted.
  app.post("/api/assistant/auth/token", async (request) => {
    const body = assistantTokenPasteSchema.parse(request.body);
    return auth.storeToken(body.token);
  });

  // API-key fallback pointer (D-AS14) — references an existing anthropic provider credential, or null.
  app.put("/api/assistant/auth/fallback", async (request) => {
    const body = assistantFallbackSchema.parse(request.body);
    return auth.setFallback(body.providerCredentialId);
  });

  // Sign out — delete the stored credential + fire the (WP 1.1-registered) kill-hook.
  app.delete("/api/assistant/auth", async () => auth.signOut());
}

// ── WP 1.1 — threads, messaging, SSE stream, stop. EVERY route here is gated by `assertConfigured()`:
//    with NO auth source configured (neither a subscription credential nor an API-key fallback), the
//    whole thread surface returns 409 — only the auth routes above stay reachable. ───────────────────
function registerThreadRoutes(
  app: FastifyInstance,
  sessions: AssistantSessionManager,
  assistantDataDir: string,
): void {
  // Create a thread. Body optional (title/model/authSource/entity pin all default).
  app.post("/api/assistant/threads", async (request, reply) => {
    sessions.assertConfigured();
    const input = assistantThreadCreateSchema.parse(request.body ?? {});
    const thread = sessions.createThread(input);
    return reply.code(201).send(thread);
  });

  // List threads, optionally filtered to one pinned entity (D-AS15). `?entityKind=&entityId=` or the
  // compact `?entity=kind:id` — the dock's "threads pinned to the current entity" section.
  app.get("/api/assistant/threads", async (request) => {
    sessions.assertConfigured();
    return sessions.listThreads(parseThreadFilter(request.query));
  });

  // Detail = thread + full persisted replay log. 404 if unknown.
  app.get("/api/assistant/threads/:id", async (request) => {
    sessions.assertConfigured();
    const { id } = request.params as { id: string };
    return sessions.getThreadDetail(id);
  });

  // Update client-writable fields only (title/model/auto-accept — status/session are engine-owned).
  app.patch("/api/assistant/threads/:id", async (request) => {
    sessions.assertConfigured();
    const { id } = request.params as { id: string };
    const update = assistantThreadUpdateSchema.parse(request.body);
    return sessions.updateThread(id, update);
  });

  // Delete a thread (cascades its events). Detaches a live session first (delete-while-streaming race).
  app.delete("/api/assistant/threads/:id", async (request, reply) => {
    sessions.assertConfigured();
    const { id } = request.params as { id: string };
    sessions.deleteThread(id);
    return reply.code(204).send();
  });

  // Send a user message (text + context envelope). Resolves the thread's auth source (D-AS14), ensures a
  // warm session (cap 409 when the max is exceeded), and kicks the turn ASYNC — events surface on the
  // stream. 202 immediately.
  app.post("/api/assistant/threads/:id/messages", async (request, reply) => {
    sessions.assertConfigured();
    const { id } = request.params as { id: string };
    const body = assistantMessageSchema.parse(request.body);
    await sessions.sendMessage(id, body.text, body.envelope);
    return reply.code(202).send({ ok: true });
  });

  // Stop — interrupt the in-flight turn (the session stays warm). Idempotent. 202.
  app.post("/api/assistant/threads/:id/stop", async (request, reply) => {
    sessions.assertConfigured();
    const { id } = request.params as { id: string };
    sessions.stop(id);
    return reply.code(202).send({ ok: true });
  });

  // Decide a pending gated write (WP 2.1) — allow (optionally with owner-edited input) or deny. Resolves
  // the SDK's parked `canUseTool` promise + persists a `permission_decision`. 404 when no matching ask is
  // pending on the thread (already decided / timed out / stopped, or an unknown id). 202 on success.
  app.post("/api/assistant/threads/:id/permission", async (request, reply) => {
    sessions.assertConfigured();
    const { id } = request.params as { id: string };
    const body = assistantPermissionDecisionSchema.parse(request.body);
    sessions.decidePermission(id, body);
    return reply.code(202).send({ ok: true });
  });

  // WP 3.3 (D-AS14) — the ONLY way a thread's authSource ever changes: an explicit owner action after
  // a limit_error, never a silent fallback. 400 if `source` already matches the thread's current one;
  // 409 if the target source isn't configured. Tears down any live session, records a settled
  // `source_switch`, flips `authSource`, and (when the thread has a prior message) re-sends it so the
  // failed turn retries on the new source. Returns the updated thread — the retried turn's events, if
  // any, surface on the SSE stream like any other message.
  app.post("/api/assistant/threads/:id/retry-source", async (request) => {
    sessions.assertConfigured();
    const { id } = request.params as { id: string };
    const body = assistantRetrySourceSchema.parse(request.body);
    return sessions.retrySource(id, body.source);
  });

  // SSE live stream of the thread's frames (durable replay + live). Mirrors the testing `streamRun`
  // template (hijack, SSE head, heartbeat, replay-then-live, idempotent close) — adapted to a long-lived
  // thread that has no terminal status, so the stream stays open until the client disconnects or the
  // thread is deleted.
  app.get("/api/assistant/threads/:id/stream", async (request, reply) => {
    sessions.assertConfigured();
    const { id } = request.params as { id: string };
    // Existence check (404 through the central handler) BEFORE we hijack the socket.
    sessions.getThread(id);
    return streamThread(request, reply, sessions, id);
  });

  // WP R1.3 (D-AS13/D-AS22) — the LIVE (on-disk) skill-workspace read surface: a review-only window
  // onto a skill workspace the agent has open on this thread, straight off the filesystem (never the
  // DB, never a secret — skill files only; see `workspace.ts`'s path-traversal + symlink-escape
  // discipline, reused here unmodified). Both 400 (no open workspace) and 404 (unknown thread / unknown
  // file) come from the underlying helpers' typed `httpError`s and flow through the central handler.
  app.get(
    "/api/assistant/threads/:id/workspace/:skillId/files",
    async (request): Promise<AssistantWorkspaceFilesResponse> => {
      sessions.assertConfigured();
      const { id, skillId } = request.params as { id: string; skillId: string };
      sessions.getThread(id); // 404 if unknown — mirrors the SSE route's existence check
      const root = workspaceRootFor(assistantDataDir, id);
      const tree = readWorkspaceTree(root, skillId); // 400 if this skill has no open workspace
      return {
        skillId,
        files: tree.map((file) => ({
          path: file.path,
          size: file.bytes.byteLength,
          isBinary: isBinary(file.bytes),
        })),
      };
    },
  );

  app.get(
    "/api/assistant/threads/:id/workspace/:skillId/file",
    async (request): Promise<AssistantWorkspaceFileContent> => {
      sessions.assertConfigured();
      const { id, skillId } = request.params as { id: string; skillId: string };
      sessions.getThread(id); // 404 if unknown
      const relPath = requireWorkspacePathQuery(request);
      const root = workspaceRootFor(assistantDataDir, id);
      const file = readWorkspaceFile(root, skillId, relPath); // 400 no open workspace / 404 unknown path
      return isBinary(file.bytes)
        ? { path: file.path, isBinary: true, size: file.bytes.byteLength }
        : { path: file.path, isBinary: false, text: file.bytes.toString("utf8") };
    },
  );
}

/** Validate the required `path` query param on the live-workspace single-file read route (400 if
 *  missing) — mirrors `skills/routes.ts`'s own `requirePathQuery`. */
function requireWorkspacePathQuery(request: FastifyRequest): string {
  const { path } = request.query as { path?: string };
  if (typeof path !== "string" || path.length === 0) {
    throw httpError(400, "Query parameter 'path' is required.");
  }
  return path;
}

/** Heartbeat keeps the SSE connection alive through idle gaps + intermediaries (decision: 15s). */
const SSE_HEARTBEAT_MS = 15_000;

/**
 * Stream a thread's {@link AssistantStreamFrame}s as Server-Sent Events on the raw response.
 *
 * - Writes the SSE head (`text/event-stream` / `no-cache` / `keep-alive`).
 * - Replays the DURABLE persisted log first (all sessions), tracking the `seq` high-water mark.
 * - Attaches a live listener: settled events are deduped by `seq` (drops the replayed overlap + any
 *   buffered gap-fill); transient `assistant_delta` frames are always forwarded (they carry no `seq`).
 * - A 15s `: ping` heartbeat keeps the socket open; the stream stays open across turns (a thread has no
 *   terminal status). It closes on client disconnect OR when the thread is deleted (`onClosed`). Close
 *   is idempotent (heartbeat cleared + unsubscribe run at most once).
 *
 * The persisted replay and the subscribe attach run with NO `await` between them, so no frame is lost
 * or duplicated across the snapshot→live handoff.
 */
async function streamThread(
  request: FastifyRequest,
  reply: FastifyReply,
  sessions: AssistantSessionManager,
  threadId: string,
): Promise<void> {
  writeSseHead(reply);

  await new Promise<void>((resolve) => {
    let settled = false;
    let unsubscribe: (() => void) | undefined;
    let lastSeq = 0;
    const heartbeat = setInterval(() => {
      if (!reply.raw.writableEnded) reply.raw.write(`: ping\n\n`);
    }, SSE_HEARTBEAT_MS);

    const close = () => {
      if (settled) return;
      settled = true;
      clearInterval(heartbeat);
      unsubscribe?.();
      if (!reply.raw.writableEnded) reply.raw.end();
      resolve();
    };

    // 1) Durable replay — persisted settled events across every session of this thread.
    for (const event of sessions.replayEvents(threadId)) {
      writeFrame(reply, event);
      if (typeof event.seq === "number" && event.seq > lastSeq) lastSeq = event.seq;
    }

    // WP 3.1 (Assistant, D-AS8/D-AS16) — an out-of-band marker (a NAMED SSE event, deliberately NOT a
    // member of the `AssistantStreamFrame` union) so the client can tell "everything above was already
    // -settled history" from "everything below just happened live". This is the one thing a
    // `ui_action` event needs to decide whether to auto-navigate (a replayed nav renders as an inert
    // chip; a live one executes instantly) — see `use-assistant-stream.ts`'s `liveSinceSeq`. Still
    // inside the same synchronous block as the replay loop above (no `await` before `subscribe()`
    // below), so this is race-free: nothing can append a NEW event to this thread between the replay
    // snapshot and the live subscribe (Node is single-threaded). Harmless to any client that doesn't
    // listen for it — a plain `EventSource.onmessage` only ever fires for the default "message" event.
    if (!reply.raw.writableEnded) reply.raw.write(`event: replay_complete\ndata: {}\n\n`);

    // 2) Live: dedupe settled events by seq; always forward transient deltas + WP R1.3's transient
    // skill-workspace progress frames (`workspace_opened`/`workspace_file_changed`/`workspace_committed`
    // — see `session-manager.ts`'s `fanWorkspaceFrame`). None of these four carry a `seq` (checked
    // explicitly here — TRANSIENT_FRAME_TYPES — purely for type-narrowing clarity; the plain
    // `writeFrame(reply, frame)` fallthrough below would already forward them at runtime, same as it
    // does for any other no-`seq` frame).
    const onFrame = (frame: AssistantStreamFrame) => {
      if (
        frame.type === "assistant_delta" ||
        frame.type === "workspace_opened" ||
        frame.type === "workspace_file_changed" ||
        frame.type === "workspace_committed"
      ) {
        writeFrame(reply, frame);
        return;
      }
      if (typeof frame.seq === "number") {
        if (frame.seq > lastSeq) {
          lastSeq = frame.seq;
          writeFrame(reply, frame);
        }
        return;
      }
      writeFrame(reply, frame);
    };

    // Subscribe (buffer replay backfills the snapshot→attach window; seq dedup drops the overlap).
    // `onClosed` = close, so deleting the thread ends this stream.
    unsubscribe = sessions.subscribe(threadId, onFrame, close);
    if (settled) return;

    // Client disconnect (browser closed the EventSource): tear down cleanly (no leaked timer/listener).
    request.raw.on("close", close);
  });
}

function writeSseHead(reply: FastifyReply): void {
  // Take over the socket: we own the framing on `reply.raw`, so Fastify must not also try to send.
  reply.hijack();
  reply.raw.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  // Flush the headers NOW so the client's EventSource/fetch connects immediately even for a cold thread
  // with no replay events (otherwise Node buffers the head until the first body write — up to a full
  // heartbeat interval away — and the client hangs waiting to connect).
  reply.raw.flushHeaders();
}

function writeFrame(reply: FastifyReply, frame: AssistantStreamFrame): void {
  if (reply.raw.writableEnded) return;
  reply.raw.write(`data: ${JSON.stringify(frame)}\n\n`);
}

/**
 * Parse the thread-list entity filter. Supports `?entityKind=…&entityId=…` (the repository filter
 * shape) and the compact `?entity=kind:id`. A half-formed pin (only one side) is ignored, matching the
 * "entity pin is a pair" contract.
 */
function parseThreadFilter(query: unknown): { entityKind?: string; entityId?: string } {
  const q = (query ?? {}) as { entity?: string; entityKind?: string; entityId?: string };
  let entityKind = q.entityKind?.trim() || undefined;
  let entityId = q.entityId?.trim() || undefined;
  if (!entityKind && !entityId && typeof q.entity === "string" && q.entity.includes(":")) {
    const [kind, ...rest] = q.entity.split(":");
    const id = rest.join(":").trim();
    if (kind?.trim() && id) {
      entityKind = kind.trim();
      entityId = id;
    }
  }
  return entityKind && entityId ? { entityKind, entityId } : {};
}
