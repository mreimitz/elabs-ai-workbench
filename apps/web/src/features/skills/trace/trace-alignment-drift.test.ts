import { describe, expect, it } from "vitest";
import type { SessionTrace, SkillGraph } from "@mcp-token-footprint/shared";
import {
  describeTraceAlignmentDrift,
  detectTraceAlignmentDrift,
  hasTraceAlignmentDrift,
} from "./trace-alignment-drift";

// RM-30 WP 7.8, decision 7 — an old trace DEGRADES WITH A VISIBLE NOTICE. Not migrated, not hidden,
// and above all not a silently thinner overlay: a reader who sees three fewer verdicts and no notice
// will conclude the run touched less than it did.

function graphWith(nodeIds: string[], edgeIds: string[]): SkillGraph {
  return {
    nodes: nodeIds.map((id, index) => ({
      id,
      kind: "subroutine" as const,
      label: id,
      anchor: { headingPath: [id], startLine: index + 1, endLine: index + 2 },
      source: "inferred" as const,
    })),
    edges: edgeIds.map((id) => ({
      id,
      from: nodeIds[0] as string,
      to: nodeIds[1] ?? (nodeIds[0] as string),
      kind: "then" as const,
    })),
    warnings: [],
  };
}

function traceWith(
  verdictNodeIds: string[],
  edgeTraversals: Record<string, number>,
  projectorVersion: number,
): SessionTrace {
  return {
    source: "run",
    ref: "run_1",
    skillVersionId: "sv_1",
    events: [],
    alignment: {
      nodeVisits: {},
      edgeTraversals,
      verdicts: verdictNodeIds.map((nodeId) => ({
        nodeId,
        status: "ok" as const,
        reason: "visited",
        evidence: [],
      })),
      unmatchedEvents: [],
      projectorVersion,
      alignerVersion: 2,
    },
  };
}

describe("detectTraceAlignmentDrift", () => {
  it("reports no drift when the trace and the graph agree", () => {
    const graph = graphWith(["a", "b"], ["e1"]);
    const trace = traceWith(["a", "b"], { e1: 1 }, 5);
    const drift = detectTraceAlignmentDrift(graph, trace, 5);
    expect(hasTraceAlignmentDrift(drift)).toBe(false);
    expect(drift.unresolvedNodeVerdicts).toBe(0);
  });

  it("counts verdicts pointing at a box the merge removed", () => {
    // The v4 projector drew one asset box PER MENTION (`asset-spec-md`, `asset-spec-md-2`); v5 merged
    // them. A recorded verdict on the second box no longer resolves — and that is the whole point.
    const graph = graphWith(["step", "asset-spec-md"], ["e1"]);
    const trace = traceWith(["step", "asset-spec-md", "asset-spec-md-2"], { e1: 1 }, 4);
    const drift = detectTraceAlignmentDrift(graph, trace, 5);
    expect(drift.unresolvedNodeVerdicts).toBe(1);
    expect(drift.totalNodeVerdicts).toBe(3);
    expect(hasTraceAlignmentDrift(drift)).toBe(true);
  });

  it("counts traversals naming an edge the graph no longer has", () => {
    const graph = graphWith(["a", "b"], ["e1"]);
    const trace = traceWith(["a"], { e1: 1, "e-gone": 2 }, 5);
    const drift = detectTraceAlignmentDrift(graph, trace, 5);
    expect(drift.unresolvedEdgeTraversals).toBe(1);
    expect(hasTraceAlignmentDrift(drift)).toBe(true);
  });

  it("treats a bare projector-version difference as drift even when every id still resolves", () => {
    const graph = graphWith(["a", "b"], ["e1"]);
    const drift = detectTraceAlignmentDrift(graph, traceWith(["a", "b"], { e1: 1 }, 4), 5);
    expect(drift.versionMismatch).toBe(true);
    expect(drift.unresolvedNodeVerdicts).toBe(0);
    expect(hasTraceAlignmentDrift(drift)).toBe(true);
  });

  it("does not call an UNKNOWN graph version a mismatch", () => {
    const graph = graphWith(["a", "b"], ["e1"]);
    const drift = detectTraceAlignmentDrift(graph, traceWith(["a"], {}, 4));
    expect(drift.versionMismatch).toBe(false);
    expect(hasTraceAlignmentDrift(drift)).toBe(false);
  });

  it("ignores a zero traversal count — an edge that was never taken is not evidence of drift", () => {
    const graph = graphWith(["a", "b"], ["e1"]);
    const drift = detectTraceAlignmentDrift(graph, traceWith(["a"], { "e-gone": 0 }, 5), 5);
    expect(drift.unresolvedEdgeTraversals).toBe(0);
  });
});

describe("describeTraceAlignmentDrift", () => {
  it("names how much no longer lines up, in plain language", () => {
    const graph = graphWith(["step"], ["e1"]);
    const trace = traceWith(["step", "gone-1", "gone-2"], { "e-gone": 3 }, 4);
    const text = describeTraceAlignmentDrift(detectTraceAlignmentDrift(graph, trace, 5));
    expect(text).toContain("2 of 3");
    expect(text).toContain("no longer exist");
    // It must say the recording is intact — the notice explains a degraded VIEW, not lost data.
    expect(text).toContain("Nothing recorded has been changed");
    // …and it must never read as a bare failure. No jargon in the headline sentence either.
    expect(text).not.toMatch(/projectorVersion|undefined|null/);
  });

  it("still says something useful when only the projector version moved", () => {
    const graph = graphWith(["a"], []);
    const text = describeTraceAlignmentDrift(
      detectTraceAlignmentDrift(graph, traceWith(["a"], {}, 4), 5),
    );
    expect(text).toContain("older version of the diagram");
    expect(text).toContain("Nothing recorded has been changed");
  });
});
