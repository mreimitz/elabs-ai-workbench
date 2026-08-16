import assert from "node:assert/strict";
import crypto from "node:crypto";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { ZodError } from "zod";
import type { RunMode, RunStatus } from "@mcp-token-footprint/shared";
import { applyMigrations, ensureLocalCollection, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { GradeRepository } from "../src/grading/grade-repository.js";
import { CollectionRepository } from "../src/collections/repository.js";
import { CollectionService } from "../src/collections/service.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import {
  SuiteOrchestrator,
  type SuiteRunStarter,
  type SuiteRunStopper,
} from "../src/suites/orchestrator.js";
import { registerRunPlanRoutes } from "../src/suites/plan-routes.js";
import { SuiteRepository } from "../src/suites/repository.js";
import { SuiteRunManager } from "../src/suites/suite-run-manager.js";
import { SuiteRunRepository } from "../src/suites/suite-run-repository.js";
import { SuiteService } from "../src/suites/service.js";
import type { RunHandle } from "../src/testing/run-service.js";
import { RunRepository } from "../src/testing/run-repository.js";
import { TestRepository } from "../src/testing/test-repository.js";
import { TestService } from "../src/testing/test-service.js";
import { toErrorMessage } from "../src/utils/errors.js";

// Testing IA (WP 2.2, D-T5) — the ONE execution engine surfaced as POST /api/run-plans. A plan from any
// of the three sources (suite · collection · adhoc) must produce a NORMAL suite-run through the EXISTING
// orchestrator (`startPlanRun`) — no forked mass-run path. Tested entirely OFFLINE via a STUBBED run
// starter (no providers / MCP): the stub creates real `runs` rows so the linkage/aggregation reads hit
// persisted state, so member equivalence, collection-current-at-launch, suite compat, cost-cap parity,
// and the source/plan_json snapshot are all asserted deterministically.

const apps: FastifyInstance[] = [];
const databases: AppDatabase[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const db of databases.splice(0)) db.close();
});

const NOW = "2026-07-05T00:00:00.000Z";

/** A fresh in-memory DB at the latest schema WITH the reserved Local collection seeded (mirrors openDatabase). */
function openFresh(): AppDatabase {
  const db = new Database(":memory:") as unknown as AppDatabase;
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  ensureLocalCollection(db);
  databases.push(db);
  return db;
}

/** Seed a provider + the given scenarios (models/environments); tests are created via the repository. */
function seedProviderAndScenarios(db: AppDatabase, scenarioIds: string[]): void {
  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, api_key_encrypted, created_at, updated_at)
     VALUES ('prov-1', 'anthropic', 'Claude', 'enc:v1:abc', @now, @now)`,
  ).run({ now: NOW });
  const insertScenario = db.prepare(
    `INSERT INTO scenarios (id, name, provider_id, model, created_at, updated_at)
     VALUES (@id, @name, 'prov-1', 'claude-sonnet-4', @now, @now)`,
  );
  for (const id of scenarioIds) insertScenario.run({ id, name: `Scenario ${id}`, now: NOW });
}

// ── Stubbed run starter (offline) ─────────────────────────────────────────────────────────────────

type FinishArgs = { status?: RunStatus; costUsd?: number };

type StubHandle = { runId: string; finished: boolean; finish: (args?: FinishArgs) => void };

type Stub = {
  startRun: SuiteRunStarter;
  stopRun: SuiteRunStopper;
  readonly started: string[];
  readonly pending: StubHandle[];
  handle(runId: string): StubHandle;
};

/** A stub run starter that creates real `runs` rows and hands back handles the test resolves on command. */
function makeStub(db: AppDatabase): Stub {
  const started: string[] = [];
  const pending: StubHandle[] = [];
  const byRunId = new Map<string, StubHandle>();

  const startRun: SuiteRunStarter = (
    testId: string,
    scenarioId: string,
    mode: RunMode,
  ): RunHandle => {
    const runId = nanoid();
    db.prepare(
      `INSERT INTO runs (id, test_id, scenario_id, mode, status, started_at)
       VALUES (@id, @testId, @scenarioId, @mode, 'running', @now)`,
    ).run({ id: runId, testId, scenarioId, mode, now: NOW });
    started.push(runId);

    let resolveDone!: (result: Awaited<RunHandle["done"]>) => void;
    const done = new Promise<Awaited<RunHandle["done"]>>((resolve) => {
      resolveDone = resolve;
    });
    const handle: StubHandle = {
      runId,
      finished: false,
      finish: (args: FinishArgs = {}) => {
        if (handle.finished) return;
        handle.finished = true;
        const status = args.status ?? "completed";
        const costUsd = args.costUsd ?? 0;
        db.prepare(
          `UPDATE runs SET status = @status, outcome = @outcome, cost_usd = @cost, duration_ms = 0 WHERE id = @id`,
        ).run({
          id: runId,
          status,
          outcome: status === "completed" ? "completed" : "error",
          cost: costUsd,
        });
        const idx = pending.indexOf(handle);
        if (idx >= 0) pending.splice(idx, 1);
        resolveDone({
          status,
          outcome: status === "completed" ? "completed" : "error",
          turns: 0,
          toolCalls: 0,
          tokensIn: 0,
          tokensOut: 0,
        });
      },
    };
    byRunId.set(runId, handle);
    pending.push(handle);
    return { runId, mode, done };
  };

  const stopRun: SuiteRunStopper = (runId: string) => {
    const handle = byRunId.get(runId);
    if (!handle || handle.finished) throw new Error("run is not active");
    handle.finish({ status: "aborted", costUsd: 0 });
  };

  return {
    startRun,
    stopRun,
    started,
    pending,
    handle: (runId: string) => {
      const h = byRunId.get(runId);
      if (!h) throw new Error(`no stub handle for ${runId}`);
      return h;
    },
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

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

type Harness = {
  db: AppDatabase;
  app: FastifyInstance;
  orchestrator: SuiteOrchestrator;
  stub: Stub;
  suiteRuns: SuiteRunRepository;
  suites: SuiteService;
  suiteRepo: SuiteRepository;
  collections: CollectionRepository;
  tests: TestRepository;
};

/** Build the full run-plan stack: a stubbed orchestrator + a Fastify app wired to POST /api/run-plans. */
async function harness(): Promise<Harness> {
  const db = openFresh();
  const suiteRepo = new SuiteRepository(db);
  const suites = new SuiteService(suiteRepo);
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
    suiteRepo,
    grades,
    manager,
  );

  const secrets = new SecretStore(crypto.randomBytes(32));
  const collections = new CollectionRepository(db, secrets);
  const testRepo = new TestRepository(db);
  const testService = new TestService(testRepo);

  const app = Fastify();
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: "Validation failed" });
    const typed = error as Error & { statusCode?: number; code?: string };
    return reply.code(typed.statusCode ?? 500).send({ error: toErrorMessage(error) });
  });
  await registerRunPlanRoutes(app, orchestrator, {
    suites,
    collections: new CollectionService(collections),
    tests: testService,
  });
  await app.ready();
  apps.push(app);

  return {
    db,
    app,
    orchestrator,
    stub,
    suiteRuns,
    suites,
    suiteRepo,
    collections,
    tests: testRepo,
  };
}

/** POST a run plan; returns the parsed { statusCode, suiteRun } for a 202, or { statusCode, body } for an error. */
async function postPlan(app: FastifyInstance, payload: unknown) {
  const res = await app.inject({ method: "POST", url: "/api/run-plans", payload });
  return { statusCode: res.statusCode, body: JSON.parse(res.body) };
}

/** The `test::scenario` pairs (with counts) of every child run linked to a suite run — the executed matrix. */
function memberPairs(db: AppDatabase, suiteRunId: string): Array<{ pair: string; n: number }> {
  return (
    db
      .prepare(
        "SELECT test_id, scenario_id, COUNT(*) AS n FROM runs WHERE suite_run_id = ? GROUP BY test_id, scenario_id",
      )
      .all(suiteRunId) as Array<{ test_id: string; scenario_id: string; n: number }>
  )
    .map((row) => ({ pair: `${row.test_id}::${row.scenario_id}`, n: row.n }))
    .sort((a, b) => a.pair.localeCompare(b.pair));
}

function suiteRunRow(
  db: AppDatabase,
  id: string,
): { suite_id: string | null; source: string | null; plan_json: string | null } {
  return db.prepare("SELECT suite_id, source, plan_json FROM suite_runs WHERE id = ?").get(id) as {
    suite_id: string | null;
    source: string | null;
    plan_json: string | null;
  };
}

// ── (1) adhoc source — explicit tests × scenarios; no suite; source + plan_json snapshotted ─────────

test("source:adhoc runs the explicit tests × scenarios as a suite-run with no owning suite", async () => {
  const h = await harness();
  seedProviderAndScenarios(h.db, ["scn-a"]);
  const t1 = h.tests.create({ name: "T1", userPrompt: "p" });
  const t2 = h.tests.create({ name: "T2", userPrompt: "p" });

  const { statusCode, body } = await postPlan(h.app, {
    source: "adhoc",
    testIds: [t1.id, t2.id],
    scenarioIds: ["scn-a"],
  });
  assert.equal(statusCode, 202, "adhoc plan returns the running suite run with 202");
  assert.equal(body.source, "adhoc");
  assert.equal(body.suiteId, undefined, "an adhoc run has no owning suite");
  assert.equal(body.status, "running");

  await drain(h.orchestrator, h.stub, body.id);

  // Members equal the plan: 2 tests × 1 scenario × 1 rep = 2 pairs, each once (order-independent).
  assert.deepEqual(
    memberPairs(h.db, body.id),
    [
      { pair: `${t1.id}::scn-a`, n: 1 },
      { pair: `${t2.id}::scn-a`, n: 1 },
    ].sort((a, b) => a.pair.localeCompare(b.pair)),
  );
  const finished = h.suiteRuns.getRun(body.id);
  assert.equal(finished.status, "completed");
  assert.equal(finished.aggregates?.cellsTotal, 2);

  // The suite_runs row persists source + the serialized plan; suite_id stays NULL.
  const row = suiteRunRow(h.db, body.id);
  assert.equal(row.suite_id, null, "no Suite row created for an adhoc plan");
  assert.equal(row.source, "adhoc");
  assert.ok(row.plan_json, "adhoc plan is snapshotted onto plan_json");
  const plan = JSON.parse(row.plan_json as string);
  assert.equal(plan.source, "adhoc");
  assert.deepEqual(plan.testIds, [t1.id, t2.id]);
});

// ── (2) collection source — every CURRENT test of the collection × the chosen scenarios ─────────────

test("source:collection runs all of the collection's tests × scenarios", async () => {
  const h = await harness();
  seedProviderAndScenarios(h.db, ["scn-a", "scn-b"]);
  const col = h.collections.create({ name: "Bench set" });
  const t1 = h.tests.create({ name: "T1", userPrompt: "p" });
  const t2 = h.tests.create({ name: "T2", userPrompt: "p" });
  const t3 = h.tests.create({ name: "T3", userPrompt: "p" });
  for (const t of [t1, t2, t3]) h.collections.assignTest(col.id, t.id);

  const { statusCode, body } = await postPlan(h.app, {
    source: "collection",
    collectionId: col.id,
    scenarioIds: ["scn-a", "scn-b"],
  });
  assert.equal(statusCode, 202);
  assert.equal(body.source, "collection");
  assert.equal(body.suiteId, undefined);

  await drain(h.orchestrator, h.stub, body.id);

  // 3 tests × 2 scenarios × 1 rep = 6 pairs, each once — every combination present.
  const pairs = memberPairs(h.db, body.id);
  assert.equal(pairs.length, 6, "3 tests × 2 scenarios = 6 members");
  const expected = [t1, t2, t3]
    .flatMap((t) => ["scn-a", "scn-b"].map((s) => `${t.id}::${s}`))
    .sort((a, b) => a.localeCompare(b));
  assert.deepEqual(
    pairs.map((p) => p.pair),
    expected,
  );
  assert.ok(
    pairs.every((p) => p.n === 1),
    "each test × scenario cell ran exactly once",
  );

  const row = suiteRunRow(h.db, body.id);
  assert.equal(row.suite_id, null, "no Suite row created for a collection plan");
  assert.equal(row.source, "collection");
  assert.ok(row.plan_json, "collection plan is snapshotted onto plan_json");
});

// ── (3) collection membership is resolved AT LAUNCH — a test added/removed between launches changes the matrix

test("source:collection picks up exactly the collection's CURRENT tests at launch time", async () => {
  const h = await harness();
  seedProviderAndScenarios(h.db, ["scn-a"]);
  const col = h.collections.create({ name: "Evolving set" });
  const t1 = h.tests.create({ name: "T1", userPrompt: "p" });
  const t2 = h.tests.create({ name: "T2", userPrompt: "p" });
  h.collections.assignTest(col.id, t1.id);
  h.collections.assignTest(col.id, t2.id);

  // Launch #1 — 2 members.
  const first = await postPlan(h.app, {
    source: "collection",
    collectionId: col.id,
    scenarioIds: ["scn-a"],
  });
  await drain(h.orchestrator, h.stub, first.body.id);
  assert.deepEqual(
    memberPairs(h.db, first.body.id).map((p) => p.pair),
    [`${t1.id}::scn-a`, `${t2.id}::scn-a`].sort((a, b) => a.localeCompare(b)),
  );

  // Add a third test → next launch sees 3.
  const t3 = h.tests.create({ name: "T3", userPrompt: "p" });
  h.collections.assignTest(col.id, t3.id);
  const second = await postPlan(h.app, {
    source: "collection",
    collectionId: col.id,
    scenarioIds: ["scn-a"],
  });
  await drain(h.orchestrator, h.stub, second.body.id);
  assert.equal(
    memberPairs(h.db, second.body.id).length,
    3,
    "the newly added test joined the matrix",
  );

  // Remove the first test → next launch sees only {t2, t3}.
  h.collections.removeTest(t1.id);
  const third = await postPlan(h.app, {
    source: "collection",
    collectionId: col.id,
    scenarioIds: ["scn-a"],
  });
  await drain(h.orchestrator, h.stub, third.body.id);
  assert.deepEqual(
    memberPairs(h.db, third.body.id).map((p) => p.pair),
    [`${t2.id}::scn-a`, `${t3.id}::scn-a`].sort((a, b) => a.localeCompare(b)),
    "the removed test is gone from the matrix",
  );
});

// ── (4) suite source via POST /api/run-plans — resolves the saved suite's membership + config ───────

test("source:suite runs the saved suite's membership × config with suite_id set and no plan_json", async () => {
  const h = await harness();
  seedProviderAndScenarios(h.db, ["scn-a"]);
  const t1 = h.tests.create({ name: "T1", userPrompt: "p" });
  const suite = h.suiteRepo.create({
    name: "Saved suite",
    config: { repetitions: 2, maxConcurrency: 4 },
    testIds: [t1.id],
    scenarioIds: ["scn-a"],
  });

  const { statusCode, body } = await postPlan(h.app, { source: "suite", suiteId: suite.id });
  assert.equal(statusCode, 202);
  assert.equal(body.source, "suite");
  assert.equal(body.suiteId, suite.id, "a suite plan carries its owning suite id");
  assert.equal(body.configSnapshot.repetitions, 2, "the saved suite's config drove the run");

  await drain(h.orchestrator, h.stub, body.id);

  // 1 test × 1 scenario × 2 reps = 2 members.
  assert.deepEqual(memberPairs(h.db, body.id), [{ pair: `${t1.id}::scn-a`, n: 2 }]);
  const row = suiteRunRow(h.db, body.id);
  assert.equal(row.suite_id, suite.id);
  assert.equal(row.source, "suite");
  assert.equal(row.plan_json, null, "a plain suite run carries no serialized inline plan");
});

// ── (5) plan-time overrides — a plan may tune the same knobs a suite exposes ────────────────────────

test("a plan's repetition override multiplies the matrix", async () => {
  const h = await harness();
  seedProviderAndScenarios(h.db, ["scn-a"]);
  const t1 = h.tests.create({ name: "T1", userPrompt: "p" });

  const { body } = await postPlan(h.app, {
    source: "adhoc",
    testIds: [t1.id],
    scenarioIds: ["scn-a"],
    repetitions: 3,
  });
  await drain(h.orchestrator, h.stub, body.id);
  assert.deepEqual(
    memberPairs(h.db, body.id),
    [{ pair: `${t1.id}::scn-a`, n: 3 }],
    "3 repetitions of the single cell",
  );
  assert.equal(h.suiteRuns.getRun(body.id).configSnapshot.repetitions, 3);
});

// ── (6) COMPAT — the existing startSuiteRun path is unchanged (now delegates through startPlanRun) ──

test("compat: orchestrator.startSuiteRun still runs a suite and stamps source:suite + suite_id", async () => {
  const h = await harness();
  seedProviderAndScenarios(h.db, ["scn-a", "scn-b"]);
  const t1 = h.tests.create({ name: "T1", userPrompt: "p" });
  const t2 = h.tests.create({ name: "T2", userPrompt: "p" });
  const suite = h.suiteRepo.create({
    name: "Compat suite",
    config: { repetitions: 1, maxConcurrency: 8 },
    testIds: [t1.id, t2.id],
    scenarioIds: ["scn-a", "scn-b"],
  });

  // The EXACT call POST /api/suites/:id/run makes today — unchanged signature, unchanged behavior.
  const run = h.orchestrator.startSuiteRun(suite.id);
  assert.equal(run.suiteId, suite.id);
  await drain(h.orchestrator, h.stub, run.id);

  // 2 tests × 2 scenarios × 1 rep = 4 members — the suite matrix, exactly as before WP 2.2.
  assert.equal(memberPairs(h.db, run.id).length, 4);
  const row = suiteRunRow(h.db, run.id);
  assert.equal(row.suite_id, suite.id);
  assert.equal(row.source, "suite", "the compat wrapper stamps source:suite");
  assert.equal(row.plan_json, null);
});

// ── (7) cost-cap parity — the aggregate soft-stop cap behaves identically through a run-plan ────────
//   (Mirrors the existing suite cost-cap test in benchmarks-orchestrator.test.ts, driven via the plan
//    endpoint. The per-run "unpriced model" rejection lives in the run engine — startPlanRun uses the
//    IDENTICAL runService.start path as a suite, so it is inherited unchanged and covered by the engine
//    tests; it is not re-exercisable with a stubbed starter.)

test("cost-cap parity: an adhoc plan soft-stops on the aggregate cost cap exactly like a suite", async () => {
  const h = await harness();
  seedProviderAndScenarios(h.db, ["scn-1"]);
  const t1 = h.tests.create({ name: "T1", userPrompt: "p" });

  // 1 test × 1 scenario × 4 reps = 4 cells; 2 at a time; each run costs $1; cap $1.50.
  const { body } = await postPlan(h.app, {
    source: "adhoc",
    testIds: [t1.id],
    scenarioIds: ["scn-1"],
    repetitions: 4,
    maxConcurrency: 2,
    aggregateCostCapUsd: 1.5,
  });
  assert.equal(h.stub.started.length, 2, "first wave of 2 started");

  // Finish cell #1 ($1 < cap): a freed worker pulls a NEW cell (#3).
  h.stub.handle(h.stub.started[0] as string).finish({ status: "completed", costUsd: 1 });
  await tick();
  assert.equal(h.stub.started.length, 3, "under the cap, the next cell was scheduled");

  // Finish cell #2 ($1 → cumulative $2 ≥ cap): the cap trips → NO new cell; cell #3 stays in flight.
  h.stub.handle(h.stub.started[1] as string).finish({ status: "completed", costUsd: 1 });
  await tick();
  assert.equal(h.stub.started.length, 3, "cap reached → the 4th cell was never scheduled");

  // Let the in-flight cell finish; the run settles as `capped` (partial results are first-class).
  h.stub.handle(h.stub.started[2] as string).finish({ status: "completed", costUsd: 1 });
  await h.orchestrator.whenSettled(body.id);

  const finished = h.suiteRuns.getRun(body.id);
  assert.equal(finished.status, "capped");
  assert.equal(finished.aggregates?.cellsTotal, 4);
  assert.equal(finished.aggregates?.cellsCompleted, 3, "3 of 4 cells ran before the soft stop");
});

// ── (8) honest errors — unknown suite/collection 404, empty collection 400, bad body 400 ────────────

test("unknown suite / unknown or empty collection / malformed body produce honest 4xx", async () => {
  const h = await harness();
  seedProviderAndScenarios(h.db, ["scn-a"]);

  const unknownSuite = await postPlan(h.app, { source: "suite", suiteId: "nope" });
  assert.equal(unknownSuite.statusCode, 404, "unknown suite → 404");

  const unknownCollection = await postPlan(h.app, {
    source: "collection",
    collectionId: "nope",
    scenarioIds: ["scn-a"],
  });
  assert.equal(unknownCollection.statusCode, 404, "unknown collection → 404");

  const empty = h.collections.create({ name: "Empty set" });
  const emptyCollection = await postPlan(h.app, {
    source: "collection",
    collectionId: empty.id,
    scenarioIds: ["scn-a"],
  });
  assert.equal(
    emptyCollection.statusCode,
    400,
    "a collection with no tests → 400, never a fake empty run",
  );
  assert.equal(h.stub.started.length, 0, "nothing was scheduled for the rejected plan");

  const badBody = await postPlan(h.app, { source: "adhoc", scenarioIds: ["scn-a"] }); // missing testIds
  assert.equal(badBody.statusCode, 400, "a malformed plan body is a zod 400");
});
