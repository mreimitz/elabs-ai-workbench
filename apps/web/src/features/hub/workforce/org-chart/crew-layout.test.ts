import type { FlowNodeData } from "@elabs-ai/components-flow";
import type { HubAgentRole } from "@mcp-token-footprint/shared";
import { describe, expect, test } from "vitest";
import {
  buildCrewMemberLayout,
  buildMixedMemberLayout,
  crewMemberNodeId,
  MEMBER_NODE_H,
  MEMBER_NODE_W,
  type MixedMemberBox,
} from "./crew-layout";
import { makeCrew, makeRole } from "./test-fixtures";

const rolesById = (roles: HubAgentRole[]) => new Map(roles.map((r) => [r.id, r]));

describe("buildCrewMemberLayout", () => {
  test("an empty crew yields an empty layout", () => {
    const layout = buildCrewMemberLayout(makeCrew("c1", "pipeline", []), new Map());
    expect(layout.nodes).toEqual([]);
    expect(layout.edges).toEqual([]);
    expect(layout).toMatchObject({ width: 0, height: 0 });
  });

  test("produces one positioned brand node per member with stable ids", () => {
    const roles = [makeRole("a"), makeRole("b"), makeRole("c")];
    const crew = makeCrew("c1", "pipeline", ["a", "b", "c"]);
    const layout = buildCrewMemberLayout(crew, rolesById(roles));

    expect(layout.nodes).toHaveLength(3);
    expect(layout.nodes.map((n) => n.id)).toEqual([
      crewMemberNodeId("c1", 0),
      crewMemberNodeId("c1", 1),
      crewMemberNodeId("c1", 2),
    ]);
    for (const node of layout.nodes) {
      expect(node.type).toBe("brand");
      expect(node.draggable).toBe(false);
      expect(node.connectable).toBe(false);
      expect(node.data.handles).toBeDefined(); // FLOW_ALL_SIDE_HANDLES → smart edges pick facing sides
      expect(Number.isFinite(node.position.x)).toBe(true);
      expect(Number.isFinite(node.position.y)).toBe(true);
    }
  });

  test("normalizes the crew bounding box to a 0,0 origin and reports a positive size", () => {
    const roles = [makeRole("a"), makeRole("b")];
    const layout = buildCrewMemberLayout(makeCrew("c1", "pipeline", ["a", "b"]), rolesById(roles));
    const minX = Math.min(...layout.nodes.map((n) => n.position.x));
    const minY = Math.min(...layout.nodes.map((n) => n.position.y));
    expect(minX).toBe(0);
    expect(minY).toBe(0);
    expect(layout.width).toBeGreaterThanOrEqual(MEMBER_NODE_W);
    expect(layout.height).toBeGreaterThanOrEqual(MEMBER_NODE_H);
  });

  test("edges follow the topology (pipeline chain) and carry the crew id namespace + arrowheads", () => {
    const roles = [makeRole("a"), makeRole("b"), makeRole("c")];
    const layout = buildCrewMemberLayout(makeCrew("c1", "pipeline", ["a", "b", "c"]), rolesById(roles));
    expect(layout.edges).toHaveLength(2);
    expect(layout.edges.map((e) => `${e.source}->${e.target}`)).toEqual([
      `${crewMemberNodeId("c1", 0)}->${crewMemberNodeId("c1", 1)}`,
      `${crewMemberNodeId("c1", 1)}->${crewMemberNodeId("c1", 2)}`,
    ]);
    for (const edge of layout.edges) {
      expect(edge.type).toBe("smart");
      expect(edge.markerEnd).toBeDefined(); // directed pipeline edges get an arrowhead
      expect(edge.id.startsWith("c1::")).toBe(true);
    }
  });

  // hub-fixes WP4.1 (RC6.1): debate's intra-crew edges are now a directed order chain, the SAME shape
  // as pipeline, matching the mission board's real execution order — no longer the old undirected
  // "facing pair" depiction. See `../topology-edges.ts`'s `buildCrewTopologyEdges`.
  test("debate edges are DIRECTED — the same order-chain shape as pipeline, with an arrowhead", () => {
    const roles = [makeRole("a"), makeRole("b")];
    const layout = buildCrewMemberLayout(makeCrew("c1", "debate", ["a", "b"]), rolesById(roles));
    expect(layout.edges).toHaveLength(1);
    expect(layout.edges[0]!.markerEnd).toBeDefined();
  });

  test("node title prefers the persona displayName; subtitle shows the job title when a persona is set", () => {
    const roles = [makeRole("a", { name: "Researcher", displayName: "Nova" })];
    const layout = buildCrewMemberLayout(makeCrew("c1", "pipeline", ["a"]), rolesById(roles));
    expect(layout.nodes[0]!.data.title).toBe("Nova");
    expect(layout.nodes[0]!.data.subtitle).toBe("Researcher");
    expect(layout.nodes[0]!.data.kind).toBe("Stage 1");
  });

  test("falls back to the role name / a model subtitle and never drops an unresolved member", () => {
    const roles = [makeRole("a", { name: "Analyst", defaultModel: "claude-3-5" })];
    // member 'ghost' has no role in the map → renders as an Unknown agent node, not omitted.
    const layout = buildCrewMemberLayout(makeCrew("c1", "parallel", ["a", "ghost"]), rolesById(roles));
    expect(layout.nodes).toHaveLength(2);
    expect(layout.nodes[0]!.data.title).toBe("Analyst");
    expect(layout.nodes[0]!.data.subtitle).toBe("claude-3-5");
    expect(layout.nodes[1]!.data.title).toBe("Unknown agent");
    expect(layout.meta[1]!.agentId).toBe("ghost");
  });

  test("scales to a 6-member fan without NaN positions (readability sanity)", () => {
    const roles = Array.from({ length: 6 }, (_, i) => makeRole(`a${i}`));
    const layout = buildCrewMemberLayout(
      makeCrew("c1", "best_of_n", roles.map((r) => r.id)),
      rolesById(roles),
    );
    expect(layout.nodes).toHaveLength(6);
    expect(layout.edges).toHaveLength(5); // fan-in: 5 → head
    expect(layout.nodes.every((n) => Number.isFinite(n.position.x) && Number.isFinite(n.position.y))).toBe(true);
  });
});

// Crew nesting (WP4.2 / D-CN8) — `buildMixedMemberLayout` is a SEPARATE, new helper over
// caller-supplied box sizes (a mix of agent-leaf and nested-crew-group boxes); `buildCrewMemberLayout`
// above stays byte-for-byte unchanged (also proven by the untouched describe block above staying green).
describe("buildMixedMemberLayout", () => {
  const leafData: FlowNodeData = { title: "Nova", kind: "Stage 1" };

  test("an empty box list yields an empty layout", () => {
    const layout = buildMixedMemberLayout([], "pipeline", "TB");
    expect(layout.nodes).toEqual([]);
    expect(layout.edges).toEqual([]);
    expect(layout).toMatchObject({ width: 0, height: 0 });
  });

  test("lays out MIXED box sizes (an agent-leaf-sized box next to a larger nested-crew-group-sized box)", () => {
    const boxes: MixedMemberBox[] = [
      { nodeId: "m0", width: MEMBER_NODE_W, height: MEMBER_NODE_H, data: leafData, topologyRole: "Stage 1" },
      // A nested crew's own (larger) recursively-computed bounding box.
      { nodeId: "m1", width: MEMBER_NODE_W * 3, height: MEMBER_NODE_H * 2, data: { title: "Nested Crew" }, topologyRole: "Stage 2" },
    ];
    const layout = buildMixedMemberLayout(boxes, "pipeline", "TB");

    expect(layout.nodes).toHaveLength(2);
    // Each box's caller-supplied size is preserved (never coerced to the fixed agent footprint).
    const byId = new Map(layout.nodes.map((n) => [n.id, n]));
    expect(byId.get("m0")).toMatchObject({ width: MEMBER_NODE_W, height: MEMBER_NODE_H });
    expect(byId.get("m1")).toMatchObject({ width: MEMBER_NODE_W * 3, height: MEMBER_NODE_H * 2 });
    // Bounding box accounts for the larger box, not just the fixed member footprint.
    expect(layout.width).toBeGreaterThanOrEqual(MEMBER_NODE_W * 3);
  });

  test("normalizes to a 0,0 origin like buildCrewMemberLayout", () => {
    const boxes: MixedMemberBox[] = [
      { nodeId: "m0", width: MEMBER_NODE_W, height: MEMBER_NODE_H, data: leafData, topologyRole: "Lead" },
      { nodeId: "m1", width: MEMBER_NODE_W, height: MEMBER_NODE_H, data: leafData, topologyRole: "Worker" },
    ];
    const layout = buildMixedMemberLayout(boxes, "parallel", "TB");
    const minX = Math.min(...layout.nodes.map((n) => n.position.x));
    const minY = Math.min(...layout.nodes.map((n) => n.position.y));
    expect(minX).toBe(0);
    expect(minY).toBe(0);
  });

  test("wires topology edges by POSITION (not box kind) — a pipeline chain connects a leaf to a group box", () => {
    const boxes: MixedMemberBox[] = [
      { nodeId: "agent-0", width: MEMBER_NODE_W, height: MEMBER_NODE_H, data: leafData, topologyRole: "Stage 1" },
      { nodeId: "group-1", width: MEMBER_NODE_W * 2, height: MEMBER_NODE_H * 2, data: { title: "g" }, topologyRole: "Stage 2" },
    ];
    const layout = buildMixedMemberLayout(boxes, "pipeline", "TB");
    expect(layout.edges).toHaveLength(1);
    expect(layout.edges[0]).toMatchObject({ source: "agent-0", target: "group-1", type: "smart" });
    expect(layout.edges[0]!.markerEnd).toBeDefined();
  });

  test("data.kind falls back to topologyRole when data doesn't already set one", () => {
    const boxes: MixedMemberBox[] = [
      { nodeId: "m0", width: MEMBER_NODE_W, height: MEMBER_NODE_H, data: { title: "Nova" }, topologyRole: "Lead" },
    ];
    const layout = buildMixedMemberLayout(boxes, "parallel", "TB");
    expect(layout.nodes[0]!.data.kind).toBe("Lead");
  });

  test("a single-box layout still produces a finite, positive bounding box", () => {
    const boxes: MixedMemberBox[] = [
      { nodeId: "m0", width: MEMBER_NODE_W, height: MEMBER_NODE_H, data: leafData, topologyRole: "Lead" },
    ];
    const layout = buildMixedMemberLayout(boxes, "parallel", "TB");
    expect(layout.edges).toEqual([]); // fewer than 2 members ⇒ no topology edges
    expect(layout.width).toBeGreaterThanOrEqual(MEMBER_NODE_W);
    expect(layout.height).toBeGreaterThanOrEqual(MEMBER_NODE_H);
  });
});
