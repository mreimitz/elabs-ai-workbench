import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { isSettledRatingState, suiteInputSchema, type SuiteRun } from "@mcp-token-footprint/shared";
import type { FailureBucketService } from "../grading/failure-buckets.js";
import type { GradeRepository } from "../grading/grade-repository.js";
import type { RunRepository } from "../testing/run-repository.js";
import type { TestService } from "../testing/test-service.js";
import {
  buildSuiteAnalytics,
  buildSuiteDeltas,
  buildSuiteRunMembers,
  parseGraderQuery,
} from "./analytics.js";
import { httpError } from "../utils/errors.js";
import type { SuiteOrchestrator } from "./orchestrator.js";
import type { SuiteService } from "./service.js";
import type { SuiteReportRepository } from "./suite-report-repository.js";
import type { SuiteReportService } from "./suite-report-service.js";
import type { SuiteRunEvent, SuiteRunManager } from "./suite-run-manager.js";
import type { SuiteRunRepository } from "./suite-run-repository.js";

/**
 * Benchmarks suite routes: suite CRUD (WP 3.1, B7) + the suite mass-run surface (WP 3.2, B8 — run /
 * list / detail / SSE stream / stop / delete) + suite-run ANALYTICS (WP 3.4, B9.2–B9.3) + the Auto-Rating
 * cross-run REPORT (WP 4.3, AR7). Thin — validate with the shared zod schema, delegate to the service /
 * orchestrator / suite-run repository / the pure analytics builder. Grouped so the single
 * `registerSuiteRoutes` call in `index.ts` wires the whole feature. The analytics reads
 * (`runs`/`grades`/`tests`) are DERIVED — recomputed from persisted state.
 */
export async function registerSuiteRoutes(
  app: FastifyInstance,
  suites: SuiteService,
  orchestrator: SuiteOrchestrator,
  suiteRuns: SuiteRunRepository,
  suiteRunManager: SuiteRunManager,
  runs: RunRepository,
  grades: GradeRepository,
  tests: TestService,
  failureBuckets: FailureBucketService,
  suiteReportService: SuiteReportService,
  suiteReports: SuiteReportRepository,
) {
  registerSuiteCrudRoutes(app, suites);
  registerSuiteRunRoutes(
    app,
    orchestrator,
    suiteRuns,
    suiteRunManager,
    runs,
    grades,
    tests,
    failureBuckets,
    suiteReportService,
    suiteReports,
  );
}

function registerSuiteCrudRoutes(app: FastifyInstance, suites: SuiteService) {
  app.get("/api/suites", async () => suites.list());

  app.get("/api/suites/:id", async (request) => {
    const { id } = request.params as { id: string };
    return suites.get(id);
  });

  app.post("/api/suites", async (request, reply) => {
    const input = suiteInputSchema.parse(request.body);
    const suite = suites.create(input);
    return reply.code(201).send(suite);
  });

  app.put("/api/suites/:id", async (request) => {
    const { id } = request.params as { id: string };
    const input = suiteInputSchema.parse(request.body);
    return suites.update(id, input);
  });

  app.delete("/api/suites/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    suites.delete(id);
    return reply.code(204).send();
  });
}

/**
 * Heartbeat keeps the SSE connection alive through idle gaps + intermediaries. Sent as a real
 * `{type:"ping"}` {@link SuiteRunEvent} (Unified Sessions WP2.3, D-US8 follow-up — replacing the old
 * `: ping` comment line, closing the parity gap `apps/api/src/testing/routes.ts`'s WP2.1 run stream
 * already had) so the client watchdog (`use-suite-stream.ts`) can parse + recognize it exactly like any
 * other event instead of relying on message-type-agnostic staleness detection. `let`, not `const`:
 * {@link setSseHeartbeatMsForTesting} is the ONLY writer, so a test can observe a heartbeat without a
 * real 15s wait — no production code path touches it.
 */
let SSE_HEARTBEAT_MS = 15_000;

/**
 * Test-only seam (Unified Sessions WP2.3, mirrors `apps/api/src/testing/routes.ts`'s
 * `setSseHeartbeatMsForTesting`): override the suite SSE heartbeat cadence for the current process and
 * return the previous value so a test's `afterEach`/cleanup can restore it. Never called from
 * production code.
 */
export function setSseHeartbeatMsForTesting(ms: number): number {
  const previous = SSE_HEARTBEAT_MS;
  SSE_HEARTBEAT_MS = ms;
  return previous;
}

function registerSuiteRunRoutes(
  app: FastifyInstance,
  orchestrator: SuiteOrchestrator,
  suiteRuns: SuiteRunRepository,
  manager: SuiteRunManager,
  runs: RunRepository,
  grades: GradeRepository,
  tests: TestService,
  failureBuckets: FailureBucketService,
  suiteReportService: SuiteReportService,
  suiteReports: SuiteReportRepository,
) {
  // Start a suite run: snapshot the config, create the `suite_runs` row (pending→running), kick off the
  // orchestrator ASYNC, and return the running suite run immediately. Errors during the async matrix
  // surface as suite/cell events + a terminal status on the stream, never as an HTTP 500 here.
  app.post("/api/suites/:id/run", async (request, reply) => {
    const { id } = request.params as { id: string };
    const suiteRun = orchestrator.startSuiteRun(id);
    return reply.code(202).send(suiteRun);
  });

  // Suite-run history (newest first), optionally scoped to one suite via `?suiteId=`.
  app.get("/api/suite-runs", async (request) => {
    const { suiteId } = request.query as { suiteId?: string };
    return suiteRuns.listRuns(suiteId);
  });

  // Live SSE stream of the suite run's cell/aggregate/status events. Registered BEFORE `/:id` isn't
  // needed (distinct suffix), but keep the detail route below it for clarity.
  app.get("/api/suite-runs/:id/stream", async (request, reply) => {
    const { id } = request.params as { id: string };
    return streamSuiteRun(request, reply, orchestrator, suiteRuns, manager, id);
  });

  // Detail — the persisted suite run (incl. cached aggregates). 404 if unknown.
  app.get("/api/suite-runs/:id", async (request) => {
    const { id } = request.params as { id: string };
    return suiteRuns.getRun(id);
  });

  // Analytics (WP 3.4, B9.2–B9.3) — the DERIVED quality×cost scatter + metadata breakdowns, computed
  // fresh from the suite run's child runs + their grades + test metadata. `?grader=` selects the score
  // dimension (default = the primary-grader priority; unknown grader → 400). 404 if the suite run is
  // unknown; honest empty (`{scatter:[],breakdowns:[]}`) when no grades exist yet.
  app.get("/api/suite-runs/:id/analytics", async (request) => {
    const { id } = request.params as { id: string };
    const { grader } = request.query as { grader?: string };
    suiteRuns.getRun(id); // 404s for an unknown id (mapped by the central error handler)
    const graderId = parseGraderQuery(grader);
    return buildSuiteAnalytics(runs, grades, tests, suiteRuns.listChildRunIds(id), graderId);
  });

  // Members — the suite run's MEMBER runs (one row per test × scenario × repetition), each a persisted
  // child run enriched with its selected-grader score + attributed variant. DERIVED from `runs` +
  // `run_grades` + `run_skills`, so it materialises IDENTICALLY for a live and a FINISHED suite run —
  // the per-cell detail the console needs to show what actually executed. `?grader=` selects the score
  // dimension (default = primary-grader priority; unknown grader → 400). 404 if the suite run is unknown.
  app.get("/api/suite-runs/:id/members", async (request) => {
    const { id } = request.params as { id: string };
    const { grader } = request.query as { grader?: string };
    const suiteRun = suiteRuns.getRun(id); // 404s for an unknown id (mapped by the central error handler)
    const graderId = parseGraderQuery(grader);
    const variants = suiteRun.configSnapshot.variants ?? [];
    return buildSuiteRunMembers(runs, grades, suiteRuns.listChildRunIds(id), variants, graderId);
  });

  // Failure-bucket clustering (WP 3.5, B9.4) — OPT-IN, EXPLICITLY triggered here and NOWHERE else. Clusters
  // the suite run's low-score judge reasons into a taxonomy via ONE judge call, persisting the DERIVED
  // clusters onto `aggregates_json`. 404 if unknown; 400 if a judge call is needed but none is configured
  // / its model is unpriced; 502 if the provider call fails. Its cost lands on the GRADING-side aggregate
  // judgeCostUsd ledger (never run cost); grades are untouched; re-triggering overwrites the clusters.
  app.post("/api/suite-runs/:id/failure-buckets", async (request) => {
    const { id } = request.params as { id: string };
    return failureBuckets.analyze(id);
  });

  // Deltas (WP 5.1, B14) — the skill-effect view: per test, each variant's grade/tokens/cost MINUS the
  // `base` variant's, meaned over repetitions, DERIVED from the child runs + grades + the config-snapshot
  // variant definitions. `?base=` names the base variant by label (defaults to the first variant); an
  // unknown base → 404. A suite run with no variants → honest empty `[]`. 404 for an unknown suite run.
  app.get("/api/suite-runs/:id/deltas", async (request) => {
    const { id } = request.params as { id: string };
    const { base } = request.query as { base?: string };
    const suiteRun = suiteRuns.getRun(id); // 404s for an unknown id (mapped by the central error handler)
    const variants = suiteRun.configSnapshot.variants ?? [];
    if (variants.length === 0) return []; // not a skill-effect suite — no variant axis
    const baseLabel = base ?? variants[0]?.label ?? "";
    if (!variants.some((variant) => variant.label === baseLabel)) {
      throw httpError(404, `Unknown base variant '${baseLabel}'`);
    }
    return buildSuiteDeltas(runs, grades, variants, suiteRuns.listChildRunIds(id), baseLabel);
  });

  // Auto-Rating (WP 4.3, AR7/AR11) — the mandatory cross-run report: the LATEST persisted `SuiteReport`,
  // a pure read (never generates/mutates). A suite run with <2 members, or one whose report hasn't
  // landed yet (generation is chained async off the orchestrator's `finish()` hook), has none — an
  // honest 404, exactly like an unknown suite run (the caller only ever asks this for an
  // ALREADY-resolved suite run, so it can't confuse the two). 404 if the suite run itself is unknown.
  app.get("/api/suite-runs/:id/report", async (request, reply) => {
    const { id } = request.params as { id: string };
    suiteRuns.getRun(id); // 404s for an unknown suite run id
    const latest = suiteReports.latest(id);
    if (!latest) {
      return reply
        .code(404)
        .send({ error: "No cross-run rating report has been generated for this suite run yet" });
    }
    // Additive: echo the persisted ROW's status onto the returned report at READ time — the stored
    // report_json is never rewritten, so a pre-stamp row still surfaces its `ready`/`partial`/`error`.
    return { ...latest.report, status: latest.status };
  });

  // Regenerate the cross-run report (APPEND-ONLY — a fresh row is inserted, prior rows are kept, latest
  // wins; mirrors `POST /api/runs/:id/grade`). NEVER blocks/fails/mutates the suite run (AR11): a <2
  // member suite run (or one raced-deleted mid-generation) yields an HONEST `report: null` + a `reason`,
  // never a 500. 404 if the suite run itself is unknown.
  app.post("/api/suite-runs/:id/report", async (request, reply) => {
    const { id } = request.params as { id: string };
    suiteRuns.getRun(id); // 404s for an unknown suite run id
    const memberCount = suiteRuns.listChildRunIds(id).length;
    const result = await suiteReportService.generate(id);
    if (!result) {
      return reply.code(200).send({
        report: null,
        reason: memberCount < 2 ? "insufficient_members" : "generation_failed",
      });
    }
    return reply.code(201).send({ report: result.report });
  });

  // Stop — halt scheduling + abort in-flight children; the suite run finalizes as `stopped`.
  app.post("/api/suite-runs/:id/stop", async (request, reply) => {
    const { id } = request.params as { id: string };
    orchestrator.stop(id);
    return reply.code(202).send({ ok: true });
  });

  // Delete — LOCKED: KEEP the child runs (their `suite_run_id` linkage is cleared); delete only the
  // suite_runs row. If the suite run is still active it is stopped + detached first. 404 if unknown.
  app.delete("/api/suite-runs/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    orchestrator.delete(id);
    return reply.code(204).send();
  });
}

/**
 * Stream a suite run's {@link SuiteRunEvent}s as Server-Sent Events on the raw response (mirrors the
 * run-console stream):
 *   - LIVE suite run: replay the manager's bounded buffer in order, attach the live listener, keep the
 *     socket open with a 15s heartbeat, tear down on client disconnect. AR11 — the stream stays OPEN
 *     through the post-`finish()` review: it closes only once BOTH the terminal `status` AND a SETTLED
 *     `rating` event have been sent (the orchestrator guarantees a settled rating event after every
 *     terminal status, so no defensive timeout is needed; a subscriber attaching mid-rating is
 *     backfilled the earlier transitions from the bounded buffer).
 *   - FINISHED (or never-active) suite run: synthesize a replay from the PERSISTED `suite_runs` snapshot
 *     (its cached aggregates, if any, then its terminal status, then — when the row's rating axis has
 *     settled — one final `rating` event) so `/stream` still works after the run settled and clients
 *     always converge. 404 if the suite run id is unknown entirely (`getRun` throws before `reply.raw`).
 */
async function streamSuiteRun(
  request: FastifyRequest,
  reply: FastifyReply,
  orchestrator: SuiteOrchestrator,
  suiteRuns: SuiteRunRepository,
  manager: SuiteRunManager,
  suiteRunId: string,
): Promise<void> {
  if (!orchestrator.isActive(suiteRunId)) {
    const suiteRun = suiteRuns.getRun(suiteRunId); // 404s for an unknown id (mapped before reply.raw)
    writeSseHead(reply);
    writePersistedSnapshot(reply, suiteRun);
    reply.raw.end();
    return;
  }

  writeSseHead(reply);

  await new Promise<void>((resolve) => {
    let settled = false;
    let unsubscribe: (() => void) | undefined;
    // WP2.3, D-US8 follow-up — a real `{type:"ping"}` SuiteRunEvent (was the raw `: ping\n\n` SSE
    // comment, invisible to `EventSource.onmessage`; see `writeEvent`'s doc for why it never gets an
    // `id:` line).
    const heartbeat = setInterval(() => {
      writeEvent(reply, { type: "ping" });
    }, SSE_HEARTBEAT_MS);

    const close = () => {
      if (settled) return;
      settled = true;
      clearInterval(heartbeat);
      unsubscribe?.();
      if (!reply.raw.writableEnded) reply.raw.end();
      resolve();
    };

    // AR11 close condition (mirrors the run stream): terminal status AND settled rating, both flushed.
    let terminalSeen = false;
    let ratingSettledSeen = false;
    const listener = (event: SuiteRunEvent) => {
      writeEvent(reply, event);
      if (event.type === "status" && isTerminalSuiteSseStatus(event.status)) terminalSeen = true;
      if (event.type === "rating" && isSettledRatingState(event.state)) ratingSettledSeen = true;
      if (terminalSeen && ratingSettledSeen) close();
    };

    // Subscribe: the manager replays its bounded buffer synchronously FIRST (in order), then forwards
    // live events — so the opening cells are never missed by a subscriber that connects late.
    unsubscribe = manager.subscribe(suiteRunId, listener);
    if (settled) return; // buffer replay already drove us to the settled end

    // Narrow race: the suite run settled between the isActive check and subscribe.
    if (!orchestrator.isActive(suiteRunId)) {
      writePersistedSnapshot(reply, suiteRuns.getRun(suiteRunId));
      close();
      return;
    }

    request.raw.on("close", close);
  });
}

/**
 * The finished-suite-run replay: cached aggregates (if any) → terminal status → AR11 convergence — a
 * synthesized `rating` event from the row when its review axis has settled (a legacy/backfilled row is
 * settled by migration v27 / the startup reconciliation; a transiently mid-review row synthesizes
 * nothing rather than inventing a state).
 */
function writePersistedSnapshot(reply: FastifyReply, suiteRun: SuiteRun): void {
  if (suiteRun.aggregates) {
    writeEvent(reply, { type: "aggregates", aggregates: suiteRun.aggregates });
  }
  writeEvent(reply, { type: "status", status: suiteRun.status });
  const state = suiteRun.ratingState;
  if (state !== undefined && isSettledRatingState(state)) {
    writeEvent(reply, { type: "rating", state });
  }
}

const TERMINAL_SUITE_SSE_STATUSES = new Set(["completed", "capped", "stopped", "error"]);
function isTerminalSuiteSseStatus(status: string): boolean {
  return TERMINAL_SUITE_SSE_STATUSES.has(status);
}

function writeSseHead(reply: FastifyReply): void {
  reply.hijack();
  reply.raw.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
}

/**
 * Unlike the run stream's `writeEvent` (`apps/api/src/testing/routes.ts`, WP2.1, D-US8), the suite
 * stream has no `id:`/`Last-Event-ID` cursor-resume mechanism (out of WP2.3's scope — WP2.R judged it a
 * nice-to-have only, since the reconnect is already lossless via the manager's bounded replay buffer +
 * the client's `seq` dedupe). So no event, including the `{type:"ping"}` heartbeat added here, ever
 * gets an `id:` line — trivially satisfying the same invariant the run stream enforces explicitly: a
 * keepalive must never advance a client's resume cursor.
 */
function writeEvent(reply: FastifyReply, event: SuiteRunEvent): void {
  if (reply.raw.writableEnded) return;
  reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
}
