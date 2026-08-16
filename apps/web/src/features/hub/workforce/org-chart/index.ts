// Assistant Hub UX (roadmap/assistant-hub-ux/, WP2.5) — the workforce Org chart public surface.
//
// For Wave-2 integration: pass `<OrgChartTab />` as `WorkforceView`'s `orgChartTab` slot.
// For WP2.4 (crew-profile Topology section): import `CrewTopologyGraph` + `buildCrewTopologyEdges`
// (dependency-light — neither pulls the Org chart tab's fetching / scope / inspector machinery).

export { OrgChartTab, OrgInspectorBody, OrgLegend, buildOrgProfilePath, nodeNavigationTarget } from "./OrgChartTab";
export type { OrgNavTarget } from "./OrgChartTab";

// Reusable single-crew topology renderer + the pure edge-builder WP2.4 consumes.
export { CrewTopologyGraph } from "./CrewTopologyGraph";
export type { CrewTopologyGraphProps } from "./CrewTopologyGraph";
export {
  buildCrewTopologyEdges,
  memberTopologyRole,
  TOPOLOGY_EDGE_MEANING,
  TOPOLOGY_LABEL,
} from "./topology-edges";
export type { OrgTopologyEdge } from "./topology-edges";

export { buildCrewMemberLayout, crewMemberNodeId, MEMBER_NODE_H, MEMBER_NODE_W } from "./crew-layout";
export type { CrewLayout, CrewMemberMeta, OrgFlowEdge, OrgMemberNode } from "./crew-layout";

export { buildOrgChartModel } from "./org-model";
export type { BuildOrgChartInput, OrgChartModel, OrgLegendCrew, OrgNodeMeta } from "./org-model";
