import assert from "node:assert/strict";
import crypto from "node:crypto";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import type { Suite, Test } from "@mcp-token-footprint/shared";
import { CollectionRepository } from "../src/collections/repository.js";
import { serializeFile, suiteToFile, testToFile } from "../src/collections/serializer.js";
import { applyMigrations, type AppDatabase, ensureLocalCollection } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { SuiteRepository } from "../src/suites/repository.js";
import { TestRepository } from "../src/testing/test-repository.js";

// Testing IA (WP 2.3) — the additive collection-membership WRITE path on test/suite CRUD:
//   • create WITH `collectionId` → validated (404 if unknown) + member of it
//   • create WITHOUT `collectionId` → lands in the reserved default "Local" collection (never orphaned)
//   • update WITH `collectionId` → the "move"; update WITHOUT → membership preserved
//   • unknown `collectionId` (create or update) → 404
// …for BOTH tests and suites, and it proves the git-sync on-disk file shape is UNAFFECTED (membership
// is local identity and is never serialized to the repo file).

const databases: AppDatabase[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

type Env = {
  db: AppDatabase;
  collections: CollectionRepository;
  tests: TestRepository;
  suites: SuiteRepository;
  localId: string;
};

/** In-memory DB at the latest schema WITH the reserved Local collection seeded (mirrors openDatabase). */
function setup(): Env {
  const db = new Database(":memory:") as unknown as AppDatabase;
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  ensureLocalCollection(db); // seed the reserved, undeletable "Local" collection (D-T4)
  databases.push(db);

  const secrets = new SecretStore(crypto.randomBytes(32));
  const collections = new CollectionRepository(db, secrets);
  const tests = new TestRepository(db);
  const suites = new SuiteRepository(db);
  const local = collections.list().find((c) => c.isDefault);
  if (!local) throw new Error("test setup: reserved Local collection was not seeded");
  return { db, collections, tests, suites, localId: local.id };
}

/** The stored (collection_id, external_key) pair for a test row. */
function testMembership(
  db: AppDatabase,
  id: string,
): { collection_id: string | null; external_key: string | null } {
  return db.prepare("SELECT collection_id, external_key FROM tests WHERE id = ?").get(id) as {
    collection_id: string | null;
    external_key: string | null;
  };
}

/** The stored (collection_id, external_key) pair for a suite row. */
function suiteMembership(
  db: AppDatabase,
  id: string,
): { collection_id: string | null; external_key: string | null } {
  return db.prepare("SELECT collection_id, external_key FROM suites WHERE id = ?").get(id) as {
    collection_id: string | null;
    external_key: string | null;
  };
}

const suiteInput = (
  name: string,
  collectionId?: string,
): Parameters<SuiteRepository["create"]>[0] => ({
  name,
  config: { repetitions: 1, maxConcurrency: 1 },
  testIds: [],
  scenarioIds: [],
  ...(collectionId !== undefined ? { collectionId } : {}),
});

// ── TESTS ─────────────────────────────────────────────────────────────────────────────────────────

test("create a test WITH collectionId → it is a member of that collection", () => {
  const { db, collections, tests } = setup();
  const col = collections.create({ name: "Bench A" });

  const t = tests.create({ name: "T", userPrompt: "p", collectionId: col.id });

  assert.equal(
    testMembership(db, t.id).collection_id,
    col.id,
    "test lands in the requested collection",
  );
  // Read side (WP 2.3, for WP 3.1): the hydrated object exposes its membership.
  assert.equal(tests.get(t.id).collectionId, col.id, "GET reads back the collection id");
});

test("create a test WITHOUT collectionId → it lands in the default Local collection", () => {
  const { db, tests, localId } = setup();

  const t = tests.create({ name: "T", userPrompt: "p" });

  assert.equal(
    testMembership(db, t.id).collection_id,
    localId,
    "a plain create is never collection-less",
  );
  assert.equal(tests.get(t.id).collectionId, localId, "GET reads back Local's id for a plain test");
});

test("update a test's collectionId MOVES it; omitting collectionId PRESERVES membership", () => {
  const { db, collections, tests, localId } = setup();
  const col = collections.create({ name: "Bench A" });

  const t = tests.create({ name: "T", userPrompt: "p" }); // starts in Local
  assert.equal(testMembership(db, t.id).collection_id, localId, "precondition: starts in Local");

  // Move via update.
  tests.update(t.id, { name: "T", userPrompt: "p", collectionId: col.id });
  assert.equal(
    testMembership(db, t.id).collection_id,
    col.id,
    "update with collectionId moves the test",
  );
  assert.equal(
    tests.get(t.id).collectionId,
    col.id,
    "GET reads back the new collection after a move",
  );

  // Omitting collectionId on a later update keeps the current membership (does NOT null it).
  tests.update(t.id, { name: "T (edited)", userPrompt: "p2" });
  assert.equal(
    testMembership(db, t.id).collection_id,
    col.id,
    "update without collectionId preserves membership",
  );
});

test("create/update a test with an UNKNOWN collectionId → 404", () => {
  const { collections, tests } = setup();
  const col = collections.create({ name: "Bench A" });
  const t = tests.create({ name: "T", userPrompt: "p", collectionId: col.id });

  assert.throws(
    () => tests.create({ name: "T2", userPrompt: "p", collectionId: "does-not-exist" }),
    (e: unknown) =>
      (e as { statusCode?: number }).statusCode === 404 &&
      /Collection not found/.test(String((e as Error).message)),
    "create with an unknown collection 404s",
  );
  assert.throws(
    () => tests.update(t.id, { name: "T", userPrompt: "p", collectionId: "does-not-exist" }),
    (e: unknown) =>
      (e as { statusCode?: number }).statusCode === 404 &&
      /Collection not found/.test(String((e as Error).message)),
    "update with an unknown collection 404s",
  );
});

// ── SUITES ────────────────────────────────────────────────────────────────────────────────────────

test("create a suite WITH collectionId → it is a member of that collection", () => {
  const { db, collections, suites } = setup();
  const col = collections.create({ name: "Bench A" });

  const s = suites.create(suiteInput("S", col.id));

  assert.equal(
    suiteMembership(db, s.id).collection_id,
    col.id,
    "suite lands in the requested collection",
  );
  assert.equal(suites.get(s.id).collectionId, col.id, "GET reads back the collection id");
});

test("create a suite WITHOUT collectionId → it lands in the default Local collection", () => {
  const { db, suites, localId } = setup();

  const s = suites.create(suiteInput("S"));

  assert.equal(
    suiteMembership(db, s.id).collection_id,
    localId,
    "a plain create is never collection-less",
  );
  assert.equal(
    suites.get(s.id).collectionId,
    localId,
    "GET reads back Local's id for a plain suite",
  );
});

test("update a suite's collectionId MOVES it; omitting collectionId PRESERVES membership", () => {
  const { db, collections, suites, localId } = setup();
  const col = collections.create({ name: "Bench A" });

  const s = suites.create(suiteInput("S")); // starts in Local
  assert.equal(suiteMembership(db, s.id).collection_id, localId, "precondition: starts in Local");

  suites.update(s.id, suiteInput("S", col.id));
  assert.equal(
    suiteMembership(db, s.id).collection_id,
    col.id,
    "update with collectionId moves the suite",
  );
  assert.equal(
    suites.get(s.id).collectionId,
    col.id,
    "GET reads back the new collection after a move",
  );

  suites.update(s.id, suiteInput("S (edited)"));
  assert.equal(
    suiteMembership(db, s.id).collection_id,
    col.id,
    "update without collectionId preserves membership",
  );
});

test("create/update a suite with an UNKNOWN collectionId → 404", () => {
  const { collections, suites } = setup();
  const col = collections.create({ name: "Bench A" });
  const s = suites.create(suiteInput("S", col.id));

  assert.throws(
    () => suites.create(suiteInput("S2", "does-not-exist")),
    (e: unknown) =>
      (e as { statusCode?: number }).statusCode === 404 &&
      /Collection not found/.test(String((e as Error).message)),
    "create with an unknown collection 404s",
  );
  assert.throws(
    () => suites.update(s.id, suiteInput("S", "does-not-exist")),
    (e: unknown) =>
      (e as { statusCode?: number }).statusCode === 404 &&
      /Collection not found/.test(String((e as Error).message)),
    "update with an unknown collection 404s",
  );
});

// ── git-sync serialization is UNAFFECTED (membership never leaves the API) ───────────────────────────

test("collection membership is ABSENT from the exported on-disk test/suite file", () => {
  const { db, collections, tests, suites } = setup();
  const col = collections.create({ name: "Bench A" });

  // A test that IS a collection member (with a stamped external_key) still serializes WITHOUT any
  // collection identity in the on-disk file (only `externalKey` is the cross-system id).
  const created = tests.create({ name: "T", userPrompt: "p", collectionId: col.id });
  collections.assignTest(col.id, created.id); // stamp an external_key (git-export requires one)
  const testRow = testMembership(db, created.id);
  const test: Test = { ...tests.get(created.id), externalKey: testRow.external_key };
  // The hydrated object DOES now carry collectionId (read side) — proving the serializer, which builds
  // via testFileSchema, strips it rather than the object simply lacking the field.
  assert.equal(test.collectionId, col.id, "the hydrated Test carries its collection membership");
  const testFile = JSON.parse(serializeFile(testToFile(test))) as Record<string, unknown>;
  assert.equal("collectionId" in testFile, false, "test file carries no collectionId");
  assert.equal("collection_id" in testFile, false, "test file carries no collection_id");
  assert.ok(
    "externalKey" in testFile,
    "the file's cross-system id is externalKey, not the collection",
  );

  const createdSuite = suites.create(suiteInput("S", col.id));
  collections.assignSuite(col.id, createdSuite.id);
  const suiteRow = suiteMembership(db, createdSuite.id);
  const suite: Suite = { ...suites.get(createdSuite.id), externalKey: suiteRow.external_key };
  assert.equal(suite.collectionId, col.id, "the hydrated Suite carries its collection membership");
  const suiteFile = JSON.parse(serializeFile(suiteToFile(suite, []))) as Record<string, unknown>;
  assert.equal("collectionId" in suiteFile, false, "suite file carries no collectionId");
  assert.equal("collection_id" in suiteFile, false, "suite file carries no collection_id");
});
