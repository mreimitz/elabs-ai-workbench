/**
 * RM-18 WP 1.4 — the upgrade-path harness.
 *
 * Opens every COMMITTED fixture database under `test/fixtures/upgrade/`, brings it forward through
 * the real open path, and asserts the invariants that must hold no matter which shape the database
 * started from. It runs inside `pnpm test` like everything else — there is no separate command and
 * no opt-in flag, so a future migration that breaks an old database fails the gate rather than a
 * user's install.
 *
 * ── Why this exists next to `migrations.test.ts` ─────────────────────────────────────────────────
 * `migrations.test.ts` is thorough about WHAT each individual step does, but every "old database" in
 * it is SIMULATED by rewinding a new one — create at the latest shape from `schemaSql`, drop a
 * table/column/index, re-stamp `user_version` backwards. That method re-derives the "old" shape from
 * TODAY'S `schema.ts` on every run, so both sides of any comparison move together and it can never
 * observe the baseline schema and the migration chain drifting apart.
 *
 * The fixtures here are frozen binaries. They never re-derive from anything. If someone adds a
 * column to `schema.ts` and forgets the migration step, the migrated-vs-fresh comparison below goes
 * red against every fixture that carries that table.
 *
 * Provenance and regeneration are documented beside the fixtures, in
 * `test/fixtures/upgrade/README.md`. The generator is `scripts/build-upgrade-fixtures.ts`.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import Database from "better-sqlite3";
import {
  applyMigrations,
  ensureLocalCollection,
  LATEST_SCHEMA_VERSION,
  type AppDatabase,
} from "../src/db/database.js";
import { ensureSearchBackfill } from "../src/observability/search.js";
import { schemaSql } from "../src/db/schema.js";
import { ScanRepository } from "../src/scans/repository.js";
import { RunRepository } from "../src/testing/run-repository.js";

const FIXTURE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "upgrade",
);

/** The one literal the generator puts in every secret-shaped column. Nothing else may appear there. */
const NOT_A_SECRET = "fixture-placeholder-not-a-secret";

const scratchDirs: string[] = [];
const openDbs: AppDatabase[] = [];

after(() => {
  for (const db of openDbs.splice(0)) {
    try {
      db.close();
    } catch {
      /* already closed */
    }
  }
  for (const dir of scratchDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Per-fixture expectations
// ─────────────────────────────────────────────────────────────────────────────────────────────────

interface FixtureExpectation {
  /** Tables the chain is EXPECTED to remove entirely (v12 drops the v10-era session-trace pair). */
  readonly droppedTables?: readonly string[];
  /** Columns the chain is EXPECTED to remove (v56 drops two that only served the retired kind). */
  readonly droppedColumns?: Readonly<Record<string, readonly string[]>>;
  /**
   * Columns the open path is EXPECTED to REWRITE (only `ensureLocalCollection` re-homing a
   * collection-less member). The probe stops demanding the old value for these; the fixture's `alsoProve`
   * says what the new one must be, so the exemption never becomes a place to hide a mutation.
   */
  readonly rewrittenColumns?: Readonly<Record<string, readonly string[]>>;
  /**
   * Rows the chain is EXPECTED to delete, per table. A table listed here is asserted at EXACTLY
   * `before - n`, so a destructive migration's blast radius is a pinned number rather than a blanket
   * "counts may go down". Every table NOT listed is asserted `after >= before` — it may gain rows
   * (a migration seed, the search-index marker) but may never lose one.
   */
  readonly deletedRows?: Readonly<Record<string, number>>;
  /**
   * Rows whose FULL pre-migration record must still be readable, unchanged, afterwards. Looked up by
   * `idColumn` (default `id`) — a few tables key on something else (`run_skills` on `run_id`).
   */
  readonly probes: ReadonlyArray<{
    readonly table: string;
    readonly id: string;
    readonly idColumn?: string;
  }>;
  /** Extra, fixture-specific proofs run against the migrated database. */
  readonly alsoProve?: (db: AppDatabase) => void;
}

const EXPECTATIONS: Readonly<Record<string, FixtureExpectation>> = {
  "v00-preversioning": {
    droppedTables: ["session_traces", "session_trace_events"],
    probes: [
      { table: "mcp_servers", id: "srv-fs" },
      { table: "mcp_scans", id: "scan-ok" },
      { table: "mcp_tool_scans", id: "tool-read" },
      { table: "provider_credentials", id: "cred-anthropic" },
      { table: "scenarios", id: "env-base" },
      { table: "tests", id: "test-list" },
      { table: "runs", id: "run-completed" },
      { table: "run_steps", id: "step-c-0" },
      { table: "run_events", id: "rev-1" },
    ],
    alsoProve: (db) => {
      // v1 / v25 — the additive `mcp_servers` columns land with their documented defaults.
      const server = db
        .prepare("SELECT auth_type, type_id FROM mcp_servers WHERE id = 'srv-fs'")
        .get() as {
        auth_type: string;
        type_id: string | null;
      };
      assert.equal(server.auth_type, "none");
      assert.equal(server.type_id, null);

      // v8 — every pre-versioning scan is stamped at counting_version 1, not silently at the current one.
      assert.equal(
        (
          db.prepare("SELECT counting_version AS v FROM mcp_scans WHERE id = 'scan-ok'").get() as {
            v: number;
          }
        ).v,
        1,
      );

      // v27 — this fixture reaches v13 with no grades at all, so every TERMINAL run must land on
      // 'skipped' and the non-terminal one must stay 'pending'. (The 'rated' branch is proved by the
      // v15 fixture, which is the only one that can carry run_grades rows.)
      const states = Object.fromEntries(
        (
          db.prepare("SELECT id, rating_state FROM runs").all() as Array<{
            id: string;
            rating_state: string;
          }>
        ).map((r) => [r.id, r.rating_state]),
      );
      assert.deepEqual(states, {
        "run-completed": "skipped",
        "run-error": "skipped",
        "run-stopped": "skipped",
      });

      // v59 — the three-way cache backfill, one run per branch.
      const cache = Object.fromEntries(
        (
          db
            .prepare("SELECT id, cache_read_tokens AS r, cache_write_tokens AS w FROM runs")
            .all() as Array<{ id: string; r: number | null; w: number | null }>
        ).map((row) => [row.id, [row.r, row.w]]),
      );
      // steps carried the split → recovered exactly
      assert.deepEqual(cache["run-completed"], [3800, 1200]);
      // a merged-only `cachedInputTokens` step → genuinely unknowable → NULL, never a fabricated 0
      assert.deepEqual(cache["run-error"], [null, null]);
      // usage steps that never mention cache → a real, knowable 0
      assert.deepEqual(cache["run-stopped"], [0, 0]);

      // v44 — the pricing seed ran on a database that had never heard of `model_pricing`.
      assert.ok(
        (
          db.prepare("SELECT COUNT(*) AS n FROM model_pricing WHERE source = 'seed'").get() as {
            n: number;
          }
        ).n > 0,
      );
    },
  },

  "v12-pre-v13": {
    probes: [
      { table: "tests", id: "test-list" },
      { table: "runs", id: "run-completed" },
      { table: "run_skills", id: "run-completed", idColumn: "run_id" },
      { table: "mcp_scans", id: "scan-ok" },
    ],
    alsoProve: (db) => {
      // v13 — the graded-tests columns arrive with the documented "behaves exactly as before" values.
      const row = db
        .prepare(
          "SELECT expectations_json AS e, category AS c, difficulty AS d, tags_json AS t FROM tests WHERE id = 'test-list'",
        )
        .get() as { e: string | null; c: string | null; d: string | null; t: string };
      assert.deepEqual(row, { e: null, c: null, d: null, t: "[]" });
      // v38's `draft` flag likewise defaults off — a pre-v38 test never auto-runs.
      assert.equal(
        (db.prepare("SELECT draft AS d FROM tests WHERE id = 'test-list'").get() as { d: number })
          .d,
        0,
      );
    },
  },

  "v15-pre-v16": {
    probes: [
      { table: "collections", id: "col-git" },
      { table: "suites", id: "suite-nightly" },
      { table: "suite_runs", id: "srun-1" },
      { table: "run_grades", id: "grade-1" },
      { table: "runs", id: "run-completed" },
    ],
    alsoProve: (db) => {
      // v16 — the git binding survives the rebuild that made those three columns nullable…
      const col = db
        .prepare(
          "SELECT repo_url AS u, repo_path AS p, branch AS b, is_default AS d FROM collections WHERE id = 'col-git'",
        )
        .get() as { u: string; p: string; b: string; d: number };
      assert.deepEqual(col, {
        u: "https://example.invalid/team/benchmarks.git",
        p: "benchmarks",
        b: "main",
        d: 0,
      });
      // …and membership is NOT blanked by the parent table being dropped and rebuilt (the hazard the
      // migration's own comment calls out: `tests.collection_id` is ON DELETE SET NULL).
      assert.equal(
        (
          db.prepare("SELECT collection_id AS c FROM tests WHERE id = 'test-list'").get() as {
            c: string;
          }
        ).c,
        "col-git",
      );
      assert.equal(
        (
          db.prepare("SELECT collection_id AS c FROM suites WHERE id = 'suite-nightly'").get() as {
            c: string;
          }
        ).c,
        "col-git",
      );
      // `ensureLocalCollection` seeds exactly one default and re-homes the collection-less suite.
      const local = db.prepare("SELECT id FROM collections WHERE is_default = 1").all() as Array<{
        id: string;
      }>;
      assert.equal(local.length, 1);
      assert.equal(
        (
          db.prepare("SELECT collection_id AS c FROM suites WHERE id = 'suite-local'").get() as {
            c: string;
          }
        ).c,
        local[0]!.id,
      );
      // v16 also made `suite_runs.suite_id` nullable while keeping the existing owned row intact.
      assert.equal(
        (
          db.prepare("SELECT suite_id AS s FROM suite_runs WHERE id = 'srun-1'").get() as {
            s: string;
          }
        ).s,
        "suite-nightly",
      );
      assert.equal(
        (
          db.prepare("PRAGMA table_info(suite_runs)").all() as Array<{
            name: string;
            notnull: number;
          }>
        ).find((c) => c.name === "suite_id")?.notnull,
        0,
      );
      // v27's OTHER branch: a terminal run that DOES carry a base-rating grade reads back 'rated'.
      assert.equal(
        (
          db.prepare("SELECT rating_state AS s FROM runs WHERE id = 'run-completed'").get() as {
            s: string;
          }
        ).s,
        "rated",
      );
      assert.equal(
        (
          db.prepare("SELECT rating_state AS s FROM runs WHERE id = 'run-error'").get() as {
            s: string;
          }
        ).s,
        "skipped",
      );
    },
  },

  "v50-pre-v51": {
    probes: [
      { table: "hub_sessions", id: "hs-parent" },
      { table: "hub_sessions", id: "hs-child" },
      { table: "hub_sessions", id: "hs-old" },
      { table: "hub_events", id: "he-1" },
    ],
    alsoProve: (db) => {
      // v51 — the CHECK is widened…
      const ddl = (
        db
          .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='hub_sessions'")
          .get() as {
          sql: string;
        }
      ).sql;
      assert.match(ddl, /'mission'\s*,\s*'auto'/);
      // …the self-reference survives the drop-and-rename…
      assert.equal(
        (
          db
            .prepare("SELECT parent_session_id AS p FROM hub_sessions WHERE id = 'hs-child'")
            .get() as {
            p: string;
          }
        ).p,
        "hs-parent",
      );
      // …and the two ALTER-appended columns (v49 archived_at, v50 tool_scope_json), which sat OUT of
      // baseline order in the old table, are copied by NAME rather than by position.
      const parent = db
        .prepare(
          "SELECT tool_scope_json AS t, archived_at AS a FROM hub_sessions WHERE id = 'hs-parent'",
        )
        .get() as { t: string | null; a: string | null };
      assert.equal(parent.t, '{"servers":{"srv-fs":["read_file"]},"builtins":[]}');
      assert.equal(parent.a, null);
      const archived = db
        .prepare(
          "SELECT tool_scope_json AS t, archived_at AS a FROM hub_sessions WHERE id = 'hs-old'",
        )
        .get() as { t: string | null; a: string | null };
      assert.equal(archived.t, null);
      assert.equal(archived.a, "2026-01-04T09:18:00.000Z");
      // v52/v55 then add their columns on top, reading back NULL for every pre-existing session.
      const later = db
        .prepare(
          "SELECT roster_json AS r, provider_credential_id AS p FROM hub_sessions WHERE id = 'hs-parent'",
        )
        .get() as { r: string | null; p: string | null };
      assert.deepEqual(later, { r: null, p: null });
    },
  },

  "v55-pre-v56": {
    // v56 is the chain's one DESTRUCTIVE step. These four numbers ARE its documented blast radius.
    deletedRows: {
      provider_credentials: 1,
      scenarios: 1,
      runs: 1,
      run_steps: 1,
    },
    // …and these two columns are retired with the feature they served.
    droppedColumns: {
      provider_credentials: ["mcp_server_id"],
      scenarios: ["answers_mode"],
    },
    // The three columns the chain deliberately rewrites — `ensureLocalCollection` re-homing the
    // collection-less test, and v57 repairing the two legacy deep-link prefixes. Every one of them
    // has its exact new value asserted in `alsoProve` below.
    rewrittenColumns: {
      tests: ["collection_id"],
      notifications: ["link_path"],
      digest_reports: ["report_json"],
    },
    probes: [
      { table: "provider_credentials", id: "cred-keep" },
      { table: "runs", id: "run-keep" },
      { table: "tests", id: "test-keep" },
      { table: "notifications", id: "note-ok" },
      { table: "digest_reports", id: "digest-1" },
    ],
    alsoProve: (db) => {
      // v56 — the retired-kind credential and everything downstream of it is gone…
      assert.equal(
        db.prepare("SELECT id FROM provider_credentials WHERE id = 'cred-doomed'").get(),
        undefined,
      );
      assert.equal(db.prepare("SELECT id FROM scenarios WHERE id = 'env-doomed'").get(), undefined);
      assert.equal(db.prepare("SELECT id FROM runs WHERE id = 'run-doomed'").get(), undefined);
      assert.equal(
        db.prepare("SELECT id FROM run_steps WHERE id = 'rs-doomed-0'").get(),
        undefined,
      );
      // …the SET NULL pointer was nulled by hand (foreign_keys is OFF during migration, so no cascade
      // would have fired on its own)…
      assert.equal(
        (
          db
            .prepare(
              "SELECT fallback_provider_credential_id AS f FROM assistant_settings WHERE id = 1",
            )
            .get() as {
            f: string | null;
          }
        ).f,
        null,
      );
      // …the CHECK no longer admits the retired kind, and its link column is gone…
      const ddl = (
        db
          .prepare(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='provider_credentials'",
          )
          .get() as { sql: string }
      ).sql;
      assert.doesNotMatch(ddl, /qlik_answers/);
      assert.ok(
        !(
          db.prepare("PRAGMA table_info(provider_credentials)").all() as Array<{ name: string }>
        ).some((c) => c.name === "mcp_server_id"),
      );
      assert.ok(
        !(db.prepare("PRAGMA table_info(scenarios)").all() as Array<{ name: string }>).some(
          (c) => c.name === "answers_mode",
        ),
      );
      // …and the unrelated environment/run/test are untouched.
      assert.ok(db.prepare("SELECT id FROM scenarios WHERE id = 'env-keep'").get());

      // v57 — both legacy deep-link prefixes are rewritten to routes that exist, in the notification
      // rows AND inside the stored digest payload; a link that was already correct is left alone.
      const links = Object.fromEntries(
        (
          db.prepare("SELECT id, link_path FROM notifications").all() as Array<{
            id: string;
            link_path: string;
          }>
        ).map((r) => [r.id, r.link_path]),
      );
      assert.deepEqual(links, {
        "note-hub": "/assistant?session=hs-parent",
        "note-issue": "/dashboard?tab=issues&issue=issue-42",
        "note-ok": "/testing/runs/run-keep",
      });
      assert.match(
        (
          db.prepare("SELECT report_json AS r FROM digest_reports WHERE id = 'digest-1'").get() as {
            r: string;
          }
        ).r,
        /\/dashboard\?tab=issues&issue=issue-42/,
      );

      // v59 — the surviving run's cache split is recovered from its steps.
      const keep = db
        .prepare(
          "SELECT cache_read_tokens AS r, cache_write_tokens AS w FROM runs WHERE id = 'run-keep'",
        )
        .get() as { r: number | null; w: number | null };
      assert.deepEqual(keep, { r: 3200, w: 300 });

      // The one deliberately rewritten column: the collection-less test is re-homed into the seeded
      // default "Local" collection, and nowhere else.
      const local = db.prepare("SELECT id FROM collections WHERE is_default = 1").all() as Array<{
        id: string;
      }>;
      assert.equal(local.length, 1);
      assert.equal(
        (
          db.prepare("SELECT collection_id AS c FROM tests WHERE id = 'test-keep'").get() as {
            c: string;
          }
        ).c,
        local[0]!.id,
      );
    },
  },

  [`v${LATEST_SCHEMA_VERSION}-at-capture`]: {
    probes: [
      { table: "mcp_scans", id: "scan-ok" },
      { table: "runs", id: "run-completed" },
      { table: "collections", id: "col-local-fixture" },
    ],
    alsoProve: (db) => {
      // The captured database already carried the Local collection, so `ensureLocalCollection` must
      // recognise it rather than mint a second default.
      const defaults = db
        .prepare("SELECT id FROM collections WHERE is_default = 1")
        .all() as Array<{ id: string }>;
      assert.deepEqual(defaults, [{ id: "col-local-fixture" }]);
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Schema introspection — a STRUCTURAL comparison, not a text one
// ─────────────────────────────────────────────────────────────────────────────────────────────────
//
// A migrated database's stored DDL text legitimately differs from a fresh one's: `ensureColumn` uses
// `ALTER TABLE … ADD COLUMN`, which APPENDS to the persisted `CREATE TABLE` statement, while
// `schema.ts` declares the same column in the middle and surrounds it with comments. Comparing raw
// `sqlite_master.sql` would therefore fail on every upgrade path for a reason that is not a defect.
//
// So the comparison below is structural and order-independent — the set of tables, each table's
// columns keyed by NAME (type · nullability · default · pk), each table's foreign keys, each table's
// CHECK constraints, and every index with its columns, uniqueness and partial predicate. That catches
// exactly the failures that matter (a column, default, CHECK, FK or index that the migration path
// never produced) and ignores the one thing that is genuinely allowed to differ (column ORDER).

interface StructuralSchema {
  tables: string[];
  columns: Record<string, string[]>;
  checks: Record<string, string[]>;
  foreignKeys: Record<string, string[]>;
  indexes: string[];
}

/** Collapse SQL whitespace so two spellings of the same clause compare equal. */
function normalizeSql(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s*([(),])\s*/g, "$1")
    .replace(/\bIF NOT EXISTS\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Pull every `CHECK (...)` clause out of a table's DDL, paren-balanced, skipping `--` comments and
 * string literals so a `)` inside either does not terminate the scan early.
 */
function extractChecks(sql: string): string[] {
  const found: string[] = [];
  for (let i = 0; i < sql.length; i++) {
    if (sql[i] === "-" && sql[i + 1] === "-") {
      const nl = sql.indexOf("\n", i);
      if (nl === -1) break;
      i = nl;
      continue;
    }
    if (sql[i] === "'") {
      const close = sql.indexOf("'", i + 1);
      if (close === -1) break;
      i = close;
      continue;
    }
    if (!/^check\b/i.test(sql.slice(i, i + 6))) continue;
    // A bare "CHECK" only counts when the next non-space character opens a group.
    let j = i + 5;
    while (j < sql.length && /\s/.test(sql[j]!)) j++;
    if (sql[j] !== "(") continue;

    let depth = 0;
    let k = j;
    for (; k < sql.length; k++) {
      const ch = sql[k];
      if (ch === "'") {
        const close = sql.indexOf("'", k + 1);
        if (close === -1) break;
        k = close;
        continue;
      }
      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    found.push(normalizeSql(sql.slice(i, k + 1)));
    i = k;
  }
  return found.sort();
}

function readStructuralSchema(db: AppDatabase): StructuralSchema {
  const objects = db
    .prepare("SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY name")
    .all() as Array<{ type: string; name: string; tbl_name: string; sql: string | null }>;

  const tables = objects
    .filter((o) => o.type === "table" && !o.name.startsWith("sqlite_"))
    .map((o) => o.name)
    .sort();

  const columns: Record<string, string[]> = {};
  const checks: Record<string, string[]> = {};
  const foreignKeys: Record<string, string[]> = {};
  for (const table of tables) {
    columns[table] = (
      db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{
        name: string;
        type: string;
        notnull: number;
        dflt_value: unknown;
        pk: number;
      }>
    )
      .map(
        (c) =>
          `${c.name}|${c.type}|notnull=${c.notnull}|default=${String(c.dflt_value)}|pk=${c.pk}`,
      )
      .sort();
    checks[table] = extractChecks(
      objects.find((o) => o.type === "table" && o.name === table)?.sql ?? "",
    );
    foreignKeys[table] = (
      db.prepare(`PRAGMA foreign_key_list("${table}")`).all() as Array<{
        table: string;
        from: string;
        to: string | null;
        on_update: string;
        on_delete: string;
      }>
    )
      .map((f) => `${f.from}->${f.table}.${f.to ?? "rowid"}|del=${f.on_delete}|upd=${f.on_update}`)
      .sort();
  }

  // `sqlite_autoindex_*` entries are implied by a table's PRIMARY KEY / UNIQUE declarations, carry no
  // SQL of their own, and are numbered by declaration order — they add nothing the column/PK
  // comparison above does not already cover, so they are excluded rather than compared by name.
  const indexes = objects
    .filter((o) => o.type === "index" && !o.name.startsWith("sqlite_autoindex_"))
    .map((o) => `${o.name}@${o.tbl_name} :: ${o.sql ? normalizeSql(o.sql) : "(implicit)"}`)
    .sort();

  return { tables, columns, checks, foreignKeys, indexes };
}

function rowCounts(db: AppDatabase): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const { name } of db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all() as Array<{ name: string }>) {
    try {
      counts[name] = (db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get() as { n: number }).n;
    } catch {
      // An FTS5 shadow table can refuse a bare COUNT(*); it is derived state, not data to conserve.
    }
  }
  return counts;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// The open path — the same four steps `openDatabase()` performs, in the same order
// ─────────────────────────────────────────────────────────────────────────────────────────────────
//
// `openDatabase()` itself cannot be reused here: it resolves `config.databasePath` at module load, so
// it can only ever open the one real database. The four calls are replicated instead — and pinned by
// `openDatabase mirrors the sequence this harness replays`, below, so the replica cannot silently
// drift away from the original.

function openLikeTheApp(file: string): AppDatabase {
  const db = new Database(file);
  openDbs.push(db);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  ensureLocalCollection(db);
  ensureSearchBackfill(db, () => {});
  return db;
}

/** A fresh database built exactly the way `openDatabase()` builds one on an empty data directory. */
function buildFresh(): AppDatabase {
  const db = new Database(":memory:");
  openDbs.push(db);
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  ensureLocalCollection(db);
  ensureSearchBackfill(db, () => {});
  return db;
}

/** Copy a committed fixture into a scratch directory — the committed file is NEVER opened for write. */
function checkoutFixture(fileName: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcpfp-upgrade-"));
  scratchDirs.push(dir);
  const target = path.join(dir, fileName);
  fs.copyFileSync(path.join(FIXTURE_DIR, fileName), target);
  return target;
}

const FIXTURE_FILES = fs
  .readdirSync(FIXTURE_DIR)
  .filter((f) => f.endsWith(".sqlite"))
  .sort();

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────────────────────────

test("the fixture set is present, small, and every fixture is accounted for", () => {
  assert.ok(
    FIXTURE_FILES.length >= 5,
    `expected the committed fixture set, found ${FIXTURE_FILES.length}`,
  );

  // The two the item names explicitly.
  assert.ok(
    FIXTURE_FILES.includes("v00-preversioning.sqlite"),
    "a user_version = 0 fixture is required",
  );
  assert.ok(FIXTURE_FILES.includes("v12-pre-v13.sqlite"), "a pre-v13 fixture is required");

  for (const file of FIXTURE_FILES) {
    const name = file.replace(/\.sqlite$/, "");
    assert.ok(
      EXPECTATIONS[name],
      `${file} has no entry in EXPECTATIONS — a new fixture must declare what it proves`,
    );
    const bytes = fs.statSync(path.join(FIXTURE_DIR, file)).size;
    assert.ok(
      bytes < 1_000_000,
      `${file} is ${bytes} bytes; fixtures are kilobyte-scale artifacts`,
    );
  }
});

test("no fixture carries anything secret-shaped", () => {
  // Fixtures are generated, never copied from `data/app.sqlite`. This asserts it rather than trusting
  // it: every column whose name marks it as secret-bearing holds the one inert placeholder literal.
  // Exact column names + the one suffix that always marks ciphertext. Deliberately NOT a loose
  // substring match: `profile_tokens_json` is a token COUNT, not a token.
  const secretish = (column: string): boolean =>
    column.endsWith("_encrypted") ||
    ["tokens_json", "code_verifier", "token_hash", "api_key", "encrypted_value"].includes(column);
  for (const file of FIXTURE_FILES) {
    const db = new Database(checkoutFixture(file), { readonly: true });
    openDbs.push(db);
    for (const { name } of db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string }>) {
      const cols = (db.prepare(`PRAGMA table_info("${name}")`).all() as Array<{ name: string }>)
        .map((c) => c.name)
        .filter(secretish);
      for (const col of cols) {
        const values = (
          db
            .prepare(`SELECT "${col}" AS v FROM "${name}" WHERE "${col}" IS NOT NULL`)
            .all() as Array<{
            v: unknown;
          }>
        ).map((r) => r.v);
        for (const value of values) {
          assert.equal(
            value,
            NOT_A_SECRET,
            `${file}: ${name}.${col} holds something other than the inert fixture placeholder`,
          );
        }
      }
    }
    db.close();
  }
});

test("openDatabase mirrors the sequence this harness replays", () => {
  // The harness cannot call `openDatabase()` (it is bound to `config.databasePath`), so it replicates
  // the body. This keeps the replica honest: if the real open path grows a fifth step, or reorders
  // the four, this goes red and the replica above must be updated with it.
  const source = fs.readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "db", "database.ts"),
    "utf8",
  );
  const body = source.slice(source.indexOf("export function openDatabase"));
  const end = body.indexOf("\n}");
  const openBody = body.slice(0, end);
  const order = [
    "db.exec(schemaSql)",
    "applyMigrations(db)",
    "ensureLocalCollection(db)",
    "ensureSearchBackfill(db)",
  ];
  let cursor = -1;
  for (const call of order) {
    const at = openBody.indexOf(call);
    assert.ok(at > cursor, `openDatabase() no longer calls ${call} after the previous step`);
    cursor = at;
  }
});

for (const file of FIXTURE_FILES) {
  const name = file.replace(/\.sqlite$/, "");
  const expectation = EXPECTATIONS[name];
  const declaredVersion = Number.parseInt(name.slice(1, 3), 10);

  test(`upgrade fixture ${name} — migrates to latest and keeps every invariant`, () => {
    assert.ok(expectation, `${file} has no EXPECTATIONS entry`);

    const working = checkoutFixture(file);

    // ── before ──────────────────────────────────────────────────────────────────────────────────
    const before = new Database(working, { readonly: true });
    openDbs.push(before);
    const startVersion = before.pragma("user_version", { simple: true }) as number;
    assert.equal(
      startVersion,
      declaredVersion,
      `${file} is not stamped at the version its name claims`,
    );
    assert.ok(
      startVersion <= LATEST_SCHEMA_VERSION,
      `${file} is stamped ahead of LATEST_SCHEMA_VERSION`,
    );
    const countsBefore = rowCounts(before);
    const probesBefore = expectation.probes.map((probe) => ({
      ...probe,
      row: before
        .prepare(`SELECT * FROM "${probe.table}" WHERE "${probe.idColumn ?? "id"}" = ?`)
        .get(probe.id) as Record<string, unknown> | undefined,
    }));
    for (const probe of probesBefore) {
      assert.ok(
        probe.row,
        `${file}: probe row ${probe.table}#${probe.id} is missing from the fixture itself`,
      );
    }
    before.close();

    // ── migrate ─────────────────────────────────────────────────────────────────────────────────
    const db = openLikeTheApp(working);

    // (1) the version lands at latest
    assert.equal(db.pragma("user_version", { simple: true }), LATEST_SCHEMA_VERSION);

    // (2) integrity: nothing dangling, nothing corrupt
    assert.deepEqual(db.pragma("foreign_key_check"), []);
    assert.deepEqual(db.pragma("integrity_check"), [{ integrity_check: "ok" }]);

    // (3) no row is lost, except where a migration deliberately deletes one
    const countsAfter = rowCounts(db);
    const dropped = new Set(expectation.droppedTables ?? []);
    const deleted = expectation.deletedRows ?? {};
    for (const [table, count] of Object.entries(countsBefore)) {
      if (dropped.has(table)) {
        assert.ok(
          !(table in countsAfter),
          `${file}: ${table} was expected to be dropped but is still there`,
        );
        continue;
      }
      const allowedLoss = deleted[table];
      if (allowedLoss === undefined) {
        assert.ok(
          (countsAfter[table] ?? -1) >= count,
          `${file}: ${table} LOST rows — ${count} → ${countsAfter[table]}, and no deletion is declared`,
        );
      } else {
        assert.equal(
          countsAfter[table],
          count - allowedLoss,
          `${file}: ${table} went ${count} → ${countsAfter[table]} rows (declared loss: ${allowedLoss})`,
        );
      }
    }
    for (const table of dropped) {
      assert.ok(
        table in countsBefore,
        `${file}: ${table} is declared dropped but was never in the fixture`,
      );
    }

    // (4) the seeded rows are still findable BY ID, with every pre-migration column value intact
    for (const probe of probesBefore) {
      const after = db
        .prepare(`SELECT * FROM "${probe.table}" WHERE "${probe.idColumn ?? "id"}" = ?`)
        .get(probe.id) as Record<string, unknown> | undefined;
      assert.ok(after, `${file}: ${probe.table}#${probe.id} did not survive the migration`);
      const gone = new Set(expectation.droppedColumns?.[probe.table] ?? []);
      const rewritten = new Set(expectation.rewrittenColumns?.[probe.table] ?? []);
      for (const [column, value] of Object.entries(probe.row!)) {
        if (gone.has(column)) {
          assert.ok(
            !(column in after),
            `${file}: ${probe.table}.${column} is declared dropped but is still present`,
          );
          continue;
        }
        if (rewritten.has(column)) continue;
        assert.deepEqual(
          after[column],
          value,
          `${file}: ${probe.table}#${probe.id}.${column} changed during the migration`,
        );
      }
    }

    // (5) the migrated schema matches a freshly created one
    const fresh = buildFresh();
    const migratedSchema = readStructuralSchema(db);
    const freshSchema = readStructuralSchema(fresh);
    assert.deepEqual(
      migratedSchema.tables,
      freshSchema.tables,
      `${file}: table set differs from a fresh database`,
    );
    for (const table of freshSchema.tables) {
      assert.deepEqual(
        migratedSchema.columns[table],
        freshSchema.columns[table],
        `${file}: ${table} columns differ from a fresh database`,
      );
      assert.deepEqual(
        migratedSchema.checks[table],
        freshSchema.checks[table],
        `${file}: ${table} CHECK constraints differ from a fresh database`,
      );
      assert.deepEqual(
        migratedSchema.foreignKeys[table],
        freshSchema.foreignKeys[table],
        `${file}: ${table} foreign keys differ from a fresh database`,
      );
    }
    assert.deepEqual(
      migratedSchema.indexes,
      freshSchema.indexes,
      `${file}: index set differs from a fresh database`,
    );

    // (6) the app can immediately USE the result
    const scans = new ScanRepository(db);
    const scanSummaries = scans.listSummaries();
    for (const summary of scanSummaries) scans.getDetail(summary.id);
    const runs = new RunRepository(db);
    const runSummaries = runs.listRuns();
    for (const summary of runSummaries) runs.getRun(summary.id);

    // (7) fixture-specific proofs about what this particular chain had to do
    expectation.alsoProve?.(db);

    // ── idempotence: PROVED by running it again, not by reading the code ─────────────────────────
    const schemaAfterFirst = migratedSchema;
    const countsAfterFirst = rowCounts(db);
    db.close();

    const second = openLikeTheApp(working);
    assert.equal(second.pragma("user_version", { simple: true }), LATEST_SCHEMA_VERSION);
    assert.deepEqual(
      readStructuralSchema(second),
      schemaAfterFirst,
      `${file}: a second open changed the schema — the migration path is not idempotent`,
    );
    assert.deepEqual(
      rowCounts(second),
      countsAfterFirst,
      `${file}: a second open changed row counts — the migration path is not idempotent`,
    );
    assert.deepEqual(second.pragma("foreign_key_check"), []);
    second.close();
  });
}
