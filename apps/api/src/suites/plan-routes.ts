import type { FastifyInstance } from "fastify";
import type { RunPlanInput, SuiteConfig } from "@mcp-token-footprint/shared";
import { runPlanInputSchema, suiteConfigSchema } from "@mcp-token-footprint/shared";
import type { CollectionService } from "../collections/service.js";
import type { TestService } from "../testing/test-service.js";
import { httpError } from "../utils/errors.js";
import { stableStringify } from "../utils/json.js";
import type { ResolvedRunPlan, SuiteOrchestrator } from "./orchestrator.js";
import type { SuiteService } from "./service.js";

/**
 * Testing IA (WP 2.2, D-T5) — the ONE execution engine surfaced as `POST /api/run-plans`. Every
 * multi-test execution is a suite-run over a PLAN, and this endpoint accepts that plan from three sources
 * (`suite` · `collection` · `adhoc`), resolves it into a {@link ResolvedRunPlan}, and hands it to the
 * EXISTING {@link SuiteOrchestrator.startPlanRun} — so run-a-collection and interactive/ad-hoc sessions
 * come for free with zero bespoke mass-run path. `POST /api/suites/:id/run` still works unchanged (it now
 * delegates through the same orchestrator entry). Thin per convention: validate with the shared zod
 * schema, resolve, delegate; typed errors flow through the central handler.
 *
 * Per D-T5 no Suite row is created for a `collection`/`adhoc` plan — `source` + the serialized plan are
 * snapshotted on the `suite_runs` row instead; "Save as suite" is the existing suites CRUD (the web
 * calls it separately), NOT this endpoint.
 */

/** The services the resolver reads to turn a {@link RunPlanInput} into a concrete matrix plan. */
export type RunPlanDeps = {
  suites: SuiteService;
  collections: CollectionService;
  tests: TestService;
};

/** The bounded knobs a plan may tune (all optional; names/bounds mirror `suiteConfigSchema`). */
type RunPlanOverrides = Partial<SuiteConfig>;

/** The system defaults (bounded) for a collection/adhoc plan that supplies no overrides. */
function defaultConfig(): SuiteConfig {
  return suiteConfigSchema.parse({});
}

/**
 * Layer plan-time overrides onto a base config. Only the knobs a suite already exposes may be tuned; an
 * absent override inherits the base value. Optional fields (cost cap / judge / variants) are set only
 * when present, so a plain plan produces a plain config (no `undefined` keys leaking onto the snapshot).
 */
function mergeConfig(base: SuiteConfig, overrides: RunPlanOverrides): SuiteConfig {
  const config: SuiteConfig = {
    repetitions: overrides.repetitions ?? base.repetitions,
    maxConcurrency: overrides.maxConcurrency ?? base.maxConcurrency,
  };
  const aggregateCostCapUsd = overrides.aggregateCostCapUsd ?? base.aggregateCostCapUsd;
  if (aggregateCostCapUsd !== undefined) config.aggregateCostCapUsd = aggregateCostCapUsd;
  const judgeOverride = overrides.judgeOverride ?? base.judgeOverride;
  if (judgeOverride !== undefined) config.judgeOverride = judgeOverride;
  const variants = overrides.variants ?? base.variants;
  if (variants !== undefined) config.variants = variants;
  return config;
}

/**
 * Resolve a validated {@link RunPlanInput} into a concrete {@link ResolvedRunPlan}:
 *  - `suite`      → the saved suite's stored membership + config (overrides tune it); `suiteId` set, no plan JSON.
 *  - `collection` → EVERY test currently in the collection (resolved AT LAUNCH) × the chosen scenarios;
 *                   `suiteId` null, the plan serialized onto `plan_json`. An empty collection → honest 400.
 *  - `adhoc`      → the explicit tests × scenarios; `suiteId` null, the plan serialized onto `plan_json`.
 * An unknown suite / collection id 404s (from the respective service). Pure + exported so the resolution
 * is unit-testable independent of Fastify.
 */
export function resolveRunPlan(input: RunPlanInput, deps: RunPlanDeps): ResolvedRunPlan {
  switch (input.source) {
    case "suite": {
      const suite = deps.suites.get(input.suiteId); // 404 if unknown
      return {
        source: "suite",
        suiteId: suite.id,
        testIds: suite.testIds,
        scenarioIds: suite.scenarioIds,
        config: mergeConfig(suite.config, input),
        planJson: null,
      };
    }
    case "collection": {
      deps.collections.get(input.collectionId); // 404 if the collection is unknown
      const testIds = deps.tests.listIdsByCollection(input.collectionId);
      if (testIds.length === 0) {
        throw httpError(400, "The collection has no tests to run.");
      }
      return {
        source: "collection",
        suiteId: null,
        testIds,
        scenarioIds: input.scenarioIds,
        config: mergeConfig(defaultConfig(), input),
        planJson: stableStringify(input),
      };
    }
    case "adhoc": {
      return {
        source: "adhoc",
        suiteId: null,
        testIds: input.testIds,
        scenarioIds: input.scenarioIds,
        config: mergeConfig(defaultConfig(), input),
        planJson: stableStringify(input),
      };
    }
  }
}

export async function registerRunPlanRoutes(
  app: FastifyInstance,
  orchestrator: SuiteOrchestrator,
  deps: RunPlanDeps,
): Promise<void> {
  // Start a run from an inline plan (any of the three sources). Resolve → hand to the orchestrator ASYNC,
  // and return the running suite-run immediately with 202 — mirroring `POST /api/suites/:id/run`. Errors
  // during the async matrix surface on the suite-run stream, never as an HTTP 500 here.
  app.post("/api/run-plans", async (request, reply) => {
    const input = runPlanInputSchema.parse(request.body);
    const plan = resolveRunPlan(input, deps);
    const suiteRun = orchestrator.startPlanRun(plan);
    return reply.code(202).send(suiteRun);
  });
}
