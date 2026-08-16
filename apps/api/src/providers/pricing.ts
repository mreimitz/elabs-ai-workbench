import { GENERATED_MODEL_PRICING, type TokenUsageActual } from "@mcp-token-footprint/shared";

/**
 * WP 1.5 / Phase 5 — best-effort model pricing for the **spend-cap guardrail** and the run cost KPI.
 *
 * Current-generation prices are DERIVED from the research dataset (`GENERATED_MODEL_PRICING`,
 * regenerate with `pnpm build:model-data`) — the single source of truth (Decision 1). The legacy
 * map below is the **fallback** for previous-generation ids the dataset does not cover (e.g.
 * `gpt-4o`, `claude-opus-4-1`) and for local/Ollama models (priced at 0 so they never trip the spend
 * cap). Dataset prices win on overlap; the legacy entries are retained so swapping to the dataset
 * never silently zeroes out a currently-priced model and disables the spend cap.
 *
 * Cost is an **estimate** — surfaced as "estimated" in the UI. A model with a KNOWN price (incl. a
 * local/free model in {@link ZERO_PRICE_MODELS}, priced at an explicit `0`) contributes its metered
 * cost. A **genuinely unknown** model (no pricing entry at all) contributes `0` here but is reported
 * as price-**unknown** by {@link isModelPriced} so the spend-cap guardrail can refuse to run rather
 * than silently allow unbounded spend (issue #10).
 */
/**
 * EXPLICIT zero-price allowlist — local / Ollama models that run on the user's own hardware and have
 * no per-token list price. They are priced at an explicit `0` (so the spend cap never trips for them)
 * and, crucially, are treated as a KNOWN price by {@link isModelPriced} — distinguishing "genuinely
 * free/local" from "we have no price for this model at all". Add local models the app should treat as
 * free here; a model that is NOT here and NOT in the priced table is reported as price-unknown.
 */
export const ZERO_PRICE_MODELS: readonly string[] = ["llama3.1", "llama3.3", "qwen2.5", "mistral"];

function zeroPriceEntries(): Record<string, { inPer1M: number; outPer1M: number }> {
  return Object.fromEntries(ZERO_PRICE_MODELS.map((id) => [id, { inPer1M: 0, outPer1M: 0 }]));
}

const LEGACY_MODEL_PRICING: Record<
  string,
  { inPer1M: number; outPer1M: number; cachedInPer1M?: number }
> = {
  // Anthropic (cache-read = 0.1× input).
  "claude-opus-4-1": { inPer1M: 15, outPer1M: 75, cachedInPer1M: 1.5 },
  "claude-opus-4": { inPer1M: 15, outPer1M: 75, cachedInPer1M: 1.5 },
  "claude-sonnet-4-5": { inPer1M: 3, outPer1M: 15, cachedInPer1M: 0.3 },
  "claude-sonnet-4": { inPer1M: 3, outPer1M: 15, cachedInPer1M: 0.3 },
  "claude-3-7-sonnet": { inPer1M: 3, outPer1M: 15, cachedInPer1M: 0.3 },
  "claude-3-5-sonnet": { inPer1M: 3, outPer1M: 15, cachedInPer1M: 0.3 },
  "claude-3-5-haiku": { inPer1M: 0.8, outPer1M: 4, cachedInPer1M: 0.08 },

  // OpenAI (cache-read = 0.5× input for GPT-4o / 4.1; o-series cached input where published).
  "gpt-4o": { inPer1M: 2.5, outPer1M: 10, cachedInPer1M: 1.25 },
  "gpt-4o-mini": { inPer1M: 0.15, outPer1M: 0.6, cachedInPer1M: 0.075 },
  "gpt-4.1": { inPer1M: 2, outPer1M: 8, cachedInPer1M: 0.5 },
  "gpt-4.1-mini": { inPer1M: 0.4, outPer1M: 1.6, cachedInPer1M: 0.1 },
  "gpt-4.1-nano": { inPer1M: 0.1, outPer1M: 0.4, cachedInPer1M: 0.025 },
  o3: { inPer1M: 2, outPer1M: 8, cachedInPer1M: 0.5 },
  "o3-mini": { inPer1M: 1.1, outPer1M: 4.4, cachedInPer1M: 0.55 },
  "o4-mini": { inPer1M: 1.1, outPer1M: 4.4, cachedInPer1M: 0.275 },

  // Google (cache-read = 0.25× input where published).
  "gemini-2.5-pro": { inPer1M: 1.25, outPer1M: 10, cachedInPer1M: 0.31 },
  "gemini-2.5-flash": { inPer1M: 0.3, outPer1M: 2.5, cachedInPer1M: 0.075 },
  "gemini-2.5-flash-lite": { inPer1M: 0.1, outPer1M: 0.4, cachedInPer1M: 0.025 },
  "gemini-2.0-flash": { inPer1M: 0.1, outPer1M: 0.4, cachedInPer1M: 0.025 },

  // Local / Ollama zero-price models (spread in) fill the rest of this map.
  ...zeroPriceEntries(),
};

// Current-generation ids the LIVE Anthropic / Claude-subscription rosters offer but the research
// dataset SNAPSHOT (as-of 2026-06-21) predates (D-MI11, `roadmap/model-identity/`). The pricing twin
// of `ROSTER_GAP_MODEL_CONTEXT_LIMITS` in `packages/shared/src/constants.ts` — see that block for why
// a gap here is not cosmetic: an unpriced model makes `isModelPriced()` false, which means a
// cost-capped run is REFUSED rather than silently unbounded (issue #10), and `estimateCost()` returns
// `0`, so a mission's `shouldAutoApprove` compares planned spend against $0.
//
// Merged BEFORE `GENERATED_MODEL_PRICING`, so a dataset refresh wins and the entry here becomes dead
// weight to delete. Values are Anthropic **list** prices per 1M tokens; cache-read is Anthropic's
// published 0.1x of input. `claude-sonnet-5` is listed at its standard $3/$15 rather than the
// promotional $2/$10 running through 2026-08-31 — this table is the durable list-price seed, and
// time-varying prices belong in the DB-backed resolver below, which carries effective dates.
export const ROSTER_GAP_MODEL_PRICING: Record<
  string,
  { inPer1M: number; outPer1M: number; cachedInPer1M?: number }
> = {
  "claude-fable-5": { inPer1M: 10, outPer1M: 50, cachedInPer1M: 1 },
  "claude-opus-5": { inPer1M: 5, outPer1M: 25, cachedInPer1M: 0.5 },
  "claude-opus-4-7": { inPer1M: 5, outPer1M: 25, cachedInPer1M: 0.5 },
  "claude-opus-4-6": { inPer1M: 5, outPer1M: 25, cachedInPer1M: 0.5 },
  "claude-sonnet-5": { inPer1M: 3, outPer1M: 15, cachedInPer1M: 0.3 },
  // Dated snapshot ids (same models as their aliases; the rosters return these exact strings, and
  // every lookup is an exact-key map read — there is no alias normalization).
  "claude-haiku-4-5-20251001": { inPer1M: 1, outPer1M: 5, cachedInPer1M: 0.1 },
  "claude-sonnet-4-5-20250929": { inPer1M: 3, outPer1M: 15, cachedInPer1M: 0.3 },
  "claude-opus-4-1-20250805": { inPer1M: 15, outPer1M: 75, cachedInPer1M: 1.5 },
};

// Dataset-derived current-gen prices win on overlap; legacy entries fill previous-generation gaps and
// the roster-gap seed fills current-generation ids the dataset snapshot predates (no regression).
export const MODEL_PRICING: Record<
  string,
  { inPer1M: number; outPer1M: number; cachedInPer1M?: number }
> = {
  ...LEGACY_MODEL_PRICING,
  ...ROSTER_GAP_MODEL_PRICING,
  ...GENERATED_MODEL_PRICING,
};

// --- Pricing resolver seam (Observability WP2.6, D-OB22) ----------------------------------------
//
// The code table above is the SEED + the belt-and-braces FALLBACK. At runtime the app installs a
// DB-backed resolver (a `PricingRepository`) here so an owner can EDIT prices in Settings without a
// code edit — the whole point of WP2.6. Because `estimateCost`/`isModelPriced` route through
// {@link resolvePrice}, every cost-computation call site (the accounting sink, the guardrail spend
// cap in the engine, the launch/estimate preview, the judge ledgers) picks up an edited price for
// NEW computations WITHOUT any signature change to those (frozen) executor loops.
//
// MONEY INVARIANT: nothing here ever recomputes an already-recorded run — a run stores its `costUsd`
// at run time; a later price edit only changes FUTURE computations. When NO resolver is installed
// (every unit test that doesn't opt in), `resolvePrice` is byte-identical to the old direct
// `MODEL_PRICING[model]` lookup, so existing behavior and tests are unchanged.

/**
 * A resolved per-1M-token price. Superset of a {@link MODEL_PRICING} entry: `cacheWritePer1M` is the
 * OPTIONAL explicit cache-write rate a user row may carry; when absent the write rate DERIVES from
 * `inPer1M` (× {@link CACHE_WRITE_MULTIPLIER}) exactly as before — so a code-table entry (which never
 * carries it) prices identically.
 */
export type ResolvedPrice = {
  inPer1M: number;
  outPer1M: number;
  cachedInPer1M?: number;
  cacheWritePer1M?: number;
};

/** Options threaded to a pricing lookup. `at` (ISO-8601) defaults to now — effective dating keys off
 *  it; `provider` is an informational hint (resolution keys on the model id, not the provider). */
export type PricingResolveOptions = { provider?: string; at?: string };

/** The DB-backed resolver installed at app startup ({@link PricingRepository} implements this). */
export type PricingResolver = {
  resolve(model: string, opts?: PricingResolveOptions): ResolvedPrice | undefined;
};

let activeResolver: PricingResolver | null = null;

/** Install the DB-backed pricing resolver (called once at app startup, `index.ts`). */
export function installPricingResolver(resolver: PricingResolver): void {
  activeResolver = resolver;
}

/** Remove any installed resolver (tests: restore the pure code-table default). */
export function resetPricingResolver(): void {
  activeResolver = null;
}

/**
 * Resolve a model's price. With a resolver installed: the DB match wins; on a DB MISS we fall back
 * to the code table (belt-and-braces) and LOG that fallback (only when the code table actually has a
 * price — a genuinely unpriced model is not a "fallback", just unpriced, and must stay quiet). With
 * NO resolver installed: the pure code-table lookup (identical to the pre-WP2.6 behavior).
 */
export function resolvePrice(model: string, opts?: PricingResolveOptions): ResolvedPrice | undefined {
  const resolver = activeResolver;
  if (!resolver) return MODEL_PRICING[model];
  const hit = resolver.resolve(model, opts);
  if (hit) return hit;
  const codeHit = MODEL_PRICING[model];
  if (codeHit) {
    console.warn(
      `[pricing] no DB pricing match for "${model}"; falling back to the code pricing table`,
    );
    return codeHit;
  }
  return undefined;
}

/**
 * Anthropic prompt-cache **write** (cache_creation) costs 1.25× the base input rate for the
 * default 5-minute TTL (2× for 1-hour). The research dataset only tracks the cache-*read* price
 * (`cachedInPer1M` ≈ 0.1× input), so the write rate is derived from `inPer1M`. If the app ever
 * switches to 1-hour caching, change this to 2 (or thread the TTL through).
 */
const CACHE_WRITE_MULTIPLIER = 1.25;

/**
 * Estimate the USD cost of one usage record for a model, mirroring how providers bill prompt
 * caching (four terms, all `tokens / 1e6 × rate`):
 *
 *   uncached input × inPer1M  +  cache-read × cachedInPer1M  +  cache-write × (1.25 × inPer1M)
 *   +  output × outPer1M
 *
 * `inputTokens` is the provider TOTAL input and **already includes** the cached slice (the AI SDK
 * normalizes Anthropic/OpenAI/Gemini this way — `inputTokens = noCache + cacheRead + cacheWrite`).
 * So the cached tokens are SUBTRACTED before charging the full-rate term, then charged once at
 * their own rate — otherwise each cached token would be billed twice (full rate + cache rate).
 * `cacheReadTokens` / `cacheWriteTokens` carry the split; when only the merged `cachedInputTokens`
 * is present (legacy/persisted usage) it's treated as all cache-read (the dominant slice). With no
 * cache activity this reduces to `input × inPer1M + output × outPer1M`. When the model publishes no
 * cache-read price, reads bill at the full input rate (never free). An **unknown** model → `0`
 * (best-effort; the spend cap just won't fire for a model we have no price for; never crashes).
 */
/**
 * Whether we have a KNOWN price for a model — either a real per-token rate or an explicit zero-price
 * local/free entry ({@link ZERO_PRICE_MODELS}). Returns `false` ONLY for a model with no pricing entry
 * at all, i.e. one whose {@link estimateCost} is `0` merely because we can't price it (not because it
 * is free). The run/guardrail path uses this to refuse a cost-capped run on an unpriced model rather
 * than let it spend unbounded (issue #10). Distinct from the cost being `0`, which a real free model
 * also has.
 */
export function isModelPriced(model: string, opts?: PricingResolveOptions): boolean {
  return resolvePrice(model, opts) !== undefined;
}

export function estimateCost(
  model: string,
  usage: TokenUsageActual,
  opts?: PricingResolveOptions,
): number {
  const pricing = resolvePrice(model, opts);
  if (!pricing) return 0;

  const hasSplit = usage.cacheReadTokens !== undefined || usage.cacheWriteTokens !== undefined;
  const cacheRead = hasSplit ? (usage.cacheReadTokens ?? 0) : (usage.cachedInputTokens ?? 0);
  const cacheWrite = hasSplit ? (usage.cacheWriteTokens ?? 0) : 0;
  const uncached = Math.max(0, usage.inputTokens - cacheRead - cacheWrite);

  const readRate = pricing.cachedInPer1M ?? pricing.inPer1M;
  // A user row may pin an explicit cache-write rate; otherwise DERIVE it exactly as before (so a
  // code-table / seed entry — which never carries one — prices byte-identically).
  const writeRate = pricing.cacheWritePer1M ?? pricing.inPer1M * CACHE_WRITE_MULTIPLIER;

  return (
    (uncached / 1e6) * pricing.inPer1M +
    (cacheRead / 1e6) * readRate +
    (cacheWrite / 1e6) * writeRate +
    (usage.outputTokens / 1e6) * pricing.outPer1M
  );
}

// --- Seed rows for the DB pricing table (Observability WP2.6) ------------------------------------
//
// The v44 migration seeds `model_pricing` from the {@link MODEL_PRICING} code table so a freshly
// migrated DB reproduces the code prices EXACTLY (seed-parity, TEST-ENFORCED). Seed rows are EXACT
// matches (never regex), stamped read-only (`source: 'seed'`) with a far-past `effective_from` so any
// user row with a real date is "newer" and wins. `cache_write_per_mtok` is NULL for every seed (the
// code table derives it), preserving the exact write-rate math on resolve.

/** A far-past instant so every seed entry is effective for any run, and any user edit is newer. */
export const SEED_PRICING_EFFECTIVE_FROM = "1970-01-01T00:00:00.000Z";

/** Deterministic id for a seed row (also lets the migration `INSERT OR IGNORE` re-run safely). */
export function seedPricingId(model: string): string {
  return `seed:${model}`;
}

/**
 * Best-effort provider label for a model id — INFORMATIONAL only (resolution keys on the model id,
 * never this). Defaults to `"other"` for an id we don't recognize; a wrong label is cosmetic.
 */
export function deriveProvider(model: string): string {
  const id = model.toLowerCase();
  if (id.startsWith("claude")) return "anthropic";
  if (id.startsWith("gpt") || /^o\d/.test(id) || id.startsWith("openai")) return "openai";
  if (id.startsWith("gemini") || id.startsWith("google/") || id.startsWith("gemma")) return "google";
  if (id.startsWith("grok")) return "xai";
  if (id.includes("mistral")) return "mistral";
  if (id.includes("llama")) return "meta";
  if (id.includes("qwen")) return "qwen";
  if (id.includes("deepseek")) return "deepseek";
  if (id.includes("phi") || id.includes("microsoft") || id.includes("copilot")) return "microsoft";
  return "other";
}

/** A `model_pricing` seed row (column-shaped, ready for the migration INSERT). */
export type SeedPricingRow = {
  id: string;
  provider: string;
  model_match: string;
  is_regex: 0;
  input_per_mtok: number;
  output_per_mtok: number;
  cache_read_per_mtok: number | null;
  cache_write_per_mtok: null;
  effective_from: string;
  created_at: string;
  source: "seed";
};

/** Build the `model_pricing` seed rows from the {@link MODEL_PRICING} code table (parity source). */
export function buildSeedPricingRows(): SeedPricingRow[] {
  return Object.entries(MODEL_PRICING).map(([model, price]) => ({
    id: seedPricingId(model),
    provider: deriveProvider(model),
    model_match: model,
    is_regex: 0,
    input_per_mtok: price.inPer1M,
    output_per_mtok: price.outPer1M,
    cache_read_per_mtok: price.cachedInPer1M ?? null,
    cache_write_per_mtok: null,
    effective_from: SEED_PRICING_EFFECTIVE_FROM,
    created_at: SEED_PRICING_EFFECTIVE_FROM,
    source: "seed",
  }));
}

// --- Per-request (per-question) pricing --------------------------------------------------------

/**
 * A flat USD price charged **per request** rather than per token. This is a deliberately DISTINCT
 * shape from the per-1M-token {@link MODEL_PRICING} entries above: some providers meter by call, not
 * by token. The Qlik Answers executor (roadmap/qlik-answers/, D-QA5) is the first consumer — the Qlik
 * Answers API reports **no token usage** and is capacity-licensed by a monthly **question** quota
 * (1 question per `invoke`/`stream`), so its first-class cost unit is questions-consumed and any USD
 * figure is `questions × perRequestUsd`.
 */
export type PerRequestPricing = { perRequestUsd: number };

/**
 * Owner-configurable per-request price table, keyed by model id (for Qlik Answers, the tenant
 * assistant id). **Empty by default** — an unpriced model means `costUsd` is `0`, which (unlike the
 * per-token spend-cap gate in {@link estimateCost}/{@link isModelPriced}) is NEVER a run-blocker for
 * this kind: a Qlik Answers run always executes and simply reports `costUsd 0` until an owner sets a
 * €/question price here. Add entries (e.g. a tenant's blended question price) to surface USD cost.
 */
export const PER_REQUEST_PRICING: Record<string, PerRequestPricing> = {
  // e.g. "<assistant-id>": { perRequestUsd: 0.02 }
};

/** The per-request USD price for a model, or `undefined` when none is configured (→ cost 0). */
export function perRequestPrice(model: string): number | undefined {
  return PER_REQUEST_PRICING[model]?.perRequestUsd;
}

/**
 * USD cost of `requests` requests/questions for a per-request-priced model. Returns `0` when the model
 * has no configured per-request price (never a run-blocker — see {@link PER_REQUEST_PRICING}). A
 * negative `requests` is floored at 0.
 */
export function estimateRequestCost(model: string, requests: number): number {
  const price = PER_REQUEST_PRICING[model]?.perRequestUsd;
  if (price === undefined) return 0;
  return price * Math.max(0, requests);
}
