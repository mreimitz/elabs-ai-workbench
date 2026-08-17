import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { afterEach, test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { CollectionRepository } from "../src/collections/repository.js";
import * as importModule from "../src/collections/insightbench-import.js";
import {
  InsightBenchImporter,
  isUnanswerableInsight,
  mapDifficultyLevel,
} from "../src/collections/insightbench-import.js";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { SuiteRepository } from "../src/suites/repository.js";
import { TestRepository } from "../src/testing/test-repository.js";

// WP 4.4 (Benchmarks, B13) — one-way InsightBench import. Offline; drives the importer against the
// trimmed real questions.json fixture. Import ONLY: there is deliberately NO exporter (assert #4).

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(here, "fixtures", "insightbench-questions-sample.json");

const databases: AppDatabase[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

/** A fresh in-memory DB at the latest schema (mirrors openDatabase()). */
function openFresh(): AppDatabase {
  const db: AppDatabase = new Database(":memory:");
  databases.push(db);
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  return db;
}

function loadFixture(): unknown {
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
}

function makeImporter(db: AppDatabase): {
  importer: InsightBenchImporter;
  tests: TestRepository;
  suites: SuiteRepository;
  collections: CollectionRepository;
} {
  const tests = new TestRepository(db);
  const suites = new SuiteRepository(db);
  const collections = new CollectionRepository(db, new SecretStore(crypto.randomBytes(32)));
  return {
    importer: new InsightBenchImporter(tests, suites, collections),
    tests,
    suites,
    collections,
  };
}

// ── (1) full mapping — counts, ordering, the difficulty-4 spot-check, tags carry the app name ────────

test("imports the fixture → 5 tests + 1 suite, ordered; the hard question maps its full expectations", () => {
  const db = openFresh();
  const { importer, tests, suites } = makeImporter(db);

  const result = importer.importQuestions({ questions: loadFixture() });

  // 5 questions across 3 apps → 5 tests created, 0 skipped, one suite.
  assert.equal(result.created, 5, "5 questions → 5 tests created");
  assert.equal(result.skipped, 0, "nothing skipped on a first import");
  assert.equal(result.testIds.length, 5, "testIds carries the 5 created ids");
  assert.ok(result.suiteId, "a suite was created");

  // The suite membership is the 5 tests, ordered by app then question (flag-1, flag-3 ×2, flag-82 ×2).
  const suite = suites.get(result.suiteId);
  assert.equal(suite.testIds.length, 5, "suite has all 5 tests");
  assert.deepEqual(
    suite.testIds,
    result.testIds,
    "suite membership matches the created tests in order",
  );
  assert.equal(suite.scenarioIds.length, 0, "no default scenarios attached");

  const ordered = suite.testIds.map((id) => tests.get(id));
  assert.deepEqual(
    ordered.map((t) => t.userPrompt),
    [
      "What is the distribution of incidents across all categories?",
      "What is the distribution of incidents assigned to each human agent?",
      "Is there a specific human agent who is assigned significantly more incidents than others?",
      "How does the success rate of goals met across different categories compare?",
      "How do cross-departmental tasks compare to non-cross-departmental tasks in terms of completion and target achievement percentages?",
    ],
    "tests are ordered by app then question",
  );

  // Spot-check the difficulty-4 (flag-1) question: full expectations incl. the exact gt_code body.
  const hard = ordered[0];
  assert.ok(hard, "the first (flag-1) test exists");
  assert.equal(
    hard.name,
    "What is the distribution of incidents across all categories?",
  );
  assert.equal(hard.difficulty, "hard", "difficulty_level 4 → hard");
  assert.equal(hard.category, "descriptive", "category taken from the question type");
  assert.deepEqual(hard.tags, ["flag-1"], "tags carry the app name");
  assert.deepEqual(
    hard.expectations,
    {
      expectedInsight: "hardware incidents is significantly higher than others",
      expectedValue: { x_val: "Hardware", y_val: 336 },
      referenceLogic: {
        kind: "code",
        language: "python",
        body: 'df.groupby("category").size().plot(kind="barh")',
      },
      answerable: true,
    },
    "gt_insight/gt_insight_value/gt_code map to expectations; answerable true",
  );

  // The flag-3 easy questions map difficulty_level 2 → easy and carry their gt_code.
  const easy = ordered[1];
  assert.ok(easy);
  assert.equal(easy.difficulty, "easy", "difficulty_level 2 → easy");
  assert.deepEqual(easy.tags, ["flag-3"]);
  assert.equal(
    easy.expectations?.referenceLogic?.body,
    'df.groupby("assigned_to").size().plot(kind="barh")',
    "flag-3 gt_code carried into referenceLogic",
  );
  assert.equal(easy.expectations?.answerable, true);
});

// ── (2) unanswerable-insight detection → answerable:false, and no fabricated referenceLogic ──────────

test("a GT insight that trips the unanswerable regex → expectations.answerable === false", () => {
  const db = openFresh();
  const { importer, tests, suites } = makeImporter(db);

  const result = importer.importQuestions({ questions: loadFixture() });
  const ordered = suites.get(result.suiteId).testIds.map((id) => tests.get(id));

  // The two flag-82 questions ("There was no column ... to conduct any analysis") are unanswerable.
  const unanswerable = ordered.filter((t) => t.tags.includes("flag-82"));
  assert.equal(unanswerable.length, 2, "both flag-82 questions imported");
  for (const t of unanswerable) {
    assert.equal(t.expectations?.answerable, false, `${t.userPrompt} → answerable false`);
    assert.equal(t.expectations?.referenceLogic, undefined, "no gt_code → no referenceLogic");
    assert.equal(
      t.expectations?.expectedValue,
      undefined,
      "empty gt_insight_value → no expectedValue",
    );
  }

  // The answerable (flag-1 / flag-3) questions stay answerable true.
  for (const t of ordered.filter((x) => !x.tags.includes("flag-82"))) {
    assert.equal(t.expectations?.answerable, true, `${t.userPrompt} stays answerable`);
  }

  // Unit-level: the ported helper + difficulty map behave as specified.
  assert.equal(isUnanswerableInsight("There was no column end_date to conduct any analysis"), true);
  assert.equal(isUnanswerableInsight("missing 'department' column"), true);
  assert.equal(isUnanswerableInsight("The pandas analysis raised a KeyError"), true);
  assert.equal(isUnanswerableInsight("Hardware incidents are the highest"), false);
  assert.equal(mapDifficultyLevel(1), "easy");
  assert.equal(mapDifficultyLevel(2), "easy");
  assert.equal(mapDifficultyLevel(3), "medium");
  assert.equal(mapDifficultyLevel(4), "hard");
  assert.equal(mapDifficultyLevel(9), undefined);
});

// ── (3) idempotent re-import — the second import creates 0 new tests, no duplicate suite ─────────────

test("re-importing the same fixture is idempotent (0 new tests, existing suite reused)", () => {
  const db = openFresh();
  const { importer, tests, suites } = makeImporter(db);

  const first = importer.importQuestions({ questions: loadFixture() });
  assert.equal(first.created, 5);

  const second = importer.importQuestions({ questions: loadFixture() });
  assert.equal(second.created, 0, "second import creates NO new tests");
  assert.equal(second.skipped, 5, "all 5 questions skipped as duplicates");
  assert.equal(second.testIds.length, 0, "no created ids on the deduped re-import");
  assert.equal(second.suiteId, first.suiteId, "the existing suite is reused, not duplicated");

  // No duplicates persisted: still exactly 5 tests and 1 suite in the DB.
  assert.equal(tests.list().length, 5, "still 5 tests after re-import");
  assert.equal(suites.list().length, 1, "still 1 suite after re-import");
});

// ── (3b) collection assignment on import + idempotence with a collection ─────────────────────────────

test("importing into a collection assigns the tests + suite; a re-import stays idempotent", () => {
  const db = openFresh();
  const { importer, tests, suites, collections } = makeImporter(db);

  const collection = collections.create({
    name: "InsightBench",
    repoUrl: "https://github.com/acme/bench.git",
    repoPath: ".",
    branch: "main",
  });

  const first = importer.importQuestions({ collectionId: collection.id, questions: loadFixture() });
  // Membership lives on the tests/suites rows (collection_id + external_key). The TestRepository does
  // not surface those columns, so read the rows directly (mirrors benchmarks-collections-contract).
  const memberRow = (id: string) =>
    db.prepare("SELECT collection_id, external_key FROM tests WHERE id = ?").get(id) as {
      collection_id: string | null;
      external_key: string | null;
    };
  for (const t of tests.list()) {
    const row = memberRow(t.id);
    assert.equal(
      row.collection_id,
      collection.id,
      "each imported test is a member of the collection",
    );
    assert.ok(row.external_key, "membership stamped a cross-system external_key");
  }
  const suiteRow = db
    .prepare("SELECT collection_id FROM suites WHERE id = ?")
    .get(first.suiteId) as {
    collection_id: string | null;
  };
  assert.equal(suiteRow.collection_id, collection.id, "the suite is in the collection");

  const second = importer.importQuestions({
    collectionId: collection.id,
    questions: loadFixture(),
  });
  assert.equal(second.created, 0);
  assert.equal(second.suiteId, first.suiteId);
  assert.equal(tests.list().length, 5, "no duplicate tests");
  assert.equal(suites.list().length, 1, "no duplicate suites");
});

// ── (4) IMPORT IS ONE-WAY — the module exposes no exporter / serialize-to-his-format function ────────

test("the importer module exposes NO exporter (import is strictly one-way)", () => {
  const exportedNames = Object.keys(importModule);
  const forbidden = /export|toquestions|serialize|tojson|write.*question|dump/i;
  const offenders = exportedNames.filter((name) => forbidden.test(name));
  assert.deepEqual(
    offenders,
    [],
    `no export-to-his-format function may exist (found: ${offenders.join(", ")})`,
  );

  // Positive sanity: the module DOES expose the importer + the ported mapping helpers.
  assert.equal(
    typeof importModule.InsightBenchImporter,
    "function",
    "the importer class is exported",
  );
  assert.equal(
    typeof importModule.isUnanswerableInsight,
    "function",
    "the unanswerable helper is exported",
  );
  assert.ok(importModule.DIFF_LEVEL_MAP, "the difficulty map is exported");
});
