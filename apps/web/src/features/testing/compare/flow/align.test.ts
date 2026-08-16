import { describe, expect, test } from "vitest";
import { alignLanes, alignNodeLists, lcsMatches } from "./align";
import { columnCellDiffs, columnDiff, divergenceColumnId } from "./flow-derive";
import type { FlowLane, FlowNode, FlowTurn } from "./flow-types";

function tool(
  run: string,
  turn: number,
  name: string,
  args = "",
  status: "ok" | "error" = "ok",
): FlowNode {
  return {
    id: `${run}-t${turn}-${name}-${args}`,
    kind: "tool",
    turnIndex: turn,
    alignKey: `tool:${name}:${args}`,
    title: name,
    toolName: name,
    status,
  };
}

function lane(runIndex: number, letter: string, turns: FlowTurn[], baseline = false): FlowLane {
  return {
    runIndex,
    letter,
    color: `var(--chart-${runIndex + 1})`,
    isBaseline: baseline,
    // Only the fields the align/diff layer touches matter here.
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

describe("lcsMatches", () => {
  test("matches the longest common subsequence with increasing indices", () => {
    const pairs = lcsMatches(["a", "b", "c", "d"], ["a", "x", "c", "d"]);
    expect(pairs).toEqual([
      [0, 0],
      [2, 2],
      [3, 3],
    ]);
  });

  test("aligns repeated keys by first occurrence", () => {
    const pairs = lcsMatches(["t", "t"], ["t"]);
    expect(pairs).toEqual([[0, 0]]);
  });
});

describe("alignNodeLists — progressive multi-lane alignment", () => {
  test("shared prefix then divergence leaves gaps on both lanes", () => {
    // A: search, create(bad); B: search, get_fields
    const a = [tool("A", 0, "search"), tool("A", 0, "create")];
    const b = [tool("B", 0, "search"), tool("B", 0, "get_fields")];
    const cols = alignNodeLists([a, b], 2, "c", 0);

    // search aligns (col 0 has both); then create is A-only, get_fields is B-only.
    expect(cols).toHaveLength(3);
    expect(cols[0]!.cells!.map((c) => c?.toolName)).toEqual(["search", "search"]);
    expect(cols[1]!.cells!.map((c) => c?.toolName)).toEqual(["create", undefined]);
    expect(cols[2]!.cells!.map((c) => c?.toolName)).toEqual([undefined, "get_fields"]);
  });

  test("three lanes align on the common step", () => {
    const a = [tool("A", 0, "search")];
    const b = [tool("B", 0, "search")];
    const c = [tool("C", 0, "search"), tool("C", 0, "extra")];
    const cols = alignNodeLists([a, b, c], 3, "c", 0);
    expect(cols).toHaveLength(2);
    expect(cols[0]!.cells!.map((x) => x?.toolName)).toEqual(["search", "search", "search"]);
    expect(cols[1]!.cells!.map((x) => x?.toolName)).toEqual([undefined, undefined, "extra"]);
  });
});

describe("alignLanes + diff — the acceptance shape", () => {
  const laneA = lane(
    0,
    "A",
    [
      { turnIndex: 0, nodes: [tool("A", 0, "search")] },
      { turnIndex: 1, nodes: [tool("A", 1, "create", "", "error")] },
    ],
    true,
  );
  const laneB = lane(1, "B", [
    { turnIndex: 0, nodes: [tool("B", 0, "search")] },
    { turnIndex: 1, nodes: [tool("B", 1, "get_fields")] },
  ]);
  const columns = alignLanes([laneA, laneB]);

  test("emits a preamble column, turn headers, and aligned node columns", () => {
    expect(columns[0]!.kind).toBe("preamble");
    const kinds = columns.map((c) => c.kind);
    expect(kinds).toContain("turn-header");
    expect(kinds).toContain("node");
  });

  test("the shared search step is unchanged; the divergent turn-1 tools are add/remove", () => {
    const nodeCols = columns.filter((c) => c.kind === "node");
    const search = nodeCols.find((c) => c.cells!.some((x) => x?.toolName === "search"))!;
    expect(columnDiff(search.cells!)).toBe("unchanged");

    const create = nodeCols.find((c) => c.cells!.some((x) => x?.toolName === "create"))!;
    // create is baseline-exclusive → baseline cell "removed", other lane a gap.
    expect(columnCellDiffs(create.cells!, 0)).toEqual(["removed", "gap"]);

    const getFields = nodeCols.find((c) => c.cells!.some((x) => x?.toolName === "get_fields"))!;
    expect(columnCellDiffs(getFields.cells!, 0)).toEqual(["gap", "added"]);
  });

  test("divergence is flagged at the first differing step", () => {
    const id = divergenceColumnId(columns);
    expect(id).not.toBeNull();
    const col = columns.find((c) => c.id === id)!;
    // the first non-unchanged node column is one of the turn-1 tools
    expect(col.turnIndex).toBe(1);
  });
});

describe("changed outcome — same step, different result", () => {
  test("a tool present in both with differing status is amber on both lanes", () => {
    const a = [tool("A", 0, "create", "x", "error")];
    const b = [tool("B", 0, "create", "x", "ok")];
    const cols = alignNodeLists([a, b], 2, "c", 0);
    expect(cols).toHaveLength(1);
    expect(columnDiff(cols[0]!.cells!)).toBe("changed");
    expect(columnCellDiffs(cols[0]!.cells!, 0)).toEqual(["changed", "changed"]);
  });
});
