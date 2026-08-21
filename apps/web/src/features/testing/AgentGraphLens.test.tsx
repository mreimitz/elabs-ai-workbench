import type { RunStep } from "@mcp-token-footprint/shared";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { Edge as RFEdge, Node as RFNode } from "@xyflow/react";
import {
  buildAgentGraph,
  layoutAgentGraph,
  type AgentGraphMode,
  type AgentGraphNode as AgentGraphModelNode,
} from "./agent-graph";
import { AgentGraphLens, agentNodeIdFromEventTarget, isAgentGraphActivateKey, toReactFlow } from "./AgentGraphLens";
import { derivePerStepEconomics, type StepCumulativeKpi } from "./analytics-derive";

/**
 * Observability WP 3.5 — the graph LENS.
 *
 * ⚠️ The gate blind spot this file exists to close (recorded in the RM-17 ledger, 2026-07-17): this
 * repo's chart/panel suites stub the rendering library as INERT no-ops, so a component wired up with
 * the wrong props still passes. A graph is exactly that class of surface. So this suite asserts on
 * **the props the graph library is actually handed** — `toReactFlow`'s output is the contract
 * (node ids, positions, handle anchors, edge labels, node `data`), and a second block renders the
 * REAL `@elabs-ai/components-flow` canvas under jsdom (the `TopologyGraph.test.tsx` precedent, which the
 * vitest config's `dedupe`/`inline` settings exist for) so the chips genuinely reach the DOM and a
 * click genuinely cross-links. Nothing here is satisfied by "something rendered".
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

/** A looping run: the model calls `search_docs` twice across three turns, and the second call fails. */
function loopingRun(): RunStep[] {
  seq = 0;
  return [
    step({ id: "s1", type: "user_message", label: "user.msg" }),
    step({ id: "s2", type: "llm_response", label: "gpt-4o", durationMs: 1500 }),
    step({ id: "s3", type: "tool_call", toolName: "search_docs", label: "search_docs", durationMs: 250 }),
    step({ id: "s4", type: "llm_response", label: "gpt-4o", durationMs: 900 }),
    step({
      id: "s5",
      type: "tool_call",
      toolName: "search_docs",
      label: "search_docs",
      durationMs: 120,
      status: "error",
    }),
    step({ id: "s6", type: "llm_response", label: "gpt-4o", durationMs: 700 }),
  ];
}

const SNAPSHOTS = new Map<string, StepCumulativeKpi>([
  ["s1", { tokensIn: 0, tokensOut: 0, costUsd: 0 }],
  ["s2", { tokensIn: 500, tokensOut: 120, costUsd: 0.03 }],
  ["s3", { tokensIn: 500, tokensOut: 120, costUsd: 0.03 }],
  ["s4", { tokensIn: 900, tokensOut: 200, costUsd: 0.05 }],
  ["s5", { tokensIn: 900, tokensOut: 200, costUsd: 0.05 }],
  ["s6", { tokensIn: 1200, tokensOut: 260, costUsd: 0.07 }],
]);

function flowFor(mode: AgentGraphMode, over?: { costBasis?: "none" | "questions" | "subscription_reference" }) {
  const steps = loopingRun();
  const graph = buildAgentGraph({ steps, mode });
  return {
    graph,
    ...toReactFlow(graph, layoutAgentGraph(graph), null, over?.costBasis),
  };
}

const nodeById = (nodes: RFNode[], id: string): RFNode => {
  const found = nodes.find((node) => node.id === id);
  expect(found, `expected node ${id} among ${nodes.map((n) => n.id).join(", ")}`).toBeDefined();
  return found!;
};
const edgeBetween = (edges: RFEdge[], from: string, to: string): RFEdge => {
  const found = edges.find((edge) => edge.source === from && edge.target === to);
  expect(found, `expected an edge ${from}→${to}`).toBeDefined();
  return found!;
};

// ── The props the graph library actually receives ────────────────────────────────────────────────

describe("AgentGraphLens — the props handed to the graph canvas", () => {
  test("every node is a registered `agentGraph` node with a FINITE position and full chip data", () => {
    const { nodes } = flowFor("aggregated");
    expect(nodes.length).toBeGreaterThan(0);
    for (const node of nodes) {
      // The node type must be one the canvas' `nodeTypes` map registers — a typo here renders React
      // Flow's unstyled default node, which "something rendered" assertions would never catch.
      expect(node.type).toBe("agentGraph");
      expect(Number.isFinite(node.position.x)).toBe(true);
      expect(Number.isFinite(node.position.y)).toBe(true);
      // Read-only lens: nothing on this canvas may be dragged or connected.
      expect(node.draggable).toBe(false);
      expect(node.connectable).toBe(false);
      const data = node.data as Record<string, unknown>;
      for (const key of ["kind", "title", "count", "tokensIn", "tokensOut", "costUsd", "durationMs", "errors"]) {
        expect(data, `node ${node.id} is missing ${key}`).toHaveProperty(key);
      }
    }
  });

  test("the aggregated tool node carries its ×N, its rolled-up duration and its error count", () => {
    const { nodes } = flowFor("aggregated");
    const tool = nodeById(nodes, "tool:search_docs").data as Record<string, unknown>;
    expect(tool.title).toBe("search_docs");
    expect(tool.kind).toBe("tool");
    expect(tool.count).toBe(2);
    expect(tool.durationMs).toBe(370); // 250 + 120
    expect(tool.errors).toBe(1);
  });

  test("token/cost chip data comes from the cumulative snapshots — and sums to the run's totals", () => {
    const steps = loopingRun();
    const graph = buildAgentGraph({
      steps,
      mode: "aggregated",
      perStepEconomics: derivePerStepEconomics(steps, SNAPSHOTS),
    });
    const { nodes } = toReactFlow(graph, layoutAgentGraph(graph), null, undefined);
    const total = nodes.reduce(
      (acc, node) => {
        const data = node.data as { tokensIn: number; tokensOut: number; costUsd: number | null };
        return {
          tokensIn: acc.tokensIn + data.tokensIn,
          tokensOut: acc.tokensOut + data.tokensOut,
          costUsd: acc.costUsd + (data.costUsd ?? 0),
        };
      },
      { tokensIn: 0, tokensOut: 0, costUsd: 0 },
    );
    expect(total.tokensIn).toBe(1200);
    expect(total.tokensOut).toBe(260);
    expect(total.costUsd).toBeCloseTo(0.07, 10);
  });

  test("a cost basis with no honest per-node figure suppresses the cost chip; a subscription marks it", () => {
    for (const basis of ["none", "questions"] as const) {
      const { nodes } = flowFor("aggregated", { costBasis: basis });
      for (const node of nodes) {
        expect((node.data as { costSuppressed: boolean }).costSuppressed).toBe(true);
        expect((node.data as { costEstimated: boolean }).costEstimated).toBe(false);
      }
    }
    const { nodes } = flowFor("aggregated", { costBasis: "subscription_reference" });
    for (const node of nodes) {
      expect((node.data as { costSuppressed: boolean }).costSuppressed).toBe(false);
      expect((node.data as { costEstimated: boolean }).costEstimated).toBe(true);
    }
  });

  test("every edge names real endpoints and binds explicit handles that exist on the node", () => {
    const HANDLES = new Set(["top", "right", "bottom", "left"]);
    for (const mode of ["aggregated", "expanded"] as const) {
      const { nodes, edges } = flowFor(mode);
      const ids = new Set(nodes.map((node) => node.id));
      expect(edges.length).toBeGreaterThan(0);
      for (const edge of edges) {
        expect(ids, `${mode}: dangling source ${edge.source}`).toContain(edge.source);
        expect(ids, `${mode}: dangling target ${edge.target}`).toContain(edge.target);
        expect(edge.type).toBe("smoothstep");
        expect(HANDLES).toContain(edge.sourceHandle);
        expect(HANDLES).toContain(edge.targetHandle);
      }
    }
  });

  test("the loop's back edge is routed away from the forward spine and labelled with its ×N", () => {
    const { edges } = flowFor("aggregated");
    // Forward: the turn drops into the tool through the top-down spine.
    const forward = edgeBetween(edges, "turn:gpt-4o", "tool:search_docs");
    expect(forward.sourceHandle).toBe("bottom");
    expect(forward.targetHandle).toBe("top");
    expect(forward.label).toBe("×2");
    // Back: the return leg climbs, so it leaves and re-enters on the LEFT rather than redrawing the
    // same path — which is the difference between a legible 2-cycle and one line drawn twice.
    const back = edgeBetween(edges, "tool:search_docs", "turn:gpt-4o");
    expect(back.sourceHandle).toBe("left");
    expect(back.targetHandle).toBe("left");
    expect(back.label).toBe("×2");
    // Both labels are token-driven CSS custom properties (an SVG fill cannot read a utility class),
    // so they read in BOTH themes rather than being pinned to one.
    expect((forward.labelStyle as { fill: string }).fill).toBe("var(--muted-foreground)");
    expect((forward.labelBgStyle as { fill: string }).fill).toBe("var(--card)");
  });

  test("a once-traversed edge carries NO ×N label (the counter means repetition, not decoration)", () => {
    const { edges } = flowFor("aggregated");
    expect(edgeBetween(edges, "user", "turn:gpt-4o").label).toBeUndefined();
  });

  test("expanded flows LEFT-TO-RIGHT: strictly increasing x, right→left handles, no ×N labels", () => {
    const { nodes, edges } = flowFor("expanded");
    const xs = nodes.map((node) => node.position.x);
    for (let i = 1; i < xs.length; i += 1) expect(xs[i]!).toBeGreaterThan(xs[i - 1]!);
    for (const edge of edges) {
      expect(edge.sourceHandle).toBe("right");
      expect(edge.targetHandle).toBe("left");
      expect(edge.label).toBeUndefined(); // every unrolled transition happens exactly once
    }
  });

  test("in expanded mode a PARENTAGE child leaves the parent's bottom and is drawn dashed", () => {
    seq = 0;
    const steps = [
      step({ id: "r1", type: "context_event", spanKind: "rating", label: "rating" }),
      step({
        id: "r2",
        type: "llm_response",
        spanKind: "judge_call",
        parentStepId: "r1",
        label: "outcome judge",
      }),
    ];
    const graph = buildAgentGraph({ steps, mode: "expanded" });
    const { edges } = toReactFlow(graph, layoutAgentGraph(graph), null, undefined);
    const parentEdge = edgeBetween(edges, "occ:r1", "occ:r2");
    expect(parentEdge.sourceHandle).toBe("bottom");
    expect(parentEdge.targetHandle).toBe("left");
    // Parentage is distinguished by a DASH pattern, not a hue — it reads without colour vision.
    expect((parentEdge.style as { strokeDasharray?: string }).strokeDasharray).toBe("4 3");
  });

  test("the selected node — and only it — is marked selected for the canvas", () => {
    const steps = loopingRun();
    const graph = buildAgentGraph({ steps, mode: "aggregated" });
    const { nodes } = toReactFlow(graph, layoutAgentGraph(graph), "tool:search_docs", undefined);
    expect(nodes.filter((node) => node.selected).map((node) => node.id)).toEqual(["tool:search_docs"]);
  });
});

// ── The rendered canvas (real @elabs-ai/components-flow under jsdom) ─────────────────────────────

describe("AgentGraphLens — rendered", () => {
  function renderLens(mode: AgentGraphMode = "aggregated", onSelectNode = vi.fn()) {
    const onModeChange = vi.fn();
    const result = render(
      <AgentGraphLens
        steps={loopingRun()}
        mode={mode}
        onModeChange={onModeChange}
        onSelectNode={onSelectNode}
      />,
    );
    return { ...result, onModeChange, onSelectNode };
  }

  test("the node chips reach the DOM — tool name, ×N counter and a spelled-out error badge", () => {
    renderLens();
    expect(screen.getByRole("region", { name: /Agent graph/ })).toBeInTheDocument();
    expect(screen.getByText("search_docs")).toBeInTheDocument();
    expect(screen.getByText("×2")).toBeInTheDocument();
    // The failing node's state is NOT carried by colour alone — the badge spells it out.
    expect(screen.getByText("1 error")).toBeInTheDocument();
  });

  test("clicking a node cross-links with the model node behind it (the filtered step view)", () => {
    const onSelectNode = vi.fn();
    const { container } = renderLens("aggregated", onSelectNode);
    const toolNode = container.querySelector('.react-flow__node[data-id="tool:search_docs"]');
    expect(toolNode).not.toBeNull();
    fireEvent.click(toolNode!);
    expect(onSelectNode).toHaveBeenCalledTimes(1);
    const selected = onSelectNode.mock.calls[0]![0] as AgentGraphModelNode;
    expect(selected.id).toBe("tool:search_docs");
    // …and it carries the step ids the Steps lens filters down to.
    expect(selected.stepIds).toEqual(["s3", "s5"]);
  });

  test("Enter on a focused node follows the same cross-link (keyboard parity)", () => {
    const onSelectNode = vi.fn();
    const { container } = renderLens("aggregated", onSelectNode);
    const toolNode = container.querySelector('.react-flow__node[data-id="tool:search_docs"]');
    fireEvent.keyDown(toolNode!, { key: "Enter" });
    expect(onSelectNode).toHaveBeenCalledTimes(1);
    expect((onSelectNode.mock.calls[0]![0] as AgentGraphModelNode).id).toBe("tool:search_docs");
  });

  test("the mode toggle is a real two-option control that reports the mode it switches to", () => {
    const { onModeChange } = renderLens("aggregated");
    const expanded = screen.getByRole("radio", { name: /Expanded/ });
    fireEvent.click(expanded);
    expect(onModeChange).toHaveBeenCalledWith("expanded");
  });

  test("a run with nothing to graph shows a real empty state, never a blank canvas", () => {
    render(
      <AgentGraphLens steps={[]} mode="aggregated" onModeChange={vi.fn()} onSelectNode={vi.fn()} />,
    );
    expect(screen.getByText("Nothing to graph yet")).toBeInTheDocument();
    expect(screen.queryByTestId("agent-graph-canvas")).not.toBeInTheDocument();
    // The mode toggle stays available so the empty view is not a dead end.
    expect(screen.getByRole("radio", { name: /Aggregated/ })).toBeInTheDocument();
  });

  test("a run with no WP3.1 hierarchy says so rather than implying a structure it does not have", () => {
    render(
      <AgentGraphLens
        steps={loopingRun()}
        mode="aggregated"
        onModeChange={vi.fn()}
        onSelectNode={vi.fn()}
      />,
    );
    expect(screen.getByText(/recorded no step hierarchy/)).toBeInTheDocument();
  });
});

// ── The DOM seams ────────────────────────────────────────────────────────────────────────────────

describe("AgentGraphLens — event-target resolution", () => {
  test("a node id resolves from a descendant; canvas chrome resolves to null", () => {
    const wrapper = document.createElement("div");
    // A node wrapper with a descendant, plus a sibling standing in for canvas chrome.
    wrapper.innerHTML =
      '<div class="react-flow__node" data-id="tool:x"><span id="inner">hi</span></div><span id="chrome">z</span>';
    document.body.appendChild(wrapper);
    expect(agentNodeIdFromEventTarget(wrapper.querySelector("#inner"))).toBe("tool:x");
    expect(agentNodeIdFromEventTarget(wrapper.querySelector("#chrome"))).toBeNull();
    expect(agentNodeIdFromEventTarget(null)).toBeNull();
    wrapper.remove();
  });

  test("Enter and Space activate; other keys do not", () => {
    for (const key of ["Enter", " ", "Spacebar"]) expect(isAgentGraphActivateKey(key)).toBe(true);
    for (const key of ["a", "Tab", "Escape", "ArrowDown"]) expect(isAgentGraphActivateKey(key)).toBe(false);
  });
});
