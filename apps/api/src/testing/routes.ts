import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  hasRunQueryParams,
  isSettledRatingState,
  parseRunFilterFromQuery,
  parseRunPagination,
  parseRunSort,
  runAnswerSchema,
  runRerunSchema,
  runStartSchema,
  runTurnSchema,
  scenarioInputSchema,
  testAttachmentInputSchema,
  testInputSchema,
  type RunDetail,
  type RunEvent,
  type RunPinResult,
  type RunStartResponse,
} from "@mcp-token-footprint/shared";
import { httpError } from "../utils/errors.js";
import type { RunManager } from "./run-manager.js";
import { isTerminalStatus } from "./run-manager.js";
import type { RunRepository } from "./run-repository.js";
import type { RunService } from "./run-service.js";
import type { ScenarioService } from "./scenario-service.js";
import { terminalFor } from "./session-terminal.js";
import type { TestService } from "./test-service.js";

/**
 * Testing routes: scenarios + tests (+ attachments) from WP 2.1, and the run control + SSE streaming
 * surface from WP 2.2 (start / stream / turns / stop / history / detail / compare), plus the Unified
 * Sessions (WP1.6) session-lifecycle actions (End session / mark seen). All grouped here so the single
 * `registerTestingRoutes` call in `index.ts` wires the whole feature.
 */
export async function registerTestingRoutes(
  app: FastifyInstance,
  scenarioService: ScenarioService,
  testService: TestService,
  runService: RunService,
  runs: RunRepository,
  runManager: RunManager,
) {
  registerScenarioRoutes(app, scenarioService, runService, runs);
  registerTestRoutes(app, testService, runService, runs);
  registerRunRoutes(app, runService, runs, runManager);
}

/**
 * H-2 — guard a test/scenario delete against a LIVE run. `runs.test_id`/`runs.scenario_id` are
 * `ON DELETE CASCADE`, so deleting the entity mid-run silently deletes the run row (+ steps/events)
 * while the provider/MCP agent loop keeps spending (every later persistence write becomes a swallowed
 * FK-violation no-op). Mirroring the F3 pattern (`DELETE /api/runs/:id`), we detect a live run by
 * cross-checking the DB's `running` rows against the in-memory {@link RunService.isActive} manager — a
 * `running` DB row alone can be a pre-restart orphan, so the manager is the source of truth for "live
 * in THIS process" — and REJECT the delete with a typed 409 (stop the run first). Returns the blocking
 * run id for a clear message; `undefined` means no live run references the entity.
 */
function liveRunFor(
  runs: RunRepository,
  runService: RunService,
  filter: { testId?: string; scenarioId?: string },
): string | undefined {
  for (const summary of runs.listRuns({ ...filter, status: "running" })) {
    if (runService.isActive(summary.id)) return summary.id;
  }
  return undefined;
}

function registerScenarioRoutes(
  app: FastifyInstance,
  scenarios: ScenarioService,
  runService: RunService,
  runs: RunRepository,
) {
  app.get("/api/scenarios", async () => scenarios.list());

  app.post("/api/scenarios", async (request, reply) => {
    const input = scenarioInputSchema.parse(request.body);
    const scenario = scenarios.create(input);
    return reply.code(201).send(scenario);
  });

  app.put("/api/scenarios/:id", async (request) => {
    const { id } = request.params as { id: string };
    const input = scenarioInputSchema.parse(request.body);
    return scenarios.update(id, input);
  });

  app.delete("/api/scenarios/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    // H-2 — refuse while a live run references this scenario (cascade would delete the running run).
    const liveRunId = liveRunFor(runs, runService, { scenarioId: id });
    if (liveRunId) {
      throw httpError(
        409,
        `Cannot delete this environment while run ${liveRunId} is live against it — stop the run first.`,
      );
    }
    scenarios.delete(id);
    return reply.code(204).send();
  });
}

function registerTestRoutes(
  app: FastifyInstance,
  tests: TestService,
  runService: RunService,
  runs: RunRepository,
) {
  app.get("/api/tests", async () => tests.list());

  app.post("/api/tests", async (request, reply) => {
    const input = testInputSchema.parse(request.body);
    const created = tests.create(input);
    return reply.code(201).send(created);
  });

  app.put("/api/tests/:id", async (request) => {
    const { id } = request.params as { id: string };
    const input = testInputSchema.parse(request.body);
    return tests.update(id, input);
  });

  app.delete("/api/tests/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    // H-2 — refuse while a live run references this test (cascade would delete the running run).
    const liveRunId = liveRunFor(runs, runService, { testId: id });
    if (liveRunId) {
      throw httpError(
        409,
        `Cannot delete this test while run ${liveRunId} is live against it — stop the run first.`,
      );
    }
    tests.delete(id);
    return reply.code(204).send();
  });

  // v1 attachment upload is base64-in-JSON, not multipart (no @fastify/multipart — owner-gated
  // new dep; see WP 2.1).
  app.post("/api/tests/:id/attachments", async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = testAttachmentInputSchema.parse(request.body);
    const attachment = tests.addAttachment(id, input);
    return reply.code(201).send(attachment);
  });
}

/**
 * Heartbeat keeps the SSE connection alive through idle gaps + intermediaries (decision: 15s). Sent as
 * a real `{type:"ping"}` {@link RunEvent} (Unified Sessions WP2.1, D-US8 — replacing the old `: ping`
 * comment line) so a client watchdog can parse + recognize it exactly like any other event instead of
 * special-casing a raw SSE comment. `let`, not `const`: {@link setSseHeartbeatMsForTesting} is the ONLY
 * writer, so a test can observe a heartbeat without a real 15s wait — no production code path touches it.
 */
let SSE_HEARTBEAT_MS = 15_000;

/**
 * Test-only seam (Unified Sessions WP2.1): override the SSE heartbeat cadence for the current process
 * and return the previous value so a test's `afterEach`/cleanup can restore it. Never called from
 * production code — every real deployment keeps the true {@link SSE_HEARTBEAT_MS} default.
 */
export function setSseHeartbeatMsForTesting(ms: number): number {
  const previous = SSE_HEARTBEAT_MS;
  SSE_HEARTBEAT_MS = ms;
  return previous;
}

function registerRunRoutes(
  app: FastifyInstance,
  runService: RunService,
  runs: RunRepository,
  runManager: RunManager,
) {
  // Start a run: validate, create the row + kick the engine ASYNC (do NOT await completion), return
  // the run id + the stream URL immediately. Errors during the async run surface as RunEvents / a
  // terminal status on the stream, never as an HTTP 500 on this POST.
  app.post("/api/runs", async (request, reply) => {
    const { testId, scenarioId, mode } = runStartSchema.parse(request.body);
    const handle = runService.start(testId, scenarioId, mode);
    // Swallow the async terminal result here (it's already emitted as events); never let the unawaited
    // promise reject unhandled.
    void handle.done.catch(() => undefined);
    const body: RunStartResponse = {
      runId: handle.runId,
      streamUrl: `/api/runs/${handle.runId}/stream`,
    };
    return reply.code(202).send(body);
  });

  // Observability (planning/Roadmap/RM-17-observability/, WP3.3, D-OB18) — FORK a terminal run into a NEW derived run.
  // Validates (source terminal, not a suite member → 409; a mid-run fork on a kind whose manifest can't
  // seed a prefix → 422; overrides), reconstructs the parent-conversation prefix (pure `fork.ts`), and
  // seeds a new run through the SAME start path with lineage. Returns the derived run id + stream URL
  // (identical to `POST /api/runs`); the async run surfaces as events/a terminal status, never a 500 here.
  app.post("/api/runs/:id/rerun", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = runRerunSchema.parse(request.body ?? {});
    const handle = runService.rerun(id, body);
    void handle.done.catch(() => undefined);
    const responseBody: RunStartResponse = {
      runId: handle.runId,
      streamUrl: `/api/runs/${handle.runId}/stream`,
    };
    return reply.code(202).send(responseBody);
  });

  // History (RunSummary[]) — newest first. Observability (WP1.1, D-OB1): with NO filter/sort/pagination
  // query param this stays byte-identical to today (`runs.listRuns()`); with any of them present it
  // parses the shared RunFilter grammar (canonical `filter=<json>` + ergonomic scalar aliases) plus
  // `sort`/`limit`/`offset` and runs the richer `queryRuns`. A malformed filter/sort surfaces as a 400
  // (RunFilterError.statusCode / ZodError, both mapped by the central handler). WP1.3 (D-OB16): the `q`
  // full-text field is now ENABLED — it composes the FTS5 index into the query (each hit carries a
  // `searchSnippet` + `searchMatchKind`); a `q` that tokenizes to no searchable term returns [].
  app.get("/api/runs", async (request) => {
    const query = (request.query ?? {}) as Record<string, unknown>;
    if (!hasRunQueryParams(query)) return runs.listRuns();
    const filter = parseRunFilterFromQuery(query);
    const sort = parseRunSort(typeof query.sort === "string" ? query.sort : undefined);
    const { limit, offset } = parseRunPagination(query);
    return runs.queryRuns(filter, { sort, limit, offset });
  });

  // Compare rows for one test across scenarios (CompareRow[]; WP 3.8 consumes). `?ids=a,b,c` or
  // repeated `?ids=a&ids=b`. Registered BEFORE `/api/runs/:id` so "compare" isn't captured as an id.
  app.get("/api/runs/compare", async (request) => {
    const ids = parseIds((request.query as { ids?: string | string[] }).ids);
    return runs.compareRuns(ids);
  });

  // SSE live stream of RunEvents (WP 2.2). Implemented on `reply.raw` so we own the wire framing.
  app.get("/api/runs/:id/stream", async (request, reply) => {
    const { id } = request.params as { id: string };
    return streamRun(request, reply, runService, runs, id);
  });

  // Detail (RunDetail; full replay) — 404 if unknown (getRun throws a 404 httpError).
  app.get("/api/runs/:id", async (request) => {
    const { id } = request.params as { id: string };
    return runs.getRun(id);
  });

  // Skills this run loaded (footprint + realized read-only disclosure usage) — powers the run-console
  // Skills panel without pulling the full step/event replay. 404 if the run is unknown.
  app.get("/api/runs/:id/skills", async (request) => {
    const { id } = request.params as { id: string };
    runs.getSummary(id); // 404s if unknown (consistent with the detail route)
    return runs.listRunSkillSummaries(id);
  });

  // Delete a run (cascades to its run_steps + run_events). Returns what was removed so the UI can
  // confirm the cascade. 404 if unknown (repository throws a 404 httpError).
  app.delete("/api/runs/:id", async (request) => {
    const { id } = request.params as { id: string };
    // F3 — if the run is still LIVE, abort its provider/MCP loop + detach it from the manager BEFORE
    // deleting the row. Otherwise the loop keeps spending after the delete and its later terminal
    // events become no-op writes against a row that no longer exists. Sessions still close in the
    // run-service `finally`. A finished/unknown run skips this and deletes as before (404 if unknown).
    if (runService.isActive(id)) runService.detachActiveRun(id);
    return runs.delete(id);
  });

  // Interactive turn — resume the loop (409 if the run isn't awaiting interactive input).
  app.post("/api/runs/:id/turns", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { text } = runTurnSchema.parse(request.body);
    runService.submitTurn(id, text);
    return reply.code(202).send({ ok: true });
  });

  // Answer a live `ask_user` question — resumes the paused tool call (409 if there's no matching open
  // question, or the run isn't a live interactive run).
  app.post("/api/runs/:id/answers", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { questionId, answer } = runAnswerSchema.parse(request.body);
    runService.answerQuestion(id, questionId, answer);
    return reply.code(202).send({ ok: true });
  });

  // Stop — abort the live run; the engine emits a terminal `outcome:"aborted"` + sessions close.
  // Unified Sessions (WP1.6) — mark the stop as OPERATOR-initiated (see `markUserInitiatedStop`)
  // BEFORE aborting, so WP3.3 can later suppress the finish-toast for a deliberate Stop click, exactly
  // like an End session.
  app.post("/api/runs/:id/stop", async (request, reply) => {
    const { id } = request.params as { id: string };
    runManager.markUserInitiatedStop(id);
    runService.stop(id);
    return reply.code(202).send({ ok: true });
  });

  // Unified Sessions (planning/Roadmap/completed/RM-29-unified-sessions/, WP1.6, D-US2) — End session: the operator's explicit
  // "close this interactive session" action. Valid ONLY for a live, non-terminal INTERACTIVE run — a
  // completed/automated/already-ended run 409s.
  //
  // Ordering (D-US1's "Stop ordering", steal-from-cdesktop rule): write the terminal VERDICT before
  // signaling the child, so a still-winding-down loop's own later natural terminal write can never
  // reclassify it. Concretely:
  //   1. `terminalFor("session_ended")` builds the shared triple (status `ended` / outcome `ended` /
  //      code `session_ended`) and `runManager.emit` writes it through the SAME choke point every
  //      other terminal disposition uses — RunRepository's persistence sink finalizes the row AND fans
  //      it out to any live SSE subscriber.
  //   2. `runs.markEnded` SYNCHRONOUSLY stamps `ended_at` too (the manager's persistence dispatch is a
  //      deferred microtask — this is a belt-and-suspenders guarantee, not a race fix).
  //   3. `runService.detachActiveRun` THEN aborts the live loop's provider/MCP call + detaches it from
  //      the manager, so its own eventual natural terminal write (e.g. the engine's pre-`terminalFor`
  //      "aborted" today) becomes a no-op against a manager that no longer knows this run — it can
  //      never overwrite the `ended` verdict just written. The post-terminal review chain (assertions/
  //      grading/rating) still runs to completion in the background exactly as it does for a plain
  //      Stop (detach doesn't touch that continuation) — only its manager-routed LIVE fan-out becomes a
  //      no-op; its direct `rating_state` writes still land, and a later `/stream` on this finished run
  //      already synthesizes the missing settled `rating` event from the row (`writePersistedReplay`).
  app.post("/api/runs/:id/end", async (request, reply) => {
    const { id } = request.params as { id: string };
    const summary = runs.getSummary(id); // 404s if unknown (repository throws)
    if (
      summary.mode !== "interactive" ||
      isTerminalStatus(summary.status) ||
      !runService.isActive(id)
    ) {
      throw httpError(409, "End session is only valid for a live interactive run");
    }
    runManager.markUserInitiatedStop(id);
    const verdict = terminalFor("session_ended");
    runManager.emit(id, {
      type: "status",
      status: verdict.status,
      outcome: verdict.outcome,
      stopReason: "Session ended by operator",
      stopReasonCode: verdict.stopReasonCode,
    });
    runs.markEnded(id);
    runService.detachActiveRun(id);
    return reply.code(202).send({ ok: true });
  });

  // Unified Sessions (WP1.6, D-US1) — mark a run opened/acknowledged by the operator (the needs-
  // attention feed WP3.3 builds). 404s if unknown (`getSummary` throws); idempotent otherwise.
  app.post("/api/runs/:id/seen", async (request, reply) => {
    const { id } = request.params as { id: string };
    runs.getSummary(id);
    runs.markSeen(id);
    return reply.code(202).send({ ok: true });
  });

  // Observability (planning/Roadmap/RM-17-observability/, WP1.6) — retention classes: pin/unpin a run. A pinned run
  // is NEVER a `POST /api/maintenance/prune-runs` victim, regardless of policy. 404s if unknown
  // (`setPinned` throws); idempotent otherwise.
  app.post("/api/runs/:id/pin", async (request): Promise<RunPinResult> => {
    const { id } = request.params as { id: string };
    return runs.setPinned(id, true);
  });
  app.delete("/api/runs/:id/pin", async (request): Promise<RunPinResult> => {
    const { id } = request.params as { id: string };
    return runs.setPinned(id, false);
  });
}

/**
 * Stream a run's {@link RunEvent}s as Server-Sent Events on the raw response.
 *
 * - Writes the SSE head (`text/event-stream` / `no-cache` / `keep-alive`).
 * - Every event carries an `id: <seq>` line ahead of its `data:` line (Unified Sessions WP2.1, D-US8
 *   — see {@link writeEvent}), so a reconnecting client's `Last-Event-ID` header (sent automatically by
 *   the browser's native `EventSource` once it has seen an `id:`, or set explicitly by a manual
 *   reconnect) gives the server a resume cursor. {@link parseLastEventId} reads that header; when
 *   present, only events with `seq > cursor` are (re-)sent — from the in-memory bounded buffer when it
 *   still covers the cursor (no gap between what the client already has and the buffer's oldest event),
 *   otherwise the missing tail is backfilled from the persisted `run_events` log FIRST (`getRun`, the
 *   same existing repository read {@link writePersistedReplay} already uses for a finished run) so the
 *   reconnect is zero-loss AND zero-dupe. A plain connect (no header) is unaffected — the full
 *   buffer/log still replays exactly as before.
 * - LIVE run: replays the manager's bounded buffer in order (so a beat-late subscriber isn't out of
 *   sync) and attaches the live listener; a 15s `{type:"ping"}` event (WP2.1 — replaces the old
 *   comment-based heartbeat) keeps the socket open without ever advancing the resume cursor (it carries
 *   no `seq`); on client disconnect the heartbeat is cleared AND the listener removed (no leaked
 *   emitters). AR11 — the stream stays OPEN through the post-terminal review: it closes only once BOTH
 *   the terminal `status` AND a SETTLED `rating` event (`rated`/`failed`/`skipped`) have been sent, so a
 *   client always sees where the review landed. The run service guarantees a settled rating event after
 *   every terminal status, so no defensive timeout is needed; a subscriber that attaches mid-rating is
 *   backfilled the earlier transitions from the manager's bounded buffer (same replay as steps).
 * - FINISHED run (no active emitter): falls back to replaying the persisted events (WP 1.6 `getRun`),
 *   cursor-filtered the same way, so `/stream` on a completed run still works, then ends — synthesizing
 *   a final `rating` event from the run row when the persisted log lacks a settled one (legacy/
 *   backfilled rows, or a re-rate that moved the row after the log settled), so clients always converge.
 *   404 if the run id is unknown.
 */
async function streamRun(
  request: FastifyRequest,
  reply: FastifyReply,
  runService: RunService,
  runs: RunRepository,
  runId: string,
): Promise<void> {
  const cursor = parseLastEventId(request);

  if (!runService.isActive(runId)) {
    // Finished (or never-active) run: replay the persisted log (cursor-filtered), then close. `getRun`
    // throws 404 for an unknown id, which the central error handler maps before we touch `reply.raw`.
    const detail = runs.getRun(runId);
    writeSseHead(reply);
    writePersistedReplay(reply, detail, cursor);
    reply.raw.end();
    return;
  }

  writeSseHead(reply);

  await new Promise<void>((resolve) => {
    let settled = false;
    // Declared BEFORE subscribe so `close()` is safe at any time: if the synchronous buffer replay
    // contains a terminal `status`, the listener fires `close()` DURING `subscribeEvents` — before it
    // returns — so `unsubscribe` is still undefined here. `unsubscribe?.()` makes that a no-op instead
    // of a TDZ `ReferenceError`. `settled` keeps `close()` idempotent (heartbeat cleared + unsubscribe
    // run at most once), so calling it before subscribe completes, on disconnect, and on terminal all
    // coexist safely.
    let unsubscribe: (() => void) | undefined;
    // WP2.1 — the heartbeat is now a real event through the same `writeEvent` choke point as everything
    // else (see its own no-op-past-end guard); it carries no `seq`, so it never touches the cursor
    // watermark below.
    const heartbeat = setInterval(() => writeEvent(reply, { type: "ping" }), SSE_HEARTBEAT_MS);

    const close = () => {
      if (settled) return;
      settled = true;
      clearInterval(heartbeat);
      unsubscribe?.();
      if (!reply.raw.writableEnded) reply.raw.end();
      resolve();
    };

    // AR11 close condition: the run is over only when the terminal status AND the settled rating
    // event have BOTH been flushed (the review runs after the terminal status, so the stream must
    // outlive it). The two flags are order-independent by construction (terminal always precedes the
    // settled rating), but tracked separately so a buffered replay containing both also closes.
    let terminalSeen = false;
    let ratingSettledSeen = false;
    // WP2.1 cursor watermark: the highest `seq` written on THIS connection so far, seeded from the
    // client's `Last-Event-ID` cursor (or -1 for a plain connect, so every event passes). EVERY event
    // — DB gap-fill, buffered replay, or live — flows through `forward`, the single write choke point
    // for this connection, so the watermark makes the whole reconnect zero-loss AND zero-dupe no matter
    // which of the (up to) three sources produced a given event: `getRun` (an existing, full-history
    // read) and the in-memory buffer can legitimately overlap near the boundary, and the watermark
    // collapses that overlap to exactly one write. Events without a `seq` (pre-WP1.1 legacy rows) can't
    // be cursor-compared, so they always pass — favoring zero loss over the (already-vanishing, and
    // then only cosmetic) risk of a legacy dupe.
    let lastWrittenSeq = cursor ?? -1;
    const forward = (event: RunEvent) => {
      if (event.seq !== undefined) {
        if (event.seq <= lastWrittenSeq) return; // already sent on this connection — no dupes
        lastWrittenSeq = event.seq;
      }
      writeEvent(reply, event);
      if (event.type === "status" && isTerminalSseStatus(event.status)) terminalSeen = true;
      if (event.type === "rating" && isSettledRatingState(event.state)) ratingSettledSeen = true;
      // (The manager also drops the run + its listeners once both hold, so this won't fire again.)
      if (terminalSeen && ratingSettledSeen) close();
    };

    // Subscribe: `runManager.subscribe` replays its bounded buffer SYNCHRONOUSLY first (in emission
    // order), then forwards live events as they occur. Nothing else can call into the manager while
    // this synchronous call is on the stack (single-threaded JS, no re-entrancy here), so `inSyncReplay`
    // reliably tells the buffered replay apart from genuinely live events: it's true only until
    // `subscribeEvents` returns. Buffered events are captured (not written yet) so the cursor-coverage
    // decision below can run BEFORE anything is sent — otherwise a gap-filling DB read would have to be
    // interleaved mid-stream instead of ordered cleanly ahead of the buffer.
    let inSyncReplay = true;
    const buffered: RunEvent[] = [];
    const listener = (event: RunEvent) => {
      if (inSyncReplay) buffered.push(event);
      else forward(event);
    };
    unsubscribe = runService.subscribeEvents(runId, listener);
    inSyncReplay = false;

    // WP2.1 cursor resume: does the just-captured in-memory buffer COVER the client's cursor? Yes if
    // there's no cursor at all (plain connect), the buffer holds no seq-stamped event to compare
    // against, or its OLDEST event's `seq` is <= cursor + 1 (no gap between what the client already has
    // and what the buffer holds). Otherwise there's a gap: the events strictly before the buffer's
    // oldest one have already been evicted from the bounded buffer and must come from the persisted log
    // — `getRun`, the SAME existing repository read `writePersistedReplay` uses for a finished run — so
    // the reconnect is zero-loss regardless of `MAX_BUFFERED_EVENTS`. `forward`'s watermark makes
    // prepending this full-history read safe even though it may overlap the buffer.
    const oldestBufferedSeq = buffered.find((event) => event.seq !== undefined)?.seq;
    const bufferCoversCursor =
      cursor === undefined || oldestBufferedSeq === undefined || oldestBufferedSeq <= cursor + 1;
    if (!bufferCoversCursor) {
      for (const event of runs.getRun(runId).events) forward(event);
    }
    for (const event of buffered) forward(event);
    // If the buffer/DB replay above already drove the stream to its settled end, `close()` ran and set
    // `settled`; nothing more to do. Detaching here would also be redundant (manager already cleaned up).
    if (settled) return;

    // Narrow race: if the run settled (terminal + settled rating) between the `isActive` check and
    // this subscribe, the manager already dropped it (no buffer, no live events will come). Fall back
    // to the persisted replay — cursor-filtered from the same watermark, + the synthesized rating
    // convergence — so the stream is never left hanging.
    if (!runService.isActive(runId)) {
      writePersistedReplay(reply, runs.getRun(runId), lastWrittenSeq);
      close();
      return;
    }

    // Client disconnect (browser closed the EventSource): tear down cleanly — no leaked timer/listener.
    request.raw.on("close", close);
  });
}

/**
 * Replay a finished run's persisted events, then — AR11 convergence — synthesize one final `rating`
 * event from the run row when the log itself lacks a settled one: legacy/backfilled rows predate the
 * rating events, and a re-rate (`POST /api/runs/:id/grade`) may have moved the row's state after the
 * log settled. The row is the source of truth for the CURRENT state, so clients always converge on it.
 * A finished row whose state is still unsettled (`pending`/`rating` — reconciled to `skipped` on
 * startup, so only a transiently-mid-review row) synthesizes nothing rather than inventing a state.
 *
 * WP2.1, D-US8 — `cursor` (a client's `Last-Event-ID`, or the connection's running watermark when
 * called from the live branch's narrow-race fallback) skips events with `seq <= cursor`; events without
 * a `seq` (pre-WP1.1 legacy rows) are always included since they can't be cursor-compared — the same
 * watermark semantics `streamRun`'s `forward` uses for the live path.
 */
function writePersistedReplay(reply: FastifyReply, detail: RunDetail, cursor?: number): void {
  let lastWrittenSeq = cursor ?? -1;
  for (const event of detail.events) {
    if (event.seq !== undefined) {
      if (event.seq <= lastWrittenSeq) continue;
      lastWrittenSeq = event.seq;
    }
    writeEvent(reply, event);
  }
  const logged = detail.events.some(
    (event) => event.type === "rating" && isSettledRatingState(event.state),
  );
  const state = detail.ratingState;
  if (!logged && state !== undefined && isSettledRatingState(state)) {
    writeEvent(reply, { type: "rating", state });
  }
}

// Unified Sessions (WP1.6, D-US2) — 'ended' joins the SSE close condition: an End-session terminal is
// just as stream-closing as any other terminal disposition.
const TERMINAL_SSE_STATUSES = new Set(["completed", "stopped", "error", "aborted", "ended"]);
function isTerminalSseStatus(status: string): boolean {
  return TERMINAL_SSE_STATUSES.has(status);
}

function writeSseHead(reply: FastifyReply): void {
  // Take over the socket: we own the framing on `reply.raw`, so Fastify must not also try to send a
  // reply (otherwise it logs "reply already sent" when the route promise resolves).
  reply.hijack();
  reply.raw.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
}

function writeEvent(reply: FastifyReply, event: RunEvent): void {
  if (reply.raw.writableEnded) return;
  // WP2.1, D-US8 — an `id:` line ahead of `data:` on every event that carries a `seq` (every event
  // since WP1.1, stamped once by `RunManager.emit`'s single choke point). A reconnecting client's
  // native `EventSource` sends this back as `Last-Event-ID` automatically; `parseLastEventId` reads it
  // server-side to resume from a cursor (see `streamRun`). The `{type:"ping"}` heartbeat carries no
  // `seq`, so it never gets an `id:` line — a keepalive must never advance the client's resume cursor.
  const id = event.seq !== undefined ? `id: ${event.seq}\n` : "";
  reply.raw.write(`${id}data: ${JSON.stringify(event)}\n\n`);
}

/**
 * WP2.1, D-US8 — parse a reconnecting client's `Last-Event-ID` header: sent automatically by the
 * browser's native `EventSource` once the stream has emitted an `id:` line, or set explicitly by a
 * manual reconnect / test. Returns `undefined` for a plain connect (no header) or a malformed value —
 * never throws, so a bad header just degrades to the pre-cursor full-replay behavior rather than
 * breaking the stream. An empty string (`Number("")` is `0` in JS — a footgun here) is treated the same
 * as "absent", not as cursor `0`.
 */
function parseLastEventId(request: FastifyRequest): number | undefined {
  const raw = request.headers["last-event-id"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

/** Parse the `?ids=` query (comma-joined or repeated), trimmed + de-duplicated, empties dropped. */
function parseIds(raw: string | string[] | undefined): string[] {
  if (raw === undefined) throw httpError(400, "Query parameter `ids` is required");
  const parts = (Array.isArray(raw) ? raw : [raw])
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return [...new Set(parts)];
}
