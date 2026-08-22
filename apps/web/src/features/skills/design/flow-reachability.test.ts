import { describe, expect, it } from "vitest";
import type { SkillGraph, SkillGraphNode } from "@mcp-token-footprint/shared";
import { buildFlow } from "./SkillGraphCanvas";
import { EDGE_KIND_ORDER, edgeKindMeta } from "./edge-kind-meta";
import { measureFlowReading } from "./FlowReadingPanel";

// RM-30 WP 7.8 piece 2 — the canvas filters by REACHABILITY, marks each reached box always- or
// maybe-read, draws the five kinds apart by more than colour, and the panel states the token figure.

function node(
  id: string,
  kind: SkillGraphNode["kind"],
  startLine: number,
  extra: Record<string, unknown> = {},
): SkillGraphNode {
  return {
    id,
    kind,
    label: id,
    anchor: { headingPath: [id], startLine, endLine: startLine + 1 },
    source: "inferred",
    ...extra,
  } as SkillGraphNode;
}

/**
 * A two-command skill where `/analyze` runs a step, that step branches, opens a file and calls a
 * tool, and separately points at `/report`. `/report` reaches only its own step.
 */
function twoCommandGraph(): SkillGraph {
  return {
    nodes: [
      node("analyze", "entry_point", 1, { trigger: { type: "command", value: "/analyze" } }),
      node("collect", "subroutine", 3),
      node("decide", "gatekeeper", 5),
      node("summarise", "subroutine", 7),
      node("spec", "asset", 9, { path: "reference/spec.md", fileKind: "reference" }),
      node("search", "tool_ref", 11, { toolName: "acme_search" }),
      node("report", "entry_point", 13, { trigger: { type: "command", value: "/report" } }),
      node("format", "subroutine", 15),
    ],
    edges: [
      { id: "e1", from: "analyze", to: "collect", kind: "triggers" },
      { id: "e2", from: "collect", to: "decide", kind: "then" },
      { id: "e3", from: "decide", to: "summarise", kind: "branch", condition: "enough data" },
      { id: "e4", from: "collect", to: "spec", kind: "uses" },
      { id: "e5", from: "summarise", to: "search", kind: "uses" },
      { id: "e6", from: "collect", to: "report", kind: "uses" },
      { id: "e7", from: "report", to: "format", kind: "triggers" },
    ],
    warnings: [],
  };
}

describe("buildFlow — an entry-point view is reachability, not lane membership", () => {
  it("shows exactly what the entry point reaches, and nothing it does not", () => {
    const graph = twoCommandGraph();
    const built = buildFlow(graph, undefined, { visibleEntryNodeId: "report" });
    const ids = built.nodes.filter((n) => n.type === "brand").map((n) => n.id);
    // /report reaches only itself and its own step — NOT /analyze's subtree, even though every one
    // of those boxes sits on a lane the old filter would have had to choose between.
    expect(ids.sort()).toEqual(["format", "report"]);
  });

  it("marks a box always-read or maybe-read by the design rule", () => {
    const graph = twoCommandGraph();
    const built = buildFlow(graph, undefined, { visibleEntryNodeId: "analyze" });
    const brand = built.nodes.filter((n) => n.type === "brand");
    const maybe = (id: string) =>
      (brand.find((n) => n.id === id)?.data as { maybeRead?: boolean } | undefined)?.maybeRead ===
      true;

    // triggers → then keeps certainty…
    expect(maybe("analyze")).toBe(false);
    expect(maybe("collect")).toBe(false);
    expect(maybe("decide")).toBe(false);
    // …a BRANCH edge does not (the model reads exactly one arm)…
    expect(maybe("summarise")).toBe(true);
    // …nor does a USES edge, at any depth.
    expect(maybe("spec")).toBe(true);
    expect(maybe("search")).toBe(true);
    expect(maybe("report")).toBe(true);
  });

  it("says always/maybe out loud in the accessible name, not by shading alone", () => {
    const built = buildFlow(twoCommandGraph(), undefined, { visibleEntryNodeId: "analyze" });
    const labelOf = (id: string) => built.nodes.find((n) => n.id === id)?.ariaLabel ?? "";
    expect(labelOf("collect")).toContain("always read");
    expect(labelOf("spec")).toContain("maybe read");
  });

  it("puts a step reachable from two entry points in BOTH flows", () => {
    const graph = twoCommandGraph();
    // Give /report a second way into `summarise`, so the step is genuinely shared.
    graph.edges.push({ id: "e8", from: "format", to: "summarise", kind: "then" });
    const fromAnalyze = buildFlow(graph, undefined, { visibleEntryNodeId: "analyze" }).nodes.map(
      (n) => n.id,
    );
    const fromReport = buildFlow(graph, undefined, { visibleEntryNodeId: "report" }).nodes.map(
      (n) => n.id,
    );
    expect(fromAnalyze).toContain("summarise");
    expect(fromReport).toContain("summarise");
  });

  it("with no entry point selected, the whole graph renders as before", () => {
    const built = buildFlow(twoCommandGraph());
    expect(built.nodes.filter((n) => n.type === "brand")).toHaveLength(8);
    // And nothing is marked maybe-read: there is no entry point to be certain or uncertain about.
    for (const n of built.nodes.filter((x) => x.type === "brand")) {
      expect((n.data as { maybeRead?: boolean }).maybeRead).toBeUndefined();
    }
  });
});

describe("edge drawing — the five kinds differ by more than colour", () => {
  it("gives every kind a distinct (dash, width) pair", () => {
    const signatures = EDGE_KIND_ORDER.map((kind) => {
      const meta = edgeKindMeta(kind);
      return `${meta.dash ?? "solid"}|${meta.width}`;
    });
    expect(new Set(signatures).size).toBe(EDGE_KIND_ORDER.length);
  });

  it("never distinguishes two kinds by colour alone", () => {
    // For every pair sharing a stroke token, the dash or the width must differ.
    for (const a of EDGE_KIND_ORDER) {
      for (const b of EDGE_KIND_ORDER) {
        if (a === b) continue;
        const ma = edgeKindMeta(a);
        const mb = edgeKindMeta(b);
        if (ma.stroke !== mb.stroke) continue;
        expect(`${ma.dash ?? "solid"}|${ma.width}`).not.toBe(`${mb.dash ?? "solid"}|${mb.width}`);
      }
    }
  });

  it("uses semantic tokens for every stroke — no raw colour literals", () => {
    for (const kind of EDGE_KIND_ORDER) {
      expect(edgeKindMeta(kind).stroke).toMatch(/^var\(--[a-z-]+\)$/);
    }
  });

  it("paints each canvas edge with its own kind's stroke, and names the kind for a reader", () => {
    const built = buildFlow(twoCommandGraph());
    const edge = (id: string) => built.edges.find((e) => e.id === id);
    expect(edge("e1")?.style).toMatchObject({ strokeWidth: edgeKindMeta("triggers").width });
    expect(edge("e3")?.style).toMatchObject({ strokeDasharray: edgeKindMeta("branch").dash });
    expect(edge("e4")?.style).toMatchObject({ strokeDasharray: edgeKindMeta("uses").dash });
    expect(edge("e2")?.ariaLabel).toContain("Then");
    expect(edge("e4")?.ariaLabel).toContain("Uses");
  });

  it("draws a kindless (pre-WP-7.8) edge as an honest unknown, not as a borrowed kind", () => {
    const meta = edgeKindMeta(undefined);
    expect(meta.label).toBe("Connection");
    expect(meta.stroke).toBe("var(--muted-foreground)");
  });
});

describe("measureFlowReading — the token figure", () => {
  const costs = new Map<string, number>([
    ["analyze", 100],
    ["collect", 400],
    ["decide", 300],
    ["summarise", 500],
    ["spec", 1200],
    ["report", 60],
    ["format", 240],
  ]);
  const toolTokens = new Map<string, number>([["acme_search", 900]]);

  it("counts always-read sections and their tokens from the reachability set", () => {
    const reading = measureFlowReading(twoCommandGraph(), "analyze", costs, toolTokens);
    // analyze (entry) is not a SECTION kind; collect + decide are.
    expect(reading.alwaysSections).toBe(2);
    expect(reading.alwaysTokens).toBe(100 + 400 + 300);
  });

  it("counts the maybe-read files and tools, and states the ceiling", () => {
    const reading = measureFlowReading(twoCommandGraph(), "analyze", costs, toolTokens);
    expect(reading.maybeFiles).toBe(1);
    expect(reading.maybeTools).toBe(1);
    // `summarise` behind the branch, the /report entry, and — the point of reachability — /report's
    // OWN step, which /analyze can reach transitively even though it sits in another lane entirely.
    expect(reading.maybeSections).toBe(3);
    expect(reading.ceilingTokens).toBe(100 + 400 + 300 + 500 + 1200 + 900 + 60 + 240);
    expect(reading.unmeasured).toBe(0);
  });

  it("EXCLUDES an unmeasured box and reports it, rather than counting it as free", () => {
    const partial = new Map(costs);
    partial.delete("spec");
    const reading = measureFlowReading(twoCommandGraph(), "analyze", partial, toolTokens);
    expect(reading.unmeasured).toBe(1);
    // The 1,200-token file is NOT silently folded in as zero — the ceiling drops by exactly its cost.
    expect(reading.ceilingTokens).toBe(100 + 400 + 300 + 500 + 900 + 60 + 240);
  });

  it("a keyword's flow is the whole skill, flagged as such", () => {
    const graph = twoCommandGraph();
    graph.nodes.push(node("kw", "entry_point", 20, { trigger: { type: "keyword", value: "go" } }));
    const reading = measureFlowReading(graph, "kw", costs, toolTokens);
    expect(reading.wholeSkill).toBe(true);
    // Every section in the document, including both commands' — no per-keyword subset is computed.
    expect(reading.alwaysSections).toBe(4); // collect · decide · summarise · format
  });
});
