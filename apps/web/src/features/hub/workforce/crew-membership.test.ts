import type { HubAgentRole, HubCrew } from "@mcp-token-footprint/shared";
import { describe, expect, test } from "vitest";
import {
  formatCrewMembershipCount,
  resolveCrewAgents,
  resolveCrewClosure,
} from "./crew-membership";

function role(id: string, overrides: Partial<HubAgentRole> = {}): HubAgentRole {
  return {
    id,
    name: `Role ${id}`,
    systemPrompt: "s",
    defaultModel: "gpt-4o",
    toolGrants: { servers: {}, builtins: [] },
    skills: [],
    target: "t",
    expectedOutcome: "o",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function crew(
  id: string,
  members: HubCrew["members"],
  overrides: Partial<HubCrew> = {},
): HubCrew {
  return {
    id,
    name: `Crew ${id}`,
    topology: "parallel",
    members,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("resolveCrewClosure — flat crew (no crewId members)", () => {
  test("agent-only members: closure is identical in shape to today's members.length", () => {
    const crews = new Map([
      ["c1", crew("c1", [{ agentId: "a" }, { agentId: "b" }, { agentId: "c" }])],
    ]);
    const closure = resolveCrewClosure("c1", crews);
    expect(closure.agentIds.size).toBe(3);
    expect(closure.crewIds.size).toBe(0);
    expect(closure.cyclic).toBe(false);
    expect(formatCrewMembershipCount(closure)).toBe("3 agents");
  });

  test("singular phrasing for exactly one agent", () => {
    const crews = new Map([["c1", crew("c1", [{ agentId: "a" }])]]);
    expect(formatCrewMembershipCount(resolveCrewClosure("c1", crews))).toBe("1 agent");
  });

  test("a dangling agentId still counts (mirrors members.length; role-existence is a display concern elsewhere)", () => {
    const crews = new Map([["c1", crew("c1", [{ agentId: "ghost" }])]]);
    const closure = resolveCrewClosure("c1", crews);
    expect(closure.agentIds.size).toBe(1);
  });
});

describe("resolveCrewClosure — 2-level nesting", () => {
  test("2 direct agents + 1 sub-crew of 3 agents closes to 5 agents / 1 crew / 6 total", () => {
    const crews = new Map([
      ["sub", crew("sub", [{ agentId: "x" }, { agentId: "y" }, { agentId: "z" }])],
      ["top", crew("top", [{ agentId: "a" }, { agentId: "b" }, { crewId: "sub" }])],
    ]);
    const closure = resolveCrewClosure("top", crews);
    expect(closure.agentIds.size).toBe(5);
    expect(closure.crewIds.size).toBe(1);
    expect(closure.cyclic).toBe(false);
    expect(formatCrewMembershipCount(closure)).toBe("5 agents, 1 crew (6 total)");
  });

  test("plural crews phrasing with 2+ nested crews", () => {
    const crews = new Map([
      ["sub1", crew("sub1", [{ agentId: "x" }])],
      ["sub2", crew("sub2", [{ agentId: "y" }])],
      ["top", crew("top", [{ crewId: "sub1" }, { crewId: "sub2" }])],
    ]);
    const closure = resolveCrewClosure("top", crews);
    expect(formatCrewMembershipCount(closure)).toBe("2 agents, 2 crews (4 total)");
  });

  test("a dangling crewId reference is skipped from the count, not thrown", () => {
    const crews = new Map([["top", crew("top", [{ agentId: "a" }, { crewId: "ghost" }])]]);
    const closure = resolveCrewClosure("top", crews);
    expect(closure.agentIds.size).toBe(1);
    expect(closure.crewIds.size).toBe(0);
    expect(closure.cyclic).toBe(false);
  });
});

describe("resolveCrewClosure — cycles terminate with a finite, honest result", () => {
  test("a mutual cycle (A ↔ B) terminates and marks cyclic: true", () => {
    const crews = new Map([
      ["a", crew("a", [{ agentId: "agent-a" }, { crewId: "b" }])],
      ["b", crew("b", [{ agentId: "agent-b" }, { crewId: "a" }])],
    ]);
    const closure = resolveCrewClosure("a", crews);
    expect(closure.cyclic).toBe(true);
    // Finite/bounded: both agents reachable, both crew ids referenced once each.
    expect(closure.agentIds).toEqual(new Set(["agent-a", "agent-b"]));
    expect(closure.crewIds).toEqual(new Set(["a", "b"]));
  });

  test("a self-reference (A → A) terminates and marks cyclic: true", () => {
    const crews = new Map([["a", crew("a", [{ agentId: "agent-a" }, { crewId: "a" }])]]);
    const closure = resolveCrewClosure("a", crews);
    expect(closure.cyclic).toBe(true);
    expect(closure.agentIds).toEqual(new Set(["agent-a"]));
    expect(closure.crewIds).toEqual(new Set(["a"]));
  });

  test("a longer cycle (A → B → C → A) still terminates", () => {
    const crews = new Map([
      ["a", crew("a", [{ crewId: "b" }])],
      ["b", crew("b", [{ crewId: "c" }])],
      ["c", crew("c", [{ agentId: "agent-c" }, { crewId: "a" }])],
    ]);
    const closure = resolveCrewClosure("a", crews);
    expect(closure.cyclic).toBe(true);
    expect(closure.agentIds).toEqual(new Set(["agent-c"]));
  });
});

describe("resolveCrewClosure — diamond (two parents share one sub-crew)", () => {
  test("crew C's agents count once in EACH parent's closure, not merged/omitted", () => {
    const crews = new Map([
      ["shared", crew("shared", [{ agentId: "shared-agent" }])],
      ["parentA", crew("parentA", [{ agentId: "a" }, { crewId: "shared" }])],
      ["parentB", crew("parentB", [{ agentId: "b" }, { crewId: "shared" }])],
    ]);
    // A single shared memo — the realistic per-render usage (OrgRail/org-chart build one memo for
    // the whole crew list) — must still give each parent its own correct, independent closure.
    const memo = new Map();
    const closureA = resolveCrewClosure("parentA", crews, memo);
    const closureB = resolveCrewClosure("parentB", crews, memo);
    expect(closureA.agentIds).toEqual(new Set(["a", "shared-agent"]));
    expect(closureB.agentIds).toEqual(new Set(["b", "shared-agent"]));
    expect(formatCrewMembershipCount(closureA)).toBe("2 agents, 1 crew (3 total)");
    expect(formatCrewMembershipCount(closureB)).toBe("2 agents, 1 crew (3 total)");
  });
});

describe("resolveCrewClosure — root not found", () => {
  test("a root crewId absent from crewsById returns an empty, non-cyclic closure", () => {
    const closure = resolveCrewClosure("ghost", new Map());
    expect(closure.agentIds.size).toBe(0);
    expect(closure.crewIds.size).toBe(0);
    expect(closure.cyclic).toBe(false);
  });
});

describe("resolveCrewAgents", () => {
  test("resolves the closure's agent ids to roles, dropping unresolved ids", () => {
    const crews = new Map([
      ["sub", crew("sub", [{ agentId: "x" }])],
      ["top", crew("top", [{ agentId: "a" }, { crewId: "sub" }, { agentId: "ghost" }])],
    ]);
    const roles = new Map([
      ["a", role("a")],
      ["x", role("x")],
    ]);
    const resolved = resolveCrewAgents("top", crews, roles);
    expect(resolved.map((r) => r.id).sort()).toEqual(["a", "x"]);
  });
});
