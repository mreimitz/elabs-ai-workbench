// The lookups the compatibility engine + run engine need over the model-comparison dataset: by
// model id, the `provider.id` per model, a hand-maintained run-engine-id → dataset-id crosswalk,
// and the cross-cutting (client/host/SDK/protocol) limits.
//
// The DATA comes from the resolved reference data pack (RM-38 WP 1.2) — `getDataPack()`, never a
// file path. Nothing here knows where a pack lives, whether it was the bundled snapshot or a
// refreshed cache, or what the app is deployed on; `../data-pack/loader.ts` is the only module in
// `apps/api` that reads pack bytes.
//
// Resolution is LAZY on purpose. These functions used to run at module load, which in ESM is
// strictly before `index.ts` can install anything — so a module-load read could only ever see a
// bundled pack, whatever boot resolved. See `../data-pack/source.ts` for the whole argument.

import type { AllModels, FlatModel } from "@mcp-token-footprint/shared";
import { getDataPack } from "../data-pack/source.js";

/** Model-id index, built once per resolved pack. Keyed by the pack object so a swap rebuilds it. */
let indexedFor: AllModels | null = null;
let byId = new Map<string, FlatModel>();

function models(): AllModels {
  return getDataPack().documents.allModels;
}

function index(): Map<string, FlatModel> {
  const all = models();
  if (indexedFor !== all) {
    byId = new Map(all.models.map((m) => [m.model_id, m]));
    indexedFor = all;
  }
  return byId;
}

/**
 * Run-engine model id → dataset model id. Current-generation ids are identical between the two
 * (claude-opus-4-8, gpt-5.5, gemini-3.5-flash, …) so this is intentionally small; it captures only
 * genuine aliases / snapshot-pinned ids. Hand-maintained (frontier models ship monthly; fuzzy
 * matching is too risky to auto-derive).
 */
export const MODEL_ID_ALIASES: Record<string, string> = {
  "claude-haiku-4-5-20251001": "claude-haiku-4-5",
};

/** The full dataset (flat rows + the per-model `detail` the resolver reads). */
export function getAllModels(): AllModels {
  return models();
}

/** Cross-cutting (client/host/SDK/protocol/provider) limits, under the catalog's `cross.*` namespace. */
export function getCrossCutting(): Record<string, unknown> {
  return getDataPack().documents.crossCutting;
}

/** Resolve a run-engine model id to its dataset id (via alias table), or null if not in the dataset. */
export function resolveDatasetModelId(modelId: string): string | null {
  const lookup = index();
  const aliased = MODEL_ID_ALIASES[modelId] ?? modelId;
  if (lookup.has(aliased)) return aliased;
  // Fall back by stripping a trailing snapshot date (`-YYYYMMDD`), e.g. a provider's pinned
  // `claude-opus-4-8-20251101` → `claude-opus-4-8`. Only used when the exact id isn't in the dataset.
  const desnapshotted = aliased.replace(/-\d{8}$/, "");
  if (desnapshotted !== aliased && lookup.has(desnapshotted)) return desnapshotted;
  return null;
}

/** A model row by dataset id (after alias resolution), or undefined if unknown. */
export function getModel(modelId: string): FlatModel | undefined {
  const resolved = resolveDatasetModelId(modelId);
  return resolved ? index().get(resolved) : undefined;
}

/** Every dataset model id (canonical, for the heatmap model picker). */
export function listModelIds(): string[] {
  return models().models.map((m) => m.model_id);
}

export type ModelRef = {
  id: string;
  providerId: string;
  providerName: string;
  displayName: string;
  group: string;
  status: string | null;
  contextWindow: number | null;
};

/** Lightweight model metadata for the heatmap model picker. */
export function listModelRefs(): ModelRef[] {
  return models().models.map((m) => ({
    id: m.model_id,
    providerId: m.provider_id,
    providerName: m.provider_name,
    displayName: m.display_name ?? m.model_id,
    group: m.group,
    status: m.status,
    contextWindow: m.context_window_tokens,
  }));
}

/** A sensible default heatmap column set: current flagships across the runnable kinds + a small
 *  window for contrast. Used when the caller doesn't pass an explicit `models` list. */
export const DEFAULT_HEATMAP_MODELS = [
  "claude-opus-4-8",
  "gpt-5.5",
  "gemini-3.5-flash",
  "claude-haiku-4-5",
  "microsoft/phi-4",
];
