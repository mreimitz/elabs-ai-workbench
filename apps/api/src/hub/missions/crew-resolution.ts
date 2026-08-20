// Crew nesting (planning/Roadmap/RM-10-crew-nesting/, WP1.1, D-CN4/D-CN5) — the pure, repository-free crew-graph
// resolution heart. Two functions over a `Map<crewId, HubCrew>` substrate with DELIBERATELY DIFFERENT
// cycle postures (D-CN4's two-layer guard, and the WP1.1 "two cycle postures are load-bearing" note):
//
//   - `assertCrewGraphValid` — the AUTHOR-TIME, cycle-REJECTING DFS. Called from the repository's
//     `createCrew`/`updateCrew` (the only layer with crew-read access) BEFORE a write lands, it throws a
//     loud `httpError(400, …)` on a cyclic / missing / over-depth `crewId` member. Reject bad input.
//   - `resolveCrewRollup` — the READ/INSTANTIATE-time, cycle-TOLERANT walk. A corrupt legacy cyclic blob
//     that bypassed the author-time guard must NEVER 500 the read tool or infinite-loop, so this one
//     skips a re-entry edge instead of throwing and returns a bounded count. Display "N agents (T total)".
//
// This module imports ONLY shared types + `httpError` — no repository, no service. WP2.1's run-time
// visited-set/depth belt reuses `resolveCrewRollup`'s cycle-safe traversal; it does not fork it.
import type { HubCrew } from "@mcp-token-footprint/shared";
import { HUB_MISSION_MAX_TOTAL_AGENTS } from "@mcp-token-footprint/shared";
import { httpError } from "../../utils/errors.js";

/**
 * Author-time, cycle-REJECTING crew-graph validation (D-CN4 author-time half). A DFS from `rootId`'s
 * `crewId` members that throws `httpError(400, …)` — never a silent skip — on:
 *
 *   (a) a **cycle**: a `crewId` already on the current path visited-set (starts `{rootId}`) — catches
 *       both self-reference (`A→A`) and a mutual cycle (`A→B→A`);
 *   (b) a **missing** nested crew: a `crewId` absent from `crewsById`;
 *   (c) **over-depth**: reaching a crew node at depth ≥ `maxCrewDepth` (root = depth 0, each `crewId`
 *       member steps +1). So `maxCrewDepth = 1` rejects ANY `crewId` member (the D-CN10 off-switch);
 *       `= 2` allows the root plus one nested level and rejects the second.
 *
 * Only `crewId` members are walked — `agentId` (role) members are inert here, and role EXISTENCE is not
 * this function's concern (a deleted role is an instantiate-time skip). The depth cap + the path set
 * together bound the recursion, so termination never relies on the graph being small.
 */
export function assertCrewGraphValid(params: {
  rootId: string;
  crewsById: ReadonlyMap<string, HubCrew>;
  maxCrewDepth: number;
}): void {
  const { rootId, crewsById, maxCrewDepth } = params;

  const label = (id: string): string => {
    const crew = crewsById.get(id);
    return crew ? `"${crew.name}" (${id})` : `"${id}"`;
  };

  const walk = (crewId: string, path: ReadonlySet<string>, depth: number): void => {
    const crew = crewsById.get(crewId);
    // Only reachable for a `rootId` the caller failed to overlay — children are validated before we
    // ever descend into them, so a real crew always resolves here.
    if (!crew) return;
    for (const member of crew.members) {
      const childId = member.crewId;
      if (childId == null) continue; // an agent (role) member — nothing to descend into
      // (a) cycle — the child is already on the current path (self A→A or mutual A→B→A).
      if (path.has(childId)) {
        throw httpError(
          400,
          `Crew ${label(childId)} forms a cycle in the crew nesting graph — a crew cannot transitively contain itself.`,
        );
      }
      // (b) missing — the referenced nested crew does not exist.
      if (!crewsById.has(childId)) {
        throw httpError(
          400,
          `Crew ${label(crewId)} references a nested crew "${childId}" that does not exist.`,
        );
      }
      // (c) over-depth — the child crew node would sit at depth ≥ the ceiling.
      const childDepth = depth + 1;
      if (childDepth >= maxCrewDepth) {
        throw httpError(
          400,
          `Crew nesting exceeds the maximum depth of ${maxCrewDepth}: nested crew ${label(childId)} would sit at depth ${childDepth}.`,
        );
      }
      walk(childId, new Set([...path, childId]), childDepth);
    }
  };

  walk(rootId, new Set([rootId]), 0);
}

/**
 * Read/instantiate-time, cycle-TOLERANT recursive agent-count rollup (D-CN5/D-CN8 display counts, and
 * WP2.1's instantiate walk). Counts agent-referencing member slots (`member.agentId != null`) at `crew`
 * plus, recursively, each `crewId` child's rollup. A memo (`Map<crewId, number>`) caches each crew's
 * fully-resolved leaf count so a **diamond** (A→B→D, A→C→D) walks D once but **counts it once per
 * referencing path** — each crew instantiates its own copy at run time, so "agents that will run" is the
 * sum over paths, not the distinct-node count. A `crewId` already on the current path (a cycle) is
 * SKIPPED, not thrown — a corrupt legacy blob must terminate with a bounded count, never 500 or loop. A
 * missing `crewId` is likewise skipped (existence is an instantiate-time concern, not a count concern).
 *
 * `maxTotalAgents` (default `HUB_MISSION_MAX_TOTAL_AGENTS`) is a safety bound: once a running count would
 * exceed it, the walk stops and `capped` is `true` — so even a pathological deeply-nested diamond lattice
 * (whose count value can grow exponentially though each node is walked once) returns a bounded number.
 */
export function resolveCrewRollup(params: {
  crew: HubCrew;
  crewsById: ReadonlyMap<string, HubCrew>;
  maxTotalAgents?: number;
}): { totalAgentCount: number; capped: boolean } {
  const { crew, crewsById } = params;
  const maxTotalAgents = params.maxTotalAgents ?? HUB_MISSION_MAX_TOTAL_AGENTS;
  const memo = new Map<string, number>();
  let capped = false;

  // The fully-resolved agent count of the subtree rooted at `node`, memoised by crew id. Bounds itself
  // at `maxTotalAgents` (any larger value can't change the capped-at-ceiling answer) and trips `capped`.
  const subtreeCount = (node: HubCrew, path: Set<string>): number => {
    const cached = memo.get(node.id);
    if (cached !== undefined) return cached;
    path.add(node.id);
    let sum = 0;
    for (const member of node.members) {
      if (member.agentId != null) {
        sum += 1;
      } else if (member.crewId != null) {
        if (!path.has(member.crewId)) {
          // Cycle re-entry is skipped above (tolerated, never thrown).
          const child = crewsById.get(member.crewId);
          if (child) sum += subtreeCount(child, path);
        }
      }
      if (sum > maxTotalAgents) {
        // The running count exceeded the ceiling — clamp, trip the flag, and stop descending.
        sum = maxTotalAgents;
        capped = true;
        break;
      }
    }
    path.delete(node.id);
    memo.set(node.id, sum);
    return sum;
  };

  const totalAgentCount = subtreeCount(crew, new Set<string>());
  return { totalAgentCount, capped };
}
