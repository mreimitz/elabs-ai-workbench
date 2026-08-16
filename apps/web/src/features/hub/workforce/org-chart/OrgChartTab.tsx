// Assistant Hub UX (roadmap/assistant-hub-ux/, WP2.5 · D-HUX5/8/9) — the workforce "Org chart" tab.
// Fills `WorkforceView`'s `orgChartTab` slot (see that file's frame-API doc): it reads the org rail's
// `?scope` itself (nothing threaded in as props), fetches the crew + role library, and renders the
// pure {@link buildOrgChartModel} on a read-only `@brand/flow` canvas — crew containers tinted by
// crew color, members drawing each crew's real topology, an Unassigned/Archived lane, `FlowMiniMap` +
// `ZoomControls`, a Legend, and an `InspectorPanel` summary. Select = inspector; double-click (or the
// inspector's "Open profile") = navigate to the entity's profile modal route (D-HUX9 v1: read + navigate).

import {
  CanvasShell,
  FlowGroupNode,
  FlowMiniMap,
  FlowNode,
  FlowSmartEdge,
  InspectorPanel,
  Legend,
  Panel,
  useEdgesState,
  useNodesState,
  ZoomControls,
} from "@brand/flow";
import { Badge, Button, cn, EmptyState, Spinner, Text } from "@brand/ui";
import type { Edge, Node, ReactFlowInstance } from "@xyflow/react";
import { AlertTriangle, GitFork, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { InlineError } from "../../../../components/InlineError";
import { listHubAgentRoles, listHubCrews } from "../../../../lib/api";
import { loadableData, useLoadable } from "../../../../lib/loadable";
import { crewAccentClasses } from "../../lib/hub-ux";
import { parseOrgRailScope } from "../OrgRail";
import {
  buildOrgChartModel,
  type OrgChartModel,
  type OrgNodeMeta,
} from "./org-model";
import { TOPOLOGY_EDGE_MEANING, TOPOLOGY_LABEL } from "./topology-edges";

// Stable node/edge type maps (React Flow warns + re-renders if these are re-created each render).
const NODE_TYPES = { brand: FlowNode, group: FlowGroupNode } as const;
const EDGE_TYPES = { smart: FlowSmartEdge } as const;

/** Where a double-click / "Open profile" on a node navigates — an agent or crew profile, or nowhere
 *  (a lane container, or a WP4.2 placeholder box). Pure so it's unit-tested without the canvas. */
export type OrgNavTarget = { kind: "agent" | "crew"; id: string };
export function nodeNavigationTarget(meta: OrgNodeMeta | undefined): OrgNavTarget | null {
  if (!meta) return null;
  if (meta.kind === "agent") return { kind: "agent", id: meta.agentId };
  // Crew nesting (WP4.2 / D-CN8) — a nested crew navigates EXACTLY like a top-level one: the same
  // `/assistant/agents/crew/:crewId` profile route is reused (D-CN8 — no new `<Route>`).
  if (meta.kind === "crew" || meta.kind === "sub-crew") return { kind: "crew", id: meta.crewId };
  // A lane group (Unassigned / Archived) or a cycle/missing placeholder has no profile to open.
  return null;
}

/**
 * The profile-modal route for a node, preserving the current query (so the org tab + scope stay
 * behind the modal) and adding `?settings=profile` (D-HUX6's default section). Pure — unit-tested.
 */
export function buildOrgProfilePath(
  target: OrgNavTarget,
  currentSearch: string,
): { pathname: string; search: string } {
  const params = new URLSearchParams(currentSearch);
  params.set("settings", "profile");
  return { pathname: `/assistant/agents/${target.kind}/${target.id}`, search: `?${params.toString()}` };
}

/**
 * WP4.2 (WP2.R — org-chart NODE keyboard parity). React Flow renders each node as a focusable
 * element (`nodesFocusable`) carrying `data-id="<nodeId>"` on its `.react-flow__node` wrapper — a
 * stable DOM contract. Resolve the node id a focus/keyboard event targets by walking up to that
 * element, so the app can SYNC selection (keyboard focus → inspector, mirroring a mouse click) and
 * ACTIVATE a node (Enter/Space → open profile, mirroring the mouse double-click) without reaching
 * into canvas geometry — which jsdom can't lay out, so this stays unit-testable. Returns `null` for
 * canvas chrome (zoom controls, minimap, the empty pane).
 */
export function orgNodeIdFromEventTarget(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  const nodeEl = target.closest<HTMLElement>(".react-flow__node[data-id]");
  return nodeEl?.dataset.id ?? null;
}

/** The keys that "activate" a focused org-chart node — open its profile, mirroring the mouse
 *  double-click (D-HUX9). Enter + Space, the standard activation pair for a button-like element. */
export function isOrgNodeActivateKey(key: string): boolean {
  return key === "Enter" || key === " " || key === "Spacebar";
}

type OrgData = { roles: Awaited<ReturnType<typeof listHubAgentRoles>>; crews: Awaited<ReturnType<typeof listHubCrews>> };

export function OrgChartTab() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const rawScope = searchParams.get("scope");
  // ui-wave U5 (owner feedback) — P0 #185 fix: `parseOrgRailScope` builds a FRESH scope object per
  // call, so calling it inline gave the `model` memo below an identity that changed EVERY render.
  // That re-derived `model` → `decoratedNodes` each render, and the canvas re-seed effect then ran
  // `setNodes` with a brand-new array every time — an unconditional update-per-render loop (React
  // #185, "maximum update depth") for any NON-default scope (crew/unassigned/archived). The default
  // scope never looped only because `parseOrgRailScope(null)` returns a module-level constant.
  // Deriving the scope FROM the raw param string restores stable identity, so the memo chain — and
  // therefore the effect — only re-fires when the scope (or the fetched data) actually changes.
  const scope = useMemo(() => parseOrgRailScope(rawScope), [rawScope]);
  const searchString = searchParams.toString();

  const { state, reload } = useLoadable<OrgData>(
    () =>
      Promise.all([listHubAgentRoles({ includeArchived: true }), listHubCrews()]).then(
        ([roles, crews]) => ({ roles, crews }),
      ),
    [],
  );
  const data = loadableData(state);

  const model = useMemo<OrgChartModel | null>(
    () => (data ? buildOrgChartModel({ crews: data.crews, roles: data.roles, scope }) : null),
    [data, scope],
  );

  // Inject the crew-color dot into each colored crew's group header (D-HUX8: color paired with the
  // crew name). `icon` is JSX, so it can't live in the pure model — it's applied here.
  const decoratedNodes = useMemo<Node[]>(() => {
    if (!model) return [];
    return model.nodes.map((node) => {
      if (node.type !== "group") return node;
      const meta = model.meta.get(node.id);
      if (meta?.kind === "crew" && meta.color) {
        return {
          ...node,
          data: {
            ...node.data,
            icon: (
              <span aria-hidden className={cn("size-2.5 shrink-0 rounded-full", crewAccentClasses(meta.color).dot)} />
            ),
          },
        };
      }
      return node;
    });
  }, [model]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Re-seed the canvas whenever the model changes (data load, scope switch). This also resets any
  // group collapse + selection — the correct behavior when the scope changes.
  useEffect(() => {
    setNodes(decoratedNodes);
    setEdges(model?.edges ?? []);
    setSelectedId(null);
  }, [decoratedNodes, model, setNodes, setEdges]);

  const selectedMeta = selectedId ? (model?.meta.get(selectedId) ?? null) : null;
  // Crew nesting (WP4.2 / D-CN8) — `"sub-crew"` meta only carries `parentCrewId` (an id); resolve its
  // NAME from the rest of the model so the inspector can say "Nested in <name>" (the meta Map is keyed
  // by nodeId, not crew id, so this scans the crew/sub-crew entries for a matching `crewId`).
  const selectedParentCrewName = useMemo(() => {
    if (!selectedMeta || selectedMeta.kind !== "sub-crew" || !model) return undefined;
    for (const m of model.meta.values()) {
      if ((m.kind === "crew" || m.kind === "sub-crew") && m.crewId === selectedMeta.parentCrewId) {
        return m.crewName;
      }
    }
    return undefined;
  }, [selectedMeta, model]);

  const openProfile = useCallback(
    (target: OrgNavTarget) => navigate(buildOrgProfilePath(target, searchString)),
    [navigate, searchString],
  );

  const onNodeDoubleClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      const target = nodeNavigationTarget(model?.meta.get(node.id));
      if (target) openProfile(target);
    },
    [model, openProfile],
  );

  // WP4.2 (WP2.R) — keyboard parity for the read-and-navigate org chart. React Flow keeps nodes
  // focusable but does NOT wire its internal selection to the app's `selectedId`, so a keyboard user
  // couldn't populate the inspector or open a profile from a node. Two capture handlers on the canvas
  // wrapper close that gap: focusing a node (Tab) syncs selection → the inspector populates (mirrors
  // a mouse single-click); Enter/Space opens the focused node's profile (mirrors the mouse
  // double-click). Both resolve the node id from the DOM (`orgNodeIdFromEventTarget`), so canvas
  // chrome (zoom controls, minimap) is a no-op and this needs no canvas geometry.
  const onCanvasFocusCapture = useCallback((event: React.FocusEvent) => {
    const id = orgNodeIdFromEventTarget(event.target);
    if (id) setSelectedId(id);
  }, []);

  const onCanvasKeyDownCapture = useCallback(
    (event: React.KeyboardEvent) => {
      if (!isOrgNodeActivateKey(event.key)) return;
      const id = orgNodeIdFromEventTarget(event.target);
      if (!id) return;
      const target = nodeNavigationTarget(model?.meta.get(id));
      if (!target) return;
      event.preventDefault();
      openProfile(target);
    },
    [model, openProfile],
  );

  const onInit = useCallback((instance: ReactFlowInstance) => {
    // Frame the whole fleet on first paint (no hand-placed viewport).
    instance.fitView({ padding: 0.18 });
  }, []);

  if (state.status === "loading") {
    return (
      <div className="flex h-full min-h-0 items-center justify-center">
        <Spinner className="size-6" />
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="flex h-full min-h-0 items-center justify-center p-6">
        <InlineError title="Couldn’t load the org chart" detail={state.error} onRetry={reload} />
      </div>
    );
  }
  if (!model || model.isEmpty) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center p-6">
        <EmptyState
          icon={<GitFork aria-hidden />}
          title="Nothing to chart yet"
          description={model?.emptyReason || "Create an agent or crew to populate the chart."}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 gap-3">
      {/* WP4.2 (WP2.R) — the capture handlers give a keyboard user node parity (focus → inspector,
          Enter/Space → open profile). They wrap ONLY the canvas (the InspectorPanel is a sibling). */}
      <div
        className="relative min-w-0 flex-1"
        onFocusCapture={onCanvasFocusCapture}
        onKeyDownCapture={onCanvasKeyDownCapture}
      >
        <CanvasShell
          // Remount on a scope switch so the view re-fits to the newly-scoped fleet (onInit refires).
          key={scope.kind === "crew" ? `crew:${scope.crewId}` : scope.kind}
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          onInit={onInit}
          onNodeClick={(_e, node) => setSelectedId(node.id)}
          onNodeDoubleClick={onNodeDoubleClick}
          onPaneClick={() => setSelectedId(null)}
          nodesDraggable={false}
          nodesConnectable={false}
          // Keep nodes keyboard-focusable (React Flow's default) so the capture handlers above can
          // sync selection + activate — explicit so a future default change can't silently break it.
          nodesFocusable
          elementsSelectable
          edgesFocusable={false}
          minZoom={0.15}
          maxZoom={1.6}
          proOptions={{ hideAttribution: true }}
          className="h-full w-full rounded-md border border-border bg-card"
        >
          <ZoomControls position="top-left" />
          <FlowMiniMap pannable zoomable />
          <Panel position="bottom-left">
            <OrgLegend model={model} />
          </Panel>
        </CanvasShell>
      </div>

      <InspectorPanel
        title={selectedMeta ? inspectorTitle(selectedMeta) : "Details"}
        hasSelection={!!selectedMeta}
        selectionKey={selectedId ?? undefined}
        onClose={() => setSelectedId(null)}
        emptyMessage="Select an agent or crew to see its details. Double-click — or focus a node and press Enter — to open its profile."
        side="right"
      >
        {selectedMeta ? (
          <OrgInspectorBody
            meta={selectedMeta}
            onOpenProfile={openProfile}
            parentCrewName={selectedParentCrewName}
          />
        ) : null}
      </InspectorPanel>
    </div>
  );
}

function inspectorTitle(meta: OrgNodeMeta): string {
  if (meta.kind === "agent") return meta.identity;
  // Crew nesting (WP4.2 / D-CN8) — a nested crew's inspector title is its own name, same as a
  // top-level one.
  if (meta.kind === "crew" || meta.kind === "sub-crew") return meta.crewName;
  if (meta.kind === "placeholder") return meta.label;
  return meta.title; // lane
}

/** The InspectorPanel body for the selected node — exported so it's testable without the canvas.
 *  `parentCrewName` (WP4.2 / D-CN8) — the immediate containing crew's NAME for a `"sub-crew"` node
 *  (`meta.parentCrewId` is only the id; the caller resolves the name from the full model, since this
 *  component only ever sees the one selected node's meta). */
export function OrgInspectorBody({
  meta,
  onOpenProfile,
  parentCrewName,
}: {
  meta: OrgNodeMeta;
  onOpenProfile: (target: OrgNavTarget) => void;
  parentCrewName?: string;
}) {
  if (meta.kind === "lane") {
    return (
      <div className="flex flex-col gap-2">
        <Text tone="muted" className="text-caption">
          {meta.laneId === "archived"
            ? "Archived agents are hidden from crews until restored."
            : "Agents that don’t belong to any crew yet."}
        </Text>
        <Text className="tabular-nums">
          {meta.count} agent{meta.count === 1 ? "" : "s"}
        </Text>
      </div>
    );
  }

  // Crew nesting (WP4.2 / D-CN8) — a non-recursing placeholder box (a cyclic or dangling `crewId`
  // reference): explain why, no "Open profile" action — there is nothing to open.
  if (meta.kind === "placeholder") {
    return (
      <div className="flex flex-col gap-3">
        <Badge variant="warning" className="w-fit gap-1.5">
          <AlertTriangle aria-hidden className="size-3.5" />
          {meta.reason === "cycle" ? "Circular reference" : "Missing crew"}
        </Badge>
        <Text tone="muted" className="text-caption">
          {meta.reason === "cycle"
            ? "This member refers back to a crew already above it in the nesting chain — drawing it again would loop forever, so it stops here."
            : "This member refers to a saved crew that no longer exists (it may have been deleted)."}
        </Text>
      </div>
    );
  }

  if (meta.kind === "crew" || meta.kind === "sub-crew") {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          {meta.color ? (
            <span aria-hidden className={cn("size-2.5 shrink-0 rounded-full", crewAccentClasses(meta.color).dot)} />
          ) : null}
          <Badge variant="secondary">{TOPOLOGY_LABEL[meta.topology]}</Badge>
          <Text tone="muted" className="tabular-nums text-caption">
            {meta.memberCount} member{meta.memberCount === 1 ? "" : "s"}
          </Text>
        </div>
        <Text tone="muted" className="text-caption">
          {TOPOLOGY_EDGE_MEANING[meta.topology]}
        </Text>
        {/* Crew nesting (WP4.2 / D-CN8) — a nested crew names its immediate parent, so the inspector
            makes the nesting relationship legible, not just visually implied by the box-in-box. */}
        {meta.kind === "sub-crew" ? (
          <Text tone="muted" className="text-caption">
            Nested in {parentCrewName ?? "another crew"}
          </Text>
        ) : null}
        {meta.description ? <Text className="text-pretty">{meta.description}</Text> : null}
        <Button type="button" variant="secondary" size="sm" onClick={() => onOpenProfile({ kind: "crew", id: meta.crewId })}>
          Open crew profile
        </Button>
      </div>
    );
  }

  // agent
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 text-caption">
        {meta.roleTitle && meta.roleTitle !== meta.identity ? (
          <Field label="Role">{meta.roleTitle}</Field>
        ) : null}
        {meta.model ? <Field label="Model">{meta.model}</Field> : null}
        {meta.topologyRole ? <Field label="Position">{meta.topologyRole}</Field> : null}
        {meta.crewName ? (
          <Field label="Crew">
            <span className="flex items-center gap-1.5">
              {meta.crewColor ? (
                <span aria-hidden className={cn("size-2 shrink-0 rounded-full", crewAccentClasses(meta.crewColor).dot)} />
              ) : null}
              {meta.crewName}
            </span>
          </Field>
        ) : null}
      </div>
      {meta.archived ? <Badge variant="outline">Archived</Badge> : null}
      <Button type="button" variant="secondary" size="sm" onClick={() => onOpenProfile({ kind: "agent", id: meta.agentId })}>
        Open agent profile
      </Button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right font-medium">{children}</span>
    </div>
  );
}

/** Canvas legend (D-HUX9 workstep 5): crew colors (via `@brand/flow` `Legend`) + topology edge meaning. */
export function OrgLegend({ model }: { model: OrgChartModel }) {
  const hasCrewColors = model.legendCrews.length > 0;
  return (
    <div className="flex max-w-[16rem] flex-col gap-2 rounded-md border border-border bg-card/95 p-3 shadow-sm backdrop-blur-sm">
      {hasCrewColors ? (
        <Legend
          title="Crews"
          items={model.legendCrews.map((c) => ({ label: c.name, color: `var(--${c.color})` }))}
        />
      ) : null}
      {model.topologies.length > 0 ? (
        <div className="flex flex-col gap-1">
          <Text variant="meta" tone="muted" className="flex items-center gap-1.5 font-semibold uppercase tracking-wide">
            <GitFork aria-hidden className="size-3.5" />
            <span>Topology arrows</span>
          </Text>
          <ul className="flex flex-col gap-0.5">
            {model.topologies.map((t) => (
              <li key={t} className="text-caption text-muted-foreground">
                <span className="font-medium text-foreground">{TOPOLOGY_LABEL[t]}</span> — {TOPOLOGY_EDGE_MEANING[t]}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {!hasCrewColors && model.topologies.length === 0 ? (
        <Text tone="muted" className="flex items-center gap-1.5 text-caption">
          <Users aria-hidden className="size-3.5" />
          Standalone agents
        </Text>
      ) : null}
    </div>
  );
}
