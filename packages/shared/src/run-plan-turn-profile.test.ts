// RM-34 WP 1.1 — the measured turn model's WIRE contract.
//
// Three things are pinned here, and each of them is a way the contract could rot silently:
//
//   1. the static constants D-ET1 keeps as the `"default"` basis still exist and still hold their
//      original values — deleting or "improving" them breaks the fresh-install path, where there is
//      no history to measure and the preview must still answer;
//   2. `turnProfile` is ADDITIVE — an estimate produced before RM-34 still validates unchanged
//      (D-ET7), so no consumer breaks on a response that never carried the field; and
//   3. `.strict()` bites, so a fourth basis or a stray key is a failure rather than silent drift.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  RUN_PLAN_ESTIMATE_OUTPUT_TOKENS_PER_TURN,
  RUN_PLAN_ESTIMATE_TURNS_HIGH,
  RUN_PLAN_ESTIMATE_TURNS_LOW,
  RUN_PLAN_ESTIMATE_TURNS_MID,
  RUN_PLAN_TURN_BASES,
  RUN_PLAN_TURN_PERCENTILE_HIGH,
  RUN_PLAN_TURN_PERCENTILE_LOW,
  RUN_PLAN_TURN_PERCENTILE_MID,
  RUN_PLAN_TURN_PROFILE_MIN_SAMPLES,
} from "./constants.js";
import { runPlanEstimateEnvironmentSchema, runPlanTurnProfileSchema } from "./schemas.js";
import type { RunPlanEstimateEnvironment, RunPlanTurnProfile } from "./types.js";

test("the D-ET1 fallback constants are untouched — a fresh install still has a band to show", () => {
  assert.equal(RUN_PLAN_ESTIMATE_TURNS_LOW, 1);
  assert.equal(RUN_PLAN_ESTIMATE_TURNS_MID, 3);
  assert.equal(RUN_PLAN_ESTIMATE_TURNS_HIGH, 8);
  assert.equal(RUN_PLAN_ESTIMATE_OUTPUT_TOKENS_PER_TURN, 350);
});

test("the basis vocabulary is narrowest-measured-first and ends on the static default", () => {
  assert.deepEqual([...RUN_PLAN_TURN_BASES], ["pair", "environment", "global", "default"]);
  assert.equal(RUN_PLAN_TURN_PROFILE_MIN_SAMPLES, 3);
  assert.deepEqual(
    [RUN_PLAN_TURN_PERCENTILE_LOW, RUN_PLAN_TURN_PERCENTILE_MID, RUN_PLAN_TURN_PERCENTILE_HIGH],
    [0.1, 0.5, 0.9],
  );
});

test("a measured profile validates; an unknown basis and an undeclared key do not", () => {
  const profile: RunPlanTurnProfile = {
    basis: "pair",
    sampleSize: 51,
    turns: { low: 5, mid: 9, high: 19 },
    outputTokensPerTurn: 1036,
  };
  assert.deepEqual(runPlanTurnProfileSchema.parse(profile), profile);

  assert.throws(() => runPlanTurnProfileSchema.parse({ ...profile, basis: "guess" }));
  assert.throws(() => runPlanTurnProfileSchema.parse({ ...profile, confidence: 0.9 }));
});

/** The environment block a run-plan estimate produced BEFORE RM-34: no turn profile at all. */
const legacyEnvironment: RunPlanEstimateEnvironment = {
  environmentId: "env-1",
  name: "BARC-Benchmark-Sonnet",
  model: "claude-sonnet-4-6",
  priced: true,
  footprintTokens: 12_000,
  hasCostCap: false,
  tokens: { low: 13_000, mid: 39_000, high: 104_000 },
  costUsd: { low: 0.42, mid: 1.0, high: 1.59 },
  cachingAssumed: true,
};

test("a pre-RM-34 environment still validates — `turnProfile` is strictly additive (D-ET7)", () => {
  const parsed = runPlanEstimateEnvironmentSchema.parse(legacyEnvironment);
  assert.equal(parsed.turnProfile, undefined, "absent ⇒ predates the measurement, not 'measured 0'");
});

test("an environment carrying a measured profile validates, profile and all", () => {
  const measured: RunPlanEstimateEnvironment = {
    ...legacyEnvironment,
    turnProfile: {
      basis: "environment",
      sampleSize: 79,
      turns: { low: 6, mid: 9, high: 16 },
      outputTokensPerTurn: 1036,
    },
  };
  assert.deepEqual(runPlanEstimateEnvironmentSchema.parse(measured), measured);
});
