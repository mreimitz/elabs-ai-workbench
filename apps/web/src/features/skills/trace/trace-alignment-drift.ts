import type { SessionTrace, SkillGraph } from "@mcp-token-footprint/shared";

// ── RM-30 WP 7.8, decision 7 — an old trace DEGRADES WITH A VISIBLE NOTICE ────────────────────────
//
// The projector is not only the canvas's source. The same graph drives trace replay, the quality
// findings and the cross-skill trigger-collision report, and WP 7.8 changed what a node ID IS:
// duplicate file and tool boxes MERGED, so a recorded "the agent read this file" verdict may point at
// a box that no longer exists.
//
// The owner settled the call: old traces are records of past runs, not live state, so they are NOT
// migrated and NOT hidden — they degrade, and the screen SAYS SO. A silently thinner overlay is the
// one outcome ruled out: the reader would see fewer verdicts and conclude the run touched less.
//
// This module is the pure detector. It answers two questions over a (graph, trace) pair:
//   1. was the trace aligned under a DIFFERENT projector version than the graph on screen?
//   2. do any of its verdicts / traversals name ids the current graph no longer contains?
// Either one is drift. The second is what actually loses information, and it is counted, because
// "3 of 11 verdicts no longer line up" is a fact a reader can act on and "something changed" is not.

export type TraceAlignmentDrift = {
  /** The projector that produced the graph on screen (undefined when the caller has not got it yet). */
  graphProjectorVersion: number | undefined;
  /** The projector the trace's alignment was computed under. */
  traceProjectorVersion: number;
  /** True when those two differ and both are known. */
  versionMismatch: boolean;
  /** Verdicts naming a node id the current graph does not contain. */
  unresolvedNodeVerdicts: number;
  /** Traversal counts naming an edge id the current graph does not contain. */
  unresolvedEdgeTraversals: number;
  /** Total verdicts carrying a node id — the denominator a notice should quote against. */
  totalNodeVerdicts: number;
};

/** Does this drift lose anything, or change what a comparison means? */
export function hasTraceAlignmentDrift(drift: TraceAlignmentDrift): boolean {
  return (
    drift.versionMismatch || drift.unresolvedNodeVerdicts > 0 || drift.unresolvedEdgeTraversals > 0
  );
}

/**
 * Compare a recorded trace against the graph it is about to be painted onto.
 *
 * Pure and total — it never throws and never mutates either input. `graphProjectorVersion` is
 * optional because the caller may hold the graph before it holds the stamp; a missing stamp is not
 * treated as a mismatch (unknown is unknown, not wrong).
 */
export function detectTraceAlignmentDrift(
  graph: SkillGraph,
  trace: SessionTrace,
  graphProjectorVersion?: number,
): TraceAlignmentDrift {
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const edgeIds = new Set(graph.edges.map((edge) => edge.id));

  let unresolvedNodeVerdicts = 0;
  let totalNodeVerdicts = 0;
  for (const verdict of trace.alignment.verdicts) {
    if (verdict.nodeId === undefined) continue;
    totalNodeVerdicts += 1;
    if (!nodeIds.has(verdict.nodeId)) unresolvedNodeVerdicts += 1;
  }

  let unresolvedEdgeTraversals = 0;
  for (const [edgeId, count] of Object.entries(trace.alignment.edgeTraversals)) {
    if (count > 0 && !edgeIds.has(edgeId)) unresolvedEdgeTraversals += 1;
  }

  const traceProjectorVersion = trace.alignment.projectorVersion;
  return {
    graphProjectorVersion,
    traceProjectorVersion,
    versionMismatch:
      graphProjectorVersion !== undefined && graphProjectorVersion !== traceProjectorVersion,
    unresolvedNodeVerdicts,
    unresolvedEdgeTraversals,
    totalNodeVerdicts,
  };
}

/**
 * The plain-language notice for a drifted trace. No jargon, no version numbers in the headline: what
 * a reader needs is "part of this replay no longer lines up, and here is how much".
 */
export function describeTraceAlignmentDrift(drift: TraceAlignmentDrift): string {
  const parts: string[] = [];
  if (drift.unresolvedNodeVerdicts > 0) {
    parts.push(
      `${drift.unresolvedNodeVerdicts} of ${drift.totalNodeVerdicts} recorded step ${
        drift.unresolvedNodeVerdicts === 1 ? "verdict points" : "verdicts point"
      } at a box this skill no longer has`,
    );
  }
  if (drift.unresolvedEdgeTraversals > 0) {
    parts.push(
      `${drift.unresolvedEdgeTraversals} recorded ${
        drift.unresolvedEdgeTraversals === 1 ? "connection" : "connections"
      } no longer exist`,
    );
  }
  if (parts.length === 0) {
    return (
      "This run was replayed against an older version of the diagram, so what you see here may not " +
      "be arranged the way it was when the run happened. Nothing recorded has been changed."
    );
  }
  return (
    `${parts.join(", and ")}. The diagram changed after this run was recorded — boxes for the same ` +
    "file or tool were merged into one — so this overlay is incomplete rather than wrong. Nothing " +
    "recorded has been changed; re-run the test to get a replay that lines up."
  );
}
