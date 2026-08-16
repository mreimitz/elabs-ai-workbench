import type { GuardrailConfig } from "@mcp-token-footprint/shared";

/**
 * WP 1.5 — run guardrails. A small accumulator the engine grows in `onStepFinish` (alongside the WP
 * 1.4 accounting) plus a pure {@link check} that names the FIRST budget crossed. The step-count limit
 * (`maxTurns`) is enforced separately by the AI SDK's `stepCountIs(maxTurns)` on the engine call; the
 * remaining budgets are enforced here and, on trip, stop the loop with `outcome: "stopped_guardrail"`
 * and `stop_reason` = the named key (decision #11 — no wall-clock).
 *
 * Unified Sessions (roadmap/unified-sessions/, WP1.3) — `engine.ts` maps a tripped budget to the
 * shared `terminalFor` table's machine-readable `StopReasonCode` at the point it consumes
 * {@link GuardrailState.tripped} (`GUARDRAIL_TRIP_CAUSES` in `engine.ts`): `maxTokens` →
 * `max_tokens`, `maxContextTokens` → `max_context_tokens`, `maxCostUsd` → `max_cost`, `maxToolCalls` →
 * `max_tool_calls`. WP1.1 originally shipped with NO dedicated code for the tool-call budget (a
 * discovered contract gap, reported rather than silently patched); WP1.7 closed it by additively
 * appending `max_tool_calls` to `STOP_REASON_CODES`.
 */
export type GuardrailState = {
  /** Provider round-trips so far (kept for parity with the step-count limit / KPI rail). */
  turns: number;
  /** Cumulative MCP tool calls the model has driven. */
  toolCalls: number;
  /** Cumulative provider-actual tokens (input + output) across all settled steps. */
  tokens: number;
  /** Live context-window size (the latest context snapshot total). */
  contextTokens: number;
  /** Cumulative estimated spend in USD (provider-actual tokens × pricing). */
  costUsd: number;
  /** Set to the first crossed budget once {@link check} trips; latched by the engine to stop. */
  tripped?: keyof GuardrailConfig;
};

/** A fresh, zeroed accumulator. */
export function initialGuardrailState(): GuardrailState {
  return { turns: 0, toolCalls: 0, tokens: 0, contextTokens: 0, costUsd: 0 };
}

/**
 * Return the FIRST guardrail budget the state has crossed (`>=` the configured cap), or `undefined`.
 * A `0`/unset cap is "no limit" (the truthiness guard). Order matches the WP 1.5 sketch:
 * tool calls → tokens → context tokens → spend. `maxTurns` is intentionally absent — it is enforced
 * by `stepCountIs(maxTurns)` on the engine call, not here.
 */
export function check(state: GuardrailState, cfg: GuardrailConfig): GuardrailState["tripped"] {
  if (cfg.maxToolCalls && state.toolCalls >= cfg.maxToolCalls) return "maxToolCalls";
  if (cfg.maxTokens && state.tokens >= cfg.maxTokens) return "maxTokens";
  if (cfg.maxContextTokens && state.contextTokens >= cfg.maxContextTokens)
    return "maxContextTokens";
  if (cfg.maxCostUsd && state.costUsd >= cfg.maxCostUsd) return "maxCostUsd";
  return undefined;
}
