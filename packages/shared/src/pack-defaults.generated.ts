// GENERATED — do not edit by hand.
// Source of truth: data-pack/models/overrides.json + data-pack/quality/thresholds.json;
// regenerate with `pnpm build:data-pack`.
//
// This is the COMPILED FLOOR (RM-38 D-DP3), not a copy anyone maintains. It exists because
// `packages/shared` may never read the filesystem and `apps/web` consumes several of these values,
// and because an unknown context window disables a guardrail while an unpriced model REFUSES a
// cost-capped run. `apps/api` merges the RUNTIME pack over this floor
// (`apps/api/src/data-pack/model-overrides.ts`); `apps/web` reads the floor alone.

export type PackModelPrice = { inPer1M: number; outPer1M: number; cachedInPer1M?: number };

/** Previous-generation ids the dataset does not cover. Merged FIRST (lowest precedence). */
export const LEGACY_MODEL_CONTEXT_LIMITS: Record<string, number> = {
  "claude-3-5-haiku": 200000,
  "claude-3-5-sonnet": 200000,
  "claude-3-7-sonnet": 200000,
  "claude-opus-4": 200000,
  "claude-opus-4-1": 200000,
  "claude-sonnet-4": 200000,
  "claude-sonnet-4-5": 200000,
  "gemini-2.0-flash": 1048576,
  "gemini-2.5-flash": 1048576,
  "gemini-2.5-flash-lite": 1048576,
  "gemini-2.5-pro": 1048576,
  "gpt-4.1": 1047576,
  "gpt-4.1-mini": 1047576,
  "gpt-4.1-nano": 1047576,
  "gpt-4o": 128000,
  "gpt-4o-mini": 128000,
  "llama3.1": 131072,
  "llama3.3": 131072,
  "mistral": 32768,
  "o3": 200000,
  "o3-mini": 200000,
  "o4-mini": 200000,
  "qwen2.5": 32768
};

/** Current-generation ids the live rosters offer but the dataset snapshot predates. Merged SECOND. */
export const ROSTER_GAP_MODEL_CONTEXT_LIMITS: Record<string, number> = {
  "claude-fable-5": 1000000,
  "claude-haiku-4-5-20251001": 200000,
  "claude-opus-4-1-20250805": 200000,
  "claude-opus-4-6": 1000000,
  "claude-opus-4-7": 1000000,
  "claude-opus-5": 1000000,
  "claude-sonnet-4-5-20250929": 200000,
  "claude-sonnet-5": 1000000
};

/** The pricing twin of the legacy limits. The zero-price entries are spread in by `pricing.ts`. */
export const LEGACY_MODEL_PRICING: Record<string, PackModelPrice> = {
  "claude-3-5-haiku": {"inPer1M":0.8,"outPer1M":4,"cachedInPer1M":0.08},
  "claude-3-5-sonnet": {"inPer1M":3,"outPer1M":15,"cachedInPer1M":0.3},
  "claude-3-7-sonnet": {"inPer1M":3,"outPer1M":15,"cachedInPer1M":0.3},
  "claude-opus-4": {"inPer1M":15,"outPer1M":75,"cachedInPer1M":1.5},
  "claude-opus-4-1": {"inPer1M":15,"outPer1M":75,"cachedInPer1M":1.5},
  "claude-sonnet-4": {"inPer1M":3,"outPer1M":15,"cachedInPer1M":0.3},
  "claude-sonnet-4-5": {"inPer1M":3,"outPer1M":15,"cachedInPer1M":0.3},
  "gemini-2.0-flash": {"inPer1M":0.1,"outPer1M":0.4,"cachedInPer1M":0.025},
  "gemini-2.5-flash": {"inPer1M":0.3,"outPer1M":2.5,"cachedInPer1M":0.075},
  "gemini-2.5-flash-lite": {"inPer1M":0.1,"outPer1M":0.4,"cachedInPer1M":0.025},
  "gemini-2.5-pro": {"inPer1M":1.25,"outPer1M":10,"cachedInPer1M":0.31},
  "gpt-4.1": {"inPer1M":2,"outPer1M":8,"cachedInPer1M":0.5},
  "gpt-4.1-mini": {"inPer1M":0.4,"outPer1M":1.6,"cachedInPer1M":0.1},
  "gpt-4.1-nano": {"inPer1M":0.1,"outPer1M":0.4,"cachedInPer1M":0.025},
  "gpt-4o": {"inPer1M":2.5,"outPer1M":10,"cachedInPer1M":1.25},
  "gpt-4o-mini": {"inPer1M":0.15,"outPer1M":0.6,"cachedInPer1M":0.075},
  "o3": {"inPer1M":2,"outPer1M":8,"cachedInPer1M":0.5},
  "o3-mini": {"inPer1M":1.1,"outPer1M":4.4,"cachedInPer1M":0.55},
  "o4-mini": {"inPer1M":1.1,"outPer1M":4.4,"cachedInPer1M":0.275}
};

/** The pricing twin of the roster-gap limits. Merged SECOND. */
export const ROSTER_GAP_MODEL_PRICING: Record<string, PackModelPrice> = {
  "claude-fable-5": {"inPer1M":10,"outPer1M":50,"cachedInPer1M":1},
  "claude-haiku-4-5-20251001": {"inPer1M":1,"outPer1M":5,"cachedInPer1M":0.1},
  "claude-opus-4-1-20250805": {"inPer1M":15,"outPer1M":75,"cachedInPer1M":1.5},
  "claude-opus-4-6": {"inPer1M":5,"outPer1M":25,"cachedInPer1M":0.5},
  "claude-opus-4-7": {"inPer1M":5,"outPer1M":25,"cachedInPer1M":0.5},
  "claude-opus-5": {"inPer1M":5,"outPer1M":25,"cachedInPer1M":0.5},
  "claude-sonnet-4-5-20250929": {"inPer1M":3,"outPer1M":15,"cachedInPer1M":0.3},
  "claude-sonnet-5": {"inPer1M":3,"outPer1M":15,"cachedInPer1M":0.3}
};

/** Local / on-device models priced at an explicit 0 AND treated as a KNOWN price. */
export const ZERO_PRICE_MODELS: readonly string[] = [
  "llama3.1",
  "llama3.3",
  "qwen2.5",
  "mistral"
];

/** Run-engine model id → dataset model id. */
export const MODEL_ID_ALIASES: Record<string, string> = {
  "claude-haiku-4-5-20251001": "claude-haiku-4-5"
};

/** Default compatibility-heatmap column set. */
export const DEFAULT_HEATMAP_MODELS: readonly string[] = [
  "claude-opus-4-8",
  "gpt-5.5",
  "gemini-3.5-flash",
  "claude-haiku-4-5",
  "microsoft/phi-4"
];

/** The honest fallback for the Claude subscription's live model list. */
export const ASSISTANT_DEFAULT_MODEL_ROSTER = [
  "claude-opus-4-8",
  "claude-sonnet-5",
  "claude-haiku-4-5",
  "claude-fable-5"
] as const;

/** The cheap model the thread-title one-shot runs on. */
export const ASSISTANT_DEFAULT_TITLE_MODEL = "claude-haiku-4-5";

/** Skill IDE quality engine — L1 (metadata) token ceiling. Env: SKILL_QUALITY_L1_TOKEN_CEILING. */
export const DEFAULT_SKILL_QUALITY_L1_TOKEN_CEILING = 500;

/** Skill IDE quality engine — L2 (body) token ceiling. Env: SKILL_QUALITY_L2_TOKEN_CEILING. */
export const DEFAULT_SKILL_QUALITY_L2_TOKEN_CEILING = 5000;

/** The quality score's penalty per severity: clamp(100 - Σ weights, 0, 100). */
export const PACK_QUALITY_SEVERITY_WEIGHTS = {
  error: 15,
  warning: 5,
  info: 1,
} as const;

/** The compare matcher's Jaccard floor when a caller passes none. */
export const DEFAULT_COMPARE_THRESHOLD = 0.6;

/** SkillFlow trace aligner — visit-count ceiling for generic loop detection. */
export const DEFAULT_LOOP_THRESHOLD = 3;

/** Suite failure buckets — a run scoring below this is a low-score candidate. */
export const FAILURE_BUCKET_SCORE_THRESHOLD = 0.5;

/** D-MCP5 — the token budget the workbench's own MCP mount holds its tools/list payload under. */
export const WORKBENCH_MCP_DEFINITION_TOKEN_BUDGET = 3500;
