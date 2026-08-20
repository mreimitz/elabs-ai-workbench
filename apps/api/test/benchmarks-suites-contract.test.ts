import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { afterEach, test } from "node:test";
import {
  SUITE_DEFAULT_CONCURRENCY,
  SUITE_DEFAULT_REPETITIONS,
  type SuiteConfig,
  type SuiteInput,
  suiteConfigSchema,
  suiteInputSchema,
} from "@mcp-token-footprint/shared";
import { applyMigrations, LATEST_SCHEMA_VERSION, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { SuiteRepository } from "../src/suites/repository.js";
import { RunRepository } from "../src/testing/run-repository.js";

// WP 3.1 (Benchmarks, B7) — the suite wire contract + persistence (migration v14). Everything here is
// ADDITIVE: a repo with no suites, and every existing run, behaves exactly as before. The matrix
// ORCHESTRATOR is WP 3.2 — this WP only covers the contract + schema + suite CRUD.

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

function tableExists(db: AppDatabase, name: string): boolean {
  return (
    (
      db
        .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(name) as {
        n: number;
      }
    ).n === 1
  );
}

const NOW = "2026-07-04T00:00:00.000Z";

/** A fresh in-memory DB at the latest schema, then migrated + stamped (mirrors openDatabase()). */
function openFresh(): AppDatabase {
  const db = track(new Database(":memory:"));
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  return db;
}

/** Seed a provider + scenarios + tests so suite membership FKs (suite_tests/suite_scenarios) resolve. */
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

// ── (1) CRUD round-trip: ordered testIds + scenario set + full config; update reorders; delete ──────

test("SuiteRepository round-trips a suite with ORDERED tests + a scenario set + a full config", () => {
  const db = openFresh();
  seedParents(db, ["scn-a", "scn-b"], ["t1", "t2", "t3"]);
  const repo = new SuiteRepository(db);

  const config: SuiteConfig = {
    repetitions: 3,
    maxConcurrency: 4,
    aggregateCostCapUsd: 12.5,
    variants: [
      {
        label: "with-skill",
        scenarioId: "scn-a",
        skillOverrides: { attach: [{ skillId: "sk-1", versionId: "latest" }], detach: ["sk-2"] },
      },
    ],
  };

  // Deliberately non-sorted order (t3, t1, t2) to prove position-ordered hydration, not id-sorted.
  const input: SuiteInput = {
    name: "Nightly benchmark",
    description: "The core regression matrix.",
    config,
    testIds: ["t3", "t1", "t2"],
    scenarioIds: ["scn-a", "scn-b"],
  };

  const created = repo.create(input);
  const got = repo.get(created.id);

  assert.deepEqual(got.testIds, ["t3", "t1", "t2"], "ordered test membership preserved on read");
  assert.deepEqual(got.scenarioIds.sort(), ["scn-a", "scn-b"]);
  assert.equal(got.name, "Nightly benchmark");
  assert.equal(got.description, "The core regression matrix.");
  assert.deepEqual(got.config, config, "full config (incl. variants) round-trips deep-equal");

  // The row-level position column matches the input order.
  const positions = db
    .prepare("SELECT test_id, position FROM suite_tests WHERE suite_id = ? ORDER BY position ASC")
    .all(created.id) as Array<{ test_id: string; position: number }>;
  assert.deepEqual(
    positions,
    [
      { test_id: "t3", position: 0 },
      { test_id: "t1", position: 1 },
      { test_id: "t2", position: 2 },
    ],
    "suite_tests.position encodes the input order",
  );

  // Update REORDERS the tests (and shrinks the set) — the new order must win on re-read.
  const updated = repo.update(created.id, {
    ...input,
    testIds: ["t2", "t3"],
    scenarioIds: ["scn-b"],
  });
  assert.deepEqual(updated.testIds, ["t2", "t3"], "update reorders + trims test membership");
  assert.deepEqual(repo.get(created.id).scenarioIds, ["scn-b"], "update replaces the scenario set");

  // Delete removes it (and 404s on a second delete).
  repo.delete(created.id);
  assert.throws(() => repo.get(created.id), /Suite not found/);
  assert.throws(() => repo.delete(created.id), /Suite not found/);
  assert.equal(
    (
      db.prepare("SELECT COUNT(*) AS n FROM suite_tests WHERE suite_id = ?").get(created.id) as {
        n: number;
      }
    ).n,
    0,
    "suite_tests cascaded away on suite delete",
  );
});

// ── (2) Config validation: bounds enforced, defaults filled when omitted ────────────────────────────

test("suiteConfigSchema enforces repetition/concurrency bounds and fills defaults", () => {
  // repetitions: min 1, max SUITE_MAX_REPETITIONS (5) — 0 and 6 are rejected.
  assert.throws(
    () => suiteConfigSchema.parse({ repetitions: 0, maxConcurrency: 3 }),
    "repetitions 0 rejected",
  );
  assert.throws(
    () => suiteConfigSchema.parse({ repetitions: 6, maxConcurrency: 3 }),
    "repetitions 6 rejected",
  );
  // maxConcurrency: min 1, max SUITE_MAX_CONCURRENCY (8) — 0 and 9 are rejected.
  assert.throws(
    () => suiteConfigSchema.parse({ repetitions: 1, maxConcurrency: 0 }),
    "concurrency 0 rejected",
  );
  assert.throws(
    () => suiteConfigSchema.parse({ repetitions: 1, maxConcurrency: 9 }),
    "concurrency 9 rejected",
  );

  // Omitting both fills the shared defaults (reps → 1, concurrency → 3).
  const filled = suiteConfigSchema.parse({});
  assert.equal(filled.repetitions, SUITE_DEFAULT_REPETITIONS);
  assert.equal(filled.repetitions, 1);
  assert.equal(filled.maxConcurrency, SUITE_DEFAULT_CONCURRENCY);
  assert.equal(filled.maxConcurrency, 3);

  // suiteInputSchema requires a non-empty name; a valid minimal input parses with config defaults.
  assert.throws(() =>
    suiteInputSchema.parse({ name: "  ", config: {}, testIds: [], scenarioIds: [] }),
  );
  const parsed = suiteInputSchema.parse({
    name: "S",
    config: {},
    testIds: ["t1"],
    scenarioIds: [],
  });
  assert.equal(parsed.config.repetitions, 1);
  assert.equal(parsed.config.maxConcurrency, 3);
});

// ── (3) Migration v14: fresh DB carries all four tables + runs columns; LATEST is 14; pre-v14 forward ─

test("migration v14 — fresh DB has the four suite tables + runs.suite_run_id/repetition; LATEST is 15", () => {
  // LATEST advanced to 18 with the Skill IDE WP 9.1 migration; v14's suite tables must still be present.
  assert.equal(
    LATEST_SCHEMA_VERSION,
    58,
    "LATEST_SCHEMA_VERSION auto-derived to 58 (v19 = suite-run member index; v20 = assistant tables; v21 = assistant_settings; v22 = suite_run_reports; v23 = provider_credentials server link; v24 = scenarios.answers_mode; v25 = server_types; v26 = rating_issues; v27 = rating_state; v28 = provider_credentials claude_subscription kind; v29 = runs.cost_basis; v30 = rating_issue_occurrences concrete evidence; v31 = unified-sessions runs columns; v32 = observability metrics indexes; v33 = observability FTS5 search index; v34 = run_views; v35 = runs.pinned; v36 = run_feedback; v37 = run_steps hierarchy; v38 = watch_rules; v39 = watch_rules.last_evaluated_at; v40 = notifications; v41 = fleet issue aggregation; v42 = runs fork lineage; v43 = digest reports; v44 = model pricing; v45 = dashboard charts; v46 = review_rubrics; v47 = hub_* tables, Assistant Hub WP0.2; v48 = hub_session_skills, Assistant Hub WP2.4; v49 = hub_memory.scope/scope_id + hub_agents.display_name + hub_crews.color + hub_sessions.archived_at, Assistant Hub UX WP1.0s; v50 = hub_sessions.tool_scope_json, end-user UX pass; v51 = hub_sessions.mode auto; v52 = hub_sessions.roster_json; v53 = hub_crews.icon, agent/crew avatar icons; v54 = hub_missions.parent_mission_id/depth/root_mission_id, crew-nesting mission-tree lineage; v55 = hub_sessions/hub_agents.provider_credential_id, model identity D-MI1; v56 = the acme_answers provider kind removed (purge + narrowed kind CHECK, mcp_server_id + scenarios.answers_mode dropped); v57 = notification/digest deep-link repair (stale /assistant/s/ + /testing/observability/issues/ paths rewritten); v58 = api_tokens, service tokens for headless/CI callers, planning/Roadmap/RM-08-ci WP 1.1)",
  );

  const db = openFresh();
  assert.equal(
    db.pragma("user_version", { simple: true }),
    LATEST_SCHEMA_VERSION,
    "fresh DB stamped at the latest",
  );

  for (const t of ["suites", "suite_tests", "suite_scenarios", "suite_runs"]) {
    assert.ok(tableExists(db, t), `suite table ${t} present on a fresh DB`);
  }
  const runCols = columns(db, "runs");
  assert.ok(runCols.includes("suite_run_id"), "runs.suite_run_id present");
  assert.ok(runCols.includes("repetition"), "runs.repetition present");
});

test("applyMigrations brings a rewound pre-v14 DB forward (recreates the suite tables + run columns)", () => {
  const db = track(new Database(":memory:"));
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);

  // Simulate a DB that predates v14: drop the four suite tables + the two additive runs columns, then
  // rewind the version stamp to 13. (SQLite can't DROP COLUMN before 3.35, but better-sqlite3 ships a
  // newer engine — this mirrors migrations.test.ts's rewind approach.)
  db.exec(
    "DROP TABLE suite_runs; DROP TABLE suite_scenarios; DROP TABLE suite_tests; DROP TABLE suites;",
  );
  db.exec("ALTER TABLE runs DROP COLUMN suite_run_id; ALTER TABLE runs DROP COLUMN repetition;");
  db.pragma("user_version = 13");
  assert.equal(tableExists(db, "suites"), false, "sanity: suites is gone before migrating");
  assert.equal(
    columns(db, "runs").includes("suite_run_id"),
    false,
    "sanity: runs.suite_run_id gone",
  );

  applyMigrations(db);

  assert.equal(
    db.pragma("user_version", { simple: true }),
    LATEST_SCHEMA_VERSION,
    "version advanced to the latest",
  );
  for (const t of ["suites", "suite_tests", "suite_scenarios", "suite_runs"]) {
    assert.ok(tableExists(db, t), `${t} recreated by v14`);
  }
  const runCols = columns(db, "runs");
  assert.ok(runCols.includes("suite_run_id"), "runs.suite_run_id re-added by v14");
  assert.ok(runCols.includes("repetition"), "runs.repetition re-added by v14");
});

// ── (4) INVARIANT — deleting a suite cascades its suite_runs but KEEPS the child runs (history) ──────

test("deleting a suite removes its suite_runs (cascade) but NEVER the child runs (runs are history)", () => {
  const db = openFresh();
  seedParents(db, ["scn-1"], ["t1"]);
  const repo = new SuiteRepository(db);

  const suite = repo.create({
    name: "Deletable suite",
    config: { repetitions: 1, maxConcurrency: 3 },
    testIds: ["t1"],
    scenarioIds: ["scn-1"],
  });

  // A suite_runs aggregate row for this suite …
  db.prepare(
    `INSERT INTO suite_runs (id, suite_id, status, config_snapshot_json, started_at)
     VALUES ('srun-1', @suiteId, 'completed', '{}', @now)`,
  ).run({ suiteId: suite.id, now: NOW });

  // … and a child run linked to it via the DENORMALIZED suite_run_id (NOT an FK).
  db.prepare(
    `INSERT INTO runs (id, test_id, scenario_id, mode, status, started_at, suite_run_id, repetition)
     VALUES ('run-1', 't1', 'scn-1', 'automated', 'completed', @now, 'srun-1', 1)`,
  ).run({ now: NOW });

  repo.delete(suite.id);

  // The suite_runs aggregate row cascaded away with the suite …
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM suite_runs WHERE id = 'srun-1'").get() as { n: number })
      .n,
    0,
    "suite_runs cascade-deleted with the suite",
  );
  // … but the child run SURVIVES, its suite_run_id now harmlessly dangling (that's the guarantee).
  const runRow = db.prepare("SELECT suite_run_id, repetition FROM runs WHERE id = 'run-1'").get() as
    | { suite_run_id: string | null; repetition: number | null }
    | undefined;
  assert.ok(runRow, "the child run is NOT deleted when its suite is deleted");
  assert.equal(
    runRow?.suite_run_id,
    "srun-1",
    "the run keeps its (now-dangling) suite_run_id — it's not an FK",
  );
  assert.equal(runRow?.repetition, 1, "the run keeps its repetition ordinal");
});

// ── (5) Existing runs unaffected: a standalone run hydrates suiteRunId/repetition as undefined ───────

test("a run created without suite linkage hydrates suiteRunId/repetition as undefined", () => {
  const db = openFresh();
  seedParents(db, ["scn-1"], ["t1"]);

  db.prepare(
    `INSERT INTO runs (id, test_id, scenario_id, mode, status, started_at)
     VALUES ('run-plain', 't1', 'scn-1', 'automated', 'completed', @now)`,
  ).run({ now: NOW });

  const runs = new RunRepository(db);
  const summary = runs.getSummary("run-plain");
  assert.equal(summary.suiteRunId, undefined, "standalone run has no suiteRunId");
  assert.equal(summary.repetition, undefined, "standalone run has no repetition");
  // Row-level: the columns default to NULL (byte-identical to a pre-v14 run).
  const row = db
    .prepare("SELECT suite_run_id, repetition FROM runs WHERE id = 'run-plain'")
    .get() as {
    suite_run_id: string | null;
    repetition: number | null;
  };
  assert.equal(row.suite_run_id, null);
  assert.equal(row.repetition, null);
});
