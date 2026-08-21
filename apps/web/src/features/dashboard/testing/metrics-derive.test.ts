import type {
  DashboardChartScanMeasure,
  RunMetricsSeries,
  RunSummary,
  ScanMetricsSeries,
  Scenario,
  Test,
} from "@mcp-token-footprint/shared";
import { describe, expect, test } from "vitest";
import {
  buildCacheResult,
  buildCapabilityClassSeries,
  buildCostResult,
  buildDurationRows,
  buildExpensiveRunRows,
  buildFailingLeaderboard,
  buildGenericRunSeriesRows,
  buildGenericScanSeriesRows,
  buildGuardrailStopRows,
  buildRunsOverTimeRows,
  buildScansStripResult,
  buildScoreTrendRows,
  buildTestingKpis,
  buildTokensResult,
  CACHE_HIT_RATE_KEY,
  humanize,
  humanizeMeasure,
  pivotToRows,
  resolveGroupLabel,
  weightedRateByKey,
} from "./metrics-derive";

function series(over: Partial<RunMetricsSeries>): RunMetricsSeries {
  return { measure: "count", group: null, capabilityClass: null, points: [], ...over };
}

describe("pivotToRows", () => {
  test("pivots N named point-lists into wide rows sharing the bucket axis, ascending", () => {
    const rows = pivotToRows([
      { key: "a", label: "A", points: [{ bucketStart: "2026-07-02T00:00:00.000Z", value: 5 }] },
      {
        key: "b",
        label: "B",
        points: [
          { bucketStart: "2026-07-01T00:00:00.000Z", value: 1 },
          { bucketStart: "2026-07-02T00:00:00.000Z", value: 2 },
        ],
      },
    ]);
    expect(rows.map((r) => r.bucketStart)).toEqual([
      "2026-07-01T00:00:00.000Z",
      "2026-07-02T00:00:00.000Z",
    ]);
    // A bucket a series has no value for is OMITTED — never zero-filled.
    expect(rows[0]).not.toHaveProperty("a");
    expect(rows[0]?.b).toBe(1);
    expect(rows[1]?.a).toBe(5);
    expect(rows[1]?.b).toBe(2);
    expect(rows[0]?.x).toBeInstanceOf(Date);
  });

  test("every emitted row's x is a VALID Date (the time-scale chart contract — never an Invalid Date)", () => {
    const rows = pivotToRows([
      { key: "a", label: "A", points: [{ bucketStart: "2026-07-01T00:00:00.000Z", value: 1 }] },
    ]);
    expect(rows).toHaveLength(1);
    expect(Number.isNaN((rows[0]?.x as Date).getTime())).toBe(false);
  });

  test("DEFENSIVE GUARD: an unparseable/empty bucketStart is SKIPPED, never emitted as an Invalid Date x", () => {
    const rows = pivotToRows([
      {
        key: "a",
        label: "A",
        points: [
          { bucketStart: "2026-07-01T00:00:00.000Z", value: 1 },
          { bucketStart: "not-a-timestamp", value: 2 },
          { bucketStart: "", value: 3 },
        ],
      },
    ]);
    // Only the parseable bucket survives — a single bad point degrades, it never yields an Invalid Date.
    expect(rows.map((r) => r.bucketStart)).toEqual(["2026-07-01T00:00:00.000Z"]);
    expect(rows.every((r) => !Number.isNaN((r.x as Date).getTime()))).toBe(true);
  });
});

describe("weightedRateByKey", () => {
  test("reconstructs the numerator (value*n) and weight-averages across series sharing a key", () => {
    const out = weightedRateByKey(
      [
        { key: "a" as const, points: [{ bucketStart: "2026-07-01T00:00:00.000Z", value: 0.5, n: 10 }] }, // 5 errors / 10
        { key: "a" as const, points: [{ bucketStart: "2026-07-01T00:00:00.000Z", value: 0.2, n: 5 }] }, // 1 error / 5
      ],
      () => "2026-07-01T00:00:00.000Z",
    );
    // (5 + 1) / (10 + 5) = 0.4
    expect(out.get("2026-07-01T00:00:00.000Z")?.value).toBeCloseTo(0.4);
    expect(out.get("2026-07-01T00:00:00.000Z")?.n).toBe(15);
  });
});

describe("humanize", () => {
  test("snake_case → Title-first-word", () => {
    expect(humanize("max_turns")).toBe("Max turns");
    expect(humanize("user_stop")).toBe("User stop");
  });
});

describe("buildRunsOverTimeRows", () => {
  test("stacks count per group and computes an OVERALL weighted error-rate line", () => {
    const input: RunMetricsSeries[] = [
      series({
        measure: "count",
        group: "claude-sonnet-4",
        points: [
          { bucketStart: "2026-07-01T00:00:00.000Z", value: 8, n: 8 },
          { bucketStart: "2026-07-02T00:00:00.000Z", value: 4, n: 4 },
        ],
      }),
      series({
        measure: "count",
        group: "gpt-5",
        points: [{ bucketStart: "2026-07-01T00:00:00.000Z", value: 2, n: 2 }],
      }),
      series({
        measure: "errorRate",
        group: "claude-sonnet-4",
        points: [
          { bucketStart: "2026-07-01T00:00:00.000Z", value: 0.25, n: 8 }, // 2 errors
          { bucketStart: "2026-07-02T00:00:00.000Z", value: 0, n: 4 },
        ],
      }),
      series({
        measure: "errorRate",
        group: "gpt-5",
        points: [{ bucketStart: "2026-07-01T00:00:00.000Z", value: 1, n: 2 }], // 2 errors
      }),
    ];
    const result = buildRunsOverTimeRows(input);
    expect(result.groups).toEqual(["claude-sonnet-4", "gpt-5"]); // sorted by total count desc (10 vs 2)
    expect(result.hasData).toBe(true);
    const day1 = result.rows.find((r) => r.bucketStart === "2026-07-01T00:00:00.000Z");
    expect(day1?.["claude-sonnet-4"]).toBe(8);
    expect(day1?.["gpt-5"]).toBe(2);
    // Overall error rate on day 1: (2 + 2) errors / (8 + 2) runs = 0.4 → 40%.
    expect(day1?.errorRatePercent).toBeCloseTo(40);
    const day2 = result.rows.find((r) => r.bucketStart === "2026-07-02T00:00:00.000Z");
    expect(day2?.["gpt-5"]).toBeUndefined(); // no gpt-5 runs that day — omitted, not 0
    expect(day2?.errorRatePercent).toBeCloseTo(0);
  });

  test("no data → hasData false, empty rows/groups", () => {
    const result = buildRunsOverTimeRows([]);
    expect(result.hasData).toBe(false);
    expect(result.rows).toEqual([]);
    expect(result.groups).toEqual([]);
  });
});

describe("buildGuardrailStopRows", () => {
  test("pivots stopReasonCode groups into stacked rows with humanized labels", () => {
    const input: RunMetricsSeries[] = [
      series({
        measure: "count",
        group: "max_turns",
        points: [{ bucketStart: "2026-07-01T00:00:00.000Z", value: 3, n: 3 }],
      }),
      series({
        measure: "count",
        group: "stalled",
        points: [{ bucketStart: "2026-07-01T00:00:00.000Z", value: 1, n: 1 }],
      }),
    ];
    const result = buildGuardrailStopRows(input);
    expect(result.codes).toEqual(["max_turns", "stalled"]); // sorted by total desc
    expect(result.labels.max_turns).toBe("Max turns");
    expect(result.rows[0]?.max_turns).toBe(3);
    expect(result.rows[0]?.stalled).toBe(1);
    expect(result.hasData).toBe(true);
  });

  test("no guardrail stops in window → honest empty result", () => {
    expect(buildGuardrailStopRows([]).hasData).toBe(false);
  });
});

describe("buildDurationRows", () => {
  test("merges p50/p95 into rows and surfaces the fallback flag + latest p95 (for the KPI header)", () => {
    const input: RunMetricsSeries[] = [
      series({
        measure: "p50DurationMs",
        points: [
          { bucketStart: "2026-07-01T00:00:00.000Z", value: 1000, n: 5 },
          { bucketStart: "2026-07-02T00:00:00.000Z", value: 1200, n: 5 },
        ],
      }),
      series({
        measure: "p95DurationMs",
        durationFallback: true,
        points: [
          { bucketStart: "2026-07-01T00:00:00.000Z", value: 4000, n: 5 },
          { bucketStart: "2026-07-02T00:00:00.000Z", value: 4500, n: 5 },
        ],
      }),
    ];
    const result = buildDurationRows(input);
    expect(result.fallbackUsed).toBe(true);
    expect(result.latestP95).toBe(4500); // the LAST bucket, not a merged/averaged figure
    expect(result.rows[0]?.p50).toBe(1000);
    expect(result.rows[1]?.p95).toBe(4500);
    expect(result.hasData).toBe(true);
  });

  test("no duration data → latestP95 null, fallbackUsed false", () => {
    const result = buildDurationRows([]);
    expect(result.latestP95).toBeNull();
    expect(result.fallbackUsed).toBe(false);
    expect(result.hasData).toBe(false);
  });
});

// ── D-OB14 — the review focus: capability classes are NEVER blended ────────────────────────────

describe("buildCapabilityClassSeries / buildTokensResult — D-OB14 no-blend guarantee", () => {
  const input: RunMetricsSeries[] = [
    series({
      measure: "tokensIn",
      capabilityClass: "exact",
      points: [{ bucketStart: "2026-07-01T00:00:00.000Z", value: 1000, n: 4 }],
    }),
    series({
      measure: "tokensIn",
      capabilityClass: "estimated",
      points: [{ bucketStart: "2026-07-01T00:00:00.000Z", value: 300, n: 2 }],
    }),
    series({
      measure: "tokensOut",
      capabilityClass: "exact",
      points: [{ bucketStart: "2026-07-01T00:00:00.000Z", value: 500, n: 4 }],
    }),
  ];

  test("returns ONE series per class present, each with its OWN total — never a merged/summed entry", () => {
    const classes = buildCapabilityClassSeries(input, "tokensIn", {});
    expect(classes).toHaveLength(2);
    const exact = classes.find((c) => c.cls === "exact");
    const estimated = classes.find((c) => c.cls === "estimated");
    expect(exact?.total).toBe(1000);
    expect(estimated?.total).toBe(300);
    // The KEY assertion: no entry anywhere claims a combined/blended total (1300) for either class,
    // and there is no third "all"/"total"/"blended" class entry synthesized.
    const totals = classes.map((c) => c.total);
    expect(totals).not.toContain(1300);
    expect(classes.map((c) => c.cls).sort()).toEqual(["estimated", "exact"]);
    expect(classes.some((c) => c.cls === "total" || c.cls === "all" || c.cls === "blended")).toBe(false);
  });

  test("pivoted rows carry SEPARATE fields per class, never a combined field", () => {
    const result = buildTokensResult(input);
    expect(result.inRows).toHaveLength(1);
    const row = result.inRows[0] as Record<string, unknown>;
    expect(row.exact).toBe(1000);
    expect(row.estimated).toBe(300);
    // No summed/blended key anywhere in the row (the exhaustive set of numeric keys is exactly the
    // two known classes — nothing else was added).
    const numericKeys = Object.keys(row).filter((k) => typeof row[k] === "number");
    expect(numericKeys.sort()).toEqual(["estimated", "exact"]);
    expect(row.total).toBeUndefined();
    expect(row.blended).toBeUndefined();
    expect(row.all).toBeUndefined();

    expect(result.outRows[0]?.exact).toBe(500);
    expect(result.hasData).toBe(true);
  });

  test("a class with no data in a bucket is OMITTED from that bucket's row, never zero-filled", () => {
    const twoClassesDifferentBuckets: RunMetricsSeries[] = [
      series({ measure: "tokensIn", capabilityClass: "exact", points: [{ bucketStart: "2026-07-01T00:00:00.000Z", value: 100, n: 1 }] }),
      series({ measure: "tokensIn", capabilityClass: "estimated", points: [{ bucketStart: "2026-07-02T00:00:00.000Z", value: 50, n: 1 }] }),
    ];
    const result = buildTokensResult(twoClassesDifferentBuckets);
    const b1 = result.inRows.find((r) => r.bucketStart === "2026-07-01T00:00:00.000Z") as Record<string, unknown>;
    const b2 = result.inRows.find((r) => r.bucketStart === "2026-07-02T00:00:00.000Z") as Record<string, unknown>;
    expect(b1?.exact).toBe(100);
    expect(b1?.estimated).toBeUndefined(); // NOT 0
    expect(b2?.estimated).toBe(50);
    expect(b2?.exact).toBeUndefined(); // NOT 0
  });
});

describe("buildCacheResult — RM-33: read and write never merge, and absence is never zero", () => {
  const B1 = "2026-07-01T00:00:00.000Z";
  const B2 = "2026-07-02T00:00:00.000Z";

  test("read and write stay SEPARATE keyed series, each labelled with what it costs", () => {
    const input: RunMetricsSeries[] = [
      series({ measure: "cacheReadTokens", capabilityClass: "exact", points: [{ bucketStart: B1, value: 800, n: 4 }] }),
      series({ measure: "cacheWriteTokens", capabilityClass: "exact", points: [{ bucketStart: B1, value: 100, n: 4 }] }),
    ];
    const result = buildCacheResult(input);

    expect(result.entries.map((e) => e.key)).toEqual(["read:exact", "write:exact"]);
    expect(result.entries.map((e) => e.label)).toEqual([
      "Cache read (~0.1× rate)",
      "Cache write (1.25× rate)",
    ]);
    expect(result.entries.map((e) => e.total)).toEqual([800, 100]);
    // The forbidden figure: one "cached" number that adds a 0.1x discount to a 1.25x premium.
    expect(result.entries.some((e) => e.total === 900)).toBe(false);
    expect(result.rows[0]?.["read:exact"]).toBe(800);
    expect(result.rows[0]?.["write:exact"]).toBe(100);
    expect(result.hasTokens).toBe(true);
    expect(result.hasData).toBe(true);
  });

  test("the hit rate becomes a PERCENTAGE on its own key — never mixed onto a token key", () => {
    const input: RunMetricsSeries[] = [
      series({ measure: "cacheReadTokens", capabilityClass: "exact", points: [{ bucketStart: B1, value: 700, n: 2 }] }),
      series({ measure: "cacheHitRate", points: [{ bucketStart: B1, value: 0.7, n: 2 }] }),
    ];
    const result = buildCacheResult(input);
    expect(result.hasHitRate).toBe(true);
    expect(result.rows[0]?.[CACHE_HIT_RATE_KEY]).toBeCloseTo(70);
    expect(result.entries.some((e) => e.key === CACHE_HIT_RATE_KEY)).toBe(false);
  });

  test("a bucket the API omitted from the rate series leaves the key OFF the row — the line breaks, it does not dip to 0%", () => {
    const input: RunMetricsSeries[] = [
      series({
        measure: "cacheReadTokens",
        capabilityClass: "exact",
        points: [
          { bucketStart: B1, value: 500, n: 2 },
          { bucketStart: B2, value: 600, n: 2 },
        ],
      }),
      // Only B1 has a known hit rate.
      series({ measure: "cacheHitRate", points: [{ bucketStart: B1, value: 0.5, n: 2 }] }),
    ];
    const result = buildCacheResult(input);
    const b2 = result.rows.find((r) => r.bucketStart === B2) as Record<string, unknown>;
    expect(b2?.[CACHE_HIT_RATE_KEY]).toBeUndefined(); // NOT 0
    expect(b2?.["read:exact"]).toBe(600);
  });

  test("a bucket with no WRITE leaves that key off too — an unwritten cache is not a zero-token write", () => {
    const input: RunMetricsSeries[] = [
      series({
        measure: "cacheReadTokens",
        capabilityClass: "exact",
        points: [
          { bucketStart: B1, value: 500, n: 2 },
          { bucketStart: B2, value: 600, n: 2 },
        ],
      }),
      series({ measure: "cacheWriteTokens", capabilityClass: "exact", points: [{ bucketStart: B1, value: 40, n: 2 }] }),
    ];
    const result = buildCacheResult(input);
    const b2 = result.rows.find((r) => r.bucketStart === B2) as Record<string, unknown>;
    expect(b2?.["write:exact"]).toBeUndefined(); // NOT 0
  });

  test("two capability classes stay separate AND get their class named in the label (D-OB14)", () => {
    const input: RunMetricsSeries[] = [
      series({ measure: "cacheReadTokens", capabilityClass: "exact", points: [{ bucketStart: B1, value: 900, n: 3 }] }),
      series({ measure: "cacheReadTokens", capabilityClass: "none", points: [{ bucketStart: B1, value: 120, n: 1 }] }),
    ];
    const result = buildCacheResult(input);
    expect(result.entries.map((e) => e.key)).toEqual(["read:exact", "read:none"]);
    for (const entry of result.entries) expect(entry.label).toMatch(/·/);
    expect(result.entries[0]?.label).toContain("Cache read (~0.1× rate)");
  });

  test("no cache series at all ⇒ no data (the panel decides between 'nothing here' and 'not measured')", () => {
    const result = buildCacheResult([
      series({ measure: "tokensIn", capabilityClass: "exact", points: [{ bucketStart: B1, value: 10, n: 1 }] }),
    ]);
    expect(result.hasData).toBe(false);
    expect(result.hasTokens).toBe(false);
    expect(result.hasHitRate).toBe(false);
    expect(result.rows).toEqual([]);
  });
});

describe("buildCostResult — one labelled series per cost basis, never a blended total", () => {
  test("each costUsd class keeps its own row figure", () => {
    const input: RunMetricsSeries[] = [
      series({ measure: "costUsd", capabilityClass: "api_exact", points: [{ bucketStart: "2026-07-01T00:00:00.000Z", value: 1.5, n: 3 }] }),
      series({
        measure: "costUsd",
        capabilityClass: "subscription_reference",
        points: [{ bucketStart: "2026-07-01T00:00:00.000Z", value: 0, n: 2 }],
      }),
    ];
    const result = buildCostResult(input);
    expect(result.costClasses.map((c) => c.cls).sort()).toEqual(["api_exact", "subscription_reference"]);
    expect(result.costRows[0]?.api_exact).toBe(1.5);
    expect(result.costRows[0]?.subscription_reference).toBe(0);
    expect(result.hasData).toBe(true);
  });
});

describe("buildScoreTrendRows", () => {
  test("ungrouped meanScore series pivots to a single-field trend", () => {
    const input: RunMetricsSeries[] = [
      series({ measure: "meanScore", points: [{ bucketStart: "2026-07-01T00:00:00.000Z", value: 0.82, n: 4 }] }),
    ];
    const result = buildScoreTrendRows(input);
    expect(result.rows[0]?.meanScore).toBeCloseTo(0.82);
    expect(result.hasData).toBe(true);
  });

  test("no graded runs in window → honest empty result (never a fabricated 0)", () => {
    expect(buildScoreTrendRows([]).hasData).toBe(false);
  });
});

describe("buildFailingLeaderboard", () => {
  test("ranks groups by error count desc, omitting clean groups entirely", () => {
    const input: RunMetricsSeries[] = [
      series({ measure: "count", group: "test-a", points: [{ bucketStart: "2026-07-01T00:00:00.000Z", value: 10, n: 10 }] }),
      series({ measure: "count", group: "test-b", points: [{ bucketStart: "2026-07-01T00:00:00.000Z", value: 5, n: 5 }] }),
      series({ measure: "count", group: "test-clean", points: [{ bucketStart: "2026-07-01T00:00:00.000Z", value: 20, n: 20 }] }),
      series({ measure: "errorRate", group: "test-a", points: [{ bucketStart: "2026-07-01T00:00:00.000Z", value: 0.3, n: 10 }] }), // 3 errors
      series({ measure: "errorRate", group: "test-b", points: [{ bucketStart: "2026-07-01T00:00:00.000Z", value: 0.8, n: 5 }] }), // 4 errors
      series({ measure: "errorRate", group: "test-clean", points: [{ bucketStart: "2026-07-01T00:00:00.000Z", value: 0, n: 20 }] }),
    ];
    const rows = buildFailingLeaderboard(input, (g) => `Test ${g}`, 8);
    expect(rows.map((r) => r.group)).toEqual(["test-b", "test-a"]); // 4 errors before 3
    expect(rows.some((r) => r.group === "test-clean")).toBe(false);
    expect(rows[0]?.label).toBe("Test test-b");
    expect(rows[0]?.errorCount).toBe(4);
  });

  test("respects the limit", () => {
    const input: RunMetricsSeries[] = Array.from({ length: 12 }, (_, i) =>
      series({ measure: "count", group: `g${i}`, points: [{ bucketStart: "2026-07-01T00:00:00.000Z", value: 5, n: 5 }] }),
    ).concat(
      Array.from({ length: 12 }, (_, i) =>
        series({ measure: "errorRate", group: `g${i}`, points: [{ bucketStart: "2026-07-01T00:00:00.000Z", value: 0.2, n: 5 }] }),
      ),
    );
    expect(buildFailingLeaderboard(input, (g) => g, 5)).toHaveLength(5);
  });
});

describe("buildExpensiveRunRows", () => {
  test("joins runs against the tests/scenarios catalog for a readable label", () => {
    const runs: RunSummary[] = [
      {
        id: "run-1",
        testId: "test-1",
        scenarioId: "scn-1",
        mode: "automated",
        status: "completed",
        startedAt: "2026-07-01T00:00:00.000Z",
        turns: 3,
        toolCalls: 1,
        peakContextTokens: 100,
        tokensIn: 10,
        tokensOut: 10,
        costUsd: 4.5,
      },
    ];
    const testsById = new Map<string, Test>([
      [
        "test-1",
        {
          id: "test-1",
          name: "Regression suite",
          userPrompt: "…",
          addedProfiles: [],
          attachments: [],
          tags: [],
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    ]);
    const scenariosById = new Map<string, Scenario>();
    const rows = buildExpensiveRunRows(runs, testsById, scenariosById);
    expect(rows[0]?.label).toBe("Regression suite");
    expect(rows[0]?.scenarioName).toBe("scn-1"); // no catalog entry → falls back to the raw id
    expect(rows[0]?.costUsd).toBe(4.5);
  });
});

describe("buildScansStripResult", () => {
  test("keeps each server as its own series, omitting a bucket with no successful scan", () => {
    const input: ScanMetricsSeries[] = [
      {
        serverId: "srv-1",
        serverName: "Alpha",
        tokenProfile: "generic_o200k",
        points: [
          {
            bucketStart: "2026-07-01T00:00:00.000Z",
            scanCount: 1,
            failureRate: 0,
            countingVersion: 2,
            totalTokens: 1200,
            toolTokens: 1000,
            resourceTokens: 100,
            promptTokens: 100,
            totalTools: 5,
            totalResources: 1,
            totalResourceTemplates: 0,
            totalPrompts: 1,
            deltaTotalTokens: null,
            deltaComparable: false,
          },
          {
            bucketStart: "2026-07-02T00:00:00.000Z",
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
          },
        ],
      },
    ];
    const result = buildScansStripResult(input);
    expect(result.series).toHaveLength(1);
    expect(result.series[0]?.points).toEqual([{ bucketStart: "2026-07-01T00:00:00.000Z", value: 1200 }]); // b2 (failed-only) omitted
    expect(result.rows[0]?.["srv-1"]).toBe(1200);
    expect(result.hasData).toBe(true);
  });

  test("no scans in window → honest empty result", () => {
    expect(buildScansStripResult([]).hasData).toBe(false);
  });
});

describe("buildTestingKpis", () => {
  test("sums run count, weight-averages the error rate, and passes through cost/duration figures untouched", () => {
    const runsOverTime = buildRunsOverTimeRows([
      series({ measure: "count", group: "m1", points: [{ bucketStart: "2026-07-01T00:00:00.000Z", value: 8, n: 8 }] }),
      series({ measure: "errorRate", group: "m1", points: [{ bucketStart: "2026-07-01T00:00:00.000Z", value: 0.25, n: 8 }] }),
    ]);
    const cost = buildCostResult([
      series({ measure: "costUsd", capabilityClass: "api_exact", points: [{ bucketStart: "2026-07-01T00:00:00.000Z", value: 2.5, n: 8 }] }),
    ]);
    const duration = buildDurationRows([
      series({ measure: "p95DurationMs", points: [{ bucketStart: "2026-07-01T00:00:00.000Z", value: 3000, n: 8 }] }),
    ]);
    const kpis = buildTestingKpis(runsOverTime, cost, duration);
    expect(kpis.runCount).toBe(8);
    expect(kpis.errorRatePercent).toBeCloseTo(25);
    expect(kpis.costByBasis).toEqual([{ cls: "api_exact", label: "$ Exact (API-metered)", total: 2.5 }]);
    expect(kpis.latestP95DurationMs).toBe(3000);
  });
});

// ── Custom chart composer (WP 2.7) — generic pivots ─────────────────────────────────────────────

describe("humanizeMeasure", () => {
  test("splits camelCase and underscores into a readable label", () => {
    expect(humanizeMeasure("errorRate")).toBe("Error rate");
    expect(humanizeMeasure("p50DurationMs")).toBe("P50 duration ms");
    expect(humanizeMeasure("costUsd")).toBe("Cost usd");
  });
});

describe("resolveGroupLabel", () => {
  test("resolves via the matching catalog lookup for server/suite/test/environment", () => {
    const catalog = {
      serverName: (id: string) => (id === "srv-1" ? "Alpha server" : id),
      suiteName: (id: string) => (id === "suite-1" ? "Nightly suite" : id),
      testName: (id: string) => (id === "test-1" ? "List files" : id),
      environmentName: (id: string) => (id === "env-1" ? "Production" : id),
    };
    expect(resolveGroupLabel("server", "srv-1", catalog)).toBe("Alpha server");
    expect(resolveGroupLabel("suite", "suite-1", catalog)).toBe("Nightly suite");
    expect(resolveGroupLabel("test", "test-1", catalog)).toBe("List files");
    expect(resolveGroupLabel("environment", "env-1", catalog)).toBe("Production");
  });

  test("providerKind/stopReasonCode get a built-in label; model/provider/skill fall back to the raw id", () => {
    expect(resolveGroupLabel("providerKind", "openai", {})).toBe("OpenAI");
    expect(resolveGroupLabel("stopReasonCode", "max_turns", {})).toBe("Max turns");
    expect(resolveGroupLabel("model", "claude-sonnet-4", {})).toBe("claude-sonnet-4");
  });

  test("an unresolved id (missing catalog entry) degrades to the raw value", () => {
    expect(resolveGroupLabel("server", "unknown-srv", {})).toBe("unknown-srv");
  });

  test("an undefined groupBy returns the raw group value", () => {
    expect(resolveGroupLabel(undefined, "x", {})).toBe("x");
  });
});

describe("buildGenericRunSeriesRows", () => {
  test("a single-measure, ungrouped series omits the measure name from the label", () => {
    const result = buildGenericRunSeriesRows(
      [series({ measure: "errorRate", group: null, points: [{ bucketStart: "2026-07-01T00:00:00.000Z", value: 0.1, n: 10 }] })],
      1,
    );
    expect(result.series).toHaveLength(1);
    const key = result.series[0]?.key as string;
    expect(result.series[0]?.label).toBe("Error rate");
    expect(result.rows[0]?.[key]).toBe(0.1);
    expect(result.hasData).toBe(true);
  });

  test("a multi-measure chart includes the measure name in every series' label", () => {
    const result = buildGenericRunSeriesRows(
      [
        series({ measure: "errorRate", group: null, points: [{ bucketStart: "2026-07-01T00:00:00.000Z", value: 0.1, n: 10 }] }),
        series({ measure: "guardrailRate", group: null, points: [{ bucketStart: "2026-07-01T00:00:00.000Z", value: 0.05, n: 10 }] }),
      ],
      2,
    );
    expect(result.series.map((s) => s.label).sort()).toEqual(["Error rate", "Guardrail rate"]);
  });

  test("a grouped series includes the resolved group label; groupLabel is applied per series", () => {
    const result = buildGenericRunSeriesRows(
      [
        series({ measure: "count", group: "srv-1", points: [{ bucketStart: "2026-07-01T00:00:00.000Z", value: 4, n: 4 }] }),
        series({ measure: "count", group: "srv-2", points: [{ bucketStart: "2026-07-01T00:00:00.000Z", value: 6, n: 6 }] }),
      ],
      1,
      (group) => (group === "srv-1" ? "Alpha" : "Beta"),
    );
    expect(result.series.map((s) => s.label).sort()).toEqual(["Alpha", "Beta"]);
  });

  test("a capability-split measure keeps ONE series per class — never blended (D-OB14)", () => {
    const result = buildGenericRunSeriesRows(
      [
        series({
          measure: "tokensIn",
          group: null,
          capabilityClass: "exact",
          points: [{ bucketStart: "2026-07-01T00:00:00.000Z", value: 1000, n: 5 }],
        }),
        series({
          measure: "tokensIn",
          group: null,
          capabilityClass: "estimated",
          points: [{ bucketStart: "2026-07-01T00:00:00.000Z", value: 200, n: 2 }],
        }),
      ],
      1,
      undefined,
      (_measure, cls) => (cls === "exact" ? "Exact" : "Estimated"),
    );
    expect(result.series).toHaveLength(2);
    const exactKey = result.series.find((s) => s.label === "Exact")?.key as string;
    const estimatedKey = result.series.find((s) => s.label === "Estimated")?.key as string;
    expect(result.rows[0]?.[exactKey]).toBe(1000);
    expect(result.rows[0]?.[estimatedKey]).toBe(200);
  });

  test("no series → honest empty result", () => {
    expect(buildGenericRunSeriesRows([], 1).hasData).toBe(false);
  });
});

function scanPoint(over: Partial<ScanMetricsSeries["points"][number]>): ScanMetricsSeries["points"][number] {
  return {
    bucketStart: "2026-07-01T00:00:00.000Z",
    scanCount: 1,
    failureRate: 0,
    countingVersion: 2,
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
    ...over,
  };
}

describe("buildGenericScanSeriesRows", () => {
  test("a single server + single measure shows a clean server-name label (no redundant measure suffix)", () => {
    const input: ScanMetricsSeries[] = [
      { serverId: "srv-1", serverName: "Alpha", tokenProfile: "generic_o200k", points: [scanPoint({ totalTokens: 1200 })] },
    ];
    const result = buildGenericScanSeriesRows(input, ["totalTokens"]);
    expect(result.series).toEqual([{ key: "srv-1··totalTokens", label: "Alpha" }]);
    expect(result.rows[0]?.["srv-1··totalTokens"]).toBe(1200);
  });

  test("multiple servers OR multiple measures qualify the label; never aggregated across servers", () => {
    const input: ScanMetricsSeries[] = [
      { serverId: "srv-1", serverName: "Alpha", tokenProfile: "generic_o200k", points: [scanPoint({ totalTokens: 1200, totalTools: 5 })] },
      { serverId: "srv-2", serverName: "Beta", tokenProfile: "generic_o200k", points: [scanPoint({ totalTokens: 300, totalTools: 2 })] },
    ];
    const measures: DashboardChartScanMeasure[] = ["totalTokens", "totalTools"];
    const result = buildGenericScanSeriesRows(input, measures);
    expect(result.series).toHaveLength(4);
    expect(result.series.map((s) => s.label).sort()).toEqual([
      "Alpha · Total tokens",
      "Alpha · Total tools",
      "Beta · Total tokens",
      "Beta · Total tools",
    ]);
    // Each server's own figures — no summed/blended total anywhere.
    expect(result.rows[0]?.["srv-1··totalTokens"]).toBe(1200);
    expect(result.rows[0]?.["srv-2··totalTokens"]).toBe(300);
  });

  test("a bucket with no successful scan (null footprint) is OMITTED, never zero-filled", () => {
    const input: ScanMetricsSeries[] = [
      {
        serverId: "srv-1",
        serverName: "Alpha",
        tokenProfile: "generic_o200k",
        points: [scanPoint({ bucketStart: "2026-07-01T00:00:00.000Z", totalTokens: 1200 }), scanPoint({ bucketStart: "2026-07-02T00:00:00.000Z", totalTokens: null })],
      },
    ];
    const result = buildGenericScanSeriesRows(input, ["totalTokens"]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.bucketStart).toBe("2026-07-01T00:00:00.000Z");
  });

  test("no series → honest empty result", () => {
    expect(buildGenericScanSeriesRows([], ["totalTokens"]).hasData).toBe(false);
  });
});
