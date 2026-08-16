import { useMemo } from "react";
import { Bar, BarChart, BarXAxis, ChartTooltip, Grid, Line, LineChart, XAxis } from "@brand/charts";
import { Skeleton } from "@brand/ui";
import type { DashboardChartType } from "@mcp-token-footprint/shared";
import { InlineError } from "../../../components/InlineError";
import { formatCostUsd, formatDuration, formatNumber, formatPercent } from "../../../lib/format";
import type { PivotedRow } from "./metrics-derive";
import { ChartBox, PanelEmptyState } from "./panel-shell";

/**
 * Custom chart composer (WP 2.7) — the ONE rendering surface shared by BOTH the composer dialog's
 * live preview and the persisted `CustomChartPanel`, driven entirely by `useCustomChartData`'s output.
 * `chartType` picks the mark: `line` needs real `Date` x values (the `@brand/charts` GOTCHA — `rows`
 * from `useCustomChartData`/`pivotToRows` already carry one); `bar`/`stacked` are CATEGORICAL (string
 * x), built here from each row's `bucketStart`.
 */
export function CustomChartCanvas({
  chartType,
  unit,
  loading,
  error,
  rows,
  series,
  hasData,
  onRetry,
  emptyTitle = "No data in this window",
  emptyDescription = "Widen the date range or adjust the chart's filter to see data here.",
}: {
  chartType: DashboardChartType;
  unit: string;
  loading: boolean;
  error: string | null;
  rows: PivotedRow[];
  series: { key: string; label: string }[];
  hasData: boolean;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  const barRows = useMemo(
    () => rows.map((row) => ({ ...row, bucketLabel: new Date(row.bucketStart).toLocaleDateString() })),
    [rows],
  );

  if (loading) {
    return (
      <ChartBox>
        <Skeleton className="h-full w-full" />
      </ChartBox>
    );
  }

  if (error) {
    return <InlineError title="Couldn’t load this chart" detail={error} onRetry={onRetry} />;
  }

  if (!hasData) {
    return <PanelEmptyState title={emptyTitle} description={emptyDescription} />;
  }

  const tooltipRows = (point: Record<string, unknown>) =>
    series.map((s, i) => ({
      color: `var(--chart-${(i % 5) + 1})`,
      label: s.label,
      value: point[s.key] != null ? formatValue(unit, Number(point[s.key])) : "n/a",
    }));

  if (chartType === "line") {
    return (
      <ChartBox>
        <LineChart
          data={rows as unknown as Record<string, unknown>[]}
          xDataKey="x"
          aspectRatio="auto"
          className="h-full w-full"
          accessibleLabel="Custom chart"
        >
          <Grid horizontal />
          {series.map((s, i) => (
            <Line key={s.key} dataKey={s.key} stroke={`var(--chart-${(i % 5) + 1})`} />
          ))}
          <XAxis />
          <ChartTooltip rows={tooltipRows} />
        </LineChart>
      </ChartBox>
    );
  }

  return (
    <ChartBox>
      <BarChart
        data={barRows as unknown as Record<string, unknown>[]}
        xDataKey="bucketLabel"
        stacked={chartType === "stacked"}
        aspectRatio="auto"
        className="h-full w-full"
        accessibleLabel="Custom chart"
      >
        <Grid horizontal />
        {series.map((s, i) => (
          <Bar key={s.key} dataKey={s.key} fill={`var(--chart-${(i % 5) + 1})`} />
        ))}
        <BarXAxis maxLabels={8} />
        <ChartTooltip showDatePill={false} rows={tooltipRows} />
      </BarChart>
    </ChartBox>
  );
}

/** Format one plotted value per the chart's shared unit (same-unit constraint — every measure on a
 *  chart maps to exactly one of these). */
function formatValue(unit: string, value: number): string {
  switch (unit) {
    case "ms":
      return formatDuration(value);
    case "usd":
      return formatCostUsd(value);
    case "rate":
      return formatPercent(value * 100);
    default:
      return formatNumber(value);
  }
}
