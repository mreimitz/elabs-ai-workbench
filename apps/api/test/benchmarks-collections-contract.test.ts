import assert from "node:assert/strict";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, test } from "node:test";
import {
  COLLECTION_FILE_FORMAT_VERSION,
  type Suite,
  type Test,
  type TestFile,
  collectionInputSchema,
  suiteFileSchema,
  testFileSchema,
} from "@mcp-token-footprint/shared";
import { CollectionRepository } from "../src/collections/repository.js";
import {
  ATTACHMENTS_NOT_SYNCED_WARNING,
  fileToTestInput,
  serializeFile,
  suiteToFile,
  testToFile,
} from "../src/collections/serializer.js";
import { applyMigrations, LATEST_SCHEMA_VERSION, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { SecretStore } from "../src/secrets/secret-store.js";

// WP 4.1 (Benchmarks, B10/B12) — the collections wire contract + persistence (migration v15) + the
// DB-row ⇄ on-disk-file serializers. Everything here is ADDITIVE: every existing test/suite (its
// collection_id/external_key NULL) behaves exactly as before. The git ENGINE is WP 4.2 — not here.

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

function newSecretStore(): SecretStore {
  return new SecretStore(crypto.randomBytes(32));
}

function seedTest(db: AppDatabase, id: string): void {
  db.prepare(
    `INSERT INTO tests (id, name, user_prompt, created_at, updated_at)
     VALUES (@id, @name, 'Do the thing.', @now, @now)`,
  ).run({ id, name: `Test ${id}`, now: NOW });
}

function seedSuite(db: AppDatabase, id: string): void {
  db.prepare(
    `INSERT INTO suites (id, name, config_json, created_at, updated_at)
     VALUES (@id, @name, '{}', @now, @now)`,
  ).run({ id, name: `Suite ${id}`, now: NOW });
}

// ── (1) Collection CRUD round-trip; the PAT NEVER appears in any response ────────────────────────────

test("CollectionRepository CRUD round-trips and NEVER returns the PAT", () => {
  const db = openFresh();
  const secrets = newSecretStore();
  const repo = new CollectionRepository(db, secrets);

  const SECRET_PAT = "ghp_SUPERSECRET_pat_value_1234567890";
  const created = repo.create({
    name: "Team benchmarks",
    repoUrl: "https://github.com/acme/benchmarks.git",
    repoPath: "collections/core",
    branch: "main",
    pat: SECRET_PAT,
  });

  // The redacted shape carries hasPat but never the value / the encrypted blob.
  assert.equal(created.hasPat, true, "hasPat true when a PAT was supplied");
  assert.equal(created.name, "Team benchmarks");
  assert.equal(created.repoUrl, "https://github.com/acme/benchmarks.git");
  assert.equal(created.lastSyncedSha, null, "lastSyncedSha null before the first sync");
  assert.ok(!("pat" in created), "no `pat` key on the response");
  assert.ok(!("patEncrypted" in created), "no `patEncrypted` key on the response");
  assert.ok(!("pat_encrypted" in created), "no `pat_encrypted` key on the response");

  // Grep the serialized response for the secret string (and any encrypted-blob prefix) → absent.
  const responseJson = JSON.stringify([repo.get(created.id), ...repo.list()]);
  assert.ok(!responseJson.includes(SECRET_PAT), "the raw PAT never appears in any response JSON");
  assert.ok(
    !responseJson.includes("enc:v1"),
    "the encrypted PAT blob never appears in any response JSON",
  );

  // The PAT IS stored (encrypted) and recoverable only via the internal decryptPat.
  assert.equal(
    repo.decryptPat(created.id),
    SECRET_PAT,
    "decryptPat (internal) recovers the stored PAT",
  );

  // Update WITHOUT a pat keeps the stored one; the response still redacts it.
  const renamed = repo.update(created.id, {
    name: "Team benchmarks (renamed)",
    repoUrl: "https://github.com/acme/benchmarks.git",
    repoPath: "collections/core",
    branch: "develop",
  });
  assert.equal(renamed.name, "Team benchmarks (renamed)");
  assert.equal(renamed.branch, "develop");
  assert.equal(renamed.hasPat, true, "omitting pat on update keeps hasPat true");
  assert.equal(
    repo.decryptPat(created.id),
    SECRET_PAT,
    "omitting pat on update keeps the stored PAT",
  );

  // Update WITH a new pat rotates it.
  const NEW_PAT = "ghp_ROTATED_pat_0987654321";
  repo.update(created.id, {
    name: "Team benchmarks (renamed)",
    repoUrl: "https://github.com/acme/benchmarks.git",
    repoPath: "collections/core",
    branch: "develop",
    pat: NEW_PAT,
  });
  assert.equal(
    repo.decryptPat(created.id),
    NEW_PAT,
    "supplying a pat on update rotates the stored PAT",
  );

  // Delete removes it (and 404s on a second delete / on decrypt).
  repo.delete(created.id);
  assert.throws(() => repo.get(created.id), /Collection not found/);
  assert.throws(() => repo.delete(created.id), /Collection not found/);
});

// ── (2) Serializer determinism / golden file: byte-stable, key-sorted, NO local refs ─────────────────

/** A fully-populated test fixture whose LOCAL ids/timestamps must NOT leak into the file. */
function fixtureTest(): Test {
  return {
    id: "test-local-123",
    name: "Revenue by region",
    userPrompt: "What is total revenue by region?",
    systemPromptOverride: "Be concise.",
    addedProfiles: ["generic_o200k", "generic_cl100k"],
    attachments: [],
    expectations: {
      expectedInsight: "APAC leads revenue.",
      expectedValue: { top: "APAC", amount: 1200000 },
      referenceLogic: {
        kind: "code",
        language: "python",
        body: "df.groupby('region').revenue.sum()",
      },
      answerable: true,
    },
    category: "aggregation",
    difficulty: "medium",
    tags: ["revenue", "regions"],
    collectionId: "col-local-999",
    externalKey: "ext-abc123",
    createdAt: NOW,
    updatedAt: NOW,
  };
}

const GOLDEN_TEST_FILE = `{
  "addedProfiles": [
    "generic_o200k",
    "generic_cl100k"
  ],
  "category": "aggregation",
  "difficulty": "medium",
  "expectations": {
    "answerable": true,
    "expectedInsight": "APAC leads revenue.",
    "expectedValue": {
      "amount": 1200000,
      "top": "APAC"
    },
    "referenceLogic": {
      "body": "df.groupby('region').revenue.sum()",
      "kind": "code",
      "language": "python"
    }
  },
  "externalKey": "ext-abc123",
  "formatVersion": 1,
  "name": "Revenue by region",
  "systemPromptOverride": "Be concise.",
  "tags": [
    "revenue",
    "regions"
  ],
  "userPrompt": "What is total revenue by region?"
}
`;

test("serializeFile(testToFile(...)) is byte-stable, key-sorted, and leaks NO local refs (golden)", () => {
  const serialized = serializeFile(testToFile(fixtureTest()));

  assert.equal(serialized, GOLDEN_TEST_FILE, "matches the golden file byte-for-byte");
  assert.equal(serialized.endsWith("}\n"), true, "ends with a trailing newline");
  // Running twice is byte-identical (determinism).
  assert.equal(serialize2x(), serialized, "serializing twice yields identical bytes");

  // NO local id / collection id / timestamp / attachment path appears in the file.
  for (const forbidden of [
    "test-local-123",
    "col-local-999",
    NOW,
    "createdAt",
    "updatedAt",
    "collectionId",
    '"id"',
  ]) {
    assert.ok(!serialized.includes(forbidden), `the file must not leak ${forbidden}`);
  }

  // And the emitted file re-validates against the on-disk zod schema (WP 4.2 reads it back).
  const parsed = testFileSchema.parse(JSON.parse(serialized));
  assert.equal(parsed.formatVersion, COLLECTION_FILE_FORMAT_VERSION);
  assert.equal(parsed.externalKey, "ext-abc123");
});

function serialize2x(): string {
  return serializeFile(testToFile(fixtureTest()));
}

// ── (3) Round-trip lossless: fileToTestInput(testToFile(t)) reproduces every SYNCED field ────────────

test("fileToTestInput(testToFile(t)) round-trips every synced field losslessly", () => {
  const t = fixtureTest();
  const roundTripped = fileToTestInput(testToFile(t));

  assert.equal(roundTripped.name, t.name);
  assert.equal(roundTripped.userPrompt, t.userPrompt);
  assert.equal(roundTripped.systemPromptOverride, t.systemPromptOverride);
  assert.deepEqual(roundTripped.addedProfiles, t.addedProfiles);
  assert.deepEqual(roundTripped.tags, t.tags);
  assert.equal(roundTripped.category, t.category);
  assert.equal(roundTripped.difficulty, t.difficulty);
  // Expectations (incl. structured expectedValue + referenceLogic) survive intact.
  assert.deepEqual(roundTripped.expectations, t.expectations);
  assert.deepEqual(roundTripped.expectations?.referenceLogic, {
    kind: "code",
    language: "python",
    body: "df.groupby('region').revenue.sum()",
  });
  // The local identity never round-trips into the input (adopted separately by the repository).
  assert.ok(
    !("collectionId" in roundTripped),
    "collectionId is not part of the reconstructed input",
  );
  assert.ok(!("externalKey" in roundTripped), "externalKey is not part of the reconstructed input");
});

// ── (4) Attachments → a `warnings` marker, and NO attachment bytes/paths in the file ─────────────────

test("a test with attachments serializes with the attachments-not-synced warning and no attachment data", () => {
  const t = fixtureTest();
  t.attachments = [
    { id: "att-local-1", kind: "file", name: "sales-2025.csv", bytes: 4096, createdAt: NOW },
  ];

  const file: TestFile = testToFile(t);
  assert.deepEqual(
    file.warnings,
    [ATTACHMENTS_NOT_SYNCED_WARNING],
    "warnings marks the un-synced attachments",
  );

  const serialized = serializeFile(file);
  for (const forbidden of ["att-local-1", "sales-2025.csv", "4096"]) {
    assert.ok(
      !serialized.includes(forbidden),
      `attachment data (${forbidden}) must never be written`,
    );
  }
  // The serialized file still validates (warnings is part of the on-disk shape).
  assert.doesNotThrow(() => testFileSchema.parse(JSON.parse(serialized)));
});

// ── (5) Migration v15: fresh DB has collections + the membership columns; LATEST is 15; pre-v15 forward ─

test("migration v15 — fresh DB has collections + tests/suites membership columns; LATEST is 15", () => {
  assert.equal(
    LATEST_SCHEMA_VERSION,
    55,
    "LATEST_SCHEMA_VERSION auto-derived to 55 (v19 suite-run member index + v20 assistant tables + v21 assistant_settings + v22 suite_run_reports + v23 provider_credentials server link + v24 scenarios.answers_mode + v25 server_types + v26 rating_issues + v27 rating_state + v28 provider_credentials claude_subscription kind + v29 runs.cost_basis + v30 rating_issue_occurrences concrete evidence + v31 unified-sessions runs columns + v32 observability metrics indexes; v33 observability FTS5 search index + v34 run_views + v35 runs.pinned + v36 run_feedback + v37 run_steps hierarchy + v38 watch_rules + v39 watch_rules.last_evaluated_at + v40 notifications + v41 fleet issue aggregation + v42 runs fork lineage + v43 digest reports + v44 model pricing + v45 dashboard charts + v46 review_rubrics; v47 = hub_* tables, Assistant Hub WP0.2; v48 = hub_session_skills, Assistant Hub WP2.4; v49 = hub_memory.scope/scope_id + hub_agents.display_name + hub_crews.color + hub_sessions.archived_at, Assistant Hub UX WP1.0s; v50 = hub_sessions.tool_scope_json, end-user UX pass; v51 = hub_sessions.mode auto; v52 = hub_sessions.roster_json; v53 = hub_crews.icon, agent/crew avatar icons; v54 = hub_missions.parent_mission_id/depth/root_mission_id, crew-nesting mission-tree lineage; v55 = hub_sessions/hub_agents.provider_credential_id, model identity D-MI1)",
  );

  const db = openFresh();
  assert.equal(
    db.pragma("user_version", { simple: true }),
    LATEST_SCHEMA_VERSION,
    "fresh DB stamped at the latest",
  );

  assert.ok(tableExists(db, "collections"), "collections table present on a fresh DB");
  const testCols = columns(db, "tests");
  assert.ok(testCols.includes("collection_id"), "tests.collection_id present");
  assert.ok(testCols.includes("external_key"), "tests.external_key present");
  const suiteCols = columns(db, "suites");
  assert.ok(suiteCols.includes("collection_id"), "suites.collection_id present");
  assert.ok(suiteCols.includes("external_key"), "suites.external_key present");
});

test("applyMigrations brings a rewound pre-v15 DB forward (collections + membership columns)", () => {
  const db = track(new Database(":memory:"));
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);

  // Simulate a DB that predates v15: drop the collections table + the four membership columns, then
  // rewind the version stamp to 14. (Mirrors benchmarks-suites-contract.test.ts's rewind approach.)
  db.exec("DROP INDEX IF EXISTS idx_tests_extkey; DROP INDEX IF EXISTS idx_suites_extkey;");
  db.exec(
    "ALTER TABLE tests DROP COLUMN collection_id; ALTER TABLE tests DROP COLUMN external_key;",
  );
  db.exec(
    "ALTER TABLE suites DROP COLUMN collection_id; ALTER TABLE suites DROP COLUMN external_key;",
  );
  db.exec("DROP TABLE collections;");
  db.pragma("user_version = 14");
  assert.equal(
    tableExists(db, "collections"),
    false,
    "sanity: collections is gone before migrating",
  );
  assert.equal(
    columns(db, "tests").includes("collection_id"),
    false,
    "sanity: tests.collection_id gone",
  );

  applyMigrations(db);

  assert.equal(
    db.pragma("user_version", { simple: true }),
    LATEST_SCHEMA_VERSION,
    "version advanced to the latest",
  );
  assert.ok(tableExists(db, "collections"), "collections recreated by v15");
  assert.ok(columns(db, "tests").includes("collection_id"), "tests.collection_id re-added by v15");
  assert.ok(columns(db, "tests").includes("external_key"), "tests.external_key re-added by v15");
  assert.ok(
    columns(db, "suites").includes("collection_id"),
    "suites.collection_id re-added by v15",
  );
  assert.ok(columns(db, "suites").includes("external_key"), "suites.external_key re-added by v15");
});

// ── INVARIANT — deleting a collection sets its members' collection_id → NULL (they go local-only) ─────

test("deleting a collection sets member tests'/suites' collection_id + external_key to NULL", () => {
  const db = openFresh();
  const repo = new CollectionRepository(db, newSecretStore());
  seedTest(db, "t1");
  seedSuite(db, "s1");

  const collection = repo.create({
    name: "Deletable",
    repoUrl: "https://github.com/acme/x.git",
    repoPath: ".",
    branch: "main",
  });
  repo.assignTest(collection.id, "t1");
  repo.assignSuite(collection.id, "s1");

  // Sanity: both are members with a stamped external_key.
  const beforeTest = db
    .prepare("SELECT collection_id, external_key FROM tests WHERE id = 't1'")
    .get() as {
    collection_id: string | null;
    external_key: string | null;
  };
  assert.equal(beforeTest.collection_id, collection.id);
  assert.ok(beforeTest.external_key, "assigning stamped an external_key");

  repo.delete(collection.id);

  const afterTest = db
    .prepare("SELECT collection_id, external_key FROM tests WHERE id = 't1'")
    .get() as {
    collection_id: string | null;
    external_key: string | null;
  };
  const afterSuite = db
    .prepare("SELECT collection_id, external_key FROM suites WHERE id = 's1'")
    .get() as {
    collection_id: string | null;
    external_key: string | null;
  };
  // The member rows SURVIVE (they are not deleted) but become local-only again.
  assert.ok(afterTest, "the test row is NOT deleted with its collection");
  assert.equal(
    afterTest.collection_id,
    null,
    "test.collection_id set to NULL on collection delete",
  );
  assert.equal(afterTest.external_key, null, "test.external_key cleared on collection delete");
  assert.equal(
    afterSuite.collection_id,
    null,
    "suite.collection_id set to NULL on collection delete",
  );
  assert.equal(afterSuite.external_key, null, "suite.external_key cleared on collection delete");
});

// ── (6) Re-key on move: assigning to a different collection re-keys with no unique-index violation ────

test("moving a test between collections re-keys its external_key (no unique-index collision)", () => {
  const db = openFresh();
  const repo = new CollectionRepository(db, newSecretStore());
  seedTest(db, "t1");

  const colA = repo.create({
    name: "A",
    repoUrl: "https://github.com/acme/a.git",
    repoPath: ".",
    branch: "main",
  });
  const colB = repo.create({
    name: "B",
    repoUrl: "https://github.com/acme/b.git",
    repoPath: ".",
    branch: "main",
  });

  repo.assignTest(colA.id, "t1");
  const kA = db.prepare("SELECT collection_id, external_key FROM tests WHERE id = 't1'").get() as {
    collection_id: string;
    external_key: string;
  };
  assert.equal(kA.collection_id, colA.id);

  // Move to B: no throw (unique index is scoped per-collection), and the key is fresh.
  assert.doesNotThrow(
    () => repo.assignTest(colB.id, "t1"),
    "re-assigning to another collection does not collide",
  );
  const kB = db.prepare("SELECT collection_id, external_key FROM tests WHERE id = 't1'").get() as {
    collection_id: string;
    external_key: string;
  };
  assert.equal(kB.collection_id, colB.id, "membership moved to collection B");
  assert.notEqual(kB.external_key, kA.external_key, "the external_key was re-keyed on the move");

  // Removing clears both columns → local-only.
  repo.removeTest("t1");
  const cleared = db
    .prepare("SELECT collection_id, external_key FROM tests WHERE id = 't1'")
    .get() as {
    collection_id: string | null;
    external_key: string | null;
  };
  assert.equal(cleared.collection_id, null);
  assert.equal(cleared.external_key, null);
});

// ── collectionInputSchema + suiteFileSchema guards (contract sanity) ──────────────────────────────────

test("collectionInputSchema requires a name + a valid URL; suiteFileSchema mirrors the on-disk shape", () => {
  assert.throws(
    () =>
      collectionInputSchema.parse({
        name: "  ",
        repoUrl: "https://x.example/r.git",
        repoPath: ".",
        branch: "main",
      }),
    "blank name rejected",
  );
  assert.throws(
    () =>
      collectionInputSchema.parse({
        name: "C",
        repoUrl: "not a url",
        repoPath: ".",
        branch: "main",
      }),
    "invalid repoUrl rejected",
  );
  const ok = collectionInputSchema.parse({
    name: "C",
    repoUrl: "https://x.example/r.git",
    repoPath: ".",
    branch: "main",
  });
  assert.equal(ok.pat, undefined, "pat is optional");

  // A suite file round-trips through the schema (ordered externalKey refs, config carried).
  const suite: Suite = {
    id: "s-local",
    name: "Nightly",
    config: { repetitions: 2, maxConcurrency: 3 },
    testIds: ["t-local-1", "t-local-2"],
    scenarioIds: ["scn-local"],
    externalKey: "ext-suite-1",
    createdAt: NOW,
    updatedAt: NOW,
  };
  const file = suiteToFile(suite, ["ext-t-1", "ext-t-2"]);
  assert.deepEqual(
    file.testExternalKeys,
    ["ext-t-1", "ext-t-2"],
    "member refs are externalKeys, not local ids",
  );
  const serialized = serializeFile(file);
  assert.ok(!serialized.includes("t-local-1"), "the suite file must not leak local test ids");
  assert.ok(!serialized.includes("scn-local"), "the suite file must not leak local scenario ids");
  assert.doesNotThrow(
    () => suiteFileSchema.parse(JSON.parse(serialized)),
    "the suite file validates on read-back",
  );
});
