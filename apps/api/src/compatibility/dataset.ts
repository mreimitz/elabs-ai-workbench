// Loads the bundled model-comparison dataset (the single source of truth for model windows, tool /
// schema limits, pricing, caching) and the cross-cutting (client/host/SDK/protocol) limits, and
// exposes the lookups the compatibility engine + run engine need: by model id, the research
// `provider.id` per model, and a hand-maintained run-engine-id → dataset-id crosswalk.
//
// Assets are produced by `pnpm build:data-pack` from `data-pack/` and committed under ./data; read
// via fs from a path
// relative to this module so it works under both tsx (from src) and `node dist` (the build copies
// ./data into dist — see apps/api/scripts/copy-data.mjs).

import { readFileSync } from "node:fs";
import type { AllModels, FlatModel } from "@mcp-token-footprint/shared";

function readJson<T>(relative: string): T {
  return JSON.parse(readFileSync(new URL(relative, import.meta.url), "utf8")) as T;
}

const allModels = readJson<AllModels>("./data/all-models.json");
const crossCutting = readJson<Record<string, unknown>>("./data/cross-cutting-limits.json");

const byId = new Map<string, FlatModel>(allModels.models.map((m) => [m.model_id, m]));

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
  return allModels;
}

/** Cross-cutting (client/host/SDK/protocol/provider) limits, under the catalog's `cross.*` namespace. */
export function getCrossCutting(): Record<string, unknown> {
  return crossCutting;
}

/** Resolve a run-engine model id to its dataset id (via alias table), or null if not in the dataset. */
export function resolveDatasetModelId(modelId: string): string | null {
  const aliased = MODEL_ID_ALIASES[modelId] ?? modelId;
  if (byId.has(aliased)) return aliased;
  // Fall back by stripping a trailing snapshot date (`-YYYYMMDD`), e.g. a provider's pinned
  // `claude-opus-4-8-20251101` → `claude-opus-4-8`. Only used when the exact id isn't in the dataset.
  const desnapshotted = aliased.replace(/-\d{8}$/, "");
  if (desnapshotted !== aliased && byId.has(desnapshotted)) return desnapshotted;
  return null;
}

/** A model row by dataset id (after alias resolution), or undefined if unknown. */
export function getModel(modelId: string): FlatModel | undefined {
  const resolved = resolveDatasetModelId(modelId);
  return resolved ? byId.get(resolved) : undefined;
}

/** Every dataset model id (canonical, for the heatmap model picker). */
export function listModelIds(): string[] {
  return allModels.models.map((m) => m.model_id);
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
  return allModels.models.map((m) => ({
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
