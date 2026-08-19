import type { ReactNode } from "react";
import { render } from "@testing-library/react";
import type { HubUsageRow } from "@mcp-token-footprint/shared";
import { describe, expect, test, vi } from "vitest";

/**
 * The repo-wide chart-prop stub: jsdom can't render `@visx` (the real `@elabs-ai/components-charts` internals), so
 * every other chart test in this app mocks the package as an inert no-op — which means a mis-wired
 * chart (wrong/missing `xDataKey`, a string x fed to a time-scale chart) still passes a green gate
 * and only crashes the REAL running app (see `.claude/CLAUDE.md`'s chart rules doc + the memory note
 * "Chart tests mock @elabs-ai/components-charts as no-op"). This suite is the FAITHFUL stub instead
 * (`dashboard/testing/time-axis-charts.test.tsx`'s own recipe, reused here): `ComposedChart` defaults
 * `xDataKey` to `"date"` (matching the real component's `.d.ts`) and runs each row's x through the
 * SAME `new Date(...).toISOString()` a real time axis performs — an undefined/invalid x throws
 * "Invalid time value" exactly as production does. `BarChart` is the categorical chart (string x, no
 * date construction) and is captured separately to assert it never gets fed a Date-typed x-key.
 */

const captured = vi.hoisted(() => ({
  composedXDataKeys: [] as (string | undefined)[],
  composedStacked: [] as (boolean | undefined)[],
  seriesBarCount: 0,
  seriesBarFills: [] as (string | undefined)[],
  barChartXDataKeys: [] as (string | undefined)[],
}));

vi.mock("@elabs-ai/components-charts", () => {
  const ComposedChart = ({
    data = [],
    xDataKey = "date",
    stacked,
    children,
  }: {
    data?: Record<string, unknown>[];
    xDataKey?: string;
    stacked?: boolean;
    children?: ReactNode;
  }) => {
    captured.composedXDataKeys.push(xDataKey);
    captured.composedStacked.push(stacked);
    for (const row of data) {
      // The real time axis's own construction — throws "Invalid time value" on a bad/missing x.
      new Date(row[xDataKey] as string | number | Date).toISOString();
    }
    return <div data-testid="composed-chart">{children}</div>;
  };
  const BarChart = ({
    xDataKey,
    children,
  }: {
    xDataKey?: string;
    children?: ReactNode;
  }) => {
    captured.barChartXDataKeys.push(xDataKey);
    return <div data-testid="bar-chart">{children}</div>;
  };
  return {
    ComposedChart,
    BarChart,
    SeriesBar: ({ fill }: { fill?: string }) => {
      captured.seriesBarCount += 1;
      captured.seriesBarFills.push(fill);
      return null;
    },
    Bar: () => null,
    BarXAxis: () => null,
    XAxis: () => null,
    YAxis: () => null,
    Grid: () => null,
    ChartTooltip: () => null,
  };
});

import { screen } from "@testing-library/react";
import { CHART_RAMP_LENGTH, chartSeriesColor } from "../../../../lib/chart-colors";
import { UsageCharts } from "./UsageCharts";
import { buildStackedTimeRows } from "./usage-derive";

function row(over: Partial<HubUsageRow> = {}): HubUsageRow {
  return {
    groupBy: "agent",
    key: "a",
    label: "Alpha",
    sessions: 1,
    costUsd: 10,
    tokensIn: 0,
    tokensOut: 0,
    ...over,
  };
}

describe("UsageCharts — chart-prop stub (WP2.6): ComposedChart gets a real Date x + xDataKey='x' + stacked", () => {
  test("the stacked-over-time chart is fed xDataKey='x' over rows carrying a valid Date, and stacked=true", () => {
    captured.composedXDataKeys.length = 0;
    captured.composedStacked.length = 0;
    captured.seriesBarCount = 0;

    const stackedRows = buildStackedTimeRows([
      {
        row: row({ key: "a", label: "Alpha" }),
        strip: [
          {
            key: "2026-06-01",
            label: "2026-06-01",
            sessions: 1,
            costUsd: 3,
            tokensIn: 0,
            tokensOut: 0,
          },
        ],
      },
      {
        row: row({ key: "b", label: "Beta" }),
        strip: [
          {
            key: "2026-06-01",
            label: "2026-06-01",
            sessions: 1,
            costUsd: 1,
            tokensIn: 0,
            tokensOut: 0,
          },
        ],
      },
    ]);

    expect(() =>
      render(
        <UsageCharts
          rows={[
            row({ key: "a", label: "Alpha", costUsd: 10 }),
            row({ key: "b", label: "Beta", costUsd: 3 }),
          ]}
          groupByLabel="agent"
          stackedRows={stackedRows}
          stackedSeries={[
            { key: "a", label: "Alpha" },
            { key: "b", label: "Beta" },
          ]}
          stackedLoading={false}
        />,
      ),
    ).not.toThrow();

    // Never the chart's own default ("date") — the row shape carries `x`, not `date`.
    expect(captured.composedXDataKeys.length).toBeGreaterThan(0);
    expect(captured.composedXDataKeys.every((k) => k === "x")).toBe(true);
    // Stacked-by-group-by, not grouped side-by-side.
    expect(captured.composedStacked.every((s) => s === true)).toBe(true);
    // One SeriesBar per stacked series (2 entities here).
    expect(captured.seriesBarCount).toBe(2);
    // And every row buildStackedTimeRows produced carries a genuinely valid Date under `x`.
    for (const r of stackedRows) {
      expect(r.x).toBeInstanceOf(Date);
      expect(Number.isNaN((r.x as Date).getTime())).toBe(false);
    }
  });

  test("the top-by-spend chart is CATEGORICAL: BarChart gets xDataKey='label' (a string), never a Date key", () => {
    captured.barChartXDataKeys.length = 0;
    render(
      <UsageCharts
        rows={[
          row({ key: "a", label: "Alpha", costUsd: 10 }),
          row({ key: "b", label: "Beta", costUsd: 3 }),
        ]}
        groupByLabel="agent"
        stackedRows={[]}
        stackedSeries={[]}
        stackedLoading={false}
      />,
    );
    expect(captured.barChartXDataKeys).toEqual(["label"]);
  });

  test("empty stacked series renders the empty state, not a crash (no fabricated chart)", () => {
    expect(() =>
      render(
        <UsageCharts
          rows={[]}
          groupByLabel="agent"
          stackedRows={[]}
          stackedSeries={[]}
          stackedLoading={false}
        />,
      ),
    ).not.toThrow();
  });

  test("loading state renders without mounting the chart", () => {
    captured.composedXDataKeys.length = 0;
    render(
      <UsageCharts
        rows={[row()]}
        groupByLabel="agent"
        stackedRows={[]}
        stackedSeries={[{ key: "a", label: "Alpha" }]}
        stackedLoading
      />,
    );
    expect(captured.composedXDataKeys.length).toBe(0);
  });

  // T10: the "Spend over time" subtitle used to render `Top ${stackedSeries.length} …` even when the
  // stacked chart had no series — announcing "Top 0 agent groups by spend" beside a populated KPI/
  // table (the per-entity `/summary` fetch can come back empty independent of the rollup rows). The
  // subtitle must never state a zero count; it should simply say nothing until there IS a count.
  test("never renders 'Top 0 …' — the numeric subtitle is guarded when stackedSeries is empty but rows are populated", () => {
    render(
      <UsageCharts
        rows={[
          row({ key: "a", label: "Alpha", costUsd: 10 }),
          row({ key: "b", label: "Beta", costUsd: 3 }),
        ]}
        groupByLabel="agent"
        stackedRows={[]}
        stackedSeries={[]}
        stackedLoading={false}
      />,
    );
    expect(screen.queryByText(/Top 0/)).not.toBeInTheDocument();
    // The empty state below still explains itself — no bare, uncaptioned gap.
    expect(screen.getByText("Nothing in this window yet")).toBeInTheDocument();
  });

  test("states the real series count and pluralizes correctly when the stacked chart has data", () => {
    const stackedRows = buildStackedTimeRows([
      {
        row: row({ key: "a", label: "Alpha" }),
        strip: [
          { key: "2026-06-01", label: "2026-06-01", sessions: 1, costUsd: 3, tokensIn: 0, tokensOut: 0 },
        ],
      },
    ]);
    render(
      <UsageCharts
        rows={[row({ key: "a", label: "Alpha", costUsd: 10 })]}
        groupByLabel="agent"
        stackedRows={stackedRows}
        stackedSeries={[{ key: "a", label: "Alpha" }]}
        stackedLoading={false}
      />,
    );
    // Singular "group" for exactly one series — not "groups".
    expect(screen.getByText("Top 1 agent group by spend, stacked.")).toBeInTheDocument();
  });
});

/**
 * dashboard-bento WP 0.1 · finding F5 — series colour comes from the shared 12-token ramp.
 *
 * This file used to keep a private five-entry `CHART_COLORS` array behind
 * `CHART_COLORS[index % CHART_COLORS.length]`. It never actually repeated a colour in production
 * because `UsageTab`'s `MAX_STACKED_SERIES` caps the series list at 5 — but the cap and the ramp
 * length were two unrelated 5s in two different files, so raising the cap to show more entities
 * would have silently painted entity 6 in entity 1's colour. This asserts the colours now come from
 * the shared ramp for any series count, so the cap is free to move.
 */
describe("UsageCharts — series colour rides the shared 12-token ramp (WP 0.1 / F5)", () => {
  function renderWithSeriesCount(count: number) {
    const entries = Array.from({ length: count }, (_, i) => ({
      row: row({ key: `k${i}`, label: `Entity ${i}` }),
      strip: [
        { key: "2026-06-01", label: "2026-06-01", sessions: 1, costUsd: 1, tokensIn: 0, tokensOut: 0 },
      ],
    }));
    return render(
      <UsageCharts
        rows={entries.map((e) => e.row)}
        groupByLabel="agent"
        stackedRows={buildStackedTimeRows(entries)}
        stackedSeries={entries.map((e) => ({ key: e.row.key as string, label: e.row.label }))}
        stackedLoading={false}
      />,
    );
  }

  test("each stacked series gets its own ramp token, past the old five-colour cycle", () => {
    captured.seriesBarFills.length = 0;
    renderWithSeriesCount(8);

    expect(captured.seriesBarFills).toEqual(Array.from({ length: 8 }, (_, i) => chartSeriesColor(i)));
    // The defect this WP fixes: the 6th series is no longer the 1st series' colour.
    expect(captured.seriesBarFills[5]).toBe("var(--chart-6)");
    expect(new Set(captured.seriesBarFills).size).toBe(8);
  });

  test("colours stay distinct all the way to the ramp length, and only then wrap", () => {
    captured.seriesBarFills.length = 0;
    renderWithSeriesCount(CHART_RAMP_LENGTH + 1);

    const fills = captured.seriesBarFills;
    expect(new Set(fills.slice(0, CHART_RAMP_LENGTH)).size).toBe(CHART_RAMP_LENGTH);
    expect(fills[CHART_RAMP_LENGTH]).toBe(fills[0]);
  });

  test("every fill is a `var(--chart-N)` reference — the only form the charts library honours", () => {
    captured.seriesBarFills.length = 0;
    renderWithSeriesCount(6);
    for (const fill of captured.seriesBarFills) {
      expect(fill).toMatch(/^var\(--chart-\d+\)$/);
    }
  });
});
