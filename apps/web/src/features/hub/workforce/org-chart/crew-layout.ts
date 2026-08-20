// Assistant Hub UX (planning/Roadmap/completed/RM-04-assistant-hub-ux/, WP2.5 · D-HUX9) — the PURE, shared per-crew member
// layout: it turns one crew (+ the role library it draws from) into positioned `@elabs-ai/components-flow`
// member nodes and topology-true edges, arranged by the library's own dagre auto-layout
// (`layoutFlow` — NO hand-placed coordinates, D-HUX9). Both {@link buildOrgChartModel} (the Org
// chart tab) and {@link CrewTopologyGraph} (WP2.4's crew-profile Topology section) consume this, so
// a crew reads identically wherever it's drawn.
//
// It imports `@elabs-ai/components-flow`'s pure `layoutFlow` (dagre, "safe to call anywhere, incl. a test") +
// `@xyflow/react` types only — no React — so the produced node/edge MODEL is unit-testable without a
// live canvas (canvas libs render empty geometry under jsdom; we assert the model, not the DOM).

import { FLOW_ALL_SIDE_HANDLES, type FlowLayoutDirection, type FlowNodeData, layoutFlow } from "@elabs-ai/components-flow";
import type { HubAgentRole, HubCrew, HubCrewMember, HubTopology } from "@mcp-token-footprint/shared";
import { type Edge, MarkerType, type Node } from "@xyflow/react";
import { buildCrewTopologyEdges, memberTopologyRole } from "./topology-edges";

/** Member node footprint (px) — a compact card the dagre layout + group sizing reason about. */
export const MEMBER_NODE_W = 208;
export const MEMBER_NODE_H = 60;

/** A branded member node (`nodeTypes={{ brand: FlowNode }}`). */
export type OrgMemberNode = Node<FlowNodeData, "brand">;
/** A branded smart edge (`edgeTypes={{ smart: FlowSmartEdge }}`) — anchors on facing sides. */
export type OrgFlowEdge = Edge;

/** Per-member provenance the Org chart uses for the inspector + double-click navigation. */
export type CrewMemberMeta = {
  nodeId: string;
  agentId: string;
  index: number;
  identity: string;
  roleTitle: string;
  model: string;
  topologyRole: string;
};

export type CrewLayout = {
  /** Member nodes, positioned by dagre and normalized so the crew's own bounding box starts at 0,0. */
  nodes: OrgMemberNode[];
  edges: OrgFlowEdge[];
  /** Bounding-box size of the laid-out members (0×0 for an empty crew). */
  width: number;
  height: number;
  meta: CrewMemberMeta[];
};

/** Stable, unique node id for member `index` of `crewId` (a crew may list the same agent twice). */
export function crewMemberNodeId(crewId: string, index: number): string {
  return `${crewId}::m${index}`;
}

function memberIdentity(role: HubAgentRole | undefined): string {
  return role?.displayName?.trim() || role?.name?.trim() || "Unknown agent";
}

/**
 * Build a crew's positioned member nodes + topology edges. `rolesById` resolves each member's
 * `agentId` to its library role (for the display name / title / model shown on the node); an
 * unresolvable member still renders as an "Unknown agent" node rather than vanishing.
 *
 * Layout direction is chosen from the topology (a data-derived choice, not a hand placement): a
 * `debate`'s facing pairs read best left-to-right; every other shape reads top-to-bottom (a pipeline
 * chain descends, a `parallel` fan spreads below its lead, a `best_of_n` fan-in converges downward).
 */
export function buildCrewMemberLayout(
  crew: HubCrew,
  rolesById: Map<string, HubAgentRole>,
): CrewLayout {
  // Crew nesting (WP0.1 / D-CN5) — `agentId` is optional now; the org chart only knows how to draw
  // AGENT members today (nested-crew rendering is a later WP), so drop nested-crew members. No current
  // crew has one, so this is a no-op for today's data; filtering up front keeps the index-coupled node
  // ids / meta / edges consistent, and the type predicate narrows `agentId` back to `string` below.
  const members = crew.members.filter(
    (m): m is HubCrewMember & { agentId: string } => m.agentId !== undefined,
  );
  if (members.length === 0) {
    return { nodes: [], edges: [], width: 0, height: 0, meta: [] };
  }

  const nodeIds = members.map((_, i) => crewMemberNodeId(crew.id, i));
  const meta: CrewMemberMeta[] = members.map((member, i) => {
    const role = rolesById.get(member.agentId);
    const identity = memberIdentity(role);
    const roleTitle = role?.name?.trim() ?? "";
    const model = (member.model ?? role?.defaultModel)?.trim() ?? "";
    return {
      nodeId: nodeIds[i]!,
      agentId: member.agentId,
      index: i,
      identity,
      roleTitle,
      model,
      topologyRole: memberTopologyRole(crew.topology, i, members.length),
    };
  });

  const rawNodes: OrgMemberNode[] = meta.map((m): OrgMemberNode => {
    // Persona name → show the job title beneath; otherwise show the model the agent runs.
    const role = rolesById.get(m.agentId);
    const subtitle = role?.displayName && m.roleTitle ? m.roleTitle : m.model || undefined;
    return {
      id: m.nodeId,
      type: "brand",
      position: { x: 0, y: 0 },
      width: MEMBER_NODE_W,
      height: MEMBER_NODE_H,
      data: {
        title: m.identity,
        kind: m.topologyRole,
        ...(subtitle ? { subtitle } : {}),
        handles: FLOW_ALL_SIDE_HANDLES,
      },
      draggable: false,
      connectable: false,
    };
  });

  const topoEdges = buildCrewTopologyEdges(crew.topology, nodeIds);
  const edges: OrgFlowEdge[] = topoEdges.map((e) => ({
    id: `${crew.id}::${e.id}`,
    source: e.source,
    target: e.target,
    type: "smart",
    ...(e.directed ? { markerEnd: { type: MarkerType.ArrowClosed } } : {}),
  }));

  const direction = crew.topology === "debate" ? "LR" : "TB";
  const laid = layoutFlow(rawNodes, edges, { direction, nodeSpacing: 44, rankSpacing: 72 });

  // Normalize so the crew's local origin is (0,0) and report the bounding-box size (for group sizing).
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const node of laid.nodes) {
    const w = node.width ?? MEMBER_NODE_W;
    const h = node.height ?? MEMBER_NODE_H;
    minX = Math.min(minX, node.position.x);
    minY = Math.min(minY, node.position.y);
    maxX = Math.max(maxX, node.position.x + w);
    maxY = Math.max(maxY, node.position.y + h);
  }
  const nodes = laid.nodes.map((node) => ({
    ...node,
    position: { x: node.position.x - minX, y: node.position.y - minY },
  }));

  return {
    nodes,
    edges,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
    meta,
  };
}

// ── Crew nesting (WP4.2 / D-CN8) — the box-in-box layout helper ─────────────────────────────────────
//
// `buildCrewMemberLayout` above is left BYTE-FOR-BYTE unchanged (it is also consumed by
// `CrewTopologyGraph.tsx`, the crew-profile Topology section — out of this WP's scope) and it assumes
// every member is a `MEMBER_NODE_W × MEMBER_NODE_H` agent leaf. The org chart's `crewLane` (in
// `org-model.ts`) now has to lay out a MIX of agent leaves and nested-crew GROUPS (whose size is
// whatever their own recursive layout produced), so this is a separate, parallel helper: the same
// `layoutFlow` dagre pass, over caller-supplied box sizes instead of a fixed member footprint.

/** One member's box for `buildMixedMemberLayout` — either an agent leaf's fixed footprint or a nested
 *  crew group's own (already-laid-out) bounding-box size. */
export type MixedMemberBox = {
  nodeId: string;
  width: number;
  height: number;
  /** The eventual `FlowNode` data for a LEAF box (ignored by callers that discard it — a nested-crew
   *  box only needs `width`/`height` from this layout pass, since it already has its own real
   *  `groupNode` built by the recursive `crewLane` call). */
  data: FlowNodeData;
  /** The member's position-derived topology role (`memberTopologyRole`) — folded into `data.kind` when
   *  `data` doesn't already set one, so a caller doesn't have to thread it through twice. */
  topologyRole: string;
};

export type MixedMemberLayout = {
  /** Laid-out boxes, normalized to a 0,0 origin. Each retains its caller-supplied `width`/`height`. */
  nodes: OrgMemberNode[];
  edges: OrgFlowEdge[];
  width: number;
  height: number;
};

/**
 * The generalized sibling of `buildCrewMemberLayout`: the SAME dagre pass + topology-edge wiring
 * (`buildCrewTopologyEdges`, unchanged — it wires by POSITION, not member kind, so an edge to/from a
 * whole nested-crew group needs no special casing here), but over caller-supplied box sizes rather
 * than assuming every member is `MEMBER_NODE_W × MEMBER_NODE_H`. `crewLane` (`org-model.ts`) is the
 * only caller: it builds one box per member (an agent's fixed leaf size, or a nested crew's own
 * recursively-computed `{width, height}`), gets back positions, then places the REAL node for each
 * box — an agent leaf built from `data`, or a nested crew's already-built `groupNode` repositioned.
 */
export function buildMixedMemberLayout(
  boxes: MixedMemberBox[],
  topology: HubTopology,
  direction: FlowLayoutDirection,
): MixedMemberLayout {
  if (boxes.length === 0) {
    return { nodes: [], edges: [], width: 0, height: 0 };
  }

  const nodeIds = boxes.map((box) => box.nodeId);
  const rawNodes: OrgMemberNode[] = boxes.map((box): OrgMemberNode => ({
    id: box.nodeId,
    type: "brand",
    position: { x: 0, y: 0 },
    width: box.width,
    height: box.height,
    data: { ...box.data, kind: box.data.kind ?? box.topologyRole },
    draggable: false,
    connectable: false,
  }));

  const topoEdges = buildCrewTopologyEdges(topology, nodeIds);
  const edges: OrgFlowEdge[] = topoEdges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: "smart",
    ...(e.directed ? { markerEnd: { type: MarkerType.ArrowClosed } } : {}),
  }));

  const laid = layoutFlow(rawNodes, edges, { direction, nodeSpacing: 44, rankSpacing: 72 });

  // Normalize so the local origin is (0,0) and report the bounding-box size (for the caller's own
  // group sizing) — identical normalization to `buildCrewMemberLayout` above.
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const node of laid.nodes) {
    const w = node.width ?? MEMBER_NODE_W;
    const h = node.height ?? MEMBER_NODE_H;
    minX = Math.min(minX, node.position.x);
    minY = Math.min(minY, node.position.y);
    maxX = Math.max(maxX, node.position.x + w);
    maxY = Math.max(maxY, node.position.y + h);
  }
  const nodes = laid.nodes.map((node) => ({
    ...node,
    position: { x: node.position.x - minX, y: node.position.y - minY },
  }));

  return {
    nodes,
    edges,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  };
}
