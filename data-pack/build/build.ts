// Pure build + derivation logic for the model-comparison dataset (no fs side effects, fully
// typechecked + unit-testable). The CLI wrapper (`build-cli.ts`) does the fs read/write; the drift
// test re-runs these functions in-memory and asserts the committed assets match.
//
// This is the TypeScript port of the research reference
// `planning/Research/RS-01-token-context-comparison/outputs/comparison/build_comparison.py`
// (Decision 2: no Python in the runtime or quality gate). The per-provider JSON files under
// `data-pack/models/**` remain the human-curated source of truth; this code merges them into the
// flat `all-models.json` index the compatibility engine reads, and derives the model-context-window
// + pricing maps the run engine consumes (Decision 1: unify on the dataset).

import type {
  AllModels,
  DerivedPrice,
  FlatModel,
  ModelDatasetEntry,
} from "@mcp-token-footprint/shared";
import { z } from "zod";

// --- Provenanced value (mirror of schema/model-entry.schema.json `$defs/provenanced`) ------------

const ProvenancedSchema = z
  .object({
    value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
    unit: z.string().optional(),
    source_url: z.string().nullable().optional(),
    source_tier: z.number().optional(),
    confidence: z.enum(["high", "medium", "low"]).optional(),
    as_of: z.string().optional(),
    derived: z.boolean().optional(),
    notes: z.string().optional(),
  })
  .passthrough();

// A model entry / provider file are intentionally loose (additionalProperties allowed upstream); we
// validate only the load-bearing structure the engine + derivation depend on, and keep the full
// object as `detail` for the resolver.
const ModelSchema = z
  .object({
    id: z.string(),
    display_name: z.string().optional(),
    family: z.string().optional(),
    status: z.string().optional(),
    context: z.object({ context_window_tokens: ProvenancedSchema.optional() }).passthrough(),
    tokenization: z.record(z.unknown()),
    tools_mcp: z.record(z.unknown()),
    skills_context: z.record(z.unknown()),
    cost: z.record(z.unknown()),
  })
  .passthrough();

const ProviderFileSchema = z
  .object({
    schema_version: z.string(),
    as_of: z.string(),
    provider: z
      .object({
        id: z.string(),
        name: z.string(),
        group: z.enum(["saas", "open_weight"]),
      })
      .passthrough(),
    models: z.array(ModelSchema).min(1),
  })
  .passthrough();

export type ProviderFile = z.infer<typeof ProviderFileSchema>;
export type ModelEntry = z.infer<typeof ModelSchema>;

// A parsed model entry must satisfy the shared dataset shape — if the zod schema and
// `packages/shared/src/model-dataset.ts` ever drift, this line stops compiling.
type _ModelEntryMatchesShared = ModelEntry extends ModelDatasetEntry ? true : never;
const _modelEntryMatchesShared: _ModelEntryMatchesShared = true;
void _modelEntryMatchesShared;

/** A provenanced node carries `{ value, confidence, ... }`; tolerate plain values / nullish. */
function pv(node: unknown): { value: unknown; confidence?: string } {
  if (node && typeof node === "object" && "value" in (node as Record<string, unknown>)) {
    const n = node as Record<string, unknown>;
    return {
      value: n.value,
      confidence: typeof n.confidence === "string" ? n.confidence : undefined,
    };
  }
  if (node && typeof node === "object") return { value: null };
  return { value: node };
}

/** Walk a dotted path through nested objects, returning the node or undefined. */
function get(obj: unknown, ...path: string[]): unknown {
  let cur: unknown = obj;
  for (const p of path) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function num(node: unknown): number | null {
  const v = pv(node).value;
  return typeof v === "number" ? v : null;
}

// `FlatModel` (the flat per-model row, mirror of `build_comparison.py:flat`) and `AllModels` are
// defined once in `packages/shared/src/model-dataset.ts`; this builder is held to them by the
// return types below.

function flat(provider: ProviderFile, m: ModelEntry, sourceFile: string): FlatModel {
  const p = provider.provider;
  return {
    provider_id: p.id,
    provider_name: p.name,
    group: p.group,
    model_id: m.id,
    display_name: m.display_name ?? null,
    family: m.family ?? null,
    status: m.status ?? null,
    context_window_tokens: num(get(m, "context", "context_window_tokens")),
    max_input_tokens: num(get(m, "context", "max_input_tokens")),
    max_output_tokens_max: num(get(m, "context", "max_output_tokens_max")),
    tokenizer_family: pv(get(m, "tokenization", "tokenizer_family")).value,
    function_calling: pv(get(m, "tools_mcp", "function_calling")).value,
    native_mcp: pv(get(m, "tools_mcp", "native_mcp")).value,
    max_tools_hard: num(get(m, "tools_mcp", "max_tools_hard")),
    max_tools_practical: num(get(m, "tools_mcp", "max_tools_practical")),
    tool_definition_shape: pv(get(m, "tools_mcp", "tool_definition_shape")).value,
    tool_search_deferral: pv(get(m, "tools_mcp", "tool_search_deferral")).value,
    tool_defs_count_as_input: pv(get(m, "tools_mcp", "tool_defs_count_as_input")).value,
    skills_supported: pv(get(m, "skills_context", "skills_supported")).value,
    prompt_caching: pv(get(m, "skills_context", "prompt_caching")).value,
    input_per_mtok_usd: num(get(m, "cost", "input_per_mtok_usd")),
    output_per_mtok_usd: num(get(m, "cost", "output_per_mtok_usd")),
    cached_input_per_mtok_usd: num(get(m, "cost", "cached_input_per_mtok_usd")),
    billing_unit: pv(get(m, "cost", "billing_unit")).value,
    reasoning_billed_as_output: pv(get(m, "cost", "reasoning_billed_as_output")).value,
    source_file: sourceFile,
    detail: m,
  };
}

const GROUP_ORDER: Record<string, number> = { saas: 0, open_weight: 1 };

/**
 * Validate + merge the per-provider files into the flat `all-models.json` index. `as_of` is taken
 * from the newest provider file so the bundled asset is deterministic (no wall-clock timestamp — the
 * drift CI re-runs this and byte-compares, so non-determinism would break it).
 */
export function buildAllModels(files: { relPath: string; data: unknown }[]): AllModels {
  const parsed = files
    .map((f) => {
      const r = ProviderFileSchema.safeParse(f.data);
      if (!r.success) {
        throw new Error(
          `Invalid provider data file ${f.relPath}: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
        );
      }
      return { relPath: f.relPath, file: r.data };
    })
    .sort((a, b) => {
      const ga = GROUP_ORDER[a.file.provider.group] ?? 9;
      const gb = GROUP_ORDER[b.file.provider.group] ?? 9;
      return (
        ga - gb ||
        a.file.provider.name.toLowerCase().localeCompare(b.file.provider.name.toLowerCase())
      );
    });

  const models: FlatModel[] = [];
  let asOf = "";
  for (const { relPath, file } of parsed) {
    if (file.as_of > asOf) asOf = file.as_of;
    for (const m of file.models) models.push(flat(file, m, relPath));
  }

  // Guard against duplicate model ids — they would silently shadow each other in the by-id index.
  const seen = new Set<string>();
  for (const m of models) {
    if (seen.has(m.model_id))
      throw new Error(`Duplicate model id across provider files: ${m.model_id}`);
    seen.add(m.model_id);
  }

  return {
    schema_version: "1.0",
    as_of: asOf,
    generator: "data-pack/build/build.ts",
    provider_count: parsed.length,
    model_count: models.length,
    models,
  };
}

// --- Derivations consumed by the run engine (Decision 1) ----------------------------------------

/** Context-window map (model id → tokens) for every model with a documented window. */
export function deriveContextLimits(all: AllModels): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of all.models) {
    if (m.context_window_tokens !== null) out[m.model_id] = m.context_window_tokens;
  }
  return out;
}

/** Pricing map (model id → per-1M USD) for every model with documented input+output prices. */
export function derivePricing(all: AllModels): Record<string, DerivedPrice> {
  const out: Record<string, DerivedPrice> = {};
  for (const m of all.models) {
    if (m.input_per_mtok_usd === null || m.output_per_mtok_usd === null) continue;
    const price: DerivedPrice = { inPer1M: m.input_per_mtok_usd, outPer1M: m.output_per_mtok_usd };
    if (m.cached_input_per_mtok_usd !== null) price.cachedInPer1M = m.cached_input_per_mtok_usd;
    out[m.model_id] = price;
  }
  return out;
}

/** Render the committed `packages/shared/src/model-data.generated.ts` (deterministic, sorted). */
export function renderSharedGenerated(all: AllModels): string {
  const limits = deriveContextLimits(all);
  const pricing = derivePricing(all);
  const limitLines = Object.keys(limits)
    .sort()
    .map((k) => `  ${JSON.stringify(k)}: ${limits[k]}`)
    .join(",\n");
  const priceLines = Object.keys(pricing)
    .sort()
    .map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(pricing[k])}`)
    .join(",\n");
  return `// GENERATED — do not edit by hand.
// Source of truth: data-pack/models/**; regenerate with \`pnpm build:data-pack\`.
// Derived from the model-comparison dataset (as-of ${all.as_of}; ${all.model_count} models).

/** Context window (tokens) per model id, for every model with a documented window. */
export const GENERATED_MODEL_CONTEXT_LIMITS: Record<string, number> = {
${limitLines}
};

export type GeneratedModelPrice = { inPer1M: number; outPer1M: number; cachedInPer1M?: number };

/** Per-1M-token USD list price per model id, for every model with documented input+output prices. */
export const GENERATED_MODEL_PRICING: Record<string, GeneratedModelPrice> = {
${priceLines}
};
`;
}

/** Stable JSON serialization for the bundled asset (2-space indent, trailing newline). */
export function serializeAllModels(all: AllModels): string {
  return JSON.stringify(all, null, 2) + "\n";
}

// --- The compiled floor (RM-38 WP 2.2, D-DP3) ---------------------------------------------------
//
// `data-pack/models/overrides.json` and `data-pack/quality/thresholds.json` are the AUTHORED copy of
// these values. But `packages/shared` may never touch the filesystem and `apps/web` reads several of
// them (`MODEL_CONTEXT_LIMITS`, `DEFAULT_COMPARE_THRESHOLD`, `FAILURE_BUCKET_SCORE_THRESHOLD`), so a
// compiled copy has to exist somewhere. Rendering it here rather than hand-maintaining it is what
// keeps D-DP1's "nothing else in the tree may hold a second copy" true: there is one authored copy
// and one DERIVED one, and `apps/api/test/compatibility-data.test.ts` rebuilds and byte-compares.
//
// D-DP3 is the reason this floor exists at all: an unknown context window silently disables a
// guardrail and an unpriced model makes `isModelPriced()` false, which REFUSES a cost-capped run.
// The floor is a merge BASE the runtime pack layers over — never an if-the-pack-is-absent fallback.

/** A price map key ordering that JSON.stringify cannot reorder — sorted, always. */
function renderRecord(record: Record<string, unknown>, indent = "  "): string {
  return Object.keys(record)
    .sort()
    .map((k) => `${indent}${JSON.stringify(k)}: ${JSON.stringify(record[k])}`)
    .join(",\n");
}

function renderStringArray(values: readonly string[], indent = "  "): string {
  return values.map((v) => `${indent}${JSON.stringify(v)}`).join(",\n");
}

/**
 * Render `packages/shared/src/pack-defaults.generated.ts` from the two authored judgement files.
 *
 * Both arguments are the PARSED JSON documents. They are typed loosely here on purpose: this module
 * must not import `packages/shared`'s zod contracts (the pack build runs before `shared` is built —
 * the same constraint that made `PACK_SCHEMA_VERSION` a separate constant), and the pack loader
 * validates both documents against those contracts at runtime anyway.
 */
export function renderPackDefaults(input: {
  modelOverrides: {
    legacy_context_limits: Record<string, number>;
    roster_gap_context_limits: Record<string, number>;
    legacy_pricing: Record<string, DerivedPrice>;
    roster_gap_pricing: Record<string, DerivedPrice>;
    zero_price_models: string[];
    default_heatmap_models: string[];
    model_id_aliases: Record<string, string>;
    assistant_default_model_roster: string[];
    assistant_default_title_model: string;
  };
  qualityThresholds: {
    skill_quality_l1_token_ceiling: number;
    skill_quality_l2_token_ceiling: number;
    quality_severity_weights: { error: number; warning: number; info: number };
    default_compare_threshold: number;
    default_loop_threshold: number;
    failure_bucket_score_threshold: number;
    workbench_mcp_definition_token_budget: number;
  };
}): string {
  const m = input.modelOverrides;
  const q = input.qualityThresholds;
  return `// GENERATED — do not edit by hand.
// Source of truth: data-pack/models/overrides.json + data-pack/quality/thresholds.json;
// regenerate with \`pnpm build:data-pack\`.
//
// This is the COMPILED FLOOR (RM-38 D-DP3), not a copy anyone maintains. It exists because
// \`packages/shared\` may never read the filesystem and \`apps/web\` consumes several of these values,
// and because an unknown context window disables a guardrail while an unpriced model REFUSES a
// cost-capped run. \`apps/api\` merges the RUNTIME pack over this floor
// (\`apps/api/src/data-pack/model-overrides.ts\`); \`apps/web\` reads the floor alone.

export type PackModelPrice = { inPer1M: number; outPer1M: number; cachedInPer1M?: number };

/** Previous-generation ids the dataset does not cover. Merged FIRST (lowest precedence). */
export const LEGACY_MODEL_CONTEXT_LIMITS: Record<string, number> = {
${renderRecord(m.legacy_context_limits)}
};

/** Current-generation ids the live rosters offer but the dataset snapshot predates. Merged SECOND. */
export const ROSTER_GAP_MODEL_CONTEXT_LIMITS: Record<string, number> = {
${renderRecord(m.roster_gap_context_limits)}
};

/** The pricing twin of the legacy limits. The zero-price entries are spread in by \`pricing.ts\`. */
export const LEGACY_MODEL_PRICING: Record<string, PackModelPrice> = {
${renderRecord(m.legacy_pricing as unknown as Record<string, unknown>)}
};

/** The pricing twin of the roster-gap limits. Merged SECOND. */
export const ROSTER_GAP_MODEL_PRICING: Record<string, PackModelPrice> = {
${renderRecord(m.roster_gap_pricing as unknown as Record<string, unknown>)}
};

/** Local / on-device models priced at an explicit 0 AND treated as a KNOWN price. */
export const ZERO_PRICE_MODELS: readonly string[] = [
${renderStringArray(m.zero_price_models)}
];

/** Run-engine model id → dataset model id. */
export const MODEL_ID_ALIASES: Record<string, string> = {
${renderRecord(m.model_id_aliases)}
};

/** Default compatibility-heatmap column set. */
export const DEFAULT_HEATMAP_MODELS: readonly string[] = [
${renderStringArray(m.default_heatmap_models)}
];

/** The honest fallback for the Claude subscription's live model list. */
export const ASSISTANT_DEFAULT_MODEL_ROSTER = [
${renderStringArray(m.assistant_default_model_roster)}
] as const;

/** The cheap model the thread-title one-shot runs on. */
export const ASSISTANT_DEFAULT_TITLE_MODEL = ${JSON.stringify(m.assistant_default_title_model)};

/** Skill IDE quality engine — L1 (metadata) token ceiling. Env: SKILL_QUALITY_L1_TOKEN_CEILING. */
export const DEFAULT_SKILL_QUALITY_L1_TOKEN_CEILING = ${q.skill_quality_l1_token_ceiling};

/** Skill IDE quality engine — L2 (body) token ceiling. Env: SKILL_QUALITY_L2_TOKEN_CEILING. */
export const DEFAULT_SKILL_QUALITY_L2_TOKEN_CEILING = ${q.skill_quality_l2_token_ceiling};

/** The quality score's penalty per severity: clamp(100 - Σ weights, 0, 100). */
export const PACK_QUALITY_SEVERITY_WEIGHTS = {
  error: ${q.quality_severity_weights.error},
  warning: ${q.quality_severity_weights.warning},
  info: ${q.quality_severity_weights.info},
} as const;

/** The compare matcher's Jaccard floor when a caller passes none. */
export const DEFAULT_COMPARE_THRESHOLD = ${q.default_compare_threshold};

/** SkillFlow trace aligner — visit-count ceiling for generic loop detection. */
export const DEFAULT_LOOP_THRESHOLD = ${q.default_loop_threshold};

/** Suite failure buckets — a run scoring below this is a low-score candidate. */
export const FAILURE_BUCKET_SCORE_THRESHOLD = ${q.failure_bucket_score_threshold};

/** D-MCP5 — the token budget the workbench's own MCP mount holds its tools/list payload under. */
export const WORKBENCH_MCP_DEFINITION_TOKEN_BUDGET = ${q.workbench_mcp_definition_token_budget};
`;
}
