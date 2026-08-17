// Assistant Hub UX (roadmap/assistant-hub-ux/, WP2.5 · D-HUX9) — the PURE, reusable topology→edge
// builder for a crew's INTRA-crew execution topology. This is the single source of truth WP2.4's
// crew-profile Topology section imports (via {@link CrewTopologyGraph}) AND the Org chart tab's
// {@link buildOrgChartModel} both draw from — so "a pipeline reads as a chain, a parallel as a fan, a
// debate as an ORDER CHAIN (RC6.1 — matches the mission board's real execution order, not the old
// facing-pair depiction), best-of-N as a fan-in" is defined in exactly one place.
//
// Deliberately framework-free (no React, no `@elabs-ai/components-flow`, no `@xyflow/react`) so it is unit-tested
// in isolation and stays dependency-light for WP2.4 to import without pulling the whole canvas.
//
// The four shapes (D-HUX9 / concept §7.3), operating on the crew's members IN ORDER:
//   • pipeline  — a directed CHAIN: m0 → m1 → m2 → … (each stage hands off to the next).
//   • parallel  — a directed FAN-OUT from a head: m0 → m1, m0 → m2, … (the first member is the v1
//                 designated fan hub / "lead"; true peer-parallel has no lead — a synthetic
//                 coordinator node is an owner-gated v2, tracked in the STATUS ledger).
//   • debate    — a directed CHAIN, same shape as `pipeline`: m0 → m1 → m2 → … (RC6.1 — debate is
//                 genuinely sequential; each debater's brief folds in every prior report, "challenge,
//                 rebut, or strengthen"; a mission-level synthesis resolves it, drawn on the full
//                 board/preview — see `../../topology-graph.ts`'s `deriveDebateGraph`). This
//                 REPLACES the old undirected "facing pairs" depiction, which read as two debaters
//                 arguing face to face and contradicted the board (live timestamps: sequential, 50s
//                 apart).
//   • best_of_n — a directed FAN-IN to a head: m1 → m0, m2 → m0, … (mirror of `parallel`; the first
//                 member is the v1 designated aggregation point).
//
// The builder is POSITION-based: it takes an array of already-unique node ids (the caller owns id
// minting — a crew may legitimately list the same agent id twice) and wires them by their position.

import type { HubTopology } from "@mcp-token-footprint/shared";

/**
 * One intra-crew topology edge. Every topology's edges are directed (RC6.1 — including debate, which
 * used to be the one undirected/mutual exception; it is now a directed order chain, same as
 * `pipeline`, because that is how it actually executes).
 */
export type OrgTopologyEdge = {
  id: string;
  source: string;
  target: string;
  directed: boolean;
};

/**
 * Map a crew's `topology` + its ordered member node ids to the edge set that draws its real
 * execution shape (D-HUX9). Pure and side-effect-free. Fewer than two members ⇒ no edges (a single
 * agent has nothing to hand off to / fan across).
 *
 * @param topology  the crew's execution topology.
 * @param memberIds the crew members' node ids, IN ORDER, assumed unique (caller-minted).
 */
export function buildCrewTopologyEdges(
  topology: HubTopology,
  memberIds: readonly string[],
): OrgTopologyEdge[] {
  const n = memberIds.length;
  if (n < 2) return [];

  const edge = (source: string, target: string, directed: boolean): OrgTopologyEdge => ({
    id: `${source}__${target}`,
    source,
    target,
    directed,
  });

  switch (topology) {
    case "pipeline":
    case "debate": {
      // Directed chain: each consecutive pair, in order (RC6.1 — debate now matches pipeline's
      // shape: it is the real execution order, "sees + rebuts", not a mutual facing pair).
      const edges: OrgTopologyEdge[] = [];
      for (let i = 1; i < n; i++) edges.push(edge(memberIds[i - 1]!, memberIds[i]!, true));
      return edges;
    }
    case "parallel": {
      // Fan-out from the head (member 0) to every other member.
      const head = memberIds[0]!;
      const edges: OrgTopologyEdge[] = [];
      for (let i = 1; i < n; i++) edges.push(edge(head, memberIds[i]!, true));
      return edges;
    }
    case "best_of_n": {
      // Fan-in: every other member converges on the head (member 0) — mirror of `parallel`.
      const head = memberIds[0]!;
      const edges: OrgTopologyEdge[] = [];
      for (let i = 1; i < n; i++) edges.push(edge(memberIds[i]!, head, true));
      return edges;
    }
    default: {
      // Exhaustiveness guard — a new HubTopology must extend this switch.
      const _never: never = topology;
      return _never;
    }
  }
}

/** Human-readable topology names for headers/legends (matches the concept wireframe's `· pipeline`). */
export const TOPOLOGY_LABEL: Record<HubTopology, string> = {
  pipeline: "Pipeline",
  parallel: "Parallel",
  debate: "Debate",
  best_of_n: "Best of N",
};

/**
 * One-line "what the arrows mean" copy per topology — the Org chart legend's edge-meaning column.
 * Matches the live mission board's own legend (`../../topology-graph.ts`'s `TOPOLOGY_LEGEND`; RC6.1) —
 * debate's copy no longer claims debaters "argue face to face"; it is a directed order chain that
 * synthesis resolves, same as the board.
 */
export const TOPOLOGY_EDGE_MEANING: Record<HubTopology, string> = {
  pipeline: "Chain — each stage hands off to the next",
  parallel: "Fan-out — the lead dispatches parallel workers",
  debate: "Chain — each debater sees and rebuts those before it, then synthesis resolves",
  best_of_n: "Fan-in — attempts converge on the aggregator",
};

/**
 * The eyebrow (`kind`) label for member `index` of `count` under `topology` — reflects the member's
 * position in the crew's ordered `members[]` (the only positional signal the wire carries). The first
 * member of a fan topology is the designated hub (see {@link buildCrewTopologyEdges}); `_count` is
 * accepted for call-site symmetry / future per-count wording.
 */
export function memberTopologyRole(topology: HubTopology, index: number, _count: number): string {
  switch (topology) {
    case "pipeline":
      return `Stage ${index + 1}`;
    case "debate":
      return `Debater ${index + 1}`;
    case "parallel":
      return index === 0 ? "Lead" : "Worker";
    case "best_of_n":
      return index === 0 ? "Lead" : `Attempt ${index}`;
    default: {
      const _never: never = topology;
      return _never;
    }
  }
}
