import { describe, expect, test } from "vitest";
import type { WorkspaceRun } from "../compare-runs";
import { laneResult, laneResults } from "./result";
import type { FlowLane, FlowNode, FlowTurn } from "./flow-types";

// Minimal synthetic FlowLane fixtures. `laneResult` only reads letter/color/run/turns/terminal, so
// `run` is a light stub cast — the identity fields (letter/color/run) pass straight through.

function answerNode(turnIndex: number, text: string, tokens?: number): FlowNode {
  return {
    id: `t${turnIndex}-answer`,
    kind: "answer",
    turnIndex,
    alignKey: `answer@t${turnIndex}`,
    title: "Assistant response",
    subtitle: text.slice(0, 20),
    resultText: text,
    ...(tokens != null ? { tokens } : {}),
  };
}

function toolNode(turnIndex: number, name: string): FlowNode {
  return {
    id: `t${turnIndex}-${name}`,
    kind: "tool",
    turnIndex,
    alignKey: `tool:${name}:`,
    title: name,
    toolName: name,
    status: "ok",
  };
}

function terminalNode(text: string): FlowNode {
  return {
    id: "terminal",
    kind: "error",
    turnIndex: 99,
    alignKey: "terminal:error",
    title: "Run error",
    subtitle: text,
    status: "error",
    resultText: text,
    resultIsError: true,
  };
}

function preambleNode(): FlowNode {
  return {
    id: "pre",
    kind: "preamble",
    turnIndex: -1,
    alignKey: "preamble",
    title: "Session start",
  };
}

function lane(overrides: {
  turns?: FlowTurn[];
  terminal?: FlowNode | null;
  letter?: string;
  color?: string;
}): FlowLane {
  return {
    runIndex: 0,
    letter: overrides.letter ?? "A",
    color: overrides.color ?? "var(--chart-1)",
    isBaseline: true,
    run: { id: "run-1" } as unknown as WorkspaceRun,
    preamble: preambleNode(),
    turns: overrides.turns ?? [],
    terminal: overrides.terminal ?? null,
    skills: [],
  };
}

describe("laneResult — final answer selection", () => {
  test("picks the LAST kind:answer node across multiple turns", () => {
    const turns: FlowTurn[] = [
      { turnIndex: 0, nodes: [toolNode(0, "search"), answerNode(0, "interim thought")] },
      { turnIndex: 1, nodes: [toolNode(1, "build")] },
      { turnIndex: 2, nodes: [answerNode(2, "the final answer", 42)] },
    ];
    const result = laneResult(lane({ turns }));
    expect(result.kind).toBe("answer");
    expect(result.text).toBe("the final answer");
    expect(result.tokens).toBe(42);
  });

  test("carries the run identity (letter/color/run) through", () => {
    const result = laneResult(
      lane({
        letter: "B",
        color: "var(--chart-2)",
        turns: [{ turnIndex: 0, nodes: [answerNode(0, "done")] }],
      }),
    );
    expect(result.letter).toBe("B");
    expect(result.color).toBe("var(--chart-2)");
    expect(result.run.id).toBe("run-1");
  });

  test("omits tokens when the answer node recorded none", () => {
    const result = laneResult(
      lane({ turns: [{ turnIndex: 0, nodes: [answerNode(0, "no usage")] }] }),
    );
    expect(result.kind).toBe("answer");
    expect(result.tokens).toBeUndefined();
  });

  test("prefers the answer even when a terminal block also exists", () => {
    const result = laneResult(
      lane({
        turns: [{ turnIndex: 0, nodes: [answerNode(0, "answered")] }],
        terminal: terminalNode("late error"),
      }),
    );
    expect(result.kind).toBe("answer");
    expect(result.text).toBe("answered");
  });
});

describe("laneResult — terminal fallback", () => {
  test("falls back to the terminal error node when no answer exists", () => {
    const result = laneResult(
      lane({
        turns: [{ turnIndex: 0, nodes: [toolNode(0, "search")] }],
        terminal: terminalNode("guardrail hit"),
      }),
    );
    expect(result.kind).toBe("error");
    expect(result.text).toBe("guardrail hit");
  });
});

describe("laneResult — the none case", () => {
  test("returns none with empty text when there is neither an answer nor a terminal block", () => {
    const result = laneResult(
      lane({ turns: [{ turnIndex: 0, nodes: [toolNode(0, "search")] }], terminal: null }),
    );
    expect(result.kind).toBe("none");
    expect(result.text).toBe("");
    expect(result.tokens).toBeUndefined();
  });

  test("returns none for a lane with no turns and no terminal", () => {
    expect(laneResult(lane({ turns: [], terminal: null })).kind).toBe("none");
  });
});

describe("laneResults — per lane, in order", () => {
  test("maps every lane to its final result, preserving letter order", () => {
    const a = lane({ letter: "A", turns: [{ turnIndex: 0, nodes: [answerNode(0, "A out")] }] });
    const b = lane({ letter: "B", color: "var(--chart-2)", terminal: terminalNode("B failed") });
    const results = laneResults([a, b]);
    expect(results.map((r) => [r.letter, r.kind, r.text])).toEqual([
      ["A", "answer", "A out"],
      ["B", "error", "B failed"],
    ]);
  });
});
