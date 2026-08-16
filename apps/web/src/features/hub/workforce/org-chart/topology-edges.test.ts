import type { HubTopology } from "@mcp-token-footprint/shared";
import { describe, expect, test } from "vitest";
import {
  buildCrewTopologyEdges,
  memberTopologyRole,
  TOPOLOGY_EDGE_MEANING,
  TOPOLOGY_LABEL,
} from "./topology-edges";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `m${i}`);
const pairs = (topology: HubTopology, n: number) =>
  buildCrewTopologyEdges(topology, ids(n)).map((e) => `${e.source}->${e.target}`);

describe("buildCrewTopologyEdges", () => {
  test("fewer than two members ⇒ no edges (nothing to hand off / fan)", () => {
    for (const t of ["pipeline", "parallel", "debate", "best_of_n"] as HubTopology[]) {
      expect(buildCrewTopologyEdges(t, [])).toEqual([]);
      expect(buildCrewTopologyEdges(t, ["only"])).toEqual([]);
    }
  });

  test("pipeline is a directed chain m0→m1→m2→…", () => {
    expect(pairs("pipeline", 4)).toEqual(["m0->m1", "m1->m2", "m2->m3"]);
    expect(buildCrewTopologyEdges("pipeline", ids(3)).every((e) => e.directed)).toBe(true);
  });

  test("parallel fans OUT from the head (member 0)", () => {
    expect(pairs("parallel", 4)).toEqual(["m0->m1", "m0->m2", "m0->m3"]);
    expect(buildCrewTopologyEdges("parallel", ids(3)).every((e) => e.directed)).toBe(true);
  });

  test("best_of_n fans IN to the head (mirror of parallel)", () => {
    expect(pairs("best_of_n", 4)).toEqual(["m1->m0", "m2->m0", "m3->m0"]);
    expect(buildCrewTopologyEdges("best_of_n", ids(3)).every((e) => e.directed)).toBe(true);
  });

  test("debate (RC6.1) is a directed chain, the SAME shape as pipeline — no more undirected facing pairs", () => {
    expect(pairs("debate", 4)).toEqual(["m0->m1", "m1->m2", "m2->m3"]);
    // The classic 2-debater case is a single directed order link, not a mutual facing link.
    expect(pairs("debate", 2)).toEqual(["m0->m1"]);
    expect(pairs("debate", 5)).toEqual(["m0->m1", "m1->m2", "m2->m3", "m3->m4"]);
    // Debate's edge shape is now literally identical to pipeline's, for any member count.
    for (const n of [2, 3, 4, 5, 6, 7]) {
      expect(pairs("debate", n)).toEqual(pairs("pipeline", n));
    }
    // Every debate edge is directed (the real "sees + rebuts" execution order).
    expect(buildCrewTopologyEdges("debate", ids(5)).every((e) => e.directed)).toBe(true);
    // No member is left without at least one edge (a chain naturally touches everyone).
    for (const n of [2, 3, 4, 5, 6, 7]) {
      const touched = new Set(buildCrewTopologyEdges("debate", ids(n)).flatMap((e) => [e.source, e.target]));
      expect(touched.size).toBe(n);
    }
  });

  test("edge ids are stable & unique per source/target pair", () => {
    const edges = buildCrewTopologyEdges("pipeline", ids(3));
    expect(new Set(edges.map((e) => e.id)).size).toBe(edges.length);
    expect(edges[0]!.id).toBe("m0__m1");
  });

  test("operates by position (accepts caller-minted unique ids verbatim)", () => {
    expect(pairsFrom("pipeline", ["a", "b", "c"])).toEqual(["a->b", "b->c"]);
  });
});

function pairsFrom(topology: HubTopology, memberIds: string[]) {
  return buildCrewTopologyEdges(topology, memberIds).map((e) => `${e.source}->${e.target}`);
}

describe("topology labels / eyebrows", () => {
  test("every topology has a label + edge-meaning", () => {
    for (const t of ["pipeline", "parallel", "debate", "best_of_n"] as HubTopology[]) {
      expect(TOPOLOGY_LABEL[t]).toBeTruthy();
      expect(TOPOLOGY_EDGE_MEANING[t]).toBeTruthy();
    }
  });

  test("debate's edge-meaning (RC6.1) drops the old 'face to face' framing and matches the board's chain + resolver story", () => {
    expect(TOPOLOGY_EDGE_MEANING.debate).not.toMatch(/face to face/i);
    expect(TOPOLOGY_EDGE_MEANING.debate).toMatch(/synthesis/i);
  });

  test("member eyebrow reflects order + designated fan hub", () => {
    expect(memberTopologyRole("pipeline", 0, 3)).toBe("Stage 1");
    expect(memberTopologyRole("pipeline", 2, 3)).toBe("Stage 3");
    expect(memberTopologyRole("debate", 1, 2)).toBe("Debater 2");
    expect(memberTopologyRole("parallel", 0, 3)).toBe("Lead");
    expect(memberTopologyRole("parallel", 2, 3)).toBe("Worker");
    expect(memberTopologyRole("best_of_n", 0, 3)).toBe("Lead");
    expect(memberTopologyRole("best_of_n", 2, 3)).toBe("Attempt 2");
  });
});
