---
type: "Work Package Spec"
title: "WP 1.5 \u2014 Guardrails + pricing"
description: "Phase: 1 \u00b7 Size: M \u00b7 Depends on: 1.4"
tags: ["roadmap", "RM-26"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP 1.5 — Guardrails + pricing

**Phase:** 1 · **Size:** M · **Depends on:** 1.4

## Objective
Stop runaway runs and surface which limit tripped: **max turns / tool calls**, **token / context
budget**, **spend cap**. Scope decision #11 (no wall-clock).

## Why / references
[`../references.md`](../references.md) → *AI SDK — Loop Control* (`stopWhen`, `stepCountIs`,
`onStepFinish`; default stop is `stepCountIs(20)`). Guardrails are scenario settings (`GuardrailConfig`
in WP 0.3). Spend = provider-actual tokens × pricing.

## Files (new)
- `apps/api/src/testing/guardrails.ts`
- `apps/api/src/providers/pricing.ts`

## Design — enforcement
- **Step count** → `stopWhen: stepCountIs(maxTurns)` on the engine call.
- **Tool-calls / token / context / spend budgets** → an accumulator updated in `onStepFinish`
  (alongside WP 1.4 accounting). When a budget is crossed, set `stop_reason` and stop the loop
  (resolve a custom `stopWhen` predicate that returns true once `tripped` is set, or abort the stream
  and finalize). The terminal `RunEvent` carries `outcome: "stopped_guardrail"` + the named reason.
```ts
type GuardrailState = { turns; toolCalls; tokens; contextTokens; costUsd; tripped?: keyof GuardrailConfig };
function check(state, cfg): GuardrailState["tripped"] | undefined {
  if (cfg.maxToolCalls && state.toolCalls >= cfg.maxToolCalls) return "maxToolCalls";
  if (cfg.maxTokens && state.tokens >= cfg.maxTokens) return "maxTokens";
  if (cfg.maxContextTokens && state.contextTokens >= cfg.maxContextTokens) return "maxContextTokens";
  if (cfg.maxCostUsd && state.costUsd >= cfg.maxCostUsd) return "maxCostUsd";
  return undefined;
}
```

## Design — pricing (best-effort, flagged)
```ts
// providers/pricing.ts  — last updated: <date>; spend cap is ESTIMATED.
export const MODEL_PRICING: Record<string, { inPer1M: number; outPer1M: number; cachedInPer1M?: number }> = { /* … */ };
export function estimateCost(model, usage: TokenUsageActual): number { /* (in/1e6*inPer1M)+(out/1e6*outPer1M)+cached */ }
```
Scope open-Q #6: pricing maintenance is manual. Label spend "estimated" in the UI (WP 3.5).

## Implementation steps
1. Wire `stepCountIs(maxTurns ?? 20)` into the engine call (WP 1.3).
2. Update `GuardrailState` in `onStepFinish`; compute cost from WP 1.4 actual usage × pricing.
3. On trip: stop, set `runs.stop_reason`, emit terminal event with `outcome:"stopped_guardrail"`.

## Acceptance
- A unit test per guardrail proves it fires and names itself in `stop_reason`.
- Spend cap halts a run once estimated cost crosses the cap; cost equals actual tokens × pricing.
- A run with no guardrails set still stops at the AI SDK default (`stepCountIs(20)`) — assert.
- Gate green.
