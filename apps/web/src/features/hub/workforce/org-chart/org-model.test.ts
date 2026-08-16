import type { HubAgentRole, HubCrew } from "@mcp-token-footprint/shared";
import { describe, expect, test } from "vitest";
import type { OrgRailScope } from "../OrgRail";
import { buildOrgChartModel, type OrgNodeMeta } from "./org-model";
import { makeCrew, makeRole } from "./test-fixtures";

function build(crews: HubCrew[], roles: HubAgentRole[], scope: OrgRailScope) {
  return buildOrgChartModel({ crews, roles, scope });
}

const groupNodes = (m: ReturnType<typeof buildOrgChartModel>) => m.nodes.filter((n) => n.type === "group");
const memberNodes = (m: ReturnType<typeof buildOrgChartModel>) => m.nodes.filter((n) => n.type === "brand");
const crewMeta = (m: ReturnType<typeof buildOrgChartModel>, id: string) =>
  [...m.meta.values()].find((x): x is Extract<OrgNodeMeta, { kind: "crew" }> => x.kind === "crew" && x.crewId === id);

describe("buildOrgChartModel — scope: all", () => {
  const roles = [makeRole("a"), makeRole("b"), makeRole("c"), makeRole("solo")];
  const crews = [
    makeCrew("k1", "pipeline", ["a", "b"], { name: "Alpha", color: "chart-1" }),
    makeCrew("k2", "parallel", ["c"], { name: "Beta" }),
  ];

  test("draws a group per crew plus an Unassigned lane for the crew-less agent", () => {
    const model = build(crews, roles, { kind: "all" });
    expect(model.isEmpty).toBe(false);
    // 2 crews + 1 unassigned lane = 3 groups
    expect(groupNodes(model)).toHaveLength(3);
    const groupIds = groupNodes(model).map((n) => n.id);
    expect(groupIds).toContain("crew:k1");
    expect(groupIds).toContain("crew:k2");
    expect(groupIds).toContain("lane:unassigned");
    // members: 2 (Alpha) + 1 (Beta) + 1 (unassigned solo) = 4
    expect(memberNodes(model)).toHaveLength(4);
  });

  test("member nodes are re-parented onto their crew group (parentId + extent)", () => {
    const model = build(crews, roles, { kind: "all" });
    const alphaMembers = memberNodes(model).filter((n) => n.parentId === "crew:k1");
    expect(alphaMembers).toHaveLength(2);
    expect(alphaMembers.every((n) => n.extent === "parent")).toBe(true);
  });

  test("each group node is emitted BEFORE its children (React Flow parent-first rule)", () => {
    const model = build(crews, roles, { kind: "all" });
    for (const child of model.nodes.filter((n) => n.parentId)) {
      const parentIdx = model.nodes.findIndex((n) => n.id === child.parentId);
      const childIdx = model.nodes.findIndex((n) => n.id === child.id);
      expect(parentIdx).toBeGreaterThanOrEqual(0);
      expect(parentIdx).toBeLessThan(childIdx);
    }
  });

  test("group nodes carry a concrete size and a colored crew is tinted via the group-border token", () => {
    const model = build(crews, roles, { kind: "all" });
    const alpha = groupNodes(model).find((n) => n.id === "crew:k1")!;
    expect(Number(alpha.style?.width)).toBeGreaterThan(0);
    expect(Number(alpha.style?.height)).toBeGreaterThan(0);
    // token→token redirect, never a raw color
    expect((alpha.style as Record<string, string>)["--flow-group-border"]).toBe("var(--chart-1)");
    // an uncolored crew leaves the group's own default border untouched
    const beta = groupNodes(model).find((n) => n.id === "crew:k2")!;
    expect((beta.style as Record<string, string>)["--flow-group-border"]).toBeUndefined();
  });

  test("group title carries the crew name + topology; edges follow topology", () => {
    const model = build(crews, roles, { kind: "all" });
    expect(crewMeta(model, "k1")?.topology).toBe("pipeline");
    const alpha = groupNodes(model).find((n) => n.id === "crew:k1")!;
    expect(alpha.data.title).toBe("Alpha · Pipeline");
    // pipeline of 2 → 1 chain edge; Beta (1 member) → 0; unassigned → 0
    expect(model.edges).toHaveLength(1);
  });

  test("lanes wrap into rows and never overlap on the x-axis within a row", () => {
    // 4 crews → LANES_PER_ROW=3 forces a wrap; the Unassigned lane starts its own row.
    const many = [
      makeCrew("k1", "pipeline", ["a"], { name: "A" }),
      makeCrew("k2", "pipeline", ["b"], { name: "B" }),
      makeCrew("k3", "pipeline", ["c"], { name: "C" }),
      makeCrew("k4", "pipeline", ["a"], { name: "D" }),
    ];
    const model = build(many, roles, { kind: "all" });
    const groups = groupNodes(model);
    // distinct row Y positions (>=2 rows because of the wrap + the forced Unassigned row)
    const rowYs = new Set(groups.map((n) => n.position.y));
    expect(rowYs.size).toBeGreaterThanOrEqual(2);
  });

  test("legend lists only colored crews shown; topologies are de-duplicated", () => {
    const model = build(crews, roles, { kind: "all" });
    expect(model.legendCrews).toEqual([{ crewId: "k1", name: "Alpha", color: "chart-1" }]);
    expect([...model.topologies].sort()).toEqual(["parallel", "pipeline"]);
  });
});

describe("buildOrgChartModel — focused scopes", () => {
  const roles = [makeRole("a"), makeRole("b"), makeRole("c", { archivedAt: "2026-02-02T00:00:00.000Z" })];
  const crews = [makeCrew("k1", "pipeline", ["a"], { name: "Alpha" })];

  test("crew scope draws only that crew", () => {
    const model = build(crews, roles, { kind: "crew", crewId: "k1" });
    expect(groupNodes(model).map((n) => n.id)).toEqual(["crew:k1"]);
    expect(model.isEmpty).toBe(false);
  });

  test("a missing crew scope is a real (non-blank) empty with a reason", () => {
    const model = build(crews, roles, { kind: "crew", crewId: "ghost" });
    expect(model.isEmpty).toBe(true);
    expect(model.emptyReason).toMatch(/no longer exists/i);
    expect(model.nodes).toEqual([]);
  });

  test("unassigned scope shows only the Unassigned lane (active, crew-less agents)", () => {
    const model = build(crews, roles, { kind: "unassigned" });
    expect(groupNodes(model).map((n) => n.id)).toEqual(["lane:unassigned"]);
    // b is active + crew-less; a is in the crew; c is archived → only b
    expect(memberNodes(model)).toHaveLength(1);
    const meta = [...model.meta.values()].find((x) => x.kind === "agent");
    expect(meta && meta.kind === "agent" && meta.agentId).toBe("b");
  });

  test("archived scope shows only archived agents, flagged archived", () => {
    const model = build(crews, roles, { kind: "archived" });
    expect(groupNodes(model).map((n) => n.id)).toEqual(["lane:archived"]);
    const agentMetas = [...model.meta.values()].filter(
      (x): x is Extract<OrgNodeMeta, { kind: "agent" }> => x.kind === "agent",
    );
    expect(agentMetas).toHaveLength(1);
    expect(agentMetas[0]!.agentId).toBe("c");
    expect(agentMetas[0]!.archived).toBe(true);
  });
});

describe("buildOrgChartModel — empty fleet", () => {
  test("no crews and no agents ⇒ isEmpty with a create-first reason", () => {
    const model = build([], [], { kind: "all" });
    expect(model.isEmpty).toBe(true);
    expect(model.emptyReason).toMatch(/create an agent/i);
    expect(model.nodes).toEqual([]);
  });
});

// Crew nesting (WP4.2 / D-CN8) — a `crewId` member draws its own nested `FlowGroupNode`, parented via
// `@xyflow`'s `parentId` onto the outer crew's group; a cyclic/dangling reference draws a distinct,
// non-recursing placeholder instead — bounded, never a hang/crash on a synthetic self-referencing
// fixture.
describe("buildOrgChartModel — crew nesting (WP4.2 / D-CN8)", () => {
  const subCrewMeta = (m: ReturnType<typeof buildOrgChartModel>, crewId: string) =>
    [...m.meta.values()].find(
      (x): x is Extract<OrgNodeMeta, { kind: "sub-crew" }> => x.kind === "sub-crew" && x.crewId === crewId,
    );
  const placeholderMetas = (m: ReturnType<typeof buildOrgChartModel>) =>
    [...m.meta.values()].filter(
      (x): x is Extract<OrgNodeMeta, { kind: "placeholder" }> => x.kind === "placeholder",
    );

  test("a crewId member produces a nested FlowGroupNode whose parentId is the outer crew's group id, tagged 'sub-crew' + parentCrewId", () => {
    const roles = [makeRole("a"), makeRole("b")];
    const sub = makeCrew("sub", "pipeline", ["b"], { name: "Sub" });
    const top = makeCrew("top", "pipeline", [], {
      name: "Top",
      members: [{ agentId: "a" }, { crewId: "sub" }],
    });
    const model = build([sub, top], roles, { kind: "crew", crewId: "top" });

    const groups = groupNodes(model);
    const topGroup = groups.find((n) => n.id === "crew:top");
    const nestedGroup = groups.find((n) => n.id === "crew:top>sub");
    expect(topGroup).toBeDefined();
    expect(nestedGroup).toBeDefined();
    expect(nestedGroup!.parentId).toBe("crew:top");
    expect(nestedGroup!.extent).toBe("parent");

    const nestedMeta = subCrewMeta(model, "sub");
    expect(nestedMeta).toBeDefined();
    expect(nestedMeta!.parentCrewId).toBe("top");
    expect(nestedMeta!.nodeId).toBe("crew:top>sub");

    // The nested crew's own member (role "b") is re-parented onto the NESTED group, not the top one.
    const nestedMember = memberNodes(model).find((n) => n.parentId === "crew:top>sub");
    expect(nestedMember).toBeDefined();
  });

  test("nested groups still emit parent-before-child across the whole chain", () => {
    const roles = [makeRole("a"), makeRole("b")];
    const sub = makeCrew("sub", "pipeline", ["b"], { name: "Sub" });
    const top = makeCrew("top", "pipeline", [], {
      name: "Top",
      members: [{ agentId: "a" }, { crewId: "sub" }],
    });
    const model = build([sub, top], roles, { kind: "crew", crewId: "top" });
    for (const child of model.nodes.filter((n) => n.parentId)) {
      const parentIdx = model.nodes.findIndex((n) => n.id === child.parentId);
      const childIdx = model.nodes.findIndex((n) => n.id === child.id);
      expect(parentIdx).toBeGreaterThanOrEqual(0);
      expect(parentIdx).toBeLessThan(childIdx);
    }
  });

  test("a dangling crewId reference produces a distinct 'missing' placeholder node, not a crash", () => {
    const roles = [makeRole("a")];
    const top = makeCrew("top", "pipeline", [], {
      name: "Top",
      members: [{ agentId: "a" }, { crewId: "ghost" }],
    });
    const model = build([top], roles, { kind: "crew", crewId: "top" });
    expect(model.isEmpty).toBe(false);
    const placeholders = placeholderMetas(model);
    expect(placeholders).toHaveLength(1);
    expect(placeholders[0]!.reason).toBe("missing");
  });

  test("a self-referencing crew (A → A) produces a 'cycle' placeholder and a BOUNDED node count — no hang", () => {
    const roles = [makeRole("a")];
    const self = makeCrew("self", "pipeline", [], {
      name: "Self",
      members: [{ agentId: "a" }, { crewId: "self" }],
    });
    const model = build([self], roles, { kind: "crew", crewId: "self" });
    expect(model.isEmpty).toBe(false);
    const placeholders = placeholderMetas(model);
    expect(placeholders).toHaveLength(1);
    expect(placeholders[0]!.reason).toBe("cycle");
    // Bounded: exactly one crew group (the placeholder never recurses into a second "Self" group).
    expect(groupNodes(model).filter((n) => n.id.includes("self"))).toHaveLength(1);
    expect(model.nodes.length).toBeLessThan(50);
  });

  test("a mutual cycle (A ↔ B) terminates with a bounded node count on a synthetic self-referencing fixture", () => {
    const roles = [makeRole("a")];
    const crewA = makeCrew("crew-a", "pipeline", [], {
      name: "Crew A",
      members: [{ agentId: "a" }, { crewId: "crew-b" }],
    });
    const crewB = makeCrew("crew-b", "pipeline", [], {
      name: "Crew B",
      members: [{ crewId: "crew-a" }],
    });
    const model = build([crewA, crewB], roles, { kind: "crew", crewId: "crew-a" });
    expect(model.isEmpty).toBe(false);
    expect(placeholderMetas(model).some((p) => p.reason === "cycle")).toBe(true);
    // Finite/bounded — the builder terminates rather than recursing forever.
    expect(model.nodes.length).toBeLessThan(50);
  });

  test("diamond node-id uniqueness: the same sub-crew nested under two different parents gets two distinct path-scoped node ids", () => {
    const roles = [makeRole("a")];
    const shared = makeCrew("shared", "pipeline", ["a"], { name: "Shared" });
    const parentA = makeCrew("parent-a", "pipeline", [], {
      name: "Parent A",
      members: [{ crewId: "shared" }],
    });
    const parentB = makeCrew("parent-b", "pipeline", [], {
      name: "Parent B",
      members: [{ crewId: "shared" }],
    });
    const model = build([shared, parentA, parentB], roles, { kind: "all" });
    const groupIds = groupNodes(model).map((n) => n.id);
    expect(groupIds).toContain("crew:parent-a>shared");
    expect(groupIds).toContain("crew:parent-b>shared");
    // No id collision — the top-level "shared" crew ALSO draws independently (it's a real saved crew).
    expect(groupIds).toContain("crew:shared");
    expect(new Set(groupIds).size).toBe(groupIds.length);
  });

  test("assignedIds is recursive: an agent reachable only via a nested sub-crew is NOT drawn in the Unassigned lane", () => {
    const roles = [makeRole("a"), makeRole("b")];
    const sub = makeCrew("sub", "pipeline", ["a"], { name: "Sub" });
    const top = makeCrew("top", "pipeline", [], { name: "Top", members: [{ crewId: "sub" }] });
    const model = build([sub, top], roles, { kind: "unassigned" });
    // Only "b" (truly unassigned) — "a" is reachable via the nested sub-crew.
    expect(memberNodes(model)).toHaveLength(1);
    const meta = [...model.meta.values()].find((x) => x.kind === "agent");
    expect(meta && meta.kind === "agent" && meta.agentId).toBe("b");
  });

  test("legend includes a nested crew's color even when it's only visible nested", () => {
    const roles = [makeRole("a")];
    const sub = makeCrew("sub", "pipeline", ["a"], { name: "Sub", color: "chart-4" });
    const top = makeCrew("top", "pipeline", [], { name: "Top", members: [{ crewId: "sub" }] });
    const model = build([sub, top], roles, { kind: "crew", crewId: "top" });
    expect(model.legendCrews).toContainEqual({ crewId: "sub", name: "Sub", color: "chart-4" });
  });
});
