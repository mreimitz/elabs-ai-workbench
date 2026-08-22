/**
 * RM-18 WP 1.4 — the upgrade-path fixture generator.
 *
 * Writes the committed fixture databases under `apps/api/test/fixtures/upgrade/`, which
 * `apps/api/test/upgrade-fixtures.test.ts` opens, migrates and asserts invariants against.
 *
 *     pnpm --filter @mcp-token-footprint/api run fixtures:upgrade
 *
 * ── Why a committed binary, and not another rewind ───────────────────────────────────────────────
 * Every "old database" in `apps/api/test/migrations.test.ts` is SIMULATED by rewinding a new one:
 * create at the latest shape from `schemaSql`, drop a table/column/index, re-stamp `user_version`
 * backwards. That has one structural blind spot no amount of extra assertions can close — the "old"
 * shape is RE-DERIVED FROM TODAY'S `schema.ts` on every test run, so it tracks whatever `schema.ts`
 * says today. A rewind test can therefore never notice that the baseline schema and the migration
 * chain have drifted apart, because both sides of the comparison move together.
 *
 * A fixture here is FROZEN. It is a real SQLite file, committed as a binary, that never re-derives
 * from `schema.ts`. The moment somebody adds a column to `schema.ts` without a matching migration
 * step, the harness's migrated-vs-fresh schema comparison goes red against every fixture.
 *
 * ── Provenance, stated honestly ──────────────────────────────────────────────────────────────────
 * These are NOT archaeologically recovered databases. This repository's git history was squashed:
 * the earliest commit already carries `LATEST_SCHEMA_VERSION = 55`, so no pre-v55 `schema.ts`
 * survives anywhere in it. The DDL below is AUTHORED, from three records the repository does carry:
 *
 *   1. the pre-versioning snapshot the project already wrote down as `OLD_SCHEMA_SQL` in
 *      `apps/api/test/migrations.test.ts` (extended here with the sibling tables no migration ever
 *      touches, and with the v10-era `session_traces` pair that migration v12 drops);
 *   2. each migration's OWN `CREATE TABLE` / `ADD COLUMN` text in `apps/api/src/db/database.ts` — a
 *      table or column introduced by migration vN is reproduced from vN's body, which IS the
 *      historical record for it;
 *   3. for tables that no migration after their era ever touched, the current `schema.ts` text,
 *      copied here as frozen text rather than imported.
 *
 * The DDL is copied into this file as frozen strings. It is deliberately NOT imported from
 * `schema.ts` — importing it would recreate exactly the rewind blind spot these fixtures close.
 *
 * ── Determinism ──────────────────────────────────────────────────────────────────────────────────
 * Every id, timestamp and payload below is a literal; the page size is pinned; each file is VACUUMed
 * before its `user_version` is stamped. Running this script twice yields byte-identical files —
 * `apps/api/test/fixtures/upgrade/README.md` documents how to verify that.
 *
 * ── Nothing here is a secret ─────────────────────────────────────────────────────────────────────
 * No row is ever copied from `data/app.sqlite`. Every value that occupies a secret-shaped column is
 * the literal marker below, which the harness asserts on.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { applyMigrations, LATEST_SCHEMA_VERSION } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";

type Db = Database.Database;

const OUT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "test",
  "fixtures",
  "upgrade",
);

/** Frozen instants — determinism first, realism second. */
const T0 = "2026-01-04T09:15:00.000Z";
const T1 = "2026-01-04T09:16:30.000Z";
const T2 = "2026-01-04T09:18:00.000Z";

/**
 * The ONE value that ever lands in a secret-shaped column (`*_encrypted`, `tokens_json`,
 * `code_verifier`, `token_hash`, …). It is not ciphertext, it decrypts to nothing, and the harness
 * asserts that every such column in every fixture holds exactly this. See the README.
 */
const NOT_A_SECRET = "fixture-placeholder-not-a-secret";

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Frozen DDL — the pre-versioning (user_version = 0) shape.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The tables as they stood BEFORE `PRAGMA user_version` gating existed. Deliberately WITHOUT:
 * `mcp_servers.auth_type`/`auth_header_name` (v1) and `type_id` (v25); `mcp_oauth_flows.completed_at`/
 * `error_message` (v1); `scenarios.tool_loading_mode` (v2); the `mcp_scans` resource/prompt block (v3)
 * and `counting_version` (v8); the `run_steps` additive block (v4) and its widened `type` CHECK (v5);
 * every additive `runs` column (v11/v14/v27/v29/v31/v35/v42/v59) and its widened `status` CHECK (v31);
 * the `tests` graded/collection/draft columns (v13/v15/v38); and `provider_credentials.mcp_server_id`
 * (v23) — its `kind` CHECK carries only the five kinds that predate v23/v28/v56.
 */
const PRE_VERSIONING_DDL = `
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

CREATE TABLE mcp_oauth_credentials (
  server_id TEXT PRIMARY KEY REFERENCES mcp_servers(id) ON DELETE CASCADE,
  client_information_json TEXT,
  tokens_json TEXT,
  code_verifier TEXT,
  discovery_state_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE mcp_oauth_flows (
  state TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
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

CREATE TABLE mcp_tool_scans (
  id TEXT PRIMARY KEY,
  scan_id TEXT NOT NULL REFERENCES mcp_scans(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  description TEXT,
  input_schema_json TEXT,
  annotations_json TEXT,
  raw_tool_json TEXT NOT NULL,
  total_tokens INTEGER NOT NULL,
  name_tokens INTEGER NOT NULL,
  description_tokens INTEGER NOT NULL,
  schema_tokens INTEGER NOT NULL,
  annotations_tokens INTEGER NOT NULL,
  raw_bytes INTEGER NOT NULL,
  contribution_percent REAL NOT NULL
);

CREATE TABLE scan_events (
  id TEXT PRIMARY KEY,
  scan_id TEXT NOT NULL REFERENCES mcp_scans(id) ON DELETE CASCADE,
  level TEXT NOT NULL CHECK (level IN ('info', 'warning', 'error')),
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
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

CREATE TABLE scenario_servers (
  scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  server_id TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  allowed_tools_json TEXT,
  PRIMARY KEY (scenario_id, server_id)
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

CREATE TABLE test_attachments (
  id TEXT PRIMARY KEY,
  test_id TEXT NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('file','image','text')),
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  bytes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
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

CREATE TABLE run_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_mcp_scans_server_scanned_at ON mcp_scans(server_id, scanned_at DESC);
CREATE INDEX idx_mcp_tool_scans_scan_tokens ON mcp_tool_scans(scan_id, total_tokens DESC);
CREATE INDEX idx_scan_events_scan_created ON scan_events(scan_id, created_at ASC);
CREATE INDEX idx_mcp_oauth_flows_server ON mcp_oauth_flows(server_id, created_at DESC);
CREATE INDEX idx_runs_test_started ON runs(test_id, started_at DESC);
CREATE INDEX idx_runs_scenario ON runs(scenario_id, started_at DESC);
CREATE INDEX idx_run_steps_run_idx ON run_steps(run_id, idx ASC);
CREATE INDEX idx_run_events_run_idx ON run_events(run_id, idx ASC);
CREATE INDEX idx_scenario_servers_scenario ON scenario_servers(scenario_id);
`;

/**
 * The v10-era external-session tables. SkillFlow WP 3.1 created them; the owner removed the feature
 * on 2026-07-03, so `schema.ts` no longer defines them and migration v12 DROPs them. A rewind
 * fixture literally CANNOT carry these — you cannot rewind your way to a table today's schema has
 * never heard of — so v12's only destructive claim has, until now, never been exercised against a
 * database that actually had something to drop.
 */
const SESSION_TRACE_DDL = `
CREATE TABLE session_traces (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE session_trace_events (
  id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL REFERENCES session_traces(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  payload_json TEXT NOT NULL
);
`;

/**
 * An authored replay of migrations v1 → v12, so a fixture stamped at 12 carries the shape a real
 * database that had been through those steps carried. Every statement below is transcribed from the
 * corresponding `MIGRATIONS` entry in `apps/api/src/db/database.ts`:
 *
 *   v1  mcp_servers.auth_type/auth_header_name, mcp_oauth_flows.completed_at/error_message
 *   v2  scenarios.tool_loading_mode
 *   v3  the mcp_scans resource/prompt block
 *   v4  the run_steps additive block
 *   v5  the run_steps `type` CHECK widening — a table REBUILD, replayed here as a rebuild
 *   v6  skills/skill_versions/skill_files columns — those tables are NOT in this fixture (they are
 *       created by `schemaSql` on open, which is exactly what happens to a real pre-skills DB)
 *   v7  scenario_skills.eager — same, table absent here
 *   v8  mcp_scans.counting_version
 *   v9  run_skills
 *   v10 (a deliberate no-op today; its historical effect is SESSION_TRACE_DDL, applied separately)
 *   v11 runs.assertion_results_json
 *   v12 DROP the session-trace tables
 */
const AUTHORED_V1_TO_V12 = `
ALTER TABLE mcp_servers ADD COLUMN auth_type TEXT NOT NULL DEFAULT 'none' CHECK (auth_type IN ('none', 'bearer', 'api_key', 'oauth', 'custom_headers'));
ALTER TABLE mcp_servers ADD COLUMN auth_header_name TEXT;
ALTER TABLE mcp_oauth_flows ADD COLUMN completed_at TEXT;
ALTER TABLE mcp_oauth_flows ADD COLUMN error_message TEXT;
ALTER TABLE scenarios ADD COLUMN tool_loading_mode TEXT NOT NULL DEFAULT 'eager' CHECK (tool_loading_mode IN ('eager', 'deferred'));
ALTER TABLE mcp_scans ADD COLUMN total_resources INTEGER NOT NULL DEFAULT 0;
ALTER TABLE mcp_scans ADD COLUMN total_resource_templates INTEGER NOT NULL DEFAULT 0;
ALTER TABLE mcp_scans ADD COLUMN total_prompts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE mcp_scans ADD COLUMN total_resource_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE mcp_scans ADD COLUMN total_prompt_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE mcp_scans ADD COLUMN largest_resource_name TEXT;
ALTER TABLE mcp_scans ADD COLUMN largest_resource_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE mcp_scans ADD COLUMN largest_prompt_name TEXT;
ALTER TABLE mcp_scans ADD COLUMN largest_prompt_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE run_steps ADD COLUMN cumulative_tokens INTEGER;
ALTER TABLE run_steps ADD COLUMN assistant_text TEXT;
ALTER TABLE run_steps ADD COLUMN reasoning_text TEXT;
ALTER TABLE run_steps ADD COLUMN turn_index INTEGER;
ALTER TABLE run_steps ADD COLUMN result_bytes INTEGER;
ALTER TABLE run_steps ADD COLUMN started_at TEXT;
ALTER TABLE run_steps ADD COLUMN ended_at TEXT;

-- v5, the CHECK widening, as its own rebuild (SQLite cannot ALTER a CHECK in place).
CREATE TABLE run_steps_v5 (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('llm_request','llm_response','tool_call','tool_result','context_event','user_message')),
  label TEXT NOT NULL,
  status TEXT NOT NULL,
  duration_ms INTEGER,
  server_id TEXT,
  tool_name TEXT,
  profile_tokens_json TEXT NOT NULL DEFAULT '{}',
  usage_actual_json TEXT,
  context_snapshot_json TEXT,
  cumulative_tokens INTEGER,
  assistant_text TEXT,
  reasoning_text TEXT,
  turn_index INTEGER,
  result_bytes INTEGER,
  started_at TEXT,
  ended_at TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}'
);
INSERT INTO run_steps_v5 (id, run_id, idx, type, label, status, duration_ms, server_id, tool_name,
  profile_tokens_json, usage_actual_json, context_snapshot_json, cumulative_tokens, assistant_text,
  reasoning_text, turn_index, result_bytes, started_at, ended_at, payload_json)
  SELECT id, run_id, idx, type, label, status, duration_ms, server_id, tool_name,
    profile_tokens_json, usage_actual_json, context_snapshot_json, cumulative_tokens, assistant_text,
    reasoning_text, turn_index, result_bytes, started_at, ended_at, payload_json FROM run_steps;
DROP TABLE run_steps;
ALTER TABLE run_steps_v5 RENAME TO run_steps;
CREATE INDEX idx_run_steps_run_idx ON run_steps(run_id, idx ASC);

ALTER TABLE mcp_scans ADD COLUMN counting_version INTEGER NOT NULL DEFAULT 1;

CREATE TABLE run_skills (
  run_id           TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  skill_id         TEXT NOT NULL,
  skill_version_id TEXT NOT NULL,
  version_label    TEXT NOT NULL DEFAULT '',
  eager            INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (run_id, skill_id)
);
CREATE INDEX idx_run_skills_version ON run_skills(skill_version_id);

ALTER TABLE runs ADD COLUMN assertion_results_json TEXT;
`;

/** v12's own step, kept separate so a fixture that never created the tables can skip it. */
const AUTHORED_V12_DROP_SESSION_TRACES = `
DROP TABLE session_trace_events;
DROP TABLE session_traces;
`;

/**
 * An authored replay of migrations v13 → v15, transcribed from their `MIGRATIONS` entries:
 * the `tests` graded/collection columns, `run_grades`, `app_settings`, `runs.suite_run_id`/
 * `repetition`, the four suite tables, and the ORIGINAL (git-mandatory) `collections` table that
 * migration v16 later rebuilds.
 */
const AUTHORED_V13_TO_V15 = `
ALTER TABLE tests ADD COLUMN expectations_json TEXT;
ALTER TABLE tests ADD COLUMN category TEXT;
ALTER TABLE tests ADD COLUMN difficulty TEXT;
ALTER TABLE tests ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';

CREATE TABLE run_grades (
  id                 TEXT PRIMARY KEY,
  run_id             TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  grader_id          TEXT NOT NULL,
  kind               TEXT NOT NULL CHECK (kind IN ('deterministic','llm')),
  status             TEXT NOT NULL CHECK (status IN ('graded','unevaluable','error')),
  score              REAL,
  raw_score          REAL,
  method             TEXT NOT NULL,
  reasoning          TEXT,
  evidence_json      TEXT,
  judge_provider_id  TEXT,
  judge_model        TEXT,
  judge_tokens_in    INTEGER NOT NULL DEFAULT 0,
  judge_tokens_out   INTEGER NOT NULL DEFAULT 0,
  judge_cost_usd     REAL NOT NULL DEFAULT 0,
  grading_version    INTEGER NOT NULL,
  created_at         TEXT NOT NULL
);
CREATE INDEX idx_run_grades_run ON run_grades(run_id, created_at ASC);
CREATE TABLE app_settings (
  key         TEXT PRIMARY KEY,
  value_json  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

ALTER TABLE runs ADD COLUMN suite_run_id TEXT;
ALTER TABLE runs ADD COLUMN repetition INTEGER;

CREATE TABLE suites (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE suite_tests (
  suite_id TEXT NOT NULL REFERENCES suites(id) ON DELETE CASCADE,
  test_id  TEXT NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  PRIMARY KEY (suite_id, test_id)
);
CREATE TABLE suite_scenarios (
  suite_id    TEXT NOT NULL REFERENCES suites(id) ON DELETE CASCADE,
  scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  PRIMARY KEY (suite_id, scenario_id)
);
CREATE TABLE suite_runs (
  id TEXT PRIMARY KEY,
  suite_id TEXT NOT NULL REFERENCES suites(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending','running','completed','capped','stopped','error')),
  config_snapshot_json TEXT NOT NULL DEFAULT '{}',
  started_at TEXT NOT NULL, ended_at TEXT,
  aggregates_json TEXT
);

CREATE TABLE collections (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  repo_url TEXT NOT NULL, repo_path TEXT NOT NULL, branch TEXT NOT NULL,
  pat_encrypted TEXT,
  last_synced_sha TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
ALTER TABLE tests ADD COLUMN collection_id TEXT REFERENCES collections(id) ON DELETE SET NULL;
ALTER TABLE tests ADD COLUMN external_key TEXT;
ALTER TABLE suites ADD COLUMN collection_id TEXT REFERENCES collections(id) ON DELETE SET NULL;
ALTER TABLE suites ADD COLUMN external_key TEXT;
CREATE UNIQUE INDEX idx_tests_extkey ON tests(collection_id, external_key)
  WHERE collection_id IS NOT NULL AND external_key IS NOT NULL;
CREATE UNIQUE INDEX idx_suites_extkey ON suites(collection_id, external_key)
  WHERE collection_id IS NOT NULL AND external_key IS NOT NULL;
`;

/**
 * The shared LATE-ERA core (v41…v55 shapes), used by the v50 and v55 fixtures.
 *
 * These two fixtures are deliberately MINIMAL — they carry the tables their target migrations act on
 * and let `schemaSql` create the rest when the database is opened. That is a pattern the migration
 * code explicitly supports (the "a MINIMAL migration-test fixture may not have created X" guards
 * scattered through `MIGRATIONS`), but it has ONE sharp edge worth stating: several indexes live
 * ONLY in a migration and never in `schema.ts` — `idx_runs_suite_run` (v19), `idx_runs_pinned` (v35),
 * `idx_run_steps_parent_step_id` (v37), `idx_rating_issues_cluster` (v41), `idx_runs_derived_from`
 * (v42) — deliberately, because `schemaSql` runs its `CREATE INDEX` statements BEFORE the migration
 * that adds the column they index. A fixture stamped ABOVE those versions therefore has to bring
 * those tables (and their indexes) with it, exactly as a real database of that vintage would; a
 * fixture that omitted them would end up with the table but not the index, which is a fixture
 * artifact rather than anything a user could hit. So this block carries `runs`, `run_steps`,
 * `rating_issues` and `rating_issue_occurrences` complete with those indexes.
 *
 * `provider_credentials` is at its v28 shape (the widened seven-kind CHECK plus the v23 link column);
 * `scenarios` carries v24's `answers_mode`; `notifications` and `digest_reports` are the v40 and v43
 * migration bodies verbatim; `assistant_settings` is the v21 body verbatim. `tests`, `runs`,
 * `run_steps` and the two rating-issue tables are at their v38 / v55 / v37 / v41 shapes — the last
 * migration to touch each before v56.
 */
const V55_ERA_DDL = `
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

CREATE TABLE assistant_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  fallback_provider_credential_id TEXT REFERENCES provider_credentials(id) ON DELETE SET NULL,
  updated_at TEXT
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
  tool_loading_mode TEXT NOT NULL DEFAULT 'eager' CHECK (tool_loading_mode IN ('eager', 'deferred')),
  answers_mode TEXT,
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
  expectations_json TEXT,
  category TEXT,
  difficulty TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  collection_id TEXT REFERENCES collections(id) ON DELETE SET NULL,
  external_key TEXT,
  draft INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE suites (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,
  config_json TEXT NOT NULL DEFAULT '{}',
  collection_id TEXT REFERENCES collections(id) ON DELETE SET NULL,
  external_key TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

-- v15's two PARTIAL UNIQUE indexes live ONLY in that migration, never in schema.ts — so a fixture
-- stamped above v15 has to carry them, exactly as a real database of that vintage does.
CREATE UNIQUE INDEX idx_tests_extkey ON tests(collection_id, external_key)
  WHERE collection_id IS NOT NULL AND external_key IS NOT NULL;
CREATE UNIQUE INDEX idx_suites_extkey ON suites(collection_id, external_key)
  WHERE collection_id IS NOT NULL AND external_key IS NOT NULL;

CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  test_id TEXT NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('automated','interactive')),
  status TEXT NOT NULL CHECK (status IN ('pending','running','completed','stopped','error','aborted','ended')),
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
  cost_basis TEXT,
  phase TEXT,
  stop_reason_code TEXT,
  ended_at TEXT,
  seen INTEGER NOT NULL DEFAULT 0,
  capabilities_json TEXT,
  active_duration_ms INTEGER,
  total_duration_ms INTEGER,
  pinned INTEGER NOT NULL DEFAULT 0,
  derived_from_run_id TEXT,
  fork_step_id TEXT
);
CREATE INDEX idx_runs_test_started ON runs(test_id, started_at DESC);
CREATE INDEX idx_runs_scenario ON runs(scenario_id, started_at DESC);
CREATE INDEX idx_runs_suite_run ON runs(suite_run_id, started_at ASC);
CREATE INDEX idx_runs_started_at ON runs(started_at);
CREATE INDEX idx_runs_status_started ON runs(status, started_at);
CREATE INDEX idx_runs_pinned ON runs(pinned);
CREATE INDEX idx_runs_derived_from ON runs(derived_from_run_id);

CREATE TABLE run_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('llm_request','llm_response','tool_call','tool_result','context_event','user_message')),
  label TEXT NOT NULL,
  status TEXT NOT NULL,
  duration_ms INTEGER,
  server_id TEXT,
  tool_name TEXT,
  profile_tokens_json TEXT NOT NULL DEFAULT '{}',
  usage_actual_json TEXT,
  context_snapshot_json TEXT,
  cumulative_tokens INTEGER,
  assistant_text TEXT,
  reasoning_text TEXT,
  turn_index INTEGER,
  result_bytes INTEGER,
  started_at TEXT,
  ended_at TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  parent_step_id TEXT,
  span_kind TEXT
);
CREATE INDEX idx_run_steps_run_idx ON run_steps(run_id, idx ASC);
CREATE INDEX idx_run_steps_parent_step_id ON run_steps(parent_step_id);

CREATE TABLE notifications (
  id        TEXT PRIMARY KEY,
  at        TEXT NOT NULL,
  severity  TEXT NOT NULL CHECK (severity IN ('info','warning','critical')),
  title     TEXT NOT NULL,
  body      TEXT NOT NULL,
  link_path TEXT,
  rule_id   TEXT,
  run_id    TEXT,
  read      INTEGER NOT NULL DEFAULT 0,
  late      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_notifications_at ON notifications(at);
CREATE INDEX idx_notifications_read ON notifications(read);

CREATE TABLE digest_reports (
  id           TEXT PRIMARY KEY,
  window_kind  TEXT NOT NULL CHECK (window_kind IN ('daily','weekly')),
  window_from  TEXT NOT NULL,
  window_to    TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  late         INTEGER NOT NULL DEFAULT 0,
  report_json  TEXT NOT NULL
);
CREATE INDEX idx_digest_reports_kind_window ON digest_reports(window_kind, window_to);
CREATE INDEX idx_digest_reports_generated_at ON digest_reports(generated_at);

CREATE TABLE rating_issues (
  id                 TEXT PRIMARY KEY,
  target_kind        TEXT NOT NULL CHECK (target_kind IN ('skill','mcp_server')),
  target_id          TEXT NOT NULL,
  target_name        TEXT NOT NULL,
  skill_version_id   TEXT,
  title              TEXT NOT NULL,
  summary            TEXT NOT NULL,
  bucket             TEXT NOT NULL,
  fix_target         TEXT NOT NULL,
  draft_fix          TEXT NOT NULL,
  severity           TEXT NOT NULL CHECK (severity IN ('low','medium','high')),
  status             TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  times_seen         INTEGER NOT NULL DEFAULT 1,
  first_seen_at      TEXT NOT NULL,
  last_seen_at       TEXT NOT NULL,
  resolved_at        TEXT,
  rating_version     INTEGER NOT NULL,
  judge_provider_id  TEXT,
  judge_model        TEXT,
  cluster_key         TEXT,
  cluster_key_version INTEGER,
  occurrences         INTEGER,
  affected_json       TEXT,
  lifecycle           TEXT CHECK (lifecycle IN ('open','resolved','regressed')),
  resolution_note     TEXT,
  trend_json          TEXT
);
CREATE INDEX idx_rating_issues_target ON rating_issues(target_kind, target_id, status);
CREATE INDEX idx_rating_issues_cluster ON rating_issues(cluster_key, cluster_key_version);

CREATE TABLE rating_issue_occurrences (
  id              TEXT PRIMARY KEY,
  issue_id        TEXT NOT NULL REFERENCES rating_issues(id) ON DELETE CASCADE,
  run_id          TEXT NOT NULL,
  suite_run_id    TEXT,
  finding_digest  TEXT NOT NULL,
  category        TEXT NOT NULL,
  message         TEXT NOT NULL,
  tool_name       TEXT,
  sent_arguments  TEXT,
  error_message   TEXT,
  created_at      TEXT NOT NULL,
  observed_at     TEXT,
  UNIQUE (issue_id, run_id, finding_digest)
);
CREATE INDEX idx_rating_issue_occurrences_issue
  ON rating_issue_occurrences(issue_id, created_at ASC);
`;

/**
 * The minimal v50-era hub slice: `hub_sessions` exactly as v47 defined it plus v49's `archived_at`
 * and v50's `tool_scope_json` (both appended by `ALTER TABLE`, so they sit LAST — which is the point:
 * migration v51's rebuild copies by NAME, and a positional copy would silently scramble them), with
 * the pre-v51 `mode` CHECK that does not admit `'auto'`. `hub_events` is the v47 body verbatim, so
 * the rebuild has a real child FK to keep valid, and the fixture seeds a parent/child session pair so
 * the self-reference is exercised too. Every other `hub_*` table is created by `schemaSql` on open.
 */
const V50_ERA_HUB_DDL = `
CREATE TABLE hub_sessions (
  id                  TEXT PRIMARY KEY,
  project_id          TEXT REFERENCES hub_projects(id) ON DELETE SET NULL,
  kind                TEXT NOT NULL CHECK (kind IN ('chat','agent')),
  parent_session_id   TEXT REFERENCES hub_sessions(id) ON DELETE CASCADE,
  mission_id          TEXT REFERENCES hub_missions(id) ON DELETE CASCADE,
  title               TEXT NOT NULL,
  title_state         TEXT NOT NULL DEFAULT 'pending' CHECK (title_state IN ('pending','auto','manual')),
  mode                TEXT NOT NULL CHECK (mode IN ('chat','research','mission')),
  topology            TEXT CHECK (topology IN ('parallel','pipeline','debate','best_of_n')),
  autonomy            TEXT CHECK (autonomy IN ('always_ask','threshold','auto')),
  crew_id             TEXT REFERENCES hub_crews(id) ON DELETE SET NULL,
  model               TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','running','completed','stopped','error','aborted','ended')),
  phase               TEXT,
  stop_reason_code    TEXT,
  capabilities_json   TEXT,
  budgets_json        TEXT,
  prompt_version      TEXT,
  cost_usd            REAL NOT NULL DEFAULT 0,
  tokens_in           INTEGER NOT NULL DEFAULT 0,
  tokens_out          INTEGER NOT NULL DEFAULT 0,
  active_duration_ms  INTEGER,
  total_duration_ms   INTEGER,
  wait_deadline_at    TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  ended_at            TEXT,
  seen                INTEGER NOT NULL DEFAULT 0
);
ALTER TABLE hub_sessions ADD COLUMN archived_at TEXT;
ALTER TABLE hub_sessions ADD COLUMN tool_scope_json TEXT;
CREATE INDEX idx_hub_sessions_project_updated ON hub_sessions(project_id, updated_at DESC);
CREATE INDEX idx_hub_sessions_kind_updated ON hub_sessions(kind, updated_at DESC);
CREATE INDEX idx_hub_sessions_parent ON hub_sessions(parent_session_id);
CREATE INDEX idx_hub_sessions_mission ON hub_sessions(mission_id);

CREATE TABLE hub_events (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES hub_sessions(id) ON DELETE CASCADE,
  seq           INTEGER NOT NULL,
  type          TEXT NOT NULL,
  payload_json  TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  UNIQUE (session_id, seq)
);
CREATE INDEX idx_hub_events_session_seq ON hub_events(session_id, seq ASC);
`;

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Seeds
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The rows every pre-versioning-lineage fixture carries. Small, but chosen so the chain has
 * something to act on at each of its data-bearing steps:
 *  - two servers, two scans (one success, one failed), tool rows and scan events;
 *  - one provider credential, one environment, two tests, one attachment;
 *  - three runs at three statuses (so v27's rating_state backfill has to make three decisions), each
 *    with steps whose `usage_actual_json` covers all THREE branches of v59's cache backfill:
 *      run-completed → steps carrying the cacheRead/cacheWrite split  (backfills to the sum)
 *      run-error     → a step carrying only merged `cachedInputTokens` (must stay NULL — unknowable)
 *      run-stopped   → a usage step that never mentions cache          (a real, knowable 0)
 */
function seedCoreRows(db: Db): void {
  db.exec(`
    INSERT INTO mcp_servers (id, name, transport, command, args_json, url, headers_json, env_json, created_at, updated_at) VALUES
      ('srv-fs',   'Filesystem', 'stdio',           'npx', '["-y","@modelcontextprotocol/server-filesystem"]', NULL, '{}', '{}', '${T0}', '${T0}'),
      ('srv-http', 'Docs',       'streamable_http', NULL,  '[]', 'https://example.invalid/mcp', '{}', '{}', '${T0}', '${T0}');

    INSERT INTO mcp_oauth_credentials (server_id, client_information_json, tokens_json, code_verifier, discovery_state_json, created_at, updated_at) VALUES
      ('srv-http', '{"client_id":"fixture-client"}', '${NOT_A_SECRET}', '${NOT_A_SECRET}', '{}', '${T0}', '${T0}');

    INSERT INTO mcp_oauth_flows (state, server_id, created_at) VALUES
      ('flow-1', 'srv-http', '${T0}');

    INSERT INTO mcp_scans (id, server_id, token_profile, scanned_at, status, total_tools, total_tokens, total_raw_bytes, average_tokens_per_tool, largest_tool_name, largest_tool_tokens) VALUES
      ('scan-ok',   'srv-fs',   'generic_o200k', '${T0}', 'success', 2, 640, 2048, 320, 'read_file', 400),
      ('scan-fail', 'srv-http', 'generic_o200k', '${T1}', 'failed',  0, 0,   0,    0,   NULL,        0);

    INSERT INTO mcp_tool_scans (id, scan_id, tool_name, description, input_schema_json, annotations_json, raw_tool_json, total_tokens, name_tokens, description_tokens, schema_tokens, annotations_tokens, raw_bytes, contribution_percent) VALUES
      ('tool-read',  'scan-ok', 'read_file',  'Read a file from disk.',  '{"type":"object"}', NULL, '{"name":"read_file"}',  400, 3, 20, 12, 0, 1200, 62.5),
      ('tool-write', 'scan-ok', 'write_file', 'Write a file to disk.',   '{"type":"object"}', NULL, '{"name":"write_file"}', 240, 3, 20, 12, 0, 848,  37.5);

    INSERT INTO scan_events (id, scan_id, level, message, created_at) VALUES
      ('ev-1', 'scan-ok',   'info',  'listed 2 tools',       '${T0}'),
      ('ev-2', 'scan-fail', 'error', 'connection refused',   '${T1}');

    INSERT INTO provider_credentials (id, kind, label, base_url, api_key_encrypted, created_at, updated_at) VALUES
      ('cred-anthropic', 'anthropic', 'Claude (fixture)', NULL, '${NOT_A_SECRET}', '${T0}', '${T0}');

    INSERT INTO scenarios (id, name, provider_id, model, params_json, system_prompt, default_profiles_json, guardrails_json, created_at, updated_at) VALUES
      ('env-base', 'Baseline', 'cred-anthropic', 'claude-sonnet-4', '{}', 'You are a fixture.', '["generic_o200k"]', '{}', '${T0}', '${T0}');

    INSERT INTO scenario_servers (scenario_id, server_id, allowed_tools_json) VALUES
      ('env-base', 'srv-fs', NULL);

    INSERT INTO tests (id, name, user_prompt, system_prompt_override, added_profiles_json, assertions_json, created_at, updated_at) VALUES
      ('test-list', 'List the files', 'List every file you can see.', NULL, '[]', NULL, '${T0}', '${T0}'),
      ('test-read', 'Read one file',  'Read README.md and summarize.', NULL, '[]', NULL, '${T0}', '${T0}');

    INSERT INTO test_attachments (id, test_id, kind, name, path, bytes, created_at) VALUES
      ('att-1', 'test-read', 'text', 'notes.txt', 'attachments/att-1', 42, '${T0}');

    INSERT INTO runs (id, test_id, scenario_id, mode, status, outcome, stop_reason, started_at, duration_ms, turns, tool_calls, peak_context_tokens, tokens_in, tokens_out, cached_tokens, cost_usd, error_message) VALUES
      ('run-completed', 'test-list', 'env-base', 'automated',   'completed', 'pass', NULL,           '${T0}', 4200, 3, 2, 8100, 7100, 900, 5000, 0.031, NULL),
      ('run-error',     'test-read', 'env-base', 'automated',   'error',     NULL,   'tool_failure', '${T1}', 1800, 1, 1, 3000, 2800, 200, 1500, 0.008, 'tool call failed'),
      ('run-stopped',   'test-list', 'env-base', 'interactive', 'stopped',   NULL,   'operator',     '${T2}', 900,  1, 0, 1200, 1100, 100, 0,    0.002, NULL);

    INSERT INTO run_steps (id, run_id, idx, type, label, status, duration_ms, server_id, tool_name, profile_tokens_json, usage_actual_json, context_snapshot_json, payload_json) VALUES
      ('step-c-0', 'run-completed', 0, 'llm_request',  'turn 1',    'ok', 700, NULL,     NULL,        '{"generic_o200k":2400}', '{"inputTokens":2400,"outputTokens":300,"cacheReadTokens":1800,"cacheWriteTokens":600}', NULL, '{}'),
      ('step-c-1', 'run-completed', 1, 'tool_call',    'read_file', 'ok', 120, 'srv-fs', 'read_file', '{"generic_o200k":80}',   NULL, NULL, '{}'),
      ('step-c-2', 'run-completed', 2, 'llm_response', 'turn 2',    'ok', 900, NULL,     NULL,        '{"generic_o200k":2600}', '{"inputTokens":2600,"outputTokens":600,"cacheReadTokens":2000,"cacheWriteTokens":600}', NULL, '{}'),
      ('step-e-0', 'run-error',     0, 'llm_request',  'turn 1',    'ok', 800, NULL,     NULL,        '{"generic_o200k":2800}', '{"inputTokens":2800,"outputTokens":200,"cachedInputTokens":1500}', NULL, '{}'),
      ('step-s-0', 'run-stopped',   0, 'llm_request',  'turn 1',    'ok', 500, NULL,     NULL,        '{"generic_o200k":1100}', '{"inputTokens":1100,"outputTokens":100}', NULL, '{}');

    INSERT INTO run_events (id, run_id, idx, type, payload_json, created_at) VALUES
      ('rev-1', 'run-completed', 0, 'status', '{"status":"running"}',   '${T0}'),
      ('rev-2', 'run-completed', 1, 'status', '{"status":"completed"}', '${T0}');
  `);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Fixture definitions
// ─────────────────────────────────────────────────────────────────────────────────────────────────

interface FixtureSpec {
  /** File name (without `.sqlite`) — the harness discovers fixtures by reading the directory. */
  readonly name: string;
  /** The `user_version` the finished file is stamped at. */
  readonly userVersion: number;
  /** One line explaining what this fixture buys, echoed into the generator's console output. */
  readonly why: string;
  readonly build: (db: Db) => void;
}

const FIXTURES: readonly FixtureSpec[] = [
  {
    name: "v00-preversioning",
    userVersion: 0,
    why: "the real historical starting point: a database from before PRAGMA user_version existed, carrying the v10-era session-trace tables v12 drops. Exercises the ENTIRE v1→latest chain against real rows.",
    build: (db) => {
      db.exec(PRE_VERSIONING_DDL);
      db.exec(SESSION_TRACE_DDL);
      seedCoreRows(db);
      db.exec(`
        INSERT INTO session_traces (id, label, source, created_at) VALUES
          ('trace-1', 'imported session', 'claude_code_jsonl', '${T0}');
        INSERT INTO session_trace_events (id, trace_id, idx, payload_json) VALUES
          ('tev-1', 'trace-1', 0, '{"type":"user"}'),
          ('tev-2', 'trace-1', 1, '{"type":"assistant"}');
      `);
    },
  },
  {
    name: "v12-pre-v13",
    userVersion: 12,
    why: "the item's own named case — a pre-v13 database. `tests` has none of the graded columns and neither `run_grades` nor `app_settings` exists yet.",
    build: (db) => {
      db.exec(PRE_VERSIONING_DDL);
      db.exec(SESSION_TRACE_DDL);
      seedCoreRows(db);
      db.exec(`
        INSERT INTO session_traces (id, label, source, created_at) VALUES
          ('trace-1', 'imported session', 'claude_code_jsonl', '${T0}');
      `);
      db.exec(AUTHORED_V1_TO_V12);
      db.exec(AUTHORED_V12_DROP_SESSION_TRACES);
      db.exec(`
        INSERT INTO run_skills (run_id, skill_id, skill_version_id, version_label, eager) VALUES
          ('run-completed', 'skill-fixture', 'skill-fixture-v1', 'v1', 0);
      `);
    },
  },
  {
    name: "v15-pre-v16",
    userVersion: 15,
    why: "the v16 double table rebuild — a git-bound collection with a member test AND a member suite, plus an old-shape (NOT NULL suite_id) suite_runs row. Also the only fixture with base-rating run_grades, so v27's rating_state backfill has to answer 'rated' as well as 'skipped'.",
    build: (db) => {
      db.exec(PRE_VERSIONING_DDL);
      seedCoreRows(db);
      db.exec(AUTHORED_V1_TO_V12);
      db.exec(AUTHORED_V13_TO_V15);
      db.exec(`
        INSERT INTO collections (id, name, repo_url, repo_path, branch, pat_encrypted, last_synced_sha, created_at, updated_at) VALUES
          ('col-git', 'Shared benchmarks', 'https://example.invalid/team/benchmarks.git', 'benchmarks', 'main', '${NOT_A_SECRET}', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '${T0}', '${T0}');

        UPDATE tests SET collection_id = 'col-git', external_key = 'ek-list' WHERE id = 'test-list';

        INSERT INTO suites (id, name, description, config_json, created_at, updated_at, collection_id, external_key) VALUES
          ('suite-nightly', 'Nightly', 'The nightly matrix', '{}', '${T0}', '${T0}', 'col-git', 'ek-nightly'),
          ('suite-local',   'Local',   NULL,                 '{}', '${T0}', '${T0}', NULL,      NULL);

        INSERT INTO suite_tests (suite_id, test_id, position) VALUES
          ('suite-nightly', 'test-list', 0),
          ('suite-nightly', 'test-read', 1);
        INSERT INTO suite_scenarios (suite_id, scenario_id) VALUES
          ('suite-nightly', 'env-base');
        INSERT INTO suite_runs (id, suite_id, status, config_snapshot_json, started_at, ended_at, aggregates_json) VALUES
          ('srun-1', 'suite-nightly', 'completed', '{}', '${T0}', '${T1}', '{"members":2}');
        UPDATE runs SET suite_run_id = 'srun-1', repetition = 1 WHERE id = 'run-completed';

        INSERT INTO run_grades (id, run_id, grader_id, kind, status, score, raw_score, method, reasoning, evidence_json, grading_version, created_at) VALUES
          ('grade-1', 'run-completed', 'answer_validation', 'llm',           'graded', 0.9, 0.9, 'judge',        'looks right', '{}', 1, '${T0}'),
          ('grade-2', 'run-completed', 'tool_hygiene',      'deterministic', 'graded', 1.0, 1.0, 'deterministic', NULL,         '{}', 1, '${T0}');

        INSERT INTO app_settings (key, value_json, updated_at) VALUES
          ('judge.default', '{"providerId":null}', '${T0}');
      `);
    },
  },
  {
    name: "v50-pre-v51",
    userVersion: 50,
    why: "migration v51's hub_sessions rebuild — the only table rebuild in the chain that copies its columns by NAME from a live intersection, with two ALTER-appended columns (v49 archived_at, v50 tool_scope_json) sitting out of baseline order, a self-referencing parent/child pair and a child event table.",
    build: (db) => {
      // The shared late-era core comes along so this looks like a real v50 database rather than a
      // hub-only stub — see the LATE-ERA note above about migration-only indexes.
      db.exec(V55_ERA_DDL);
      db.exec(V50_ERA_HUB_DDL);
      db.exec(`
        INSERT INTO hub_sessions (id, kind, title, title_state, mode, model, status, created_at, updated_at, tool_scope_json, archived_at) VALUES
          ('hs-parent', 'chat',  'Fleet review',      'manual',  'mission',  'claude-sonnet-4', 'completed', '${T0}', '${T1}', '{"servers":{"srv-fs":["read_file"]},"builtins":[]}', NULL),
          ('hs-child',  'agent', 'Researcher',        'auto',    'research', 'claude-sonnet-4', 'completed', '${T0}', '${T1}', NULL, NULL),
          ('hs-old',    'chat',  'Archived thread',   'pending', 'chat',     'claude-sonnet-4', 'ended',     '${T0}', '${T1}', NULL, '${T2}');
        UPDATE hub_sessions SET parent_session_id = 'hs-parent' WHERE id = 'hs-child';
        INSERT INTO hub_events (id, session_id, seq, type, payload_json, created_at) VALUES
          ('he-1', 'hs-parent', 0, 'user_message',      '{"text":"go"}',   '${T0}'),
          ('he-2', 'hs-parent', 1, 'assistant_message', '{"text":"done"}', '${T1}'),
          ('he-3', 'hs-child',  0, 'user_message',      '{"text":"dig"}',  '${T0}');
      `);
    },
  },
  {
    name: "v55-pre-v56",
    userVersion: 55,
    why: "the only DESTRUCTIVE migration in the chain (v56 deletes a retired-kind credential together with its environments and runs, narrows the kind CHECK and DROPs two columns) plus v57's link rewrite — neither is reachable from a pre-versioning fixture, because both act on tables and values that only exist from v23/v40 onward.",
    build: (db) => {
      db.exec(V55_ERA_DDL);
      db.exec(`
        INSERT INTO provider_credentials (id, kind, label, base_url, api_key_encrypted, mcp_server_id, created_at, updated_at) VALUES
          ('cred-keep',   'anthropic',    'Claude (fixture)', NULL, '${NOT_A_SECRET}', NULL, '${T0}', '${T0}'),
          ('cred-doomed', 'qlik_answers', 'Answers (retired)', 'https://example.invalid', '${NOT_A_SECRET}', NULL, '${T0}', '${T0}');

        INSERT INTO assistant_settings (id, fallback_provider_credential_id, updated_at) VALUES
          (1, 'cred-doomed', '${T0}');

        INSERT INTO scenarios (id, name, provider_id, model, params_json, system_prompt, default_profiles_json, guardrails_json, tool_loading_mode, answers_mode, created_at, updated_at) VALUES
          ('env-keep',   'Baseline', 'cred-keep',   'claude-sonnet-4', '{}', '', '[]', '{}', 'eager',    NULL,                  '${T0}', '${T0}'),
          ('env-doomed', 'Answers',  'cred-doomed', 'answers-default', '{}', '', '[]', '{}', 'deferred', '{"transport":"invoke"}', '${T0}', '${T0}');

        INSERT INTO tests (id, name, user_prompt, added_profiles_json, tags_json, created_at, updated_at) VALUES
          ('test-keep', 'Keep me', 'Do the thing.', '[]', '[]', '${T0}', '${T0}');

        INSERT INTO runs (id, test_id, scenario_id, mode, status, started_at, duration_ms, turns, tool_calls, peak_context_tokens, tokens_in, tokens_out, cached_tokens, cost_usd, rating_state) VALUES
          ('run-keep',   'test-keep', 'env-keep',   'automated', 'completed', '${T0}', 3000, 2, 1, 5000, 4500, 500, 2000, 0.02, 'rated'),
          ('run-doomed', 'test-keep', 'env-doomed', 'automated', 'completed', '${T1}', 2000, 1, 0, 3000, 2800, 200, 0,    0.01, 'rated');

        INSERT INTO run_steps (id, run_id, idx, type, label, status, profile_tokens_json, usage_actual_json, payload_json) VALUES
          ('rs-keep-0',   'run-keep',   0, 'llm_request', 'turn 1', 'ok', '{}', '{"inputTokens":4500,"outputTokens":500,"cacheReadTokens":3200,"cacheWriteTokens":300}', '{}'),
          ('rs-doomed-0', 'run-doomed', 0, 'llm_request', 'turn 1', 'ok', '{}', '{"inputTokens":2800,"outputTokens":200}', '{}');

        INSERT INTO notifications (id, at, severity, title, body, link_path, rule_id, run_id, read, late) VALUES
          ('note-hub',   '${T0}', 'info',     'Mission finished', 'The mission reached a terminal state.', '/assistant/s/hs-parent',                      NULL, NULL, 0, 0),
          ('note-issue', '${T1}', 'warning',  'Issue regressed',  'A fleet issue reopened.',                '/testing/observability/issues/issue-42',      NULL, NULL, 0, 0),
          ('note-ok',    '${T2}', 'critical', 'Budget tripped',   'A watch rule fired.',                    '/testing/runs/run-keep',                      NULL, 'run-keep', 0, 0);

        INSERT INTO digest_reports (id, window_kind, window_from, window_to, generated_at, late, report_json) VALUES
          ('digest-1', 'daily', '${T0}', '${T2}', '${T2}', 0, '{"issues":[{"id":"issue-42","link":"/testing/observability/issues/issue-42"}]}');
      `);
    },
  },
  {
    // The ONE fixture that is captured from the app's own code rather than authored — and it is
    // captured, not simulated: `schemaSql` + `applyMigrations` are run once here, at generation time,
    // and the result is frozen on disk. Its value is coverage the authored fixtures cannot give: it
    // carries EVERY table, so the harness's migrated-vs-fresh comparison sees a `schema.ts` change on
    // ANY table, not only on the handful an old fixture happens to contain. It is also self-renewing —
    // the moment a migration lands, this file is stamped below the new latest and becomes a free
    // pre-vNEXT fixture, while the generator emits a NEW one for the new latest.
    name: `v${LATEST_SCHEMA_VERSION}-at-capture`,
    userVersion: LATEST_SCHEMA_VERSION,
    why: "the whole schema, frozen at capture: proves applyMigrations is a strict no-op on an at-latest database today, and becomes the pre-vNEXT fixture the moment a migration lands.",
    build: (db) => {
      db.exec(schemaSql);
      applyMigrations(db);
      // `ensureLocalCollection` mints a nanoid, so it is NOT run here — a random id would destroy
      // byte-determinism. The row it would create is inserted with a fixed id instead, which makes
      // the real `ensureLocalCollection` a no-op when the harness opens this fixture.
      db.exec(`
        INSERT INTO collections (id, name, repo_url, repo_path, branch, pat_encrypted, last_synced_sha, is_default, created_at, updated_at)
          VALUES ('col-local-fixture', 'Local', NULL, NULL, NULL, NULL, NULL, 1, '${T0}', '${T0}');
      `);
      seedCoreRows(db);
      db.exec("UPDATE tests SET collection_id = 'col-local-fixture'");
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Runner
// ─────────────────────────────────────────────────────────────────────────────────────────────────

function writeFixture(spec: FixtureSpec): void {
  const file = path.join(OUT_DIR, `${spec.name}.sqlite`);
  for (const suffix of ["", "-wal", "-shm"]) {
    if (fs.existsSync(file + suffix)) fs.rmSync(file + suffix);
  }

  const db = new Database(file);
  try {
    // 512-byte pages keep a mostly-empty fixture in the low kilobytes. `journal_mode = delete` (the
    // default) is left alone deliberately: WAL would leave `-wal`/`-shm` sidecars beside a committed
    // artifact. Foreign keys stay OFF while building so seed order never matters.
    db.pragma("page_size = 512");
    db.pragma("foreign_keys = OFF");
    spec.build(db);
    // VACUUM rewrites the file with no freelist and the pinned page size, which is what makes two
    // runs of this script byte-identical.
    db.exec("VACUUM");
    db.pragma(`user_version = ${spec.userVersion}`);
  } finally {
    db.close();
  }

  const bytes = fs.readFileSync(file);
  const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  console.log(
    `  ${spec.name}.sqlite  user_version=${spec.userVersion}  ${String(bytes.length).padStart(7)} bytes  sha256:${digest}`,
  );
  console.log(`      ${spec.why}`);
}

function main(): void {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`Writing ${FIXTURES.length} upgrade fixtures to ${OUT_DIR}\n`);
  for (const spec of FIXTURES) writeFixture(spec);
  console.log(
    "\nDone. Re-run and `git status` should be clean — these files are byte-deterministic.\n" +
      "Do NOT regenerate an existing fixture to make a failing migration pass: a fixture is frozen\n" +
      "evidence of a shape that was on disk. Add a new one instead.",
  );
}

main();
