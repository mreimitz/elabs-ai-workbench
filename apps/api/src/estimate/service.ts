// UX overhaul WP 3.5 (G7, D-UX12) — resolves the DB + pricing tables for the advisory run-plan cost
// preview, then hands fully-resolved inputs to the pure {@link estimateRunPlan}. Reads only (persisted
// scenarios, tests, and the latest completed scan per allowed server); never spawns MCP or touches
// secrets — the estimate needs NO provider key (it reads footprints + the code-side pricing tables).
//
// RM-34 WP 1.2 — it now also reads the app's own COMPLETED RUN HISTORY, to measure the turn band the
// estimator used to guess. That read lives here rather than in `estimate.ts` for the same reason
// footprints and prices do (D-ET8): the math stays pure and unit-testable, and every I/O decision —
// including the D-ET2 narrowest-first fallback below — is visible in one place.

import {
  RUN_PLAN_TURN_PROFILE_MIN_SAMPLES,
  type RunPlanEstimate,
  type RunPlanTurnBasis,
  type RunPlanTurnProfile,
} from "@mcp-token-footprint/shared";
import type { ScanRepository } from "../scans/repository.js";
import type { ScenarioService } from "../testing/scenario-service.js";
import type { TestService } from "../testing/test-service.js";
import {
  type RunTurnProfileKey,
  type RunTurnProfileSamples,
  type RunTurnSample,
  type RunRepository,
  turnProfilePairKey,
} from "../testing/run-repository.js";
import { resolvePrice } from "../providers/pricing.js";
import {
  DEFAULT_TURN_PROFILE,
  type EstimateEnvInput,
  type EstimateTestInput,
  estimateRunPlan,
  roughPromptTokens,
} from "./estimate.js";

/**
 * The environment tool-definition footprint = Σ latest-completed-scan token totals over its allowed
 * servers. A server with no successful scan contributes 0 tokens but flips `hasFootprint` off so the
 * UI can say "footprint unknown, not zero". Unknown/deleted server ids are skipped gracefully.
 */
function resolveFootprint(
  scans: ScanRepository,
  serverIds: string[],
): { footprintTokens: number; hasFootprint: boolean } {
  let footprintTokens = 0;
  let scanned = 0;
  for (const serverId of serverIds) {
    let scan: ReturnType<ScanRepository["getLatestForServer"]> = null;
    try {
      scan = scans.getLatestForServer(serverId);
    } catch {
      scan = null; // unknown/deleted server id → skip
    }
    if (scan && scan.status === "success") {
      footprintTokens += scan.totalTokens;
      scanned += 1;
    }
  }
  // hasFootprint is true only when EVERY allowed server contributed a scan (no silent gaps); with no
  // allowed servers there is genuinely nothing to load, which is a complete — not missing — footprint.
  const hasFootprint = serverIds.length === 0 || scanned === serverIds.length;
  return { footprintTokens, hasFootprint };
}

// ── RM-34 WP 1.2 — resolving ONE turn profile per environment (D-ET2) ────────────────────────────
// `measureTurnProfiles` answers with SAMPLES at three levels and no opinion about which should win.
// Turning those into one profile per environment is this file's job, and it has exactly two rules:
//
//   1. Narrowest level that clears the sample floor wins, and levels are NEVER mixed (D-ET2). A level
//      below `RUN_PLAN_TURN_PROFILE_MIN_SAMPLES` falls through WHOLE — blending a 2-run pair into its
//      environment's 79 runs would produce a figure nobody measured.
//   2. A level must speak for the WHOLE selection it is used on. See {@link resolveTurnProfile}.

/** A resolved profile plus the identity of the level it came from — so "same level?" is exact, not a numeric coincidence. */
type LeveledTurnProfile = { levelKey: string; profile: RunPlanTurnProfile };

/** Has this level enough completed runs to speak for itself (D-ET2)? A missing level never does. */
function clearsFloor(sample: RunTurnSample | undefined | null): sample is RunTurnSample {
  return sample != null && sample.sampleSize >= RUN_PLAN_TURN_PROFILE_MIN_SAMPLES;
}

function leveled(
  basis: RunPlanTurnBasis,
  levelKey: string,
  sample: RunTurnSample,
): LeveledTurnProfile {
  // `RunTurnSample` is a `RunPlanTurnProfile` minus its `basis` by construction (WP 1.1), so naming
  // the level is genuinely all that is left to do — the two shapes cannot drift apart.
  return { levelKey, profile: { basis, ...sample } };
}

/**
 * The wider half of the ladder: `environment` → `global` → `default`. Identical for every test in the
 * environment by construction, which is what makes it a safe common denominator in
 * {@link resolveTurnProfile}.
 */
function resolveWideTurnProfile(
  samples: RunTurnProfileSamples,
  environmentId: string,
): LeveledTurnProfile {
  const environment = samples.environment.get(environmentId);
  if (clearsFloor(environment))
    return leveled("environment", `environment:${environmentId}`, environment);
  if (clearsFloor(samples.global)) return leveled("global", "global", samples.global);
  return { levelKey: "default", profile: DEFAULT_TURN_PROFILE };
}

/**
 * One environment's turn profile, resolved per (environment, test) pair and then reduced to the one
 * level every selected pair agrees on.
 *
 * The awkward shape this solves: a plan selects many tests per environment, but the estimator's turn
 * band is per ENVIRONMENT — there is one band, and every selected test is costed against it. So a
 * pair-level profile may only stand for the whole environment when the environment's whole selection
 * IS that pair. With two tests selected, "test A's 51 runs" and "test B's 8 runs" are two different
 * measurements of two different things; picking A's (the first one) would quietly cost B against a
 * band nobody measured for it, and averaging their percentiles would invent a third band nobody
 * measured at all. Both are the mixing D-ET2 forbids. The honest answer is the narrowest level that
 * genuinely covers the selection — which, the moment the pairs disagree, is the environment level (or
 * whatever it in turn falls through to), a real sample that includes all of them.
 */
function resolveTurnProfile(
  samples: RunTurnProfileSamples,
  environmentId: string,
  testIds: readonly string[],
): RunPlanTurnProfile {
  const wide = resolveWideTurnProfile(samples, environmentId);
  // Resolve narrowest-first per PAIR. A pair below the floor falls through to `wide` whole — which is
  // also, deliberately, what makes it agree with every other pair that fell through.
  const perPair = [...new Set(testIds)].map((testId) => {
    const pair = samples.pair.get(turnProfilePairKey({ environmentId, testId }));
    return clearsFloor(pair) ? leveled("pair", `pair:${environmentId}:${testId}`, pair) : wide;
  });
  const first = perPair[0];
  if (!first) return wide.profile; // no tests selected for this environment — nothing to disagree
  return perPair.every((p) => p.levelKey === first.levelKey) ? first.profile : wide.profile;
}

export type EstimateDeps = {
  scenarios: ScenarioService;
  tests: TestService;
  scans: ScanRepository;
  /**
   * RM-34 WP 1.2 — completed-run history, for the measured turn band. Narrowed to the one method the
   * estimate uses: this endpoint reads run STATISTICS, and should not be able to reach a run's
   * contents by accident.
   */
  runs: Pick<RunRepository, "measureTurnProfiles">;
};

/**
 * Build the advisory estimate for a selection of tests × environments × repetitions. Unknown ids are
 * dropped (advisory, never a 404); a model with no pricing entry is reported unpriced (tokens counted,
 * dollars excluded). Pure math lives in {@link estimateRunPlan}.
 */
export function buildRunPlanEstimate(
  deps: EstimateDeps,
  input: { testIds: string[]; environmentIds: string[]; repetitions: number },
): RunPlanEstimate {
  const testById = new Map(deps.tests.list().map((t) => [t.id, t]));
  const scenarioById = new Map(deps.scenarios.list().map((s) => [s.id, s]));
  const resolvedTestRows = input.testIds
    .map((id) => testById.get(id))
    .filter((t): t is NonNullable<typeof t> => t !== undefined);
  const resolvedTests: EstimateTestInput[] = resolvedTestRows.map((t) => ({
    promptTokens: roughPromptTokens(t.userPrompt),
  }));

  const resolvedScenarios = input.environmentIds
    .map((id) => scenarioById.get(id))
    .filter((s): s is NonNullable<typeof s> => s !== undefined);

  // RM-34 WP 1.2 — ONE history read for the whole request. The widest level is every completed run
  // anyway, so a query per pair would be N+2 scans of the same three columns for the same answer.
  // The ids are the plan's real cross-product, not a guess: only tests and environments that actually
  // resolved above are asked about, so a dropped id measures nothing rather than measuring wrongly.
  const selectedTestIds = [...new Set(resolvedTestRows.map((t) => t.id))];
  const turnProfileKeys: RunTurnProfileKey[] = resolvedScenarios.flatMap((scenario) =>
    selectedTestIds.map((testId) => ({ environmentId: scenario.id, testId })),
  );
  const turnSamples = deps.runs.measureTurnProfiles(turnProfileKeys);

  const resolvedEnvs: EstimateEnvInput[] = resolvedScenarios.map((scenario) => {
    const serverIds = scenario.allowedServers.map((a) => a.serverId);
    const { footprintTokens, hasFootprint } = resolveFootprint(deps.scans, serverIds);
    // WP2.6 — the launch preview prices through the DB-backed pricing map (the code table is the
    // seed + fallback), so an owner's edited price is reflected in the cost preview too.
    // RM-33 WP 2.1 — the WHOLE resolved price is passed on. This used to be narrowed to
    // `{ inPer1M, outPer1M }` right here, silently discarding `cachedInPer1M`/`cacheWritePer1M`,
    // which is what left the preview unable to model prompt caching at all.
    const price = resolvePrice(scenario.model);
    return {
      environmentId: scenario.id,
      name: scenario.name,
      model: scenario.model,
      footprintTokens,
      systemPromptTokens: roughPromptTokens(scenario.systemPrompt),
      hasFootprint,
      hasCostCap:
        scenario.guardrails.maxCostUsd !== undefined && scenario.guardrails.maxCostUsd !== null,
      pricing: price ?? null,
      ...(scenario.guardrails.maxTurns ? { maxTurns: scenario.guardrails.maxTurns } : {}),
      // RM-34 WP 1.2 — pre-clamp and already reduced to ONE basis; `estimate.ts` applies `maxTurns`
      // to it (D-ET6) and never asks where it came from (D-ET8).
      turnProfile: resolveTurnProfile(turnSamples, scenario.id, selectedTestIds),
    } satisfies EstimateEnvInput;
  });

  return estimateRunPlan(resolvedEnvs, resolvedTests, input.repetitions);
}
