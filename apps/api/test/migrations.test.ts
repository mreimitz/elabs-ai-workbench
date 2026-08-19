import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { afterEach, test } from "node:test";
import {
  applyMigrations,
  ensureLocalCollection,
  LATEST_SCHEMA_VERSION,
  LOCAL_COLLECTION_NAME,
  type AppDatabase,
} from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { buildSeedPricingRows, MODEL_PRICING } from "../src/providers/pricing.js";
import { ScanRepository } from "../src/scans/repository.js";
import { RunRepository } from "../src/testing/run-repository.js";

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

function tableDdl(db: AppDatabase, table: string): string {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) as { sql?: string } | undefined;
  return row?.sql ?? "";
}

function tableExists(db: AppDatabase, table: string): boolean {
  return (
    (
      db
        .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(table) as { n: number }
    ).n === 1
  );
}

function columnExists(db: AppDatabase, table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return cols.some((c) => c.name === column);
}

function indexExists(db: AppDatabase, index: string): boolean {
  return (
    (
      db
        .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'index' AND name = ?")
        .get(index) as { n: number }
    ).n === 1
  );
}

/**
 * The normalized column shape of a table (order + name/type/nullability/default/pk) — a DDL-text-agnostic
 * way to assert a rebuilt (upgraded) table matches the fresh-DB table. Ignores `cid` only implicitly (it
 * follows column order, which we compare positionally).
 */
function tableShape(db: AppDatabase, table: string) {
  return (
    db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: unknown;
      pk: number;
    }>
  ).map(({ name, type, notnull, dflt_value, pk }) => ({ name, type, notnull, dflt_value, pk }));
}

// ── An OLD on-disk schema snapshot: the tables as they existed BEFORE the newer columns/CHECK ──────
// Deliberately omits: mcp_servers.auth_type/auth_header_name (v1), scenarios.tool_loading_mode (v2),
// mcp_scans resource/prompt columns (v3) + counting_version (v8), run_steps additive columns (v4),
// and run_steps carries the OLD `type` CHECK without 'user_message' (widened by v5). This is what
// `applyMigrations` must bring forward.
const OLD_SCHEMA_SQL = `
CREATE TABLE mcp_servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  transport TEXT NOT NULL CHECK (transport IN ('stdio', 'streamable_http')),
  command TEXT,
  args_json TEXT NOT NULL DEFAULT '[]',
  url TEXT,
  headers_json TEXT NOT NULL DEFAULT '{}',
  env_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE mcp_scans (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  token_profile TEXT NOT NULL,
  scanned_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed')),
  total_tools INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  total_raw_bytes INTEGER NOT NULL DEFAULT 0,
  average_tokens_per_tool REAL NOT NULL DEFAULT 0,
  largest_tool_name TEXT,
  largest_tool_tokens INTEGER NOT NULL DEFAULT 0,
  error_message TEXT
);

CREATE TABLE provider_credentials (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('anthropic','openai','google','openai_compatible','ollama')),
  label TEXT NOT NULL,
  base_url TEXT,
  api_key_encrypted TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE scenarios (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider_id TEXT NOT NULL REFERENCES provider_credentials(id) ON DELETE RESTRICT,
  model TEXT NOT NULL,
  params_json TEXT NOT NULL DEFAULT '{}',
  system_prompt TEXT NOT NULL DEFAULT '',
  default_profiles_json TEXT NOT NULL DEFAULT '[]',
  guardrails_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE tests (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  user_prompt TEXT NOT NULL,
  system_prompt_override TEXT,
  added_profiles_json TEXT NOT NULL DEFAULT '[]',
  assertions_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  test_id TEXT NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('automated','interactive')),
  status TEXT NOT NULL CHECK (status IN ('pending','running','completed','stopped','error','aborted')),
  outcome TEXT,
  stop_reason TEXT,
  started_at TEXT NOT NULL,
  duration_ms INTEGER,
  turns INTEGER NOT NULL DEFAULT 0,
  tool_calls INTEGER NOT NULL DEFAULT 0,
  peak_context_tokens INTEGER NOT NULL DEFAULT 0,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  cached_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  error_message TEXT
);

CREATE TABLE run_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('llm_request','llm_response','tool_call','tool_result','context_event')),
  label TEXT NOT NULL,
  status TEXT NOT NULL,
  duration_ms INTEGER,
  server_id TEXT,
  tool_name TEXT,
  profile_tokens_json TEXT NOT NULL DEFAULT '{}',
  usage_actual_json TEXT,
  context_snapshot_json TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}'
);
`;

const NOW = "2026-06-20T00:00:00.000Z";

/** Build an in-memory DB at the OLD schema and seed one scan + one run + one (old) run_steps row. */
function seedOldDatabase(): AppDatabase {
  const db = track(new Database(":memory:"));
  db.pragma("foreign_keys = ON");
  db.exec(OLD_SCHEMA_SQL);

  db.prepare(
    `INSERT INTO mcp_servers (id, name, transport, command, args_json, url, headers_json, env_json, created_at, updated_at)
     VALUES ('srv-1', 'Filesystem', 'stdio', 'npx', '[]', NULL, '{}', '{}', @now, @now)`,
  ).run({ now: NOW });
  db.prepare(
    `INSERT INTO mcp_scans (id, server_id, token_profile, scanned_at, status, total_tools, total_tokens)
     VALUES ('scan-old', 'srv-1', 'generic_o200k', @now, 'success', 3, 999)`,
  ).run({ now: NOW });

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
     VALUES ('test-1', 'List files', 'Use the tools.', @now, @now)`,
  ).run({ now: NOW });
  db.prepare(
    `INSERT INTO runs (id, test_id, scenario_id, mode, status, started_at)
     VALUES ('run-old', 'test-1', 'scn-1', 'automated', 'completed', @now)`,
  ).run({ now: NOW });
  db.prepare(
    `INSERT INTO run_steps (id, run_id, idx, type, label, status, profile_tokens_json, payload_json)
     VALUES ('step-old', 'run-old', 0, 'tool_call', 'read_file', 'ok', '{"generic_o200k":42}', '{"k":1}')`,
  ).run();

  return db;
}

/** Mirror openDatabase() on an in-memory DB: create everything at latest, then run migrations. */
function openFresh(): AppDatabase {
  const db = track(new Database(":memory:"));
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  return db;
}

// ── Migration: OLD snapshot → openDatabase()/applyMigrations → current schema, rows preserved ──────

test("applyMigrations brings an OLD-schema DB up to the current schema and stamps user_version", () => {
  const db = seedOldDatabase();
  assert.equal(db.pragma("user_version", { simple: true }), 0, "old DB starts at user_version 0");

  // Simulate openDatabase(): CREATE TABLE IF NOT EXISTS is a no-op on the existing old tables, then
  // the numbered migrations add the missing columns / widen the run_steps CHECK.
  db.exec(schemaSql);
  applyMigrations(db);

  // The version stamp advanced to the baseline.
  assert.equal(
    db.pragma("user_version", { simple: true }),
    LATEST_SCHEMA_VERSION,
    "user_version stamped to the baseline after migrating",
  );

  // mcp_scans gained the resource/prompt summary columns AND counting_version.
  const scanCols = columns(db, "mcp_scans");
  for (const col of [
    "total_resources",
    "total_resource_templates",
    "total_prompts",
    "total_resource_tokens",
    "total_prompt_tokens",
    "largest_resource_name",
    "largest_resource_tokens",
    "largest_prompt_name",
    "largest_prompt_tokens",
    "counting_version",
  ]) {
    assert.ok(scanCols.includes(col), `mcp_scans should have migrated column ${col}`);
  }

  // Other tables' additive columns arrived too.
  assert.ok(columns(db, "mcp_servers").includes("auth_type"), "mcp_servers.auth_type added");
  assert.ok(
    columns(db, "scenarios").includes("tool_loading_mode"),
    "scenarios.tool_loading_mode added",
  );
  // v24 added `scenarios.answers_mode` for the Answers-integration transport override; v56 DROPPED it again
  // with the feature. A DB migrated all the way to LATEST must therefore NOT carry it.
  assert.ok(
    !columns(db, "scenarios").includes("answers_mode"),
    "scenarios.answers_mode added by v24 and dropped again by v56",
  );
  assert.ok(
    !columns(db, "provider_credentials").includes("mcp_server_id"),
    "provider_credentials.mcp_server_id added by v23 and dropped again by v56",
  );
  for (const col of [
    "cumulative_tokens",
    "assistant_text",
    "reasoning_text",
    "turn_index",
    "result_bytes",
    "started_at",
    "ended_at",
  ]) {
    assert.ok(columns(db, "run_steps").includes(col), `run_steps.${col} added`);
  }

  // The run_steps CHECK was widened to admit 'user_message' (the F6 rebuild step).
  assert.match(
    tableDdl(db, "run_steps"),
    /user_message/,
    "run_steps type CHECK widened to include user_message",
  );

  // v13 (Benchmarks) — the OLD `tests` table (from OLD_SCHEMA_SQL, without the new columns) gains the
  // graded-tests columns, and the new run_grades + app_settings tables exist after migrating.
  const testCols = columns(db, "tests");
  for (const col of ["expectations_json", "category", "difficulty", "tags_json"]) {
    assert.ok(testCols.includes(col), `tests.${col} added by v13`);
  }
  const tableExists = (name: string) =>
    (
      db
        .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(name) as {
        n: number;
      }
    ).n === 1;
  assert.ok(tableExists("run_grades"), "run_grades table present after migrating");
  assert.ok(tableExists("app_settings"), "app_settings table present after migrating");
  for (const col of ["grader_id", "score", "judge_cost_usd", "grading_version"]) {
    assert.ok(columns(db, "run_grades").includes(col), `run_grades.${col} present`);
  }
  // An existing old test row keeps its data and its new tags_json defaults to '[]'.
  const testRow = db
    .prepare("SELECT tags_json, expectations_json FROM tests WHERE id = 'test-1'")
    .get() as {
    tags_json: string;
    expectations_json: string | null;
  };
  assert.equal(testRow.tags_json, "[]", "old test row's new tags_json defaulted to '[]'");
  assert.equal(testRow.expectations_json, null, "old test row's new expectations_json is NULL");

  // Existing rows are preserved across the additive migrations AND the run_steps rebuild.
  const scanRow = db.prepare("SELECT * FROM mcp_scans WHERE id = 'scan-old'").get() as {
    total_tokens: number;
    counting_version: number;
    total_resources: number;
  };
  assert.equal(scanRow.total_tokens, 999, "old scan row preserved");
  assert.equal(scanRow.counting_version, 1, "counting_version backfilled to the default 1");
  assert.equal(scanRow.total_resources, 0, "new numeric column defaulted to 0");

  const stepRow = db.prepare("SELECT * FROM run_steps WHERE id = 'step-old'").get() as {
    label: string;
    profile_tokens_json: string;
    cumulative_tokens: number | null;
  };
  assert.equal(stepRow.label, "read_file", "old run_steps row preserved across the rebuild");
  assert.equal(
    stepRow.profile_tokens_json,
    '{"generic_o200k":42}',
    "old run_steps data preserved across the rebuild",
  );
  assert.equal(stepRow.cumulative_tokens, null, "new nullable run_steps column defaults to NULL");

  // The widened CHECK now accepts a user_message step (would have been REJECTED by the old CHECK).
  assert.doesNotThrow(() => {
    db.prepare(
      `INSERT INTO run_steps (id, run_id, idx, type, label, status)
       VALUES ('step-um', 'run-old', 1, 'user_message', 'user', 'ok')`,
    ).run();
  }, "a user_message step inserts after the CHECK widen");

  // v18 (Skill IDE WP 9.1) — skill_versions gained the additive intent_log_json column.
  assert.ok(
    columns(db, "skill_versions").includes("intent_log_json"),
    "v18 added skill_versions.intent_log_json",
  );

  // v27 (Auto-Rating AR11) — runs/suite_runs gained rating_state; the old TERMINAL run (no
  // base-rating grade rows — run_grades didn't even exist pre-v13) backfills to 'skipped'.
  assert.ok(columns(db, "runs").includes("rating_state"), "v27 added runs.rating_state");
  assert.ok(
    columns(db, "suite_runs").includes("rating_state"),
    "v27 added suite_runs.rating_state",
  );
  const oldRun = db.prepare("SELECT rating_state FROM runs WHERE id = 'run-old'").get() as {
    rating_state: string;
  };
  assert.equal(
    oldRun.rating_state,
    "skipped",
    "terminal pre-v27 run without base-rating grades backfills to 'skipped'",
  );

  // v29 (Claude subscription WP 3.1) — runs gained the additive cost_basis column; the old run
  // backfills to NULL (→ absent/'api_exact', the ordinary exactly-billed meaning).
  assert.ok(columns(db, "runs").includes("cost_basis"), "v29 added runs.cost_basis");
  const oldRunBasis = db.prepare("SELECT cost_basis FROM runs WHERE id = 'run-old'").get() as {
    cost_basis: string | null;
  };
  assert.equal(oldRunBasis.cost_basis, null, "pre-v29 run's new cost_basis defaults to NULL");
});

// ── Migration v18: a pre-v18 DB (skill_versions without intent_log_json, stamped 17) → column added ──
test("migration v18 — pre-v18 DB gains skill_versions.intent_log_json (additive, rows preserved)", () => {
  const db = track(new Database(":memory:"));
  db.pragma("foreign_keys = ON");
  // The skill_versions shape as it stood at v17 (no intent_log_json), plus its `skills` FK parent.
  db.exec(`
    CREATE TABLE skills (id TEXT PRIMARY KEY, current_version_id TEXT);
    CREATE TABLE skill_versions (
      id TEXT PRIMARY KEY,
      skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      version_label TEXT NOT NULL,
      tree_sha TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      token_profile TEXT NOT NULL,
      file_count INTEGER NOT NULL,
      total_bytes INTEGER NOT NULL,
      imported_from TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL
    );
  `);
  db.prepare("INSERT INTO skills (id) VALUES ('sk-1')").run();
  db.prepare(
    `INSERT INTO skill_versions (id, skill_id, seq, version_label, tree_sha, source_kind, token_profile, file_count, total_bytes, imported_from, note, created_at)
     VALUES ('sv-1','sk-1',1,'v1','sha-1','upload','generic_o200k',1,10,'upload','before v18','2026-01-01T00:00:00.000Z')`,
  ).run();
  db.pragma("user_version = 17");
  assert.ok(
    !columns(db, "skill_versions").includes("intent_log_json"),
    "pre-v18 DB lacks intent_log_json",
  );

  applyMigrations(db);

  assert.equal(
    db.pragma("user_version", { simple: true }),
    LATEST_SCHEMA_VERSION,
    "stamped to latest after v18",
  );
  assert.ok(columns(db, "skill_versions").includes("intent_log_json"), "v18 added intent_log_json");
  const row = db
    .prepare("SELECT note, intent_log_json FROM skill_versions WHERE id = 'sv-1'")
    .get() as {
    note: string;
    intent_log_json: string | null;
  };
  assert.equal(row.note, "before v18", "existing row preserved across the additive migration");
  assert.equal(row.intent_log_json, null, "the new column defaults to NULL for existing rows");
});

// ── Migration v20 (Assistant WP 0.1) — assistant_credentials/threads/events; v21 adds settings ─────
// NOTE: roadmap/assistant/00-plan.md §4 originally numbered this migration "v19", but v19 (Testing-UX
// suite-run member index, above) landed first — this is v20 (see db/database.ts). Later WPs added
// v21 (assistant_settings), v22 (suite_run_reports), v23 (provider_credentials server link), and v24
// (scenarios.answers_mode — both later reverted by v56).

test("migration v20 — a fresh DB stamps LATEST (58) and carries the 3 assistant tables", () => {
  const db = openFresh();

  assert.equal(
    LATEST_SCHEMA_VERSION,
    58,
    "LATEST_SCHEMA_VERSION auto-derived to 58 (v20 = Assistant tables; v21 = assistant_settings; v22 = suite_run_reports; v23 = provider_credentials server link; v24 = scenarios.answers_mode; v25 = server_types; v26 = rating_issues; v27 = rating_state; v28 = provider_credentials claude_subscription kind; v29 = runs.cost_basis; v30 = rating_issue_occurrences concrete evidence; v31 = unified-sessions runs columns; v32 = observability metrics indexes; v33 = observability FTS5 search index + v34 run_views + v35 runs.pinned + v36 run_feedback + v37 run_steps hierarchy + v38 watch_rules + v39 watch_rules.last_evaluated_at + v40 notifications + v41 fleet issue aggregation + v42 runs fork lineage + v43 digest reports + v44 model pricing + v45 dashboard charts + v46 review_rubrics; v47 = hub_* tables, Assistant Hub WP0.2; v48 = hub_session_skills, Assistant Hub WP2.4; v49 = hub_memory.scope/scope_id + hub_agents.display_name + hub_crews.color + hub_sessions.archived_at, Assistant Hub UX WP1.0s; v50 = hub_sessions.tool_scope_json, Assistant Hub end-user UX pass; v51 = hub_sessions.mode auto, Assistant Hub hub-fixes WP6.1; v52 = hub_sessions.roster_json, Assistant Hub end-user UX pass; v53 = hub_crews.icon, agent/crew avatar icons; v54 = hub_missions.parent_mission_id/depth/root_mission_id, crew-nesting mission-tree lineage; v55 = hub_sessions.provider_credential_id + hub_agents.provider_credential_id, model identity D-MI1; v56 = the retired Answers provider kind removed (purge + narrowed kind CHECK, mcp_server_id + scenarios.answers_mode dropped); v57 = notification/digest deep-link repair (stale /assistant/s/ + /testing/observability/issues/ paths rewritten); v58 = api_tokens, service tokens for headless/CI callers, roadmap/ci WP 1.1)",
  );
  assert.equal(db.pragma("user_version", { simple: true }), 58, "fresh DB stamped at 58");
  for (const table of ["assistant_credentials", "assistant_threads", "assistant_events"]) {
    assert.ok(tableExists(db, table), `fresh DB has ${table}`);
  }
  assert.ok(tableExists(db, "digest_reports"), "fresh DB has the v43 digest_reports table");
  assert.ok(tableExists(db, "model_pricing"), "fresh DB has the v44 model_pricing table");
  assert.ok(tableExists(db, "dashboard_charts"), "fresh DB has the v45 dashboard_charts table");
  assert.ok(tableExists(db, "review_rubrics"), "fresh DB has the v46 review_rubrics table");

  // v32 (Observability WP1.2) — the metrics covering indexes exist on a FRESH DB (they live in
  // schema.ts's baseline too, because a fresh DB is stamped at LATEST and SKIPS every migration).
  // v35 (Observability WP1.6) — idx_runs_pinned, same footgun. v42 (WP3.3) — idx_runs_derived_from.
  for (const index of [
    "idx_runs_started_at",
    "idx_runs_status_started",
    "idx_mcp_scans_scanned_at",
    "idx_runs_pinned",
    "idx_runs_derived_from",
  ]) {
    assert.ok(indexExists(db, index), `fresh DB has metrics index ${index}`);
  }
});

// ── Migration v42 (Observability WP3.3) — a pre-v42 (v41) DB gains the runs fork-lineage columns ──
test("migration v42 — a pre-v42 (v41) DB gains derived_from_run_id/fork_step_id + the index, rows survive", () => {
  const db = track(new Database(":memory:"));
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql); // everything at latest, incl. the v42 columns + index…
  // …then simulate a pre-v42 (v41) DB by rebuilding `runs` WITHOUT the lineage columns + stamping to 41.
  db.exec(`
    DROP INDEX IF EXISTS idx_runs_derived_from;
    ALTER TABLE runs DROP COLUMN derived_from_run_id;
    ALTER TABLE runs DROP COLUMN fork_step_id;
  `);
  db.pragma("user_version = 41");
  assert.ok(
    !columnExists(db, "runs", "derived_from_run_id"),
    "sanity: the v41 fixture lacks derived_from_run_id",
  );
  assert.ok(!indexExists(db, "idx_runs_derived_from"), "sanity: the v41 fixture lacks the index");

  // A pre-existing run row (untouched by an additive-column migration) must survive — with its real
  // test/scenario/provider parents so the migration's post-run FK integrity check stays clean.
  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, base_url, api_key_encrypted, created_at, updated_at)
     VALUES ('pc-v42', 'anthropic', 'P', NULL, 'enc', @now, @now)`,
  ).run({ now: NOW });
  db.prepare(
    `INSERT INTO scenarios (id, name, provider_id, model, created_at, updated_at)
     VALUES ('sc-v42', 'S', 'pc-v42', 'claude', @now, @now)`,
  ).run({ now: NOW });
  db.prepare(
    `INSERT INTO tests (id, name, user_prompt, created_at, updated_at)
     VALUES ('t-v42', 'T', 'hi', @now, @now)`,
  ).run({ now: NOW });
  db.prepare(
    `INSERT INTO runs (id, test_id, scenario_id, mode, status, started_at)
     VALUES ('run-v42', 't-v42', 'sc-v42', 'automated', 'completed', @now)`,
  ).run({ now: NOW });

  applyMigrations(db);

  assert.equal(
    db.pragma("user_version", { simple: true }),
    LATEST_SCHEMA_VERSION,
    "stamped to latest after v42",
  );
  assert.ok(columnExists(db, "runs", "derived_from_run_id"), "v42 added derived_from_run_id");
  assert.ok(columnExists(db, "runs", "fork_step_id"), "v42 added fork_step_id");
  assert.ok(indexExists(db, "idx_runs_derived_from"), "v42 added the lineage index");
  const row = db.prepare("SELECT * FROM runs WHERE id = 'run-v42'").get() as {
    derived_from_run_id: string | null;
    fork_step_id: string | null;
  };
  assert.equal(row.derived_from_run_id, null, "pre-existing run reads back non-derived (NULL)");
  assert.equal(row.fork_step_id, null, "pre-existing run reads back NULL fork_step_id");
});

// ── Migration v43 (Observability WP5.5) — a pre-v43 (v42) DB gains the digest_reports table ────────
test("migration v43 — a pre-v43 (v42) DB gains digest_reports; idempotent, immediately usable", () => {
  const db = track(new Database(":memory:"));
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql); // everything at latest, incl. digest_reports…
  db.exec("DROP TABLE IF EXISTS digest_reports;"); // …then rewind to a pre-v43 (v42) DB
  db.pragma("user_version = 42");
  assert.ok(!tableExists(db, "digest_reports"), "sanity: the v42 fixture lacks digest_reports");

  applyMigrations(db);

  assert.equal(
    db.pragma("user_version", { simple: true }),
    58,
    "stamped to LATEST (58) after v43…v58",
  );
  assert.ok(
    tableExists(db, "digest_reports"),
    "v43 created digest_reports on the existing (v42) DB",
  );

  db.prepare(
    `INSERT INTO digest_reports (id, window_kind, window_from, window_to, generated_at, late, report_json)
     VALUES ('d1','daily','2026-07-15T00:00:00.000Z','2026-07-16T00:00:00.000Z','2026-07-16T08:00:00.000Z',0,'{}')`,
  ).run();
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM digest_reports").get() as { n: number }).n,
    1,
    "digest_reports usable post-migration",
  );
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO digest_reports (id, window_kind, window_from, window_to, generated_at, late, report_json)
           VALUES ('d2','bogus','2026-07-15T00:00:00.000Z','2026-07-16T00:00:00.000Z','2026-07-16T08:00:00.000Z',0,'{}')`,
        )
        .run(),
    /CHECK/,
    "the window_kind CHECK constraint rejects an unknown value",
  );
  assert.ok(
    indexExists(db, "idx_digest_reports_kind_window"),
    "v43 added idx_digest_reports_kind_window",
  );
  assert.ok(
    indexExists(db, "idx_digest_reports_generated_at"),
    "v43 added idx_digest_reports_generated_at",
  );

  assert.doesNotThrow(() => applyMigrations(db), "re-applying v43+v44+v45+v46 is a no-op");
  assert.equal(
    db.pragma("user_version", { simple: true }),
    LATEST_SCHEMA_VERSION,
    "version unchanged after the re-run",
  );
});

// ── Migration v44 (Observability WP2.6) — a pre-v44 (v43) DB gains model_pricing + the code seed ────
test("migration v44 — a pre-v44 (v43) DB gains model_pricing seeded from the code table; idempotent", () => {
  const db = track(new Database(":memory:"));
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql); // everything at latest, incl. model_pricing…
  db.exec("DROP TABLE IF EXISTS model_pricing;"); // …then rewind to a pre-v44 (v43) DB
  db.pragma("user_version = 43");
  assert.ok(!tableExists(db, "model_pricing"), "sanity: the v43 fixture lacks model_pricing");

  applyMigrations(db);

  assert.equal(
    db.pragma("user_version", { simple: true }),
    58,
    "stamped to LATEST (58) after v44…v58",
  );
  assert.ok(tableExists(db, "model_pricing"), "v44 created model_pricing on the existing (v43) DB");
  assert.ok(indexExists(db, "idx_model_pricing_match"), "v44 added idx_model_pricing_match");
  assert.ok(indexExists(db, "idx_model_pricing_source"), "v44 added idx_model_pricing_source");

  // The seed reproduces the code table: one 'seed' row per MODEL_PRICING entry, with EXACT prices.
  const seedCount = (
    db.prepare("SELECT COUNT(*) AS n FROM model_pricing WHERE source = 'seed'").get() as {
      n: number;
    }
  ).n;
  assert.equal(seedCount, buildSeedPricingRows().length, "one seed row per code-table model");
  assert.ok(seedCount >= 20, "the seed is non-trivial");
  const gpt4o = db
    .prepare(
      "SELECT input_per_mtok, output_per_mtok, source FROM model_pricing WHERE model_match = 'gpt-4o'",
    )
    .get() as { input_per_mtok: number; output_per_mtok: number; source: string } | undefined;
  assert.ok(gpt4o, "gpt-4o was seeded");
  assert.equal(gpt4o.source, "seed", "seeded as read-only");
  const code = MODEL_PRICING["gpt-4o"];
  assert.ok(code);
  assert.equal(
    gpt4o.input_per_mtok,
    code.inPer1M,
    "seed input rate matches the code table exactly",
  );
  assert.equal(
    gpt4o.output_per_mtok,
    code.outPer1M,
    "seed output rate matches the code table exactly",
  );

  // The source CHECK rejects an unknown value.
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO model_pricing (id, provider, model_match, is_regex, input_per_mtok, output_per_mtok, effective_from, created_at, source)
           VALUES ('bogus','x','m',0,1,1,'1970-01-01T00:00:00.000Z','1970-01-01T00:00:00.000Z','banana')`,
        )
        .run(),
    /CHECK/,
    "the source CHECK constraint rejects an unknown value",
  );

  // Idempotent: re-applying does not double-seed.
  assert.doesNotThrow(() => applyMigrations(db), "re-applying v44+v45+v46 is a no-op");
  assert.equal(
    db.pragma("user_version", { simple: true }),
    LATEST_SCHEMA_VERSION,
    "version unchanged after the re-run",
  );
  assert.equal(
    (
      db.prepare("SELECT COUNT(*) AS n FROM model_pricing WHERE source = 'seed'").get() as {
        n: number;
      }
    ).n,
    seedCount,
    "no double-seed on re-run",
  );
});

// ── Migration v32 (Observability WP1.2) — a pre-v32 (v31) DB gains the three metrics covering indexes ──
test("migration v32 — a pre-v32 (v31) DB gains the metrics indexes and existing rows survive", () => {
  const db = track(new Database(":memory:"));
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql); // everything at latest, incl. the v32 indexes…
  // …then simulate a pre-v32 (v31) DB by dropping the three indexes + stamping back to 31.
  db.exec(`
    DROP INDEX IF EXISTS idx_runs_started_at;
    DROP INDEX IF EXISTS idx_runs_status_started;
    DROP INDEX IF EXISTS idx_mcp_scans_scanned_at;
  `);
  db.pragma("user_version = 31");
  for (const index of [
    "idx_runs_started_at",
    "idx_runs_status_started",
    "idx_mcp_scans_scanned_at",
  ]) {
    assert.ok(!indexExists(db, index), `sanity: the v31 fixture lacks ${index}`);
  }

  // A pre-existing scan row (untouched by an index-only migration) must survive.
  db.prepare(
    `INSERT INTO mcp_servers (id, name, transport, command, args_json, url, headers_json, env_json, auth_type, auth_header_name, created_at, updated_at)
     VALUES ('srv-v32', 'Pre-existing', 'stdio', 'npx', '[]', NULL, '{}', '{}', 'none', NULL, @now, @now)`,
  ).run({ now: NOW });
  db.prepare(
    `INSERT INTO mcp_scans (id, server_id, token_profile, scanned_at, status, total_tools, total_tokens)
     VALUES ('scan-v32', 'srv-v32', 'generic_o200k', @now, 'success', 2, 123)`,
  ).run({ now: NOW });

  applyMigrations(db);

  assert.equal(
    db.pragma("user_version", { simple: true }),
    LATEST_SCHEMA_VERSION,
    "stamped to latest after v32",
  );
  for (const index of [
    "idx_runs_started_at",
    "idx_runs_status_started",
    "idx_mcp_scans_scanned_at",
  ]) {
    assert.ok(indexExists(db, index), `v32 migration created ${index} on the existing (v31) DB`);
  }
  const scan = db.prepare("SELECT total_tokens FROM mcp_scans WHERE id = 'scan-v32'").get() as
    | { total_tokens: number }
    | undefined;
  assert.equal(scan?.total_tokens, 123, "index-only migration preserves existing rows");

  // Idempotent: re-running is a no-op (IF NOT EXISTS) and leaves the version unchanged.
  assert.doesNotThrow(() => applyMigrations(db), "re-applying v32 is a no-op");
  assert.equal(
    db.pragma("user_version", { simple: true }),
    LATEST_SCHEMA_VERSION,
    "version unchanged after the re-run",
  );
});

// ── Migration v33 (Observability WP1.3, D-OB16) — the run_search FTS5 index + run_search_map docmap ──
// Proves BOTH the migration-footgun paths land the same tables: a FRESH DB (schema.ts baseline) and an
// UPGRADED DB (the v33 `up`). Idempotent both ways; the FTS table is usable (MATCH) post-migration.

test("migration v33 — a fresh DB carries run_search + run_search_map (schema.ts baseline)", () => {
  const db = openFresh();
  assert.ok(tableExists(db, "run_search"), "fresh DB has the run_search FTS5 table");
  assert.ok(tableExists(db, "run_search_map"), "fresh DB has the run_search_map docmap");
  // The FTS5 table is functional on a fresh DB (MATCH works).
  db.prepare(
    "INSERT INTO run_search (run_id, step_id, kind, content) VALUES ('r','0','assistant','fresh db content')",
  ).run();
  const hit = db.prepare("SELECT run_id FROM run_search WHERE run_search MATCH 'content'").get() as
    | { run_id: string }
    | undefined;
  assert.equal(hit?.run_id, "r", "MATCH works on a fresh DB");
});

test("migration v33 — a pre-v33 (v32) DB gains run_search + run_search_map; existing rows survive; idempotent", () => {
  const db = track(new Database(":memory:"));
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql); // everything at latest, incl. the v33 FTS tables…
  db.exec("DROP TABLE IF EXISTS run_search_map; DROP TABLE IF EXISTS run_search;"); // …then rewind to v32
  db.pragma("user_version = 32");
  assert.ok(!tableExists(db, "run_search"), "sanity: the v32 fixture lacks run_search");
  assert.ok(!tableExists(db, "run_search_map"), "sanity: the v32 fixture lacks run_search_map");

  // A pre-existing run (v33 is additive DDL only — the row must survive untouched).
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
     VALUES ('test-1', 'List files', 'Use the tools.', @now, @now)`,
  ).run({ now: NOW });
  db.prepare(
    `INSERT INTO runs (id, test_id, scenario_id, mode, status, started_at)
     VALUES ('run-pre33', 'test-1', 'scn-1', 'automated', 'completed', @now)`,
  ).run({ now: NOW });

  applyMigrations(db);

  assert.equal(
    db.pragma("user_version", { simple: true }),
    LATEST_SCHEMA_VERSION,
    "stamped to latest after v33",
  );
  assert.ok(tableExists(db, "run_search"), "v33 created run_search on the existing (v32) DB");
  assert.ok(
    tableExists(db, "run_search_map"),
    "v33 created run_search_map on the existing (v32) DB",
  );
  assert.equal(
    (db.pragma("foreign_key_check") as unknown[]).length,
    0,
    "foreign_key_check clean after v33 (run_search_map -> runs FK, empty)",
  );
  const run = db.prepare("SELECT status FROM runs WHERE id = 'run-pre33'").get() as
    | { status: string }
    | undefined;
  assert.equal(run?.status, "completed", "the additive DDL migration preserves existing rows");

  // The FTS table is usable + its docmap FK cascades on run delete.
  db.prepare(
    "INSERT INTO run_search (run_id, step_id, kind, content) VALUES ('run-pre33','0','assistant','migrated widget text')",
  ).run();
  const rowid = db.prepare("SELECT rowid FROM run_search WHERE run_id = 'run-pre33'").get() as {
    rowid: number;
  };
  db.prepare(
    "INSERT INTO run_search_map (run_id, step_id, kind, doc_rowid) VALUES ('run-pre33','0','assistant',@rid)",
  ).run({ rid: rowid.rowid });
  db.prepare("DELETE FROM runs WHERE id = 'run-pre33'").run();
  assert.equal(
    (
      db.prepare("SELECT COUNT(*) AS n FROM run_search_map WHERE run_id = 'run-pre33'").get() as {
        n: number;
      }
    ).n,
    0,
    "the docmap cascades on run delete (ON DELETE CASCADE)",
  );

  // Idempotent: re-running is a no-op and leaves the version unchanged.
  assert.doesNotThrow(() => applyMigrations(db), "re-applying v33 is a no-op");
  assert.equal(
    db.pragma("user_version", { simple: true }),
    LATEST_SCHEMA_VERSION,
    "version unchanged after the re-run",
  );
});

test("migration v20 — a pre-v20 (v19) DB gains the 3 assistant tables and keeps existing rows", () => {
  const db = track(new Database(":memory:"));
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql); // everything at latest, incl. the 3 assistant tables…
  db.exec(`
    DROP TABLE assistant_events;
    DROP TABLE assistant_threads;
    DROP TABLE assistant_credentials;
  `); // …then simulate a pre-v20 (v19) DB lacking them
  db.pragma("user_version = 19");
  for (const table of ["assistant_credentials", "assistant_threads", "assistant_events"]) {
    assert.ok(!tableExists(db, table), `sanity: the v19 fixture lacks ${table}`);
  }

  // A pre-existing row in an UNRELATED table (this migration touches nothing else) must survive.
  db.prepare(
    `INSERT INTO mcp_servers (id, name, transport, command, args_json, url, headers_json, env_json, auth_type, auth_header_name, created_at, updated_at)
     VALUES ('srv-pre-v20', 'Pre-existing', 'stdio', 'npx', '[]', NULL, '{}', '{}', 'none', NULL, @now, @now)`,
  ).run({ now: NOW });

  applyMigrations(db);

  assert.equal(
    db.pragma("user_version", { simple: true }),
    LATEST_SCHEMA_VERSION,
    "stamped to latest after v20",
  );
  for (const table of ["assistant_credentials", "assistant_threads", "assistant_events"]) {
    assert.ok(tableExists(db, table), `v20 migration created ${table} on the existing (v19) DB`);
  }
  const server = db.prepare("SELECT name FROM mcp_servers WHERE id = 'srv-pre-v20'").get() as
    | { name: string }
    | undefined;
  assert.equal(
    server?.name,
    "Pre-existing",
    "unrelated pre-existing row survives the additive migration",
  );

  // The new tables are immediately usable post-migration (insert + read a thread).
  db.prepare(
    `INSERT INTO assistant_threads (id, title, entity_kind, entity_id, model, auth_source, sdk_session_id, status, auto_accept, created_at, updated_at)
     VALUES ('thread-1', 'Test thread', NULL, NULL, 'claude-sonnet-4-5', 'subscription', NULL, 'idle', 0, @now, @now)`,
  ).run({ now: NOW });
  const thread = db.prepare("SELECT title FROM assistant_threads WHERE id = 'thread-1'").get() as
    | { title: string }
    | undefined;
  assert.equal(
    thread?.title,
    "Test thread",
    "assistant_threads is usable immediately after the migration",
  );
});

test("applyMigrations is idempotent — re-running on an up-to-date DB is a no-op", () => {
  const db = openFresh();
  const version = db.pragma("user_version", { simple: true });
  assert.equal(version, LATEST_SCHEMA_VERSION, "fresh DB is created at the baseline version");
  assert.doesNotThrow(() => applyMigrations(db), "re-applying migrations does not throw");
  assert.equal(
    db.pragma("user_version", { simple: true }),
    LATEST_SCHEMA_VERSION,
    "version unchanged",
  );
  assert.ok(columns(db, "mcp_scans").includes("counting_version"), "fresh DB has counting_version");
  assert.ok(
    columns(db, "skill_versions").includes("intent_log_json"),
    "fresh DB has intent_log_json (v18)",
  );
  assert.ok(tableExists(db, "assistant_threads"), "fresh DB has assistant_threads (v20)");
  assert.ok(tableExists(db, "assistant_settings"), "fresh DB has assistant_settings (v21)");
  assert.ok(tableExists(db, "suite_run_reports"), "fresh DB has suite_run_reports (v22)");
});

// ── Migration v21 (Assistant WP 0.2) — assistant_settings (fallback pointer); LATEST is 21 ──────────

test("migration v21 — a pre-v21 (v20) DB gains assistant_settings and it is immediately usable", () => {
  const db = track(new Database(":memory:"));
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql); // everything at latest, incl. assistant_settings…
  db.exec("DROP TABLE assistant_settings;"); // …then simulate a pre-v21 (v20) DB lacking it
  db.pragma("user_version = 20");
  assert.ok(
    !tableExists(db, "assistant_settings"),
    "sanity: the v20 fixture lacks assistant_settings",
  );

  applyMigrations(db);

  assert.equal(
    db.pragma("user_version", { simple: true }),
    LATEST_SCHEMA_VERSION,
    "stamped to latest after v21",
  );
  assert.ok(
    tableExists(db, "assistant_settings"),
    "v21 migration created assistant_settings on the existing DB",
  );

  // The single-row config + its FK to provider_credentials work end to end (ON DELETE SET NULL).
  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, base_url, api_key_encrypted, created_at, updated_at)
     VALUES ('prov-1', 'anthropic', 'Prod', NULL, 'enc:v1:x', @now, @now)`,
  ).run({ now: NOW });
  db.prepare(
    `INSERT INTO assistant_settings (id, fallback_provider_credential_id, updated_at) VALUES (1, 'prov-1', @now)`,
  ).run({ now: NOW });
  db.prepare("DELETE FROM provider_credentials WHERE id = 'prov-1'").run();
  const row = db
    .prepare("SELECT fallback_provider_credential_id AS ref FROM assistant_settings WHERE id = 1")
    .get() as { ref: string | null } | undefined;
  assert.equal(
    row?.ref,
    null,
    "deleting the referenced provider credential clears the fallback (ON DELETE SET NULL)",
  );
});

// ── Migration v22 (Auto-Rating WP 4.1) — suite_run_reports; LATEST is 22 ────────────────────────────

test("migration v22 — a pre-v22 (v21) DB gains suite_run_reports and it is immediately usable (FK CASCADE)", () => {
  const db = track(new Database(":memory:"));
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql); // everything at latest, incl. suite_run_reports…
  db.exec("DROP TABLE suite_run_reports;"); // …then simulate a pre-v22 (v21) DB lacking it
  db.pragma("user_version = 21");
  assert.ok(
    !tableExists(db, "suite_run_reports"),
    "sanity: the v21 fixture lacks suite_run_reports",
  );

  applyMigrations(db);

  assert.equal(
    db.pragma("user_version", { simple: true }),
    LATEST_SCHEMA_VERSION,
    "stamped to latest after v22",
  );
  assert.ok(
    LATEST_SCHEMA_VERSION >= 22,
    "the suite_run_reports migration (v22) is part of the sequence",
  );
  assert.ok(
    tableExists(db, "suite_run_reports"),
    "v22 migration created suite_run_reports on the existing (v21) DB",
  );

  // The append-only report table + its FK to suite_runs work end to end (ON DELETE CASCADE).
  db.prepare(
    `INSERT INTO suites (id, name, config_json, created_at, updated_at)
     VALUES ('suite-1', 'S', '{}', @now, @now)`,
  ).run({ now: NOW });
  db.prepare(
    `INSERT INTO suite_runs (id, suite_id, status, config_snapshot_json, started_at)
     VALUES ('sr-1', 'suite-1', 'completed', '{}', @now)`,
  ).run({ now: NOW });
  db.prepare(
    `INSERT INTO suite_run_reports (id, suite_run_id, status, report_json, rating_version, created_at)
     VALUES ('rep-1', 'sr-1', 'ready', '{}', 1, @now)`,
  ).run({ now: NOW });
  const before = db.prepare("SELECT COUNT(*) AS n FROM suite_run_reports").get() as { n: number };
  assert.equal(before.n, 1, "suite_run_reports is usable immediately after the migration");
  // Deleting the parent suite run cascades to its report rows.
  db.prepare("DELETE FROM suite_runs WHERE id = 'sr-1'").run();
  const after = db.prepare("SELECT COUNT(*) AS n FROM suite_run_reports").get() as { n: number };
  assert.equal(
    after.n,
    0,
    "deleting the suite run cascade-drops its report rows (ON DELETE CASCADE)",
  );
});

// ── Migrations v23/v24 → v56 — the retired Answers provider kind, end to end ─────────────────────
//
// v23 (a provider_credentials REBUILD: + `mcp_server_id`, `kind` CHECK widened to admit that kind)
// and v24 (`scenarios.answers_mode`) built the Answers integration's schema; v56
// REMOVED it again when the feature was deleted from the product — purging every such
// credential together with the environments and runs that depended on it, narrowing the CHECK back to
// the 6 live kinds, and dropping both columns.
//
// Those three steps must still REPLAY on a real old DB, so this drives a genuine pre-v23 fixture (the
// OLD provider_credentials shape, stamped at 22) all the way to LATEST and asserts the END state:
// the historical rows a customer actually cares about survive with their SAME ids (the
// assistant_settings fallback FK stays valid — foreign_key_check clean), the retired columns are gone,
// and the narrowed CHECK rejects the retired kind. A second run is a no-op (idempotent).

/** Rewind a fresh (latest) DB's provider_credentials to its pre-v23 (v22) shape + stamp back to 22, then
 * seed a provider row referenced by the assistant_settings fallback pointer and a registered server. */
function seedPreV23Database(): AppDatabase {
  const db = track(new Database(":memory:"));
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql); // create everything at latest, then rewind provider_credentials to the old shape

  db.pragma("foreign_keys = OFF"); // drop/recreate the parent without firing child RESTRICT / SET NULL
  db.exec(`
    DROP TABLE provider_credentials;
    CREATE TABLE provider_credentials (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('anthropic','openai','google','openai_compatible','ollama')),
      label TEXT NOT NULL,
      base_url TEXT,
      api_key_encrypted TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  db.pragma("foreign_keys = ON");
  db.pragma("user_version = 22");

  // A provider row the assistant_settings fallback pointer references (must survive every rebuild).
  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, base_url, api_key_encrypted, created_at, updated_at)
     VALUES ('prov-keep', 'anthropic', 'Prod', NULL, 'enc:v1:x', @now, @now)`,
  ).run({ now: NOW });
  db.prepare(
    `INSERT INTO assistant_settings (id, fallback_provider_credential_id, updated_at) VALUES (1, 'prov-keep', @now)`,
  ).run({ now: NOW });

  return db;
}

test("migrations v23…v56 — a pre-v23 DB replays the whole chain: rows + fallback FK preserved, retired columns gone, idempotent", () => {
  const db = seedPreV23Database();
  assert.equal(
    db.pragma("user_version", { simple: true }),
    22,
    "fixture starts stamped at 22 (pre-v23)",
  );
  assert.ok(
    !columns(db, "provider_credentials").includes("mcp_server_id"),
    "sanity: fixture lacks mcp_server_id",
  );

  applyMigrations(db);

  assert.equal(
    db.pragma("user_version", { simple: true }),
    LATEST_SCHEMA_VERSION,
    "stamped to LATEST after the full chain",
  );
  // v23 added `mcp_server_id` and v24 `scenarios.answers_mode`; v56 dropped both again.
  assert.ok(
    !columns(db, "provider_credentials").includes("mcp_server_id"),
    "mcp_server_id is gone again (v56)",
  );
  assert.ok(
    !columns(db, "scenarios").includes("answers_mode"),
    "scenarios.answers_mode is gone again (v56)",
  );

  // Every pre-existing row survived with its SAME id, so the fallback FK is still valid.
  const keep = db
    .prepare("SELECT kind, label, api_key_encrypted AS key FROM provider_credentials WHERE id = 'prov-keep'")
    .get() as { kind: string; label: string; key: string } | undefined;
  assert.deepEqual(
    keep,
    { kind: "anthropic", label: "Prod", key: "enc:v1:x" },
    "the pre-existing credential survived the rebuilds verbatim",
  );
  const settings = db
    .prepare("SELECT fallback_provider_credential_id AS f FROM assistant_settings WHERE id = 1")
    .get() as { f: string | null };
  assert.equal(settings.f, "prov-keep", "the assistant_settings fallback pointer still resolves");
  assert.deepEqual(db.pragma("foreign_key_check"), [], "no dangling references after the rebuilds");

  // The narrowed CHECK rejects the retired kind (v56's whole purpose) but still admits a live one.
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO provider_credentials (id, kind, label, created_at, updated_at)
           VALUES ('bad', 'qlik_answers', 'x', @now, @now)`,
        )
        .run({ now: NOW }),
    /CHECK constraint failed/,
    "the narrowed CHECK rejects the retired kind",
  );
  assert.doesNotThrow(() =>
    db
      .prepare(
        `INSERT INTO provider_credentials (id, kind, label, created_at, updated_at)
         VALUES ('sub', 'claude_subscription', 'CLI', @now, @now)`,
      )
      .run({ now: NOW }),
  );

  // Idempotent: re-running changes nothing.
  const before = tableShape(db, "provider_credentials");
  applyMigrations(db);
  assert.deepEqual(tableShape(db, "provider_credentials"), before, "second run is a no-op");
  assert.equal(db.pragma("user_version", { simple: true }), LATEST_SCHEMA_VERSION);
});

test("migration v56 — a retired-kind credential is purged together with its environments and runs; unrelated rows survive", () => {
  const db = track(new Database(":memory:"));
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  // Rewind provider_credentials + scenarios to the pre-v56 (v55) shape so the purge has real rows.
  db.pragma("foreign_keys = OFF");
  db.exec(`
    DROP TABLE provider_credentials;
    CREATE TABLE provider_credentials (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('anthropic','openai','google','openai_compatible','ollama','qlik_answers','claude_subscription')),
      label TEXT NOT NULL,
      base_url TEXT,
      api_key_encrypted TEXT,
      mcp_server_id TEXT REFERENCES mcp_servers(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    ALTER TABLE scenarios ADD COLUMN answers_mode TEXT;
  `);
  db.pragma("foreign_keys = ON");
  db.pragma("user_version = 55");

  const cred = db.prepare(
    "INSERT INTO provider_credentials (id, kind, label, created_at, updated_at) VALUES (?, ?, ?, @now, @now)",
  );
  cred.run("prov-qa", "qlik_answers", "Tenant", { now: NOW });
  cred.run("prov-keep", "anthropic", "Prod", { now: NOW });
  const scenario = db.prepare(
    "INSERT INTO scenarios (id, name, provider_id, model, created_at, updated_at) VALUES (?, ?, ?, 'm', @now, @now)",
  );
  scenario.run("scn-qa", "Q", "prov-qa", { now: NOW });
  scenario.run("scn-keep", "K", "prov-keep", { now: NOW });
  db.prepare(
    "INSERT INTO tests (id, name, user_prompt, created_at, updated_at) VALUES ('t-1', 'T', 'go', @now, @now)",
  ).run({ now: NOW });
  const run = db.prepare(
    "INSERT INTO runs (id, test_id, scenario_id, mode, status, started_at) VALUES (?, 't-1', ?, 'automated', 'completed', @now)",
  );
  run.run("run-qa", "scn-qa", { now: NOW });
  run.run("run-keep", "scn-keep", { now: NOW });
  const step = db.prepare(
    "INSERT INTO run_steps (id, run_id, idx, type, label, status) VALUES (?, ?, 1, 'llm_response', 'x', 'ok')",
  );
  step.run("step-qa", "run-qa");
  step.run("step-keep", "run-keep");
  db.prepare(
    "INSERT INTO assistant_settings (id, fallback_provider_credential_id, updated_at) VALUES (1, 'prov-qa', @now)",
  ).run({ now: NOW });

  applyMigrations(db);

  const ids = (sql: string) => (db.prepare(sql).all() as Array<{ id: string }>).map((r) => r.id);
  assert.deepEqual(ids("SELECT id FROM provider_credentials"), ["prov-keep"], "the retired-kind credential is gone");
  assert.deepEqual(ids("SELECT id FROM scenarios"), ["scn-keep"], "its environment went with it");
  assert.deepEqual(ids("SELECT id FROM runs"), ["run-keep"], "and its runs");
  assert.deepEqual(ids("SELECT id FROM run_steps"), ["step-keep"], "and their steps (no orphans)");
  const settings = db
    .prepare("SELECT fallback_provider_credential_id AS f FROM assistant_settings WHERE id = 1")
    .get() as { f: string | null };
  assert.equal(settings.f, null, "the ON DELETE SET NULL pointer was nulled by hand (FKs are OFF)");
  assert.deepEqual(db.pragma("foreign_key_check"), [], "nothing dangling after the purge + rebuild");
});

// ── Migration v28 (Claude subscription WP 0.2, D-CS6) — provider_credentials: widen kind CHECK to admit
// 'claude_subscription'; LATEST is 28 ────────────────────────────────────────────────────────────────
//
// Build a pre-v28 DB (provider_credentials already at the v23 shape — mcp_server_id present — but its
// kind CHECK still lacks 'claude_subscription'; stamped at user_version 27) with a provider row that
// assistant_settings' fallback pointer references, then run applyMigrations and prove: the widened CHECK
// arrives; every existing row survives with its SAME id (so the fallback FK stays valid — foreign_key_check
// clean); a second run is a no-op (idempotent); a claude_subscription row now inserts (the widened CHECK
// admits it) with NO api_key_encrypted (keyless by design, D-CS7); and the upgraded table's column SHAPE
// matches a fresh DB's (this migration adds no column, only widens the CHECK).

/** Rewind a fresh (latest) DB's provider_credentials to its pre-v28 (v27) shape (CHECK without
 * 'claude_subscription', but WITH mcp_server_id — that arrived in v23) + stamp back to 27, then seed a
 * provider row referenced by the assistant_settings fallback pointer. */
function seedPreV28Database(): AppDatabase {
  const db = track(new Database(":memory:"));
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql); // create everything at latest, then rewind provider_credentials to the v27 shape

  db.pragma("foreign_keys = OFF"); // drop/recreate the parent without firing child RESTRICT / SET NULL
  db.exec(`
    DROP TABLE provider_credentials;
    CREATE TABLE provider_credentials (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('anthropic','openai','google','openai_compatible','ollama','qlik_answers')),
      label TEXT NOT NULL,
      base_url TEXT,
      api_key_encrypted TEXT,
      mcp_server_id TEXT REFERENCES mcp_servers(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  db.pragma("foreign_keys = ON");
  db.pragma("user_version = 27");

  // A provider row the assistant_settings fallback pointer references (must survive the parent rebuild).
  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, base_url, api_key_encrypted, created_at, updated_at)
     VALUES ('prov-keep', 'anthropic', 'Prod', NULL, 'enc:v1:x', @now, @now)`,
  ).run({ now: NOW });
  db.prepare(
    `INSERT INTO assistant_settings (id, fallback_provider_credential_id, updated_at) VALUES (1, 'prov-keep', @now)`,
  ).run({ now: NOW });

  return db;
}

test("migration v28 — pre-v28 DB widens the kind CHECK to admit claude_subscription; rows + fallback FK preserved; idempotent", () => {
  const db = seedPreV28Database();
  assert.equal(
    db.pragma("user_version", { simple: true }),
    27,
    "fixture starts stamped at 27 (pre-v28)",
  );
  assert.ok(
    columns(db, "provider_credentials").includes("mcp_server_id"),
    "sanity: fixture already has mcp_server_id (arrived at v23)",
  );
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO provider_credentials (id, kind, label, created_at, updated_at)
           VALUES ('bad', 'claude_subscription', 'x', @now, @now)`,
        )
        .run({ now: NOW }),
    /CHECK constraint failed/,
    "sanity: the pre-v28 CHECK rejects a claude_subscription kind",
  );

  applyMigrations(db);

  assert.equal(
    db.pragma("user_version", { simple: true }),
    LATEST_SCHEMA_VERSION,
    "stamped to latest after v28",
  );
  assert.equal(
    (db.pragma("foreign_key_check") as unknown[]).length,
    0,
    "foreign_key_check clean after the rebuild",
  );

  // The pre-existing provider row survived with its SAME id → the fallback pointer still resolves.
  const keep = db.prepare("SELECT kind FROM provider_credentials WHERE id = 'prov-keep'").get() as
    | { kind: string }
    | undefined;
  assert.equal(keep?.kind, "anthropic", "existing provider row preserved across the rebuild");
  const fallback = db
    .prepare("SELECT fallback_provider_credential_id AS ref FROM assistant_settings WHERE id = 1")
    .get() as { ref: string | null } | undefined;
  assert.equal(
    fallback?.ref,
    "prov-keep",
    "assistant_settings fallback pointer survives the rebuild (FK intact)",
  );

  // The widened CHECK now admits a keyless claude_subscription row (D-CS7 — no api_key_encrypted).
  // NOTE: `mcp_server_id` is deliberately NOT named here — v23 added it, v56 dropped it again.
  assert.doesNotThrow(
    () =>
      db
        .prepare(
          `INSERT INTO provider_credentials (id, kind, label, base_url, api_key_encrypted, created_at, updated_at)
           VALUES ('prov-cs', 'claude_subscription', 'Claude (subscription)', NULL, NULL, @now, @now)`,
        )
        .run({ now: NOW }),
    "the widened CHECK admits a claude_subscription row",
  );
  const csRow = db
    .prepare("SELECT api_key_encrypted FROM provider_credentials WHERE id = 'prov-cs'")
    .get() as { api_key_encrypted: string | null };
  assert.equal(csRow.api_key_encrypted, null, "a claude_subscription row stores no key");

  // Idempotent: re-running is a no-op and leaves the FK graph clean + the version unchanged.
  assert.doesNotThrow(() => applyMigrations(db), "re-applying v28 is a no-op");
  assert.equal(
    (db.pragma("foreign_key_check") as unknown[]).length,
    0,
    "foreign_key_check still clean after a re-run",
  );
  assert.equal(
    db.pragma("user_version", { simple: true }),
    LATEST_SCHEMA_VERSION,
    "version unchanged after the re-run",
  );

  // Fresh DB == upgraded DB shape for provider_credentials (v28 adds no column, only widens the CHECK).
  assert.deepEqual(
    tableShape(db, "provider_credentials"),
    tableShape(openFresh(), "provider_credentials"),
    "upgraded provider_credentials column shape matches a fresh DB",
  );
});

// ── Migration v29 (Claude subscription WP 3.1, D-CS4/D-CS8) — runs: additive cost_basis; LATEST is 29 ──
//
// A pre-v29 DB (runs WITHOUT cost_basis, stamped at user_version 28) gains the additive nullable
// `runs.cost_basis` column; the existing run row backfills to NULL (→ absent/'api_exact'); the column
// shape then matches a fresh DB. Mirrors the v18 (intent_log_json) additive-column test.
test("migration v29 — pre-v29 DB gains runs.cost_basis (additive, existing run backfills NULL)", () => {
  const db = track(new Database(":memory:"));
  db.pragma("foreign_keys = ON");
  // A minimal `runs`-like table as it stood at v28 (no cost_basis), PLUS minimal `tests`/`scenarios`
  // parents (Unified Sessions WP1.6, v31 — its `runs` rebuild sources the FULL target DDL from
  // schema.ts, which FK-references both, so `foreign_key_check` now needs them satisfiable even though
  // v29's own `ensureColumn` never cared about FKs).
  db.exec(`
    CREATE TABLE tests (id TEXT PRIMARY KEY);
    CREATE TABLE scenarios (id TEXT PRIMARY KEY);
    CREATE TABLE runs (
      id TEXT PRIMARY KEY,
      test_id TEXT NOT NULL,
      scenario_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      cost_usd REAL NOT NULL DEFAULT 0,
      rating_state TEXT NOT NULL DEFAULT 'pending'
    );
  `);
  db.prepare("INSERT INTO tests (id) VALUES ('t')").run();
  db.prepare("INSERT INTO scenarios (id) VALUES ('s')").run();
  db.prepare(
    `INSERT INTO runs (id, test_id, scenario_id, mode, status, started_at, cost_usd)
     VALUES ('run-pre-v29', 't', 's', 'automated', 'completed', @now, 1.23)`,
  ).run({ now: NOW });
  db.pragma("user_version = 28");
  assert.ok(!columns(db, "runs").includes("cost_basis"), "pre-v29 DB lacks runs.cost_basis");

  applyMigrations(db);

  assert.equal(
    db.pragma("user_version", { simple: true }),
    LATEST_SCHEMA_VERSION,
    "stamped to latest after v29",
  );
  assert.ok(columns(db, "runs").includes("cost_basis"), "v29 added runs.cost_basis");
  const row = db
    .prepare("SELECT cost_usd, cost_basis FROM runs WHERE id = 'run-pre-v29'")
    .get() as {
    cost_usd: number;
    cost_basis: string | null;
  };
  assert.equal(row.cost_usd, 1.23, "existing run row preserved across the additive migration");
  assert.equal(row.cost_basis, null, "pre-v29 run's new cost_basis defaults to NULL");

  // Idempotent: re-running is a no-op and leaves the version unchanged.
  assert.doesNotThrow(() => applyMigrations(db), "re-applying v29 is a no-op");
  assert.equal(
    db.pragma("user_version", { simple: true }),
    LATEST_SCHEMA_VERSION,
    "version unchanged after the re-run",
  );
});

// ── Migration v35 (Observability WP1.6) — runs: additive pinned + idx_runs_pinned ──────────────────
//
// (1) FRESH path — proven above by "migration v20 — a fresh DB stamps LATEST (41) …", which already
//     asserts `idx_runs_pinned` exists on a fresh DB (schema.ts baseline; LATEST advanced past 35 with
//     the v36 run_feedback + v37 run_steps hierarchy + v38 watch_rules migrations below). (2) UPGRADE path — a pre-v35 (v34) DB (runs
//     WITHOUT `pinned`/its index, stamped at user_version 34) gains the additive `runs.pinned` column
//     (existing rows backfill 0/unpinned) and the index; idempotent on re-run. Mirrors the v29
//     (cost_basis)/v32 (index-only) pattern.
test("migration v35 — pre-v35 (v34) DB gains runs.pinned + idx_runs_pinned (additive, existing run backfills 0)", () => {
  const db = track(new Database(":memory:"));
  db.pragma("foreign_keys = ON");
  // A fresh DB is already at latest (incl. runs.pinned + idx_runs_pinned) — rewind it to the pre-v35
  // (v34) shape: drop the index (required before DROP COLUMN — SQLite refuses to drop a column an
  // index still references), then the column, then roll user_version back.
  db.exec(schemaSql);
  db.exec("DROP INDEX IF EXISTS idx_runs_pinned;");
  db.exec("ALTER TABLE runs DROP COLUMN pinned;");
  db.pragma("user_version = 34");
  assert.ok(!columns(db, "runs").includes("pinned"), "pre-v35 DB lacks runs.pinned");
  assert.ok(!indexExists(db, "idx_runs_pinned"), "pre-v35 DB lacks idx_runs_pinned");

  // A pre-existing run row (FK parents first) — written before pinned existed.
  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, created_at, updated_at)
     VALUES ('prov-pre35','anthropic','Claude',@now,@now)`,
  ).run({ now: NOW });
  db.prepare(
    `INSERT INTO scenarios (id, name, provider_id, model, created_at, updated_at)
     VALUES ('scn-pre35','S','prov-pre35','claude-sonnet-4',@now,@now)`,
  ).run({ now: NOW });
  db.prepare(
    `INSERT INTO tests (id, name, user_prompt, created_at, updated_at)
     VALUES ('test-pre35','T','go',@now,@now)`,
  ).run({ now: NOW });
  db.prepare(
    `INSERT INTO runs (id, test_id, scenario_id, mode, status, started_at)
     VALUES ('run-pre-v35','test-pre35','scn-pre35','automated','completed',@now)`,
  ).run({ now: NOW });

  applyMigrations(db);

  assert.equal(
    db.pragma("user_version", { simple: true }),
    LATEST_SCHEMA_VERSION,
    "stamped to latest after v35",
  );
  assert.ok(columns(db, "runs").includes("pinned"), "v35 added runs.pinned");
  assert.ok(indexExists(db, "idx_runs_pinned"), "v35 recreated idx_runs_pinned");
  const row = db.prepare("SELECT pinned FROM runs WHERE id = 'run-pre-v35'").get() as {
    pinned: number;
  };
  assert.equal(row.pinned, 0, "pre-v35 run's new pinned column defaults to 0 (unpinned)");

  // Idempotent: re-running is a no-op and leaves the version unchanged.
  assert.doesNotThrow(() => applyMigrations(db), "re-applying v35 is a no-op");
  assert.equal(
    db.pragma("user_version", { simple: true }),
    LATEST_SCHEMA_VERSION,
    "version unchanged after the re-run",
  );
});

// ── Migration v36 (Observability WP1.5) — run_feedback (+ 2 indexes); LATEST is 36 ─────────────────
//
// A whole NEW table (like v34's run_views), not a column add — so, like v34, its indexes are safe in
// BOTH schema.ts's baseline AND this migration step (no "column doesn't exist yet" ordering hazard;
// contrast v35's idx_runs_pinned, which lives ONLY in the migration). (1) FRESH path — proven above by
// "migration v20 — a fresh DB stamps LATEST (41) …", which already asserts `LATEST_SCHEMA_VERSION ===
// 41` and that a fresh DB carries run_feedback (schema.ts baseline; also re-asserted directly below).
// (2) UPGRADE path — a pre-v36 (v35) DB (no run_feedback table, stamped at user_version 35) gains the
// table + both indexes; idempotent on re-run; a neighboring row survives untouched.
test("migration v36 — a fresh DB carries run_feedback (schema.ts baseline)", () => {
  const db = openFresh();
  assert.ok(tableExists(db, "run_feedback"), "fresh DB has the run_feedback table");
  assert.ok(indexExists(db, "idx_run_feedback_run_id"), "fresh DB has idx_run_feedback_run_id");
  assert.ok(indexExists(db, "idx_run_feedback_run_key"), "fresh DB has idx_run_feedback_run_key");
});

test("migration v36 — a pre-v36 (v35) DB gains run_feedback + its indexes; neighboring rows survive; idempotent", () => {
  const db = track(new Database(":memory:"));
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql); // everything at latest, incl. run_feedback…
  db.exec("DROP TABLE IF EXISTS run_feedback;"); // …then rewind to a pre-v36 (v35) DB
  db.pragma("user_version = 35");
  assert.ok(!tableExists(db, "run_feedback"), "sanity: the v35 fixture lacks run_feedback");

  // A pre-existing, unrelated row (run_feedback is additive DDL only — it must survive untouched).
  db.prepare(
    "INSERT INTO provider_credentials (id, kind, label, created_at, updated_at) VALUES ('prov-pre36','anthropic','Claude',@now,@now)",
  ).run({ now: NOW });

  applyMigrations(db);

  assert.equal(
    db.pragma("user_version", { simple: true }),
    LATEST_SCHEMA_VERSION,
    "stamped to latest after v36",
  );
  assert.ok(tableExists(db, "run_feedback"), "v36 created run_feedback on the existing (v35) DB");
  assert.ok(indexExists(db, "idx_run_feedback_run_id"), "v36 created idx_run_feedback_run_id");
  assert.ok(indexExists(db, "idx_run_feedback_run_key"), "v36 created idx_run_feedback_run_key");
  const provider = db
    .prepare("SELECT label FROM provider_credentials WHERE id = 'prov-pre36'")
    .get() as { label: string } | undefined;
  assert.equal(provider?.label, "Claude", "the additive migration preserves existing rows");

  // Usable immediately post-migration (needs a run to FK against).
  db.prepare(
    `INSERT INTO scenarios (id, name, provider_id, model, created_at, updated_at)
     VALUES ('scn-pre36','S','prov-pre36','claude-sonnet-4',@now,@now)`,
  ).run({ now: NOW });
  db.prepare(
    `INSERT INTO tests (id, name, user_prompt, created_at, updated_at)
     VALUES ('test-pre36','T','go',@now,@now)`,
  ).run({ now: NOW });
  db.prepare(
    `INSERT INTO runs (id, test_id, scenario_id, mode, status, started_at)
     VALUES ('run-pre36','test-pre36','scn-pre36','automated','completed',@now)`,
  ).run({ now: NOW });
  db.prepare(
    `INSERT INTO run_feedback (id, run_id, key, source, score, created_at)
     VALUES ('fb1','run-pre36','verdict','human',1,@now)`,
  ).run({ now: NOW });
  const row = db.prepare("SELECT score FROM run_feedback WHERE id = 'fb1'").get() as
    | { score: number }
    | undefined;
  assert.equal(row?.score, 1);

  // Idempotent: re-running is a no-op and leaves the version unchanged.
  assert.doesNotThrow(() => applyMigrations(db), "re-applying v36 is a no-op");
  assert.equal(
    db.pragma("user_version", { simple: true }),
    LATEST_SCHEMA_VERSION,
    "version unchanged after the re-run",
  );
});

// ── Migration v37 (Observability WP3.1) — run_steps: additive parent_step_id + span_kind + index ───
//
// A COLUMN add (like v35's pinned), so — UNLIKE v34/v36's whole-new-table indexes — its index lives
// ONLY in the migration, never schema.ts (schemaSql's unconditional CREATE INDEX would throw "no such
// column" against a pre-v37 run_steps table). (1) FRESH path — the two columns + index on a fresh DB
// (schema.ts baseline; the v20 test also asserts LATEST advanced to 37). (2) UPGRADE path — a pre-v37
// (v36) DB (run_steps WITHOUT the two columns/its index, stamped at user_version 36) gains them; an
// existing step reads them back NULL (renders flat — FORWARD-ONLY, never backfilled); idempotent.
test("migration v37 — a fresh DB carries run_steps.parent_step_id + span_kind + its index (schema.ts baseline)", () => {
  const db = openFresh();
  assert.ok(
    columns(db, "run_steps").includes("parent_step_id"),
    "fresh DB has run_steps.parent_step_id",
  );
  assert.ok(columns(db, "run_steps").includes("span_kind"), "fresh DB has run_steps.span_kind");
  assert.ok(
    indexExists(db, "idx_run_steps_parent_step_id"),
    "fresh DB has idx_run_steps_parent_step_id",
  );
});

test("migration v37 — pre-v37 (v36) DB gains run_steps.parent_step_id + span_kind + index (additive; existing step reads NULL/flat)", () => {
  const db = track(new Database(":memory:"));
  db.pragma("foreign_keys = ON");
  // A fresh DB is already at latest — rewind run_steps to the pre-v37 (v36) shape: drop the index
  // (required before DROP COLUMN — SQLite refuses to drop a column an index still references), then the
  // two columns, then roll user_version back.
  db.exec(schemaSql);
  db.exec("DROP INDEX IF EXISTS idx_run_steps_parent_step_id;");
  db.exec("ALTER TABLE run_steps DROP COLUMN span_kind;");
  db.exec("ALTER TABLE run_steps DROP COLUMN parent_step_id;");
  db.pragma("user_version = 36");
  assert.ok(
    !columns(db, "run_steps").includes("parent_step_id"),
    "pre-v37 DB lacks run_steps.parent_step_id",
  );
  assert.ok(
    !columns(db, "run_steps").includes("span_kind"),
    "pre-v37 DB lacks run_steps.span_kind",
  );
  assert.ok(
    !indexExists(db, "idx_run_steps_parent_step_id"),
    "pre-v37 DB lacks idx_run_steps_parent_step_id",
  );

  // A pre-existing step row (FK parents first) — written before the hierarchy columns existed.
  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, created_at, updated_at)
     VALUES ('prov-pre37','anthropic','Claude',@now,@now)`,
  ).run({ now: NOW });
  db.prepare(
    `INSERT INTO scenarios (id, name, provider_id, model, created_at, updated_at)
     VALUES ('scn-pre37','S','prov-pre37','claude-sonnet-4',@now,@now)`,
  ).run({ now: NOW });
  db.prepare(
    `INSERT INTO tests (id, name, user_prompt, created_at, updated_at)
     VALUES ('test-pre37','T','go',@now,@now)`,
  ).run({ now: NOW });
  db.prepare(
    `INSERT INTO runs (id, test_id, scenario_id, mode, status, started_at)
     VALUES ('run-pre37','test-pre37','scn-pre37','automated','completed',@now)`,
  ).run({ now: NOW });
  db.prepare(
    `INSERT INTO run_steps (id, run_id, idx, type, label, status)
     VALUES ('step-pre37','run-pre37',0,'llm_response','answer','ok')`,
  ).run();

  applyMigrations(db);

  assert.equal(
    db.pragma("user_version", { simple: true }),
    LATEST_SCHEMA_VERSION,
    "stamped to latest after v37",
  );
  assert.ok(
    columns(db, "run_steps").includes("parent_step_id"),
    "v37 added run_steps.parent_step_id",
  );
  assert.ok(columns(db, "run_steps").includes("span_kind"), "v37 added run_steps.span_kind");
  assert.ok(
    indexExists(db, "idx_run_steps_parent_step_id"),
    "v37 created idx_run_steps_parent_step_id",
  );
  const row = db
    .prepare("SELECT parent_step_id, span_kind FROM run_steps WHERE id = 'step-pre37'")
    .get() as { parent_step_id: string | null; span_kind: string | null };
  assert.equal(row.parent_step_id, null, "pre-v37 step's parent_step_id defaults to NULL (flat)");
  assert.equal(row.span_kind, null, "pre-v37 step's span_kind defaults to NULL (flat)");

  // Idempotent: re-running is a no-op and leaves the version unchanged.
  assert.doesNotThrow(() => applyMigrations(db), "re-applying v37 is a no-op");
  assert.equal(
    db.pragma("user_version", { simple: true }),
    LATEST_SCHEMA_VERSION,
    "version unchanged after the re-run",
  );
});

// ── Migration v16 (Testing IA WP 1.2) — nullable repo columns + is_default, nullable suite_id, Local seed ──
//
// Build a pre-v16 DB (collections/suite_runs at the OLD not-null shape, stamped at user_version 15) with a
// git-bound collection + a member test + a LOOSE test + a LOOSE suite, then simulate startup
// (schemaSql → applyMigrations → ensureLocalCollection) and prove: git-bound collection keeps ALL fields;
// membership survives the parent-table rebuild (FK preserved, not blanked); Local appears exactly once (and
// again after a second startup — idempotent); loose test + loose suite land in Local; fresh DB == upgraded DB shape.

/** Rewind a fresh (latest) DB to the pre-v16 on-disk shape: collections/suite_runs at their v15 (not-null,
 * no is_default/source/plan_json) shape, version stamp back to 15. Then seed the fixture rows. */
function seedPreV16Database(): AppDatabase {
  const db = track(new Database(":memory:"));
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql); // create everything at latest, then rewind the two v16 tables to their old shape

  db.pragma("foreign_keys = OFF"); // drop/recreate the parent `collections` without firing child SET NULL
  db.exec(`
    DROP TABLE collections;
    CREATE TABLE collections (
      id TEXT PRIMARY KEY, name TEXT NOT NULL,
      repo_url TEXT NOT NULL, repo_path TEXT NOT NULL, branch TEXT NOT NULL,
      pat_encrypted TEXT, last_synced_sha TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    DROP TABLE suite_runs;
    CREATE TABLE suite_runs (
      id TEXT PRIMARY KEY,
      suite_id TEXT NOT NULL REFERENCES suites(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN ('pending','running','completed','capped','stopped','error')),
      config_snapshot_json TEXT NOT NULL DEFAULT '{}',
      started_at TEXT NOT NULL, ended_at TEXT,
      aggregates_json TEXT
    );
  `);
  db.pragma("foreign_keys = ON");
  db.pragma("user_version = 15");

  // A fully-populated git-bound collection (every field set) + one MEMBER test bound to it.
  db.prepare(
    `INSERT INTO collections (id, name, repo_url, repo_path, branch, pat_encrypted, last_synced_sha, created_at, updated_at)
     VALUES ('col-git', 'Team Bench', 'https://github.com/acme/bench.git', 'suites', 'develop', 'enc:v1:tok', 'deadbeef', @now, @now)`,
  ).run({ now: NOW });
  db.prepare(
    `INSERT INTO tests (id, name, user_prompt, collection_id, external_key, created_at, updated_at)
     VALUES ('t-member', 'Member', 'p', 'col-git', 'ek-member', @now, @now)`,
  ).run({ now: NOW });
  // A LOOSE (collection-less) test + a LOOSE suite — must be re-homed to Local on startup.
  db.prepare(
    `INSERT INTO tests (id, name, user_prompt, created_at, updated_at) VALUES ('t-loose', 'Loose', 'p', @now, @now)`,
  ).run({ now: NOW });
  db.prepare(
    `INSERT INTO suites (id, name, created_at, updated_at) VALUES ('s-loose', 'Loose Suite', @now, @now)`,
  ).run({ now: NOW });

  return db;
}

test("migration v16 — pre-v16 DB: git-bound fields kept, membership preserved, Local seeded once, loose members re-homed", () => {
  const db = seedPreV16Database();
  assert.equal(
    db.pragma("user_version", { simple: true }),
    15,
    "fixture starts stamped at 15 (pre-v16)",
  );
  assert.equal(
    (
      db.prepare("PRAGMA table_info(collections)").all() as Array<{ name: string; notnull: number }>
    ).find((c) => c.name === "repo_url")?.notnull,
    1,
    "sanity: fixture's collections.repo_url is NOT NULL before migrating",
  );

  // Simulate openDatabase(): CREATE IF NOT EXISTS no-ops on the existing (old-shape) tables, migrations run
  // v16, then the Local seed/backfill runs.
  db.exec(schemaSql);
  applyMigrations(db);
  ensureLocalCollection(db);

  assert.equal(
    db.pragma("user_version", { simple: true }),
    LATEST_SCHEMA_VERSION,
    "stamped to latest after v16",
  );

  // (1) The git-bound collection keeps ALL its fields; is_default defaulted to 0 (it is not the Local row).
  const gitCol = db.prepare("SELECT * FROM collections WHERE id = 'col-git'").get() as Record<
    string,
    unknown
  >;
  assert.equal(gitCol.name, "Team Bench");
  assert.equal(gitCol.repo_url, "https://github.com/acme/bench.git");
  assert.equal(gitCol.repo_path, "suites");
  assert.equal(gitCol.branch, "develop");
  assert.equal(gitCol.pat_encrypted, "enc:v1:tok");
  assert.equal(gitCol.last_synced_sha, "deadbeef");
  assert.equal(gitCol.is_default, 0, "git-bound collection is not the default");

  // (1b) Membership SURVIVED the parent-table rebuild (this is what the FK-off handling protects).
  const member = db
    .prepare("SELECT collection_id, external_key FROM tests WHERE id = 't-member'")
    .get() as {
    collection_id: string | null;
    external_key: string | null;
  };
  assert.equal(
    member.collection_id,
    "col-git",
    "member test still bound to the git collection after the rebuild",
  );
  assert.equal(
    member.external_key,
    "ek-member",
    "member test kept its external_key across the rebuild",
  );

  // (2) Exactly one default "Local" collection, and it is never repo-bound.
  const localRows = db.prepare("SELECT * FROM collections WHERE is_default = 1").all() as Array<
    Record<string, unknown>
  >;
  assert.equal(localRows.length, 1, "exactly one is_default = 1 row");
  const local = localRows[0]!;
  assert.equal(local.name, LOCAL_COLLECTION_NAME, "the default collection is named 'Local'");
  assert.equal(local.repo_url, null, "Local is never repo-bound (repo_url NULL)");
  assert.equal(local.repo_path, null, "Local repo_path NULL");
  assert.equal(local.branch, null, "Local branch NULL");
  assert.equal(
    (
      db
        .prepare("SELECT COUNT(*) AS n FROM collections WHERE name = ?")
        .get(LOCAL_COLLECTION_NAME) as { n: number }
    ).n,
    1,
    "exactly one collection named 'Local'",
  );

  // (3) The loose test + loose suite were re-homed to Local (no member left collection-less).
  assert.equal(
    (
      db.prepare("SELECT collection_id FROM tests WHERE id = 't-loose'").get() as {
        collection_id: string | null;
      }
    ).collection_id,
    local.id,
    "loose test re-homed to Local",
  );
  assert.equal(
    (
      db.prepare("SELECT collection_id FROM suites WHERE id = 's-loose'").get() as {
        collection_id: string | null;
      }
    ).collection_id,
    local.id,
    "loose suite re-homed to Local",
  );

  // (4) Idempotent: a second startup neither creates a second Local nor changes any membership.
  ensureLocalCollection(db);
  assert.equal(
    (
      db.prepare("SELECT COUNT(*) AS n FROM collections WHERE is_default = 1").get() as {
        n: number;
      }
    ).n,
    1,
    "second startup does NOT create a second Local",
  );
  assert.equal(
    (db.prepare("SELECT id FROM collections WHERE is_default = 1").get() as { id: string }).id,
    local.id,
    "the same Local row persists",
  );
  assert.equal(
    (
      db.prepare("SELECT collection_id FROM tests WHERE id = 't-member'").get() as {
        collection_id: string;
      }
    ).collection_id,
    "col-git",
    "second startup leaves the git member untouched",
  );

  // (5) Fresh DB shape == upgraded DB shape for the two rebuilt tables (mirrors the file's shape-compare pattern).
  const fresh = openFresh();
  assert.deepEqual(
    tableShape(db, "collections"),
    tableShape(fresh, "collections"),
    "collections shape matches fresh DB",
  );
  assert.deepEqual(
    tableShape(db, "suite_runs"),
    tableShape(fresh, "suite_runs"),
    "suite_runs shape matches fresh DB",
  );
  // The suite_runs → suites FK (ON DELETE CASCADE) survived the rebuild.
  const suiteRunFks = db.prepare("PRAGMA foreign_key_list(suite_runs)").all() as Array<{
    table: string;
    on_delete: string;
  }>;
  assert.ok(
    suiteRunFks.some((fk) => fk.table === "suites" && fk.on_delete === "CASCADE"),
    "suite_runs keeps its ON DELETE CASCADE FK to suites",
  );
});

// ── Delete endpoints cascade to child rows ─────────────────────────────────────────────────────

test("ScanRepository.delete removes a scan and cascades to its child tool/resource/prompt/event rows", () => {
  const db = openFresh();
  db.prepare(
    `INSERT INTO mcp_servers (id, name, transport, command, args_json, url, headers_json, env_json, created_at, updated_at)
     VALUES ('srv-1', 'Filesystem', 'stdio', 'npx', '[]', NULL, '{}', '{}', @now, @now)`,
  ).run({ now: NOW });
  db.prepare(
    `INSERT INTO mcp_scans (id, server_id, token_profile, scanned_at, status)
     VALUES ('scan-1', 'srv-1', 'generic_o200k', @now, 'success')`,
  ).run({ now: NOW });
  db.prepare(
    `INSERT INTO mcp_tool_scans (id, scan_id, tool_name, raw_tool_json, total_tokens, name_tokens, description_tokens, schema_tokens, annotations_tokens, raw_bytes, contribution_percent)
     VALUES ('tool-1', 'scan-1', 'read_file', '{}', 10, 1, 2, 3, 0, 4, 100)`,
  ).run();
  db.prepare(
    `INSERT INTO mcp_resource_scans (id, scan_id, kind, uri, raw_resource_json, total_tokens, uri_tokens, name_tokens, description_tokens, mimetype_tokens, raw_bytes, contribution_percent)
     VALUES ('res-1', 'scan-1', 'resource', 'file://a', '{}', 5, 1, 1, 1, 1, 2, 100)`,
  ).run();
  db.prepare(
    `INSERT INTO mcp_prompt_scans (id, scan_id, prompt_name, raw_prompt_json, total_tokens, name_tokens, description_tokens, arguments_tokens, raw_bytes, contribution_percent)
     VALUES ('prm-1', 'scan-1', 'greet', '{}', 7, 1, 1, 1, 2, 100)`,
  ).run();
  db.prepare(
    `INSERT INTO scan_events (id, scan_id, level, message, created_at)
     VALUES ('evt-1', 'scan-1', 'info', 'started', @now)`,
  ).run({ now: NOW });

  const scans = new ScanRepository(db);
  const result = scans.delete("scan-1");

  assert.deepEqual(result, {
    scanId: "scan-1",
    deletedTools: 1,
    deletedResources: 1,
    deletedPrompts: 1,
    deletedEvents: 1,
  });

  const remaining = (table: string) =>
    (
      db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE scan_id = 'scan-1'`).get() as {
        n: number;
      }
    ).n;
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM mcp_scans WHERE id = 'scan-1'").get() as { n: number })
      .n,
    0,
  );
  for (const table of ["mcp_tool_scans", "mcp_resource_scans", "mcp_prompt_scans", "scan_events"]) {
    assert.equal(remaining(table), 0, `${table} rows cascaded away`);
  }

  // Deleting an unknown scan 404s.
  assert.throws(() => scans.delete("nope"), /Scan not found/);
});

test("RunRepository.delete removes a run and cascades to its run_steps + run_events", () => {
  const db = openFresh();
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
     VALUES ('test-1', 'List files', 'Use the tools.', @now, @now)`,
  ).run({ now: NOW });
  db.prepare(
    `INSERT INTO runs (id, test_id, scenario_id, mode, status, started_at)
     VALUES ('run-1', 'test-1', 'scn-1', 'automated', 'completed', @now)`,
  ).run({ now: NOW });
  db.prepare(
    `INSERT INTO run_steps (id, run_id, idx, type, label, status)
     VALUES ('step-1', 'run-1', 0, 'tool_call', 'read_file', 'ok'), ('step-2', 'run-1', 1, 'user_message', 'user', 'ok')`,
  ).run();
  db.prepare(
    `INSERT INTO run_events (id, run_id, idx, type, payload_json, created_at)
     VALUES ('evt-1', 'run-1', 0, 'status', '{}', @now)`,
  ).run({ now: NOW });

  const runs = new RunRepository(db);
  const result = runs.delete("run-1");

  assert.deepEqual(result, { runId: "run-1", deletedSteps: 2, deletedEvents: 1 });
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM runs WHERE id = 'run-1'").get() as { n: number }).n,
    0,
  );
  assert.equal(
    (
      db.prepare("SELECT COUNT(*) AS n FROM run_steps WHERE run_id = 'run-1'").get() as {
        n: number;
      }
    ).n,
    0,
  );
  assert.equal(
    (
      db.prepare("SELECT COUNT(*) AS n FROM run_events WHERE run_id = 'run-1'").get() as {
        n: number;
      }
    ).n,
    0,
  );

  assert.throws(() => runs.delete("nope"), /Run not found/);
});

// ── Retention: keep last N scans per server ────────────────────────────────────────────────────

test("pruneServerScans keeps the most recent N scans per server and cascades the rest", () => {
  const db = openFresh();
  db.prepare(
    `INSERT INTO mcp_servers (id, name, transport, command, args_json, url, headers_json, env_json, created_at, updated_at)
     VALUES ('srv-1', 'A', 'stdio', 'npx', '[]', NULL, '{}', '{}', @now, @now),
            ('srv-2', 'B', 'stdio', 'npx', '[]', NULL, '{}', '{}', @now, @now)`,
  ).run({ now: NOW });
  const insertScan = db.prepare(
    `INSERT INTO mcp_scans (id, server_id, token_profile, scanned_at, status) VALUES (?, ?, 'generic_o200k', ?, 'success')`,
  );
  // srv-1: 4 scans at increasing timestamps; srv-2: 1 scan.
  for (let i = 1; i <= 4; i++) insertScan.run(`s1-${i}`, "srv-1", `2026-06-2${i}T00:00:00.000Z`);
  insertScan.run("s2-1", "srv-2", "2026-06-20T00:00:00.000Z");
  // A tool row on the oldest srv-1 scan proves the cascade fires on prune.
  db.prepare(
    `INSERT INTO mcp_tool_scans (id, scan_id, tool_name, raw_tool_json, total_tokens, name_tokens, description_tokens, schema_tokens, annotations_tokens, raw_bytes, contribution_percent)
     VALUES ('t-old', 's1-1', 'x', '{}', 1, 1, 0, 0, 0, 1, 100)`,
  ).run();

  const scans = new ScanRepository(db);
  const pruned = scans.pruneServerScans("srv-1", 2);

  // The two OLDEST srv-1 scans are pruned; the two newest survive; srv-2 untouched.
  assert.deepEqual(pruned.sort(), ["s1-1", "s1-2"]);
  const surviving = (
    db.prepare("SELECT id FROM mcp_scans WHERE server_id = 'srv-1' ORDER BY id").all() as Array<{
      id: string;
    }>
  ).map((r) => r.id);
  assert.deepEqual(surviving, ["s1-3", "s1-4"]);
  assert.equal(
    (
      db.prepare("SELECT COUNT(*) AS n FROM mcp_scans WHERE server_id = 'srv-2'").get() as {
        n: number;
      }
    ).n,
    1,
  );
  assert.equal(
    (
      db.prepare("SELECT COUNT(*) AS n FROM mcp_tool_scans WHERE scan_id = 's1-1'").get() as {
        n: number;
      }
    ).n,
    0,
    "pruned scan's tools cascaded away",
  );

  // keep <= 0 disables retention (no-op).
  assert.deepEqual(scans.pruneServerScans("srv-1", 0), []);
});

// F5 — retention must NEVER prune a `running` scan: it's in-flight, so pruning it orphans the work
// (FK errors + lost results when it completes). Only TERMINAL scans ('success'/'failed') are candidates.
test("pruneServerScans never prunes a running scan (retention considers only terminal scans)", () => {
  const db = openFresh();
  db.prepare(
    `INSERT INTO mcp_servers (id, name, transport, command, args_json, url, headers_json, env_json, created_at, updated_at)
     VALUES ('srv-1', 'A', 'stdio', 'npx', '[]', NULL, '{}', '{}', @now, @now)`,
  ).run({ now: NOW });
  const insertScan = db.prepare(
    `INSERT INTO mcp_scans (id, server_id, token_profile, scanned_at, status) VALUES (?, ?, 'generic_o200k', ?, ?)`,
  );
  // A RUNNING scan started earliest, then two TERMINAL scans finished later. Under the old "order ALL
  // scans by scanned_at DESC, keep N" logic, retention=1 would prune the two oldest — INCLUDING the
  // in-flight running scan (orphaning it). It must be excluded entirely from the victim set.
  insertScan.run("s-running", "srv-1", "2026-06-19T00:00:00.000Z", "running");
  insertScan.run("s-done-old", "srv-1", "2026-06-20T00:00:00.000Z", "success");
  insertScan.run("s-done-new", "srv-1", "2026-06-21T00:00:00.000Z", "failed");

  const scans = new ScanRepository(db);
  const pruned = scans.pruneServerScans("srv-1", 1);

  // Only the older TERMINAL scan is pruned; the newest terminal (within keep=1) AND the running scan survive.
  assert.deepEqual(pruned, ["s-done-old"], "only the terminal scan beyond keep=1 is pruned");
  assert.ok(
    db.prepare("SELECT id FROM mcp_scans WHERE id = 's-running'").get(),
    "the running scan is NEVER pruned",
  );
  assert.ok(
    db.prepare("SELECT id FROM mcp_scans WHERE id = 's-done-new'").get(),
    "the newest terminal scan survives",
  );
  assert.equal(
    db.prepare("SELECT id FROM mcp_scans WHERE id = 's-done-old'").get(),
    undefined,
    "the older terminal scan was pruned",
  );
});

// ── Migration v31 (Unified Sessions WP1.6, D-US1/D-US2) — runs: widen status CHECK to admit 'ended' +
// 7 new session-lifecycle columns (phase/stop_reason_code/ended_at/seen/capabilities_json/
// active_duration_ms/total_duration_ms); LATEST is 31 ──────────────────────────────────────────────
//
// Build a pre-v31 DB (`runs` at the OLD shape — status CHECK without 'ended', none of the 7 new
// columns — stamped at user_version 30) with an existing terminal run + a child run_steps/run_events
// row (proving the FK-cascade children survive the parent rebuild), then run applyMigrations and
// prove: the widened CHECK + new columns arrive; the existing run row (and its children) survive,
// NULL-safe on every new column — it reads back exactly as it always has; a second run is a no-op
// (idempotent); an 'ended' row now inserts; and the upgraded table's column SHAPE + indexes match a
// fresh DB's.

function seedPreV31Database(): AppDatabase {
  const db = track(new Database(":memory:"));
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql); // create everything at latest, then rewind `runs` to its pre-v31 shape

  db.pragma("foreign_keys = OFF"); // drop/recreate the parent without firing children's ON DELETE CASCADE
  db.exec(`
    DROP TABLE runs;
    CREATE TABLE runs (
      id TEXT PRIMARY KEY,
      test_id TEXT NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
      scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
      mode TEXT NOT NULL CHECK (mode IN ('automated','interactive')),
      status TEXT NOT NULL CHECK (status IN ('pending','running','completed','stopped','error','aborted')),
      outcome TEXT,
      stop_reason TEXT,
      started_at TEXT NOT NULL,
      duration_ms INTEGER,
      turns INTEGER NOT NULL DEFAULT 0,
      tool_calls INTEGER NOT NULL DEFAULT 0,
      peak_context_tokens INTEGER NOT NULL DEFAULT 0,
      tokens_in INTEGER NOT NULL DEFAULT 0,
      tokens_out INTEGER NOT NULL DEFAULT 0,
      cached_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      error_message TEXT,
      assertion_results_json TEXT,
      suite_run_id TEXT,
      repetition INTEGER,
      rating_state TEXT NOT NULL DEFAULT 'pending',
      cost_basis TEXT
    );
    CREATE INDEX idx_runs_test_started ON runs(test_id, started_at DESC);
    CREATE INDEX idx_runs_scenario ON runs(scenario_id, started_at DESC);
    CREATE INDEX idx_runs_suite_run ON runs(suite_run_id, started_at ASC);
  `);
  db.pragma("foreign_keys = ON");
  db.pragma("user_version = 30");

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
     VALUES ('test-1', 'List files', 'Use the tools.', @now, @now)`,
  ).run({ now: NOW });
  db.prepare(
    `INSERT INTO runs (id, test_id, scenario_id, mode, status, started_at, cost_usd)
     VALUES ('run-pre-v31', 'test-1', 'scn-1', 'interactive', 'completed', @now, 4.5)`,
  ).run({ now: NOW });
  db.prepare(
    `INSERT INTO run_steps (id, run_id, idx, type, label, status)
     VALUES ('step-pre-v31', 'run-pre-v31', 0, 'tool_call', 'read_file', 'ok')`,
  ).run();
  db.prepare(
    `INSERT INTO run_events (id, run_id, idx, type, payload_json, created_at)
     VALUES ('evt-pre-v31', 'run-pre-v31', 0, 'status', '{}', @now)`,
  ).run({ now: NOW });

  return db;
}

test("migration v31 — pre-v31 DB widens runs.status CHECK to admit 'ended' + adds the 7 session-lifecycle columns; rows + children preserved; idempotent", () => {
  const db = seedPreV31Database();
  assert.equal(
    db.pragma("user_version", { simple: true }),
    30,
    "fixture starts stamped at 30 (pre-v31)",
  );
  for (const col of [
    "phase",
    "stop_reason_code",
    "ended_at",
    "seen",
    "capabilities_json",
    "active_duration_ms",
    "total_duration_ms",
  ]) {
    assert.ok(!columns(db, "runs").includes(col), `sanity: fixture lacks runs.${col}`);
  }
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO runs (id, test_id, scenario_id, mode, status, started_at)
           VALUES ('bad', 'test-1', 'scn-1', 'interactive', 'ended', @now)`,
        )
        .run({ now: NOW }),
    /CHECK constraint failed/,
    "sanity: the pre-v31 CHECK rejects status 'ended'",
  );

  applyMigrations(db);

  assert.equal(
    db.pragma("user_version", { simple: true }),
    LATEST_SCHEMA_VERSION,
    "stamped to latest after v31",
  );
  assert.equal(
    (db.pragma("foreign_key_check") as unknown[]).length,
    0,
    "foreign_key_check clean after the rebuild",
  );

  for (const col of [
    "phase",
    "stop_reason_code",
    "ended_at",
    "seen",
    "capabilities_json",
    "active_duration_ms",
    "total_duration_ms",
  ]) {
    assert.ok(columns(db, "runs").includes(col), `v31 added runs.${col}`);
  }

  // The pre-existing run row survived with its SAME id, NULL-safe on every new column (reads as
  // absent/false — replays exactly as it always has), and its children (run_steps/run_events)
  // survived the FK-parent rebuild.
  const oldRun = db.prepare("SELECT * FROM runs WHERE id = 'run-pre-v31'").get() as Record<
    string,
    unknown
  >;
  assert.equal(oldRun.status, "completed", "existing run row preserved across the rebuild");
  assert.equal(oldRun.cost_usd, 4.5, "existing run row's data preserved");
  assert.equal(oldRun.phase, null, "new phase column defaults to NULL for an existing row");
  assert.equal(oldRun.stop_reason_code, null, "new stop_reason_code column defaults to NULL");
  assert.equal(oldRun.ended_at, null, "new ended_at column defaults to NULL");
  assert.equal(oldRun.seen, 0, "new seen column defaults to 0 (false)");
  assert.equal(oldRun.capabilities_json, null, "new capabilities_json column defaults to NULL");
  assert.equal(oldRun.active_duration_ms, null, "new active_duration_ms column defaults to NULL");
  assert.equal(oldRun.total_duration_ms, null, "new total_duration_ms column defaults to NULL");

  const step = db.prepare("SELECT label FROM run_steps WHERE id = 'step-pre-v31'").get() as
    | { label: string }
    | undefined;
  assert.equal(step?.label, "read_file", "child run_steps row survives the runs rebuild");
  const evt = db.prepare("SELECT type FROM run_events WHERE id = 'evt-pre-v31'").get() as
    | { type: string }
    | undefined;
  assert.equal(evt?.type, "status", "child run_events row survives the runs rebuild");

  // The widened CHECK now admits an 'ended' row.
  assert.doesNotThrow(
    () =>
      db
        .prepare(
          `INSERT INTO runs (id, test_id, scenario_id, mode, status, started_at, ended_at, seen, stop_reason_code)
           VALUES ('run-ended', 'test-1', 'scn-1', 'interactive', 'ended', @now, @now, 1, 'session_ended')`,
        )
        .run({ now: NOW }),
    "the widened CHECK admits status 'ended'",
  );

  // Idempotent: re-running is a no-op and leaves the FK graph clean + the version unchanged.
  assert.doesNotThrow(() => applyMigrations(db), "re-applying v31 is a no-op");
  assert.equal(
    (db.pragma("foreign_key_check") as unknown[]).length,
    0,
    "foreign_key_check still clean after a re-run",
  );
  assert.equal(
    db.pragma("user_version", { simple: true }),
    LATEST_SCHEMA_VERSION,
    "version unchanged after the re-run",
  );

  // Fresh DB == upgraded DB shape for runs.
  assert.deepEqual(
    tableShape(db, "runs"),
    tableShape(openFresh(), "runs"),
    "upgraded runs column shape matches a fresh DB",
  );

  // The three runs indexes survived the rebuild (a DROP TABLE would otherwise silently drop them).
  const indexNames = (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'runs'")
      .all() as Array<{ name: string }>
  ).map((r) => r.name);
  for (const idx of ["idx_runs_test_started", "idx_runs_scenario", "idx_runs_suite_run"]) {
    assert.ok(indexNames.includes(idx), `${idx} recreated after the rebuild`);
  }
});

// ── Migration v41 (Observability WP5.1) — fleet issue aggregation: additive columns + cluster index ──
test("migration v41 — a fresh DB carries the rating-issues fleet columns + the cluster index", () => {
  const db = openFresh();

  for (const col of [
    "cluster_key",
    "cluster_key_version",
    "occurrences",
    "affected_json",
    "lifecycle",
    "resolution_note",
    "trend_json",
  ]) {
    assert.ok(columns(db, "rating_issues").includes(col), `fresh DB rating_issues has ${col}`);
  }
  assert.ok(
    columns(db, "rating_issue_occurrences").includes("observed_at"),
    "fresh DB rating_issue_occurrences has observed_at",
  );
  // The cluster index lives ONLY in the migration (never schema.ts) but a fresh DB still gets it
  // (applyMigrations runs every step on a fresh DB) — the v35 idx_runs_pinned footgun.
  assert.ok(indexExists(db, "idx_rating_issues_cluster"), "fresh DB has idx_rating_issues_cluster");
});

test("migration v41 — a pre-v41 DB gains the fleet columns + index; existing rows survive", () => {
  const db = track(new Database(":memory:"));
  db.pragma("foreign_keys = ON");
  // The rating-issues tables as they stood at v40 (v26 rating_issues + v30 occurrences — NO fleet
  // columns), plus app_settings (the sweep watermark store the migration does not touch).
  db.exec(`
    CREATE TABLE rating_issues (
      id TEXT PRIMARY KEY,
      target_kind TEXT NOT NULL CHECK (target_kind IN ('skill','mcp_server')),
      target_id TEXT NOT NULL,
      target_name TEXT NOT NULL,
      skill_version_id TEXT,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      bucket TEXT NOT NULL,
      fix_target TEXT NOT NULL,
      draft_fix TEXT NOT NULL,
      severity TEXT NOT NULL CHECK (severity IN ('low','medium','high')),
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
      times_seen INTEGER NOT NULL DEFAULT 1,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      resolved_at TEXT,
      rating_version INTEGER NOT NULL,
      judge_provider_id TEXT,
      judge_model TEXT
    );
    CREATE TABLE rating_issue_occurrences (
      id TEXT PRIMARY KEY,
      issue_id TEXT NOT NULL REFERENCES rating_issues(id) ON DELETE CASCADE,
      run_id TEXT NOT NULL,
      suite_run_id TEXT,
      finding_digest TEXT NOT NULL,
      category TEXT NOT NULL,
      message TEXT NOT NULL,
      tool_name TEXT,
      sent_arguments TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (issue_id, run_id, finding_digest)
    );
  `);
  db.prepare(
    `INSERT INTO rating_issues (
       id, target_kind, target_id, target_name, title, summary, bucket, fix_target, draft_fix,
       severity, status, times_seen, first_seen_at, last_seen_at, rating_version
     ) VALUES ('ri-1','mcp_server','srv-1','Srv','t','s','mcp_server','mcp_server','fix','medium',
       'open',1,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z',1)`,
  ).run();
  db.pragma("user_version = 40");

  assert.ok(!columns(db, "rating_issues").includes("cluster_key"), "pre-v41 lacks cluster_key");

  db.exec(schemaSql); // CREATE TABLE IF NOT EXISTS no-ops on the existing old tables
  applyMigrations(db);

  assert.equal(
    db.pragma("user_version", { simple: true }),
    LATEST_SCHEMA_VERSION,
    "stamped forward to LATEST after v41",
  );
  for (const col of [
    "cluster_key",
    "cluster_key_version",
    "occurrences",
    "affected_json",
    "lifecycle",
    "resolution_note",
    "trend_json",
  ]) {
    assert.ok(columns(db, "rating_issues").includes(col), `v41 added rating_issues.${col}`);
  }
  assert.ok(
    columns(db, "rating_issue_occurrences").includes("observed_at"),
    "v41 added rating_issue_occurrences.observed_at",
  );
  assert.ok(indexExists(db, "idx_rating_issues_cluster"), "v41 created idx_rating_issues_cluster");
  // The existing per-run issue survived, its new fleet columns reading back NULL (unchanged behavior).
  const row = db
    .prepare("SELECT title, cluster_key, lifecycle FROM rating_issues WHERE id = 'ri-1'")
    .get() as { title: string; cluster_key: string | null; lifecycle: string | null };
  assert.equal(row.title, "t", "existing issue row preserved");
  assert.equal(row.cluster_key, null, "existing (AR) issue reads cluster_key back NULL");
  assert.equal(row.lifecycle, null, "existing (AR) issue reads lifecycle back NULL");

  // Idempotent: re-applying is a no-op and leaves the version unchanged.
  assert.doesNotThrow(() => applyMigrations(db), "re-applying v41 is a no-op");
});

// ── Migration v51 (Assistant Hub hub-fixes WP6.1, RC7) — hub_sessions.mode gains 'auto' ──────────────
//
// A CHECK can't be altered in place, so v51 is the 12-step table rebuild. Proves it on a REALISTIC pre-v51
// fixture (an OLD-CHECK hub_sessions with v49/v50's columns ALTER-appended at the end, plus the tables it
// references and a self-referencing parent→child pair), that: the rebuild preserves every row + the self-FK,
// the widened CHECK admits an 'auto' session, garbage is still rejected, and the upgrade is idempotent.

/** A pre-v51 hub_sessions fixture: the OLD mode CHECK (no 'auto'), archived_at/tool_scope_json appended
 *  via ALTER (as a real upgraded DB would have them — at the END, not schema.ts order), a parent + a
 *  self-referencing agent child + a mission-mode row, stamped at 50. */
function seedPreV51Database(): AppDatabase {
  const db = track(new Database(":memory:"));
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE hub_projects (id TEXT PRIMARY KEY);
    CREATE TABLE hub_crews (id TEXT PRIMARY KEY);
    CREATE TABLE hub_missions (id TEXT PRIMARY KEY);
    -- v55 (model identity, D-MI1) makes hub_sessions reference provider_credentials; SQLite resolves FK
    -- targets at DML time, so this fixture needs the parent table present for its post-migration inserts.
    CREATE TABLE provider_credentials (id TEXT PRIMARY KEY);
    CREATE TABLE hub_sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES hub_projects(id) ON DELETE SET NULL,
      kind TEXT NOT NULL CHECK (kind IN ('chat','agent')),
      parent_session_id TEXT REFERENCES hub_sessions(id) ON DELETE CASCADE,
      mission_id TEXT REFERENCES hub_missions(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      title_state TEXT NOT NULL DEFAULT 'pending' CHECK (title_state IN ('pending','auto','manual')),
      mode TEXT NOT NULL CHECK (mode IN ('chat','research','mission')),
      topology TEXT, autonomy TEXT, crew_id TEXT REFERENCES hub_crews(id) ON DELETE SET NULL,
      model TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
      phase TEXT, stop_reason_code TEXT, capabilities_json TEXT, budgets_json TEXT, prompt_version TEXT,
      cost_usd REAL NOT NULL DEFAULT 0, tokens_in INTEGER NOT NULL DEFAULT 0, tokens_out INTEGER NOT NULL DEFAULT 0,
      active_duration_ms INTEGER, total_duration_ms INTEGER, wait_deadline_at TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, ended_at TEXT, seen INTEGER NOT NULL DEFAULT 0
    );
    ALTER TABLE hub_sessions ADD COLUMN archived_at TEXT;
    ALTER TABLE hub_sessions ADD COLUMN tool_scope_json TEXT;
    CREATE INDEX idx_hub_sessions_project_updated ON hub_sessions(project_id, updated_at DESC);
    CREATE INDEX idx_hub_sessions_kind_updated ON hub_sessions(kind, updated_at DESC);
    CREATE INDEX idx_hub_sessions_parent ON hub_sessions(parent_session_id);
    CREATE INDEX idx_hub_sessions_mission ON hub_sessions(mission_id);
  `);
  db.prepare(
    `INSERT INTO hub_sessions (id,kind,title,mode,model,created_at,updated_at) VALUES ('p1','chat','Parent','mission',@m,@now,@now)`,
  ).run({ m: "gpt-4o", now: NOW });
  db.prepare(
    `INSERT INTO hub_sessions (id,kind,parent_session_id,title,mode,model,created_at,updated_at) VALUES ('c1','agent','p1','Child','chat',@m,@now,@now)`,
  ).run({ m: "gpt-4o", now: NOW });
  db.prepare(
    `INSERT INTO hub_sessions (id,kind,title,mode,model,created_at,updated_at) VALUES ('r1','chat','Research','research',@m,@now,@now)`,
  ).run({ m: "gpt-4o", now: NOW });
  db.pragma("user_version = 50");
  return db;
}

test("migration v51 — pre-v51 DB widens hub_sessions.mode to admit 'auto'; rows + self-FK preserved; idempotent", () => {
  const db = seedPreV51Database();
  // Sanity: the pre-v51 CHECK rejects 'auto'.
  assert.throws(
    () =>
      db
        .prepare(`INSERT INTO hub_sessions (id,kind,title,mode,model,created_at,updated_at) VALUES ('x','chat','X','auto',@m,@now,@now)`)
        .run({ m: "gpt-4o", now: NOW }),
    /CHECK constraint failed/,
    "the pre-v51 CHECK rejects an auto session (guards the rebuild's purpose)",
  );

  applyMigrations(db);

  assert.equal(db.pragma("user_version", { simple: true }), LATEST_SCHEMA_VERSION, "stamped to latest after v51");
  assert.equal((db.pragma("foreign_key_check") as unknown[]).length, 0, "foreign_key_check clean after the rebuild");
  assert.ok(tableDdl(db, "hub_sessions").includes("'auto'"), "the mode CHECK now lists 'auto'");

  // Every row survived, and the self-referencing child still points at its parent.
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM hub_sessions").get() as { n: number }).n,
    3,
    "all three rows preserved across the rebuild",
  );
  assert.equal(
    (db.prepare("SELECT parent_session_id AS p FROM hub_sessions WHERE id='c1'").get() as { p: string }).p,
    "p1",
    "the self-FK (parent_session_id) survives the rebuild",
  );

  // The widened CHECK admits an auto session…
  assert.doesNotThrow(
    () =>
      db
        .prepare(`INSERT INTO hub_sessions (id,kind,title,mode,model,created_at,updated_at) VALUES ('a1','chat','Auto','auto',@m,@now,@now)`)
        .run({ m: "gpt-4o", now: NOW }),
    "the widened CHECK admits an auto session",
  );
  // …but garbage is still rejected.
  assert.throws(
    () =>
      db
        .prepare(`INSERT INTO hub_sessions (id,kind,title,mode,model,created_at,updated_at) VALUES ('b','chat','B','bogus',@m,@now,@now)`)
        .run({ m: "gpt-4o", now: NOW }),
    /CHECK constraint failed/,
    "an out-of-union mode is still rejected",
  );

  // The four indexes are back after the rebuild.
  for (const index of [
    "idx_hub_sessions_project_updated",
    "idx_hub_sessions_kind_updated",
    "idx_hub_sessions_parent",
    "idx_hub_sessions_mission",
  ]) {
    assert.ok(indexExists(db, index), `index ${index} recreated after the rebuild`);
  }

  // Idempotent: re-running is a no-op and leaves the FK graph clean + the version unchanged.
  assert.doesNotThrow(() => applyMigrations(db), "re-applying v51 is a no-op");
  assert.equal((db.pragma("foreign_key_check") as unknown[]).length, 0, "foreign_key_check still clean after a re-run");
  assert.equal(db.pragma("user_version", { simple: true }), LATEST_SCHEMA_VERSION, "version unchanged after the re-run");
});

// ── Migration v55 (model identity, D-MI1) — hub_sessions/hub_agents.provider_credential_id ──────────
//
// A model id does NOT identify a provider: the signed-in Claude subscription reports Anthropic's CANONICAL
// ids on purpose, so `claude-sonnet-5` names BOTH an `anthropic` API model and a `claude_subscription` one.
// v55 pins WHICH credential runs a session / a saved agent. Two additive nullable columns with
// `ON DELETE SET NULL` (deliberately NOT the Testing feature's RESTRICT — `hub_sessions` is a historical
// REPLAY table, so RESTRICT would make a credential permanently undeletable once any session used it).
// Proves: a FRESH DB and a v54-stamped DB both arrive at 55 with the columns; a pre-v55 row reads back
// NULL (⇒ the unchanged name-heuristic path, no backfill); the FK degrades rather than blocks; idempotent.

test("migration v55 — a fresh DB carries hub_sessions/hub_agents.provider_credential_id (schema.ts baseline)", () => {
  const db = openFresh();
  assert.equal(db.pragma("user_version", { simple: true }), 58, "fresh DB stamped at 58");
  assert.ok(
    columnExists(db, "hub_sessions", "provider_credential_id"),
    "the baseline DDL carries hub_sessions.provider_credential_id (a fresh DB SKIPS every migration)",
  );
  assert.ok(
    columnExists(db, "hub_agents", "provider_credential_id"),
    "the baseline DDL carries hub_agents.provider_credential_id",
  );
  // The FK is SET NULL, not RESTRICT — the whole point of the column's delete semantics.
  for (const table of ["hub_sessions", "hub_agents"]) {
    assert.match(
      tableDdl(db, table),
      /provider_credential_id\s+TEXT\s+REFERENCES\s+provider_credentials\(id\)\s+ON\s+DELETE\s+SET\s+NULL/i,
      `${table}.provider_credential_id is ON DELETE SET NULL`,
    );
  }
});

test("migration v55 — a v54-stamped DB gains both columns; pre-v55 rows read back NULL; deleting the credential degrades rather than blocks; idempotent", () => {
  // A v54-stamped DB = the CURRENT baseline minus this migration's two columns. Building it from
  // `schemaSql` and dropping the columns keeps the fixture honest (every other table is exactly what a
  // real v54 install had) without hand-copying ~30 columns of DDL.
  const db = track(new Database(":memory:") as unknown as AppDatabase);
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  db.exec("ALTER TABLE hub_sessions DROP COLUMN provider_credential_id");
  db.exec("ALTER TABLE hub_agents DROP COLUMN provider_credential_id");
  db.pragma("user_version = 54");

  const now = "2026-07-27T00:00:00.000Z";
  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, base_url, api_key_encrypted, created_at, updated_at)
     VALUES ('prov-1', 'anthropic', 'Claude', NULL, 'enc', @now, @now)`,
  ).run({ now });
  db.prepare(
    `INSERT INTO hub_sessions (id, kind, title, title_state, mode, model, status, created_at, updated_at, seen)
     VALUES ('s-legacy', 'chat', 'Legacy', 'pending', 'chat', 'claude-sonnet-5', 'completed', @now, @now, 0)`,
  ).run({ now });
  db.prepare(
    `INSERT INTO hub_agents (id, name, system_prompt, default_model, target, expected_outcome, created_at, updated_at)
     VALUES ('a-legacy', 'Researcher', 'sp', 'claude-sonnet-5', 'tgt', 'out', @now, @now)`,
  ).run({ now });

  assert.equal(
    columnExists(db, "hub_sessions", "provider_credential_id"),
    false,
    "the v54 fixture genuinely lacks the column (guards the migration's purpose)",
  );

  applyMigrations(db);

  assert.equal(db.pragma("user_version", { simple: true }), LATEST_SCHEMA_VERSION, "stamped to latest");
  assert.equal(
    LATEST_SCHEMA_VERSION,
    58, "and latest is 58");
  assert.equal((db.pragma("foreign_key_check") as unknown[]).length, 0, "foreign_key_check clean");
  assert.ok(columnExists(db, "hub_sessions", "provider_credential_id"), "hub_sessions gained it");
  assert.ok(columnExists(db, "hub_agents", "provider_credential_id"), "hub_agents gained it");

  // NO BACKFILL — a guess written into the DB would be indistinguishable from a real pin, so every
  // pre-v55 row reads back NULL and replays through the unchanged model-name heuristic.
  for (const [table, id] of [
    ["hub_sessions", "s-legacy"],
    ["hub_agents", "a-legacy"],
  ] as const) {
    assert.equal(
      (
        db
          .prepare(`SELECT provider_credential_id AS p FROM ${table} WHERE id = ?`)
          .get(id) as { p: string | null }
      ).p,
      null,
      `the pre-v55 ${table} row reads back NULL (⇒ the unchanged heuristic path)`,
    );
  }

  // A newly pinned row round-trips, and the ALTER-added REFERENCES clause is a REAL, enforced FK.
  db.prepare("UPDATE hub_sessions SET provider_credential_id = 'prov-1' WHERE id = 's-legacy'").run();
  assert.throws(
    () =>
      db.prepare("UPDATE hub_agents SET provider_credential_id = 'nope' WHERE id = 'a-legacy'").run(),
    /FOREIGN KEY constraint failed/,
    "a pin to a non-existent credential is rejected by the FK",
  );

  // ON DELETE SET NULL, not RESTRICT: the credential stays deletable and the session survives.
  assert.doesNotThrow(
    () => db.prepare("DELETE FROM provider_credentials WHERE id = 'prov-1'").run(),
    "a credential a session used is still deletable (RESTRICT would have made it permanent)",
  );
  assert.equal(
    (
      db
        .prepare("SELECT provider_credential_id AS p FROM hub_sessions WHERE id = 's-legacy'")
        .get() as { p: string | null }
    ).p,
    null,
    "the pin is nulled, degrading that session to the legacy heuristic — its history is untouched",
  );

  assert.doesNotThrow(() => applyMigrations(db), "re-applying v55 is a no-op");
  assert.equal(
    db.pragma("user_version", { simple: true }),
    LATEST_SCHEMA_VERSION,
    "version unchanged after the re-run",
  );
});

// ══ v57 — persisted notification / digest deep links repaired ════════════════════════════════════
// The emitters wrote routes that never existed (`/assistant/s/<id>`, `/testing/observability/issues/
// <id>`), so every already-stored notification still deep-linked into the 404 catch-all after the
// source fix. Proves: the legacy rows are rewritten to the real routes (`/assistant?session=<id>`,
// `/dashboard?tab=issues&issue=<id>`), an already-correct row is untouched, the same link embedded in
// a stored digest payload is rewritten too, and re-running is a no-op.

function seedPreV57Database(): AppDatabase {
  const db = track(new Database(":memory:"));
  db.exec(`
    CREATE TABLE notifications (
      id TEXT PRIMARY KEY, at TEXT NOT NULL, severity TEXT NOT NULL, title TEXT NOT NULL,
      body TEXT NOT NULL, link_path TEXT, rule_id TEXT, run_id TEXT,
      read INTEGER NOT NULL DEFAULT 0, late INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE digest_reports (
      id TEXT PRIMARY KEY, window_kind TEXT NOT NULL, window_from TEXT NOT NULL,
      window_to TEXT NOT NULL, generated_at TEXT NOT NULL, late INTEGER NOT NULL DEFAULT 0,
      report_json TEXT NOT NULL
    );
  `);
  const insert = db.prepare(
    `INSERT INTO notifications (id,at,severity,title,body,link_path) VALUES (@id,@at,'info',@title,'b',@link)`,
  );
  insert.run({ id: "n-mission", at: NOW, title: "Mission completed", link: "/assistant/s/sess-1" });
  insert.run({ id: "n-issue", at: NOW, title: "Issue regressed", link: "/testing/observability/issues/iss-1" });
  insert.run({ id: "n-run", at: NOW, title: "Run failed", link: "/testing/runs/run-1" });
  insert.run({ id: "n-none", at: NOW, title: "No link", link: null });
  db.prepare(
    `INSERT INTO digest_reports (id,window_kind,window_from,window_to,generated_at,report_json)
     VALUES ('d1','daily',@a,@b,@b,@json)`,
  ).run({
    a: NOW,
    b: NOW,
    json: JSON.stringify({ newIssues: [{ id: "iss-1", linkPath: "/testing/observability/issues/iss-1" }] }),
  });
  db.pragma("user_version = 56");
  return db;
}

test("migration v57 — stale notification/digest deep links are rewritten to routes that exist; idempotent", () => {
  const db = seedPreV57Database();
  applyMigrations(db);

  const linkOf = (id: string) =>
    (db.prepare("SELECT link_path AS l FROM notifications WHERE id = ?").get(id) as { l: string | null }).l;

  assert.equal(linkOf("n-mission"), "/assistant?session=sess-1", "a hub session link points at the workspace route");
  assert.equal(
    linkOf("n-issue"),
    "/dashboard?tab=issues&issue=iss-1",
    "a fleet-issue link points at the Dashboard's Issues tab",
  );
  assert.equal(linkOf("n-run"), "/testing/runs/run-1", "an already-valid link is untouched");
  assert.equal(linkOf("n-none"), null, "a link-less notification stays link-less");

  const payload = (
    db.prepare("SELECT report_json AS j FROM digest_reports WHERE id = 'd1'").get() as { j: string }
  ).j;
  assert.match(payload, /\/dashboard\?tab=issues&issue=iss-1/, "the stored digest payload is rewritten too");
  assert.doesNotMatch(payload, /observability\/issues/, "no legacy issue path survives in the payload");

  assert.doesNotThrow(() => applyMigrations(db), "re-applying v57 is a no-op");
  assert.equal(linkOf("n-mission"), "/assistant?session=sess-1", "the rewrite is not applied twice");
  assert.equal(
    db.pragma("user_version", { simple: true }),
    LATEST_SCHEMA_VERSION,
    "version unchanged after the re-run",
  );
});

// ══ v58 — service tokens (roadmap/ci/ WP 1.1, D-C2): the api_tokens table ═════════════════════════
// A2's two paths: a FRESH DB boots from schema.ts with `api_tokens` present (every migration no-ops
// and the version is stamped), and a DB stamped at 57 gains the table in place with its data intact.

test("migration v58 — a fresh DB carries api_tokens from the schema.ts baseline and stamps 58", () => {
  const db = openFresh();
  assert.equal(db.pragma("user_version", { simple: true }), 58, "fresh DB stamped at 58");
  assert.equal(LATEST_SCHEMA_VERSION, 58, "LATEST_SCHEMA_VERSION auto-derived to 58");
  assert.ok(tableExists(db, "api_tokens"), "the baseline DDL carries api_tokens");
  assert.deepEqual(columns(db, "api_tokens"), [
    "id",
    "label",
    "token_hash",
    "token_prefix",
    "scopes_json",
    "created_at",
    "last_used_at",
    "expires_at",
  ]);
  assert.ok(indexExists(db, "idx_api_tokens_created_at"), "the created_at index is present");
  // token_hash is UNIQUE so authentication is a single indexed lookup, never a scan-and-compare.
  assert.match(tableDdl(db, "api_tokens"), /token_hash\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i);
  // There is deliberately NO column that could hold a plaintext token.
  assert.ok(!columns(db, "api_tokens").some((c) => /secret|plaintext|token_value/.test(c)));
});

test("migration v58 — a pre-v58 (v57) DB gains api_tokens with its other data intact; idempotent", () => {
  // A v57-stamped DB = the CURRENT baseline minus this migration's table. Building it from `schemaSql`
  // and dropping the table keeps the fixture honest (every other table is exactly what a real v57
  // install had) — the v43 digest_reports pattern.
  const db = track(new Database(":memory:") as unknown as AppDatabase);
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  db.exec("DROP TABLE IF EXISTS api_tokens;");
  db.pragma("user_version = 57");
  assert.ok(!tableExists(db, "api_tokens"), "sanity: the v57 fixture genuinely lacks api_tokens");

  // Pre-existing data that must survive the upgrade untouched.
  const now = "2026-08-19T00:00:00.000Z";
  db.prepare(
    `INSERT INTO mcp_servers (id, name, transport, command, url, created_at, updated_at)
     VALUES ('srv-1', 'Existing server', 'stdio', 'node', NULL, @now, @now)`,
  ).run({ now });

  applyMigrations(db);

  assert.equal(db.pragma("user_version", { simple: true }), LATEST_SCHEMA_VERSION, "stamped to latest");
  assert.equal((db.pragma("foreign_key_check") as unknown[]).length, 0, "foreign_key_check clean");
  assert.ok(tableExists(db, "api_tokens"), "v58 created api_tokens on the existing (v57) DB");
  assert.ok(indexExists(db, "idx_api_tokens_created_at"), "…and its index");
  assert.equal(
    (db.prepare("SELECT name FROM mcp_servers WHERE id = 'srv-1'").get() as { name: string }).name,
    "Existing server",
    "existing rows survive the additive migration",
  );

  // Immediately usable, and the UNIQUE hash actually bites.
  db.prepare(
    `INSERT INTO api_tokens (id, label, token_hash, token_prefix, scopes_json, created_at, last_used_at, expires_at)
     VALUES ('t1', 'CI', 'hash-1', 'ab12cd34', '["read"]', @now, NULL, NULL)`,
  ).run({ now });
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO api_tokens (id, label, token_hash, token_prefix, scopes_json, created_at, last_used_at, expires_at)
           VALUES ('t2', 'CI 2', 'hash-1', 'ef56gh78', '["read"]', @now, NULL, NULL)`,
        )
        .run({ now }),
    /UNIQUE/,
    "two tokens can never share a hash",
  );

  // An upgraded table must be shaped exactly like the fresh-DB one (the migration DDL and the
  // schema.ts baseline are the same declaration; a drift between them is the classic v-N bug).
  assert.deepEqual(tableShape(db, "api_tokens"), tableShape(openFresh(), "api_tokens"));

  assert.doesNotThrow(() => applyMigrations(db), "re-applying v58 is a no-op");
  assert.equal(
    db.pragma("user_version", { simple: true }),
    LATEST_SCHEMA_VERSION,
    "version unchanged after the re-run",
  );
});
