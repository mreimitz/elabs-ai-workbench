import type { RunStep, TokenUsageActual } from "@mcp-token-footprint/shared";
import { runDurationMs } from "./analytics-derive";
import type { TimelineItem } from "./use-run-stream";

/**
 * Observability (WP3.4) — one summary row per assistant turn, for the Turns lens (`TurnsLens.tsx`,
 * the LangSmith "Turns" idea scoped to what this console needs: fast scanning of a long interactive
 * session). Pure derivation from the SAME `stream.timeline`/`stream.steps` every other pane reads, so
 * it can't drift from the conversation/steps views.
 */
export type TurnSummary = {
  /** 0-based assistant-turn ordinal (matches `TimelineAssistantTurn.turnIndex`). */
  turnIndex: number;
  /** 1-based human label. */
  turnNo: number;
  /** First non-blank line of the user turn that immediately preceded this one, if any. */
  promptFirstLine: string | null;
  /** First non-blank line of the assistant's reply, falling back to its reasoning. */
  replyFirstLine: string | null;
  /** True while this is the not-yet-settled in-flight turn. */
  streaming: boolean;
  hasError: boolean;
  /** Wall-clock span of the turn's own steps (`startedAt`→`endedAt`), or null when not timed. */
  durationMs: number | null;
  tokensIn: number;
  tokensOut: number;
  /** RM-33 — the usage record `tokensIn` decomposes; absent when the turn reported none. */
  usage?: TokenUsageActual;
  toolCalls: number;
  /** The turn's closing `llm_response` step id — the feedback-control scope + the cross-console link. */
  stepId: string | null;
};

/** The first non-blank line of `text`, trimmed; `null` for empty/all-blank text. */
export function firstLine(text: string | undefined | null): string | null {
  if (!text) return null;
  const line = text.split("\n").find((l) => l.trim().length > 0);
  return line ? line.trim() : null;
}

/**
 * One {@link TurnSummary} per assistant turn in `timeline`, in order. Each turn is paired with the
 * user item that immediately PRECEDED it in the timeline (the opener prompt, or the interactive
 * follow-up right before it) — a turn with no preceding (unconsumed) user item carries a null prompt
 * rather than a stale one from two turns back.
 */
export function deriveTurnSummaries(timeline: TimelineItem[], steps: RunStep[]): TurnSummary[] {
  const summaries: TurnSummary[] = [];
  let pendingPrompt: string | null = null;

  for (const item of timeline) {
    if (item.kind === "user") {
      pendingPrompt = firstLine(item.text);
      continue;
    }
    const turnSteps = steps.filter((s) => s.turnIndex === item.turnIndex);
    summaries.push({
      turnIndex: item.turnIndex,
      turnNo: item.turnIndex + 1,
      promptFirstLine: pendingPrompt,
      replyFirstLine: firstLine(item.assistantText) ?? firstLine(item.reasoningText),
      streaming: item.streaming,
      hasError: item.status === "error" || turnSteps.some((s) => s.status === "error"),
      durationMs: runDurationMs(turnSteps),
      tokensIn: item.usageActual?.inputTokens ?? 0,
      tokensOut: item.usageActual?.outputTokens ?? 0,
      // RM-33 — the record `tokensIn` decomposes, so the row's ↑ figure can explain itself.
      ...(item.usageActual ? { usage: item.usageActual } : {}),
      toolCalls: item.toolCalls.length,
      stepId: item.stepId ?? null,
    });
    pendingPrompt = null; // consumed — the NEXT turn's prompt (if any) is a later, distinct user item
  }

  return summaries;
}
