// Assistant Hub (planning/Roadmap/RM-03-assistant-hub/, WP1.7, §1.3 · D-AH8 · R-SES1) — the pure MISSION-BOARD
// reducer. The single most important invariant of the mission (R-SES1 / the AG-UI rule): the WHOLE
// board — plan, approval, every agent, every report, the synthesis + its partial mark — is
// reconstructible from the parent session's `hub_events` ALONE. This function does exactly that, with
// NO I/O and NO side effects (it renders the mission INERT on replay). The web `MissionBoard`
// reconstructs the same shape independently; this API-side reducer is the replay-fidelity test's
// authoritative source of truth.
//
// Crew nesting (planning/Roadmap/RM-10-crew-nesting/, WP3.1 · D-CN7, R-SES1) — the reducer is now TREE-AWARE. A nested
// mission emits its own `plan_proposed` + per-member `agent_spawned` into the SAME root session log,
// each carrying additive parent-linkage (`parentMissionId` / `parentAgentKey`). The reducer discovers
// every mission node from those events, reduces each node with the EXACT single-mission logic, then
// grafts each sub-mission's members onto its parent crew-node agent's `children` (deepest-first) and
// rolls cost up per level. A FLAT (un-nested) mission reconstructs to exactly the pre-WP3.1 shape —
// every agent a leaf, no `children` — so nothing about a non-nested mission changes.

import type {
  HubAgentReport,
  HubAutonomyLevel,
  HubEvent,
  HubMissionPlan,
} from "@mcp-token-footprint/shared";

/** The coarse mission phase derivable from the event log alone (distinct from the DB `status`, which
 *  additionally distinguishes `stopped` vs `completed` — not knowable from events without the row). */
export type MissionBoardPhase = "proposed" | "approved" | "running" | "synthesizing" | "done";

/** One agent's board state, derived from its `agent_spawned` (+ `agent_report` when it finished). */
export type MissionBoardAgent = {
  agentSessionId: string;
  key: string;
  roleName: string;
  model: string;
  brief?: string;
  index: number;
  /** The structured report once the agent finished; absent while running / when skipped (partial). */
  report?: HubAgentReport;
  reported: boolean;
  /** Crew nesting (WP3.1) — a CREW-NODE agent's expanded sub-mission members (recursively grafted).
   *  Absent on a leaf agent (the un-nested case). Set by matching a sub-mission's `parentAgentKey`
   *  against this node's `key`. */
  children?: MissionBoardAgent[];
  /** Crew nesting (WP3.1) — the sub-mission id a crew-node agent expanded into (the {@link children}'
   *  home mission). Absent on a leaf. Lets a drill-down reconstruct the sub-mission board by id. */
  subMissionId?: string;
  /** Crew nesting (WP3.1) — the agent's ROLLED cost (USD): a LEAF's own `agent_report.costUsd`, or a
   *  crew node's `sum(children rolled cost)` (its own PROJECTED report cost is deliberately IGNORED to
   *  avoid double-counting — WP2.1 stamps that with the full sub-mission total). Absent when unknown
   *  (a pre-WP2.4 log carried no per-agent cost). The whole-tree total = the sum of all leaf costs. */
  costUsd?: number;
};

/** The fully-reconstructed mission board (replay-inert). */
export type MissionBoardState = {
  missionId: string;
  plan: HubMissionPlan;
  phase: MissionBoardPhase;
  autonomy?: HubAutonomyLevel;
  approved: boolean;
  autoApproved: boolean;
  agents: MissionBoardAgent[];
  synthesis?: { messageId?: string; partial: boolean; agentReportRefs: string[] };
};

/** Crew nesting (WP3.1 / D-CN4) — the reducer's own defensive depth cap for the parent-chain walks (the
 *  run-time engine's `HUB_MISSION_MAX_DEPTH` is the real guard; this only bounds a corrupt/cyclic log). */
const MAX_TREE_DEPTH = 64;

/** Crew nesting (WP3.1) — a single mission NODE's parent-linkage as recorded on the event log (`{}` for
 *  the root). Derived from `plan_proposed` (load-bearing) with an `agent_spawned` fallback (mirror). */
type NodeLink = { parentMissionId?: string; parentAgentKey?: string };

/**
 * Reduce ONE mission node's board from the log, using ONLY events tagged with `missionId`. This is the
 * EXACT pre-WP3.1 single-mission logic, factored out and parameterized by the node's id (so it no longer
 * derives the id itself). `plan_updated` overrides the proposed plan; agents come from `agent_spawned`
 * (ordered by their `index`), each gaining its `report` + `costUsd` from the matching `agent_report`; the
 * phase advances proposed → approved → running → synthesizing/done. Returns `undefined` when the node has
 * no plan (no `plan_proposed`/`plan_updated`). Deterministic + side-effect-free (R-SES1).
 */
function reduceMissionNode(
  events: readonly HubEvent[],
  missionId: string,
): MissionBoardState | undefined {
  let plan: HubMissionPlan | undefined;
  let phase: MissionBoardPhase = "proposed";
  let approved = false;
  let autoApproved = false;
  let autonomy: HubAutonomyLevel | undefined;
  const agents = new Map<string, MissionBoardAgent>();
  let synthesis: MissionBoardState["synthesis"];

  for (const event of events) {
    switch (event.type) {
      case "plan_proposed":
        if (event.missionId === missionId) {
          plan = event.plan;
          phase = "proposed";
        }
        break;
      case "plan_updated":
        if (event.missionId === missionId) plan = event.plan;
        break;
      case "plan_approved":
        if (event.missionId === missionId) {
          approved = true;
          autoApproved = event.auto === true;
          autonomy = event.autonomy ?? autonomy;
          if (phase === "proposed") phase = "approved";
        }
        break;
      case "mission_started":
        if (event.missionId === missionId) phase = "running";
        break;
      case "agent_spawned":
        if (event.missionId === missionId) {
          agents.set(event.agentSessionId, {
            agentSessionId: event.agentSessionId,
            key: event.key,
            roleName: event.roleName,
            model: event.model,
            ...(event.brief ? { brief: event.brief } : {}),
            index: event.index ?? agents.size,
            reported: false,
          });
        }
        break;
      case "agent_report": {
        if (event.missionId !== missionId) break;
        const agent = agents.get(event.agentSessionId);
        if (agent) {
          agent.report = event.report;
          agent.reported = true;
          // Crew nesting (WP3.1) — carry the agent's REAL cost from the event (WP2.4). For a LEAF this is
          // its rolled cost as-is; a crew node's is OVERWRITTEN by the children roll-up in `rollUpCost`.
          if (event.costUsd !== undefined) agent.costUsd = event.costUsd;
        }
        break;
      }
      case "mission_synthesis":
        if (event.missionId === missionId) {
          phase = "done";
          synthesis = {
            ...(event.messageId ? { messageId: event.messageId } : {}),
            partial: event.partial === true,
            agentReportRefs: event.agentReportRefs ?? [],
          };
        }
        break;
      default:
        break;
    }
  }

  if (!plan) return undefined;
  const orderedAgents = [...agents.values()].sort((a, b) => a.index - b.index);
  if (phase === "running" && synthesis) phase = "done";

  return {
    missionId,
    plan,
    phase,
    ...(autonomy ? { autonomy } : {}),
    approved,
    autoApproved,
    agents: orderedAgents,
    ...(synthesis ? { synthesis } : {}),
  };
}

/**
 * Crew nesting (WP3.1) — roll cost up bottom-up over one agent subtree, MUTATING each crew node's
 * `costUsd` to the sum of its children's rolled costs (its own projected report cost is ignored — the
 * no-double-count rule). Returns this agent's rolled cost: a leaf's own `costUsd ?? 0`, or the children
 * sum. Deterministic; the returned tree total = the sum of all leaf costs.
 */
function rollUpCost(agent: MissionBoardAgent): number {
  if (agent.children && agent.children.length > 0) {
    let sum = 0;
    for (const child of agent.children) sum += rollUpCost(child);
    agent.costUsd = sum;
    return sum;
  }
  return agent.costUsd ?? 0;
}

/**
 * Crew nesting (WP3.1 / D-CN7, R-SES1) — reconstruct the WHOLE mission tree from a root session's event
 * log. Returns `{ rootId, byId }` where `byId` maps EVERY tree-member mission id → its own reconstructed
 * `MissionBoardState` (crew-node agents already carrying grafted `children` + rolled `costUsd`), so the
 * root board and a per-mission drill share one computation. `undefined` when the session has no mission.
 *
 * The root is the LATEST `plan_proposed` whose `parentMissionId` is undefined (NOT merely the latest
 * `plan_proposed`, which — now that sub-missions emit their own — could be a nested node). Only missions
 * whose parent-chain transitively reaches THAT root are in the tree (a prior re-propose's stale
 * sub-missions are excluded). Pure + deterministic.
 */
function buildMissionTree(
  events: readonly HubEvent[],
): { rootId: string; byId: Map<string, MissionBoardState> } | undefined {
  // (1) Root identity — the latest ROOT-level `plan_proposed` (no `parentMissionId`).
  let rootId: string | undefined;
  const links = new Map<string, NodeLink>();
  const missionIds = new Set<string>();
  for (const event of events) {
    if (event.type === "plan_proposed") {
      missionIds.add(event.missionId);
      links.set(event.missionId, {
        ...(event.parentMissionId ? { parentMissionId: event.parentMissionId } : {}),
        ...(event.parentAgentKey ? { parentAgentKey: event.parentAgentKey } : {}),
      });
      if (event.parentMissionId === undefined) rootId = event.missionId;
    } else if (event.type === "plan_updated") {
      missionIds.add(event.missionId);
    } else if (event.type === "agent_spawned") {
      missionIds.add(event.missionId);
      // Mirror fallback (robust to ordering): record linkage from a spawn only if `plan_proposed` did not.
      if (event.parentMissionId !== undefined && !links.has(event.missionId)) {
        links.set(event.missionId, {
          parentMissionId: event.parentMissionId,
          ...(event.parentAgentKey ? { parentAgentKey: event.parentAgentKey } : {}),
        });
      }
    }
  }
  if (rootId === undefined) return undefined;

  // (2) Tree membership — the root plus every mission whose parent-chain transitively reaches it (cycle-
  //     and depth-guarded, D-CN4). A stale earlier root's sub-missions never reach the CURRENT root.
  const reachesRoot = (missionId: string): boolean => {
    let cursor: string | undefined = missionId;
    const seen = new Set<string>();
    for (let depth = 0; cursor !== undefined && depth <= MAX_TREE_DEPTH; depth++) {
      if (cursor === rootId) return true;
      if (seen.has(cursor)) return false;
      seen.add(cursor);
      cursor = links.get(cursor)?.parentMissionId;
    }
    return false;
  };
  const depthOf = (missionId: string): number => {
    let cursor: string | undefined = missionId;
    const seen = new Set<string>();
    let depth = 0;
    while (cursor !== undefined && cursor !== rootId && !seen.has(cursor) && depth <= MAX_TREE_DEPTH) {
      seen.add(cursor);
      cursor = links.get(cursor)?.parentMissionId;
      depth++;
    }
    return depth;
  };
  const members = [...missionIds].filter(reachesRoot);

  // (3) Per-node state via the EXACT single-mission logic (only tree members).
  const byId = new Map<string, MissionBoardState>();
  for (const id of members) {
    const state = reduceMissionNode(events, id);
    if (state) byId.set(id, state);
  }
  const rootState = byId.get(rootId);
  if (!rootState) return undefined; // the root has no plan → no board (pre-WP3.1 `!plan` behavior)

  // (4) Assemble the tree DEEPEST-FIRST so a grandchild is grafted onto its crew node before that node's
  //     own mission is grafted upward (the grafted `children` reference the SAME agent objects).
  const nonRoot = members
    .filter((id) => id !== rootId && byId.has(id))
    .sort((a, b) => depthOf(b) - depthOf(a));
  for (const id of nonRoot) {
    const child = byId.get(id);
    const link = links.get(id);
    if (!child || !link?.parentMissionId) continue;
    const parent = byId.get(link.parentMissionId);
    if (!parent) continue; // parent not in the tree (defensive) — skip, never crash
    // Find the parent's CREW-NODE agent whose `key` matches this sub-mission's `parentAgentKey`.
    const pa = parent.agents.find((agent) => agent.key === link.parentAgentKey);
    if (!pa) continue; // a missing crew node is a replay defect the test catches — guard, don't crash
    pa.children = child.agents;
    pa.subMissionId = id;
    // The crew node is `reported` once its sub-mission SYNTHESIZED (mirrors a leaf's `agent_report`);
    // its own projected report (from the parent-log `agent_report`) still populates `pa.report`.
    if (child.synthesis !== undefined) pa.reported = true;
  }

  // (5) Per-level cost roll-up (bottom-up) over the root's agents — recursion reaches every node, and
  //     `byId` states share the same agent objects, so every drill-down node is rolled too.
  for (const agent of rootState.agents) rollUpCost(agent);

  return { rootId, byId };
}

/**
 * Reconstruct the LATEST ROOT mission's board (tree-aware) from a parent session's event log. Returns
 * `undefined` when the session has no mission. Crew-node agents carry their expanded sub-mission members
 * as `children` (recursively) and a rolled per-level `costUsd`; a flat mission is byte-shaped as before.
 * Deterministic + side-effect-free (R-SES1).
 */
export function reconstructMission(events: readonly HubEvent[]): MissionBoardState | undefined {
  const tree = buildMissionTree(events);
  return tree ? tree.byId.get(tree.rootId) : undefined;
}

/**
 * Crew nesting (WP3.1) — reconstruct a SPECIFIC mission node's board by id (the root or any tree-member
 * sub-mission), with its own crew-node `children` grafted + costs rolled. Returns `undefined` when the id
 * is not a member of the current mission tree. The per-mission drill primitive WP3.2 consumes.
 */
export function reconstructMissionById(
  events: readonly HubEvent[],
  missionId: string,
): MissionBoardState | undefined {
  return buildMissionTree(events)?.byId.get(missionId);
}

/** True once the mission has synthesized (a terminal board — the plan card is replaced by the board). */
export function isMissionBoardTerminal(state: MissionBoardState): boolean {
  return state.phase === "done";
}
