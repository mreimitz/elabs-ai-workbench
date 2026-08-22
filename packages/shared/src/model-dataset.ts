// The shape of the model-comparison dataset — `data-pack/generated/all-models.json`, built from the
// hand-curated per-provider entries under `data-pack/models/**`.
//
// This is the ONE definition. `data-pack/build/build.ts` declares it as the return type of its
// merge, and every consumer in `apps/api/src/compatibility/*` imports it from here, so the builder
// and the readers cannot drift apart without a compile error. It lives in `packages/shared` rather
// than beside the builder because RM-38 moved the builder to `data-pack/`, which is outside any
// app's `rootDir` — and because a dataset row IS a contract, not a build detail.
//
// The leaves stay `unknown` on purpose: every fact in a provider entry is a "provenanced" node
// (`{ value, confidence, source_url, source_tier, as_of, … }`) whose `value` is deliberately
// polymorphic, and the severity resolver reads it by dotted path. Narrowing it here would either
// lie about the data or force a second schema next to `model-entry.schema.json`.

/** One model as authored in a provider file, kept whole as `FlatModel.detail`. */
export type ModelDatasetEntry = {
  id: string;
  display_name?: string;
  family?: string;
  status?: string;
  context: Record<string, unknown>;
  tokenization: Record<string, unknown>;
  tools_mcp: Record<string, unknown>;
  skills_context: Record<string, unknown>;
  cost: Record<string, unknown>;
  [key: string]: unknown;
};

/** One row of the flat index: the load-bearing facts hoisted out, plus the whole entry as `detail`. */
export type FlatModel = {
  provider_id: string;
  provider_name: string;
  group: string;
  model_id: string;
  display_name: string | null;
  family: string | null;
  status: string | null;
  context_window_tokens: number | null;
  max_input_tokens: number | null;
  max_output_tokens_max: number | null;
  tokenizer_family: unknown;
  function_calling: unknown;
  native_mcp: unknown;
  max_tools_hard: number | null;
  max_tools_practical: number | null;
  tool_definition_shape: unknown;
  tool_search_deferral: unknown;
  tool_defs_count_as_input: unknown;
  skills_supported: unknown;
  prompt_caching: unknown;
  input_per_mtok_usd: number | null;
  output_per_mtok_usd: number | null;
  cached_input_per_mtok_usd: number | null;
  billing_unit: unknown;
  reasoning_billed_as_output: unknown;
  /** Repo-relative path of the pack file this row came from — provenance, not data. */
  source_file: string;
  detail: ModelDatasetEntry;
};

/** `data-pack/generated/all-models.json` in full. */
export type AllModels = {
  schema_version: string;
  as_of: string;
  generator: string;
  provider_count: number;
  model_count: number;
  models: FlatModel[];
};

/** Per-1M-token USD list price, as derived into `model-data.generated.ts`. */
export type DerivedPrice = { inPer1M: number; outPer1M: number; cachedInPer1M?: number };
