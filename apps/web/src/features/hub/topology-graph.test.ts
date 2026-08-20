// Assistant Hub (planning/Roadmap/RM-03-assistant-hub/, WP2.2) — the PURE topology-graph derivation (no React, no
// @elabs-ai/components-flow). Proves the four shapes + live-state tone mapping + the best_of_n judge/winner nodes.

import type { HubTopology } from "@mcp-token-footprint/shared";
import { describe, expect, test } from "vitest";
import {
  deriveTopologyGraph,
  TOPOLOGY_LEGEND,
  type TopoGraphInputAgent,
  type TopoNodeState,
} from "./topology-graph";

const agent = (id: string, state: TopoNodeState = "idle"): TopoGraphInputAgent => ({
  id,
  title: `Role ${id}`,
  state,
});

describe("deriveTopologyGraph", () => {
  test("empty team → empty graph", () => {
    expect(deriveTopologyGraph({ topology: "parallel", agents: [] })).toEqual({ nodes: [], edges: [] });
  });

  test("parallel: agents fan into a single synthesis node", () => {
    const g = deriveTopologyGraph({
      topology: "parallel",
      agents: [agent("a"), agent("b"), agent("c")],
      terminal: { state: "idle" },
    });
    expect(g.nodes).toHaveLength(4); // 3 agents + synthesis
    const terminal = g.nodes.find((n) => n.id === "__terminal__");
    expect(terminal?.kind).toBe("Synthesis");
    // Every agent points at the synthesis (fan-in), and nothing else.
    expect(g.edges).toHaveLength(3);
    expect(g.edges.every((e) => e.target === "__terminal__")).toBe(true);
    // Agents share the top row (y=0); the synthesis is below.
    expect(g.nodes.filter((n) => n.id !== "__terminal__").every((n) => n.y === 0)).toBe(true);
    expect(terminal!.y).toBeGreaterThan(0);
  });

  test("pipeline: a top-to-bottom chain ending at synthesis", () => {
    const g = deriveTopologyGraph({
      topology: "pipeline",
      agents: [agent("a"), agent("b"), agent("c")],
      terminal: { state: "idle" },
    });
    // Chain edges a->b, b->c, c->terminal.
    expect(g.edges.map((e) => `${e.source}->${e.target}`)).toEqual(["a->b", "b->c", "c->__terminal__"]);
    // Stages descend (strictly increasing y), all in one column (x=0).
    const stages = g.nodes.filter((n) => n.id !== "__terminal__");
    expect(stages.every((n) => n.x === 0)).toBe(true);
    expect(stages[0]!.y).toBeLessThan(stages[1]!.y);
    expect(stages[0]!.kind).toBe("Stage 1");
  });

  // ── hub-fixes WP4.4 (D-HF3) — round-based debate. The former single-row "sees + rebuts" ORDER-chain
  //    probes are DELIBERATELY updated (not deleted) to assert the new round shape. ─────────────────────
  test("debate (WP4.4): default 2 rounds — parallel OPENINGS row, a REBUTTAL row with cross-visibility, final round feeds the resolver", () => {
    const g = deriveTopologyGraph({
      topology: "debate",
      agents: [agent("a"), agent("b"), agent("c")],
      terminal: { state: "idle" },
      // debateRounds omitted ⇒ the runtime default (2): openings + one rebuttal row.
    });
    // Two rows of debater nodes + the resolver: 3 openings + 3 rebuttals + 1 terminal.
    const openings = ["a", "b", "c"];
    const rebuttals = ["a::r2", "b::r2", "c::r2"];
    expect(g.nodes.map((n) => n.id)).toEqual([...openings, ...rebuttals, "__terminal__"]);

    // Openings share the top row (y=0), parallel & independent (NO edges INTO them).
    const openingNodes = g.nodes.filter((n) => openings.includes(n.id));
    expect(openingNodes.every((n) => n.y === 0)).toBe(true);
    expect(openingNodes[0]!.kind).toBe("Debater 1 · opening");
    expect(openingNodes[0]!.x).toBeLessThan(openingNodes[1]!.x);
    expect(g.edges.some((e) => openings.includes(e.target))).toBe(false);

    // Rebuttals sit in the second row (same columns) and are labeled as rebuttals.
    const rebuttalNodes = g.nodes.filter((n) => rebuttals.includes(n.id));
    expect(rebuttalNodes.every((n) => n.y > 0 && n.y < g.nodes.find((t) => t.id === "__terminal__")!.y)).toBe(true);
    expect(rebuttalNodes[0]!.kind).toBe("Debater 1 · rebuttal");

    // Cross-visibility "rebuts" edges: each opening → every OTHER debater's rebuttal (j ≠ i), never itself.
    const rebutsEdges = g.edges.filter((e) => e.label === "rebuts");
    expect(rebutsEdges.map((e) => `${e.source}->${e.target}`).sort()).toEqual(
      [
        "a->b::r2", "a->c::r2",
        "b->a::r2", "b->c::r2",
        "c->a::r2", "c->b::r2",
      ].sort(),
    );
    // A debater NEVER rebuts itself (no self-edge into its own rebuttal node).
    expect(rebutsEdges.some((e) => e.source === "a" && e.target === "a::r2")).toBe(false);

    // ONLY the final (rebuttal) round feeds the resolver, explicitly named "Synthesis (resolver)".
    const terminal = g.nodes.find((n) => n.id === "__terminal__");
    expect(terminal?.kind).toBe("Synthesis (resolver)");
    const terminalEdges = g.edges.filter((e) => e.target === "__terminal__");
    expect(terminalEdges.map((e) => e.source).sort()).toEqual(rebuttals.slice().sort());
    expect(terminalEdges.every((e) => e.label === undefined)).toBe(true);
    expect(g.edges).toHaveLength(6 + 3); // 6 cross rebuts + 3 terminal fan-in
  });

  test("debate: debateRounds=1 — independent openings feed the resolver directly, no rebuttal row", () => {
    const g = deriveTopologyGraph({
      topology: "debate",
      agents: [agent("a"), agent("b")],
      terminal: { state: "idle" },
      debateRounds: 1,
    });
    // Openings only (bare "Debater N", no "· opening" suffix) → terminal; no rebuttal nodes/edges.
    expect(g.nodes.map((n) => n.id)).toEqual(["a", "b", "__terminal__"]);
    expect(g.nodes.find((n) => n.id === "a")?.kind).toBe("Debater 1");
    expect(g.edges.some((e) => e.label === "rebuts")).toBe(false);
    expect(g.edges.map((e) => `${e.source}->${e.target}`).sort()).toEqual([
      "a->__terminal__",
      "b->__terminal__",
    ]);
  });

  test("debate: debateRounds clamps to 1..3 (0 → openings only; 5 → three stacked rows)", () => {
    const clampedLow = deriveTopologyGraph({
      topology: "debate",
      agents: [agent("a"), agent("b")],
      terminal: { state: "idle" },
      debateRounds: 0,
    });
    // 0 clamps to 1 round: openings feed the terminal directly, no rebuttal nodes.
    expect(clampedLow.nodes.map((n) => n.id)).toEqual(["a", "b", "__terminal__"]);

    const clampedHigh = deriveTopologyGraph({
      topology: "debate",
      agents: [agent("a"), agent("b")],
      terminal: { state: "idle" },
      debateRounds: 5,
    });
    // 5 clamps to 3 rounds: openings + rebuttal + rebuttal-2 rows (2 debaters → 2*3 + terminal = 7 nodes).
    expect(clampedHigh.nodes.map((n) => n.id)).toEqual(["a", "b", "a::r2", "b::r2", "a::r3", "b::r3", "__terminal__"]);
    // Round 3's rebuttal cross-edges come from the round-2 nodes (deeper cross-visibility).
    expect(clampedHigh.edges.filter((e) => e.target === "a::r3").map((e) => e.source)).toEqual(["b::r2"]);
    // Only the final (round-3) nodes feed the resolver.
    expect(clampedHigh.edges.filter((e) => e.target === "__terminal__").map((e) => e.source).sort()).toEqual([
      "a::r3",
      "b::r3",
    ]);
    expect(clampedHigh.nodes.find((n) => n.id === "a::r3")?.kind).toBe("Debater 1 · rebuttal 2");
  });

  test("debate: a rebuttal edge animates when the target debater is active; terminal fan-in animates once synthesis starts", () => {
    const mid = deriveTopologyGraph({
      topology: "debate",
      agents: [agent("a", "reported"), agent("b", "active")],
      terminal: { state: "waiting" },
    });
    // The "rebuts" edge INTO b's rebuttal node animates (b is active); the one into a's does not.
    expect(mid.edges.find((e) => e.target === "b::r2")?.animated).toBe(true);
    expect(mid.edges.find((e) => e.target === "a::r2")?.animated).toBe(false);
    expect(mid.edges.filter((e) => e.target === "__terminal__").every((e) => e.animated === false)).toBe(true);

    const synthesizing = deriveTopologyGraph({
      topology: "debate",
      agents: [agent("a", "reported"), agent("b", "reported")],
      terminal: { state: "active" },
    });
    expect(
      synthesizing.edges.filter((e) => e.target === "__terminal__").every((e) => e.animated === true),
    ).toBe(true);
  });

  test("best_of_n: attempts fan into a Judge, then the Judge feeds the Synthesis", () => {
    const g = deriveTopologyGraph({
      topology: "best_of_n",
      agents: [agent("a"), agent("b"), agent("c")],
      terminal: { state: "idle" },
    });
    const judge = g.nodes.find((n) => n.id === "__judge__");
    const synth = g.nodes.find((n) => n.id === "__terminal__");
    expect(judge?.kind).toBe("Judge");
    expect(synth?.kind).toBe("Synthesis");
    // Every attempt → judge (blind fan-in), judge → synthesis.
    expect(g.edges.filter((e) => e.target === "__judge__")).toHaveLength(3);
    expect(g.edges.find((e) => e.source === "__judge__")?.target).toBe("__terminal__");
    // Attempts carry an "Attempt N" eyebrow.
    expect(g.nodes.find((n) => n.id === "a")?.kind).toBe("Attempt 1");
  });

  test("live state maps to tone; the best_of_n winner reads success + a 'winner' eyebrow", () => {
    const g = deriveTopologyGraph({
      topology: "best_of_n",
      agents: [agent("a", "reported"), agent("b", "winner"), agent("c", "missing")],
      terminal: { state: "active" },
    });
    const byId = new Map(g.nodes.map((n) => [n.id, n]));
    expect(byId.get("a")!.tone).toBe("success");
    expect(byId.get("b")!.tone).toBe("success");
    expect(byId.get("b")!.kind).toContain("winner");
    expect(byId.get("c")!.tone).toBe("destructive"); // did not report
    expect(byId.get("__terminal__")!.tone).toBe("accent"); // synthesizing
  });

  test("an active agent's incoming edge is animated", () => {
    const g = deriveTopologyGraph({
      topology: "pipeline",
      agents: [agent("a", "reported"), agent("b", "active")],
      terminal: { state: "waiting" },
    });
    expect(g.edges.find((e) => e.target === "b")?.animated).toBe(true);
    expect(g.edges.find((e) => e.target === "__terminal__")?.animated).toBe(false);
  });

  // ── crew-nesting WP4.3 (D-CN2/D-CN5) — the `isCrew`/`memberCount` flags thread through unchanged ────
  test("isCrew/memberCount thread through `toNode` for every topology shape; a plain agent carries neither", () => {
    const crewAgent: TopoGraphInputAgent = {
      id: "crew-1",
      title: "Strategy Crew",
      state: "active",
      isCrew: true,
      memberCount: 4,
    };
    const plainAgent = agent("plain-1", "reported");

    const parallel = deriveTopologyGraph({ topology: "parallel", agents: [crewAgent, plainAgent] });
    const crewNode = parallel.nodes.find((n) => n.id === "crew-1");
    const plainNode = parallel.nodes.find((n) => n.id === "plain-1");
    expect(crewNode?.isCrew).toBe(true);
    expect(crewNode?.memberCount).toBe(4);
    expect(plainNode?.isCrew).toBeUndefined();
    expect(plainNode?.memberCount).toBeUndefined();

    // pipeline + best_of_n paths reuse the SAME `toNode` — the flag threads through unchanged there too.
    const pipeline = deriveTopologyGraph({ topology: "pipeline", agents: [crewAgent, plainAgent] });
    expect(pipeline.nodes.find((n) => n.id === "crew-1")?.isCrew).toBe(true);
    const bestOfN = deriveTopologyGraph({ topology: "best_of_n", agents: [crewAgent, plainAgent] });
    expect(bestOfN.nodes.find((n) => n.id === "crew-1")?.isCrew).toBe(true);

    // debate: every round's copy of the node carries the flag (openings + rebuttal rows).
    const debate = deriveTopologyGraph({ topology: "debate", agents: [crewAgent, plainAgent] });
    expect(debate.nodes.find((n) => n.id === "crew-1")?.isCrew).toBe(true);
    expect(debate.nodes.find((n) => n.id === "crew-1::r2")?.isCrew).toBe(true);
    expect(debate.nodes.find((n) => n.id === "plain-1::r2")?.isCrew).toBeUndefined();
  });
});

describe("TOPOLOGY_LEGEND", () => {
  test("every topology has a non-empty one-line legend; debate reads round-based (parallel open + rebut), not the old sequential 'in order' / 'face to face' framing", () => {
    for (const t of ["pipeline", "parallel", "debate", "best_of_n"] as HubTopology[]) {
      expect(TOPOLOGY_LEGEND[t]).toBeTruthy();
    }
    // hub-fixes WP4.4 (D-HF3) — the legend wording seam updated for round-based debate.
    expect(TOPOLOGY_LEGEND.debate).not.toMatch(/face to face/i);
    expect(TOPOLOGY_LEGEND.debate).not.toMatch(/run in order/i);
    expect(TOPOLOGY_LEGEND.debate).toMatch(/parallel/i);
    expect(TOPOLOGY_LEGEND.debate).toMatch(/rebut/i);
    expect(TOPOLOGY_LEGEND.debate).toMatch(/synthesis/i);
  });
});
