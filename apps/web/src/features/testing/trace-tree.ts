import type { RunStep, RunStepType, TokenUsageActual } from "@mcp-token-footprint/shared";
import { safeJson } from "../../lib/format";
import { firstProfileTokens } from "./StepLog";
import {
  toolAnchorValue,
  toolCallIdOfStep,
  turnAnchorValue,
  type ConsoleNavRef,
} from "./console-anchors";
import type {
  RunDeltas,
  RunKpis,
  TimelineAssistantTurn,
  TimelineItem,
  TimelineToolCall,
  TimelineUserItem,
} from "./use-run-stream";

/**
 * Pure derivation of the **Trace timeline** — a turn-grouped, multi-level tree reconstructed from the
 * SAME `RunStreamState` the rest of the console reads (so it can never drift). It reuses Wave-1's
 * `buildTimeline` output (turn grouping + tool_call/tool_result pairing, de-duped by `toolCallId`)
 * and only re-shapes it into a collapsible hierarchy with bottom-up KPIs:
 *
 *   Turn N (separator + aggregate chips)
 *     ├─ User prompt (when the turn opened with one) — leaf, expands to the full prompt
 *     └─ Assistant (the turn's generation, aggregate chips)
 *         ├─ LLM response (event) → Request (derived) · Reasoning · Response  (expandable leaves)
 *         └─ Tool: <name> (event) → Arguments · Result                        (expandable leaves)
 *
 * No React, no side effects — unit-testable and reusable, like `buildTimeline`/`dedupeToolSteps`.
 *
 * KPI honesty: per-event **cost is not measured by the engine** (cost is only cumulative on `kpi`
 * events). So cost appears at TURN level only — derived by diffing consecutive cumulative
 * `kpiByStepId` snapshots (mirrors `analytics-derive` `deriveTurnTrend`); sub-events carry tokens +
 * duration only. The "Request" leaf is the FORK-A derived delta (the turn's new input), not the raw
 * request body (which is not captured) — labelled as such.
 */

export type TraceNodeKind = "turn" | "user" | "assistant" | "event-llm" | "event-tool" | "leaf";

/** Right-aligned chips for a node. Only the defined fields render. */
export type TraceKpi = {
  tokensIn?: number;
  tokensOut?: number;
  /**
   * RM-33 — the usage record `tokensIn` decomposes, when the turn carries one. A Trace row shows a
   * cache-INCLUSIVE token count next to a cache-DISCOUNTED cost (`costUsd` flows from `estimateCost`,
   * which prices reads at ~0.1x and writes at 1.25x), so the two do not reconcile at list rate and a
   * reader has no way to see why. This is what makes them reconcilable.
   */
  usage?: TokenUsageActual;
  /** A single token figure (e.g. a tool result's size) when in/out don't apply. */
  tokens?: number;
  durationMs?: number;
  /** Turn/run only — never fabricated on sub-events. */
  costUsd?: number;
  /** ISO start time → the HH:MM:SS clock. */
  timestamp?: string;
};

export type TraceNode = {
  id: string;
  kind: TraceNodeKind;
  title: string;
  /** A muted one-liner beside the title (e.g. an arg preview). */
  subtitle?: string;
  /** Maps to a `RunStep` → drives the shared `selectedStepId` cross-highlight. */
  stepId?: string;
  /** For the status-tinted icon/dot. */
  status?: RunStep["status"];
  /** For the leading type icon (`STEP_TYPE_META`). */
  stepType?: RunStepType;
  kpi: TraceKpi;
  /** Leaf content rendered (read-only) on expand. Mutually exclusive with `children`. */
  detail?: string;
  detailLabel?: string;
  /** A leaf whose detail is an error (red tint). */
  detailError?: boolean;
  /** Monaco language id for the expand-modal's read-only editor (`detail` is shown there in full). */
  detailLanguage?: "json" | "markdown";
  /** The backing `RunStep` id → drives the expand-modal's right-side detail panel (`PacketTabs`). */
  detailStepId?: string;
  /**
   * WP 3.2 — the cross-representation anchor value for this row (a `turn:<i>` or `tool:<id>` value),
   * set on the row's DOM so a chat/error/turn-index link can scroll the Trace here.
   */
  anchorValue?: string;
  /** WP 3.2 — the nav ref this row's "Show in chat" link scrolls the chat to (turn/tool). */
  navRef?: ConsoleNavRef;
  children: TraceNode[];
  defaultOpen: boolean;
};

export function buildTraceTree(input: {
  steps: RunStep[];
  timeline: TimelineItem[];
  deltas: RunDeltas;
  kpiByStepId: Map<string, RunKpis> | null;
}): TraceNode[] {
  const { steps, timeline, deltas, kpiByStepId } = input;

  // The timeline turn carries usage/context/status/text but NOT the llm_response step's id/timing, so
  // index the llm_response step by turnIndex to recover id (selection), startedAt (clock), and
  // startedAt/endedAt (duration).
  const llmByTurn = new Map<number, RunStep>();
  for (const s of steps) {
    if (
      s.type === "llm_response" &&
      typeof s.turnIndex === "number" &&
      !llmByTurn.has(s.turnIndex)
    ) {
      llmByTurn.set(s.turnIndex, s);
    }
  }

  const nodes: TraceNode[] = [];
  let pendingUser: TimelineUserItem | null = null;
  // Cumulative cost at the previous turn's llm_response — the base for the per-turn diff.
  let prevTurnCostBase: number | undefined;

  const flushUserOnly = (): void => {
    if (!pendingUser) return;
    nodes.push(turnNode(nodes.length + 1, [userNode(pendingUser)], {}));
    pendingUser = null;
  };

  for (const item of timeline) {
    if (item.kind === "user") {
      // Two user prompts with no assistant between → emit the first as its own (user-only) turn.
      if (pendingUser) flushUserOnly();
      pendingUser = item;
      continue;
    }

    const turn = item;
    const llmStep = llmByTurn.get(turn.turnIndex);
    const children: TraceNode[] = [];
    if (pendingUser) {
      children.push(userNode(pendingUser));
      pendingUser = null;
    }
    children.push(assistantNode(turn, llmStep, deltas));

    // Per-turn cost = cumulative(this turn's llm_response) − cumulative(prev turn's). The first turn's
    // diff base is undefined → its cumulative IS its own cost.
    let costUsd: number | undefined;
    if (kpiByStepId && llmStep) {
      const cum = kpiByStepId.get(llmStep.id)?.costUsd;
      if (typeof cum === "number") {
        costUsd = prevTurnCostBase === undefined ? cum : Math.max(0, cum - prevTurnCostBase);
        prevTurnCostBase = cum;
      }
    }
    nodes.push(
      turnNode(turn.turnIndex + 1, children, turnKpi(turn, llmStep, costUsd), turn.turnIndex),
    );
  }
  flushUserOnly();

  return nodes;
}

// ── node builders ────────────────────────────────────────────────────────────────────────────────

function turnNode(
  turnNo: number,
  children: TraceNode[],
  kpi: TraceKpi,
  turnIndex?: number,
): TraceNode {
  // WP 3.2 — real assistant turns carry the shared turn anchor + a "Show in chat" ref; positional
  // user-only turns (no `turnIndex`) are not cross-linkable, so they get neither.
  return assign(
    {
      id: `trace-turn-${turnNo}`,
      kind: "turn",
      title: `Turn ${turnNo}`,
      kpi,
      children,
      defaultOpen: true,
    },
    typeof turnIndex === "number"
      ? { anchorValue: turnAnchorValue(turnIndex), navRef: { kind: "turn", turnIndex } }
      : {},
  );
}

function userNode(item: TimelineUserItem): TraceNode {
  const text = item.text.trim();
  return assign(
    {
      id: `trace-${item.id}`,
      kind: "user",
      title: "User prompt",
      stepId: item.id,
      stepType: "user_message",
      kpi: {},
      children: [],
      defaultOpen: false,
    },
    {
      subtitle: text.length > 0 ? oneLine(text, 96) : undefined,
      detail: text.length > 0 ? text : undefined,
      detailLabel: text.length > 0 ? "Prompt" : undefined,
      detailLanguage: "markdown",
      detailStepId: item.id,
    },
  );
}

function assistantNode(
  turn: TimelineAssistantTurn,
  llmStep: RunStep | undefined,
  deltas: RunDeltas,
): TraceNode {
  const children: TraceNode[] = [llmEventNode(turn, llmStep, deltas)];
  for (const tc of turn.toolCalls) children.push(toolEventNode(tc));

  const durationMs = sumDurations([
    durationOf(llmStep),
    ...turn.toolCalls.map((tc) => toolDuration(tc)),
  ]);
  const kpi: TraceKpi = {};
  if (turn.usageActual?.inputTokens) kpi.tokensIn = turn.usageActual.inputTokens;
  if (turn.usageActual?.outputTokens) kpi.tokensOut = turn.usageActual.outputTokens;
  // RM-33 — carry the record itself so the chip can explain its own number.
  if (turn.usageActual) kpi.usage = turn.usageActual;
  if (durationMs !== undefined) kpi.durationMs = durationMs;
  if (llmStep?.startedAt) kpi.timestamp = llmStep.startedAt;

  return assign(
    {
      id: `trace-asst-${turn.turnIndex}`,
      kind: "assistant",
      title: "Assistant",
      status: turn.status,
      kpi,
      children,
      defaultOpen: true,
    },
    { stepType: "llm_response" },
  );
}

function llmEventNode(
  turn: TimelineAssistantTurn,
  llmStep: RunStep | undefined,
  deltas: RunDeltas,
): TraceNode {
  const assistantText = turn.assistantText ?? (turn.streaming ? deltas.text : "");
  const reasoningText = turn.reasoningText ?? (turn.streaming ? deltas.reasoning : "");

  const llmDetailStep = llmStep ? { detailStepId: llmStep.id } : {};

  const children: TraceNode[] = [];
  // FORK A — "sent" is the DERIVED new input this turn (full request body is not captured).
  children.push({
    id: `trace-asst-${turn.turnIndex}-request`,
    kind: "leaf",
    title: "Request",
    subtitle: "new input this turn",
    kpi: {},
    detail:
      "The full LLM request (system prompt + tool definitions + re-sent history) is not captured. " +
      "The new input this turn appears above as the User prompt and/or the prior turn's tool Results; " +
      "the cumulative request is reconstructable by reading the earlier turns.",
    detailLabel: "Request (derived)",
    detailLanguage: "markdown",
    ...llmDetailStep,
    children: [],
    defaultOpen: false,
  });
  if (reasoningText.length > 0) {
    children.push({
      id: `trace-asst-${turn.turnIndex}-reasoning`,
      kind: "leaf",
      title: "Reasoning",
      kpi: {},
      detail: reasoningText,
      detailLabel: "Reasoning",
      detailLanguage: "markdown",
      ...llmDetailStep,
      children: [],
      defaultOpen: false,
    });
  }
  children.push({
    id: `trace-asst-${turn.turnIndex}-response`,
    kind: "leaf",
    title: "Response",
    subtitle: assistantText.length > 0 ? oneLine(assistantText, 96) : "(no text)",
    kpi: {},
    ...(assistantText.length > 0
      ? {
          detail: assistantText,
          detailLabel: "Response",
          detailLanguage: "markdown" as const,
          ...llmDetailStep,
        }
      : {}),
    children: [],
    defaultOpen: false,
  });

  const durationMs = durationOf(llmStep);
  const kpi: TraceKpi = {};
  if (turn.usageActual?.inputTokens) kpi.tokensIn = turn.usageActual.inputTokens;
  if (turn.usageActual?.outputTokens) kpi.tokensOut = turn.usageActual.outputTokens;
  // RM-33 — carry the record itself so the chip can explain its own number.
  if (turn.usageActual) kpi.usage = turn.usageActual;
  if (durationMs !== undefined) kpi.durationMs = durationMs;
  if (llmStep?.startedAt) kpi.timestamp = llmStep.startedAt;

  return assign(
    {
      id: `trace-asst-${turn.turnIndex}-llm`,
      kind: "event-llm",
      title: "LLM response",
      status: turn.status,
      stepType: "llm_response",
      kpi,
      children,
      defaultOpen: false,
    },
    { ...(llmStep ? { stepId: llmStep.id } : {}) },
  );
}

function toolEventNode(tc: TimelineToolCall): TraceNode {
  const toolCallId = toolCallIdOfStep(tc.call);
  const args = readArgs(tc.call);
  const result = resultDetail(tc.result);
  const failed =
    tc.result?.status === "error" || tc.call.status === "error" || result?.isError === true;

  const children: TraceNode[] = [];
  children.push({
    id: `${tc.id}-args`,
    kind: "leaf",
    title: "Arguments",
    kpi: {},
    ...(args !== undefined
      ? {
          detail: safeJson(args),
          detailLabel: "Arguments",
          detailLanguage: "json" as const,
          detailStepId: tc.call.id,
        }
      : {}),
    children: [],
    defaultOpen: false,
  });
  children.push(
    assign(
      {
        id: `${tc.id}-result`,
        kind: "leaf",
        title: result?.isError ? "Result (isError)" : "Result",
        kpi: {},
        children: [],
        defaultOpen: false,
      },
      {
        detail: result ? result.value : undefined,
        detailLabel: "Result",
        detailError: result?.isError === true ? true : undefined,
        detailLanguage: result?.language,
        detailStepId: tc.result?.id ?? tc.call.id,
        status: result?.isError ? "error" : undefined,
      },
    ),
  );

  const durationMs = toolDuration(tc);
  const resultTokens = tc.result ? firstProfileTokens(tc.result) : 0;
  const kpi: TraceKpi = {};
  if (resultTokens > 0) kpi.tokens = resultTokens;
  if (durationMs !== undefined) kpi.durationMs = durationMs;
  if (tc.call.startedAt) kpi.timestamp = tc.call.startedAt;

  return assign(
    {
      id: `trace-${tc.id}`,
      kind: "event-tool",
      title: tc.toolName,
      stepId: tc.call.id,
      stepType: "tool_call",
      status: failed ? "error" : tc.result ? "ok" : "running",
      kpi,
      children,
      defaultOpen: false,
    },
    {
      subtitle: tc.serverId,
      // WP 3.2 — the tool row is a scroll target (matched by an error card / a chat "View in trace")
      // and offers a "Show in chat" link back to the call (chat falls back to its containing turn).
      ...(toolCallId ? { anchorValue: toolAnchorValue(toolCallId) } : {}),
      ...(toolCallId
        ? {
            navRef: {
              kind: "tool",
              toolCallId,
              ...(typeof tc.call.turnIndex === "number" ? { turnIndex: tc.call.turnIndex } : {}),
            },
          }
        : {}),
    },
  );
}

// ── small helpers ────────────────────────────────────────────────────────────────────────────────

function turnKpi(
  turn: TimelineAssistantTurn,
  llmStep: RunStep | undefined,
  costUsd: number | undefined,
): TraceKpi {
  const durationMs = sumDurations([
    durationOf(llmStep),
    ...turn.toolCalls.map((tc) => toolDuration(tc)),
  ]);
  const firstStart = turn.toolCalls[0]?.call.startedAt ?? llmStep?.startedAt;
  const kpi: TraceKpi = {};
  if (turn.usageActual?.inputTokens) kpi.tokensIn = turn.usageActual.inputTokens;
  if (turn.usageActual?.outputTokens) kpi.tokensOut = turn.usageActual.outputTokens;
  // RM-33 — carry the record itself so the chip can explain its own number.
  if (turn.usageActual) kpi.usage = turn.usageActual;
  if (durationMs !== undefined) kpi.durationMs = durationMs;
  if (typeof costUsd === "number") kpi.costUsd = costUsd;
  if (firstStart) kpi.timestamp = firstStart;
  return kpi;
}

/** Duration of a step from Track-E wall-clock, or its `durationMs`, else undefined. */
function durationOf(step: RunStep | undefined): number | undefined {
  if (!step) return undefined;
  if (step.startedAt && step.endedAt) {
    const ms = new Date(step.endedAt).getTime() - new Date(step.startedAt).getTime();
    if (Number.isFinite(ms) && ms >= 0) return ms;
  }
  return step.durationMs;
}

/** A tool call's duration — result step preferred (it carries the MCP-sink timing), else the call. */
function toolDuration(tc: TimelineToolCall): number | undefined {
  return (
    durationOf(tc.result) ?? durationOf(tc.call) ?? tc.result?.durationMs ?? tc.call.durationMs
  );
}

function sumDurations(values: Array<number | undefined>): number | undefined {
  const present = values.filter((v): v is number => typeof v === "number");
  return present.length > 0 ? present.reduce((a, b) => a + b, 0) : undefined;
}

function readArgs(step: RunStep): unknown {
  const p = step.payload;
  if (p && typeof p === "object" && "args" in p) return (p as { args: unknown }).args;
  return undefined;
}

/** The redacted result text for a tool_result — the MCP `content[].text` when present, else the JSON. */
function resultDetail(
  result: RunStep | undefined,
): { value: string; isError: boolean; language: "json" | "markdown" } | null {
  if (!result) return null;
  const isError = result.status === "error";
  const p = result.payload;
  if (p && typeof p === "object") {
    const r = (p as { result?: unknown }).result;
    if (r && typeof r === "object") {
      const rr = r as { content?: unknown; isError?: unknown };
      if (Array.isArray(rr.content)) {
        const text = rr.content
          .map((c) =>
            c && typeof c === "object" && typeof (c as { text?: unknown }).text === "string"
              ? (c as { text: string }).text
              : "",
          )
          .filter((t) => t.length > 0)
          .join("\n")
          .trim();
        if (text.length > 0)
          return { value: text, isError: isError || rr.isError === true, language: "markdown" };
      }
      return { value: safeJson(r), isError, language: "json" };
    }
    if ("error" in p)
      return {
        value: String((p as { error: unknown }).error),
        isError: true,
        language: "markdown",
      };
  }
  return { value: safeJson(p), isError, language: "json" };
}

/** Collapse text to one clamped line for a row subtitle. */
function oneLine(value: string, max: number): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * Build a node by merging a base with optional fields, dropping any `undefined` so it satisfies the
 * project's exact-optional typing (never sets `key: undefined`).
 */
function assign(base: TraceNode, optional: Partial<TraceNode>): TraceNode {
  const out: TraceNode = { ...base };
  for (const [k, v] of Object.entries(optional)) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}
