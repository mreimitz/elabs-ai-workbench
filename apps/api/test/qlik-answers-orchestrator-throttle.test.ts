import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import { nanoid } from "nanoid";
import type { RunMode, RunOutcome, RunStatus, ScenarioInput } from "@mcp-token-footprint/shared";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { GradeRepository } from "../src/grading/grade-repository.js";
import { ProviderRepository } from "../src/providers/repository.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import {
  QLIK_ANSWERS_MAX_CONCURRENCY,
  SuiteOrchestrator,
  type SuiteRunStarter,
  type SuiteRunStopper,
} from "../src/suites/orchestrator.js";
import { SuiteRepository } from "../src/suites/repository.js";
import { SuiteRunManager } from "../src/suites/suite-run-manager.js";
import { SuiteRunRepository } from "../src/suites/suite-run-repository.js";
import type { RunHandle } from "../src/testing/run-service.js";
import { RunRepository } from "../src/testing/run-repository.js";
import { ScenarioRepository } from "../src/testing/scenario-repository.js";
import { TestRepository } from "../src/testing/test-repository.js";

// Qlik Answers (WP 1.5) — the orchestrator's PER-PROVIDER concurrency cap for `qlik_answers` cells
// (research doc §3.4: Qlik invoke/stream is Tier 2, 100 req/min/tenant). Tested entirely OFFLINE via a
// CONTROLLABLE stub run starter (no real runs, no tenant contact): the stub records, per provider
// credential, the live in-flight count and its high-water mark, so the cap + the "no deadlock, every
// cell eventually runs" guarantee + "non-qlik scheduling is UNDISTURBED" are all asserted deterministically.

const databases: AppDatabase[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

const NOW = "2026-07-11T00:00:00.000Z";

function openFresh(): AppDatabase {
  const db = new Database(":memory:") as unknown as AppDatabase;
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  databases.push(db);
  return db;
}

/** Seed one provider credential of the given kind; returns its id. */
function seedProvider(db: AppDatabase, id: string, kind: "qlik_answers" | "anthropic"): string {
  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, base_url, api_key_encrypted, created_at, updated_at)
     VALUES (@id, @kind, @label, @baseUrl, 'enc:v1:abc', @now, @now)`,
  ).run({
    id,
    kind,
    label: id,
    baseUrl: kind === "qlik_answers" ? "https://acme.us.qlikcloud.com" : null,
    now: NOW,
  });
  return id;
}

function scenarioInput(providerId: string, model: string): ScenarioInput {
  return {
    name: `Scenario for ${providerId}`,
    providerId,
    model,
    params: {},
    systemPrompt: "",
    allowedServers: [],
    allowedSkills: [],
    defaultProfiles: ["generic_o200k"],
    guardrails: {},
    toolLoadingMode: "eager",
  };
}

function seedTest(db: AppDatabase, id: string): void {
  db.prepare(
    `INSERT INTO tests (id, name, user_prompt, created_at, updated_at)
     VALUES (@id, @name, 'Do the thing.', @now, @now)`,
  ).run({ id, name: `Test ${id}`, now: NOW });
}

// ── Controllable stub run starter — records per-provider in-flight + its high-water mark ───────────

type FinishArgs = { status?: RunStatus; costUsd?: number };
type StubHandle = { runId: string; finished: boolean; finish: (args?: FinishArgs) => void };

function outcomeFor(status: RunStatus): RunOutcome {
  if (status === "completed") return "completed";
  if (status === "aborted") return "aborted";
  return "error";
}

type Stub = {
  startRun: SuiteRunStarter;
  stopRun: SuiteRunStopper;
  /** Every started run id, in start order (proves nothing is skipped/dropped). */
  readonly started: string[];
  /** Not-yet-finished handles, so a test can drain them progressively. */
  readonly pending: StubHandle[];
  handle(runId: string): StubHandle;
  /** Live in-flight count across ALL scenarios (qlik + non-qlik) — proves the overall pool still works. */
  readonly totalInFlight: number;
  readonly maxTotalInFlight: number;
  maxInFlightForProvider(providerId: string): number;
};

/** `scenarioId -> providerId` so the stub can attribute an in-flight cell to its provider credential. */
function makeThrottleStub(db: AppDatabase, scenarioProvider: ReadonlyMap<string, string>): Stub {
  let totalInFlight = 0;
  let maxTotalInFlight = 0;
  const inFlightByProvider = new Map<string, number>();
  const maxInFlightByProvider = new Map<string, number>();
  const started: string[] = [];
  const pending: StubHandle[] = [];
  const byRunId = new Map<string, StubHandle>();

  const startRun: SuiteRunStarter = (testId: string, scenarioId: string, mode: RunMode): RunHandle => {
    const runId = nanoid();
    db.prepare(
      `INSERT INTO runs (id, test_id, scenario_id, mode, status, started_at)
       VALUES (@id, @testId, @scenarioId, @mode, 'running', @now)`,
    ).run({ id: runId, testId, scenarioId, mode, now: NOW });

    totalInFlight += 1;
    maxTotalInFlight = Math.max(maxTotalInFlight, totalInFlight);
    started.push(runId);

    const providerId = scenarioProvider.get(scenarioId);
    if (providerId !== undefined) {
      const next = (inFlightByProvider.get(providerId) ?? 0) + 1;
      inFlightByProvider.set(providerId, next);
      maxInFlightByProvider.set(providerId, Math.max(maxInFlightByProvider.get(providerId) ?? 0, next));
    }

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
        ).run({ id: runId, status, outcome: outcomeFor(status), cost: costUsd });
        totalInFlight -= 1;
        if (providerId !== undefined) {
          inFlightByProvider.set(providerId, (inFlightByProvider.get(providerId) ?? 1) - 1);
        }
        const idx = pending.indexOf(handle);
        if (idx >= 0) pending.splice(idx, 1);
        resolveDone({
          status,
          outcome: outcomeFor(status),
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
    get totalInFlight() {
      return totalInFlight;
    },
    get maxTotalInFlight() {
      return maxTotalInFlight;
    },
    maxInFlightForProvider: (providerId: string) => maxInFlightByProvider.get(providerId) ?? 0,
    handle: (runId: string) => {
      const h = byRunId.get(runId);
      if (!h) throw new Error(`no stub handle for ${runId}`);
      return h;
    },
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Finish every pending stub handle each tick until the suite run settles (bounded so a real deadlock hangs the test, not the CI runner forever). */
async function drain(orchestrator: SuiteOrchestrator, stub: Stub, suiteRunId: string): Promise<void> {
  const settled = orchestrator.whenSettled(suiteRunId);
  let done = false;
  void settled.then(() => {
    done = true;
  });
  let guard = 0;
  while (!done && guard++ < 1000) {
    await tick();
    for (const handle of [...stub.pending]) handle.finish({ status: "completed" });
  }
  assert.ok(done, "the suite run settled within the bounded drain loop (no deadlock)");
  await settled;
}

/** The full orchestrator stack wired with the D-QA6 `compat` deps (scenarios/tests/providers) — the
 * SAME dependency bundle the WP 1.5 cap reads to resolve a cell's provider kind/id. */
function harness(
  db: AppDatabase,
  scenarioProvider: ReadonlyMap<string, string>,
): {
  orchestrator: SuiteOrchestrator;
  stub: Stub;
  suiteRuns: SuiteRunRepository;
  suiteRepo: SuiteRepository;
} {
  const scenarioRepo = new ScenarioRepository(db);
  const testRepo = new TestRepository(db);
  const providers = new ProviderRepository(db, new SecretStore(Buffer.alloc(32, 7)));
  const suiteRepo = new SuiteRepository(db);
  const suiteRuns = new SuiteRunRepository(db);
  const grades = new GradeRepository(db);
  const runs = new RunRepository(db);
  const manager = new SuiteRunManager();
  const stub = makeThrottleStub(db, scenarioProvider);
  const orchestrator = new SuiteOrchestrator(
    stub.startRun,
    stub.stopRun,
    runs,
    suiteRuns,
    suiteRepo,
    grades,
    manager,
    undefined,
    undefined,
    { scenarios: scenarioRepo, tests: testRepo, providers },
  );
  return { orchestrator, stub, suiteRuns, suiteRepo };
}

// ── (1) The cap holds across a mass-run against ONE qlik_answers provider, and the run completes ───

test("qlik_answers cells for the SAME provider never exceed QLIK_ANSWERS_MAX_CONCURRENCY, and every cell eventually runs (no deadlock)", async () => {
  const db = openFresh();
  const qlikProvider = seedProvider(db, "prov-qlik", "qlik_answers");
  const scenarioRepo = new ScenarioRepository(db);
  // 3 DISTINCT scenarios (e.g. 3 different tenant assistants) all bound to the SAME provider credential
  // — a mass-run rarely runs just one scenario, and this also proves the cap is keyed by PROVIDER, not
  // by scenario. `SUITE_MAX_REPETITIONS` caps a single scenario's repetitions at 5, so 3 scenarios ×
  // 5 reps = 15 cells is how the test reaches "well above the cap" within the schema's bounds.
  const scenarios = [
    scenarioRepo.create(scenarioInput(qlikProvider, "asst-1")),
    scenarioRepo.create(scenarioInput(qlikProvider, "asst-2")),
    scenarioRepo.create(scenarioInput(qlikProvider, "asst-3")),
  ];
  seedTest(db, "t1");

  const scenarioProvider = new Map(scenarios.map((s) => [s.id, qlikProvider]));
  const { orchestrator, stub, suiteRuns, suiteRepo } = harness(db, scenarioProvider);

  // 1 test × 3 qlik scenarios (SAME provider) × 5 repetitions (schema max) = 15 cells; a worker pool of
  // 8 (schema max) — well above the cap — so WITHOUT the per-provider throttle the first wave would
  // start all 8 at once, and EVERY remaining cell (all 3 scenarios share the one provider) is capped.
  const suite = suiteRepo.create({
    name: "Qlik mass-run",
    config: { repetitions: 5, maxConcurrency: 8 },
    testIds: ["t1"],
    scenarioIds: scenarios.map((s) => s.id),
  });

  const run = orchestrator.startSuiteRun(suite.id);

  // The very first (synchronous) wave is capped at QLIK_ANSWERS_MAX_CONCURRENCY, NOT maxConcurrency —
  // proving the throttle applies from the first wave, not just eventually. Every OTHER worker in that
  // wave found nothing claimable (every remaining cell shares the same capped provider) and parked.
  assert.equal(
    stub.started.length,
    QLIK_ANSWERS_MAX_CONCURRENCY,
    `first wave holds exactly the qlik_answers cap (${QLIK_ANSWERS_MAX_CONCURRENCY}), not maxConcurrency (8)`,
  );
  assert.equal(stub.totalInFlight, QLIK_ANSWERS_MAX_CONCURRENCY);

  await drain(orchestrator, stub, run.id);

  assert.equal(stub.started.length, 15, "all 15 cells eventually ran — the parked workers were woken");
  assert.ok(
    stub.maxInFlightForProvider(qlikProvider) <= QLIK_ANSWERS_MAX_CONCURRENCY,
    `max observed in-flight for the provider (${stub.maxInFlightForProvider(qlikProvider)}) never exceeded the cap`,
  );

  const finished = suiteRuns.getRun(run.id);
  assert.equal(finished.status, "completed");
  assert.equal(finished.aggregates?.cellsTotal, 15);
  assert.equal(finished.aggregates?.cellsCompleted, 15);
});

// ── (2) A mixed run — qlik_answers cells are capped, non-qlik cells are COMPLETELY unaffected ──────

test("mixed run: the qlik_answers provider is capped while non-qlik cells reach the full maxConcurrency (unaffected, regression check)", async () => {
  const db = openFresh();
  const qlikProvider = seedProvider(db, "prov-qlik", "qlik_answers");
  const anthropicProvider = seedProvider(db, "prov-anthropic", "anthropic");
  const scenarioRepo = new ScenarioRepository(db);
  const qlikScenario = scenarioRepo.create(scenarioInput(qlikProvider, "asst-1"));
  const anthropicScenario = scenarioRepo.create(scenarioInput(anthropicProvider, "claude-sonnet-4"));
  seedTest(db, "t1");

  const scenarioProvider = new Map([
    [qlikScenario.id, qlikProvider],
    [anthropicScenario.id, anthropicProvider],
  ]);
  const { orchestrator, stub, suiteRuns, suiteRepo } = harness(db, scenarioProvider);

  // 1 test × 2 scenarios × 5 repetitions (schema max) = 10 cells; maxConcurrency 8 (schema max — well
  // above the qlik cap of 4), so a shortfall in the qlik lane must be picked up by the anthropic lane —
  // proving the pool isn't globally throttled down to the qlik cap.
  const suite = suiteRepo.create({
    name: "Mixed mass-run",
    config: { repetitions: 5, maxConcurrency: 8 },
    testIds: ["t1"],
    scenarioIds: [qlikScenario.id, anthropicScenario.id],
  });

  const run = orchestrator.startSuiteRun(suite.id);

  // The worker pool still reaches its FULL maxConcurrency (8) overall — it is only the qlik_answers
  // lane that is capped at 4; the remaining 4 slots of the first wave went to the anthropic scenario.
  assert.equal(
    stub.totalInFlight,
    8,
    "the pool reaches full maxConcurrency — non-qlik cells filled the capacity the qlik cap left idle",
  );
  assert.ok(
    stub.maxInFlightForProvider(qlikProvider) <= QLIK_ANSWERS_MAX_CONCURRENCY,
    "the qlik provider itself never exceeded its cap even in the mixed run",
  );

  await drain(orchestrator, stub, run.id);

  assert.equal(stub.started.length, 10, "all 10 cells (both scenarios) eventually ran");
  assert.ok(stub.maxInFlightForProvider(qlikProvider) <= QLIK_ANSWERS_MAX_CONCURRENCY);

  const finished = suiteRuns.getRun(run.id);
  assert.equal(finished.status, "completed");
  assert.equal(finished.aggregates?.cellsCompleted, 10);
});

// ── (3) Two DIFFERENT qlik_answers providers are capped INDEPENDENTLY ───────────────────────────────

test("two different qlik_answers provider credentials are capped independently of each other", async () => {
  const db = openFresh();
  const providerA = seedProvider(db, "prov-qlik-a", "qlik_answers");
  const providerB = seedProvider(db, "prov-qlik-b", "qlik_answers");
  const scenarioRepo = new ScenarioRepository(db);
  const scenarioA = scenarioRepo.create(scenarioInput(providerA, "asst-a"));
  const scenarioB = scenarioRepo.create(scenarioInput(providerB, "asst-b"));
  seedTest(db, "t1");

  const scenarioProvider = new Map([
    [scenarioA.id, providerA],
    [scenarioB.id, providerB],
  ]);
  const { orchestrator, stub, suiteRuns, suiteRepo } = harness(db, scenarioProvider);

  // 1 test × 2 DISTINCT qlik providers × 5 repetitions (schema max) = 10 cells; maxConcurrency 8 (schema
  // max — exactly the two providers' COMBINED cap of 8) — each provider should independently saturate at
  // 4 in flight (8 total), never one provider alone soaking up more than its own cap.
  const suite = suiteRepo.create({
    name: "Two-tenant mass-run",
    config: { repetitions: 5, maxConcurrency: 8 },
    testIds: ["t1"],
    scenarioIds: [scenarioA.id, scenarioB.id],
  });

  const run = orchestrator.startSuiteRun(suite.id);

  assert.equal(
    stub.totalInFlight,
    QLIK_ANSWERS_MAX_CONCURRENCY * 2,
    "both providers' caps are saturated independently — 4 + 4 = 8 in flight",
  );

  await drain(orchestrator, stub, run.id);

  assert.equal(stub.started.length, 10, "all 10 cells across both tenants eventually ran");
  assert.ok(stub.maxInFlightForProvider(providerA) <= QLIK_ANSWERS_MAX_CONCURRENCY);
  assert.ok(stub.maxInFlightForProvider(providerB) <= QLIK_ANSWERS_MAX_CONCURRENCY);

  const finished = suiteRuns.getRun(run.id);
  assert.equal(finished.status, "completed");
  assert.equal(finished.aggregates?.cellsCompleted, 10);
});
