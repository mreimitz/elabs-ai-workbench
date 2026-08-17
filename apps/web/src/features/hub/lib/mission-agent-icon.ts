import type { HubAgentRole, HubCrew, HubMissionPlan } from "@mcp-token-footprint/shared";

/**
 * Assistant Hub — resolve a mission agent's avatar icon + brief on the session surfaces (progress
 * rail, report cards, graph nodes). A mission agent carries only `roleName`/`model`/`key`, so the
 * custom `icon` is recovered from the role library two ways, in order:
 *   1. by `roleId` — set on the planned agent when the planner REUSES a saved role;
 *   2. by NAME — the planner often INVENTS an agent (no `roleId`) whose name nonetheless matches a
 *      saved role (e.g. "acme-analyst-agent"). Matching that name to the library recovers the icon the
 *      owner set — otherwise every planner-invented agent would fall back to a generic glyph.
 *
 * Returns `undefined` when neither resolves or the role has no icon — `RoleAvatar` then falls back to
 * the model provider logo and finally a generic glyph, so a missing icon is never an error.
 */
export type MissionRoleLookup = {
  /** role id → role. */
  byId: Map<string, HubAgentRole>;
  /** lower-cased role `name` AND `displayName` → role (first wins). */
  byName: Map<string, HubAgentRole>;
};

/** Build the two lookup maps once (memoize at the caller). Name keys are lower-cased + trimmed. */
export function buildMissionRoleLookup(roles: readonly HubAgentRole[]): MissionRoleLookup {
  const byId = new Map<string, HubAgentRole>();
  const byName = new Map<string, HubAgentRole>();
  for (const role of roles) {
    byId.set(role.id, role);
    const name = role.name?.trim().toLowerCase();
    if (name && !byName.has(name)) byName.set(name, role);
    const displayName = role.displayName?.trim().toLowerCase();
    if (displayName && !byName.has(displayName)) byName.set(displayName, role);
  }
  return { byId, byName };
}

/** Resolve a role from the lookup by id first, then by name (the planner-invented case). */
function resolveRole(
  lookup: MissionRoleLookup | undefined,
  roleId: string | undefined,
  name: string | undefined,
): HubAgentRole | undefined {
  if (!lookup) return undefined;
  const byId = roleId ? lookup.byId.get(roleId) : undefined;
  if (byId) return byId;
  const key = name?.trim().toLowerCase();
  return key ? lookup.byName.get(key) : undefined;
}

/** The avatar icon for a mission agent identified by its plan `key` (progress rail / board / graph). */
export function missionAgentIcon(
  plan: HubMissionPlan | undefined,
  lookup: MissionRoleLookup | undefined,
  key: string,
): string | undefined {
  const planned = plan?.agents.find((agent) => agent.key === key);
  return resolveRole(lookup, planned?.roleId, planned?.name)?.icon;
}

/** The avatar icon for a planned agent held directly (the pre-run plan card, `HubPlannedAgent`). */
export function plannedAgentIcon(
  lookup: MissionRoleLookup | undefined,
  agent: { roleId?: string; name: string },
): string | undefined {
  return resolveRole(lookup, agent.roleId, agent.name)?.icon;
}

/**
 * Crew nesting (WP4.3 / D-CN5) — the saved-crew library lookup for a plan's `crewId`-bearing slots (the
 * `PlannedCrewCard`'s name/icon resolution). Simpler than {@link MissionRoleLookup}'s two-map shape:
 * a crew-ref slot is always addressed by id (`HubPlannedAgent.crewId`), never resolved by name.
 */
export type MissionCrewLookup = Map<string, HubCrew>;

/** Build the crew lookup once (memoize at the caller — mirrors {@link buildMissionRoleLookup}). */
export function buildMissionCrewLookup(crews: readonly HubCrew[]): MissionCrewLookup {
  return new Map(crews.map((crew) => [crew.id, crew]));
}

/**
 * Resolve a mission agent's BRIEF — the task it was given (its sole user turn under D-AH9 isolation),
 * i.e. "the prompt it received". The board view carries `brief?` but it is dropped when falsy
 * (`reconstructMissionBoard`) and omitted by synthetic logs, so fall back to the frozen plan by `key`.
 * Returns undefined when neither has a brief.
 */
export function missionAgentBrief(
  plan: HubMissionPlan | undefined,
  key: string,
  agentBrief?: string,
): string | undefined {
  const brief = agentBrief ?? plan?.agents.find((agent) => agent.key === key)?.brief;
  return brief && brief.trim() !== "" ? brief : undefined;
}
