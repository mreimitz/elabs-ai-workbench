import type { ReactNode } from "react";
import type { HubAgentRole, HubCrewMember, HubTopology } from "@mcp-token-footprint/shared";
import { HUB_TOPOLOGIES } from "@mcp-token-footprint/shared";
import { Text } from "@elabs-ai/components-ui";
import { DialogSection } from "../../../../components/dialogs";
import { FieldRow } from "../../../../components/FieldRow";
import { SelectField } from "../../../../components/SelectField";
import { crewFormToTopoInput, TOPOLOGY_LABELS, TOPOLOGY_SHORT } from "../../agents/crew-topology";
import { TopologyGraph } from "../../TopologyGraph";

/**
 * Assistant Hub UX WP2.4 (D-HUX6/D-HUX9) — the crew profile modal's Topology section: pick the
 * topology, then preview the crew's REAL execution shape (pipeline chain · parallel fan · debate pair
 * · best-of-N fan-in) — never hand-drawn, always derived from the SAME `deriveTopologyGraph` pure
 * function (`../../topology-graph.ts`) the live mission board already uses, via the exported
 * `crewFormToTopoInput` helper — "shared renderer with 2.5's edge logic — import, not duplicate" (the
 * WP's own text). That helper and the topology labels live in `../../agents/crew-topology.ts` (moved
 * there by model-identity WP5.1 when the old `CrewEditor` builder, their previous home, was deleted).
 *
 * ================================================================================================
 * CROSS-COMPONENT SLOT: `topologyRenderer` (built in parallel by WP2.5, `workforce/org-chart/*`)
 * ================================================================================================
 * WP2.5 owns the Org chart tab's `@elabs-ai/components-flow` canvas rendering EVERY crew's topology at once
 * (`CanvasShell` + `FlowGroupNode` + `FlowNode`, D-HUX9). At Wave-2 integration, pass a
 * `topologyRenderer` node here — built from WP2.5's own node/edge builders scoped to just THIS crew —
 * to replace the default `TopologyGraph` preview below with the same visual language the org chart
 * uses everywhere else. Until then, the default already renders a REAL (not placeholder-textual)
 * preview by reusing `TopologyGraph`/`deriveTopologyGraph` — a genuinely shared renderer that predates
 * this workstream and is NOT owned by WP2.5, so there is nothing to duplicate by using it here too.
 */
export function TopologySection({
  topology,
  members,
  roleById,
  onTopologyChange,
  disabled,
  topologyRenderer,
}: {
  topology: HubTopology;
  members: HubCrewMember[];
  roleById: Map<string, HubAgentRole>;
  onTopologyChange: (next: HubTopology) => void;
  disabled?: boolean;
  /** Slot name: `topologyRenderer` — see the class doc above. */
  topologyRenderer?: ReactNode;
}) {
  return (
    <DialogSection
      title="Topology"
      description="How this crew's members work together once instantiated into a mission."
    >
      <FieldRow id="crew-profile-topology" label="Topology">
        <SelectField
          id="crew-profile-topology"
          label=""
          value={topology}
          onChange={(next) => onTopologyChange(next as HubTopology)}
          options={HUB_TOPOLOGIES.map((value) => ({ value, label: TOPOLOGY_LABELS[value] }))}
          disabled={disabled}
        />
      </FieldRow>

      <div className="flex flex-col gap-1.5">
        <Text className="font-medium">Topology preview</Text>
        {topologyRenderer ?? (
          <TopologyGraph
            input={crewFormToTopoInput({ topology, members }, roleById)}
            ariaLabel={`${TOPOLOGY_SHORT[topology]} topology — ${members.length} member${
              members.length === 1 ? "" : "s"
            }`}
            className="h-64"
          />
        )}
      </div>
    </DialogSection>
  );
}
