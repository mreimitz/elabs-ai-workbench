// Assistant Hub UX (planning/Roadmap/completed/RM-04-assistant-hub-ux/, WP2.5 · D-HUX9) — the STANDALONE, compact single-crew
// topology renderer. WP2.4's crew-profile "Topology" section drops this in to preview how a crew will
// execute (the same visual the Org chart tab draws inside each crew container). It reuses the shared
// pure `buildCrewMemberLayout` + `buildCrewTopologyEdges`, so it stays dependency-light: WP2.4 imports
// it WITHOUT pulling the Org chart tab's fetching / scope / inspector machinery.

import { CanvasShell, FlowNode, FlowSmartEdge, ZoomControls } from "@elabs-ai/components-flow";
import { Text } from "@elabs-ai/components-ui";
import type { HubAgentRole, HubCrew } from "@mcp-token-footprint/shared";
import { useMemo } from "react";
import { buildCrewMemberLayout } from "./crew-layout";
import { TOPOLOGY_EDGE_MEANING } from "./topology-edges";

// Stable maps (React Flow re-renders / warns if these are re-created each render).
const NODE_TYPES = { brand: FlowNode } as const;
const EDGE_TYPES = { smart: FlowSmartEdge } as const;

export type CrewTopologyGraphProps = {
  crew: HubCrew;
  /** The role library, to resolve each member's display name / title / model. */
  roles: HubAgentRole[];
  /** Accessible summary for the labelled region. Defaults to "<name> topology". */
  ariaLabel?: string;
  /** Height utility (layout only). Defaults to a compact panel height. */
  className?: string;
};

/**
 * Render one crew's execution topology on a read-only `@elabs-ai/components-flow` canvas. An empty crew renders a
 * muted hint (not a blank canvas). Read-and-navigate only — no drag / connect / select (D-HUX9 v1).
 */
export function CrewTopologyGraph({ crew, roles, ariaLabel, className }: CrewTopologyGraphProps) {
  const rolesById = useMemo(() => new Map(roles.map((r) => [r.id, r])), [roles]);
  const layout = useMemo(() => buildCrewMemberLayout(crew, rolesById), [crew, rolesById]);
  const label = ariaLabel ?? `${crew.name} topology`;

  if (layout.nodes.length === 0) {
    return (
      <div
        aria-label={label}
        role="img"
        className="flex h-full min-h-24 items-center justify-center rounded-md border border-dashed border-border bg-muted/30 px-4 py-6"
      >
        <Text tone="muted" className="text-caption">
          Add at least one member to preview the topology.
        </Text>
      </div>
    );
  }

  return (
    <section
      aria-label={label}
      data-testid="crew-topology-graph"
      className={`overflow-hidden rounded-md border border-border bg-card ${className ?? "h-72"}`}
    >
      <CanvasShell
        nodes={layout.nodes}
        edges={layout.edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        edgesFocusable={false}
        panOnDrag
        zoomOnScroll={false}
        minZoom={0.2}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
      >
        <ZoomControls />
      </CanvasShell>
      <span className="sr-only">{TOPOLOGY_EDGE_MEANING[crew.topology]}</span>
    </section>
  );
}
