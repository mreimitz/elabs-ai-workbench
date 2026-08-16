import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { nanoid } from "nanoid";
import { config } from "../config/env.js";
import { ensureSearchBackfill, RUN_SEARCH_DDL } from "../observability/search.js";
import { buildSeedPricingRows } from "../providers/pricing.js";
import { schemaSql } from "./schema.js";

export type AppDatabase = Database.Database;

export function openDatabase(): AppDatabase {
  fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
  const db = new Database(config.databasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  // A fresh DB is created at the latest schema (every table + column) here; an existing DB is a
  // no-op for CREATE TABLE IF NOT EXISTS and is brought forward by the numbered migrations below.
  db.exec(schemaSql);
  applyMigrations(db);
  // Testing IA (WP 1.2, D-T4): guarantee the reserved default "Local" collection + adopt every
  // collection-less member. Runs on EVERY startup (fresh AND upgraded) — a fresh DB stamps
  // LATEST_SCHEMA_VERSION and skips the v16 migration, so this seed cannot live inside the migration.
  ensureLocalCollection(db);
  // Observability (WP1.3, D-OB16): one-shot, migration-adjacent full-text backfill of existing runs.
  // Marker-gated, so it runs exactly once after upgrading to v33 (a fresh DB has no runs → instant no-op).
  ensureSearchBackfill(db);
  return db;
}

/** The reserved name of the default, never-repo-bound "local home" collection (D-T4). */
// TODO: use the shared LOCAL_COLLECTION_NAME constant once WP 1.1 lands (do not import an unbuilt sibling branch).
export const LOCAL_COLLECTION_NAME = "Local";

/**
 * Testing IA (WP 1.2, D-T4) — guarantee exactly one default "Local" collection and re-home every
 * collection-less test/suite to it. Idempotent and safe to run on every startup:
 *  - creates the Local collection only if no `is_default = 1` row exists (a second startup is a no-op);
 *  - backfills `tests.collection_id IS NULL` and `suites.collection_id IS NULL` → the Local id.
 *
 * The Local collection is never repo-bound (repo columns NULL). Its undeletable / never-repo-bound
 * invariant is enforced app-level in WP 2.1 (not here — this only seeds the row + backfills members).
 */
export function ensureLocalCollection(db: AppDatabase): void {
  const seed = db.transaction(() => {
    let local = db.prepare("SELECT id FROM collections WHERE is_default = 1 LIMIT 1").get() as
      | { id: string }
      | undefined;
    if (!local) {
      const now = new Date().toISOString();
      const id = nanoid();
      db.prepare(
        `INSERT INTO collections (
           id, name, repo_url, repo_path, branch, pat_encrypted, last_synced_sha, is_default, created_at, updated_at
         ) VALUES (@id, @name, NULL, NULL, NULL, NULL, NULL, 1, @now, @now)`,
      ).run({ id, name: LOCAL_COLLECTION_NAME, now });
      local = { id };
    }
    // No member may stay collection-less: local-only tests/suites belong to Local (D-T4).
    db.prepare("UPDATE tests SET collection_id = @id WHERE collection_id IS NULL").run({
      id: local.id,
    });
    db.prepare("UPDATE suites SET collection_id = @id WHERE collection_id IS NULL").run({
      id: local.id,
    });
  });
  seed();
}

/**
 * Ordered, idempotent, `PRAGMA user_version`-gated schema migrations. Each entry's `up` is a small
 * additive/non-destructive step that is safe to re-run (column adds skip if present; the run_steps
 * rebuild self-guards on the stored DDL). The current full schema — everything in `schema.ts` plus
 * every step below, INCLUDING `mcp_scans.counting_version` — is the baseline at
 * {@link LATEST_SCHEMA_VERSION}.
 *
 * - Fresh DB: `schemaSql` already created everything at the latest shape, so every step no-ops and
 *   we simply stamp `user_version = LATEST_SCHEMA_VERSION`.
 * - Existing DB: only steps with `version > user_version` run, then the version is stamped — so an
 *   on-disk DB (from before versioning, `user_version = 0`) is brought fully forward, and a DB
 *   already at latest is skipped entirely.
 */
const MIGRATIONS: Array<{ version: number; up: (db: AppDatabase) => void }> = [
  {
    // v1 — MCP server auth metadata + OAuth-flow lifecycle columns.
    version: 1,
    up: (db) => {
      ensureColumn(
        db,
        "mcp_servers",
        "auth_type",
        "TEXT NOT NULL DEFAULT 'none' CHECK (auth_type IN ('none', 'bearer', 'api_key', 'oauth', 'custom_headers'))",
      );
      ensureColumn(db, "mcp_servers", "auth_header_name", "TEXT");
      ensureColumn(db, "mcp_oauth_flows", "completed_at", "TEXT");
      ensureColumn(db, "mcp_oauth_flows", "error_message", "TEXT");
    },
  },
  {
    // v2 — per-scenario tool-loading strategy (eager vs deferred). Existing scenarios backfill to
    // 'eager', preserving the meaning of every run made before this setting existed.
    version: 2,
    up: (db) => {
      ensureColumn(
        db,
        "scenarios",
        "tool_loading_mode",
        "TEXT NOT NULL DEFAULT 'eager' CHECK (tool_loading_mode IN ('eager', 'deferred'))",
      );
    },
  },
  {
    // v3 — resource/prompt footprint summary columns on mcp_scans (additive; existing scans → 0/NULL).
    version: 3,
    up: (db) => {
      ensureColumn(db, "mcp_scans", "total_resources", "INTEGER NOT NULL DEFAULT 0");
      ensureColumn(db, "mcp_scans", "total_resource_templates", "INTEGER NOT NULL DEFAULT 0");
      ensureColumn(db, "mcp_scans", "total_prompts", "INTEGER NOT NULL DEFAULT 0");
      ensureColumn(db, "mcp_scans", "total_resource_tokens", "INTEGER NOT NULL DEFAULT 0");
      ensureColumn(db, "mcp_scans", "total_prompt_tokens", "INTEGER NOT NULL DEFAULT 0");
      ensureColumn(db, "mcp_scans", "largest_resource_name", "TEXT");
      ensureColumn(db, "mcp_scans", "largest_resource_tokens", "INTEGER NOT NULL DEFAULT 0");
      ensureColumn(db, "mcp_scans", "largest_prompt_name", "TEXT");
      ensureColumn(db, "mcp_scans", "largest_prompt_tokens", "INTEGER NOT NULL DEFAULT 0");
    },
  },
  {
    // v4 — additive run_steps columns (WP 5.6 cumulative tokens, F2 prose/reasoning, engine turn
    // ordinal, tool-result byte size, Track E wall-clock timing). Nullable; older steps read NULL.
    version: 4,
    up: (db) => {
      ensureColumn(db, "run_steps", "cumulative_tokens", "INTEGER");
      ensureColumn(db, "run_steps", "assistant_text", "TEXT");
      ensureColumn(db, "run_steps", "reasoning_text", "TEXT");
      ensureColumn(db, "run_steps", "turn_index", "INTEGER");
      ensureColumn(db, "run_steps", "result_bytes", "INTEGER");
      ensureColumn(db, "run_steps", "started_at", "TEXT");
      ensureColumn(db, "run_steps", "ended_at", "TEXT");
    },
  },
  {
    // v5 — F6: widen the run_steps.type CHECK to admit 'user_message'. SQLite can't ALTER a CHECK in
    // place, so this is a rebuild — and it must run AFTER v4 so the rebuild copies the new columns.
    version: 5,
    up: (db) => widenRunStepsTypeCheck(db),
  },
  {
    // v6 — Skills registry additive columns (skills/version/file tables).
    version: 6,
    up: (db) => {
      ensureColumn(db, "skills", "github_last_sha", "TEXT");
      ensureColumn(db, "skill_versions", "note", "TEXT");
      ensureColumn(db, "skill_versions", "manifest_valid", "INTEGER NOT NULL DEFAULT 1");
      ensureColumn(db, "skill_versions", "manifest_errors_json", "TEXT NOT NULL DEFAULT '[]'");
      ensureColumn(db, "skill_versions", "l1_metadata_tokens", "INTEGER NOT NULL DEFAULT 0");
      ensureColumn(db, "skill_versions", "l2_body_tokens", "INTEGER NOT NULL DEFAULT 0");
      ensureColumn(db, "skill_versions", "l3_resource_tokens", "INTEGER NOT NULL DEFAULT 0");
      ensureColumn(db, "skill_versions", "total_tokens", "INTEGER NOT NULL DEFAULT 0");
      ensureColumn(db, "skill_files", "token_total", "INTEGER NOT NULL DEFAULT 0");
    },
  },
  {
    // v7 — eager toggle on a scenario's skill attachment (WP 2.3). Existing attachments default 0.
    version: 7,
    up: (db) => {
      ensureColumn(db, "scenario_skills", "eager", "INTEGER NOT NULL DEFAULT 0");
    },
  },
  {
    // v8 — token-accounting version stamp on a scan (integration baseline). Existing scans default 1.
    version: 8,
    up: (db) => {
      ensureColumn(db, "mcp_scans", "counting_version", "INTEGER NOT NULL DEFAULT 1");
    },
  },
  {
    // v9 — SkillFlow (WP 2.1) run_skills table: which skill version each run resolved. Additive; a
    // pre-existing DB (no run_skills yet) gains the empty table + its index. `CREATE … IF NOT EXISTS`
    // makes it a no-op on a fresh DB (schema.ts already created it at the latest shape). skill_id /
    // skill_version_id are denormalized (NOT FK'd) so run history survives skill deletion.
    version: 9,
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS run_skills (
          run_id           TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
          skill_id         TEXT NOT NULL,
          skill_version_id TEXT NOT NULL,
          version_label    TEXT NOT NULL DEFAULT '',
          eager            INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (run_id, skill_id)
        );
        CREATE INDEX IF NOT EXISTS idx_run_skills_version ON run_skills(skill_version_id);
      `);
    },
  },
  {
    // v10 — SkillFlow (WP 3.1) external-session ingestion originally created session_traces +
    // session_trace_events here. Those tables were REMOVED by owner decision 2026-07-03 (Trace Mode
    // sources are ONLY this app's own test runs) and are dropped by v12 below, so this step is now a
    // deliberate no-op: a fresh DB must never create the tables at all, and an existing DB that ran
    // the old v10 has its tables dropped by v12. Kept as a numbered placeholder so the migration
    // sequence stays stable.
    version: 10,
    up: () => {
      // intentionally empty — see v12.
    },
  },
  {
    // v11 — SkillFlow (WP 5.1) validation-gate assertion results on a run. Additive column: existing
    // DBs gain `runs.assertion_results_json` (NULL for every prior run — they carried no assertions);
    // a fresh DB already has it from schema.ts, so `ensureColumn` is a no-op there.
    version: 11,
    up: (db) => {
      ensureColumn(db, "runs", "assertion_results_json", "TEXT");
    },
  },
  {
    // v12 — remove the external Claude Code session-log tables (owner decision 2026-07-03: Trace Mode
    // sources are ONLY this app's own test runs; the WP 3.1 session-upload feature is removed
    // entirely). Drop the child table first (session_trace_events FK-references session_traces), then
    // the parent. `IF EXISTS` makes this a safe no-op on a fresh DB (schema.ts no longer creates them)
    // and on any DB that never reached the old v10.
    version: 12,
    up: (db) => {
      db.exec(`
        DROP TABLE IF EXISTS session_trace_events;
        DROP TABLE IF EXISTS session_traces;
      `);
    },
  },
  {
    // v13 — Benchmarks (WP 1.1): graded-tests contract. Additive `tests` columns (existing tests
    // backfill: expectations/category/difficulty NULL, tags_json '[]' → behaves exactly as before);
    // new run_grades (append-only grade history) + generic app_settings KV (WP 1.3 default judge).
    // `CREATE … IF NOT EXISTS` makes the two new tables a no-op on a fresh DB (schema.ts already made
    // them at the latest shape); on an existing DB they're created here.
    version: 13,
    up: (db) => {
      ensureColumn(db, "tests", "expectations_json", "TEXT");
      ensureColumn(db, "tests", "category", "TEXT");
      ensureColumn(db, "tests", "difficulty", "TEXT");
      ensureColumn(db, "tests", "tags_json", "TEXT NOT NULL DEFAULT '[]'");
      db.exec(`
        CREATE TABLE IF NOT EXISTS run_grades (
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
        CREATE INDEX IF NOT EXISTS idx_run_grades_run ON run_grades(run_id, created_at ASC);
        CREATE TABLE IF NOT EXISTS app_settings (
          key         TEXT PRIMARY KEY,
          value_json  TEXT NOT NULL,
          updated_at  TEXT NOT NULL
        );
      `);
    },
  },
  {
    // v14 — Benchmarks (WP 3.1): suites. New suites/suite_tests/suite_scenarios/suite_runs tables +
    // additive runs.suite_run_id (denormalized, NOT an FK — run history survives suite deletion) +
    // runs.repetition. Existing runs backfill NULL (unaffected). `CREATE … IF NOT EXISTS` makes the
    // four tables a no-op on a fresh DB (schema.ts already created them at the latest shape); on an
    // existing DB they're created here.
    version: 14,
    up: (db) => {
      ensureColumn(db, "runs", "suite_run_id", "TEXT");
      ensureColumn(db, "runs", "repetition", "INTEGER");
      db.exec(`
        CREATE TABLE IF NOT EXISTS suites (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,
          config_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS suite_tests (
          suite_id TEXT NOT NULL REFERENCES suites(id) ON DELETE CASCADE,
          test_id  TEXT NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
          position INTEGER NOT NULL,
          PRIMARY KEY (suite_id, test_id)
        );
        CREATE TABLE IF NOT EXISTS suite_scenarios (
          suite_id    TEXT NOT NULL REFERENCES suites(id) ON DELETE CASCADE,
          scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
          PRIMARY KEY (suite_id, scenario_id)
        );
        CREATE TABLE IF NOT EXISTS suite_runs (
          id TEXT PRIMARY KEY,
          suite_id TEXT NOT NULL REFERENCES suites(id) ON DELETE CASCADE,
          status TEXT NOT NULL CHECK (status IN ('pending','running','completed','capped','stopped','error')),
          config_snapshot_json TEXT NOT NULL DEFAULT '{}',
          started_at TEXT NOT NULL, ended_at TEXT,
          aggregates_json TEXT
        );
      `);
    },
  },
  {
    // v15 — Benchmarks (WP 4.1, B10/B12): collections. New `collections` table + additive
    // `tests`/`suites` `collection_id` (FK ON DELETE SET NULL → a member becomes local-only when its
    // collection is deleted) + `external_key` (cross-system identity), with a per-collection partial
    // unique index. Existing tests/suites backfill NULL (local-only, unchanged). The `collections`
    // table is created FIRST so the ADD COLUMN foreign keys reference an existing parent; `CREATE …
    // IF NOT EXISTS` / `ensureColumn` no-op on a fresh DB (schema.ts already made them at latest shape).
    // NOTE: SQLite accepts an inline `REFERENCES … ON DELETE SET NULL` on ADD COLUMN because the column
    // is nullable and defaults to NULL (the one FK restriction on ADD COLUMN).
    version: 15,
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS collections (
          id TEXT PRIMARY KEY, name TEXT NOT NULL,
          repo_url TEXT NOT NULL, repo_path TEXT NOT NULL, branch TEXT NOT NULL,
          pat_encrypted TEXT,
          last_synced_sha TEXT,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
      `);
      ensureColumn(
        db,
        "tests",
        "collection_id",
        "TEXT REFERENCES collections(id) ON DELETE SET NULL",
      );
      ensureColumn(db, "tests", "external_key", "TEXT");
      ensureColumn(
        db,
        "suites",
        "collection_id",
        "TEXT REFERENCES collections(id) ON DELETE SET NULL",
      );
      ensureColumn(db, "suites", "external_key", "TEXT");
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_tests_extkey ON tests(collection_id, external_key)
          WHERE collection_id IS NOT NULL AND external_key IS NOT NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_suites_extkey ON suites(collection_id, external_key)
          WHERE collection_id IS NOT NULL AND external_key IS NOT NULL;
      `);
    },
  },
  {
    // v16 — Testing IA (WP 1.2 · D-T4/D-T5/D-T6). Two NOT-NULL drops that SQLite cannot do with ALTER
    // COLUMN, so each is the documented 12-step table rebuild (create-new → copy → drop-old → rename):
    //   • `collections`: repo_url/repo_path/branch become nullable (a collection may be LOCAL, no repo) +
    //     add `is_default`. collections is the PARENT of tests.collection_id / suites.collection_id
    //     (ON DELETE SET NULL) — dropping the old table would fire those SET-NULLs and blank membership,
    //     so `applyMigrations` disables foreign_keys around the whole migration transaction per the
    //     12-step doc (and foreign_key_check verifies integrity before commit).
    //   • `suite_runs`: suite_id becomes nullable (ad-hoc/collection plans have no owning Suite — no
    //     auto-created Suite rows) + add `source` and `plan_json`.
    // Each rebuild SELF-GUARDS on the live column nullability, so this step is a no-op on a fresh DB
    // (schema.ts already built the target shape) and is safe to re-run. The idempotent "Local" seed +
    // member backfill is NOT here — it runs on every startup via ensureLocalCollection() (openDatabase).
    version: 16,
    up: (db) => {
      rebuildCollectionsForOptionalRepo(db);
      rebuildSuiteRunsForOptionalSuite(db);
    },
  },
  {
    // v17 — Skill IDE (WP 8.1, I9.1): per-skill server bindings. A single ADDITIVE `CREATE TABLE IF
    // NOT EXISTS` (the v13/v15 additive pattern, NOT the v16 table-rebuild): `skill_server_bindings`
    // resolves a skill's portable frontmatter `servers:` names to registered servers. `CREATE … IF
    // NOT EXISTS` no-ops on a fresh DB (schema.ts already made the table at latest shape) and creates
    // it on an existing (v16) DB. Forward-safe: no existing table/column is touched.
    version: 17,
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS skill_server_bindings (
          skill_id    TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
          server_name TEXT NOT NULL,
          server_id   TEXT REFERENCES mcp_servers(id) ON DELETE SET NULL,
          PRIMARY KEY (skill_id, server_name)
        );
      `);
    },
  },
  {
    // v18 — Skill IDE (WP 9.1, I10.3): the live-draft engine's op INTENT LOG. A single ADDITIVE
    // `intent_log_json TEXT` column on `skill_versions` (the v17 additive-column pattern, NOT a table
    // rebuild) storing the staged-op audit a content-canonical save (`POST /api/skills/:id/save-draft`)
    // attaches as version metadata — so op-level granularity survives the move to text-canonical saves.
    // `ensureColumn` no-ops on a fresh DB (schema.ts already added the column) and adds it on an
    // existing (v17) DB. Forward-safe: no existing table/column is touched.
    version: 18,
    up: (db) => {
      ensureColumn(db, "skill_versions", "intent_log_json", "TEXT");
    },
  },
  {
    // v19 — Testing UX: index runs(suite_run_id, started_at) for the suite-run member lookup. Every
    // suite-run reader (analytics, deltas, report, and the members endpoint) selects a suite run's
    // children via `WHERE suite_run_id = ? ORDER BY started_at ASC`; without this they full-scan `runs`
    // as history grows. This lives in a MIGRATION (not schema.ts) because `suite_run_id` is the v14-added
    // column — schema.ts runs before v14 on a pre-v14 upgrade, so an index on it there fails ("no such
    // column"). Ordered after v14 here, so the column always exists. `IF NOT EXISTS` no-ops on re-run and
    // on a fresh DB (which runs every migration). Forward-safe: creates an index, touches no data.
    version: 19,
    up: (db) => {
      // A real DB always has `runs` (schemaSql + v14), but a MINIMAL migration-test fixture stamped
      // between 14 and 18 may not — indexing an absent table would throw. Guard on its existence so the
      // step is a correct no-op there (nothing to index) while indexing every real DB.
      const hasRuns = db
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='runs'")
        .get();
      if (hasRuns)
        db.exec(
          "CREATE INDEX IF NOT EXISTS idx_runs_suite_run ON runs(suite_run_id, started_at ASC);",
        );
    },
  },
  {
    // v20 — Assistant (WP 0.1): the workstream's persistence foundation. Three ADDITIVE `CREATE
    // TABLE IF NOT EXISTS` tables (the v13/v15/v17 additive pattern, NOT the v16 table-rebuild):
    //   • assistant_credentials — one stored Claude OAuth token (D-AS1/D-AS2); encrypted via
    //     SecretStore, never returned by any route.
    //   • assistant_threads — one row per chat thread, optionally pinned to an app entity (D-AS15).
    //   • assistant_events — the append-only, per-thread-monotonic-`seq` replayable event log the
    //     session engine (WP 1.1) persists settled events to.
    // `CREATE … IF NOT EXISTS` no-ops on a fresh DB (schema.ts already created these tables at the
    // latest shape) and creates them on an existing (pre-v20) DB. No existing table/column is
    // touched, so this is forward-safe and requires no rebuild.
    //
    // NOTE — version-number drift: `roadmap/assistant/00-plan.md` §4 and its WP 0.1 brief were
    // written naming this migration "v19", but by the time this WP landed, v19 (Testing-UX
    // suite-run member index, above) already occupied that slot — so this is v20, and
    // `LATEST_SCHEMA_VERSION` (auto-derived below) becomes 20. The four version-literal test locks
    // that assumed 19 (`benchmarks-contract.test.ts`, `benchmarks-collections-contract.test.ts`,
    // `benchmarks-suites-contract.test.ts`, `skill-ide-server-binding.test.ts`) were updated to 20
    // in the same change that added this migration.
    version: 20,
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS assistant_credentials (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL CHECK (kind IN ('claude_oauth')),
          token_encrypted TEXT NOT NULL,
          label TEXT,
          created_at TEXT NOT NULL,
          last_used_at TEXT
        );
        CREATE TABLE IF NOT EXISTS assistant_threads (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          entity_kind TEXT,
          entity_id TEXT,
          model TEXT NOT NULL,
          auth_source TEXT NOT NULL CHECK (auth_source IN ('subscription', 'api_key')),
          sdk_session_id TEXT,
          status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'running', 'error')),
          auto_accept INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_assistant_threads_entity
          ON assistant_threads(entity_kind, entity_id, updated_at DESC);
        CREATE TABLE IF NOT EXISTS assistant_events (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL REFERENCES assistant_threads(id) ON DELETE CASCADE,
          seq INTEGER NOT NULL,
          type TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE (thread_id, seq)
        );
        CREATE INDEX IF NOT EXISTS idx_assistant_events_thread_seq ON assistant_events(thread_id, seq ASC);
      `);
    },
  },
  {
    // v21 — Assistant (WP 0.2): the single-row `assistant_settings` config table that holds the
    // API-key FALLBACK pointer (D-AS14). Additive `CREATE TABLE IF NOT EXISTS` (the v13/v15/v17/v20
    // additive pattern): it no-ops on a fresh DB (schema.ts already created it) and creates it on an
    // existing (pre-v21) DB. The single stored column is a REFERENCE to a provider_credentials row —
    // the key is never duplicated here; ON DELETE SET NULL keeps the pointer from ever dangling.
    // Bumps LATEST_SCHEMA_VERSION (auto-derived below) to 21.
    version: 21,
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS assistant_settings (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          fallback_provider_credential_id TEXT REFERENCES provider_credentials(id) ON DELETE SET NULL,
          updated_at TEXT
        );
      `);
    },
  },
  {
    // v22 — Auto-Rating (WP 4.1, AR7/AR11/AR12/AR15): the mandatory suite-run cross-run report. A single
    // ADDITIVE `CREATE TABLE IF NOT EXISTS` (the v13/v15/v17/v20/v21 additive pattern, NOT the v16
    // table-rebuild): `suite_run_reports` is append-only, latest-per-suite-run wins (mirrors run_grades).
    // It stores the serialized SuiteReport (`report_json`) + `rating_version` (AUTO_RATING_VERSION) + the
    // SEPARATE judge ledger columns (0/null on this deterministic pass; WP 4.2 fills them). FK ON DELETE
    // CASCADE ties a report to its suite_runs row. `CREATE … IF NOT EXISTS` no-ops on a fresh DB (schema.ts
    // already created it at the latest shape) and creates it on an existing (pre-v22) DB. Forward-safe: no
    // existing table/column is touched, so no rebuild. Bumps LATEST_SCHEMA_VERSION (auto-derived below) to 22.
    version: 22,
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS suite_run_reports (
          id                TEXT PRIMARY KEY,
          suite_run_id      TEXT NOT NULL REFERENCES suite_runs(id) ON DELETE CASCADE,
          status            TEXT NOT NULL CHECK (status IN ('ready','partial','error')),
          report_json       TEXT NOT NULL,
          rating_version    INTEGER NOT NULL,
          judge_provider_id TEXT,
          judge_model       TEXT,
          judge_tokens_in   INTEGER NOT NULL DEFAULT 0,
          judge_tokens_out  INTEGER NOT NULL DEFAULT 0,
          judge_cost_usd    REAL NOT NULL DEFAULT 0,
          created_at        TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_suite_run_reports_run ON suite_run_reports(suite_run_id, created_at ASC);
      `);
    },
  },
  {
    // v23 — Qlik Answers (WP 0.2, D-QA1): link a provider credential to a registered MCP server whose
    // OAuth token / auth headers it reuses, AND admit the new `qlik_answers` kind. This is NOT an
    // additive column: the `kind` CHECK must widen to include 'qlik_answers', and SQLite CANNOT ALTER a
    // CHECK constraint in place — so this is the documented 12-step TABLE REBUILD (mirrors v16's
    // `rebuildCollectionsForOptionalRepo`), not an `ensureColumn`.
    //
    // `provider_credentials` is a PARENT of BOTH `scenarios.provider_id` (ON DELETE RESTRICT) and
    // `assistant_settings.fallback_provider_credential_id` (v21, ON DELETE SET NULL). The rebuild's
    // `DROP TABLE provider_credentials` would fire those child actions (blanking the fallback pointer /
    // blocking on RESTRICT) if FK enforcement were ON — but `applyMigrations` runs the whole migration
    // with foreign_keys OFF and `foreign_key_check`s before commit, so the rebuild is safe PROVIDED it
    // preserves every row with its SAME `id` (which the copy below does), keeping every child reference
    // valid. SELF-GUARDS on the live presence of `mcp_server_id`, so it no-ops on a fresh DB (schema.ts
    // already built the target shape) and on a re-run — idempotent on a v22 DB. `provider_credentials`
    // has no indexes to recreate. Bumps LATEST_SCHEMA_VERSION (auto-derived below) to 23.
    version: 23,
    up: (db) => rebuildProviderCredentialsForServerLink(db),
  },
  {
    // v24 — Qlik Answers (WP 2.3, D-QA2 gap fix): persist the per-scenario `answersMode.transport`
    // override. WP 0.1 added the `Scenario.answersMode` type + `scenarioInputSchema` field, but no
    // column ever backed it, so it was silently dropped on save (surfaced by WP 1.2 as a gap; folded
    // into this WP). A single ADDITIVE nullable `ensureColumn` (the v2/v11/v21 pattern, NOT a table
    // rebuild — no CHECK/constraint involved): `scenarios.answers_mode TEXT` stores the JSON-serialized
    // `answersMode` object (e.g. '{"transport":"invoke"}'), NULL for every non-qlik scenario and any
    // qlik_answers scenario that never set it. `ensureColumn` no-ops on a fresh DB (schema.ts already
    // added the column) and adds it on an existing (pre-v24) DB. Forward-safe: no existing table/column
    // is touched, so no rebuild. Bumps LATEST_SCHEMA_VERSION (auto-derived below) to 24.
    //
    // A real DB always has `scenarios` (schemaSql), but a MINIMAL migration-test fixture stamped past
    // v17 (e.g. the v18 skill_versions-only fixture) may not — `ensureColumn` on an absent table would
    // throw (the v19/v23 guard pattern). Guard on its existence so the step is a correct no-op there
    // while adding the column on every real DB.
    version: 24,
    up: (db) => {
      const hasScenarios = db
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='scenarios'")
        .get();
      if (hasScenarios) ensureColumn(db, "scenarios", "answers_mode", "TEXT");
    },
  },
  {
    // v25 — Server types (roadmap/server-types, D-ST6): a first-class grouping entity for MCP
    // servers ("Qlik-SaaS" = production fleet, "qlik-stage" = beta/RC). Lifecycle status lives ON
    // the type (D-ST1); each server references at most one type. Fully ADDITIVE — a new table
    // (`CREATE TABLE IF NOT EXISTS`, no-op on a fresh DB where schema.ts already built it) plus one
    // nullable `ensureColumn` on `mcp_servers` with `REFERENCES server_types(id) ON DELETE SET
    // NULL` (SQLite allows an ADD COLUMN with a REFERENCES clause when the default is NULL, and
    // `applyMigrations` runs with foreign_keys OFF anyway). No CHECK widening → no table rebuild.
    // Guarded on `mcp_servers` presence for MINIMAL migration-test fixtures (the v24 pattern).
    // Bumps LATEST_SCHEMA_VERSION (auto-derived below) to 25.
    version: 25,
    up: (db) => {
      db.exec(`CREATE TABLE IF NOT EXISTS server_types (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE,
        status TEXT NOT NULL DEFAULT 'production' CHECK (status IN ('production', 'release_candidate', 'beta', 'deprecated')),
        description TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`);
      const hasServers = db
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='mcp_servers'")
        .get();
      if (hasServers) {
        ensureColumn(
          db,
          "mcp_servers",
          "type_id",
          "TEXT REFERENCES server_types(id) ON DELETE SET NULL",
        );
      }
    },
  },
  {
    // v26 — Rating Issues registry (Auto-Rating follow-on): DISTINCT, deduplicated, persistent issues
    // distilled from error_forensics findings against the skills / MCP servers a run used, plus their
    // per-run occurrences. Fully ADDITIVE — two `CREATE TABLE IF NOT EXISTS` tables + indexes (the
    // v13/v15/v17/v20/v21/v22/v25 additive pattern, NOT the v16 table-rebuild): no-op on a fresh DB
    // (schema.ts already built them at the latest shape), created here on an existing (pre-v26) DB.
    // target_id/target_name and run_id/suite_run_id are DENORMALIZED (not FK'd to skills/mcp_servers/
    // runs) so issue history survives target and run deletion; the occurrences UNIQUE key
    // (issue_id, run_id, finding_digest) makes reprocessing a run a strict no-op. Bumps
    // LATEST_SCHEMA_VERSION (auto-derived below) to 26.
    version: 26,
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS rating_issues (
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
          judge_model        TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_rating_issues_target ON rating_issues(target_kind, target_id, status);
        CREATE TABLE IF NOT EXISTS rating_issue_occurrences (
          id              TEXT PRIMARY KEY,
          issue_id        TEXT NOT NULL REFERENCES rating_issues(id) ON DELETE CASCADE,
          run_id          TEXT NOT NULL,
          suite_run_id    TEXT,
          finding_digest  TEXT NOT NULL,
          category        TEXT NOT NULL,
          message         TEXT NOT NULL,
          created_at      TEXT NOT NULL,
          UNIQUE (issue_id, run_id, finding_digest)
        );
        CREATE INDEX IF NOT EXISTS idx_rating_issue_occurrences_issue
          ON rating_issue_occurrences(issue_id, created_at ASC);
      `);
    },
  },
  {
    // v27 — Auto-Rating (AR11): the additive `rating_state` REVIEW axis on runs + suite_runs. A pair
    // of nullable-free `ensureColumn`s (the v2/v11/v24 additive pattern — plain TEXT NOT NULL DEFAULT
    // 'pending', no CHECK, so no table rebuild), then an honest BACKFILL so history reads correctly:
    //   • a run at a TERMINAL status ('completed','stopped','error','aborted') was reviewed iff a
    //     base-rating grade row exists (run_grades.grader_id in BASE_RATING_GRADER_IDS) → 'rated',
    //     else 'skipped' (its review never ran / predates auto-rating); non-terminal rows stay 'pending'.
    //   • a suite run at a TERMINAL status ('completed','capped','stopped','error') was reviewed iff a
    //     suite_run_reports row exists → 'rated', else 'skipped'; non-terminal rows stay 'pending'.
    // rating_state NEVER touches the status vocabularies — it is a separate, orthogonal dimension.
    // Guarded on table existence for MINIMAL migration-test fixtures (the v19/v24 pattern); the
    // EXISTS sub-selects additionally guard on run_grades/suite_run_reports presence so a fixture
    // carrying runs but not the grade tables still migrates (no grades → 'skipped').
    version: 27,
    up: (db) => {
      const hasTable = (name: string) =>
        db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name) !==
        undefined;
      if (hasTable("runs")) {
        ensureColumn(db, "runs", "rating_state", "TEXT NOT NULL DEFAULT 'pending'");
        const gradeProbe = hasTable("run_grades")
          ? `EXISTS (SELECT 1 FROM run_grades g
                      WHERE g.run_id = runs.id
                        AND g.grader_id IN ('answer_validation','insight_surplus','error_forensics'))`
          : "0";
        db.exec(`
          UPDATE runs SET rating_state = CASE
            WHEN status IN ('completed','stopped','error','aborted')
              THEN CASE WHEN ${gradeProbe} THEN 'rated' ELSE 'skipped' END
            ELSE 'pending'
          END;
        `);
      }
      if (hasTable("suite_runs")) {
        ensureColumn(db, "suite_runs", "rating_state", "TEXT NOT NULL DEFAULT 'pending'");
        const reportProbe = hasTable("suite_run_reports")
          ? `EXISTS (SELECT 1 FROM suite_run_reports r WHERE r.suite_run_id = suite_runs.id)`
          : "0";
        db.exec(`
          UPDATE suite_runs SET rating_state = CASE
            WHEN status IN ('completed','capped','stopped','error')
              THEN CASE WHEN ${reportProbe} THEN 'rated' ELSE 'skipped' END
            ELSE 'pending'
          END;
        `);
      }
    },
  },
  {
    // v28 — Claude subscription (roadmap/claude-subscription/, WP 0.2, D-CS6): widen
    // `provider_credentials.kind`'s CHECK to admit 'claude_subscription', mirroring v23's
    // qlik_answers-add-kind rebuild (SQLite cannot ALTER a CHECK in place — the canonical widening is
    // a table rebuild: create the new-shape table, copy every existing column verbatim, drop the old
    // table, rename). Unlike v23, this migration adds NO new column (mcp_server_id already exists as
    // of v23) — only the CHECK's admitted values change — so idempotency is detected by inspecting the
    // table's persisted DDL (`sqlite_master.sql`) for the new literal, the same content-based check
    // widenRunStepsTypeCheck (v5/F6) uses, rather than a column-presence probe.
    version: 28,
    up: (db) => widenProviderCredentialsKindCheck(db),
  },
  {
    // v29 — Claude subscription (roadmap/claude-subscription/, WP 3.1, D-CS4/D-CS8): persist the run's
    // cost BASIS so the Runs feed + Compare (which read `runs`-table columns via `toRunSummary`, not the
    // live `kpi` event) can mark a subscription run's shadow-priced `cost_usd` "est. · subscription".
    // A single ADDITIVE nullable `ensureColumn` (the v2/v11/v18/v24 pattern — plain TEXT, no CHECK, so
    // no table rebuild): `runs.cost_basis TEXT`, NULL for every run before this (→ absent/'api_exact',
    // the ordinary exactly-billed meaning), written at finalize from the terminal kpi for a
    // `claude_subscription` run. `ensureColumn` no-ops on a fresh DB (schema.ts already added the
    // column) and adds it on an existing (pre-v29) DB. Forward-safe: no existing table/column is
    // touched, so no rebuild. Guarded on `runs` presence for MINIMAL migration-test fixtures (the
    // v19/v24/v27 pattern). Bumps LATEST_SCHEMA_VERSION (auto-derived below) to 29.
    version: 29,
    up: (db) => {
      const hasRuns = db
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='runs'")
        .get();
      if (hasRuns) ensureColumn(db, "runs", "cost_basis", "TEXT");
    },
  },
  {
    // v30 — Rating Issues refinement: persist CONCRETE failure evidence on each occurrence so a filed
    // issue shows the ACTUAL wrong call (the failing tool, a redacted excerpt of the arguments actually
    // sent) and the EXACT error text, not just a category. Three ADDITIVE nullable `ensureColumn`s (the
    // v2/v11/v24/v29 pattern — plain TEXT, no CHECK, so no table rebuild); occurrences written before
    // v30 keep NULLs (rendered as "no captured evidence"). `ensureColumn` no-ops on a fresh DB (schema.ts
    // already carries the columns) and adds them on an existing (pre-v30) DB. Forward-safe: no existing
    // table/column is touched. Guarded on `rating_issue_occurrences` presence for MINIMAL migration-test
    // fixtures (the v19/v24/v27/v29 pattern). Bumps LATEST_SCHEMA_VERSION (auto-derived below) to 30.
    version: 30,
    up: (db) => {
      const hasTable = db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='rating_issue_occurrences'",
        )
        .get();
      if (!hasTable) return;
      ensureColumn(db, "rating_issue_occurrences", "tool_name", "TEXT");
      ensureColumn(db, "rating_issue_occurrences", "sent_arguments", "TEXT");
      ensureColumn(db, "rating_issue_occurrences", "error_message", "TEXT");
    },
  },
  {
    // v31 — Unified Sessions (roadmap/unified-sessions/, WP1.6, D-US1/D-US2): the session-lifecycle
    // persistence surface. Two things land in ONE rebuild (SQLite cannot ALTER a CHECK in place, so the
    // status-CHECK widening forces a rebuild anyway — folding the 7 new columns into the SAME rebuild
    // avoids a second full-table rewrite):
    //   • widen `runs.status`'s CHECK to admit 'ended' (D-US2's additive terminal status for an
    //     operator-closed interactive session);
    //   • add `phase` / `stop_reason_code` / `ended_at` / `seen` / `capabilities_json` /
    //     `active_duration_ms` / `total_duration_ms` — ALL nullable (`seen` defaults 0/false) so every
    //     existing run reads back exactly as before.
    // Mirrors `widenRunStepsTypeCheck` (v5/F6) EXACTLY: rename → recreate from `schemaSql` (which now
    // carries both the widened CHECK and the 7 new columns) → copy the OLD columns by name (the new
    // columns are simply absent from the INSERT's column list, so they take their DEFAULT/NULL) → drop
    // → recreate `runs`' three indexes (DROP TABLE drops them). Idempotency is CONTENT-based (the
    // v28 pattern — no single column-presence probe would cover both the CHECK widening and the
    // column adds): inspect the persisted DDL for the new CHECK literal. No-ops on a fresh DB
    // (schema.ts already built the target shape) and on a re-run.
    //
    // `runs` is the PARENT of `run_steps`/`run_events`/`run_grades`/`run_skills` (all `ON DELETE
    // CASCADE`) — the same hazard v16/v23/v28 document: dropping the old table WOULD fire those
    // cascades if foreign_keys were ON. MUST run with foreign_keys OFF (the caller's responsibility —
    // see `applyMigrations`); every existing row is copied with its SAME `id`, so every child reference
    // stays valid (verified by `foreign_key_check` before commit). Guarded on `runs` presence for
    // MINIMAL migration-test fixtures (the v19/v24/v27/v29/v30 pattern). Bumps LATEST_SCHEMA_VERSION
    // (auto-derived below) to 31.
    version: 31,
    up: (db) => widenRunsStatusCheckAndAddSessionColumns(db),
  },
  {
    // v32 — Observability metrics (WP1.2, D-OB13): covering indexes for the hot time-axis predicates of
    // the on-demand `GET /api/metrics/{runs,scans}` endpoints. INDEX-ONLY, touches NO data (the v19
    // pattern). Mirrors the three `CREATE INDEX IF NOT EXISTS` added to schema.ts's baseline so a FRESH
    // DB (stamped at LATEST, which SKIPS every migration) and an UPGRADED DB (which runs this step) both
    // carry them — the migration footgun the WP calls out. `IF NOT EXISTS` no-ops on a fresh DB and on a
    // re-run. Guarded on each table's presence for MINIMAL migration-test fixtures (the v19/v27/v29
    // pattern) — a fixture stamped below LATEST may not have created `runs`/`mcp_scans`.
    version: 32,
    up: (db) => {
      const hasTable = (name: string) =>
        db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
      if (hasTable("runs")) {
        db.exec(
          "CREATE INDEX IF NOT EXISTS idx_runs_started_at ON runs(started_at);" +
            "CREATE INDEX IF NOT EXISTS idx_runs_status_started ON runs(status, started_at);",
        );
      }
      if (hasTable("mcp_scans")) {
        db.exec("CREATE INDEX IF NOT EXISTS idx_mcp_scans_scanned_at ON mcp_scans(scanned_at);");
      }
    },
  },
  {
    // v33 — Observability full-text search (WP1.3, D-OB16): the `run_search` FTS5 index + `run_search_map`
    // docmap over run content. The DDL is DERIVED-state DDL shared verbatim with schema.ts's baseline
    // (RUN_SEARCH_DDL) so a FRESH DB (which runs schema.ts, and whose applyMigrations no-ops every step)
    // and an UPGRADED DB (which runs THIS step) both land the exact same tables — the migration footgun the
    // WP calls out. Every statement is `IF NOT EXISTS`, so it no-ops on a fresh DB / a re-run. Guarded on
    // `runs` (the docmap's FK parent) for MINIMAL migration-test fixtures stamped below LATEST that may not
    // have created it. The one-shot BACKFILL of existing runs is NOT here (a long backfill must not live in
    // the single migration transaction) — it runs migration-adjacent in openDatabase via
    // ensureSearchBackfill, gated by a marker so it happens exactly once.
    version: 33,
    up: (db) => {
      const hasRuns = db
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='runs'")
        .get();
      if (hasRuns) db.exec(RUN_SEARCH_DDL);
    },
  },
  {
    // v34 — Observability saved views (WP1.4): the `run_views` table (name + a validated RunFilter +
    // opaque columns/sort presentation hints). The DDL is IDENTICAL to schema.ts's baseline (`CREATE
    // TABLE IF NOT EXISTS`) so a FRESH DB (whose applyMigrations no-ops every step) and an UPGRADED DB
    // (which runs THIS step) both land the exact same table — the migration footgun the WP calls out.
    // No FK to any other table (a view stores a filter, never a join to runs), so no table-presence
    // guard is needed. `IF NOT EXISTS` makes this a no-op on a fresh DB / a re-run.
    version: 34,
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS run_views (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE COLLATE NOCASE,
          filter_json TEXT NOT NULL,
          columns_json TEXT,
          sort_json TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
    },
  },
  {
    // v35 — Observability retention classes (WP1.6): `runs.pinned` (a pinned run is NEVER pruned) +
    // a covering index. A single ADDITIVE `ensureColumn` (the v2/v11/v18/v24/v29 pattern — plain
    // INTEGER NOT NULL DEFAULT 0, no CHECK, so no table rebuild): every run persisted before this
    // reads back unpinned (0/false), exactly as it always has. `ensureColumn` no-ops on a fresh DB
    // (schema.ts's `CREATE TABLE IF NOT EXISTS runs` already carries the column there) and adds it on
    // an existing (pre-v35) DB. The COLUMN is declared in schema.ts's baseline, but its INDEX lives
    // ONLY here, never in schema.ts — the SAME hazard schema.ts documents for `idx_runs_suite_run`
    // (a v14-added column): `db.exec(schemaSql)` runs its `CREATE INDEX` statements unconditionally,
    // BEFORE this migration has had a chance to add the column, so an inline `CREATE INDEX ...
    // idx_runs_pinned ON runs(pinned)` in schema.ts would throw "no such column: pinned" against any
    // pre-v35 DB whose `runs` table already exists (schema.ts's `CREATE TABLE IF NOT EXISTS` is then a
    // no-op that never adds the column). Fresh DBs still get the index: `applyMigrations` runs EVERY
    // step (as idempotent no-ops) even on a fresh DB stamped at `user_version = 0`, so this step's
    // `CREATE INDEX IF NOT EXISTS` always executes — see the MIGRATIONS array doc comment above. Also
    // makes the WP1.1 `pinned` RunFilter placeholder LIVE — see `buildRunFilterWhere` in
    // run-repository.ts AND its replicated copy in observability/metrics.ts (both updated in this WP
    // to filter on the new column instead of the old "match nothing" `1 = 0` placeholder). Guarded on
    // `runs` presence for MINIMAL migration-test fixtures (the v19/v24/v27/v29/v30/v32 pattern). Bumps
    // LATEST_SCHEMA_VERSION (auto-derived below) to 35.
    version: 35,
    up: (db) => {
      const hasRuns = db
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='runs'")
        .get();
      if (hasRuns) {
        ensureColumn(db, "runs", "pinned", "INTEGER NOT NULL DEFAULT 0");
        db.exec("CREATE INDEX IF NOT EXISTS idx_runs_pinned ON runs(pinned);");
      }
    },
  },
  {
    // v36 — Observability human feedback (WP1.5, D-OB15): the `run_feedback` table (+ 2 covering
    // indexes) — a GENERIC score/note primitive on a run or one of its steps, STRICTLY SEPARATE from
    // grading (nothing in grading/suites/compare reads it — see the WP1.5 separation regression test
    // in apps/api/test/run-feedback.test.ts). The DDL is IDENTICAL to schema.ts's baseline (`CREATE
    // TABLE/INDEX IF NOT EXISTS`) so a FRESH DB (whose applyMigrations no-ops every step) and an
    // UPGRADED DB (which runs THIS step) both land the exact same shape — the migration footgun the WP
    // calls out. An index on a BRAND-NEW table is safe in both schema.ts AND here (unlike an index on a
    // migration-ADDED COLUMN — see v35's note above): the whole table (and its indexes) is new, so
    // there's no "column doesn't exist yet" ordering hazard. Also makes the WP1.1 `RunFilter.feedback`
    // placeholder LIVE — see `buildRunFilterWhere` in run-repository.ts AND its replicated copy in
    // observability/metrics.ts (both updated in this WP to EXISTS-join `run_feedback` instead of the
    // old "match nothing" `1 = 0` placeholder). Guarded on `runs`/`run_steps` presence (the table's two
    // FK parents) for MINIMAL migration-test fixtures stamped below LATEST that may not have created
    // them yet (the v19/v24/v27/v29/v30/v32/v33 pattern).
    version: 36,
    up: (db) => {
      const hasTable = (name: string) =>
        db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
      if (hasTable("runs") && hasTable("run_steps")) {
        db.exec(`
          CREATE TABLE IF NOT EXISTS run_feedback (
            id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
            step_id TEXT REFERENCES run_steps(id) ON DELETE CASCADE,
            key TEXT NOT NULL DEFAULT 'verdict',
            score REAL,
            comment TEXT,
            source TEXT NOT NULL CHECK (source IN ('human','auto')),
            created_at TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_run_feedback_run_id ON run_feedback(run_id);
          CREATE INDEX IF NOT EXISTS idx_run_feedback_run_key ON run_feedback(run_id, key);
        `);
      }
    },
  },
  {
    // v37 — Observability step hierarchy (WP3.1, D-OB17): the two additive `run_steps` columns
    // `parent_step_id` + `span_kind` (+ an index on `parent_step_id`). FORWARD-ONLY: a pre-v37 step
    // reads both back NULL and renders FLAT — NEVER backfilled. The COLUMNS are declared in schema.ts's
    // baseline (so a FRESH DB gets them via `CREATE TABLE`) AND added here via `ensureColumn` (so an
    // EXISTING pre-v37 DB, whose `CREATE TABLE IF NOT EXISTS run_steps` was a no-op, gains them). The
    // INDEX lives ONLY here, NEVER in schema.ts — `db.exec(schemaSql)` runs its `CREATE INDEX` statements
    // unconditionally BEFORE this migration, so an inline `CREATE INDEX ... ON run_steps(parent_step_id)`
    // in schema.ts would throw "no such column: parent_step_id" against any pre-v37 DB whose run_steps
    // table already exists. Fresh DBs still get the index: `applyMigrations` runs EVERY step (as
    // idempotent no-ops) even on a fresh DB stamped at user_version 0, so this step's
    // `CREATE INDEX IF NOT EXISTS` always executes (the v35 `idx_runs_pinned` precedent, exactly). Guarded
    // on `run_steps` presence for MINIMAL migration-test fixtures (the v19/v24/v27/v29/v30/v32/v33/v36
    // pattern). Bumps LATEST_SCHEMA_VERSION (auto-derived below) to 37.
    version: 37,
    up: (db) => {
      const hasRunSteps = db
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='run_steps'")
        .get();
      if (hasRunSteps) {
        ensureColumn(db, "run_steps", "parent_step_id", "TEXT");
        ensureColumn(db, "run_steps", "span_kind", "TEXT");
        db.exec(
          "CREATE INDEX IF NOT EXISTS idx_run_steps_parent_step_id ON run_steps(parent_step_id);",
        );
      }
    },
  },
  {
    // v38 — Observability watch rules (WP4.1, D-OB19/D-OB21): three BRAND-NEW tables — `watch_rules`
    // (the rule defs), `watch_rule_events` (the append-only audit log), `watch_secrets` (the ENCRYPTED
    // webhook-URL store) — plus their indexes, AND one additive `tests.draft` column (the promote_to_test
    // draft flag). The three tables' DDL is IDENTICAL to schema.ts's baseline (`CREATE TABLE/INDEX IF
    // NOT EXISTS`) so a FRESH DB (whose applyMigrations no-ops every step) and an UPGRADED DB (which runs
    // THIS step) land the exact same shape — the migration footgun the WP calls out. Indexes on BRAND-NEW
    // tables are safe in BOTH schema.ts and here (unlike an index on a migration-ADDED column — see v35's
    // note): the whole table is new, so there's no "column doesn't exist yet" ordering hazard. `tests.draft`
    // is the v2/v11/v35 additive-column pattern (INTEGER NOT NULL DEFAULT 0, no CHECK → no table rebuild):
    // every existing test reads back non-draft. Guarded on `tests` presence for MINIMAL migration-test
    // fixtures below LATEST (the v19/v24/v27/v29/v30/v32/v33/v36/v37 pattern). Bumps LATEST_SCHEMA_VERSION
    // (auto-derived below) to 38.
    version: 38,
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS watch_rules (
          id           TEXT PRIMARY KEY,
          name         TEXT NOT NULL,
          enabled      INTEGER NOT NULL DEFAULT 1,
          trigger      TEXT NOT NULL CHECK (trigger IN ('on_terminal','windowed')),
          filter_json  TEXT NOT NULL,
          sample       REAL,
          window_json  TEXT,
          actions_json TEXT NOT NULL,
          created_at   TEXT NOT NULL,
          updated_at   TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_watch_rules_enabled ON watch_rules(enabled, trigger);

        CREATE TABLE IF NOT EXISTS watch_rule_events (
          id          TEXT PRIMARY KEY,
          rule_id     TEXT NOT NULL REFERENCES watch_rules(id) ON DELETE CASCADE,
          run_id      TEXT,
          at          TEXT NOT NULL,
          action      TEXT NOT NULL,
          result_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_watch_rule_events_rule ON watch_rule_events(rule_id, at);
        CREATE INDEX IF NOT EXISTS idx_watch_rule_events_run ON watch_rule_events(run_id);

        CREATE TABLE IF NOT EXISTS watch_secrets (
          ref             TEXT PRIMARY KEY,
          rule_id         TEXT NOT NULL REFERENCES watch_rules(id) ON DELETE CASCADE,
          encrypted_value TEXT NOT NULL,
          created_at      TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_watch_secrets_rule ON watch_secrets(rule_id);
      `);
      const hasTests = db
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='tests'")
        .get();
      if (hasTests) {
        ensureColumn(db, "tests", "draft", "INTEGER NOT NULL DEFAULT 0");
      }
    },
  },
  {
    // v39 — Observability windowed watch rules (WP4.2, D-OB19): ONE additive, nullable `last_evaluated_at`
    // column on `watch_rules` — the boot-catch-up baseline (the ISO-8601 end, a grid boundary, of the most
    // recent trailing window the scheduler evaluated). The v29 `ensureColumn` additive-column pattern:
    // nullable TEXT, no DEFAULT/CHECK → no table rebuild; a pre-v39 rule reads it back NULL (never
    // backfilled — a rule that existed before the scheduler ran has no evaluation history, and NULL means
    // "evaluate only the most recent completed window on first sight", never a fabricated gap). The COLUMN
    // is ALSO declared in schema.ts's baseline (a FRESH DB gets it via CREATE TABLE, whose migration step
    // here is then a no-op via ensureColumn's existence check). Guarded on `watch_rules` presence for
    // MINIMAL migration-test fixtures below LATEST (the v19/v24/v27/v29/v30/v32/v33/v36/v37/v38 pattern).
    // The windowed CONFIG itself reuses the EXISTING `window_json` column (v38, already nullable) — no
    // column change needed there. Bumps LATEST_SCHEMA_VERSION (auto-derived below) to 39.
    version: 39,
    up: (db) => {
      const hasWatchRules = db
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='watch_rules'")
        .get();
      if (hasWatchRules) {
        ensureColumn(db, "watch_rules", "last_evaluated_at", "TEXT");
      }
    },
  },
  {
    // v40 — Observability notification center (WP4.3, D-OB19): the brand-new `notifications` table the
    // (now unblocked) `notify` watch action writes to. DDL is IDENTICAL to schema.ts's baseline (the
    // v38 pattern — a brand-new table is safe in both the baseline CREATE TABLE and this migration; no
    // "column doesn't exist yet" ordering hazard). `CREATE TABLE IF NOT EXISTS` makes this a no-op on a
    // fresh DB (already created by the baseline) and additive on an upgrade path. Bumps
    // LATEST_SCHEMA_VERSION (auto-derived below) to 40.
    version: 40,
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS notifications (
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
        CREATE INDEX IF NOT EXISTS idx_notifications_at ON notifications(at);
        CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read);
      `);
    },
  },
  {
    // v41 — Observability fleet issue aggregation (WP5.1, D-OB20): EXTEND the v26 rating-issues registry
    // with a FLEET dimension — seven additive nullable columns on `rating_issues` plus one on
    // `rating_issue_occurrences` — so recurring failures become deterministically-clustered first-class
    // issues (occurrence counts, first/last seen, affected entities, a per-day trend, an
    // open/resolved/regressed lifecycle). NO new link table: the sweep REUSES the existing v26
    // `rating_issue_occurrences` table (its UNIQUE (issue_id, run_id, finding_digest) key gives the sweep
    // idempotency for free); it only gains `observed_at` (the contributing run's terminal time, so the
    // fleet first/last-seen + trend derive from WHEN the failure happened and survive run deletion).
    //
    // Every column is the v29/v35/v37 additive-column pattern (`ensureColumn` — plain nullable, no table
    // rebuild): an ordinary per-run auto-rating issue reads them back NULL and behaves EXACTLY as before
    // (AR contracts unchanged). The COLUMNS are declared in schema.ts's baseline too (a FRESH DB gets
    // them via CREATE TABLE, and `ensureColumn` no-ops there). The `lifecycle` CHECK is safe on an
    // ALTER ADD COLUMN — existing rows get NULL, which a `CHECK (... IN (...))` treats as satisfied.
    //
    // The cluster INDEX lives ONLY here, NEVER in schema.ts — `db.exec(schemaSql)` runs its CREATE INDEX
    // statements UNCONDITIONALLY before this migration adds `cluster_key`, so an inline
    // `CREATE INDEX ... ON rating_issues(cluster_key)` in schema.ts would throw "no such column:
    // cluster_key" against any pre-v41 DB whose `rating_issues` table already exists (the SAME v35
    // idx_runs_pinned / v37 idx_run_steps_parent_step_id footgun). Fresh DBs still get the index:
    // `applyMigrations` runs EVERY step (as idempotent no-ops) even on a fresh DB stamped at
    // user_version 0, so this step's `CREATE INDEX IF NOT EXISTS` always executes. Guarded on the two
    // tables' presence for MINIMAL migration-test fixtures below LATEST (the v19…v40 pattern). Bumps
    // LATEST_SCHEMA_VERSION (auto-derived below) to 41.
    version: 41,
    up: (db) => {
      const hasTable = (name: string) =>
        db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
      if (hasTable("rating_issues")) {
        ensureColumn(db, "rating_issues", "cluster_key", "TEXT");
        ensureColumn(db, "rating_issues", "cluster_key_version", "INTEGER");
        ensureColumn(db, "rating_issues", "occurrences", "INTEGER");
        ensureColumn(db, "rating_issues", "affected_json", "TEXT");
        ensureColumn(
          db,
          "rating_issues",
          "lifecycle",
          "TEXT CHECK (lifecycle IN ('open','resolved','regressed'))",
        );
        ensureColumn(db, "rating_issues", "resolution_note", "TEXT");
        ensureColumn(db, "rating_issues", "trend_json", "TEXT");
        db.exec(
          "CREATE INDEX IF NOT EXISTS idx_rating_issues_cluster ON rating_issues(cluster_key, cluster_key_version);",
        );
      }
      if (hasTable("rating_issue_occurrences")) {
        ensureColumn(db, "rating_issue_occurrences", "observed_at", "TEXT");
      }
    },
  },
  {
    // v42 — Observability fork-from-step (WP3.3, D-OB18): two ADDITIVE nullable columns on `runs` that
    // record a DERIVED run's lineage — `derived_from_run_id` (the parent it was forked FROM) and
    // `fork_step_id` (the parent step it was forked AT; NULL = a whole-run re-launch). BOTH the v29/v35
    // additive-column pattern (`ensureColumn` — plain nullable TEXT, no DEFAULT/CHECK → no table rebuild):
    // every run persisted before this reads them back NULL and behaves EXACTLY as before (it is not a
    // derived run). The COLUMNS are declared in schema.ts's baseline too (a FRESH DB gets them via
    // CREATE TABLE, and `ensureColumn` no-ops there).
    //
    // The lineage INDEX lives ONLY here, never in schema.ts — the SAME footgun the v35 `idx_runs_pinned`
    // / v37 `idx_run_steps_parent_step_id` comments document: `db.exec(schemaSql)` runs its CREATE INDEX
    // statements UNCONDITIONALLY before this migration adds `derived_from_run_id`, so an inline
    // `CREATE INDEX ... ON runs(derived_from_run_id)` in schema.ts would throw "no such column" against any
    // pre-v42 DB whose `runs` table already exists. Fresh DBs still get the index: `applyMigrations` runs
    // EVERY step (as idempotent no-ops) even on a fresh DB stamped at user_version 0, so this
    // `CREATE INDEX IF NOT EXISTS` always executes. Makes the WP1.1 `derived` RunFilter placeholder LIVE
    // (default-exclude = `derived_from_run_id IS NULL`) — see `buildRunFilterWhere` in run-repository.ts,
    // its replica in observability/metrics.ts, and `matchesRunFilter` in shared. Guarded on `runs`
    // presence for MINIMAL migration-test fixtures below LATEST (the v19…v41 pattern). Bumps
    // LATEST_SCHEMA_VERSION (auto-derived below) to 42.
    version: 42,
    up: (db) => {
      const hasRuns = db
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='runs'")
        .get();
      if (hasRuns) {
        ensureColumn(db, "runs", "derived_from_run_id", "TEXT");
        ensureColumn(db, "runs", "fork_step_id", "TEXT");
        db.exec("CREATE INDEX IF NOT EXISTS idx_runs_derived_from ON runs(derived_from_run_id);");
      }
    },
  },
  {
    // v43 — Observability scheduled digest report (WP5.5, D-OB22): the brand-new `digest_reports`
    // table the WP4.2 scheduler's additive `onDigest` tick (+ the manual `POST /api/reports/digest/
    // generate`) writes to. DDL is IDENTICAL to schema.ts's baseline (the v40 notifications pattern —
    // a brand-new table is safe in both the baseline CREATE TABLE and this migration; no "column
    // doesn't exist yet" ordering hazard, so the indexes are declared in schema.ts too, unlike the
    // v41/v42 additive-column migrations). `CREATE TABLE IF NOT EXISTS` makes this a no-op on a fresh
    // DB (already created by the baseline) and additive on an upgrade path. Bumps
    // LATEST_SCHEMA_VERSION (auto-derived below) to 43.
    version: 43,
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS digest_reports (
          id           TEXT PRIMARY KEY,
          window_kind  TEXT NOT NULL CHECK (window_kind IN ('daily','weekly')),
          window_from  TEXT NOT NULL,
          window_to    TEXT NOT NULL,
          generated_at TEXT NOT NULL,
          late         INTEGER NOT NULL DEFAULT 0,
          report_json  TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_digest_reports_kind_window ON digest_reports(window_kind, window_to);
        CREATE INDEX IF NOT EXISTS idx_digest_reports_generated_at ON digest_reports(generated_at);
      `);
    },
  },
  {
    // v44 — Observability DB-backed model pricing (WP2.6, D-OB22): the brand-new `model_pricing`
    // table so per-model prices are editable in Settings instead of a code edit. DDL is IDENTICAL to
    // schema.ts's baseline (the v40/v43 brand-new-table pattern — safe in both the baseline CREATE
    // TABLE and this migration; no "column doesn't exist yet" ordering hazard, so the indexes live in
    // schema.ts too). The migration then SEEDS the table from the `providers/pricing.ts` code table
    // (`buildSeedPricingRows`) so a freshly migrated DB reproduces the code prices EXACTLY (seed-
    // parity, TEST-ENFORCED). `CREATE TABLE IF NOT EXISTS` + `INSERT OR IGNORE` (deterministic
    // `seed:<model>` ids) make this a safe re-run: on a FRESH DB the baseline created the empty table
    // and `applyMigrations` (which runs EVERY step even on a fresh DB stamped at user_version 0)
    // performs the one-time seed; on an UPGRADE path this creates + seeds; re-opening an at-latest DB
    // skips migrations entirely (no double-seed). MONEY INVARIANT: seeding NEVER touches `runs` /
    // `run_steps` — no recorded run cost is recomputed. Bumps LATEST_SCHEMA_VERSION (auto-derived) to 44.
    version: 44,
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS model_pricing (
          id                   TEXT PRIMARY KEY,
          provider             TEXT NOT NULL,
          model_match          TEXT NOT NULL,
          is_regex             INTEGER NOT NULL DEFAULT 0,
          input_per_mtok       REAL NOT NULL,
          output_per_mtok      REAL NOT NULL,
          cache_read_per_mtok  REAL,
          cache_write_per_mtok REAL,
          effective_from       TEXT NOT NULL,
          created_at           TEXT NOT NULL,
          source               TEXT NOT NULL CHECK (source IN ('seed','user'))
        );
        CREATE INDEX IF NOT EXISTS idx_model_pricing_match ON model_pricing(model_match);
        CREATE INDEX IF NOT EXISTS idx_model_pricing_source ON model_pricing(source);
      `);
      const insert = db.prepare(
        `INSERT OR IGNORE INTO model_pricing
           (id, provider, model_match, is_regex, input_per_mtok, output_per_mtok,
            cache_read_per_mtok, cache_write_per_mtok, effective_from, created_at, source)
         VALUES
           (@id, @provider, @model_match, @is_regex, @input_per_mtok, @output_per_mtok,
            @cache_read_per_mtok, @cache_write_per_mtok, @effective_from, @created_at, @source)`,
      );
      for (const row of buildSeedPricingRows()) insert.run(row);
    },
  },
  {
    // v45 — Observability custom chart composer (WP2.7, D-OB22): the brand-new `dashboard_charts`
    // table backing user-defined charts on the Testing dashboard (measure(s) [same-unit constraint] +
    // filter/groupBy/bucket + chart type, persisted + cloneable). DDL is IDENTICAL to schema.ts's
    // baseline (the v40/v43/v44 brand-new-table pattern — safe in both the baseline CREATE TABLE and
    // this migration; no "column doesn't exist yet" ordering hazard, so the index lives in schema.ts
    // too). `CREATE TABLE IF NOT EXISTS` makes this a no-op on a fresh DB (already created by the
    // baseline) and additive on an upgrade path. `config_json` is validated by the shared
    // `dashboardChartConfigSchema` on every write (observability/dashboard-charts.ts) — same-unit
    // multi-measure only; the composer renders ONLY what `/api/metrics/*` already returns (no
    // client-side aggregation — this migration itself holds no seed data, unlike v44's pricing seed).
    // Bumps LATEST_SCHEMA_VERSION (auto-derived below) to 45.
    version: 45,
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS dashboard_charts (
          id          TEXT PRIMARY KEY,
          name        TEXT NOT NULL,
          config_json TEXT NOT NULL,
          position    INTEGER NOT NULL,
          created_at  TEXT NOT NULL,
          updated_at  TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_dashboard_charts_position ON dashboard_charts(position);
      `);
    },
  },
  {
    // v46 — Observability review queue lite (WP4.5, D-OB22, FINAL WP of the observability workstream):
    // the brand-new `review_rubrics` table backing structured human review — a persisted, named
    // checklist of keys (each thumbs/scale5/note), walked keyboard-first over a filtered set of runs.
    // DDL is IDENTICAL to schema.ts's baseline (the v40/v43/v44/v45 brand-new-table pattern — safe in
    // both the baseline CREATE TABLE and this migration; no "column doesn't exist yet" ordering
    // hazard). `CREATE TABLE IF NOT EXISTS` makes this a no-op on a fresh DB (already created by the
    // baseline) and additive on an upgrade path. `keys_json` is validated by the shared
    // `reviewRubricInputSchema`/`reviewRubricPatchSchema` on every write
    // (observability/rubrics.ts) — a "review session" itself is deliberately EPHEMERAL config (a
    // source filter + a picked rubric); only the rubric persists. Every verdict a reviewer records is
    // written through the EXISTING WP1.5 `run_feedback` API — this migration carries no feedback data
    // and touches no other table. Bumps LATEST_SCHEMA_VERSION (auto-derived below) to 46.
    version: 46,
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS review_rubrics (
          id           TEXT PRIMARY KEY,
          name         TEXT NOT NULL UNIQUE COLLATE NOCASE,
          instructions TEXT,
          keys_json    TEXT NOT NULL,
          created_at   TEXT NOT NULL,
          updated_at   TEXT NOT NULL
        );
      `);
    },
  },
  {
    // v47 — Assistant Hub (roadmap/assistant-hub/, WP0.2, D-AH1…D-AH20): the 13 brand-new `hub_*`
    // tables backing the full-page, multi-model, multi-agent Assistant. DDL is IDENTICAL to
    // schema.ts's baseline (the v20/v40/v43/v44/v45/v46 brand-new-table pattern — safe in both the
    // baseline CREATE TABLE and this migration; no "column doesn't exist yet" ordering hazard, since
    // every hub_* table is new — none of them touch an existing table/column). `CREATE TABLE IF NOT
    // EXISTS` makes this a no-op on a fresh DB (already created by the baseline) and additive on an
    // upgrade path. See db/schema.ts's "Assistant Hub" section for the full column-by-column
    // rationale (lifecycle-column reuse from Unified Sessions D-AH3, the append-only per-session
    // `seq` on hub_events, the two forward FK references). hub/repository.ts is the only code that
    // touches these tables. Bumps LATEST_SCHEMA_VERSION (auto-derived below) to 47.
    version: 47,
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS hub_projects (
          id           TEXT PRIMARY KEY,
          name         TEXT NOT NULL,
          description  TEXT,
          instructions TEXT,
          created_at   TEXT NOT NULL,
          updated_at   TEXT NOT NULL,
          archived_at  TEXT
        );

        CREATE TABLE IF NOT EXISTS hub_agents (
          id                TEXT PRIMARY KEY,
          name              TEXT NOT NULL,
          description       TEXT,
          icon              TEXT,
          system_prompt     TEXT NOT NULL,
          default_model     TEXT NOT NULL,
          tool_grants_json  TEXT NOT NULL DEFAULT '{"servers":{},"builtins":[]}',
          skill_ids_json    TEXT NOT NULL DEFAULT '[]',
          target            TEXT NOT NULL,
          expected_outcome  TEXT NOT NULL,
          budgets_json      TEXT,
          created_at        TEXT NOT NULL,
          updated_at        TEXT NOT NULL,
          archived_at       TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_hub_agents_archived ON hub_agents(archived_at);

        CREATE TABLE IF NOT EXISTS hub_crews (
          id           TEXT PRIMARY KEY,
          name         TEXT NOT NULL,
          description  TEXT,
          topology     TEXT NOT NULL CHECK (topology IN ('parallel','pipeline','debate','best_of_n')),
          members_json TEXT NOT NULL DEFAULT '[]',
          created_at   TEXT NOT NULL,
          updated_at   TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS hub_sessions (
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
        CREATE INDEX IF NOT EXISTS idx_hub_sessions_project_updated ON hub_sessions(project_id, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_hub_sessions_kind_updated ON hub_sessions(kind, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_hub_sessions_parent ON hub_sessions(parent_session_id);
        CREATE INDEX IF NOT EXISTS idx_hub_sessions_mission ON hub_sessions(mission_id);

        CREATE TABLE IF NOT EXISTS hub_missions (
          id                       TEXT PRIMARY KEY,
          session_id               TEXT NOT NULL REFERENCES hub_sessions(id) ON DELETE CASCADE,
          status                   TEXT NOT NULL DEFAULT 'proposed'
                                    CHECK (status IN ('proposed','approved','running','synthesizing','completed','stopped','failed')),
          topology                 TEXT NOT NULL CHECK (topology IN ('parallel','pipeline','debate','best_of_n')),
          autonomy                 TEXT NOT NULL CHECK (autonomy IN ('always_ask','threshold','auto')),
          plan_json                TEXT NOT NULL,
          budgets_json             TEXT,
          cost_usd                 REAL NOT NULL DEFAULT 0,
          agent_session_ids_json   TEXT NOT NULL DEFAULT '[]',
          started_at               TEXT,
          ended_at                 TEXT,
          created_at               TEXT NOT NULL,
          updated_at               TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_hub_missions_session ON hub_missions(session_id);

        CREATE TABLE IF NOT EXISTS hub_events (
          id            TEXT PRIMARY KEY,
          session_id    TEXT NOT NULL REFERENCES hub_sessions(id) ON DELETE CASCADE,
          seq           INTEGER NOT NULL,
          type          TEXT NOT NULL,
          payload_json  TEXT NOT NULL,
          created_at    TEXT NOT NULL,
          UNIQUE (session_id, seq)
        );
        CREATE INDEX IF NOT EXISTS idx_hub_events_session_seq ON hub_events(session_id, seq ASC);

        CREATE TABLE IF NOT EXISTS hub_artifacts (
          id                  TEXT PRIMARY KEY,
          session_id          TEXT REFERENCES hub_sessions(id) ON DELETE SET NULL,
          project_id          TEXT REFERENCES hub_projects(id) ON DELETE SET NULL,
          kind                TEXT NOT NULL CHECK (kind IN ('markdown','code','html','table','json')),
          title               TEXT NOT NULL,
          latest_version      INTEGER NOT NULL DEFAULT 0,
          current_version_id  TEXT REFERENCES hub_artifact_versions(id) ON DELETE SET NULL,
          created_at          TEXT NOT NULL,
          updated_at          TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_hub_artifacts_session ON hub_artifacts(session_id);
        CREATE INDEX IF NOT EXISTS idx_hub_artifacts_project ON hub_artifacts(project_id);

        CREATE TABLE IF NOT EXISTS hub_artifact_versions (
          id           TEXT PRIMARY KEY,
          artifact_id  TEXT NOT NULL REFERENCES hub_artifacts(id) ON DELETE CASCADE,
          version      INTEGER NOT NULL,
          content      TEXT NOT NULL,
          note         TEXT,
          author_kind  TEXT NOT NULL CHECK (author_kind IN ('user','assistant','agent','system')),
          author_ref   TEXT,
          created_at   TEXT NOT NULL,
          UNIQUE (artifact_id, version)
        );
        CREATE INDEX IF NOT EXISTS idx_hub_artifact_versions_artifact ON hub_artifact_versions(artifact_id, version ASC);

        CREATE TABLE IF NOT EXISTS hub_reviews (
          id             TEXT PRIMARY KEY,
          artifact_id    TEXT NOT NULL REFERENCES hub_artifacts(id) ON DELETE CASCADE,
          base_version   INTEGER NOT NULL,
          status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','cancelled')),
          reviewer_kind  TEXT NOT NULL CHECK (reviewer_kind IN ('user','assistant','agent','system')),
          reviewer_ref   TEXT,
          comments_json  TEXT NOT NULL DEFAULT '[]',
          created_at     TEXT NOT NULL,
          updated_at     TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_hub_reviews_artifact ON hub_reviews(artifact_id, created_at ASC);

        CREATE TABLE IF NOT EXISTS hub_files (
          id          TEXT PRIMARY KEY,
          sha256      TEXT NOT NULL,
          mime        TEXT NOT NULL,
          bytes       INTEGER NOT NULL,
          filename    TEXT,
          content     BLOB NOT NULL,
          created_at  TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_hub_files_sha256 ON hub_files(sha256);

        CREATE TABLE IF NOT EXISTS hub_file_links (
          id           TEXT PRIMARY KEY,
          file_id      TEXT NOT NULL REFERENCES hub_files(id) ON DELETE CASCADE,
          role         TEXT NOT NULL CHECK (role IN ('upload','pinned','produced')),
          target_kind  TEXT NOT NULL CHECK (target_kind IN ('project','session','message','artifact')),
          target_id    TEXT NOT NULL,
          created_at   TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_hub_file_links_file ON hub_file_links(file_id);
        CREATE INDEX IF NOT EXISTS idx_hub_file_links_target ON hub_file_links(target_kind, target_id);

        CREATE TABLE IF NOT EXISTS hub_memory (
          id          TEXT PRIMARY KEY,
          kind        TEXT NOT NULL CHECK (kind IN ('profile','preference','instruction')),
          content     TEXT NOT NULL,
          source      TEXT NOT NULL CHECK (source IN ('user','assistant_proposed')),
          status      TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','active','archived')),
          created_at  TEXT NOT NULL,
          updated_at  TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_hub_memory_status ON hub_memory(status);

        CREATE TABLE IF NOT EXISTS hub_session_summaries (
          id          TEXT PRIMARY KEY,
          session_id  TEXT NOT NULL REFERENCES hub_sessions(id) ON DELETE CASCADE,
          upto_seq    INTEGER NOT NULL,
          content     TEXT NOT NULL,
          tokens      INTEGER NOT NULL DEFAULT 0,
          created_at  TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_hub_session_summaries_session ON hub_session_summaries(session_id, upto_seq DESC);
      `);
    },
  },
  {
    // v48 — Assistant Hub skills (WP2.4, R-SK1…R-SK3/R-SK8): the brand-new `hub_session_skills` table
    // backing SESSION-level skill attachment (mirrors `scenario_skills`, plus `invocation_mode` —
    // R-SK3's model_invocable/user_only/name_only). DDL is IDENTICAL to schema.ts's baseline (the
    // v40/…/v47 brand-new-table pattern — safe in both the baseline CREATE TABLE and this migration; no
    // "column doesn't exist yet" ordering hazard, since the table is new and its FK targets
    // (hub_sessions, skills, skill_versions) already exist by v47/the original baseline).
    // `CREATE TABLE IF NOT EXISTS` makes this a no-op on a fresh DB (already created by the baseline)
    // and additive on an upgrade path. Role-level attachment (`hub_agents.skill_ids_json`) needed NO
    // migration — it upgrades the JSON blob's CONTENT shape (plain string[] → HubSkillAttachment[]) in
    // an existing TEXT column with a single reader/writer (`hub/repository.ts`); a role created before
    // this WP simply reads back `skills: []` (the historical `[]` default parses unchanged).
    // Bumps LATEST_SCHEMA_VERSION (auto-derived below) to 48.
    version: 48,
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS hub_session_skills (
          session_id        TEXT NOT NULL REFERENCES hub_sessions(id) ON DELETE CASCADE,
          skill_id          TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
          version_mode      TEXT NOT NULL DEFAULT 'latest' CHECK (version_mode IN ('latest','pinned')),
          pinned_version_id TEXT REFERENCES skill_versions(id) ON DELETE CASCADE,
          invocation_mode   TEXT NOT NULL DEFAULT 'model_invocable'
                             CHECK (invocation_mode IN ('model_invocable','user_only','name_only')),
          PRIMARY KEY (session_id, skill_id)
        );
        CREATE INDEX IF NOT EXISTS idx_hub_session_skills_skill ON hub_session_skills(skill_id);
      `);
    },
  },
  {
    // v49 — Assistant Hub UX (roadmap/assistant-hub-ux/, WP1.0s, D-HUX4/D-HUX8/D-HUX11, P2/P4): the
    // Wave-1 DB schema substrate. Lands ALL of Wave 1's additive `hub_*` columns in ONE migration so the
    // parallel API WPs (memory scopes, agent/crew identity, session archive) never touch `db/` and never
    // collide on a migration version. Four plain ADDITIVE `ensureColumn`s (the v2/v11/v18/v24/v29/v35
    // pattern — nullable or DEFAULT-backed, no CHECK on the ALTER itself, since SQLite's ADD COLUMN
    // can't cleanly carry one; the admitted-values CHECKs live ONLY in schema.ts's baseline for a fresh
    // DB — see hub_memory/hub_crews there):
    //   • hub_memory.scope TEXT NOT NULL DEFAULT 'profile' — every existing memory row reads back
    //     'profile' via the DEFAULT (D-HUX11: "existing rows → profile"), exactly the pre-scope meaning.
    //   • hub_memory.scope_id TEXT — the owning project/agent/crew id for a scoped entry; NULL (absent)
    //     for every existing row, matching `profile` (global) scope.
    //   • hub_agents.display_name TEXT — an optional persona name; NULL for every existing role, which
    //     keeps falling back to `name` (the role title), exactly as before this WP (D-HUX8/P2 — the
    //     avatar itself reuses the EXISTING `icon` column; no avatar column is added here).
    //   • hub_crews.color TEXT — the optional `--chart-1…5` accent; NULL for every existing crew (no
    //     explicit accent), rendered only as a small name-paired accent, never a fill (D-HUX8).
    //   • hub_sessions.archived_at TEXT — mirrors `hub_agents.archived_at`; NULL for every existing
    //     session (not archived). The API projects `archived = archived_at IS NOT NULL` (P4 — archive
    //     only, no hard delete this workstream).
    // `ensureColumn` no-ops on a fresh DB (schema.ts's baseline already carries all four columns) and
    // adds them on an existing (pre-v49) DB. Forward-safe: no existing table/column is touched, so no
    // rebuild. Every `hub_*` table is guarded on its own presence for MINIMAL migration-test fixtures
    // (the v19/v24/v27/v29/v30/v32/v35 pattern) — a fixture stamped below v47 may not have created them
    // yet. Wire is UNCHANGED here (frozen at WP0.1's additive `HubMemory.scope`/`scopeId`,
    // `HubAgentRole.displayName`, `HubCrew.color`, `HubSession.archived` — this WP is DB-only). Bumps
    // LATEST_SCHEMA_VERSION (auto-derived below) to 49.
    version: 49,
    up: (db) => {
      const hasTable = (name: string) =>
        db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name) !==
        undefined;
      if (hasTable("hub_memory")) {
        ensureColumn(db, "hub_memory", "scope", "TEXT NOT NULL DEFAULT 'profile'");
        ensureColumn(db, "hub_memory", "scope_id", "TEXT");
      }
      if (hasTable("hub_agents")) {
        ensureColumn(db, "hub_agents", "display_name", "TEXT");
      }
      if (hasTable("hub_crews")) {
        ensureColumn(db, "hub_crews", "color", "TEXT");
      }
      if (hasTable("hub_sessions")) {
        ensureColumn(db, "hub_sessions", "archived_at", "TEXT");
      }
    },
  },
  {
    // v50 — Assistant Hub end-user UX pass: session-level MCP tool SCOPE. One additive `ensureColumn`
    // (the v2/v11/v18/v24/v29/v35/v49 pattern — nullable, no CHECK on the ALTER). `tool_scope_json`
    // holds a HubToolGrants blob; NULL ⇒ "auto" (every reachable scanned server granted + tool_search,
    // the pre-existing default), so every pre-v50 session reads back as auto with no behavior change.
    // Set (once, at create) ⇒ resolveHubMcpGrants narrows to the listed servers/tools. Skills scope
    // needs no column — it rides the existing `hub_session_skills` table (no attachments ⇒ full
    // registry offered for prompt-driven pick; attachments ⇒ that set only). Guarded on the table's
    // presence for minimal migration-test fixtures (a fixture stamped below v47 lacks hub_sessions).
    // Bumps LATEST_SCHEMA_VERSION (auto-derived below) to 50.
    version: 50,
    up: (db) => {
      const hasTable = (name: string) =>
        db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name) !==
        undefined;
      if (hasTable("hub_sessions")) {
        ensureColumn(db, "hub_sessions", "tool_scope_json", "TEXT");
      }
    },
  },
  {
    // v51 — Assistant Hub hub-fixes WP6.1 (RC7): widen `hub_sessions.mode`'s CHECK to admit `auto` (the
    // per-message chat-vs-mission router). A CHECK can't be altered in place → the 12-step table rebuild
    // (`rebuildHubSessionsForAutoMode`, self-guarded + FK-safe under `applyMigrations`'s foreign_keys=OFF
    // window). Purely permissive: every pre-v51 session's mode is unchanged and still valid, so replay is
    // untouched; only NEW `auto` sessions become insertable. Bumps LATEST_SCHEMA_VERSION (auto-derived
    // below) to 51.
    version: 51,
    up: (db) => rebuildHubSessionsForAutoMode(db),
  },
  {
    // v52 — Assistant Hub end-user UX pass: add `hub_sessions.roster_json`, the session's Agents & Crews
    // ROSTER (a HubSessionRoster {crewIds,agentIds} blob). NULL/absent ⇒ none. A preferred pool fed to
    // the mission planner (it prefers + hydrates these saved roles, may still expand). Additive nullable
    // column — every pre-v52 session gets NULL, replay untouched. Guarded on the table's presence for
    // minimal migration-test fixtures. Bumps LATEST_SCHEMA_VERSION (auto-derived below) to 52.
    version: 52,
    up: (db) => {
      const hasTable = (name: string) =>
        db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name) !==
        undefined;
      if (hasTable("hub_sessions")) {
        ensureColumn(db, "hub_sessions", "roster_json", "TEXT");
      }
    },
  },
  {
    // v53 — real avatar icons for agents & crews (owner request). Agents already have `hub_agents.icon`
    // (nullable TEXT), so only crews need a column. One additive `ensureColumn` (the v50/v52 pattern —
    // nullable, no CHECK on the ALTER); NULL/absent ⇒ no explicit icon (the member-strip / Persona
    // fallback), so every pre-v53 crew reads back unchanged. Guarded on the table's presence for
    // minimal migration-test fixtures. Bumps LATEST_SCHEMA_VERSION (auto-derived below) to 53.
    version: 53,
    up: (db) => {
      const hasTable = (name: string) =>
        db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name) !==
        undefined;
      if (hasTable("hub_crews")) {
        ensureColumn(db, "hub_crews", "icon", "TEXT");
      }
    },
  },
  {
    // v54 — crew-nesting (D-CN6): give `hub_missions` its runtime-recursive-tree lineage. Three
    // additive columns — `parent_mission_id` (self-FK, ON DELETE CASCADE — deletes a subtree without
    // touching siblings), `depth` (INTEGER NOT NULL DEFAULT 0 — distance from the root), and
    // `root_mission_id` (denormalised whole-tree key; a root self-references its own id) for an O(1)
    // getMissionTree rollup. Follows the v50/v52/v53 additive pattern: nullable/defaulted so every
    // pre-v54 mission reads back with parent NULL / depth 0 / root NULL and replay is untouched. An
    // `ADD COLUMN` cannot carry a CHECK (none needed here — the CHECK-in-baseline-only discipline), and
    // SQLite permits a self-referential FK column on ALTER provided its default is NULL (it is) and a
    // NOT NULL column provided a non-NULL default is given (DEFAULT 0). applyMigrations runs under
    // foreign_keys = OFF, so existing rows get NULL parent and pass the pre-commit foreign_key_check.
    // Guarded on the table's presence for minimal migration-test fixtures (a fixture stamped below v47
    // lacks hub_missions). Bumps LATEST_SCHEMA_VERSION (auto-derived below) to 54.
    version: 54,
    up: (db) => {
      const hasTable = (name: string) =>
        db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name) !==
        undefined;
      if (hasTable("hub_missions")) {
        ensureColumn(
          db,
          "hub_missions",
          "parent_mission_id",
          "TEXT REFERENCES hub_missions(id) ON DELETE CASCADE",
        );
        ensureColumn(db, "hub_missions", "depth", "INTEGER NOT NULL DEFAULT 0");
        ensureColumn(db, "hub_missions", "root_mission_id", "TEXT");
      }
    },
  },
  {
    // v55 — model identity (D-MI1, `roadmap/model-identity/`): pin WHICH provider credential runs a hub
    // session / a saved agent, instead of re-guessing the provider from the model NAME. A model id does
    // NOT identify a provider — the signed-in Claude subscription deliberately reports Anthropic's
    // CANONICAL ids (`providers/subscription-models.ts`, so `resolvePrice`/MODEL_CONTEXT_LIMITS exact-key
    // lookups keep working), so `claude-sonnet-5` names BOTH an `anthropic` API model and a
    // `claude_subscription` one; `inferHubModelKind`'s return type structurally EXCLUDES
    // `claude_subscription`, so an "Anthropic CLI" session silently ran on the metered API key and failed
    // with "your credit balance is too low". Two additive nullable columns, the v50/v52/v53 pattern:
    // NULL on every pre-v55 row ⇒ the unchanged name-heuristic fallback ⇒ replay is untouched, and there
    // is deliberately NO backfill (a guess written into the DB would be indistinguishable from a real
    // pin). `ON DELETE SET NULL` — NOT the Testing feature's RESTRICT: `hub_sessions` is a historical
    // REPLAY table, so RESTRICT would make a credential permanently undeletable once any session had used
    // it; SET NULL degrades that session to the legacy heuristic path instead. An `ADD COLUMN` may carry
    // a REFERENCES clause provided the default is NULL (it is), and applyMigrations runs under
    // foreign_keys = OFF, so existing rows get NULL and pass the pre-commit foreign_key_check. Guarded on
    // each table's presence for minimal migration-test fixtures (a fixture stamped below v47 lacks both).
    // Bumps LATEST_SCHEMA_VERSION (auto-derived below) to 55.
    version: 55,
    up: (db) => {
      const hasTable = (name: string) =>
        db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name) !==
        undefined;
      const reference = "TEXT REFERENCES provider_credentials(id) ON DELETE SET NULL";
      if (hasTable("hub_sessions")) {
        ensureColumn(db, "hub_sessions", "provider_credential_id", reference);
      }
      if (hasTable("hub_agents")) {
        ensureColumn(db, "hub_agents", "provider_credential_id", reference);
      }
    },
  },
];

/** The baseline schema version: the current full schema (schema.ts + every migration step above). */
export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;

/**
 * Apply every migration newer than the DB's `user_version`, in one transaction, then stamp the
 * version. Idempotent and non-destructive: safe to call on a fresh DB (all steps no-op), a
 * pre-versioning DB (`user_version = 0` → all steps run once), or an up-to-date DB (skipped).
 *
 * Foreign keys are DISABLED around the migration transaction (restored afterwards). This is required
 * by the SQLite 12-step table-rebuild procedure (used by v16 to make `collections`/`suite_runs`
 * columns nullable): `collections` is a PARENT table, so DROPping the old copy with FK enforcement ON
 * would fire its children's `ON DELETE SET NULL` and silently blank membership. `PRAGMA foreign_keys`
 * is a no-op inside a transaction, so the toggle must happen out here; `foreign_key_check` inside the
 * transaction then verifies no rebuild left a dangling reference before we commit.
 */
export function applyMigrations(db: AppDatabase): void {
  const current = db.pragma("user_version", { simple: true }) as number;
  if (current >= LATEST_SCHEMA_VERSION) return;
  const foreignKeysWereOn = (db.pragma("foreign_keys", { simple: true }) as number) === 1;
  if (foreignKeysWereOn) db.pragma("foreign_keys = OFF");
  try {
    const run = db.transaction(() => {
      for (const migration of MIGRATIONS) {
        if (migration.version > current) migration.up(db);
      }
      // 12-step procedure step 10 — catch any rebuild that left a dangling FK before committing.
      const violations = db.pragma("foreign_key_check") as unknown[];
      if (violations.length > 0) {
        throw new Error(
          `Migration left ${violations.length} foreign-key violation(s): ${JSON.stringify(violations)}`,
        );
      }
      db.pragma(`user_version = ${LATEST_SCHEMA_VERSION}`);
    });
    run();
  } finally {
    if (foreignKeysWereOn) db.pragma("foreign_keys = ON");
  }
}

/**
 * v16 (D-T4) — make `collections.repo_url/repo_path/branch` nullable + add `is_default`, via the
 * SQLite 12-step rebuild. SELF-GUARDS on `repo_url`'s live nullability so it no-ops on a fresh DB (or a
 * re-run) where the table is already at the target shape. MUST run with foreign_keys OFF (the caller's
 * responsibility — see {@link applyMigrations}): `collections` is the parent of tests/suites
 * `collection_id`, so the DROP below would otherwise fire their `ON DELETE SET NULL` and blank
 * membership. There are no indexes on `collections` to recreate.
 */
function rebuildCollectionsForOptionalRepo(db: AppDatabase): void {
  const repoUrl = (
    db.prepare("PRAGMA table_info(collections)").all() as Array<{ name: string; notnull: number }>
  ).find((c) => c.name === "repo_url");
  if (!repoUrl || repoUrl.notnull === 0) return; // absent (defensive) or already nullable → no-op

  db.exec(`
    CREATE TABLE collections_new (
      id TEXT PRIMARY KEY, name TEXT NOT NULL,
      repo_url TEXT, repo_path TEXT, branch TEXT,
      pat_encrypted TEXT,
      last_synced_sha TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    INSERT INTO collections_new (id, name, repo_url, repo_path, branch, pat_encrypted, last_synced_sha, created_at, updated_at)
      SELECT id, name, repo_url, repo_path, branch, pat_encrypted, last_synced_sha, created_at, updated_at FROM collections;
    DROP TABLE collections;
    ALTER TABLE collections_new RENAME TO collections;
  `);
}

/**
 * v16 (D-T5) — make `suite_runs.suite_id` nullable (ad-hoc/collection plans have no owning Suite) + add
 * `source` and `plan_json`, via the SQLite 12-step rebuild. SELF-GUARDS on `suite_id`'s live nullability
 * (no-op on a fresh DB / re-run). `suite_runs` is a CHILD of `suites` (kept ON DELETE CASCADE, now
 * nullable); nothing FK-references `suite_runs` (runs.suite_run_id is denormalized), and it has no
 * indexes to recreate.
 */
function rebuildSuiteRunsForOptionalSuite(db: AppDatabase): void {
  const suiteId = (
    db.prepare("PRAGMA table_info(suite_runs)").all() as Array<{ name: string; notnull: number }>
  ).find((c) => c.name === "suite_id");
  if (!suiteId || suiteId.notnull === 0) return; // absent (defensive) or already nullable → no-op

  db.exec(`
    CREATE TABLE suite_runs_new (
      id TEXT PRIMARY KEY,
      suite_id TEXT REFERENCES suites(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN ('pending','running','completed','capped','stopped','error')),
      config_snapshot_json TEXT NOT NULL DEFAULT '{}',
      started_at TEXT NOT NULL, ended_at TEXT,
      aggregates_json TEXT,
      source TEXT,
      plan_json TEXT
    );
    INSERT INTO suite_runs_new (id, suite_id, status, config_snapshot_json, started_at, ended_at, aggregates_json)
      SELECT id, suite_id, status, config_snapshot_json, started_at, ended_at, aggregates_json FROM suite_runs;
    DROP TABLE suite_runs;
    ALTER TABLE suite_runs_new RENAME TO suite_runs;
  `);
}

/**
 * v23 (D-QA1) — widen `provider_credentials.kind` to admit `'qlik_answers'` + add the nullable
 * `mcp_server_id TEXT REFERENCES mcp_servers(id) ON DELETE SET NULL` link column, via the SQLite
 * 12-step rebuild (SQLite cannot ALTER a CHECK constraint in place). SELF-GUARDS on the live presence
 * of `mcp_server_id` so it no-ops on a fresh DB (schema.ts already built the target shape) and on a
 * re-run. MUST run with foreign_keys OFF (the caller's responsibility — see {@link applyMigrations}):
 * `provider_credentials` is the parent of `scenarios.provider_id` (ON DELETE RESTRICT) and
 * `assistant_settings.fallback_provider_credential_id` (ON DELETE SET NULL), so the DROP below would
 * otherwise fire those actions. Every existing row is copied with its SAME `id`, so both child
 * references stay valid (verified by `foreign_key_check` before commit). There are no indexes on
 * `provider_credentials` to recreate.
 */
function rebuildProviderCredentialsForServerLink(db: AppDatabase): void {
  // A real DB always has `provider_credentials` (schemaSql), but a MINIMAL migration-test fixture stamped
  // between 17 and 22 may not — rebuilding an absent table would throw. Guard on its existence so the step
  // is a correct no-op there (nothing to rebuild) while rebuilding every real DB.
  const hasTable = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='provider_credentials'")
    .get();
  if (!hasTable) return;

  const hasLink = (
    db.prepare("PRAGMA table_info(provider_credentials)").all() as Array<{ name: string }>
  ).some((c) => c.name === "mcp_server_id");
  if (hasLink) return; // already at the target shape (fresh DB / re-run) → no-op

  db.exec(`
    CREATE TABLE provider_credentials_new (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('anthropic','openai','google','openai_compatible','ollama','qlik_answers')),
      label TEXT NOT NULL,
      base_url TEXT,
      api_key_encrypted TEXT,
      mcp_server_id TEXT REFERENCES mcp_servers(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO provider_credentials_new (id, kind, label, base_url, api_key_encrypted, created_at, updated_at)
      SELECT id, kind, label, base_url, api_key_encrypted, created_at, updated_at FROM provider_credentials;
    DROP TABLE provider_credentials;
    ALTER TABLE provider_credentials_new RENAME TO provider_credentials;
  `);
}

/**
 * v51 (Assistant Hub hub-fixes WP6.1, RC7) — widen `hub_sessions.mode`'s CHECK to admit `auto` (the new
 * per-message chat-vs-mission router). A CHECK constraint can't be altered in place, so this is the SQLite
 * 12-step table rebuild (create-new → copy → drop-old → rename), like `rebuildProviderCredentialsForServerLink`.
 * `hub_sessions` SELF-references (`parent_session_id`) and is referenced by children (agent sessions,
 * `hub_missions`, `hub_events`); the rebuild is safe because `applyMigrations` runs with `foreign_keys=OFF`
 * and a `foreign_key_check` gates the commit, and every id is preserved (rows copied verbatim), so no FK
 * — self or child — is left dangling. Self-guarded on the live DDL so it's a no-op on a fresh DB (whose
 * schema.ts already permits `auto`) or a re-run, and on a minimal migration-test fixture with no
 * `hub_sessions` table. Column copy is EXPLICIT + intersection-based, so an ALTER-appended column order
 * (v49 `archived_at`, v50 `tool_scope_json`) copies correctly by NAME rather than position.
 */
function rebuildHubSessionsForAutoMode(db: AppDatabase): void {
  const meta = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='hub_sessions'")
    .get() as { sql?: string } | undefined;
  if (!meta) return; // no hub_sessions (fixture below v47) → nothing to rebuild
  if (meta.sql && /'mission'\s*,\s*'auto'/.test(meta.sql)) return; // already widened → no-op

  // The columns to carry across, by NAME (order-independent): every live column that also exists in the
  // rebuilt table. `hub_sessions` at v50 already has all of these; the intersection is defensive.
  const newColumns = new Set([
    "id", "project_id", "kind", "parent_session_id", "mission_id", "title", "title_state", "mode",
    "topology", "autonomy", "crew_id", "model", "status", "phase", "stop_reason_code",
    "capabilities_json", "budgets_json", "prompt_version", "tool_scope_json", "cost_usd", "tokens_in",
    "tokens_out", "active_duration_ms", "total_duration_ms", "wait_deadline_at", "created_at",
    "updated_at", "ended_at", "seen", "archived_at",
  ]);
  const liveCols = (db.prepare("PRAGMA table_info(hub_sessions)").all() as Array<{ name: string }>)
    .map((c) => c.name)
    .filter((name) => newColumns.has(name));
  const colList = liveCols.map((name) => `"${name}"`).join(", ");

  db.exec(`
    CREATE TABLE hub_sessions_new (
      id                  TEXT PRIMARY KEY,
      project_id          TEXT REFERENCES hub_projects(id) ON DELETE SET NULL,
      kind                TEXT NOT NULL CHECK (kind IN ('chat','agent')),
      parent_session_id   TEXT REFERENCES hub_sessions(id) ON DELETE CASCADE,
      mission_id          TEXT REFERENCES hub_missions(id) ON DELETE CASCADE,
      title               TEXT NOT NULL,
      title_state         TEXT NOT NULL DEFAULT 'pending' CHECK (title_state IN ('pending','auto','manual')),
      mode                TEXT NOT NULL CHECK (mode IN ('chat','research','mission','auto')),
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
      tool_scope_json     TEXT,
      cost_usd            REAL NOT NULL DEFAULT 0,
      tokens_in           INTEGER NOT NULL DEFAULT 0,
      tokens_out          INTEGER NOT NULL DEFAULT 0,
      active_duration_ms  INTEGER,
      total_duration_ms   INTEGER,
      wait_deadline_at    TEXT,
      created_at          TEXT NOT NULL,
      updated_at          TEXT NOT NULL,
      ended_at            TEXT,
      seen                INTEGER NOT NULL DEFAULT 0,
      archived_at         TEXT
    );
    INSERT INTO hub_sessions_new (${colList}) SELECT ${colList} FROM hub_sessions;
    DROP TABLE hub_sessions;
    ALTER TABLE hub_sessions_new RENAME TO hub_sessions;
    CREATE INDEX IF NOT EXISTS idx_hub_sessions_project_updated ON hub_sessions(project_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_hub_sessions_kind_updated ON hub_sessions(kind, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_hub_sessions_parent ON hub_sessions(parent_session_id);
    CREATE INDEX IF NOT EXISTS idx_hub_sessions_mission ON hub_sessions(mission_id);
  `);
}

/**
 * v28 (Claude subscription, WP 0.2, D-CS6) — widen `provider_credentials.kind`'s CHECK to admit
 * 'claude_subscription'. Same rebuild shape as {@link rebuildProviderCredentialsForServerLink} (v23):
 * a fresh CREATE with the new-shape CHECK, `INSERT … SELECT` copying every existing column (INCLUDING
 * `mcp_server_id`, which v23 already added — unlike v23 this migration adds no new column), DROP the
 * old table, RENAME. MUST run with foreign_keys OFF (the caller's responsibility — see
 * {@link applyMigrations}), for the same reason v23 documents: `provider_credentials` is the parent of
 * `scenarios.provider_id` (ON DELETE RESTRICT) and `assistant_settings.fallback_provider_credential_id`
 * (ON DELETE SET NULL), so the DROP would otherwise fire those actions. Every existing row keeps its
 * SAME `id`, so both child references stay valid (verified by `foreign_key_check` before commit).
 *
 * Idempotency is CONTENT-based (unlike v23's column-presence probe): no column is added here, so the
 * self-guard inspects the table's persisted DDL (`sqlite_master.sql`) for the new CHECK literal —
 * mirrors `widenRunStepsTypeCheck`'s (v5/F6) `row.sql.includes(...)` pattern. No-ops on a fresh DB
 * (schema.ts already built the target shape) and on a re-run.
 */
function widenProviderCredentialsKindCheck(db: AppDatabase): void {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='provider_credentials'")
    .get() as { sql?: string } | undefined;
  // A real DB always has `provider_credentials` (schemaSql), but a MINIMAL migration-test fixture may
  // not — rebuilding an absent table would throw. Guard on its existence (the v19/v24/v27 pattern) so
  // the step is a correct no-op there while rebuilding every real DB.
  if (!row?.sql) return;
  if (row.sql.includes("claude_subscription")) return; // already at the target shape (fresh DB / re-run)

  db.exec(`
    CREATE TABLE provider_credentials_new (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('anthropic','openai','google','openai_compatible','ollama','qlik_answers','claude_subscription')),
      label TEXT NOT NULL,
      base_url TEXT,
      api_key_encrypted TEXT,
      mcp_server_id TEXT REFERENCES mcp_servers(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO provider_credentials_new (id, kind, label, base_url, api_key_encrypted, mcp_server_id, created_at, updated_at)
      SELECT id, kind, label, base_url, api_key_encrypted, mcp_server_id, created_at, updated_at FROM provider_credentials;
    DROP TABLE provider_credentials;
    ALTER TABLE provider_credentials_new RENAME TO provider_credentials;
  `);
}

/**
 * v31 (Unified Sessions, WP1.6, D-US1/D-US2) — widen `runs.status`'s CHECK to admit `'ended'` AND add
 * the 7 new session-lifecycle columns, in one rebuild.
 *
 * UNLIKE {@link widenRunStepsTypeCheck} (v5/F6) — which safely renames `run_steps` itself out of the
 * way first, because nothing FK-references `run_steps` — `runs` IS FK-referenced (`run_steps`/
 * `run_events`/`run_grades`/`run_skills`, all `ON DELETE CASCADE`). SQLite's `ALTER TABLE … RENAME TO`
 * automatically rewrites OTHER tables' stored FK text to follow a renamed parent, so renaming `runs`
 * itself away first would silently repoint those children at the rename target — then dropping it
 * leaves them dangling. This instead follows the v16/v23/v28 shape: build the target shape under a
 * NEW name (`runs_new`, sourced from `schemaSql` via {@link extractCreateTable} so it can never drift
 * from the fresh-DB shape), copy the OLD columns by name (new columns default/NULL), DROP the ORIGINAL
 * `runs` (its name — and thus what the children's untouched `REFERENCES runs(id)` text resolves to —
 * is freed), then RENAME `runs_new` INTO that freed name. Recreates `runs`' 3 indexes (a `DROP TABLE`
 * drops them). Content-based idempotency (the v28 pattern): no-ops on a fresh DB / re-run.
 */
function widenRunsStatusCheckAndAddSessionColumns(db: AppDatabase): void {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'runs'")
    .get() as { sql?: string } | undefined;
  if (!row?.sql || row.sql.includes("'ended'")) return; // absent (defensive) or already widened

  const runsDdl = extractCreateTable(schemaSql, "runs");
  if (!runsDdl) return; // defensive: schemaSql always defines it
  const runsNewDdl = runsDdl.replace(
    "CREATE TABLE IF NOT EXISTS runs (",
    "CREATE TABLE runs_new (",
  );

  const cols = (db.prepare("PRAGMA table_info(runs)").all() as Array<{ name: string }>).map(
    (c) => c.name,
  );
  const colList = cols.join(", ");
  const rebuild = db.transaction(() => {
    db.exec(runsNewDdl);
    db.exec(`INSERT INTO runs_new (${colList}) SELECT ${colList} FROM runs`);
    db.exec("DROP TABLE runs");
    db.exec("ALTER TABLE runs_new RENAME TO runs");
    db.exec("CREATE INDEX IF NOT EXISTS idx_runs_test_started ON runs(test_id, started_at DESC)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_runs_scenario ON runs(scenario_id, started_at DESC)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_runs_suite_run ON runs(suite_run_id, started_at ASC)");
  });
  rebuild();
}

/**
 * F6 — rebuild `run_steps` so its `type` CHECK admits `'user_message'`, only if the existing table's
 * DDL doesn't already mention it. SQLite cannot ALTER a CHECK constraint in place, so the canonical
 * widening is a rebuild: rename → recreate from `schemaSql` (which now carries the widened CHECK) →
 * copy rows → drop → recreate the index. Idempotent: a fresh DB (table already widened) is skipped.
 */
function widenRunStepsTypeCheck(db: AppDatabase): void {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'run_steps'")
    .get() as { sql?: string } | undefined;
  if (!row?.sql || row.sql.includes("user_message")) return; // already widened (or not present yet)

  const runStepsDdl = extractCreateTable(schemaSql, "run_steps");
  if (!runStepsDdl) return; // defensive: schemaSql always defines it

  // Copy every existing column by name so the new (nullable) columns simply default to NULL.
  const cols = (db.prepare("PRAGMA table_info(run_steps)").all() as Array<{ name: string }>).map(
    (c) => c.name,
  );
  const colList = cols.join(", ");
  // Nested inside applyMigrations' transaction → runs as a SAVEPOINT (better-sqlite3 handles this).
  const rebuild = db.transaction(() => {
    db.exec("ALTER TABLE run_steps RENAME TO run_steps_old");
    db.exec(runStepsDdl);
    db.exec(`INSERT INTO run_steps (${colList}) SELECT ${colList} FROM run_steps_old`);
    db.exec("DROP TABLE run_steps_old");
    db.exec("CREATE INDEX IF NOT EXISTS idx_run_steps_run_idx ON run_steps(run_id, idx ASC)");
  });
  rebuild();
}

/**
 * Pull one `CREATE TABLE IF NOT EXISTS <name> ( … );` statement out of the schema SQL blob. Scans
 * with balanced-paren tracking while skipping `--` line comments and `'…'` string literals, so a
 * `);` that appears INSIDE a column comment (e.g. run_steps' "…(NULL on … steps); drives…") doesn't
 * prematurely terminate the extraction. Returns the statement up to and including its closing `)`.
 */
function extractCreateTable(sql: string, table: string): string | undefined {
  const start = sql.indexOf(`CREATE TABLE IF NOT EXISTS ${table} (`);
  if (start === -1) return undefined;
  const open = sql.indexOf("(", start);
  if (open === -1) return undefined;

  let depth = 0;
  for (let i = open; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "-" && sql[i + 1] === "-") {
      // Line comment: skip to end of line (its parens/quotes don't count).
      const nl = sql.indexOf("\n", i);
      if (nl === -1) break;
      i = nl;
      continue;
    }
    if (ch === "'") {
      // String literal: skip to its closing quote (SQLite escapes '' — advancing past each handles it).
      const close = sql.indexOf("'", i + 1);
      if (close === -1) break;
      i = close;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return sql.slice(start, i + 1); // closing paren of the CREATE TABLE
    }
  }
  return undefined;
}

function ensureColumn(
  db: AppDatabase,
  tableName: string,
  columnName: string,
  columnDefinition: string,
): void {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  if (columns.some((column) => column.name === columnName)) return;
  db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`).run();
}
