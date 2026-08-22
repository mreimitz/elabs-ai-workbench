import { describe, expect, it } from "vitest";
import { applyPositionOverrides, type SkillCanvasNode } from "./SkillGraphCanvas";

// RM-30 WP 7.8 (design decision 5) — the CANVAS half of persisted positions. The database half is
// `apps/api/test/skillflow-box-positions.test.ts`; this pins the merge rule the canvas applies, and
// the one condition the approval attaches to it: an ORPHANED position never breaks the canvas.

function brandNode(id: string, x: number, y: number): SkillCanvasNode {
  return {
    id,
    type: "brand",
    position: { x, y },
    data: { title: id, kind: "Sub-routine" },
  } as SkillCanvasNode;
}

describe("applyPositionOverrides — saved positions merged over automatic layout", () => {
  const autoLaid = [brandNode("a", 0, 0), brandNode("b", 420, 0), brandNode("c", 840, 0)];

  it("moves only the boxes it names, and leaves the rest on the automatic layout", () => {
    const merged = applyPositionOverrides(autoLaid, new Map([["b", { x: 100, y: 300 }]]));
    expect(merged.find((n) => n.id === "b")?.position).toEqual({ x: 100, y: 300 });
    expect(merged.find((n) => n.id === "a")?.position).toEqual({ x: 0, y: 0 });
    expect(merged.find((n) => n.id === "c")?.position).toEqual({ x: 840, y: 0 });
  });

  it("an ORPHANED position — a box the skill no longer has — is simply ignored", () => {
    // The condition the approval attaches to storing positions at all: box identity is derived from
    // the document, so restructuring a skill orphans some rows. That must cost the ONE box its saved
    // place and nothing else — never a stray ghost node, never a crash, never a blank canvas.
    const merged = applyPositionOverrides(
      autoLaid,
      new Map([
        ["b", { x: 100, y: 300 }],
        ["a-heading-that-was-renamed-away", { x: -9999, y: -9999 }],
      ]),
    );
    expect(merged).toHaveLength(3);
    expect(merged.map((n) => n.id).sort()).toEqual(["a", "b", "c"]);
    expect(merged.find((n) => n.id === "b")?.position).toEqual({ x: 100, y: 300 });
  });

  it("an empty arrangement returns the input array itself — the canvas re-seed stays identity-stable", () => {
    expect(applyPositionOverrides(autoLaid, new Map())).toBe(autoLaid);
  });

  it("a position of exactly (0, 0) is honoured, not treated as absent", () => {
    // A real drag can land a box on the origin, and `0` is falsy — the merge must not lose it.
    const merged = applyPositionOverrides(autoLaid, new Map([["c", { x: 0, y: 0 }]]));
    expect(merged.find((n) => n.id === "c")?.position).toEqual({ x: 0, y: 0 });
  });

  it("never mutates the nodes it was handed", () => {
    const input = [brandNode("a", 1, 2)];
    const snapshot = JSON.parse(JSON.stringify(input));
    applyPositionOverrides(input, new Map([["a", { x: 50, y: 60 }]]));
    expect(input).toEqual(snapshot);
  });
});
