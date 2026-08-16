import type { RunStep } from "@mcp-token-footprint/shared";

/**
 * WP 3.2 — the per-turn index shown in the run console's monitoring rail (a clickable list of turns
 * with per-turn tokens; each row cross-links to that turn in the chat). Pure derivation from the same
 * `RunStep[]` the rest of the console reads, so it can't drift.
 *
 * One row per SETTLED assistant turn (its closing `llm_response` step). Provider-actual input/output
 * tokens come from that step's `usageActual`; the context total from its `context` snapshot; tool-call
 * count from the engine `tool_call` steps of the same turn (the `:mcp:` sink duplicate is excluded so
 * the count matches the conversation); `hasError` when any step of the turn failed.
 */

export type TurnRow = {
  /** 0-based assistant-turn ordinal (matches `TimelineAssistantTurn.turnIndex`). */
  turnIndex: number;
  /** 1-based human label. */
  turnNo: number;
  tokensIn: number;
  tokensOut: number;
  /** Context-window total after the turn, or null when the turn carried no snapshot. */
  contextTotal: number | null;
  toolCalls: number;
  hasError: boolean;
};

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function deriveTurnRows(steps: RunStep[]): TurnRow[] {
  // Per-turn tool-call counts (engine steps only, not the `:mcp:` sink) + which turns saw an error.
  const toolCalls = new Map<number, number>();
  const errorTurns = new Set<number>();
  for (const step of steps) {
    const ti = typeof step.turnIndex === "number" ? step.turnIndex : undefined;
    if (step.type === "tool_call" && !step.id.includes(":mcp:") && ti !== undefined) {
      toolCalls.set(ti, (toolCalls.get(ti) ?? 0) + 1);
    }
    if (step.status === "error" && ti !== undefined) errorTurns.add(ti);
  }

  const rows: TurnRow[] = [];
  let fallback = 0; // running ordinal for old runs whose steps predate `turnIndex`
  for (const step of steps) {
    if (step.type !== "llm_response") continue;
    fallback += 1;
    const ti = typeof step.turnIndex === "number" ? step.turnIndex : fallback - 1;
    rows.push({
      turnIndex: ti,
      turnNo: ti + 1,
      tokensIn: num(step.usageActual?.inputTokens),
      tokensOut: num(step.usageActual?.outputTokens),
      contextTotal: step.context ? step.context.total : null,
      toolCalls: toolCalls.get(ti) ?? 0,
      hasError: errorTurns.has(ti) || step.status === "error",
    });
  }
  return rows;
}
