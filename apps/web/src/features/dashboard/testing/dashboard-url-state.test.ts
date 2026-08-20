import { describe, expect, test } from "vitest";
import { parseRunFilter, runFilterSchema } from "@mcp-token-footprint/shared";
import {
  baseRunFilter,
  bucketRangeIso,
  DEFAULT_TESTING_GROUP_BY,
  defaultControls,
  drillDownFilter,
  drillDownHref,
  metricsWindow,
  parseControlsFromSearchParams,
  resolveBucket,
  type TestingDashboardControls,
  writeControlsToSearchParams,
} from "./dashboard-url-state";

const NOW = new Date("2026-07-17T12:00:00.000Z");

describe("defaultControls", () => {
  test("resolves the trailing 7-day window ending today, grouped by model, no filters", () => {
    const controls = defaultControls(NOW);
    expect(controls.to).toBe("2026-07-17");
    expect(controls.from).toBe("2026-07-11");
    expect(controls.groupBy).toBe(DEFAULT_TESTING_GROUP_BY);
    expect(controls.providerKind).toEqual([]);
    expect(controls.serverId).toEqual([]);
    expect(controls.scenarioId).toEqual([]);
    expect(controls.suiteId).toBeUndefined();
    expect(controls.model).toEqual([]);
  });
});

describe("parseControlsFromSearchParams", () => {
  test("empty params fall back to the default control set", () => {
    const params = new URLSearchParams();
    expect(parseControlsFromSearchParams(params, NOW)).toEqual(defaultControls(NOW));
  });

  test("reads every facet when present", () => {
    const params = new URLSearchParams({
      tGroupBy: "server",
      tProvider: "anthropic,openai",
      tServer: "srv-1,srv-2",
      tEnv: "scn-1",
      tSuite: "suite-1",
      tModel: "claude-sonnet-4",
    });
    const controls = parseControlsFromSearchParams(params, NOW);
    expect(controls).toEqual({
      // The window is NOT a URL facet any more (dashboard-bento WP 2.2) — it comes from the page
      // range, and falls back to the trailing 7 days when the caller supplies none.
      from: defaultControls(NOW).from,
      to: defaultControls(NOW).to,
      groupBy: "server",
      providerKind: ["anthropic", "openai"],
      serverId: ["srv-1", "srv-2"],
      scenarioId: ["scn-1"],
      suiteId: "suite-1",
      model: ["claude-sonnet-4"],
    });
  });

  test("an unknown groupBy falls back to the default field, not a throw", () => {
    const params = new URLSearchParams({ tGroupBy: "bogus" });
    expect(parseControlsFromSearchParams(params, NOW).groupBy).toBe(DEFAULT_TESTING_GROUP_BY);
  });

  test("the page range (WP 2.2) is copied onto the controls verbatim — instants, not day bounds", () => {
    const controls = parseControlsFromSearchParams(new URLSearchParams(), NOW, {
      from: "2026-07-16T12:00:00.000Z",
      to: "2026-07-17T12:00:00.000Z",
    });
    expect(controls.from).toBe("2026-07-16T12:00:00.000Z");
    expect(controls.to).toBe("2026-07-17T12:00:00.000Z");
    // …and a trailing-24h window still buckets hourly, exactly as the day-granular one used to.
    expect(resolveBucket(controls)).toBe("hour");
    expect(metricsWindow(controls)).toEqual({
      from: "2026-07-16T12:00:00.000Z",
      to: "2026-07-17T12:00:00.000Z",
    });
  });

  test("de-duplicates and trims comma-joined list values", () => {
    const params = new URLSearchParams({ tServer: " srv-1, srv-1 ,srv-2," });
    const controls = parseControlsFromSearchParams(params, NOW);
    expect(controls.serverId).toEqual(["srv-1", "srv-2"]);
  });
});

describe("writeControlsToSearchParams / parseControlsFromSearchParams — round trip", () => {
  test("write → parse restores the exact facet set (non-default groupBy + every filter dimension)", () => {
    const controls: TestingDashboardControls = {
      from: "2026-07-01",
      to: "2026-07-10",
      groupBy: "providerKind",
      providerKind: ["anthropic"],
      serverId: ["srv-1"],
      scenarioId: ["scn-1", "scn-2"],
      suiteId: "suite-1",
      model: ["claude-sonnet-4"],
    };
    const written = writeControlsToSearchParams(new URLSearchParams(), controls);
    // The window is supplied by the page range, not the URL — hand it back in to round-trip.
    const restored = parseControlsFromSearchParams(written, NOW, {
      from: controls.from,
      to: controls.to,
    });
    expect(restored).toEqual(controls);
  });

  test("the default groupBy is omitted from the URL (clean common case)", () => {
    const written = writeControlsToSearchParams(new URLSearchParams(), defaultControls(NOW));
    expect(written.has("tGroupBy")).toBe(false);
  });

  test("does not mutate the input URLSearchParams, and never writes the date window", () => {
    const original = new URLSearchParams({ tab: "testing" });
    const written = writeControlsToSearchParams(original, {
      ...defaultControls(NOW),
      groupBy: "server",
    });
    expect(original.has("tGroupBy")).toBe(false);
    expect(written.get("tab")).toBe("testing"); // unrelated keys survive
    expect(written.get("tGroupBy")).toBe("server");
    // The window belongs to the page-level `?range=` param (dashboard-bento WP 2.2).
    expect(written.has("tFrom")).toBe(false);
    expect(written.has("tTo")).toBe(false);
  });
});

describe("baseRunFilter", () => {
  test("empty controls yield an empty (no-constraint) filter", () => {
    expect(baseRunFilter(defaultControls(NOW))).toEqual({});
  });

  test("carries every present dimension, omitting empty arrays / absent suite", () => {
    const controls: TestingDashboardControls = {
      ...defaultControls(NOW),
      providerKind: ["anthropic"],
      serverId: ["srv-1"],
      scenarioId: ["scn-1"],
      model: ["claude-sonnet-4"],
    };
    expect(baseRunFilter(controls)).toEqual({
      providerKind: ["anthropic"],
      serverId: ["srv-1"],
      scenarioId: ["scn-1"],
      model: ["claude-sonnet-4"],
    });
  });
});

describe("metricsWindow", () => {
  test("resolves inclusive start-of-day / end-of-day instants", () => {
    const controls = { ...defaultControls(NOW), from: "2026-07-01", to: "2026-07-10" };
    expect(metricsWindow(controls)).toEqual({
      from: "2026-07-01T00:00:00.000Z",
      to: "2026-07-10T23:59:59.999Z",
    });
  });
});

describe("resolveBucket", () => {
  test("a same-day / 24h-scale window buckets hourly", () => {
    expect(resolveBucket({ ...defaultControls(NOW), from: "2026-07-17", to: "2026-07-17" })).toBe("hour");
  });

  test("the default 7-day window buckets daily", () => {
    expect(resolveBucket(defaultControls(NOW))).toBe("day");
  });

  test("a 30-day window buckets daily", () => {
    expect(resolveBucket({ ...defaultControls(NOW), from: "2026-06-18", to: "2026-07-17" })).toBe("day");
  });

  test("a multi-month custom window buckets weekly", () => {
    expect(resolveBucket({ ...defaultControls(NOW), from: "2026-01-01", to: "2026-07-17" })).toBe("week");
  });
});

describe("bucketRangeIso", () => {
  test("a day bucket spans [start, start+1day-1ms]", () => {
    expect(bucketRangeIso("2026-07-10T00:00:00.000Z", "day")).toEqual({
      from: "2026-07-10T00:00:00.000Z",
      to: "2026-07-10T23:59:59.999Z",
    });
  });

  test("an hour bucket spans [start, start+1h-1ms]", () => {
    expect(bucketRangeIso("2026-07-10T05:00:00.000Z", "hour")).toEqual({
      from: "2026-07-10T05:00:00.000Z",
      to: "2026-07-10T05:59:59.999Z",
    });
  });

  test("a week bucket spans [start, start+7days-1ms]", () => {
    expect(bucketRangeIso("2026-07-06T00:00:00.000Z", "week")).toEqual({
      from: "2026-07-06T00:00:00.000Z",
      to: "2026-07-12T23:59:59.999Z",
    });
  });
});

// ── Drill-down round trip (WP 2.2 acceptance #3) — an error-rate point, a stopReasonCode slice, and
// a leaderboard row are exercised end-to-end in the panel tests; this locks the PURE composition +
// href encoding these panels all build on.

describe("drillDownFilter / drillDownHref", () => {
  const controls: TestingDashboardControls = {
    ...defaultControls(NOW),
    from: "2026-07-01",
    to: "2026-07-10",
    providerKind: ["anthropic"],
  };

  test("folds the dimension filter + date window, with `extra` winning on collision", () => {
    const filter = drillDownFilter(controls, { stopReasonCode: ["max_turns"] });
    expect(filter).toEqual({
      providerKind: ["anthropic"],
      dateFrom: "2026-07-01T00:00:00.000Z",
      dateTo: "2026-07-10T23:59:59.999Z",
      stopReasonCode: ["max_turns"],
    });
  });

  test("`extra.serverId` overrides the control bar's own serverId selection", () => {
    const withServerFilter = { ...controls, serverId: ["srv-control"] };
    const filter = drillDownFilter(withServerFilter, { serverId: ["srv-exact-bar"] });
    expect(filter.serverId).toEqual(["srv-exact-bar"]);
  });

  test("the produced href round-trips through serializeRunFilter/parseRunFilter to the EXACT filter", () => {
    const filter = drillDownFilter(controls, { testId: ["test-1"] });
    const href = drillDownHref(filter);
    expect(href.startsWith("/testing/runs?filter=")).toBe(true);
    const encoded = href.slice("/testing/runs?filter=".length);
    const restored = parseRunFilter(decodeURIComponent(encoded));
    // Compare against the zod-normalized filter (drops undefined optionals) so the assertion is
    // exact — this is the acceptance #3 round-trip: serialize → URL → decode → parse === original.
    expect(restored).toEqual(runFilterSchema.parse(filter));
    expect(restored.providerKind).toEqual(["anthropic"]);
    expect(restored.testId).toEqual(["test-1"]);
    expect(restored.dateFrom).toBe("2026-07-01T00:00:00.000Z");
    expect(restored.dateTo).toBe("2026-07-10T23:59:59.999Z");
  });

  test("a stopReasonCode slice's href round-trips to the exact stopReasonCode array", () => {
    const filter = drillDownFilter(controls, { stopReasonCode: ["stalled"] });
    const href = drillDownHref(filter);
    const encoded = decodeURIComponent(href.slice("/testing/runs?filter=".length));
    expect(parseRunFilter(encoded).stopReasonCode).toEqual(["stalled"]);
  });

  test("a leaderboard row (testId/serverId) href round-trips to the exact id", () => {
    const testRowFilter = drillDownFilter(controls, { testId: ["failing-test-1"] });
    const testHref = drillDownHref(testRowFilter);
    expect(
      parseRunFilter(decodeURIComponent(testHref.slice("/testing/runs?filter=".length))).testId,
    ).toEqual(["failing-test-1"]);

    const serverRowFilter = drillDownFilter(controls, { serverId: ["srv-failing"] });
    const serverHref = drillDownHref(serverRowFilter);
    expect(
      parseRunFilter(decodeURIComponent(serverHref.slice("/testing/runs?filter=".length))).serverId,
    ).toEqual(["srv-failing"]);
  });
});
