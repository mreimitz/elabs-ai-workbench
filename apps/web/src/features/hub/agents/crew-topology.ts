import type { HubAgentRole, HubCrewMember, HubTopology } from "@mcp-token-footprint/shared";
import type { TopoGraphInput } from "../topology-graph";

/**
 * Crew TOPOLOGY vocabulary + the crew-form → topology-graph derivation, extracted verbatim from the
 * (now deleted) `CrewEditor.tsx` by model-identity WP5.1.
 *
 * These three symbols were always the shared half of that module — `crew-profile/TopologySection.tsx`
 * imported them across the feature boundary so the crew profile modal and the old builder could never
 * drift on what "Pipeline"/"Debate"/etc. mean, or on how a crew's shape is graphed. WP4.1 made the
 * builder itself unreachable (its `HubModelPicker` adoption left `CrewEditor`/`CrewLibraryPanel` with
 * no production importer), so the vocabulary now lives here on its own rather than inside a dead
 * component file. Nothing about the values or the derivation changed — this is a move, not a rewrite.
 */

export const TOPOLOGY_SHORT: Record<HubTopology, string> = {
  parallel: "Parallel",
  pipeline: "Pipeline",
  debate: "Debate",
  best_of_n: "Best of N",
};

export const TOPOLOGY_LABELS: Record<HubTopology, string> = {
  parallel: "Parallel — every member works independently",
  pipeline: "Pipeline — ordered hand-offs, each stage feeds the next",
  debate: "Debate — alternating adversarial turns + a resolver",
  best_of_n: "Best of N — independent attempts + a blind judge",
};

/** The `{ topology, members }` slice a crew form must expose to be graphable. This was spelled
 *  `Pick<CrewFormValue, "topology" | "members">` while `CrewFormValue` lived in `CrewEditor.tsx`;
 *  it is structurally identical, so every existing caller type-checks unchanged. The crew profile
 *  modal's own form value remains a compatible superset. */
export type CrewTopoFormValue = {
  topology: HubTopology;
  members: HubCrewMember[];
};

/** Build the live topology-graph preview input from the current crew form (static — every node "idle";
 *  the SHAPE, not live run state). Members map to nodes in order; a deleted role reads "(deleted role)".
 *  The crew profile modal's Topology section default renderer calls this directly instead of
 *  re-deriving the same node/edge shape, per the workstream's "shared renderer — import, not
 *  duplicate" rule (D-HUX9's topology-true edges live in `topology-graph.ts`'s `deriveTopologyGraph`,
 *  which this function feeds; the org-chart canvas reuses that SAME pure function). */
export function crewFormToTopoInput(
  value: CrewTopoFormValue,
  roleById: Map<string, HubAgentRole>,
): TopoGraphInput {
  return {
    topology: value.topology,
    agents: value.members.flatMap((member, index) => {
      // Crew nesting (WP0.1 / D-CN5) — `agentId` is optional; a nested-crew member isn't graphed in this
      // preview yet (nested rendering is a later WP), so drop it here (no change for agent members).
      const roleId = member.agentId;
      if (!roleId) return [];
      const role = roleById.get(roleId);
      const agentIdSlice = roleId.slice(0, 6);
      return [
        {
          id: `${roleId}-${index}`,
          title: role?.name ?? `(deleted role · ${agentIdSlice})`,
          subtitle: member.model ?? role?.defaultModel ?? "",
          state: "idle" as const,
        },
      ];
    }),
    terminal: { state: "idle" },
  };
}
