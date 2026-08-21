---
type: "Work Package Spec"
title: "WP 1.1 — the cache-aware contract: kpi/summary/aggregate fields, CostBreakdown, one pricing code path"
description: "Phase 1 of item.md. Ledger: STATUS.md. Contract-only: shared types + zod, plus computeCostBreakdown extracted from estimateCost."
tags: ["roadmap", "RM-33"]
timestamp: "2026-08-21T08:05:00Z"
status: "final"
---
# WP 1.1 — the cache-aware contract + `computeCostBreakdown`

Phase 1 of [`item.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md). Shared rules: the repo rules in
`.claude/rules/` — in particular `.claude/rules/architecture.md` (a wire shape
is declared in `packages/shared` first, as a type **and** a zod schema).

**Depends on:** nothing.
**Consumed by:** every other WP in this plan.

This is a **contract + one pure refactor** WP. It adds optional wire fields, one new shared type, two
pure helpers, and it collapses cost computation onto a single code path. **It changes no persisted
number, emits no new event, renders nothing.**

---

## Locked decisions this WP implements

- **D-CT1** — `tokensIn`/`tokensOut` keep their current meaning (gross, cache-inclusive). Every field
  added here is **additive and optional**; nothing is redefined or subtracted.
- **D-CT2** — cache read and cache write stay separate. The merged `cachedInputTokens` remains for
  legacy rows and is **tagged**, never guessed apart.
- **D-CT5** — one pricing code path: `estimateCost` becomes a thin caller of `computeCostBreakdown`.
- **D-CT4** — no new dependency.

---

## Scope

### 1. `packages/shared/src/types.ts` — additive optional fields

Add `cacheReadTokens?: number` and `cacheWriteTokens?: number` to:

| Shape | Line today |
| --- | --- |
| the `kpi` member of `RunEvent` | `:1568-1580` |
| `RunSummary` (inherited by `RunDetail`) | `:1646-1690` |
| `RunReport.kpis` | `:2543-2560` |
| `SuiteAggregates` | `:1113-1126` |

Also add `cachedTokens?: number` to `RunSummary` — the merged legacy figure, so the already-persisted
`runs.cached_tokens` column (`apps/api/src/db/schema.ts:262`) finally has somewhere to go. Every one
of these is **optional**: a run persisted before WP 1.2 has none of them, and every existing consumer
compiles untouched.

Mirror each in `packages/shared/src/schemas.ts` (`:2705-2715` kpi, `:556-564` report kpis,
`:2762-2772` suite aggregates), as `.optional()` members. The kpi schema is `.passthrough()`, so an
older API streaming to a newer web build stays valid — do not tighten it.

### 2. `packages/shared/src/types.ts` — the new `CostBreakdown` shape

```ts
export type CostBreakdownSplit = "exact" | "merged" | "none";

export type CostBreakdown = {
  uncachedUsd: number;
  cacheReadUsd: number;
  cacheWriteUsd: number;
  outputUsd: number;
  totalUsd: number;
  /** What the SAME tokens would cost with every input token at the full rate, minus `totalUsd`.
   *  NEGATIVE when cache writes dominate — a cache write costs 1.25x, it is a premium, not a saving. */
  savedVsUncachedUsd: number;
  /** `false` when the model has no pricing entry at all (`totalUsd` is 0 because we cannot price it,
   *  not because it is free) — mirrors the existing `isModelPriced` signal. */
  priced: boolean;
  /** `exact` = the provider gave a read/write split · `merged` = only `cachedInputTokens` survived,
   *  so the whole cached slice is priced as READ and a surface must say the split is unavailable ·
   *  `none` = no cache slice at all. */
  split: CostBreakdownSplit;
};
```

Add a `.strict()` zod schema for it in `schemas.ts`. Export both from `packages/shared/src/index.ts`.

### 3. `packages/shared` — two pure helpers

Put them beside `TokenUsageActual` (a new `packages/shared/src/token-usage.ts` is fine; export from
`index.ts`). Neither imports anything but `zod`-free plain TS.

```ts
/** Cache-read share of the provider-billed input, or `null` when it cannot be known. */
export function cacheHitRate(usage: TokenUsageActual): number | null;

/** Which split fidelity a usage record carries — the same discriminator `CostBreakdown.split` uses. */
export function usageSplitKind(usage: TokenUsageActual): CostBreakdownSplit;
```

`cacheHitRate` returns `null` when `inputTokens === 0`, or when `usageSplitKind` is `"merged"`
(a merged number cannot answer "how much was a *read*"). It never returns `0` to mean "unknown"
(D-CT6).

### 4. `apps/api/src/providers/pricing.ts` — extract, do not duplicate

Move the body of `estimateCost` (`:210-234`) into:

```ts
export function computeCostBreakdown(
  model: string,
  usage: TokenUsageActual,
  opts?: PricingResolveOptions,
): CostBreakdown;
```

keeping the existing arithmetic **byte-identical in behaviour**: `hasSplit` detection (`:218`), the
merged-as-read fallback (`:219`), `uncached = max(0, inputTokens - cacheRead - cacheWrite)` (`:221`),
`readRate = cachedInPer1M ?? inPer1M` (`:223`), `writeRate = cacheWritePer1M ?? inPer1M *
CACHE_WRITE_MULTIPLIER` (`:226`). Then:

```ts
export function estimateCost(model, usage, opts): number {
  return computeCostBreakdown(model, usage, opts).totalUsd;
}
```

`savedVsUncachedUsd` = `((inputTokens / 1e6) * inPer1M + outputUsd) - totalUsd`. `priced` reuses the
existing `isModelPriced` logic (`:206-208`) rather than re-deriving it; when `priced === false` every
USD field is `0`.

**Do not touch** the rate tables, `resolvePrice`, the DB resolver, or `CACHE_WRITE_MULTIPLIER`.

---

## Out of scope

Persistence, the migration, the `kpi` emit, the estimate endpoint, metrics measures, any UI, any
report. Those are WPs 1.2 → 4.1. **Do not** add a `cachedTokens` field to `HubUsage` (it deliberately
carries only the split — `types.ts:4944-4945`).

---

## Acceptance

1. `packages/shared` exports `CostBreakdown`, `CostBreakdownSplit`, its zod schema, `cacheHitRate`
   and `usageSplitKind`; `apps/api/src/providers/pricing.ts` exports `computeCostBreakdown`.
2. **The identity test.** A table of usage shapes — exact split · merged-only · no cache · zero input
   · unpriced model · cache-write-heavy — each asserts
   `computeCostBreakdown(m, u, o).totalUsd === estimateCost(m, u, o)`. This is the tooth that stops
   the two paths drifting; **break it deliberately once and watch it go red** before ticking.
3. **`savedVsUncachedUsd` can go negative.** A test with `cacheWriteTokens` dominating and no reads
   asserts a negative value. A test that only ever proves it positive does not satisfy this.
4. `cacheHitRate` returns `null` (never `0`) for zero input and for a merged-only record; returns the
   read share for an exact record.
5. `usageSplitKind` returns `"exact"` / `"merged"` / `"none"` for the three record shapes.
6. Every added wire field is optional and every pre-existing shared test still passes **unmodified** —
   proof that D-CT1 held.
7. No new dependency in any `package.json`. No migration. No file under `apps/web` touched.
8. Gate green: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`.
