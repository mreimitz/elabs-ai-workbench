import type { RunStep } from "@mcp-token-footprint/shared";
import type { StepEconomics } from "./analytics-derive";
import { dedupeToolSteps } from "./dedupe-tool-steps";

/**
 * Observability (RM-17 WP 3.5, D-OB29) — the AGENT GRAPH projection: a run's persisted `run_steps`
 * (plus WP3.1's optional `parentStepId`/`spanKind` links) rendered as a node-link graph — which tools
 * the agent reached for, how often, where it looped, and where it erred.
 *
 * This module is PURE and framework-free on purpose: it owns the whole model (nodes, edges, cycle
 * detection, deterministic layout) so it can be fixture-tested without React Flow, and so the canvas
 * component (`AgentGraphLens.tsx`) is a thin renderer with no derivation of its own. It adds NO wire
 * field, NO persisted column and NO dependency — everything below is derived from steps the console
 * has already been sent (WP 3.5 non-goals: "no new persistence … no schema change, no wire change").
 *
 * ── The two modes ─────────────────────────────────────────────────────────────────────────────────
 *  - **aggregated** (default): steps sharing a name merge into ONE node carrying a `count` (the ×N
 *    counter). Repeated sequences therefore fold back on themselves — a `turn → tool → turn` pattern
 *    becomes a genuine 2-cycle, and a tool called twice in a row becomes a self-loop. That is the
 *    run's SHAPE.
 *  - **expanded**: every call is its own node, loops unrolled, edges strictly in execution order.
 *    Acyclic by construction (the chain only ever moves forward).
 *
 * ── What becomes a node ───────────────────────────────────────────────────────────────────────────
 * A step is PRIMARY (it owns a node) when it is the operator's own message, an assistant turn, a tool
 * call, the auto-rating span, or one judge call — see {@link primaryKindOf}. Everything else (the
 * `llm_request` half of a turn, a `tool_result`, a `tool_io` roundtrip child, a `context_event`, a
 * future `probe`/`turn` span) is ATTACHED to the primary that owns it: its `parentStepId` ancestor
 * when WP3.1 hierarchy is present, otherwise the primary that preceded it. So every step lands in
 * exactly one node and NOTHING is silently dropped — which is what lets the node chips sum back to
 * the KPI-rail totals.
 *
 * A run recorded BEFORE WP3.1 carries neither `parentStepId` nor `spanKind`; it renders FLAT through
 * exactly the same code path (the "previous primary" fallback), never crashes, and reports
 * `hasHierarchy: false` so the lens can say so out loud.
 */

// ── Mode ─────────────────────────────────────────────────────────────────────────────────────────

export const AGENT_GRAPH_MODES = ["aggregated", "expanded"] as const;

export type AgentGraphMode = (typeof AGENT_GRAPH_MODES)[number];

/** The URL-param seam (`?graph=`): anything that isn't `expanded` is the default `aggregated` view. */
export function coerceAgentGraphMode(value: string | null | undefined): AgentGraphMode {
  return value === "expanded" ? "expanded" : "aggregated";
}

// ── Model ────────────────────────────────────────────────────────────────────────────────────────

/**
 * A node's role. `user`/`turn`/`tool` exist for every run; `rating`/`judge` only appear once WP3.1
 * hierarchy exposes the post-run review span and its per-judge children (the WP's "sub-step" kind).
 */
export type AgentGraphNodeKind = "user" | "turn" | "tool" | "rating" | "judge";

export type AgentGraphNode = {
  /** Stable + deep-linkable: the group key in aggregated mode, `occ:<primary step id>` in expanded. */
  id: string;
  kind: AgentGraphNodeKind;
  /** The tool name / model id / span name this node stands for. */
  label: string;
  /** How many underlying occurrences merged into this node (always 1 in expanded mode) — the ×N. */
  count: number;
  /** Every step id this node accounts for, in execution order — the click-through payload. */
  stepIds: string[];
  /** Execution order of this node's FIRST occurrence (0-based) — the deterministic tie-breaker. */
  firstOrder: number;
  tokensIn: number;
  tokensOut: number;
  /** `null` when the run carries no cumulative KPI snapshots — UNKNOWN, never a fabricated 0. */
  costUsd: number | null;
  /** Summed wall-clock over this node's PRIMARY steps only (a child mirrors its parent's window). */
  durationMs: number | null;
  /** How many of this node's steps ended in `status: "error"`. */
  errors: number;
  /** The first failing step id — the error badge's cross-link target. */
  firstErrorStepId?: string;
};

export type AgentGraphEdge = {
  id: string;
  from: string;
  to: string;
  /** How many times this transition was executed (>= 1; > 1 only in aggregated mode). */
  count: number;
  /**
   * `parent` when the edge is a WP3.1 parentage link (a judge call under its rating span);
   * `sequence` when it is plain execution order.
   */
  kind: "sequence" | "parent";
};

export type AgentGraph = {
  mode: AgentGraphMode;
  nodes: AgentGraphNode[];
  edges: AgentGraphEdge[];
  /** True when the edge set contains at least one directed cycle (a self-loop counts). */
  hasCycle: boolean;
  /** True when at least one step carried WP3.1's `parentStepId` (else the run renders flat). */
  hasHierarchy: boolean;
  /** True when per-step cumulative snapshots were supplied, so cost figures are real. */
  hasEconomics: boolean;
};

// ── Classification ───────────────────────────────────────────────────────────────────────────────

/** The node kind a step OWNS, or `null` when the step is a detail attached to another step's node. */
export function primaryKindOf(step: RunStep): AgentGraphNodeKind | null {
  if (step.spanKind === "rating") return "rating";
  if (step.spanKind === "judge_call") return "judge";
  if (step.type === "user_message") return "user";
  if (step.type === "llm_response") return "turn";
  if (step.type === "tool_call") return "tool";
  return null;
}

/** Human label for a primary step's node — the tool name, the model id, or a span name. */
function labelFor(step: RunStep, kind: AgentGraphNodeKind): string {
  if (kind === "user") return "You";
  if (kind === "tool") return step.toolName ?? step.label ?? "tool";
  if (kind === "rating") return "Rating";
  return step.label || (kind === "judge" ? "Judge" : "Assistant turn");
}

/** The aggregation key — what "steps sharing a name" means, per kind. */
function groupKeyFor(step: RunStep, kind: AgentGraphNodeKind): string {
  if (kind === "user") return "user";
  if (kind === "rating") return "rating";
  return `${kind}:${labelFor(step, kind)}`;
}

// ── Economics ────────────────────────────────────────────────────────────────────────────────────

type StepFigures = { tokensIn: number; tokensOut: number; costUsd: number | null };

const NO_FIGURES: StepFigures = { tokensIn: 0, tokensOut: 0, costUsd: null };

/**
 * ONE rule for a step's token/cost contribution, so the graph can never disagree with the KPI rail:
 *  - With cumulative snapshots (a replayed run) the figures ARE WP3.2's per-step deltas, whose sum is
 *    the run's final cumulative total — i.e. the rail's own numbers.
 *  - Without them (a live run, or a run recorded before per-step snapshots) tokens fall back to the
 *    provider-reported `usageActual`, which is exactly what the console's own from-steps KPI
 *    derivation sums, and cost is reported UNKNOWN (`null`) rather than guessed at.
 */
function figuresFor(
  step: RunStep,
  perStep: ReadonlyMap<string, StepEconomics> | null,
): StepFigures {
  if (perStep) {
    const economics = perStep.get(step.id);
    if (!economics) return { tokensIn: 0, tokensOut: 0, costUsd: 0 };
    return {
      tokensIn: economics.tokensInDelta,
      tokensOut: economics.tokensOutDelta,
      costUsd: economics.costUsdDelta,
    };
  }
  if (!step.usageActual) return NO_FIGURES;
  return {
    tokensIn: finite(step.usageActual.inputTokens),
    tokensOut: finite(step.usageActual.outputTokens),
    costUsd: null,
  };
}

function finite(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

// ── Occurrences ──────────────────────────────────────────────────────────────────────────────────

type Occurrence = {
  id: string;
  kind: AgentGraphNodeKind;
  label: string;
  groupKey: string;
  order: number;
  primaryStep: RunStep;
  steps: RunStep[];
  /** The occurrence id of the primary ancestor this one hangs off (WP3.1 parentage), when any. */
  parentOccurrenceId?: string;
};

/**
 * Walk a step's `parentStepId` chain until it reaches a step that OWNS a node, and return that step's
 * id. Bounded by the number of steps seen so far, so a corrupt/cyclic chain can never spin. Returns
 * `undefined` when the chain dangles (WP3.1 already drops forward references at persist time, but a
 * de-duped display list can still fold a literal parent away — `step-tree.ts` documents the same
 * situation) or when the run carries no hierarchy at all.
 */
function resolvePrimaryAncestor(
  step: RunStep,
  byId: ReadonlyMap<string, RunStep>,
  primaryStepIds: ReadonlySet<string>,
): string | undefined {
  let cursor = step.parentStepId;
  for (let hops = 0; cursor !== undefined && hops <= byId.size; hops += 1) {
    if (primaryStepIds.has(cursor)) return cursor;
    cursor = byId.get(cursor)?.parentStepId;
  }
  return undefined;
}

/**
 * Fold the run's steps into ordered occurrences. Non-primary steps attach to their primary ancestor
 * when hierarchy resolves it, else to the primary that PRECEDED them; a detail that arrives before
 * any primary is held in a pending buffer and attaches to the first primary that follows (and, if the
 * run never produces one, to the last occurrence — so a step is only ever lost when the run has no
 * node at all).
 */
function buildOccurrences(steps: RunStep[]): Occurrence[] {
  const byId = new Map(steps.map((step) => [step.id, step] as const));
  const primaryStepIds = new Set<string>();
  for (const step of steps) if (primaryKindOf(step) !== null) primaryStepIds.add(step.id);

  const occurrences: Occurrence[] = [];
  const occurrenceByPrimaryId = new Map<string, Occurrence>();
  const pending: RunStep[] = [];

  for (const step of steps) {
    const kind = primaryKindOf(step);
    if (kind !== null) {
      const parentPrimaryId = resolvePrimaryAncestor(step, byId, primaryStepIds);
      const parentOccurrence = parentPrimaryId
        ? occurrenceByPrimaryId.get(parentPrimaryId)
        : undefined;
      const occurrence: Occurrence = {
        id: `occ:${step.id}`,
        kind,
        label: labelFor(step, kind),
        groupKey: groupKeyFor(step, kind),
        order: occurrences.length,
        primaryStep: step,
        steps: [...pending, step],
        ...(parentOccurrence ? { parentOccurrenceId: parentOccurrence.id } : {}),
      };
      pending.length = 0;
      occurrences.push(occurrence);
      occurrenceByPrimaryId.set(step.id, occurrence);
      continue;
    }

    const ancestorId = resolvePrimaryAncestor(step, byId, primaryStepIds);
    const owner = ancestorId
      ? occurrenceByPrimaryId.get(ancestorId)
      : occurrences[occurrences.length - 1];
    if (owner) owner.steps.push(step);
    else pending.push(step);
  }

  // A trailing detail with nowhere to go still belongs to the run's last node rather than vanishing.
  const last = occurrences[occurrences.length - 1];
  if (pending.length > 0 && last) last.steps.push(...pending);

  return occurrences;
}

/** Sum one occurrence group's steps into the node figures. */
function accumulate(
  occurrences: Occurrence[],
  perStep: ReadonlyMap<string, StepEconomics> | null,
): Pick<
  AgentGraphNode,
  "stepIds" | "tokensIn" | "tokensOut" | "costUsd" | "durationMs" | "errors" | "firstErrorStepId"
> {
  const stepIds: string[] = [];
  let tokensIn = 0;
  let tokensOut = 0;
  let costUsd: number | null = perStep ? 0 : null;
  let durationMs: number | null = null;
  let errors = 0;
  let firstErrorStepId: string | undefined;

  for (const occurrence of occurrences) {
    // Wall clock comes from the PRIMARY step only: a `tool_io` child mirrors its parent's window
    // (WP3.1), so summing children would double-count the same milliseconds.
    if (typeof occurrence.primaryStep.durationMs === "number") {
      durationMs = (durationMs ?? 0) + occurrence.primaryStep.durationMs;
    }
    for (const step of occurrence.steps) {
      stepIds.push(step.id);
      const figures = figuresFor(step, perStep);
      tokensIn += figures.tokensIn;
      tokensOut += figures.tokensOut;
      if (costUsd !== null && figures.costUsd !== null) costUsd += figures.costUsd;
      if (step.status === "error") {
        errors += 1;
        if (firstErrorStepId === undefined) firstErrorStepId = step.id;
      }
    }
  }

  return {
    stepIds,
    tokensIn,
    tokensOut,
    costUsd,
    durationMs,
    errors,
    ...(firstErrorStepId !== undefined ? { firstErrorStepId } : {}),
  };
}

// ── Edges ────────────────────────────────────────────────────────────────────────────────────────

type EdgeSeed = { from: string; to: string; kind: AgentGraphEdge["kind"] };

/** Merge seeds into deduplicated edges carrying a traversal `count`; `parent` only when EVERY seed is. */
function mergeEdges(seeds: EdgeSeed[]): AgentGraphEdge[] {
  const merged = new Map<string, AgentGraphEdge>();
  for (const seed of seeds) {
    const id = `${seed.from}→${seed.to}`;
    const existing = merged.get(id);
    if (existing) {
      existing.count += 1;
      if (seed.kind !== existing.kind) existing.kind = "sequence";
      continue;
    }
    merged.set(id, { id, from: seed.from, to: seed.to, count: 1, kind: seed.kind });
  }
  return [...merged.values()];
}

/**
 * The transitions of a run, as occurrence-id pairs: the execution chain (each occurrence to the next)
 * plus an explicit parentage edge wherever a child's parent is NOT the occurrence immediately before
 * it (the adjacent case is already covered by the chain edge, which is then marked `parent`).
 */
function seedEdges(occurrences: Occurrence[]): EdgeSeed[] {
  const seeds: EdgeSeed[] = [];
  for (let i = 1; i < occurrences.length; i += 1) {
    const previous = occurrences[i - 1];
    const current = occurrences[i];
    if (!previous || !current) continue;
    const isParentLink = current.parentOccurrenceId === previous.id;
    seeds.push({ from: previous.id, to: current.id, kind: isParentLink ? "parent" : "sequence" });
  }
  for (const occurrence of occurrences) {
    const parentId = occurrence.parentOccurrenceId;
    if (parentId === undefined) continue;
    const previous = occurrences[occurrence.order - 1];
    if (previous && previous.id === parentId) continue; // already the chain edge above
    seeds.push({ from: parentId, to: occurrence.id, kind: "parent" });
  }
  return seeds;
}

/** Directed-cycle detection (three-colour DFS). A self-loop is a cycle. */
export function graphHasCycle(nodes: AgentGraphNode[], edges: AgentGraphEdge[]): boolean {
  const out = new Map<string, string[]>();
  for (const edge of edges) {
    const list = out.get(edge.from);
    if (list) list.push(edge.to);
    else out.set(edge.from, [edge.to]);
  }
  const state = new Map<string, 0 | 1 | 2>(); // 0 unseen · 1 on stack · 2 done
  const visit = (id: string): boolean => {
    if (state.get(id) === 1) return true;
    if (state.get(id) === 2) return false;
    state.set(id, 1);
    for (const next of out.get(id) ?? []) if (visit(next)) return true;
    state.set(id, 2);
    return false;
  };
  for (const node of nodes) if (visit(node.id)) return true;
  return false;
}

// ── Projection ───────────────────────────────────────────────────────────────────────────────────

export type AgentGraphInput = {
  /** The run's steps in flat `index` order (`RunStreamState.steps` / `RunDetail.steps`). */
  steps: RunStep[];
  mode: AgentGraphMode;
  /**
   * WP3.2's per-step economics (`derivePerStepEconomics`), or `null` when the run has no cumulative
   * snapshots yet. `null` means cost is reported as UNKNOWN, never as zero.
   */
  perStepEconomics?: ReadonlyMap<string, StepEconomics> | null;
};

/**
 * Project a run into its agent graph. Pure and deterministic — the same steps always yield the same
 * nodes, edges and (via {@link layoutAgentGraph}) the same positions.
 */
export function buildAgentGraph({
  steps,
  mode,
  perStepEconomics = null,
}: AgentGraphInput): AgentGraph {
  // The SAME display de-dup the step log applies: one logical row per tool call (the engine step and
  // its MCP-sink twin are one call), so a tool node's ×N is the number of calls, not of transcript rows.
  const logical = dedupeToolSteps(steps);
  const hasHierarchy = logical.some((step) => step.parentStepId != null);
  const occurrences = buildOccurrences(logical);

  if (occurrences.length === 0) {
    return {
      mode,
      nodes: [],
      edges: [],
      hasCycle: false,
      hasHierarchy,
      hasEconomics: perStepEconomics !== null,
    };
  }

  const idOf =
    mode === "expanded"
      ? (occurrence: Occurrence) => occurrence.id
      : (occurrence: Occurrence) => occurrence.groupKey;

  // Group occurrences by the mode's identity (itself in expanded, the group key in aggregated),
  // preserving first-occurrence order so the node list is stable.
  const grouped = new Map<string, Occurrence[]>();
  for (const occurrence of occurrences) {
    const id = idOf(occurrence);
    const list = grouped.get(id);
    if (list) list.push(occurrence);
    else grouped.set(id, [occurrence]);
  }

  const nodes: AgentGraphNode[] = [];
  for (const [id, group] of grouped) {
    const head = group[0];
    if (!head) continue;
    nodes.push({
      id,
      kind: head.kind,
      label: head.label,
      count: group.length,
      firstOrder: head.order,
      ...accumulate(group, perStepEconomics),
    });
  }

  // `seedEdges` derives both endpoints from `occurrences`, so every lookup resolves; a seed naming
  // an occurrence that somehow isn't there is dropped rather than crashing the lens.
  const byOccurrenceId = new Map(occurrences.map((occurrence) => [occurrence.id, occurrence]));
  const edgeSeeds: EdgeSeed[] = [];
  for (const seed of seedEdges(occurrences)) {
    const from = byOccurrenceId.get(seed.from);
    const to = byOccurrenceId.get(seed.to);
    if (!from || !to) continue;
    edgeSeeds.push({ from: idOf(from), to: idOf(to), kind: seed.kind });
  }
  const edges = mergeEdges(edgeSeeds);

  return {
    mode,
    nodes,
    edges,
    hasCycle: graphHasCycle(nodes, edges),
    hasHierarchy,
    hasEconomics: perStepEconomics !== null,
  };
}

// ── Layout ───────────────────────────────────────────────────────────────────────────────────────
//
// Hand-rolled and deterministic, mirroring `features/skills/design/graph-layout.ts` (SkillFlow's own
// note: "no layout dependency"). Aggregated lays out TOP-DOWN (shortest-hop layers, so a loop back
// edge visibly climbs); expanded lays out LEFT-TO-RIGHT in execution order, dropping a parentage
// child one row below its parent. Same graph → same positions, which is what the layout test asserts.

/** Fixed rendered node width (`AgentGraphNode` renders `w-[220px]`), so columns line up. */
export const AGENT_NODE_WIDTH = 220;
/** Horizontal stride between columns (box + clear gap for the edges/labels between them). */
export const AGENT_COL_STEP = 300;
/** Vertical stride between rows. */
export const AGENT_ROW_STEP = 150;

export type AgentGraphPosition = { x: number; y: number; depth: number };

/** Layer every node by shortest hop count from an entry node (a node nothing else points at). */
function aggregatedDepths(graph: AgentGraph): Map<string, number> {
  const incoming = new Map<string, number>();
  for (const node of graph.nodes) incoming.set(node.id, 0);
  for (const edge of graph.edges) {
    if (edge.from === edge.to) continue; // a self-loop is not an entry disqualifier
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
  }
  const out = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (edge.from === edge.to) continue;
    const list = out.get(edge.from);
    if (list) list.push(edge.to);
    else out.set(edge.from, [edge.to]);
  }

  const ordered = [...graph.nodes].sort((a, b) => a.firstOrder - b.firstOrder);
  const depths = new Map<string, number>();
  const roots = ordered.filter((node) => (incoming.get(node.id) ?? 0) === 0);
  // A wholly cyclic graph has no zero-indegree node; the earliest occurrence is then the entry.
  const seeds = roots.length > 0 ? roots : ordered.slice(0, 1);

  const queue: { id: string; depth: number }[] = seeds.map((node) => ({ id: node.id, depth: 0 }));
  for (const seed of seeds) depths.set(seed.id, 0);
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    for (const next of out.get(current.id) ?? []) {
      if (depths.has(next)) continue;
      depths.set(next, current.depth + 1);
      queue.push({ id: next, depth: current.depth + 1 });
    }
  }
  // Anything unreachable (a disconnected fragment) is appended below the deepest known layer, in
  // first-occurrence order — every node always gets a depth; layout never throws.
  let overflow = Math.max(-1, ...depths.values()) + 1;
  for (const node of ordered) {
    if (depths.has(node.id)) continue;
    depths.set(node.id, overflow);
    overflow += 1;
  }
  return depths;
}

/** Expanded depth: 0 unless the node hangs off a parentage edge, then one row below its parent. */
function expandedDepths(graph: AgentGraph): Map<string, number> {
  const parentOf = new Map<string, string>();
  for (const edge of graph.edges) {
    if (edge.kind === "parent" && !parentOf.has(edge.to)) parentOf.set(edge.to, edge.from);
  }
  const ordered = [...graph.nodes].sort((a, b) => a.firstOrder - b.firstOrder);
  const depths = new Map<string, number>();
  for (const node of ordered) {
    const parent = parentOf.get(node.id);
    const parentDepth = parent === undefined ? undefined : depths.get(parent);
    depths.set(node.id, parentDepth === undefined ? 0 : parentDepth + 1);
  }
  return depths;
}

/**
 * Deterministic positions for a graph. Aggregated: rows are shortest-hop layers, each layer centred
 * horizontally and ordered by first occurrence. Expanded: one column per occurrence in execution
 * order, rows only for parentage.
 */
export function layoutAgentGraph(graph: AgentGraph): Map<string, AgentGraphPosition> {
  const positions = new Map<string, AgentGraphPosition>();
  if (graph.nodes.length === 0) return positions;

  if (graph.mode === "expanded") {
    const depths = expandedDepths(graph);
    const ordered = [...graph.nodes].sort((a, b) => a.firstOrder - b.firstOrder);
    ordered.forEach((node, column) => {
      const depth = depths.get(node.id) ?? 0;
      positions.set(node.id, { x: column * AGENT_COL_STEP, y: depth * AGENT_ROW_STEP, depth });
    });
    return positions;
  }

  const depths = aggregatedDepths(graph);
  const layers = new Map<number, AgentGraphNode[]>();
  for (const node of [...graph.nodes].sort((a, b) => a.firstOrder - b.firstOrder)) {
    const depth = depths.get(node.id) ?? 0;
    const layer = layers.get(depth);
    if (layer) layer.push(node);
    else layers.set(depth, [node]);
  }
  for (const [depth, layer] of layers) {
    layer.forEach((node, slot) => {
      const x = (slot - (layer.length - 1) / 2) * AGENT_COL_STEP;
      positions.set(node.id, { x, y: depth * AGENT_ROW_STEP, depth });
    });
  }
  return positions;
}

// ── Node lookup helpers (the click-through / deep-link seam) ──────────────────────────────────────

/** The steps a node stands for, in execution order — what the Steps lens filters down to. */
export function stepIdsForNode(graph: AgentGraph, nodeId: string | null): Set<string> | null {
  if (!nodeId) return null;
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  return node ? new Set(node.stepIds) : null;
}

/** The node a `?focus=` deep link names, or `null` when it names nothing in this graph. */
export function findAgentGraphNode(graph: AgentGraph, nodeId: string | null): AgentGraphNode | null {
  if (!nodeId) return null;
  return graph.nodes.find((candidate) => candidate.id === nodeId) ?? null;
}
