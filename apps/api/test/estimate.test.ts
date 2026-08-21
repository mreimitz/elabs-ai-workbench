import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  RUN_PLAN_ESTIMATE_TURNS_HIGH,
  RUN_PLAN_ESTIMATE_TURNS_LOW,
  RUN_PLAN_ESTIMATE_TURNS_MID,
  type RunPlanTurnProfile,
} from "@mcp-token-footprint/shared";
import {
  type EstimateEnvInput,
  type EstimateTestInput,
  estimateRunPlan,
  roughPromptTokens,
} from "../src/estimate/estimate.js";

function env(over: Partial<EstimateEnvInput> = {}): EstimateEnvInput {
  return {
    environmentId: "env_1",
    name: "GPT env",
    model: "gpt-4o",
    footprintTokens: 5000,
    systemPromptTokens: 100,
    hasFootprint: true,
    hasCostCap: true,
    pricing: { inPer1M: 2.5, outPer1M: 10 },
    ...over,
  };
}

/** Anthropic-shaped rates: a published cache-READ rate is what lets the band model caching at all. */
const CACHING_PRICE = { inPer1M: 3, outPer1M: 15, cachedInPer1M: 0.3 };
/** The same headline rates with NO cache-read price — the band must collapse. */
const NO_CACHE_PRICE = { inPer1M: 3, outPer1M: 15 };

const OUTPUT_PER_TURN = 350;
const CACHE_WRITE_MULTIPLIER = 1.25;

function near(actual: number, expected: number, tolerance = 1e-9, what = "value"): void {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${what}: expected ≈ ${expected}, got ${actual} (Δ ${actual - expected})`,
  );
}

const test1: EstimateTestInput = { promptTokens: 40 };
const test2: EstimateTestInput = { promptTokens: 60 };

test("2 tests × 2 environments × 2 reps → non-zero token + cost band, low ≤ mid ≤ high", () => {
  const est = estimateRunPlan(
    [env({ environmentId: "a" }), env({ environmentId: "b" })],
    [test1, test2],
    2,
  );

  assert.equal(est.testCount, 2);
  assert.equal(est.environmentCount, 2);
  assert.equal(est.repetitions, 2);
  assert.equal(est.totalRuns, 2 * 2 * 2);

  assert.ok(est.tokens.low > 0, "low tokens non-zero");
  assert.ok(est.tokens.low <= est.tokens.mid, "low ≤ mid tokens");
  assert.ok(est.tokens.mid <= est.tokens.high, "mid ≤ high tokens");

  assert.ok(est.costUsd.low > 0, "priced envs yield a non-zero cost band");
  assert.ok(
    est.costUsd.low <= est.costUsd.mid && est.costUsd.mid <= est.costUsd.high,
    "cost band ordered",
  );

  assert.equal(est.unpricedEnvironmentCount, 0);
  assert.equal(est.uncappedEnvironmentCount, 0);
});

test("token math matches the footprint × turns × runs model exactly", () => {
  // One env, one test, one rep. low = TURNS_LOW turns; high = TURNS_HIGH turns.
  const e = env({ footprintTokens: 5000, systemPromptTokens: 100, pricing: null });
  const est = estimateRunPlan([e], [{ promptTokens: 40 }], 1);
  const perTurnPrefix = 5000 + 100;
  const OUTPUT_PER_TURN = 350;
  const expectLow =
    RUN_PLAN_ESTIMATE_TURNS_LOW * perTurnPrefix +
    40 +
    RUN_PLAN_ESTIMATE_TURNS_LOW * OUTPUT_PER_TURN;
  const expectHigh =
    RUN_PLAN_ESTIMATE_TURNS_HIGH * perTurnPrefix +
    40 +
    RUN_PLAN_ESTIMATE_TURNS_HIGH * OUTPUT_PER_TURN;
  assert.equal(est.tokens.low, expectLow);
  assert.equal(est.tokens.high, expectHigh);
});

test("a bigger footprint drives a strictly bigger token estimate", () => {
  const small = estimateRunPlan([env({ footprintTokens: 1000 })], [test1], 1);
  const big = estimateRunPlan([env({ footprintTokens: 20000 })], [test1], 1);
  assert.ok(
    big.tokens.high > small.tokens.high,
    "20k-token env estimates more than a 1k-token env",
  );
});

test("unpriced (e.g. ollama) model: tokens counted, dollars excluded, reason labeled", () => {
  const priced = env({
    environmentId: "gpt",
    model: "gpt-4o",
    pricing: { inPer1M: 2.5, outPer1M: 10 },
  });
  const unpriced = env({ environmentId: "ollama", model: "custom-local", pricing: null });
  const est = estimateRunPlan([priced, unpriced], [test1], 1);

  const ollama = est.environments.find((x) => x.environmentId === "ollama");
  assert.ok(ollama);
  assert.equal(ollama?.priced, false);
  assert.equal(ollama?.reason, "Unpriced model");
  assert.equal(ollama?.costUsd, undefined, "unpriced env carries no $ range");
  assert.ok((ollama?.tokens.high ?? 0) > 0, "unpriced env still counts tokens");

  assert.equal(est.unpricedEnvironmentCount, 1);
  // Plan cost sums PRICED envs only — equals the gpt env alone.
  const gpt = est.environments.find((x) => x.environmentId === "gpt");
  assert.equal(est.costUsd.high, gpt?.costUsd?.high);
});

test("cost-cap-less environments are counted for the advisory warn rows", () => {
  const capped = env({ environmentId: "capped", hasCostCap: true });
  const uncapped = env({ environmentId: "uncapped", hasCostCap: false });
  const est = estimateRunPlan([capped, uncapped], [test1], 1);
  assert.equal(est.uncappedEnvironmentCount, 1);
  assert.equal(est.environments.find((x) => x.environmentId === "uncapped")?.hasCostCap, false);
});

test("maxTurns guardrail clamps the high band", () => {
  const unclamped = estimateRunPlan([env({ pricing: null })], [test1], 1);
  const clamped = estimateRunPlan([env({ pricing: null, maxTurns: 2 })], [test1], 1);
  assert.ok(clamped.tokens.high < unclamped.tokens.high, "maxTurns=2 caps the high estimate");
});

test("no scanned footprint is labeled but still priced/estimable", () => {
  const e = env({ hasFootprint: false, footprintTokens: 0 });
  const est = estimateRunPlan([e], [test1], 1);
  const row = est.environments[0];
  assert.equal(row?.reason, "No scanned server footprint");
  assert.equal(row?.priced, true);
  assert.ok(row?.costUsd, "still priced");
});

test("roughPromptTokens: chars/4, empty → 0", () => {
  assert.equal(roughPromptTokens(""), 0);
  assert.equal(roughPromptTokens(undefined), 0);
  assert.equal(roughPromptTokens("abcd"), 1);
  assert.equal(roughPromptTokens("abcde"), 2);
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// RM-33 WP 2.1 — the cost band is now the PROMPT-CACHING band, not the turn band
// ══════════════════════════════════════════════════════════════════════════════════════════════════

test("WP2.1 — the band's HIGH end is the pre-RM-33 arithmetic, to the cent", () => {
  // The upper bound must not move: this is the number the launcher has always shown as its ceiling,
  // and the whole point of a range is that the old, cache-blind figure is one honest end of it.
  const e = env({ pricing: CACHING_PRICE, footprintTokens: 5000, systemPromptTokens: 100 });
  const est = estimateRunPlan([e], [{ promptTokens: 40 }], 1);

  const turns = RUN_PLAN_ESTIMATE_TURNS_HIGH; // 8 — no maxTurns clamp here
  const grossInput = turns * (5000 + 100) + 40;
  const output = turns * OUTPUT_PER_TURN;
  const oldArithmetic = (grossInput / 1e6) * 3 + (output / 1e6) * 15;

  near(est.costUsd.high, oldArithmetic, 1e-9, "costUsd.high vs the pre-RM-33 formula");
});

test("WP2.1 — the band's LOW end prices the re-sent prefix as one cache write + N-1 cache reads", () => {
  const e = env({ pricing: CACHING_PRICE, footprintTokens: 5000, systemPromptTokens: 100 });
  const est = estimateRunPlan([e], [{ promptTokens: 40 }], 1);

  const turns = RUN_PLAN_ESTIMATE_TURNS_HIGH;
  const prefix = 5000 + 100;
  // Turn 1 WRITES the prefix (1.25×); turns 2..N READ it (0.1×); the per-turn delta — here the user
  // prompt — stays uncached at the full rate. The token TOTAL is unchanged (D-CT1: gross input
  // already includes the cached slice), so this WP re-prices, it does not re-count.
  const expected =
    (40 / 1e6) * 3 +
    (((turns - 1) * prefix) / 1e6) * 0.3 +
    (prefix / 1e6) * 3 * CACHE_WRITE_MULTIPLIER +
    ((turns * OUTPUT_PER_TURN) / 1e6) * 15;

  near(est.costUsd.low, expected, 1e-9, "costUsd.low vs the cached prefix model");
  assert.ok(est.costUsd.low < est.costUsd.high, "caching is cheaper than no caching at 8 turns");
  assert.ok(
    est.costUsd.low <= est.costUsd.mid && est.costUsd.mid <= est.costUsd.high,
    "band ordered",
  );
  assert.equal(est.cachingAssumed, true);
  assert.equal(est.environments[0]?.cachingAssumed, true);
});

test("WP2.1 (Acceptance 1) — against run 4LnBMey0w53EnDRNG__TH's RECORDED numbers, within 10%", () => {
  // Recorded from the owner's database (read from an isolated copy; the live file was never opened):
  //   run 4LnBMey0w53EnDRNG__TH · environment "BARC-Benchmark-Sonnet" · model claude-sonnet-4-6
  //   turns 19 · tokens_in 958,457 (gross) · tokens_out 8,447
  //   cache_read_tokens 832,540 · cache_write_tokens 59,034 · cost_usd $0.7984935
  // Those rates ($3 / $15 / $0.3 cached-in) reproduce the persisted cost EXACTLY:
  //   66,883×3 + 832,540×0.3 + 59,034×3.75 + 8,447×15, all /1e6  =  $0.7984935.
  // Its fully-UNCACHED counterfactual is 958,457×3 + 8,447×15, /1e6 = $3.002076 — which is what this
  // endpoint used to predict, on its own, as a point estimate: ~3.8× the bill the owner actually paid.
  const ACTUAL_COST_USD = 0.7984935;
  const UNCACHED_COST_USD = 3.002076;

  // The fixture matches the run's GROSS INPUT at the estimator's own high turn count. It cannot match
  // the turn count (19 > the estimator's ceiling of 8) or the output tokens (a flat 350/turn), and it
  // is not supposed to: the token model is explicitly out of this WP's scope. What is under test is
  // the PRICING of a given token shape, so the tolerance below absorbs the token model's roughness.
  const est = estimateRunPlan(
    [
      env({
        environmentId: "barc",
        name: "BARC-Benchmark-Sonnet",
        model: "claude-sonnet-4-6",
        footprintTokens: 119_700,
        systemPromptTokens: 50,
        pricing: CACHING_PRICE,
        hasCostCap: false,
        maxTurns: 8,
      }),
    ],
    [{ promptTokens: 457 }],
    1,
  );

  // 8 × (119,700 + 50) + 457 = 958,457 — the run's gross input, exactly.
  assert.equal(
    est.tokens.high - 8 * OUTPUT_PER_TURN,
    958_457,
    "fixture reproduces the gross input",
  );

  const TOLERANCE = 0.1; // 10% — stated, not discovered: see the note above.
  const lowErr = Math.abs(est.costUsd.low - ACTUAL_COST_USD) / ACTUAL_COST_USD;
  const highErr = Math.abs(est.costUsd.high - UNCACHED_COST_USD) / UNCACHED_COST_USD;
  assert.ok(
    lowErr <= TOLERANCE,
    `costUsd.low ${est.costUsd.low} vs the run's real $${ACTUAL_COST_USD} — off by ${(lowErr * 100).toFixed(1)}%`,
  );
  assert.ok(
    highErr <= TOLERANCE,
    `costUsd.high ${est.costUsd.high} vs its uncached $${UNCACHED_COST_USD} — off by ${(highErr * 100).toFixed(1)}%`,
  );
  // And the defect this WP exists to fix: the old point estimate was multiples of the real bill.
  assert.ok(
    est.costUsd.high / est.costUsd.low > 3,
    "the range spans the ~3.8× the cache-blind estimate used to over-state by",
  );
});

test("WP2.1 (Acceptance 2) — no published cache-read rate ⇒ low === high, cachingAssumed false", () => {
  const est = estimateRunPlan([env({ pricing: NO_CACHE_PRICE })], [test1], 1);
  const row = est.environments[0];

  assert.equal(est.cachingAssumed, false, "the plan must not claim a caching discount");
  assert.equal(row?.cachingAssumed, false);
  assert.equal(
    row?.costUsd?.low,
    row?.costUsd?.high,
    "the environment's band collapses to a point",
  );
  assert.equal(row?.costUsd?.mid, row?.costUsd?.high);
  assert.equal(est.costUsd.low, est.costUsd.high, "…and so does the plan's");
  assert.ok(est.costUsd.low > 0, "collapsed is not the same as zero");
});

test("WP2.1 — an unpriced model claims no caching, and still carries no dollars", () => {
  const est = estimateRunPlan([env({ pricing: null })], [test1], 1);
  const row = est.environments[0];
  assert.equal(row?.priced, false);
  assert.equal(row?.cachingAssumed, false, "we cannot claim caching for a model we cannot price");
  assert.equal(row?.costUsd, undefined);
  assert.equal(est.cachingAssumed, false);
});

test("WP2.1 — on a ONE-turn plan the cache WRITE is a premium, and the band brackets it honestly", () => {
  // maxTurns: 1 ⇒ the whole prefix is written to cache at 1.25× with no read to earn it back, so
  // caching genuinely costs MORE. The band is min/max rather than "cached is always the low end":
  // asserting an order the arithmetic does not always produce would be the dishonest option.
  const e = env({
    pricing: CACHING_PRICE,
    maxTurns: 1,
    footprintTokens: 5000,
    systemPromptTokens: 100,
  });
  const est = estimateRunPlan([e], [{ promptTokens: 40 }], 1);

  const prefix = 5100;
  const uncached = ((1 * prefix + 40) / 1e6) * 3 + (OUTPUT_PER_TURN / 1e6) * 15;
  const cached =
    (40 / 1e6) * 3 + (prefix / 1e6) * 3 * CACHE_WRITE_MULTIPLIER + (OUTPUT_PER_TURN / 1e6) * 15;
  assert.ok(cached > uncached, "the fixture really is a write-premium case");

  near(est.costUsd.low, uncached, 1e-9, "low = the cheaper end");
  near(est.costUsd.high, cached, 1e-9, "high = the dearer end");
  assert.ok(est.costUsd.low <= est.costUsd.mid && est.costUsd.mid <= est.costUsd.high, "ordered");
  assert.equal(est.cachingAssumed, true, "the band still brackets both outcomes");
});

test("WP2.1 — the plan-level flag is SOME, not EVERY: one caching environment sets it", () => {
  const est = estimateRunPlan(
    [
      env({ environmentId: "caches", pricing: CACHING_PRICE }),
      env({ environmentId: "does-not", pricing: NO_CACHE_PRICE }),
    ],
    [test1],
    1,
  );
  assert.equal(
    est.cachingAssumed,
    true,
    "one caching environment makes the plan's low end discounted",
  );
  assert.equal(est.environments.find((e) => e.environmentId === "caches")?.cachingAssumed, true);
  assert.equal(est.environments.find((e) => e.environmentId === "does-not")?.cachingAssumed, false);
  assert.ok(est.costUsd.low < est.costUsd.high, "the plan band is genuinely open");
});

test("WP2.1 — repetitions scale both ends of the band linearly", () => {
  const e = env({ pricing: CACHING_PRICE });
  const one = estimateRunPlan([e], [test1, test2], 1);
  const three = estimateRunPlan([e], [test1, test2], 3);
  near(three.costUsd.low, one.costUsd.low * 3, 1e-9, "low × reps");
  near(three.costUsd.high, one.costUsd.high * 3, 1e-9, "high × reps");
});

test("WP2.1 (Acceptance 3, D-CT5) — estimate.ts holds NO cost arithmetic of its own", () => {
  // The tooth for "one pricing code path". `computeCostBreakdownForPrice` is the only way a dollar
  // may be produced in this module; a second `tokens / 1e6 × rate` anywhere in it is the exact defect
  // this WP removed, and it must not creep back.
  const source = readFileSync(
    fileURLToPath(new URL("../src/estimate/estimate.ts", import.meta.url)),
    "utf8",
  );
  // Comments are prose and may legitimately describe the formula; only real code is scanned. (This
  // module has no string literal containing `//` or `/*`, so the naive strip is exact here.)
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  assert.match(
    code,
    /computeCostBreakdownForPrice\(/,
    "estimate.ts must price through the single shared cost formula",
  );

  const rateArithmetic = code.match(/[\w.]*Per1M\s*[*/]|[*/]\s*[\w.]*Per1M/g);
  assert.equal(
    rateArithmetic,
    null,
    `estimate.ts multiplies/divides a per-1M rate itself: ${JSON.stringify(rateArithmetic)}`,
  );

  const perMillionDivisor = code.match(/1e6|1_000_000/g);
  assert.equal(
    perMillionDivisor,
    null,
    `estimate.ts carries a per-million divisor — that is a cost formula: ${JSON.stringify(perMillionDivisor)}`,
  );
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// RM-34 WP 1.2 — the turn band is MEASURED when history can answer, and guessed only when it cannot
// ══════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * The measured profile from the plan's own evidence, rounded to whole turns: the owner's
 * BARC-Benchmark-Sonnet environment, 79 completed runs, p10 4 / p50 6 / p90 16 turns at ~1,036 output
 * tokens a turn. Used as the worked example throughout, so the numbers below are recognisable.
 */
const MEASURED: RunPlanTurnProfile = {
  basis: "environment",
  sampleSize: 79,
  turns: { low: 4, mid: 6, high: 16 },
  outputTokensPerTurn: 1036,
};

test("WP1.2 (Acceptance 1, D-ET1) — with NO history the estimate is byte-identical to the pre-RM-34 output", () => {
  // The whole safety property of this WP in one assertion. These literals were captured by RUNNING the
  // pre-RM-34 estimator on exactly this input, then frozen — they are an observation, not a
  // re-derivation of the formula being tested (a re-derivation would agree with any bug it shares).
  // Two environments so a `maxTurns` clamp, an unpriced model and a caching model are all covered.
  const est = estimateRunPlan(
    [
      env({
        environmentId: "env_1",
        name: "Baseline env",
        model: "claude-sonnet-4-6",
        footprintTokens: 5000,
        systemPromptTokens: 100,
        pricing: CACHING_PRICE,
      }),
      env({
        environmentId: "env_2",
        name: "Unpriced env",
        model: "custom-local",
        footprintTokens: 1200,
        systemPromptTokens: 25,
        hasFootprint: false,
        hasCostCap: false,
        pricing: null,
        maxTurns: 2,
      }),
    ],
    [{ promptTokens: 40 }, { promptTokens: 60 }],
    2,
  );

  // `turnProfile` is the one ADDITIVE field (D-ET7); strip it and what remains must match byte for
  // byte. Stripping is what makes this an equality rather than a spot-check of a few fields.
  const withoutProfiles = {
    ...est,
    environments: est.environments.map(({ turnProfile: _ignored, ...rest }) => rest),
  };
  assert.deepEqual(withoutProfiles, {
    testCount: 2,
    environmentCount: 2,
    repetitions: 2,
    totalRuns: 8,
    tokens: { low: 28500, mid: 78400, high: 187400 },
    costUsd: { low: 0.28794000000000003, mid: 0.47307, high: 0.6582 },
    unpricedEnvironmentCount: 1,
    uncappedEnvironmentCount: 1,
    cachingAssumed: true,
    environments: [
      {
        environmentId: "env_1",
        name: "Baseline env",
        model: "claude-sonnet-4-6",
        priced: true,
        footprintTokens: 5000,
        hasCostCap: true,
        tokens: { low: 22000, mid: 65600, high: 174600 },
        costUsd: { low: 0.28794000000000003, mid: 0.47307, high: 0.6582 },
        cachingAssumed: true,
      },
      {
        environmentId: "env_2",
        name: "Unpriced env",
        model: "custom-local",
        priced: false,
        reason: "Unpriced model",
        footprintTokens: 1200,
        hasCostCap: false,
        tokens: { low: 6500, mid: 12800, high: 12800 },
        cachingAssumed: false,
      },
    ],
  });

  // …and "no history" is REPORTED as such, not left off the wire (D-ET5).
  for (const row of est.environments) {
    assert.deepEqual(row.turnProfile, {
      basis: "default",
      sampleSize: 0,
      turns: {
        low: RUN_PLAN_ESTIMATE_TURNS_LOW,
        mid: RUN_PLAN_ESTIMATE_TURNS_MID,
        high: RUN_PLAN_ESTIMATE_TURNS_HIGH,
      },
      outputTokensPerTurn: OUTPUT_PER_TURN,
    });
  }
});

test("WP1.2 (Acceptance 2) — a measured profile drives BOTH the turn band and the output term", () => {
  const e = env({ pricing: null, footprintTokens: 5000, systemPromptTokens: 100 });
  const measured = estimateRunPlan([{ ...e, turnProfile: MEASURED }], [{ promptTokens: 40 }], 1);

  const prefix = 5100;
  const at = (turns: number) => turns * prefix + 40 + turns * MEASURED.outputTokensPerTurn;
  assert.equal(measured.tokens.low, at(4), "low follows the profile's p10");
  assert.equal(measured.tokens.mid, at(6), "mid follows the profile's p50");
  assert.equal(measured.tokens.high, at(16), "high follows the profile's p90");

  // The output term really is the profile's, not the constant: at 16 turns the two differ by
  // 16 × (1,036 − 350) = 10,976 tokens, which is the whole reason D-ET4 exists.
  const withDefaultOutput = 16 * prefix + 40 + 16 * OUTPUT_PER_TURN;
  assert.equal(
    measured.tokens.high - withDefaultOutput,
    16 * (MEASURED.outputTokensPerTurn - OUTPUT_PER_TURN),
  );

  // And the profile is reported back verbatim, so a reader can check the band against its evidence.
  assert.deepEqual(measured.environments[0]?.turnProfile, MEASURED);
});

test("WP1.2 (Acceptance 3, D-ET6) — maxTurns clamps a MEASURED band, last: 4/6/16 capped at 5 ⇒ 4/5/5", () => {
  // The ordering tooth. Clamping BEFORE the band is chosen would hold the measured p90 of 16 down to
  // the old ceiling of 8 and quietly revert this WP; clamping after is what makes the guardrail a
  // guardrail rather than a second turn model.
  const e = env({
    pricing: null,
    footprintTokens: 5000,
    systemPromptTokens: 100,
    turnProfile: MEASURED,
    maxTurns: 5,
  });
  const est = estimateRunPlan([e], [{ promptTokens: 40 }], 1);

  const prefix = 5100;
  const at = (turns: number) => turns * prefix + 40 + turns * MEASURED.outputTokensPerTurn;
  assert.equal(est.tokens.low, at(4), "low (4) is under the cap and untouched");
  assert.equal(est.tokens.mid, at(5), "mid (6) is clamped to 5");
  assert.equal(est.tokens.high, at(5), "high (16) is clamped to 5");
  assert.ok(est.tokens.low <= est.tokens.mid && est.tokens.mid <= est.tokens.high, "band ordered");

  // The REPORTED profile stays pre-clamp: "usually 4–16 turns, capped at 5" is two facts, and
  // collapsing them would make the cap invisible.
  assert.deepEqual(est.environments[0]?.turnProfile, MEASURED);

  // A cap ABOVE the measured p90 must not raise anything — clamping is a ceiling, never a floor.
  const uncapped = estimateRunPlan([{ ...e, maxTurns: 40 }], [{ promptTokens: 40 }], 1);
  assert.equal(uncapped.tokens.high, at(16), "a cap above the measured high leaves it alone");
});

test("WP1.2 — a measured high above 8 is NOT silently held at the old ceiling", () => {
  // The specific regression a careless `cap = maxTurns ?? RUN_PLAN_ESTIMATE_TURNS_HIGH` reintroduces:
  // with no maxTurns set, the fallback cap must be "no cap", never the default profile's own high.
  const e = env({ pricing: null, turnProfile: MEASURED });
  const est = estimateRunPlan([e], [{ promptTokens: 40 }], 1);
  const withCeiling = estimateRunPlan(
    [{ ...e, maxTurns: RUN_PLAN_ESTIMATE_TURNS_HIGH }],
    [{ promptTokens: 40 }],
    1,
  );
  assert.ok(
    est.tokens.high > withCeiling.tokens.high,
    "an unclamped 16-turn profile must estimate MORE than the same profile capped at 8",
  );
});

test("WP1.2 (Acceptance 7) — RM-33 still holds at a MEASURED turn count: no cache-read rate ⇒ low === high", () => {
  // The RM-33 WP 2.1 guard, re-asserted on the axis this WP moves. The dollar band spreads on caching
  // and nothing else (D-CT2); a turn spread creeping back into `costUsd` shows up here first.
  const profiles: Array<RunPlanTurnProfile | undefined> = [
    undefined,
    MEASURED,
    { ...MEASURED, turns: { low: 1, mid: 9, high: 19 } },
  ];
  for (const turnProfile of profiles) {
    const est = estimateRunPlan([env({ pricing: NO_CACHE_PRICE, turnProfile })], [test1], 1);
    const row = est.environments[0];
    const where = JSON.stringify(turnProfile?.turns ?? "default");
    assert.equal(row?.costUsd?.low, row?.costUsd?.high, `band must be a point at turns ${where}`);
    assert.equal(row?.costUsd?.mid, row?.costUsd?.high, `mid too, at turns ${where}`);
    assert.equal(est.costUsd.low, est.costUsd.high, `…and the plan's, at turns ${where}`);
    assert.equal(est.cachingAssumed, false);
    assert.ok(est.costUsd.low > 0, "collapsed is not the same as zero");
  }
});

test("WP1.2 — a cacheable model still prices BOTH ends at the same (measured) high turn count", () => {
  const e = env({
    pricing: CACHING_PRICE,
    footprintTokens: 5000,
    systemPromptTokens: 100,
    turnProfile: MEASURED,
  });
  const est = estimateRunPlan([e], [{ promptTokens: 40 }], 1);

  const turns = MEASURED.turns.high; // 16 — both ends, per RM-33 WP 2.1
  const prefix = 5100;
  const output = turns * MEASURED.outputTokensPerTurn;
  const uncached = ((turns * prefix + 40) / 1e6) * 3 + (output / 1e6) * 15;
  const cached =
    (40 / 1e6) * 3 +
    (((turns - 1) * prefix) / 1e6) * 0.3 +
    (prefix / 1e6) * 3 * CACHE_WRITE_MULTIPLIER +
    (output / 1e6) * 15;

  near(est.costUsd.high, uncached, 1e-9, "high = the uncached counterfactual at the measured high");
  near(est.costUsd.low, cached, 1e-9, "low = the cached model at the SAME turn count");
});

test("WP1.2 (Acceptance 6, D-ET8) — estimate.ts imports nothing that can reach a database", () => {
  // The purity tooth, in the same style as D-CT5's above. `estimate.ts` is the app's one place where
  // this band's arithmetic can be read whole; the moment it can look something up, "pure over its
  // inputs" stops being checkable by reading it. The service resolves, this file computes.
  const source = readFileSync(
    fileURLToPath(new URL("../src/estimate/estimate.ts", import.meta.url)),
    "utf8",
  );
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  // An ALLOW-list, not a deny-list: a deny-list only ever blocks the I/O module someone thought of.
  const ALLOWED = new Set(["@mcp-token-footprint/shared", "../providers/pricing.js"]);
  const specifiers = [...code.matchAll(/(?:^|\n)\s*import[\s\S]*?from\s+"([^"]+)"/g)].map(
    (m) => m[1] as string,
  );
  assert.ok(
    specifiers.length > 0,
    "the import scan found nothing — the regex is broken, not the file",
  );
  for (const specifier of specifiers) {
    assert.ok(
      ALLOWED.has(specifier),
      `estimate.ts imports ${specifier}; D-ET8 keeps it pure — resolve it in service.ts and pass the result in`,
    );
  }

  // Named for the message quality: these are the imports this WP could plausibly have added.
  const ioish = code.match(
    /from\s+"[^"]*(?:\/db\/|run-repository|repository\.js|better-sqlite3|node:fs)[^"]*"/g,
  );
  assert.equal(ioish, null, `estimate.ts reaches for I/O: ${JSON.stringify(ioish)}`);
});
