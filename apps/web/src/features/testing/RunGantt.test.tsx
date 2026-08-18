import type { ReactNode } from "react";
import type { RunStep } from "@mcp-token-footprint/shared";
import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

// `@elabs-ai/components-charts`' real `Gantt` transitively pulls `@visx/gradient`, whose ESM export map Vitest/jsdom
// can't resolve (a pre-existing environment limitation — see the SAME posture in every
// `apps/web/src/features/dashboard/testing/*Panel.test.tsx` and `DashboardView.test.tsx`, which all
// stub `@elabs-ai/components-charts` rather than fight it). The stub renders each `GanttTask`'s `name` + `parentId`
// as plain, assertable DOM — enough to prove the NESTING (WP 3.2's `parentId` wiring) without needing
// the real chart's internals.
type GanttTaskLike = { id: string; name: ReactNode; parentId?: string; dependencies?: string[] };
/** Records the scale props the component drives, so a test can assert the unit ladder it offers. */
const ganttProps: { viewMode?: string; viewModes?: string[] } = {};
vi.mock("@elabs-ai/components-charts", () => {
  // Faithful re-implementations of the three pure helpers `RunGantt` imports from the barrel. They
  // are plain arithmetic (no React, no @visx), so mirroring them here keeps the stub honest without
  // importing the real module — see the mock rationale above.
  const GANTT_UNIT_MS: Record<string, number> = {
    millisecond: 1,
    second: 1_000,
    minute: 60_000,
    hour: 3_600_000,
    day: 86_400_000,
    week: 604_800_000,
    month: 2_592_000_000,
    quarter: 7_776_000_000,
  };
  const LADDER = [
    "millisecond",
    "second",
    "minute",
    "hour",
    "day",
    "week",
    "month",
    "quarter",
  ] as const;
  function pickGanttTimeUnit(spanMs: number): string {
    for (const u of LADDER) if (spanMs / GANTT_UNIT_MS[u]! <= 40) return u;
    return "quarter";
  }
  function computeGanttZoomBounds(args: {
    domainStart: Date;
    domainEnd: Date;
    viewportWidth?: number;
  }): { min: number; max: number } {
    const viewportWidth = args.viewportWidth ?? 1200;
    const spanDays =
      (args.domainEnd.getTime() - args.domainStart.getTime()) / GANTT_UNIT_MS.day!;
    if (!(spanDays > 0)) return { min: 2, max: 200 };
    return {
      min: Math.min(2, viewportWidth / spanDays),
      max: Math.max(200, (viewportWidth * 20) / spanDays),
    };
  }

  function Gantt({
    tasks,
    children,
    viewMode,
    viewModes,
  }: {
    tasks: GanttTaskLike[];
    children?: ReactNode;
    viewMode?: string;
    viewModes?: string[];
  }) {
    ganttProps.viewMode = viewMode;
    ganttProps.viewModes = viewModes;
    return (
      <div data-testid="gantt">
        {tasks.map((t) => (
          <div key={t.id} data-testid={`gantt-task-${t.id}`} data-parent-id={t.parentId ?? ""}>
            {t.name}
          </div>
        ))}
        {children}
      </div>
    );
  }
  Gantt.Toolbar = () => null;
  Gantt.Body = () => null;
  return { Gantt, GANTT_UNIT_MS, pickGanttTimeUnit, computeGanttZoomBounds };
});

import { buildTasks, offeredViewModes, resolveCanvasWidth, RunGantt } from "./RunGantt";
import type { RunStreamState } from "./use-run-stream";

function step(over: Partial<RunStep> & Pick<RunStep, "id" | "type">): RunStep {
  return {
    runId: "run",
    index: 0,
    label: over.type,
    status: "ok",
    profileTokens: {},
    payload: {},
    ...over,
  } as RunStep;
}

function streamOf(steps: RunStep[]): RunStreamState {
  return {
    status: "completed",
    phase: null,
    queuePosition: null,
    phaseDeadlineAt: null,
    ratingState: null,
    steps,
    kpis: null,
    timeline: [],
    deltas: { text: "", reasoning: "" },
    error: null,
  } as unknown as RunStreamState;
}

describe("buildTasks — flat legacy runs are BYTE-STABLE (WP 3.2 acceptance 1)", () => {
  test("a run with no tool_io children builds the SAME task set as before (llm_response + tool_call bars only)", () => {
    const llm = step({
      id: "llm-1",
      index: 0,
      type: "llm_response",
      turnIndex: 0,
      status: "ok",
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: "2026-01-01T00:00:01.000Z",
    });
    const mcp = step({
      id: "run:mcp:0",
      index: 1,
      type: "tool_call",
      toolName: "search",
      status: "ok",
      startedAt: "2026-01-01T00:00:01.000Z",
      endedAt: "2026-01-01T00:00:01.200Z",
      payload: { toolCallId: "c1" },
    });

    const tasks = buildTasks([llm, mcp]);

    expect(tasks).toHaveLength(2);
    expect(tasks.map((t) => t.id)).toEqual(["llm-1", "run:mcp:0"]);
    // Neither task carries a parentId — flat, exactly as before this WP.
    expect(tasks.every((t) => t.parentId === undefined)).toBe(true);
    // No dependency arrows: row order already carries request → tools → response, and at run scale
    // the arrows were long curves over near-zero-width bars.
    expect(tasks.every((t) => t.dependencies === undefined)).toBe(true);
  });
});

describe("buildTasks — nested tool_io swimlanes (WP 3.2 acceptance 1)", () => {
  test("a timed tool_io child nests under its parent tool_call task via parentId", () => {
    const mcp = step({
      id: "run:mcp:0",
      index: 0,
      type: "tool_call",
      toolName: "search",
      status: "ok",
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: "2026-01-01T00:00:01.000Z",
      payload: { toolCallId: "c1" },
    });
    const io = step({
      id: "run:mcp:0:io",
      index: 1,
      type: "context_event",
      spanKind: "tool_io",
      parentStepId: "run:mcp:0",
      label: "search · MCP I/O",
      status: "ok",
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: "2026-01-01T00:00:01.000Z",
    });

    const tasks = buildTasks([mcp, io]);

    expect(tasks).toHaveLength(2);
    const parent = tasks.find((t) => t.id === "run:mcp:0")!;
    const child = tasks.find((t) => t.id === "run:mcp:0:io")!;
    expect(parent.parentId).toBeUndefined();
    expect(child.parentId).toBe("run:mcp:0");
    expect(child.status).toBe("success"); // reuses toolStatus — the SAME semantic rule as its parent
  });

  test("an error tool_io child maps to the error status, same rule as a failed tool_call", () => {
    const mcp = step({
      id: "run:mcp:0",
      index: 0,
      type: "tool_call",
      toolName: "search",
      status: "error",
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: "2026-01-01T00:00:01.000Z",
      payload: { toolCallId: "c1" },
    });
    const io = step({
      id: "run:mcp:0:io",
      index: 1,
      type: "context_event",
      spanKind: "tool_io",
      parentStepId: "run:mcp:0",
      status: "error",
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: "2026-01-01T00:00:01.000Z",
    });
    const tasks = buildTasks([mcp, io]);
    const child = tasks.find((t) => t.id === "run:mcp:0:io")!;
    expect(child.status).toBe("error");
  });

  test("a tool_io child whose parent was dropped (never happens in practice) is defensively skipped, never a dangling bar", () => {
    const io = step({
      id: "orphan:io",
      index: 0,
      type: "context_event",
      spanKind: "tool_io",
      parentStepId: "does-not-exist",
      status: "ok",
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: "2026-01-01T00:00:01.000Z",
    });
    const tasks = buildTasks([io]);
    expect(tasks).toHaveLength(0);
  });

  test("an UNTIMED tool_io step (no startedAt/endedAt) is excluded like every other untimed step", () => {
    const mcp = step({
      id: "run:mcp:0",
      index: 0,
      type: "tool_call",
      toolName: "search",
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: "2026-01-01T00:00:01.000Z",
      payload: { toolCallId: "c1" },
    });
    const io = step({
      id: "run:mcp:0:io",
      index: 1,
      type: "context_event",
      spanKind: "tool_io",
      parentStepId: "run:mcp:0",
      // no startedAt/endedAt
    });
    const tasks = buildTasks([mcp, io]);
    expect(tasks.map((t) => t.id)).toEqual(["run:mcp:0"]);
  });
});

describe("RunGantt component", () => {
  test("renders an EmptyState when no step carries timing (flat legacy, unaffected by this WP)", () => {
    const steps = [step({ id: "s0", index: 0, type: "user_message" })];
    render(<RunGantt stream={streamOf(steps)} />);
    expect(screen.getByText("No timeline yet")).toBeInTheDocument();
  });

  test("renders both the parent tool_call bar and its nested tool_io child, with the child's parentId wired to the parent's task id", () => {
    const mcp = step({
      id: "run:mcp:0",
      index: 0,
      type: "tool_call",
      toolName: "search",
      status: "ok",
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: "2026-01-01T00:00:01.000Z",
      payload: { toolCallId: "c1" },
    });
    const io = step({
      id: "run:mcp:0:io",
      index: 1,
      type: "context_event",
      spanKind: "tool_io",
      parentStepId: "run:mcp:0",
      label: "search · MCP I/O",
      status: "ok",
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: "2026-01-01T00:00:01.000Z",
    });
    render(<RunGantt stream={streamOf([mcp, io])} />);

    expect(screen.getByText("search")).toBeInTheDocument();
    expect(screen.getByText("search · MCP I/O")).toBeInTheDocument();
    const childTask = screen.getByTestId("gantt-task-run:mcp:0:io");
    expect(childTask.getAttribute("data-parent-id")).toBe("run:mcp:0");
    const parentTask = screen.getByTestId("gantt-task-run:mcp:0");
    expect(parentTask.getAttribute("data-parent-id")).toBe("");
  });
});

describe("offeredViewModes — the toolbar offers SUB-DAY units, not the calendar defaults", () => {
  test("a seconds-long run offers millisecond | second | minute (never day/week/month/quarter)", () => {
    expect(offeredViewModes("second")).toEqual(["millisecond", "second", "minute"]);
  });

  test("mid-ladder units get the full window: two finer + the unit + one coarser", () => {
    expect(offeredViewModes("minute")).toEqual(["millisecond", "second", "minute", "hour"]);
    expect(offeredViewModes("hour")).toEqual(["second", "minute", "hour", "day"]);
  });

  test("the finest unit clamps to the ladder start rather than producing a short/empty window", () => {
    expect(offeredViewModes("millisecond")).toEqual(["millisecond", "second"]);
  });

  test("the coarsest unit has no coarser neighbour, so the window is the two finer units + itself", () => {
    expect(offeredViewModes("quarter")).toEqual(["week", "month", "quarter"]);
  });
});

/** The library's own span-derived px/day ceiling: max(200, viewportWidth × 20 / spanDays). */
function computeMaxPxPerDay(viewportWidth: number, spanMs: number): number {
  const spanDays = spanMs / 86_400_000;
  return Math.max(200, (viewportWidth * 20) / spanDays);
}

describe("resolveCanvasWidth — the chip is a REAL zoom, fit-to-pane by default", () => {
  const SPAN_40S = 40_000;
  // A generous ceiling so these cases exercise the tick/fit arms, not the clamp.
  const ROOMY_MAX_PX_PER_DAY = 20 * 86_400_000;

  test("a unit COARSER than the pane can show clamps up to fit — no horizontal scroll", () => {
    // 40 s at minute granularity = 0.67 ticks ≈ 48 px, far under the 900 px pane.
    const width = resolveCanvasWidth({
      spanMs: SPAN_40S,
      unit: "minute",
      fitWidth: 900,
      maxPxPerDay: ROOMY_MAX_PX_PER_DAY,
    });
    expect(width).toBe(900);
  });

  test("a FINER unit widens the canvas past the pane — that widening IS the zoom", () => {
    // 40 s at second granularity = 40 ticks × 72 px = 2880 px against a 900 px pane.
    const width = resolveCanvasWidth({
      spanMs: SPAN_40S,
      unit: "second",
      fitWidth: 900,
      maxPxPerDay: ROOMY_MAX_PX_PER_DAY,
    });
    expect(width).toBe(2880);
    expect(width).toBeGreaterThan(900);
  });

  test("millisecond over a 40 s run clamps to the library ceiling, not ~2.9M px", () => {
    // Unclamped this would be 40_000 ticks × 72 px. The ceiling is maxPxPerDay × span-in-days.
    const maxPxPerDay = computeMaxPxPerDay(900, SPAN_40S);
    const width = resolveCanvasWidth({
      spanMs: SPAN_40S,
      unit: "millisecond",
      fitWidth: 900,
      maxPxPerDay,
    });
    expect(width).toBe(Math.round((maxPxPerDay * SPAN_40S) / 86_400_000));
    expect(width).toBeLessThan(40_000 * 72);
    expect(width).toBeGreaterThan(900);
  });
});

describe("RunGantt — scale wiring (the run is seconds long, not days)", () => {
  function timedRun(endedAt: string): RunStep[] {
    return [
      step({
        id: "llm-1",
        index: 0,
        type: "llm_response",
        turnIndex: 0,
        status: "ok",
        startedAt: "2026-01-01T00:00:00.000Z",
        endedAt,
      }),
    ];
  }

  test("a one-second run drives the SECOND unit and offers a sub-day ladder", () => {
    render(<RunGantt stream={streamOf(timedRun("2026-01-01T00:00:01.000Z"))} />);
    expect(ganttProps.viewMode).toBe("second");
    expect(ganttProps.viewModes).toEqual(["millisecond", "second", "minute"]);
    // The regression this replaces: the old local picker returned "day" for anything under 6 h,
    // whose [week, day] timescale has zero ticks inside a one-second domain.
    expect(ganttProps.viewModes).not.toContain("day");
  });

  test("a half-hour run steps up to the MINUTE unit", () => {
    render(<RunGantt stream={streamOf(timedRun("2026-01-01T00:30:00.000Z"))} />);
    expect(ganttProps.viewMode).toBe("minute");
    expect(ganttProps.viewModes).toEqual(["millisecond", "second", "minute", "hour"]);
  });
});
