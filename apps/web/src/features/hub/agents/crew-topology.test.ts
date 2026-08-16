// model-identity WP5.1 — locks the three symbols extracted out of the (deleted) `CrewEditor.tsx`.
// `crew-profile/TopologySection.tsx` is their only production consumer, and its own coverage renders
// the graph rather than asserting the derivation, so these unit tests are what keep the MOVE honest:
// the labels are the exact strings the crew profile modal's topology Select shows, and the derivation
// is the exact node shape `TopologyGraph`/`deriveTopologyGraph` is fed.

import type { HubAgentRole, HubCrewMember } from "@mcp-token-footprint/shared";
import { HUB_TOPOLOGIES } from "@mcp-token-footprint/shared";
import { describe, expect, test } from "vitest";
import { crewFormToTopoInput, TOPOLOGY_LABELS, TOPOLOGY_SHORT } from "./crew-topology";

function role(overrides: Partial<HubAgentRole> = {}): HubAgentRole {
  return {
    id: "role-1",
    name: "Research Analyst",
    systemPrompt: "You research topics thoroughly.",
    defaultModel: "claude-sonnet-4-5",
    toolGrants: { servers: {}, builtins: [] },
    skills: [],
    target: "Investigate the topic",
    expectedOutcome: "A structured report",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    archivedAt: null,
    ...overrides,
  };
}

const roleMap = (...roles: HubAgentRole[]): Map<string, HubAgentRole> =>
  new Map(roles.map((r) => [r.id, r]));

describe("TOPOLOGY_SHORT / TOPOLOGY_LABELS", () => {
  test("both cover every HUB_TOPOLOGIES member (the Select maps over that list)", () => {
    for (const topology of HUB_TOPOLOGIES) {
      expect(TOPOLOGY_SHORT[topology]).toBeTruthy();
      expect(TOPOLOGY_LABELS[topology]).toBeTruthy();
    }
    expect(Object.keys(TOPOLOGY_SHORT).sort()).toEqual([...HUB_TOPOLOGIES].sort());
    expect(Object.keys(TOPOLOGY_LABELS).sort()).toEqual([...HUB_TOPOLOGIES].sort());
  });

  test("the long label leads with the short one (the two surfaces must not drift)", () => {
    for (const topology of HUB_TOPOLOGIES) {
      expect(TOPOLOGY_LABELS[topology].startsWith(TOPOLOGY_SHORT[topology])).toBe(true);
    }
  });
});

describe("crewFormToTopoInput", () => {
  test("maps members to idle nodes in order, carrying the role name + model", () => {
    const members: HubCrewMember[] = [{ agentId: "role-1" }, { agentId: "role-2" }];
    const input = crewFormToTopoInput(
      { topology: "pipeline", members },
      roleMap(role(), role({ id: "role-2", name: "Writer", defaultModel: "claude-opus-4-1" })),
    );

    expect(input.topology).toBe("pipeline");
    expect(input.terminal).toEqual({ state: "idle" });
    expect(input.agents).toEqual([
      { id: "role-1-0", title: "Research Analyst", subtitle: "claude-sonnet-4-5", state: "idle" },
      { id: "role-2-1", title: "Writer", subtitle: "claude-opus-4-1", state: "idle" },
    ]);
  });

  test("a per-member model override wins over the role default", () => {
    const input = crewFormToTopoInput(
      { topology: "parallel", members: [{ agentId: "role-1", model: "claude-haiku-4-5" }] },
      roleMap(role()),
    );
    expect(input.agents[0]?.subtitle).toBe("claude-haiku-4-5");
  });

  test("a deleted role degrades to a labelled placeholder with a 6-char id slice", () => {
    const input = crewFormToTopoInput(
      { topology: "parallel", members: [{ agentId: "role-vanished-xyz" }] },
      roleMap(),
    );
    expect(input.agents).toHaveLength(1);
    expect(input.agents[0]?.title).toBe("(deleted role · role-v)");
  });

  test("a nested-crew member (no agentId) is dropped, and does not shift the surviving node's id", () => {
    // The index comes from the ORIGINAL member array, so the agent after a nested crew keeps index 1.
    const members: HubCrewMember[] = [{ crewId: "crew-9" } as HubCrewMember, { agentId: "role-1" }];
    const input = crewFormToTopoInput({ topology: "debate", members }, roleMap(role()));

    expect(input.agents).toEqual([
      { id: "role-1-1", title: "Research Analyst", subtitle: "claude-sonnet-4-5", state: "idle" },
    ]);
  });

  test("an empty crew still yields a well-formed graph input", () => {
    const input = crewFormToTopoInput({ topology: "best_of_n", members: [] }, roleMap());
    expect(input).toEqual({ topology: "best_of_n", agents: [], terminal: { state: "idle" } });
  });
});
