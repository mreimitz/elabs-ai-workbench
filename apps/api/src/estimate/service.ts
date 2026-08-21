// UX overhaul WP 3.5 (G7, D-UX12) — resolves the DB + pricing tables for the advisory run-plan cost
// preview, then hands fully-resolved inputs to the pure {@link estimateRunPlan}. Reads only (persisted
// scenarios, tests, and the latest completed scan per allowed server); never spawns MCP or touches
// secrets — the estimate needs NO provider key (it reads footprints + the code-side pricing tables).

import type { RunPlanEstimate } from "@mcp-token-footprint/shared";
import type { ScanRepository } from "../scans/repository.js";
import type { ScenarioService } from "../testing/scenario-service.js";
import type { TestService } from "../testing/test-service.js";
import { resolvePrice } from "../providers/pricing.js";
import {
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

export type EstimateDeps = {
  scenarios: ScenarioService;
  tests: TestService;
  scans: ScanRepository;
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
  const resolvedTests: EstimateTestInput[] = input.testIds
    .map((id) => testById.get(id))
    .filter((t): t is NonNullable<typeof t> => t !== undefined)
    .map((t) => ({ promptTokens: roughPromptTokens(t.userPrompt) }));

  const resolvedEnvs: EstimateEnvInput[] = input.environmentIds
    .map((id) => scenarioById.get(id))
    .filter((s): s is NonNullable<typeof s> => s !== undefined)
    .map((scenario) => {
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
      } satisfies EstimateEnvInput;
    });

  return estimateRunPlan(resolvedEnvs, resolvedTests, input.repetitions);
}
