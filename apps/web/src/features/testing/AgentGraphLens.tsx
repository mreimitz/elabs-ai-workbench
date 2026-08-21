import { useCallback, useMemo } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { RunStep, SessionCostBasis } from "@mcp-token-footprint/shared";
import { CanvasShell, ZoomControls } from "@elabs-ai/components-flow";
import type { Edge as RFEdge, Node as RFNode } from "@xyflow/react";
import { EmptyState, Text, ToggleGroup, ToggleGroupItem } from "@elabs-ai/components-ui";
import { Workflow } from "lucide-react";
import {
  buildAgentGraph,
  layoutAgentGraph,
  type AgentGraph,
  type AgentGraphMode,
  type AgentGraphNode as AgentGraphModelNode,
  type AgentGraphPosition,
} from "./agent-graph";
import { AgentGraphNode, type AgentGraphNodeData, type AgentGraphRFNode } from "./AgentGraphNode";
import { derivePerStepEconomics, type StepCumulativeKpi } from "./analytics-derive";

/**
 * Observability WP 3.5 (D-OB29) — the run console's GRAPH lens: the run as a node-link diagram, the
 * agent's shape at a glance (which tools, how often, where it looped, where it erred). A third way to
 * read the same run, beside the conversation and the step log.
 *
 * Everything derived lives in the pure `agent-graph.ts` (model, cycle detection, deterministic
 * layout); this file only maps that model onto `@elabs-ai/components-flow`'s `CanvasShell` and back
 * again. It renders READ-ONLY — no drag, no connect, no edit — exactly like the Hub's
 * `TopologyGraph`, whose node-composition and keyboard-selection patterns it follows.
 *
 * Loading vs streaming (`.claude/rules/loading-states.md`): the graph has no "no content yet"
 * spinner, because it is a projection of state the console already holds — a run with no steps yet
 * shows a real `EmptyState`, and the graph then BUILDS UP as steps stream in. It never renders an
 * error of its own (a run's failure is the run bar's and the conversation's job), and a replayed run
 * yields exactly the same graph as the live one because both read the same accumulated steps.
 */

/** One stable nodeTypes map — React Flow re-renders the whole canvas if this identity changes. */
const nodeTypes = { agentGraph: AgentGraphNode } as const;

/** Edge labels are SVG text, so they take token CSS custom properties, never a Tailwind class
 *  (the `TopologyGraph` precedent — an SVG `fill` cannot read a utility). Both read in both themes. */
const EDGE_LABEL_STYLE = { fill: "var(--muted-foreground)", fontSize: 11, fontWeight: 500 } as const;
const EDGE_LABEL_BG_STYLE = { fill: "var(--card)" } as const;

export type AgentGraphLensProps = {
  /** The run's steps, in flat index order — the same list every other lens renders. */
  steps: RunStep[];
  /** WP3.2's cumulative per-step KPI snapshots (replay only); `null` while a run is live. */
  kpiByStepId?: ReadonlyMap<string, StepCumulativeKpi> | null;
  /** The run's cost basis (D-US4) — governs whether a per-node dollar figure is honest at all. */
  costBasis?: SessionCostBasis;
  mode: AgentGraphMode;
  onModeChange: (mode: AgentGraphMode) => void;
  /** The node the Steps lens is currently filtered to (`?focus=`), or null. */
  selectedNodeId?: string | null;
  /** Click / Enter / Space on a node — the cross-link into the filtered step view. */
  onSelectNode: (node: AgentGraphModelNode) => void;
};

/**
 * Resolve the node id a click/focus/keyboard event targets. React Flow stamps `data-id` on every
 * `.react-flow__node` wrapper (a stable DOM contract), so selection can be driven from keyboard focus
 * without reading canvas geometry — which jsdom cannot lay out, keeping this unit-testable. Mirrors
 * `TopologyGraph`'s `topoNodeIdFromEventTarget`. Returns null for canvas chrome (zoom controls, pane).
 */
export function agentNodeIdFromEventTarget(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLElement>(".react-flow__node[data-id]")?.dataset.id ?? null;
}

/** Enter + Space "activate" a focused node — the standard activation pair. */
export function isAgentGraphActivateKey(key: string): boolean {
  return key === "Enter" || key === " " || key === "Spacebar";
}

/**
 * Map the pure graph + its layout onto React Flow nodes/edges. Exported so the lens test can assert
 * on exactly what the canvas receives (this repo's chart/panel suites historically stubbed the
 * rendering library as a no-op, which lets a mis-wired surface pass the gate — see the WP note).
 */
export function toReactFlow(
  graph: AgentGraph,
  positions: Map<string, AgentGraphPosition>,
  selectedNodeId: string | null,
  costBasis: SessionCostBasis | undefined,
): { nodes: RFNode[]; edges: RFEdge[] } {
  // WP3.2's `showsCostChip` rule, reused: a `"none"` basis has no dollar figure at all, so the chip
  // is suppressed rather than rendered as $0.00; a subscription run's shadow price IS shown but
  // MARKED an estimate (D-CS4/D-CS8 — exact tokens at list rate, marginal cost $0).
  const costSuppressed = costBasis === "none";
  const costEstimated = costBasis === "subscription_reference";

  const nodes: AgentGraphRFNode[] = graph.nodes.map((node) => {
    const position = positions.get(node.id) ?? { x: 0, y: 0, depth: 0 };
    const data: AgentGraphNodeData = {
      kind: node.kind,
      title: node.label,
      count: node.count,
      tokensIn: node.tokensIn,
      tokensOut: node.tokensOut,
      costUsd: node.costUsd,
      durationMs: node.durationMs,
      errors: node.errors,
      costSuppressed,
      costEstimated,
    };
    return {
      id: node.id,
      type: "agentGraph",
      position: { x: position.x, y: position.y },
      data,
      draggable: false,
      connectable: false,
      selectable: true,
      selected: node.id === selectedNodeId,
    };
  });

  const depthOf = (id: string): number => positions.get(id)?.depth ?? 0;
  const edges: RFEdge[] = graph.edges.map((edge) => {
    const isSelfLoop = edge.from === edge.to;
    // In AGGREGATED (top-down) mode a back edge climbs to an equal-or-shallower layer — the visual
    // signature of a loop. Routing it out of the LEFT side and back into the LEFT side keeps it clear
    // of the forward spine, so a 2-cycle reads as two distinct arcs instead of one path drawn twice.
    // EXPANDED mode is a forward chain by construction (`agent-graph.ts` proves it acyclic), and its
    // rows encode PARENTAGE rather than distance — so the same depth comparison would misread every
    // same-row transition as a loop. It gets its own left-to-right rule instead.
    const isBackEdge =
      graph.mode === "aggregated" && !isSelfLoop && depthOf(edge.to) <= depthOf(edge.from);
    const anchors = isSelfLoop
      ? { sourceHandle: "right", targetHandle: "bottom" }
      : graph.mode === "expanded"
        ? edge.kind === "parent"
          ? // A parentage child sits one row down and to the right: leave the bottom, enter the left.
            { sourceHandle: "bottom", targetHandle: "left" }
          : { sourceHandle: "right", targetHandle: "left" }
        : isBackEdge
          ? { sourceHandle: "left", targetHandle: "left" }
          : { sourceHandle: "bottom", targetHandle: "top" };
    return {
      id: edge.id,
      source: edge.from,
      target: edge.to,
      type: "smoothstep",
      ...anchors,
      // The traversal counter is what makes a folded loop legible; a once-traversed edge stays clean.
      ...(edge.count > 1
        ? { label: `×${edge.count}`, labelStyle: EDGE_LABEL_STYLE, labelBgStyle: EDGE_LABEL_BG_STYLE }
        : {}),
      // Parentage reads as a dashed line (a shape difference, not a colour one) so a judge call under
      // its rating span is distinguishable from plain execution order without relying on hue.
      ...(edge.kind === "parent" ? { style: { strokeDasharray: "4 3" } } : {}),
    } satisfies RFEdge;
  });

  return { nodes, edges };
}

export function AgentGraphLens({
  steps,
  kpiByStepId = null,
  costBasis,
  mode,
  onModeChange,
  selectedNodeId = null,
  onSelectNode,
}: AgentGraphLensProps) {
  const perStepEconomics = useMemo(
    () => (kpiByStepId ? derivePerStepEconomics(steps, kpiByStepId) : null),
    [steps, kpiByStepId],
  );
  const graph = useMemo(
    () => buildAgentGraph({ steps, mode, perStepEconomics }),
    [steps, mode, perStepEconomics],
  );
  const positions = useMemo(() => layoutAgentGraph(graph), [graph]);
  const flow = useMemo(
    () => toReactFlow(graph, positions, selectedNodeId, costBasis),
    [graph, positions, selectedNodeId, costBasis],
  );

  const nodeById = useMemo(
    () => new Map(graph.nodes.map((node) => [node.id, node] as const)),
    [graph.nodes],
  );
  const select = useCallback(
    (nodeId: string | null) => {
      const node = nodeId ? nodeById.get(nodeId) : undefined;
      if (node) onSelectNode(node);
    },
    [nodeById, onSelectNode],
  );
  const onKeyDownCapture = useCallback(
    (event: ReactKeyboardEvent) => {
      if (!isAgentGraphActivateKey(event.key)) return;
      const id = agentNodeIdFromEventTarget(event.target);
      if (!id) return;
      event.preventDefault();
      select(id);
    },
    [select],
  );
  const toggle = (
    <ToggleGroup
      type="single"
      variant="segmented"
      size="sm"
      value={mode}
      onValueChange={(next) => {
        // A Radix single toggle can emit "" when the pressed item is clicked again; ignore it so
        // exactly one mode always stays selected.
        if (next === "aggregated" || next === "expanded") onModeChange(next);
      }}
      aria-label="Agent graph mode"
    >
      <ToggleGroupItem value="aggregated" aria-label="Aggregated — merge repeated calls into one node">
        Aggregated
      </ToggleGroupItem>
      <ToggleGroupItem value="expanded" aria-label="Expanded — one node per call, loops unrolled">
        Expanded
      </ToggleGroupItem>
    </ToggleGroup>
  );

  if (graph.nodes.length === 0) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-3 p-4">
        <div className="flex shrink-0 items-center gap-3">{toggle}</div>
        <EmptyState
          icon={<Workflow aria-hidden />}
          title="Nothing to graph yet"
          description="The agent graph builds up as the run streams — its first prompt, turn or tool call draws the first node."
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-4">
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        {toggle}
        <Text variant="meta" tone="muted" as="span">
          {mode === "aggregated"
            ? "Repeated calls merge into one node; ×N counts how often it ran."
            : "One node per call, in execution order — loops unrolled left to right."}
        </Text>
        {graph.hasCycle && mode === "aggregated" ? (
          <Text variant="meta" tone="muted" as="span">
            This run loops — at least one path returns to a node it already visited.
          </Text>
        ) : null}
        {!graph.hasHierarchy ? (
          <Text variant="meta" tone="muted" as="span">
            This run recorded no step hierarchy, so the graph is flat.
          </Text>
        ) : null}
      </div>
      <section
        aria-label={`Agent graph — ${graph.nodes.length} nodes, ${graph.edges.length} transitions`}
        data-testid="agent-graph-canvas"
        className="min-h-0 flex-1 overflow-hidden rounded-md border border-border bg-card"
        onKeyDownCapture={onKeyDownCapture}
      >
        <CanvasShell
          nodes={flow.nodes}
          edges={flow.edges}
          nodeTypes={nodeTypes}
          fitView
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          nodesFocusable
          edgesFocusable={false}
          onNodeClick={(_event, node) => select(node.id)}
          panOnDrag
          zoomOnScroll={false}
          minZoom={0.2}
          maxZoom={1.4}
          proOptions={{ hideAttribution: true }}
        >
          <ZoomControls />
        </CanvasShell>
      </section>
      <Text variant="meta" tone="muted" as="p">
        Select a node to filter the step log to the steps behind it.
      </Text>
    </div>
  );
}
