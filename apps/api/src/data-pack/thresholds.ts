// The judgement tables the app reads out of the resolved pack (RM-38 WP 2.2).
//
// Three documents, two shapes of answer:
//
//   * ADVISOR thresholds are PACK-ONLY. Nothing outside `apps/api/src/advisor/` reads them, the
//     pack's JSON Schema marks every key required, and the loader refuses a pack that omits one —
//     so there is no floor to merge and no `??` anywhere below. A missing threshold is a refused
//     pack, not a silently disabled severity band.
//
//   * MODEL and QUALITY values are merged over a COMPILED FLOOR (D-DP3). The floor is
//     `packages/shared/src/pack-defaults.generated.ts`, rendered from the same authored pack files
//     by `pnpm build:data-pack` — so it is derived, not a second maintained copy (D-DP1). It is a
//     merge BASE, not an if-the-pack-is-absent fallback: a pack that DROPS a model must not be able
//     to unknow its context window (which silently disables the compaction guardrail) or unprice it
//     (which makes `isModelPriced()` false, REFUSING a cost-capped run and making `estimateCost()`
//     return 0, so a mission's `shouldAutoApprove` compares planned spend against $0).
//
// MERGE PRECEDENCE IS CONTRACT and `apps/api/test/data-pack-thresholds.test.ts` fails if two lines
// are swapped:
//
//     compiled floor  →  pack legacy  →  pack roster-gap  →  pack generated dataset
//
// with the DB-backed `PricingRepository` resolver (`providers/pricing.ts`) still winning over all
// of it for prices.
//
// Every accessor resolves LAZILY through `getDataPack()` and memoizes per resolved pack object, for
// exactly the reason `source.ts`'s header gives: a module-load read cannot observe the boot-time
// install, and a fresh merge of ~200 keys on every accounting step would be wasteful.

import {
  type DataPackAdvisorThresholds,
  type DataPackModelPrice,
  type DataPackQualityThresholds,
  DEFAULT_HEATMAP_MODELS as FLOOR_DEFAULT_HEATMAP_MODELS,
  LEGACY_MODEL_PRICING as FLOOR_LEGACY_MODEL_PRICING,
  MODEL_CONTEXT_LIMITS as FLOOR_MODEL_CONTEXT_LIMITS,
  MODEL_ID_ALIASES as FLOOR_MODEL_ID_ALIASES,
  ROSTER_GAP_MODEL_PRICING as FLOOR_ROSTER_GAP_MODEL_PRICING,
  ZERO_PRICE_MODELS as FLOOR_ZERO_PRICE_MODELS,
} from "@mcp-token-footprint/shared";
import { config } from "../config/env.js";
import type { ResolvedDataPack } from "./loader.js";
import { getDataPack } from "./source.js";

/** A per-1M-token USD price as the pack and the compiled floor both spell it. */
export type ModelPrice = DataPackModelPrice;

/** Memoize one derived view per resolved pack. A pack swap (WP 3.1) invalidates by identity. */
function perPack<T>(compute: (pack: ResolvedDataPack) => T): () => T {
  let forPack: ResolvedDataPack | null = null;
  let value: T | undefined;
  return () => {
    const pack = getDataPack();
    if (forPack !== pack || value === undefined) {
      value = compute(pack);
      forPack = pack;
    }
    return value;
  };
}

// --- Advisor (pack-only) ------------------------------------------------------------------------

/**
 * Every tunable number the deterministic advisor rules read, from the pack in force.
 *
 * `highWasteShare` / `mediumWasteShare` are ONE entry here for what used to be two identical
 * constant pairs in `unused-tool-trim.ts` and `quality-validated-trim.ts`
 * (`apps/api/test/data-pack-thresholds.test.ts` fails if a second copy reappears).
 */
export function advisorThresholds(): DataPackAdvisorThresholds {
  return getDataPack().documents.advisorThresholds;
}

// --- Quality (floor + pack) ---------------------------------------------------------------------

/** The shared skill-quality / compare / loop / budget numbers, from the pack in force. */
export function qualityThresholds(): DataPackQualityThresholds {
  return getDataPack().documents.qualityThresholds;
}

/**
 * The L1/L2 skill-quality ceilings, resolved **env → pack → compiled default** (asserted by test).
 *
 * `config` holds only the ENV override (`null` when unset) — it cannot hold the resolved value,
 * because `config/env.ts` is evaluated at module load and `data-pack/resolve.ts` imports it, so a
 * pack read from there would be a cycle as well as too early.
 */
export function skillQualityCeilings(): { l1: number; l2: number } {
  const pack = qualityThresholds();
  return {
    l1: config.skillQualityL1TokenCeilingOverride ?? pack.skill_quality_l1_token_ceiling,
    l2: config.skillQualityL2TokenCeilingOverride ?? pack.skill_quality_l2_token_ceiling,
  };
}

/** D-MCP5 — the token budget the workbench's own MCP mount holds its tools/list payload under. */
export function workbenchMcpDefinitionTokenBudget(): number {
  return qualityThresholds().workbench_mcp_definition_token_budget;
}

// --- Models (floor + pack, order is contract) ---------------------------------------------------

/**
 * Context window (tokens) per model id: **compiled floor → pack legacy → pack roster-gap → pack
 * generated dataset.**
 *
 * The floor comes first so a pack that omits a model cannot unknow its window (D-DP3); the three
 * pack layers keep the exact precedence `MODEL_CONTEXT_LIMITS` has always had, so a dataset refresh
 * still wins over both hand-maintained seeds.
 */
export const modelContextLimits = perPack(modelContextLimitsFor);

/**
 * The same merge, over a pack the CALLER already holds.
 *
 * Exported (RM-38 WP 3.2) so `data-pack/status.ts` can project the browser's copy of this map out of
 * the SAME `ResolvedDataPack` object it reads the metadata from — the accessor above would resolve
 * `getDataPack()` a second time, which is the seam through which a payload could name one pack's
 * version beside another pack's values. One merge, two entry points.
 */
export function modelContextLimitsFor(pack: ResolvedDataPack): Record<string, number> {
  const overrides = pack.documents.modelOverrides;
  const generated: Record<string, number> = {};
  for (const model of pack.documents.allModels.models) {
    if (model.context_window_tokens !== null) generated[model.model_id] = model.context_window_tokens;
  }
  return {
    ...FLOOR_MODEL_CONTEXT_LIMITS,
    ...overrides.legacy_context_limits,
    ...overrides.roster_gap_context_limits,
    ...generated,
  };
}

/**
 * List price per model id, in the same four-layer order. The zero-price allowlist is spread into
 * the legacy layer exactly where `pricing.ts` has always spread it, so a local model stays priced
 * at an explicit `0` (a KNOWN price) rather than becoming price-unknown.
 */
export const modelPricingTable = perPack((pack): Record<string, ModelPrice> => {
  const overrides = pack.documents.modelOverrides;
  const generated: Record<string, ModelPrice> = {};
  for (const model of pack.documents.allModels.models) {
    if (model.input_per_mtok_usd === null || model.output_per_mtok_usd === null) continue;
    const price: ModelPrice = {
      inPer1M: model.input_per_mtok_usd,
      outPer1M: model.output_per_mtok_usd,
    };
    if (model.cached_input_per_mtok_usd !== null) {
      price.cachedInPer1M = model.cached_input_per_mtok_usd;
    }
    generated[model.model_id] = price;
  }
  return {
    ...compiledPricingFloor(),
    ...overrides.legacy_pricing,
    ...zeroPriceEntriesFrom(overrides.zero_price_models),
    ...overrides.roster_gap_pricing,
    ...generated,
  };
});

/** The compiled pricing floor: the same legacy ∪ zero ∪ roster-gap union `pricing.ts` seeds with. */
function compiledPricingFloor(): Record<string, ModelPrice> {
  return {
    ...FLOOR_LEGACY_MODEL_PRICING,
    ...zeroPriceEntriesFrom(FLOOR_ZERO_PRICE_MODELS),
    ...FLOOR_ROSTER_GAP_MODEL_PRICING,
  };
}

function zeroPriceEntriesFrom(ids: readonly string[]): Record<string, ModelPrice> {
  return Object.fromEntries(ids.map((id) => [id, { inPer1M: 0, outPer1M: 0 }]));
}

/**
 * Local / on-device models priced at an explicit `0` AND treated as a KNOWN price — the floor UNION
 * the pack's list, never the pack alone: dropping a model from this list makes it price-unknown,
 * which refuses a cost-capped run (D-DP3).
 */
export const zeroPriceModels = perPack((pack): readonly string[] => {
  const merged = new Set<string>([
    ...FLOOR_ZERO_PRICE_MODELS,
    ...pack.documents.modelOverrides.zero_price_models,
  ]);
  return [...merged];
});

/** Run-engine model id → dataset model id, pack over floor. */
export const modelIdAliases = perPack((pack): Record<string, string> => ({
  ...FLOOR_MODEL_ID_ALIASES,
  ...pack.documents.modelOverrides.model_id_aliases,
}));

/**
 * The default compatibility-heatmap column set. The pack REPLACES the floor here rather than
 * merging: this is an ordered display list, not a safety floor — a merge would silently append
 * columns an operator deliberately removed.
 */
export const defaultHeatmapModels = perPack((pack): readonly string[] => {
  const fromPack = pack.documents.modelOverrides.default_heatmap_models;
  return fromPack.length > 0 ? fromPack : FLOOR_DEFAULT_HEATMAP_MODELS;
});
