import type { RunDetail, RunEvent, RunStep } from "@mcp-token-footprint/shared";
import { safeJson } from "../../../../lib/format";
import { firstProfileTokens } from "../../StepLog";
import { buildTimeline, type TimelineToolCall } from "../../use-run-stream";
import type { WorkspaceRun } from "../compare-runs";
import type { FlowLane, FlowNode, FlowTurn } from "./flow-types";

/**
 * Reshape a finished run's {@link RunDetail} into an aligned-lane-ready {@link FlowLane}. Reuses the
 * console's `buildTimeline` (WP 3.2 turn grouping + tool_call/tool_result pairing, de-duped by
 * `toolCallId`) so the flow diff can never drift from what the run console shows — then flattens each
 * turn into the §H4 event blocks (reasoning → tool calls → answer) plus a session preamble (skills
 * loaded) and, when the run ended abnormally, a terminal guardrail/error block.
 *
 * Pure + React-free (unit-testable): the only inputs are the run summary + its persisted trace.
 */
export function buildFlowLane(run: WorkspaceRun, detail: RunDetail): FlowLane {
  // A terminal status → no in-flight synthesis; buildTimeline reconstructs the settled conversation.
  const timeline = buildTimeline({
    steps: detail.steps,
    deltas: { text: "", reasoning: "" },
    status: detail.status,
  });

  const turns: FlowTurn[] = [];
  let terminalTurnIndex = 0;

  for (const item of timeline) {
    if (item.kind === "user") continue; // the opening prompt is identical across same-test runs

    const turnIndex = item.turnIndex;
    terminalTurnIndex = Math.max(terminalTurnIndex, turnIndex);
    const nodes: FlowNode[] = [];

    // 1 · reasoning (collapsed to one line)
    const reasoning = item.reasoningText?.trim();
    if (reasoning) {
      nodes.push({
        id: `${run.id}-t${turnIndex}-reasoning`,
        kind: "reasoning",
        turnIndex,
        alignKey: `reasoning@t${turnIndex}`,
        title: "Reasoning",
        subtitle: oneLine(reasoning, 120),
      });
    }

    // 2 · tool calls, in stream order
    for (const tc of item.toolCalls) {
      nodes.push(toolNode(run.id, turnIndex, tc));
    }

    // 3 · the turn's assistant prose (the final answer on the terminal turn)
    const answer = item.assistantText?.trim();
    if (answer) {
      nodes.push({
        id: `${run.id}-t${turnIndex}-answer`,
        kind: "answer",
        turnIndex,
        alignKey: `answer@t${turnIndex}`,
        title: "Assistant response",
        subtitle: oneLine(answer, 140),
        resultText: answer,
        ...(item.usageActual?.outputTokens ? { tokens: item.usageActual.outputTokens } : {}),
      });
    }

    if (nodes.length > 0) turns.push({ turnIndex, nodes });
  }

  turns.sort((a, b) => a.turnIndex - b.turnIndex);

  return {
    runIndex: run.index,
    letter: run.letter,
    color: run.color,
    isBaseline: run.isBaseline,
    run,
    preamble: preambleNode(run.id, detail),
    turns,
    terminal: terminalNode(run.id, detail, terminalTurnIndex + 1),
    skills: detail.skills,
  };
}

// ── node builders ────────────────────────────────────────────────────────────────────────────────

function toolNode(runId: string, turnIndex: number, tc: TimelineToolCall): FlowNode {
  const args = readArgs(tc.call);
  const argsJson = args !== undefined ? stableStringify(args) : "";
  const result = resultText(tc.result);
  const failed =
    tc.result?.status === "error" || tc.call.status === "error" || result?.isError === true;
  const tokens = tc.result ? firstProfileTokens(tc.result) : 0;
  const durationMs = toolDuration(tc);
  const skillDisclosure = isSkillDisclosure(tc.toolName);

  return {
    id: `${runId}-${tc.id}`,
    kind: "tool",
    turnIndex,
    // Args are part of the alignment key so the SAME tool with DIFFERENT args does not falsely align.
    alignKey: `tool:${tc.toolName}:${argsJson}`,
    title: tc.toolName,
    ...(tc.serverId ? { subtitle: tc.serverId } : {}),
    status: failed ? "error" : tc.result ? "ok" : "running",
    toolName: tc.toolName,
    ...(tc.serverId ? { serverId: tc.serverId } : {}),
    ...(argsJson ? { argsJson } : {}),
    ...(result ? { resultText: result.value, resultIsError: result.isError } : {}),
    ...(skillDisclosure ? { isSkillDisclosure: true } : {}),
    ...(tokens > 0 ? { tokens } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    stepId: tc.call.id,
  };
}

function preambleNode(runId: string, detail: RunDetail): FlowNode {
  const count = detail.skills.length;
  const cost = detail.skills.reduce((sum, s) => sum + (s.footprint?.totalTokens ?? 0), 0);
  const subtitle =
    count === 0
      ? "No skills attached"
      : `${count} skill${count === 1 ? "" : "s"} loaded · ${formatTokens(cost)} always-on`;
  return {
    id: `${runId}-preamble`,
    kind: "preamble",
    turnIndex: -1,
    alignKey: "preamble",
    title: "Session start",
    subtitle,
    ...(cost > 0 ? { tokens: cost } : {}),
  };
}

/** A terminal guardrail/error block from the run's outcome + its persisted event log. */
function terminalNode(runId: string, detail: RunDetail, turnIndex: number): FlowNode | null {
  const status = detail.status;
  const outcome = detail.outcome;
  const abnormal = status === "error" || status === "aborted" || status === "stopped";
  const outcomeAbnormal = outcome != null && outcome !== "completed";
  if (!abnormal && !outcomeAbnormal) return null;

  const { message, stopReason } = terminalReason(detail.events);
  const guardrail =
    status === "stopped" ||
    (outcome ?? "").includes("guardrail") ||
    (stopReason ?? "").toLowerCase().includes("guardrail") ||
    (stopReason ?? "").toLowerCase().includes("max");
  const kind = guardrail ? "guardrail" : "error";

  return {
    id: `${runId}-terminal`,
    kind,
    turnIndex,
    alignKey: `terminal:${kind}`,
    title: guardrail ? "Guardrail stop" : "Run error",
    subtitle:
      message ??
      stopReason ??
      (guardrail ? "A guardrail limit was reached" : "The run ended in error"),
    status: "error",
    ...(message || stopReason ? { resultText: message ?? stopReason, resultIsError: true } : {}),
  };
}

function terminalReason(events: RunEvent[]): { message?: string; stopReason?: string } {
  let message: string | undefined;
  let stopReason: string | undefined;
  for (const event of events) {
    if (event.type === "error" && typeof event.message === "string") message = event.message;
    if (event.type === "status" && typeof event.stopReason === "string")
      stopReason = event.stopReason;
  }
  return { ...(message ? { message } : {}), ...(stopReason ? { stopReason } : {}) };
}

// ── small helpers ────────────────────────────────────────────────────────────────────────────────

/** The read-only skill-disclosure tools the agent uses to open a skill (metered, never executed). */
function isSkillDisclosure(toolName: string): boolean {
  const n = toolName.toLowerCase();
  return n.includes("read_skill_file") || n.startsWith("skill:") || n.includes("skill://");
}

function readArgs(step: RunStep): unknown {
  const p = step.payload;
  if (p && typeof p === "object" && "args" in p) return (p as { args: unknown }).args;
  return undefined;
}

/** Stable JSON (sorted keys) so identical args produce an identical alignment key regardless of order. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return Object.fromEntries(entries.map(([k, v]) => [k, sortKeys(v)]));
  }
  return value;
}

function resultText(result: RunStep | undefined): { value: string; isError: boolean } | null {
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
        if (text.length > 0) return { value: text, isError: isError || rr.isError === true };
      }
      return { value: safeJson(r), isError };
    }
    if ("error" in p) return { value: String((p as { error: unknown }).error), isError: true };
  }
  return { value: safeJson(p), isError };
}

function toolDuration(tc: TimelineToolCall): number | undefined {
  return (
    durationOf(tc.result) ?? durationOf(tc.call) ?? tc.result?.durationMs ?? tc.call.durationMs
  );
}

function durationOf(step: RunStep | undefined): number | undefined {
  if (!step) return undefined;
  if (step.startedAt && step.endedAt) {
    const ms = new Date(step.endedAt).getTime() - new Date(step.startedAt).getTime();
    if (Number.isFinite(ms) && ms >= 0) return ms;
  }
  return step.durationMs;
}

function oneLine(value: string, max: number): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function formatTokens(n: number): string {
  return `${n.toLocaleString()} tok`;
}
