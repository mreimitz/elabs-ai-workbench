import type { RunStep } from "@mcp-token-footprint/shared";
import { describe, expect, test } from "vitest";
import {
  buildStepTree,
  childrenByParentId,
  defaultCollapsedStepIds,
  expandableStepIds,
  hasStepHierarchy,
} from "./step-tree";
import { dedupeToolSteps } from "./dedupe-tool-steps";

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

describe("hasStepHierarchy", () => {
  test("false for a flat run (no step carries parentStepId)", () => {
    const steps = [
      step({ id: "s0", index: 0, type: "user_message" }),
      step({ id: "s1", index: 1, type: "llm_response" }),
    ];
    expect(hasStepHierarchy(steps)).toBe(false);
  });

  test("true once any step carries parentStepId", () => {
    const steps = [
      step({ id: "s0", index: 0, type: "context_event" }),
      step({ id: "s1", index: 1, type: "context_event", spanKind: "judge_call", parentStepId: "s0" }),
    ];
    expect(hasStepHierarchy(steps)).toBe(true);
  });
});

describe("buildStepTree", () => {
  test("a flat run (no parentStepId) is all roots, depth 0", () => {
    const steps = [
      step({ id: "s0", index: 0, type: "user_message" }),
      step({ id: "s1", index: 1, type: "llm_response" }),
    ];
    const tree = buildStepTree(steps, steps);
    expect(tree).toHaveLength(2);
    expect(tree.every((n) => n.depth === 0 && n.children.length === 0)).toBe(true);
  });

  test("rating -> judge_call: a simple direct parent link (no reparenting needed)", () => {
    const rating = step({ id: "rating-1", index: 5, type: "context_event", spanKind: "rating" });
    const judge = step({
      id: "judge-1",
      index: 6,
      type: "context_event",
      spanKind: "judge_call",
      parentStepId: "rating-1",
    });
    const tree = buildStepTree([rating, judge], [rating, judge]);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.step.id).toBe("rating-1");
    expect(tree[0]!.children).toHaveLength(1);
    expect(tree[0]!.children[0]!.step.id).toBe("judge-1");
    expect(tree[0]!.children[0]!.depth).toBe(1);
  });

  test("tool_io reparents onto the surviving ENGINE tool_call row after dedupeToolSteps drops the MCP-sink row", () => {
    const engine = step({
      id: "run:step:0",
      index: 0,
      type: "tool_call",
      toolName: "search",
      payload: { toolCallId: "c1", args: { q: "x" } },
    });
    const mcp = step({
      id: "run:mcp:0",
      index: 1,
      type: "tool_call",
      toolName: "search",
      durationMs: 50,
      payload: { toolCallId: "c1", isError: false },
    });
    const io = step({
      id: "run:mcp:0:io",
      index: 2,
      type: "context_event",
      spanKind: "tool_io",
      parentStepId: "run:mcp:0", // points at the MCP-sink row dedupeToolSteps folds away
      toolName: "search",
    });
    const raw = [engine, mcp, io];
    const displayed = dedupeToolSteps(raw); // drops `run:mcp:0`, merges onto `run:step:0`
    expect(displayed.some((s) => s.id === "run:mcp:0")).toBe(false);

    const tree = buildStepTree(displayed, raw);
    // The tool_call (engine) row is a root; the tool_io child hangs off it, NOT orphaned as its own root.
    expect(tree).toHaveLength(1);
    expect(tree[0]!.step.id).toBe("run:step:0");
    expect(tree[0]!.children).toHaveLength(1);
    expect(tree[0]!.children[0]!.step.id).toBe("run:mcp:0:io");
    expect(tree[0]!.children[0]!.depth).toBe(1);
  });

  test("a dangling/unresolvable parentStepId renders the step as a root, never throws", () => {
    const orphan = step({
      id: "s1",
      index: 0,
      type: "context_event",
      spanKind: "tool_io",
      parentStepId: "does-not-exist",
    });
    const tree = buildStepTree([orphan], [orphan]);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.step.id).toBe("s1");
    expect(tree[0]!.depth).toBe(0);
  });
});

describe("defaultCollapsedStepIds", () => {
  test("a rating parent collapses by default", () => {
    const rating = step({ id: "r1", index: 0, type: "context_event", spanKind: "rating" });
    const judge = step({
      id: "j1",
      index: 1,
      type: "context_event",
      spanKind: "judge_call",
      parentStepId: "r1",
    });
    const tree = buildStepTree([rating, judge], [rating, judge]);
    expect(defaultCollapsedStepIds(tree)).toEqual(new Set(["r1"]));
  });

  test("a tool_call parent owning a tool_io child collapses by default", () => {
    const call = step({ id: "c1", index: 0, type: "tool_call", toolName: "fetch" });
    const io = step({
      id: "io1",
      index: 1,
      type: "context_event",
      spanKind: "tool_io",
      parentStepId: "c1",
    });
    const tree = buildStepTree([call, io], [call, io]);
    expect(defaultCollapsedStepIds(tree)).toEqual(new Set(["c1"]));
  });

  test("a leaf (no children) never appears in the default-collapsed set", () => {
    const leaf = step({ id: "l1", index: 0, type: "llm_response" });
    const tree = buildStepTree([leaf], [leaf]);
    expect(defaultCollapsedStepIds(tree).size).toBe(0);
  });
});

describe("expandableStepIds / childrenByParentId", () => {
  test("collects only parents (nodes with children), and their child-id lists", () => {
    const rating = step({ id: "r1", index: 0, type: "context_event", spanKind: "rating" });
    const judge1 = step({
      id: "j1",
      index: 1,
      type: "context_event",
      spanKind: "judge_call",
      parentStepId: "r1",
    });
    const judge2 = step({
      id: "j2",
      index: 2,
      type: "context_event",
      spanKind: "judge_call",
      parentStepId: "r1",
    });
    const leaf = step({ id: "l1", index: 3, type: "llm_response" });
    const tree = buildStepTree([rating, judge1, judge2, leaf], [rating, judge1, judge2, leaf]);

    expect(expandableStepIds(tree)).toEqual(["r1"]);
    expect(childrenByParentId(tree)).toEqual(new Map([["r1", ["j1", "j2"]]]));
  });
});
