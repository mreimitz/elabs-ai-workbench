import { describe, expect, test } from "vitest";
import type { RunDetail, RunStep } from "@mcp-token-footprint/shared";
import { chartSeriesColor } from "../../../../lib/chart-colors";
import { alignLanes } from "./align";
import { resolveFocusedStep } from "./focus-step";
import type { FlowLane, FlowNode, FlowTurn } from "./flow-types";

function toolNode(run: string, name: string, stepId?: string): FlowNode {
  return {
    id: `${run}-t0-${name}`,
    kind: "tool",
    turnIndex: 0,
    alignKey: `tool:${name}:`,
    title: name,
    toolName: name,
    status: "ok",
    ...(stepId ? { stepId } : {}),
  };
}

function lane(runIndex: number, letter: string, turns: FlowTurn[]): FlowLane {
  return {
    runIndex,
    letter,
    color: chartSeriesColor(runIndex),
    isBaseline: runIndex === 0,
    run: { id: `run-${letter}`, index: runIndex, letter } as unknown as FlowLane["run"],
    preamble: {
      id: `run-${letter}-pre`,
      kind: "preamble",
      turnIndex: -1,
      alignKey: "preamble",
      title: "Session start",
    },
    turns,
    terminal: null,
    skills: [],
  };
}

function step(partial: Partial<RunStep> & { id: string; type: RunStep["type"] }): RunStep {
  return {
    runId: "run-A",
    index: 0,
    label: partial.toolName ?? partial.type,
    status: "ok",
    profileTokens: {},
    ...partial,
  } as RunStep;
}

function detail(steps: RunStep[]): RunDetail {
  return { steps, events: [], skills: [] } as unknown as RunDetail;
}

describe("resolveFocusedStep", () => {
  // Two lanes sharing a turn-0 "search" tool; A's node carries the backing tool_call step id.
  const laneA = lane(0, "A", [{ turnIndex: 0, nodes: [toolNode("A", "search", "call-A")] }]);
  const laneB = lane(1, "B", [{ turnIndex: 0, nodes: [toolNode("B", "search", "call-B")] }]);
  const lanes = [laneA, laneB];
  const columns = alignLanes(lanes);

  const details = new Map<string, RunDetail>([
    [
      "run-A",
      detail([
        step({
          id: "call-A",
          type: "tool_call",
          toolName: "search",
          payload: { toolCallId: "tc-1", args: { q: 1 } },
        }),
        step({
          id: "res-A",
          type: "tool_result",
          toolName: "search",
          payload: { toolCallId: "tc-1", result: "ok" },
        }),
      ]),
    ],
  ]);

  test("resolves a flow-cell token to its lane, node, call step, and paired result step", () => {
    // Find the aligned node column id for the search step.
    const searchCol = columns.find(
      (c) => c.kind === "node" && c.cells?.some((n) => n?.toolName === "search"),
    )!;
    const focus = `A@${searchCol.id}`;

    const resolved = resolveFocusedStep(focus, lanes, columns, details);
    expect(resolved).not.toBeNull();
    expect(resolved!.lane.letter).toBe("A");
    expect(resolved!.node.toolName).toBe("search");
    expect(resolved!.callStep?.id).toBe("call-A");
    expect(resolved!.resultStep?.id).toBe("res-A");
  });

  test("returns null for a non-flow / malformed token", () => {
    expect(resolveFocusedStep(null, lanes, columns, details)).toBeNull();
    expect(resolveFocusedStep("nope", lanes, columns, details)).toBeNull();
  });

  test("returns null when the letter is not in the current set (stale after a chip removal)", () => {
    const searchCol = columns.find((c) => c.kind === "node")!;
    expect(resolveFocusedStep(`Z@${searchCol.id}`, lanes, columns, details)).toBeNull();
  });

  test("returns null when the column no longer exists (realigned away)", () => {
    expect(resolveFocusedStep("A@t9c9", lanes, columns, details)).toBeNull();
  });

  test("resolves the node but no backing steps when the run has no loaded detail", () => {
    const searchCol = columns.find(
      (c) => c.kind === "node" && c.cells?.some((n) => n?.toolName === "search"),
    )!;
    // B has a node but no entry in `details` → node resolves, steps stay null.
    const resolved = resolveFocusedStep(`B@${searchCol.id}`, lanes, columns, details);
    expect(resolved).not.toBeNull();
    expect(resolved!.node.toolName).toBe("search");
    expect(resolved!.callStep).toBeNull();
    expect(resolved!.resultStep).toBeNull();
  });
});
