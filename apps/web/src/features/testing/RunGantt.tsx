import { useEffect, useMemo, useRef, useState } from "react";
import type { RunStep } from "@mcp-token-footprint/shared";
import { EmptyState } from "@brand/ui";
import { Gantt, type GanttStatus, type GanttTask } from "@brand/charts";
import { GanttChartSquare } from "lucide-react";
import type { RunStreamState } from "./use-run-stream";

/**
 * Track D — the run timeline (findings/09 §4.4), mounted by `AnalyticsPanel`'s Timeline sub-tab. A
 * `@brand/charts` `Gantt` built from the steps that carry Track-E wall-clock timing
 * (`startedAt`/`endedAt`): one bar per `llm_response` turn and one per `tool_call`, on a fixed
 * wall-clock domain so sub-second tool calls stay visible. Bars are colored by the SEMANTIC `Status`
 * union ONLY (never `--chart-N`, per the Gantt rule):
 *   - LLM turn → `info` (settled) / `pending` (still running);
 *   - tool call → `success` (ok) / `error` (failed).
 *
 * Dependencies chain request → its tool calls → the next turn's response, ordered by `turnIndex` +
 * emission order. Older runs persisted before the timing contract have null `startedAt`/`endedAt`; we
 * guard for that and show an EmptyState rather than an empty axis.
 *
 * Observability (WP 3.2) — a timed `tool_io` CHILD step (WP3.1's `spanKind`, the MCP roundtrip detail
 * under its `tool_call` parent) becomes a NESTED lane via `GanttTask.parentId` — `@brand/charts`' `Gantt`
 * already renders `parentId` as a collapsible child row, so no new chart primitive is needed. The
 * `tool_io` child's `parentStepId` already equals the SURVIVING `:mcp:` tool-call task's id (both are
 * emitted from the same MCP-sink call — see `dedupeToolCalls` below, which keeps the `:mcp:` step as the
 * bar), so no id reparenting is needed here (unlike `StepLog`'s tree, which displays the `:step:` ENGINE
 * row instead and must reparent — see `step-tree.ts`). A run with no `tool_io` children (every run
 * recorded before WP3.1) renders EXACTLY as before — untimed, unparented tasks are unaffected.
 */

export type RunGanttProps = {
  /** The accumulated run stream — the Gantt reads `stream.steps` (only timed steps are plotted). */
  stream: RunStreamState;
};

/** A step that is guaranteed to carry both wall-clock timestamps (after the guard below). */
type TimedStep = RunStep & { startedAt: string; endedAt: string };

function isTimed(step: RunStep): step is TimedStep {
  return typeof step.startedAt === "string" && typeof step.endedAt === "string";
}

/** Map an `llm_response` step's run-status into the Gantt's semantic `GanttStatus` union. */
function llmStatus(step: TimedStep): GanttStatus {
  if (step.status === "error") return "error";
  if (step.status === "running") return "pending";
  return "info";
}

/** Map a `tool_call` step's run-status into the Gantt's semantic `GanttStatus` union. */
function toolStatus(step: TimedStep): GanttStatus {
  if (step.status === "error") return "error";
  if (step.status === "running") return "pending";
  return "success";
}

/** Read a `toolCallId` off a step's redacted payload (engine + MCP-sink steps both carry it). */
function payloadToolCallId(step: RunStep): string | undefined {
  const p = step.payload;
  if (p && typeof p === "object" && "toolCallId" in p) {
    const id = (p as { toolCallId: unknown }).toolCallId;
    return typeof id === "string" ? id : undefined;
  }
  return undefined;
}

/**
 * De-dupe the timed `tool_call` steps to one per logical call. Each call is emitted twice — the engine
 * `tool_call` and the `:mcp:`-keyed MCP-sink duplicate (which carries the real `durationMs`). We key by
 * `toolCallId` when present (else the step id), preferring the MCP-sink step (real latency span). A
 * call with neither side timed is already excluded by the `isTimed` filter upstream.
 */
function dedupeToolCalls(timedToolCalls: TimedStep[]): TimedStep[] {
  const byKey = new Map<string, TimedStep>();
  const order: string[] = [];
  for (const step of timedToolCalls) {
    const key = payloadToolCallId(step) ?? step.id;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, step);
      order.push(key);
    } else if (step.id.includes(":mcp:") && !existing.id.includes(":mcp:")) {
      // Prefer the MCP-sink span (real measured latency) over the engine duplicate.
      byKey.set(key, step);
    }
  }
  return order.map((k) => byKey.get(k)!);
}

/**
 * Build the `GanttTask[]` from the timed steps. One bar per `llm_response` turn + one per de-duped
 * `tool_call`, in stream (`index`) order, PLUS (WP 3.2) one NESTED bar per timed `tool_io` child —
 * `GanttTask.parentId` set to its parent `tool_call` task's id, so `Gantt` renders it as a collapsible
 * child lane. Dependencies wire each turn's tool calls back to the preceding response, and the next
 * response forward from that turn's tool calls (request → tools → response), so the arrows read as the
 * agent loop; a nested `tool_io` child carries NO dependency arrow of its own (it's already anchored
 * under its parent). Bars carry only the semantic `Status` color — `tool_io` reuses `toolStatus`, the
 * SAME rule its parent `tool_call` bar uses.
 */
export function buildTasks(steps: RunStep[]): GanttTask[] {
  const timed = steps.filter(isTimed);
  const dedupedTools = dedupeToolCalls(timed.filter((s) => s.type === "tool_call"));
  const keptToolIds = new Set(dedupedTools.map((s) => s.id));

  const tasks: GanttTask[] = [];
  let prevResponseId: string | undefined;
  let pendingToolIds: string[] = [];

  for (const step of timed) {
    if (step.type === "llm_response") {
      const turnOrdinal =
        typeof step.turnIndex === "number" ? step.turnIndex + 1 : tasks.length + 1;
      // Chain from this turn's tool calls when present, else from the previous response.
      const deps =
        pendingToolIds.length > 0 ? pendingToolIds : prevResponseId ? [prevResponseId] : [];
      tasks.push({
        id: step.id,
        name: `LLM · turn ${turnOrdinal}`,
        start: step.startedAt,
        end: step.endedAt,
        status: llmStatus(step),
        ...(deps.length > 0 ? { dependencies: deps } : {}),
      });
      prevResponseId = step.id;
      pendingToolIds = [];
      continue;
    }

    if (step.type === "tool_call" && keptToolIds.has(step.id)) {
      tasks.push({
        id: step.id,
        name: step.toolName ?? step.label,
        start: step.startedAt,
        end: step.endedAt,
        status: toolStatus(step),
        ...(prevResponseId ? { dependencies: [prevResponseId] } : {}),
      });
      pendingToolIds.push(step.id);
      continue;
    }

    // Observability (WP 3.2) — a timed `tool_io` child nests under its parent `tool_call` bar. The
    // parent id already equals a surviving `:mcp:` task's id (both sides of the SAME MCP-sink call —
    // no reparenting needed, unlike `StepLog`'s tree). A child whose parent got filtered out by the
    // `isTimed`/de-dup passes above (shouldn't happen — `tool_io` mirrors its parent's timing) is
    // defensively skipped rather than plotted as a dangling/parentless bar.
    if (step.type === "context_event" && step.spanKind === "tool_io") {
      const parentId = step.parentStepId;
      if (parentId && keptToolIds.has(parentId)) {
        tasks.push({
          id: step.id,
          name: step.label,
          start: step.startedAt,
          end: step.endedAt,
          status: toolStatus(step),
          parentId,
        });
      }
    }
    // llm_request / tool_result / user_message have no own span — not plotted.
  }

  return tasks;
}

/** The wall-clock domain [min startedAt, max endedAt] padded by 2% each side, or null when no spans. */
function buildDomain(tasks: GanttTask[]): { start: Date; end: Date } | null {
  if (tasks.length === 0) return null;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const t of tasks) {
    min = Math.min(min, new Date(t.start).getTime());
    max = Math.max(max, new Date(t.end).getTime());
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  // Guard a zero-width domain (a single instantaneous step): widen to 1s so the bar renders.
  if (max <= min) max = min + 1000;
  const pad = Math.max(1000, (max - min) * 0.02);
  return { start: new Date(min - pad), end: new Date(max + pad) };
}

/** Pick a sensible default view granularity from the total span. */
function pickViewMode(start: Date, end: Date): "day" | "week" | "month" | "quarter" {
  const spanMs = end.getTime() - start.getTime();
  const hour = 3_600_000;
  if (spanMs <= 6 * hour) return "day";
  if (spanMs <= 7 * 24 * hour) return "week";
  if (spanMs <= 90 * 24 * hour) return "month";
  return "quarter";
}

export function RunGantt({ stream }: RunGanttProps) {
  const tasks = useMemo(() => buildTasks(stream.steps), [stream.steps]);
  const domain = useMemo(() => buildDomain(tasks), [tasks]);

  // `Gantt.Body` needs a concrete `canvasWidth` (px) — there is no responsive default. Measure the
  // container so the timeline fills the pane, with a fallback width before the first measure lands.
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasWidth, setCanvasWidth] = useState(720);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      // Reserve the label column (default 240px) so the bars canvas gets the rest; clamp to a floor.
      const width = Math.max(360, Math.round(entry.contentRect.width) - 240);
      setCanvasWidth(width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!domain || tasks.length === 0) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center p-6">
        <EmptyState
          icon={<GanttChartSquare aria-hidden />}
          title="No timeline yet"
          description="The run timeline draws once steps carry wall-clock timing. Runs recorded before per-step timing was captured have no timeline."
        />
      </div>
    );
  }

  const viewMode = pickViewMode(domain.start, domain.end);

  return (
    <div ref={containerRef} className="h-full min-h-0 w-full overflow-hidden">
      <Gantt tasks={tasks} defaultViewMode={viewMode} style={{ height: 360 }}>
        <Gantt.Toolbar />
        <Gantt.Body
          domainStart={domain.start}
          domainEnd={domain.end}
          canvasWidth={canvasWidth}
          maxHeight={320}
        />
      </Gantt>
    </div>
  );
}
