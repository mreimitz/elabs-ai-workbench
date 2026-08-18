import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RunStep } from "@mcp-token-footprint/shared";
import { EmptyState } from "@elabs-ai/components-ui";
import {
  computeGanttZoomBounds,
  Gantt,
  GANTT_UNIT_MS,
  type GanttColumn,
  type GanttStatus,
  type GanttTask,
  type GanttTimeUnit,
  pickGanttTimeUnit,
} from "@elabs-ai/components-charts";
import { GanttChartSquare } from "lucide-react";
import { formatDuration } from "../../lib/format";
import type { RunStreamState } from "./use-run-stream";

/**
 * Track D — the run timeline (findings/09 §4.4), mounted by `AnalyticsPanel`'s Timeline sub-tab. A
 * `@elabs-ai/components-charts` `Gantt` built from the steps that carry Track-E wall-clock timing
 * (`startedAt`/`endedAt`): one bar per `llm_response` turn and one per `tool_call`, on the run's own
 * wall-clock domain. Bars are colored by the SEMANTIC `Status` union ONLY (never `--chart-N`, per the
 * Gantt rule):
 *   - LLM turn → `info` (settled) / `pending` (still running);
 *   - tool call → `success` (ok) / `error` (failed).
 *
 * Older runs persisted before the timing contract have null `startedAt`/`endedAt`; we guard for that
 * and show an EmptyState rather than an empty axis.
 *
 * Observability (WP 3.2) — a timed `tool_io` CHILD step (WP3.1's `spanKind`, the MCP roundtrip detail
 * under its `tool_call` parent) becomes a NESTED lane via `GanttTask.parentId` — `@elabs-ai/components-charts`' `Gantt`
 * already renders `parentId` as a collapsible child row, so no new chart primitive is needed. The
 * `tool_io` child's `parentStepId` already equals the SURVIVING `:mcp:` tool-call task's id (both are
 * emitted from the same MCP-sink call — see `dedupeToolCalls` below, which keeps the `:mcp:` step as the
 * bar), so no id reparenting is needed here (unlike `StepLog`'s tree, which displays the `:step:` ENGINE
 * row instead and must reparent — see `step-tree.ts`).
 *
 * ── Scale & zoom ──────────────────────────────────────────────────────────────────────────────────
 * An agent run spans SECONDS, so the four calendar view modes the `Gantt` toolbar offers by default
 * (`day`/`week`/`month`/`quarter`) are all useless here: a 40-second domain contains no day or week
 * boundary, so the timescale rows render with zero ticks and every bar collapses to the 2 px floor. We
 * therefore drive the chart on the SUB-DAY half of `GanttTimeUnit`:
 *   - the unit auto-picks from the run's own span (`pickGanttTimeUnit`, the library's ≤40-ticks rule),
 *   - `viewModes` offers a WINDOW of the ladder around it, so the chips read e.g. Millisecond | Second
 *     | Minute rather than four dead calendar presets,
 *   - and — because composing `<Gantt.Body>` as `children` bypasses the root's own `pxPerDay` →
 *     `canvasWidth` wiring — the selected unit drives the canvas width HERE (`resolveCanvasWidth`), so
 *     pressing a chip is a real zoom (a finer unit widens the canvas past the pane and the body scrolls
 *     horizontally) instead of only relabelling the ticks. Ctrl/⌘ + wheel zooms continuously between
 *     fit-to-pane and the library's own span-derived ceiling.
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
 * child lane. Bars carry only the semantic `Status` color — `tool_io` reuses `toolStatus`, the SAME
 * rule its parent `tool_call` bar uses.
 *
 * No `dependencies` are emitted. The agent loop is strictly sequential, so row order already carries
 * request → tools → response, and `parentId` already anchors a `tool_io` child under its call; at run
 * scale a sub-second bar is near-zero width, which turned the dependency arrows into long curves
 * dominating the canvas while encoding nothing the ordering didn't.
 */
export function buildTasks(steps: RunStep[]): GanttTask[] {
  const timed = steps.filter(isTimed);
  const dedupedTools = dedupeToolCalls(timed.filter((s) => s.type === "tool_call"));
  const keptToolIds = new Set(dedupedTools.map((s) => s.id));

  const tasks: GanttTask[] = [];

  for (const step of timed) {
    if (step.type === "llm_response") {
      const turnOrdinal =
        typeof step.turnIndex === "number" ? step.turnIndex + 1 : tasks.length + 1;
      tasks.push({
        id: step.id,
        name: `LLM · turn ${turnOrdinal}`,
        start: step.startedAt,
        end: step.endedAt,
        status: llmStatus(step),
      });
      continue;
    }

    if (step.type === "tool_call" && keptToolIds.has(step.id)) {
      tasks.push({
        id: step.id,
        name: step.toolName ?? step.label,
        start: step.startedAt,
        end: step.endedAt,
        status: toolStatus(step),
      });
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

/**
 * The wall-clock domain [min startedAt, max endedAt] padded by 2% each side, plus the UNPADDED run
 * start (`runStartMs`) so the `t+` column reads 0 on the first step. Null when there are no spans.
 */
function buildDomain(
  tasks: GanttTask[],
): { start: Date; end: Date; runStartMs: number } | null {
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
  return { start: new Date(min - pad), end: new Date(max + pad), runStartMs: min };
}

/** Coarse→fine ladder, in the same order the library's own `pickGanttTimeUnit` walks it. */
const UNIT_LADDER: GanttTimeUnit[] = [
  "millisecond",
  "second",
  "minute",
  "hour",
  "day",
  "week",
  "month",
  "quarter",
];

/** Target width of ONE timescale tick at the selected unit — the zoom-in width driver. */
const PX_PER_TICK = 72;

/** Left pane = Step | t+ | Dur. MUST stay equal to the `ganttColumns` widths' sum. */
const LABEL_PANE_WIDTH = 352;

/** Floor for the bars canvas so a very narrow pane still renders a usable axis. */
const MIN_CANVAS_WIDTH = 360;

/**
 * The units the toolbar offers: a window of the ladder around the run's auto-picked unit (two finer,
 * one coarser). The finer entries are the zoom-IN direction; the coarser one zooms back out and is
 * clamped to fit-to-pane. Anchoring on `auto` is what replaces the library's default calendar-only
 * `["day","week","month","quarter"]`, which is meaningless for a seconds-long agent run.
 */
export function offeredViewModes(auto: GanttTimeUnit): GanttTimeUnit[] {
  const i = UNIT_LADDER.indexOf(auto);
  if (i < 0) return UNIT_LADDER.slice(0, 4);
  return UNIT_LADDER.slice(Math.max(0, i - 2), i + 2);
}

/**
 * The bars-canvas width for a given tick unit: about `PX_PER_TICK` per tick, but never narrower than
 * the pane (so the default view fits with no horizontal scroll) and never wider than the library's own
 * span-derived ceiling (`computeGanttZoomBounds().max` × span-in-days — without it, `millisecond` over
 * a 40 s run would ask for a ~2.9 M px canvas).
 */
export function resolveCanvasWidth(args: {
  spanMs: number;
  unit: GanttTimeUnit;
  fitWidth: number;
  maxPxPerDay: number;
}): number {
  const { spanMs, unit, fitWidth, maxPxPerDay } = args;
  const tickWidth = (spanMs / GANTT_UNIT_MS[unit]) * PX_PER_TICK;
  const maxWidth = Math.max(fitWidth, (maxPxPerDay * spanMs) / GANTT_UNIT_MS.day);
  return Math.round(Math.max(fitWidth, Math.min(tickWidth, maxWidth)));
}

export function RunGantt({ stream }: RunGanttProps) {
  const tasks = useMemo(() => buildTasks(stream.steps), [stream.steps]);
  const domain = useMemo(() => buildDomain(tasks), [tasks]);

  // `Gantt.Body` needs a concrete `canvasWidth` (px) — there is no responsive default. Measure the
  // pane so the timeline fills it, with a fallback width before the first measure lands.
  const containerRef = useRef<HTMLDivElement>(null);
  const [paneWidth, setPaneWidth] = useState(LABEL_PANE_WIDTH + 720);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setPaneWidth(Math.round(entry.contentRect.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Two operator overrides over the auto-picked scale: an explicit toolbar chip, and the continuous
  // Ctrl/⌘ + wheel zoom. `null` on either means "follow the run's own span", so a still-streaming run
  // keeps re-picking its unit until the operator takes over.
  const [pickedUnit, setPickedUnit] = useState<GanttTimeUnit | null>(null);
  const [zoomPxPerDay, setZoomPxPerDay] = useState<number | null>(null);

  const handleViewModeChange = useCallback((mode: GanttTimeUnit) => {
    setPickedUnit(mode);
    // A chip press is authoritative: drop any wheel zoom so the canvas always visibly re-fits.
    setZoomPxPerDay(null);
  }, []);
  const handleZoom = useCallback((next: number) => setZoomPxPerDay(next), []);

  const runStartMs = domain?.runStartMs ?? 0;
  const ganttColumns = useMemo<GanttColumn[]>(
    () => [
      { id: "name", header: "Step", width: 200 },
      {
        id: "offset",
        header: "t+",
        width: 76,
        align: "end",
        tabularNums: true,
        cell: (task) => formatDuration(task.start.getTime() - runStartMs),
      },
      {
        id: "duration",
        header: "Dur",
        width: 76,
        align: "end",
        tabularNums: true,
        cell: (task) => formatDuration(task.end.getTime() - task.start.getTime()),
      },
    ],
    [runStartMs],
  );

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

  const spanMs = domain.end.getTime() - domain.start.getTime();
  const spanDays = spanMs / GANTT_UNIT_MS.day;
  const autoUnit = pickGanttTimeUnit(spanMs);
  const unit = pickedUnit ?? autoUnit;

  const fitWidth = Math.max(MIN_CANVAS_WIDTH, paneWidth - LABEL_PANE_WIDTH);
  const { max: maxPxPerDay } = computeGanttZoomBounds({
    domainStart: domain.start,
    domainEnd: domain.end,
    viewportWidth: fitWidth,
  });
  const maxCanvasWidth = Math.max(fitWidth, maxPxPerDay * spanDays);
  const canvasWidth =
    zoomPxPerDay === null
      ? resolveCanvasWidth({ spanMs, unit, fitWidth, maxPxPerDay })
      : Math.round(Math.min(Math.max(zoomPxPerDay * spanDays, fitWidth), maxCanvasWidth));

  return (
    <div ref={containerRef} className="h-full min-h-0 w-full overflow-hidden">
      <Gantt
        tasks={tasks}
        columns={ganttColumns}
        labelColumnWidth={LABEL_PANE_WIDTH}
        viewMode={unit}
        viewModes={offeredViewModes(autoUnit)}
        onViewModeChange={handleViewModeChange}
        className="h-full min-h-0"
      >
        <Gantt.Toolbar />
        <Gantt.Body
          className="min-h-0 flex-1"
          labelColumnWidth={LABEL_PANE_WIDTH}
          domainStart={domain.start}
          domainEnd={domain.end}
          canvasWidth={canvasWidth}
          pxPerDay={canvasWidth / spanDays}
          onZoom={handleZoom}
          zoomBounds={{
            minPixelsPerDay: fitWidth / spanDays,
            maxPixelsPerDay: Math.max(fitWidth / spanDays, maxPxPerDay),
          }}
          maxHeight="100%"
        />
      </Gantt>
    </div>
  );
}
