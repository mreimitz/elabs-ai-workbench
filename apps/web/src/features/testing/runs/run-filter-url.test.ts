import { describe, expect, test } from "vitest";
import type { RunFilter } from "@mcp-token-footprint/shared";
import { serializeRunFilter } from "@mcp-token-footprint/shared";
import { drillDownHref } from "../../dashboard/testing/dashboard-url-state";
import { SESSION_COLUMNS_PREFERENCE } from "./run-columns";
import {
  RUN_VIEW_PRESETS,
  WAITING_FOR_YOU_FILTER,
  isEmptyRunFilter,
  isPresetViewId,
  parseFilterFromSearchParams,
  writeFilterToSearchParams,
} from "./run-filter-url";

describe("parseFilterFromSearchParams", () => {
  test("an absent `filter` param parses to `{}` (no constraint)", () => {
    expect(parseFilterFromSearchParams(new URLSearchParams())).toEqual({});
  });

  test("a malformed `filter` param falls back to `{}` rather than throwing", () => {
    const params = new URLSearchParams({ filter: "{not json" });
    expect(parseFilterFromSearchParams(params)).toEqual({});
  });

  test("an unknown field falls back to `{}` (the shared schema is strict)", () => {
    const params = new URLSearchParams({ filter: JSON.stringify({ bogusField: true }) });
    expect(parseFilterFromSearchParams(params)).toEqual({});
  });

  test("reads a valid filter", () => {
    const filter: RunFilter = { status: ["completed"], pinned: true };
    const params = new URLSearchParams({ filter: serializeRunFilter(filter) });
    expect(parseFilterFromSearchParams(params)).toEqual(filter);
  });
});

describe("writeFilterToSearchParams", () => {
  test("an empty filter OMITS the `filter` param (clean URL for 'no filters')", () => {
    const params = writeFilterToSearchParams(new URLSearchParams(), {});
    expect(params.has("filter")).toBe(false);
  });

  test("a filter carrying only undefined-valued keys is ALSO treated as empty", () => {
    const filter = { status: undefined, pinned: undefined } as RunFilter;
    const params = writeFilterToSearchParams(new URLSearchParams(), filter);
    expect(params.has("filter")).toBe(false);
  });

  test("a non-empty filter is written as the canonical serialized JSON", () => {
    const filter: RunFilter = { status: ["completed", "error"], scenarioId: ["scn-1"] };
    const params = writeFilterToSearchParams(new URLSearchParams(), filter);
    expect(params.get("filter")).toBe(serializeRunFilter(filter));
  });

  test("does not mutate the input params (returns a copy)", () => {
    const input = new URLSearchParams({ tab: "runs" });
    const output = writeFilterToSearchParams(input, { pinned: true });
    expect(input.has("filter")).toBe(false);
    expect(output.get("tab")).toBe("runs");
    expect(output.get("filter")).toBe(serializeRunFilter({ pinned: true }));
  });

  test("round-trips BYTE-STABLE through parseFilterFromSearchParams (acceptance #1)", () => {
    const filter: RunFilter = {
      status: ["completed"],
      outcome: ["stopped_guardrail"],
      scenarioId: ["scn-2", "scn-1"],
      dateFrom: "2026-07-01T00:00:00.000Z",
      dateTo: "2026-07-10T23:59:59.999Z",
      scoreGte: 0.5,
      costUsdLte: 1.25,
      pinned: true,
      feedback: { key: "thumbs", hasScore: true },
    };
    const written = writeFilterToSearchParams(new URLSearchParams(), filter);
    const parsedBack = parseFilterFromSearchParams(written);
    // Byte-stable: re-serializing what we parsed back reproduces the EXACT same string.
    expect(serializeRunFilter(parsedBack)).toBe(written.get("filter"));
    expect(serializeRunFilter(parsedBack)).toBe(serializeRunFilter(filter));
  });
});

describe("dashboard drill-down hydration (WP2.2 → WP2.3 contract)", () => {
  test("a WP2.2 drillDownHref's `filter=` query hydrates EXACTLY via parseFilterFromSearchParams", () => {
    const filter: RunFilter = {
      serverId: ["srv-1"],
      model: ["claude-sonnet-4"],
      dateFrom: "2026-07-10T00:00:00.000Z",
      dateTo: "2026-07-16T23:59:59.999Z",
      stopReasonCode: ["max_turns"],
    };
    const href = drillDownHref(filter);
    const url = new URL(href, "http://localhost");
    expect(url.pathname).toBe("/testing/runs");
    const hydrated = parseFilterFromSearchParams(url.searchParams);
    expect(hydrated).toEqual(filter);
  });
});

describe("isEmptyRunFilter", () => {
  test("true for `{}`", () => {
    expect(isEmptyRunFilter({})).toBe(true);
  });

  test("true for an object carrying only undefined-valued keys", () => {
    expect(isEmptyRunFilter({ status: undefined } as RunFilter)).toBe(true);
  });

  test("false once any field is set", () => {
    expect(isEmptyRunFilter({ pinned: true })).toBe(false);
  });
});

describe("RUN_VIEW_PRESETS", () => {
  test("carries the named presets in order: All, Sessions, Failures, Guardrail stops, Waiting for you, Needs attention, Pinned", () => {
    expect(RUN_VIEW_PRESETS.map((p) => p.name)).toEqual([
      "All",
      "Sessions",
      "Failures",
      "Guardrail stops",
      "Waiting for you",
      "Needs attention",
      "Pinned",
    ]);
  });

  test("'All' is the empty (no-constraint) filter", () => {
    expect(RUN_VIEW_PRESETS[0]?.filter).toEqual({});
  });

  test("'Sessions' filters on interactiveOnly and switches to the session column set (WP 2.4)", () => {
    const sessions = RUN_VIEW_PRESETS.find((p) => p.name === "Sessions");
    expect(sessions?.filter).toEqual({ interactiveOnly: true });
    expect(sessions?.columns).toEqual(SESSION_COLUMNS_PREFERENCE);
  });

  test("every OTHER preset carries no `columns` override (keeps whatever is currently active)", () => {
    for (const preset of RUN_VIEW_PRESETS) {
      if (preset.name === "Sessions") continue;
      expect(preset.columns).toBeUndefined();
    }
  });

  test("'Waiting for you' filters on phase:waiting_input, and matches the exported WAITING_FOR_YOU_FILTER", () => {
    expect(RUN_VIEW_PRESETS.find((p) => p.name === "Waiting for you")?.filter).toEqual({
      phase: ["waiting_input"],
    });
    expect(WAITING_FOR_YOU_FILTER).toEqual({ phase: ["waiting_input"] });
  });

  test("'Needs attention' filters on needsAttention:true (owner-requested)", () => {
    expect(RUN_VIEW_PRESETS.find((p) => p.name === "Needs attention")?.filter).toEqual({
      needsAttention: true,
    });
  });

  test("'Pinned' filters on pinned:true", () => {
    expect(RUN_VIEW_PRESETS.find((p) => p.name === "Pinned")?.filter).toEqual({ pinned: true });
  });

  test("every preset id is recognized by isPresetViewId, and a server view id is not", () => {
    for (const preset of RUN_VIEW_PRESETS) {
      expect(isPresetViewId(preset.id)).toBe(true);
    }
    expect(isPresetViewId("a-server-generated-uuid")).toBe(false);
  });
});
