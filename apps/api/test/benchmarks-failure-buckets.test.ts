import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import type { GraderId, JudgeSettings, SuiteConfig } from "@mcp-token-footprint/shared";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import {
  buildFailureClusteringPrompt,
  collectLowScoreReasons,
  FailureBucketService,
  parseFailureBuckets,
} from "../src/grading/failure-buckets.js";
import { GradeRepository } from "../src/grading/grade-repository.js";
import type { JudgeGenerate, JudgeGenerateResult } from "../src/grading/judge.js";
import { estimateCost } from "../src/providers/pricing.js";
import { collectChildData, computeSuiteAggregates } from "../src/suites/orchestrator.js";
import { SuiteRepository } from "../src/suites/repository.js";
import { SuiteRunRepository } from "../src/suites/suite-run-repository.js";
import { RunRepository } from "../src/testing/run-repository.js";

/**
 * WP 3.5 (Benchmarks, B9.4) — the OPT-IN failure-bucket clustering, tested entirely OFFLINE via a STUBBED
 * judge (no provider, no network). Asserts the four load-bearing invariants: membership integrity (a
 * hallucinated / non-low-score member id is dropped, shares sum correctly), cost-on-the-grading-ledger
 * (the clustering cost lands on the derived aggregate judgeCostUsd, NEVER a run's cost, and grades stay
 * byte-identical), re-trigger overwrites (never double-counts, grades untouched), never-unprompted (a
 * static scan that no run/grade/orchestrator source references the module), and the no-failures no-op.
 */

const NOW = "2026-07-04T00:00:00.000Z";
const PRICED_MODEL = "claude-sonnet-4"; // in the pricing table → estimateCost > 0
const USAGE = { inputTokens: 600, outputTokens: 90 };
const CONFIGURED: () => JudgeSettings = () => ({
  providerCredentialId: "prov-1",
  model: PRICED_MODEL,
});
const CONFIG: SuiteConfig = { repetitions: 1, maxConcurrency: 3 };

const databases: AppDatabase[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function openFresh(): AppDatabase {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  databases.push(db);
  return db;
}

/** Seed a provider + one scenario + one test so the child-run FKs resolve. */
function seedParents(db: AppDatabase): void {
  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, api_key_encrypted, created_at, updated_at)
     VALUES ('prov-1', 'anthropic', 'Claude', 'enc:v1:abc', @now, @now)`,
  ).run({ now: NOW });
  db.prepare(
    `INSERT INTO scenarios (id, name, provider_id, model, created_at, updated_at)
     VALUES ('scn-1', 'Baseline', 'prov-1', 'claude-sonnet-4', @now, @now)`,
  ).run({ now: NOW });
  db.prepare(
    `INSERT INTO tests (id, name, user_prompt, created_at, updated_at)
     VALUES ('t1', 'Test', 'Do the thing.', @now, @now)`,
  ).run({ now: NOW });
}

/** Insert a completed child run already linked to the suite run (with a real exec cost + tokens). */
function insertChildRun(
  db: AppDatabase,
  opts: { id: string; suiteRunId: string; costUsd: number },
): void {
  db.prepare(
    `INSERT INTO runs (id, test_id, scenario_id, mode, status, outcome, started_at, cost_usd, tokens_in, tokens_out, suite_run_id, repetition)
       VALUES (@id, 't1', 'scn-1', 'automated', 'completed', 'completed', @now, @cost, 100, 50, @suiteRunId, 1)`,
  ).run({ id: opts.id, cost: opts.costUsd, suiteRunId: opts.suiteRunId, now: NOW });
}

/** Insert one grade row (outcome_judge by default) carrying an optional judge cost. */
function insertGrade(
  grades: GradeRepository,
  opts: {
    runId: string;
    score: number;
    reasoning: string;
    judgeCostUsd?: number;
    graderId?: GraderId;
  },
): void {
  grades.insert({
    runId: opts.runId,
    graderId: opts.graderId ?? "outcome_judge",
    kind: "llm",
    status: "graded",
    score: opts.score,
    method: "logprob_weighted",
    reasoning: opts.reasoning,
    judgeCostUsd: opts.judgeCostUsd ?? 0,
  });
}

/** A fresh set of repos over the DB. Repos are stateless wrappers, so new instances are fine. */
function repos(db: AppDatabase) {
  return {
    suiteRuns: new SuiteRunRepository(db),
    runs: new RunRepository(db),
    grades: new GradeRepository(db),
  };
}

/** Create the suite + a suite-run row; return its id + the repos. */
function seedSuiteRun(db: AppDatabase): { suiteRunId: string } & ReturnType<typeof repos> {
  const suite = new SuiteRepository(db).create({
    name: "S",
    config: CONFIG,
    testIds: ["t1"],
    scenarioIds: ["scn-1"],
  });
  const r = repos(db);
  const suiteRun = r.suiteRuns.create(suite.id, CONFIG);
  return { suiteRunId: suiteRun.id, ...r };
}

/** Finalize the suite run with DERIVED aggregates (so the merge path overlays a real cached snapshot). */
function finalize(r: ReturnType<typeof repos>, suiteRunId: string, cellsTotal: number): void {
  const childIds = r.suiteRuns.listChildRunIds(suiteRunId);
  const aggregates = computeSuiteAggregates(
    collectChildData(r.runs, r.grades, childIds),
    cellsTotal,
  );
  r.suiteRuns.finalize(suiteRunId, "completed", aggregates);
}

function stubGenerate(result: JudgeGenerateResult): JudgeGenerate {
  return async () => result;
}
const THROW_IF_CALLED: JudgeGenerate = async () => {
  throw new Error("generate must NOT be called");
};

const approx = (actual: number | null | undefined, expected: number, eps = 1e-9): void =>
  assert.ok(
    actual !== null && actual !== undefined && Math.abs(actual - expected) < eps,
    `${actual} ≈ ${expected}`,
  );

// ── (0) Pure parse — membership integrity + fence tolerance + disjoint assignment ─────────────────

test("parseFailureBuckets: fence-tolerant; drops hallucinated + duplicate members; shares over total", () => {
  const valid = new Set(["r1", "r2", "r3"]);
  const text =
    "```json\n" +
    JSON.stringify([
      { label: "A", description: "d", memberRunIds: ["r1", "r2", "nope", "r1"] }, // dup r1 + hallucinated "nope"
      { label: "B", description: "d", memberRunIds: ["r2", "r3"] }, // r2 already assigned to A → only r3 here
    ]) +
    "\n```";
  const buckets = parseFailureBuckets(text, valid);
  assert.equal(buckets.length, 2);
  assert.deepEqual(buckets[0]?.memberRunIds, ["r1", "r2"], "dup + hallucinated dropped");
  assert.deepEqual(buckets[1]?.memberRunIds, ["r3"], "r2 not double-assigned across clusters");
  approx(buckets[0]?.share, 2 / 3);
  approx(buckets[1]?.share, 1 / 3);
  approx(
    buckets.reduce((s, b) => s + b.share, 0),
    1,
  );
});

// ── (1) Clustering parse + membership integrity (end-to-end via the service) ──────────────────────

test("clusters low-score reasons; drops a hallucinated AND a passing-run id; every member is a real low-score run", async () => {
  const db = openFresh();
  seedParents(db);
  const r = seedSuiteRun(db);

  // 3 failing runs + 1 passing run (score ≥ threshold → EXCLUDED from the low-score set).
  for (const id of ["run-1", "run-2", "run-3", "run-4"])
    insertChildRun(db, { id, suiteRunId: r.suiteRunId, costUsd: 0.1 });
  insertGrade(r.grades, {
    runId: "run-1",
    score: 0.2,
    reasoning: "Reported the wrong revenue figure.",
  });
  insertGrade(r.grades, {
    runId: "run-2",
    score: 0.3,
    reasoning: "Invented a tool that does not exist.",
  });
  insertGrade(r.grades, { runId: "run-3", score: 0.1, reasoning: "Produced no final answer." });
  insertGrade(r.grades, { runId: "run-4", score: 0.9, reasoning: "Correct and complete." }); // passing
  finalize(r, r.suiteRunId, 4);

  // The judge references a hallucinated id ("run-999") AND a real-but-PASSING run ("run-4") — both dropped.
  const text = JSON.stringify([
    {
      label: "Wrong value",
      description: "The answer had an incorrect figure.",
      memberRunIds: ["run-1", "run-2", "run-4", "run-999"],
    },
    { label: "No answer", description: "No final answer produced.", memberRunIds: ["run-3"] },
  ]);
  const service = new FailureBucketService({
    ...r,
    resolveJudge: CONFIGURED,
    generate: stubGenerate({ text, usage: USAGE }),
  });

  const updated = await service.analyze(r.suiteRunId);
  const buckets = updated.aggregates?.failureBuckets ?? [];
  assert.equal(buckets.length, 2);

  const lowSet = new Set(["run-1", "run-2", "run-3"]);
  const allMembers = buckets.flatMap((b) => b.memberRunIds);
  assert.ok(!allMembers.includes("run-999"), "hallucinated id dropped");
  assert.ok(!allMembers.includes("run-4"), "a real but non-low-score run id dropped");
  for (const member of allMembers)
    assert.ok(lowSet.has(member), `${member} is a real low-score run`);

  const wrong = buckets.find((b) => b.label === "Wrong value");
  const noAnswer = buckets.find((b) => b.label === "No answer");
  assert.deepEqual(wrong?.memberRunIds, ["run-1", "run-2"]);
  assert.deepEqual(noAnswer?.memberRunIds, ["run-3"]);
  approx(wrong?.share, 2 / 3); // 2 of 3 low-score runs
  approx(noAnswer?.share, 1 / 3);
  approx(
    buckets.reduce((s, b) => s + b.share, 0),
    1,
  );
});

// ── (2) Cost on the GRADING ledger, not run cost; grades byte-identical ───────────────────────────

test("clustering cost lands on the aggregate judge ledger; no run cost_usd changes; grades untouched", async () => {
  const db = openFresh();
  seedParents(db);
  const r = seedSuiteRun(db);

  insertChildRun(db, { id: "run-1", suiteRunId: r.suiteRunId, costUsd: 0.5 });
  insertChildRun(db, { id: "run-2", suiteRunId: r.suiteRunId, costUsd: 0.7 });
  insertGrade(r.grades, { runId: "run-1", score: 0.2, reasoning: "wrong", judgeCostUsd: 0.01 });
  insertGrade(r.grades, { runId: "run-2", score: 0.3, reasoning: "off", judgeCostUsd: 0.02 });
  finalize(r, r.suiteRunId, 2);

  const baseJudgeCost = 0.03; // 0.01 + 0.02 (child grade judge ledger)
  const baseExecCost = 1.2; // 0.5 + 0.7 (run cost)
  const runCostBefore = db.prepare("SELECT id, cost_usd FROM runs ORDER BY id").all();
  const gradesBefore = db.prepare("SELECT * FROM run_grades ORDER BY id").all();

  const text = JSON.stringify([
    { label: "All", description: "d", memberRunIds: ["run-1", "run-2"] },
  ]);
  const service = new FailureBucketService({
    ...r,
    resolveJudge: CONFIGURED,
    generate: stubGenerate({ text, usage: USAGE }),
  });
  const updated = await service.analyze(r.suiteRunId);

  const clusterCost = estimateCost(PRICED_MODEL, USAGE);
  assert.ok(clusterCost > 0, "the priced judge model has a real cost");
  approx(updated.aggregates?.judgeCostUsd, baseJudgeCost + clusterCost); // grading ledger absorbed it
  approx(updated.aggregates?.execCostUsd, baseExecCost); // run/exec cost untouched

  // No run's own cost changed …
  assert.deepEqual(db.prepare("SELECT id, cost_usd FROM runs ORDER BY id").all(), runCostBefore);
  // … and the append-only grade rows are byte-identical (no row added or mutated).
  assert.deepEqual(db.prepare("SELECT * FROM run_grades ORDER BY id").all(), gradesBefore);
});

// ── (3) Re-trigger OVERWRITES the clusters; no double-count; grades untouched ──────────────────────

test("re-triggering overwrites the derived clusters and does not double-count judge cost", async () => {
  const db = openFresh();
  seedParents(db);
  const r = seedSuiteRun(db);

  insertChildRun(db, { id: "run-1", suiteRunId: r.suiteRunId, costUsd: 0.1 });
  insertChildRun(db, { id: "run-2", suiteRunId: r.suiteRunId, costUsd: 0.1 });
  insertGrade(r.grades, { runId: "run-1", score: 0.2, reasoning: "a", judgeCostUsd: 0.01 });
  insertGrade(r.grades, { runId: "run-2", score: 0.3, reasoning: "b", judgeCostUsd: 0.01 });
  finalize(r, r.suiteRunId, 2);

  const gradesBefore = db.prepare("SELECT * FROM run_grades ORDER BY id").all();

  let call = 0;
  const generate: JudgeGenerate = async () => {
    call += 1;
    const clusters =
      call === 1
        ? [{ label: "First", description: "d", memberRunIds: ["run-1", "run-2"] }]
        : [{ label: "Second", description: "d", memberRunIds: ["run-1"] }];
    return { text: JSON.stringify(clusters), usage: USAGE };
  };
  const service = new FailureBucketService({ ...r, resolveJudge: CONFIGURED, generate });

  const first = await service.analyze(r.suiteRunId);
  assert.deepEqual(
    first.aggregates?.failureBuckets?.map((b) => b.label),
    ["First"],
  );
  const judgeAfterFirst = first.aggregates?.judgeCostUsd;

  const second = await service.analyze(r.suiteRunId);
  // Overwritten (not appended): exactly one cluster, the SECOND result.
  assert.equal(second.aggregates?.failureBuckets?.length, 1);
  assert.deepEqual(
    second.aggregates?.failureBuckets?.map((b) => b.label),
    ["Second"],
  );
  // Judge cost is base + ONE clustering call, not two (base is recomputed each trigger).
  approx(second.aggregates?.judgeCostUsd, judgeAfterFirst ?? 0);
  approx(second.aggregates?.judgeCostUsd, 0.02 + estimateCost(PRICED_MODEL, USAGE));
  // Append-only grades are byte-identical before/after both triggers.
  assert.deepEqual(db.prepare("SELECT * FROM run_grades ORDER BY id").all(), gradesBefore);
});

// ── (4) Never unprompted — a static scan that no lifecycle source invokes the clustering ──────────

test("no auto-trigger path exists: only the suite route invokes failure-bucket clustering", () => {
  const srcRoot = new URL("../src/", import.meta.url);
  const lifecycleFiles = [
    "suites/orchestrator.ts",
    "testing/run-service.ts",
    "grading/grade-service.ts",
  ];
  for (const rel of lifecycleFiles) {
    const content = readFileSync(new URL(rel, srcRoot), "utf8");
    assert.ok(
      !content.includes("failure-buckets"),
      `${rel} must not import the failure-buckets module`,
    );
    assert.ok(
      !content.includes("FailureBucketService"),
      `${rel} must not construct the failure-bucket service`,
    );
    assert.ok(
      !content.includes("failureBuckets"),
      `${rel} must not reference the derived failureBuckets`,
    );
  }
  // Positive control: the explicit route IS the sole caller of analyze().
  const routes = readFileSync(new URL("suites/routes.ts", srcRoot), "utf8");
  assert.ok(routes.includes("/failure-buckets"), "the suite route registers the explicit trigger");
  assert.ok(/failureBuckets\.analyze\(/.test(routes), "the route is the caller of analyze()");
});

// ── (5) No low-score grades → an empty taxonomy with NO judge call ────────────────────────────────

test("no low-score grades → an empty taxonomy and NO judge call (throwing stub is never invoked)", async () => {
  const db = openFresh();
  seedParents(db);
  const r = seedSuiteRun(db);

  insertChildRun(db, { id: "run-1", suiteRunId: r.suiteRunId, costUsd: 0.1 });
  insertChildRun(db, { id: "run-2", suiteRunId: r.suiteRunId, costUsd: 0.1 });
  // Both runs PASS (score ≥ threshold) → nothing to cluster.
  insertGrade(r.grades, { runId: "run-1", score: 0.8, reasoning: "good", judgeCostUsd: 0.01 });
  insertGrade(r.grades, { runId: "run-2", score: 0.9, reasoning: "great", judgeCostUsd: 0.02 });
  finalize(r, r.suiteRunId, 2);

  // No low-score reasons → collector returns none, so the (throwing) judge is never called.
  assert.equal(
    collectLowScoreReasons(r.grades, r.suiteRuns.listChildRunIds(r.suiteRunId)).length,
    0,
  );

  const service = new FailureBucketService({
    ...r,
    resolveJudge: CONFIGURED,
    generate: THROW_IF_CALLED,
  });
  const updated = await service.analyze(r.suiteRunId);

  assert.deepEqual(updated.aggregates?.failureBuckets, []);
  approx(updated.aggregates?.judgeCostUsd, 0.03); // base child judge cost only — no clustering cost added
});

// ── (6) The prompt enumerates every failing run once, grouped by run id ───────────────────────────

test("buildFailureClusteringPrompt enumerates each failing run once with its grader reasons", () => {
  const prompt = buildFailureClusteringPrompt([
    { runId: "run-1", graderId: "outcome_judge", score: 0.2, reasoning: "wrong number" },
    { runId: "run-1", graderId: "rouge1", score: 0.1, reasoning: "low overlap" },
    { runId: "run-2", graderId: "outcome_judge", score: 0.3, reasoning: "hallucinated" },
  ]);
  assert.ok(prompt.includes("[1] runId: run-1"));
  assert.ok(prompt.includes("[2] runId: run-2"));
  assert.ok(
    prompt.includes("wrong number") &&
      prompt.includes("low overlap") &&
      prompt.includes("hallucinated"),
  );
  assert.ok(prompt.includes("JSON array"), "asks for a JSON array of clusters");
});
