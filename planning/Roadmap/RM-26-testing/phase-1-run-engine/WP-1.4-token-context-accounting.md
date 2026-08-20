---
type: "Work Package Spec"
title: "WP 1.4 \u2014 Token & context accounting"
description: "Phase: 1 \u00b7 Size: L \u00b7 Depends on: 1.3"
tags: ["roadmap", "RM-26"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP 1.4 — Token & context accounting

**Phase:** 1 · **Size:** L · **Depends on:** 1.3

## Objective
Per-step measurement with multiple **estimator lenses** + **provider-actual** usage, plus a
**context-window composition** snapshot per step and overflow detection. This is the product's core
value.

## Why / references
Scope decisions #2 (profiles as lenses, estimator + actual), #3 (surface native context mgmt),
#12 (overflow = record it). The model: [`../references.md`](../references.md) → *Braintrust — token
usage* (per-call prompt/completion split, context-window utilization %, per-step attribution;
oversized tool schemas inflate prompt tokens — exactly what we visualize). Field names follow
*OpenTelemetry GenAI* (`input_tokens`/`output_tokens`/cache/reasoning). Anthropic cache fields per
*Anthropic prompt caching*. Reuse the `TokenCounter` interface
(`apps/api/src/token-counting/types.ts`) and profiles (`profiles.ts`). Extends
[`../../04-token-counting-strategy.md`](/Research/RS-09-token-counting-strategy/outputs/token-counting-strategy.md) from "definition only" to
"definition + runtime".

## Files (new)
- `apps/api/src/testing/accounting.ts`

## Design — two measurement sources
1. **Estimator lenses (per resolved profile).** Use `TokenCounter.countText`/`countJson` over the
   *exact* serialized request the SDK sends (messages + tool defs + params) and the response. These
   work for any provider and any step.
2. **Provider-actual.** Read from the AI SDK step/finish `usage` + `providerMetadata`:
   `inputTokens`, `outputTokens`, cached + reasoning where present (Anthropic
   `cache_read_input_tokens`/`cache_creation_input_tokens`; OpenAI cached/reasoning — WP 2.3 maps the
   rest). Only available on `llm_*` steps. Surface the **estimate − actual delta**.

## Design — context snapshot (the centerpiece data)
After each step compute a `ContextSnapshot` attributing the live window to segments — so the UI chart
(WP 3.5) can show *what* fills it:
```ts
type ContextSnapshot = { total; limit; segments: { system, tool_defs, history, tool_results, output } };
```
- `system` = system prompt tokens; `tool_defs` = Σ allowed tool-definition tokens (reuse
  `countToolDefinition`); `history` = prior turns; `tool_results` = injected results; `output` =
  current generation.
- `limit` = `MODEL_CONTEXT_LIMITS[model]` (WP 0.3 seed) — but treat a provider context-limit error as
  the **ground-truth overflow** signal regardless of the map.
- `total` rolls up; track `peakContextTokens` on the run.

## Design — overflow (decision #12)
No app-side intervention. If the provider throws a context-length error, the engine catches it, emits
a `context_event` step + a terminal `status` event with `outcome: "context_overflow"`, and persists it
as a legitimate result. The chart marks the overflow point.

## StepSink interface (consumed by WP 1.3 / 1.5 / 1.6)
```ts
interface StepSink {
  llmRequest(req): Promise<void>;
  llmResponse(res, usage): Promise<void>;   // computes lenses + actual + snapshot, emits RunEvent {step,kpi}
  toolCall(def, args, result, ms): Promise<void>;
  context(snapshot): void;
}
```

## Implementation steps
1. Build a resolver that, given resolved profiles, returns the active `TokenCounter`s.
2. Implement the sink: for each step, count lenses, extract actual usage, compute the snapshot,
   accumulate run KPIs (turns, toolCalls, tokensIn/out, cached, peakContext), emit `step` + `kpi`
   `RunEvent`s, and hand the record to persistence (WP 1.6).
3. Centralize provider-usage field mapping here so WP 2.3 only adds cases.

## Acceptance
- A run yields a `run_steps` series where each `llm_*` step has both estimator lens counts **and**
  provider-actual usage, with a computed delta.
- The context series attributes the `tool_defs` slice (assert: adding a tool to the allow-list raises
  the baseline `tool_defs` tokens at turn 0 — the thesis).
- A forced context-limit error produces `outcome: "context_overflow"`, not a crash.
- Gate green.
