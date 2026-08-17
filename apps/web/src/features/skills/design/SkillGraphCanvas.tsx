import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import {
  DEFAULT_SKILL_FLOW_ID,
  type SkillGraph,
  type SkillGraphEdge,
  type ToolDiagnostic,
  type TraceVerdictStatus,
  type TriggerKind,
} from "@mcp-token-footprint/shared";
import {
  Badge,
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ScrollArea,
  Text,
} from "@elabs-ai/components-ui";
import type {
  BrandFlowNode,
  Connection,
  Edge,
  EdgeProps,
  FlowNodeData,
  LegendItem,
  Node,
  NodeProps,
} from "@elabs-ai/components-flow";
import { CanvasShell, FlowNode, useNodesState, useReactFlow, ZoomControls } from "@elabs-ai/components-flow";
// `@elabs-ai/components-flow` does not re-export these React Flow building blocks, so they come from the direct
// `@xyflow/react` dependency: `Handle` because the brand `FlowNode` hardcodes its handles to
// Top/Bottom (an upstream gap — it ignores a node's `sourcePosition`/`targetPosition`, see
// `CanvasNodeView`), the smoothstep path for the LR edge, and the store hook for pane dimensions.
import { BaseEdge, getSmoothStepPath, Handle, useStoreApi } from "@xyflow/react";
import { AlertTriangle, HelpCircle, Play, Waypoints } from "lucide-react";
import {
  edgeLabelPosition,
  FIT_MAX_ZOOM,
  FIT_PADDING_RATIO,
  layoutSkillGraphWithLanes,
  NODE_HEIGHT_ESTIMATE,
  NODE_SOURCE_POSITION,
  NODE_TARGET_POSITION,
  NODE_WIDTH,
  RANK_STEP,
  READABLE_MIN_ZOOM,
  resolveFitViewport,
  SKIP_EDGE_ARC,
  SOURCE_HANDLE_ID,
  TARGET_HANDLE_ID,
} from "./graph-layout";
import { diagnosticsInRange, NODE_KIND_META } from "./node-kind-meta";
import {
  EDGE_KIND_EXPLAINER_IDS,
  explainerFor,
  NODE_KIND_EXPLAINER_IDS,
} from "./code-intel/explainers";
import { TOOL_DRAG_MIME, type ToolDragPayload } from "./ToolsPalette";
import { PREVIEW_NODE_PREFIX } from "./use-edit-ops";
import { getToolDiagnostics } from "../skills-inspector-api";

/** The keys that delete the selected element on the editable canvas (WP 2.2 — disconnect an asset). */
const EDIT_DELETE_KEYS = ["Backspace", "Delete"];

/** K3/WP 7.2 — options for React Flow's own FIRST-render fit (`fitView` prop): the shared padding
 *  plus the readability clamp, so even the pre-measure frame never opens microscopic. Subsequent
 *  (measured) fits go through {@link FitViewOnChange} → `resolveFitViewport`, which additionally
 *  left-anchors an over-wide graph so the first rank stays visible instead of a centered clip. */
const FIT_VIEW_OPTIONS = {
  padding: FIT_PADDING_RATIO,
  minZoom: READABLE_MIN_ZOOM,
  maxZoom: FIT_MAX_ZOOM,
} as const;

/** How far users may zoom OUT manually (instance floor — deliberately far below the auto-fit
 *  readability clamp so ZoomControls' fit button / pinch-zoom can still reach a full overview of a
 *  very wide graph). */
const CANVAS_MIN_ZOOM = 0.1;

/** The rank-0 column all lane heads share (rank 0 sits at `x = 0` in graph-layout coords). */
const LANE_LABEL_X = 0;
/** How far above a band's row-0 the lane header floats — sits in the inter-lane `LANE_GAP`, clear
 *  of the skip-edge arcs (which rise ~`SKIP_EDGE_ARC` above the row from mid-node height). */
const LANE_LABEL_Y_OFFSET = 46;

/** The flow a node/edge belongs to — additive `flowId`, absent ⇒ the default `'main'` body flow. */
function flowIdOf(item: { flowId?: string }): string {
  return item.flowId ?? DEFAULT_SKILL_FLOW_ID;
}

// ── Shared skill-graph canvas (WP 1.3 core, extracted in WP 2.3) ────────────────────────────────
// ONE node/edge-building + canvas-rendering implementation for BOTH inspector canvases: the Design
// tab (no overlay — exactly the WP 1.3 behavior) and the Trace tab (a per-run execution overlay).
// The overlay is a pure input: verdict → `FlowNode` tone (`ok`→"success", `fracture`→"destructive",
// `unvisited`→tone "default" dimmed via a layout-only opacity utility), visit-count badge on visited
// nodes, the fracture reason in the node subtitle, and traversal counts on traversed edges' labels.
// All verdict color comes from the `@elabs-ai/components-flow` tone tokens — no raw colors anywhere here.

/** Per-node execution overlay derived from a `TraceAlignment` verdict + visit count. */
export type TraceNodeOverlay = {
  status: TraceVerdictStatus;
  /** Times the aligner counted this node visited (0 for unvisited). */
  visits: number;
  /** The verdict's reason — surfaced on fractures as the node subtitle (exit code / misroute / loop). */
  reason?: string;
};

/** The optional execution overlay: node verdicts + per-edge traversal counts (only counts > 0). */
export type TraceCanvasOverlay = {
  nodes: Map<string, TraceNodeOverlay>;
  edgeTraversals: Map<string, number>;
};

/** A tiny, non-interactive node used ONLY to render an edge's label text (`@elabs-ai/components-flow`'s
 *  `FlowEdge` draws the path but never renders a label — see the WP 1.3 report for why). */
type ConditionLabelNode = Node<{ text: string }, "label">;

/** A non-interactive lane header (WP 1.3): one per flow band, rendered in flow coordinate space so it
 *  pans/zooms with its lane (NOT a `SkillGraphNode` and NOT a new node KIND — a render-only helper,
 *  exactly like {@link ConditionLabelNode}). */
type LaneLabelNode = Node<
  { label: string; trigger?: { type: TriggerKind; value: string } },
  "lane"
>;

/** `FlowNodeData` plus the overlay's visit count (rendered as a Badge by {@link CanvasNodeView}).
 *  `FlowNodeData extends Record<string, unknown>`, so the extra fields are invisible to `FlowNode`. */
type CanvasNodeData = FlowNodeData & {
  visits?: number;
  /** Skill IDE WP 5.2 — the node's 1-based inclusive SKILL.md anchor span, carried on the built node
   *  so the canvas can map line-anchored tool-reference diagnostics onto the node that owns them
   *  WITHOUT re-reading the graph (the canvas only ever sees built nodes). */
  anchorStartLine?: number;
  anchorEndLine?: number;
  /** Skill IDE WP 5.2 — count of tool-reference diagnostics anchored inside this node → warning badge. */
  toolDiagnostics?: number;
};
type CanvasBrandNode = Node<CanvasNodeData, "brand">;
export type SkillCanvasNode = CanvasBrandNode | ConditionLabelNode | LaneLabelNode;

function ConditionLabel({ data }: NodeProps<ConditionLabelNode>) {
  return (
    <Badge variant="outline" className="pointer-events-none whitespace-nowrap shadow-sm">
      {data.text}
    </Badge>
  );
}

/** The lane header: a `/command` (with a play glyph) or "Main flow", styled with semantic tokens
 *  only. Non-interactive + keyboard-unreachable (it's decorative furniture, not a target). */
function LaneLabel({ data }: NodeProps<LaneLabelNode>) {
  return (
    <div className="pointer-events-none flex items-center gap-1.5 whitespace-nowrap">
      {data.trigger ? (
        <Play className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      ) : null}
      <Text variant="meta" tone="muted" as="span">
        {data.label}
      </Text>
    </div>
  );
}

/** Handle skin copied verbatim from the brand `FlowNode`'s own handles (token utilities only) so
 *  the side-mounted replacements are visually indistinguishable from the upstream ones. */
const HANDLE_CLASS = "!size-2 !border-2 !border-flow-edge !bg-flow-node";

/** The brand `FlowNode` plus (a) an execution-count `Badge` when the overlay recorded visits
 *  (Trace mode, top-right) and (b) a warning-tone tool-diagnostics `Badge` when this node's section
 *  carries an unknown/stale MCP tool reference (Skill IDE WP 5.2, top-left).
 *
 *  WP 7.2 (audit SI4) — side-mounted handles: the layout runs LEFT→RIGHT, but the brand `FlowNode`
 *  hardcodes its handles to Top/Bottom and ignores a node's `sourcePosition`/`targetPosition` (a
 *  real upstream gap — raise with the owner: `FlowNode` should honor them). Until that lands
 *  upstream, this wrapper owns the handles: a LEFT target + RIGHT source (ids `in`/`out`, which
 *  every edge binds to explicitly in {@link buildFlow}) rendered BEFORE the `FlowNode`, and the
 *  `FlowNode`'s built-in top/bottom handles hidden via the wrapper's layout-only utility — so no
 *  edge can ever attach to a node's top or bottom. The `w-56` wrapper pins every node to the
 *  layout's `NODE_WIDTH` (224px) so columns align and long titles truncate instead of colliding
 *  with the neighbour rank. */
function CanvasNodeView(props: NodeProps<CanvasBrandNode>) {
  const visits = props.data.visits;
  const diagnostics = props.data.toolDiagnostics;
  const showVisits = typeof visits === "number" && visits > 0;
  const showDiagnostics = typeof diagnostics === "number" && diagnostics > 0;
  return (
    <div className="relative w-56 [&_.react-flow__handle-bottom]:hidden [&_.react-flow__handle-top]:hidden">
      <Handle
        type="target"
        id={TARGET_HANDLE_ID}
        position={NODE_TARGET_POSITION}
        isConnectable={props.isConnectable}
        className={HANDLE_CLASS}
      />
      <Handle
        type="source"
        id={SOURCE_HANDLE_ID}
        position={NODE_SOURCE_POSITION}
        isConnectable={props.isConnectable}
        className={HANDLE_CLASS}
      />
      <FlowNode {...(props as NodeProps<BrandFlowNode>)} />
      {showDiagnostics ? (
        <Badge
          variant="warning"
          className="absolute -left-2 -top-2 gap-0.5 tabular-nums shadow-sm"
          aria-label={`${diagnostics} tool reference ${diagnostics === 1 ? "issue" : "issues"}`}
        >
          <AlertTriangle className="size-3" aria-hidden />
          {diagnostics}
        </Badge>
      ) : null}
      {showVisits ? (
        <Badge
          variant="secondary"
          className="absolute -right-2 -top-2 tabular-nums shadow-sm"
          aria-label={`Executed ${visits} ${visits === 1 ? "time" : "times"}`}
        >
          ×{visits}
        </Badge>
      ) : null}
    </div>
  );
}

/**
 * WP 7.2 — the skill canvas edge: a SMOOTHSTEP path (orthogonal with rounded corners) in the same
 * brand skin as `@elabs-ai/components-flow`'s `FlowEdge` (identical `--flow-edge` token stroke — `FlowEdge` only
 * draws beziers, an upstream gap to raise: a `pathType` variant). Horizontal LR connections read as
 * clean orthogonal runs, and a SAME-ROW edge that skips over intermediate ranks (a gatekeeper
 * "goto" branch) is arced `SKIP_EDGE_ARC` above the row so it never cuts straight through the
 * boxes standing between its endpoints. Skip detection compares HANDLE coordinates: adjacent ranks
 * are one `RANK_GAP` (< `RANK_STEP`) apart handle-to-handle; a skip spans ≥ one full extra rank.
 */
function SkillFlowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
}: EdgeProps) {
  const skipsRanks = Math.abs(targetY - sourceY) < 8 && targetX - sourceX > RANK_STEP;
  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 12,
    ...(skipsRanks ? { centerY: sourceY - SKIP_EDGE_ARC } : {}),
  });
  return (
    <BaseEdge
      id={id}
      path={edgePath}
      markerEnd={markerEnd}
      style={{ stroke: "var(--flow-edge)", strokeWidth: 1.5, ...style }}
    />
  );
}

const nodeTypes = { brand: CanvasNodeView, label: ConditionLabel, lane: LaneLabel };
const edgeTypes = { brand: SkillFlowEdge };

/**
 * K3/WP 7.2 — re-frame the graph whenever its geometry changes. React Flow's `fitView` prop only fits
 * on the FIRST render, but the skill graph's nodes arrive/rebuild asynchronously (draft projection,
 * diagnostics fetch, flow-filter switch), so a one-shot fit would frame an empty/partial canvas and
 * leave real nodes clipped. Keyed on a geometry signature (ids + positions, NOT selection), this
 * refits after each real layout change without thrashing on every node re-seed.
 *
 * The frame itself comes from the PURE `resolveFitViewport` (graph-layout) instead of React Flow's
 * `fitView`: plain fitView CENTERS a graph that cannot fit at the readability floor, which is
 * exactly the audit-SI4 clip (rank 0 pushed off the left edge, the first row cut at the top).
 * `resolveFitViewport` clamps zoom to [`READABLE_MIN_ZOOM`, `FIT_MAX_ZOOM`] and anchors an
 * over-wide/over-tall graph to its start — first rank and first lane fully visible, one padding in. */
function FitViewOnChange({ signature }: { signature: string }) {
  const { getNodes, getNodesBounds, setViewport } = useReactFlow();
  const store = useStoreApi();
  useEffect(() => {
    if (!signature) return;
    // React Flow only measures node dimensions after paint, so a single immediate fit frames a
    // zero-size (unfit) graph. Re-fit a few times over ~0.8s so the final frame lands once every node
    // is measured — cheap, idempotent, and settles well before the user interacts.
    let cancelled = false;
    const timers = [60, 220, 500, 800, 1200].map((delay) =>
      setTimeout(() => {
        if (cancelled) return;
        // Nudge React Flow to re-measure its pane first: when the canvas is flanked by side panels
        // (Tools + Node details), React Flow can cache a stale (full-width) pane size and fit to it,
        // leaving the graph off-centre. A resize event forces a fresh measure, then we fit to it.
        window.dispatchEvent(new Event("resize"));
        requestAnimationFrame(() => {
          if (cancelled) return;
          const { width, height } = store.getState();
          const viewport = resolveFitViewport(getNodesBounds(getNodes()), width, height);
          // Unmeasured pane/nodes ⇒ no viewport yet — a later tick lands once dimensions exist.
          if (viewport) void setViewport(viewport, { duration: 150 });
        });
      }, delay),
    );
    return () => {
      cancelled = true;
      for (const timer of timers) clearTimeout(timer);
    };
  }, [signature, getNodes, getNodesBounds, setViewport, store]);
  return null;
}

/** How close (px, screen space) a node's center may sit to a pane edge and still count as "in view"
 *  for {@link resolveSeededFocus} — anything nearer/outside gets centered. */
const SEEDED_FOCUS_MARGIN = 24;

/** The minimal node shape {@link resolveSeededFocus} needs (structural subset of a React Flow node). */
export type SeededFocusNode = {
  position: { x: number; y: number };
  measured?: { width?: number; height?: number };
  width?: number;
  height?: number;
};

/**
 * SI14 — the PURE bring-into-view decision for an externally selected node: where to center the
 * viewport, or `null` for "already visible — don't move the camera". Visibility is judged on the
 * node's CENTER point (with a small edge margin), so a canvas CLICK — whose node is by definition
 * under the pointer — never yanks the viewport, while a problems-panel "Show node" / `?node=` deep
 * link / code-cursor sync onto an off-screen node pans it into view. Unmeasured pane (0×0) ⇒ `null`
 * (nothing to judge against; the mount-time framing is `FitViewOnChange`'s job). Exported for tests.
 */
export function resolveSeededFocus(
  node: SeededFocusNode,
  viewport: { x: number; y: number; zoom: number },
  paneWidth: number,
  paneHeight: number,
  margin: number = SEEDED_FOCUS_MARGIN,
): { x: number; y: number } | null {
  if (paneWidth <= 0 || paneHeight <= 0) return null;
  const width = node.measured?.width ?? node.width ?? NODE_WIDTH;
  const height = node.measured?.height ?? node.height ?? NODE_HEIGHT_ESTIMATE;
  const centerX = node.position.x + width / 2;
  const centerY = node.position.y + height / 2;
  const screenX = centerX * viewport.zoom + viewport.x;
  const screenY = centerY * viewport.zoom + viewport.y;
  const visible =
    screenX >= margin &&
    screenX <= paneWidth - margin &&
    screenY >= margin &&
    screenY <= paneHeight - margin;
  return visible ? null : { x: centerX, y: centerY };
}

/**
 * SI14 — bring a CALLER-seeded (external) selection into view: the problems panel's "Show node",
 * a `?node=` deep link, or split-mode code-cursor sync selects a node by re-seeding the `nodes`
 * prop's `selected` flags, which says nothing about visibility. Render-null helper mounted as a
 * CHILD of {@link SkillGraphCanvas} (children render inside the React Flow context — the same
 * contract `FitViewOnChange` and the Trace tab's `TraceFocusNode` use). Pans ONLY when the node's
 * center is outside the pane ({@link resolveSeededFocus}), and keeps the user's zoom — focusing is
 * a pan, never a surprise zoom jump. A node id absent from the canvas (e.g. hidden by the flow
 * filter) is a no-op.
 */
function FocusSeededSelection({ nodeId }: { nodeId: string | undefined }) {
  const { getNode, getViewport, setCenter } = useReactFlow();
  const store = useStoreApi();
  useEffect(() => {
    if (!nodeId) return;
    const node = getNode(nodeId);
    if (!node) return;
    const { width, height } = store.getState();
    const viewport = getViewport();
    const target = resolveSeededFocus(node, viewport, width, height);
    if (target) void setCenter(target.x, target.y, { zoom: viewport.zoom, duration: 250 });
  }, [nodeId, getNode, getViewport, setCenter, store]);
  return null;
}

/** SI10 — a session-local map of manually dragged node positions (node id → flow coords). Pure
 *  VIEW state: it never touches the draft/op buffer, is never persisted, and is dropped whenever
 *  the graph's structural geometry (the fit signature) — or the skill/version — changes. */
export type NodePositionOverrides = ReadonlyMap<string, { x: number; y: number }>;

/** SI10 — merge manual drag positions over the auto-layout output. Nodes without an override pass
 *  through UNTOUCHED (same object), and an empty override map returns the input array itself, so
 *  the memoized re-seed path stays identity-stable when nobody has dragged. Pure; exported for tests. */
export function applyPositionOverrides(
  nodes: SkillCanvasNode[],
  overrides: NodePositionOverrides,
): SkillCanvasNode[] {
  if (overrides.size === 0) return nodes;
  return nodes.map((node) => {
    const position = overrides.get(node.id);
    return position ? { ...node, position: { x: position.x, y: position.y } } : node;
  });
}

/** K3 — the geometry-only signature `FitViewOnChange` (and SI10's override reset) key on: ids +
 *  AUTO-LAYOUT positions, ignoring selection flags. The canvas always computes it from the nodes
 *  BEFORE drag overrides are merged, so dragging a node can never change the signature — the fit
 *  never re-runs (and overrides never reset) because of a drag. Pure; exported for tests. */
export function nodeGeometrySignature(nodes: SkillCanvasNode[]): string {
  return nodes
    .map((node) => `${node.id}@${Math.round(node.position.x)},${Math.round(node.position.y)}`)
    .join("|");
}

/** Legend rows for the five node kinds — the Design legend, and the base of the Trace legend. */
export const NODE_KIND_LEGEND_ITEMS: LegendItem[] = (
  Object.keys(NODE_KIND_META) as Array<keyof typeof NODE_KIND_META>
).map((kind) => ({
  label: NODE_KIND_META[kind].label,
  color: NODE_KIND_META[kind].color,
}));

/** Shorten a verdict reason so it fits the node subtitle (full text lives in the evidence pane). */
function shortReason(reason: string | undefined): string | undefined {
  if (!reason) return undefined;
  return reason.length > 72 ? `${reason.slice(0, 71)}…` : reason;
}

/** Verdict → `FlowNode` tone. Unvisited stays "default" (dimmed by the wrapper's opacity class). */
function overlayTone(status: TraceVerdictStatus): FlowNodeData["tone"] {
  if (status === "ok") return "success";
  if (status === "fracture") return "destructive";
  return "default";
}

/** Options for {@link buildFlow}. `visibleFlowId` scopes the canvas to one flow lane (the Design
 *  tab's flow picker); absent ⇒ every lane is shown. */
export type BuildFlowOptions = {
  /** When set, only nodes on this flow — and edges with BOTH endpoints on it — render. */
  visibleFlowId?: string;
};

/** Build the React Flow node/edge arrays from a `SkillGraph` + its layout positions (+ optional
 *  execution overlay). Never throws — edges referencing a node id absent from the graph are dropped
 *  (defensively; the projector's own contract never produces one, but the canvas must not crash if
 *  it ever did).
 *
 *  WP 1.3 — flow lanes: nodes are laid out in one vertical band per flow, each band headed by a
 *  non-interactive lane label (only when the graph has >1 flow, so single-flow skills look
 *  unchanged). `options.visibleFlowId` filters to a single lane: a node is kept iff it's on that
 *  flow, and an edge iff BOTH its endpoints survive that filter — so a cross-flow edge only renders
 *  when both lanes are shown (no dangling half-edges). Filtering the node/edge set also filters the
 *  overlay, so per-flow filtering can never strand a verdict badge on a hidden node. */
export function buildFlow(
  graph: SkillGraph,
  overlay?: TraceCanvasOverlay,
  options?: BuildFlowOptions,
): { nodes: SkillCanvasNode[]; edges: Edge[]; droppedEdges: number } {
  const { positions, lanes } = layoutSkillGraphWithLanes(graph);
  const visibleFlowId = options?.visibleFlowId;
  const isFlowVisible = (item: { flowId?: string }): boolean =>
    visibleFlowId === undefined || flowIdOf(item) === visibleFlowId;

  const visibleNodes = graph.nodes.filter(isFlowVisible);
  const visibleNodeIds = new Set(visibleNodes.map((n) => n.id));
  // Asset targets drive which edges the editable canvas lets you DELETE (WP 2.2 — only section→asset
  // "connections" can be removed → `disconnect_asset`; flow-sequence/branch edges stay put).
  const assetNodeIds = new Set(graph.nodes.filter((n) => n.kind === "asset").map((n) => n.id));

  const flowNodes: SkillCanvasNode[] = visibleNodes.map((node) => {
    const meta = NODE_KIND_META[node.kind];
    const position = positions.get(node.id) ?? { x: 0, y: 0 };
    const verdict = overlay?.nodes.get(node.id);

    const tone = verdict ? overlayTone(verdict.status) : meta.tone;
    const fractureReason = verdict?.status === "fracture" ? shortReason(verdict.reason) : undefined;
    // Entry points title on their trigger value (WP 1.3, e.g. "/report"); their fuller heading text
    // (e.g. "/report daily") becomes the subtitle when it adds anything.
    const title = node.kind === "entry_point" ? node.trigger.value : node.label;
    const entrySubtitle =
      node.kind === "entry_point" && node.label !== node.trigger.value ? node.label : undefined;
    const subtitle = fractureReason ?? (node.kind === "asset" ? node.path : entrySubtitle);
    const ariaLabel = verdict
      ? `${meta.label}: ${node.label} — ${verdict.status}, ${verdict.visits} ${
          verdict.visits === 1 ? "visit" : "visits"
        }`
      : `${meta.label}: ${node.label}`;

    return {
      id: node.id,
      type: "brand" as const,
      position,
      // WP 7.2 (SI4) — the LR contract on the node object itself: edges leave RIGHT, arrive LEFT.
      // `CanvasNodeView` renders the actual side handles from the same graph-layout constants.
      sourcePosition: NODE_SOURCE_POSITION,
      targetPosition: NODE_TARGET_POSITION,
      ariaLabel,
      // Nodes are NEVER key-deletable on the canvas: removal is panel-driven (`remove_node` /
      // `delete_command`, each with its own confirm). The editable canvas's delete key only removes a
      // selected section→asset EDGE (→ `disconnect_asset`); this keeps a stray Delete from desyncing
      // the graph (WP 2.2).
      deletable: false,
      // Dimming for never-visited nodes is a LAYOUT-ONLY opacity utility on the React Flow node
      // wrapper — no color literals; the verdict colors come exclusively from the tone tokens.
      ...(verdict?.status === "unvisited" ? { className: "opacity-40" } : {}),
      data: {
        title,
        subtitle,
        kind: meta.label,
        icon: meta.icon,
        tone,
        // WP 5.2 — carry the node's SKILL.md anchor span so the canvas can attribute line-anchored
        // tool-reference diagnostics to it (the count is injected later, by the component's fetch).
        anchorStartLine: node.anchor.startLine,
        anchorEndLine: node.anchor.endLine,
        ...(verdict && verdict.visits > 0 ? { visits: verdict.visits } : {}),
      },
    };
  });

  // `droppedEdges` counts STRUCTURAL defects (an edge citing a node absent from the whole graph) —
  // NOT edges merely hidden by the flow filter. Compute it against the full node set first, then
  // narrow to the visible lane(s).
  const allNodeIds = new Set(graph.nodes.map((n) => n.id));
  const structurallyValid = graph.edges.filter(
    (edge) => allNodeIds.has(edge.from) && allNodeIds.has(edge.to),
  );
  const droppedEdges = graph.edges.length - structurallyValid.length;
  const validEdges = structurallyValid.filter(
    (edge) => visibleNodeIds.has(edge.from) && visibleNodeIds.has(edge.to),
  );

  const flowEdges: Edge[] = validEdges.map((edge) => ({
    id: edge.id,
    source: edge.from,
    target: edge.to,
    type: "brand",
    // WP 7.2 (SI4) — bind every edge explicitly to the side handles `CanvasNodeView` renders (the
    // brand `FlowNode`'s legacy top/bottom handles are hidden and must never receive an edge).
    sourceHandle: SOURCE_HANDLE_ID,
    targetHandle: TARGET_HANDLE_ID,
    // Only a REAL section→asset edge is deletable (→ `disconnect_asset`); a preview-only connect edge
    // (its id carries the preview prefix) isn't — undo a staged connect via Discard, not the canvas.
    deletable: assetNodeIds.has(edge.to) && !edge.id.startsWith(PREVIEW_NODE_PREFIX),
    // Traversed edges animate (React Flow's token-styled dash animation) — the executed path reads
    // as motion, never as a raw color.
    ...((overlay?.edgeTraversals.get(edge.id) ?? 0) > 0 ? { animated: true } : {}),
  }));

  // Edge labels: one small non-interactive "label" node per condition-carrying edge, fanned out
  // horizontally when a source has more than one (a gatekeeper's branches). With an overlay, a
  // traversed edge's label carries its traversal count (`×N`); traversed edges WITHOUT a condition
  // get a count-only label so every traversal count is visible.
  const traversalText = (edgeId: string): string | undefined => {
    const count = overlay?.edgeTraversals.get(edgeId) ?? 0;
    return count > 0 ? `×${count}` : undefined;
  };

  const bySource = new Map<string, SkillGraphEdge[]>();
  const labelled = new Set<string>();
  for (const edge of validEdges) {
    if (!edge.condition) continue;
    const list = bySource.get(edge.from) ?? [];
    list.push(edge);
    bySource.set(edge.from, list);
    labelled.add(edge.id);
  }
  for (const siblings of bySource.values()) {
    siblings.forEach((edge, index) => {
      const labelPosition = edgeLabelPosition(positions, edge, index, siblings.length);
      if (!labelPosition) return;
      const traversal = traversalText(edge.id);
      const text = traversal ? `${edge.condition} · ${traversal}` : (edge.condition as string);
      flowNodes.push({
        id: `label:${edge.id}`,
        type: "label",
        position: labelPosition,
        selectable: false,
        draggable: false,
        connectable: false,
        focusable: false,
        ariaLabel: `Condition: ${text}`,
        data: { text },
      });
    });
  }

  if (overlay) {
    for (const edge of validEdges) {
      if (labelled.has(edge.id)) continue;
      const traversal = traversalText(edge.id);
      if (!traversal) continue;
      const labelPosition = edgeLabelPosition(positions, edge, 0, 1);
      if (!labelPosition) continue;
      flowNodes.push({
        id: `label:${edge.id}`,
        type: "label",
        position: labelPosition,
        selectable: false,
        draggable: false,
        connectable: false,
        focusable: false,
        ariaLabel: `Traversed ${traversal}`,
        data: { text: traversal },
      });
    }
  }

  // Lane headers (WP 1.3): one per VISIBLE flow band, floated just above the band's first row. Only
  // rendered when the graph actually has more than one flow — a single-flow skill's canvas is
  // unchanged. Non-interactive + keyboard-unreachable (decorative), rendered in flow space so they
  // pan/zoom with their lane.
  if (lanes.length > 1) {
    for (const lane of lanes) {
      if (!isFlowVisible({ flowId: lane.flowId })) continue;
      flowNodes.push({
        id: `lane:${lane.flowId}`,
        type: "lane",
        position: { x: LANE_LABEL_X, y: lane.baseY - LANE_LABEL_Y_OFFSET },
        selectable: false,
        draggable: false,
        connectable: false,
        focusable: false,
        ariaLabel: `Flow: ${lane.label}`,
        data: { label: lane.label, ...(lane.trigger ? { trigger: lane.trigger } : {}) },
      });
    }
  }

  return { nodes: flowNodes, edges: flowEdges, droppedEdges };
}

/**
 * Skill IDE WP 9.4 (I10.5) — the graph legend popover: every node kind + edge kind with its explainer
 * (title + one-line teaching + guide anchor), resolved through the SINGLE `explainers.ts` registry — the
 * SAME source the code hovers, the node panel's "What is this?", and the problems panel read. So the
 * legend can never teach a kind differently from the rest of the IDE. Position-agnostic (the caller
 * places it — the unified editor's toolbar, next to the Flow/Code/Split control).
 */
export function ExplainerLegend() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-1"
          aria-label="What the node and edge kinds mean"
        >
          <HelpCircle aria-hidden className="size-4" />
          Legend
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 max-w-[calc(100vw-2rem)] p-0">
        <div className="border-b border-border p-3">
          <Text variant="meta" className="font-medium">
            What the graph means
          </Text>
          <Text variant="meta" tone="muted">
            Every node and edge kind, with a link to the authoring guide.
          </Text>
        </div>
        <ScrollArea className="max-h-96">
          <div className="flex flex-col gap-1 p-2">
            {NODE_KIND_EXPLAINER_IDS.map((kind) => {
              const entry = explainerFor(kind);
              if (!entry) return null;
              return (
                <LegendRow
                  key={kind}
                  glyph={NODE_KIND_META[kind].icon}
                  title={entry.title}
                  short={entry.short}
                  guideAnchor={entry.guideAnchor}
                />
              );
            })}
            <div className="my-1 border-t border-border" />
            {EDGE_KIND_EXPLAINER_IDS.map((id) => {
              const entry = explainerFor(id);
              if (!entry) return null;
              return (
                <LegendRow
                  key={id}
                  glyph={<Waypoints />}
                  title={entry.title}
                  short={entry.short}
                  guideAnchor={entry.guideAnchor}
                />
              );
            })}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

/** One legend entry: the kind's glyph, its title, the teaching line, and the guide-anchor reference. */
function LegendRow({
  glyph,
  title,
  short,
  guideAnchor,
}: {
  glyph: ReactNode;
  title: string;
  short: string;
  guideAnchor: string;
}) {
  return (
    <div className="flex items-start gap-2 rounded-md p-2">
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-4">
        {glyph}
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <Text variant="meta" className="font-medium">
          {title}
        </Text>
        <Text variant="meta" tone="muted" className="text-pretty">
          {short}
        </Text>
        <code className="break-all text-xs text-muted-foreground">{guideAnchor}</code>
      </div>
    </div>
  );
}

export type SkillGraphCanvasProps = {
  nodes: SkillCanvasNode[];
  edges: Edge[];
  /** Fired with the selected brand node's id (pointer AND keyboard selection), or undefined. */
  onSelectNode: (nodeId: string | undefined) => void;
  /** Extra overlays rendered inside the flow (panels etc.). */
  children?: ReactNode;
  /**
   * WP 2.2 — put the canvas in EDIT mode: enables constrained drag-to-connect (a drag from a section
   * node's source handle to an asset node's target handle) and delete-key removal of a selected
   * section→asset edge. Off (the default) ⇒ pure read-only — the Trace tab and the Design view mode
   * behave exactly as before (no connect handles are live, no delete key is bound).
   */
  editable?: boolean;
  /** Only when `editable`: the user completed a connection drag. The caller validates the section→
   *  asset rule and stages `connect_asset` (or rejects it inline). Nothing mutates here. */
  onConnect?: (connection: Connection) => void;
  /** Only when `editable`: the user deleted edges on the canvas. The caller stages `disconnect_asset`
   *  for the section→asset edges among them. */
  onEdgesDelete?: (edges: Edge[]) => void;
  /**
   * Skill IDE WP 8.3 — only when `editable`: a Tools-palette tool was dropped onto the canvas. The
   * canvas hit-tests which React Flow node received the drop (via its `data-id`) and hands
   * `(server, tool, nodeId)` up; the caller validates the node is a section and stages `add_tool_ref`
   * (a drop on empty pane / a non-section arrives as `nodeId: null` and the caller rejects it inline).
   * Nothing mutates here — this is the same "gesture → typed op on the shared buffer" contract as
   * `onConnect`. Omitted / non-edit ⇒ the drag/drop handlers are not wired at all.
   */
  onToolDrop?: (payload: { server: string; tool: string; nodeId: string | null }) => void;
  /**
   * Skill IDE WP 5.2 — when BOTH are supplied, the canvas self-fetches this version's MCP
   * tool-reference diagnostics (`GET …/tool-diagnostics`, read-only over persisted scans) and paints a
   * warning-tone badge on every section node whose SKILL.md span carries an `unknown_tool`/`stale_tool`
   * reference. Omitted (e.g. the Trace tab, which passes neither) ⇒ no fetch, no badges — the read-only
   * canvas behaves exactly as before. A failed fetch degrades silently to "no badges" (the detail panel
   * / SKILL.md editor surface the diagnostics + any errors); it never breaks the canvas.
   */
  skillId?: string;
  versionId?: string;
};

/**
 * The one canvas both inspector modes render: a `@elabs-ai/components-flow` `CanvasShell` — pan/zoom,
 * keyboard-reachable node selection (via React Flow's `onSelectionChange`, which fires for both
 * pointer and keyboard-driven selection), a `Legend`, and `ZoomControls`.
 *
 * Read-only by default; when `editable` (WP 2.2 — the Design tab's edit mode) it also accepts a
 * CONSTRAINED drag-to-connect and a delete-key edge removal — but never mutates the graph itself:
 * `onConnect`/`onEdgesDelete` only hand the gesture up to the caller, which stages a typed op onto
 * the shared edit buffer (nodes are marked non-deletable in `buildFlow`, so a stray Delete can only
 * ever remove a section→asset edge, never a node).
 *
 * Node state is held internally via `useNodesState` and re-seeded whenever the built `nodes` prop
 * changes: React Flow treats a plain `nodes` prop WITHOUT `onNodesChange` as fully controlled, so
 * selection changes were silently discarded and click-to-select never stuck (a latent WP 1.3 gap
 * the Trace tab exposed).
 */
export function SkillGraphCanvas({
  nodes,
  edges,
  onSelectNode,
  children,
  editable = false,
  onConnect,
  onEdgesDelete,
  onToolDrop,
  skillId,
  versionId,
}: SkillGraphCanvasProps) {
  const [liveNodes, setLiveNodes, onNodesChange] = useNodesState<SkillCanvasNode>(nodes);

  // WP 8.3 — drag-to-reference: accept an HTML5 drag from the Tools palette. `dragover` must
  // preventDefault (only for OUR mime) to make the canvas a valid drop target; `drop` reads the tool
  // payload and hit-tests the React Flow node under the pointer (its wrapper carries `data-id`).
  const toolDropEnabled = editable && !!onToolDrop;
  const handleToolDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!toolDropEnabled || !event.dataTransfer.types.includes(TOOL_DRAG_MIME)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    },
    [toolDropEnabled],
  );
  const handleToolDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!toolDropEnabled) return;
      const raw = event.dataTransfer.getData(TOOL_DRAG_MIME);
      if (!raw) return;
      event.preventDefault();
      let payload: ToolDragPayload;
      try {
        payload = JSON.parse(raw) as ToolDragPayload;
      } catch {
        return;
      }
      if (typeof payload?.server !== "string" || typeof payload?.tool !== "string") return;
      const target = event.target as HTMLElement | null;
      const nodeEl = target?.closest?.(".react-flow__node");
      const nodeId = nodeEl?.getAttribute("data-id") ?? null;
      onToolDrop?.({ server: payload.server, tool: payload.tool, nodeId });
    },
    [toolDropEnabled, onToolDrop],
  );

  // WP 5.2 — the version's tool-reference diagnostics, self-fetched only when the caller supplies
  // BOTH ids (Design tab). Cancellable + re-run on (skillId, versionId) change; a failure degrades to
  // "no badges" rather than surfacing an error here (the panel / SKILL.md editor own error UI).
  const [diagnostics, setDiagnostics] = useState<ToolDiagnostic[]>([]);
  useEffect(() => {
    if (!skillId || !versionId) {
      setDiagnostics([]);
      return;
    }
    let cancelled = false;
    setDiagnostics([]);
    getToolDiagnostics(skillId, versionId)
      .then((report) => {
        if (!cancelled) setDiagnostics(report.diagnostics);
      })
      .catch(() => {
        if (!cancelled) setDiagnostics([]);
      });
    return () => {
      cancelled = true;
    };
  }, [skillId, versionId]);

  // Paint the diagnostic count onto each affected brand node's data (label/lane nodes carry no anchor
  // and are passed through untouched). Pure derivation over the built nodes + the fetched diagnostics.
  const decoratedNodes = useMemo(() => {
    if (diagnostics.length === 0) return nodes;
    return nodes.map((node) => {
      if (node.type !== "brand") return node;
      const { anchorStartLine, anchorEndLine } = node.data;
      if (anchorStartLine === undefined || anchorEndLine === undefined) return node;
      const count = diagnosticsInRange(diagnostics, anchorStartLine, anchorEndLine).length;
      if (count === 0) return node;
      return { ...node, data: { ...node.data, toolDiagnostics: count } };
    });
  }, [nodes, diagnostics]);

  // K3 — a geometry-only signature (ids + AUTO-LAYOUT positions, ignoring the selection flag) so
  // `FitViewOnChange` refits when the graph actually changes shape, not on every selection re-seed.
  // Computed from `decoratedNodes` — i.e. BEFORE the SI10 drag overrides are merged — so a manual
  // drag can never trigger a refit (or reset itself).
  const geometrySignature = useMemo(() => nodeGeometrySignature(decoratedNodes), [decoratedNodes]);

  // ── SI10 — session-local node dragging ───────────────────────────────────────────────────────────
  // Manual positions are VIEW state only: stored here (never in the draft — no op, no dirty flag,
  // nothing persisted) and merged over the auto-layout output on every re-seed, so a dragged node
  // keeps its place through selection re-seeds and diagnostic repaints. The overrides are keyed to
  // the layout they were dragged on (`skillId | versionId | geometry signature`): the moment the
  // structural layout changes — a node added/removed/re-ranked, or a skill/version switch — the key
  // no longer matches and the stale positions are ignored (auto-layout wins again), exactly in step
  // with the `FitViewOnChange` refit that fires on the same signature.
  const layoutKey = `${skillId ?? ""} ${versionId ?? ""} ${geometrySignature}`;
  const layoutKeyRef = useRef(layoutKey);
  layoutKeyRef.current = layoutKey;
  const [dragOverrides, setDragOverrides] = useState<{
    layoutKey: string;
    positions: Map<string, { x: number; y: number }>;
  } | null>(null);
  const activeOverrides =
    dragOverrides !== null && dragOverrides.layoutKey === layoutKey
      ? dragOverrides.positions
      : null;

  const positionedNodes = useMemo(
    () =>
      activeOverrides ? applyPositionOverrides(decoratedNodes, activeOverrides) : decoratedNodes,
    [decoratedNodes, activeOverrides],
  );

  /** Record where a drag left a node. STRICTLY view state — no callback prop fires, so nothing can
   *  reach the edit buffer / draft store from here. Stable identity (reads the layout key via ref). */
  const handleNodeDragStop = useCallback((_event: unknown, node: SkillCanvasNode) => {
    const key = layoutKeyRef.current;
    setDragOverrides((current) => {
      const positions = new Map(
        current !== null && current.layoutKey === key ? current.positions : [],
      );
      positions.set(node.id, { x: node.position.x, y: node.position.y });
      return { layoutKey: key, positions };
    });
  }, []);

  // Re-seed when the caller rebuilds the flow (new graph / overlay), the diagnostic decoration
  // changes, or a drag override lands; resets any selection with it.
  useEffect(() => {
    setLiveNodes(positionedNodes);
  }, [positionedNodes, setLiveNodes]);

  // ── SI14 (P0: minified React #185) — the selection announce MUST keep ONE stable identity ───────
  // React Flow's `SelectionListenerInner` puts the `onSelectionChange` CALLBACK in its effect deps,
  // so a new identity per render re-announces the store's CURRENT selection on EVERY render — and
  // the store lags one commit behind an externally seeded selection (the re-seed effect above lands
  // AFTER the child listener's effect). With the old inline lambda, the problems panel's "Show node"
  // (`setSelectedNodeId` → seeded `selected` flags) got its selection clobbered back by that stale
  // announce, which re-rendered with new flags, which the store echoed one pass later — a value
  // ping-pong (`nodeId` ↔ `undefined`) that hit React's nested-update limit and crashed the app.
  // A stable identity means the listener fires ONLY on real selection-id changes, whose announced
  // value always matches the caller's just-set state — the sync converges. The ref keeps the LATEST
  // `onSelectNode` observable without ever changing the handler's identity.
  const onSelectNodeRef = useRef(onSelectNode);
  onSelectNodeRef.current = onSelectNode;
  const handleSelectionChange = useCallback(({ nodes: selected }: { nodes: SkillCanvasNode[] }) => {
    const next = selected.find((n) => n.type === "brand");
    onSelectNodeRef.current(next?.id);
  }, []);

  // SI14 — the node the CALLER seeded as selected (external selection arrives through the `nodes`
  // prop: problems-panel "Show node", `?node=` deep links, code-cursor sync). Drives the
  // bring-into-view child; a gesture-driven (click) selection seeds the same flag one round-trip
  // later, but its node is already visible, so `FocusSeededSelection` never moves the camera then.
  const seededSelectedId = useMemo(
    () => nodes.find((node) => node.type === "brand" && node.selected)?.id,
    [nodes],
  );

  return (
    <CanvasShell<SkillCanvasNode>
      nodes={liveNodes}
      edges={edges}
      onNodesChange={onNodesChange}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      // SI10 — nodes may be rearranged by hand (label/lane helper nodes opt out per-node). The
      // resulting positions are session-local view state captured in `handleNodeDragStop`.
      nodesDraggable
      onNodeDragStop={handleNodeDragStop}
      nodesConnectable={editable}
      edgesReconnectable={false}
      // WP 7.2 — let users zoom far OUT manually (overview of a wide graph); the AUTO-fit keeps its
      // own readability floor via `resolveFitViewport` / `FIT_VIEW_OPTIONS.minZoom`.
      minZoom={CANVAS_MIN_ZOOM}
      // K3/WP 7.2 — frame the graph on mount at a READABLE zoom, first rank fully visible (the
      // measured re-fit in `FitViewOnChange` owns every subsequent geometry change).
      fitView
      fitViewOptions={FIT_VIEW_OPTIONS}
      deleteKeyCode={editable ? EDIT_DELETE_KEYS : null}
      onConnect={editable ? onConnect : undefined}
      onEdgesDelete={editable ? onEdgesDelete : undefined}
      onDragOver={toolDropEnabled ? handleToolDragOver : undefined}
      onDrop={toolDropEnabled ? handleToolDrop : undefined}
      onSelectionChange={handleSelectionChange}
    >
      {/* K3/K4 — the node-kind / verdict legend is DOCKED in each caller's IDE chrome (the Design
          toolbar's ExplainerLegend, the Trace toolbar's Legend), never floated over the canvas. */}
      <FitViewOnChange signature={geometrySignature} />
      <FocusSeededSelection nodeId={seededSelectedId} />
      <ZoomControls />
      {children}
    </CanvasShell>
  );
}
