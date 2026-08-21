import { describe, expect, test } from "vitest";
import type { RunFilter } from "@mcp-token-footprint/shared";
import { serializeRunFilter } from "@mcp-token-footprint/shared";
import { DEFAULT_RUN_COLUMNS_PREFERENCE, SESSION_COLUMNS_PREFERENCE } from "./run-columns";
import {
  DEFAULT_RUN_FEED_VIEW_STATE,
  type RunFeedViewState,
  hasExplicitRunFeedState,
  parseRunFeedViewState,
  parseRunTableSort,
  writeRunFeedViewState,
} from "./run-feed-url";

/** A fully-populated, non-default state — every field differs from {@link DEFAULT_RUN_FEED_VIEW_STATE}. */
const FULL_STATE: RunFeedViewState = {
  filter: {
    status: ["completed", "error"],
    outcome: ["stopped_guardrail"],
    scenarioId: ["scn-2", "scn-1"],
    dateFrom: "2026-07-01T00:00:00.000Z",
    scoreGte: 0.5,
    pinned: true,
    q: "timeout",
    feedback: { key: "thumbs", hasScore: true },
  },
  viewId: "view-abc",
  typeFacet: ["suite"],
  groupBy: "environment",
  sort: { key: "cost", dir: "asc" },
  columns: { visible: ["environment", "tokens", "cost"], previewMode: "error" },
};

describe("parseRunFeedViewState / writeRunFeedViewState — the AM-OB1 round-trip", () => {
  test("an empty query parses to the documented default state (D-TB10: the zero-param route works)", () => {
    expect(parseRunFeedViewState(new URLSearchParams())).toEqual(DEFAULT_RUN_FEED_VIEW_STATE);
  });

  test("writing the default state onto an empty query writes NOTHING (clean URLs stay clean)", () => {
    const params = writeRunFeedViewState(new URLSearchParams(), DEFAULT_RUN_FEED_VIEW_STATE);
    expect(params.toString()).toBe("");
  });

  test("serialize → parse deep-equals the original for a fully-populated state", () => {
    const written = writeRunFeedViewState(new URLSearchParams(), FULL_STATE);
    expect(parseRunFeedViewState(written)).toEqual(FULL_STATE);
  });

  test("the round-trip is byte-stable — re-writing what we parsed reproduces the same query string", () => {
    const once = writeRunFeedViewState(new URLSearchParams(), FULL_STATE);
    const twice = writeRunFeedViewState(new URLSearchParams(), parseRunFeedViewState(once));
    expect(twice.toString()).toBe(once.toString());
  });

  test("each param carries the value the feed shows", () => {
    const params = writeRunFeedViewState(new URLSearchParams(), FULL_STATE);
    expect(params.get("filter")).toBe(serializeRunFilter(FULL_STATE.filter));
    expect(params.get("view")).toBe("view-abc");
    expect(params.get("type")).toBe("suite");
    expect(params.get("group")).toBe("environment");
    expect(params.get("sort")).toBe("cost:asc");
    expect(params.get("cols")).toBe("environment,tokens,cost");
    expect(params.get("preview")).toBe("error");
  });

  test("params this module does not own are preserved verbatim", () => {
    const input = new URLSearchParams({ feed: "suites", launch: "1" });
    const output = writeRunFeedViewState(input, FULL_STATE);
    expect(output.get("feed")).toBe("suites");
    expect(output.get("launch")).toBe("1");
    // …and the input itself is untouched (the writer always copies).
    expect(input.has("view")).toBe(false);
  });

  test("returning a field to its default DELETES its param rather than writing the default value", () => {
    const populated = writeRunFeedViewState(new URLSearchParams(), FULL_STATE);
    const cleared = writeRunFeedViewState(populated, DEFAULT_RUN_FEED_VIEW_STATE);
    expect(cleared.toString()).toBe("");
  });

  test("a saved view's session column set round-trips (order preserved)", () => {
    const state: RunFeedViewState = {
      ...DEFAULT_RUN_FEED_VIEW_STATE,
      columns: SESSION_COLUMNS_PREFERENCE,
    };
    const parsed = parseRunFeedViewState(writeRunFeedViewState(new URLSearchParams(), state));
    expect(parsed.columns).toEqual(SESSION_COLUMNS_PREFERENCE);
  });

  test("an EMPTY visible-column list is a real choice, distinguishable from an absent param", () => {
    const state: RunFeedViewState = {
      ...DEFAULT_RUN_FEED_VIEW_STATE,
      columns: { visible: [], previewMode: "none" },
    };
    const written = writeRunFeedViewState(new URLSearchParams(), state);
    expect(written.get("cols")).toBe("");
    expect(parseRunFeedViewState(written).columns.visible).toEqual([]);
    // …whereas no `cols` param at all restores the default set.
    expect(parseRunFeedViewState(new URLSearchParams()).columns.visible).toEqual(
      DEFAULT_RUN_COLUMNS_PREFERENCE.visible,
    );
  });
});

describe("parseRunFeedViewState — a hand-edited or stale URL degrades, never throws", () => {
  test("an unknown group axis falls back to the default", () => {
    const params = new URLSearchParams({ group: "by-vibes" });
    expect(parseRunFeedViewState(params).groupBy).toBe("none");
  });

  test("an unknown sort key or direction falls back to the default sort", () => {
    expect(parseRunFeedViewState(new URLSearchParams({ sort: "nonsense:asc" })).sort).toEqual(
      DEFAULT_RUN_FEED_VIEW_STATE.sort,
    );
    expect(parseRunFeedViewState(new URLSearchParams({ sort: "cost:sideways" })).sort).toEqual(
      DEFAULT_RUN_FEED_VIEW_STATE.sort,
    );
    expect(parseRunFeedViewState(new URLSearchParams({ sort: "cost" })).sort).toEqual(
      DEFAULT_RUN_FEED_VIEW_STATE.sort,
    );
  });

  test("unknown column keys are dropped and the known ones survive", () => {
    const params = new URLSearchParams({ cols: "cost,not-a-column,duration,cost" });
    expect(parseRunFeedViewState(params).columns.visible).toEqual(["cost", "duration"]);
  });

  test("an unknown preview mode falls back to the default", () => {
    const params = new URLSearchParams({ preview: "telepathy" });
    expect(parseRunFeedViewState(params).columns.previewMode).toBe("none");
  });

  test("unknown type-facet values are dropped", () => {
    expect(parseRunFeedViewState(new URLSearchParams({ type: "suite,ghost" })).typeFacet).toEqual([
      "suite",
    ]);
  });

  test("a blank `view` param reads as no view", () => {
    expect(parseRunFeedViewState(new URLSearchParams({ view: "   " })).viewId).toBeNull();
  });

  test("a malformed `filter` still degrades to `{}` (unchanged WP 2.3 contract)", () => {
    const params = new URLSearchParams({ filter: "{not json", sort: "cost:asc" });
    const parsed = parseRunFeedViewState(params);
    expect(parsed.filter).toEqual({});
    // …and the rest of the state is still read correctly.
    expect(parsed.sort).toEqual({ key: "cost", dir: "asc" });
  });
});

describe("hasExplicitRunFeedState — telling a named URL from a self-describing one", () => {
  test("false for a bare `?view=<id>` (the short named-URL form)", () => {
    expect(hasExplicitRunFeedState(new URLSearchParams({ view: "view-abc" }))).toBe(false);
  });

  test("false for a zero-param URL, and for params this module does not own", () => {
    expect(hasExplicitRunFeedState(new URLSearchParams())).toBe(false);
    expect(hasExplicitRunFeedState(new URLSearchParams({ feed: "suites" }))).toBe(false);
  });

  test("true once ANY other state param is present", () => {
    const filter: RunFilter = { pinned: true };
    expect(
      hasExplicitRunFeedState(
        new URLSearchParams({ view: "view-abc", filter: serializeRunFilter(filter) }),
      ),
    ).toBe(true);
    expect(hasExplicitRunFeedState(new URLSearchParams({ sort: "cost:asc" }))).toBe(true);
    expect(hasExplicitRunFeedState(new URLSearchParams({ cols: "" }))).toBe(true);
  });
});

describe("parseRunTableSort — a saved view's OPAQUE sort hint", () => {
  test("accepts the shape this app writes", () => {
    expect(parseRunTableSort({ key: "tokens", dir: "asc" })).toEqual({ key: "tokens", dir: "asc" });
  });

  test("rejects anything else rather than throwing", () => {
    expect(parseRunTableSort(null)).toBeNull();
    expect(parseRunTableSort("cost:asc")).toBeNull();
    expect(parseRunTableSort({ key: "cost" })).toBeNull();
    expect(parseRunTableSort({ key: "colour", dir: "asc" })).toBeNull();
    expect(parseRunTableSort({ key: "cost", dir: "up" })).toBeNull();
  });
});
