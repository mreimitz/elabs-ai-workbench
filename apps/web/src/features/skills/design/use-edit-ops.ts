import { useCallback, useMemo, useState } from "react";
import { DEFAULT_SKILL_FLOW_ID } from "@mcp-token-footprint/shared";
import type {
  SkillEditOp,
  SkillGraph,
  SkillGraphEdge,
  SkillGraphNode,
} from "@mcp-token-footprint/shared";

// ── The local edit-op buffer (panel- AND canvas-driven ops) ─────────────────────────────────────────
// The Design tab accumulates `SkillEditOp`s locally (this hook), lets the user review + save them, and
// — purely for the canvas's benefit while editing — projects a client-side PREVIEW graph so the user
// sees roughly what will change before saving. The API remains authoritative: `applyPreviewOps` is a
// best-effort, ui-only transform; the server re-projects the real graph from `SKILL.md` and is the
// only source of truth for the saved result.
//
// WP 9.1 (I10) note: this buffer is now the INTERACTION LAYER of the live-draft store (`use-skill-draft`).
// Its public API is UNCHANGED — panels stage ops exactly as before — but underneath, staging an op now
// feeds the buffer through the server-side `apply-preview` splice into the canonical draft SKILL.md text
// (so a canvas edit is reflected in the draft immediately), and the save is content-canonical
// (`POST /api/skills/:id/save-draft`) with this buffer captured as the version's intent-log metadata.
//
// Origin note (Skill IDE WP 2.2): under the older SkillFlow decisions this buffer was "panel-driven
// only; NEVER canvas drag-to-draw" — that rule forbade FREEHAND edge drawing. Skill IDE's constrained
// drag-to-connect supersedes it: a canvas drag from a section node to an asset node only ever STAGES a
// typed `connect_asset` op (and deleting a section→asset edge stages `disconnect_asset`); nothing on
// the canvas mutates the graph directly — every canvas gesture still flows through this buffer → the
// preview → the Save dialog, exactly like the panel editors do.

/** A synthetic node id prefix for `add_subroutine` preview nodes — never a real graph node id, and
 *  never sent to the server (it only exists in `applyPreviewOps`'s output for canvas rendering). */
export const PREVIEW_NODE_PREFIX = "preview:new:";

/** True for a preview-only node id minted by {@link applyPreviewOps} (an unsaved `add_subroutine`). */
export function isPreviewOnlyNodeId(nodeId: string): boolean {
  return nodeId.startsWith(PREVIEW_NODE_PREFIX);
}

/**
 * A SECTION node is one whose anchor starts at its own heading line — mirrors
 * `apps/api/src/skillflow/edit-ops.ts` `isSectionNode` EXACTLY (kept in sync by hand; both read the
 * same `SkillGraphNode` shape). Only section nodes accept `rename_node` / `update_section_body` /
 * `set_annotation` / `reorder` / `add_subroutine`-anchor — the panel uses this to decide which
 * editors to show, so it never composes an op the server would 400 on.
 */
export function isSectionNode(node: SkillGraphNode): boolean {
  if (node.kind !== "subroutine" && node.kind !== "gatekeeper" && node.kind !== "validation_gate") {
    return false;
  }
  const headingTitle = node.anchor.headingPath[node.anchor.headingPath.length - 1];
  return headingTitle !== undefined && headingTitle === node.label;
}

/** A human-readable one-liner for one op — the SaveVersionDialog's review list. */
export function describeEditOp(op: SkillEditOp, graph: SkillGraph): string {
  const label = (id: string) => graph.nodes.find((n) => n.id === id)?.label ?? id;
  switch (op.op) {
    case "rename_node":
      return `Rename “${label(op.nodeId)}” to “${op.label}”`;
    case "update_section_body":
      return `Edit the body of “${label(op.nodeId)}”`;
    case "add_subroutine":
      return `Add section “${op.title}”${op.afterNodeId ? ` after “${label(op.afterNodeId)}”` : " at the end"}`;
    case "remove_node":
      return `Remove “${label(op.nodeId)}”`;
    case "reorder":
      return `Move “${label(op.nodeId)}”${op.afterNodeId ? ` after “${label(op.afterNodeId)}”` : " to the start"}`;
    case "set_edge_condition":
      return `Set an edge condition to “${op.condition}”`;
    case "add_asset_ref":
      return `Reference “${op.path}” from “${label(op.nodeId)}”`;
    case "set_gate_expectation":
      return `Set the gate expectation on “${label(op.nodeId)}”`;
    case "set_annotation":
      return `Annotate “${label(op.nodeId)}” as ${op.kind} (id=${op.id})`;
    case "add_command":
      return `Add command “${op.command}”${op.title ? ` (${op.title})` : ""}`;
    case "rename_command":
      return `Rename command “${label(op.nodeId)}” to “${op.command}”`;
    case "delete_command":
      return `Delete command “${label(op.nodeId)}” and its flow`;
    case "connect_asset":
      return `Connect “${op.path}” to “${label(op.nodeId)}”`;
    case "disconnect_asset":
      return `Disconnect “${op.path}” from “${label(op.nodeId)}”`;
    case "add_tool_ref":
      return `Reference tool “${op.tool}” (${op.server}) from “${label(op.nodeId)}”`;
    default:
      return (op as SkillEditOp).op;
  }
}

function targetsNode(op: SkillEditOp, nodeId: string): boolean {
  return "nodeId" in op && op.nodeId === nodeId;
}

export type EditOpsController = {
  /** The ops buffer, in the order they'll be sent (append order; replacements keep their new slot). */
  ops: SkillEditOp[];
  /** True once at least one op is staged — drives the Save/Discard bar + unsaved-changes guards. */
  dirty: boolean;
  /**
   * Append an op, applying the same client-side conflict guards the server enforces (WP 4.1
   * `validateEditOps`), so a batch that would 400 or need degrading is never even composed:
   *  - `remove_node` drops every other pending op on that node (they'd conflict with the removal)
   *    and replaces an earlier pending `remove_node` on the same node (there is only ever one);
   *  - staging any OTHER op on a node that already has a pending `remove_node` is a no-op (undo the
   *    removal first — surfaced by the panel disabling those controls, not by throwing here);
   *  - a second op of the SAME type on the same node/edge REPLACES the earlier one (documented
   *    behavior per the WP: last-write-wins locally, never an error) rather than erroring like the
   *    server does when two same-type ops land in one batch;
   *  - `add_subroutine` has no natural node/edge key (it creates a new node) — every call appends.
   */
  addOp: (op: SkillEditOp) => void;
  /** Drop every pending op that targets `nodeId` (used by "undo remove" / a node-level revert). */
  discardNode: (nodeId: string) => void;
  /** Drop every pending op. */
  clear: () => void;
  /** Pending ops targeting one node (by `nodeId`), in buffer order. */
  opsForNode: (nodeId: string) => SkillEditOp[];
  /** Pending ops targeting one edge (by `edgeId`), in buffer order. */
  opsForEdge: (edgeId: string) => SkillEditOp[];
  /** Whether `nodeId` has a pending `remove_node` op. */
  isRemoved: (nodeId: string) => boolean;
};

/** The op buffer hook (WP 4.2). Takes no arguments — the buffer is independent of which graph/version
 *  is loaded; the caller (`SkillDesignView`) clears it when the version changes. */
export function useEditOps(): EditOpsController {
  const [ops, setOps] = useState<SkillEditOp[]>([]);

  const addOp = useCallback((newOp: SkillEditOp) => {
    setOps((current) => {
      if (newOp.op === "remove_node") {
        const filtered = current.filter((op) => !targetsNode(op, newOp.nodeId));
        return [...filtered, newOp];
      }
      if ("nodeId" in newOp) {
        const removalPending = current.some(
          (op) => op.op === "remove_node" && op.nodeId === newOp.nodeId,
        );
        if (removalPending) return current; // conflicting with a staged removal — no-op.
        const filtered = current.filter(
          (op) => !(op.op === newOp.op && "nodeId" in op && op.nodeId === newOp.nodeId),
        );
        return [...filtered, newOp];
      }
      if ("edgeId" in newOp) {
        const filtered = current.filter(
          (op) => !(op.op === newOp.op && "edgeId" in op && op.edgeId === newOp.edgeId),
        );
        return [...filtered, newOp];
      }
      // add_subroutine: no natural target key — every call creates a distinct new section.
      return [...current, newOp];
    });
  }, []);

  const discardNode = useCallback((nodeId: string) => {
    setOps((current) => current.filter((op) => !targetsNode(op, nodeId)));
  }, []);

  const clear = useCallback(() => setOps([]), []);

  const opsForNode = useCallback(
    (nodeId: string) => ops.filter((op) => targetsNode(op, nodeId)),
    [ops],
  );
  const opsForEdge = useCallback(
    (edgeId: string) => ops.filter((op) => "edgeId" in op && op.edgeId === edgeId),
    [ops],
  );
  const isRemoved = useCallback(
    (nodeId: string) => ops.some((op) => op.op === "remove_node" && op.nodeId === nodeId),
    [ops],
  );

  return {
    ops,
    dirty: ops.length > 0,
    addOp,
    discardNode,
    clear,
    opsForNode,
    opsForEdge,
    isRemoved,
  };
}

/** The flow a node/edge belongs to — additive `flowId`, absent ⇒ the default `'main'` body flow. */
function previewFlowOf(item: { flowId?: string }): string {
  return item.flowId ?? DEFAULT_SKILL_FLOW_ID;
}

/**
 * Apply the ops buffer to `graph` for CLIENT-SIDE PREVIEW ONLY (never sent anywhere; the API is the
 * only authority on the saved result — a save always re-projects from the real, edited `SKILL.md`).
 * Covers exactly the transforms with a graph-visual effect:
 *  - `rename_node` → label; `set_annotation` → the source badge flips to "annotated";
 *  - `add_subroutine` → a synthetic section node inserted in document order;
 *  - `remove_node` → node + its edges dropped; `set_edge_condition` → edge label;
 *  - `add_command` (WP 2.2) → a synthetic `entry_point` node on its own new flow lane (+ a `flows`
 *    entry) so the new lane appears in the preview; `rename_command` → the entry's trigger/label (and
 *    its lane label) change; `delete_command` → the whole flow (every node/edge carrying its id, incl.
 *    the entry) vanishes;
 *  - `connect_asset` (WP 2.2) → a preview edge from the section to the existing asset node;
 *    `disconnect_asset` → that section→asset edge is dropped.
 *  - `add_tool_ref` (WP 8.3) → a synthetic `tool_ref` leaf + a `calls` edge from the referencing
 *    section (the projector lifts the appended sentence into exactly this node on the next save/
 *    reproject; the preview shows it before save so the canvas reflects the staged reference).
 * Ops with no direct graph-visual effect (`update_section_body`, `set_gate_expectation`,
 * `add_asset_ref`, `reorder`, `set_keywords`, tree/file ops) are intentionally NOT reflected here —
 * they change prose/frontmatter/files the canvas doesn't render.
 */
export function applyPreviewOps(graph: SkillGraph, ops: SkillEditOp[]): SkillGraph {
  if (ops.length === 0) return graph;

  // delete_command → the whole flow (all nodes/edges carrying its flowId) drops from the preview. A
  // command entry node's flowId is its own id, so the entry itself drops with its flow.
  const deletedFlowIds = new Set<string>();
  for (const op of ops) {
    if (op.op !== "delete_command") continue;
    const entry = graph.nodes.find((n) => n.id === op.nodeId);
    if (entry) deletedFlowIds.add(entry.flowId ?? entry.id);
  }

  const removedIds = new Set(
    ops
      .filter((op): op is Extract<SkillEditOp, { op: "remove_node" }> => op.op === "remove_node")
      .map((op) => op.nodeId),
  );
  const isDropped = (node: SkillGraphNode): boolean =>
    removedIds.has(node.id) || deletedFlowIds.has(previewFlowOf(node));
  const droppedNodeIds = new Set(graph.nodes.filter(isDropped).map((n) => n.id));

  const renames = new Map<string, string>();
  const annotated = new Set<string>();
  const commandRenames = new Map<string, string>();
  for (const op of ops) {
    if (op.op === "rename_node") renames.set(op.nodeId, op.label);
    if (op.op === "set_annotation") annotated.add(op.nodeId);
    if (op.op === "rename_command") commandRenames.set(op.nodeId, op.command);
  }
  const edgeConditions = new Map<string, string>();
  for (const op of ops) {
    if (op.op === "set_edge_condition") edgeConditions.set(op.edgeId, op.condition);
  }

  // disconnect_asset → drop the section→asset edge, matched by the section's flow + the asset's path.
  const droppedEdgeIds = new Set<string>();
  for (const op of ops) {
    if (op.op !== "disconnect_asset") continue;
    const section = graph.nodes.find((n) => n.id === op.nodeId);
    if (!section) continue;
    const asset = graph.nodes.find(
      (n) =>
        n.kind === "asset" && n.path === op.path && previewFlowOf(n) === previewFlowOf(section),
    );
    if (!asset) continue;
    const edge = graph.edges.find((e) => e.from === section.id && e.to === asset.id);
    if (edge) droppedEdgeIds.add(edge.id);
  }

  let nodes: SkillGraphNode[] = graph.nodes
    .filter((node) => !droppedNodeIds.has(node.id))
    .map((node) => {
      let next = node;
      if (renames.has(node.id)) next = { ...next, label: renames.get(node.id) as string };
      if (annotated.has(node.id)) next = { ...next, source: "annotated" };
      if (next.kind === "entry_point" && commandRenames.has(node.id)) {
        const value = commandRenames.get(node.id) as string;
        next = { ...next, label: value, trigger: { ...next.trigger, value } };
      }
      return next;
    });

  const edges: SkillGraphEdge[] = graph.edges
    .filter(
      (edge) =>
        !droppedEdgeIds.has(edge.id) &&
        !droppedNodeIds.has(edge.from) &&
        !droppedNodeIds.has(edge.to),
    )
    .map((edge) =>
      edgeConditions.has(edge.id) ? { ...edge, condition: edgeConditions.get(edge.id) } : edge,
    );

  // connect_asset → a preview edge from the section to the EXISTING asset node the user dragged onto
  // (best-effort: skip if that asset node can't be located, or an edge already links the pair).
  let connectIndex = 0;
  for (const op of ops) {
    if (op.op !== "connect_asset") continue;
    const section = graph.nodes.find((n) => n.id === op.nodeId);
    if (!section || droppedNodeIds.has(section.id)) continue;
    const asset = graph.nodes.find(
      (n) =>
        n.kind === "asset" && n.path === op.path && previewFlowOf(n) === previewFlowOf(section),
    );
    if (!asset || droppedNodeIds.has(asset.id)) continue;
    if (edges.some((e) => e.from === section.id && e.to === asset.id)) continue;
    edges.push({
      id: `${PREVIEW_NODE_PREFIX}edge:${connectIndex}`,
      from: section.id,
      to: asset.id,
      ...(section.flowId !== undefined ? { flowId: section.flowId } : {}),
    });
    connectIndex += 1;
  }

  // add_tool_ref → a preview-only `tool_ref` leaf + a `calls` edge from the referencing section, so the
  // canvas reflects the staged reference before save (the projector lifts the appended sentence into
  // exactly this node/edge on the next reproject). `serverName` is left unset to match the projector
  // (text-only) — the detail card resolves it by tool name against the bound-tools list either way.
  let toolRefIndex = 0;
  for (const op of ops) {
    if (op.op !== "add_tool_ref") continue;
    const section = graph.nodes.find((n) => n.id === op.nodeId);
    if (!section || droppedNodeIds.has(section.id)) continue;
    const refId = `${PREVIEW_NODE_PREFIX}toolref:${toolRefIndex}`;
    nodes = [
      ...nodes,
      {
        id: refId,
        kind: "tool_ref",
        label: op.tool,
        toolName: op.tool,
        anchor: {
          headingPath: [],
          startLine: section.anchor.endLine + 0.5,
          endLine: section.anchor.endLine + 0.5,
        },
        source: "inferred",
        ...(section.flowId !== undefined ? { flowId: section.flowId } : {}),
      },
    ];
    edges.push({
      id: `${PREVIEW_NODE_PREFIX}edge:toolref:${toolRefIndex}`,
      from: section.id,
      to: refId,
      ...(section.flowId !== undefined ? { flowId: section.flowId } : {}),
    });
    toolRefIndex += 1;
  }

  // add_subroutine → a preview-only node placed right after its anchor in document order (fractional
  // startLine so it sorts between the anchor and the NEXT real section), or at the tail for
  // `afterNodeId: null`. `isPreviewOnlyNodeId` lets the panel recognize + special-case it.
  const maxStartLine = graph.nodes.reduce((max, n) => Math.max(max, n.anchor.startLine), 0);
  let previewIndex = 0;
  for (const op of ops) {
    if (op.op !== "add_subroutine") continue;
    const afterNode = op.afterNodeId ? graph.nodes.find((n) => n.id === op.afterNodeId) : undefined;
    const startLine = afterNode ? afterNode.anchor.endLine + 0.5 : maxStartLine + 1 + previewIndex;
    nodes = [
      ...nodes,
      {
        id: `${PREVIEW_NODE_PREFIX}${previewIndex}`,
        kind: "subroutine",
        label: op.title,
        anchor: { headingPath: [op.title], startLine, endLine: startLine },
        source: "inferred",
      },
    ];
    previewIndex += 1;
  }

  // add_command → a preview-only `entry_point` node on its OWN new flow (flowId = its id), sorted to
  // the document tail so its lane renders below the existing ones. A matching `flows` entry gives the
  // lane its `/command` label.
  let cmdIndex = 0;
  const previewFlows: NonNullable<SkillGraph["flows"]> = [];
  for (const op of ops) {
    if (op.op !== "add_command") continue;
    const entryId = `${PREVIEW_NODE_PREFIX}cmd:${cmdIndex}`;
    const startLine = maxStartLine + 100 + cmdIndex;
    nodes = [
      ...nodes,
      {
        id: entryId,
        kind: "entry_point",
        label: op.title?.trim() || op.command,
        trigger: { type: "command", value: op.command },
        anchor: { headingPath: [op.command], startLine, endLine: startLine },
        source: "inferred",
        flowId: entryId,
      },
    ];
    previewFlows.push({ id: entryId, label: op.command, entryNodeId: entryId });
    cmdIndex += 1;
  }

  nodes = [...nodes].sort((a, b) => a.anchor.startLine - b.anchor.startLine);

  // Carry `flows` through the preview (dropping deleted command flows + reflecting renames) so lane
  // labels stay accurate; append the preview command flows. Keep it absent when the source graph had
  // none and nothing added one (a single-flow skill's canvas is unchanged).
  let flows = graph.flows;
  if (graph.flows || previewFlows.length > 0) {
    flows = [
      ...(graph.flows ?? [])
        .filter((flow) => !deletedFlowIds.has(flow.id))
        .map((flow) =>
          flow.entryNodeId && commandRenames.has(flow.entryNodeId)
            ? { ...flow, label: commandRenames.get(flow.entryNodeId) as string }
            : flow,
        ),
      ...previewFlows,
    ];
  }

  return { nodes, edges, warnings: graph.warnings, ...(flows ? { flows } : {}) };
}
