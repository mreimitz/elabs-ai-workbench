import {
  DEFAULT_LOOP_THRESHOLD,
  SKILLFLOW_ALIGNER_VERSION,
  SKILLFLOW_PROJECTOR_VERSION,
  type SkillGraph,
  type SkillGraphEdge,
  type SkillGraphNode,
  type TraceAlignment,
  type TraceEvent,
  type TraceVerdict,
} from "@mcp-token-footprint/shared";

/**
 * WP 2.2 — the deterministic trace-alignment engine (D7a). `alignTrace(graph, events)` is a PURE
 * conformance check of a normalized event stream against a projected `SkillGraph`: no model calls,
 * no network, no filesystem, no clock — the same `(graph, events, opts)` always yields a deep-equal
 * `TraceAlignment`. Anything the deterministic rules cannot attribute lands in `unmatchedEvents`
 * (honest coverage — no silent drops, no fuzzy string similarity, no guessing).
 *
 * ## Matching rules (deterministic signals only)
 *
 * | signal | rule |
 * | --- | --- |
 * | `skill_file_read` | `payload.path === asset.path` → visit EVERY asset node with that path (the projector emits one asset node per referencing section, and the trace cannot tell which reference the agent followed), traverse each asset's in-edge from its referencing section, and mark subroutine referencing sections visited. |
 * | `script_result` | `payload.script === gate.script` → visit the gate (+ its referencing subroutine section). `exitCode 0` contributes `ok`; non-zero contributes a `fracture` whose reason carries the exit code and whose evidence is the event idx. |
 * | `tool_result` degradation | See {@link bindToolErrorsToGate} — gates with NO `script_result` evidence may bind a *failed* tool result, but only over a deterministic link. Internal runs persist no structured exit codes (WP 2.1 ground truth), so this is the only gate evidence they can offer. |
 * | `marker` | `payload.gateId === a gatekeeper id` → visit it; `payload.routeId === an outgoing edge id` → traverse that edge; a `routeId` naming no outgoing edge → fracture on the gatekeeper (expected-vs-actual in the reason, the named route on `edgeId`). A `gateId` naming a subroutine section visits that section. Any other marker is unmatched. |
 * | gatekeeper inference | See {@link inferGatekeepers} — no marker, no fracture; conservative downstream implication only. |
 * | section implication | A subroutine section is visited when an event visits one of its attached accessory nodes (asset / validation_gate reached over an edge from the section), or a marker names it. Internal runs emit no direct section signal, so a section with no visited accessories staying `unvisited` is honest coverage, not a bug (LLM-judge semantics are out of scope — D7c). |
 * | loop detection | Any single node visited more than `loopThreshold` (default {@link DEFAULT_LOOP_THRESHOLD}) times, or a `loop_guard`'s owning section exceeding its `maxIterations` → fracture on the governing loop guard (or on the over-visited node itself when no guard is attached), visit count in the reason. |
 *
 * ## Verdict assembly
 * Every graph node gets exactly one verdict: `fracture` (any fracture evidence) > `ok` (visited,
 * no fracture) > `unvisited`. Edges carry no verdicts of their own — traversals are counted in
 * `edgeTraversals` — except a marker route mismatch, whose fracture verdict also names the bogus
 * route on `edgeId`. Every verdict's `evidence` cites event idxs present in the input.
 *
 * ## Confidence (WP 3.2, additive)
 * Every verdict also carries `confidence`: `'exact'` when its evidence cites at least one `marker`
 * or `script_result` event (deterministic hard evidence — an explicit breadcrumb naming the gate/
 * route, or an observed script exit code), `'inferred'` otherwise. This is a plain read over the
 * already-assembled verdicts ({@link withConfidence}) — it changes no matching rule above, only
 * tags the result. A trace with NO marker/script_result event anywhere (the honest WP 2.1 internal-
 * run reality — no exit codes, no breadcrumbs) therefore has every verdict, including every
 * `unvisited` one, come back `'inferred'`, exactly the Phase-2 behavior plus the new field (D2:
 * zero-annotation skills keep working unchanged). One documented nuance: `inferGatekeepers` folds a
 * visited downstream node's OWN evidence into the gatekeeper it implies (see below) — so a
 * conservatively-implied gatekeeper whose downstream branch happens to pass through a script_result-
 * backed gate inherits that idx and reads `'exact'` too. This is intentional, not a leak: the
 * gatekeeper's branch is only "implied" in the sense of the aligner deciding it was traversed, but
 * the traversal itself is then confirmed by real deterministic evidence further downstream.
 */
export type AlignOptions = {
  /** Visit-count ceiling for generic loop detection (default {@link DEFAULT_LOOP_THRESHOLD}). */
  loopThreshold?: number;
  /**
   * The projector version the graph was computed under (the graph route already has it — pass it
   * through). Defaults to the current {@link SKILLFLOW_PROJECTOR_VERSION}.
   */
  projectorVersion?: number;
};

export function alignTrace(
  graph: SkillGraph,
  events: TraceEvent[],
  opts?: AlignOptions,
): TraceAlignment {
  const loopThreshold = opts?.loopThreshold ?? DEFAULT_LOOP_THRESHOLD;
  const state = new AlignmentState(graph);

  matchAssetReads(state, events);
  matchScriptResults(state, events);
  bindToolErrorsToGate(state, events);
  matchMarkers(state, events);
  inferGatekeepers(state);
  detectLoops(state, loopThreshold);

  return {
    nodeVisits: state.nodeVisitsRecord(),
    edgeTraversals: state.edgeTraversalsRecord(),
    verdicts: withConfidence(state.assembleVerdicts(), events),
    unmatchedEvents: state.unmatchedEvents(events),
    projectorVersion: opts?.projectorVersion ?? SKILLFLOW_PROJECTOR_VERSION,
    alignerVersion: SKILLFLOW_ALIGNER_VERSION,
  };
}

/**
 * WP 3.2 — tag every verdict with `confidence`: `'exact'` when ANY of its evidence idxs is a
 * `marker` or `script_result` event in the input, `'inferred'` otherwise (including every verdict
 * with no evidence at all, e.g. `unvisited`). Deterministic + a pure function of the already-built
 * verdicts and the event stream — no new matching semantics, purely an additive tag.
 */
function withConfidence(verdicts: TraceVerdict[], events: TraceEvent[]): TraceVerdict[] {
  const hardEvidenceIdxs = new Set(
    events
      .filter((event) => event.type === "marker" || event.type === "script_result")
      .map((event) => event.idx),
  );
  return verdicts.map((verdict) => ({
    ...verdict,
    confidence: verdict.evidence.some((idx) => hardEvidenceIdxs.has(idx)) ? "exact" : "inferred",
  }));
}

// --- Rule passes ----------------------------------------------------------------------------------

/** `skill_file_read` path → asset node(s): visit, traverse the referencing-section edge, imply the section. */
function matchAssetReads(state: AlignmentState, events: TraceEvent[]): void {
  for (const event of events) {
    if (event.type !== "skill_file_read") continue;
    const assets = state.assetsByPath.get(event.payload.path) ?? [];
    for (const asset of assets) {
      state.visitAccessory(asset, event.idx);
      state.matched.add(event.idx);
    }
  }
}

/** `script_result` script → validation gate(s): visit; exit 0 contributes ok, non-zero a fracture. */
function matchScriptResults(state: AlignmentState, events: TraceEvent[]): void {
  for (const event of events) {
    if (event.type !== "script_result") continue;
    const script = event.payload.script;
    if (!script) continue; // a script_result without a script names no gate — stays unmatched
    const gates = state.gatesByScript.get(script) ?? [];
    for (const gate of gates) {
      state.visitAccessory(gate, event.idx);
      state.gatesWithScriptEvidence.add(gate.id);
      state.matched.add(event.idx);
      if (event.payload.exitCode !== 0) {
        state.fracture(
          gate.id,
          `script ${script} exited ${event.payload.exitCode} (expected exit 0)`,
          [event.idx],
        );
      }
    }
  }
}

/**
 * Degradation rule for gates with NO `script_result` evidence (the internal-run reality — persisted
 * tool results carry no structured exit codes): a `tool_result` with `status: "error"`, paired with
 * its preceding `tool_call` (same tool name, nearest earlier idx), may be bound to a gate ONLY when
 * the trace offers a deterministic link:
 *   (a) an earlier `skill_file_read` of the gate's exact `script` path (the agent demonstrably
 *       engaged with that script before the failing call), or
 *   (b) the tool name literally containing the script's basename (e.g. a `run_validate.py` tool).
 * When bound, the failure is a fracture with the call/result (+link) idxs as evidence. With no
 * deterministic link the gate is simply left `unvisited` — we do NOT guess which tool failure (if
 * any) was the gate. Deliberately asymmetric: an `ok` tool result is NEVER treated as gate-pass
 * evidence even when linked — a generic tool success does not prove the gate's expectation held,
 * while a linked failure is strong enough to surface.
 */
function bindToolErrorsToGate(state: AlignmentState, events: TraceEvent[]): void {
  for (const gate of state.gates) {
    if (state.gatesWithScriptEvidence.has(gate.id)) continue;
    const scriptBase = basename(gate.script);

    for (const result of events) {
      if (result.type !== "tool_result" || result.payload.status !== "error") continue;
      const tool = result.payload.tool;
      if (!tool) continue; // no tool name → cannot pair a preceding call deterministically
      const call = nearestEarlierToolCall(events, tool, result.idx);
      if (!call) continue;

      const evidence: number[] = [];
      if (call.payload.tool.includes(scriptBase)) {
        evidence.push(call.idx, result.idx); // link (b): tool name names the script
      } else {
        const link = events.find(
          (e) => e.type === "skill_file_read" && e.payload.path === gate.script && e.idx < call.idx,
        );
        if (!link) continue; // no deterministic link → do NOT bind; the gate stays unvisited
        evidence.push(link.idx, call.idx, result.idx); // link (a): earlier read of the script itself
      }

      state.visitAccessory(gate, result.idx);
      for (const idx of evidence) state.matched.add(idx);
      state.fracture(
        gate.id,
        `tool "${tool}" failed and is deterministically linked to ${gate.script} (no script_result evidence available)`,
        evidence,
      );
    }
  }
}

/** `marker` events: gatekeeper visit + exact route matching; a named section is visited; else unmatched. */
function matchMarkers(state: AlignmentState, events: TraceEvent[]): void {
  for (const event of events) {
    if (event.type !== "marker") continue;
    const gateId = event.payload.gateId;
    if (!gateId) continue; // a raw marker with no parsed gateId matches nothing (WP 3.2 hardens parsing)
    const node = state.byId.get(gateId);
    if (!node) continue;

    if (node.kind === "gatekeeper") {
      state.visit(node.id, event.idx);
      state.markerVisited.add(node.id);
      state.matched.add(event.idx);
      const routeId = event.payload.routeId;
      if (!routeId) continue;
      const outgoing = state.outEdges.get(node.id) ?? [];
      const edge = outgoing.find((e) => e.id === routeId);
      if (edge) {
        state.traverse(edge.id);
      } else {
        const expected = outgoing.map((e) => e.id).join(", ") || "(none)";
        state.fracture(
          node.id,
          `marker route "${routeId}" matches no outgoing edge of gatekeeper "${node.id}" (expected one of: ${expected}; actual: "${routeId}")`,
          [event.idx],
          routeId,
        );
      }
    } else if (node.kind === "subroutine") {
      // A marker may also name a section directly ("a marker names them").
      state.visit(node.id, event.idx);
      state.matched.add(event.idx);
    }
    // Markers naming asset/gate/loop_guard ids are not a defined signal — left unmatched (honest).
  }
}

/**
 * CONSERVATIVE gatekeeper inference for gatekeepers WITHOUT marker evidence (markers, when present,
 * are authoritative and suppress inference for that node). The simple version, on purpose:
 *  - only CONDITIONAL outgoing edges (a labelled branch) participate — a plain sequential edge out
 *    of a gatekeeper implies nothing about which branch was taken;
 *  - a branch counts as "taken" when any node reachable from its target (following all edges) was
 *    visited by an earlier pass (direct asset/gate visits, implied sections, marker visits);
 *  - every taken branch is traversed (if several branches lead to visited territory we traverse
 *    each — the trace does not disambiguate, and we do not guess);
 *  - the gatekeeper itself is visited once when at least one branch was taken, with the implying
 *    events as evidence;
 *  - NO fracture is ever produced here — without marker evidence (WP 3.2's breadcrumb convention)
 *    misrouting cannot be proven deterministically, so a silent gatekeeper stays `unvisited`
 *    rather than being judged.
 */
function inferGatekeepers(state: AlignmentState): void {
  for (const node of state.graph.nodes) {
    if (node.kind !== "gatekeeper" || state.markerVisited.has(node.id)) continue;
    const conditional = (state.outEdges.get(node.id) ?? []).filter(
      (e) => e.condition !== undefined,
    );
    const implyingEvidence = new Set<number>();
    let takenBranches = 0;

    for (const edge of conditional) {
      const reachable = state.reachableFrom(edge.to);
      const visitedDownstream = [...reachable].filter((id) => (state.visits.get(id) ?? 0) > 0);
      if (visitedDownstream.length === 0) continue;
      takenBranches += 1;
      state.traverse(edge.id);
      for (const id of visitedDownstream) {
        for (const idx of state.evidence.get(id) ?? []) implyingEvidence.add(idx);
      }
    }

    if (takenBranches > 0) {
      state.visit(node.id, ...[...implyingEvidence]);
      state.okNote.set(
        node.id,
        `implied: downstream visits reach through ${takenBranches} condition branch(es)`,
      );
    }
  }
}

/**
 * Loop detection: (a) a `loop_guard` whose owning section was visited more than its
 * `maxIterations` → fracture on the guard; (b) any other node visited more than `loopThreshold`
 * → fracture on its governing loop guard (the guard attached to the node itself, or to the node's
 * referencing section) — or on the node itself when no guard is attached. Visit counts land in the
 * reason; evidence is the visiting events.
 */
function detectLoops(state: AlignmentState, loopThreshold: number): void {
  // (a) explicit loop guards with an iteration cap.
  for (const node of state.graph.nodes) {
    if (node.kind !== "loop_guard" || node.maxIterations === undefined) continue;
    const section = state.owningSectionOf(node.id);
    if (!section) continue;
    const count = state.visits.get(section.id) ?? 0;
    if (count > node.maxIterations) {
      state.fracture(
        node.id,
        `section "${section.label}" visited ${count} times — exceeds the loop guard's maxIterations of ${node.maxIterations}`,
        [...(state.evidence.get(section.id) ?? [])],
      );
    }
  }

  // (b) the generic visit-count ceiling.
  for (const node of state.graph.nodes) {
    if (node.kind === "loop_guard") continue;
    const count = state.visits.get(node.id) ?? 0;
    if (count <= loopThreshold) continue;
    const guard = state.guardFor(node.id);
    state.fracture(
      (guard ?? node).id,
      `"${node.label}" visited ${count} times — over the loop threshold of ${loopThreshold}`,
      [...(state.evidence.get(node.id) ?? [])],
    );
  }
}

// --- Alignment state ------------------------------------------------------------------------------

type Fracture = { reasons: string[]; evidence: Set<number>; edgeId?: string };
type GateNode = Extract<SkillGraphNode, { kind: "validation_gate" }>;

/** Mutable working state for one alignment run. All iteration follows graph/event order → determinism. */
class AlignmentState {
  readonly byId = new Map<string, SkillGraphNode>();
  readonly assetsByPath = new Map<string, Array<Extract<SkillGraphNode, { kind: "asset" }>>>();
  readonly gates: GateNode[] = [];
  readonly gatesByScript = new Map<string, GateNode[]>();
  readonly outEdges = new Map<string, SkillGraphEdge[]>();
  readonly inEdges = new Map<string, SkillGraphEdge[]>();

  readonly visits = new Map<string, number>();
  readonly evidence = new Map<string, Set<number>>();
  readonly traversals = new Map<string, number>();
  readonly fractures = new Map<string, Fracture>();
  readonly matched = new Set<number>();
  readonly markerVisited = new Set<string>();
  readonly gatesWithScriptEvidence = new Set<string>();
  readonly okNote = new Map<string, string>();

  constructor(readonly graph: SkillGraph) {
    for (const node of graph.nodes) {
      this.byId.set(node.id, node);
      if (node.kind === "asset") {
        const list = this.assetsByPath.get(node.path) ?? [];
        list.push(node);
        this.assetsByPath.set(node.path, list);
      } else if (node.kind === "validation_gate") {
        this.gates.push(node);
        const list = this.gatesByScript.get(node.script) ?? [];
        list.push(node);
        this.gatesByScript.set(node.script, list);
      }
    }
    for (const edge of graph.edges) {
      const out = this.outEdges.get(edge.from) ?? [];
      out.push(edge);
      this.outEdges.set(edge.from, out);
      const inn = this.inEdges.get(edge.to) ?? [];
      inn.push(edge);
      this.inEdges.set(edge.to, inn);
    }
  }

  visit(nodeId: string, ...eventIdxs: number[]): void {
    this.visits.set(nodeId, (this.visits.get(nodeId) ?? 0) + 1);
    const set = this.evidence.get(nodeId) ?? new Set<number>();
    for (const idx of eventIdxs) set.add(idx);
    this.evidence.set(nodeId, set);
  }

  /**
   * Visit an accessory node (asset / validation gate) from one event: count the visit, traverse the
   * in-edge from its referencing section, and imply that section — but only a SUBROUTINE section.
   * A gatekeeper owning an accessory is deliberately NOT marked visited here (gatekeepers are only
   * visited via markers or the conservative branch inference), though the edge itself is traversed.
   */
  visitAccessory(node: SkillGraphNode, eventIdx: number): void {
    this.visit(node.id, eventIdx);
    for (const edge of this.inEdges.get(node.id) ?? []) {
      const from = this.byId.get(edge.from);
      if (!from || (from.kind !== "subroutine" && from.kind !== "gatekeeper")) continue;
      this.traverse(edge.id);
      if (from.kind === "subroutine") this.visit(from.id, eventIdx);
    }
  }

  traverse(edgeId: string): void {
    this.traversals.set(edgeId, (this.traversals.get(edgeId) ?? 0) + 1);
  }

  fracture(nodeId: string, reason: string, evidence: number[], edgeId?: string): void {
    const entry = this.fractures.get(nodeId) ?? { reasons: [], evidence: new Set<number>() };
    entry.reasons.push(reason);
    for (const idx of evidence) entry.evidence.add(idx);
    if (edgeId && entry.edgeId === undefined) entry.edgeId = edgeId;
    this.fractures.set(nodeId, entry);
  }

  /** All node ids reachable from `startId` (inclusive), following edges forward. */
  reachableFrom(startId: string): Set<string> {
    const seen = new Set<string>([startId]);
    const queue = [startId];
    while (queue.length > 0) {
      const current = queue.shift() as string;
      for (const edge of this.outEdges.get(current) ?? []) {
        if (seen.has(edge.to)) continue;
        seen.add(edge.to);
        queue.push(edge.to);
      }
    }
    return seen;
  }

  /** The section (subroutine/gatekeeper) node an accessory/loop-guard hangs off (its in-edge source). */
  owningSectionOf(nodeId: string): SkillGraphNode | undefined {
    for (const edge of this.inEdges.get(nodeId) ?? []) {
      const from = this.byId.get(edge.from);
      if (from && (from.kind === "subroutine" || from.kind === "gatekeeper")) return from;
    }
    return undefined;
  }

  /**
   * The loop guard governing a node: attached to the node itself, or — for ACCESSORY nodes
   * (asset / validation gate) only — attached to their referencing section. A section never
   * inherits a guard through its sequential in-edge (that edge's source is the *previous*
   * section, whose guard governs different territory).
   */
  guardFor(nodeId: string): SkillGraphNode | undefined {
    const attachedTo = (ownerId: string): SkillGraphNode | undefined => {
      for (const edge of this.outEdges.get(ownerId) ?? []) {
        const to = this.byId.get(edge.to);
        if (to?.kind === "loop_guard") return to;
      }
      return undefined;
    };
    const own = attachedTo(nodeId);
    if (own) return own;
    const kind = this.byId.get(nodeId)?.kind;
    if (kind !== "asset" && kind !== "validation_gate") return undefined;
    const section = this.owningSectionOf(nodeId);
    return section ? attachedTo(section.id) : undefined;
  }

  nodeVisitsRecord(): Record<string, number> {
    const record: Record<string, number> = {};
    for (const node of this.graph.nodes) {
      const count = this.visits.get(node.id) ?? 0;
      if (count > 0) record[node.id] = count;
    }
    return record;
  }

  edgeTraversalsRecord(): Record<string, number> {
    const record: Record<string, number> = {};
    for (const edge of this.graph.edges) {
      const count = this.traversals.get(edge.id) ?? 0;
      if (count > 0) record[edge.id] = count;
    }
    return record;
  }

  /** One verdict per graph node, in graph order: fracture > ok (visited) > unvisited. */
  assembleVerdicts(): TraceVerdict[] {
    const verdicts: TraceVerdict[] = [];
    for (const node of this.graph.nodes) {
      const fracture = this.fractures.get(node.id);
      if (fracture) {
        verdicts.push({
          nodeId: node.id,
          ...(fracture.edgeId ? { edgeId: fracture.edgeId } : {}),
          status: "fracture",
          reason: fracture.reasons.join("; "),
          evidence: sorted(fracture.evidence),
        });
        continue;
      }
      const count = this.visits.get(node.id) ?? 0;
      if (count > 0) {
        const note = this.okNote.get(node.id);
        verdicts.push({
          nodeId: node.id,
          status: "ok",
          reason: note ?? `visited ${count} time(s)`,
          evidence: sorted(this.evidence.get(node.id) ?? new Set()),
        });
        continue;
      }
      verdicts.push({
        nodeId: node.id,
        status: "unvisited",
        reason: unvisitedReason(node),
        evidence: [],
      });
    }
    return verdicts;
  }

  unmatchedEvents(events: TraceEvent[]): number[] {
    return events.filter((event) => !this.matched.has(event.idx)).map((event) => event.idx);
  }
}

// --- Small pure helpers ---------------------------------------------------------------------------

/** The nearest `tool_call` for `tool` strictly before `beforeIdx` (the failing result's own call). */
function nearestEarlierToolCall(
  events: TraceEvent[],
  tool: string,
  beforeIdx: number,
): Extract<TraceEvent, { type: "tool_call" }> | undefined {
  let best: Extract<TraceEvent, { type: "tool_call" }> | undefined;
  for (const event of events) {
    if (event.type !== "tool_call" || event.idx >= beforeIdx) continue;
    if (event.payload.tool !== tool) continue;
    if (!best || event.idx > best.idx) best = event;
  }
  return best;
}

/** Honest per-kind phrasing for an unvisited node (why silence is expected, not judged). */
function unvisitedReason(node: SkillGraphNode): string {
  switch (node.kind) {
    case "asset":
      return `no skill_file_read of ${node.path} in the trace`;
    case "validation_gate":
      return `no script_result for ${node.script} and no deterministically linked tool failure — not judged`;
    case "gatekeeper":
      return "no marker evidence and no downstream visits imply a branch — not judged";
    case "loop_guard":
      return "loop guard not triggered";
    default:
      return "no deterministic signal reached this section (internal runs emit no direct section events)";
  }
}

function basename(p: string): string {
  const parts = p.split("/");
  return parts[parts.length - 1] ?? p;
}

function sorted(values: Set<number>): number[] {
  return [...values].sort((a, b) => a - b);
}
