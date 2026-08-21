import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { afterEach, test } from "node:test";
import type { RunOutcome, RunStatus, SuiteConfig, SuiteVariant } from "@mcp-token-footprint/shared";
import { suiteRunReportQuerySchema } from "@mcp-token-footprint/shared";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { GradeRepository } from "../src/grading/grade-repository.js";
import {
  collectSuiteRunReportData,
  createSuiteRunJsonReport,
  createSuiteRunMarkdownReport,
  type SuiteRunReportDeps,
} from "../src/reports/suite-run-report.js";
import { buildSuiteRunMembers } from "../src/suites/analytics.js";
import { SuiteRepository } from "../src/suites/repository.js";
import { SuiteReportRepository } from "../src/suites/suite-report-repository.js";
import { SuiteService } from "../src/suites/service.js";
import { SuiteRunRepository } from "../src/suites/suite-run-repository.js";
import { RunRepository } from "../src/testing/run-repository.js";
import { ScenarioRepository } from "../src/testing/scenario-repository.js";
import { ScenarioService } from "../src/testing/scenario-service.js";
import { TestRepository } from "../src/testing/test-repository.js";
import { TestService } from "../src/testing/test-service.js";

// Testing UX — the suite-run MEMBER endpoint (`buildSuiteRunMembers`) + the enriched suite-run report
// export (per-cell tokens/cost + embed=full run details), tested entirely OFFLINE against hand-seeded
// `runs` rows linked to a `suite_runs` row. Members are read from PERSISTED state, so they materialise
// for a run that was never finalized (live parity) exactly as for a finished one — the whole point of
// the endpoint (the console can show what executed after the per-cell SSE stream is gone).

const databases: AppDatabase[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

const NOW = "2026-07-10T00:00:00.000Z";

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
  return {
    db,
    runs: new RunRepository(db),
    grades: new GradeRepository(db),
    tests: new TestService(new TestRepository(db)),
    scenarios: new ScenarioService(new ScenarioRepository(db)),
    suites: new SuiteService(new SuiteRepository(db)),
    suiteRuns: new SuiteRunRepository(db),
  };
}

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
    `INSERT INTO tests (id, name, user_prompt, created_at, updated_at)
     VALUES (@id, @name, 'Do the thing.', @now, @now)`,
  );
  insertTest.run({ id: "t1", name: "Test 1", now: NOW });
  insertTest.run({ id: "t2", name: "Test 2", now: NOW });
}

/** Seed the suite + a suite_runs row (still `running`, i.e. NOT finalized, unless told otherwise). */
function seedSuiteRun(db: AppDatabase, suites: SuiteService, config: SuiteConfig): string {
  const suite = suites.create({
    name: "Members fixture",
    config,
    testIds: ["t1", "t2"],
    scenarioIds: ["scn-a", "scn-b"],
  });
  const id = "sr-1";
  db.prepare(
    `INSERT INTO suite_runs (id, suite_id, status, config_snapshot_json, started_at)
     VALUES (@id, @suiteId, 'running', @config, @now)`,
  ).run({ id, suiteId: suite.id, config: JSON.stringify(config), now: NOW });
  return id;
}

type Child = {
  runId: string;
  testId: string;
  scenarioId: string;
  repetition: number;
  status: RunStatus;
  outcome?: RunOutcome;
  turns: number;
  toolCalls: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  score: number | null;
  /** run_skills.skill_id rows to attribute a variant (WP 5.1). */
  skillIds?: string[];
};

function seedChild(d: Deps, suiteRunId: string, child: Child): void {
  d.db
    .prepare(
      `INSERT INTO runs (id, test_id, scenario_id, mode, status, outcome, started_at, suite_run_id, repetition,
                         tokens_in, tokens_out, cost_usd, duration_ms, turns, tool_calls, peak_context_tokens)
       VALUES (@id, @testId, @scenarioId, 'automated', @status, @outcome, @startedAt, @suiteRunId, @rep,
               @tin, @tout, @cost, 1000, @turns, @tools, 0)`,
    )
    .run({
      id: child.runId,
      testId: child.testId,
      scenarioId: child.scenarioId,
      status: child.status,
      outcome: child.outcome ?? null,
      startedAt: `2026-07-10T00:00:0${child.repetition}.000Z`,
      suiteRunId,
      rep: child.repetition,
      tin: child.tokensIn,
      tout: child.tokensOut,
      cost: child.costUsd,
      turns: child.turns,
      tools: child.toolCalls,
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
  for (const skillId of child.skillIds ?? []) {
    d.db
      .prepare(
        `INSERT INTO run_skills (run_id, skill_id, skill_version_id, version_label, eager)
         VALUES (@runId, @skillId, @versionId, 'v1', 0)`,
      )
      .run({ runId: child.runId, skillId, versionId: `${skillId}-v1` });
  }
}

/** A minimal llm_response step so a member's embed=full run report has a session log to render. */
function seedStep(d: Deps, runId: string): void {
  d.db
    .prepare(
      `INSERT INTO run_steps (id, run_id, idx, type, label, status, turn_index, assistant_text, payload_json, profile_tokens_json)
       VALUES (@id, @runId, 0, 'llm_response', 'Assistant', 'completed', 0, 'Hello world.', '{}', '{}')`,
    )
    .run({ id: `${runId}-s0`, runId });
  d.db
    .prepare(
      `INSERT INTO run_events (id, run_id, idx, type, payload_json, created_at) VALUES (@id, @runId, 0, 'log', '{}', @now)`,
    )
    .run({ id: `${runId}-e0`, runId, now: NOW });
}

const PLAIN: SuiteConfig = { repetitions: 2, maxConcurrency: 4 };

function reportDeps(d: Deps): SuiteRunReportDeps {
  return {
    suiteRuns: d.suiteRuns,
    runs: d.runs,
    grades: d.grades,
    tests: d.tests,
    scenarios: d.scenarios,
    suites: d.suites,
    // Auto-Rating (WP 4.3) — no report has been generated in this fixture; `collectSuiteRunReportData`
    // degrades to an ABSENT `suiteReport` (these pre-4.3 tests assert no report block).
    suiteReports: new SuiteReportRepository(d.db),
  };
}

// ── (1) Members — one row per child with real tokens/cost/status/score + repetition ────────────────

test("members: one row per child carrying its tokens/cost/status/score + repetition", () => {
  const db = openFresh();
  const d = deps(db);
  seedParents(db);
  const sr = seedSuiteRun(db, d.suites, PLAIN);
  seedChild(d, sr, {
    runId: "r1",
    testId: "t1",
    scenarioId: "scn-a",
    repetition: 1,
    status: "completed",
    turns: 3,
    toolCalls: 2,
    tokensIn: 60,
    tokensOut: 40,
    costUsd: 0.01,
    score: 0.8,
  });
  seedChild(d, sr, {
    runId: "r2",
    testId: "t1",
    scenarioId: "scn-a",
    repetition: 2,
    status: "completed",
    turns: 4,
    toolCalls: 1,
    tokensIn: 120,
    tokensOut: 80,
    costUsd: 0.03,
    score: 0.6,
  });
  seedChild(d, sr, {
    runId: "r3",
    testId: "t1",
    scenarioId: "scn-b",
    repetition: 1,
    status: "error",
    outcome: "error",
    turns: 1,
    toolCalls: 0,
    tokensIn: 10,
    tokensOut: 5,
    costUsd: 0.002,
    score: null,
  });

  const members = buildSuiteRunMembers(d.runs, d.grades, d.suiteRuns.listChildRunIds(sr), []);
  assert.equal(members.length, 3);

  const r1 = members.find((m) => m.id === "r1");
  assert.ok(r1);
  assert.equal(r1?.testId, "t1");
  assert.equal(r1?.scenarioId, "scn-a");
  assert.equal(r1?.status, "completed");
  assert.equal(r1?.turns, 3);
  assert.equal(r1?.toolCalls, 2);
  assert.equal(r1?.tokensIn, 60);
  assert.equal(r1?.tokensOut, 40);
  assert.equal(r1?.costUsd, 0.01);
  assert.equal(r1?.repetition, 1);
  assert.equal(r1?.score, 0.8);

  assert.equal(members.find((m) => m.id === "r3")?.status, "error");
  assert.equal(
    members.find((m) => m.id === "r3")?.score,
    null,
    "an ungraded member reports null, never 0",
  );
});

// ── (2) Grader re-selection mirrors the analytics/aggregate score dimension ────────────────────────

test("members: ?grader= re-scores; a run without that grader reports null (not 0)", () => {
  const db = openFresh();
  const d = deps(db);
  seedParents(db);
  const sr = seedSuiteRun(db, d.suites, PLAIN);
  seedChild(d, sr, {
    runId: "r1",
    testId: "t1",
    scenarioId: "scn-a",
    repetition: 1,
    status: "completed",
    turns: 1,
    toolCalls: 0,
    tokensIn: 60,
    tokensOut: 40,
    costUsd: 0.01,
    score: 0.8,
  });
  seedChild(d, sr, {
    runId: "r2",
    testId: "t1",
    scenarioId: "scn-a",
    repetition: 2,
    status: "completed",
    turns: 1,
    toolCalls: 0,
    tokensIn: 60,
    tokensOut: 40,
    costUsd: 0.01,
    score: 0.6,
  });
  d.grades.insert({
    runId: "r1",
    graderId: "rouge1",
    kind: "deterministic",
    status: "graded",
    score: 0.5,
    method: "rouge1",
  });

  const runIds = d.suiteRuns.listChildRunIds(sr);
  const byDefault = buildSuiteRunMembers(d.runs, d.grades, runIds, []);
  const byRouge = buildSuiteRunMembers(d.runs, d.grades, runIds, [], "rouge1");

  assert.equal(byDefault.find((m) => m.id === "r1")?.score, 0.8, "default = outcome_judge");
  assert.equal(byRouge.find((m) => m.id === "r1")?.score, 0.5, "rouge1 re-selected");
  assert.equal(byRouge.find((m) => m.id === "r2")?.score, null, "r2 has no rouge1 grade → null");
});

// ── (3) Live parity + robustness (unfinalized run; deleted run id skipped) ─────────────────────────

test("members: returned for an UNFINALIZED (running) suite run; an unknown run id is skipped", () => {
  const db = openFresh();
  const d = deps(db);
  seedParents(db);
  const sr = seedSuiteRun(db, d.suites, PLAIN); // status stays 'running' — never finalized
  seedChild(d, sr, {
    runId: "r1",
    testId: "t1",
    scenarioId: "scn-a",
    repetition: 1,
    status: "running",
    turns: 1,
    toolCalls: 0,
    tokensIn: 10,
    tokensOut: 0,
    costUsd: 0,
    score: null,
  });

  assert.equal(d.suiteRuns.getRun(sr).status, "running");
  const members = buildSuiteRunMembers(
    d.runs,
    d.grades,
    [...d.suiteRuns.listChildRunIds(sr), "ghost-run"],
    [],
  );
  assert.equal(
    members.length,
    1,
    "the deleted/unknown run id is skipped, the live one is returned",
  );
  assert.equal(members[0]?.status, "running");
});

// ── (4) Variant attribution KEEPS an unattributable run (unlike deltas) ────────────────────────────

test("members: variant attribution labels matched runs and KEEPS unmatched ones", () => {
  const db = openFresh();
  const d = deps(db);
  seedParents(db);
  const variants: SuiteVariant[] = [
    { label: "base", scenarioId: "scn-a", skillOverrides: {} },
    {
      label: "+skill",
      scenarioId: "scn-a",
      skillOverrides: { attach: [{ skillId: "sk1", versionId: "latest" }] },
    },
  ];
  const sr = seedSuiteRun(db, d.suites, { ...PLAIN, variants });
  // A: scn-a with sk1 loaded → most-specific match "+skill". B: scn-a no skills → "base".
  // C: scn-b — no variant is on scn-b → unattributable, but KEPT (it honestly ran).
  seedChild(d, sr, {
    runId: "rA",
    testId: "t1",
    scenarioId: "scn-a",
    repetition: 1,
    status: "completed",
    turns: 1,
    toolCalls: 0,
    tokensIn: 10,
    tokensOut: 5,
    costUsd: 0.01,
    score: 0.9,
    skillIds: ["sk1"],
  });
  seedChild(d, sr, {
    runId: "rB",
    testId: "t1",
    scenarioId: "scn-a",
    repetition: 2,
    status: "completed",
    turns: 1,
    toolCalls: 0,
    tokensIn: 10,
    tokensOut: 5,
    costUsd: 0.01,
    score: 0.5,
  });
  seedChild(d, sr, {
    runId: "rC",
    testId: "t1",
    scenarioId: "scn-b",
    repetition: 1,
    status: "completed",
    turns: 1,
    toolCalls: 0,
    tokensIn: 10,
    tokensOut: 5,
    costUsd: 0.01,
    score: 0.7,
  });

  const members = buildSuiteRunMembers(d.runs, d.grades, d.suiteRuns.listChildRunIds(sr), variants);
  assert.equal(members.length, 3, "all three runs are kept");
  assert.equal(members.find((m) => m.id === "rA")?.variantLabel, "+skill");
  assert.equal(members.find((m) => m.id === "rB")?.variantLabel, "base");
  assert.equal(
    members.find((m) => m.id === "rC")?.variantLabel,
    undefined,
    "unattributable → kept, no label",
  );
});

// ── (5) Report — summary enriches cells with tokens/cost, embeds NO detail ─────────────────────────

test("report embed=summary: cells carry tokens/cost; no embedded run detail; markdown has no §6", () => {
  const db = openFresh();
  const d = deps(db);
  seedParents(db);
  const sr = seedSuiteRun(db, d.suites, PLAIN);
  seedChild(d, sr, {
    runId: "r1",
    testId: "t1",
    scenarioId: "scn-a",
    repetition: 1,
    status: "completed",
    turns: 3,
    toolCalls: 2,
    tokensIn: 60,
    tokensOut: 40,
    costUsd: 0.01,
    score: 0.8,
  });

  const suiteRun = d.suiteRuns.getRun(sr);
  const data = collectSuiteRunReportData(reportDeps(d), suiteRun); // default = summary
  assert.equal(data.embed, "summary");
  const cell = data.cells.find((c) => c.runId === "r1");
  assert.ok(cell);
  assert.equal(cell?.tokensIn, 60);
  assert.equal(cell?.tokensOut, 40);
  assert.equal(cell?.costUsd, 0.01);
  assert.equal(cell?.turns, 3);
  assert.equal(cell?.toolCalls, 2);
  assert.equal(cell?.detail, undefined, "summary embeds no full run report");
  assert.equal(cell?.grades, undefined);

  const json = createSuiteRunJsonReport(suiteRun, data);
  assert.equal(json.embed, "summary");
  const md = createSuiteRunMarkdownReport(suiteRun, data);
  // §4 still renders (stable stakeholder numbering) but embeds nothing — an honest pointer instead.
  assert.match(md, /## 4\. Run details/, "the Run details section always renders");
  assert.match(
    md,
    /_Member run details are not embedded in a summary export/,
    "summary embed renders an honest pointer instead of member logs",
  );
  assert.doesNotMatch(md, /### Run r1/, "no member run report is embedded for embed=summary");
  // RM-33 WP 3.2 inserted the two cache columns between Tokens and Cost.
  assert.match(
    md,
    /\| Tokens \| Cache read \| Cache write \| Cost \|/,
    "the cell table carries real tokens + the cache split + cost columns",
  );
});

// ── (6) Report — embed=full embeds each member's real run report (steps) + grades ──────────────────

test("report embed=full: each cell embeds its full run report (steps) + grades; markdown fills §4", () => {
  const db = openFresh();
  const d = deps(db);
  seedParents(db);
  const sr = seedSuiteRun(db, d.suites, PLAIN);
  seedChild(d, sr, {
    runId: "r1",
    testId: "t1",
    scenarioId: "scn-a",
    repetition: 1,
    status: "completed",
    turns: 1,
    toolCalls: 0,
    tokensIn: 60,
    tokensOut: 40,
    costUsd: 0.01,
    score: 0.8,
  });
  seedStep(d, "r1"); // give the run a session log to embed

  const suiteRun = d.suiteRuns.getRun(sr);
  const data = collectSuiteRunReportData(reportDeps(d), suiteRun, undefined, "full");
  assert.equal(data.embed, "full");
  const cell = data.cells.find((c) => c.runId === "r1");
  assert.ok(cell?.detail, "the cell embeds a full run report");
  assert.ok(Array.isArray(cell?.detail?.run.steps), "the embedded report carries the run's steps");
  assert.equal(cell?.detail?.run.steps.length, 1, "the seeded step is embedded");
  assert.ok(Array.isArray(cell?.grades), "the cell embeds its grade rows");
  assert.equal(cell?.grades?.[0]?.graderId, "outcome_judge");

  const md = createSuiteRunMarkdownReport(suiteRun, data);
  assert.match(md, /## 4\. Run details/, "markdown renders the run-details section");
  assert.match(md, /### Run r1 —/, "each member run is a subsection");
  assert.match(
    md,
    /#### MCP Token Footprint Run Report/,
    "the embedded run report headings are demoted (H1→H4)",
  );
});

// ── (7) Report — embed=full degrades a cell whose test was deleted, never throws ───────────────────

test("report embed=full: a member whose test is gone degrades to summary-only, doesn't 500", () => {
  const db = openFresh();
  const d = deps(db);
  seedParents(db);
  const sr = seedSuiteRun(db, d.suites, PLAIN);
  seedChild(d, sr, {
    runId: "r1",
    testId: "t1",
    scenarioId: "scn-a",
    repetition: 1,
    status: "completed",
    turns: 1,
    toolCalls: 0,
    tokensIn: 60,
    tokensOut: 40,
    costUsd: 0.01,
    score: 0.8,
  });
  // An orphan run whose test no longer exists (FK off so the run itself survives the missing parent).
  db.pragma("foreign_keys = OFF");
  db.prepare(
    `INSERT INTO runs (id, test_id, scenario_id, mode, status, started_at, suite_run_id, repetition,
                       tokens_in, tokens_out, cost_usd, duration_ms, turns, tool_calls, peak_context_tokens)
     VALUES ('r-orphan', 'ghost-test', 'scn-a', 'automated', 'completed', '2026-07-10T00:00:09.000Z', @sr, 1,
             30, 20, 0.02, 500, 2, 1, 0)`,
  ).run({ sr });
  db.pragma("foreign_keys = ON");

  const suiteRun = d.suiteRuns.getRun(sr);
  let data!: ReturnType<typeof collectSuiteRunReportData>;
  assert.doesNotThrow(() => {
    data = collectSuiteRunReportData(reportDeps(d), suiteRun, undefined, "full");
  });
  const orphan = data.cells.find((c) => c.runId === "r-orphan");
  assert.ok(orphan, "the orphan cell is still reported");
  assert.equal(orphan?.tokensIn, 30, "with its real spend");
  assert.equal(orphan?.detail, undefined, "but degraded to summary-only (no embedded detail)");
  // The healthy run still embeds its detail.
  assert.ok(
    data.cells.find((c) => c.runId === "r1")?.detail,
    "the healthy cell still embeds full detail",
  );
});

// ── (8) The report query schema defaults + validates the embed level ───────────────────────────────

test("suiteRunReportQuerySchema defaults embed to summary and rejects an unknown level", () => {
  assert.equal(suiteRunReportQuerySchema.parse({}).embed, "summary");
  assert.equal(suiteRunReportQuerySchema.parse({ embed: "full" }).embed, "full");
  assert.throws(() => suiteRunReportQuerySchema.parse({ embed: "everything" }));
});

// ── RM-33 WP 3.2 — the cache split across the matrix ───────────────────────────────────────────────
//
// A suite run is where "how much of this fleet's spend was cache" is actually decided, so the export
// carries the split per cell AND as an aggregate. The aggregate is ALL-OR-NOTHING (WP 1.2): one
// member that cannot answer makes the whole figure unknown, because a partial sum understates the
// matrix while looking complete. Read and write are never merged (D-CT2) — a read is a ~0.1x
// discount, a write a 1.25x premium, and one combined bar would render the premium as a saving.

/** Write the migration-59 cache columns onto an already-seeded child run. */
function setChildCache(
  d: Deps,
  runId: string,
  cache: { cached: number; read: number | null; write: number | null },
): void {
  d.db
    .prepare(
      `UPDATE runs SET cached_tokens = @cached, cache_read_tokens = @read, cache_write_tokens = @write
       WHERE id = @id`,
    )
    .run({ id: runId, cached: cache.cached, read: cache.read, write: cache.write });
}

test("report cells carry the cache split, and a member that cannot answer reads — not 0", () => {
  const db = openFresh();
  const d = deps(db);
  seedParents(db);
  const sr = seedSuiteRun(db, d.suites, PLAIN);
  const base = {
    testId: "t1",
    scenarioId: "scn-a",
    status: "completed" as RunStatus,
    turns: 1,
    toolCalls: 0,
    tokensIn: 1000,
    tokensOut: 100,
    costUsd: 0.01,
    score: 0.8,
  };
  seedChild(d, sr, { ...base, runId: "known", repetition: 1 });
  seedChild(d, sr, { ...base, runId: "unknown", repetition: 2 });
  setChildCache(d, "known", { cached: 900, read: 800, write: 100 });
  // "unknown" keeps NULL cache columns — a pre-migration-59 / merged-only run.

  const suiteRun = d.suiteRuns.getRun(sr);
  const data = collectSuiteRunReportData(reportDeps(d), suiteRun);
  const known = data.cells.find((c) => c.runId === "known");
  const unknown = data.cells.find((c) => c.runId === "unknown");
  assert.equal(known?.cacheReadTokens, 800);
  assert.equal(known?.cacheWriteTokens, 100);
  assert.equal(unknown?.cacheReadTokens, undefined, "unknowable ⇒ absent, never a fabricated 0");
  assert.equal(unknown?.tokensIn, 1000, "D-CT1 — the gross figure is untouched either way");

  const md = createSuiteRunMarkdownReport(suiteRun, data);
  assert.match(md, /\| 1100 \| 800 \| 100 \| \$0\.0100 \|/, "the known member prints its split");
  assert.match(md, /\| 1100 \| — \| — \| \$0\.0100 \|/, "the unknown member prints an em dash");
});

test("the aggregates line prints the split when known and says WHY when it is not", () => {
  const db = openFresh();
  const d = deps(db);
  seedParents(db);
  const sr = seedSuiteRun(db, d.suites, PLAIN);
  seedChild(d, sr, {
    runId: "r1",
    testId: "t1",
    scenarioId: "scn-a",
    repetition: 1,
    status: "completed",
    turns: 1,
    toolCalls: 0,
    tokensIn: 1000,
    tokensOut: 100,
    costUsd: 0.01,
    score: 0.8,
  });

  const withSplit = {
    ...d.suiteRuns.getRun(sr),
    aggregates: {
      cellsTotal: 1,
      cellsCompleted: 1,
      meanGrade: 0.8,
      gradeStdDev: 0,
      passRateAt05: 1,
      totalTokens: 1100,
      cacheReadTokens: 800,
      cacheWriteTokens: 100,
      execCostUsd: 0.01,
      judgeCostUsd: 0,
    },
  };
  const data = collectSuiteRunReportData(reportDeps(d), withSplit);
  const md = createSuiteRunMarkdownReport(withSplit, data);
  assert.match(md, /- Cache read: 800 \(billed ~0\.1x input — a discount\)/);
  assert.match(md, /- Cache write: 100 \(billed 1\.25x input — a premium, not a saving\)/);

  // Drop the split — one unknown member is enough for WP 1.2's roll-up to leave it out entirely.
  const noSplit = {
    ...withSplit,
    aggregates: {
      ...withSplit.aggregates,
      cacheReadTokens: undefined,
      cacheWriteTokens: undefined,
    },
  };
  const mdNoSplit = createSuiteRunMarkdownReport(
    noSplit,
    collectSuiteRunReportData(reportDeps(d), noSplit),
  );
  assert.match(mdNoSplit, /- Cache read \/ write: not measured across this matrix/);
  assert.doesNotMatch(mdNoSplit, /- Cache read: 0/, "never a 0 that looks like 'caching stopped'");
});

test("an embedded member report carries the SAME cost breakdown as its standalone export", () => {
  const db = openFresh();
  const d = deps(db);
  seedParents(db);
  const sr = seedSuiteRun(db, d.suites, PLAIN);
  seedChild(d, sr, {
    runId: "r1",
    testId: "t1",
    scenarioId: "scn-a",
    repetition: 1,
    status: "completed",
    turns: 1,
    toolCalls: 0,
    tokensIn: 1000,
    tokensOut: 100,
    costUsd: 0.01,
    score: 0.8,
  });
  seedStep(d, "r1");
  setChildCache(d, "r1", { cached: 900, read: 800, write: 100 });

  const suiteRun = d.suiteRuns.getRun(sr);
  const data = collectSuiteRunReportData(reportDeps(d), suiteRun, undefined, "full");
  const detail = data.cells.find((c) => c.runId === "r1")?.detail;
  assert.ok(detail, "embed=full embeds the member's own run report");
  assert.equal(detail.statistics.cacheReadTokens, 800);
  assert.equal(detail.statistics.cacheWriteTokens, 100);
  assert.ok(
    detail.statistics.costBreakdown,
    "the embedded report goes through the same enrichment builder as GET /api/reports/run/:id/json",
  );
  assert.equal(detail.statistics.costBreakdown.split, "exact");
});
