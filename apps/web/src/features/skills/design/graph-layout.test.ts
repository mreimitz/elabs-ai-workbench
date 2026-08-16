import { describe, expect, test } from "vitest";
import type { SkillGraph, SkillGraphEdge, SkillGraphNode } from "@mcp-token-footprint/shared";
import { Position } from "@xyflow/react";
import {
  edgeLabelPosition,
  FIT_MAX_ZOOM,
  FIT_PADDING_RATIO,
  LANE_GAP,
  layoutSkillGraphWithLanes,
  NODE_HEIGHT_ESTIMATE,
  NODE_SOURCE_POSITION,
  NODE_TARGET_POSITION,
  NODE_WIDTH,
  RANK_GAP,
  RANK_STEP,
  READABLE_MIN_ZOOM,
  resolveFitViewport,
  SOURCE_HANDLE_ID,
  TARGET_HANDLE_ID,
} from "./graph-layout";
import { buildFlow } from "./SkillGraphCanvas";

// ── Fixtures (synthetic graphs mirroring the projector's contract) ───────────────────────────────

function anchor(startLine: number) {
  return { headingPath: [], startLine, endLine: startLine + 3 };
}

function section(id: string, line: number, flowId?: string): SkillGraphNode {
  return {
    id,
    kind: "subroutine",
    label: `Section ${id}`,
    anchor: anchor(line),
    source: "inferred",
    ...(flowId ? { flowId } : {}),
  };
}

function gate(id: string, line: number): SkillGraphNode {
  return { id, kind: "gatekeeper", label: `Gate ${id}`, anchor: anchor(line), source: "inferred" };
}

function toolRef(id: string, line: number): SkillGraphNode {
  return {
    id,
    kind: "tool_ref",
    toolName: id,
    label: id,
    anchor: anchor(line),
    source: "inferred",
  };
}

function entry(id: string, line: number): SkillGraphNode {
  return {
    id,
    kind: "entry_point",
    trigger: { type: "command", value: `/${id}` },
    label: `/${id}`,
    anchor: anchor(line),
    source: "annotated",
    flowId: id,
  };
}

function edge(from: string, to: string, extra?: Partial<SkillGraphEdge>): SkillGraphEdge {
  return { id: `${from}->${to}`, from, to, ...extra };
}

function graph(nodes: SkillGraphNode[], edges: SkillGraphEdge[]): SkillGraph {
  return { nodes, edges, warnings: [] };
}

/** A chain of sections s1→s2→s3→s4, with s2 owning two tool_ref accessories (the seeded-graph shape). */
function chainWithAccessories(): SkillGraph {
  return graph(
    [
      section("s1", 1),
      section("s2", 10),
      section("s3", 20),
      section("s4", 30),
      toolRef("t1", 12),
      toolRef("t2", 14),
    ],
    [edge("s1", "s2"), edge("s2", "s3"), edge("s3", "s4"), edge("s2", "t1"), edge("s2", "t2")],
  );
}

const at = (positions: Map<string, { x: number; y: number }>, id: string) => {
  const position = positions.get(id);
  expect(position, `node ${id} must be laid out`).toBeDefined();
  return position as { x: number; y: number };
};

// ── (a) + (c) — left-to-right ranks with a generous, non-overlapping gap ──────────────────────────

describe("layoutSkillGraphWithLanes — LR ranks", () => {
  test("section x advances strictly monotonically, one RANK_STEP per rank, all on row 0", () => {
    const { positions } = layoutSkillGraphWithLanes(chainWithAccessories());
    const xs = ["s1", "s2", "s3", "s4"].map((id) => at(positions, id).x);
    for (let i = 1; i < xs.length; i += 1) {
      expect(xs[i]).toBeGreaterThan(xs[i - 1] as number);
      expect((xs[i] as number) - (xs[i - 1] as number)).toBe(RANK_STEP);
    }
    for (const id of ["s1", "s2", "s3", "s4"]) {
      expect(at(positions, id).y).toBe(0);
    }
  });

  test("rank separation leaves at least 180px clear between node boxes (WP 7.2)", () => {
    expect(RANK_GAP).toBeGreaterThanOrEqual(180);
    expect(RANK_STEP - NODE_WIDTH).toBe(RANK_GAP);
    const { positions } = layoutSkillGraphWithLanes(chainWithAccessories());
    const xs = ["s1", "s2", "s3", "s4"].map((id) => at(positions, id).x);
    for (let i = 1; i < xs.length; i += 1) {
      expect((xs[i] as number) - (xs[i - 1] as number) - NODE_WIDTH).toBeGreaterThanOrEqual(180);
    }
  });

  test("deterministic: the same graph lays out identically twice", () => {
    const a = layoutSkillGraphWithLanes(chainWithAccessories());
    const b = layoutSkillGraphWithLanes(chainWithAccessories());
    expect(a.positions).toEqual(b.positions);
    expect(a.lanes).toEqual(b.lanes);
  });
});

// ── (d) — accessories: forward column, no vertical overlap within a column ───────────────────────

describe("layoutSkillGraphWithLanes — accessory placement", () => {
  test("an accessory lands in the column AFTER its owning section (edges always flow forward)", () => {
    const { positions } = layoutSkillGraphWithLanes(chainWithAccessories());
    const owner = at(positions, "s2");
    for (const id of ["t1", "t2"]) {
      const accessory = at(positions, id);
      expect(accessory.x).toBe(owner.x + RANK_STEP);
      expect(accessory.y).toBeGreaterThan(0);
    }
  });

  test("no two nodes in the same column overlap vertically (clearance ≥ box + 40px)", () => {
    const { positions } = layoutSkillGraphWithLanes(chainWithAccessories());
    const byColumn = new Map<number, number[]>();
    for (const { x, y } of positions.values()) {
      const list = byColumn.get(x) ?? [];
      list.push(y);
      byColumn.set(x, list);
    }
    for (const ys of byColumn.values()) {
      ys.sort((a, b) => a - b);
      for (let i = 1; i < ys.length; i += 1) {
        expect((ys[i] as number) - (ys[i - 1] as number)).toBeGreaterThanOrEqual(
          NODE_HEIGHT_ESTIMATE + 40,
        );
      }
    }
  });

  test("every node always receives a position (accessory without an owner included)", () => {
    const orphanGraph = graph(
      [section("s1", 1), section("s2", 10), toolRef("stray", 12)],
      [edge("s1", "s2")],
    );
    const { positions } = layoutSkillGraphWithLanes(orphanGraph);
    expect(positions.size).toBe(3);
    const stray = at(positions, "stray");
    // Falls back to the column after its nearest-by-line section — still on an accessory row.
    expect(stray.x).toBe(at(positions, "s2").x + RANK_STEP);
    expect(stray.y).toBeGreaterThan(0);
  });
});

// ── Flow lanes stay stacked and non-overlapping ───────────────────────────────────────────────────

describe("layoutSkillGraphWithLanes — lanes", () => {
  test("a command flow bands below main, offset by at least LANE_GAP", () => {
    const g: SkillGraph = {
      ...graph(
        [section("s1", 1), section("s2", 10), entry("report", 20), section("c1", 22, "report")],
        [edge("s1", "s2"), edge("report", "c1", { flowId: "report" })],
      ),
      flows: [
        { id: "main", label: "Main flow" },
        { id: "report", label: "/report", entryNodeId: "report" },
      ],
    };
    const { positions, lanes } = layoutSkillGraphWithLanes(g);
    expect(lanes.map((lane) => lane.flowId)).toEqual(["main", "report"]);
    expect(lanes[0]?.baseY).toBe(0);
    expect(lanes[1]?.baseY).toBeGreaterThanOrEqual(LANE_GAP);
    expect(at(positions, "report").y).toBe(lanes[1]?.baseY);
    expect(at(positions, "c1").y).toBe(lanes[1]?.baseY);
  });
});

// ── (b) — the canvas contract: side handles on every node, side-bound edges ──────────────────────

describe("buildFlow — LR handle contract (audit SI4)", () => {
  test("every laid-out node carries sourcePosition Right and targetPosition Left", () => {
    expect(NODE_SOURCE_POSITION).toBe(Position.Right);
    expect(NODE_TARGET_POSITION).toBe(Position.Left);
    const { nodes } = buildFlow(chainWithAccessories());
    const brandNodes = nodes.filter((node) => node.type === "brand");
    expect(brandNodes.length).toBe(6);
    for (const node of brandNodes) {
      expect(node.sourcePosition).toBe(Position.Right);
      expect(node.targetPosition).toBe(Position.Left);
    }
  });

  test("every edge binds explicitly to the side handles — never a top/bottom attachment", () => {
    const { edges, droppedEdges } = buildFlow(chainWithAccessories());
    expect(droppedEdges).toBe(0);
    expect(edges.length).toBe(5);
    for (const flowEdge of edges) {
      expect(flowEdge.type).toBe("brand");
      expect(flowEdge.sourceHandle).toBe(SOURCE_HANDLE_ID);
      expect(flowEdge.targetHandle).toBe(TARGET_HANDLE_ID);
    }
  });
});

// ── Condition labels track the LR wire ────────────────────────────────────────────────────────────

describe("edgeLabelPosition", () => {
  const positions = new Map([
    ["a", { x: 0, y: 0 }],
    ["b", { x: RANK_STEP, y: 0 }],
    ["far", { x: RANK_STEP * 3, y: 0 }],
    ["acc", { x: RANK_STEP, y: 120 }],
  ]);

  test("adjacent same-row edge labels sit on the wire inside the rank gap", () => {
    const label = edgeLabelPosition(positions, edge("a", "b", { condition: "ok" }), 0, 1);
    expect(label).toEqual({ x: RANK_STEP / 2, y: 28 });
  });

  test("rank-skipping same-row edge labels lift above the row (matching the skip arc)", () => {
    const label = edgeLabelPosition(positions, edge("a", "far", { condition: "retry" }), 0, 1);
    expect(label?.y).toBeLessThan(0);
  });

  test("accessory-drop edge labels keep the plain midpoint", () => {
    const label = edgeLabelPosition(positions, edge("a", "acc", { condition: "uses" }), 0, 1);
    expect(label).toEqual({ x: RANK_STEP / 2, y: 60 });
  });

  test("an edge citing an unknown node yields no label position", () => {
    expect(edgeLabelPosition(positions, edge("a", "ghost"), 0, 1)).toBeUndefined();
  });
});

// ── Fit viewport: readable zoom, first rank always visible ────────────────────────────────────────

describe("resolveFitViewport", () => {
  test("a small graph centers at natural size (zoom capped at FIT_MAX_ZOOM)", () => {
    const viewport = resolveFitViewport({ x: 0, y: 0, width: 400, height: 200 }, 1000, 600);
    expect(viewport).toBeDefined();
    expect(viewport?.zoom).toBe(FIT_MAX_ZOOM);
    // Centered on both axes: (pane − graph·zoom) / 2.
    expect(viewport?.x).toBeCloseTo((1000 - 400 * FIT_MAX_ZOOM) / 2);
    expect(viewport?.y).toBeCloseTo((600 - 200 * FIT_MAX_ZOOM) / 2);
  });

  test("an over-wide graph clamps at the readability floor and anchors the FIRST rank on-screen", () => {
    const viewport = resolveFitViewport({ x: 0, y: -46, width: 4000, height: 300 }, 1000, 600);
    expect(viewport?.zoom).toBe(READABLE_MIN_ZOOM);
    // Left-anchored one padding in — rank 0 (bounds.x = 0) renders at screen x = padX > 0.
    expect(viewport?.x).toBeCloseTo(1000 * FIT_PADDING_RATIO);
    // Vertical still fits ⇒ centered, and the topmost element (y = −46) stays on-screen.
    const topOnScreen = (viewport?.y ?? 0) + -46 * (viewport?.zoom ?? 0);
    expect(topOnScreen).toBeGreaterThanOrEqual(0);
  });

  test("an over-tall graph anchors its top row one padding in (nothing clipped at the top)", () => {
    const viewport = resolveFitViewport({ x: 0, y: -46, width: 900, height: 3000 }, 1000, 600);
    expect(viewport?.zoom).toBe(READABLE_MIN_ZOOM);
    const topOnScreen = (viewport?.y ?? 0) + -46 * (viewport?.zoom ?? 0);
    expect(topOnScreen).toBeCloseTo(600 * FIT_PADDING_RATIO);
  });

  test("returns undefined while the pane or nodes are unmeasured", () => {
    expect(resolveFitViewport({ x: 0, y: 0, width: 0, height: 0 }, 1000, 600)).toBeUndefined();
    expect(resolveFitViewport({ x: 0, y: 0, width: 100, height: 100 }, 0, 0)).toBeUndefined();
  });

  test("readability floor keeps the 14px FlowNode title at ≥ 11px apparent size", () => {
    expect(14 * READABLE_MIN_ZOOM).toBeGreaterThanOrEqual(11);
  });
});

// ── Gatekeeper branches (mixed section kinds) still lay out on the spine ─────────────────────────

describe("layoutSkillGraphWithLanes — gatekeepers", () => {
  test("a gatekeeper occupies its own rank; branch targets stay on row 0", () => {
    const g = graph(
      [section("s1", 1), gate("g1", 10), section("s2", 20), section("s3", 30)],
      [
        edge("s1", "g1"),
        edge("g1", "s2", { condition: "pass" }),
        edge("g1", "s3", { condition: "fail" }),
        edge("s2", "s3"),
      ],
    );
    const { positions } = layoutSkillGraphWithLanes(g);
    const xs = ["s1", "g1", "s2", "s3"].map((id) => at(positions, id).x);
    for (let i = 1; i < xs.length; i += 1) {
      expect(xs[i]).toBeGreaterThan(xs[i - 1] as number);
    }
    for (const id of ["s1", "g1", "s2", "s3"]) {
      expect(at(positions, id).y).toBe(0);
    }
  });
});
