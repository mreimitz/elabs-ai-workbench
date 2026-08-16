import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, before, test } from "node:test";
import Database from "better-sqlite3";
import { nanoid } from "nanoid";
import {
  COLLECTION_FILE_FORMAT_VERSION,
  REPO_NOT_BOUND_CODE,
  type RunMode,
  type RunStatus,
} from "@mcp-token-footprint/shared";
import { CollectionGitSyncService } from "../src/collections/git-sync.js";
import { CollectionRepository } from "../src/collections/repository.js";
import { serializeFile } from "../src/collections/serializer.js";
import { CollectionService } from "../src/collections/service.js";
import { applyMigrations, ensureLocalCollection, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { GradeRepository } from "../src/grading/grade-repository.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import {
  SuiteOrchestrator,
  type SuiteRunStarter,
  type SuiteRunStopper,
} from "../src/suites/orchestrator.js";
import { resolveRunPlan } from "../src/suites/plan-routes.js";
import { SuiteRepository } from "../src/suites/repository.js";
import { SuiteRunManager } from "../src/suites/suite-run-manager.js";
import { SuiteRunRepository } from "../src/suites/suite-run-repository.js";
import { SuiteService } from "../src/suites/service.js";
import type { RunHandle } from "../src/testing/run-service.js";
import { RunRepository } from "../src/testing/run-repository.js";
import { TestRepository } from "../src/testing/test-repository.js";
import { TestService } from "../src/testing/test-service.js";

// Testing IA (WP 4.1) — the INTEGRATED end-to-end proofs the WP 2.1/2.2 unit tests don't cover, driven
// entirely OFFLINE (a STUBBED run starter — no providers/MCP; every git "remote" is a local `git init
// --bare` exposed as a `file://` URL — no network):
//   (2) Local lifecycle: create a LOCAL collection → add tests → run it as source:'collection' through the
//       REAL resolveRunPlan + orchestrator.startPlanRun → members = tests × scenarios. Then bind a `file://`
//       bare repo and confirm the existing offline sync pushes the members unchanged.
//   (3) Unbound honesty: sync/status/resolve on a LOCAL (unbound) collection → 400 REPO_NOT_BOUND. Asserted
//       here as the natural precondition of the lifecycle; the DEDICATED service+route coverage of all three
//       verbs lives in `collections-local.test.ts` (not duplicated wholesale).
//   (4) Plan equivalence: the SAME tests × scenarios × reps launched via source:'suite' and via source:'adhoc'
//       (both through resolveRunPlan → startPlanRun) produce equivalently-shaped suite-runs (member count +
//       pairing + accounting), differing only in the expected source/suite_id metadata.

const databases: AppDatabase[] = [];
const orchestrators: SuiteOrchestrator[] = [];
const tmpRoots: string[] = [];
let gitAvailable = false;

before(() => {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    gitAvailable = true;
  } catch {
    gitAvailable = false;
  }
});

afterEach(() => {
  orchestrators.splice(0);
  for (const db of databases.splice(0)) db.close();
  for (const dir of tmpRoots.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch {
      // ignore — ephemeral temp dir
    }
  }
});

const NOW = "2026-07-05T00:00:00.000Z";

function mkTmp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpRoots.push(dir);
  return dir;
}

/** Run git with a fixed neutral identity (test-side remote setup only). */
function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Seed",
      GIT_AUTHOR_EMAIL: "seed@example.com",
      GIT_COMMITTER_NAME: "Seed",
      GIT_COMMITTER_EMAIL: "seed@example.com",
      GIT_TERMINAL_PROMPT: "0",
    },
  });
}

/** A fresh bare repo (default branch `main`), returned as a `file://` URL (the existing sync-E2E pattern). */
function initBareRemote(): string {
  const dir = mkTmp("ia-e2e-remote-");
  git(dir, ["init", "--bare", "-b", "main"]);
  return pathToFileURL(dir).toString();
}

/** Clone the bare remote read-only and return the file at `relPath` (or undefined if absent). */
function readRemoteFile(remoteUrl: string, relPath: string): string | undefined {
  const wt = mkTmp("ia-e2e-read-");
  git(path.dirname(wt), ["clone", "-q", remoteUrl, wt]);
  const abs = path.join(wt, ...relPath.split("/"));
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : undefined;
}

/** A minimal on-disk TestFile JSON, byte-identical to what the engine exporter emits for a plain test. */
function testFileJson(externalKey: string, name: string, userPrompt: string): string {
  return serializeFile({
    formatVersion: COLLECTION_FILE_FORMAT_VERSION,
    externalKey,
    name,
    userPrompt,
    tags: [],
    addedProfiles: [],
  });
}

function externalKeyOf(db: AppDatabase, testId: string): string {
  const row = db.prepare("SELECT external_key FROM tests WHERE id = ?").get(testId) as {
    external_key: string | null;
  };
  return row.external_key ?? "";
}

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

/** Seed a provider + the given scenarios so the stub's `runs` rows satisfy the scenario FK. */
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

// ── Stubbed run starter (offline) — creates real `runs` rows so linkage/aggregation read persisted state ──

type StubHandle = { runId: string; finished: boolean; finish: (costUsd?: number) => void };

type Stub = {
  startRun: SuiteRunStarter;
  stopRun: SuiteRunStopper;
  readonly pending: StubHandle[];
};

function makeStub(db: AppDatabase): Stub {
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

    let resolveDone!: (result: Awaited<RunHandle["done"]>) => void;
    const done = new Promise<Awaited<RunHandle["done"]>>((resolve) => {
      resolveDone = resolve;
    });
    const handle: StubHandle = {
      runId,
      finished: false,
      finish: (costUsd = 0) => {
        if (handle.finished) return;
        handle.finished = true;
        db.prepare(
          `UPDATE runs SET status = 'completed', outcome = 'completed', cost_usd = @cost, duration_ms = 0 WHERE id = @id`,
        ).run({ id: runId, cost: costUsd });
        const idx = pending.indexOf(handle);
        if (idx >= 0) pending.splice(idx, 1);
        resolveDone({
          status: "completed",
          outcome: "completed",
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
    if (handle && !handle.finished) handle.finish(0);
  };

  return { startRun, stopRun, pending };
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
    for (const handle of [...stub.pending]) handle.finish(costUsd);
  }
  await settled;
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

type Harness = {
  db: AppDatabase;
  orchestrator: SuiteOrchestrator;
  stub: Stub;
  suiteRuns: SuiteRunRepository;
  collections: CollectionRepository;
  tests: TestRepository;
  suites: SuiteRepository;
  sync: CollectionGitSyncService;
  deps: { suites: SuiteService; collections: CollectionService; tests: TestService };
};

/** Build the full offline stack: a stubbed orchestrator + the run-plan resolver deps + the git-sync service. */
function harness(): Harness {
  const db = openFresh();
  const secrets = new SecretStore(crypto.randomBytes(32));
  const collections = new CollectionRepository(db, secrets);
  const tests = new TestRepository(db);
  const suites = new SuiteRepository(db);
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
  orchestrators.push(orchestrator);

  const baseDir = mkTmp("ia-e2e-clones-");
  const sync = new CollectionGitSyncService(db, collections, tests, suites, {
    baseDir,
    gitTimeoutMs: 30_000,
  });

  const deps = {
    suites: new SuiteService(suites),
    collections: new CollectionService(collections),
    tests: new TestService(tests),
  };
  return { db, orchestrator, stub, suiteRuns, collections, tests, suites, sync, deps };
}

// ── (2 + 3) Local lifecycle: create LOCAL → add tests → run source:'collection' → members match; unbound honesty ──

test("WP4.1 proof 2 — a LOCAL collection is created, holds tests, and runs as source:'collection' matching its members", async () => {
  const h = harness();
  seedProviderAndScenarios(h.db, ["scn-a", "scn-b"]);

  // Create a LOCAL (unbound) collection and explicitly seed membership (NOT relying on a default —
  // WP 2.3 is changing plain-create to default to Local, so we stamp collection_id ourselves).
  const col = h.collections.create({ name: "My local set" });
  assert.equal(col.repoUrl, null, "the collection starts LOCAL (unbound)");
  assert.equal(col.isDefault, false, "a user-created local collection is not the reserved default");
  const t1 = h.tests.create({ name: "Alpha", userPrompt: "do alpha" });
  const t2 = h.tests.create({ name: "Beta", userPrompt: "do beta" });
  h.collections.assignTest(col.id, t1.id);
  h.collections.assignTest(col.id, t2.id);
  assert.deepEqual(
    h.tests.listIdsByCollection(col.id).slice().sort(),
    [t1.id, t2.id].slice().sort(),
    "both tests are members of the local collection",
  );

  // (3) UNBOUND HONESTY — while LOCAL, sync/status/resolve all refuse with an honest 400 REPO_NOT_BOUND.
  // (The dedicated service + route coverage of all three verbs is in collections-local.test.ts.)
  for (const call of [
    () => h.sync.sync(col.id),
    () => h.sync.status(col.id),
    () => h.sync.resolve(col.id, []),
  ]) {
    await assert.rejects(call, (err: Error & { statusCode?: number; code?: string }) => {
      assert.equal(
        err.statusCode,
        400,
        "an unbound sync/status/resolve is an honest 400, never a fake success",
      );
      assert.equal(err.code, REPO_NOT_BOUND_CODE, "carries the shared REPO_NOT_BOUND code");
      return true;
    });
  }

  // Run the LOCAL collection through the REAL resolver + orchestrator (source:'collection').
  const plan = resolveRunPlan(
    { source: "collection", collectionId: col.id, scenarioIds: ["scn-a", "scn-b"] },
    h.deps,
  );
  assert.equal(plan.suiteId, null, "a collection plan creates no owning Suite row");
  assert.deepEqual(
    plan.testIds.slice().sort(),
    [t1.id, t2.id].slice().sort(),
    "the plan resolved the collection's current tests",
  );
  const suiteRun = h.orchestrator.startPlanRun(plan);
  assert.equal(suiteRun.source, "collection");
  assert.equal(suiteRun.status, "running");

  await drain(h.orchestrator, h.stub, suiteRun.id);

  // Members equal tests × scenarios: 2 tests × 2 scenarios × 1 rep = 4 pairs, each once.
  const pairs = memberPairs(h.db, suiteRun.id);
  assert.equal(pairs.length, 4, "2 tests × 2 scenarios = 4 members");
  const expected = [t1, t2]
    .flatMap((t) => ["scn-a", "scn-b"].map((s) => `${t.id}::${s}`))
    .sort((a, b) => a.localeCompare(b));
  assert.deepEqual(
    pairs.map((p) => p.pair),
    expected,
    "every test × scenario cell ran",
  );
  assert.ok(
    pairs.every((p) => p.n === 1),
    "each cell ran exactly once",
  );

  const finished = h.suiteRuns.getRun(suiteRun.id);
  assert.equal(finished.status, "completed");
  assert.equal(finished.aggregates?.cellsTotal, 4, "the derived aggregates count all four cells");
  assert.equal(finished.aggregates?.cellsCompleted, 4);
});

test(
  "WP4.1 proof 2 (cont.) — bind-later: a LOCAL collection binds a `file://` repo and the existing offline sync pushes its members",
  { skip: !gitAvailable },
  async () => {
    const remoteUrl = initBareRemote();
    const h = harness();

    // A LOCAL collection with one member (explicit membership; not relying on the WP 2.3 default).
    const col = h.collections.create({ name: "Grows up" });
    const t = h.tests.create({ name: "Alpha Test", userPrompt: "do the thing" });
    h.collections.assignTest(col.id, t.id);

    // Before binding, sync is honestly refused (the lifecycle precondition).
    await assert.rejects(
      h.sync.sync(col.id),
      (err: Error & { code?: string }) => err.code === REPO_NOT_BOUND_CODE,
      "unbound sync refused before binding",
    );

    // Bind a real (bare, file://) repo. A `file://` remote is a test stand-in and is now rejected by
    // the https-only `collectionInputSchema` guard (H-1), so the binding is written directly (mirroring
    // the repository's own UPDATE); the EXISTING offline sync flow then pushes the member unchanged.
    h.db
      .prepare(
        "UPDATE collections SET repo_url = ?, repo_path = ?, branch = ?, updated_at = ? WHERE id = ?",
      )
      .run(remoteUrl, "", "main", new Date().toISOString(), col.id);
    const bound = h.collections.get(col.id);
    assert.equal(bound.repoUrl, remoteUrl, "the binding persisted");
    assert.equal(bound.isDefault, false, "binding does not touch the default flag");

    const result = await h.sync.sync(col.id);
    assert.equal(result.status, "pushed", "bind-later sync pushes the member");
    assert.equal(result.state.conflicts.length, 0, "a first push has no conflicts");

    const key = externalKeyOf(h.db, t.id);
    const onRemote = readRemoteFile(remoteUrl, "tests/alpha-test.json");
    assert.ok(onRemote, "the exported file landed on the remote after bind-later");
    assert.equal(
      onRemote,
      testFileJson(key, "Alpha Test", "do the thing"),
      "byte-identical to the engine export",
    );
    assert.ok(
      h.collections.get(col.id).lastSyncedSha,
      "last_synced_sha recorded after the bind-later push",
    );
  },
);

// ── (4) Plan equivalence: the SAME matrix via source:'suite' and source:'adhoc' → equivalently shaped ──

test("WP4.1 proof 4 — the same tests × scenarios × reps via source:'suite' and source:'adhoc' produce equivalently-shaped suite-runs", async () => {
  const h = harness();
  seedProviderAndScenarios(h.db, ["scn-a", "scn-b"]);
  const t1 = h.tests.create({ name: "T1", userPrompt: "p" });
  const t2 = h.tests.create({ name: "T2", userPrompt: "p" });
  const testIds = [t1.id, t2.id];
  const scenarioIds = ["scn-a", "scn-b"];
  const REPS = 2;
  const COST_PER_CELL = 0.25;

  // A saved suite carrying the exact matrix + reps.
  const suite = h.suites.create({
    name: "Equivalence suite",
    config: { repetitions: REPS, maxConcurrency: 8 },
    testIds,
    scenarioIds,
  });

  // Launch A — source:'suite' via the resolver → orchestrator.
  const suitePlan = resolveRunPlan({ source: "suite", suiteId: suite.id }, h.deps);
  const suiteRunA = h.orchestrator.startPlanRun(suitePlan);
  await drain(h.orchestrator, h.stub, suiteRunA.id, COST_PER_CELL);

  // Launch B — source:'adhoc' with the SAME tests × scenarios × reps via the resolver → orchestrator.
  const adhocPlan = resolveRunPlan(
    { source: "adhoc", testIds, scenarioIds, repetitions: REPS },
    h.deps,
  );
  const suiteRunB = h.orchestrator.startPlanRun(adhocPlan);
  await drain(h.orchestrator, h.stub, suiteRunB.id, COST_PER_CELL);

  // MEMBER COUNT + PAIRING — identical executed matrices (2 tests × 2 scenarios × 2 reps = 4 pairs, each n=2).
  const pairsA = memberPairs(h.db, suiteRunA.id);
  const pairsB = memberPairs(h.db, suiteRunB.id);
  const expected = testIds
    .flatMap((tid) => scenarioIds.map((sid) => ({ pair: `${tid}::${sid}`, n: REPS })))
    .sort((a, b) => a.pair.localeCompare(b.pair));
  assert.deepEqual(pairsA, expected, "the suite matrix is exactly tests × scenarios × reps");
  assert.deepEqual(pairsB, expected, "the adhoc matrix is exactly tests × scenarios × reps");
  assert.deepEqual(pairsA, pairsB, "suite and adhoc executed the IDENTICAL member matrix");

  // ACCOUNTING — the derived aggregates match (cell totals + exec cost); differ only where they SHOULD.
  const aggA = h.suiteRuns.getRun(suiteRunA.id);
  const aggB = h.suiteRuns.getRun(suiteRunB.id);
  assert.equal(aggA.status, "completed");
  assert.equal(aggB.status, "completed");
  assert.equal(aggA.aggregates?.cellsTotal, 8, "8 cells total");
  assert.equal(aggB.aggregates?.cellsTotal, 8);
  assert.equal(
    aggA.aggregates?.cellsCompleted,
    aggB.aggregates?.cellsCompleted,
    "same number of completed cells",
  );
  assert.equal(
    aggA.aggregates?.execCostUsd,
    aggB.aggregates?.execCostUsd,
    "same aggregate exec cost",
  );
  assert.equal(
    aggA.aggregates?.execCostUsd,
    8 * COST_PER_CELL,
    "exec cost = 8 cells × per-cell cost",
  );
  assert.equal(
    aggA.aggregates?.judgeCostUsd,
    aggB.aggregates?.judgeCostUsd,
    "same (zero) judge cost — no grades",
  );

  // METADATA — the two runs differ ONLY where the plan model says they should: a suite run owns a Suite +
  // no inline plan; an adhoc run owns no Suite + snapshots its plan onto plan_json.
  const rowA = h.db
    .prepare("SELECT suite_id, source, plan_json FROM suite_runs WHERE id = ?")
    .get(suiteRunA.id) as {
    suite_id: string | null;
    source: string | null;
    plan_json: string | null;
  };
  const rowB = h.db
    .prepare("SELECT suite_id, source, plan_json FROM suite_runs WHERE id = ?")
    .get(suiteRunB.id) as {
    suite_id: string | null;
    source: string | null;
    plan_json: string | null;
  };
  assert.equal(rowA.source, "suite");
  assert.equal(rowA.suite_id, suite.id, "the suite run carries its owning suite id");
  assert.equal(rowA.plan_json, null, "a suite run snapshots no inline plan");
  assert.equal(rowB.source, "adhoc");
  assert.equal(rowB.suite_id, null, "the adhoc run owns no Suite");
  assert.ok(rowB.plan_json, "the adhoc run snapshots its inline plan");
});
