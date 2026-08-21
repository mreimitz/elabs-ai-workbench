---
type: "Work Package Spec"
title: "WP 2.1 — cache-aware run-plan cost preview"
description: "Phase 2 of item.md. Ledger: STATUS.md. Stops the estimate endpoint re-pricing the whole prefix at full rate every turn; returns a range bracketing cached and uncached."
tags: ["roadmap", "RM-33"]
timestamp: "2026-08-21T08:07:00Z"
status: "final"
---
# WP 2.1 — cache-aware run-plan cost preview

Phase 2 of [`item.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md).

**Depends on:** WP 1.1 (`computeCostBreakdown`).
**Consumed by:** the launcher cost preview and the workbench MCP launch tools' advisory estimate
(`apps/api/src/mcp-server/tools.ts:176-194`), both of which call this service and need no change.

## The defect

`apps/api/src/estimate/estimate.ts:60-78`:

```ts
const perTurnPrefix = env.footprintTokens + env.systemPromptTokens;
const input = turns * perTurnPrefix + test.promptTokens;
return (input / 1e6) * env.pricing.inPer1M + (output / 1e6) * env.pricing.outPer1M;
```

Every input token is charged at the full rate, and the prefix is re-charged in full on every turn.
`apps/api/src/estimate/service.ts:77-87` resolves a complete `ResolvedPrice` and then **deliberately
narrows it**, discarding `cachedInPer1M` and `cacheWritePer1M`. For a run like the observed one the
preview lands near **$2.87** against a real **$0.80** — roughly 3.6×.

The app **switches Anthropic caching on itself** (`apps/api/src/providers/registry.ts:114-132`), so
this is not a hypothetical the estimator is entitled to ignore.

## Scope

- `estimate.ts:23` — `EnvPricing` gains `cachedInPer1M?: number` and `cacheWritePer1M?: number`.
- `service.ts:77-87` — stop narrowing; pass the resolved rates through.
- Model the prefix honestly in `runCost`:
  - **turn 1** writes the prefix → `cacheWriteTokens = perTurnPrefix`
  - **turns 2..N** read it → `cacheReadTokens = perTurnPrefix` each
  - the per-turn delta (the prompt, the growing history, tool results) stays **uncached**
  - build a `TokenUsageActual` from that and call **`computeCostBreakdown`** (D-CT5). Do **not**
    write a second cost formula here.
- Return a **range**, not a point. `EstimateRange` already exists (`types.ts:3852-3892`) and
  `costUsd` is already `EstimateRange | undefined`:
  - **low** = the cached model above
  - **high** = today's arithmetic (no caching at all)
  When the model publishes no `cachedInPer1M`, low === high and the range collapses — correct, not a
  special case.
- Only claim caching where it can happen. `cachedInPer1M` being present *is* that signal (an
  unpriced-for-cache model gets the full rate through `computeCostBreakdown`'s existing `readRate`
  fallback at `pricing.ts:223`), so no provider-kind fork is needed — and none may be added.
- Surface the assumption in the response so the launcher can label it: add
  `cachingAssumed: boolean` to the estimate response shape (`packages/shared`, additive + zod).

## Out of scope

The token model itself (`footprintTokens`, `systemPromptTokens`, turn count) is unchanged — this WP
prices the same tokens correctly, it does not re-count them. No UI beyond whatever renders
`costUsd` already; the launcher's presentation of the range is WP 3.1.

## Acceptance

1. For a plan matching a real finished cached run, `costUsd.low` lands within a stated tolerance of
   that run's actual `cost_usd`, and `costUsd.high` within tolerance of its fully-uncached cost. Use
   a fixture with recorded numbers, not a live provider.
2. A model with no `cachedInPer1M` yields `low === high` and `cachingAssumed === false`.
3. **No second formula.** A test reads `apps/api/src/estimate/estimate.ts` and fails if it contains
   an `inPer1M` multiplication outside the `computeCostBreakdown` call — the D-CT5 tooth. Break it
   once and watch it go red.
4. Every existing estimate test still passes, with expectations updated **only** where the range's
   `high` is the old point value (i.e. the old behaviour is exactly the range's upper bound).
5. `POST /api/estimate/run-plan` stays additive: the response gains `cachingAssumed` and a `costUsd`
   whose `low` may now differ from `high`; no field is removed or renamed.
6. Gate green: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`.
