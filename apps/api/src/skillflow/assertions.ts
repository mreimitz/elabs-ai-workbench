import type {
  AssertionResult,
  SkillGraph,
  SkillGraphNode,
  TestAssertions,
  TestSkillGate,
  TestSkillRoute,
  TraceAlignment,
  TraceVerdict,
} from "@mcp-token-footprint/shared";

/**
 * WP 5.1 — the PURE validation-gate assertion evaluator. `evaluateAssertions` turns a test's declared
 * gate expectations into per-assertion pass/fail/unevaluable results, derived ENTIRELY from a run's
 * trace alignments (the WP 2.2 output) — no execution, no re-alignment, no model calls, no I/O (D4).
 * The same `(assertions, alignments)` always yields a deep-equal `AssertionResult[]`.
 *
 * ## Inputs
 * `alignmentsBySkillId` maps each skill the run RESOLVED to `{ versionId, graph, alignment }` — the
 * concrete version's projected graph and its computed alignment. A `skillId` referenced by an
 * assertion but ABSENT from this map means the run did not attach that skill (or its version could not
 * be aligned) → the assertion is `unevaluable`, never a silent pass/fail.
 *
 * ## Semantics (one result per declared assertion, in a stable order: gates, routes, noFractures)
 *
 * | assertion | pass | fail | unevaluable |
 * | --- | --- | --- | --- |
 * | `skillGate` `expect:'visited'` | node's verdict != `unvisited` | verdict == `unvisited` | skill not attached · node id not in the version's graph |
 * | `skillGate` `expect:'pass'` | verdict == `ok` (a validation_gate that is merely `unvisited` is NOT a pass) | verdict `fracture`/`unvisited` | skill not attached · node id not in the graph |
 * | `skillRoute` | `edgeTraversals[expectedEdgeId] > 0` | traversal count 0 | skill not attached · edge id not in the graph · gatekeeper id missing · the edge is not owned by that gatekeeper |
 * | `noFractures` | no `fracture` verdict across ALL attached skills' alignments | ≥1 `fracture` verdict | no attached skill could be aligned (empty map) |
 *
 * `unevaluable` results NEVER fail a run (the run-service hook folds only `fail` — and today folds it
 * only into the additive results array, not `outcome`; see the WP 5.1 outcome decision). Confidence +
 * evidence propagate from the underlying verdict(s) where sensible.
 */
export type SkillAlignment = {
  versionId: string;
  graph: SkillGraph;
  alignment: TraceAlignment;
};

export function evaluateAssertions(
  assertions: TestAssertions,
  alignmentsBySkillId: Map<string, SkillAlignment>,
): AssertionResult[] {
  const results: AssertionResult[] = [];

  for (const gate of assertions.skillGates ?? []) {
    results.push(evaluateSkillGate(gate, alignmentsBySkillId));
  }
  for (const route of assertions.skillRoutes ?? []) {
    results.push(evaluateSkillRoute(route, alignmentsBySkillId));
  }
  if (assertions.noFractures === true) {
    results.push(evaluateNoFractures(alignmentsBySkillId));
  }

  return results;
}

// --- skillGate --------------------------------------------------------------------------------

function evaluateSkillGate(
  gate: TestSkillGate,
  alignments: Map<string, SkillAlignment>,
): AssertionResult {
  const assertion = { kind: "skillGate" as const, ...gate };
  const skill = alignments.get(gate.skillId);
  if (!skill) {
    return unevaluable(assertion, `skill "${gate.skillId}" is not attached to this run`);
  }
  const node = skill.graph.nodes.find((n) => n.id === gate.nodeId);
  if (!node) {
    return unevaluable(
      assertion,
      `node "${gate.nodeId}" is not in skill "${gate.skillId}"'s graph (version ${skill.versionId})`,
    );
  }
  const verdict = findNodeVerdict(skill.alignment, gate.nodeId);
  if (!verdict) {
    // The aligner emits exactly one verdict per graph node; a gap here is an internal inconsistency,
    // not a user misconfiguration — surface it rather than guessing a pass/fail.
    return unevaluable(assertion, `no verdict for node "${gate.nodeId}" in the alignment`);
  }

  const evidence = verdict.evidence.length > 0 ? verdict.evidence : undefined;
  if (gate.expect === "visited") {
    const passed = verdict.status !== "unvisited";
    return {
      assertion,
      status: passed ? "pass" : "fail",
      reason: passed
        ? `${nodeLabel(node)} was visited (verdict: ${verdict.status})`
        : `${nodeLabel(node)} was never visited`,
      ...(evidence ? { evidence } : {}),
      ...(verdict.confidence ? { confidence: verdict.confidence } : {}),
    };
  }

  // expect: 'pass' → the node's verdict is `ok` (a validation_gate that is merely `unvisited` — no
  // script_result / linked tool failure — is NOT a pass; `ok` already implies visited).
  const passed = verdict.status === "ok";
  return {
    assertion,
    status: passed ? "pass" : "fail",
    reason: passed
      ? `${nodeLabel(node)} passed (verdict: ok) — ${verdict.reason}`
      : `${nodeLabel(node)} did not pass (verdict: ${verdict.status}) — ${verdict.reason}`,
    ...(evidence ? { evidence } : {}),
    ...(verdict.confidence ? { confidence: verdict.confidence } : {}),
  };
}

// --- skillRoute -------------------------------------------------------------------------------

function evaluateSkillRoute(
  route: TestSkillRoute,
  alignments: Map<string, SkillAlignment>,
): AssertionResult {
  const assertion = { kind: "skillRoute" as const, ...route };
  const skill = alignments.get(route.skillId);
  if (!skill) {
    return unevaluable(assertion, `skill "${route.skillId}" is not attached to this run`);
  }
  const gatekeeper = skill.graph.nodes.find((n) => n.id === route.gatekeeperId);
  if (!gatekeeper) {
    return unevaluable(
      assertion,
      `gatekeeper "${route.gatekeeperId}" is not in skill "${route.skillId}"'s graph (version ${skill.versionId})`,
    );
  }
  const edge = skill.graph.edges.find((e) => e.id === route.expectedEdgeId);
  if (!edge) {
    return unevaluable(
      assertion,
      `edge "${route.expectedEdgeId}" is not in skill "${route.skillId}"'s graph (version ${skill.versionId})`,
    );
  }
  if (edge.from !== route.gatekeeperId) {
    return unevaluable(
      assertion,
      `edge "${route.expectedEdgeId}" is not an outgoing edge of gatekeeper "${route.gatekeeperId}"`,
    );
  }

  const traversals = skill.alignment.edgeTraversals[route.expectedEdgeId] ?? 0;
  const passed = traversals > 0;
  // Propagate the gatekeeper's verdict confidence/evidence when the route was taken (the sensible
  // underlying signal for "which branch ran"). A not-taken route has no supporting evidence.
  const gkVerdict = findNodeVerdict(skill.alignment, route.gatekeeperId);
  return {
    assertion,
    status: passed ? "pass" : "fail",
    reason: passed
      ? `route "${edgeLabel(edge, route.expectedEdgeId)}" was taken ${traversals} time(s)`
      : `route "${edgeLabel(edge, route.expectedEdgeId)}" was never taken (0 traversals)`,
    ...(passed && gkVerdict && gkVerdict.evidence.length > 0
      ? { evidence: gkVerdict.evidence }
      : {}),
    ...(passed && gkVerdict?.confidence ? { confidence: gkVerdict.confidence } : {}),
  };
}

// --- noFractures ------------------------------------------------------------------------------

function evaluateNoFractures(alignments: Map<string, SkillAlignment>): AssertionResult {
  const assertion = { kind: "noFractures" as const };
  if (alignments.size === 0) {
    return unevaluable(
      assertion,
      "no attached skill could be aligned to evaluate fractures against",
    );
  }

  const fractures: Array<{
    skillId: string;
    verdict: TraceVerdict;
    node: SkillGraphNode | undefined;
  }> = [];
  // Iterate skills in id order for a deterministic reason string, verdicts in graph/alignment order.
  for (const skillId of [...alignments.keys()].sort()) {
    const skill = alignments.get(skillId) as SkillAlignment;
    for (const verdict of skill.alignment.verdicts) {
      if (verdict.status !== "fracture") continue;
      const node = verdict.nodeId
        ? skill.graph.nodes.find((n) => n.id === verdict.nodeId)
        : undefined;
      fractures.push({ skillId, verdict, node });
    }
  }

  if (fractures.length === 0) {
    return {
      assertion,
      status: "pass",
      reason: `no fractures across ${alignments.size} attached skill(s)`,
    };
  }

  const evidence = [...new Set(fractures.flatMap((f) => f.verdict.evidence))].sort((a, b) => a - b);
  const anyExact = fractures.some((f) => f.verdict.confidence === "exact");
  const anyConfidence = fractures.some((f) => f.verdict.confidence !== undefined);
  const detail = fractures
    .map(
      (f) =>
        `${f.skillId}:${f.node ? nodeLabel(f.node) : (f.verdict.nodeId ?? f.verdict.edgeId ?? "?")}`,
    )
    .join(", ");
  return {
    assertion,
    status: "fail",
    reason: `${fractures.length} fracture(s) across attached skills: ${detail}`,
    ...(evidence.length > 0 ? { evidence } : {}),
    ...(anyConfidence ? { confidence: anyExact ? "exact" : "inferred" } : {}),
  };
}

// --- helpers ----------------------------------------------------------------------------------

/** The one verdict the aligner assembled for `nodeId` (matched on `nodeId`, ignoring any edge tag). */
function findNodeVerdict(alignment: TraceAlignment, nodeId: string): TraceVerdict | undefined {
  return alignment.verdicts.find((v) => v.nodeId === nodeId);
}

function unevaluable(assertion: AssertionResult["assertion"], reason: string): AssertionResult {
  return { assertion, status: "unevaluable", reason };
}

function nodeLabel(node: SkillGraphNode): string {
  return `${node.kind} "${node.label}" (${node.id})`;
}

function edgeLabel(edge: { condition?: string }, edgeId: string): string {
  return edge.condition ? `${edgeId} [${edge.condition}]` : edgeId;
}
