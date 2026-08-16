// Assistant Hub — hub-fixes (Defect 1a): keep a mission session's ROSTER servers reachable.
//
// When a session scopes in saved Agents & Crews (its "roster") but is created/edited with a narrow
// (non-null) tool scope, a reused server-bound role's MCP server must still be REACHABLE from the session
// — otherwise the plan-grant clamp strips it at plan time and the mission agent runs tool-less (the
// original "the Qlik agent can't use its Qlik server" bug). This module resolves a roster to its concrete
// roles and unions their server grants into the scope (the pure join lives in `tools/grants.ts`). Used at
// session CREATE (session-service) and session PATCH (routes).

import type { HubAgentRole, HubSessionRoster, HubToolGrants } from "@mcp-token-footprint/shared";
import type { HubRepository } from "./repository.js";
import { unionRosterServerGrantsIntoScope } from "./tools/grants.js";

type RosterRepository = Pick<HubRepository, "listAgentRoles" | "getCrew">;

/** Resolve a roster (agent ids + crew ids) to its concrete saved roles, DEDUPED (a role reached via both
 *  an explicit agent id and a crew appears once). Order: explicit agents first, then crew members. A
 *  deleted/unknown agent or crew id is silently dropped (resolution parity with the planner's
 *  `resolveRoster`). Archived roles are included — a scoped-in role may since have been archived. */
export function resolveRosterRoles(repository: RosterRepository, roster: HubSessionRoster): HubAgentRole[] {
  const byId = new Map(repository.listAgentRoles({ includeArchived: true }).map((role) => [role.id, role]));
  const roles: HubAgentRole[] = [];
  const seen = new Set<string>();
  const add = (id: string): void => {
    if (seen.has(id)) return;
    const role = byId.get(id);
    if (!role) return;
    seen.add(id);
    roles.push(role);
  };
  for (const id of roster.agentIds) add(id);
  for (const crewId of roster.crewIds) {
    try {
      // Crew nesting (WP0.1 / D-CN5) — a member may carry a nested `crewId` instead of an `agentId`;
      // only agent members contribute a role to the roster here (nested-crew resolution is WP2.1).
      for (const member of repository.getCrew(crewId).members) {
        if (member.agentId) add(member.agentId);
      }
    } catch {
      // deleted/unknown crew — skip (resolution parity)
    }
  }
  return roles;
}

/**
 * Union a roster's role server grants into a session's tool scope so those servers stay reachable (the
 * Defect 1a fix). A `null`/`undefined` scope (auto — already every reachable server) or an absent/empty
 * roster is returned UNCHANGED (same reference), so a caller can compare by identity to decide whether to
 * persist a new scope.
 */
export function unionRosterServersIntoScope(
  repository: RosterRepository,
  scope: HubToolGrants | null | undefined,
  roster: HubSessionRoster | null | undefined,
): HubToolGrants | null | undefined {
  if (!scope || !roster) return scope;
  const roles = resolveRosterRoles(repository, roster);
  if (roles.length === 0) return scope;
  return unionRosterServerGrantsIntoScope(scope, roles);
}
