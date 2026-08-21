import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  RUN_PLAN_ESTIMATE_TURNS_HIGH,
  RUN_PLAN_ESTIMATE_TURNS_LOW,
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
