// Observability WP1.1 — the RunFilter grammar over `GET /api/runs` + the repository SQL translation.
//
// Proves (acceptance):
//   1. Every filter field family filters correctly against seeded fixtures — incl. combined AND,
//      date windows, and score-with-grader (latest-per-grader).  (repository `queryRuns`)
//   2. Round-trip serialize/parse is proven in packages/shared/src/run-filter.test.ts; here we prove
//      a malformed `filter=` → 400 through the real route.
//   3. `q` runs full-text search (WP1.3) — composes with filters, returns snippet+kind.  (route)
//   4. The no-param `GET /api/runs` path is byte-identical to today's `listRuns()`.  (repo + route)
//   +  The SQL translation AGREES with the pure `matchesRunFilter` predicate (cross-check) so the two
//      consumers of the grammar can never drift.

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import Fastify from "fastify";
import { ZodError } from "zod";
import {
  matchesRunFilter,
  type RunFilter,
  type RunFilterCandidate,
} from "@mcp-token-footprint/shared";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { computeRunMetrics } from "../src/observability/metrics.js";
import { RunManager } from "../src/testing/run-manager.js";
import { RunRepository } from "../src/testing/run-repository.js";
import type { RunService } from "../src/testing/run-service.js";
import { registerTestingRoutes } from "../src/testing/routes.js";
import type { ScenarioService } from "../src/testing/scenario-service.js";
import type { TestService } from "../src/testing/test-service.js";
import { toErrorMessage } from "../src/utils/errors.js";

const databases: AppDatabase[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

const NOW = "2026-06-01T00:00:00.000Z";

function createDatabase(): AppDatabase {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  databases.push(db);
  return db;
}

// ── Seed a fixture graph that distinguishes every filter dimension ───────────────────────────────

type RunSeed = {
  id: string;
  scenarioId: string;
  testId: string;
  mode: "automated" | "interactive";
  status: string;
  outcome?: string;
  stopReasonCode?: string;
  phase?: string;
  seen?: boolean;
  costUsd?: number;
  tokensIn?: number;
  tokensOut?: number;
  activeDurationMs?: number;
  totalDurationMs?: number;
  startedAt: string;
  suiteRunId?: string;
  pinned?: boolean;
};

const RUNS: RunSeed[] = [
  {
    id: "r1",
    scenarioId: "scn-A",
    testId: "t-1",
    mode: "automated",
    status: "completed",
    outcome: "completed",
    seen: true,
    costUsd: 0.1,
    tokensIn: 100,
    tokensOut: 200,
    activeDurationMs: 5000,
    startedAt: "2026-07-01T00:00:00.000Z",
    pinned: true,
  },
  {
    id: "r2",
    scenarioId: "scn-B",
    testId: "t-2",
    mode: "interactive",
    status: "error",
    outcome: "error",
    stopReasonCode: "provider_error",
    seen: false,
    costUsd: 1.5,
    tokensIn: 2000,
    tokensOut: 3000,
    activeDurationMs: 20000,
    startedAt: "2026-07-05T00:00:00.000Z",
    suiteRunId: "sr-1",
  },
  {
    id: "r3",
    scenarioId: "scn-C",
    testId: "t-1",
    mode: "interactive",
    status: "ended",
    outcome: "ended",
    stopReasonCode: "session_ended",
    seen: true,
    costUsd: 0.2,
    tokensIn: 50,
    tokensOut: 50,
    activeDurationMs: 3000,
    startedAt: "2026-07-08T00:00:00.000Z",
  },
  {
    id: "r4",
    scenarioId: "scn-A",
    testId: "t-2",
    mode: "interactive",
    status: "running",
    phase: "waiting_input",
    seen: false,
    costUsd: 0,
    tokensIn: 0,
    tokensOut: 0,
    // No active/total duration — a live run; used to prove a duration bound EXCLUDES a run with neither.
    startedAt: "2026-07-10T00:00:00.000Z",
  },
  {
    id: "r5",
    scenarioId: "scn-B",
    testId: "t-1",
    mode: "automated",
    status: "completed",
    outcome: "assertions_failed",
    seen: false,
    costUsd: 0.5,
    tokensIn: 400,
    tokensOut: 600,
    activeDurationMs: 8000,
    startedAt: "2026-07-12T00:00:00.000Z",
    suiteRunId: "sr-1",
  },
];

function seed(db: AppDatabase): RunRepository {
  const provider = db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, created_at, updated_at) VALUES (@id, @kind, @label, @now, @now)`,
  );
  provider.run({ id: "prov-1", kind: "anthropic", label: "Claude", now: NOW });
  provider.run({ id: "prov-2", kind: "openai", label: "OpenAI", now: NOW });

  const server = db.prepare(
    `INSERT INTO mcp_servers (id, name, transport, command, created_at, updated_at) VALUES (@id, @name, 'stdio', 'x', @now, @now)`,
  );
  for (const id of ["srv-1", "srv-2", "srv-3"]) server.run({ id, name: id, now: NOW });

  const scenario = db.prepare(
    `INSERT INTO scenarios (id, name, provider_id, model, created_at, updated_at) VALUES (@id, @name, @providerId, @model, @now, @now)`,
  );
  scenario.run({
    id: "scn-A",
    name: "A",
    providerId: "prov-1",
    model: "claude-sonnet-4",
    now: NOW,
  });
  scenario.run({ id: "scn-B", name: "B", providerId: "prov-2", model: "gpt-5", now: NOW });
  scenario.run({ id: "scn-C", name: "C", providerId: "prov-1", model: "claude-haiku", now: NOW });

  const scenServer = db.prepare(
    `INSERT INTO scenario_servers (scenario_id, server_id) VALUES (@scenarioId, @serverId)`,
  );
  scenServer.run({ scenarioId: "scn-A", serverId: "srv-1" });
  scenServer.run({ scenarioId: "scn-A", serverId: "srv-2" });
  scenServer.run({ scenarioId: "scn-B", serverId: "srv-3" });

  const collection = db.prepare(
    `INSERT INTO collections (id, name, created_at, updated_at) VALUES (@id, @name, @now, @now)`,
  );
  collection.run({ id: "col-1", name: "Col 1", now: NOW });
  collection.run({ id: "col-2", name: "Col 2", now: NOW });

  const testRow = db.prepare(
    `INSERT INTO tests (id, name, user_prompt, collection_id, created_at, updated_at) VALUES (@id, @name, 'go', @collectionId, @now, @now)`,
  );
  testRow.run({ id: "t-1", name: "T1", collectionId: "col-1", now: NOW });
  testRow.run({ id: "t-2", name: "T2", collectionId: null, now: NOW });

  db.prepare(
    `INSERT INTO suites (id, name, collection_id, created_at, updated_at) VALUES ('su-1', 'Suite 1', 'col-2', @now, @now)`,
  ).run({ now: NOW });
  db.prepare(
    `INSERT INTO suite_runs (id, suite_id, status, started_at) VALUES ('sr-1', 'su-1', 'completed', @now)`,
  ).run({ now: NOW });

  const runInsert = db.prepare(
    `INSERT INTO runs (
       id, test_id, scenario_id, mode, status, outcome, stop_reason_code, phase, seen,
       started_at, cost_usd, tokens_in, tokens_out, active_duration_ms, total_duration_ms, suite_run_id, pinned
     ) VALUES (
       @id, @testId, @scenarioId, @mode, @status, @outcome, @stopReasonCode, @phase, @seen,
       @startedAt, @costUsd, @tokensIn, @tokensOut, @activeDurationMs, @totalDurationMs, @suiteRunId, @pinned
     )`,
  );
  for (const r of RUNS) {
    runInsert.run({
      id: r.id,
      testId: r.testId,
      scenarioId: r.scenarioId,
      mode: r.mode,
      status: r.status,
      outcome: r.outcome ?? null,
      stopReasonCode: r.stopReasonCode ?? null,
      phase: r.phase ?? null,
      seen: r.seen ? 1 : 0,
      startedAt: r.startedAt,
      costUsd: r.costUsd ?? 0,
      tokensIn: r.tokensIn ?? 0,
      tokensOut: r.tokensOut ?? 0,
      activeDurationMs: r.activeDurationMs ?? null,
      totalDurationMs: r.totalDurationMs ?? null,
      suiteRunId: r.suiteRunId ?? null,
      pinned: r.pinned ? 1 : 0,
    });
  }

  const skill = db.prepare(
    `INSERT INTO run_skills (run_id, skill_id, skill_version_id) VALUES (@runId, @skillId, @skillVersionId)`,
  );
  skill.run({ runId: "r1", skillId: "sk-1", skillVersionId: "sv-1" });
  skill.run({ runId: "r5", skillId: "sk-2", skillVersionId: "sv-2" });

  const grade = db.prepare(
    `INSERT INTO run_grades (id, run_id, grader_id, kind, status, score, method, grading_version, created_at)
     VALUES (@id, @runId, @graderId, 'llm', 'graded', @score, 'test', 1, @createdAt)`,
  );
  grade.run({
    id: "g1",
    runId: "r1",
    graderId: "outcome_judge",
    score: 0.8,
    createdAt: "2026-07-01T01:00:00.000Z",
  });
  grade.run({
    id: "g2",
    runId: "r2",
    graderId: "tool_hygiene",
    score: 0.3,
    createdAt: "2026-07-05T01:00:00.000Z",
  });
  // r5 was graded twice by outcome_judge — the LATEST (0.4) must win, not the earlier 0.9.
  grade.run({
    id: "g3",
    runId: "r5",
    graderId: "outcome_judge",
    score: 0.9,
    createdAt: "2026-07-12T01:00:00.000Z",
  });
  grade.run({
    id: "g4",
    runId: "r5",
    graderId: "outcome_judge",
    score: 0.4,
    createdAt: "2026-07-12T02:00:00.000Z",
  });

  // WP1.5 — human feedback (`run_feedback`), RUN-LEVEL (no step_id): r1/r5 carry a scored 'verdict';
  // r2 carries an UNSCORED 'notes' comment (score NULL) — proves `hasScore` distinguishes the two.
  // r3/r4 carry none. Deliberately DISJOINT from run_grades (r1/r2/r5 above) so the SEPARATION
  // regression test (run-feedback.test.ts) has a fixture where both exist on the same runs.
  const feedback = db.prepare(
    `INSERT INTO run_feedback (id, run_id, step_id, key, score, comment, source, created_at)
     VALUES (@id, @runId, NULL, @key, @score, @comment, 'human', @createdAt)`,
  );
  feedback.run({
    id: "f1",
    runId: "r1",
    key: "verdict",
    score: 1,
    comment: null,
    createdAt: "2026-07-01T02:00:00.000Z",
  });
  feedback.run({
    id: "f2",
    runId: "r2",
    key: "notes",
    score: null,
    comment: "needs review",
    createdAt: "2026-07-05T02:00:00.000Z",
  });
  feedback.run({
    id: "f3",
    runId: "r5",
    key: "verdict",
    score: -1,
    comment: null,
    createdAt: "2026-07-12T03:00:00.000Z",
  });

  return new RunRepository(db);
}

function ids(rows: { id: string }[]): string[] {
  return rows.map((r) => r.id).sort();
}

// ── Acceptance #1 — every filter field family ────────────────────────────────────────────────────

test("filter: status / outcome / stopReasonCode / phase", () => {
  const runs = seed(createDatabase());
  assert.deepEqual(ids(runs.queryRuns({ status: ["completed"] })), ["r1", "r5"]);
  assert.deepEqual(ids(runs.queryRuns({ status: ["error", "ended"] })), ["r2", "r3"]);
  assert.deepEqual(ids(runs.queryRuns({ outcome: ["assertions_failed"] })), ["r5"]);
  assert.deepEqual(ids(runs.queryRuns({ stopReasonCode: ["provider_error"] })), ["r2"]);
  assert.deepEqual(ids(runs.queryRuns({ stopReasonCode: ["session_ended"] })), ["r3"]);
  assert.deepEqual(ids(runs.queryRuns({ phase: ["waiting_input"] })), ["r4"]);
});

test("filter: seen / interactiveOnly / hasError", () => {
  const runs = seed(createDatabase());
  assert.deepEqual(ids(runs.queryRuns({ seen: true })), ["r1", "r3"]);
  assert.deepEqual(ids(runs.queryRuns({ seen: false })), ["r2", "r4", "r5"]);
  assert.deepEqual(ids(runs.queryRuns({ interactiveOnly: true })), ["r2", "r3", "r4"]);
  assert.deepEqual(ids(runs.queryRuns({ hasError: true })), ["r2"]);
  assert.deepEqual(ids(runs.queryRuns({ hasError: false })), ["r1", "r3", "r4", "r5"]);
});

test("filter: providerKind / model (scenario joins)", () => {
  const runs = seed(createDatabase());
  assert.deepEqual(ids(runs.queryRuns({ providerKind: ["openai"] })), ["r2", "r5"]);
  assert.deepEqual(ids(runs.queryRuns({ providerKind: ["anthropic"] })), ["r1", "r3", "r4"]);
  assert.deepEqual(ids(runs.queryRuns({ model: ["gpt-5"] })), ["r2", "r5"]);
  assert.deepEqual(ids(runs.queryRuns({ model: ["claude-haiku"] })), ["r3"]);
});

test("filter: serverId / scenarioId / testId / skillId", () => {
  const runs = seed(createDatabase());
  assert.deepEqual(ids(runs.queryRuns({ serverId: ["srv-3"] })), ["r2", "r5"]);
  assert.deepEqual(ids(runs.queryRuns({ serverId: ["srv-1"] })), ["r1", "r4"]);
  assert.deepEqual(ids(runs.queryRuns({ serverId: ["srv-1", "srv-3"] })), ["r1", "r2", "r4", "r5"]);
  assert.deepEqual(ids(runs.queryRuns({ scenarioId: ["scn-A"] })), ["r1", "r4"]);
  assert.deepEqual(ids(runs.queryRuns({ testId: ["t-1"] })), ["r1", "r3", "r5"]);
  assert.deepEqual(ids(runs.queryRuns({ skillId: ["sk-1"] })), ["r1"]);
  assert.deepEqual(ids(runs.queryRuns({ skillId: ["sk-2"] })), ["r5"]);
});

test("filter: suiteId / suiteRunId / collectionId (suite + test membership)", () => {
  const runs = seed(createDatabase());
  assert.deepEqual(ids(runs.queryRuns({ suiteId: "su-1" })), ["r2", "r5"]);
  assert.deepEqual(ids(runs.queryRuns({ suiteRunId: "sr-1" })), ["r2", "r5"]);
  // col-1: the tests t-1 members (r1, r3, r5).
  assert.deepEqual(ids(runs.queryRuns({ collectionId: "col-1" })), ["r1", "r3", "r5"]);
  // col-2: the suite su-1 members via suite_run (r2, r5).
  assert.deepEqual(ids(runs.queryRuns({ collectionId: "col-2" })), ["r2", "r5"]);
});

test("filter: cost / tokens / duration ranges", () => {
  const runs = seed(createDatabase());
  assert.deepEqual(ids(runs.queryRuns({ costUsdGte: 0.5 })), ["r2", "r5"]);
  assert.deepEqual(ids(runs.queryRuns({ costUsdLte: 0.2 })), ["r1", "r3", "r4"]);
  assert.deepEqual(ids(runs.queryRuns({ tokensGte: 700 })), ["r2", "r5"]);
  assert.deepEqual(ids(runs.queryRuns({ tokensLte: 300 })), ["r1", "r3", "r4"]);
  assert.deepEqual(ids(runs.queryRuns({ durationMsGte: 5000 })), ["r1", "r2", "r5"]);
  // r4 has neither active nor total duration → excluded by any duration bound.
  assert.deepEqual(ids(runs.queryRuns({ durationMsLte: 4000 })), ["r3"]);
});

test("filter: date windows", () => {
  const runs = seed(createDatabase());
  assert.deepEqual(ids(runs.queryRuns({ dateFrom: "2026-07-06T00:00:00.000Z" })), [
    "r3",
    "r4",
    "r5",
  ]);
  assert.deepEqual(ids(runs.queryRuns({ dateTo: "2026-07-05T00:00:00.000Z" })), ["r1", "r2"]);
  assert.deepEqual(
    ids(
      runs.queryRuns({ dateFrom: "2026-07-05T00:00:00.000Z", dateTo: "2026-07-10T00:00:00.000Z" }),
    ),
    ["r2", "r3", "r4"],
  );
});

test("filter: score with optional grader (latest-per-grader wins)", () => {
  const runs = seed(createDatabase());
  // Any grader's LATEST score ≥ 0.5: r1 (0.8). r5's latest outcome_judge is 0.4, r2's is 0.3 → excluded.
  assert.deepEqual(ids(runs.queryRuns({ scoreGte: 0.5 })), ["r1"]);
  assert.deepEqual(ids(runs.queryRuns({ scoreGte: 0.5, grader: "outcome_judge" })), ["r1"]);
  assert.deepEqual(ids(runs.queryRuns({ scoreLte: 0.5 })), ["r2", "r5"]);
  // grader alone (no bound) → runs with a latest grade from that grader.
  assert.deepEqual(ids(runs.queryRuns({ grader: "tool_hygiene" })), ["r2"]);
  assert.deepEqual(
    ids(runs.queryRuns({ scoreGte: 0.35, scoreLte: 0.45, grader: "outcome_judge" })),
    ["r5"],
  );
});

test("filter: combined AND semantics", () => {
  const runs = seed(createDatabase());
  assert.deepEqual(ids(runs.queryRuns({ status: ["completed"], providerKind: ["openai"] })), [
    "r5",
  ]);
  assert.deepEqual(ids(runs.queryRuns({ providerKind: ["anthropic"], interactiveOnly: true })), [
    "r3",
    "r4",
  ]);
  assert.deepEqual(ids(runs.queryRuns({ testId: ["t-1"], costUsdLte: 0.3, seen: true })), [
    "r1",
    "r3",
  ]);
});

// WP1.6 — `pinned` is now a REAL column (r1 is seeded pinned). WP3.3 (D-OB18) — `derived` is now LIVE
// too (a REAL `runs.derived_from_run_id` column), DEFAULT-EXCLUDE: a forked run is hidden from the feed
// unless `derived:true`.
test("filter: pinned (live, WP1.6) / derived (live, WP3.3 — default-exclude)", () => {
  const db = createDatabase();
  const runs = seed(db);
  assert.deepEqual(ids(runs.queryRuns({ pinned: true })), ["r1"]);
  assert.deepEqual(ids(runs.queryRuns({ pinned: false })), ["r2", "r3", "r4", "r5"]);

  // Seed a DERIVED run r6 (forked from r1 at a step). It must be HIDDEN by default.
  db.prepare(
    `INSERT INTO runs (id, test_id, scenario_id, mode, status, started_at, derived_from_run_id, fork_step_id)
     VALUES ('r6', 't-1', 'scn-A', 'automated', 'completed', '2026-07-14T00:00:00.000Z', 'r1', 'r1:step:3')`,
  ).run();

  // Default (absent derived) EXCLUDES the fork; the 5 originals are unchanged.
  assert.deepEqual(ids(runs.queryRuns({})), ["r1", "r2", "r3", "r4", "r5"]);
  assert.deepEqual(ids(runs.queryRuns({ derived: false })), ["r1", "r2", "r3", "r4", "r5"]);
  // `derived:true` keeps ONLY the fork.
  assert.deepEqual(ids(runs.queryRuns({ derived: true })), ["r6"]);

  // 3-way consistency for r6: the SQL result agrees with the pure predicate over the materialized
  // candidate (the same cross-check the main test enforces for every OTHER field).
  const candidate = runs.buildFilterCandidate("r6");
  assert.ok(candidate, "r6 candidate materializes");
  assert.equal(candidate?.derived, true, "buildFilterCandidate marks r6 derived");
  assert.equal(matchesRunFilter(candidate!, { derived: true }), true, "predicate: derived:true keeps r6");
  assert.equal(matchesRunFilter(candidate!, {}), false, "predicate: default excludes r6");
  assert.equal(matchesRunFilter(candidate!, { derived: false }), false, "predicate: derived:false excludes r6");
});

// Owner-requested — "needs attention" EXPOSED as a filterable property. The base fixture already carries
// a waiting_input-running run (r4), unseen-terminal runs (r2/r5), and seen-terminal runs (r1/r3); here we
// ADD the fourth case the rule distinguishes — a RUNNING-NON-WAITING run (r6: running, no phase, unseen)
// which does NOT need attention (it's actively executing, nothing is paused on the operator).
test("filter: needsAttention (owner-requested — waiting_input-running OR unseen-not-running)", () => {
  const db = createDatabase();
  const runs = seed(db);

  // r6 — running, NO distinct phase, unseen: the running-non-waiting case. Must NOT need attention, and
  // (crucially) must appear under `needsAttention:false` — proving the NULL-safe SQL negation is exact.
  db.prepare(
    `INSERT INTO runs (id, test_id, scenario_id, mode, status, phase, seen, started_at)
     VALUES ('r6', 't-1', 'scn-A', 'automated', 'running', NULL, 0, '2026-07-13T00:00:00.000Z')`,
  ).run();

  // waiting_input-running (r4) + unseen-terminals (r2, r5); NOT the seen-terminals, NOT r6.
  assert.deepEqual(ids(runs.queryRuns({ needsAttention: true })), ["r2", "r4", "r5"]);
  // seen-terminals (r1, r3) + the running-non-waiting r6.
  assert.deepEqual(ids(runs.queryRuns({ needsAttention: false })), ["r1", "r3", "r6"]);

  // 3-way consistency for r6 (the case the base cross-check fixture lacks): SQL agrees with the pure
  // predicate over the materialized candidate.
  const candidate = runs.buildFilterCandidate("r6");
  assert.ok(candidate, "r6 candidate materializes");
  assert.equal(candidate?.status, "running", "buildFilterCandidate carries r6 status");
  assert.equal(candidate?.seen, false, "buildFilterCandidate carries r6 seen=false");
  assert.equal(
    matchesRunFilter(candidate!, { needsAttention: true }),
    false,
    "predicate: a running-non-waiting run does not need attention",
  );
  assert.equal(
    matchesRunFilter(candidate!, { needsAttention: false }),
    true,
    "predicate: needsAttention:false keeps the running-non-waiting run",
  );
});

// WP1.5 — `feedback` is now a REAL EXISTS-join over `run_feedback` (was a "match nothing" placeholder
// through WP1.1–1.4). r1/r5 carry a scored 'verdict', r2 an unscored 'notes'; r3/r4 carry none.
test("filter: feedback (live, WP1.5) — key presence / hasScore / empty = no constraint", () => {
  const runs = seed(createDatabase());
  assert.deepEqual(ids(runs.queryRuns({ feedback: { key: "verdict" } })), ["r1", "r5"]);
  assert.deepEqual(ids(runs.queryRuns({ feedback: { key: "notes" } })), ["r2"]);
  assert.deepEqual(runs.queryRuns({ feedback: { key: "no-such-key" } }), []);
  assert.deepEqual(ids(runs.queryRuns({ feedback: { hasScore: true } })), ["r1", "r5"]);
  assert.deepEqual(
    ids(runs.queryRuns({ feedback: { key: "verdict", hasScore: true } })),
    ["r1", "r5"],
  );
  assert.deepEqual(runs.queryRuns({ feedback: { key: "notes", hasScore: true } }), []);
  // An EMPTY `{}` imposes no constraint (mirrors every other optional RunFilter field).
  assert.deepEqual(ids(runs.queryRuns({ feedback: {} })), ["r1", "r2", "r3", "r4", "r5"]);
});

// ── Sort + pagination ────────────────────────────────────────────────────────────────────────────

test("sort by cost (asc/desc) and default started_at DESC", () => {
  const runs = seed(createDatabase());
  assert.deepEqual(
    runs.queryRuns({}, { sort: { field: "costUsd", direction: "desc" } }).map((r) => r.id),
    ["r2", "r5", "r3", "r1", "r4"],
  );
  assert.deepEqual(
    runs.queryRuns({}, { sort: { field: "costUsd", direction: "asc" } }).map((r) => r.id),
    ["r4", "r1", "r3", "r5", "r2"],
  );
  // Default (no sort) = newest first.
  assert.deepEqual(
    runs.queryRuns({}).map((r) => r.id),
    ["r5", "r4", "r3", "r2", "r1"],
  );
});

test("pagination: limit / offset over the default order", () => {
  const runs = seed(createDatabase());
  assert.deepEqual(
    runs.queryRuns({}, { limit: 2 }).map((r) => r.id),
    ["r5", "r4"],
  );
  assert.deepEqual(
    runs.queryRuns({}, { limit: 2, offset: 2 }).map((r) => r.id),
    ["r3", "r2"],
  );
  assert.deepEqual(
    runs.queryRuns({}, { offset: 4 }).map((r) => r.id),
    ["r1"],
  );
});

// ── Acceptance #4 — empty filter is byte-identical to listRuns() ─────────────────────────────────

test("queryRuns({}) equals listRuns() (no-filter path unchanged)", () => {
  const runs = seed(createDatabase());
  assert.deepStrictEqual(runs.queryRuns({}), runs.listRuns());
});

// ── Cross-check: SQL translation AGREES with the pure matchesRunFilter predicate ─────────────────

/** The enriched {@link RunFilterCandidate} for each seeded run — the exact view a watch rule (WP4.1)
 *  would materialize. Kept in lockstep with the seed so the predicate and SQL can't drift. */
const CANDIDATES: Record<string, RunFilterCandidate> = {
  r1: {
    status: "completed",
    outcome: "completed",
    mode: "automated",
    scenarioId: "scn-A",
    testId: "t-1",
    seen: true,
    costUsd: 0.1,
    tokensIn: 100,
    tokensOut: 200,
    activeDurationMs: 5000,
    startedAt: "2026-07-01T00:00:00.000Z",
    providerKind: "anthropic",
    model: "claude-sonnet-4",
    serverIds: ["srv-1", "srv-2"],
    skillIds: ["sk-1"],
    collectionIds: ["col-1"],
    scores: [{ grader: "outcome_judge", score: 0.8 }],
    pinned: true,
    feedbackKeys: ["verdict"],
    hasFeedbackScore: true,
  },
  r2: {
    status: "error",
    outcome: "error",
    stopReasonCode: "provider_error",
    mode: "interactive",
    scenarioId: "scn-B",
    testId: "t-2",
    seen: false,
    costUsd: 1.5,
    tokensIn: 2000,
    tokensOut: 3000,
    activeDurationMs: 20000,
    startedAt: "2026-07-05T00:00:00.000Z",
    providerKind: "openai",
    model: "gpt-5",
    serverIds: ["srv-3"],
    skillIds: [],
    suiteId: "su-1",
    suiteRunId: "sr-1",
    collectionIds: ["col-2"],
    scores: [{ grader: "tool_hygiene", score: 0.3 }],
    feedbackKeys: ["notes"],
    hasFeedbackScore: false,
  },
  r3: {
    status: "ended",
    outcome: "ended",
    stopReasonCode: "session_ended",
    mode: "interactive",
    scenarioId: "scn-C",
    testId: "t-1",
    seen: true,
    costUsd: 0.2,
    tokensIn: 50,
    tokensOut: 50,
    activeDurationMs: 3000,
    startedAt: "2026-07-08T00:00:00.000Z",
    providerKind: "anthropic",
    model: "claude-haiku",
    serverIds: [],
    skillIds: [],
    collectionIds: ["col-1"],
    scores: [],
  },
  r4: {
    status: "running",
    phase: "waiting_input",
    mode: "interactive",
    scenarioId: "scn-A",
    testId: "t-2",
    seen: false,
    costUsd: 0,
    tokensIn: 0,
    tokensOut: 0,
    startedAt: "2026-07-10T00:00:00.000Z",
    providerKind: "anthropic",
    model: "claude-sonnet-4",
    serverIds: ["srv-1", "srv-2"],
    skillIds: [],
    collectionIds: [],
    scores: [],
  },
  r5: {
    status: "completed",
    outcome: "assertions_failed",
    mode: "automated",
    scenarioId: "scn-B",
    testId: "t-1",
    seen: false,
    costUsd: 0.5,
    tokensIn: 400,
    tokensOut: 600,
    activeDurationMs: 8000,
    startedAt: "2026-07-12T00:00:00.000Z",
    providerKind: "openai",
    model: "gpt-5",
    serverIds: ["srv-3"],
    skillIds: ["sk-2"],
    suiteId: "su-1",
    suiteRunId: "sr-1",
    collectionIds: ["col-1", "col-2"],
    scores: [{ grader: "outcome_judge", score: 0.4 }],
    feedbackKeys: ["verdict"],
    hasFeedbackScore: true,
  },
};

test("SQL translation agrees with matchesRunFilter for every seeded run", () => {
  const runs = seed(createDatabase());
  const filters: RunFilter[] = [
    {},
    { status: ["completed"] },
    { outcome: ["error", "ended"] },
    { stopReasonCode: ["provider_error"] },
    { phase: ["waiting_input"] },
    { seen: true },
    { interactiveOnly: true },
    { hasError: true },
    { hasError: false },
    { providerKind: ["openai"] },
    { model: ["claude-haiku", "gpt-5"] },
    { serverId: ["srv-1", "srv-3"] },
    { scenarioId: ["scn-A"] },
    { testId: ["t-1"] },
    { skillId: ["sk-2"] },
    { suiteId: "su-1" },
    { suiteRunId: "sr-1" },
    { collectionId: "col-1" },
    { collectionId: "col-2" },
    { costUsdGte: 0.2, costUsdLte: 1.5 },
    { tokensGte: 300 },
    { durationMsGte: 5000 },
    { durationMsLte: 4000 },
    { dateFrom: "2026-07-05T00:00:00.000Z", dateTo: "2026-07-10T00:00:00.000Z" },
    { scoreGte: 0.5 },
    { scoreLte: 0.5, grader: "outcome_judge" },
    { status: ["completed"], providerKind: ["openai"] },
    { needsAttention: true },
    { needsAttention: false },
    { pinned: true },
    { derived: true },
    { derived: false },
    { feedback: { hasScore: true } },
    { feedback: { key: "verdict" } },
    { feedback: { key: "notes", hasScore: true } },
    { feedback: {} },
  ];
  for (const filter of filters) {
    const sqlIds = ids(runs.queryRuns(filter));
    const predicateIds = Object.entries(CANDIDATES)
      .filter(([, candidate]) => matchesRunFilter(candidate, filter))
      .map(([id]) => id)
      .sort();
    assert.deepEqual(sqlIds, predicateIds, `disagreement for ${JSON.stringify(filter)}`);
  }
});

// ── Auto-rating dimensions (RM-17 Phase 6, AM-OB12) ──────────────────────────────────────────────
//
// A SEPARATE fixture from `seed()` on purpose: base-rating grades carry scores, and folding them into
// the shared graph would silently move the `scoreGte`/`grader` expectations above — a fixture change
// masquerading as a passing test. This graph exists only to distinguish the rating dimensions, and it
// is cross-checked THREE ways (the repository SQL · the pure predicate over the repository's OWN
// materialized candidate · the metrics SQL replica) so no pair of them can drift.

const RATING_NOW = "2026-08-03T00:00:00.000Z";
const RATING_RUN_IDS = ["rr1", "rr2", "rr3", "rr4", "rr5", "rr6", "rr7"] as const;

/**
 * Seven runs, one per branch that matters:
 *   rr1  answered / valuable / a GRADED-but-EMPTY forensics inventory (an operationally clean run)
 *   rr2  re-rated — the superseded `answered` must lose to the later `unanswered`
 *   rr3  MALFORMED evidence on both graders (must not throw, must not match)
 *   rr4  NO rating rows at all — the unrated run
 *   rr5  two findings sharing a bucket, plus a superseded forensics row with a different bucket
 *   rr6  evidence of the WRONG SHAPE — an object where an array belongs, and an array of scalars
 *   rr7  a verdict / bucket outside the frozen vocabulary
 * All seven start inside one UTC day so a `day` bucket collapses to exactly one point.
 */
function seedRatings(): { runs: RunRepository; db: AppDatabase } {
  const db = createDatabase();
  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, created_at, updated_at) VALUES ('prov-r', 'anthropic', 'Claude', @now, @now)`,
  ).run({ now: RATING_NOW });
  db.prepare(
    `INSERT INTO scenarios (id, name, provider_id, model, created_at, updated_at) VALUES ('scn-r', 'R', 'prov-r', 'claude-sonnet-4', @now, @now)`,
  ).run({ now: RATING_NOW });
  db.prepare(
    `INSERT INTO tests (id, name, user_prompt, created_at, updated_at) VALUES ('t-r', 'TR', 'go', @now, @now)`,
  ).run({ now: RATING_NOW });

  const runInsert = db.prepare(
    `INSERT INTO runs (id, test_id, scenario_id, mode, status, outcome, started_at, cost_usd, tokens_in, tokens_out, active_duration_ms)
     VALUES (@id, 't-r', 'scn-r', 'automated', 'completed', 'completed', @startedAt, 0.1, 100, 100, 1000)`,
  );
  RATING_RUN_IDS.forEach((id, i) => {
    runInsert.run({ id, startedAt: `2026-08-03T0${i + 1}:00:00.000Z` });
  });

  // `evidence_json` is inserted RAW (never through `stableStringify`) so the malformed cases are real.
  const rate = db.prepare(
    `INSERT INTO run_grades (id, run_id, grader_id, kind, status, score, method, evidence_json, grading_version, created_at)
     VALUES (@id, @runId, @graderId, 'llm', 'graded', @score, 'test', @evidence, 1, @createdAt)`,
  );
  const ratingRows: Array<[string, string, string, number | null, string | null, string]> = [
    // id, runId, graderId, score, evidence_json, createdAt
    ["ra1", "rr1", "answer_validation", 1, '{"verdict":"answered","score":1,"quotes":[],"citedSteps":[]}', "2026-08-03T09:00:00.000Z"],
    ["ri1", "rr1", "insight_surplus", 1, '{"verdict":"valuable","score":1,"quotes":[],"citedSteps":[]}', "2026-08-03T09:00:00.000Z"],
    // An operationally clean run: `error_forensics` GRADED with an EMPTY inventory. Not "unrated" —
    // but it carries no bucket, so it must match no bucket filter.
    ["re1", "rr1", "error_forensics", 1, "[]", "2026-08-03T09:00:00.000Z"],

    // rr2 re-rated. `run_grades` is append-only, so the earlier `answered` is still on disk.
    ["ra2a", "rr2", "answer_validation", 1, '{"verdict":"answered"}', "2026-08-03T09:00:00.000Z"],
    ["ra2b", "rr2", "answer_validation", 0, '{"verdict":"unanswered"}', "2026-08-03T11:00:00.000Z"],
    ["re2", "rr2", "error_forensics", 0.5, '[{"bucket":"mcp_server","fixTarget":"mcp_server"},{"bucket":"provider_infra","fixTarget":"none"}]', "2026-08-03T09:00:00.000Z"],

    // rr3: evidence that is not JSON at all. SQLite's json_* functions THROW on this, so an
    // unguarded clause would 500 the WHOLE feed rather than merely fail to match this row.
    ["ra3", "rr3", "answer_validation", null, "not json at all", "2026-08-03T09:00:00.000Z"],
    ["re3", "rr3", "error_forensics", null, "{oops", "2026-08-03T09:00:00.000Z"],

    // rr4: deliberately nothing.

    // rr5: two findings sharing `skill` with different fix targets, plus a SUPERSEDED forensics row
    // whose `test_setup` bucket must not match.
    ["re5old", "rr5", "error_forensics", 0.4, '[{"bucket":"test_setup","fixTarget":"none"}]', "2026-08-03T09:00:00.000Z"],
    ["re5", "rr5", "error_forensics", 0.2, '[{"bucket":"skill","fixTarget":"skill"},{"bucket":"skill","fixTarget":"none"}]', "2026-08-03T12:00:00.000Z"],
    ["ri5", "rr5", "insight_surplus", 0.2, '{"verdict":"noise","surplusTokens":900}', "2026-08-03T09:00:00.000Z"],

    // rr6: shape confusion. `json_each` yields SCALAR members for both of these, and `json_extract`
    // throws on a scalar — the `je.type = 'object'` guard is what keeps this off the error path.
    ["re6", "rr6", "error_forensics", null, '{"notAnArray":true}', "2026-08-03T09:00:00.000Z"],
    ["ra6", "rr6", "answer_validation", null, "[1,2,3]", "2026-08-03T09:00:00.000Z"],

    // rr7: a verdict / bucket outside the frozen vocabulary (a future grader, or a hand-edited row).
    ["ra7", "rr7", "answer_validation", null, '{"verdict":"probably"}', "2026-08-03T09:00:00.000Z"],
    ["re7", "rr7", "error_forensics", null, '[{"bucket":"gremlins","fixTarget":"witchcraft"}]', "2026-08-03T09:00:00.000Z"],
  ];
  for (const [id, runId, graderId, score, evidence, createdAt] of ratingRows) {
    rate.run({ id, runId, graderId, score, evidence, createdAt });
  }

  // Two EXPECTATION grades so `meanScore` has something to report. The base-rating scores above are
  // deliberately invisible to it (AR6 — `PRIMARY_GRADER_PRIORITY` excludes the three base graders),
  // which the AR6 test below asserts rather than assumes.
  rate.run({
    id: "rj1",
    runId: "rr1",
    graderId: "outcome_judge",
    score: 0.9,
    evidence: null,
    createdAt: "2026-08-03T09:30:00.000Z",
  });
  rate.run({
    id: "rj2",
    runId: "rr2",
    graderId: "outcome_judge",
    score: 0.1,
    evidence: null,
    createdAt: "2026-08-03T09:30:00.000Z",
  });

  return { runs: new RunRepository(db), db };
}

/** Every rating filter worth cross-checking, plus the whole-vocabulary sweeps that catch an
 *  "absent read as a value" regression in either direction. */
const RATING_FILTERS: RunFilter[] = [
  {},
  { answerVerdict: ["answered"] },
  { answerVerdict: ["unanswered"] },
  { answerVerdict: ["partial"] },
  { answerVerdict: ["answered", "unanswered"] },
  { answerVerdict: ["answered", "partial", "unanswered"] },
  { insightVerdict: ["valuable"] },
  { insightVerdict: ["noise"] },
  { insightVerdict: ["none"] },
  { insightVerdict: ["none", "valuable", "noise"] },
  { errorBucket: ["skill"] },
  { errorBucket: ["mcp_server"] },
  { errorBucket: ["test_setup"] },
  { errorBucket: ["provider_infra"] },
  { errorBucket: ["skill", "mcp_server", "model_behavior", "test_setup", "provider_infra"] },
  { errorFixTarget: ["skill"] },
  { errorFixTarget: ["none"] },
  { errorFixTarget: ["mcp_server"] },
  { errorFixTarget: ["skill", "mcp_server", "none"] },
  // Composed with the rest of the grammar, and with each other.
  { answerVerdict: ["unanswered"], errorBucket: ["mcp_server"] },
  { answerVerdict: ["answered"], errorBucket: ["mcp_server"] },
  { answerVerdict: ["answered"], status: ["completed"] },
  { insightVerdict: ["noise"], errorFixTarget: ["skill"] },
];

/** Total `count` over an unbounded window — the cheapest proof that the metrics SQL replica selected
 *  the same rows as the repository. */
function metricsRunCount(db: AppDatabase, filter: RunFilter): number {
  return computeRunMetrics(db, { filter, bucket: "day", measures: ["count"] })
    .series.filter((s) => s.measure === "count")
    .flatMap((s) => s.points)
    .reduce((sum, p) => sum + p.value, 0);
}

test("rating filters: the SQL translation, the predicate and the metrics replica all agree", () => {
  const { runs, db } = seedRatings();
  const allIds = ids(runs.queryRuns({}));
  assert.deepEqual(allIds, [...RATING_RUN_IDS].sort());

  for (const filter of RATING_FILTERS) {
    const sqlIds = ids(runs.queryRuns(filter));
    // The predicate runs over the repository's OWN materialized candidate, so this pins the evidence
    // readers in `buildFilterCandidate` as well as the predicate itself.
    const predicateIds = allIds
      .filter((id) => {
        const candidate = runs.buildFilterCandidate(id);
        assert.ok(candidate, `no candidate for ${id}`);
        return matchesRunFilter(candidate, filter);
      })
      .sort();
    assert.deepEqual(sqlIds, predicateIds, `SQL vs predicate for ${JSON.stringify(filter)}`);

    // The SECOND SQL translation (`observability/metrics.ts`'s replica) must select the same rows.
    assert.equal(
      metricsRunCount(db, filter),
      sqlIds.length,
      `metrics replica vs repository SQL for ${JSON.stringify(filter)}`,
    );
  }
});

test("rating filters: hand-counted expectations, so an agreeing PAIR of bugs still fails", () => {
  const { runs } = seedRatings();
  // rr1 answered; rr2's LATEST is unanswered — its superseded `answered` must not match.
  assert.deepEqual(ids(runs.queryRuns({ answerVerdict: ["answered"] })), ["rr1"]);
  assert.deepEqual(ids(runs.queryRuns({ answerVerdict: ["unanswered"] })), ["rr2"]);
  assert.deepEqual(ids(runs.queryRuns({ answerVerdict: ["partial"] })), []);
  assert.deepEqual(ids(runs.queryRuns({ insightVerdict: ["valuable"] })), ["rr1"]);
  assert.deepEqual(ids(runs.queryRuns({ insightVerdict: ["noise"] })), ["rr5"]);
  // rr5's LATEST forensics carries `skill` twice; its superseded `test_setup` row must not match.
  assert.deepEqual(ids(runs.queryRuns({ errorBucket: ["skill"] })), ["rr5"]);
  assert.deepEqual(ids(runs.queryRuns({ errorBucket: ["test_setup"] })), []);
  assert.deepEqual(ids(runs.queryRuns({ errorBucket: ["mcp_server"] })), ["rr2"]);
  assert.deepEqual(ids(runs.queryRuns({ errorBucket: ["provider_infra"] })), ["rr2"]);
  // ANY finding may carry the value — rr5 has both a `skill` and a `none` fix target.
  assert.deepEqual(ids(runs.queryRuns({ errorFixTarget: ["skill"] })), ["rr5"]);
  assert.deepEqual(ids(runs.queryRuns({ errorFixTarget: ["none"] })), ["rr2", "rr5"]);
});

test("rating filters: an unrated run is EXCLUDED by every verdict, never counted as a default", () => {
  const { runs } = seedRatings();
  // The whole-vocabulary sweep is the real assertion: if absence were being read as some value,
  // asking for EVERY member of a vocabulary would return the unrated/unreadable runs too.
  const everyAnswer = ids(runs.queryRuns({ answerVerdict: ["answered", "partial", "unanswered"] }));
  assert.deepEqual(everyAnswer, ["rr1", "rr2"]);
  const everyInsight = ids(runs.queryRuns({ insightVerdict: ["none", "valuable", "noise"] }));
  assert.deepEqual(everyInsight, ["rr1", "rr5"]);
  const everyBucket = ids(
    runs.queryRuns({
      errorBucket: ["skill", "mcp_server", "model_behavior", "test_setup", "provider_infra"],
    }),
  );
  assert.deepEqual(everyBucket, ["rr2", "rr5"]);
  const everyFixTarget = ids(runs.queryRuns({ errorFixTarget: ["skill", "mcp_server", "none"] }));
  assert.deepEqual(everyFixTarget, ["rr2", "rr5"]);

  // rr4 (never rated), rr3 (malformed evidence), rr6 (wrong evidence SHAPE) and rr7 (outside the
  // frozen vocabulary) are absent from all four.
  for (const list of [everyAnswer, everyInsight, everyBucket, everyFixTarget]) {
    for (const excluded of ["rr3", "rr4", "rr6", "rr7"]) {
      assert.ok(!list.includes(excluded), `${excluded} must not match any verdict`);
    }
  }
  // And rr1's GRADED-but-empty forensics inventory is in NO bucket — a clean run is not a run in
  // some default bucket.
  assert.ok(!everyBucket.includes("rr1"), "a clean forensics inventory belongs to no bucket");

  // The unrated run is still there when nothing constrains it: a rating filter NARROWS, it never
  // default-excludes the way `derived` does.
  assert.ok(ids(runs.queryRuns({})).includes("rr4"));
});

test("rating filters: malformed evidence_json does not take the query down (json_* throws on it)", () => {
  const { runs, db } = seedRatings();
  // Each of these would raise SQLITE_ERROR "malformed JSON" against an unguarded json_extract /
  // json_each, and that failure would be a 500 on the WHOLE runs feed — not one missing row.
  assert.doesNotThrow(() => runs.queryRuns({ answerVerdict: ["answered"] }));
  assert.doesNotThrow(() => runs.queryRuns({ insightVerdict: ["noise"] }));
  assert.doesNotThrow(() => runs.queryRuns({ errorBucket: ["skill"] }));
  assert.doesNotThrow(() => runs.queryRuns({ errorFixTarget: ["none"] }));
  assert.doesNotThrow(() =>
    computeRunMetrics(db, {
      filter: { errorBucket: ["skill"] },
      bucket: "day",
      measures: ["count", "meanScore"],
    }),
  );
  // The candidate builder reads the same rows through JSON.parse and must be equally unbothered.
  for (const id of ["rr3", "rr6", "rr7"]) {
    const candidate = runs.buildFilterCandidate(id);
    assert.ok(candidate);
    assert.deepEqual(candidate.answerVerdicts, []);
    assert.deepEqual(candidate.errorBuckets, []);
    assert.deepEqual(candidate.errorFixTargets, []);
  }
});

// AR6 / D-OB15 (acceptance #6). The whole reframe rests on these filters being a READ. If one of them
// wrote, re-scored or re-interpreted a grade, "what share of runs came back unanswered" would stop
// being an observation OF the graders and start being a second opinion ABOUT them.
test("AR6: rating filters leave run_grades and meanScore byte-identical, and never enter a score", () => {
  const { runs, db } = seedRatings();
  const gradeRows = () => JSON.stringify(db.prepare("SELECT * FROM run_grades ORDER BY id").all());
  const meanScoreDoc = () =>
    JSON.stringify(computeRunMetrics(db, { filter: {}, bucket: "day", measures: ["meanScore"] }));

  const gradesBefore = gradeRows();
  const meanBefore = meanScoreDoc();

  for (const filter of RATING_FILTERS) {
    runs.queryRuns(filter);
    computeRunMetrics(db, { filter, bucket: "day", measures: ["count", "meanScore"] });
    for (const id of RATING_RUN_IDS) runs.buildFilterCandidate(id);
  }

  assert.equal(gradeRows(), gradesBefore, "a rating filter mutated run_grades");
  assert.equal(meanScoreDoc(), meanBefore, "a rating filter changed what meanScore reports");

  // The base-rating SCORES stay out of `meanScore` entirely (AR6): only the two `outcome_judge`
  // grades back it, so the unfiltered mean is (0.9 + 0.1) / 2 — not a blend with the base graders'
  // 1 / 0 / 0.5 / 0.2 rows sitting beside them.
  const meanOf = (filter: RunFilter): number[] =>
    computeRunMetrics(db, { filter, bucket: "day", measures: ["meanScore"] })
      .series.filter((s) => s.measure === "meanScore")
      .flatMap((s) => s.points)
      .map((p) => p.value);
  assert.deepEqual(meanOf({}), [0.5]);
  // A verdict filter narrows the POPULATION and nothing else: each run keeps the score it had.
  assert.deepEqual(meanOf({ answerVerdict: ["answered"] }), [0.9]);
  assert.deepEqual(meanOf({ answerVerdict: ["unanswered"] }), [0.1]);
  // And a filter that selects only UNRATED-for-score runs reports NOTHING rather than 0 — the same
  // honesty rule a share metric needs (an empty numerator is not a zero).
  assert.deepEqual(meanOf({ errorBucket: ["skill"] }), []);
});


// ── Route: GET /api/runs (no-param path, aliases, q full-text search, malformed → 400) ────────────

function buildRouteApp(runs: RunRepository) {
  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ZodError)
      return reply.code(400).send({ error: "Validation failed", issues: error.issues });
    const typed = error as Error & { statusCode?: number };
    return reply.code(typed.statusCode ?? 500).send({ error: toErrorMessage(error) });
  });
  // Only GET /api/runs is exercised here; the other testing routes reference their services solely
  // inside handlers we never call, so stubs are safe (registration never dereferences them).
  const runManager = new RunManager(runs);
  return registerTestingRoutes(
    app,
    {} as unknown as ScenarioService,
    {} as unknown as TestService,
    {} as unknown as RunService,
    runs,
    runManager,
  ).then(() => app);
}

test("GET /api/runs with no params returns today's full newest-first history", async () => {
  const runs = seed(createDatabase());
  const app = await buildRouteApp(runs);
  const res = await app.inject({ method: "GET", url: "/api/runs" });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body) as { id: string }[];
  // Same rows, same newest-first order as today's `listRuns()`. (Byte-identity of the raw objects is
  // proven at the repository level in "queryRuns({}) equals listRuns()" — the HTTP JSON round-trip
  // drops undefined-valued keys, so a deep-equal against the raw repo objects would be spurious here.)
  assert.deepEqual(
    body.map((r) => r.id),
    runs.listRuns().map((r) => r.id),
  );
  assert.deepEqual(
    body.map((r) => r.id),
    ["r5", "r4", "r3", "r2", "r1"],
  );
  await app.close();
});

test("GET /api/runs applies the canonical filter= JSON and the scalar aliases", async () => {
  const runs = seed(createDatabase());
  const app = await buildRouteApp(runs);

  const byJson = await app.inject({
    method: "GET",
    url: `/api/runs?filter=${encodeURIComponent('{"status":["completed"]}')}`,
  });
  assert.equal(byJson.statusCode, 200);
  assert.deepEqual((JSON.parse(byJson.body) as { id: string }[]).map((r) => r.id).sort(), [
    "r1",
    "r5",
  ]);

  const byAlias = await app.inject({
    method: "GET",
    url: "/api/runs?status=error,ended&sort=startedAt:asc",
  });
  assert.equal(byAlias.statusCode, 200);
  assert.deepEqual(
    (JSON.parse(byAlias.body) as { id: string }[]).map((r) => r.id),
    ["r2", "r3"],
  );

  await app.close();
});

test("GET /api/runs runs full-text q (WP1.3) — composes with filters, returns snippets, tolerates empty", async () => {
  const db = createDatabase();
  const runs = seed(db);
  // Seed FTS documents directly (this test predates the run persistence hooks — the write path is
  // exercised in search-index.test.ts). r1 (completed) + r3 (ended) both mention "escalation".
  const doc = db.prepare(
    "INSERT INTO run_search (run_id, step_id, kind, content) VALUES (@runId, @stepId, @kind, @content)",
  );
  doc.run({ runId: "r1", stepId: "3", kind: "assistant", content: "the customer escalation was resolved" });
  doc.run({ runId: "r3", stepId: "__terminal__", kind: "error", content: "escalation timeout on the session" });
  const app = await buildRouteApp(runs);

  // `q` alias → both matching runs, newest-first (r3 @07-08 before r1 @07-01), each with a snippet+kind.
  const viaAlias = await app.inject({ method: "GET", url: "/api/runs?q=escalation" });
  assert.equal(viaAlias.statusCode, 200);
  const rows = JSON.parse(viaAlias.body) as { id: string; searchSnippet?: string; searchMatchKind?: string }[];
  assert.deepEqual(rows.map((r) => r.id), ["r3", "r1"]);
  assert.ok(rows.every((r) => r.searchSnippet?.includes("[escalation]")), "each hit carries a snippet");
  assert.equal(rows.find((r) => r.id === "r1")?.searchMatchKind, "assistant");
  assert.equal(rows.find((r) => r.id === "r3")?.searchMatchKind, "error");

  // `q` composes with a status alias → only the completed run.
  const composed = await app.inject({ method: "GET", url: "/api/runs?q=escalation&status=completed" });
  assert.equal(composed.statusCode, 200);
  assert.deepEqual((JSON.parse(composed.body) as { id: string }[]).map((r) => r.id), ["r1"]);

  // `q` via canonical filter= JSON works too.
  const viaJson = await app.inject({
    method: "GET",
    url: `/api/runs?filter=${encodeURIComponent('{"q":"escalation"}')}`,
  });
  assert.equal(viaJson.statusCode, 200);
  assert.equal((JSON.parse(viaJson.body) as unknown[]).length, 2);

  // A q with no searchable token (punctuation only) is valid and returns [] (never a 400/500).
  const empty = await app.inject({ method: "GET", url: `/api/runs?q=${encodeURIComponent("!!!")}` });
  assert.equal(empty.statusCode, 200);
  assert.deepEqual(JSON.parse(empty.body), []);

  await app.close();
});

test("GET /api/runs returns 400 for a malformed / invalid filter", async () => {
  const runs = seed(createDatabase());
  const app = await buildRouteApp(runs);
  const badJson = await app.inject({ method: "GET", url: "/api/runs?filter=%7Bnot-json" });
  assert.equal(badJson.statusCode, 400);
  const badField = await app.inject({
    method: "GET",
    url: `/api/runs?filter=${encodeURIComponent('{"status":["not-a-status"]}')}`,
  });
  assert.equal(badField.statusCode, 400);
  const badSort = await app.inject({ method: "GET", url: "/api/runs?sort=bogus" });
  assert.equal(badSort.statusCode, 400);
  await app.close();
});
