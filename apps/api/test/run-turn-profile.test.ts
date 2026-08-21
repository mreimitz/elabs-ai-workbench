import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { RunRepository, turnProfilePairKey } from "../src/testing/run-repository.js";

// RM-34 WP 1.1 — `RunRepository.measureTurnProfiles`, the read that replaces the estimator's guessed
// turn band with the app's own history. Every test here is over a REAL SQLite schema; no provider
// key, no MCP, no network.
//
// The four rules this measurement lives or dies by, each with its own test below:
//
//   D-ET3   completed runs only — a stopped/error run's turn count measures the interruption
//   turns>0 a completed zero-turn row would divide by zero, not measure anything
//   nearest-rank percentiles — every band end is a turn count some run actually took
//   D-ET4   output tokens per turn is Σ tokens_out ÷ Σ turns, NOT the mean of per-run ratios
//
// Break any one of them and exactly one test here goes red. That is the point.

const databases: AppDatabase[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

const NOW = "2026-08-21T00:00:00.000Z";

type SeedRun = {
  environmentId: string;
  testId: string;
  status: string;
  turns: number;
  tokensOut?: number;
};

type Harness = { db: AppDatabase; runs: RunRepository };

/** A DB with the environments/tests the seeded runs reference, plus the runs themselves. */
function makeHarness(seed: SeedRun[]): Harness {
  const db = new Database(":memory:") as unknown as AppDatabase;
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  databases.push(db);

  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, created_at, updated_at)
     VALUES ('prov-1', 'anthropic', 'Claude', @now, @now)`,
  ).run({ now: NOW });

  const insertEnvironment = db.prepare(
    `INSERT INTO scenarios (id, name, provider_id, model, created_at, updated_at)
     VALUES (@id, @id, 'prov-1', 'claude-sonnet-4-6', @now, @now)`,
  );
  const insertTest = db.prepare(
    `INSERT INTO tests (id, name, user_prompt, created_at, updated_at)
     VALUES (@id, @id, 'Use the tools.', @now, @now)`,
  );
  for (const id of new Set(seed.map((run) => run.environmentId))) {
    insertEnvironment.run({ id, now: NOW });
  }
  for (const id of new Set(seed.map((run) => run.testId))) insertTest.run({ id, now: NOW });

  const insertRun = db.prepare(
    `INSERT INTO runs (id, test_id, scenario_id, mode, status, started_at, turns, tokens_out)
     VALUES (@id, @testId, @environmentId, 'automated', @status, @now, @turns, @tokensOut)`,
  );
  seed.forEach((run, index) => {
    insertRun.run({
      id: `run-${index}`,
      testId: run.testId,
      environmentId: run.environmentId,
      status: run.status,
      turns: run.turns,
      tokensOut: run.tokensOut ?? run.turns * 100,
      now: NOW,
    });
  });

  return { db, runs: new RunRepository(db) };
}

/** The one pair every single-environment test measures. */
const KEY = { environmentId: "env-1", testId: "test-1" };

// ── D-ET3 — completed runs only ──────────────────────────────────────────────────────────────────

test("a stopped run's 40 turns never enters the band — completed only (D-ET3)", () => {
  const { runs } = makeHarness([
    { ...KEY, status: "completed", turns: 5 },
    { ...KEY, status: "completed", turns: 6 },
    { ...KEY, status: "completed", turns: 7 },
    // Cut short at 40 turns. Including it would put the p90 at 40 and the whole preview with it.
    { ...KEY, status: "stopped", turns: 40 },
  ]);

  const sample = runs.measureTurnProfiles([KEY]).pair.get(turnProfilePairKey(KEY));

  assert.ok(sample, "the pair was measured");
  assert.equal(sample.sampleSize, 3, "three completed runs, not four");
  assert.deepEqual(sample.turns, { low: 5, mid: 6, high: 7 });
});

test("error and aborted runs are excluded too — the rule is the status, not the outlier", () => {
  const { runs } = makeHarness([
    { ...KEY, status: "completed", turns: 8 },
    { ...KEY, status: "completed", turns: 9 },
    { ...KEY, status: "completed", turns: 10 },
    { ...KEY, status: "error", turns: 1 }, // an error run dies early: biases the band LOW
    { ...KEY, status: "aborted", turns: 2 },
    { ...KEY, status: "ended", turns: 30 },
  ]);

  const sample = runs.measureTurnProfiles([KEY]).pair.get(turnProfilePairKey(KEY));

  assert.ok(sample);
  assert.equal(sample.sampleSize, 3);
  assert.deepEqual(sample.turns, { low: 8, mid: 9, high: 10 });
});

// ── the turns > 0 guard ──────────────────────────────────────────────────────────────────────────

test("a completed zero-turn run is excluded and the output mean stays finite", () => {
  const { runs } = makeHarness([
    // `runs.turns` defaults to 0 and nothing constrains it; this row would divide by zero.
    { ...KEY, status: "completed", turns: 0, tokensOut: 500 },
    { ...KEY, status: "completed", turns: 4, tokensOut: 4_000 },
    { ...KEY, status: "completed", turns: 6, tokensOut: 6_000 },
  ]);

  const sample = runs.measureTurnProfiles([KEY]).pair.get(turnProfilePairKey(KEY));

  assert.ok(sample);
  assert.equal(sample.sampleSize, 2, "the zero-turn row is not a measurement");
  assert.equal(Number.isFinite(sample.outputTokensPerTurn), true);
  assert.equal(sample.outputTokensPerTurn, 1_000, "10,000 tokens over 10 turns");
  assert.deepEqual(sample.turns, { low: 4, mid: 4, high: 6 });
});

test("an environment whose only completed run has zero turns measures nothing at all", () => {
  const { runs } = makeHarness([{ ...KEY, status: "completed", turns: 0, tokensOut: 900 }]);

  const samples = runs.measureTurnProfiles([KEY]);

  assert.equal(samples.pair.size, 0);
  assert.equal(samples.environment.size, 0);
  assert.equal(samples.global, null, "no usable history ⇒ the D-ET1 constants are the answer");
});

// ── nearest-rank percentiles ─────────────────────────────────────────────────────────────────────

test("percentiles are NEAREST-RANK at n = 3 — the floor sample reports min / median / max", () => {
  const { runs } = makeHarness([
    { ...KEY, status: "completed", turns: 5 },
    { ...KEY, status: "completed", turns: 6 },
    { ...KEY, status: "completed", turns: 7 },
  ]);

  const sample = runs.measureTurnProfiles([KEY]).pair.get(turnProfilePairKey(KEY));

  assert.ok(sample);
  // Interpolated, these would be 5.2 / 6 / 6.8 — turn counts no run ever took.
  assert.deepEqual(sample.turns, { low: 5, mid: 6, high: 7 });
});

test("percentiles are NEAREST-RANK at n = 10 — ranks 1 / 5 / 9, never a midpoint", () => {
  const { runs } = makeHarness(
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((turns) => ({ ...KEY, status: "completed", turns })),
  );

  const sample = runs.measureTurnProfiles([KEY]).pair.get(turnProfilePairKey(KEY));

  assert.ok(sample);
  assert.equal(sample.sampleSize, 10);
  // Interpolated, these would be 1.9 / 5.5 / 9.1. Nearest-rank keeps every end a real observation.
  assert.deepEqual(sample.turns, { low: 1, mid: 5, high: 9 });
});

test("insertion order cannot change the band — the sample is sorted before it is read", () => {
  const shuffled = [7, 2, 19, 5, 11, 3, 6, 9, 4, 8];
  const { runs } = makeHarness(shuffled.map((turns) => ({ ...KEY, status: "completed", turns })));

  const sample = runs.measureTurnProfiles([KEY]).pair.get(turnProfilePairKey(KEY));

  assert.ok(sample);
  // ascending: 2 3 4 5 6 7 8 9 11 19 → ranks 1 / 5 / 9.
  assert.deepEqual(sample.turns, { low: 2, mid: 6, high: 11 });
});

// ── D-ET4 — Σ tokens_out ÷ Σ turns ───────────────────────────────────────────────────────────────

test("output per turn is the ratio of SUMS — a long run outweighs a short one (D-ET4)", () => {
  const { runs } = makeHarness([
    { ...KEY, status: "completed", turns: 2, tokensOut: 200 }, // 100 / turn
    { ...KEY, status: "completed", turns: 18, tokensOut: 18_000 }, // 1,000 / turn
  ]);

  const sample = runs.measureTurnProfiles([KEY]).pair.get(turnProfilePairKey(KEY));

  assert.ok(sample);
  // Σ 18,200 ÷ Σ 20 = 910. The mean of the two per-run ratios would be 550 — a figure that gives a
  // 2-turn run the same say as an 18-turn one, which is exactly what the estimator must not do.
  assert.equal(sample.outputTokensPerTurn, 910);
  assert.notEqual(sample.outputTokensPerTurn, 550);
});

// ── the three levels, from one pass ──────────────────────────────────────────────────────────────

test("pair, environment and global are measured together and do not blend into each other", () => {
  const { runs } = makeHarness([
    // env-1 / test-1 — the requested pair
    { environmentId: "env-1", testId: "test-1", status: "completed", turns: 5 },
    { environmentId: "env-1", testId: "test-1", status: "completed", turns: 6 },
    { environmentId: "env-1", testId: "test-1", status: "completed", turns: 7 },
    // env-1 / test-2 — same environment, a different test: in `environment`, NOT in the pair
    { environmentId: "env-1", testId: "test-2", status: "completed", turns: 15 },
    { environmentId: "env-1", testId: "test-2", status: "completed", turns: 16 },
    // env-2 — never selected: only the widest level may see it
    { environmentId: "env-2", testId: "test-1", status: "completed", turns: 30 },
  ]);

  const samples = runs.measureTurnProfiles([{ environmentId: "env-1", testId: "test-1" }]);

  const pair = samples.pair.get(turnProfilePairKey({ environmentId: "env-1", testId: "test-1" }));
  assert.ok(pair);
  assert.equal(pair.sampleSize, 3, "the other test's runs are a different pair");
  assert.deepEqual(pair.turns, { low: 5, mid: 6, high: 7 });

  const environment = samples.environment.get("env-1");
  assert.ok(environment);
  assert.equal(environment.sampleSize, 5, "both of this environment's tests");

  assert.equal(samples.pair.size, 1, "only the requested pair");
  assert.equal(samples.environment.size, 1, "only the requested environment");
  assert.ok(samples.global);
  assert.equal(samples.global.sampleSize, 6, "every completed run, selected or not");
});

test("a batch of keys is answered in ONE query, not one per pair", () => {
  const seed: SeedRun[] = [];
  for (const environmentId of ["env-1", "env-2", "env-3"]) {
    for (const testId of ["test-1", "test-2"]) {
      for (const turns of [4, 5, 6])
        seed.push({ environmentId, testId, status: "completed", turns });
    }
  }
  const { db, runs } = makeHarness(seed);
  const keys = seed.map(({ environmentId, testId }) => ({ environmentId, testId }));

  // Count statements prepared DURING the measurement only (the repository's constructor prepares its
  // own search-index handles, which is not what this pins).
  const prepared: string[] = [];
  const realPrepare = db.prepare.bind(db);
  const spied = db as unknown as { prepare: (sql: string) => unknown };
  spied.prepare = (sql: string) => {
    prepared.push(sql);
    return realPrepare(sql);
  };

  const samples = runs.measureTurnProfiles(keys);

  assert.equal(prepared.length, 1, `one pass over runs, got ${prepared.length} statements`);
  assert.equal(samples.pair.size, 6);
  assert.equal(samples.environment.size, 3);
  assert.equal(samples.global?.sampleSize, 18);
});

test("a fresh install measures nothing and says so — no runs at all", () => {
  const { runs } = makeHarness([]);

  const samples = runs.measureTurnProfiles([KEY]);

  assert.equal(samples.pair.size, 0);
  assert.equal(samples.environment.size, 0);
  assert.equal(samples.global, null);
});

test("the pair key joins on NUL, so two different selections can never collide", () => {
  assert.equal(
    turnProfilePairKey({ environmentId: "env-1", testId: "test-1" }),
    "env-1\u0000test-1",
  );
  // On a `-` or `:` separator these two selections would share one key ("a-b-c") and blend.
  assert.notEqual(
    turnProfilePairKey({ environmentId: "a", testId: "b-c" }),
    turnProfilePairKey({ environmentId: "a-b", testId: "c" }),
  );
});
