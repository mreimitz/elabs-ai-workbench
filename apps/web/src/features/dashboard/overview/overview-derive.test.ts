import { describe, expect, test } from "vitest";
import type {
  AdvisorReport,
  AdvisorSeverity,
  RatingIssue,
  RunMetricsResponse,
  RunMetricsSeries,
  ScanMetricsPoint,
  ScanMetricsResponse,
  ScanMetricsSeries,
  ScanSummary,
  ServerConfig,
} from "@mcp-token-footprint/shared";
import type { OverviewRange } from "./overview-contract";
import {
  ATTENTION_ITEM_LIMIT,
  bucketFloorUtc,
  buildAdvisorTeaser,
  buildAttentionData,
  buildBucketAxis,
  buildCostByBasis,
  buildFootprintData,
  buildRunHealthData,
  buildStandingSeries,
  densifyCounts,
  pickSeriesPerServer,
  previousRange,
  resolveOverviewBucket,
  windowPassRatePercent,
} from "./overview-derive";

// ── Fixture builders ─────────────────────────────────────────────────────────────────────────────

/** A `ScanMetricsPoint` with a successful scan behind it. `delta`/`comparable` are set per case. */
function measured(
  bucketStart: string,
  totalTokens: number,
  delta: { deltaTotalTokens: number | null; deltaComparable: boolean },
  splits: { tool?: number; resource?: number; prompt?: number } = {},
): ScanMetricsPoint {
  return {
    bucketStart,
    scanCount: 1,
    failureRate: 0,
    countingVersion: 2,
    totalTokens,
    toolTokens: splits.tool ?? totalTokens,
    resourceTokens: splits.resource ?? 0,
    promptTokens: splits.prompt ?? 0,
    totalTools: 10,
    totalResources: 0,
    totalResourceTemplates: 0,
    totalPrompts: 0,
    deltaTotalTokens: delta.deltaTotalTokens,
    deltaComparable: delta.deltaComparable,
  };
}

/** A bucket in which a scan ran but none SUCCEEDED — no measurement, so no footprint value. */
function unmeasured(bucketStart: string): ScanMetricsPoint {
  return {
    bucketStart,
    scanCount: 1,
    failureRate: 1,
    countingVersion: null,
    totalTokens: null,
    toolTokens: null,
    resourceTokens: null,
    promptTokens: null,
    totalTools: null,
    totalResources: null,
    totalResourceTemplates: null,
    totalPrompts: null,
    deltaTotalTokens: null,
    deltaComparable: false,
  };
}

function scanSeries(
  serverId: string,
  serverName: string | null,
  points: ScanMetricsPoint[],
  tokenProfile = "generic_o200k",
): ScanMetricsSeries {
  return { serverId, serverName, tokenProfile, points };
}

function scanResponse(servers: ScanMetricsSeries[]): ScanMetricsResponse {
  return { bucket: "day", timezone: "UTC", from: null, to: null, servers };
}

function runResponse(series: RunMetricsSeries[]): RunMetricsResponse {
  return {
    bucket: "day",
    timezone: "UTC",
    from: null,
    to: null,
    groupBy: null,
    measures: ["count", "errorRate", "costUsd"],
    unavailableMeasures: [],
    series,
  };
}

function countSeries(points: { bucketStart: string; value: number }[]): RunMetricsSeries {
  return {
    measure: "count",
    group: null,
    capabilityClass: null,
    points: points.map((point) => ({ ...point, n: point.value })),
  };
}

function errorRateSeries(
  points: { bucketStart: string; value: number; n: number }[],
): RunMetricsSeries {
  return { measure: "errorRate", group: null, capabilityClass: null, points };
}

function costSeries(capabilityClass: string, total: number): RunMetricsSeries {
  return {
    measure: "costUsd",
    group: null,
    capabilityClass,
    points: [{ bucketStart: "2026-08-01T00:00:00.000Z", value: total, n: 1 }],
  };
}

function server(id: string, name: string): ServerConfig {
  return {
    id,
    name,
    transport: "stdio",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    hasEnvSecrets: false,
    hasHeaderSecrets: false,
    authType: "none",
  } as ServerConfig;
}

function scanSummary(
  overrides: Partial<ScanSummary> & Pick<ScanSummary, "id" | "serverId">,
): ScanSummary {
  return {
    serverName: "Server",
    tokenProfile: "generic_o200k",
    scannedAt: "2026-08-01T00:00:00.000Z",
    status: "success",
    totalTools: 1,
    totalTokens: 10,
    totalRawBytes: 10,
    averageTokensPerTool: 10,
    largestToolTokens: 10,
    totalResources: 0,
    totalResourceTemplates: 0,
    totalPrompts: 0,
    totalResourceTokens: 0,
    totalPromptTokens: 0,
    largestResourceTokens: 0,
    largestPromptTokens: 0,
    countingVersion: 2,
    ...overrides,
  } as ScanSummary;
}

function fleetIssue(
  id: string,
  title: string,
  lifecycle: "open" | "regressed" | "resolved",
  lastSeenAt = "2026-08-01T00:00:00.000Z",
): RatingIssue {
  return {
    id,
    targetKind: "server",
    targetId: "srv",
    targetName: "Files server",
    title,
    summary: "Summary",
    bucket: "tool_error",
    fixTarget: "mcp_server",
    draftFix: "Fix it",
    severity: "high",
    status: "open",
    timesSeen: 3,
    firstSeenAt: "2026-07-01T00:00:00.000Z",
    lastSeenAt,
    ratingVersion: 1,
    judgeProviderId: null,
    judgeModel: null,
    occurrences: [],
    fleet: {
      clusterKey: `cluster-${id}`,
      clusterKeyVersion: 1,
      lifecycle,
      occurrenceCount: 3,
      firstSeenAt: "2026-07-01T00:00:00.000Z",
      lastSeenAt,
      affected: { servers: ["srv"], skills: [], tests: [], models: [] },
      trend: [],
    },
  } as unknown as RatingIssue;
}

const RANGE: OverviewRange = {
  from: "2026-08-01T00:00:00.000Z",
  to: "2026-08-08T00:00:00.000Z",
  preset: "7d",
};

// ── Window + bucket vocabulary ───────────────────────────────────────────────────────────────────

describe("resolveOverviewBucket", () => {
  test("24h → hour, 7d/30d → day", () => {
    expect(resolveOverviewBucket({ ...RANGE, preset: "24h" })).toBe("hour");
    expect(resolveOverviewBucket(RANGE)).toBe("day");
    expect(
      resolveOverviewBucket({
        from: "2026-07-09T00:00:00.000Z",
        to: "2026-08-08T00:00:00.000Z",
        preset: "30d",
      }),
    ).toBe("day");
  });
});

describe("previousRange", () => {
  test("is the equal-length window immediately before", () => {
    expect(previousRange(RANGE)).toEqual({
      from: "2026-07-25T00:00:00.000Z",
      to: "2026-08-01T00:00:00.000Z",
    });
  });

  test("refuses an unusable range rather than inventing a baseline", () => {
    expect(previousRange({ from: "nope", to: RANGE.to, preset: "7d" })).toBeNull();
    expect(previousRange({ from: RANGE.to, to: RANGE.from, preset: "7d" })).toBeNull();
  });
});

describe("bucketFloorUtc", () => {
  test("floors in UTC; week starts Monday", () => {
    const instant = new Date("2026-08-06T13:47:12.345Z"); // a Thursday
    expect(bucketFloorUtc(instant, "hour").toISOString()).toBe("2026-08-06T13:00:00.000Z");
    expect(bucketFloorUtc(instant, "day").toISOString()).toBe("2026-08-06T00:00:00.000Z");
    expect(bucketFloorUtc(instant, "week").toISOString()).toBe("2026-08-03T00:00:00.000Z");
  });

  test("a Sunday walks BACK to the previous Monday", () => {
    expect(bucketFloorUtc(new Date("2026-08-09T05:00:00.000Z"), "week").toISOString()).toBe(
      "2026-08-03T00:00:00.000Z",
    );
  });
});

describe("buildBucketAxis", () => {
  test("enumerates every bucket the window covers", () => {
    const axis = buildBucketAxis(
      "2026-08-01T00:00:00.000Z",
      "2026-08-04T00:00:00.000Z",
      "day",
      new Date("2026-08-10T00:00:00.000Z"),
    );
    expect(axis).toEqual([
      "2026-08-01T00:00:00.000Z",
      "2026-08-02T00:00:00.000Z",
      "2026-08-03T00:00:00.000Z",
      "2026-08-04T00:00:00.000Z",
    ]);
  });

  test("clamps at `now` — a window running past the present grows no future buckets", () => {
    const axis = buildBucketAxis(
      "2026-08-01T00:00:00.000Z",
      "2026-08-31T23:59:59.999Z",
      "day",
      new Date("2026-08-03T09:00:00.000Z"),
    );
    expect(axis).toEqual([
      "2026-08-01T00:00:00.000Z",
      "2026-08-02T00:00:00.000Z",
      "2026-08-03T00:00:00.000Z",
    ]);
  });

  test("an unparseable window yields no axis rather than a fabricated one", () => {
    expect(buildBucketAxis("nope", "also-nope", "day", new Date())).toEqual([]);
  });
});

describe("densifyCounts", () => {
  test("fills the buckets the API omitted with a truthful zero, so cadence is not compressed", () => {
    const axis = [
      "2026-08-01T00:00:00.000Z",
      "2026-08-02T00:00:00.000Z",
      "2026-08-03T00:00:00.000Z",
    ];
    const points = [
      { bucketStart: "2026-08-01T00:00:00.000Z", value: 4 },
      { bucketStart: "2026-08-03T00:00:00.000Z", value: 7 },
    ];
    expect(densifyCounts(points, axis)).toEqual([
      { bucketStart: "2026-08-01T00:00:00.000Z", value: 4 },
      { bucketStart: "2026-08-02T00:00:00.000Z", value: 0 },
      { bucketStart: "2026-08-03T00:00:00.000Z", value: 7 },
    ]);
  });

  test("a gap is a real gap at its own x, never a point shifted left", () => {
    const axis = [
      "2026-08-01T00:00:00.000Z",
      "2026-08-02T00:00:00.000Z",
      "2026-08-03T00:00:00.000Z",
    ];
    const densified = densifyCounts([{ bucketStart: "2026-08-03T00:00:00.000Z", value: 7 }], axis);
    // Without densification the single point would land at index 0 and read as "4 days ago".
    expect(densified[0]).toEqual({ bucketStart: "2026-08-01T00:00:00.000Z", value: 0 });
    expect(densified[2]).toEqual({ bucketStart: "2026-08-03T00:00:00.000Z", value: 7 });
  });

  test("keeps a point whose bucket is off-axis rather than silently dropping data", () => {
    const densified = densifyCounts(
      [{ bucketStart: "2026-07-30T00:00:00.000Z", value: 2 }],
      ["2026-08-01T00:00:00.000Z"],
    );
    expect(densified).toEqual([
      { bucketStart: "2026-07-30T00:00:00.000Z", value: 2 },
      { bucketStart: "2026-08-01T00:00:00.000Z", value: 0 },
    ]);
  });
});

// ── Footprint ────────────────────────────────────────────────────────────────────────────────────

describe("buildFootprintData — the delta covers the SAME population as its value", () => {
  // The exact defect WP 0.3 shipped: Δ summed over only the servers that HAVE a previous scan, beside
  // a value totalling ALL servers, rendered a 100,000 → 590,000 fleet GROWTH as a favourable shrink.
  const FIXTURE = scanResponse([
    scanSeries("a", "Alpha", [
      measured("2026-01-01T00:00:00.000Z", 100_000, {
        deltaTotalTokens: null,
        deltaComparable: false,
      }),
      measured("2026-02-01T00:00:00.000Z", 90_000, {
        deltaTotalTokens: -10_000,
        deltaComparable: true,
      }),
    ]),
    scanSeries("b", "Bravo", [
      measured("2026-03-01T00:00:00.000Z", 500_000, {
        deltaTotalTokens: null,
        deltaComparable: false,
      }),
    ]),
  ]);

  test("A@Jan 100000 → A@Feb 90000 → B added @Mar 500000 ⇒ delta is +490000, NOT −10000", () => {
    const data = buildFootprintData(FIXTURE);
    expect(data).not.toBeNull();
    expect(data?.totalTokens).toBe(590_000);
    expect(data?.deltaTokens).toBe(490_000);
    expect(data?.firstTimeServers).toBe(1);
  });

  test("value − delta equals the fleet's previous measured total", () => {
    const data = buildFootprintData(FIXTURE);
    expect((data?.totalTokens ?? 0) - (data?.deltaTokens ?? 0)).toBe(100_000);
  });

  test("an incomparable server VOIDS the fleet delta — null, never 0", () => {
    // Alpha's latest measurement was counted under a different `counting_version`, so the API refuses
    // to subtract. Reporting Bravo's delta alone would put a partial Δ beside a whole-fleet value.
    const data = buildFootprintData(
      scanResponse([
        scanSeries("a", "Alpha", [
          measured("2026-01-01T00:00:00.000Z", 100_000, {
            deltaTotalTokens: null,
            deltaComparable: false,
          }),
          measured("2026-02-01T00:00:00.000Z", 90_000, {
            deltaTotalTokens: null,
            deltaComparable: false,
          }),
        ]),
        scanSeries("b", "Bravo", [
          measured("2026-01-01T00:00:00.000Z", 10_000, {
            deltaTotalTokens: null,
            deltaComparable: false,
          }),
          measured("2026-02-01T00:00:00.000Z", 12_000, {
            deltaTotalTokens: 2_000,
            deltaComparable: true,
          }),
        ]),
      ]),
    );
    expect(data?.totalTokens).toBe(102_000);
    expect(data?.deltaTokens).toBeNull();
  });

  test("no prior scan anywhere ⇒ delta is null (there is no previous fleet total to be a Δ OF)", () => {
    const data = buildFootprintData(
      scanResponse([
        scanSeries("a", "Alpha", [
          measured("2026-03-01T00:00:00.000Z", 100_000, {
            deltaTotalTokens: null,
            deltaComparable: false,
          }),
        ]),
      ]),
    );
    expect(data?.totalTokens).toBe(100_000);
    expect(data?.deltaTokens).toBeNull();
    expect(data?.firstTimeServers).toBe(1);
  });

  test("returns null (⇒ an EMPTY section) when nothing was successfully scanned", () => {
    expect(buildFootprintData(scanResponse([]))).toBeNull();
    expect(
      buildFootprintData(
        scanResponse([scanSeries("a", "Alpha", [unmeasured("2026-03-01T00:00:00.000Z")])]),
      ),
    ).toBeNull();
  });

  test("a bucket with no successful scan stays a REAL GAP — never zero-filled into the series", () => {
    const data = buildFootprintData(
      scanResponse([
        scanSeries("a", "Alpha", [
          measured("2026-01-01T00:00:00.000Z", 100_000, {
            deltaTotalTokens: null,
            deltaComparable: false,
          }),
          unmeasured("2026-02-01T00:00:00.000Z"),
          measured("2026-03-01T00:00:00.000Z", 110_000, {
            deltaTotalTokens: null,
            deltaComparable: false,
          }),
        ]),
      ]),
    );
    expect(data?.perServer[0]?.points).toEqual([
      { bucketStart: "2026-01-01T00:00:00.000Z", value: 100_000 },
      { bucketStart: "2026-03-01T00:00:00.000Z", value: 110_000 },
    ]);
    // The failed bucket broke comparability with the earlier measurement — refuse to subtract.
    expect(data?.deltaTokens).toBeNull();
  });

  test("composes the surface mix from the same latest measurements", () => {
    const data = buildFootprintData(
      scanResponse([
        scanSeries("a", "Alpha", [
          measured(
            "2026-03-01T00:00:00.000Z",
            600,
            { deltaTotalTokens: null, deltaComparable: false },
            { tool: 400, resource: 150, prompt: 50 },
          ),
        ]),
      ]),
    );
    expect(data?.mix).toEqual({ toolTokens: 400, resourceTokens: 150, promptTokens: 50 });
  });

  test("falls back to the server catalog, then the id, for a series with no name", () => {
    const data = buildFootprintData(
      scanResponse([
        scanSeries("a", null, [
          measured("2026-03-01T00:00:00.000Z", 1, {
            deltaTotalTokens: null,
            deltaComparable: false,
          }),
        ]),
        scanSeries("z", null, [
          measured("2026-03-01T00:00:00.000Z", 1, {
            deltaTotalTokens: null,
            deltaComparable: false,
          }),
        ]),
      ]),
      [server("a", "Alpha")],
    );
    expect(data?.perServer.map((entry) => entry.serverName)).toEqual(["Alpha", "z"]);
  });
});

describe("buildFootprintData — the footprint is a STANDING measurement, the trend is not", () => {
  // The browser-walk defect: 103 scans on record, newest 19 days old, a 7-day window ⇒ the WINDOWED
  // `GET /api/metrics/scans` returns `{"servers":[]}`, and the hero + startup-cost + surface-mix +
  // movers tiles all vanished — the fleet's single most important number absent, with 103 scans
  // sitting in the database. A footprint does not stop being true because nobody scanned this week.
  const STANDING = scanResponse([
    scanSeries("a", "Alpha", [
      measured("2026-07-01T00:00:00.000Z", 100_000, {
        deltaTotalTokens: null,
        deltaComparable: false,
      }),
      measured(
        "2026-07-20T00:00:00.000Z",
        120_000,
        { deltaTotalTokens: 20_000, deltaComparable: true },
        { tool: 90_000, resource: 20_000, prompt: 10_000 },
      ),
    ]),
  ]);
  const QUIET_WINDOW = scanResponse([]);

  test("a window with no scan in it keeps every current-state figure and only drops the trend", () => {
    const data = buildFootprintData(STANDING, [], QUIET_WINDOW);
    expect(data).not.toBeNull();
    expect(data?.totalTokens).toBe(120_000);
    expect(data?.deltaTokens).toBe(20_000);
    expect(data?.mix).toEqual({ toolTokens: 90_000, resourceTokens: 20_000, promptTokens: 10_000 });
    // The ONLY casualty of a quiet window: the plotted series.
    expect(data?.perServer).toEqual([]);
    expect(data?.noActivityInWindow).toBe(true);
    // …and the tile is told when the fleet WAS last measured, so it can say so.
    expect(data?.latestMeasuredAt).toBe("2026-07-20T00:00:00.000Z");
  });

  test("the plotted trend comes from the WINDOW, never from the standing history", () => {
    const windowed = scanResponse([
      scanSeries("a", "Alpha", [
        measured("2026-08-05T00:00:00.000Z", 120_000, {
          deltaTotalTokens: null,
          deltaComparable: false,
        }),
      ]),
    ]);
    const data = buildFootprintData(STANDING, [], windowed);
    expect(data?.perServer[0]?.points).toEqual([
      { bucketStart: "2026-08-05T00:00:00.000Z", value: 120_000 },
    ]);
    expect(data?.noActivityInWindow).toBe(false);
    // The figures still come from the standing response — a single in-window measurement must not
    // reset the Δ to "first measurement" (which is exactly what the windowed-only build did).
    expect(data?.deltaTokens).toBe(20_000);
    expect(data?.firstTimeServers).toBe(0);
  });

  test("`empty` (⇒ the tiles self-hide) means NO successful scan at all, ever — not a quiet window", () => {
    expect(buildFootprintData(scanResponse([]), [], QUIET_WINDOW)).toBeNull();
    expect(buildFootprintData(STANDING, [], QUIET_WINDOW)).not.toBeNull();
  });

  test("an omitted window means 'the window covers everything', never 'the window is empty'", () => {
    const data = buildFootprintData(STANDING);
    expect(data?.noActivityInWindow).toBe(false);
    expect(data?.perServer[0]?.points).toHaveLength(2);
  });

  test("`latestMeasuredAt` is the NEWEST measurement across the fleet, not the first server's", () => {
    const data = buildFootprintData(
      scanResponse([
        scanSeries("a", "Alpha", [
          measured("2026-07-01T00:00:00.000Z", 10, {
            deltaTotalTokens: null,
            deltaComparable: false,
          }),
        ]),
        scanSeries("b", "Bravo", [
          measured("2026-07-31T00:00:00.000Z", 20, {
            deltaTotalTokens: null,
            deltaComparable: false,
          }),
        ]),
      ]),
    );
    expect(data?.latestMeasuredAt).toBe("2026-07-31T00:00:00.000Z");
  });
});

describe("buildFootprintData — WP 2.3: the CHART plots every server, carried from its last success", () => {
  // Owner, 2026-08-20: "fleet footprint shows only scanned MCP servers which have been scanned
  // during the selected time and the result drops if a scan wasnt successfull. but we should show
  // all MCP servers there and get the number from the last successfull scan."
  //
  // Two independent defects sat behind that sentence, and each has its own test below: the lines
  // were built from the RANGE-SCOPED response (so a server nobody scanned this week vanished), and
  // they plotted measured points only (so a FAILED scan broke the line or dragged it down).
  //
  // Note what is deliberately NOT changed: `perServer` keeps its window-scoped, measured-only
  // meaning, because `MoversTile` subtracts its last two points to rank movement — carrying a value
  // forward there would turn every quiet server into a fabricated "moved by 0" and empty that tile.

  test("a server whose ONLY scan predates the window is still plotted (population is standing)", () => {
    const standing = scanResponse([
      scanSeries("old", "Long-quiet server", [
        measured("2026-06-01T00:00:00.000Z", 628, {
          deltaTotalTokens: null,
          deltaComparable: false,
        }),
      ]),
    ]);
    // The window contains nothing at all — the exact shape that used to erase the chart.
    const data = buildFootprintData(standing, [], scanResponse([]));
    expect(data?.noActivityInWindow).toBe(true);
    expect(data?.perServer).toEqual([]);
    expect(data?.standingSeries).toEqual([
      {
        serverId: "old",
        serverName: "Long-quiet server",
        points: [{ bucketStart: "2026-06-01T00:00:00.000Z", value: 628 }],
      },
    ]);
  });

  test("a FAILED scan holds the previous value — the line neither breaks nor drops", () => {
    // The real `mcp-assets` shape: success, success, then a failed scan. A second server keeps
    // scanning afterwards, so the shared axis runs past the failure and the carry is observable.
    const data = buildFootprintData(
      scanResponse([
        scanSeries("assets", "mcp-assets", [
          measured("2026-07-01T00:00:00.000Z", 600, {
            deltaTotalTokens: null,
            deltaComparable: false,
          }),
          measured("2026-07-02T00:00:00.000Z", 628, {
            deltaTotalTokens: 28,
            deltaComparable: true,
          }),
          unmeasured("2026-07-03T00:00:00.000Z"),
        ]),
        scanSeries("other", "Other", [
          measured("2026-07-04T00:00:00.000Z", 100, {
            deltaTotalTokens: null,
            deltaComparable: false,
          }),
        ]),
      ]),
    );
    const assets = data?.standingSeries.find((entry) => entry.serverId === "assets");
    expect(assets?.points).toEqual([
      { bucketStart: "2026-07-01T00:00:00.000Z", value: 600 },
      { bucketStart: "2026-07-02T00:00:00.000Z", value: 628 },
      // The failed bucket contributes no axis position of its own (nothing was measured there), and
      // the line runs on at its last GOOD figure — never 0, never a break, never a dive.
      { bucketStart: "2026-07-04T00:00:00.000Z", value: 628 },
    ]);
    for (const point of assets?.points ?? []) expect(point.value).toBeGreaterThan(0);
  });

  test("nothing is invented BEFORE a server's first successful scan (no back-fill with 0)", () => {
    const data = buildFootprintData(
      scanResponse([
        scanSeries("early", "Early", [
          measured("2026-07-01T00:00:00.000Z", 1_000, {
            deltaTotalTokens: null,
            deltaComparable: false,
          }),
          measured("2026-07-03T00:00:00.000Z", 1_200, {
            deltaTotalTokens: 200,
            deltaComparable: true,
          }),
        ]),
        scanSeries("late", "Late", [
          measured("2026-07-03T00:00:00.000Z", 50, {
            deltaTotalTokens: null,
            deltaComparable: false,
          }),
        ]),
      ]),
    );
    const late = data?.standingSeries.find((entry) => entry.serverId === "late");
    // The shared axis has two positions; `late` starts at its first measurement, not at the axis.
    expect(late?.points).toEqual([{ bucketStart: "2026-07-03T00:00:00.000Z", value: 50 }]);
    expect(late?.points.some((point) => point.bucketStart === "2026-07-01T00:00:00.000Z")).toBe(
      false,
    );
  });

  test("a server with NO successful scan is NAMED, never plotted (not even as a 0 line)", () => {
    const data = buildFootprintData(
      scanResponse([
        scanSeries("a", "Alpha", [
          measured("2026-07-01T00:00:00.000Z", 100, {
            deltaTotalTokens: null,
            deltaComparable: false,
          }),
        ]),
        // Scanned repeatedly, never successfully — it has no honest value to draw.
        scanSeries("failing", "All-failing", [unmeasured("2026-07-02T00:00:00.000Z")]),
      ]),
      [server("a", "Alpha"), server("failing", "All-failing"), server("never", "Never scanned")],
    );
    expect(data?.standingSeries.map((entry) => entry.serverId)).toEqual(["a"]);
    expect(data?.unmeasuredServers).toEqual([
      { serverId: "failing", serverName: "All-failing" },
      { serverId: "never", serverName: "Never scanned" },
    ]);
    // …and the fleet total is untouched by either of them — no zero was added to anything.
    expect(data?.totalTokens).toBe(100);
  });

  test("`unmeasuredServers` is empty when every configured server has been measured", () => {
    const data = buildFootprintData(
      scanResponse([
        scanSeries("a", "Alpha", [
          measured("2026-07-01T00:00:00.000Z", 100, {
            deltaTotalTokens: null,
            deltaComparable: false,
          }),
        ]),
      ]),
      [server("a", "Alpha")],
    );
    expect(data?.unmeasuredServers).toEqual([]);
  });

  test("with NO server catalog nothing is claimed about servers — the exclusion list stays empty", () => {
    // The catalog is the only thing that knows a server exists; without it, inventing an exclusion
    // would be as dishonest as inventing a measurement.
    const data = buildFootprintData(
      scanResponse([
        scanSeries("a", "Alpha", [
          measured("2026-07-01T00:00:00.000Z", 100, {
            deltaTotalTokens: null,
            deltaComparable: false,
          }),
        ]),
      ]),
    );
    expect(data?.unmeasuredServers).toEqual([]);
  });

  test("the window still decides `perServer` and `noActivityInWindow` — only the CHART went standing", () => {
    const standing = scanResponse([
      scanSeries("a", "Alpha", [
        measured("2026-07-01T00:00:00.000Z", 100_000, {
          deltaTotalTokens: null,
          deltaComparable: false,
        }),
        measured("2026-07-20T00:00:00.000Z", 120_000, {
          deltaTotalTokens: 20_000,
          deltaComparable: true,
        }),
      ]),
    ]);
    const windowed = scanResponse([
      scanSeries("a", "Alpha", [
        measured("2026-07-20T00:00:00.000Z", 120_000, {
          deltaTotalTokens: 20_000,
          deltaComparable: true,
        }),
      ]),
    ]);
    const data = buildFootprintData(standing, [], windowed);
    // The window's raw trace: one point (what `MoversTile`/`StartupCostTile` read).
    expect(data?.perServer[0]?.points).toEqual([
      { bucketStart: "2026-07-20T00:00:00.000Z", value: 120_000 },
    ]);
    // The chart's standing line: the whole history.
    expect(data?.standingSeries[0]?.points).toHaveLength(2);
    expect(data?.noActivityInWindow).toBe(false);
  });
});

describe("buildStandingSeries — last observation carried forward, over one shared axis", () => {
  const series = (
    serverId: string,
    points: { bucketStart: string; value: number }[],
  ): Parameters<typeof buildStandingSeries>[0][number] => ({
    serverId,
    serverName: serverId.toUpperCase(),
    points,
    // Only `serverId`/`serverName`/`points` are read; the rest of `ServerFootprint` is irrelevant
    // here and is filled with values that would be obviously wrong if it ever WERE read.
    latest: measured("1970-01-01T00:00:00.000Z", -1, {
      deltaTotalTokens: null,
      deltaComparable: false,
    }) as never,
    deltaTokens: null,
    firstMeasured: false,
  });

  test("every series is defined at every axis position at or after its own first measurement", () => {
    const out = buildStandingSeries([
      series("a", [
        { bucketStart: "2026-07-01T00:00:00.000Z", value: 10 },
        { bucketStart: "2026-07-05T00:00:00.000Z", value: 12 },
      ]),
      series("b", [{ bucketStart: "2026-07-03T00:00:00.000Z", value: 99 }]),
    ]);
    expect(out[0]?.points).toEqual([
      { bucketStart: "2026-07-01T00:00:00.000Z", value: 10 },
      { bucketStart: "2026-07-03T00:00:00.000Z", value: 10 }, // carried across b's scan
      { bucketStart: "2026-07-05T00:00:00.000Z", value: 12 }, // steps only on a real measurement
    ]);
    expect(out[1]?.points).toEqual([
      { bucketStart: "2026-07-03T00:00:00.000Z", value: 99 },
      { bucketStart: "2026-07-05T00:00:00.000Z", value: 99 }, // held, not dropped
    ]);
  });

  test("the axis is sorted chronologically whatever order the points arrive in", () => {
    const out = buildStandingSeries([
      series("a", [
        { bucketStart: "2026-07-05T00:00:00.000Z", value: 12 },
        { bucketStart: "2026-07-01T00:00:00.000Z", value: 10 },
      ]),
    ]);
    expect(out[0]?.points.map((point) => point.bucketStart)).toEqual([
      "2026-07-01T00:00:00.000Z",
      "2026-07-05T00:00:00.000Z",
    ]);
    expect(out[0]?.points.map((point) => point.value)).toEqual([10, 12]);
  });

  test("no series carries a value before its own first measurement, and none is ever 0", () => {
    const out = buildStandingSeries([
      series("early", [{ bucketStart: "2026-07-01T00:00:00.000Z", value: 5 }]),
      series("late", [{ bucketStart: "2026-07-09T00:00:00.000Z", value: 7 }]),
    ]);
    expect(out[1]?.points).toEqual([{ bucketStart: "2026-07-09T00:00:00.000Z", value: 7 }]);
    for (const entry of out)
      for (const point of entry.points) expect(point.value).toBeGreaterThan(0);
  });

  test("an empty population yields an empty chart, not a fabricated axis", () => {
    expect(buildStandingSeries([])).toEqual([]);
  });
});

describe("pickSeriesPerServer", () => {
  test("one server scanned under two token profiles is never counted twice", () => {
    const response = scanResponse([
      scanSeries(
        "a",
        "Alpha",
        [
          measured("2026-01-01T00:00:00.000Z", 100, {
            deltaTotalTokens: null,
            deltaComparable: false,
          }),
        ],
        "generic_cl100k",
      ),
      scanSeries(
        "a",
        "Alpha",
        [
          measured("2026-03-01T00:00:00.000Z", 900, {
            deltaTotalTokens: null,
            deltaComparable: false,
          }),
        ],
        "generic_o200k",
      ),
    ]);
    const picked = pickSeriesPerServer(response);
    expect(picked).toHaveLength(1);
    // The profile the operator most recently scanned with wins.
    expect(picked[0]?.tokenProfile).toBe("generic_o200k");
    expect(buildFootprintData(response)?.totalTokens).toBe(900);
  });

  test("a measured series always beats an unmeasured one, whichever order they arrive in", () => {
    const measuredSeries = scanSeries(
      "a",
      "Alpha",
      [
        measured("2026-01-01T00:00:00.000Z", 100, {
          deltaTotalTokens: null,
          deltaComparable: false,
        }),
      ],
      "zzz_profile",
    );
    const emptySeries = scanSeries(
      "a",
      "Alpha",
      [unmeasured("2026-01-01T00:00:00.000Z")],
      "aaa_profile",
    );
    expect(pickSeriesPerServer(scanResponse([emptySeries, measuredSeries]))[0]?.tokenProfile).toBe(
      "zzz_profile",
    );
    expect(pickSeriesPerServer(scanResponse([measuredSeries, emptySeries]))[0]?.tokenProfile).toBe(
      "zzz_profile",
    );
  });
});

// ── Run health ───────────────────────────────────────────────────────────────────────────────────

describe("windowPassRatePercent", () => {
  test("weights each bucket's rate by the runs behind it", () => {
    // 1 failure of 10, then 3 of 10 → 4 failures of 20 → 80% pass. A naive mean of rates says 80% too,
    // so make the sizes uneven: 1/10 and 3/5 → 4 of 15 → 73.33%, where a mean of rates would say 65%.
    const response = runResponse([
      errorRateSeries([
        { bucketStart: "2026-08-01T00:00:00.000Z", value: 0.1, n: 10 },
        { bucketStart: "2026-08-02T00:00:00.000Z", value: 0.6, n: 5 },
      ]),
    ]);
    expect(windowPassRatePercent(response)).toBeCloseTo((1 - 4 / 15) * 100, 6);
  });

  test("null — never 0 — when no run reached a terminal state", () => {
    expect(windowPassRatePercent(runResponse([errorRateSeries([])]))).toBeNull();
  });
});

describe("buildCostByBasis — bases are NEVER summed (D-OB14)", () => {
  test("one figure per capability class present", () => {
    const figures = buildCostByBasis(
      runResponse([costSeries("api_exact", 3), costSeries("subscription_reference", 11)]),
      null,
    );
    expect(figures).toEqual([
      { basis: "api_exact", currentUsd: 3, previousUsd: null },
      { basis: "subscription_reference", currentUsd: 11, previousUsd: null },
    ]);
    // The defect this guards: a single blended 14.
    expect(figures.some((figure) => figure.currentUsd === 14)).toBe(false);
    expect(figures.reduce((sum, figure) => sum + figure.currentUsd, 0)).toBe(14);
  });

  test("previousUsd is null when the previous window held no runs at all", () => {
    const figures = buildCostByBasis(
      runResponse([costSeries("api_exact", 3)]),
      runResponse([countSeries([])]),
    );
    expect(figures[0]?.previousUsd).toBeNull();
  });

  test("previousUsd is 0 when the previous window HAD runs but no spend on that basis", () => {
    const figures = buildCostByBasis(
      runResponse([costSeries("api_exact", 3)]),
      runResponse([countSeries([{ bucketStart: "2026-07-25T00:00:00.000Z", value: 4 }])]),
    );
    expect(figures[0]?.previousUsd).toBe(0);
  });

  test("a basis that spent nothing in either window is omitted rather than rendered as $0.00", () => {
    expect(
      buildCostByBasis(runResponse([costSeries("none", 0)]), runResponse([countSeries([])])),
    ).toEqual([]);
  });
});

describe("buildRunHealthData", () => {
  const current = runResponse([
    countSeries([
      { bucketStart: "2026-08-01T00:00:00.000Z", value: 6 },
      { bucketStart: "2026-08-03T00:00:00.000Z", value: 4 },
    ]),
    errorRateSeries([{ bucketStart: "2026-08-01T00:00:00.000Z", value: 0.2, n: 10 }]),
    costSeries("api_exact", 2.5),
  ]);
  const options = {
    range: {
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-08-03T00:00:00.000Z",
      preset: "7d" as const,
    },
    bucket: "day" as const,
    now: new Date("2026-08-09T00:00:00.000Z"),
  };

  test("counts runs, states pass rate, and densifies the sparkline over the window", () => {
    const data = buildRunHealthData(current, null, options);
    expect(data?.runCount).toBe(10);
    expect(data?.passRatePercent).toBeCloseTo(80, 6);
    expect(data?.runsOverTime).toEqual([
      { bucketStart: "2026-08-01T00:00:00.000Z", value: 6 },
      { bucketStart: "2026-08-02T00:00:00.000Z", value: 0 },
      { bucketStart: "2026-08-03T00:00:00.000Z", value: 4 },
    ]);
  });

  test("pass-rate Δ is in percentage POINTS against the previous window", () => {
    const previous = runResponse([
      countSeries([{ bucketStart: "2026-07-30T00:00:00.000Z", value: 10 }]),
      errorRateSeries([{ bucketStart: "2026-07-30T00:00:00.000Z", value: 0.5, n: 10 }]),
    ]);
    expect(buildRunHealthData(current, previous, options)?.passRateDeltaPoints).toBeCloseTo(30, 6);
  });

  test("no comparable previous window ⇒ Δ is null, not 0", () => {
    expect(buildRunHealthData(current, null, options)?.passRateDeltaPoints).toBeNull();
    expect(
      buildRunHealthData(current, runResponse([errorRateSeries([])]), options)?.passRateDeltaPoints,
    ).toBeNull();
  });

  test("returns null (⇒ an EMPTY section) when the window contains no runs", () => {
    expect(buildRunHealthData(runResponse([countSeries([])]), null, options)).toBeNull();
  });
});

// ── Attention ────────────────────────────────────────────────────────────────────────────────────

describe("buildAttentionData", () => {
  const servers = [server("s1", "Files"), server("s2", "Search"), server("s3", "Never scanned")];
  const scans = [
    scanSummary({
      id: "scan-1",
      serverId: "s1",
      status: "failed",
      errorMessage: "Connection refused",
      scannedAt: "2026-08-02T00:00:00.000Z",
    }),
    scanSummary({ id: "scan-0", serverId: "s1", scannedAt: "2026-08-01T00:00:00.000Z" }),
    scanSummary({ id: "scan-2", serverId: "s2", scannedAt: "2026-08-02T00:00:00.000Z" }),
  ];

  test("triages failed scans, then regressions, then open issues, then unscanned servers", () => {
    const data = buildAttentionData(servers, scans, [
      fleetIssue("i1", "Open thing", "open"),
      fleetIssue("i2", "Regressed thing", "regressed"),
      fleetIssue("i3", "Fixed thing", "resolved"),
    ]);
    expect(data?.items.map((item) => item.kind)).toEqual([
      "scan_failed",
      "issue_regressed",
      "issue_open",
      "server_unscanned",
    ]);
    expect(data?.total).toBe(4);
  });

  test("uses the LATEST scan per server, so a fixed server leaves the queue", () => {
    const fixed = [
      ...scans,
      scanSummary({ id: "scan-3", serverId: "s1", scannedAt: "2026-08-03T00:00:00.000Z" }),
    ];
    const data = buildAttentionData(servers, fixed, []);
    expect(data?.items.map((item) => item.kind)).toEqual(["server_unscanned"]);
  });

  test("every row carries a real href and, for a server row, its id for the inline Scan action", () => {
    const data = buildAttentionData(servers, scans, [fleetIssue("i1", "Open thing", "open")]);
    const byKind = new Map(data?.items.map((item) => [item.kind, item]));
    expect(byKind.get("scan_failed")?.href).toBe("/scans/scan-1");
    expect(byKind.get("scan_failed")?.detail).toBe("Connection refused");
    expect(byKind.get("scan_failed")?.serverId).toBe("s1");
    expect(byKind.get("server_unscanned")?.href).toBe("/servers/s3");
    expect(byKind.get("server_unscanned")?.detail).toBeNull();
    expect(byKind.get("issue_open")?.href).toBe("/dashboard?tab=issues&issue=i1");
    expect(byKind.get("issue_open")?.serverId).toBeNull();
  });

  test("ignores per-run rating issues — only CLUSTERED fleet issues reach the queue", () => {
    const { fleet: _fleet, ...perRun } = fleetIssue("i9", "Per-run", "open");
    expect(buildAttentionData([], [], [perRun as RatingIssue])).toBeNull();
  });

  test("caps the rendered rows but still reports the true total", () => {
    const many = Array.from({ length: ATTENTION_ITEM_LIMIT + 3 }, (_, index) =>
      fleetIssue(`i${index}`, `Issue ${index}`, "open"),
    );
    const data = buildAttentionData([], [], many);
    expect(data?.items).toHaveLength(ATTENTION_ITEM_LIMIT);
    expect(data?.total).toBe(ATTENTION_ITEM_LIMIT + 3);
  });

  test("returns null when nothing needs the operator", () => {
    expect(buildAttentionData([server("s2", "Search")], [scans[2] as ScanSummary], [])).toBeNull();
  });
});

// ── Advisor ──────────────────────────────────────────────────────────────────────────────────────

describe("buildAdvisorTeaser", () => {
  function report(
    recommendations: {
      id: string;
      severity: AdvisorSeverity;
      savings?: { value: number; unit: "tokens"; estimate: true; basis: string };
    }[],
  ): AdvisorReport {
    return {
      advisorVersion: 1,
      generatedAt: "2026-08-08T00:00:00.000Z",
      scope: { kind: "fleet" },
      insufficientData: [],
      recommendations: recommendations.map((entry) => ({
        id: entry.id,
        ruleId: "rule",
        title: `Title ${entry.id}`,
        detail: `Detail ${entry.id}`,
        severity: entry.severity,
        evidence: [{ kind: "scan", id: "scan-1", label: "Scan" }],
        assumptions: [],
        ...(entry.savings ? { savings: entry.savings } : {}),
      })),
    } as AdvisorReport;
  }

  test("surfaces the most severe recommendation, ties broken by the report's own order", () => {
    const teaser = buildAdvisorTeaser(
      report([
        { id: "a", severity: "medium" },
        { id: "b", severity: "high" },
        { id: "c", severity: "high" },
      ]),
    );
    expect(teaser?.title).toBe("Title b");
    expect(teaser?.severity).toBe("high");
    expect(teaser?.href).toBe("/advisor");
  });

  test("maps the advisor's `info` severity onto the contract's `low`", () => {
    expect(buildAdvisorTeaser(report([{ id: "a", severity: "info" }]))?.severity).toBe("low");
  });

  test("renders the savings WITH its unit, and null when the rule named none", () => {
    expect(
      buildAdvisorTeaser(
        report([
          {
            id: "a",
            severity: "high",
            savings: { value: 31_000, unit: "tokens", estimate: true, basis: "12 unused tools" },
          },
        ]),
      )?.savingsLabel,
    ).toContain("31,000 tokens");
    expect(buildAdvisorTeaser(report([{ id: "a", severity: "high" }]))?.savingsLabel).toBeNull();
  });

  test("returns null (⇒ an EMPTY section) when the advisor found nothing", () => {
    expect(buildAdvisorTeaser(report([]))).toBeNull();
  });
});
