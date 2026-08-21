// UX overhaul WP 3.5 (G7, D-UX12) — the PURE run-plan cost-estimate math. No DB, no pricing tables,
// no I/O: the route/service resolves scenarios, tests, scan footprints and model prices, then hands
// the fully-resolved inputs here. That keeps this deliberately-rough band unit-testable in isolation
// (see apps/api/test/estimate.test.ts).
//
// The estimate is ADVISORY (it blocks nothing) and intentionally wide. The dominant token driver is
// the environment's tool-definition footprint, which is re-sent to the model on every agent turn
// (eager tool loading), so the TOKEN band is essentially "how many turns will the agent take?" —
// spread by RUN_PLAN_ESTIMATE_TURNS_{LOW,MID,HIGH}, clamped by a scenario's `maxTurns` guardrail
// when it is tighter than the high assumption.
//
// RM-34 WP 1.2 — that turn band is no longer a guess when history can answer instead. The service
// measures the environment's own completed runs and hands the result in as `turnProfile`; this file
// prefers it over the three constants, and takes the per-turn OUTPUT figure from the same profile
// (D-ET4 — measuring turns while still assuming 350 output tokens a turn would be internally
// inconsistent). Nothing about the resolution happens here: which basis won is the service's
// decision, and D-ET8 keeps this file free of anything that could look it up. Two properties are
// load-bearing and each has a test:
//   * with NO profile the arithmetic is byte-identical to the pre-RM-34 output — D-ET1's fallback is
//     the constants, and a fresh install must still see the preview it always saw;
//   * `maxTurns` clamps LAST, applied to whichever band was chosen (D-ET6). A scenario guardrail is a
//     hard operator constraint, and a measured p90 above it is not evidence the run will exceed it.
//
// RM-33 WP 2.1 — the DOLLAR band no longer spreads on turns; it spreads on **prompt caching**.
// Before this WP every input token was charged at the full rate and the re-sent prefix was re-charged
// in full on every turn, which over-stated a real cached run by ~3.8x (measured: run
// 4LnBMey0w53EnDRNG__TH billed $0.798 where this file predicted $3.00). The app switches Anthropic
// caching on itself (`apps/api/src/providers/registry.ts`), so ignoring it was not a defensible
// simplification. Both ends of `costUsd` are now evaluated at the SAME (high) turn count and differ
// only in the caching assumption, so they are directly comparable; the turn spread stays on `tokens`.
// All four terms come from `computeCostBreakdownForPrice` — D-CT5: there is exactly ONE cost formula
// in the app, and this file must never grow a second one.

import {
  RUN_PLAN_ESTIMATE_CHARS_PER_TOKEN,
  RUN_PLAN_ESTIMATE_OUTPUT_TOKENS_PER_TURN,
  RUN_PLAN_ESTIMATE_TURNS_HIGH,
  RUN_PLAN_ESTIMATE_TURNS_LOW,
  RUN_PLAN_ESTIMATE_TURNS_MID,
  type EstimateRange,
  type RunPlanEstimate,
  type RunPlanEstimateEnvironment,
  type RunPlanTurnProfile,
  type TokenUsageActual,
} from "@mcp-token-footprint/shared";
import { computeCostBreakdownForPrice } from "../providers/pricing.js";

/**
 * A per-token price for a model, or `null` when the model is genuinely unpriced. Structurally a
 * `ResolvedPrice` — RM-33 WP 2.1 stopped the service narrowing it to the two headline rates, because
 * throwing away `cachedInPer1M` is exactly what made the preview cache-blind.
 */
export type EnvPricing = {
  inPer1M: number;
  outPer1M: number;
  /** Cache-READ rate. Its PRESENCE is the whole "can this model cache?" signal — see {@link cachingAssumedFor}. */
  cachedInPer1M?: number;
  /** Cache-WRITE rate when an owner pinned one; otherwise `computeCostBreakdownForPrice` derives 1.25x input. */
  cacheWritePer1M?: number;
} | null;

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
  /**
   * RM-34 WP 1.2 — the turn model measured from this environment's own completed runs, already
   * resolved to ONE basis by the service (D-ET2/D-ET8). Absent ⇒ the D-ET1 static constants, which
   * is what a fresh install, a brand-new environment and a never-run test all still get.
   *
   * Pre-clamp by contract: `maxTurns` is applied to it here, not before it arrives.
   */
  turnProfile?: RunPlanTurnProfile;
};

/** One test, reduced to the only thing the estimate needs: its rough user-prompt token count. */
export type EstimateTestInput = { promptTokens: number };

/**
 * RM-34 WP 1.2 (D-ET1) — the turn model when history has nothing to say: the three static constants,
 * reported as an honest `basis: "default"` with `sampleSize: 0` rather than left off the wire. "No
 * profile" and "a profile that measured nothing" must be the same visible answer, because the
 * launcher's whole reason for showing a basis is that an operator can tell a measured band from a
 * guessed one — and a silently-missing field reads as neither.
 *
 * Exported so the service resolves against exactly this object instead of re-deriving the constants
 * (two spellings of "the default" is one too many).
 */
export const DEFAULT_TURN_PROFILE: RunPlanTurnProfile = {
  basis: "default",
  sampleSize: 0,
  turns: {
    low: RUN_PLAN_ESTIMATE_TURNS_LOW,
    mid: RUN_PLAN_ESTIMATE_TURNS_MID,
    high: RUN_PLAN_ESTIMATE_TURNS_HIGH,
  },
  outputTokensPerTurn: RUN_PLAN_ESTIMATE_OUTPUT_TOKENS_PER_TURN,
};

/** The turn model this environment is estimated on — measured when the service found one, else D-ET1's constants. */
function turnProfileFor(env: EstimateEnvInput): RunPlanTurnProfile {
  return env.turnProfile ?? DEFAULT_TURN_PROFILE;
}

/**
 * The turn band actually used, with `maxTurns` clamped LAST over whichever band was chosen (D-ET6).
 *
 * The order matters and is the point of the WP: clamping first, then choosing, would silently hold a
 * measured p90 of 16 down to the old ceiling of 8 and revert RM-34 to a rename. Note the no-cap case
 * is `Infinity`, not `RUN_PLAN_ESTIMATE_TURNS_HIGH` — that constant is the DEFAULT's own high end,
 * never a ceiling on a measured one, and reusing it as the cap would put the 8 back by the side door.
 * `Math.min` is monotone, so `low ≤ mid ≤ high` survives any cap.
 */
function turnBand(env: EstimateEnvInput): EstimateRange {
  const base = turnProfileFor(env).turns;
  const cap = env.maxTurns && env.maxTurns > 0 ? env.maxTurns : Number.POSITIVE_INFINITY;
  return {
    low: Math.min(base.low, cap),
    mid: Math.min(base.mid, cap),
    high: Math.min(base.high, cap),
  };
}

/**
 * Rough tokens for ONE run (one test × one environment) at a given turn count. The system prompt +
 * tool-definition footprint are re-sent every turn; the user prompt is sent once; the agent emits
 * {@link turnProfileFor}'s `outputTokensPerTurn` per turn — measured from this environment's own
 * completed runs when there are enough of them, else the D-ET1 constant. Deliberately ignores
 * conversation growth and attachments (noted as an estimate in the UI).
 *
 * Its input term is duplicated, deliberately and byte-identically, in {@link runUsage}: that function
 * re-PRICES exactly the tokens this one COUNTS. Change the arithmetic in one and you must change it
 * in the other, or the launcher will show a dollar figure for a token figure it never displayed.
 */
function runTokens(env: EstimateEnvInput, test: EstimateTestInput, turns: number): number {
  const perTurnPrefix = env.footprintTokens + env.systemPromptTokens;
  const input = turns * perTurnPrefix + test.promptTokens;
  const output = turns * turnProfileFor(env).outputTokensPerTurn;
  return Math.round(input + output);
}

/**
 * RM-33 WP 2.1 — whether this environment's cost band may model prompt caching at all.
 *
 * The signal is the resolved price publishing a cache-READ rate, and nothing else. There is
 * deliberately no provider-kind fork ("is this Anthropic?"): a model we cannot price for cache reads
 * would otherwise be charged a 1.25x cache-WRITE premium on its first turn with no discount to offset
 * it, which is a worse lie than simply not claiming caching. When this is `false` the band collapses
 * to today's full-rate number at both ends — correct, not a special case.
 */
function cachingAssumedFor(env: EstimateEnvInput): boolean {
  return env.pricing !== null && env.pricing.cachedInPer1M !== undefined;
}

/**
 * The token shape of ONE run at a turn count, as a {@link TokenUsageActual} the single cost formula
 * can price. `inputTokens` is the GROSS total (D-CT1 — it already includes the cached slice), and is
 * byte-identical to {@link runTokens}'s input term: this WP re-prices the same tokens, it does not
 * re-count them.
 *
 * With `cached`, the prefix the agent re-sends every turn is modelled honestly: turn 1 WRITES it
 * (1.25x), turns 2..N READ it (~0.1x), and the per-turn delta — here the user prompt — stays
 * uncached at the full rate. With `cached` off, no cache slice is declared and the formula reduces to
 * `input x inPer1M + output x outPer1M`, i.e. exactly the pre-RM-33 arithmetic.
 */
function runUsage(
  env: EstimateEnvInput,
  test: EstimateTestInput,
  turns: number,
  cached: boolean,
): TokenUsageActual {
  const perTurnPrefix = env.footprintTokens + env.systemPromptTokens;
  const inputTokens = turns * perTurnPrefix + test.promptTokens;
  const outputTokens = turns * turnProfileFor(env).outputTokensPerTurn;
  if (!cached) return { inputTokens, outputTokens };
  return {
    inputTokens,
    outputTokens,
    cacheWriteTokens: turns >= 1 ? perTurnPrefix : 0,
    cacheReadTokens: Math.max(0, turns - 1) * perTurnPrefix,
  };
}

/**
 * The two ends of one run's cost band at a turn count: `cached` prices the re-sent prefix as one
 * cache write plus cache reads, `uncached` charges every input token the full rate (the pre-RM-33
 * number). Unpriced ⇒ `0` at both ends, exactly as before — that is `priced: false`'s job to explain,
 * never a zero pretending to be free.
 */
function runCostEnds(
  env: EstimateEnvInput,
  test: EstimateTestInput,
  turns: number,
): { cached: number; uncached: number } {
  const price = env.pricing ?? undefined;
  const uncached = computeCostBreakdownForPrice(price, runUsage(env, test, turns, false)).totalUsd;
  if (!cachingAssumedFor(env)) return { cached: uncached, uncached };
  return {
    cached: computeCostBreakdownForPrice(price, runUsage(env, test, turns, true)).totalUsd,
    uncached,
  };
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
    const turns = turnBand(env);
    // Tokens for this environment across all tests × reps.
    let tokens = ZERO_RANGE;
    // RM-33 WP 2.1 — dollars are accumulated as the TWO caching ends, both at `turns.high`, not as a
    // turn band. `turns.high` is the turn count the pre-RM-33 `costUsd.high` already used, which is
    // what keeps the old arithmetic the band's honest upper bound.
    let cachedCost = 0;
    let uncachedCost = 0;
    for (const test of tests) {
      tokens = addRange(tokens, {
        low: runTokens(env, test, turns.low),
        mid: runTokens(env, test, turns.mid),
        high: runTokens(env, test, turns.high),
      });
      const ends = runCostEnds(env, test, turns.high);
      cachedCost += ends.cached;
      uncachedCost += ends.uncached;
    }
    const scale = (r: EstimateRange): EstimateRange => ({
      low: r.low * reps,
      mid: r.mid * reps,
      high: r.high * reps,
    });
    tokens = scale(tokens);
    cachedCost *= reps;
    uncachedCost *= reps;

    // `low`/`high` are min/max rather than "cached is always the cheap one", because on a ONE-turn
    // plan (`maxTurns: 1`) the whole prefix is a cache WRITE at 1.25x with no read to offset it, so
    // caching genuinely costs more. The band's job is to bracket both outcomes; asserting an order
    // that the arithmetic does not always produce would be the dishonest option. For every turn count
    // >= 2 with a published cache-read rate this resolves to low = cached, high = the old number.
    // `mid` is their midpoint: the caching assumption has exactly two honest ends, and inventing a
    // third would be a figure nobody measured. Nothing renders `costUsd.mid` — the launcher shows
    // low–high — but `EstimateRange` has three slots and `low <= mid <= high` must hold.
    const costLow = Math.min(cachedCost, uncachedCost);
    const costHigh = Math.max(cachedCost, uncachedCost);
    const cost: EstimateRange = {
      low: costLow,
      mid: (costLow + costHigh) / 2,
      high: costHigh,
    };
    const cachingAssumed = cachingAssumedFor(env);

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
      cachingAssumed,
      // RM-34 WP 1.2 (D-ET5) — the turn model behind `tokens`, reported PRE-CLAMP. The clamp is a
      // property of the scenario's guardrail, not of the measurement, and conflating them would make
      // "this environment usually takes 16 turns, capped at 5" unreadable as "it takes 5".
      turnProfile: turnProfileFor(env),
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
    // RM-33 WP 2.1 — `some`, not `every`: the plan band is a sum, so ONE caching environment already
    // makes `costUsd.low` a genuinely cache-discounted figure the label has to explain. A plan where
    // no environment can cache reports `false`, and its low and high ends are equal.
    cachingAssumed: envEstimates.some((e) => e.cachingAssumed === true),
    environments: envEstimates,
  };
}

/** Rough token count for prompt text we have but have not BPE-counted (system + user prompt). */
export function roughPromptTokens(text: string | undefined | null): number {
  if (!text) return 0;
  return Math.ceil(text.length / RUN_PLAN_ESTIMATE_CHARS_PER_TOKEN);
}
