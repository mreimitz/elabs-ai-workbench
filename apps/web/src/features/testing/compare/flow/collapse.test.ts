import { describe, expect, test } from "vitest";
import { collapseColumns, groupIdForColumn } from "./collapse";
import type { AlignedColumn, FlowNode } from "./flow-types";

// Small synthetic AlignedColumn fixtures — mirrors the fixture style in align.test.ts, but builds
// AlignedColumn[] directly (collapseColumns operates on already-aligned columns, not raw lanes).

function tool(id: string, name: string, status: "ok" | "error" = "ok"): FlowNode {
  return {
    id,
    kind: "tool",
    turnIndex: 0,
    alignKey: `tool:${name}:`,
    title: name,
    toolName: name,
    status,
  };
}

/** A `node` column where every lane is present with the SAME outcome — collapsible. */
function unchangedCol(id: string): AlignedColumn {
  return {
    id,
    kind: "node",
    turnIndex: 0,
    cells: [tool(`${id}-a`, "search"), tool(`${id}-b`, "search")],
  };
}

/** A `node` column where every lane is present but the outcome (status) differs — "changed". */
function changedCol(id: string): AlignedColumn {
  return {
    id,
    kind: "node",
    turnIndex: 0,
    cells: [tool(`${id}-a`, "create", "error"), tool(`${id}-b`, "create", "ok")],
  };
}

/** A `node` column present in only one lane — a "gap". */
function gapCol(id: string): AlignedColumn {
  return { id, kind: "node", turnIndex: 0, cells: [tool(`${id}-a`, "extra"), null] };
}

function turnHeaderCol(id: string): AlignedColumn {
  return { id, kind: "turn-header", turnIndex: 0, present: [true, true] };
}

/** A `preamble` column whose cells would read as "unchanged" if the kind check were skipped. */
function preambleCol(id = "pre"): AlignedColumn {
  return {
    id,
    kind: "preamble",
    turnIndex: -1,
    cells: [tool(`${id}-a`, "pre"), tool(`${id}-b`, "pre")],
  };
}

describe("collapseColumns — default view (changesOnly: false)", () => {
  test("a maximal run of >= 3 consecutive all-unchanged node columns collapses into one group", () => {
    const columns = [unchangedCol("c0"), unchangedCol("c1"), unchangedCol("c2")];
    const rows = collapseColumns(columns, { changesOnly: false });
    expect(rows).toEqual([{ type: "group", id: "grp:c0:c2", columns, count: 3 }]);
  });

  test("a run of exactly 1 stays an ordinary column row", () => {
    const columns = [unchangedCol("c0")];
    const rows = collapseColumns(columns, { changesOnly: false });
    expect(rows).toEqual([{ type: "column", column: columns[0] }]);
  });

  test("a run of 2 stays as ordinary column rows (below the default minRun of 3)", () => {
    const columns = [unchangedCol("c0"), unchangedCol("c1")];
    const rows = collapseColumns(columns, { changesOnly: false });
    expect(rows).toEqual([
      { type: "column", column: columns[0] },
      { type: "column", column: columns[1] },
    ]);
  });

  test("a longer run (5) still collapses into one group with the right count", () => {
    const columns = [
      unchangedCol("c0"),
      unchangedCol("c1"),
      unchangedCol("c2"),
      unchangedCol("c3"),
      unchangedCol("c4"),
    ];
    const rows = collapseColumns(columns, { changesOnly: false });
    expect(rows).toEqual([{ type: "group", id: "grp:c0:c4", columns, count: 5 }]);
  });
});

describe("collapseColumns — changesOnly: true", () => {
  test("collapses a run of exactly 1 unchanged column", () => {
    const columns = [unchangedCol("c0")];
    const rows = collapseColumns(columns, { changesOnly: true });
    expect(rows).toEqual([{ type: "group", id: "grp:c0:c0", columns, count: 1 }]);
  });

  test("collapses a run of 2 unchanged columns", () => {
    const columns = [unchangedCol("c0"), unchangedCol("c1")];
    const rows = collapseColumns(columns, { changesOnly: true });
    expect(rows).toEqual([{ type: "group", id: "grp:c0:c1", columns, count: 2 }]);
  });
});

describe("what breaks a run", () => {
  test("a turn-header column breaks the run (and is never itself collapsed)", () => {
    const columns = [
      unchangedCol("c0"),
      unchangedCol("c1"),
      unchangedCol("c2"),
      turnHeaderCol("t1h"),
      unchangedCol("c3"),
      unchangedCol("c4"),
      unchangedCol("c5"),
    ];
    const rows = collapseColumns(columns, { changesOnly: false });
    expect(rows.map((row) => row.type)).toEqual(["group", "column", "group"]);
    const first = rows[0]!;
    const middle = rows[1]!;
    const last = rows[2]!;
    expect(first.type === "group" && first.count).toBe(3);
    expect(middle).toEqual({ type: "column", column: columns[3] });
    expect(last.type === "group" && last.count).toBe(3);
  });

  test("a changed (differing-outcome) column breaks the run", () => {
    const columns = [
      unchangedCol("c0"),
      unchangedCol("c1"),
      unchangedCol("c2"),
      changedCol("c3"),
      unchangedCol("c4"),
      unchangedCol("c5"),
      unchangedCol("c6"),
    ];
    const rows = collapseColumns(columns, { changesOnly: false });
    expect(rows.map((row) => row.type)).toEqual(["group", "column", "group"]);
    expect(rows[1]).toEqual({ type: "column", column: columns[3] });
  });

  test("a gap column breaks the run", () => {
    const columns = [
      unchangedCol("c0"),
      unchangedCol("c1"),
      unchangedCol("c2"),
      gapCol("c3"),
      unchangedCol("c4"),
      unchangedCol("c5"),
      unchangedCol("c6"),
    ];
    const rows = collapseColumns(columns, { changesOnly: false });
    expect(rows.map((row) => row.type)).toEqual(["group", "column", "group"]);
    expect(rows[1]).toEqual({ type: "column", column: columns[3] });
  });

  test("a preamble column never collapses, even when changesOnly is true", () => {
    const columns = [preambleCol(), unchangedCol("c0"), unchangedCol("c1"), unchangedCol("c2")];
    const rows = collapseColumns(columns, { changesOnly: true });
    expect(rows[0]).toEqual({ type: "column", column: columns[0] });
    expect(rows[1]).toEqual({
      type: "group",
      id: "grp:c0:c2",
      columns: columns.slice(1),
      count: 3,
    });
  });
});

describe("groupIdForColumn", () => {
  test("returns the containing group id for a member column", () => {
    const columns = [unchangedCol("c0"), unchangedCol("c1"), unchangedCol("c2")];
    const rows = collapseColumns(columns, { changesOnly: false });
    expect(groupIdForColumn(rows, "c1")).toBe("grp:c0:c2");
    expect(groupIdForColumn(rows, "c0")).toBe("grp:c0:c2");
    expect(groupIdForColumn(rows, "c2")).toBe("grp:c0:c2");
  });

  test("returns null for a column that is visible (not collapsed)", () => {
    const columns = [unchangedCol("c0"), unchangedCol("c1")];
    const rows = collapseColumns(columns, { changesOnly: false });
    expect(groupIdForColumn(rows, "c0")).toBeNull();
  });

  test("returns null for an id that doesn't exist in the rows at all", () => {
    const columns = [unchangedCol("c0"), unchangedCol("c1"), unchangedCol("c2")];
    const rows = collapseColumns(columns, { changesOnly: false });
    expect(groupIdForColumn(rows, "nope")).toBeNull();
  });
});
