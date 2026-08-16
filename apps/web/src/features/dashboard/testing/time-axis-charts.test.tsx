import type { ReactNode } from "react";
import { render as rtlRender } from "@testing-library/react";
import type { RunMetricsSeries, ScanMetricsPoint, ScanMetricsSeries } from "@mcp-token-footprint/shared";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@brand/ui";
import { defaultControls } from "./dashboard-url-state";
import { pivotToRows } from "./metrics-derive";

/** Every panel here now has at least one icon-only control (`IconButton`, D-TB5), which renders a
 *  Radix `Tooltip` that throws without an ancestor `TooltipProvider` — wrap the raw RTL `render`
 *  once here rather than at each call site. */
function render(ui: ReactNode) {
  return rtlRender(<TooltipProvider>{ui}</TooltipProvider>);
}

/**
 * REGRESSION — the Testing dashboard crashed the whole tab into the error boundary with
 * `RangeError: Invalid time value` (owner-reported, reproduced live). Root cause: the time-scale
 * charts (`@brand/charts` `LineChart`/`AreaChart`/`ComposedChart`) DEFAULT `xDataKey` to `"date"`
 * (verified in the package's `index.d.ts`), but the pivoted rows carry the timestamp under `x` (a
 * `Date`) with NO `"date"` field. Any panel that forgot `xDataKey="x"` therefore fed the chart an
 * `undefined` x → `new Date(undefined)` → Invalid Date → the axis' `.toISOString()` threw. This
 * suite locks the fix: every time-scale panel must set `xDataKey="x"` over rows whose `x` is a valid
 * `Date`.
 *
 * The other panel suites stub `@brand/charts` with INERT no-ops, so they never reproduce the crash.
 * This suite stubs it FAITHFULLY at the one contract that matters — a time-scale chart builds its x
 * from `row[xDataKey]` and calls `.toISOString()` on it — so a mis-wired panel throws here (test
 * FAILS pre-fix) and a correctly-wired one renders clean (test PASSES post-fix). The crash lives in
 * the row → x-Date construction the panel hands the chart, NOT in the (jsdom-incompatible) charting
 * internals, so this mock is a faithful, sufficient reproduction. `BarChart` is the categorical
 * chart (string x, no date construction) and never throws here.
 */

const captured = vi.hoisted(() => ({ xDataKeys: [] as (string | undefined)[] }));

vi.mock("@brand/charts", () => {
  // Faithful time-scale chart: xDataKey defaults to "date" (matching the real component), and each
  // row's x is run through the same `new Date(...).toISOString()` a time axis performs — an
  // undefined/invalid x throws "Invalid time value", exactly as the real chart does.
  const TimeScaleChart = ({
    data = [],
    xDataKey = "date",
    children,
  }: {
    data?: Record<string, unknown>[];
    xDataKey?: string;
    children?: ReactNode;
  }) => {
    captured.xDataKeys.push(xDataKey);
    for (const row of data) {
      new Date(row[xDataKey] as string | number | Date).toISOString();
    }
    return <div data-testid="time-scale-chart">{children}</div>;
  };
  return {
    LineChart: TimeScaleChart,
    AreaChart: TimeScaleChart,
    ComposedChart: TimeScaleChart,
    BarChart: ({ children }: { children?: ReactNode }) => <div data-testid="bar-chart">{children}</div>,
    Line: () => null,
    SeriesBar: () => null,
    Bar: () => null,
    BarXAxis: () => null,
    XAxis: () => null,
    YAxis: () => null,
    Grid: () => null,
    ChartTooltip: () => null,
  };
});

import { CustomChartCanvas } from "./CustomChartCanvas";
import { DurationPanel } from "./DurationPanel";
import { RunsErrorRatePanel } from "./RunsErrorRatePanel";
import { ScansStripPanel } from "./ScansStripPanel";
import { ScoreTrendPanel } from "./ScoreTrendPanel";

const CONTROLS = { ...defaultControls(new Date("2026-07-17T00:00:00.000Z")), from: "2026-07-01", to: "2026-07-10" };

// A fully-populated MULTI-bucket series — the exact crash path (a single populated bucket would
// still crash, but the reported failure was a real, multi-point window). `bucketStart` uses the
// real API shape: the ISO-8601 string `bucketStartUtc` emits.
const BUCKETS = [
  "2026-07-01T00:00:00.000Z",
  "2026-07-02T00:00:00.000Z",
  "2026-07-03T00:00:00.000Z",
];

function runSeries(over: Partial<RunMetricsSeries>): RunMetricsSeries {
  return { measure: "count", group: null, capabilityClass: null, points: [], ...over };
}

function scanPoint(bucketStart: string, totalTokens: number): ScanMetricsPoint {
  return {
    bucketStart,
    scanCount: 1,
    failureRate: 0,
    countingVersion: 2,
    totalTokens,
    toolTokens: totalTokens - 200,
    resourceTokens: 100,
    promptTokens: 100,
    totalTools: 5,
    totalResources: 1,
    totalResourceTemplates: 0,
    totalPrompts: 1,
    deltaTotalTokens: null,
    deltaComparable: false,
  };
}

const SCORE_SERIES: RunMetricsSeries[] = [
  runSeries({ measure: "meanScore", points: BUCKETS.map((b, i) => ({ bucketStart: b, value: 0.7 + i * 0.05, n: 4 })) }),
];

const DURATION_SERIES: RunMetricsSeries[] = [
  runSeries({ measure: "p50DurationMs", points: BUCKETS.map((b) => ({ bucketStart: b, value: 1200, n: 5 })) }),
  runSeries({ measure: "p95DurationMs", points: BUCKETS.map((b) => ({ bucketStart: b, value: 4200, n: 5 })) }),
];

const RUNS_SERIES: RunMetricsSeries[] = [
  runSeries({ measure: "count", group: "anthropic", points: BUCKETS.map((b) => ({ bucketStart: b, value: 8, n: 8 })) }),
  runSeries({ measure: "count", group: "openai", points: BUCKETS.map((b) => ({ bucketStart: b, value: 5, n: 5 })) }),
  runSeries({ measure: "errorRate", group: null, points: BUCKETS.map((b) => ({ bucketStart: b, value: 0.1, n: 13 })) }),
];

const SCAN_SERIES: ScanMetricsSeries[] = [
  {
    serverId: "srv-1",
    serverName: "Alpha",
    tokenProfile: "generic_o200k",
    points: BUCKETS.map((b, i) => scanPoint(b, 1000 + i * 120)),
  },
];

const CUSTOM_ROWS = pivotToRows([
  { key: "a", label: "Series A", points: BUCKETS.map((b, i) => ({ bucketStart: b, value: 10 + i })) },
]);
const CUSTOM_SERIES = [{ key: "a", label: "Series A" }];

describe("Testing dashboard — every time-axis chart survives a real multi-bucket window (no 'Invalid time value')", () => {
  beforeEach(() => {
    captured.xDataKeys.length = 0;
  });

  test("ScoreTrendPanel (LineChart) renders a multi-bucket score line without throwing", () => {
    expect(() =>
      render(<ScoreTrendPanel series={SCORE_SERIES} controls={CONTROLS} bucket="day" onDrill={vi.fn()} />),
    ).not.toThrow();
  });

  test("DurationPanel (LineChart) renders p50/p95 lines without throwing", () => {
    expect(() =>
      render(<DurationPanel series={DURATION_SERIES} controls={CONTROLS} bucket="day" onDrill={vi.fn()} />),
    ).not.toThrow();
  });

  test("ScansStripPanel (LineChart) renders the per-server footprint trend without throwing", () => {
    expect(() => render(<ScansStripPanel series={SCAN_SERIES} onOpenServer={vi.fn()} />)).not.toThrow();
  });

  test("RunsErrorRatePanel (ComposedChart, the reference) stays clean", () => {
    expect(() =>
      render(
        <RunsErrorRatePanel
          series={RUNS_SERIES}
          controls={CONTROLS}
          bucket="day"
          groupLabel={(g) => g}
          onDrill={vi.fn()}
        />,
      ),
    ).not.toThrow();
  });

  test("CustomChartCanvas line chart renders a Date-x line without throwing", () => {
    expect(() =>
      render(
        <CustomChartCanvas
          chartType="line"
          unit="count"
          loading={false}
          error={null}
          rows={CUSTOM_ROWS}
          series={CUSTOM_SERIES}
          hasData
        />,
      ),
    ).not.toThrow();
  });

  test("every time-scale chart is fed xDataKey=\"x\" over rows carrying a valid Date x", () => {
    render(<ScoreTrendPanel series={SCORE_SERIES} controls={CONTROLS} bucket="day" onDrill={vi.fn()} />);
    render(<DurationPanel series={DURATION_SERIES} controls={CONTROLS} bucket="day" onDrill={vi.fn()} />);
    render(<ScansStripPanel series={SCAN_SERIES} onOpenServer={vi.fn()} />);
    render(
      <RunsErrorRatePanel
        series={RUNS_SERIES}
        controls={CONTROLS}
        bucket="day"
        groupLabel={(g) => g}
        onDrill={vi.fn()}
      />,
    );
    render(
      <CustomChartCanvas
        chartType="line"
        unit="count"
        loading={false}
        error={null}
        rows={CUSTOM_ROWS}
        series={CUSTOM_SERIES}
        hasData
      />,
    );
    // Each time-scale chart mounted at least once, and NONE relied on the default "date" key.
    expect(captured.xDataKeys.length).toBeGreaterThan(0);
    expect(captured.xDataKeys.every((k) => k === "x")).toBe(true);
    // And every pivoted row the panels build carries a genuinely valid Date under `x`.
    for (const row of CUSTOM_ROWS) {
      expect(Number.isNaN((row.x as Date).getTime())).toBe(false);
    }
  });

  test("DEFENSIVE: a malformed/empty bucketStart degrades (that point is dropped) instead of crashing the tab", () => {
    const withBadBuckets: RunMetricsSeries[] = [
      runSeries({
        measure: "meanScore",
        points: [
          { bucketStart: "2026-07-01T00:00:00.000Z", value: 0.8, n: 3 },
          { bucketStart: "not-a-timestamp", value: 0.5, n: 1 },
          { bucketStart: "", value: 0.4, n: 1 },
        ],
      }),
    ];
    expect(() =>
      render(<ScoreTrendPanel series={withBadBuckets} controls={CONTROLS} bucket="day" onDrill={vi.fn()} />),
    ).not.toThrow();
    // The chart only ever saw a valid Date x (the two bad buckets never reached it).
    expect(captured.xDataKeys.every((k) => k === "x")).toBe(true);
  });
});
