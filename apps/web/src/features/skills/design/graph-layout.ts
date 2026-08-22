import {
  DEFAULT_SKILL_FLOW_ID,
  type SkillGraph,
  type SkillGraphEdge,
  type SkillGraphNode,
  type TriggerKind,
} from "@mcp-token-footprint/shared";
// `Position` is a plain string enum from React Flow (a direct dependency) — importing it keeps this
// module pure (no component code runs) while letting the layout OWN the handle-side contract.
import { Position } from "@xyflow/react";

// ── Deterministic layered layout with flow lanes (WP 1.3, geometry reworked in WP 7.2/SI4) ───────
// A hand-rolled layering over the graph IR — no layout dependency (per the WP note: "no new layout
// dependency without owner approval"). Pure function: the same graph always yields the same
// positions (required by the WP acceptance: "same graph → same positions").
//
// Shape of a projected graph (apps/api/src/skillflow/projector.ts): every markdown heading becomes
// exactly one "section" node — usually `subroutine`/`gatekeeper`, but an in-file `skillflow:gate`
// annotation can turn a HEADING itself into a `validation_gate` node (see the "annotated" fixture).
// Everything else (an inferred `asset`/`validation_gate`/`loop_guard`/`tool_ref`) is a leaf
// accessory attached to the section that references it via an incoming edge, and — critically —
// accessories never have an OUTGOING edge of their own, while every section does (to the next
// section and/or its own accessories). So "does this node have an outgoing edge" is what actually
// distinguishes a section from an accessory, not the node's `kind` — kind alone under-counts
// annotated section-level gates. `entry_point` nodes (Skill IDE I1) always head a flow, so they are
// section-like by kind too.
//
// WP 7.2 geometry (audit SI4 — every edge must attach LEFT/RIGHT, never top/bottom):
//   - PRIMARY (section) nodes form the horizontal RANK axis, advancing left-to-right in document
//     order (`anchor.startLine`) — the reading order of the SKILL.md itself. One rank per section,
//     `RANK_STEP` apart, leaving a clear `RANK_GAP` between node boxes (nodes render at the fixed
//     `NODE_WIDTH`, so step − width = gap).
//   - SECONDARY (accessory) nodes drop into the column AFTER their owning section (owner rank + 1),
//     on rows below the section row, stacking downward when a column hosts more than one. With
//     side-mounted handles (source Right / target Left) this keeps every section→accessory edge
//     flowing strictly FORWARD (down-right) — an accessory directly below its own section would
//     force the edge to exit right and hook BACKWARD into the accessory's left side.
//   - Anything left over (an orphan with no owning edge) falls back to the tail of the rank axis in
//     document order — every node always gets a position; layout never throws.
//
// FLOW LANES (WP 1.3): nodes are grouped into bands by `flowId` (absent ⇒ `'main'`). Band order is
// `'main'` first, then the command flows in document order (their entry point's `anchor.startLine`).
// Each band runs the SAME primary/accessory algorithm above (a horizontal strip), then is offset
// downward by a running `laneBaseY` (previous band's lowest element + one `LANE_GAP`) so bands never
// overlap. A single-flow graph (every node on `'main'`) collapses to ONE band at `laneBaseY = 0`.

export type NodePosition = { x: number; y: number };

/** One flow band — its id, a human label (the flow's `/command` token or "Main flow"), the entry
 *  point's trigger when it has one, and the band's top edge in layout coords (row 0 of the band). */
export type SkillLane = {
  flowId: string;
  label: string;
  trigger?: { type: TriggerKind; value: string };
  baseY: number;
};

/** Section-like kinds always occupy the main column even without an outgoing edge; `entry_point`
 *  heads its flow so it is always primary too. */
const SECTION_LIKE_KINDS: ReadonlySet<SkillGraphNode["kind"]> = new Set([
  "subroutine",
  "gatekeeper",
  "entry_point",
]);

// ── WP 7.2 — the geometry contract the canvas renders against ───────────────────────────────────
/** The fixed width every laid-out node box renders at (the canvas wrapper applies `w-56` = 224px)
 *  so columns align and rank spacing is deterministic — an unbounded box could overlap its
 *  neighbour rank. */
export const NODE_WIDTH = 224;
/** Approximate rendered `FlowNode` height (kind eyebrow + title + optional subtitle) — used only to
 *  reason about vertical clearance; nothing hardcodes a box to this. */
export const NODE_HEIGHT_ESTIMATE = 72;
/** Clear horizontal space between one rank's node box and the next rank's (WP 7.2 asks ~180–220px
 *  so edges + condition labels have room between columns). */
export const RANK_GAP = 196;
/** Horizontal step between successive rank columns (box + gap). */
export const RANK_STEP = NODE_WIDTH + RANK_GAP;
/** Every node's outgoing edges leave on the RIGHT, incoming arrive on the LEFT (audit SI4 — the
 *  left-to-right layout must never attach an edge to a node's top/bottom). The canvas renders its
 *  handles from these constants, so layout and handles cannot drift apart. */
export const NODE_SOURCE_POSITION = Position.Right;
export const NODE_TARGET_POSITION = Position.Left;
/** Stable handle ids: every edge binds explicitly to the side handles (never to a hidden legacy
 *  top/bottom handle). */
export const SOURCE_HANDLE_ID = "out";
export const TARGET_HANDLE_ID = "in";
/** How far ABOVE the row line a rank-skipping same-row edge arcs so it clears the boxes it would
 *  otherwise cut straight through (measured from the source handle's y). */
export const SKIP_EDGE_ARC = 56;

const PRIMARY_Y = 0;
/** Vertical drop from a column's section row to the accessory row beneath it (and between stacked
 *  accessories in one column) — `NODE_HEIGHT_ESTIMATE` + ~48px clearance, so boxes never touch. */
const ACCESSORY_STEP = 120;
/** Blank vertical space inserted between two flow lanes (stacked top-to-bottom) so their nodes never
 *  touch. Each lane is a horizontal strip; successive lanes stack downward. */
export const LANE_GAP = 160;

/** The flow a node/edge belongs to — additive `flowId`, absent ⇒ the default `'main'` body flow. */
function flowOf(item: { flowId?: string }): string {
  return item.flowId ?? DEFAULT_SKILL_FLOW_ID;
}

/** Stable order: document position first (`anchor.startLine`), then node id as a tie-breaker. */
function byDocumentOrder(a: SkillGraphNode, b: SkillGraphNode): number {
  return a.anchor.startLine - b.anchor.startLine || a.id.localeCompare(b.id);
}

/** For every node, the id of the first edge's source that points AT it (its "owner"), if any. */
function buildOwnerMap(edges: SkillGraphEdge[], nodeIds: ReadonlySet<string>): Map<string, string> {
  const owner = new Map<string, string>();
  for (const edge of edges) {
    if (!owner.has(edge.to) && nodeIds.has(edge.from)) {
      owner.set(edge.to, edge.from);
    }
  }
  return owner;
}

/** The nearest primary node at-or-before `startLine` in document order, else the first primary node. */
function nearestPrimaryIndex(startLine: number, primary: SkillGraphNode[]): number {
  let best = 0;
  for (let i = 0; i < primary.length; i += 1) {
    if ((primary[i] as SkillGraphNode).anchor.startLine <= startLine) best = i;
    else break;
  }
  return best;
}

/**
 * Lay a SINGLE flow band out LEFT-TO-RIGHT relative to its own origin (rank 0 at `x = 0`, the
 * section row at `y = 0`). Scoped to the band's own nodes + the edges whose BOTH endpoints live in
 * the band (intra-band edges only — a cross-flow edge must not make a node in one lane "own" a node
 * in another). Returns each placed node's band-relative position plus the band's lowest `y` (how far
 * the accessory rows drop below the section row — the band's height).
 */
function layoutBand(
  bandNodes: SkillGraphNode[],
  intraEdges: SkillGraphEdge[],
): { positions: Map<string, NodePosition>; maxY: number } {
  const positions = new Map<string, NodePosition>();
  const nodeIds = new Set(bandNodes.map((n) => n.id));
  const hasOutgoingEdge = new Set(intraEdges.map((e) => e.from));
  const isPrimary = (node: SkillGraphNode): boolean =>
    SECTION_LIKE_KINDS.has(node.kind) || hasOutgoingEdge.has(node.id);

  // Primary (section) nodes form the horizontal rank axis: one column per section, left-to-right in
  // document order (the reading order of the SKILL.md).
  const primary = bandNodes.filter(isPrimary).sort(byDocumentOrder);
  const rankOf = new Map<string, number>();
  let maxY = 0;
  primary.forEach((node, rank) => {
    rankOf.set(node.id, rank);
    positions.set(node.id, { x: rank * RANK_STEP, y: PRIMARY_Y });
  });

  const owner = buildOwnerMap(intraEdges, nodeIds);
  const secondary = bandNodes.filter((n) => !isPrimary(n)).sort(byDocumentOrder);

  // Accessories drop into the column AFTER their owning section (owner rank + 1), stacking downward
  // when a column hosts more than one (so siblings never overlap). Forward placement keeps the
  // section→accessory edge flowing left-to-right into the accessory's LEFT handle; the owning
  // section's own column stays clear for the straight section→section spine.
  const placedInColumn = new Map<number, number>();

  for (const node of secondary) {
    const ownerId = owner.get(node.id);
    const ownerRank =
      ownerId !== undefined && rankOf.has(ownerId) ? (rankOf.get(ownerId) as number) : undefined;
    const column =
      ownerRank !== undefined
        ? ownerRank + 1
        : primary.length > 0
          ? nearestPrimaryIndex(node.anchor.startLine, primary) + 1
          : 0;
    const slot = placedInColumn.get(column) ?? 0;
    placedInColumn.set(column, slot + 1);
    const y = (slot + 1) * ACCESSORY_STEP;
    positions.set(node.id, { x: column * RANK_STEP, y });
    if (y > maxY) maxY = y;
  }

  // Defensive fallback: any node neither primary nor resolved above (should not happen given the
  // projector's contract) still gets a position, appended to the tail of the section rank axis
  // (row 0 of a tail column is never occupied by an accessory, which always sits on rows 1+).
  let tail = primary.length;
  for (const node of bandNodes) {
    if (!positions.has(node.id)) {
      positions.set(node.id, { x: tail * RANK_STEP, y: PRIMARY_Y });
      tail += 1;
    }
  }

  return { positions, maxY };
}

/** The band order for a graph: `'main'` first (when present), then command flows in the projector's
 *  document order (`graph.flows`), then — defensively — any leftover present flow id by its entry
 *  point's `anchor.startLine`. Only flows that actually own a node get a band. */
function orderedFlowIds(graph: SkillGraph, byId: Map<string, SkillGraphNode>): string[] {
  const present = new Set(graph.nodes.map(flowOf));
  const order: string[] = [];
  const seen = new Set<string>();
  if (present.has(DEFAULT_SKILL_FLOW_ID)) {
    order.push(DEFAULT_SKILL_FLOW_ID);
    seen.add(DEFAULT_SKILL_FLOW_ID);
  }
  for (const flow of graph.flows ?? []) {
    if (flow.id !== DEFAULT_SKILL_FLOW_ID && present.has(flow.id) && !seen.has(flow.id)) {
      order.push(flow.id);
      seen.add(flow.id);
    }
  }
  const entryStart = (flowId: string): number =>
    byId.get(flowId)?.anchor.startLine ?? Number.MAX_SAFE_INTEGER;
  const leftover = [...present].filter((id) => !seen.has(id));
  leftover.sort((a, b) => entryStart(a) - entryStart(b) || a.localeCompare(b));
  order.push(...leftover);
  return order;
}

/** The human label + trigger for a flow band. Prefers `graph.flows[*].label` (the `/command` token,
 *  or "Main flow"); falls back to the band's entry-point node, then the flow id. */
function laneMeta(
  flowId: string,
  graph: SkillGraph,
  byId: Map<string, SkillGraphNode>,
): { label: string; trigger?: { type: TriggerKind; value: string } } {
  const entry = byId.get(flowId);
  const trigger = entry && entry.kind === "entry_point" ? entry.trigger : undefined;
  const declared = graph.flows?.find((flow) => flow.id === flowId)?.label;
  const label = declared ?? (entry ? entry.label : flowId);
  return trigger ? { label, trigger } : { label };
}

/**
 * Project a `SkillGraph` into a `{ x, y }` position per node id PLUS the ordered flow lanes.
 * Deterministic and pure — no randomness, no I/O, no dependency on render order.
 */
export function layoutSkillGraphWithLanes(graph: SkillGraph): {
  positions: Map<string, NodePosition>;
  lanes: SkillLane[];
} {
  const positions = new Map<string, NodePosition>();
  const lanes: SkillLane[] = [];
  const { nodes, edges } = graph;
  if (nodes.length === 0) return { positions, lanes };

  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const order = orderedFlowIds(graph, byId);
  const nodesByFlow = new Map<string, SkillGraphNode[]>();
  for (const node of nodes) {
    const key = flowOf(node);
    const list = nodesByFlow.get(key);
    if (list) list.push(node);
    else nodesByFlow.set(key, [node]);
  }

  let laneBaseY = 0;
  for (const flowId of order) {
    const bandNodes = nodesByFlow.get(flowId) ?? [];
    if (bandNodes.length === 0) continue;
    const bandIds = new Set(bandNodes.map((n) => n.id));
    const intraEdges = edges.filter((e) => bandIds.has(e.from) && bandIds.has(e.to));
    const { positions: bandPositions, maxY } = layoutBand(bandNodes, intraEdges);
    for (const [id, pos] of bandPositions) {
      positions.set(id, { x: pos.x, y: pos.y + laneBaseY });
    }
    lanes.push({ flowId, baseY: laneBaseY, ...laneMeta(flowId, graph, byId) });
    laneBaseY += maxY + LANE_GAP;
  }

  return { positions, lanes };
}

/**
 * Project a `SkillGraph` into a `{ x, y }` position per node id. Thin wrapper over
 * {@link layoutSkillGraphWithLanes} (positions only) — kept for callers that don't need lanes.
 */
export function layoutSkillGraph(graph: SkillGraph): Map<string, NodePosition> {
  return layoutSkillGraphWithLanes(graph).positions;
}

// RM-30 WP 7.8 deleted `layoutSkillLanes` (positions discarded, lanes only). Its ONE consumer was the
// flow picker's option list, and a flow is no longer a lane: the picker offers ENTRY POINTS and the
// canvas filters by reachability from one of them. Keeping a "list the lanes" helper around would have
// left a second, quietly wrong answer to "what flows does this skill have" sitting in the tree.

/** A same-row edge that spans MORE than one rank step (node origins compared) — it skips over at
 *  least one intermediate column, so the canvas arcs it above the row (see `SKIP_EDGE_ARC`). */
function isSameRowSkip(from: NodePosition, to: NodePosition): boolean {
  return Math.abs(to.y - from.y) < 1 && to.x - from.x > RANK_STEP;
}

/**
 * Midpoint (with a small per-sibling horizontal fan-out) for a condition label attached to `edge`.
 * `siblingIndex`/`siblingCount` are the edge's position among its source node's OTHER
 * condition-carrying outgoing edges — spreads a gatekeeper's branches apart instead of stacking their
 * labels on top of one another.
 *
 * Vertical placement (WP 7.2, LR geometry): a same-row edge between ADJACENT ranks runs along the
 * wire (≈ handle height, `y + 28`) so the label sits ON the connection inside the rank gap; a
 * same-row edge that SKIPS ranks is arced above the row by the canvas, so its label lifts above the
 * row too (`y − 36`) instead of landing on top of an intermediate node. Everything else (accessory
 * drops, backward references) keeps the plain midpoint.
 */
export function edgeLabelPosition(
  positions: Map<string, NodePosition>,
  edge: SkillGraphEdge,
  siblingIndex: number,
  siblingCount: number,
): NodePosition | undefined {
  const from = positions.get(edge.from);
  const to = positions.get(edge.to);
  if (!from || !to) return undefined;
  const fanSpacing = 96;
  const offset = (siblingIndex - (siblingCount - 1) / 2) * fanSpacing;
  const x = (from.x + to.x) / 2 + offset;
  if (isSameRowSkip(from, to)) return { x, y: from.y - 36 };
  if (Math.abs(to.y - from.y) < 1) return { x, y: from.y + 28 };
  return { x, y: (from.y + to.y) / 2 };
}

// ── WP 7.2 — deterministic fit-to-view (closes K3 for real) ─────────────────────────────────────

/** Fraction of each pane dimension kept clear around the fitted graph. */
export const FIT_PADDING_RATIO = 0.15;
/** The readability floor: never auto-fit below this zoom, or node labels shrink past ~11px (the
 *  `FlowNode` title is 14px ⇒ 14 × 0.8 = 11.2px apparent). A graph too wide to fit at this zoom is
 *  anchored to its FIRST rank instead of being centered (which would clip rank 0 off-screen). */
export const READABLE_MIN_ZOOM = 0.8;
/** Never auto-zoom past natural size — a two-node graph should not render billboard-sized. */
export const FIT_MAX_ZOOM = 1;

export type FitBounds = { x: number; y: number; width: number; height: number };
export type FitViewport = { x: number; y: number; zoom: number };

/**
 * Compute the viewport that frames `bounds` inside a `paneWidth`×`paneHeight` canvas:
 *   - zoom = fit-with-padding, clamped to [`READABLE_MIN_ZOOM`, `FIT_MAX_ZOOM`];
 *   - each axis centers when the graph fits, and ANCHORS TO ITS START (left edge / top edge, one
 *     padding in) when it overflows — so the first rank and the first lane are always fully
 *     visible on mount, never clipped by a centered over-wide fit (audit SI4).
 * Pure and unit-testable; returns `undefined` while the pane or the nodes are unmeasured (a later
 * re-fit tick supplies real dimensions).
 */
export function resolveFitViewport(
  bounds: FitBounds,
  paneWidth: number,
  paneHeight: number,
): FitViewport | undefined {
  if (paneWidth <= 0 || paneHeight <= 0 || bounds.width <= 0 || bounds.height <= 0) {
    return undefined;
  }
  const padX = paneWidth * FIT_PADDING_RATIO;
  const padY = paneHeight * FIT_PADDING_RATIO;
  const availableWidth = paneWidth - 2 * padX;
  const availableHeight = paneHeight - 2 * padY;
  const fitZoom = Math.min(availableWidth / bounds.width, availableHeight / bounds.height);
  const zoom = Math.min(Math.max(fitZoom, READABLE_MIN_ZOOM), FIT_MAX_ZOOM);
  const x =
    bounds.width * zoom > availableWidth
      ? padX - bounds.x * zoom
      : (paneWidth - bounds.width * zoom) / 2 - bounds.x * zoom;
  const y =
    bounds.height * zoom > availableHeight
      ? padY - bounds.y * zoom
      : (paneHeight - bounds.height * zoom) / 2 - bounds.y * zoom;
  return { x, y, zoom };
}
