import type { ReactNode } from "react";
import { useMemo } from "react";
import {
  Bar,
  BarChart,
  BarXAxis,
  ChartTooltip,
  ComposedChart,
  Grid,
  SeriesBar,
  XAxis,
  YAxis,
} from "@brand/charts";
import { Card, CardContent, CardHeader, CardTitle, EmptyState, Text } from "@brand/ui";
import type { HubUsageRow } from "@mcp-token-footprint/shared";
import { formatCostUsd } from "../../../../lib/format";
import { rankByCost } from "./usage-derive";

/**
 * Assistant Hub UX WP2.6 (D-HUX10, §7.3) — the Usage tab's two `ChartCard`s: "spend over time,
 * stacked by group-by" and "top by spend". Local `ChartPanel`/`ChartBox`/`PanelEmptyState` framing —
 * each feature re-creates this small wrapper rather than importing a sibling feature's (the
 * now-retired `UsageView.tsx` carried this same doc note; `dashboard/testing/panel-shell.tsx`'s the
 * same call).
 *
 * ⚠️ CHART GOTCHA (repo-wide rule, every chart author has been bitten by this):
 *   - `ComposedChart` is a TIME-SCALE chart — its x MUST be a real `Date`, never a string, and
 *     `xDataKey` must be set explicitly (`ComposedChartProps.xDataKey` defaults to `"date"`, which
 *     `usage-derive.ts`'s `buildStackedTimeRows` rows do NOT carry — they carry `x`). Both are
 *     honored below (`xDataKey="x"`, `point.x` built from `new Date(...)` in `buildStackedTimeRows`).
 *   - `BarChart` is CATEGORICAL — its x is the row label (a string), which is exactly what "top by
 *     spend" needs (one bar per agent/crew/model/project/mode NAME, not a time axis).
 *   - `stacked` on `ComposedChart` stacks `SeriesBar` children in DOM order at each `x` (confirmed
 *     via the vendored `.d.ts` — "Stack SeriesBar segments in child order at each x"); this is the
 *     SAME "stacked bars over time" recipe `dashboard/testing/RunsErrorRatePanel.tsx` already uses
 *     for its grouped-run-count panel, reused here rather than re-derived.
 */

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

function chartColor(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length] ?? "var(--chart-1)";
}

export function UsageCharts({
  rows,
  groupByLabel,
  stackedRows,
  stackedSeries,
  stackedLoading,
}: {
  /** Every current-groupBy rollup row (ranked desc, unattributed included) — powers "top by spend". */
  rows: HubUsageRow[];
  /** e.g. "agent" — used in chart subtitles. */
  groupByLabel: string;
  /** `usage-derive.ts`'s `buildStackedTimeRows` output — one row per day, `x: Date` + one numeric
   *  field per series key. Empty while `stackedLoading`. */
  stackedRows: Record<string, unknown>[];
  /** The entities the stacked chart has a series for (top attributed rows, by cost) — `{ key, label }`
   *  pairs matching `stackedRows`' field names (`usage-derive.ts`'s `seriesKeyFor`). */
  stackedSeries: { key: string; label: string }[];
  stackedLoading: boolean;
}) {
  const topRows = useMemo(() => rankByCost(rows).slice(0, 8), [rows]);
  const topChartRows = useMemo(
    () =>
      topRows.map((row) => ({
        label: row.label,
        costUsd: row.costUsd,
        unattributed: row.unattributed,
      })),
    [topRows],
  );

  // T10: this subtitle used to render `Top ${stackedSeries.length} …` unconditionally, so an empty
  // stacked chart (the per-entity `/summary` fetch can come back empty even while the KPI/table
  // above have real rows — see `UsageTab.tsx`'s `stackedEntries` catch) read as "Top 0 agent groups
  // by spend" sitting beside a populated total. Guard the count: only state a series count once
  // there IS one; the empty/loading states below already explain themselves without a numeric claim.
  const stackedSubtitle =
    !stackedLoading && stackedSeries.length > 0
      ? `Top ${stackedSeries.length} ${groupByLabel} group${stackedSeries.length === 1 ? "" : "s"} by spend, stacked.`
      : undefined;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <ChartPanel title="Spend over time" subtitle={stackedSubtitle}>
        {stackedLoading ? (
          <ChartBox>
            <div className="flex h-full items-center justify-center">
              <Text tone="muted">Loading…</Text>
            </div>
          </ChartBox>
        ) : stackedRows.length === 0 || stackedSeries.length === 0 ? (
          <PanelEmptyState
            title="Nothing in this window yet"
            description="No attributed spend to chart over time for the current filter."
          />
        ) : (
          <ChartBox>
            <ComposedChart
              data={stackedRows}
              xDataKey="x"
              stacked
              aspectRatio="auto"
              className="h-full w-full"
              accessibleLabel={`Spend over time, stacked by ${groupByLabel}`}
            >
              <Grid horizontal />
              {stackedSeries.map((series, i) => (
                <SeriesBar key={series.key} dataKey={series.key} fill={chartColor(i)} />
              ))}
              <XAxis />
              <YAxis formatValue={(v) => formatCostUsd(v)} />
              <ChartTooltip
                rows={(point) =>
                  stackedSeries.map((series, i) => ({
                    color: chartColor(i),
                    label: series.label,
                    value: formatCostUsd(Number(point[series.key] ?? 0)),
                  }))
                }
              />
            </ComposedChart>
          </ChartBox>
        )}
      </ChartPanel>

      <ChartPanel
        title="Top by spend"
        subtitle={`Every ${groupByLabel} group in the current filter.`}
      >
        {topChartRows.length === 0 ? (
          <PanelEmptyState
            title="Nothing in this window yet"
            description="No spend recorded for the current filter."
          />
        ) : (
          <ChartBox>
            <BarChart
              data={topChartRows}
              xDataKey="label"
              aspectRatio="auto"
              className="h-full w-full"
              accessibleLabel={`Top ${groupByLabel} groups by spend`}
            >
              <Grid horizontal />
              <Bar dataKey="costUsd" fill="var(--chart-1)" />
              <BarXAxis maxLabels={8} />
              <ChartTooltip
                showDatePill={false}
                rows={(point) => [
                  {
                    color: "var(--chart-1)",
                    label: point.unattributed
                      ? `${point.label} (unattributed)`
                      : String(point.label ?? ""),
                    value: formatCostUsd(Number(point.costUsd ?? 0)),
                  },
                ]}
              />
            </BarChart>
          </ChartBox>
        )}
      </ChartPanel>
    </div>
  );
}

function ChartPanel({
  title,
  subtitle,
  children,
}: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <Card className="min-w-0">
      <CardHeader className="space-y-0">
        <CardTitle>{title}</CardTitle>
        {subtitle ? (
          <Text variant="meta" tone="muted">
            {subtitle}
          </Text>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">{children}</CardContent>
    </Card>
  );
}

function ChartBox({ children }: { children: ReactNode }) {
  return <div className="h-56 w-full">{children}</div>;
}

function PanelEmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex min-h-40 items-center justify-center py-6">
      <EmptyState title={title} description={description} />
    </div>
  );
}
