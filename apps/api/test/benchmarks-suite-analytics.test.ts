import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { afterEach, test } from "node:test";
import {
  AUTO_RATING_VERSION,
  type RunStatus,
  type SuiteAnalytics,
  type SuiteReport,
} from "@mcp-token-footprint/shared";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { GradeRepository } from "../src/grading/grade-repository.js";
import {
  collectSuiteRunReportData,
  createSuiteRunJsonReport,
  createSuiteRunMarkdownReport,
  type SuiteRunReportDeps,
} from "../src/reports/suite-run-report.js";
import { buildSuiteAnalytics } from "../src/suites/analytics.js";
import { computeSuiteAggregates, collectChildData } from "../src/suites/orchestrator.js";
import { SuiteRepository } from "../src/suites/repository.js";
import { SuiteReportRepository } from "../src/suites/suite-report-repository.js";
import { SuiteService } from "../src/suites/service.js";
import { SuiteRunRepository } from "../src/suites/suite-run-repository.js";
import { RunRepository } from "../src/testing/run-repository.js";
import { ScenarioRepository } from "../src/testing/scenario-repository.js";
import { ScenarioService } from "../src/testing/scenario-service.js";
import { TestRepository } from "../src/testing/test-repository.js";
import { TestService } from "../src/testing/test-service.js";

// WP 3.4 (Benchmarks, B9.2–B9.3) — suite-run ANALYTICS (quality×cost scatter + metadata breakdowns) and
// the suite-run report export, tested entirely OFFLINE against a hand-seeded fixture: a 2 test × 2
// scenario × 2 repetition matrix persisted as real `runs` rows linked to a `suite_runs` row, with seeded
// grades + test metadata. Every asserted mean/count is hand-computed; the two functions under test are
// the exact ones the endpoint (`buildSuiteAnalytics`) and the report route (`collectSuiteRunReportData` +
// the pure builders) call.

const databases: AppDatabase[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

const NOW = "2026-07-04T00:00:00.000Z";

function openFresh(): AppDatabase {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  databases.push(db as unknown as AppDatabase);
  return db as unknown as AppDatabase;
}

type Deps = {
  db: AppDatabase;
  runs: RunRepository;
  grades: GradeRepository;
  tests: TestService;
  scenarios: ScenarioService;
  suites: SuiteService;
  suiteRuns: SuiteRunRepository;
};

function deps(db: AppDatabase): Deps {
  const suites = new SuiteService(new SuiteRepository(db));
  return {
    db,
    runs: new RunRepository(db),
    grades: new GradeRepository(db),
    tests: new TestService(new TestRepository(db)),
    scenarios: new ScenarioService(new ScenarioRepository(db)),
    suites,
    suiteRuns: new SuiteRunRepository(db),
  };
}

/** Seed the provider + two scenarios + two tests (with analytics metadata). */
function seedParents(db: AppDatabase): void {
  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, api_key_encrypted, created_at, updated_at)
     VALUES ('prov-1', 'anthropic', 'Claude', 'enc:v1:abc', @now, @now)`,
  ).run({ now: NOW });
  const insertScenario = db.prepare(
    `INSERT INTO scenarios (id, name, provider_id, model, created_at, updated_at)
     VALUES (@id, @name, 'prov-1', 'claude-sonnet-4', @now, @now)`,
  );
  insertScenario.run({ id: "scn-a", name: "Scenario A", now: NOW });
  insertScenario.run({ id: "scn-b", name: "Scenario B", now: NOW });
  const insertTest = db.prepare(
    `INSERT INTO tests (id, name, user_prompt, category, difficulty, tags_json, created_at, updated_at)
     VALUES (@id, @name, 'Do the thing.', @category, @difficulty, @tags, @now, @now)`,
  );
  insertTest.run({
    id: "t1",
    name: "Test 1",
    category: "retrieval",
    difficulty: "easy",
    tags: JSON.stringify(["sql", "charts"]),
    now: NOW,
  });
  insertTest.run({
    id: "t2",
    name: "Test 2",
    category: "analysis",
    difficulty: "hard",
    tags: JSON.stringify(["sql"]),
    now: NOW,
  });
}

/** Create the suite (matching the fixture) + a suite_runs row, then return the suite run id. */
function seedSuiteRun(db: AppDatabase, suites: SuiteService): string {
  const suite = suites.create({
    name: "Analytics fixture",
    config: { repetitions: 2, maxConcurrency: 4 },
    testIds: ["t1", "t2"],
    scenarioIds: ["scn-a", "scn-b"],
  });
  const suiteRunId = "sr-1";
  db.prepare(
    `INSERT INTO suite_runs (id, suite_id, status, config_snapshot_json, started_at)
     VALUES (@id, @suiteId, 'running', @config, @now)`,
  ).run({
    id: suiteRunId,
    suiteId: suite.id,
    config: JSON.stringify({ repetitions: 2, maxConcurrency: 4 }),
    now: NOW,
  });
  return suiteRunId;
}

type Child = {
  runId: string;
  testId: string;
  scenarioId: string;
  repetition: number;
  status: RunStatus;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  /** outcome_judge score (0–1), or null for an ungraded run. */
  score: number | null;
};

/** Insert one settled child run (linked to the suite run) + its outcome_judge grade when scored. */
function seedChild(d: Deps, suiteRunId: string, child: Child): void {
  d.db
    .prepare(
      `INSERT INTO runs (id, test_id, scenario_id, mode, status, started_at, suite_run_id, repetition,
                         tokens_in, tokens_out, cost_usd, duration_ms, turns, tool_calls, peak_context_tokens)
       VALUES (@id, @testId, @scenarioId, 'automated', @status, @startedAt, @suiteRunId, @rep,
               @tin, @tout, @cost, 0, 0, 0, 0)`,
    )
    .run({
      id: child.runId,
      testId: child.testId,
      scenarioId: child.scenarioId,
      status: child.status,
      // started_at ASC ordering (listChildRunIds) → the repetition ordinal is reconstructed in order.
      startedAt: `2026-07-04T00:00:0${child.repetition}.000Z`,
      suiteRunId,
      rep: child.repetition,
      tin: child.tokensIn,
      tout: child.tokensOut,
      cost: child.costUsd,
    });
  if (child.score !== null) {
    d.grades.insert({
      runId: child.runId,
      graderId: "outcome_judge",
      kind: "llm",
      status: "graded",
      score: child.score,
      method: "logprob_weighted",
      judgeCostUsd: 0.01,
    });
  }
}

// The fixture: 2 tests × 2 scenarios × 2 reps = 8 child runs. t1×scnB rep2 is ungraded (excluded from
// its subject's meanScore, NOT a 0); t2×scnB is FULLY ungraded (no scatter point / no breakdown slice).
const FIXTURE: Child[] = [
  {
    runId: "r1",
    testId: "t1",
    scenarioId: "scn-a",
    repetition: 1,
    status: "completed",
    tokensIn: 60,
    tokensOut: 40,
    costUsd: 0.01,
    score: 0.8,
  },
  {
    runId: "r2",
    testId: "t1",
    scenarioId: "scn-a",
    repetition: 2,
    status: "completed",
    tokensIn: 120,
    tokensOut: 80,
    costUsd: 0.03,
    score: 0.6,
  },
  {
    runId: "r3",
    testId: "t1",
    scenarioId: "scn-b",
    repetition: 1,
    status: "completed",
    tokensIn: 180,
    tokensOut: 120,
    costUsd: 0.05,
    score: 0.4,
  },
  {
    runId: "r4",
    testId: "t1",
    scenarioId: "scn-b",
    repetition: 2,
    status: "completed",
    tokensIn: 60,
    tokensOut: 40,
    costUsd: 0.01,
    score: null,
  },
  {
    runId: "r5",
    testId: "t2",
    scenarioId: "scn-a",
    repetition: 1,
    status: "completed",
    tokensIn: 240,
    tokensOut: 160,
    costUsd: 0.1,
    score: 1.0,
  },
  {
    runId: "r6",
    testId: "t2",
    scenarioId: "scn-a",
    repetition: 2,
    status: "completed",
    tokensIn: 240,
    tokensOut: 160,
    costUsd: 0.1,
    score: 0.0,
  },
  {
    runId: "r7",
    testId: "t2",
    scenarioId: "scn-b",
    repetition: 1,
    status: "completed",
    tokensIn: 30,
    tokensOut: 20,
    costUsd: 0.005,
    score: null,
  },
  {
    runId: "r8",
    testId: "t2",
    scenarioId: "scn-b",
    repetition: 2,
    status: "completed",
    tokensIn: 30,
    tokensOut: 20,
    costUsd: 0.005,
    score: null,
  },
];

function seedFixture(): { d: Deps; suiteRunId: string } {
  const db = openFresh();
  const d = deps(db);
  seedParents(db);
  const suiteRunId = seedSuiteRun(db, d.suites);
  for (const child of FIXTURE) seedChild(d, suiteRunId, child);
  return { d, suiteRunId };
}

const approx = (actual: number | null | undefined, expected: number, label: string) =>
  assert.ok(
    actual !== null && actual !== undefined && Math.abs(actual - expected) < 1e-9,
    `${label}: ${actual} ≈ ${expected}`,
  );

// ── (1) Scatter — one point per subject, reps averaged; ungraded excluded from meanScore ──────────

test("scatter: one point per (test × scenario) subject with repetitions averaged", () => {
  const { d, suiteRunId } = seedFixture();
  const analytics = buildSuiteAnalytics(
    d.runs,
    d.grades,
    d.tests,
    d.suiteRuns.listChildRunIds(suiteRunId),
  );

  // 3 plottable subjects (t2×scnB is fully ungraded → omitted), sorted by test then scenario.
  assert.deepEqual(
    analytics.scatter.map((p) => `${p.testId}/${p.scenarioId}`),
    ["t1/scn-a", "t1/scn-b", "t2/scn-a"],
  );

  const [a, b, c] = analytics.scatter;
  // t1×scn-a: scores [0.8, 0.6] → mean 0.7; tokens [100, 200] → 150; cost [0.01, 0.03] → 0.02; reps 2.
  approx(a?.meanScore, 0.7, "t1/scn-a meanScore");
  approx(a?.meanTokens, 150, "t1/scn-a meanTokens");
  approx(a?.meanCostUsd, 0.02, "t1/scn-a meanCostUsd");
  assert.equal(a?.reps, 2);
  // t1×scn-b: graded [0.4] only (rep2 ungraded, NOT 0) → mean 0.4; tokens [300, 100] → 200; cost 0.03.
  approx(b?.meanScore, 0.4, "t1/scn-b meanScore");
  approx(b?.meanTokens, 200, "t1/scn-b meanTokens");
  approx(b?.meanCostUsd, 0.03, "t1/scn-b meanCostUsd");
  assert.equal(b?.reps, 2, "reps counts BOTH repetitions even though one was ungraded");
  // t2×scn-a: scores [1.0, 0.0] → mean 0.5; tokens [400, 400] → 400; cost 0.10.
  approx(c?.meanScore, 0.5, "t2/scn-a meanScore");
  approx(c?.meanTokens, 400, "t2/scn-a meanTokens");
  approx(c?.meanCostUsd, 0.1, "t2/scn-a meanCostUsd");
  assert.equal(c?.reps, 2);
});

// ── (2) Breakdowns — category / difficulty / tag × scenario; hand-computed means + counts ─────────

test("breakdowns: category/difficulty/tag slices grouped by scenario match a hand computation", () => {
  const { d, suiteRunId } = seedFixture();
  const analytics = buildSuiteAnalytics(
    d.runs,
    d.grades,
    d.tests,
    d.suiteRuns.listChildRunIds(suiteRunId),
  );

  const slice = (dimension: string, key: string, scenarioId: string) =>
    analytics.breakdowns.find(
      (s) => s.dimension === dimension && s.key === key && s.scenarioId === scenarioId,
    );

  // (category, analysis, scn-b) has no graded run → omitted; (difficulty, hard, scn-b) too.
  const keys = analytics.breakdowns.map((s) => `${s.dimension}:${s.key}:${s.scenarioId}`);
  assert.deepEqual(keys, [
    "category:analysis:scn-a",
    "category:retrieval:scn-a",
    "category:retrieval:scn-b",
    "difficulty:easy:scn-a",
    "difficulty:easy:scn-b",
    "difficulty:hard:scn-a",
    "tag:charts:scn-a",
    "tag:charts:scn-b",
    "tag:sql:scn-a",
    "tag:sql:scn-b",
  ]);

  // category retrieval scn-a = runs r1,r2 → mean 0.7, cost 0.02, count 2.
  const retA = slice("category", "retrieval", "scn-a");
  approx(retA?.meanScore, 0.7, "cat retrieval scn-a meanScore");
  approx(retA?.meanCostUsd, 0.02, "cat retrieval scn-a meanCostUsd");
  assert.equal(retA?.count, 2);

  // category retrieval scn-b = runs r3(0.4), r4(ungraded) → mean 0.4, cost (0.05+0.01)/2=0.03, count 2.
  const retB = slice("category", "retrieval", "scn-b");
  approx(retB?.meanScore, 0.4, "cat retrieval scn-b meanScore");
  approx(retB?.meanCostUsd, 0.03, "cat retrieval scn-b meanCostUsd");
  assert.equal(retB?.count, 2, "count includes the ungraded rep");

  // category analysis scn-a = r5(1.0), r6(0.0) → mean 0.5, cost 0.10, count 2.
  const anaA = slice("category", "analysis", "scn-a");
  approx(anaA?.meanScore, 0.5, "cat analysis scn-a meanScore");
  approx(anaA?.meanCostUsd, 0.1, "cat analysis scn-a meanCostUsd");
  assert.equal(anaA?.count, 2);

  // tag sql scn-a spans BOTH tests (t1 + t2): r1,r2,r5,r6 → scores [0.8,0.6,1.0,0.0] mean 0.6;
  // cost (0.01+0.03+0.1+0.1)/4 = 0.06; count 4.
  const sqlA = slice("tag", "sql", "scn-a");
  approx(sqlA?.meanScore, 0.6, "tag sql scn-a meanScore");
  approx(sqlA?.meanCostUsd, 0.06, "tag sql scn-a meanCostUsd");
  assert.equal(sqlA?.count, 4);

  // tag sql scn-b = r3(0.4),r4(–),r7(–),r8(–) → graded only [0.4] mean 0.4;
  // cost (0.05+0.01+0.005+0.005)/4 = 0.0175; count 4.
  const sqlB = slice("tag", "sql", "scn-b");
  approx(sqlB?.meanScore, 0.4, "tag sql scn-b meanScore");
  approx(sqlB?.meanCostUsd, 0.0175, "tag sql scn-b meanCostUsd");
  assert.equal(sqlB?.count, 4);

  // tag charts is only on t1 → charts scn-a = r1,r2 (mean 0.7); charts scn-b = r3,r4 (mean 0.4).
  approx(slice("tag", "charts", "scn-a")?.meanScore, 0.7, "tag charts scn-a meanScore");
  approx(slice("tag", "charts", "scn-b")?.meanScore, 0.4, "tag charts scn-b meanScore");
});

// ── (3) Grader selection — ?grader= re-scores; unknown-grader runs excluded (not 0) ───────────────

test("grader selection re-scores subjects; a run without that grader is excluded from the mean", () => {
  const db = openFresh();
  const d = deps(db);
  seedParents(db);
  const suiteRunId = seedSuiteRun(db, d.suites);
  // One subject (t1×scn-a), 2 reps. Both graded by outcome_judge (0.8/0.6); only rep1 also has rouge1 (0.5).
  seedChild(d, suiteRunId, FIXTURE[0]!); // r1: outcome 0.8
  seedChild(d, suiteRunId, FIXTURE[1]!); // r2: outcome 0.6
  d.grades.insert({
    runId: "r1",
    graderId: "rouge1",
    kind: "deterministic",
    status: "graded",
    score: 0.5,
    method: "rouge1",
  });

  const runIds = d.suiteRuns.listChildRunIds(suiteRunId);
  const byDefault = buildSuiteAnalytics(d.runs, d.grades, d.tests, runIds);
  const byRouge = buildSuiteAnalytics(d.runs, d.grades, d.tests, runIds, "rouge1");

  approx(byDefault.scatter[0]?.meanScore, 0.7, "default (outcome_judge) mean 0.7");
  // rouge1 exists only on r1 (0.5); r2 has no rouge1 grade → excluded (NOT counted as 0), so mean = 0.5.
  approx(byRouge.scatter[0]?.meanScore, 0.5, "rouge1 mean 0.5 (r2 excluded, not 0)");
  assert.equal(byRouge.scatter[0]?.reps, 2, "reps still counts both repetitions");
});

// ── (4) Empty when no grades; unknown suite run 404s ──────────────────────────────────────────────

test("analytics is honestly empty when no child run has a grade; unknown suite run 404s", () => {
  const db = openFresh();
  const d = deps(db);
  seedParents(db);
  const suiteRunId = seedSuiteRun(db, d.suites);
  // Two child runs, both ungraded.
  seedChild(d, suiteRunId, { ...FIXTURE[0]!, score: null });
  seedChild(d, suiteRunId, { ...FIXTURE[4]!, score: null });

  const empty: SuiteAnalytics = buildSuiteAnalytics(
    d.runs,
    d.grades,
    d.tests,
    d.suiteRuns.listChildRunIds(suiteRunId),
  );
  assert.deepEqual(empty, { scatter: [], breakdowns: [] });

  // The endpoint 404s an unknown suite run via getRun before it ever computes analytics.
  assert.throws(() => d.suiteRuns.getRun("nope"), /Suite run not found/);
});

// ── (5) Suite-run report — config snapshot + aggregates + grades + analytics; links resolve ───────

test("suite-run report includes config, aggregates, per-cell scores + analytics; child links resolve", () => {
  const { d, suiteRunId } = seedFixture();

  // Cache the derived aggregates onto the suite run (as the orchestrator does on finalize), so the
  // report's aggregates section is populated — recomputed from the same children + grades.
  const runIds = d.suiteRuns.listChildRunIds(suiteRunId);
  const aggregates = computeSuiteAggregates(collectChildData(d.runs, d.grades, runIds), 8);
  d.suiteRuns.finalize(suiteRunId, "completed", aggregates);

  const suiteRun = d.suiteRuns.getRun(suiteRunId);
  const reportDeps: SuiteRunReportDeps = {
    suiteRuns: d.suiteRuns,
    runs: d.runs,
    grades: d.grades,
    tests: d.tests,
    scenarios: d.scenarios,
    suites: d.suites,
    // Auto-Rating (WP 4.3) — no report has been generated in this fixture; `collectSuiteRunReportData`
    // must degrade to an ABSENT `suiteReport` (this test predates WP 4.3 and asserts no report block).
    suiteReports: new SuiteReportRepository(d.db),
  };
  const data = collectSuiteRunReportData(reportDeps, suiteRun);
  const json = createSuiteRunJsonReport(suiteRun, data);

  // Config snapshot + aggregates + analytics are all present.
  assert.equal(json.configSnapshot.repetitions, 2);
  assert.equal(json.aggregates?.cellsTotal, 8);
  assert.equal(json.aggregates?.cellsCompleted, 8);
  assert.equal(json.suiteRun.suiteName, "Analytics fixture");
  assert.equal(json.analytics.scatter.length, 3);
  assert.equal(json.analytics.breakdowns.length, 10);

  // Per-cell (= per child run) rows: 8 cells, each with a resolved score (or null) + a real runId.
  assert.equal(data.cells.length, 8);
  const r1Cell = data.cells.find((cell) => cell.runId === "r1");
  assert.ok(r1Cell, "r1 cell present");
  assert.equal(r1Cell?.testName, "Test 1");
  assert.equal(r1Cell?.scenarioName, "Scenario A");
  approx(r1Cell?.score ?? null, 0.8, "r1 cell score");
  const r4Cell = data.cells.find((cell) => cell.runId === "r4");
  assert.equal(r4Cell?.score, null, "an ungraded cell reports a null score, never 0");
  // Repetition ordinals are reconstructed per subject (started_at ASC).
  assert.deepEqual(
    data.cells
      .filter((c) => c.testId === "t1" && c.scenarioId === "scn-a")
      .map((c) => c.repetition),
    [1, 2],
  );

  // Every cited child-run id resolves to a real run (the report links `/api/reports/run/:id/json`).
  for (const cell of data.cells) {
    assert.doesNotThrow(() => d.runs.getSummary(cell.runId), `cell run ${cell.runId} resolves`);
  }

  // Markdown builds insights-first, cites the aggregates + a resolvable child-run report link.
  const md = createSuiteRunMarkdownReport(suiteRun, data);
  assert.match(md, /# MCP Token Footprint Suite Run Report/);
  assert.match(md, /## 1\. Cross-run rating report/, "rating report section leads");
  assert.match(md, /## 2\. Summary/, "identity + aggregates merged into the Summary section");
  assert.match(md, /- Mean grade: /, "aggregates content lives in the Summary section");
  assert.match(md, /## 3\. Statistics/, "scatter/breakdowns/cells grouped under Statistics");
  assert.match(md, /### Cells/, "the per-cell table is a Statistics subsection");
  assert.match(md, /## 5\. Appendix — frozen config snapshot/, "the config closes the document");
  const order = [
    "## 1. Cross-run rating report",
    "## 2. Summary",
    "## 3. Statistics",
    "## 4. Run details",
    "## 5. Appendix — frozen config snapshot",
  ].map((heading) => md.indexOf(heading));
  assert.ok(
    order.every((at, i) => at !== -1 && (i === 0 || at > (order[i - 1] ?? 0))),
    "the five sections appear in numbered order",
  );
  assert.match(md, /\/api\/reports\/run\/r1\/json/);
  assert.match(md, /Analytics fixture/);
});

// ── (5b) Suite-run report export — the Auto-Rating SuiteReport block (WP 4.3, additive) ────────────

test("suite-run report export: the SuiteReport block is ABSENT (not null) when no report has landed yet", () => {
  const { d, suiteRunId } = seedFixture();
  const suiteRun = d.suiteRuns.getRun(suiteRunId);
  const reportDeps: SuiteRunReportDeps = {
    suiteRuns: d.suiteRuns,
    runs: d.runs,
    grades: d.grades,
    tests: d.tests,
    scenarios: d.scenarios,
    suites: d.suites,
    suiteReports: new SuiteReportRepository(d.db),
  };
  const data = collectSuiteRunReportData(reportDeps, suiteRun);
  const json = createSuiteRunJsonReport(suiteRun, data);
  assert.ok(
    !("suiteReport" in json),
    "no suiteReport key when none has been generated (byte-identical to pre-WP-4.3)",
  );

  const md = createSuiteRunMarkdownReport(suiteRun, data);
  assert.match(
    md,
    /## 1\. Cross-run rating report/,
    "the section still renders (stakeholder completeness)",
  );
  assert.match(
    md,
    /_No cross-run rating report was generated \(fewer than 2 members, or generation is pending\)\._/,
    "honest no-report one-liner",
  );
  assert.ok(!/### Narrative/.test(md), "no rating-report content when none exists");
});

test("suite-run report export: the SuiteReport block is embedded verbatim once a report has landed (JSON + Markdown)", () => {
  const { d, suiteRunId } = seedFixture();
  const suiteReports = new SuiteReportRepository(d.db);
  const fixtureReport: SuiteReport = {
    suiteRunId,
    testGroups: [
      {
        testId: "t1",
        runIds: ["r1", "r2"],
        score: { mean: 0.7, stdDev: 0.1 },
        costUsd: { mean: 0.02, stdDev: 0.005 },
        turns: { mean: 3, stdDev: 1 },
        toolPathVariance: 1,
        agreement: {
          summary: "2/2 runs conclude the same root cause.",
          agreeCount: 2,
          totalCount: 2,
          contradicts: false,
        },
      },
    ],
    errorClustering: [
      {
        label: "Failed tool call",
        description: "1 of 2 run(s) hit a failed_tool_call signal.",
        memberRunIds: ["r1"],
        share: 0.5,
      },
    ],
    rootCauseRollup: [
      {
        bucket: "mcp_server",
        fixTarget: "mcp_server",
        draftFix: "Raise the server timeout",
        frequency: 1,
        memberRunIds: ["r1"],
      },
    ],
    narrative: "Both runs agree; the dominant fix targets the MCP server.",
    judgeProvenance: { judgeProviderId: "claude_cli", judgeModel: "claude-sonnet-4-5" },
    ratingVersion: AUTO_RATING_VERSION,
    generatedAt: NOW,
    skippedMembers: [],
  };
  suiteReports.insert({
    suiteRunId,
    status: "ready",
    report: fixtureReport,
    ratingVersion: AUTO_RATING_VERSION,
  });

  const suiteRun = d.suiteRuns.getRun(suiteRunId);
  const reportDeps: SuiteRunReportDeps = {
    suiteRuns: d.suiteRuns,
    runs: d.runs,
    grades: d.grades,
    tests: d.tests,
    scenarios: d.scenarios,
    suites: d.suites,
    suiteReports,
  };
  const data = collectSuiteRunReportData(reportDeps, suiteRun);
  const json = createSuiteRunJsonReport(suiteRun, data);
  assert.deepEqual(
    (json as { suiteReport: SuiteReport }).suiteReport,
    // The collector echoes the persisted ROW's status onto the report at read time (additive).
    { ...fixtureReport, status: "ready" },
    "the LATEST persisted report is embedded verbatim (+ the row's read-time status echo)",
  );
  assert.equal(
    Object.keys(json)[2],
    "suiteReport",
    "suiteReport sits right after generatedAt + suiteRun (insights-first key order)",
  );

  const md = createSuiteRunMarkdownReport(suiteRun, data);
  assert.match(md, /## 1\. Cross-run rating report/, "the rating report leads the document");
  assert.match(md, /Raise the server timeout/);
  assert.match(md, /Both runs agree; the dominant fix targets the MCP server\./);
  assert.match(md, /claude_cli/);
  // Narrative comes FIRST inside the section (before the per-test-group table).
  assert.ok(
    md.indexOf("### Narrative") < md.indexOf("### Per-test-group consistency + variance"),
    "narrative renders before the per-test-group table",
  );
});
