import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import type { RunMetricsMeasure, RunMetricsSeries } from "@mcp-token-footprint/shared";
import { describe, expect, test, vi } from "vitest";
import { defaultControls } from "./dashboard-url-state";
import { CACHE_HIT_RATE_KEY, type CacheSeriesEntry } from "./metrics-derive";

/**
 * `@elabs-ai/components-charts`'s barrel breaks under Vitest/jsdom (a deep `@visx/gradient` subpath
 * its Gantt chart pulls in fails to resolve) — every dashboard suite stubs it; see
 * `TokensPanel.test.tsx`'s note. This stub is deliberately a little richer than the usual no-op: it
 * makes the CHART's mere existence and each SERIES' dataKey observable, because the assertion this
 * file exists for is a NEGATIVE one — that in the unavailable state no chart and no series are
 * rendered at all.
 */
vi.mock("@elabs-ai/components-charts", () => ({
  ComposedChart: ({ data, children }: { data?: unknown[]; children: ReactNode }) => (
    <div data-testid="composed-chart" data-rows={JSON.stringify(data ?? [])}>
      {children}
    </div>
  ),
  SeriesBar: ({ dataKey }: { dataKey: string }) => <div data-testid={`series:${dataKey}`} />,
  Line: ({ dataKey }: { dataKey: string }) => <div data-testid={`line:${dataKey}`} />,
  Grid: () => null,
  XAxis: () => null,
  YAxis: () => null,
  ChartTooltip: () => null,
}));

import { CachePanel, cacheTooltipRows } from "./CachePanel";

function series(over: Partial<RunMetricsSeries>): RunMetricsSeries {
  return { measure: "count", group: null, capabilityClass: null, points: [], ...over };
}

const CONTROLS = defaultControls(new Date("2026-07-17T00:00:00.000Z"));
const BUCKET = "2026-07-05T00:00:00.000Z";

const ALL_CACHE_MEASURES: RunMetricsMeasure[] = ["cacheReadTokens", "cacheWriteTokens", "cacheHitRate"];

/** A healthy window: reads, writes and a real hit rate. */
const CACHE_SERIES: RunMetricsSeries[] = [
  series({ measure: "cacheReadTokens", capabilityClass: "exact", points: [{ bucketStart: BUCKET, value: 355_791, n: 8 }] }),
  series({ measure: "cacheWriteTokens", capabilityClass: "exact", points: [{ bucketStart: BUCKET, value: 14_041, n: 8 }] }),
  series({ measure: "cacheHitRate", points: [{ bucketStart: BUCKET, value: 0.962, n: 8 }] }),
];

function renderPanel(over: { series?: RunMetricsSeries[]; unavailableMeasures?: RunMetricsMeasure[] } = {}) {
  return render(
    <CachePanel
      series={over.series ?? CACHE_SERIES}
      unavailableMeasures={over.unavailableMeasures ?? []}
      controls={CONTROLS}
      bucket="day"
      onDrill={vi.fn()}
    />,
  );
}

describe("CachePanel — the UNAVAILABLE state (WP 3.3 acceptance #3, the load-bearing requirement)", () => {
  test("a window whose runs have no known split renders 'not measured' — NOT a 0% line and NOT a bare empty chart", () => {
    const { container } = renderPanel({ series: [], unavailableMeasures: ALL_CACHE_MEASURES });

    // (a) it says, in words, that the split was not measured …
    expect(screen.getByText("Cache split not measured")).toBeInTheDocument();
    expect(screen.getByText(/predate cache measurement/i)).toBeInTheDocument();

    // (b) … it is NOT the generic "there is simply no data" state (which reads as "no runs") …
    expect(screen.queryByText("No cache data")).not.toBeInTheDocument();

    // (c) … NO chart is mounted at all, so there is no empty frame to misread …
    expect(screen.queryByTestId("composed-chart")).not.toBeInTheDocument();
    expect(screen.queryByTestId(`line:${CACHE_HIT_RATE_KEY}`)).not.toBeInTheDocument();

    // (d) … and no zero/zero-percent figure is rendered ANYWHERE in the panel. A 0% cache-hit line
    // is indistinguishable from a caching regression — the single most misleading thing this panel
    // could do.
    expect(container.textContent ?? "").not.toMatch(/\b0(\.0)?\s*%/);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  test("even if the API contradicted itself and sent ZERO-valued series alongside the unavailable flag, no 0% line is drawn", () => {
    // The API does not do this (it emits no series for an unavailable measure) — which is exactly
    // why the panel must not depend on that politeness. `unavailableMeasures` is the authority.
    const zeroed: RunMetricsSeries[] = [
      series({ measure: "cacheReadTokens", capabilityClass: "exact", points: [{ bucketStart: BUCKET, value: 0, n: 8 }] }),
      series({ measure: "cacheWriteTokens", capabilityClass: "exact", points: [{ bucketStart: BUCKET, value: 0, n: 8 }] }),
      series({ measure: "cacheHitRate", points: [{ bucketStart: BUCKET, value: 0, n: 8 }] }),
    ];
    const { container } = renderPanel({ series: zeroed, unavailableMeasures: ALL_CACHE_MEASURES });

    expect(screen.getByText("Cache split not measured")).toBeInTheDocument();
    expect(screen.queryByTestId("composed-chart")).not.toBeInTheDocument();
    expect(screen.queryByTestId(`line:${CACHE_HIT_RATE_KEY}`)).not.toBeInTheDocument();
    expect(container.textContent ?? "").not.toMatch(/\b0(\.0)?\s*%/);
  });

  test("one unavailable measure is enough — they share one backing pair of columns, so a partial answer is not a real one", () => {
    renderPanel({ series: CACHE_SERIES, unavailableMeasures: ["cacheHitRate"] });
    expect(screen.getByText("Cache split not measured")).toBeInTheDocument();
    expect(screen.queryByTestId("composed-chart")).not.toBeInTheDocument();
  });

  test("CONTROL — the SAME series with nothing unavailable really does render the chart (so the assertions above can fail)", () => {
    renderPanel({ series: CACHE_SERIES, unavailableMeasures: [] });
    expect(screen.getByTestId("composed-chart")).toBeInTheDocument();
    expect(screen.getByTestId(`line:${CACHE_HIT_RATE_KEY}`)).toBeInTheDocument();
    expect(screen.queryByText("Cache split not measured")).not.toBeInTheDocument();
  });
});

describe("CachePanel — read vs write are distinct and priced (acceptance #2)", () => {
  test("both halves render as their OWN series, each labelled with its rate multiplier", () => {
    renderPanel();
    expect(screen.getByTestId("series:read:exact")).toBeInTheDocument();
    expect(screen.getByTestId("series:write:exact")).toBeInTheDocument();
    expect(screen.getByText("Cache read (~0.1× rate)")).toBeInTheDocument();
    expect(screen.getByText("Cache write (1.25× rate)")).toBeInTheDocument();
    // Each half keeps its OWN total — never a combined "cached" figure (D-CT2).
    expect(screen.getByText("355,791")).toBeInTheDocument();
    expect(screen.getByText("14,041")).toBeInTheDocument();
    expect(screen.queryByText("369,832")).not.toBeInTheDocument(); // read + write, the forbidden sum
  });

  test("the legend swatches for read and write are DIFFERENT ramp tokens (visually distinguishable)", () => {
    const { container } = renderPanel();
    const swatches = [...container.querySelectorAll("li > span[aria-hidden]")].map(
      (el) => (el as HTMLElement).style.backgroundColor,
    );
    expect(swatches.length).toBeGreaterThanOrEqual(2);
    expect(swatches[0]).not.toEqual(swatches[1]);
    // Every swatch is a --chart-* ramp reference, never a raw colour.
    for (const swatch of swatches) expect(swatch).toMatch(/^var\(--chart-\d+\)$/);
  });

  test("the hit rate is presented as a RATE — its own right-hand axis, named as such, not a token count", () => {
    renderPanel();
    expect(screen.getByTestId(`line:${CACHE_HIT_RATE_KEY}`)).toBeInTheDocument();
    expect(screen.getByText("Cache hit rate (right axis, %)")).toBeInTheDocument();
  });

  test("a genuinely empty window (no runs at all → no series, nothing unavailable) shows the ordinary empty state", () => {
    renderPanel({ series: [], unavailableMeasures: [] });
    expect(screen.getByText("No cache data")).toBeInTheDocument();
    expect(screen.queryByText("Cache split not measured")).not.toBeInTheDocument();
  });
});

describe("cacheTooltipRows — an absent value is 'n/a', never a fabricated 0 (D-CT6)", () => {
  const ENTRIES: CacheSeriesEntry[] = [
    { key: "read:exact", kind: "read", cls: "exact", label: "Cache read (~0.1× rate)", total: 100 },
    { key: "write:exact", kind: "write", cls: "exact", label: "Cache write (1.25× rate)", total: 20 },
  ];

  test("a bucket the hit-rate series omitted reads 'n/a' — a 0.0% row would read as a caching regression", () => {
    const rows = cacheTooltipRows({ "read:exact": 100 }, ENTRIES, true);
    expect(rows.find((r) => r.label === "Cache hit rate")?.value).toBe("n/a");
    expect(rows.find((r) => r.label === "Cache write (1.25× rate)")?.value).toBe("n/a");
    expect(rows.find((r) => r.label === "Cache read (~0.1× rate)")?.value).toBe("100");
  });

  test("a REPORTED zero is still shown as zero — absence and a measured zero are different statements", () => {
    const rows = cacheTooltipRows({ "read:exact": 0, "write:exact": 0, [CACHE_HIT_RATE_KEY]: 0 }, ENTRIES, true);
    expect(rows.find((r) => r.label === "Cache read (~0.1× rate)")?.value).toBe("0");
    expect(rows.find((r) => r.label === "Cache hit rate")?.value).toBe("0.0%");
  });

  test("every tooltip row's colour is a --chart-* ramp reference", () => {
    const rows = cacheTooltipRows({ "read:exact": 1, "write:exact": 2, [CACHE_HIT_RATE_KEY]: 50 }, ENTRIES, true);
    for (const row of rows) expect(row.color).toMatch(/^var\(--chart-\d+\)$/);
  });
});
