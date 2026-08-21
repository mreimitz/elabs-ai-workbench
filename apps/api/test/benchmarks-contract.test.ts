import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { afterEach, test } from "node:test";
import {
  GRADER_IDS,
  GRADING_VERSION,
  type RunGrade,
  type TestExpectations,
  runGradeSchema,
  testInputSchema,
} from "@mcp-token-footprint/shared";
import { applyMigrations, LATEST_SCHEMA_VERSION, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { TestRepository } from "../src/testing/test-repository.js";

// WP 1.1 (Benchmarks) — the graded-tests wire contract + persistence. Everything here is ADDITIVE:
// a test with no expectations must round-trip byte-identically and behave exactly as before.

const databases: AppDatabase[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function track(db: AppDatabase): AppDatabase {
  databases.push(db);
  return db;
}

function columns(db: AppDatabase, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
    (c) => c.name,
  );
}

/** A fresh in-memory DB at the latest schema, then migrated + stamped (mirrors openDatabase()). */
function openFresh(): AppDatabase {
  const db = track(new Database(":memory:"));
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  return db;
}

// ── Round-trip: a fully-populated expectations/metadata block persists + hydrates unchanged ─────────

test("TestRepository round-trips a test WITH full expectations + category/difficulty/tags", () => {
  const db = openFresh();
  const repo = new TestRepository(db);

  const expectations: TestExpectations = {
    expectedInsight: "Revenue grew 12% year over year.",
    // A nested structured value must survive the JSON round-trip intact.
    expectedValue: {
      total: 1234.5,
      currency: "USD",
      breakdown: { q1: 300, q2: 934.5 },
      flags: [true, false],
    },
    // referenceLogic is a DOCUMENT handed to a judge — never executed (B15).
    referenceLogic: { kind: "code", language: "python", body: "df['revenue'].sum()" },
    answerable: false, // marks an unanswerable question
    rubricOverride: "Grade strictly on the numeric total, ignoring prose.",
  };

  const created = repo.create({
    name: "Graded revenue test",
    userPrompt: "What was the total revenue?",
    systemPromptOverride: undefined,
    addedProfiles: ["generic_o200k"],
    expectations,
    category: "finance",
    difficulty: "hard",
    tags: ["revenue", "kpi"],
  });

  // Re-read from the DB (not just the create() return) to prove persistence + hydration.
  const got = repo.get(created.id);
  assert.deepEqual(got.expectations, expectations, "expectations round-trip deep-equal");
  assert.equal(got.category, "finance");
  assert.equal(got.difficulty, "hard");
  assert.deepEqual(got.tags, ["revenue", "kpi"]);
  assert.equal(got.name, "Graded revenue test");
  assert.deepEqual(got.addedProfiles, ["generic_o200k"]);

  // Update must persist a changed expectations/metadata block too.
  const updated = repo.update(created.id, {
    name: "Graded revenue test v2",
    userPrompt: "What was the total revenue?",
    systemPromptOverride: undefined,
    addedProfiles: [],
    expectations: { ...expectations, answerable: true, rubricOverride: undefined },
    category: "sales",
    difficulty: "medium",
    tags: ["revenue"],
  });
  assert.equal(updated.category, "sales");
  assert.equal(updated.difficulty, "medium");
  assert.equal(updated.expectations?.answerable, true);
  assert.equal(updated.expectations?.rubricOverride, undefined);
  assert.deepEqual(updated.tags, ["revenue"]);
});

// ── Additive / back-compat: a test with NO expectations behaves exactly as pre-1.1 ─────────────────

test("a test created WITHOUT expectations hydrates as pre-1.1 (undefined blocks, tags [])", () => {
  const db = openFresh();
  const repo = new TestRepository(db);

  const created = repo.create({
    name: "Plain test",
    userPrompt: "List the files.",
    systemPromptOverride: undefined,
    addedProfiles: [],
    // no expectations / category / difficulty / tags
  });

  const got = repo.get(created.id);
  assert.equal(got.expectations, undefined, "expectations hydrates to undefined");
  assert.equal(got.category, undefined, "category hydrates to undefined");
  assert.equal(got.difficulty, undefined, "difficulty hydrates to undefined");
  assert.deepEqual(got.tags, [], "tags hydrates to []");

  // Row-level: the reserved columns are NULL and tags_json is exactly '[]' (byte-identical to pre-1.1).
  const row = db
    .prepare("SELECT expectations_json, category, difficulty, tags_json FROM tests WHERE id = ?")
    .get(created.id) as {
    expectations_json: string | null;
    category: string | null;
    difficulty: string | null;
    tags_json: string;
  };
  assert.equal(row.expectations_json, null, "expectations_json column is NULL");
  assert.equal(row.category, null, "category column is NULL");
  assert.equal(row.difficulty, null, "difficulty column is NULL");
  assert.equal(row.tags_json, "[]", "tags_json column is exactly '[]'");
});

// ── Zod validation: the shape is enforced (400 on bad input), defaults applied, omission allowed ────

test("testInputSchema rejects a bad referenceLogic.kind and a bad difficulty", () => {
  assert.throws(
    () =>
      testInputSchema.parse({
        name: "x",
        userPrompt: "p",
        expectations: { referenceLogic: { kind: "bash", body: "ls" } },
      }),
    "referenceLogic.kind outside 'code'|'text' is rejected",
  );

  assert.throws(
    () => testInputSchema.parse({ name: "x", userPrompt: "p", difficulty: "trivial" }),
    "difficulty outside the enum is rejected",
  );
});

test("testInputSchema accepts omitted expectations and defaults tags to []", () => {
  const parsed = testInputSchema.parse({ name: "x", userPrompt: "p" });
  assert.equal(parsed.expectations, undefined, "expectations stays undefined when omitted");
  assert.equal(parsed.category, undefined);
  assert.equal(parsed.difficulty, undefined);
  assert.deepEqual(parsed.tags, [], "tags defaults to []");

  // A well-formed expectations block (code reference, unanswerable) parses cleanly.
  const withExpectations = testInputSchema.parse({
    name: "x",
    userPrompt: "p",
    expectations: {
      expectedInsight: "ok",
      referenceLogic: { kind: "text", body: "sum the column" },
      answerable: true,
    },
    difficulty: "easy",
    tags: ["a", "b"],
  });
  assert.equal(withExpectations.expectations?.referenceLogic?.kind, "text");
  assert.equal(withExpectations.difficulty, "easy");
  assert.deepEqual(withExpectations.tags, ["a", "b"]);
});

// ── The grade contract front-loaded for WP 1.2 (runGradeSchema validates a well-formed grade) ──────

test("runGradeSchema validates a well-formed RunGrade and the grader roster is the full nine", () => {
  // The original six expectation graders (WP 1.1, Benchmarks) plus the three always-on base-rating
  // graders appended by Auto-Rating WP 1.1 (answer_validation/insight_surplus/error_forensics) — see
  // BASE_RATING_GRADER_IDS. Append-only: the original six keep their order (asserted below).
  assert.equal(GRADER_IDS.length, 9, "six expectation graders + three base-rating graders");
  assert.deepEqual(
    GRADER_IDS.slice(0, 6),
    [
      "rouge1",
      "value_match",
      "outcome_judge",
      "tool_hygiene",
      "trajectory_judge",
      "skillflow_conformance",
    ],
    "the original six graders are unchanged and unreordered",
  );
  assert.deepEqual(
    GRADER_IDS.slice(6),
    ["answer_validation", "insight_surplus", "error_forensics"],
    "the three base-rating graders are appended in this order",
  );

  const grade: RunGrade = {
    id: "grade-1",
    runId: "run-1",
    graderId: "outcome_judge",
    kind: "llm",
    status: "graded",
    score: 0.8,
    rawScore: 8,
    method: "logprob_weighted",
    reasoning: "The final answer matched the rubric.",
    evidence: [3, 7],
    judgeProviderId: "prov-1",
    judgeModel: "claude-sonnet-4-5",
    judgeTokensIn: 120,
    judgeTokensOut: 40,
    judgeCostUsd: 0.0012,
    gradingVersion: GRADING_VERSION,
    createdAt: "2026-07-04T00:00:00.000Z",
  };
  assert.doesNotThrow(() => runGradeSchema.parse(grade));

  // A deterministic, unevaluable grade (no ground truth) is also valid — null scores, no judge ledger.
  assert.doesNotThrow(() =>
    runGradeSchema.parse({
      ...grade,
      graderId: "rouge1",
      kind: "deterministic",
      status: "unevaluable",
      score: null,
      rawScore: null,
      method: "rouge1",
      reasoning: null,
      evidence: null,
      judgeProviderId: null,
      judgeModel: null,
      judgeTokensIn: 0,
      judgeTokensOut: 0,
      judgeCostUsd: 0,
    }),
  );

  // A bogus grader id is rejected.
  assert.throws(() => runGradeSchema.parse({ ...grade, graderId: "not_a_grader" }));
});

// ── Migration v13: fresh DB carries the new columns/tables; LATEST is 13 ───────────────────────────

test("migration v13 — fresh DB has the new tests columns + run_grades + app_settings", () => {
  // LATEST advanced to 18 with the Skill IDE WP 9.1 migration; v13's columns/tables must still be present.
  assert.equal(
    LATEST_SCHEMA_VERSION,
    60,
    "LATEST_SCHEMA_VERSION auto-derived to 60 (…v19 suite-run member index + v20 assistant tables + v21 assistant_settings + v22 suite_run_reports + v23 provider_credentials server link + v24 scenarios.answers_mode + v25 server_types + v26 rating_issues + v27 rating_state + v28 provider_credentials claude_subscription kind + v29 runs.cost_basis + v30 rating_issue_occurrences concrete evidence + v31 unified-sessions runs columns + v32 observability metrics indexes; v33 observability FTS5 search index + v34 run_views + v35 runs.pinned + v36 run_feedback + v37 run_steps hierarchy + v38 watch_rules + v39 watch_rules.last_evaluated_at + v40 notifications + v41 fleet issue aggregation + v42 runs fork lineage + v43 digest reports + v44 model pricing + v45 dashboard charts + v46 review_rubrics; v47 = hub_* tables, Assistant Hub WP0.2; v48 = hub_session_skills, Assistant Hub WP2.4; v49 = hub_memory.scope/scope_id + hub_agents.display_name + hub_crews.color + hub_sessions.archived_at, Assistant Hub UX WP1.0s; v50 = hub_sessions.tool_scope_json, end-user UX pass; v51 = hub_sessions.mode auto; v52 = hub_sessions.roster_json; v53 = hub_crews.icon, agent/crew avatar icons; v54 = hub_missions.parent_mission_id/depth/root_mission_id, crew-nesting mission-tree lineage; v55 = hub_sessions/hub_agents.provider_credential_id, model identity D-MI1; v56 = the acme_answers provider kind removed (purge + narrowed kind CHECK, mcp_server_id + scenarios.answers_mode dropped); v57 = notification/digest deep-link repair (stale /assistant/s/ + /testing/observability/issues/ paths rewritten); v58 = api_tokens, service tokens for headless/CI callers, planning/Roadmap/RM-08-ci WP 1.1; v59 = runs.cache_read_tokens/cache_write_tokens, the prompt-cache split on the run row, planning/Roadmap/RM-33-cache-aware-token-accounting WP 1.2; v60 = grade_feedback, human verdicts ON grades + the derived calibration set, planning/Roadmap/RM-07-benchmarks WP 6.1)",
  );

  const db = openFresh();
  assert.equal(
    db.pragma("user_version", { simple: true }),
    LATEST_SCHEMA_VERSION,
    "fresh DB stamped at the latest",
  );

  const testCols = columns(db, "tests");
  for (const c of ["expectations_json", "category", "difficulty", "tags_json"]) {
    assert.ok(testCols.includes(c), `tests should carry the new column ${c}`);
  }

  const gradeCols = columns(db, "run_grades");
  for (const c of [
    "id",
    "run_id",
    "grader_id",
    "kind",
    "status",
    "score",
    "raw_score",
    "method",
    "reasoning",
    "evidence_json",
    "judge_provider_id",
    "judge_model",
    "judge_tokens_in",
    "judge_tokens_out",
    "judge_cost_usd",
    "grading_version",
    "created_at",
  ]) {
    assert.ok(gradeCols.includes(c), `run_grades should carry the column ${c}`);
  }

  assert.deepEqual(columns(db, "app_settings").sort(), ["key", "updated_at", "value_json"]);
});

// ── Migration v13 brings a pre-v13 DB (missing run_grades/app_settings) forward ─────────────────────

test("applyMigrations recreates run_grades + app_settings on a pre-v13 DB", () => {
  const db = track(new Database(":memory:"));
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  // Simulate a DB that predates v13: drop the two tables and rewind the version stamp to 12.
  db.exec("DROP TABLE run_grades; DROP TABLE app_settings;");
  db.pragma("user_version = 12");
  const tableCount = (name: string) =>
    (
      db
        .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(name) as {
        n: number;
      }
    ).n;
  assert.equal(tableCount("run_grades"), 0, "sanity: run_grades is gone before migrating");

  applyMigrations(db);

  assert.equal(
    db.pragma("user_version", { simple: true }),
    LATEST_SCHEMA_VERSION,
    "version advanced to the latest",
  );
  assert.equal(tableCount("run_grades"), 1, "run_grades recreated by v13");
  assert.equal(tableCount("app_settings"), 1, "app_settings recreated by v13");
  // The append-only index came back too.
  const idx = db
    .prepare(
      "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'index' AND name = 'idx_run_grades_run'",
    )
    .get() as { n: number };
  assert.equal(idx.n, 1, "idx_run_grades_run recreated by v13");
});
