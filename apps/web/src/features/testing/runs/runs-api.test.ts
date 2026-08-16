import { describe, expect, it } from "vitest";
import type { RunSummary, Suite, SuiteRun } from "@mcp-token-footprint/shared";
import { type FeedSuiteItem, buildRunsFeed } from "./runs-api";

// Minimal builders — only the fields the feed derivation reads.
function run(over: Partial<RunSummary> & { id: string }): RunSummary {
  return {
    testId: "t1",
    scenarioId: "s1",
    mode: "automated",
    status: "completed",
    startedAt: "2026-07-04T00:00:00.000Z",
    turns: 1,
    toolCalls: 0,
    peakContextTokens: 0,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    ...over,
  };
}

function suiteRun(over: Partial<SuiteRun> & { id: string }): SuiteRun {
  return {
    status: "completed",
    configSnapshot: { repetitions: 1, maxConcurrency: 1 },
    startedAt: "2026-07-04T00:00:00.000Z",
    ...over,
  };
}

function suite(over: Partial<Suite> & { id: string }): Suite {
  return {
    name: "A suite",
    config: { repetitions: 1, maxConcurrency: 1 },
    testIds: [],
    scenarioIds: [],
    createdAt: "2026-07-04T00:00:00.000Z",
    updatedAt: "2026-07-04T00:00:00.000Z",
    ...over,
  };
}

const EMPTY = { tests: [], scenarios: [], providers: [] };

function suiteItems(feed: ReturnType<typeof buildRunsFeed>): FeedSuiteItem[] {
  return feed.items.filter((item): item is FeedSuiteItem => item.kind === "suite");
}

describe("buildRunsFeed", () => {
  it("keeps standalone runs as single rows and nests suite members under their summary", () => {
    const feed = buildRunsFeed({
      runs: [
        run({ id: "standalone", startedAt: "2026-07-04T03:00:00.000Z" }),
        run({ id: "member-a", suiteRunId: "sr1", startedAt: "2026-07-04T01:00:00.000Z" }),
        run({ id: "member-b", suiteRunId: "sr1", startedAt: "2026-07-04T02:00:00.000Z" }),
      ],
      suiteRuns: [suiteRun({ id: "sr1", suiteId: "su1", startedAt: "2026-07-04T00:30:00.000Z" })],
      suites: [suite({ id: "su1", name: "My suite" })],
      ...EMPTY,
    });

    // The two members do NOT appear as their own top-level rows.
    const runItemIds = feed.items
      .filter((i) => i.kind === "run")
      .map((i) => (i.kind === "run" ? i.run.id : ""));
    expect(runItemIds).toEqual(["standalone"]);

    const suites = suiteItems(feed);
    expect(suites).toHaveLength(1);
    expect(suites[0]?.suiteName).toBe("My suite");
    // Members are newest-first.
    expect(suites[0]?.members.map((m) => m.id)).toEqual(["member-b", "member-a"]);
  });

  it("merges single + suite rows newest-first by startedAt", () => {
    const feed = buildRunsFeed({
      runs: [run({ id: "r-old", startedAt: "2026-07-04T00:00:00.000Z" })],
      suiteRuns: [
        suiteRun({ id: "sr-new", startedAt: "2026-07-04T05:00:00.000Z", source: "adhoc" }),
      ],
      suites: [],
      ...EMPTY,
    });
    expect(feed.items.map((i) => (i.kind === "run" ? i.run.id : i.suiteRun.id))).toEqual([
      "sr-new",
      "r-old",
    ]);
  });

  it("derives test × environment counts from members, and reps from the config snapshot", () => {
    const feed = buildRunsFeed({
      runs: [
        run({ id: "m1", suiteRunId: "sr", testId: "tA", scenarioId: "sX" }),
        run({ id: "m2", suiteRunId: "sr", testId: "tA", scenarioId: "sY" }),
        run({ id: "m3", suiteRunId: "sr", testId: "tB", scenarioId: "sX" }),
      ],
      suiteRuns: [
        suiteRun({
          id: "sr",
          suiteId: "su",
          configSnapshot: { repetitions: 3, maxConcurrency: 2 },
        }),
      ],
      suites: [suite({ id: "su" })],
      ...EMPTY,
    });
    const item = suiteItems(feed)[0];
    expect(item?.testCount).toBe(2); // tA, tB
    expect(item?.environmentCount).toBe(2); // sX, sY
    expect(item?.repetitions).toBe(3);
  });

  it("falls back to the saved suite's membership for counts when no members exist yet", () => {
    const feed = buildRunsFeed({
      runs: [],
      suiteRuns: [suiteRun({ id: "sr", suiteId: "su" })],
      suites: [suite({ id: "su", testIds: ["t1", "t2", "t3"], scenarioIds: ["s1", "s2"] })],
      ...EMPTY,
    });
    const item = suiteItems(feed)[0];
    expect(item?.testCount).toBe(3);
    expect(item?.environmentCount).toBe(2);
    expect(item?.members).toEqual([]);
  });

  it("resolves no suite name for a collection/adhoc plan (no owning suite row)", () => {
    const feed = buildRunsFeed({
      runs: [],
      suiteRuns: [suiteRun({ id: "sr", source: "collection" })],
      suites: [],
      ...EMPTY,
    });
    expect(suiteItems(feed)[0]?.suiteName).toBeNull();
  });

  // Observability WP2.3 — `matchedRuns` is the server-computed RunFilter match set. `undefined`/`null`
  // (every existing test above) means "no filter active" and is BYTE-UNCHANGED from before this WP.
  describe("matchedRuns (WP2.3 RunFilter-bound query)", () => {
    it("null matchedRuns (the default) keeps every run — identical to no filter", () => {
      const feed = buildRunsFeed({
        runs: [run({ id: "standalone" }), run({ id: "member", suiteRunId: "sr1" })],
        suiteRuns: [suiteRun({ id: "sr1" })],
        suites: [],
        matchedRuns: null,
        ...EMPTY,
      });
      expect(feed.items).toHaveLength(2);
    });

    it("a standalone run NOT in the matched set is excluded from the feed", () => {
      const feed = buildRunsFeed({
        runs: [run({ id: "matches" }), run({ id: "excluded" })],
        suiteRuns: [],
        suites: [],
        matchedRuns: [run({ id: "matches" })],
        ...EMPTY,
      });
      expect(feed.items.map((i) => (i.kind === "run" ? i.run.id : ""))).toEqual(["matches"]);
    });

    it("prefers the MATCHED run's payload (carries searchSnippet/searchMatchKind on a `q` hit)", () => {
      const feed = buildRunsFeed({
        runs: [run({ id: "r1" })],
        suiteRuns: [],
        suites: [],
        matchedRuns: [run({ id: "r1", searchSnippet: "…[hit]…", searchMatchKind: "prompt" })],
        ...EMPTY,
      });
      const item = feed.items[0];
      expect(item?.kind === "run" ? item.run.searchSnippet : undefined).toBe("…[hit]…");
    });

    it("a suite row is included iff AT LEAST ONE member is in the matched set", () => {
      const feed = buildRunsFeed({
        runs: [run({ id: "m1", suiteRunId: "sr-hit" }), run({ id: "m2", suiteRunId: "sr-miss" })],
        suiteRuns: [suiteRun({ id: "sr-hit" }), suiteRun({ id: "sr-miss" })],
        suites: [],
        matchedRuns: [run({ id: "m1", suiteRunId: "sr-hit" })],
        ...EMPTY,
      });
      const included = suiteItems(feed).map((i) => i.suiteRun.id);
      expect(included).toEqual(["sr-hit"]);
    });

    it("an included suite's member list is UNFILTERED (never truncated by the active filter)", () => {
      const feed = buildRunsFeed({
        runs: [
          run({ id: "m1", suiteRunId: "sr", startedAt: "2026-07-04T02:00:00.000Z" }),
          run({ id: "m2", suiteRunId: "sr", startedAt: "2026-07-04T01:00:00.000Z" }),
        ],
        suiteRuns: [suiteRun({ id: "sr" })],
        suites: [],
        // Only m1 matches the filter, but the suite's DRILL-DOWN (expanded member list) still shows BOTH.
        matchedRuns: [run({ id: "m1", suiteRunId: "sr" })],
        ...EMPTY,
      });
      expect(suiteItems(feed)[0]?.members.map((m) => m.id)).toEqual(["m1", "m2"]);
    });

    it("an empty matched set (nothing matches) yields an empty feed", () => {
      const feed = buildRunsFeed({
        runs: [run({ id: "r1" }), run({ id: "m1", suiteRunId: "sr" })],
        suiteRuns: [suiteRun({ id: "sr" })],
        suites: [],
        matchedRuns: [],
        ...EMPTY,
      });
      expect(feed.items).toHaveLength(0);
    });
  });

  // Observability WP3.3 (D-OB18) — forks are hidden from the DEFAULT (unfiltered) feed; a
  // `derived:true` "show forks" filter reveals them via the server-computed matched set.
  describe("fork lineage default-exclude", () => {
    it("the unfiltered feed HIDES a derived run", () => {
      const feed = buildRunsFeed({
        runs: [run({ id: "normal" }), run({ id: "fork", derivedFromRunId: "normal" })],
        suiteRuns: [],
        suites: [],
        ...EMPTY,
      });
      expect(feed.items.map((i) => (i.kind === "run" ? i.run.id : i.suiteRun.id))).toEqual([
        "normal",
      ]);
    });

    it("a 'show forks' filter (matched set = only the fork) reveals it", () => {
      const fork = run({ id: "fork", derivedFromRunId: "normal" });
      const feed = buildRunsFeed({
        runs: [run({ id: "normal" }), fork],
        suiteRuns: [],
        suites: [],
        matchedRuns: [fork], // the server's `?filter={derived:true}` payload
        ...EMPTY,
      });
      expect(feed.items.map((i) => (i.kind === "run" ? i.run.id : i.suiteRun.id))).toEqual([
        "fork",
      ]);
    });
  });
});
