import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import Fastify from "fastify";
import { ZodError } from "zod";
import { isSettledRatingState, type SuiteRunEvent } from "@mcp-token-footprint/shared";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { AppSettingsRepository } from "../src/grading/app-settings-repository.js";
import { GradeRepository } from "../src/grading/grade-repository.js";
import type { GradeService } from "../src/grading/grade-service.js";
import { registerGradingRoutes } from "../src/grading/routes.js";
import { RunReportService } from "../src/grading/run-report.js";
import {
  SuiteOrchestrator,
  type ResolvedRunPlan,
  type SuiteRunStarter,
} from "../src/suites/orchestrator.js";
import { SuiteRepository } from "../src/suites/repository.js";
import { SuiteRunManager } from "../src/suites/suite-run-manager.js";
import { SuiteRunRepository } from "../src/suites/suite-run-repository.js";
import { RunRepository } from "../src/testing/run-repository.js";
import type { RunHandle } from "../src/testing/run-service.js";
import { toErrorMessage } from "../src/utils/errors.js";

// AR11 — the rating axis OUTSIDE the live run stream (which run-stream-routes.test.ts covers):
//   (1) the repository transitions (setRatingState / appendRatingEvent / orphan reconciliation),
//   (2) the manual re-rate route (`POST /api/runs/:id/grade` → rating → rated/failed, persisted),
//   (3) the suite orchestrator's review phase around the post-`finish()` report hook + the suite
//       manager's deferred cleanup (terminal AND settled rating), i.e. what the suite SSE carries.

const NOW = "2026-07-04T00:00:00.000Z";

const databases: AppDatabase[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function createDatabase(): AppDatabase {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  databases.push(db);
  return db;
}

/** Seed the provider → scenario → test parents plus one run row (default status 'completed'). */
function seedRun(db: AppDatabase, runId: string, status = "completed"): void {
  db.prepare(
    `INSERT OR IGNORE INTO provider_credentials (id, kind, label, api_key_encrypted, created_at, updated_at)
     VALUES ('prov-1', 'anthropic', 'Claude', 'enc:v1:abc', @now, @now)`,
  ).run({ now: NOW });
  db.prepare(
    `INSERT OR IGNORE INTO scenarios (id, name, provider_id, model, created_at, updated_at)
     VALUES ('scn-1', 'Baseline', 'prov-1', 'claude-sonnet-4', @now, @now)`,
  ).run({ now: NOW });
  db.prepare(
    `INSERT OR IGNORE INTO tests (id, name, user_prompt, created_at, updated_at)
     VALUES ('test-1', 'T', 'p', @now, @now)`,
  ).run({ now: NOW });
  db.prepare(
    `INSERT INTO runs (id, test_id, scenario_id, mode, status, started_at)
     VALUES (@id, 'test-1', 'scn-1', 'automated', @status, @now)`,
  ).run({ id: runId, status, now: NOW });
}

// ── (1) Repository transitions ────────────────────────────────────────────────────────────────────

test("RunRepository.setRatingState round-trips through the summary; a fresh row boots 'pending'", () => {
  const db = createDatabase();
  const runs = new RunRepository(db);
  seedRun(db, "run-1");

  assert.equal(runs.getSummary("run-1").ratingState, "pending", "fresh row defaults to 'pending'");
  runs.setRatingState("run-1", "rating");
  assert.equal(runs.getSummary("run-1").ratingState, "rating");
  runs.setRatingState("run-1", "rated");
  assert.equal(runs.getSummary("run-1").ratingState, "rated");
  // The terminal-status contract is untouched: status never carries a rating member.
  assert.equal(runs.getSummary("run-1").status, "completed");
  // Unknown run: a silent 0-row no-op (the review transitions must never throw).
  assert.doesNotThrow(() => runs.setRatingState("nope", "failed"));
});

test("RunRepository.appendRatingEvent appends to the replay log AFTER the stored events, in order", () => {
  const db = createDatabase();
  const runs = new RunRepository(db);
  seedRun(db, "run-1");
  db.prepare(
    `INSERT INTO run_events (id, run_id, idx, type, payload_json, created_at)
     VALUES ('evt-0', 'run-1', 0, 'status', '{"type":"status","status":"completed"}', @now)`,
  ).run({ now: NOW });

  runs.appendRatingEvent("run-1", "rating");
  runs.appendRatingEvent("run-1", "rated");

  const events = runs.getRun("run-1").events;
  assert.equal(events.length, 3, "two rating events appended after the stored log");
  assert.deepEqual(
    events.slice(1).map((e) => (e.type === "rating" ? e.state : e.type)),
    ["rating", "rated"],
    "the transitions replay in append order (idx continues after MAX)",
  );
  // Unknown run: a silent no-op (the re-rate path must never fail over rating bookkeeping).
  assert.doesNotThrow(() => runs.appendRatingEvent("nope", "rated"));
  assert.equal(runs.getRun("run-1").events.length, 3);
});

test("abortOrphanedRuns settles the rating axis: orphans → aborted+skipped, stuck reviews → skipped", () => {
  const db = createDatabase();
  const runs = new RunRepository(db);
  seedRun(db, "run-live", "running");
  seedRun(db, "run-stuck", "completed");
  runs.setRatingState("run-stuck", "rating"); // crashed mid-review (terminal, never settled)
  seedRun(db, "run-done", "completed");
  runs.setRatingState("run-done", "rated"); // already settled — must be left alone

  const reconciled = runs.abortOrphanedRuns();

  assert.equal(reconciled, 1, "one running orphan reconciled");
  assert.equal(runs.getSummary("run-live").status, "aborted");
  assert.equal(runs.getSummary("run-live").ratingState, "skipped", "orphan review → skipped");
  assert.equal(runs.getSummary("run-stuck").ratingState, "skipped", "stuck mid-review → skipped");
  assert.equal(runs.getSummary("run-done").ratingState, "rated", "a settled review is untouched");
});

test("SuiteRunRepository.setRatingState + reconcileOrphans mirror the run-side axis", () => {
  const db = createDatabase();
  const suiteRuns = new SuiteRunRepository(db);

  const live = suiteRuns.create(null, { repetitions: 1, maxConcurrency: 1 }, "adhoc");
  suiteRuns.updateStatus(live.id, "running");
  const stuck = suiteRuns.create(null, { repetitions: 1, maxConcurrency: 1 }, "adhoc");
  suiteRuns.finalize(stuck.id, "completed", {
    cellsTotal: 1,
    cellsCompleted: 1,
    meanGrade: null,
    gradeStdDev: null,
    passRateAt05: null,
    totalTokens: 0,
    execCostUsd: 0,
    judgeCostUsd: 0,
  });
  suiteRuns.setRatingState(stuck.id, "rating"); // crashed mid-review

  assert.equal(suiteRuns.getRun(live.id).ratingState, "pending", "fresh row boots 'pending'");
  suiteRuns.setRatingState(live.id, "rated");
  assert.equal(suiteRuns.getRun(live.id).ratingState, "rated");
  suiteRuns.setRatingState(live.id, "pending"); // rewind for the reconcile below

  suiteRuns.reconcileOrphans();
  assert.equal(suiteRuns.getRun(live.id).status, "error", "orphan finalized as error");
  assert.equal(suiteRuns.getRun(live.id).ratingState, "skipped", "orphan review → skipped");
  assert.equal(suiteRuns.getRun(stuck.id).ratingState, "skipped", "stuck mid-review → skipped");
});

// ── (2) The manual re-rate route: POST /api/runs/:id/grade ───────────────────────────────────────

function stubGrades(behavior: "ok" | "throw"): GradeService {
  return {
    gradeRun: async () => {
      if (behavior === "throw") throw new Error("judge exploded");
      return [];
    },
  } as unknown as GradeService;
}

async function makeGradingApp(db: AppDatabase, grades: GradeService) {
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: "Validation failed" });
    const typed = error as Error & { statusCode?: number };
    return reply
      .code(typeof typed.statusCode === "number" ? typed.statusCode : 500)
      .send({ error: toErrorMessage(error) });
  });
  const gradeRepo = new GradeRepository(db);
  const runRepo = new RunRepository(db);
  await registerGradingRoutes(
    app,
    grades,
    new AppSettingsRepository(db),
    { cliAvailable: () => false },
    new RunReportService(gradeRepo, runRepo),
    undefined, // no issue registry here
    runRepo, // AR11 — the rating axis around the re-rate
  );
  return { app, runRepo };
}

test("re-rate: POST /api/runs/:id/grade transitions rating→rated and appends the replay-log events", async () => {
  const db = createDatabase();
  seedRun(db, "run-1");
  const { app, runRepo } = await makeGradingApp(db, stubGrades("ok"));

  const res = await app.inject({ method: "POST", url: "/api/runs/run-1/grade", payload: {} });
  assert.equal(res.statusCode, 200);

  assert.equal(runRepo.getSummary("run-1").ratingState, "rated", "the re-rate settled to 'rated'");
  const ratings = runRepo
    .getRun("run-1")
    .events.filter((e) => e.type === "rating")
    .map((e) => (e.type === "rating" ? e.state : ""));
  assert.deepEqual(
    ratings,
    ["rating", "rated"],
    "both transitions were appended to run_events so a replayed stream converges",
  );
  await app.close();
});

test("re-rate: a grade failure surfaces as the route error AND settles the axis to 'failed'", async () => {
  const db = createDatabase();
  seedRun(db, "run-1");
  const { app, runRepo } = await makeGradingApp(db, stubGrades("throw"));

  const res = await app.inject({ method: "POST", url: "/api/runs/run-1/grade", payload: {} });
  assert.equal(res.statusCode, 500, "the grade failure still surfaces to the caller (unchanged)");

  const summary = runRepo.getSummary("run-1");
  assert.equal(summary.ratingState, "failed", "the axis records the failed re-rate");
  assert.equal(summary.status, "completed", "the run's own terminal status is untouched");
  await app.close();
});

// ── (3) The suite orchestrator's review phase + the suite manager's deferred cleanup ─────────────

/** A run starter whose cells settle immediately as completed — the orchestrator under test needs no engine. */
function immediateStarter(): SuiteRunStarter {
  let n = 0;
  return (_testId, _scenarioId, mode): RunHandle => ({
    runId: `stub-run-${n++}`,
    mode,
    done: Promise.resolve({
      status: "completed" as const,
      outcome: "completed" as const,
      turns: 0,
      toolCalls: 0,
      tokensIn: 0,
      tokensOut: 0,
    }),
  });
}

function makeOrchestrator(
  db: AppDatabase,
  hook?: (suiteRunId: string) => Promise<unknown>,
): { orchestrator: SuiteOrchestrator; manager: SuiteRunManager; suiteRuns: SuiteRunRepository } {
  const suiteRuns = new SuiteRunRepository(db);
  const manager = new SuiteRunManager();
  const orchestrator = new SuiteOrchestrator(
    immediateStarter(),
    () => undefined,
    new RunRepository(db),
    suiteRuns,
    new SuiteRepository(db),
    new GradeRepository(db),
    manager,
    undefined, // no skills — no variants in these plans
    hook,
  );
  return { orchestrator, manager, suiteRuns };
}

const PLAN: ResolvedRunPlan = {
  source: "adhoc",
  suiteId: null,
  testIds: ["t1"],
  scenarioIds: ["s1"],
  config: { repetitions: 1, maxConcurrency: 1 },
  planJson: null,
};

function suiteRatings(events: SuiteRunEvent[]): string[] {
  return events.filter((e) => e.type === "rating").map((e) => (e.type === "rating" ? e.state : ""));
}

test("suite AR11: the orchestrator wraps the report hook — rating→rated on the row AND the SSE channel", async () => {
  const db = createDatabase();
  const hookCalls: string[] = [];
  const { orchestrator, manager, suiteRuns } = makeOrchestrator(db, async (suiteRunId) => {
    hookCalls.push(suiteRunId);
    return undefined;
  });

  const run = orchestrator.startPlanRun(PLAN);
  const events: SuiteRunEvent[] = [];
  manager.subscribe(run.id, (e) => events.push(e)); // buffered replay + live — the SSE route's feed
  await orchestrator.whenSettled(run.id);

  assert.deepEqual(hookCalls, [run.id], "the report hook ran once, after finish()");
  assert.deepEqual(suiteRatings(events), ["rating", "rated"], "the suite stream carried the review");
  // Ordering: the terminal status precedes the review (finish() emits first).
  const idxTerminal = events.findIndex((e) => e.type === "status" && e.status === "completed");
  const idxRating = events.findIndex((e) => e.type === "rating");
  assert.ok(idxTerminal !== -1 && idxTerminal < idxRating, "review runs strictly after finalize");
  // The manager's cleanup waited for the settled rating (terminal alone no longer drops the run).
  assert.equal(orchestrator.isActive(run.id), false, "cleaned up after the settled rating");
  // Persisted convergence — what the finished-suite stream route synthesizes its rating event from.
  const persisted = suiteRuns.getRun(run.id);
  assert.equal(persisted.status, "completed", "suite status untouched by the review");
  assert.equal(persisted.ratingState, "rated");
  assert.ok(
    persisted.ratingState !== undefined && isSettledRatingState(persisted.ratingState),
    "a finished suite run always converges on a settled rating state",
  );
});

test("suite AR11: a report-hook crash settles 'failed' — the suite run's own result is untouched", async () => {
  const db = createDatabase();
  const { orchestrator, manager, suiteRuns } = makeOrchestrator(db, async () => {
    throw new Error("report generation exploded");
  });

  const run = orchestrator.startPlanRun(PLAN);
  const events: SuiteRunEvent[] = [];
  manager.subscribe(run.id, (e) => events.push(e));
  await orchestrator.whenSettled(run.id);

  assert.deepEqual(suiteRatings(events), ["rating", "failed"]);
  const persisted = suiteRuns.getRun(run.id);
  assert.equal(persisted.status, "completed", "a review crash never fails the suite run");
  assert.equal(persisted.ratingState, "failed");
});

test("suite AR11: no report hook wired → the axis settles 'skipped' (never a fake rating/rated)", async () => {
  const db = createDatabase();
  const { orchestrator, manager, suiteRuns } = makeOrchestrator(db); // no hook

  const run = orchestrator.startPlanRun(PLAN);
  const events: SuiteRunEvent[] = [];
  manager.subscribe(run.id, (e) => events.push(e));
  await orchestrator.whenSettled(run.id);

  assert.deepEqual(suiteRatings(events), ["skipped"], "one settled event, no 'rating' phase");
  assert.equal(suiteRuns.getRun(run.id).ratingState, "skipped");
  assert.equal(orchestrator.isActive(run.id), false, "cleanup still fires on the settled skipped");
});
