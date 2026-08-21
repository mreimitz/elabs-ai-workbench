import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { nanoid } from "nanoid";
import { afterEach, test } from "node:test";
import type { RunMode, RunOutcome, RunStatus, SuiteInput } from "@mcp-token-footprint/shared";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { GradeRepository } from "../src/grading/grade-repository.js";
import { SuiteRepository } from "../src/suites/repository.js";
import {
  collectChildData,
  computeSuiteAggregates,
  SuiteOrchestrator,
  type SuiteRunStarter,
  type SuiteRunStopper,
} from "../src/suites/orchestrator.js";
import { SuiteRunManager } from "../src/suites/suite-run-manager.js";
import { SuiteRunRepository } from "../src/suites/suite-run-repository.js";
import type { RunHandle } from "../src/testing/run-service.js";
import { RunRepository } from "../src/testing/run-repository.js";

// WP 3.2 (Benchmarks, B8) — the suite mass-run ORCHESTRATOR, tested entirely OFFLINE via a STUBBED run
// starter (no real runs, no providers, no MCP sessions). The stub creates real `runs` rows so the
// orchestrator's linkage/aggregation reads hit persisted state, and hands back handles the test resolves
// on command — so scheduling, the concurrency bound, the soft-stop cap, stop, and aggregates are all
// asserted deterministically.

const databases: AppDatabase[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

const NOW = "2026-07-04T00:00:00.000Z";

/** A fresh in-memory DB at the latest schema, migrated + stamped (mirrors openDatabase()). */
function openFresh(): AppDatabase {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  databases.push(db);
  return db;
}

/** Seed a provider + scenarios + tests so the runs/suite membership FKs resolve. */
function seedParents(db: AppDatabase, scenarioIds: string[], testIds: string[]): void {
  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, api_key_encrypted, created_at, updated_at)
     VALUES ('prov-1', 'anthropic', 'Claude', 'enc:v1:abc', @now, @now)`,
  ).run({ now: NOW });
  const insertScenario = db.prepare(
    `INSERT INTO scenarios (id, name, provider_id, model, created_at, updated_at)
     VALUES (@id, @name, 'prov-1', 'claude-sonnet-4', @now, @now)`,
  );
  for (const id of scenarioIds) insertScenario.run({ id, name: `Scenario ${id}`, now: NOW });
  const insertTest = db.prepare(
    `INSERT INTO tests (id, name, user_prompt, created_at, updated_at)
     VALUES (@id, @name, 'Do the thing.', @now, @now)`,
  );
  for (const id of testIds) insertTest.run({ id, name: `Test ${id}`, now: NOW });
}

// ── Stubbed run starter (offline) ────────────────────────────────────────────────────────────────

type FinishArgs = { status?: RunStatus; costUsd?: number; tokensIn?: number; tokensOut?: number };

type StubHandle = {
  runId: string;
  testId: string;
  scenarioId: string;
  finished: boolean;
  finish: (args?: FinishArgs) => void;
};

type Stub = {
  startRun: SuiteRunStarter;
  stopRun: SuiteRunStopper;
  /** Live count of started-but-not-yet-finished handles. */
  readonly inFlight: number;
  /** High-water mark of {@link inFlight} across the whole run. */
  readonly maxInFlight: number;
  /** Every started run id, in start order. */
  readonly started: string[];
  /** Per `test::scenario` start count — proves each cell is scheduled exactly once (× repetitions). */
  readonly startCounts: Map<string, number>;
  /** Not-yet-finished handles, FIFO. */
  readonly pending: StubHandle[];
  handle(runId: string): StubHandle;
};

function outcomeFor(status: RunStatus): RunOutcome {
  if (status === "completed") return "completed";
  if (status === "aborted") return "aborted";
  return "error";
}

function makeStub(db: AppDatabase): Stub {
  let inFlight = 0;
  let maxInFlight = 0;
  const started: string[] = [];
  const startCounts = new Map<string, number>();
  const pending: StubHandle[] = [];
  const byRunId = new Map<string, StubHandle>();

  const startRun: SuiteRunStarter = (
    testId: string,
    scenarioId: string,
    mode: RunMode,
  ): RunHandle => {
    const runId = nanoid();
    // Create the real runs row (status running) so linkRunToSuite + getSummary resolve against the DB.
    db.prepare(
      `INSERT INTO runs (id, test_id, scenario_id, mode, status, started_at)
       VALUES (@id, @testId, @scenarioId, @mode, 'running', @now)`,
    ).run({ id: runId, testId, scenarioId, mode, now: NOW });
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    started.push(runId);
    const key = `${testId}::${scenarioId}`;
    startCounts.set(key, (startCounts.get(key) ?? 0) + 1);

    let resolveDone!: (result: Awaited<RunHandle["done"]>) => void;
    const done = new Promise<Awaited<RunHandle["done"]>>((resolve) => {
      resolveDone = resolve;
    });

    const handle: StubHandle = {
      runId,
      testId,
      scenarioId,
      finished: false,
      finish: (args: FinishArgs = {}) => {
        if (handle.finished) return;
        handle.finished = true;
        const status = args.status ?? "completed";
        const costUsd = args.costUsd ?? 0;
        const tokensIn = args.tokensIn ?? 0;
        const tokensOut = args.tokensOut ?? 0;
        // Finalize the run row exactly as the real run finalize would (cost + tokens + terminal status),
        // so the orchestrator reads the true settled cost/tokens for the cap + aggregates.
        db.prepare(
          `UPDATE runs SET status = @status, outcome = @outcome, cost_usd = @cost,
                           tokens_in = @tin, tokens_out = @tout, duration_ms = 0 WHERE id = @id`,
        ).run({
          id: runId,
          status,
          outcome: outcomeFor(status),
          cost: costUsd,
          tin: tokensIn,
          tout: tokensOut,
        });
        inFlight -= 1;
        const idx = pending.indexOf(handle);
        if (idx >= 0) pending.splice(idx, 1);
        resolveDone({
          status,
          outcome: outcomeFor(status),
          turns: 0,
          toolCalls: 0,
          tokensIn,
          tokensOut,
        });
      },
    };
    byRunId.set(runId, handle);
    pending.push(handle);
    return { runId, mode, done };
  };

  // Mirror runService.stop: throws if the run isn't active (already settled). The orchestrator's
  // safeStop swallows that. Aborting an in-flight child finishes it as `aborted` with zero cost.
  const stopRun: SuiteRunStopper = (runId: string) => {
    const handle = byRunId.get(runId);
    if (!handle || handle.finished) throw new Error("run is not active");
    handle.finish({ status: "aborted", costUsd: 0 });
  };

  return {
    startRun,
    stopRun,
    get inFlight() {
      return inFlight;
    },
    get maxInFlight() {
      return maxInFlight;
    },
    started,
    startCounts,
    pending,
    handle: (runId: string) => {
      const h = byRunId.get(runId);
      if (!h) throw new Error(`no stub handle for ${runId}`);
      return h;
    },
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Build an orchestrator over a fresh DB + a suite, returning every handle the test needs. */
function harness(
  db: AppDatabase,
  suiteInput: SuiteInput,
): {
  orchestrator: SuiteOrchestrator;
  stub: Stub;
  suiteRuns: SuiteRunRepository;
  runs: RunRepository;
  grades: GradeRepository;
  suiteId: string;
} {
  const suites = new SuiteRepository(db);
  const suite = suites.create(suiteInput);
  const runs = new RunRepository(db);
  const grades = new GradeRepository(db);
  const suiteRuns = new SuiteRunRepository(db);
  const manager = new SuiteRunManager();
  const stub = makeStub(db);
  const orchestrator = new SuiteOrchestrator(
    stub.startRun,
    stub.stopRun,
    runs,
    suiteRuns,
    suites,
    grades,
    manager,
  );
  return { orchestrator, stub, suiteRuns, runs, grades, suiteId: suite.id };
}

/** Finish every pending stub handle (cost `costUsd` each) each tick until the suite run settles. */
async function drain(
  orchestrator: SuiteOrchestrator,
  stub: Stub,
  suiteRunId: string,
  costUsd = 0,
): Promise<void> {
  const settled = orchestrator.whenSettled(suiteRunId);
  let done = false;
  void settled.then(() => {
    done = true;
  });
  let guard = 0;
  while (!done && guard++ < 1000) {
    await tick();
    for (const handle of [...stub.pending]) handle.finish({ status: "completed", costUsd });
  }
  await settled;
}

function linkedRunCount(db: AppDatabase, suiteRunId: string): number {
  return (
    db.prepare("SELECT COUNT(*) AS n FROM runs WHERE suite_run_id = ?").get(suiteRunId) as {
      n: number;
    }
  ).n;
}

// ── (1) Full matrix scheduled exactly once per cell ──────────────────────────────────────────────

test("schedules every test × scenario × repetition cell exactly once", async () => {
  const db = openFresh();
  seedParents(db, ["scn-a", "scn-b"], ["t1", "t2"]);
  const { orchestrator, stub, suiteRuns, suiteId } = harness(db, {
    name: "Matrix",
    config: { repetitions: 2, maxConcurrency: 8 },
    testIds: ["t1", "t2"],
    scenarioIds: ["scn-a", "scn-b"],
  });

  const run = orchestrator.startSuiteRun(suiteId);
  await drain(orchestrator, stub, run.id);

  // 2 tests × 2 scenarios × 2 reps = 8 cells, each started once.
  assert.equal(stub.started.length, 8, "8 cells started");
  assert.equal(new Set(stub.started).size, 8, "every started run id is unique");
  for (const key of ["t1::scn-a", "t1::scn-b", "t2::scn-a", "t2::scn-b"]) {
    assert.equal(stub.startCounts.get(key), 2, `${key} started once per repetition`);
  }
  // Each cell's run is linked to the suite run with its repetition ordinal.
  assert.equal(linkedRunCount(db, run.id), 8, "all 8 child runs linked to the suite run");
  const reps = db
    .prepare(
      "SELECT repetition, COUNT(*) AS n FROM runs WHERE suite_run_id = ? GROUP BY repetition ORDER BY repetition",
    )
    .all(run.id) as Array<{ repetition: number; n: number }>;
  assert.deepEqual(reps, [
    { repetition: 1, n: 4 },
    { repetition: 2, n: 4 },
  ]);

  const finished = suiteRuns.getRun(run.id);
  assert.equal(finished.status, "completed");
  assert.equal(finished.aggregates?.cellsTotal, 8);
  assert.equal(finished.aggregates?.cellsCompleted, 8);
});

// ── (2) Concurrency bound — in-flight never exceeds config.maxConcurrency ─────────────────────────

test("never runs more than config.maxConcurrency cells in flight", async () => {
  const db = openFresh();
  seedParents(db, ["scn-a", "scn-b"], ["t1", "t2"]);
  const { orchestrator, stub, suiteId } = harness(db, {
    name: "Bounded",
    config: { repetitions: 2, maxConcurrency: 3 },
    testIds: ["t1", "t2"],
    scenarioIds: ["scn-a", "scn-b"],
  });

  const run = orchestrator.startSuiteRun(suiteId);
  // The first wave saturates EXACTLY maxConcurrency (started synchronously by the worker pool) — and no
  // more than that before any cell settles.
  assert.equal(stub.inFlight, 3, "first wave holds exactly maxConcurrency in flight");
  assert.equal(stub.started.length, 3, "no more than maxConcurrency started before any settle");

  await drain(orchestrator, stub, run.id);

  assert.equal(stub.started.length, 8, "all 8 cells eventually ran");
  assert.equal(
    stub.maxInFlight,
    3,
    "in-flight count never exceeded maxConcurrency across the whole run",
  );
});

// ── (3) Soft-stop cost cap — stop scheduling, let in-flight finish, mark capped ───────────────────

test("soft-stops on the aggregate cost cap: no NEW cells, in-flight finish, status capped", async () => {
  const db = openFresh();
  seedParents(db, ["scn-1"], ["t1"]);
  const { orchestrator, stub, suiteRuns, suiteId } = harness(db, {
    name: "Capped",
    // 1 test × 1 scenario × 4 reps = 4 cells; 2 at a time; each run costs $1; cap $1.50.
    config: { repetitions: 4, maxConcurrency: 2, aggregateCostCapUsd: 1.5 },
    testIds: ["t1"],
    scenarioIds: ["scn-1"],
  });

  const run = orchestrator.startSuiteRun(suiteId);
  assert.equal(stub.started.length, 2, "first wave of 2 started");

  // Finish cell #1 ($1 → cumulative $1 < cap): a worker pulls a NEW cell (cell #3).
  stub.handle(stub.started[0] as string).finish({ status: "completed", costUsd: 1 });
  await tick();
  assert.equal(stub.started.length, 3, "under the cap, a freed worker scheduled the next cell");

  // Finish cell #2 ($1 → cumulative $2 ≥ cap $1.5): the cap trips → NO new cell is scheduled, but cell
  // #3 is already IN FLIGHT and must be allowed to finish.
  stub.handle(stub.started[1] as string).finish({ status: "completed", costUsd: 1 });
  await tick();
  assert.equal(stub.started.length, 3, "cap reached → the 4th cell was NEVER scheduled");
  assert.equal(stub.inFlight, 1, "the in-flight cell #3 is still running (not killed)");

  // Let the in-flight cell #3 finish; the suite then settles as `capped`.
  stub.handle(stub.started[2] as string).finish({ status: "completed", costUsd: 1 });
  await orchestrator.whenSettled(run.id);

  const finished = suiteRuns.getRun(run.id);
  assert.equal(finished.status, "capped");
  assert.equal(
    stub.started.length,
    3,
    "exactly 3 of 4 cells ever ran (partial results are first-class)",
  );
  assert.equal(linkedRunCount(db, run.id), 3, "3 partial child runs persisted + linked");
  assert.equal(finished.aggregates?.cellsTotal, 4);
  assert.equal(finished.aggregates?.cellsCompleted, 3);
});

// ── (4) Stop mid-suite — scheduling halts, in-flight aborted, status stopped ──────────────────────

test("stop halts scheduling and aborts in-flight children, finalizing as stopped", async () => {
  const db = openFresh();
  seedParents(db, ["scn-1"], ["t1"]);
  const { orchestrator, stub, suiteRuns, suiteId } = harness(db, {
    name: "Stoppable",
    config: { repetitions: 4, maxConcurrency: 2 },
    testIds: ["t1"],
    scenarioIds: ["scn-1"],
  });

  const run = orchestrator.startSuiteRun(suiteId);
  assert.equal(stub.started.length, 2, "first wave of 2 started");

  orchestrator.stop(run.id);
  await orchestrator.whenSettled(run.id);

  const finished = suiteRuns.getRun(run.id);
  assert.equal(finished.status, "stopped");
  assert.equal(stub.started.length, 2, "no further cells scheduled after stop");
  // The two in-flight children were aborted by the stop.
  const statuses = db
    .prepare("SELECT status FROM runs WHERE suite_run_id = ? ORDER BY id")
    .all(run.id) as Array<{ status: string }>;
  assert.equal(statuses.length, 2);
  assert.ok(
    statuses.every((row) => row.status === "aborted"),
    "in-flight children aborted on stop",
  );
});

// ── (5) Startup orphan reconciliation — running/pending suite_runs → error ────────────────────────

test("reconcileOrphans marks running/pending suite runs as error, leaves terminal ones untouched", () => {
  const db = openFresh();
  seedParents(db, ["scn-1"], ["t1"]);
  const suites = new SuiteRepository(db);
  const suite = suites.create({
    name: "Orphans",
    config: { repetitions: 1, maxConcurrency: 3 },
    testIds: ["t1"],
    scenarioIds: ["scn-1"],
  });
  const insert = db.prepare(
    `INSERT INTO suite_runs (id, suite_id, status, config_snapshot_json, started_at)
     VALUES (@id, @suiteId, @status, '{}', @now)`,
  );
  insert.run({ id: "sr-running", suiteId: suite.id, status: "running", now: NOW });
  insert.run({ id: "sr-pending", suiteId: suite.id, status: "pending", now: NOW });
  insert.run({ id: "sr-done", suiteId: suite.id, status: "completed", now: NOW });

  const suiteRuns = new SuiteRunRepository(db);
  const reconciled = suiteRuns.reconcileOrphans();
  assert.equal(reconciled, 2, "the running + pending suite runs were reconciled");

  assert.equal(suiteRuns.getRun("sr-running").status, "error");
  assert.equal(suiteRuns.getRun("sr-pending").status, "error");
  assert.ok(suiteRuns.getRun("sr-running").endedAt, "reconciled orphan is stamped ended_at");
  assert.equal(
    suiteRuns.getRun("sr-done").status,
    "completed",
    "a terminal suite run is untouched",
  );
});

// ── (6) Aggregates — derived from children + grades; recompute equals the cached snapshot ─────────

test("aggregates match a hand-computed fixture and equal an independent recompute of the cache", async () => {
  const db = openFresh();
  seedParents(db, ["scn-1"], ["t1"]);
  const { orchestrator, stub, suiteRuns, runs, grades, suiteId } = harness(db, {
    name: "Aggregated",
    config: { repetitions: 2, maxConcurrency: 2 },
    testIds: ["t1"],
    scenarioIds: ["scn-1"],
  });

  const run = orchestrator.startSuiteRun(suiteId);
  assert.equal(stub.started.length, 2, "2 cells started");
  const [runA, runB] = stub.started as [string, string];

  // Insert one graded outcome_judge grade per child (score 0.8 and 0.4) with distinct judge costs.
  grades.insert({
    runId: runA,
    graderId: "outcome_judge",
    kind: "llm",
    status: "graded",
    score: 0.8,
    method: "logprob_weighted",
    judgeCostUsd: 0.02,
  });
  grades.insert({
    runId: runB,
    graderId: "outcome_judge",
    kind: "llm",
    status: "graded",
    score: 0.4,
    method: "logprob_weighted",
    judgeCostUsd: 0.03,
  });

  // Finish both with distinct exec cost + tokens.
  stub.handle(runA).finish({ status: "completed", costUsd: 0.1, tokensIn: 100, tokensOut: 50 });
  stub.handle(runB).finish({ status: "completed", costUsd: 0.2, tokensIn: 200, tokensOut: 70 });
  await orchestrator.whenSettled(run.id);

  const aggregates = suiteRuns.getRun(run.id).aggregates;
  assert.ok(aggregates, "aggregates cached on the suite run");

  const approx = (actual: number | null | undefined, expected: number) =>
    assert.ok(
      actual !== null && actual !== undefined && Math.abs(actual - expected) < 1e-9,
      `${actual} ≈ ${expected}`,
    );

  // Hand-computed: scores [0.8, 0.4] → mean 0.6, popStdDev 0.2, passRate 0.5 (1 of 2 ≥ 0.5).
  assert.equal(aggregates?.cellsTotal, 2);
  assert.equal(aggregates?.cellsCompleted, 2);
  approx(aggregates?.meanGrade, 0.6);
  approx(aggregates?.gradeStdDev, 0.2);
  approx(aggregates?.passRateAt05, 0.5);
  approx(aggregates?.totalTokens, 420); // (100+50) + (200+70)
  approx(aggregates?.execCostUsd, 0.3); // 0.1 + 0.2
  approx(aggregates?.judgeCostUsd, 0.05); // 0.02 + 0.03

  // Recompute from persisted children + grades — must equal the cached snapshot exactly (same fn).
  const runIds = suiteRuns.listChildRunIds(run.id);
  const recomputed = computeSuiteAggregates(collectChildData(runs, grades, runIds), 2);
  assert.deepEqual(
    recomputed,
    aggregates,
    "cached aggregates_json is recomputable from children + grades",
  );
});

// ── (7) Delete keeps children — clear suite_run_id linkage, delete only the suite_runs row ────────

test("deleting a suite run KEEPS its child runs (linkage cleared), removes only the suite_runs row", async () => {
  const db = openFresh();
  seedParents(db, ["scn-1"], ["t1"]);
  const { orchestrator, stub, suiteRuns, runs, suiteId } = harness(db, {
    name: "Deletable",
    config: { repetitions: 2, maxConcurrency: 2 },
    testIds: ["t1"],
    scenarioIds: ["scn-1"],
  });

  const run = orchestrator.startSuiteRun(suiteId);
  const childIds = [...stub.started];
  await drain(orchestrator, stub, run.id, 0.05);
  assert.equal(linkedRunCount(db, run.id), 2, "2 children linked before delete");

  orchestrator.delete(run.id);

  // The suite_runs row is gone …
  assert.throws(() => suiteRuns.getRun(run.id), /Suite run not found/);
  // … but BOTH child runs survive, with their suite_run_id (and repetition) linkage cleared.
  assert.equal(linkedRunCount(db, run.id), 0, "no run still points at the deleted suite run");
  for (const runId of childIds) {
    const summary = runs.getSummary(runId);
    assert.equal(summary.status, "completed", "child run still exists after suite-run delete");
    const row = db.prepare("SELECT suite_run_id, repetition FROM runs WHERE id = ?").get(runId) as {
      suite_run_id: string | null;
      repetition: number | null;
    };
    assert.equal(row.suite_run_id, null, "suite_run_id cleared");
    assert.equal(row.repetition, null, "repetition cleared");
  }
});

// ── RM-33 WP 1.2 (D-CT2/D-CT6) — the cache split rolls up ALL-OR-NOTHING ────────────────────────
//
// A suite is exactly where an operator compares totals across runs, so a partial sum is worse than no
// sum: it looks complete while silently omitting whatever it could not read. `totalTokens` (which has
// no unknown state — every run row has NOT NULL tokens_in/out) is untouched by any of this.

test("RM-33 — suite cache totals sum when every member's split is known", () => {
  const aggregates = computeSuiteAggregates(
    [
      {
        runId: "r1",
        status: "completed",
        tokensIn: 1000,
        tokensOut: 100,
        costUsd: 0.1,
        cacheReadTokens: 800,
        cacheWriteTokens: 100,
        outcomeScore: 0.9,
        judgeCostUsd: 0.01,
      },
      {
        runId: "r2",
        status: "completed",
        tokensIn: 500,
        tokensOut: 50,
        costUsd: 0.05,
        cacheReadTokens: 400,
        cacheWriteTokens: 0,
        outcomeScore: 0.8,
        judgeCostUsd: 0.01,
      },
    ],
    2,
  );
  assert.equal(aggregates.cacheReadTokens, 1200);
  assert.equal(aggregates.cacheWriteTokens, 100);
  assert.equal(aggregates.totalTokens, 1650, "totalTokens is untouched by the split (D-CT1)");
});

test("RM-33 — ONE member with an unknown split makes the suite cache total unknown, not partial", () => {
  // The failure mode this prevents: summing only the members that reported would render, say,
  // "1,200 cached" for a matrix whose second member was never measured — a number that reads as the
  // whole matrix and is not. `undefined` forces the surface to say it cannot answer.
  const aggregates = computeSuiteAggregates(
    [
      {
        runId: "r1",
        status: "completed",
        tokensIn: 1000,
        tokensOut: 100,
        costUsd: 0.1,
        cacheReadTokens: 800,
        cacheWriteTokens: 100,
        outcomeScore: 0.9,
        judgeCostUsd: 0.01,
      },
      // A run persisted before migration v59 with nothing to backfill from.
      {
        runId: "r2-legacy",
        status: "completed",
        tokensIn: 500,
        tokensOut: 50,
        costUsd: 0.05,
        outcomeScore: 0.8,
        judgeCostUsd: 0.01,
      },
    ],
    2,
  );
  assert.equal(aggregates.cacheReadTokens, undefined, "unknown, NOT the 800 it could have summed");
  assert.equal(aggregates.cacheWriteTokens, undefined);
  assert.equal(aggregates.totalTokens, 1650, "…while totalTokens still answers, as it always could");
});

test("RM-33 — an empty matrix reports a real zero, not unknown", () => {
  // Nothing ran, so nothing was cached. That is knowable, and `every()` over an empty list gives it
  // to us for free — but it is worth pinning, because the vacuous-truth branch is easy to break.
  const aggregates = computeSuiteAggregates([], 0);
  assert.equal(aggregates.cacheReadTokens, 0);
  assert.equal(aggregates.cacheWriteTokens, 0);
});
