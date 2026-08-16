// Shared fixtures for the Org chart (WP2.5) pure-model + component tests.
import type { HubAgentRole, HubCrew, HubCrewMember, HubTopology } from "@mcp-token-footprint/shared";

export function makeRole(id: string, overrides: Partial<HubAgentRole> = {}): HubAgentRole {
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

export function makeCrew(
  id: string,
  topology: HubTopology,
  agentIds: string[],
  overrides: Partial<HubCrew> = {},
): HubCrew {
  const members: HubCrewMember[] = agentIds.map((agentId) => ({ agentId }));
  return {
    id,
    name: `Crew ${id}`,
    topology,
    members,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}
