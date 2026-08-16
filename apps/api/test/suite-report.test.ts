import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import { nanoid } from "nanoid";
import {
  AUTO_RATING_VERSION,
  type CostBasis,
  type ErrorFinding,
  type FixTarget,
  type JudgeSettings,
  type RootCauseBucket,
  type RunStatus,
  suiteReportSchema,
} from "@mcp-token-footprint/shared";
import type { RunMode } from "@mcp-token-footprint/shared";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { GradeRepository } from "../src/grading/grade-repository.js";
import type { JudgeGenerate } from "../src/grading/judge.js";
import { SuiteOrchestrator } from "../src/suites/orchestrator.js";
import { SuiteRepository } from "../src/suites/repository.js";
import { SuiteReportRepository } from "../src/suites/suite-report-repository.js";
import {
  buildDeterministicSuiteReport,
  buildSuiteReportNarrative,
  clusterErrorsByCategory,
  computeBaselineDeltas,
  computeRootCauseRollup,
  computeTestGroupFindings,
  computeVariance,
  DEFAULT_MEMBER_GRADE_POLL_MS,
  DEFAULT_MEMBER_GRADE_WAIT_MS,
  SuiteReportService,
} from "../src/suites/suite-report-service.js";
import { SuiteRunManager } from "../src/suites/suite-run-manager.js";
import { SuiteRunRepository } from "../src/suites/suite-run-repository.js";
import { RunRepository } from "../src/testing/run-repository.js";
import type { RunHandle } from "../src/testing/run-service.js";

// Auto-Rating (WP 4.1) — the DETERMINISTIC suite-report analytics + the post-`finish()` generation seam,
// tested entirely OFFLINE against a real in-memory DB (no orchestrator, no providers, no judge). The
// service is fed seeded suite_runs + runs + run_steps + run_grades, so variance / tool-path / error
// clustering, the ≥2-member gate, the bounded-wait `partial`, the crash → `error` row, and append-only
// latest-wins are all asserted deterministically. Sanity assertions confirm the shape validates.

const databases: AppDatabase[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

const NOW = "2026-07-11T00:00:00.000Z";

function openFresh(): AppDatabase {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  databases.push(db);
  return db;
}

function seedParents(db: AppDatabase, scenarioId: string, testIds: string[]): void {
  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, api_key_encrypted, created_at, updated_at)
     VALUES ('prov-1', 'anthropic', 'Claude', 'enc:v1:abc', @now, @now)`,
  ).run({ now: NOW });
  db.prepare(
    `INSERT INTO scenarios (id, name, provider_id, model, created_at, updated_at)
     VALUES (@id, 'Scenario', 'prov-1', 'claude-sonnet-4', @now, @now)`,
  ).run({ id: scenarioId, now: NOW });
  const insertTest = db.prepare(
    `INSERT INTO tests (id, name, user_prompt, created_at, updated_at)
     VALUES (@id, @name, 'Do the thing.', @now, @now)`,
  );
  for (const id of testIds) insertTest.run({ id, name: `Test ${id}`, now: NOW });
}

/** Create a finished suite_runs row, returning its id. `startedAt` orders runs for the baseline lookup. */
function seedSuiteRun(db: AppDatabase, startedAt: string = NOW): string {
  const id = nanoid();
  db.prepare(
    `INSERT INTO suite_runs (id, suite_id, status, config_snapshot_json, started_at, ended_at, source)
     VALUES (@id, NULL, 'completed', '{}', @startedAt, @startedAt, 'adhoc')`,
  ).run({ id, startedAt });
  return id;
}

type SeedRun = {
  testId: string;
  scenarioId: string;
  suiteRunId: string;
  status?: RunStatus;
  costUsd?: number;
  turns?: number;
  /** Ordered tool names for the run's tool_call steps (drives tool-path variance). */
  toolPath?: string[];
};

/** Insert a completed run row (+ its tool_call steps) linked to a suite run; returns the run id. */
function seedRun(db: AppDatabase, run: SeedRun): string {
  const id = nanoid();
  db.prepare(
    `INSERT INTO runs (id, test_id, scenario_id, mode, status, outcome, started_at, turns, tool_calls, cost_usd, suite_run_id, repetition)
     VALUES (@id, @testId, @scenarioId, 'automated', @status, 'completed', @now, @turns, @toolCalls, @cost, @suiteRunId, 1)`,
  ).run({
    id,
    testId: run.testId,
    scenarioId: run.scenarioId,
    status: run.status ?? "completed",
    turns: run.turns ?? 0,
    toolCalls: (run.toolPath ?? []).length,
    cost: run.costUsd ?? 0,
    suiteRunId: run.suiteRunId,
    now: NOW,
  });
  const insertStep = db.prepare(
    `INSERT INTO run_steps (id, run_id, idx, type, label, status, tool_name, profile_tokens_json, payload_json)
     VALUES (@id, @runId, @idx, 'tool_call', @label, 'ok', @toolName, '{}', '{}')`,
  );
  (run.toolPath ?? []).forEach((toolName, idx) => {
    insertStep.run({ id: nanoid(), runId: id, idx, label: toolName, toolName });
  });
  return id;
}

/** Insert a graded outcome_judge grade (the primary-grader score picked into the score variance). */
function seedOutcomeGrade(grades: GradeRepository, runId: string, score: number): void {
  grades.insert({
    runId,
    graderId: "outcome_judge",
    kind: "llm",
    status: "graded",
    score,
    method: "single_sample",
  });
}

/** Insert an error_forensics grade carrying the given finding categories (deterministic clustering source). */
function seedForensicsGrade(
  grades: GradeRepository,
  runId: string,
  categories: ErrorFinding["category"][],
): void {
  const evidence: ErrorFinding[] = categories.map((category, i) => ({
    id: `ef-${i}`,
    description: `${category} signal`,
    category,
    bucket: "mcp_server",
    fixTarget: "none",
    draftFix: "review manually",
    evidenceSteps: [i],
    evidenceEventIds: [],
  }));
  grades.insert({
    runId,
    graderId: "error_forensics",
    kind: "llm",
    status: "graded",
    score: evidence.length === 0 ? 1 : 0.5,
    method: "error_forensics_v1_inventory_only",
    evidence,
  });
}

/** One finding spec for {@link seedForensicsFindings} — the (bucket, fixTarget, draftFix) triple `computeRootCauseRollup` clusters on. */
type FindingSpec = {
  bucket: RootCauseBucket;
  fixTarget: FixTarget;
  draftFix: string;
  category?: ErrorFinding["category"];
};

/** Insert an error_forensics grade carrying explicit (bucket, fixTarget, draftFix) findings (WP 4.2 root-cause roll-up source). */
function seedForensicsFindings(grades: GradeRepository, runId: string, specs: FindingSpec[]): void {
  const evidence: ErrorFinding[] = specs.map((spec, i) => ({
    id: `ef-${runId}-${i}`,
    description: "signal",
    category: spec.category ?? "failed_tool_call",
    bucket: spec.bucket,
    fixTarget: spec.fixTarget,
    draftFix: spec.draftFix,
    evidenceSteps: [i],
    evidenceEventIds: [],
  }));
  grades.insert({
    runId,
    graderId: "error_forensics",
    kind: "llm",
    status: "graded",
    score: 0.5,
    method: "error_forensics_v1",
    evidence,
  });
}

/** Insert a graded answer_validation grade (its `verdict` feeds the WP 4.2 agreement prompt). */
function seedAnswerValidationGrade(
  grades: GradeRepository,
  runId: string,
  verdict: "answered" | "partial" | "unanswered",
): void {
  grades.insert({
    runId,
    graderId: "answer_validation",
    kind: "llm",
    status: "graded",
    score: verdict === "answered" ? 0.9 : verdict === "partial" ? 0.5 : 0.1,
    method: "answer_validation_v1",
    evidence: { verdict, score: verdict === "answered" ? 0.9 : 0.5, quotes: [], citedSteps: [0] },
  });
}

/** Insert one `llm_response` step carrying the run's final answer prose (drives `finalAssistantText`). */
function seedAnswerStep(db: AppDatabase, runId: string, text: string): void {
  db.prepare(
    `INSERT INTO run_steps (id, run_id, idx, type, label, status, profile_tokens_json, assistant_text, payload_json)
     VALUES (@id, @runId, 0, 'llm_response', 'answer', 'ok', '{}', @text, '{}')`,
  ).run({ id: nanoid(), runId, text });
}

/**
 * Claude subscription (roadmap/claude-subscription/, WP 2.2, D-CS4/D-CS8) — insert a persisted `kpi`
 * `run_events` row carrying `costBasis`, exactly like the live event stream the subscription executor
 * emits (`claude-subscription-executor.ts` `emitKpi`). `SuiteReportService` reads this back off
 * `RunRepository.getRun(...).events` (the run summary row itself has no `cost_basis` column — the
 * marker rides the persisted event log, mirroring how the app already round-trips every other event).
 */
function seedKpiEvent(db: AppDatabase, runId: string, costBasis: CostBasis, costUsd = 0.001): void {
  db.prepare(
    `INSERT INTO run_events (id, run_id, idx, type, payload_json, created_at)
     VALUES (@id, @runId, 999, 'kpi', @payload, @now)`,
  ).run({
    id: nanoid(),
    runId,
    payload: JSON.stringify({
      type: "kpi",
      turns: 1,
      toolCalls: 0,
      tokensIn: 10,
      tokensOut: 5,
      contextTokens: 15,
      costUsd,
      costBasis,
    }),
    now: NOW,
  });
}

const PRICED_JUDGE_MODEL = "claude-sonnet-4"; // priced → estimateCost > 0, isModelPriced true (mirrors grading-answer-validation.test.ts)
const CONFIGURED_JUDGE: () => JudgeSettings = () => ({
  providerCredentialId: "prov-judge",
  model: PRICED_JUDGE_MODEL,
});
const NO_JUDGE: () => JudgeSettings | null = () => null;

/** A fake judge `generate` that records every prompt it was called with and answers per-call via `respond`. */
function trackedGenerate(
  respond: (prompt: string) => {
    text: string;
    usage?: { inputTokens: number; outputTokens: number };
  },
): {
  generate: JudgeGenerate;
  calls: string[];
} {
  const calls: string[] = [];
  const generate: JudgeGenerate = async (_settings, prompt) => {
    calls.push(prompt);
    const { text, usage } = respond(prompt);
    return { text, usage: usage ?? { inputTokens: 100, outputTokens: 20 } };
  };
  return { generate, calls };
}

/** A `generate` that always throws (proves a path never actually calls the judge, or exercises a call failure). */
function throwingGenerate(message = "simulated judge call failure"): JudgeGenerate {
  return async () => {
    throw new Error(message);
  };
}

// ── (1) computeVariance arithmetic (pure) ────────────────────────────────────────────────────────

test("computeVariance — mean + POPULATION stdDev over non-null values; both null when empty", () => {
  // scores [0.8, 0.4, 0.6] → mean 0.6, popStdDev = sqrt(((0.2)^2 + (0.2)^2 + 0)/3) = sqrt(0.08/3).
  const v = computeVariance([0.8, 0.4, 0.6]);
  assert.ok(Math.abs((v.mean ?? NaN) - 0.6) < 1e-9, `mean ${v.mean} ≈ 0.6`);
  assert.ok(
    Math.abs((v.stdDev ?? NaN) - Math.sqrt(0.08 / 3)) < 1e-9,
    `stdDev ${v.stdDev} ≈ sqrt(0.08/3)`,
  );

  // nulls are excluded from BOTH mean and stdDev.
  const mixed = computeVariance([2, null, 4, null, 6]);
  assert.ok(Math.abs((mixed.mean ?? NaN) - 4) < 1e-9, "mean ignores nulls");
  assert.ok(Math.abs((mixed.stdDev ?? NaN) - Math.sqrt(8 / 3)) < 1e-9, "stdDev ignores nulls");

  // all-null (unevaluable) → both null, never a forced 0.
  assert.deepEqual(computeVariance([null, null]), { mean: null, stdDev: null });
  assert.deepEqual(computeVariance([]), { mean: null, stdDev: null });

  // single value → mean is the value, stdDev 0.
  assert.deepEqual(computeVariance([0.5]), { mean: 0.5, stdDev: 0 });
});

// ── (2) buildDeterministicSuiteReport — variance + toolPathVariance + placeholders + schema ───────

test("buildDeterministicSuiteReport — per-test-group variance, tool-path variance, honest 4.2 placeholders", () => {
  const db = openFresh();
  seedParents(db, "scn-1", ["t1"]);
  const grades = new GradeRepository(db);
  const runs = new RunRepository(db);
  const suiteRunId = seedSuiteRun(db);

  // 3 runs of the SAME test: scores [0.8,0.4,0.6], cost [0.1,0.2,0.3], turns [2,4,6];
  // tool paths: two identical [A,B] + one divergent [A,C] → 2 distinct shapes.
  const r1 = seedRun(db, {
    testId: "t1",
    scenarioId: "scn-1",
    suiteRunId,
    costUsd: 0.1,
    turns: 2,
    toolPath: ["A", "B"],
  });
  const r2 = seedRun(db, {
    testId: "t1",
    scenarioId: "scn-1",
    suiteRunId,
    costUsd: 0.2,
    turns: 4,
    toolPath: ["A", "B"],
  });
  const r3 = seedRun(db, {
    testId: "t1",
    scenarioId: "scn-1",
    suiteRunId,
    costUsd: 0.3,
    turns: 6,
    toolPath: ["A", "C"],
  });
  seedOutcomeGrade(grades, r1, 0.8);
  seedOutcomeGrade(grades, r2, 0.4);
  seedOutcomeGrade(grades, r3, 0.6);

  const report = buildDeterministicSuiteReport(runs, grades, suiteRunId, [r1, r2, r3]);

  assert.equal(report.suiteRunId, suiteRunId);
  assert.equal(report.ratingVersion, AUTO_RATING_VERSION);
  assert.equal(report.testGroups.length, 1, "one test group (all runs share t1)");
  const group = report.testGroups[0];
  assert.ok(group);
  assert.equal(group.testId, "t1");
  assert.deepEqual(group.runIds.sort(), [r1, r2, r3].sort());
  assert.ok(Math.abs((group.score.mean ?? NaN) - 0.6) < 1e-9, "score mean 0.6");
  assert.ok(Math.abs((group.score.stdDev ?? NaN) - Math.sqrt(0.08 / 3)) < 1e-9, "score stdDev");
  assert.ok(Math.abs((group.costUsd.mean ?? NaN) - 0.2) < 1e-9, "cost mean 0.2");
  assert.ok(Math.abs((group.turns.mean ?? NaN) - 4) < 1e-9, "turns mean 4");
  assert.equal(group.toolPathVariance, 2, "2 distinct tool-path shapes");

  // `agreement`/`narrative` are still honest placeholders here — buildDeterministicSuiteReport has no
  // judge access; SuiteReportService.enrichWithAgreement (WP 4.2) fills them. `rootCauseRollup` IS real
  // (deterministic, no judge needed) but is genuinely `[]` here since no error_forensics grades were seeded.
  assert.equal(
    group.agreement.summary,
    "",
    "agreement summary is a 4.2 placeholder (filled by the service)",
  );
  assert.equal(group.agreement.totalCount, 3, "agreement totalCount reflects the group size");
  assert.equal(group.agreement.contradicts, false);
  assert.equal(report.narrative, "", "narrative is a 4.2 placeholder (filled by the service)");
  assert.deepEqual(
    report.rootCauseRollup,
    [],
    "no error_forensics findings seeded → an empty (but REAL) roll-up",
  );
  assert.deepEqual(
    report.judgeProvenance,
    { judgeProviderId: null, judgeModel: null },
    "no judge on the deterministic pass",
  );

  // The composed report validates against the shared zod contract.
  assert.doesNotThrow(
    () => suiteReportSchema.parse(report),
    "report validates against suiteReportSchema",
  );
});

test("buildDeterministicSuiteReport — identical tool paths → toolPathVariance 1; multiple test groups sorted", () => {
  const db = openFresh();
  seedParents(db, "scn-1", ["t1", "t2"]);
  const grades = new GradeRepository(db);
  const runs = new RunRepository(db);
  const suiteRunId = seedSuiteRun(db);

  const a1 = seedRun(db, { testId: "t2", scenarioId: "scn-1", suiteRunId, toolPath: ["X"] });
  const a2 = seedRun(db, { testId: "t2", scenarioId: "scn-1", suiteRunId, toolPath: ["X"] });
  const b1 = seedRun(db, { testId: "t1", scenarioId: "scn-1", suiteRunId, toolPath: ["Y"] });
  const b2 = seedRun(db, { testId: "t1", scenarioId: "scn-1", suiteRunId, toolPath: ["Z"] });

  const report = buildDeterministicSuiteReport(runs, grades, suiteRunId, [a1, a2, b1, b2]);
  assert.deepEqual(
    report.testGroups.map((g) => g.testId),
    ["t1", "t2"],
    "test groups sorted by testId",
  );
  const t1 = report.testGroups.find((g) => g.testId === "t1");
  const t2 = report.testGroups.find((g) => g.testId === "t2");
  assert.equal(t2?.toolPathVariance, 1, "identical tool paths → 1 distinct shape");
  assert.equal(t1?.toolPathVariance, 2, "divergent tool paths → 2 distinct shapes");
  // No graded scores → variance null (never a forced 0).
  assert.deepEqual(
    t1?.score,
    { mean: null, stdDev: null },
    "no graded members → null score variance",
  );
});

// ── (3) Deterministic error clustering (AR12) ─────────────────────────────────────────────────────

test("clusterErrorsByCategory — clusters member runs by grader-owned error category with correct shares", () => {
  const db = openFresh();
  seedParents(db, "scn-1", ["t1"]);
  const grades = new GradeRepository(db);
  const suiteRunId = seedSuiteRun(db);
  const r1 = seedRun(db, { testId: "t1", scenarioId: "scn-1", suiteRunId });
  const r2 = seedRun(db, { testId: "t1", scenarioId: "scn-1", suiteRunId });
  const r3 = seedRun(db, { testId: "t1", scenarioId: "scn-1", suiteRunId });
  seedForensicsGrade(grades, r1, ["failed_tool_call"]);
  seedForensicsGrade(grades, r2, ["failed_tool_call", "context_overflow"]);
  seedForensicsGrade(grades, r3, []); // clean run — no findings

  const buckets = clusterErrorsByCategory(grades, [r1, r2, r3]);
  const byLabel = new Map(buckets.map((b) => [b.label, b]));
  const failed = byLabel.get("Failed tool call");
  const overflow = byLabel.get("Context overflow");
  assert.ok(failed, "a failed_tool_call cluster exists");
  assert.deepEqual(
    failed?.memberRunIds.sort(),
    [r1, r2].sort(),
    "both failing runs in the cluster",
  );
  assert.ok(Math.abs((failed?.share ?? 0) - 2 / 3) < 1e-9, "share = 2/3 (of all 3 members)");
  assert.ok(overflow, "a context_overflow cluster exists");
  assert.deepEqual(overflow?.memberRunIds, [r2], "only r2 overflowed");
  assert.ok(Math.abs((overflow?.share ?? 0) - 1 / 3) < 1e-9, "share = 1/3");

  // Every share denominator is the FULL member count; a clean run contributes to no cluster.
  assert.equal(clusterErrorsByCategory(grades, []).length, 0, "no members → no clusters");
});

// ── (4) Service — ≥2-member gate (AR7) ────────────────────────────────────────────────────────────

test("SuiteReportService.generate — single-member run gets NO report (AR7)", async () => {
  const db = openFresh();
  seedParents(db, "scn-1", ["t1"]);
  const grades = new GradeRepository(db);
  const runs = new RunRepository(db);
  const suiteRuns = new SuiteRunRepository(db);
  const reports = new SuiteReportRepository(db);
  const suiteRunId = seedSuiteRun(db);
  const r1 = seedRun(db, { testId: "t1", scenarioId: "scn-1", suiteRunId });
  seedOutcomeGrade(grades, r1, 0.9);

  const service = new SuiteReportService({ suiteRuns, runs, grades, reports });
  const result = await service.generate(suiteRunId);
  assert.equal(result, null, "no report for a single-member suite run");
  assert.equal(reports.latest(suiteRunId), null, "no row persisted");
});

test("SuiteReportService.generate — ≥2 members produces a persisted `ready` report", async () => {
  const db = openFresh();
  seedParents(db, "scn-1", ["t1"]);
  const grades = new GradeRepository(db);
  const runs = new RunRepository(db);
  const suiteRuns = new SuiteRunRepository(db);
  const reports = new SuiteReportRepository(db);
  const suiteRunId = seedSuiteRun(db);
  const r1 = seedRun(db, { testId: "t1", scenarioId: "scn-1", suiteRunId, toolPath: ["A"] });
  const r2 = seedRun(db, { testId: "t1", scenarioId: "scn-1", suiteRunId, toolPath: ["A"] });
  seedOutcomeGrade(grades, r1, 0.8);
  seedOutcomeGrade(grades, r2, 0.6);

  const service = new SuiteReportService({ suiteRuns, runs, grades, reports });
  const result = await service.generate(suiteRunId);
  assert.ok(result, "a report was generated");
  assert.equal(result?.status, "ready", "all members rated → ready");
  assert.equal(result?.ratingVersion, AUTO_RATING_VERSION);
  assert.equal(result?.judgeCostUsd, 0, "judge ledger is 0 on the deterministic pass");
  assert.equal(result?.judgeProviderId, null, "judge provider null on the deterministic pass");

  const latest = reports.latest(suiteRunId);
  assert.ok(latest, "the row is readable back");
  assert.doesNotThrow(() => suiteReportSchema.parse(latest?.report), "persisted report validates");
});

// ── (5) Service — bounded-wait → `partial` when a member is un-rated ──────────────────────────────

test("SuiteReportService.generate — an un-rated member within the bound yields a `partial` report (never a hang)", async () => {
  const db = openFresh();
  seedParents(db, "scn-1", ["t1"]);
  const grades = new GradeRepository(db);
  const runs = new RunRepository(db);
  const suiteRuns = new SuiteRunRepository(db);
  const reports = new SuiteReportRepository(db);
  const suiteRunId = seedSuiteRun(db);
  const r1 = seedRun(db, { testId: "t1", scenarioId: "scn-1", suiteRunId });
  const r2 = seedRun(db, { testId: "t1", scenarioId: "scn-1", suiteRunId });
  seedOutcomeGrade(grades, r1, 0.8); // r1 rated; r2 has NO grade rows (rating hasn't landed)

  // Tiny bound so the test doesn't wait the 30s default.
  const service = new SuiteReportService({
    suiteRuns,
    runs,
    grades,
    reports,
    gradeWaitTimeoutMs: 40,
    gradeWaitPollMs: 5,
  });
  const started = Date.now();
  const result = await service.generate(suiteRunId);
  assert.ok(Date.now() - started < 5_000, "generation settled quickly — bounded, never a hang");
  assert.equal(result?.status, "partial", "a slow/absent member rating degrades to partial");
  // The deterministic analytics still compute from whatever grades exist (r1 graded, r2 null).
  assert.doesNotThrow(
    () => suiteReportSchema.parse(result?.report),
    "partial report still validates",
  );
});

test("default member-grade wait bound is generous but finite (never a hang)", () => {
  assert.equal(DEFAULT_MEMBER_GRADE_WAIT_MS, 30_000);
  assert.ok(
    DEFAULT_MEMBER_GRADE_POLL_MS > 0 && DEFAULT_MEMBER_GRADE_POLL_MS < DEFAULT_MEMBER_GRADE_WAIT_MS,
  );
});

// ── (6) Service — a generation crash → `error` row; suite run untouched ───────────────────────────

test("SuiteReportService.generate — a build crash persists a `status:error` row, suite run untouched (AR11)", async () => {
  const db = openFresh();
  seedParents(db, "scn-1", ["t1"]);
  const realGrades = new GradeRepository(db);
  const runs = new RunRepository(db);
  const suiteRuns = new SuiteRunRepository(db);
  const reports = new SuiteReportRepository(db);
  const suiteRunId = seedSuiteRun(db);
  const r1 = seedRun(db, { testId: "t1", scenarioId: "scn-1", suiteRunId });
  const r2 = seedRun(db, { testId: "t1", scenarioId: "scn-1", suiteRunId });

  // A grades stub: `listByRun` reports the members as RATED (so the bounded wait passes → `ready`), but
  // `latestByGrader` THROWS — so the deterministic build crashes and must degrade to a persisted `error` row.
  const faultyGrades = {
    listByRun: (runId: string) => (realGrades.listByRun(runId).length >= 0 ? [{ runId }] : []),
    latestByGrader: () => {
      throw new Error("boom: simulated systemic grade read failure");
    },
  } as unknown as GradeRepository;

  const service = new SuiteReportService({ suiteRuns, runs, grades: faultyGrades, reports });
  const result = await service.generate(suiteRunId);
  assert.equal(result?.status, "error", "a build crash is caught → status:error row");
  assert.doesNotThrow(
    () => suiteReportSchema.parse(result?.report),
    "the empty error report still validates",
  );

  // The suite run itself is entirely untouched (status + aggregates unchanged).
  const suiteRun = suiteRuns.getRun(suiteRunId);
  assert.equal(suiteRun.status, "completed", "suite run status untouched by a failed report");
});

// ── (7) Service — append-only, latest-per-suite-run wins ──────────────────────────────────────────

test("SuiteReportRepository — append-only; latest() returns the newest, listBySuiteRun keeps history", async () => {
  const db = openFresh();
  seedParents(db, "scn-1", ["t1"]);
  const grades = new GradeRepository(db);
  const runs = new RunRepository(db);
  const suiteRuns = new SuiteRunRepository(db);
  const reports = new SuiteReportRepository(db);
  const suiteRunId = seedSuiteRun(db);
  const r1 = seedRun(db, { testId: "t1", scenarioId: "scn-1", suiteRunId, toolPath: ["A"] });
  const r2 = seedRun(db, { testId: "t1", scenarioId: "scn-1", suiteRunId, toolPath: ["A"] });
  seedOutcomeGrade(grades, r1, 0.8);
  seedOutcomeGrade(grades, r2, 0.6);

  const service = new SuiteReportService({ suiteRuns, runs, grades, reports });
  const first = await service.generate(suiteRunId);
  await new Promise((resolve) => setTimeout(resolve, 2)); // ensure a distinct created_at ordering
  const second = await service.generate(suiteRunId);
  assert.ok(
    first && second && first.id !== second.id,
    "two distinct appended rows (never an update)",
  );

  const history = reports.listBySuiteRun(suiteRunId);
  assert.equal(history.length, 2, "history preserved (append-only)");
  assert.equal(reports.latest(suiteRunId)?.id, second.id, "latest() returns the newest row");
});

// ── (8) Orchestrator integration — the post-`finish()` hook fires for ≥2 members; not on delete ────

/** A minimal offline run starter: creates the run row (running) + hands back a handle the test finishes. */
function makeStarter(db: AppDatabase) {
  const pending: Array<{ runId: string; finish: () => void }> = [];
  const started: string[] = [];
  const startRun = (testId: string, scenarioId: string, mode: RunMode): RunHandle => {
    const runId = nanoid();
    db.prepare(
      `INSERT INTO runs (id, test_id, scenario_id, mode, status, started_at) VALUES (@id, @testId, @scenarioId, @mode, 'running', @now)`,
    ).run({ id: runId, testId, scenarioId, mode, now: NOW });
    started.push(runId);
    let resolveDone!: (r: Awaited<RunHandle["done"]>) => void;
    const done = new Promise<Awaited<RunHandle["done"]>>((resolve) => {
      resolveDone = resolve;
    });
    pending.push({
      runId,
      finish: () => {
        db.prepare(
          `UPDATE runs SET status='completed', outcome='completed', cost_usd=0, duration_ms=0 WHERE id=@id`,
        ).run({ id: runId });
        resolveDone({
          status: "completed",
          outcome: "completed",
          turns: 0,
          toolCalls: 0,
          tokensIn: 0,
          tokensOut: 0,
        });
      },
    });
    return { runId, mode, done };
  };
  return { startRun, stopRun: () => {}, pending, started };
}

test("orchestrator — a ≥2-member suite run generates a persisted report after finish(); whenSettled awaits it", async () => {
  const db = openFresh();
  seedParents(db, "scn-1", ["t1"]);
  const suites = new SuiteRepository(db);
  const suite = suites.create({
    name: "Reported",
    config: { repetitions: 2, maxConcurrency: 8 },
    testIds: ["t1"],
    scenarioIds: ["scn-1"],
  });
  const runs = new RunRepository(db);
  const grades = new GradeRepository(db);
  const suiteRuns = new SuiteRunRepository(db);
  const reports = new SuiteReportRepository(db);
  const service = new SuiteReportService({
    suiteRuns,
    runs,
    grades,
    reports,
    gradeWaitTimeoutMs: 200,
    gradeWaitPollMs: 5,
  });
  const starter = makeStarter(db);
  const orchestrator = new SuiteOrchestrator(
    starter.startRun,
    starter.stopRun,
    runs,
    suiteRuns,
    suites,
    grades,
    new SuiteRunManager(),
    undefined, // no skill registry
    (id) => service.generate(id), // WP 4.1 report hook
  );

  const run = orchestrator.startSuiteRun(suite.id);
  // Both cells started in the first wave — grade them, then finish them.
  assert.equal(starter.started.length, 2, "2 cells started");
  seedOutcomeGrade(grades, starter.started[0] as string, 0.7);
  seedOutcomeGrade(grades, starter.started[1] as string, 0.5);
  for (const p of [...starter.pending]) p.finish();

  await orchestrator.whenSettled(run.id);

  // The suite run finalized normally …
  assert.equal(
    suiteRuns.getRun(run.id).status,
    "completed",
    "suite run finalized independently of the report",
  );
  // … and whenSettled waited for the post-finish report to land.
  const report = reports.latest(run.id);
  assert.ok(report, "a suite report was persisted for the ≥2-member run");
  assert.equal(report?.status, "ready", "members were rated → ready");
  assert.doesNotThrow(() => suiteReportSchema.parse(report?.report), "the report validates");
});

test("orchestrator — no report hook wired → suite run still completes (behavior unchanged)", async () => {
  const db = openFresh();
  seedParents(db, "scn-1", ["t1"]);
  const suites = new SuiteRepository(db);
  const suite = suites.create({
    name: "Unreported",
    config: { repetitions: 2, maxConcurrency: 8 },
    testIds: ["t1"],
    scenarioIds: ["scn-1"],
  });
  const runs = new RunRepository(db);
  const grades = new GradeRepository(db);
  const suiteRuns = new SuiteRunRepository(db);
  const reports = new SuiteReportRepository(db);
  const starter = makeStarter(db);
  const orchestrator = new SuiteOrchestrator(
    starter.startRun,
    starter.stopRun,
    runs,
    suiteRuns,
    suites,
    grades,
    new SuiteRunManager(),
    // no skills, no report hook — the pre-WP-4.1 construction shape
  );

  const run = orchestrator.startSuiteRun(suite.id);
  for (const p of [...starter.pending]) p.finish();
  await orchestrator.whenSettled(run.id);

  assert.equal(
    suiteRuns.getRun(run.id).status,
    "completed",
    "suite run completes with no hook wired",
  );
  assert.equal(reports.latest(run.id), null, "no report generated when no hook is injected");
});

// ── (9) WP 4.2 — computeRootCauseRollup: deterministic (bucket, fixTarget) aggregation ────────────

test("computeRootCauseRollup — aggregates by (bucket, fixTarget): frequency, memberRunIds, representative draftFix, frequency-ranked", () => {
  const db = openFresh();
  seedParents(db, "scn-1", ["t1"]);
  const grades = new GradeRepository(db);
  const r1 = seedRun(db, { testId: "t1", scenarioId: "scn-1", suiteRunId: "n/a" });
  const r2 = seedRun(db, { testId: "t1", scenarioId: "scn-1", suiteRunId: "n/a" });
  const r3 = seedRun(db, { testId: "t1", scenarioId: "scn-1", suiteRunId: "n/a" });

  // skill/skill: 3 findings across r1/r2/r3, majority draftFix "Add fields param note to SKILL.md" (2 vs 1).
  seedForensicsFindings(grades, r1, [
    { bucket: "skill", fixTarget: "skill", draftFix: "Add fields param note to SKILL.md" },
  ]);
  seedForensicsFindings(grades, r2, [
    { bucket: "skill", fixTarget: "skill", draftFix: "Add fields param note to SKILL.md" },
    { bucket: "mcp_server", fixTarget: "mcp_server", draftFix: "Raise the server timeout" },
  ]);
  seedForensicsFindings(grades, r3, [
    { bucket: "skill", fixTarget: "skill", draftFix: "A different phrasing of the same fix" },
  ]);

  const rollup = computeRootCauseRollup(grades, [r1, r2, r3]);

  const skillEntry = rollup.find((e) => e.bucket === "skill" && e.fixTarget === "skill");
  assert.ok(skillEntry, "a skill/skill cluster exists");
  assert.equal(skillEntry?.frequency, 3, "3 qualifying findings (one from each of r1, r2, r3)");
  assert.deepEqual(
    skillEntry?.memberRunIds.sort(),
    [r1, r2, r3].sort(),
    "all three contributing runs listed",
  );
  assert.equal(
    skillEntry?.draftFix,
    "Add fields param note to SKILL.md",
    "the most-frequent draftFix wins (2 vs 1)",
  );

  const serverEntry = rollup.find((e) => e.bucket === "mcp_server" && e.fixTarget === "mcp_server");
  assert.ok(serverEntry, "an mcp_server/mcp_server cluster exists");
  assert.equal(serverEntry?.frequency, 1);
  assert.deepEqual(serverEntry?.memberRunIds, [r2]);
  assert.equal(serverEntry?.draftFix, "Raise the server timeout");

  // Ranked by frequency DESC — skill/skill (3) before mcp_server/mcp_server (1).
  assert.deepEqual(
    rollup.map((e) => `${e.bucket}/${e.fixTarget}`),
    ["skill/skill", "mcp_server/mcp_server"],
  );

  // No findings at all → an empty roll-up, never a forced entry.
  assert.deepEqual(computeRootCauseRollup(grades, []), []);
});

test("computeRootCauseRollup — a clean run (no findings) contributes nothing; distinct clusters stay separate", () => {
  const db = openFresh();
  seedParents(db, "scn-1", ["t1"]);
  const grades = new GradeRepository(db);
  const clean = seedRun(db, { testId: "t1", scenarioId: "scn-1", suiteRunId: "n/a" });
  const modelIssue = seedRun(db, { testId: "t1", scenarioId: "scn-1", suiteRunId: "n/a" });
  seedForensicsFindings(grades, clean, []);
  seedForensicsFindings(grades, modelIssue, [
    { bucket: "model_behavior", fixTarget: "none", draftFix: "No actionable fix" },
  ]);

  const rollup = computeRootCauseRollup(grades, [clean, modelIssue]);
  assert.equal(rollup.length, 1, "only one cluster (the clean run contributes nothing)");
  assert.equal(rollup[0]?.bucket, "model_behavior");
  assert.equal(rollup[0]?.fixTarget, "none");
  assert.deepEqual(rollup[0]?.memberRunIds, [modelIssue]);
});

// ── (10) WP 4.2 — per-test-group LLM agreement (AR10): ONE call per group, never pairwise ─────────

test("SuiteReportService.generate — exactly ONE agreement call per test-group (AR10, not pairwise); parses agreeCount/contradicts/summary from the judge JSON", async () => {
  const db = openFresh();
  seedParents(db, "scn-1", ["t1", "t2"]);
  const grades = new GradeRepository(db);
  const runs = new RunRepository(db);
  const suiteRuns = new SuiteRunRepository(db);
  const reports = new SuiteReportRepository(db);
  const suiteRunId = seedSuiteRun(db);

  // t1: 2 runs (will agree). t2: 3 runs (will contradict) — a pairwise implementation would make
  // C(2,2)=1 + C(3,2)=3 = 4 calls; the per-test-group contract makes exactly 2 (one per group).
  const a1 = seedRun(db, { testId: "t1", scenarioId: "scn-1", suiteRunId });
  const a2 = seedRun(db, { testId: "t1", scenarioId: "scn-1", suiteRunId });
  const b1 = seedRun(db, { testId: "t2", scenarioId: "scn-1", suiteRunId });
  const b2 = seedRun(db, { testId: "t2", scenarioId: "scn-1", suiteRunId });
  const b3 = seedRun(db, { testId: "t2", scenarioId: "scn-1", suiteRunId });
  for (const r of [a1, a2, b1, b2, b3]) seedOutcomeGrade(grades, r, 0.7);
  seedAnswerStep(db, a1, "The missing fields param causes the failure.");
  seedAnswerValidationGrade(grades, a1, "answered");

  const { generate, calls } = trackedGenerate((prompt) => {
    if (prompt.includes('id "t1"')) {
      return { text: '{"agreeCount": 2, "contradicts": false, "summary": "2/2 runs agree on X"}' };
    }
    return {
      text: '{"agreeCount": 2, "contradicts": true, "summary": "2/3 runs agree; 1 reports a different figure"}',
    };
  });

  const service = new SuiteReportService({
    suiteRuns,
    runs,
    grades,
    reports,
    resolveJudge: CONFIGURED_JUDGE,
    generate,
  });
  const result = await service.generate(suiteRunId);
  assert.ok(result, "report generated");
  assert.equal(
    calls.length,
    2,
    "exactly ONE call per test-group (2 groups → 2 calls, never pairwise)",
  );
  // The prompt cites the run's real answer + its answer_validation verdict (read-only inputs, AR10).
  assert.match(
    calls.find((p) => p.includes('id "t1"')) ?? "",
    /missing fields param causes the failure/,
  );
  assert.match(
    calls.find((p) => p.includes('id "t1"')) ?? "",
    /answer_validation verdict: answered/,
  );

  const t1 = result?.report.testGroups.find((g) => g.testId === "t1");
  const t2 = result?.report.testGroups.find((g) => g.testId === "t2");
  assert.deepEqual(t1?.agreement, {
    summary: "2/2 runs agree on X",
    agreeCount: 2,
    totalCount: 2,
    contradicts: false,
  });
  assert.deepEqual(t2?.agreement, {
    summary: "2/3 runs agree; 1 reports a different figure",
    agreeCount: 2,
    totalCount: 3,
    contradicts: true,
  });
  assert.doesNotThrow(
    () => suiteReportSchema.parse(result?.report),
    "the enriched report still validates",
  );
});

test("SuiteReportService.generate — judge provenance + the SEPARATE cost ledger are stamped from the (faked) agreement-call usage", async () => {
  const db = openFresh();
  seedParents(db, "scn-1", ["t1"]);
  const grades = new GradeRepository(db);
  const runs = new RunRepository(db);
  const suiteRuns = new SuiteRunRepository(db);
  const reports = new SuiteReportRepository(db);
  const suiteRunId = seedSuiteRun(db);
  const r1 = seedRun(db, { testId: "t1", scenarioId: "scn-1", suiteRunId });
  const r2 = seedRun(db, { testId: "t1", scenarioId: "scn-1", suiteRunId });
  seedOutcomeGrade(grades, r1, 0.7);
  seedOutcomeGrade(grades, r2, 0.7);

  const { generate } = trackedGenerate(() => ({
    text: '{"agreeCount": 2, "contradicts": false, "summary": "2/2 runs agree"}',
    usage: { inputTokens: 321, outputTokens: 47 },
  }));

  const service = new SuiteReportService({
    suiteRuns,
    runs,
    grades,
    reports,
    resolveJudge: CONFIGURED_JUDGE,
    generate,
  });
  const result = await service.generate(suiteRunId);
  assert.ok(result);
  assert.equal(result?.judgeProviderId, "prov-judge");
  assert.equal(result?.judgeModel, PRICED_JUDGE_MODEL);
  assert.equal(result?.judgeTokensIn, 321);
  assert.equal(result?.judgeTokensOut, 47);
  assert.ok((result?.judgeCostUsd ?? 0) > 0, "a priced model → a non-zero estimated cost");
  assert.deepEqual(
    result?.report.judgeProvenance,
    { judgeProviderId: "prov-judge", judgeModel: PRICED_JUDGE_MODEL },
    "the report's own judgeProvenance mirrors the ledger's source",
  );
});

// ── (11) WP 4.2 — narrative: populated + grounded in the agreement + rootCauseRollup data ─────────

test("SuiteReportService.generate — narrative is populated + grounded (cites only computed agreement/root-cause data)", async () => {
  const db = openFresh();
  seedParents(db, "scn-1", ["t1"]);
  const grades = new GradeRepository(db);
  const runs = new RunRepository(db);
  const suiteRuns = new SuiteRunRepository(db);
  const reports = new SuiteReportRepository(db);
  const suiteRunId = seedSuiteRun(db);
  const r1 = seedRun(db, { testId: "t1", scenarioId: "scn-1", suiteRunId });
  const r2 = seedRun(db, { testId: "t1", scenarioId: "scn-1", suiteRunId });
  seedOutcomeGrade(grades, r1, 0.7);
  seedOutcomeGrade(grades, r2, 0.7);
  seedForensicsFindings(grades, r1, [
    { bucket: "skill", fixTarget: "skill", draftFix: "Add the missing fields param to SKILL.md" },
  ]);
  seedForensicsFindings(grades, r2, [
    { bucket: "skill", fixTarget: "skill", draftFix: "Add the missing fields param to SKILL.md" },
  ]);

  const { generate } = trackedGenerate(() => ({
    text: '{"agreeCount": 2, "contradicts": false, "summary": "2/2 runs agree"}',
  }));
  const service = new SuiteReportService({
    suiteRuns,
    runs,
    grades,
    reports,
    resolveJudge: CONFIGURED_JUDGE,
    generate,
  });
  const result = await service.generate(suiteRunId);

  assert.ok(result?.report.narrative, "narrative is non-empty");
  assert.match(
    result?.report.narrative ?? "",
    /consistent/i,
    "cites the (non-contradicting) agreement verdict",
  );
  assert.match(
    result?.report.narrative ?? "",
    /skill\/skill/,
    "cites the actual top root-cause cluster",
  );
  assert.match(
    result?.report.narrative ?? "",
    /2×/,
    "cites the actual frequency — no invented numbers",
  );
});

// ── (12) WP 4.2 — honest degradation: no judge / judge failure / unparseable response (AR11) ──────

test("SuiteReportService.generate — no judge configured → honest-neutral agreement, deterministic-only narrative, null provenance; generate is NEVER called", async () => {
  const db = openFresh();
  seedParents(db, "scn-1", ["t1"]);
  const grades = new GradeRepository(db);
  const runs = new RunRepository(db);
  const suiteRuns = new SuiteRunRepository(db);
  const reports = new SuiteReportRepository(db);
  const suiteRunId = seedSuiteRun(db);
  const r1 = seedRun(db, { testId: "t1", scenarioId: "scn-1", suiteRunId });
  const r2 = seedRun(db, { testId: "t1", scenarioId: "scn-1", suiteRunId });
  seedOutcomeGrade(grades, r1, 0.7);
  seedOutcomeGrade(grades, r2, 0.7);

  const mustNotBeCalled = throwingGenerate(
    "generate must never be called when no judge is configured",
  );
  const service = new SuiteReportService({
    suiteRuns,
    runs,
    grades,
    reports,
    resolveJudge: NO_JUDGE,
    generate: mustNotBeCalled,
  });
  const result = await service.generate(suiteRunId);
  assert.ok(result, "the report still generates (AR11 — never blocked by a missing judge)");
  assert.equal(result?.status, "ready");

  const group = result?.report.testGroups[0];
  assert.equal(
    group?.agreement.agreeCount,
    0,
    "honest-neutral count — never a fabricated agreement",
  );
  assert.equal(group?.agreement.totalCount, 2);
  assert.equal(group?.agreement.contradicts, false);
  assert.match(
    group?.agreement.summary ?? "",
    /not evaluated/i,
    "the summary is honest about why, not blank",
  );
  assert.match(
    result?.report.narrative ?? "",
    /not evaluated/i,
    "the narrative stays deterministic-only",
  );
  assert.deepEqual(result?.report.judgeProvenance, { judgeProviderId: null, judgeModel: null });
  assert.equal(result?.judgeProviderId, null);
  assert.equal(result?.judgeCostUsd, 0, "no call ran → no spend");
});

test("SuiteReportService.generate — omitted resolveJudge/generate deps (undefined) degrade exactly like no-judge", async () => {
  const db = openFresh();
  seedParents(db, "scn-1", ["t1"]);
  const grades = new GradeRepository(db);
  const runs = new RunRepository(db);
  const suiteRuns = new SuiteRunRepository(db);
  const reports = new SuiteReportRepository(db);
  const suiteRunId = seedSuiteRun(db);
  const r1 = seedRun(db, { testId: "t1", scenarioId: "scn-1", suiteRunId });
  const r2 = seedRun(db, { testId: "t1", scenarioId: "scn-1", suiteRunId });
  seedOutcomeGrade(grades, r1, 0.7);
  seedOutcomeGrade(grades, r2, 0.7);

  // The pre-4.2 construction shape (no judge deps at all) — must not crash, must degrade honestly.
  const service = new SuiteReportService({ suiteRuns, runs, grades, reports });
  const result = await service.generate(suiteRunId);
  assert.ok(result);
  const group = result?.report.testGroups[0];
  assert.match(group?.agreement.summary ?? "", /not evaluated/i);
  assert.equal(result?.judgeCostUsd, 0);
  assert.deepEqual(result?.report.judgeProvenance, { judgeProviderId: null, judgeModel: null });
});

test("SuiteReportService.generate — a judge agreement-call FAILURE degrades that group honestly; the report is still persisted (AR11)", async () => {
  const db = openFresh();
  seedParents(db, "scn-1", ["t1"]);
  const grades = new GradeRepository(db);
  const runs = new RunRepository(db);
  const suiteRuns = new SuiteRunRepository(db);
  const reports = new SuiteReportRepository(db);
  const suiteRunId = seedSuiteRun(db);
  const r1 = seedRun(db, { testId: "t1", scenarioId: "scn-1", suiteRunId });
  const r2 = seedRun(db, { testId: "t1", scenarioId: "scn-1", suiteRunId });
  seedOutcomeGrade(grades, r1, 0.7);
  seedOutcomeGrade(grades, r2, 0.7);

  const service = new SuiteReportService({
    suiteRuns,
    runs,
    grades,
    reports,
    resolveJudge: CONFIGURED_JUDGE,
    generate: throwingGenerate("provider exploded"),
  });
  const result = await service.generate(suiteRunId);
  assert.ok(result, "the report is still persisted despite the judge failure");
  assert.equal(
    result?.status,
    "ready",
    "the deterministic build succeeded — status is unaffected by the judge failure",
  );

  const group = result?.report.testGroups[0];
  assert.equal(group?.agreement.agreeCount, 0);
  assert.equal(group?.agreement.contradicts, false);
  assert.match(group?.agreement.summary ?? "", /failed/i);
  assert.equal(result?.judgeCostUsd, 0, "a failed call spent nothing — no ledger entry");
  assert.equal(result?.judgeProviderId, null);
  assert.doesNotThrow(
    () => suiteReportSchema.parse(result?.report),
    "the degraded report still validates",
  );
});

test("SuiteReportService.generate — an unparseable judge response still stamps the ledger (the call genuinely spent tokens)", async () => {
  const db = openFresh();
  seedParents(db, "scn-1", ["t1"]);
  const grades = new GradeRepository(db);
  const runs = new RunRepository(db);
  const suiteRuns = new SuiteRunRepository(db);
  const reports = new SuiteReportRepository(db);
  const suiteRunId = seedSuiteRun(db);
  const r1 = seedRun(db, { testId: "t1", scenarioId: "scn-1", suiteRunId });
  const r2 = seedRun(db, { testId: "t1", scenarioId: "scn-1", suiteRunId });
  seedOutcomeGrade(grades, r1, 0.7);
  seedOutcomeGrade(grades, r2, 0.7);

  const { generate } = trackedGenerate(() => ({
    text: "I refuse to answer in JSON today.",
    usage: { inputTokens: 55, outputTokens: 12 },
  }));
  const service = new SuiteReportService({
    suiteRuns,
    runs,
    grades,
    reports,
    resolveJudge: CONFIGURED_JUDGE,
    generate,
  });
  const result = await service.generate(suiteRunId);
  assert.ok(result);
  const group = result?.report.testGroups[0];
  assert.equal(group?.agreement.agreeCount, 0, "honest-neutral — no verdict could be read");
  assert.match(group?.agreement.summary ?? "", /no parseable|not evaluated/i);
  // The call DID run and spend tokens — the SEPARATE ledger still records it (never silently dropped).
  assert.equal(result?.judgeTokensIn, 55);
  assert.equal(result?.judgeTokensOut, 12);
  assert.equal(result?.judgeProviderId, "prov-judge");
});

// ── (13) Suite-report enrichment — the row status is stamped INSIDE the persisted report ──────────

test("SuiteReportService.generate — stamps the row's status inside the persisted report (ready + partial)", async () => {
  const db = openFresh();
  seedParents(db, "scn-1", ["t1"]);
  const grades = new GradeRepository(db);
  const runs = new RunRepository(db);
  const suiteRuns = new SuiteRunRepository(db);
  const reports = new SuiteReportRepository(db);

  // Ready: both members rated.
  const readyId = seedSuiteRun(db);
  const r1 = seedRun(db, { testId: "t1", scenarioId: "scn-1", suiteRunId: readyId });
  const r2 = seedRun(db, { testId: "t1", scenarioId: "scn-1", suiteRunId: readyId });
  seedOutcomeGrade(grades, r1, 0.8);
  seedOutcomeGrade(grades, r2, 0.6);
  const service = new SuiteReportService({
    suiteRuns,
    runs,
    grades,
    reports,
    gradeWaitTimeoutMs: 40,
    gradeWaitPollMs: 5,
  });
  const ready = await service.generate(readyId);
  assert.equal(ready?.status, "ready");
  assert.equal(ready?.report.status, "ready", "the row status is stamped inside the report JSON");

  // Partial: one member never rated within the bound.
  const partialId = seedSuiteRun(db);
  const p1 = seedRun(db, { testId: "t1", scenarioId: "scn-1", suiteRunId: partialId });
  seedRun(db, { testId: "t1", scenarioId: "scn-1", suiteRunId: partialId }); // un-rated member
  seedOutcomeGrade(grades, p1, 0.8);
  const partial = await service.generate(partialId);
  assert.equal(partial?.status, "partial");
  assert.equal(partial?.report.status, "partial", "the partial status is stamped inside too");

  // Both stamped reports still validate against the shared contract.
  assert.doesNotThrow(() => suiteReportSchema.parse(ready?.report));
  assert.doesNotThrow(() => suiteReportSchema.parse(partial?.report));
});

// ── (14) Suite-report enrichment — computeTestGroupFindings (pure, deterministic) ─────────────────

test("computeTestGroupFindings — evidence-grounded sentences per rule; a quiet group yields []", () => {
  const quiet = {
    runIds: ["r1", "r2"],
    score: { mean: 0.7, stdDev: 0.05 },
    costUsd: { mean: 0.1, stdDev: 0.01 },
    toolPathVariance: 1,
    agreement: { summary: "2/2 runs agree.", agreeCount: 2, totalCount: 2, contradicts: false },
  };
  assert.deepEqual(computeTestGroupFindings(quiet, []), [], "nothing stands out → []");

  const noisy = {
    runIds: ["r1", "r2", "r3"],
    score: { mean: 0.5, stdDev: 0.2 }, // > 0.15 → high spread
    costUsd: { mean: 0.1, stdDev: 0.08 }, // CV 0.8 > 0.5 → cost outlier
    toolPathVariance: 3, // > 1 → divergence
    agreement: {
      summary: "2/3 runs agree; 1 reports a different figure.",
      agreeCount: 2,
      totalCount: 3,
      contradicts: true,
    },
  };
  const clusters = [
    {
      label: "Failed tool call",
      description: "…",
      memberRunIds: ["r1", "r3", "someone-else"],
      share: 0.5,
    },
    { label: "Context overflow", description: "…", memberRunIds: ["other-run"], share: 0.25 },
  ];
  const findings = computeTestGroupFindings(noisy, clusters);
  assert.deepEqual(findings, [
    "Runs contradict: 2/3 runs agree; 1 reports a different figure.",
    "High score variance (± 0.20) across 3 runs",
    "3 distinct tool-call paths for the same test",
    "Cost varies widely: ±$0.0800 around a $0.1000 mean",
    "2 run(s) hit Failed tool call",
  ]);

  // Boundary honesty: stdDev exactly at the threshold, zero-mean cost, and null variance never fire.
  const boundary = {
    runIds: ["r1", "r2"],
    score: { mean: 0.5, stdDev: 0.15 }, // NOT > 0.15
    costUsd: { mean: 0, stdDev: 0.5 }, // mean 0 → no CV finding
    toolPathVariance: 1,
    agreement: { summary: "", agreeCount: 2, totalCount: 2, contradicts: false },
  };
  assert.deepEqual(computeTestGroupFindings(boundary, []), []);
  const nullVariance = {
    runIds: ["r1", "r2"],
    score: { mean: null, stdDev: null },
    costUsd: { mean: null, stdDev: null },
    toolPathVariance: 0,
    agreement: { summary: "", agreeCount: 0, totalCount: 2, contradicts: false },
  };
  assert.deepEqual(computeTestGroupFindings(nullVariance, []), []);

  // A blank contradiction summary still yields a grounded sentence (counts, never invented prose).
  const blankSummary = {
    ...quiet,
    agreement: { summary: "", agreeCount: 1, totalCount: 2, contradicts: true },
  };
  assert.deepEqual(computeTestGroupFindings(blankSummary, []), [
    "Runs contradict: only 1/2 run(s) side with the majority conclusion.",
  ]);
});

test("SuiteReportService.generate — findings are computed onto every test group (never invented for a quiet group)", async () => {
  const db = openFresh();
  seedParents(db, "scn-1", ["t1"]);
  const grades = new GradeRepository(db);
  const runs = new RunRepository(db);
  const suiteRuns = new SuiteRunRepository(db);
  const reports = new SuiteReportRepository(db);
  const suiteRunId = seedSuiteRun(db);
  // Divergent tool paths (2 shapes) + a wide score spread (0.9 vs 0.3 → popStdDev 0.3 > 0.15).
  const r1 = seedRun(db, { testId: "t1", scenarioId: "scn-1", suiteRunId, toolPath: ["A"] });
  const r2 = seedRun(db, { testId: "t1", scenarioId: "scn-1", suiteRunId, toolPath: ["B"] });
  seedOutcomeGrade(grades, r1, 0.9);
  seedOutcomeGrade(grades, r2, 0.3);
  seedForensicsGrade(grades, r1, ["failed_tool_call"]);
  seedForensicsGrade(grades, r2, []);

  const service = new SuiteReportService({ suiteRuns, runs, grades, reports });
  const result = await service.generate(suiteRunId);
  const group = result?.report.testGroups[0];
  assert.ok(group?.findings, "findings landed on the test group");
  assert.ok(
    group?.findings?.some((f) => /High score variance \(± 0\.30\) across 2 runs/.test(f)),
    `score-spread finding present (got ${JSON.stringify(group?.findings)})`,
  );
  assert.ok(
    group?.findings?.includes("2 distinct tool-call paths for the same test"),
    "tool-path finding present",
  );
  assert.ok(
    group?.findings?.includes("1 run(s) hit Failed tool call"),
    "error-cluster membership finding present",
  );
  assert.doesNotThrow(() => suiteReportSchema.parse(result?.report));
});

// ── (15) Suite-report enrichment — computeBaselineDeltas (pure) + the generation-time baseline ────

test("computeBaselineDeltas — current-minus-baseline per test; null when either side is null; flags a flipped agreement", () => {
  const variance = (mean: number | null, stdDev: number | null) => ({ mean, stdDev });
  const group = (
    testId: string,
    score: number | null,
    cost: number | null,
    turns: number | null,
    contradicts: boolean,
  ) => ({
    testId,
    runIds: ["x"],
    score: variance(score, score === null ? null : 0),
    costUsd: variance(cost, cost === null ? null : 0),
    turns: variance(turns, turns === null ? null : 0),
    toolPathVariance: 1,
    agreement: { summary: "", agreeCount: 0, totalCount: 1, contradicts },
  });

  const current = {
    testGroups: [group("t1", 0.7, 0.2, 4, true), group("t2", null, 0.1, 2, false)],
  };
  const baseline = {
    testGroups: [group("t1", 0.5, 0.1, 2, false), group("t2", 0.9, null, 2, false)],
  };
  const deltas = computeBaselineDeltas(current, baseline);
  assert.equal(deltas.length, 2, "one entry per CURRENT test group");
  const t1 = deltas.find((d) => d.testId === "t1");
  assert.ok(Math.abs((t1?.scoreMeanDelta ?? NaN) - 0.2) < 1e-9, "score delta +0.2");
  assert.ok(Math.abs((t1?.costMeanDelta ?? NaN) - 0.1) < 1e-9, "cost delta +0.1");
  assert.ok(Math.abs((t1?.turnsMeanDelta ?? NaN) - 2) < 1e-9, "turns delta +2");
  assert.equal(t1?.agreementFlipped, true, "contradicts changed false→true");
  const t2 = deltas.find((d) => d.testId === "t2");
  assert.equal(t2?.scoreMeanDelta, null, "null current side → null delta (never a fabricated 0)");
  assert.equal(t2?.costMeanDelta, null, "null baseline side → null delta");
  assert.ok(
    Math.abs((t2?.turnsMeanDelta ?? NaN) - 0) < 1e-9,
    "both sides real → a genuine 0 delta",
  );
  assert.equal(t2?.agreementFlipped, false);

  // A test absent from the baseline report → all-null deltas, agreementFlipped false.
  const missing = computeBaselineDeltas(
    { testGroups: [group("t9", 0.5, 0.1, 1, true)] },
    { testGroups: [] },
  );
  assert.deepEqual(missing, [
    {
      testId: "t9",
      scoreMeanDelta: null,
      costMeanDelta: null,
      turnsMeanDelta: null,
      agreementFlipped: false,
    },
  ]);
});

test("SuiteReportService.generate — baseline delta lands against the most recent EARLIER comparable reported run; incomparable/report-less candidates are skipped", async () => {
  const db = openFresh();
  seedParents(db, "scn-1", ["t1", "t2"]);
  const grades = new GradeRepository(db);
  const runs = new RunRepository(db);
  const suiteRuns = new SuiteRunRepository(db);
  const reports = new SuiteReportRepository(db);
  const service = new SuiteReportService({ suiteRuns, runs, grades, reports });

  // A (oldest, COMPARABLE — same {t1} member set — and reported): scores 0.4/0.6 (mean 0.5),
  // cost 0.1 each, turns 2 each.
  const aId = seedSuiteRun(db, "2026-07-08T00:00:00.000Z");
  const a1 = seedRun(db, {
    testId: "t1",
    scenarioId: "scn-1",
    suiteRunId: aId,
    costUsd: 0.1,
    turns: 2,
  });
  const a2 = seedRun(db, {
    testId: "t1",
    scenarioId: "scn-1",
    suiteRunId: aId,
    costUsd: 0.1,
    turns: 2,
  });
  seedOutcomeGrade(grades, a1, 0.4);
  seedOutcomeGrade(grades, a2, 0.6);
  assert.ok(await service.generate(aId), "the baseline run got its own report");

  // D (newer, comparable but NEVER reported) — must be skipped, keeping the lookup going back to A.
  const dId = seedSuiteRun(db, "2026-07-09T00:00:00.000Z");
  const d1 = seedRun(db, { testId: "t1", scenarioId: "scn-1", suiteRunId: dId });
  const d2 = seedRun(db, { testId: "t1", scenarioId: "scn-1", suiteRunId: dId });
  seedOutcomeGrade(grades, d1, 0.5);
  seedOutcomeGrade(grades, d2, 0.5);

  // E (newest earlier run, reported but INCOMPARABLE — different member test set {t2}) — skipped.
  const eId = seedSuiteRun(db, "2026-07-10T00:00:00.000Z");
  const e1 = seedRun(db, { testId: "t2", scenarioId: "scn-1", suiteRunId: eId });
  const e2 = seedRun(db, { testId: "t2", scenarioId: "scn-1", suiteRunId: eId });
  seedOutcomeGrade(grades, e1, 0.9);
  seedOutcomeGrade(grades, e2, 0.9);
  assert.ok(await service.generate(eId), "the incomparable run got a report too");

  // B (current): scores 0.8/0.6 (mean 0.7), cost 0.2 each, turns 4 each.
  const bId = seedSuiteRun(db, NOW);
  const b1 = seedRun(db, {
    testId: "t1",
    scenarioId: "scn-1",
    suiteRunId: bId,
    costUsd: 0.2,
    turns: 4,
  });
  const b2 = seedRun(db, {
    testId: "t1",
    scenarioId: "scn-1",
    suiteRunId: bId,
    costUsd: 0.2,
    turns: 4,
  });
  seedOutcomeGrade(grades, b1, 0.8);
  seedOutcomeGrade(grades, b2, 0.6);

  const result = await service.generate(bId);
  const baseline = result?.report.baseline;
  assert.ok(baseline, "a baseline landed on the current report");
  assert.equal(
    baseline?.suiteRunId,
    aId,
    "the most recent EARLIER comparable run WITH a report wins (E incomparable, D unreported)",
  );
  assert.equal(baseline?.perTest.length, 1, "one delta entry per current test group");
  const delta = baseline?.perTest[0];
  assert.equal(delta?.testId, "t1");
  assert.ok(Math.abs((delta?.scoreMeanDelta ?? NaN) - 0.2) < 1e-9, "score mean 0.7 − 0.5 = +0.2");
  assert.ok(Math.abs((delta?.costMeanDelta ?? NaN) - 0.1) < 1e-9, "cost mean 0.2 − 0.1 = +0.1");
  assert.ok(Math.abs((delta?.turnsMeanDelta ?? NaN) - 2) < 1e-9, "turns mean 4 − 2 = +2");
  assert.equal(delta?.agreementFlipped, false, "no judge on either side → contradicts unchanged");
  assert.doesNotThrow(
    () => suiteReportSchema.parse(result?.report),
    "the baseline-carrying report validates",
  );

  // The baseline run's own report never gained a baseline (nothing earlier was comparable + reported).
  assert.equal(reports.latest(aId)?.report.baseline, undefined);
});

test("SuiteReportService.generate — baseline is OMITTED when no earlier comparable reported run exists", async () => {
  const db = openFresh();
  seedParents(db, "scn-1", ["t1"]);
  const grades = new GradeRepository(db);
  const runs = new RunRepository(db);
  const suiteRuns = new SuiteRunRepository(db);
  const reports = new SuiteReportRepository(db);
  const suiteRunId = seedSuiteRun(db);
  const r1 = seedRun(db, { testId: "t1", scenarioId: "scn-1", suiteRunId });
  const r2 = seedRun(db, { testId: "t1", scenarioId: "scn-1", suiteRunId });
  seedOutcomeGrade(grades, r1, 0.8);
  seedOutcomeGrade(grades, r2, 0.6);

  const service = new SuiteReportService({ suiteRuns, runs, grades, reports });
  const result = await service.generate(suiteRunId);
  assert.ok(result, "the report still generates");
  assert.equal(result?.report.baseline, undefined, "no comparable earlier run → baseline omitted");
  assert.doesNotThrow(() => suiteReportSchema.parse(result?.report));
});

// ── (16) Claude subscription — suite report degradation (WP 2.2, D-CS4/D-CS8) ──────────────────────
// A `claude_subscription` member run's `costUsd` is a SHADOW reference price (WP 1.5) marked with
// `costBasis: "subscription_reference"` on its persisted `kpi` run_event (WP 0.1) — the run summary row
// itself carries no dedicated column for it. These tests confirm: (a) that shadow cost flows into the
// suite's cost analytics through the exact SAME code path as any other run (no kind gating anywhere in
// this file); (b) the report surfaces an honest, evidence-grounded "est. · subscription" marker so a
// downstream consumer (WP 3.1) can label the figure; and (c) a suite whose members are ALL (or partly)
// `claude_subscription` — which carries no logprobs — still generates a COMPLETE report, never a throw,
// never a fabricated score.

test("computeTestGroupFindings — subscriptionRunIds param adds an evidence-grounded marker; omitted/empty is a no-op (backward compatible)", () => {
  const group = {
    runIds: ["r1", "r2", "r3"],
    score: { mean: 0.7, stdDev: 0.05 },
    costUsd: { mean: 0.1, stdDev: 0.01 },
    toolPathVariance: 1,
    agreement: { summary: "3/3 runs agree.", agreeCount: 3, totalCount: 3, contradicts: false },
  };
  // Omitted (existing 2-arg call sites) → unaffected, exactly the pre-WP-2.2 shape.
  assert.deepEqual(computeTestGroupFindings(group, []), []);
  // Explicit empty set → same as omitted.
  assert.deepEqual(computeTestGroupFindings(group, [], new Set()), []);
  // r1 + r3 are subscription-priced → one grounded "N of M" sentence, never invented for r2.
  const findings = computeTestGroupFindings(group, [], new Set(["r1", "r3"]));
  assert.deepEqual(findings, [
    "2 of 3 run(s) priced via the Claude subscription's shadow-reference estimate (est. · subscription) — not a billed charge.",
  ]);
});

test("buildSuiteReportNarrative — subscriptionRunCount appends an honest accuracy note; 0/omitted is a no-op (backward compatible)", () => {
  const input = {
    testGroups: [{ testId: "t1", agreement: { summary: "x", agreeCount: 1, totalCount: 1, contradicts: false } }],
    evaluatedGroupCount: 1,
    rootCauseRollup: [],
  };
  const withoutMarker = buildSuiteReportNarrative(input);
  assert.equal(buildSuiteReportNarrative({ ...input, subscriptionRunCount: 0 }), withoutMarker);
  const withMarker = buildSuiteReportNarrative({ ...input, subscriptionRunCount: 2 });
  assert.notEqual(withMarker, withoutMarker);
  assert.match(
    withMarker,
    /2 run\(s\) in this report were priced via the Claude subscription's shadow-reference estimate \(est\. · subscription\)/,
  );
  assert.ok(withMarker.startsWith(withoutMarker), "the deterministic-only prefix is unchanged, only appended to");
});

test("buildDeterministicSuiteReport — a subscription member's shadow costUsd sums into testGroups[].costUsd through the SAME path as any other run (no kind gating)", () => {
  const db = openFresh();
  seedParents(db, "scn-1", ["t1"]);
  const grades = new GradeRepository(db);
  const runs = new RunRepository(db);
  const suiteRunId = seedSuiteRun(db);
  // r1 ordinary (api_exact, $0.10); r2 subscription-priced shadow estimate ($0.30). No kind-aware
  // branch exists anywhere in buildDeterministicSuiteReport — costUsd is read the identical way.
  const r1 = seedRun(db, { testId: "t1", scenarioId: "scn-1", suiteRunId, costUsd: 0.1 });
  const r2 = seedRun(db, { testId: "t1", scenarioId: "scn-1", suiteRunId, costUsd: 0.3 });
  seedKpiEvent(db, r2, "subscription_reference", 0.3);

  const report = buildDeterministicSuiteReport(runs, grades, suiteRunId, [r1, r2]);
  const group = report.testGroups.find((g) => g.testId === "t1");
  assert.ok(group);
  assert.ok(
    Math.abs((group?.costUsd.mean ?? Number.NaN) - 0.2) < 1e-9,
    `mean cost (0.10 + 0.30)/2 = 0.20 regardless of costBasis, got ${group?.costUsd.mean}`,
  );
});

test("SuiteReportService.generate — a MIXED subscription/ordinary test group completes normally: agreement call runs, cost aggregates unchanged, the report surfaces the subscription accuracy marker", async () => {
  const db = openFresh();
  seedParents(db, "scn-1", ["t1"]);
  const grades = new GradeRepository(db);
  const runs = new RunRepository(db);
  const suiteRuns = new SuiteRunRepository(db);
  const reports = new SuiteReportRepository(db);
  const suiteRunId = seedSuiteRun(db);
  const r1 = seedRun(db, { testId: "t1", scenarioId: "scn-1", suiteRunId, costUsd: 0.1 });
  const r2 = seedRun(db, { testId: "t1", scenarioId: "scn-1", suiteRunId, costUsd: 0.3 });
  seedKpiEvent(db, r2, "subscription_reference", 0.3);
  seedOutcomeGrade(grades, r1, 0.7);
  seedOutcomeGrade(grades, r2, 0.7);
  seedAnswerStep(db, r1, "Answer A.");
  seedAnswerStep(db, r2, "Answer A.");

  const { generate } = trackedGenerate(() => ({
    text: '{"agreeCount": 2, "contradicts": false, "summary": "2/2 runs agree"}',
  }));
  const service = new SuiteReportService({
    suiteRuns,
    runs,
    grades,
    reports,
    resolveJudge: CONFIGURED_JUDGE,
    generate,
  });
  const result = await service.generate(suiteRunId);
  assert.ok(result, "the report still generates for a mixed suite — no crash, no separate path");
  assert.equal(result?.status, "ready");

  const group = result?.report.testGroups.find((g) => g.testId === "t1");
  assert.ok(
    Math.abs((group?.costUsd.mean ?? Number.NaN) - 0.2) < 1e-9,
    "the shadow-priced member's cost summed into the SAME mean as an ordinary member",
  );
  assert.deepEqual(group?.agreement, {
    summary: "2/2 runs agree",
    agreeCount: 2,
    totalCount: 2,
    contradicts: false,
  });
  assert.ok(
    group?.findings?.some((f) =>
      /1 of 2 run\(s\) priced via the Claude subscription's shadow-reference estimate \(est\. · subscription\)/.test(
        f,
      ),
    ),
    `subscription marker present on the group's findings (got ${JSON.stringify(group?.findings)})`,
  );
  assert.match(
    result?.report.narrative ?? "",
    /1 run\(s\) in this report were priced via the Claude subscription's shadow-reference estimate/,
    "the suite-level narrative also carries the marker",
  );
  assert.doesNotThrow(() => suiteReportSchema.parse(result?.report), "the marked-up report still validates");
});

test("SuiteReportService.generate — a suite whose members are ALL claude_subscription (no logprobs, no PRIMARY-grader score) still produces a COMPLETE report: never a throw, honest-neutral verdicts, no fabricated score", async () => {
  const db = openFresh();
  seedParents(db, "scn-1", ["t1"]);
  const grades = new GradeRepository(db);
  const runs = new RunRepository(db);
  const suiteRuns = new SuiteRunRepository(db);
  const reports = new SuiteReportRepository(db);
  const suiteRunId = seedSuiteRun(db);
  const r1 = seedRun(db, { testId: "t1", scenarioId: "scn-1", suiteRunId, costUsd: 0.05 });
  const r2 = seedRun(db, { testId: "t1", scenarioId: "scn-1", suiteRunId, costUsd: 0.07 });
  const r3 = seedRun(db, { testId: "t1", scenarioId: "scn-1", suiteRunId, costUsd: 0.06 });
  for (const runId of [r1, r2, r3]) {
    seedKpiEvent(db, runId, "subscription_reference", 0.06);
    // AR5's guarantee (error_forensics always emits a grade row) — satisfies the rated-gate WITHOUT
    // any PRIMARY_GRADER_PRIORITY score, mirroring "the outcome judge produced no score" honestly
    // (the analogue, in THIS file's scope, of "no logprobs to weight a rating from").
    seedForensicsGrade(grades, runId, []);
  }

  // No judge configured at all — the agreement facet must degrade honestly, never crash, never invent
  // a logprob-weighted number it has no basis for.
  const service = new SuiteReportService({ suiteRuns, runs, grades, reports, resolveJudge: NO_JUDGE });
  const result = await service.generate(suiteRunId);

  assert.ok(result, "generation completed — no throw for an all-subscription suite");
  assert.equal(result?.status, "ready");
  const group = result?.report.testGroups[0];
  assert.equal(group?.score.mean, null, "no PRIMARY-grader score anywhere → null mean, never a forced 0");
  assert.equal(group?.score.stdDev, null);
  assert.ok(
    Math.abs((group?.costUsd.mean ?? Number.NaN) - 0.06) < 1e-9,
    "shadow cost still aggregates normally",
  );
  assert.equal(group?.agreement.contradicts, false, "honest-neutral, never a fabricated contradiction");
  assert.match(group?.agreement.summary ?? "", /not evaluated/i);
  assert.ok(
    group?.findings?.some((f) => /3 of 3 run\(s\) priced via the Claude subscription/.test(f)),
    `all three runs flagged subscription-priced (got ${JSON.stringify(group?.findings)})`,
  );
  assert.match(
    result?.report.narrative ?? "",
    /3 run\(s\) in this report were priced via the Claude subscription/,
  );
  assert.doesNotThrow(
    () => suiteReportSchema.parse(result?.report),
    "an all-subscription report still validates against the (unchanged) wire schema",
  );
});
