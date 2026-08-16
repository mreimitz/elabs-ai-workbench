// Assistant Hub (roadmap/assistant-hub/, WP2.2 · §1.9 · R-UX4) — the mission TOPOLOGY GRAPH renderer.
// A thin `@brand/flow` canvas over the pure {@link deriveTopologyGraph} layout: it draws the mission's
// team as a directed graph (agents → synthesis / judge / resolver) with LIVE state coloured onto each
// node (waiting → default, working → accent, reported → success, did-not-report → destructive; the
// best_of_n winner reads success + a "winner" eyebrow). Read-only (no drag/connect/select) — it VISUALIZES
// state, it never edits it. Rendered on the mission board and as the crew-builder preview. brand-ui only.

import { CanvasShell, FlowNode, ZoomControls, type FlowNodeData } from "@brand/flow";
import { Text } from "@brand/ui";
import type { Edge as RFEdge, Node as RFNode } from "@xyflow/react";
import {
  useCallback,
  useMemo,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { MissionAgentNode } from "./MissionAgentNode";
import {
  deriveTopologyGraph,
  isAgentNodeId,
  TOPOLOGY_LEGEND,
  type TopoGraph,
  type TopoGraphInput,
} from "./topology-graph";

// Edges render on xyflow's built-in default (bezier) type — TopologyGraph registers no `edgeTypes`
// — so a `label` renders via xyflow's own `labelStyle`/`labelBgStyle` hooks. Styled with token CSS
// custom properties (not raw colors — SVG `fill` cannot take a Tailwind class) so the "sees + rebuts"
// annotation reads correctly in both themes.
const EDGE_LABEL_STYLE = { fill: "var(--muted-foreground)", fontSize: 11, fontWeight: 500 } as const;
const EDGE_LABEL_BG_STYLE = { fill: "var(--card)" } as const;

// Two stable nodeTypes maps (React Flow warns/re-renders if these are re-created each render). The
// `mission` variant adds the rich `missionAgent` node (avatar + status + brief) for AGENT nodes; the
// default `plain` variant (crew previews) keeps every node on the compact `@brand/flow` FlowNode.
const nodeTypes = { brand: FlowNode } as const;
const missionNodeTypes = { brand: FlowNode, missionAgent: MissionAgentNode } as const;

// The mission variant's rich agent card is much taller than the plain node, so its rows are spaced
// further apart. Done here (scaling the pure layout's y) so the pure module + its position tests stay
// untouched; the plain crew previews keep the compact spacing.
const MISSION_ROW_SCALE = 1.9;

type BrandNode = RFNode<FlowNodeData, "brand">;

export type TopologyGraphVariant = "mission" | "plain";

function toReactFlow(
  graph: TopoGraph,
  selectable: boolean,
  selectedNodeId: string | undefined,
  iconById: Map<string, ReactNode> | undefined,
  variant: TopologyGraphVariant,
  briefById: Map<string, string> | undefined,
): { nodes: RFNode[]; edges: RFEdge[] } {
  const nodes: RFNode[] = graph.nodes.map((node) => {
    // A debate rebuttal id is `<agentId>::r{n}` — look its avatar/brief up by the base agent id.
    const baseId = node.id.split("::")[0] ?? node.id;
    const icon = iconById?.get(baseId);
    const common = {
      id: node.id,
      position: {
        x: node.x,
        y: variant === "mission" ? node.y * MISSION_ROW_SCALE : node.y,
      },
      draggable: false,
      // hub-fixes WP4.3 — nodes become clickable/keyboard-selectable only when the (expanded) modal
      // asks for it; the inline board graph stays read-only. `selected` is driven purely by the
      // CONTROLLED `selectedNodeId` (nodes are otherwise fully controlled — no `onNodesChange` — so
      // there is no internal xyflow selection store to ping-pong with; SI14 can't occur here).
      selectable,
      selected: selectable && node.id === selectedNodeId,
      connectable: false,
    };
    // AGENT nodes in the mission variant get the rich profile-style card; synthesis/judge/terminal
    // nodes (and every node in the plain variant) stay on the compact FlowNode.
    if (variant === "mission" && isAgentNodeId(node.id)) {
      const brief = briefById?.get(baseId);
      return {
        ...common,
        type: "missionAgent",
        data: {
          title: node.title,
          ...(node.subtitle ? { subtitle: node.subtitle } : {}),
          state: node.state,
          ...(icon ? { icon } : {}),
          ...(brief ? { brief } : {}),
          // Crew nesting (WP4.3) — a sub-crew slot's node: the crew glyph + member count swap in for
          // the avatar/model subtitle (`MissionAgentNode`'s `data.isCrew` branch).
          ...(node.isCrew ? { isCrew: true as const } : {}),
          ...(node.memberCount !== undefined ? { memberCount: node.memberCount } : {}),
        },
      } satisfies RFNode;
    }
    return {
      ...common,
      type: "brand",
      data: {
        title: node.title,
        kind: node.kind,
        ...(node.subtitle ? { subtitle: node.subtitle } : {}),
        ...(icon ? { icon } : {}),
        tone: node.tone,
      },
    } satisfies BrandNode;
  });
  const edges: RFEdge[] = graph.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    animated: e.animated,
    ...(e.label
      ? { label: e.label, labelStyle: EDGE_LABEL_STYLE, labelBgStyle: EDGE_LABEL_BG_STYLE }
      : {}),
  }));
  return { nodes, edges };
}

export type TopologyGraphProps = {
  input: TopoGraphInput;
  /** An accessible summary of the diagram (topology + counts) for the labelled region. */
  ariaLabel: string;
  /** Height utility (layout only) — defaults to a compact board-friendly height. */
  className?: string;
  /** Optional per-node leading glyph / avatar (node id → element). The mission board passes each
   *  agent's `RoleAvatar`; the crew preview passes nothing. In the `mission` variant it's the large
   *  overlapping avatar; in `plain` it's `FlowNode`'s small icon slot. */
  iconById?: Map<string, ReactNode>;
  /** `"mission"` renders AGENT nodes as the rich profile-style card (avatar + status + 2-line brief);
   *  `"plain"` (default) keeps every node on the compact `@brand/flow` FlowNode (crew previews). */
  variant?: TopologyGraphVariant;
  /** Mission-only: each agent's brief (the prompt it received) → node id → text, shown as the node's
   *  2-line preview. Keyed by agent session id (a debate rebuttal resolves to its base agent). */
  briefById?: Map<string, string>;
  /** hub-fixes WP4.3 — enable node selection (click + keyboard). Default `false` keeps the inline
   *  board graph read-only; the expand modal turns it on to drive its right-hand agent panel. */
  selectable?: boolean;
  /** The CONTROLLED selected node id — that node reads as selected. */
  selectedNodeId?: string;
  /** Fired when a node is selected via click, keyboard (Enter/Space), or focus. */
  onSelectNode?: (nodeId: string) => void;
};

/**
 * hub-fixes WP4.3 — resolve the node id a focus/keyboard event targets. React Flow renders each node
 * as a focusable element carrying `data-id="<nodeId>"` on its `.react-flow__node` wrapper (a stable
 * DOM contract), so selection can be synced from keyboard focus / Enter without reaching into canvas
 * geometry (which jsdom can't lay out — this stays unit-testable). Mirrors the org chart's
 * `orgNodeIdFromEventTarget`. Returns `null` for canvas chrome (zoom controls, the empty pane).
 */
export function topoNodeIdFromEventTarget(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  const nodeEl = target.closest<HTMLElement>(".react-flow__node[data-id]");
  return nodeEl?.dataset.id ?? null;
}

/** The keys that "select" a focused node — Enter + Space, the standard activation pair. */
export function isTopoActivateKey(key: string): boolean {
  return key === "Enter" || key === " " || key === "Spacebar";
}

/**
 * Render a topology graph. `input` is mapped through the pure layout, so the same component draws the live
 * board and the static crew preview — only the per-node `state` differs. An empty team renders a muted
 * hint rather than a blank canvas. A populated graph carries a one-line legend (RC6.1) stating how the
 * topology actually runs, so the shape is never left to speak for itself.
 */
export function TopologyGraph({
  input,
  ariaLabel,
  className,
  selectable = false,
  selectedNodeId,
  onSelectNode,
  iconById,
  variant = "plain",
  briefById,
}: TopologyGraphProps) {
  const graph = useMemo(() => deriveTopologyGraph(input), [input]);
  const rf = useMemo(
    () => toReactFlow(graph, selectable, selectedNodeId, iconById, variant, briefById),
    [graph, selectable, selectedNodeId, iconById, variant, briefById],
  );

  // Keyboard/focus parity (WP4.3) — mirrors OrgChartTab's capture handlers so a keyboard user can
  // drive the modal's agent panel: Tab-focusing a node selects it; Enter/Space selects it. Both
  // resolve the id from the DOM, so canvas chrome (zoom controls) is a no-op and no geometry is read.
  const onFocusCapture = useCallback(
    (event: ReactFocusEvent) => {
      const id = topoNodeIdFromEventTarget(event.target);
      if (id) onSelectNode?.(id);
    },
    [onSelectNode],
  );
  const onKeyDownCapture = useCallback(
    (event: ReactKeyboardEvent) => {
      if (!isTopoActivateKey(event.key)) return;
      const id = topoNodeIdFromEventTarget(event.target);
      if (!id) return;
      event.preventDefault();
      onSelectNode?.(id);
    },
    [onSelectNode],
  );

  if (graph.nodes.length === 0) {
    return (
      <div className="flex h-full min-h-24 items-center justify-center rounded-md border border-dashed border-border bg-muted/30 px-4 py-6">
        <Text tone="muted" className="text-caption">
          Add at least one member to preview the topology.
        </Text>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-col gap-1.5">
      <section
        aria-label={ariaLabel}
        data-testid="topology-graph"
        className={`min-h-48 overflow-hidden rounded-md border border-border bg-card ${className ?? "h-64"}`}
        onFocusCapture={selectable ? onFocusCapture : undefined}
        onKeyDownCapture={selectable ? onKeyDownCapture : undefined}
      >
        <CanvasShell
          nodes={rf.nodes}
          edges={rf.edges}
          nodeTypes={variant === "mission" ? missionNodeTypes : nodeTypes}
          fitView
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={selectable}
          nodesFocusable={selectable}
          edgesFocusable={false}
          onNodeClick={selectable ? (_event, node) => onSelectNode?.(node.id) : undefined}
          panOnDrag
          zoomOnScroll={false}
          minZoom={0.2}
          maxZoom={1.4}
          proOptions={{ hideAttribution: true }}
        >
          <ZoomControls />
        </CanvasShell>
      </section>
      <Text tone="muted" className="text-caption" data-testid="topology-graph-legend">
        {TOPOLOGY_LEGEND[input.topology]}
      </Text>
    </div>
  );
}
