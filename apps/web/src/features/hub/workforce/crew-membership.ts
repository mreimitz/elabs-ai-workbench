// Crew nesting (roadmap/crew-nesting/, WP4.2 · D-CN8) — the PURE, cycle-safe, memoised client-side
// closure helper every N-level workforce surface (OrgRail, CrewCard, CrewHeaderCard, DirectoryTab,
// the org-chart canvas) builds its recursive counts/membership from. `apps/api/src/hub/missions/
// crew-resolution.ts`'s WP1.1 read-time rollup is the server-side sibling — it cannot be imported
// here (architecture.md: no web→api source imports), so this is an independent, framework-free
// (no React/brand-ui) reimplementation of the same posture: cycle-TOLERANT, never throws, never loops
// forever, and mirrors its "memoize per crew id, skip a re-entry edge" simplification (a corrupt or
// stale fetch gets a bounded, honest answer — never a 500-equivalent crash or an infinite recursion).
//
// This is display/UI plumbing only — it answers "what does this crew's org-rail row / count badge /
// org-chart legend show", not "what will actually execute" (that remains the API's `resolveCrewRollup`,
// which sums agents PER REFERENCING PATH because each path instantiates its own copy at run time). Here
// a diamond/shared sub-crew's agents are counted once per closure (a Set), which is the right notion
// for "how many distinct agents does this crew reach" — an honest display count, not an execution plan.

import type { HubAgentRole, HubCrew } from "@mcp-token-footprint/shared";

/** The recursive, cycle-safe membership closure of one crew: every agent + every nested crew reachable
 *  transitively through `crewId` members, plus whether a cycle was detected anywhere in the walk. */
export type CrewClosure = { agentIds: Set<string>; crewIds: Set<string>; cyclic: boolean };

/**
 * Recursively resolve `crewId`'s full membership closure over `crewsById` (WP0.1/D-CN5's `HubCrewMember`
 * = exactly one of `agentId` | `crewId`). Cycle-safe: a `crewId` member already on the CURRENT path
 * (`visiting`, which includes `crewId` itself — so a self-reference `A → A` counts too) is never
 * recursed into again — it still counts as one crew reference (`crewIds` gets it) and marks the whole
 * closure `cyclic: true`, it just doesn't re-enter. A `crewId` pointing at nothing in `crewsById`
 * (dangling/deleted crew) is skipped from the count entirely (mirrors the existing "if (!role) return
 * null" skip for an unresolved role member elsewhere in this surface).
 *
 * `memo` caches each crew id's fully-resolved closure so a shared sub-crew referenced from multiple
 * parents (a diamond) is only walked once — callers building counts for MANY crews in one render
 * (OrgRail, the org chart) should build one `Map` via `useMemo` and pass it into every call so the
 * memoization is actually shared (mirrors WP1.1's "memoised" rollup helper).
 */
export function resolveCrewClosure(
  crewId: string,
  crewsById: ReadonlyMap<string, HubCrew>,
  memo: Map<string, CrewClosure> = new Map(),
  visiting: ReadonlySet<string> = new Set(),
): CrewClosure {
  const cached = memo.get(crewId);
  if (cached) return cached;

  const crew = crewsById.get(crewId);
  const agentIds = new Set<string>();
  const crewIds = new Set<string>();
  let cyclic = false;

  if (crew) {
    // The path INCLUDING this crew — a member referencing crewId (self-reference) or any ancestor is
    // a cycle. Computed once per crew and threaded to every child call, so a child's own self/ancestor
    // check has the full path available.
    const path = new Set(visiting);
    path.add(crewId);

    for (const member of crew.members) {
      if (member.agentId) {
        agentIds.add(member.agentId);
        continue;
      }
      const childId = member.crewId;
      if (!childId) continue; // malformed member (neither key set) — defensively skip, never crash
      if (!crewsById.has(childId)) continue; // dangling/deleted nested crew — skip from the count
      crewIds.add(childId); // counts as one crew reference regardless of whether it's a cycle
      if (path.has(childId)) {
        cyclic = true; // re-entry edge — never recurse again
        continue;
      }
      const childClosure = resolveCrewClosure(childId, crewsById, memo, path);
      for (const id of childClosure.agentIds) agentIds.add(id);
      for (const id of childClosure.crewIds) crewIds.add(id);
      if (childClosure.cyclic) cyclic = true;
    }
  }

  const closure: CrewClosure = { agentIds, crewIds, cyclic };
  memo.set(crewId, closure);
  return closure;
}

/**
 * "N agents" when the closure has no nested crews (`crewIds.size === 0`) — byte-for-byte today's
 * plain `crew.members.length` count for the common flat-crew case (zero visible change). Otherwise
 * "N agents, M crews (T total)" (D-CN8) so a crew with sub-crews reads honestly instead of a single
 * ambiguous number.
 */
export function formatCrewMembershipCount(closure: CrewClosure): string {
  const agents = closure.agentIds.size;
  if (closure.crewIds.size === 0) {
    return `${agents} agent${agents === 1 ? "" : "s"}`;
  }
  const crews = closure.crewIds.size;
  const total = agents + crews;
  return `${agents} agent${agents === 1 ? "" : "s"}, ${crews} crew${crews === 1 ? "" : "s"} (${total} total)`;
}

/**
 * `crewId`'s full recursive agent closure, resolved to library roles (unresolved/deleted-role ids
 * dropped — mirrors `CrewCard`'s existing avatar-strip skip). Feeds `CrewCard`'s direct+nested member
 * disambiguation and `DirectoryTab`'s `scopedCrewMembers` grid, so the scoped view shows every agent
 * reachable through the whole nested subtree, not just this crew's direct members (D-CN8).
 */
export function resolveCrewAgents(
  crewId: string,
  crewsById: ReadonlyMap<string, HubCrew>,
  rolesById: ReadonlyMap<string, HubAgentRole>,
): HubAgentRole[] {
  const closure = resolveCrewClosure(crewId, crewsById);
  const roles: HubAgentRole[] = [];
  for (const agentId of closure.agentIds) {
    const role = rolesById.get(agentId);
    if (role) roles.push(role);
  }
  return roles;
}
