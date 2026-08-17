// Assistant Hub UX (roadmap/assistant-hub-ux/, WP2.5 · D-HUX8/9) — the PURE Org chart model builder.
// Given the crew + role library and the org rail's `?scope`, it produces the full `@elabs-ai/components-flow`
// node/edge model: one `FlowGroupNode` per crew (tinted by its crew color, member `FlowNode`s
// re-parented inside drawing the crew's real topology), plus an Unassigned / Archived lane. Lanes are
// packed into rows deterministically; every MEMBER position comes from the library's dagre
// auto-layout (`buildCrewMemberLayout` for a pure-agent crew's profile Topology section;
// `buildMixedMemberLayout` here, since a crew's member may now be a nested crew — D-CN8) — no
// hand-placed coordinates (D-HUX9).
//
// Crew nesting (WP4.2 / D-CN8) — `crewLane` is now RECURSIVE: a `crewId` member draws its own nested
// `FlowGroupNode` (parented onto this crew's group via `@xyflow`'s `parentId`, which composes nested
// positioning automatically across arbitrary depth — the one load-bearing insight this WP relies on),
// cycle-safe via an ancestor-path check + a defensive absolute depth cap, same posture as the org
// rail's tree. A dangling or cyclic reference renders a distinct, non-recursing placeholder box.
//
// Framework-free apart from `@elabs-ai/components-flow`'s pure layout helpers + `@xyflow/react` types (the
// `OrgRailScope` import is TYPE-only, erased at build — it never pulls OrgRail's React runtime in), so
// the whole model is unit-testable without a live canvas.

import { FLOW_ALL_SIDE_HANDLES, type FlowGroupNodeData, type FlowNodeData, layoutGraph } from "@elabs-ai/components-flow";
import type { HubAgentRole, HubCrew, HubCrewColor, HubTopology } from "@mcp-token-footprint/shared";
import type { Edge, Node } from "@xyflow/react";
import type { CSSProperties } from "react";
import type { OrgRailScope } from "../OrgRail";
import { resolveCrewClosure } from "../crew-membership";
import {
  buildMixedMemberLayout,
  crewMemberNodeId,
  MEMBER_NODE_H,
  MEMBER_NODE_W,
  type MixedMemberBox,
  type OrgMemberNode,
} from "./crew-layout";
import { memberTopologyRole, TOPOLOGY_LABEL } from "./topology-edges";

// ── Layout metrics (px) — deterministic lane packing around the dagre member layouts ─────────────
const GROUP_PAD_X = 22;
const GROUP_HEADER_H = 48;
const GROUP_PAD_BOTTOM = 22;
const LANE_GUTTER_X = 56;
const LANE_GUTTER_Y = 72;
/** Crew lanes flow left-to-right, wrapping after this many so a wide fleet stays readable. */
const LANES_PER_ROW = 3;
/** Minimum inner content size so an empty crew still draws a real (labelled) container. */
const EMPTY_CONTENT_W = MEMBER_NODE_W;
const EMPTY_CONTENT_H = MEMBER_NODE_H;
/** Crew nesting (WP4.2 / D-CN8) — a defensive cap on RECURSION depth, mirroring the org rail's
 *  `ORG_RAIL_MAX_RENDER_DEPTH`. Never fires in normal operation; it exists so a non-cyclic but
 *  pathological chain can't blow the canvas — same treatment as a genuine cycle (a placeholder box). */
const ORG_CHART_MAX_RENDER_DEPTH = 8;

// ── The model shape ──────────────────────────────────────────────────────────────────────────────

/** Provenance for one node, used by the inspector summary + double-click navigation. */
export type OrgNodeMeta =
  | {
      kind: "agent";
      nodeId: string;
      agentId: string;
      identity: string;
      roleTitle: string;
      model: string;
      topologyRole?: string;
      crewId?: string;
      crewName?: string;
      crewColor?: HubCrewColor;
      archived: boolean;
    }
  | {
      kind: "crew";
      nodeId: string;
      crewId: string;
      crewName: string;
      topology: HubTopology;
      memberCount: number;
      color?: HubCrewColor;
      description?: string;
    }
  | {
      /** Crew nesting (WP4.2 / D-CN8) — a NESTED crew's group meta: same shape as `"crew"` plus the
       *  immediate containing crew's id, so the inspector can show "Nested in <parentCrewName>". A
       *  top-level crew lane keeps the plain `"crew"` kind, unchanged. */
      kind: "sub-crew";
      nodeId: string;
      crewId: string;
      crewName: string;
      topology: HubTopology;
      memberCount: number;
      parentCrewId: string;
      color?: HubCrewColor;
      description?: string;
    }
  | {
      /** Crew nesting (WP4.2 / D-CN8) — a non-recursing placeholder box for a `crewId` member that is
       *  cyclic (already on the render path, or the defensive depth cap was hit) or dangling (the
       *  referenced crew no longer exists). No "Open profile" action — there is nothing to open. */
      kind: "placeholder";
      nodeId: string;
      reason: "cycle" | "missing";
      label: string;
    }
  | { kind: "lane"; nodeId: string; laneId: "unassigned" | "archived"; title: string; count: number };

/** A crew present in the current view that carries a color — the crew-color legend's rows. */
export type OrgLegendCrew = { crewId: string; name: string; color: HubCrewColor };

export type OrgChartModel = {
  nodes: Node[];
  edges: Edge[];
  meta: Map<string, OrgNodeMeta>;
  /** Crews (in this view) that have a color — for the Legend's crew swatches. */
  legendCrews: OrgLegendCrew[];
  /** Distinct topologies present — for the Legend's edge-meaning rows. */
  topologies: HubTopology[];
  /** True when there is nothing to draw for the scope (drives the tab's EmptyState). */
  isEmpty: boolean;
  emptyReason: string;
};

export type BuildOrgChartInput = {
  crews: HubCrew[];
  /** The full role library (active + archived). */
  roles: HubAgentRole[];
  scope: OrgRailScope;
};

// ── Internals ──────────────────────────────────────────────────────────────────────────────────

type Lane = {
  groupNode: Node;
  children: Node[];
  edges: Edge[];
  meta: OrgNodeMeta[];
  width: number;
  height: number;
  /** Force this lane to begin a fresh row (the Unassigned / Archived lane sits below the crews). */
  forceNewRow: boolean;
};

function memberIdentity(role: HubAgentRole | undefined): string {
  return role?.displayName?.trim() || role?.name?.trim() || "Unknown agent";
}

/** Bounding-box origin-normalize a set of positioned nodes (grid lanes have no dagre to normalize). */
function normalizeBounds(nodes: OrgMemberNode[]): { nodes: OrgMemberNode[]; width: number; height: number } {
  if (nodes.length === 0) return { nodes, width: 0, height: 0 };
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const n of nodes) {
    const w = n.width ?? MEMBER_NODE_W;
    const h = n.height ?? MEMBER_NODE_H;
    minX = Math.min(minX, n.position.x);
    minY = Math.min(minY, n.position.y);
    maxX = Math.max(maxX, n.position.x + w);
    maxY = Math.max(maxY, n.position.y + h);
  }
  return {
    nodes: nodes.map((n) => ({ ...n, position: { x: n.position.x - minX, y: n.position.y - minY } })),
    width: maxX - minX,
    height: maxY - minY,
  };
}

/** Group container size + tint style for a lane wrapping `contentW × contentH` of content. */
function groupStyle(contentW: number, contentH: number, color?: HubCrewColor): CSSProperties {
  const width = Math.max(contentW, EMPTY_CONTENT_W) + GROUP_PAD_X * 2;
  const height = GROUP_HEADER_H + Math.max(contentH, EMPTY_CONTENT_H) + GROUP_PAD_BOTTOM;
  // Redirect the component's OWN border token to the crew's theme-aware chart token — a token→token
  // redirect (D-HUX8 "tinted border on the crew container"), never a raw color. Both themes carry
  // --chart-1…5, so it stays correct in light and dark.
  const tint: Record<string, string> = color ? { "--flow-group-border": `var(--${color})` } : {};
  return { width, height, ...tint } as CSSProperties;
}

/** One member's resolved "box-in-box" plan — an agent leaf, a nested crew's own recursive lane, or a
 *  non-recursing placeholder (cycle/missing). Kept internal to `crewLane`. */
type MemberPlan =
  | { kind: "agent"; box: MixedMemberBox; meta: OrgNodeMeta }
  | { kind: "placeholder"; box: MixedMemberBox; meta: OrgNodeMeta }
  | { kind: "nested"; box: MixedMemberBox; lane: Lane };

function placeholderPlan(
  nodeId: string,
  topologyRole: string,
  reason: "cycle" | "missing",
  label: string,
): MemberPlan {
  return {
    kind: "placeholder",
    box: {
      nodeId,
      width: MEMBER_NODE_W,
      height: MEMBER_NODE_H,
      data: { title: label, kind: topologyRole, tone: "warning" } satisfies FlowNodeData,
      topologyRole,
    },
    meta: { kind: "placeholder", nodeId, reason, label },
  };
}

/**
 * One crew's group + its members, RECURSIVE (WP4.2 / D-CN8): a `crewId` member draws its own nested
 * `FlowGroupNode` via a recursive call to this SAME function, re-parented via `parentId` onto this
 * crew's group id — `@xyflow`'s `parentId` chain composes nested-group positioning automatically
 * across arbitrary depth, so no manual cross-level coordinate flattening is needed here.
 *
 * `groupId` is this crew occurrence's own group-node id: `crew:<id>` for a top-level lane (unchanged,
 * byte-for-byte the pre-WP4.2 scheme every existing test/snapshot assumes), or a path-scoped
 * `<parentGroupId>><childCrewId>` for a nested occurrence, so the SAME crew/agent appearing via two
 * different nesting paths never collides on node id (each occurrence renders as its own node — no
 * cross-path dedup/merge in this WP). `ancestorCrewIds` is the render-path chain of crew ids ABOVE
 * this one (empty at the top level); a `crewId` member pointing at any crew already on that path
 * (including this crew itself — a self-reference) is a cycle, and the defensive
 * `ORG_CHART_MAX_RENDER_DEPTH` cap catches a non-cyclic but pathological chain the same way.
 */
function crewLane(
  crew: HubCrew,
  rolesById: Map<string, HubAgentRole>,
  crewsById: Map<string, HubCrew>,
  ancestorCrewIds: readonly string[],
  groupId: string,
): Lane {
  const depth = ancestorCrewIds.length;
  const pathIncludingSelf = [...ancestorCrewIds, crew.id];

  const plans: MemberPlan[] = crew.members.map((member, index): MemberPlan => {
    const topologyRole = memberTopologyRole(crew.topology, index, crew.members.length);
    const nodeId = crewMemberNodeId(groupId, index);

    if (member.agentId) {
      const role = rolesById.get(member.agentId);
      const identity = memberIdentity(role);
      const roleTitle = role?.name?.trim() ?? "";
      const model = (member.model ?? role?.defaultModel)?.trim() ?? "";
      const subtitle = role?.displayName && roleTitle ? roleTitle : model || undefined;
      return {
        kind: "agent",
        box: {
          nodeId,
          width: MEMBER_NODE_W,
          height: MEMBER_NODE_H,
          data: {
            title: identity,
            kind: topologyRole,
            ...(subtitle ? { subtitle } : {}),
            handles: FLOW_ALL_SIDE_HANDLES,
          } satisfies FlowNodeData,
          topologyRole,
        },
        meta: {
          kind: "agent",
          nodeId,
          agentId: member.agentId,
          identity,
          roleTitle,
          model,
          topologyRole,
          crewId: crew.id,
          crewName: crew.name,
          ...(crew.color ? { crewColor: crew.color } : {}),
          archived: false,
        },
      };
    }

    const childId = member.crewId;
    if (!childId) {
      // Malformed member (neither key set) — defensive; the wire schema's `.strict()+.superRefine`
      // blocks this, but a stale/corrupt fetch must never crash the builder.
      return placeholderPlan(nodeId, topologyRole, "missing", "Malformed member");
    }
    if (pathIncludingSelf.includes(childId) || depth >= ORG_CHART_MAX_RENDER_DEPTH) {
      return placeholderPlan(nodeId, topologyRole, "cycle", "Circular reference");
    }
    const childCrew = crewsById.get(childId);
    if (!childCrew) {
      return placeholderPlan(nodeId, topologyRole, "missing", `Deleted crew · ${childId.slice(0, 6)}`);
    }
    const childGroupId = `${groupId}>${childCrew.id}`;
    const childLane = crewLane(childCrew, rolesById, crewsById, pathIncludingSelf, childGroupId);
    return {
      kind: "nested",
      box: {
        nodeId: childGroupId,
        width: childLane.width,
        height: childLane.height,
        data: { title: childCrew.name, kind: topologyRole } satisfies FlowNodeData,
        topologyRole,
      },
      lane: childLane,
    };
  });

  const direction = crew.topology === "debate" ? "LR" : "TB";
  const layout = buildMixedMemberLayout(
    plans.map((p) => p.box),
    crew.topology,
    direction,
  );
  const style = groupStyle(layout.width, layout.height, crew.color);
  const width = Number(style.width);
  const height = Number(style.height);

  const groupData: FlowGroupNodeData & { crewColor?: HubCrewColor } = {
    title: `${crew.name} · ${TOPOLOGY_LABEL[crew.topology]}`,
    childCount: crew.members.length,
    tone: "default",
    ...(crew.color ? { crewColor: crew.color } : {}),
  };
  const groupNode: Node = {
    id: groupId,
    type: "group",
    position: { x: 0, y: 0 },
    data: groupData,
    style,
    selectable: true,
    draggable: false,
    connectable: false,
  };

  // This crew occurrence's OWN meta — "crew" at the top level (unchanged), "sub-crew" (+
  // `parentCrewId`) when nested one or more levels down.
  const parentCrewId = ancestorCrewIds[ancestorCrewIds.length - 1];
  const ownMeta: OrgNodeMeta = parentCrewId
    ? {
        kind: "sub-crew",
        nodeId: groupId,
        crewId: crew.id,
        crewName: crew.name,
        topology: crew.topology,
        memberCount: crew.members.length,
        parentCrewId,
        ...(crew.color ? { color: crew.color } : {}),
        ...(crew.description ? { description: crew.description } : {}),
      }
    : {
        kind: "crew",
        nodeId: groupId,
        crewId: crew.id,
        crewName: crew.name,
        topology: crew.topology,
        memberCount: crew.members.length,
        ...(crew.color ? { color: crew.color } : {}),
        ...(crew.description ? { description: crew.description } : {}),
      };

  const children: Node[] = [];
  const edges: Edge[] = [...layout.edges];
  const meta: OrgNodeMeta[] = [ownMeta];

  for (const plan of plans) {
    const laidNode = layout.nodes.find((n) => n.id === plan.box.nodeId);
    if (!laidNode) continue; // defensive — 1:1 boxes↔layout.nodes, should always resolve
    const position = { x: GROUP_PAD_X + laidNode.position.x, y: GROUP_HEADER_H + laidNode.position.y };

    if (plan.kind === "nested") {
      // Place the child's ALREADY-BUILT groupNode at the dagre-assigned position, parented onto THIS
      // crew's group — `@xyflow`'s `parentId` composes nested positioning automatically. Pass the
      // child's own children/edges/meta through untouched (they're already correctly path-scoped).
      children.push({ ...plan.lane.groupNode, parentId: groupId, extent: "parent", position });
      children.push(...plan.lane.children);
      edges.push(...plan.lane.edges);
      for (const m of plan.lane.meta) meta.push(m);
      continue;
    }

    // agent leaf or a non-recursing cycle/missing placeholder — both a plain "brand" leaf box.
    children.push({
      id: plan.box.nodeId,
      type: "brand",
      position,
      data: laidNode.data,
      parentId: groupId,
      extent: "parent",
      selectable: true,
      draggable: false,
      connectable: false,
    });
    meta.push(plan.meta);
  }

  return { groupNode, children, edges, meta, width, height, forceNewRow: false };
}

/** A grid lane of standalone agents (Unassigned / Archived) — no crew, no topology, no edges. */
function agentGridLane(
  laneId: "unassigned" | "archived",
  title: string,
  roles: HubAgentRole[],
  archived: boolean,
): Lane {
  const groupId = `lane:${laneId}`;
  const rawNodes: OrgMemberNode[] = roles.map((role, i): OrgMemberNode => {
    const identity = memberIdentity(role);
    const model = role.defaultModel?.trim() ?? "";
    return {
      id: `${groupId}::a${i}`,
      type: "brand",
      position: { x: 0, y: 0 },
      width: MEMBER_NODE_W,
      height: MEMBER_NODE_H,
      data: {
        title: identity,
        kind: archived ? "Archived" : "Unassigned",
        ...(model ? { subtitle: model } : {}),
      } satisfies FlowNodeData,
      draggable: false,
      connectable: false,
    };
  });

  const gridded = layoutGraph(rawNodes, [], {
    algorithm: "grid",
    spacing: { x: MEMBER_NODE_W + 40, y: MEMBER_NODE_H + 44 },
  }) as OrgMemberNode[];
  const { nodes: normalized, width, height } = normalizeBounds(gridded);

  const style = groupStyle(width, height);
  const groupNode: Node = {
    id: groupId,
    type: "group",
    position: { x: 0, y: 0 },
    data: { title, childCount: roles.length, tone: "default" } satisfies FlowGroupNodeData,
    style,
    selectable: true,
    draggable: false,
    connectable: false,
  };

  const children: Node[] = normalized.map((n): Node => ({
    ...n,
    parentId: groupId,
    extent: "parent",
    position: { x: GROUP_PAD_X + n.position.x, y: GROUP_HEADER_H + n.position.y },
    selectable: true,
  }));

  const meta: OrgNodeMeta[] = [
    { kind: "lane", nodeId: groupId, laneId, title, count: roles.length },
    ...roles.map((role, i): OrgNodeMeta => ({
      kind: "agent",
      nodeId: `${groupId}::a${i}`,
      agentId: role.id,
      identity: memberIdentity(role),
      roleTitle: role.name?.trim() ?? "",
      model: role.defaultModel?.trim() ?? "",
      archived,
    })),
  ];

  return {
    groupNode,
    children,
    edges: [],
    meta,
    width: Number(style.width),
    height: Number(style.height),
    forceNewRow: true,
  };
}

/** Deterministically pack lanes into rows, writing each group node's absolute position in place. */
function packLanes(lanes: Lane[]): void {
  let cursorX = 0;
  let rowY = 0;
  let rowHeight = 0;
  let laneInRow = 0;
  const newRow = () => {
    cursorX = 0;
    rowY += rowHeight + LANE_GUTTER_Y;
    rowHeight = 0;
    laneInRow = 0;
  };
  for (const lane of lanes) {
    if (laneInRow > 0 && (lane.forceNewRow || laneInRow >= LANES_PER_ROW)) newRow();
    lane.groupNode.position = { x: cursorX, y: rowY };
    cursorX += lane.width + LANE_GUTTER_X;
    rowHeight = Math.max(rowHeight, lane.height);
    laneInRow++;
  }
}

// ── The builder ──────────────────────────────────────────────────────────────────────────────────

/**
 * Build the Org chart's `@elabs-ai/components-flow` model for the given `scope` (D-HUX5's rail scoping):
 *   • default / "all" → every crew as a tinted group + an Unassigned lane (active roles in no crew).
 *   • `crew:<id>`     → that one crew (focused).
 *   • "unassigned"    → the Unassigned lane only.
 *   • "archived"      → the Archived lane only (archived roles).
 * Returns `isEmpty` (+ scope-aware `emptyReason`) rather than a blank canvas when there's nothing to
 * draw, so the tab renders a real EmptyState.
 */
export function buildOrgChartModel({ crews, roles, scope }: BuildOrgChartInput): OrgChartModel {
  const rolesById = new Map(roles.map((r) => [r.id, r]));
  const crewsById = new Map(crews.map((c) => [c.id, c]));
  const activeRoles = roles.filter((r) => !r.archivedAt);
  const archivedRoles = roles.filter((r) => r.archivedAt);
  // Crew nesting (WP4.2 / D-CN8) — recursive, cycle-safe: an agent reachable only via a nested
  // sub-crew counts as assigned too. ONE memo shared across every crew's closure (a diamond is only
  // walked once).
  const closureMemo = new Map<string, ReturnType<typeof resolveCrewClosure>>();
  const assignedIds = new Set<string>();
  for (const crew of crews) {
    const closure = resolveCrewClosure(crew.id, crewsById, closureMemo);
    for (const agentId of closure.agentIds) assignedIds.add(agentId);
  }
  const unassignedRoles = activeRoles.filter((r) => !assignedIds.has(r.id));

  const sortedCrews = [...crews].sort((a, b) => a.name.localeCompare(b.name));

  const lanes: Lane[] = [];
  let emptyReason = "";

  switch (scope.kind) {
    case "crew": {
      const crew = sortedCrews.find((c) => c.id === scope.crewId);
      if (crew) lanes.push(crewLane(crew, rolesById, crewsById, [], `crew:${crew.id}`));
      else emptyReason = "That crew no longer exists. Pick another from the rail.";
      break;
    }
    case "unassigned": {
      if (unassignedRoles.length > 0) {
        lanes.push(agentGridLane("unassigned", "Unassigned", unassignedRoles, false));
      } else emptyReason = "Every agent belongs to a crew — nothing unassigned to show.";
      break;
    }
    case "archived": {
      if (archivedRoles.length > 0) {
        lanes.push(agentGridLane("archived", "Archived", archivedRoles, true));
      } else emptyReason = "No archived agents.";
      break;
    }
    default: {
      // "all" — crews first, then the Unassigned lane on its own row.
      for (const crew of sortedCrews) lanes.push(crewLane(crew, rolesById, crewsById, [], `crew:${crew.id}`));
      if (unassignedRoles.length > 0) {
        lanes.push(agentGridLane("unassigned", "Unassigned", unassignedRoles, false));
      }
      if (lanes.length === 0) {
        emptyReason = "No agents or crews yet. Create an agent to populate the chart.";
      }
      break;
    }
  }

  packLanes(lanes);

  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const meta = new Map<string, OrgNodeMeta>();
  for (const lane of lanes) {
    nodes.push(lane.groupNode, ...lane.children); // parent BEFORE children (React Flow requirement)
    edges.push(...lane.edges);
    for (const m of lane.meta) meta.set(m.nodeId, m);
  }

  // Legend: crews actually drawn in this view (top-level OR nested — WP4.2), only those with a color.
  const shownCrewIds = new Set(
    [...meta.values()]
      .filter(
        (m): m is Extract<OrgNodeMeta, { kind: "crew" | "sub-crew" }> =>
          m.kind === "crew" || m.kind === "sub-crew",
      )
      .map((m) => m.crewId),
  );
  const legendCrews: OrgLegendCrew[] = sortedCrews
    .filter((c) => shownCrewIds.has(c.id) && c.color)
    .map((c) => ({ crewId: c.id, name: c.name, color: c.color as HubCrewColor }));
  const topologies = [
    ...new Set(sortedCrews.filter((c) => shownCrewIds.has(c.id)).map((c) => c.topology)),
  ];

  return {
    nodes,
    edges,
    meta,
    legendCrews,
    topologies,
    isEmpty: lanes.length === 0,
    emptyReason,
  };
}
