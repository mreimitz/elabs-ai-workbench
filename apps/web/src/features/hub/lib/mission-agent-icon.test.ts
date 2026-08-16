import type { HubAgentRole, HubMissionPlan, HubPlannedAgent } from "@mcp-token-footprint/shared";
import { describe, expect, test } from "vitest";
import { buildMissionRoleLookup, missionAgentIcon, plannedAgentIcon } from "./mission-agent-icon";

function plannedAgent(overrides: Partial<HubPlannedAgent> = {}): HubPlannedAgent {
  return {
    key: "a",
    name: "Analyst",
    systemPrompt: "You analyze.",
    model: "claude-sonnet-5",
    toolGrants: { servers: {}, builtins: [] },
    skillIds: [],
    brief: "Investigate.",
    target: "Analyze",
    expectedOutcome: "A report",
    ...overrides,
  };
}

function plan(agents: HubPlannedAgent[]): HubMissionPlan {
  return { topology: "parallel", autonomy: "always_ask", agents };
}

function role(overrides: Partial<HubAgentRole> & { id: string }): HubAgentRole {
  return {
    name: "Analyst",
    systemPrompt: "You analyze.",
    defaultModel: "claude-sonnet-5",
    toolGrants: { servers: {}, builtins: [] },
    skills: [],
    target: "Analyze",
    expectedOutcome: "A report",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("missionAgentIcon", () => {
  const lookup = buildMissionRoleLookup([
    role({ id: "role-1", name: "Research Analyst", icon: "lucide:brain" }),
    role({ id: "role-2", name: "qlik-analyst-agent", displayName: "Steven", icon: "lucide:database" }),
  ]);

  test("resolves an agent's icon by key → roleId → role.icon", () => {
    const p = plan([plannedAgent({ key: "a", roleId: "role-1" })]);
    expect(missionAgentIcon(p, lookup, "a")).toBe("lucide:brain");
  });

  test("resolves by NAME when the planner INVENTED the agent (no roleId) but its name matches a role", () => {
    const p = plan([plannedAgent({ key: "a", name: "qlik-analyst-agent" })]); // no roleId
    expect(missionAgentIcon(p, lookup, "a")).toBe("lucide:database");
  });

  test("resolves by displayName too (case-insensitive)", () => {
    const p = plan([plannedAgent({ key: "a", name: "STEVEN" })]);
    expect(missionAgentIcon(p, lookup, "a")).toBe("lucide:database");
  });

  test("undefined when neither id nor name matches, or the role has no icon", () => {
    expect(missionAgentIcon(plan([plannedAgent({ key: "a", name: "Unknown" })]), lookup, "a")).toBeUndefined();
    const noIcon = buildMissionRoleLookup([role({ id: "r", name: "Plain" })]);
    expect(missionAgentIcon(plan([plannedAgent({ key: "a", name: "Plain" })]), noIcon, "a")).toBeUndefined();
  });

  test("undefined when the lookup is absent (still loading) or the key is unknown", () => {
    const p = plan([plannedAgent({ key: "a", roleId: "role-1" })]);
    expect(missionAgentIcon(p, undefined, "a")).toBeUndefined();
    expect(missionAgentIcon(p, lookup, "missing-key")).toBeUndefined();
    expect(missionAgentIcon(undefined, lookup, "a")).toBeUndefined();
  });
});

describe("plannedAgentIcon", () => {
  const lookup = buildMissionRoleLookup([
    role({ id: "role-2", name: "qlik-analyst-agent", icon: "lucide:database" }),
  ]);

  test("resolves a HubPlannedAgent by roleId then name", () => {
    expect(plannedAgentIcon(lookup, { roleId: "role-2", name: "whatever" })).toBe("lucide:database");
    expect(plannedAgentIcon(lookup, { name: "qlik-analyst-agent" })).toBe("lucide:database");
    expect(plannedAgentIcon(lookup, { name: "nope" })).toBeUndefined();
    expect(plannedAgentIcon(undefined, { name: "qlik-analyst-agent" })).toBeUndefined();
  });
});
