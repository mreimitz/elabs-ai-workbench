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
type GanttTaskLike = { id: string; name: ReactNode; parentId?: string };
vi.mock("@elabs-ai/components-charts", () => {
  function Gantt({ tasks, children }: { tasks: GanttTaskLike[]; children?: ReactNode }) {
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
  return { Gantt };
});

import { buildTasks, RunGantt } from "./RunGantt";
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
