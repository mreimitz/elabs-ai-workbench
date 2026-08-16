import { describe, expect, test } from "vitest";
import type { TraceVerdict } from "@mcp-token-footprint/shared";
import { NODE_HEIGHT_ESTIMATE, NODE_WIDTH } from "../design/graph-layout";
import { buildEventNodeIndex, resolveFocusPoint } from "./trace-link";

// WP 7.6 — the pure evidence→canvas linking helpers.

describe("buildEventNodeIndex", () => {
  test("maps each cited evidence idx to its verdict's node", () => {
    const verdicts: TraceVerdict[] = [
      { nodeId: "s1", status: "ok", reason: "executed", evidence: [1, 2] },
      { nodeId: "s2", status: "fracture", reason: "exit 1", evidence: [4] },
    ];
    const index = buildEventNodeIndex(verdicts);
    expect(index.get(1)).toBe("s1");
    expect(index.get(2)).toBe("s1");
    expect(index.get(4)).toBe("s2");
    expect(index.has(0)).toBe(false);
    expect(index.size).toBe(3);
  });

  test("the FIRST verdict citing an idx wins (deterministic tie-break)", () => {
    const verdicts: TraceVerdict[] = [
      { nodeId: "s1", status: "ok", reason: "executed", evidence: [3] },
      { nodeId: "s2", status: "ok", reason: "executed", evidence: [3] },
    ];
    expect(buildEventNodeIndex(verdicts).get(3)).toBe("s1");
  });

  test("skips edge-only verdicts (no nodeId) and handles empty input", () => {
    const verdicts: TraceVerdict[] = [
      { edgeId: "e1", status: "ok", reason: "traversed", evidence: [5] },
      { nodeId: "s1", status: "unvisited", reason: "never visited", evidence: [] },
    ];
    expect(buildEventNodeIndex(verdicts).size).toBe(0);
    expect(buildEventNodeIndex([]).size).toBe(0);
  });
});

describe("resolveFocusPoint", () => {
  test("centers on measured dimensions when React Flow has them", () => {
    const point = resolveFocusPoint({
      position: { x: 100, y: 40 },
      measured: { width: 224, height: 80 },
    });
    expect(point).toEqual({ x: 212, y: 80 });
  });

  test("falls back to the layout constants before measurement", () => {
    const point = resolveFocusPoint({ position: { x: 0, y: 0 } });
    expect(point).toEqual({ x: NODE_WIDTH / 2, y: NODE_HEIGHT_ESTIMATE / 2 });
  });

  test("mixes measured and fallback per-axis", () => {
    const point = resolveFocusPoint({ position: { x: 10, y: 10 }, measured: { width: 100 } });
    expect(point).toEqual({ x: 60, y: 10 + NODE_HEIGHT_ESTIMATE / 2 });
  });
});
