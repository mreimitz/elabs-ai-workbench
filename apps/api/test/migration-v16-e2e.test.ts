import assert from "node:assert/strict";
import crypto from "node:crypto";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import {
  applyMigrations,
  ensureLocalCollection,
  LATEST_SCHEMA_VERSION,
  LOCAL_COLLECTION_NAME,
  type AppDatabase,
} from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { CollectionRepository } from "../src/collections/repository.js";
import { CollectionService } from "../src/collections/service.js";
import { resolveRunPlan } from "../src/suites/plan-routes.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { SuiteService } from "../src/suites/service.js";
import { SuiteRepository } from "../src/suites/repository.js";
import { TestRepository } from "../src/testing/test-repository.js";
import { TestService } from "../src/testing/test-service.js";

// Testing IA (WP 4.1) — the THOROUGH, INTEGRATED pre-v16 → v16 upgrade proof. WP 1.2's
// `migrations.test.ts` unit test already covers the isolated shape/idempotency subset; THIS test builds a
// richer pre-v16 on-disk fixture (a git-bound collection with a MEMBER test AND a MEMBER suite, a
// pre-existing OLD-shape `suite_runs` row, a loose test + a loose suite), runs the real open path
// (schemaSql → applyMigrations → ensureLocalCollection), and then proves the migrated DB is not merely
// shaped correctly but FUNCTIONAL: its migrated membership flows through the REAL run-plan resolver, and
// the now-nullable `suite_runs.suite_id` accepts a source-tagged ad-hoc row. Idempotent across a second
// full open. Offline, no providers/git — the resolver reads persisted membership only.

const databases: AppDatabase[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function track(db: AppDatabase): AppDatabase {
  databases.push(db);
  return db;
}

const NOW = "2026-06-20T00:00:00.000Z";

/** The normalized column shape of a table (order + name/type/nullability/default/pk) — DDL-text-agnostic. */
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

function notnullOf(db: AppDatabase, table: string, column: string): number | undefined {
  return (
    db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string; notnull: number }>
  ).find((c) => c.name === column)?.notnull;
}

/** Mirror openDatabase() on an in-memory DB: create everything at latest, then migrate. */
function openFresh(): AppDatabase {
  const db = track(new Database(":memory:"));
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  ensureLocalCollection(db);
  return db;
}

/**
 * Build a pre-v16 on-disk fixture: rewind `collections` (NOT-NULL repo cols, no `is_default`) and
 * `suite_runs` (NOT-NULL `suite_id`, no `source`/`plan_json`) to their v15 shape, stamp `user_version = 15`,
 * then seed:
 *   - a fully-populated GIT-BOUND collection (`col-git`, every field set),
 *   - a MEMBER test (`t-member`, external_key `ek-member`) and a MEMBER suite (`s-owner`, external_key
 *     `ek-owner`) both bound to `col-git`,
 *   - a pre-existing OLD-shape `suite_runs` row (`sr-old`, suite_id `s-owner`, NOT NULL),
 *   - a LOOSE (collection-less) test (`t-loose`) and a LOOSE suite (`s-loose`) — must re-home to Local.
 */
function seedPreV16Database(): AppDatabase {
  const db = track(new Database(":memory:"));
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql); // everything at latest, then rewind the two v16 tables to their old shape

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

  // A fully-populated git-bound collection (every field set).
  db.prepare(
    `INSERT INTO collections (id, name, repo_url, repo_path, branch, pat_encrypted, last_synced_sha, created_at, updated_at)
     VALUES ('col-git', 'Team Bench', 'https://github.com/acme/bench.git', 'suites', 'develop', 'enc:v1:tok', 'deadbeef', @now, @now)`,
  ).run({ now: NOW });
  // A MEMBER test + a MEMBER suite bound to the git collection (external_key cross-system identity set).
  db.prepare(
    `INSERT INTO tests (id, name, user_prompt, collection_id, external_key, created_at, updated_at)
     VALUES ('t-member', 'Member', 'do the thing', 'col-git', 'ek-member', @now, @now)`,
  ).run({ now: NOW });
  db.prepare(
    `INSERT INTO suites (id, name, collection_id, external_key, created_at, updated_at)
     VALUES ('s-owner', 'Member Suite', 'col-git', 'ek-owner', @now, @now)`,
  ).run({ now: NOW });
  // A pre-existing OLD-shape suite_runs row that owns a suite — must survive the rebuild with suite_id intact.
  db.prepare(
    `INSERT INTO suite_runs (id, suite_id, status, config_snapshot_json, started_at, ended_at, aggregates_json)
     VALUES ('sr-old', 's-owner', 'completed', '{"repetitions":1,"maxConcurrency":8}', @now, @now, '{"cellsTotal":1}')`,
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

test("WP4.1 proof 1 — pre-v16 upgrade: binding intact, Local once, loose members re-homed, suite_runs migrated, functional + idempotent", () => {
  const db = seedPreV16Database();

  // Sanity: the fixture really is at the OLD (not-null) shape before migrating.
  assert.equal(
    db.pragma("user_version", { simple: true }),
    15,
    "fixture starts stamped at 15 (pre-v16)",
  );
  assert.equal(
    notnullOf(db, "collections", "repo_url"),
    1,
    "sanity: collections.repo_url is NOT NULL pre-v16",
  );
  assert.equal(
    notnullOf(db, "suite_runs", "suite_id"),
    1,
    "sanity: suite_runs.suite_id is NOT NULL pre-v16",
  );

  // ── Run the REAL open path: CREATE IF NOT EXISTS no-ops on the old tables, v16 rebuilds them, the
  //    Local seed + member backfill runs.
  db.exec(schemaSql);
  applyMigrations(db);
  ensureLocalCollection(db);

  assert.equal(
    db.pragma("user_version", { simple: true }),
    LATEST_SCHEMA_VERSION,
    "stamped to latest after v16",
  );

  // (A) BINDING INTACT — the git-bound collection keeps every field; is_default defaulted to 0.
  const gitCol = db.prepare("SELECT * FROM collections WHERE id = 'col-git'").get() as Record<
    string,
    unknown
  >;
  assert.equal(gitCol.name, "Team Bench");
  assert.equal(gitCol.repo_url, "https://github.com/acme/bench.git");
  assert.equal(gitCol.repo_path, "suites");
  assert.equal(gitCol.branch, "develop");
  assert.equal(gitCol.pat_encrypted, "enc:v1:tok", "the encrypted PAT survived the rebuild");
  assert.equal(gitCol.last_synced_sha, "deadbeef", "the last-synced sha survived the rebuild");
  assert.equal(gitCol.is_default, 0, "a git-bound collection is not the default");

  // (A2) MEMBERSHIP PRESERVED across the parent-table rebuild (test AND suite; FK not blanked).
  const member = db
    .prepare("SELECT collection_id, external_key FROM tests WHERE id = 't-member'")
    .get() as {
    collection_id: string | null;
    external_key: string | null;
  };
  assert.equal(member.collection_id, "col-git", "member test still bound to the git collection");
  assert.equal(member.external_key, "ek-member", "member test kept its external_key");
  const ownerSuite = db
    .prepare("SELECT collection_id, external_key FROM suites WHERE id = 's-owner'")
    .get() as {
    collection_id: string | null;
    external_key: string | null;
  };
  assert.equal(
    ownerSuite.collection_id,
    "col-git",
    "member suite still bound to the git collection",
  );
  assert.equal(ownerSuite.external_key, "ek-owner", "member suite kept its external_key");

  // (B) LOCAL EXISTS EXACTLY ONCE and is never repo-bound.
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

  // (C) LOOSE members re-homed to Local (no member left collection-less).
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
  assert.equal(
    (
      db.prepare("SELECT COUNT(*) AS n FROM tests WHERE collection_id IS NULL").get() as {
        n: number;
      }
    ).n,
    0,
    "no test left collection-less after the upgrade",
  );
  assert.equal(
    (
      db.prepare("SELECT COUNT(*) AS n FROM suites WHERE collection_id IS NULL").get() as {
        n: number;
      }
    ).n,
    0,
    "no suite left collection-less after the upgrade",
  );

  // (D) SUITE_RUNS SHAPE MIGRATED — the old row survived with suite_id intact; source/plan_json default NULL.
  assert.equal(notnullOf(db, "suite_runs", "suite_id"), 0, "suite_runs.suite_id is now nullable");
  const oldRun = db.prepare("SELECT * FROM suite_runs WHERE id = 'sr-old'").get() as Record<
    string,
    unknown
  >;
  assert.equal(oldRun.suite_id, "s-owner", "the pre-existing suite_run kept its owning suite id");
  assert.equal(oldRun.status, "completed", "the pre-existing suite_run kept its status");
  assert.equal(
    oldRun.config_snapshot_json,
    '{"repetitions":1,"maxConcurrency":8}',
    "kept its config snapshot",
  );
  assert.equal(oldRun.aggregates_json, '{"cellsTotal":1}', "kept its cached aggregates");
  assert.equal(oldRun.source, null, "a pre-v16 suite_run has NULL source after the rebuild");
  assert.equal(oldRun.plan_json, null, "a pre-v16 suite_run has NULL plan_json after the rebuild");
  // The suite_runs → suites ON DELETE CASCADE FK survived the rebuild.
  const suiteRunFks = db.prepare("PRAGMA foreign_key_list(suite_runs)").all() as Array<{
    table: string;
    on_delete: string;
  }>;
  assert.ok(
    suiteRunFks.some((fk) => fk.table === "suites" && fk.on_delete === "CASCADE"),
    "suite_runs keeps its ON DELETE CASCADE FK to suites",
  );
  // The now-nullable suite_id genuinely accepts a source-tagged ad-hoc suite_run (the D-T5 plan model).
  assert.doesNotThrow(() => {
    db.prepare(
      `INSERT INTO suite_runs (id, suite_id, status, config_snapshot_json, started_at, source, plan_json)
       VALUES ('sr-adhoc', NULL, 'completed', '{}', @now, 'adhoc', '{"source":"adhoc"}')`,
    ).run({ now: NOW });
  }, "the migrated suite_runs admits a suite-less, source-tagged ad-hoc row");

  // (E) FRESH DB SHAPE == UPGRADED DB SHAPE for both rebuilt tables.
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

  // (F) INTEGRATED / FUNCTIONAL — the migrated membership flows through the REAL run-plan resolver: a
  //     source:'collection' plan on the git-bound collection resolves to exactly its migrated member test,
  //     and a plan on Local resolves to the re-homed loose test. Proves the upgraded DB is runnable, not
  //     just correctly shaped. (Resolution reads persisted membership only — offline, no providers/git.)
  const secrets = new SecretStore(crypto.randomBytes(32));
  const collections = new CollectionRepository(db, secrets);
  const tests = new TestRepository(db);
  const suites = new SuiteRepository(db);
  const deps = {
    suites: new SuiteService(suites),
    collections: new CollectionService(collections),
    tests: new TestService(tests),
  };
  const gitPlan = resolveRunPlan(
    { source: "collection", collectionId: "col-git", scenarioIds: ["scn-x"] },
    deps,
  );
  assert.deepEqual(
    gitPlan.testIds,
    ["t-member"],
    "the git collection resolves to exactly its migrated member test",
  );
  assert.equal(gitPlan.suiteId, null, "a collection plan creates no owning suite");
  const localPlan = resolveRunPlan(
    { source: "collection", collectionId: local.id, scenarioIds: ["scn-x"] },
    deps,
  );
  assert.deepEqual(localPlan.testIds, ["t-loose"], "Local resolves to the re-homed loose test");
  // The redacted collection read is sound too: git-bound → isDefault false, Local → isDefault true, PAT hidden.
  assert.equal(
    deps.collections.get("col-git").isDefault,
    false,
    "git collection redacts to isDefault=false",
  );
  assert.equal(
    deps.collections.get("col-git").hasPat,
    true,
    "git collection reports it holds a PAT (value hidden)",
  );
  assert.equal(deps.collections.get(local.id).isDefault, true, "Local redacts to isDefault=true");

  // (G) IDEMPOTENT — a SECOND full open (migrate + seed) creates no second Local and changes no membership.
  db.exec(schemaSql);
  applyMigrations(db);
  ensureLocalCollection(db);
  assert.equal(
    (
      db.prepare("SELECT COUNT(*) AS n FROM collections WHERE is_default = 1").get() as {
        n: number;
      }
    ).n,
    1,
    "second open does NOT create a second Local",
  );
  assert.equal(
    (db.prepare("SELECT id FROM collections WHERE is_default = 1").get() as { id: string }).id,
    local.id,
    "the same Local row persists across a second open",
  );
  assert.equal(
    (
      db.prepare("SELECT collection_id FROM tests WHERE id = 't-member'").get() as {
        collection_id: string;
      }
    ).collection_id,
    "col-git",
    "second open leaves the git member untouched",
  );
  assert.equal(
    (
      db.prepare("SELECT collection_id FROM tests WHERE id = 't-loose'").get() as {
        collection_id: string;
      }
    ).collection_id,
    local.id,
    "second open leaves the re-homed loose test in Local",
  );
});
