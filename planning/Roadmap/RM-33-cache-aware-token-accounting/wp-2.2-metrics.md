---
type: "Work Package Spec"
title: "WP 2.2 — cacheReadTokens / cacheWriteTokens / cacheHitRate observability measures"
description: "Phase 2 of item.md. Ledger: STATUS.md. Makes the cache split chartable over time, excluding pre-migration runs rather than zero-filling them."
tags: ["roadmap", "RM-33"]
timestamp: "2026-08-21T08:08:00Z"
status: "final"
---
# WP 2.2 — cache measures for metrics-over-time

Phase 2 of [`item.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md).

**Depends on:** WP 1.2 (the `runs` columns).
**Consumed by:** WP 3.1 (the dashboard Tokens panel + the custom chart composer, which inherits the
measure list automatically via `use-custom-chart-data.ts:59`).

Today cached tokens **cannot be charted at all** — `RUN_METRICS_MEASURES`
(`packages/shared/src/constants.ts:423-434`) has no cache member.

## Scope

- `constants.ts:423` — `RUN_METRICS_MEASURES` gains `cacheReadTokens`, `cacheWriteTokens`,
  `cacheHitRate`. Add units for each in the units map (`:479-490`) — tokens, tokens, and a ratio.
- `constants.ts:441` — add `cacheReadTokens` and `cacheWriteTokens` to `CAPABILITY_SPLIT_MEASURES`.
  They are token measures in the `tokens` capability class, so D-OB14's no-blending rule applies to
  them exactly as it does to `tokensIn`/`tokensOut`. **`cacheHitRate` is a ratio and is NOT added** —
  it follows the `errorRate` precedent.
- `apps/api/src/observability/metrics.ts`
  - select `cache_read_tokens`, `cache_write_tokens` in the row shape (`:262-278`) and the SELECT
    (`:331-338`).
  - accumulate at `:482-490`, keyed by the same `cap.tokens` capability class as the existing token
    sums.
  - **D-CT6, the load-bearing rule: a run whose cache columns are NULL is EXCLUDED from the bucket,
    never counted as 0.** If a requested measure has no usable row across the whole window, report it
    in `unavailableMeasures` and emit no series — exactly the path `feedbackRate` takes today. An
    empty bucket stays omitted (`:571-576`), never zero-filled.
  - `cacheHitRate` = `Σ cache_read_tokens / Σ tokens_in` over the bucket's **usable** rows only.

## Out of scope

New `RunFilter` predicates. Add a `cacheRead*` filter **only** if it falls out of the existing
`buildRunFilterWhere` mirror for free; otherwise leave it — and note in the ledger that the
`buildRunFilterWhere` duplication between `metrics.ts` and the runs repository is a known,
cross-check-tested replication (see the module header at `metrics.ts:17-20`) that this WP must
**mirror, not unify**.

## Acceptance

1. `GET /api/metrics/runs?measures=cacheReadTokens,cacheWriteTokens,cacheHitRate` returns one series
   per capability class for the two token measures and a single series for the ratio.
2. **The no-fake-zero tooth.** A window containing only pre-migration (NULL-cache) runs reports all
   three measures in `unavailableMeasures` and emits **no** series. A mixed window emits series
   computed from the usable rows only, and its `cacheHitRate` denominator excludes the NULL rows.
   Break this deliberately (zero-fill instead of exclude) and watch it go red.
3. Capability classes are never blended for the two token measures — the existing D-OB14 test pattern
   extended, not rewritten.
4. Repeated identical calls are byte-identical (the module's determinism contract).
5. The `metrics.ts` ↔ runs-repository filter cross-check test still passes unmodified.
6. Gate green: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`.
