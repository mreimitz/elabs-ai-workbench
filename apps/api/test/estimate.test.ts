import assert from "node:assert/strict";
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
