// UX overhaul WP 3.5 (G7, D-UX12) — the PURE run-plan cost-estimate math. No DB, no pricing tables,
// no I/O: the route/service resolves scenarios, tests, scan footprints and model prices, then hands
// the fully-resolved inputs here. That keeps this deliberately-rough band unit-testable in isolation
// (see apps/api/test/estimate.test.ts).
//
// The estimate is ADVISORY (it blocks nothing) and intentionally wide. The dominant token driver is
// the environment's tool-definition footprint, which is re-sent to the model on every agent turn
// (eager tool loading), so the low/mid/high band is essentially "how many turns will the agent
// take?" — spread by RUN_PLAN_ESTIMATE_TURNS_{LOW,MID,HIGH}, clamped by a scenario's `maxTurns`
// guardrail when it is tighter than the high assumption.

import {
  RUN_PLAN_ESTIMATE_CHARS_PER_TOKEN,
  RUN_PLAN_ESTIMATE_OUTPUT_TOKENS_PER_TURN,
  RUN_PLAN_ESTIMATE_TURNS_HIGH,
  RUN_PLAN_ESTIMATE_TURNS_LOW,
  RUN_PLAN_ESTIMATE_TURNS_MID,
  type EstimateRange,
  type RunPlanEstimate,
  type RunPlanEstimateEnvironment,
} from "@mcp-token-footprint/shared";

/** A per-token price for a model, or `null` when the model is genuinely unpriced. */
export type EnvPricing = { inPer1M: number; outPer1M: number } | null;

/** One environment, fully resolved by the service, ready for the pure estimate. */
export type EstimateEnvInput = {
  environmentId: string;
  name: string;
  model: string;
  /** Σ latest-completed-scan token totals over the environment's allowed servers (tool definitions). */
  footprintTokens: number;
  /** Rough token count of the scenario's system prompt (re-sent each turn alongside the tools). */
  systemPromptTokens: number;
  /** Whether ANY allowed server had a completed scan — false ⇒ the footprint is unknown, not zero. */
  hasFootprint: boolean;
  /** Whether the scenario sets a per-run cost cap (`guardrails.maxCostUsd`). */
  hasCostCap: boolean;
  /** Per-token price, or `null` when the model has no known price (excluded from the $ range). */
  pricing: EnvPricing;
  /** The scenario's `guardrails.maxTurns`, if set — clamps the high (and possibly mid/low) turn count. */
  maxTurns?: number;
};

/** One test, reduced to the only thing the estimate needs: its rough user-prompt token count. */
export type EstimateTestInput = { promptTokens: number };

/** Clamp the three turn assumptions by an optional per-scenario `maxTurns` cap. Keeps low ≤ mid ≤ high. */
function turnBand(maxTurns?: number): EstimateRange {
  const cap = maxTurns && maxTurns > 0 ? maxTurns : RUN_PLAN_ESTIMATE_TURNS_HIGH;
  return {
    low: Math.min(RUN_PLAN_ESTIMATE_TURNS_LOW, cap),
    mid: Math.min(RUN_PLAN_ESTIMATE_TURNS_MID, cap),
    high: Math.min(RUN_PLAN_ESTIMATE_TURNS_HIGH, cap),
  };
}

/**
 * Rough tokens for ONE run (one test × one environment) at a given turn count. The system prompt +
 * tool-definition footprint are re-sent every turn; the user prompt is sent once; the agent emits
 * ~OUTPUT_TOKENS_PER_TURN per turn. Deliberately ignores conversation growth and attachments (noted
 * as an estimate in the UI).
 */
function runTokens(env: EstimateEnvInput, test: EstimateTestInput, turns: number): number {
  const perTurnPrefix = env.footprintTokens + env.systemPromptTokens;
  const input = turns * perTurnPrefix + test.promptTokens;
  const output = turns * RUN_PLAN_ESTIMATE_OUTPUT_TOKENS_PER_TURN;
  return Math.round(input + output);
}

/** The same run's cost in USD at a turn count, or `0` when unpriced (never negative). */
function runCost(env: EstimateEnvInput, test: EstimateTestInput, turns: number): number {
  if (!env.pricing) return 0;
  const perTurnPrefix = env.footprintTokens + env.systemPromptTokens;
  const input = turns * perTurnPrefix + test.promptTokens;
  const output = turns * RUN_PLAN_ESTIMATE_OUTPUT_TOKENS_PER_TURN;
  return (input / 1e6) * env.pricing.inPer1M + (output / 1e6) * env.pricing.outPer1M;
}

function addRange(a: EstimateRange, b: EstimateRange): EstimateRange {
  return { low: a.low + b.low, mid: a.mid + b.mid, high: a.high + b.high };
}

const ZERO_RANGE: EstimateRange = { low: 0, mid: 0, high: 0 };

/**
 * Estimate a whole run plan: every selected test runs against every environment, `repetitions` times.
 * Tokens are summed for ALL environments; dollars only for PRICED ones (unpriced environments are
 * counted in tokens but excluded from `costUsd` and labeled). Pure over its inputs.
 */
export function estimateRunPlan(
  environments: EstimateEnvInput[],
  tests: EstimateTestInput[],
  repetitions: number,
): RunPlanEstimate {
  const reps = Math.max(1, Math.floor(repetitions));
  const testCount = tests.length;
  const environmentCount = environments.length;

  const envEstimates: RunPlanEstimateEnvironment[] = environments.map((env) => {
    const turns = turnBand(env.maxTurns);
    // Tokens for this environment across all tests × reps.
    let tokens = ZERO_RANGE;
    let cost = ZERO_RANGE;
    for (const test of tests) {
      tokens = addRange(tokens, {
        low: runTokens(env, test, turns.low),
        mid: runTokens(env, test, turns.mid),
        high: runTokens(env, test, turns.high),
      });
      cost = addRange(cost, {
        low: runCost(env, test, turns.low),
        mid: runCost(env, test, turns.mid),
        high: runCost(env, test, turns.high),
      });
    }
    const scale = (r: EstimateRange): EstimateRange => ({
      low: r.low * reps,
      mid: r.mid * reps,
      high: r.high * reps,
    });
    tokens = scale(tokens);
    cost = scale(cost);

    const priced = env.pricing !== null;
    // The most important caveat wins the single-line reason; unpriced dwarfs a missing footprint.
    const reason = !priced
      ? "Unpriced model"
      : !env.hasFootprint
        ? "No scanned server footprint"
        : undefined;

    return {
      environmentId: env.environmentId,
      name: env.name,
      model: env.model,
      priced,
      ...(reason ? { reason } : {}),
      footprintTokens: env.footprintTokens,
      hasCostCap: env.hasCostCap,
      tokens: {
        low: Math.round(tokens.low),
        mid: Math.round(tokens.mid),
        high: Math.round(tokens.high),
      },
      ...(priced ? { costUsd: cost } : {}),
    };
  });

  const totalTokens = envEstimates.reduce((acc, e) => addRange(acc, e.tokens), ZERO_RANGE);
  const totalCost = envEstimates.reduce(
    (acc, e) => (e.costUsd ? addRange(acc, e.costUsd) : acc),
    ZERO_RANGE,
  );

  return {
    testCount,
    environmentCount,
    repetitions: reps,
    totalRuns: testCount * environmentCount * reps,
    tokens: totalTokens,
    costUsd: totalCost,
    unpricedEnvironmentCount: envEstimates.filter((e) => !e.priced).length,
    uncappedEnvironmentCount: envEstimates.filter((e) => !e.hasCostCap).length,
    environments: envEstimates,
  };
}

/** Rough token count for prompt text we have but have not BPE-counted (system + user prompt). */
export function roughPromptTokens(text: string | undefined | null): number {
  if (!text) return 0;
  return Math.ceil(text.length / RUN_PLAN_ESTIMATE_CHARS_PER_TOKEN);
}
