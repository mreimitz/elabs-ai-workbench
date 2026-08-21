import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import {
  RUN_PLAN_ESTIMATE_OUTPUT_TOKENS_PER_TURN,
  RUN_PLAN_ESTIMATE_TURNS_HIGH,
  RUN_PLAN_ESTIMATE_TURNS_LOW,
  RUN_PLAN_ESTIMATE_TURNS_MID,
  RUN_PLAN_TURN_PROFILE_MIN_SAMPLES,
} from "@mcp-token-footprint/shared";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { buildRunPlanEstimate } from "../src/estimate/service.js";
import { resetPricingResolver } from "../src/providers/pricing.js";
import { ScanRepository } from "../src/scans/repository.js";
import { RunRepository } from "../src/testing/run-repository.js";
import { ScenarioRepository } from "../src/testing/scenario-repository.js";
import { ScenarioService } from "../src/testing/scenario-service.js";
import { TestRepository } from "../src/testing/test-repository.js";
import { TestService } from "../src/testing/test-service.js";

// RM-34 WP 1.2 — the SERVICE half: resolving one turn profile per environment out of the three
// levels `RunRepository.measureTurnProfiles` reports (D-ET2), over a real SQLite schema with real
// seeded runs. No provider key, no MCP, no network.
//
// Two rules are under test here, and nothing else in this file matters as much:
//
//   1. The NARROWEST level that clears `RUN_PLAN_TURN_PROFILE_MIN_SAMPLES` wins, and a level below
//      the floor falls through WHOLE — never blended into the next one (D-ET2).
//   2. A level must speak for the WHOLE selection it is used on. A plan selects many tests per
//      environment but the estimator's band is per ENVIRONMENT, so a pair-level profile may only
//      stand for the environment when the environment's whole selection IS that pair. With two tests
//      selected, using the first one's profile would cost the second against a band nobody measured
//      for it — the exact failure this test file exists to prevent.
//
// Percentiles below are NEAREST-RANK (WP 1.1): rank = ceil(p × n) on the ascending sample. They are
// written out longhand at every fixture so the expected numbers can be checked by hand.

const databases: AppDatabase[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  resetPricingResolver();
});

const NOW = "2026-08-21T00:00:00.000Z";

type SeedRun = {
  environment: string;
  test: string;
  turns: number;
  /** Defaults to `turns × 1000`, so `outputTokensPerTurn` is a round 1,000 unless a test says otherwise. */
  tokensOut?: number;
  /** Defaults to `"completed"` — the only status D-ET3 measures. */
  status?: string;
};

type Harness = {
  estimate: (selection: { environments: string[]; tests: string[] }) => ReturnType<
    typeof buildRunPlanEstimate
  >;
  id: (name: string) => string;
};

/**
 * A DB holding the named environments and tests, plus the seeded runs, wired to the real
 * {@link buildRunPlanEstimate}. Environments and tests are addressed by their fixture NAME; the
 * harness maps names to the generated ids so the expectations below stay readable.
 */
function makeHarness(
  seed: SeedRun[],
  options: { maxTurns?: Record<string, number> } = {},
): Harness {
  const db = new Database(":memory:") as unknown as AppDatabase;
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  databases.push(db);

  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, created_at, updated_at)
     VALUES ('prov-1', 'anthropic', 'Claude', @now, @now)`,
  ).run({ now: NOW });

  const scenarios = new ScenarioService(new ScenarioRepository(db));
  const tests = new TestService(new TestRepository(db));
  const scans = new ScanRepository(db);
  const runs = new RunRepository(db);

  const idByName = new Map<string, string>();
  for (const name of new Set(seed.map((run) => run.environment))) {
    const maxTurns = options.maxTurns?.[name];
    const created = scenarios.create({
      name,
      providerId: "prov-1",
      // Unpriced on purpose: this file is about the TOKEN model. A priced model would only add
      // dollars nobody here asserts.
      model: "custom-local",
      params: {},
      systemPrompt: "",
      allowedServers: [],
      allowedSkills: [],
      defaultProfiles: [],
      guardrails: maxTurns === undefined ? {} : { maxTurns },
      toolLoadingMode: "eager",
    });
    idByName.set(name, created.id);
  }
  for (const name of new Set(seed.map((run) => run.test))) {
    // A one-character prompt is the shortest a test may have (the schema requires one), and
    // `roughPromptTokens` rounds it to exactly 1 token — the only non-zero input term in this file.
    const created = tests.create({ name, userPrompt: "x", addedProfiles: [], tags: [] });
    idByName.set(name, created.id);
  }

  const insertRun = db.prepare(
    `INSERT INTO runs (id, test_id, scenario_id, mode, status, started_at, turns, tokens_out)
     VALUES (@id, @testId, @environmentId, 'automated', @status, @now, @turns, @tokensOut)`,
  );
  seed.forEach((run, index) => {
    insertRun.run({
      id: `run-${index}`,
      testId: idByName.get(run.test),
      environmentId: idByName.get(run.environment),
      status: run.status ?? "completed",
      turns: run.turns,
      tokensOut: run.tokensOut ?? run.turns * 1000,
      now: NOW,
    });
  });

  const id = (name: string): string => {
    const found = idByName.get(name);
    assert.ok(found, `fixture has no environment or test named ${name}`);
    return found;
  };

  return {
    id,
    estimate: (selection) =>
      buildRunPlanEstimate(
        { scenarios, tests, scans, runs },
        {
          environmentIds: selection.environments.map(id),
          testIds: selection.tests.map(id),
          repetitions: 1,
        },
      ),
  };
}

/** The environment row for a fixture-named environment. */
function row(h: Harness, estimate: ReturnType<typeof buildRunPlanEstimate>, name: string) {
  const found = estimate.environments.find((e) => e.environmentId === h.id(name));
  assert.ok(found, `no estimate row for ${name}`);
  return found;
}

// ── D-ET2 level 1 — the pair ─────────────────────────────────────────────────────────────────────

test("the (environment, test) pair wins when it clears the floor, even where the environment says otherwise", () => {
  // env-B / test-1: 4 completed runs at 9, 9, 10, 11 turns → clears the floor of 3.
  //   ascending [9,9,10,11] · p10 rank ceil(0.4)=1 → 9 · p50 rank ceil(2)=2 → 9 · p90 rank ceil(3.6)=4 → 11
  // env-B / test-2: 5 runs at 2 turns, which would drag the ENVIRONMENT level to 2 / 2 / 11.
  const h = makeHarness([
    { environment: "env-B", test: "test-1", turns: 9 },
    { environment: "env-B", test: "test-1", turns: 9 },
    { environment: "env-B", test: "test-1", turns: 10 },
    { environment: "env-B", test: "test-1", turns: 11 },
    ...Array.from({ length: 5 }, () => ({ environment: "env-B", test: "test-2", turns: 2 })),
  ]);

  const estimate = h.estimate({ environments: ["env-B"], tests: ["test-1"] });
  const profile = row(h, estimate, "env-B").turnProfile;

  assert.deepEqual(profile, {
    basis: "pair",
    sampleSize: 4,
    turns: { low: 9, mid: 9, high: 11 },
    outputTokensPerTurn: 1000,
  });
  // Not the environment's 9-run answer — the narrow, relevant sample beat the wide one.
  assert.notEqual(profile?.sampleSize, 9);
});

// ── D-ET2 level 2 — the environment, reached by falling through WHOLE ────────────────────────────

test("a pair BELOW the floor falls through to the environment level whole — never a blend (D-ET2)", () => {
  // env-A / test-1 (the selection): 2 completed runs at 20 turns — one short of the floor of 3.
  // env-A / test-2: 4 runs at 5, 6, 7, 8 turns.
  // The environment level is every completed run of env-A: [5,6,7,8,20,20], n = 6.
  //   p10 rank ceil(0.6)=1 → 5 · p50 rank ceil(3)=3 → 7 · p90 rank ceil(5.4)=6 → 20
  // A BLEND — using the 2-run pair at all, or weighting it in — reads 20 / 20 / 20 at sampleSize 2,
  // or something between. Nothing between is a figure anyone measured.
  assert.equal(RUN_PLAN_TURN_PROFILE_MIN_SAMPLES, 3, "the fixture is built around a floor of 3");
  const h = makeHarness([
    { environment: "env-A", test: "test-1", turns: 20 },
    { environment: "env-A", test: "test-1", turns: 20 },
    { environment: "env-A", test: "test-2", turns: 5 },
    { environment: "env-A", test: "test-2", turns: 6 },
    { environment: "env-A", test: "test-2", turns: 7 },
    { environment: "env-A", test: "test-2", turns: 8 },
  ]);

  const estimate = h.estimate({ environments: ["env-A"], tests: ["test-1"] });
  const profile = row(h, estimate, "env-A").turnProfile;

  assert.deepEqual(profile, {
    basis: "environment",
    sampleSize: 6,
    turns: { low: 5, mid: 7, high: 20 },
    outputTokensPerTurn: 1000,
  });
});

test("many tests per environment: the selection's pairs disagree, so the ENVIRONMENT level covers them all", () => {
  // Both pairs clear the floor and measure genuinely different things — test-1 runs long, test-2 runs
  // short. The estimator has ONE band per environment, so neither pair may speak for the other: using
  // test-1's (the first selected) would cost test-2 against 9 / 9 / 11, and averaging the two would
  // invent a third band nobody measured. Both are the mixing D-ET2 forbids.
  // env-B level: [2,2,2,2,2,9,9,10,11], n = 9.
  //   p10 rank ceil(0.9)=1 → 2 · p50 rank ceil(4.5)=5 → 2 · p90 rank ceil(8.1)=9 → 11
  const seed: SeedRun[] = [
    { environment: "env-B", test: "test-1", turns: 9 },
    { environment: "env-B", test: "test-1", turns: 9 },
    { environment: "env-B", test: "test-1", turns: 10 },
    { environment: "env-B", test: "test-1", turns: 11 },
    ...Array.from({ length: 5 }, () => ({ environment: "env-B", test: "test-2", turns: 2 })),
  ];

  const h = makeHarness(seed);
  const both = h.estimate({ environments: ["env-B"], tests: ["test-1", "test-2"] });
  assert.deepEqual(row(h, both, "env-B").turnProfile, {
    basis: "environment",
    sampleSize: 9,
    turns: { low: 2, mid: 2, high: 11 },
    outputTokensPerTurn: 1000,
  });

  // Selection ORDER must not change the answer — "the first test's profile" would flip with it.
  const reversed = makeHarness(seed);
  assert.deepEqual(
    row(
      reversed,
      reversed.estimate({ environments: ["env-B"], tests: ["test-2", "test-1"] }),
      "env-B",
    ).turnProfile,
    row(h, both, "env-B").turnProfile,
  );

  // …while selecting ONE of them still gets that pair's own, narrower profile.
  const alone = makeHarness(seed);
  assert.equal(
    row(alone, alone.estimate({ environments: ["env-B"], tests: ["test-1"] }), "env-B").turnProfile
      ?.basis,
    "pair",
  );
});

// ── D-ET2 level 3 — global ───────────────────────────────────────────────────────────────────────

test("an environment with too little history of its own falls through to the GLOBAL sample", () => {
  // env-new has one completed run: below the floor at both the pair and the environment level.
  // Global is every completed run in the app — here 1 + 4 = 5: [1,4,4,4,4].
  //   p10 rank ceil(0.5)=1 → 1 · p50 rank ceil(2.5)=3 → 4 · p90 rank ceil(4.5)=5 → 4
  const h = makeHarness([
    { environment: "env-new", test: "test-1", turns: 1 },
    ...Array.from({ length: 4 }, () => ({ environment: "env-old", test: "test-2", turns: 4 })),
  ]);

  const estimate = h.estimate({ environments: ["env-new"], tests: ["test-1"] });
  assert.deepEqual(row(h, estimate, "env-new").turnProfile, {
    basis: "global",
    sampleSize: 5,
    turns: { low: 1, mid: 4, high: 4 },
    outputTokensPerTurn: 1000,
  });
});

// ── D-ET1 level 4 — the static constants, reported honestly ──────────────────────────────────────

test('no usable history anywhere ⇒ basis "default" with sampleSize 0, and the pre-RM-34 constants', () => {
  // Two runs, both below the floor even globally — and an `error` run, which D-ET3 excludes outright.
  const h = makeHarness([
    { environment: "env-fresh", test: "test-1", turns: 7 },
    { environment: "env-fresh", test: "test-1", turns: 7 },
    { environment: "env-fresh", test: "test-1", turns: 40, status: "error" },
  ]);

  const estimate = h.estimate({ environments: ["env-fresh"], tests: ["test-1"] });
  assert.deepEqual(row(h, estimate, "env-fresh").turnProfile, {
    basis: "default",
    sampleSize: 0,
    turns: {
      low: RUN_PLAN_ESTIMATE_TURNS_LOW,
      mid: RUN_PLAN_ESTIMATE_TURNS_MID,
      high: RUN_PLAN_ESTIMATE_TURNS_HIGH,
    },
    outputTokensPerTurn: RUN_PLAN_ESTIMATE_OUTPUT_TOKENS_PER_TURN,
  });
});

// ── The profile actually reaches the numbers ─────────────────────────────────────────────────────

test("the resolved profile drives the environment's token band, output term included", () => {
  // Empty system prompt and no scanned servers ⇒ the estimate is the output term plus the
  // one-token user prompt, which makes the measured `outputTokensPerTurn` readable off `tokens`.
  // 4 runs at 5 turns each with 2,000 output tokens each: Σ tokens_out 8,000 ÷ Σ turns 20 = 400.
  const h = makeHarness(
    Array.from({ length: 4 }, () => ({
      environment: "env-A",
      test: "test-1",
      turns: 5,
      tokensOut: 2000,
    })),
  );

  const estimate = h.estimate({ environments: ["env-A"], tests: ["test-1"] });
  const environment = row(h, estimate, "env-A");
  assert.deepEqual(environment.turnProfile, {
    basis: "pair",
    sampleSize: 4,
    turns: { low: 5, mid: 5, high: 5 },
    outputTokensPerTurn: 400,
  });
  // 5 turns × 400 output tokens + the 1-token user prompt, with every per-turn input term zero.
  assert.equal(environment.tokens.high, 5 * 400 + 1);
  assert.equal(environment.tokens.low, 5 * 400 + 1);
});

test("maxTurns clamps the MEASURED band end to end, and the reported profile stays pre-clamp (D-ET6)", () => {
  // 4 runs at 5, 6, 7, 20 turns → p10 rank 1 → 5 · p50 rank 2 → 6 · p90 rank 4 → 20, at 1,000
  // output tokens a turn. The environment caps runs at 6 turns, so the band must read 5 / 6 / 6.
  const h = makeHarness(
    [5, 6, 7, 20].map((turns) => ({ environment: "env-A", test: "test-1", turns })),
    { maxTurns: { "env-A": 6 } },
  );

  const estimate = h.estimate({ environments: ["env-A"], tests: ["test-1"] });
  const environment = row(h, estimate, "env-A");

  assert.deepEqual(
    environment.turnProfile?.turns,
    { low: 5, mid: 6, high: 20 },
    "reported pre-clamp",
  );
  assert.equal(environment.tokens.low, 5 * 1000 + 1);
  assert.equal(environment.tokens.mid, 6 * 1000 + 1);
  assert.equal(
    environment.tokens.high,
    6 * 1000 + 1,
    "the measured p90 of 20 is clamped to the cap of 6",
  );
});

// ── Per-environment, not per-request ─────────────────────────────────────────────────────────────

test("two environments in ONE request each carry the basis they actually used", () => {
  // env-rich has its own 4-run pair; env-thin has nothing of its own and falls through to global.
  // Global is every completed run: [3,9,9,10,11], n = 5 → p10 rank 1 → 3 · p50 rank 3 → 9 · p90 rank 5 → 11.
  const h = makeHarness([
    { environment: "env-rich", test: "test-1", turns: 9 },
    { environment: "env-rich", test: "test-1", turns: 9 },
    { environment: "env-rich", test: "test-1", turns: 10 },
    { environment: "env-rich", test: "test-1", turns: 11 },
    { environment: "env-thin", test: "test-1", turns: 3 },
  ]);

  const estimate = h.estimate({ environments: ["env-rich", "env-thin"], tests: ["test-1"] });

  assert.deepEqual(row(h, estimate, "env-rich").turnProfile, {
    basis: "pair",
    sampleSize: 4,
    turns: { low: 9, mid: 9, high: 11 },
    outputTokensPerTurn: 1000,
  });
  assert.deepEqual(row(h, estimate, "env-thin").turnProfile, {
    basis: "global",
    sampleSize: 5,
    turns: { low: 3, mid: 9, high: 11 },
    outputTokensPerTurn: 1000,
  });
});
