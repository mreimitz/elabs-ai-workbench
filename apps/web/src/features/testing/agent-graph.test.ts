import type { RunStep } from "@mcp-token-footprint/shared";
import { describe, expect, test } from "vitest";
import { derivePerStepEconomics, type StepCumulativeKpi } from "./analytics-derive";
import {
  buildAgentGraph,
  coerceAgentGraphMode,
  findAgentGraphNode,
  graphHasCycle,
  layoutAgentGraph,
  primaryKindOf,
  stepIdsForNode,
  type AgentGraph,
} from "./agent-graph";

/**
 * Observability WP 3.5 — the agent-graph PROJECTION, fixture-tested against the four run shapes the
 * WP's acceptance names: a linear run, a looping run, an erroring run, and a run with NO WP3.1
 * hierarchy (pre-WP3.1 data must render flat and never crash). The projection is pure, so everything
 * here is asserted on the model itself — the canvas rendering is locked separately in
 * `AgentGraphLens.test.tsx`, which asserts on the props actually handed to the graph library.
 */

let seq = 0;
function step(over: Partial<RunStep> & Pick<RunStep, "type">): RunStep {
  seq += 1;
  return {
    id: over.id ?? `run:step:${seq}`,
    runId: "run-1",
    index: over.index ?? seq,
    label: over.label ?? over.type,
    status: "ok",
    profileTokens: {},
    payload: {},
    ...over,
  } as RunStep;
}

function reset() {
  seq = 0;
}

// ── Fixtures ─────────────────────────────────────────────────────────────────────────────────────

/** LINEAR — the operator prompts, the model answers once, one tool is called. No repetition. */
function linearRun(): RunStep[] {
  reset();
  return [
    step({ id: "s1", type: "user_message", label: "user.msg" }),
    step({ id: "s2", type: "llm_response", label: "gpt-4o", turnIndex: 0, durationMs: 1200 }),
    step({ id: "s3", type: "tool_call", toolName: "search_docs", label: "search_docs", durationMs: 300 }),
    step({ id: "s4", type: "tool_result", label: "search_docs" }),
  ];
}

/** LOOPING — the model calls the SAME tool across three turns; the aggregated graph must fold it. */
function loopingRun(): RunStep[] {
  reset();
  return [
    step({ id: "s1", type: "user_message", label: "user.msg" }),
    step({ id: "s2", type: "llm_response", label: "gpt-4o", turnIndex: 0 }),
    step({ id: "s3", type: "tool_call", toolName: "search_docs", label: "search_docs" }),
    step({ id: "s4", type: "tool_result", label: "search_docs" }),
    step({ id: "s5", type: "llm_response", label: "gpt-4o", turnIndex: 1 }),
    step({ id: "s6", type: "tool_call", toolName: "search_docs", label: "search_docs" }),
    step({ id: "s7", type: "tool_result", label: "search_docs" }),
    step({ id: "s8", type: "llm_response", label: "gpt-4o", turnIndex: 2 }),
  ];
}

/** ERRORING — the second call of a repeated tool fails. */
function erroringRun(): RunStep[] {
  reset();
  return [
    step({ id: "s1", type: "user_message", label: "user.msg" }),
    step({ id: "s2", type: "llm_response", label: "gpt-4o" }),
    step({ id: "s3", type: "tool_call", toolName: "fetch_page", label: "fetch_page" }),
    step({ id: "s4", type: "llm_response", label: "gpt-4o" }),
    step({ id: "s5", type: "tool_call", toolName: "fetch_page", label: "fetch_page", status: "error" }),
    step({ id: "s6", type: "tool_result", label: "fetch_page", status: "error" }),
  ];
}

/**
 * NO HIERARCHY — a run recorded before WP3.1: not one `parentStepId`, not one `spanKind`, and the
 * request/response halves both present. This is the "renders flat, never crashes" fixture.
 */
function flatLegacyRun(): RunStep[] {
  reset();
  return [
    step({ id: "s1", type: "context_event", label: "context.event" }),
    step({ id: "s2", type: "user_message", label: "user.msg" }),
    step({ id: "s3", type: "llm_request", label: "gpt-4o" }),
    step({ id: "s4", type: "llm_response", label: "gpt-4o" }),
    step({ id: "s5", type: "tool_call", toolName: "list_files", label: "list_files" }),
    step({ id: "s6", type: "tool_result", label: "list_files" }),
    step({ id: "s7", type: "llm_request", label: "gpt-4o" }),
    step({ id: "s8", type: "llm_response", label: "gpt-4o" }),
  ];
}

/** HIERARCHICAL — the WP3.1 shapes: a `tool_io` child under its call, judge calls under the rating span. */
function hierarchicalRun(): RunStep[] {
  reset();
  return [
    step({ id: "s1", type: "user_message", label: "user.msg" }),
    step({ id: "s2", type: "llm_response", label: "gpt-4o" }),
    step({ id: "s3", type: "tool_call", toolName: "search_docs", label: "search_docs" }),
    step({
      id: "s4",
      type: "context_event",
      spanKind: "tool_io",
      parentStepId: "s3",
      label: "tool.io",
    }),
    step({ id: "s5", type: "llm_response", label: "gpt-4o" }),
    step({ id: "s6", type: "context_event", spanKind: "rating", label: "rating" }),
    step({
      id: "s7",
      type: "llm_response",
      spanKind: "judge_call",
      parentStepId: "s6",
      label: "outcome judge",
      payload: { judgeTokensIn: 40, judgeTokensOut: 8, judgeCostUsd: 0.002 },
    }),
    step({
      id: "s8",
      type: "llm_response",
      spanKind: "judge_call",
      parentStepId: "s6",
      label: "trajectory judge",
      payload: { judgeTokensIn: 20, judgeTokensOut: 4, judgeCostUsd: 0.001 },
    }),
  ];
}

const ids = (graph: AgentGraph) => graph.nodes.map((node) => node.id);
const byId = (graph: AgentGraph, id: string) => {
  const node = findAgentGraphNode(graph, id);
  expect(node, `expected a node ${id} in ${ids(graph).join(", ")}`).not.toBeNull();
  return node!;
};

// ── The mode seam ────────────────────────────────────────────────────────────────────────────────

describe("agent-graph — the `?graph=` mode seam", () => {
  test("only `expanded` selects the unrolled view; everything else is the aggregated default", () => {
    expect(coerceAgentGraphMode("expanded")).toBe("expanded");
    for (const value of [null, undefined, "", "aggregated", "bogus", "Expanded", "EXPANDED"]) {
      expect(coerceAgentGraphMode(value)).toBe("aggregated");
    }
  });
});

// ── Acceptance 1 — aggregated merges with ×N and shows the loop; expanded unrolls it ─────────────

describe("agent-graph — aggregated vs expanded (WP3.5 acceptance 1)", () => {
  test("a linear run aggregates to one node per name and carries NO cycle", () => {
    const graph = buildAgentGraph({ steps: linearRun(), mode: "aggregated" });
    expect(ids(graph)).toEqual(["user", "turn:gpt-4o", "tool:search_docs"]);
    for (const node of graph.nodes) expect(node.count).toBe(1);
    expect(graph.hasCycle).toBe(false);
    expect(graph.edges.map((edge) => `${edge.from}→${edge.to}`)).toEqual([
      "user→turn:gpt-4o",
      "turn:gpt-4o→tool:search_docs",
    ]);
  });

  test("a looping run merges repeated calls into ×N nodes and produces at least one cycle", () => {
    const graph = buildAgentGraph({ steps: loopingRun(), mode: "aggregated" });
    expect(ids(graph)).toEqual(["user", "turn:gpt-4o", "tool:search_docs"]);
    // Three assistant turns and two calls of the SAME tool merged into two nodes carrying ×N.
    expect(byId(graph, "turn:gpt-4o").count).toBe(3);
    expect(byId(graph, "tool:search_docs").count).toBe(2);
    // …and the repetition shows as a real 2-cycle turn ⇄ tool, traversed twice each way.
    expect(graph.hasCycle).toBe(true);
    const turnToTool = graph.edges.find((e) => e.from === "turn:gpt-4o" && e.to === "tool:search_docs");
    const toolToTurn = graph.edges.find((e) => e.from === "tool:search_docs" && e.to === "turn:gpt-4o");
    expect(turnToTool?.count).toBe(2);
    expect(toolToTurn?.count).toBe(2);
  });

  test("expanded unrolls the SAME looping run in execution order, one node per call, acyclic", () => {
    const graph = buildAgentGraph({ steps: loopingRun(), mode: "expanded" });
    // One node per primary step, in execution order — the loop is unrolled, not folded.
    expect(ids(graph)).toEqual(["occ:s1", "occ:s2", "occ:s3", "occ:s5", "occ:s6", "occ:s8"]);
    for (const node of graph.nodes) expect(node.count).toBe(1);
    expect(graph.nodes.map((node) => node.firstOrder)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(graph.hasCycle).toBe(false);
    // Edges are the execution chain, each traversed exactly once.
    expect(graph.edges.map((edge) => `${edge.from}→${edge.to}`)).toEqual([
      "occ:s1→occ:s2",
      "occ:s2→occ:s3",
      "occ:s3→occ:s5",
      "occ:s5→occ:s6",
      "occ:s6→occ:s8",
    ]);
    for (const edge of graph.edges) expect(edge.count).toBe(1);
  });

  test("the same tool called twice IN A ROW folds to a self-loop (which is itself a cycle)", () => {
    reset();
    const steps = [
      step({ id: "s1", type: "llm_response", label: "gpt-4o" }),
      step({ id: "s2", type: "tool_call", toolName: "grep", label: "grep" }),
      step({ id: "s3", type: "tool_call", toolName: "grep", label: "grep" }),
    ];
    const graph = buildAgentGraph({ steps, mode: "aggregated" });
    const selfEdge = graph.edges.find((edge) => edge.from === edge.to);
    expect(selfEdge?.from).toBe("tool:grep");
    expect(graph.hasCycle).toBe(true);
    expect(byId(graph, "tool:grep").count).toBe(2);
  });

  test("the ×N counts LOGICAL tool calls — the engine row and its MCP-sink twin are one call", () => {
    reset();
    const steps = [
      step({ id: "run:step:1", type: "llm_response", label: "gpt-4o" }),
      step({
        id: "run:step:2",
        type: "tool_call",
        toolName: "search_docs",
        label: "search_docs",
        payload: { toolCallId: "c1", args: {} },
      }),
      // The MCP-sink twin of the SAME logical call (`:mcp:` id) — de-duped away by the display
      // transform the step log applies, so the graph must NOT count it as a second call.
      step({
        id: "run:mcp:2",
        type: "tool_call",
        toolName: "search_docs",
        label: "search_docs",
        durationMs: 42,
        payload: { toolCallId: "c1", isError: false },
      }),
    ];
    const graph = buildAgentGraph({ steps, mode: "aggregated" });
    expect(byId(graph, "tool:search_docs").count).toBe(1);
    // …and the merged row's MCP-side timing still reaches the node.
    expect(byId(graph, "tool:search_docs").durationMs).toBe(42);
  });
});

// ── Acceptance 5 — the four fixtures, incl. a run with no hierarchy ──────────────────────────────

describe("agent-graph — hierarchy, and its absence (WP3.5 acceptance 5)", () => {
  test("a pre-WP3.1 run (no parentStepId, no spanKind) renders FLAT and never throws", () => {
    const steps = flatLegacyRun();
    const aggregated = buildAgentGraph({ steps, mode: "aggregated" });
    const expanded = buildAgentGraph({ steps, mode: "expanded" });

    expect(aggregated.hasHierarchy).toBe(false);
    expect(expanded.hasHierarchy).toBe(false);
    // Every node sits at depth 0 or on the plain execution chain — no parentage edge exists at all.
    expect(aggregated.edges.every((edge) => edge.kind === "sequence")).toBe(true);
    expect(expanded.edges.every((edge) => edge.kind === "sequence")).toBe(true);
    expect(ids(aggregated)).toEqual(["user", "turn:gpt-4o", "tool:list_files"]);
    // The layout still resolves a position for every node (it never throws on a flat run).
    const positions = layoutAgentGraph(aggregated);
    expect(positions.size).toBe(aggregated.nodes.length);
  });

  test("a hierarchical run exposes the rating span + its judge children as their own nodes", () => {
    const graph = buildAgentGraph({ steps: hierarchicalRun(), mode: "aggregated" });
    expect(graph.hasHierarchy).toBe(true);
    expect(ids(graph)).toEqual([
      "user",
      "turn:gpt-4o",
      "tool:search_docs",
      "rating",
      "judge:outcome judge",
      "judge:trajectory judge",
    ]);
    // The `tool_io` child is NOT a node of its own — it is folded into its parent tool call.
    expect(byId(graph, "tool:search_docs").stepIds).toEqual(["s3", "s4"]);
    // The judge calls hang off the rating span as PARENTAGE edges, not plain sequence.
    const ratingToOutcome = graph.edges.find(
      (edge) => edge.from === "rating" && edge.to === "judge:outcome judge",
    );
    const ratingToTrajectory = graph.edges.find(
      (edge) => edge.from === "rating" && edge.to === "judge:trajectory judge",
    );
    expect(ratingToOutcome?.kind).toBe("parent");
    expect(ratingToTrajectory?.kind).toBe("parent");
  });

  test("EVERY step lands in exactly one node — nothing is dropped, so the chips can sum honestly", () => {
    for (const steps of [linearRun(), loopingRun(), erroringRun(), flatLegacyRun(), hierarchicalRun()]) {
      for (const mode of ["aggregated", "expanded"] as const) {
        const graph = buildAgentGraph({ steps, mode });
        const seen = graph.nodes.flatMap((node) => node.stepIds);
        expect(new Set(seen).size, `duplicate step in ${mode}`).toBe(seen.length);
        expect([...seen].sort()).toEqual(steps.map((s) => s.id).sort());
      }
    }
  });

  test("a run with no steps at all is an EMPTY graph, not a crash", () => {
    const graph = buildAgentGraph({ steps: [], mode: "aggregated" });
    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
    expect(graph.hasCycle).toBe(false);
    expect(layoutAgentGraph(graph).size).toBe(0);
  });

  test("a run of ONLY detail steps (no primary) yields no nodes rather than throwing", () => {
    reset();
    const steps = [
      step({ id: "s1", type: "context_event", label: "context.event" }),
      step({ id: "s2", type: "llm_request", label: "gpt-4o" }),
    ];
    expect(steps.every((s) => primaryKindOf(s) === null)).toBe(true);
    const graph = buildAgentGraph({ steps, mode: "aggregated" });
    expect(graph.nodes).toEqual([]);
  });

  test("a detail step that arrives BEFORE any node attaches to the first node that follows", () => {
    reset();
    const steps = [
      step({ id: "s1", type: "context_event", label: "context.event" }),
      step({ id: "s2", type: "user_message", label: "user.msg" }),
    ];
    const graph = buildAgentGraph({ steps, mode: "aggregated" });
    expect(byId(graph, "user").stepIds).toEqual(["s1", "s2"]);
  });

  test("a dangling parentStepId degrades to the preceding node instead of throwing", () => {
    reset();
    const steps = [
      step({ id: "s1", type: "llm_response", label: "gpt-4o" }),
      step({ id: "s2", type: "context_event", spanKind: "tool_io", parentStepId: "nope", label: "io" }),
    ];
    const graph = buildAgentGraph({ steps, mode: "aggregated" });
    expect(byId(graph, "turn:gpt-4o").stepIds).toEqual(["s1", "s2"]);
  });
});

// ── Acceptance 2 — node chips consistent with the KPI-rail totals ────────────────────────────────

describe("agent-graph — node economics (WP3.5 acceptance 2)", () => {
  // A run whose cumulative KPI snapshots are the very numbers the rail shows at the end.
  const RAIL = { tokensIn: 900, tokensOut: 210, costUsd: 0.055 };
  const snapshots = new Map<string, StepCumulativeKpi>([
    ["s1", { tokensIn: 0, tokensOut: 0, costUsd: 0 }],
    ["s2", { tokensIn: 400, tokensOut: 100, costUsd: 0.02 }],
    ["s3", { tokensIn: 400, tokensOut: 100, costUsd: 0.02 }],
    ["s4", { tokensIn: 400, tokensOut: 100, costUsd: 0.02 }],
    ["s5", { tokensIn: 700, tokensOut: 160, costUsd: 0.04 }],
    ["s6", { tokensIn: 700, tokensOut: 160, costUsd: 0.04 }],
    ["s7", { tokensIn: 700, tokensOut: 160, costUsd: 0.04 }],
    ["s8", { tokensIn: RAIL.tokensIn, tokensOut: RAIL.tokensOut, costUsd: RAIL.costUsd }],
  ]);

  test("summed node chips reproduce the run's final cumulative totals — i.e. the KPI rail", () => {
    const steps = loopingRun();
    const perStepEconomics = derivePerStepEconomics(steps, snapshots);
    for (const mode of ["aggregated", "expanded"] as const) {
      const graph = buildAgentGraph({ steps, mode, perStepEconomics });
      const total = graph.nodes.reduce(
        (acc, node) => ({
          tokensIn: acc.tokensIn + node.tokensIn,
          tokensOut: acc.tokensOut + node.tokensOut,
          costUsd: acc.costUsd + (node.costUsd ?? 0),
        }),
        { tokensIn: 0, tokensOut: 0, costUsd: 0 },
      );
      expect(total.tokensIn, mode).toBe(RAIL.tokensIn);
      expect(total.tokensOut, mode).toBe(RAIL.tokensOut);
      expect(total.costUsd, mode).toBeCloseTo(RAIL.costUsd, 10);
      expect(graph.hasEconomics).toBe(true);
    }
  });

  test("the aggregated tool node's ×N matches the rail's logical tool-call count", () => {
    const steps = loopingRun();
    const graph = buildAgentGraph({ steps, mode: "aggregated" });
    const toolCalls = steps.filter((s) => s.type === "tool_call").length;
    const turns = steps.filter((s) => s.type === "llm_response").length;
    const toolNodeCounts = graph.nodes
      .filter((node) => node.kind === "tool")
      .reduce((sum, node) => sum + node.count, 0);
    const turnNodeCounts = graph.nodes
      .filter((node) => node.kind === "turn")
      .reduce((sum, node) => sum + node.count, 0);
    expect(toolNodeCounts).toBe(toolCalls);
    expect(turnNodeCounts).toBe(turns);
  });

  test("without cumulative snapshots cost is UNKNOWN (null), and tokens fall back to provider usage", () => {
    reset();
    const steps = [
      step({
        id: "s1",
        type: "llm_response",
        label: "gpt-4o",
        usageActual: { inputTokens: 120, outputTokens: 30 },
      }),
      step({ id: "s2", type: "tool_call", toolName: "grep", label: "grep", durationMs: 12 }),
    ];
    const graph = buildAgentGraph({ steps, mode: "aggregated" });
    expect(graph.hasEconomics).toBe(false);
    const turn = byId(graph, "turn:gpt-4o");
    expect(turn.tokensIn).toBe(120);
    expect(turn.tokensOut).toBe(30);
    // Never a fabricated 0 — the run simply cannot answer the cost question yet.
    expect(turn.costUsd).toBeNull();
    expect(byId(graph, "tool:grep").costUsd).toBeNull();
    // …and the tool's own wall clock is still real.
    expect(byId(graph, "tool:grep").durationMs).toBe(12);
  });

  test("an untimed node reports duration UNKNOWN rather than 0ms", () => {
    const graph = buildAgentGraph({ steps: loopingRun(), mode: "aggregated" });
    expect(byId(graph, "turn:gpt-4o").durationMs).toBeNull();
  });

  test("duration sums the node's own primary steps, never a child's mirrored window", () => {
    const graph = buildAgentGraph({ steps: linearRun(), mode: "aggregated" });
    expect(byId(graph, "turn:gpt-4o").durationMs).toBe(1200);
    expect(byId(graph, "tool:search_docs").durationMs).toBe(300);
  });
});

// ── Errors ───────────────────────────────────────────────────────────────────────────────────────

describe("agent-graph — errors", () => {
  test("an erroring run marks the node and names the FIRST failing step for the cross-link", () => {
    const graph = buildAgentGraph({ steps: erroringRun(), mode: "aggregated" });
    const tool = byId(graph, "tool:fetch_page");
    expect(tool.count).toBe(2);
    // The failed call AND its failed result both land on the node.
    expect(tool.errors).toBe(2);
    expect(tool.firstErrorStepId).toBe("s5");
    // The clean nodes stay clean — an error on one node never bleeds onto another.
    expect(byId(graph, "turn:gpt-4o").errors).toBe(0);
    expect(byId(graph, "turn:gpt-4o").firstErrorStepId).toBeUndefined();
  });

  test("in expanded mode only the failing occurrence is marked, not every call of that tool", () => {
    const graph = buildAgentGraph({ steps: erroringRun(), mode: "expanded" });
    expect(byId(graph, "occ:s3").errors).toBe(0);
    expect(byId(graph, "occ:s5").errors).toBe(2);
  });
});

// ── Click-through + deep-link resolution (acceptance 3 + 4) ──────────────────────────────────────

describe("agent-graph — node → steps resolution (WP3.5 acceptance 3/4)", () => {
  test("a node resolves to exactly the steps it accounts for, in both modes", () => {
    const steps = loopingRun();
    const aggregated = buildAgentGraph({ steps, mode: "aggregated" });
    expect(stepIdsForNode(aggregated, "tool:search_docs")).toEqual(new Set(["s3", "s4", "s6", "s7"]));
    const expanded = buildAgentGraph({ steps, mode: "expanded" });
    expect(stepIdsForNode(expanded, "occ:s6")).toEqual(new Set(["s6", "s7"]));
  });

  test("an unknown / absent `?focus=` resolves to no filter rather than an empty step view", () => {
    const graph = buildAgentGraph({ steps: loopingRun(), mode: "aggregated" });
    expect(stepIdsForNode(graph, "tool:nonexistent")).toBeNull();
    expect(stepIdsForNode(graph, null)).toBeNull();
    expect(findAgentGraphNode(graph, "nope")).toBeNull();
  });

  test("aggregated node ids are stable, human-meaningful keys — safe to put in a URL", () => {
    const a = buildAgentGraph({ steps: loopingRun(), mode: "aggregated" });
    const b = buildAgentGraph({ steps: loopingRun(), mode: "aggregated" });
    expect(ids(a)).toEqual(ids(b));
    expect(ids(a)).toContain("tool:search_docs");
  });
});

// ── Layout ───────────────────────────────────────────────────────────────────────────────────────

describe("agent-graph — deterministic layout", () => {
  test("the same graph always yields the same positions", () => {
    const graph = buildAgentGraph({ steps: loopingRun(), mode: "aggregated" });
    expect([...layoutAgentGraph(graph)]).toEqual([...layoutAgentGraph(graph)]);
  });

  test("aggregated lays out TOP-DOWN — depth grows with distance from the entry node", () => {
    const positions = layoutAgentGraph(buildAgentGraph({ steps: loopingRun(), mode: "aggregated" }));
    expect(positions.get("user")?.depth).toBe(0);
    expect(positions.get("turn:gpt-4o")?.depth).toBe(1);
    expect(positions.get("tool:search_docs")?.depth).toBe(2);
    // …and y grows with depth, so the loop edge visibly climbs back up.
    const user = positions.get("user")!;
    const tool = positions.get("tool:search_docs")!;
    expect(tool.y).toBeGreaterThan(user.y);
  });

  test("expanded lays out LEFT-TO-RIGHT in execution order", () => {
    const positions = layoutAgentGraph(buildAgentGraph({ steps: loopingRun(), mode: "expanded" }));
    const xs = ["occ:s1", "occ:s2", "occ:s3", "occ:s5", "occ:s6", "occ:s8"].map(
      (id) => positions.get(id)!.x,
    );
    for (let i = 1; i < xs.length; i += 1) expect(xs[i]!).toBeGreaterThan(xs[i - 1]!);
  });

  test("expanded drops a parentage child one row BELOW its parent", () => {
    const positions = layoutAgentGraph(buildAgentGraph({ steps: hierarchicalRun(), mode: "expanded" }));
    expect(positions.get("occ:s6")?.depth).toBe(0); // the rating span
    expect(positions.get("occ:s7")?.depth).toBe(1); // its judge child
    expect(positions.get("occ:s8")?.depth).toBe(1);
    expect(positions.get("occ:s7")!.y).toBeGreaterThan(positions.get("occ:s6")!.y);
  });

  test("a wholly cyclic graph (no entry node) still gets a position for every node", () => {
    reset();
    const steps = [
      step({ id: "s1", type: "llm_response", label: "gpt-4o" }),
      step({ id: "s2", type: "tool_call", toolName: "grep", label: "grep" }),
      step({ id: "s3", type: "llm_response", label: "gpt-4o" }),
    ];
    const graph = buildAgentGraph({ steps, mode: "aggregated" });
    expect(graph.hasCycle).toBe(true);
    const positions = layoutAgentGraph(graph);
    expect(positions.size).toBe(graph.nodes.length);
    for (const position of positions.values()) {
      expect(Number.isFinite(position.x)).toBe(true);
      expect(Number.isFinite(position.y)).toBe(true);
    }
  });
});

describe("agent-graph — cycle detection", () => {
  test("detects a plain cycle, a self-loop, and reports none for a DAG", () => {
    const node = (id: string) => ({
      id,
      kind: "tool" as const,
      label: id,
      count: 1,
      stepIds: [],
      firstOrder: 0,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: null,
      durationMs: null,
      errors: 0,
    });
    const edge = (from: string, to: string) => ({
      id: `${from}→${to}`,
      from,
      to,
      count: 1,
      kind: "sequence" as const,
    });
    const nodes = [node("a"), node("b"), node("c")];
    expect(graphHasCycle(nodes, [edge("a", "b"), edge("b", "c")])).toBe(false);
    expect(graphHasCycle(nodes, [edge("a", "b"), edge("b", "a")])).toBe(true);
    expect(graphHasCycle(nodes, [edge("a", "a")])).toBe(true);
    expect(graphHasCycle(nodes, [edge("a", "b"), edge("b", "c"), edge("c", "a")])).toBe(true);
  });
});
