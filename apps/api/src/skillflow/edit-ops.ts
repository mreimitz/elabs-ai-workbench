import {
  DEFAULT_SKILL_FLOW_ID,
  type SkillEditOp,
  type SkillFileNode,
  type SkillGraph,
  type SkillGraphNode,
} from "@mcp-token-footprint/shared";

/**
 * The edit-op vocabulary's SEMANTIC layer (WP 4.1): validate a batch of graph-level edit ops
 * against the projected graph BEFORE any text is touched. Pure — no I/O, no text splicing (that is
 * `roundtrip.ts`); this only answers "do these ops make sense against this graph?".
 *
 * Returns a list of human-readable errors; an empty list means the batch is applicable. The route
 * maps a non-empty list to a 400. Rules:
 * - every referenced node/edge id must exist (unknown ids error WITH the list of valid ids);
 * - section ops (`rename_node`, `update_section_body`, `add_asset_ref`, `set_annotation`,
 *   `reorder`, and `add_subroutine`/`reorder` targets) must reference a SECTION node — one whose
 *   anchor starts at a heading line (accessory nodes — assets, inferred gates, loop guards — hang
 *   off a section's anchor but have no heading of their own to splice);
 * - `set_gate_expectation` must reference a `validation_gate` node;
 * - ops targeting the same node compose, EXCEPT conflicting pairs: `remove_node` combined with any
 *   other op on the same node, or two ops of the same type on the same node (ambiguous order).
 *
 * `remove_node` itself is allowed on any existing node — removing an ACCESSORY node is not a safe
 * text deletion (it means editing the referencing sentence), so `roundtrip.ts` degrades it to a
 * warning + skip rather than this layer rejecting it.
 */
export function validateEditOps(
  graph: SkillGraph,
  ops: SkillEditOp[],
  files: SkillFileNode[] = [],
): string[] {
  const errors: string[] = [];
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const edgeIds = new Set(graph.edges.map((edge) => edge.id));

  const validNodeIds = () => [...nodesById.keys()].join(", ") || "(none)";
  const validEdgeIds = () => [...edgeIds].join(", ") || "(none)";

  const requireNode = (op: SkillEditOp, nodeId: string): SkillGraphNode | undefined => {
    const node = nodesById.get(nodeId);
    if (!node) {
      errors.push(`${op.op}: unknown nodeId "${nodeId}" — valid node ids: ${validNodeIds()}.`);
    }
    return node;
  };

  const requireSectionNode = (op: SkillEditOp, nodeId: string): void => {
    const node = requireNode(op, nodeId);
    if (node && !isSectionNode(node)) {
      errors.push(
        `${op.op}: node "${nodeId}" is a ${node.kind} accessory, not a section — only section nodes (heading-anchored) can be targeted by this op.`,
      );
    }
  };

  for (const op of ops) {
    switch (op.op) {
      case "rename_node":
      case "update_section_body":
      case "add_asset_ref":
      case "set_annotation":
        requireSectionNode(op, op.nodeId);
        break;
      case "remove_node":
        requireNode(op, op.nodeId);
        break;
      case "reorder":
        requireSectionNode(op, op.nodeId);
        if (op.afterNodeId !== null) requireSectionNode(op, op.afterNodeId);
        break;
      case "add_subroutine":
        if (op.afterNodeId !== null) requireSectionNode(op, op.afterNodeId);
        break;
      case "set_gate_expectation": {
        const node = requireNode(op, op.nodeId);
        if (node && node.kind !== "validation_gate") {
          errors.push(
            `set_gate_expectation: node "${op.nodeId}" is a ${node.kind}, not a validation_gate.`,
          );
        }
        break;
      }
      case "set_edge_condition":
        if (!edgeIds.has(op.edgeId)) {
          errors.push(
            `set_edge_condition: unknown edgeId "${op.edgeId}" — valid edge ids: ${validEdgeIds()}.`,
          );
        }
        break;
      // --- Skill IDE WP 2.1 — command CRUD / keywords / asset connect-disconnect ------------------
      // Kind checks here; duplicate-token, unknown-flow, and delete-command flow-conflict validation
      // (which need the whole batch + graph flows) are collected by `findCommandOpErrors` below.
      case "add_command":
        break; // command token + afterFlowId validated in findCommandOpErrors
      case "rename_command":
      case "delete_command": {
        const node = requireNode(op, op.nodeId);
        if (node && !isCommandEntry(node)) {
          errors.push(
            `${op.op}: node "${op.nodeId}" is a ${node.kind}, not a /command entry point.`,
          );
        }
        break;
      }
      case "set_keywords":
        break; // frontmatter-only; keyword non-emptiness enforced by zod; no graph target
      case "connect_asset":
      case "disconnect_asset":
        // Wire/unwire a bundled file to a step — targets a heading-anchored SECTION node (same
        // requirement as add_asset_ref; an accessory/asset node has no body to edit).
        requireSectionNode(op, op.nodeId);
        break;
      // --- Skill IDE WP 8.3 (I9.3) — reference a bound server's tool from a section --------------------
      // Same kind rule as add_asset_ref / connect_asset: the target must be a heading-anchored SECTION
      // node (the splice appends a reference sentence to its body — an accessory node has no body to
      // edit). `server`/`tool` non-emptiness is enforced by zod; the anchored-splice semantics live in
      // `roundtrip.ts` (`applyToolRef`, reusing the same body-append machinery as add_asset_ref).
      case "add_tool_ref":
        requireSectionNode(op, op.nodeId);
        break;
      // --- Skill IDE WP 3.1 (I3) — tree/file ops: validated here against the version's FILE LIST ---
      // (unlike the graph ops above, which validate against the projected graph). The tree ENGINE
      // (`tree-ops.ts`) additionally enforces path traversal, the SKILL.md rename/delete guard, and
      // the ingest caps; this layer answers the set-level question "do these file ops make sense
      // against the current tree?" so the route can 400 with an aggregated, path-listing message.
      case "add_file":
      case "update_file":
      case "rename_file":
      case "delete_file":
        break; // collected below by `findFileOpErrors` (needs the whole batch + file list)
    }
  }

  errors.push(...findFileOpErrors(ops, files));
  errors.push(...findCommandOpErrors(graph, ops));
  errors.push(...findConflicts(ops));
  return errors;
}

/** An `entry_point` node whose trigger is a `/command` (vs a natural-language keyword). */
function isCommandEntry(
  node: SkillGraphNode,
): node is Extract<SkillGraphNode, { kind: "entry_point" }> {
  return node.kind === "entry_point" && node.trigger.type === "command";
}

/**
 * Batch-level validation for the WP 2.1 command/keyword ops, which need the projected graph's flows
 * and entry points (not just single-node lookups):
 * - a `/command` token must be UNIQUE — an `add_command`, or a `rename_command` that changes the
 *   token, may not collide with an existing projected command entry OR with another op in the batch;
 * - an `add_command`'s `afterFlowId` (if present) must name a real flow;
 * - `delete_command` removes a whole flow, so it may NOT be combined with any OTHER op that targets a
 *   node/edge inside that flow (or an `add_command` inserting into it) — ambiguous against a removal;
 * - at most one `set_keywords` per batch (two would fight over the same frontmatter block).
 */
function findCommandOpErrors(graph: SkillGraph, ops: SkillEditOp[]): string[] {
  const errors: string[] = [];
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const edgesById = new Map(graph.edges.map((edge) => [edge.id, edge]));

  const existingCommandValues = new Set<string>();
  for (const node of graph.nodes) {
    if (isCommandEntry(node)) existingCommandValues.add(node.trigger.value);
  }
  const flowIds = new Set<string>([
    DEFAULT_SKILL_FLOW_ID,
    ...(graph.flows ?? []).map((flow) => flow.id),
  ]);
  const validFlowIds = () => [...flowIds].join(", ");

  // Duplicate-token detection — validated against the PROJECTED graph's entry points + the batch.
  const claimed = new Set<string>();
  for (const op of ops) {
    if (op.op === "add_command") {
      const value = op.command.trim();
      if (existingCommandValues.has(value)) {
        errors.push(
          `add_command: command "${value}" already exists — a /command token must be unique.`,
        );
      }
      if (claimed.has(value)) {
        errors.push(`add_command: two ops in this batch target the same command token "${value}".`);
      }
      claimed.add(value);
      if (op.afterFlowId !== undefined && !flowIds.has(op.afterFlowId)) {
        errors.push(
          `add_command: unknown afterFlowId "${op.afterFlowId}" — valid flow ids: ${validFlowIds()}.`,
        );
      }
    } else if (op.op === "rename_command") {
      const node = nodesById.get(op.nodeId);
      if (!node || !isCommandEntry(node)) continue; // kind/existence error already pushed inline
      const value = op.command.trim();
      const current = node.trigger.value;
      if (value !== current) {
        if (existingCommandValues.has(value)) {
          errors.push(
            `rename_command: command "${value}" already exists — a /command token must be unique.`,
          );
        }
        if (claimed.has(value)) {
          errors.push(
            `rename_command: two ops in this batch target the same command token "${value}".`,
          );
        }
        claimed.add(value);
      }
    }
  }

  // delete_command conflict: no other op may edit inside the flow being removed.
  for (const del of ops) {
    if (del.op !== "delete_command") continue;
    const entry = nodesById.get(del.nodeId);
    if (!entry || !isCommandEntry(entry)) continue; // kind/existence error already pushed inline
    const deletedFlow = entry.flowId ?? entry.id;
    for (const other of ops) {
      if (other === del) continue;
      const targetFlow = opTargetFlow(other, nodesById, edgesById);
      if (targetFlow !== undefined && targetFlow === deletedFlow) {
        errors.push(
          `conflicting ops: delete_command on flow "${deletedFlow}" cannot be combined with a ${other.op} that targets the same flow.`,
        );
      }
    }
  }

  const keywordOps = ops.filter((op) => op.op === "set_keywords");
  if (keywordOps.length > 1) {
    errors.push(
      `conflicting ops: ${keywordOps.length} set_keywords ops in one batch (ambiguous which wins).`,
    );
  }

  return errors;
}

/** The flow an op edits within, for delete_command conflict detection (undefined ⇒ flow-agnostic). */
function opTargetFlow(
  op: SkillEditOp,
  nodesById: Map<string, SkillGraphNode>,
  edgesById: Map<string, SkillGraph["edges"][number]>,
): string | undefined {
  if (op.op === "add_command") return op.afterFlowId;
  if (op.op === "set_edge_condition") {
    const edge = edgesById.get(op.edgeId);
    return edge ? (edge.flowId ?? DEFAULT_SKILL_FLOW_ID) : undefined;
  }
  if ("nodeId" in op) {
    const node = nodesById.get(op.nodeId);
    return node ? (node.flowId ?? DEFAULT_SKILL_FLOW_ID) : undefined;
  }
  return undefined;
}

/**
 * Validate the TREE/file ops of a batch (WP 3.1, I3) against the version's current file list:
 * - `update_file`/`delete_file` and a `rename_file`'s `from` must name an EXISTING path — an unknown
 *   path errors WITH the list of valid paths (mirrors the graph ops' unknown-id message);
 * - `add_file` and a `rename_file`'s `to` must NOT collide with an existing path (target-exists);
 * - conflicting pairs across the batch: `delete_file` + `update_file` on one path, a `rename_file`
 *   whose `from` is also `delete_file`d, two `rename_file`s onto one `to`, and two `add_file`s on one
 *   path. Path traversal + the SKILL.md guard + caps live in `tree-ops.ts` (the engine), not here.
 */
function findFileOpErrors(ops: SkillEditOp[], files: SkillFileNode[]): string[] {
  const errors: string[] = [];
  const existing = new Set(files.map((file) => file.path));
  const validPaths = () => [...existing].sort().join(", ") || "(none)";

  const updated = new Set<string>();
  const deleted = new Set<string>();
  const renameFroms = new Set<string>();
  const renameTos: string[] = [];
  const added: string[] = [];

  for (const op of ops) {
    switch (op.op) {
      case "add_file":
        if (existing.has(op.path)) {
          errors.push(`add_file: "${op.path}" already exists in this version.`);
        }
        added.push(op.path);
        break;
      case "update_file":
        if (!existing.has(op.path)) {
          errors.push(`update_file: unknown path "${op.path}" — valid paths: ${validPaths()}.`);
        }
        updated.add(op.path);
        break;
      case "delete_file":
        if (!existing.has(op.path)) {
          errors.push(`delete_file: unknown path "${op.path}" — valid paths: ${validPaths()}.`);
        }
        deleted.add(op.path);
        break;
      case "rename_file":
        if (!existing.has(op.from)) {
          errors.push(`rename_file: unknown path "${op.from}" — valid paths: ${validPaths()}.`);
        }
        if (existing.has(op.to)) {
          errors.push(`rename_file: target "${op.to}" already exists in this version.`);
        }
        renameFroms.add(op.from);
        renameTos.push(op.to);
        break;
    }
  }

  for (const path of updated) {
    if (deleted.has(path)) {
      errors.push(`conflicting file ops on "${path}": it is both delete_file'd and update_file'd.`);
    }
  }
  for (const from of renameFroms) {
    if (deleted.has(from)) {
      errors.push(`conflicting file ops on "${from}": it is both delete_file'd and rename_file'd.`);
    }
  }
  const seenTo = new Set<string>();
  for (const to of renameTos) {
    if (seenTo.has(to)) {
      errors.push(`conflicting file ops: two rename_file ops target the same path "${to}".`);
    }
    seenTo.add(to);
  }
  const seenAdd = new Set<string>();
  for (const path of added) {
    if (seenAdd.has(path)) {
      errors.push(`conflicting file ops: two add_file ops target the same path "${path}".`);
    }
    seenAdd.add(path);
  }

  return errors;
}

/**
 * A SECTION node is one whose anchor starts at its own heading line — `subroutine`, `gatekeeper`,
 * or an ANNOTATED `validation_gate` section. Distinguished from accessory nodes (assets, inferred
 * gates, loop guards — which reuse their section's anchor) by the label: a section node's label IS
 * the section title, i.e. the last element of its `headingPath`; accessory labels are file
 * basenames / `Loop: …` prefixes.
 */
export function isSectionNode(node: SkillGraphNode): boolean {
  if (node.kind !== "subroutine" && node.kind !== "gatekeeper" && node.kind !== "validation_gate") {
    return false;
  }
  const headingTitle = node.anchor.headingPath[node.anchor.headingPath.length - 1];
  return headingTitle !== undefined && headingTitle === node.label;
}

/**
 * Conflicting-pair detection: `remove_node` + any other op on the same node, or two ops of the
 * same type on the same node (their composition order would be ambiguous). Distinct op types on
 * one node compose fine (e.g. rename + update body touch disjoint line ranges).
 */
function findConflicts(ops: SkillEditOp[]): string[] {
  const errors: string[] = [];
  const opsByNode = new Map<string, SkillEditOp[]>();
  for (const op of ops) {
    if (!("nodeId" in op)) continue;
    const list = opsByNode.get(op.nodeId) ?? [];
    list.push(op);
    opsByNode.set(op.nodeId, list);
  }

  for (const [nodeId, nodeOps] of opsByNode) {
    if (nodeOps.length < 2) continue;
    if (nodeOps.some((op) => op.op === "remove_node")) {
      const others = nodeOps.filter((op) => op.op !== "remove_node").map((op) => op.op);
      if (others.length > 0 || nodeOps.length > 1) {
        errors.push(
          `conflicting ops on node "${nodeId}": remove_node cannot be combined with ${
            others.join(", ") || "another remove_node"
          } on the same node.`,
        );
        continue;
      }
    }
    const seen = new Set<string>();
    for (const op of nodeOps) {
      if (seen.has(op.op)) {
        errors.push(
          `conflicting ops on node "${nodeId}": two ${op.op} ops target the same node (ambiguous order).`,
        );
        break;
      }
      seen.add(op.op);
    }
  }
  return errors;
}
