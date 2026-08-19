import { useMemo } from "react";
import { Activity } from "lucide-react";
import { ChartTooltip, ComposedChart, Grid, Line, SeriesBar, XAxis, YAxis } from "@elabs-ai/components-charts";
import type { MetricsBucket, RunFilter, RunMetricsSeries } from "@mcp-token-footprint/shared";
import { CHART_RAMP_LENGTH, chartSeriesColor } from "../../../lib/chart-colors";
import { formatNumber, formatPercent } from "../../../lib/format";
import { bucketRangeIso, drillDownFilter, type TestingDashboardControls } from "./dashboard-url-state";
import { buildRunsOverTimeRows, datapointBucketStart } from "./metrics-derive";
import { ChartBox, ChartPanel, PanelEmptyState } from "./panel-shell";

/**
 * The error-rate LINE is a different measure on a different axis, not one of the grouped count
 * series, so it reserves the LAST ramp slot and the bars cycle every slot before it. The old code
 * expressed the same reservation as `(i % 4) + 1` against a hard-coded fifth token — which both
 * under-used the twelve-token ramp AND collided again at the 5th group.
 */
const GROUP_RAMP_LENGTH = CHART_RAMP_LENGTH - 1;
const ERROR_RATE_COLOR = chartSeriesColor(CHART_RAMP_LENGTH - 1);

/** The line's own dataKey — the one series here that is a RATE, not a run count. */
const ERROR_RATE_KEY = "errorRatePercent";

/**
 * Panel 1 — Runs & error rate over time. Grouped run-count bars (stacked by the dashboard's global
 * `groupBy`) + an OVERALL error-rate line on a secondary axis, via `ComposedChart` (the
 * `@elabs-ai/components-charts` "mixed bar columns + lines on a shared time scale" chart). `x` is fed real
 * `Date` objects (the Line/ComposedChart GOTCHA — a string x throws "Invalid time value").
 *
 * Drill-down: the chart itself is the click surface. `onDatapointClick` fires for a pointer OR a
 * keyboard activation (the chart mounts real `<button>` targets OUTSIDE the aria-hidden `<svg>`),
 * and every bar/point in a bucket resolves to the SAME target — the runs feed scoped to exactly
 * that bucket's window. Group is deliberately NOT folded into the filter: the bars stack a bucket's
 * groups, and a click anywhere in the stack means "this bucket", so a bar click and the error-rate
 * point above it can never disagree.
 */
export function RunsErrorRatePanel({
  series,
  controls,
  bucket,
  groupLabel,
  onDrill,
}: {
  series: RunMetricsSeries[];
  controls: TestingDashboardControls;
  bucket: MetricsBucket;
  groupLabel: (group: string) => string;
  onDrill: (filter: RunFilter) => void;
}) {
  const { rows, groups, hasData } = useMemo(() => buildRunsOverTimeRows(series), [series]);

  return (
    <ChartPanel
      title="Runs & error rate over time"
      subtitle={`Run count by ${groups.length > 0 ? "group" : "window"}, overall error rate`}
      icon={<Activity aria-hidden className="size-4" />}
    >
      {hasData ? (
        <ChartBox>
          <ComposedChart
            data={rows as unknown as Record<string, unknown>[]}
            xDataKey="x"
            aspectRatio="auto"
            className="h-full w-full"
            accessibleLabel="Run count and error rate over time"
            onDatapointClick={(point) => {
              const bucketStart = datapointBucketStart(point.datum);
              if (!bucketStart) return;
              const { from, to } = bucketRangeIso(bucketStart, bucket);
              onDrill(drillDownFilter(controls, { dateFrom: from, dateTo: to }));
            }}
            // The default accessible name would read the raw series dataKey — which under
            // `groupBy=server`/`suite` is an opaque id, not something a screen-reader user can act on.
            datapointLabel={(point) => {
              const key = String(point.seriesKey ?? "");
              const name = key === ERROR_RATE_KEY ? "Error rate" : groupLabel(key);
              const when = point.category instanceof Date ? point.category.toLocaleString() : String(point.category ?? "");
              const value =
                key === ERROR_RATE_KEY
                  ? formatPercent(Number(point.value ?? 0))
                  : `${formatNumber(Number(point.value ?? 0))} runs`;
              return `${name}, ${when}: ${value}`;
            }}
          >
            <Grid horizontal />
            {groups.map((group, i) => (
              <SeriesBar key={group} dataKey={group} fill={chartSeriesColor(i, GROUP_RAMP_LENGTH)} />
            ))}
            <Line dataKey={ERROR_RATE_KEY} yAxisId="right" stroke={ERROR_RATE_COLOR} showMarkers />
            <XAxis />
            <YAxis yAxisId="left" />
            <YAxis yAxisId="right" orientation="right" formatValue={(v) => `${v}%`} />
            <ChartTooltip
              rows={(point) => [
                ...groups.map((group, i) => ({
                  color: chartSeriesColor(i, GROUP_RAMP_LENGTH),
                  label: groupLabel(group),
                  value: formatNumber(Number(point[group] ?? 0)),
                })),
                {
                  color: ERROR_RATE_COLOR,
                  label: "Error rate",
                  value: formatPercent(Number(point[ERROR_RATE_KEY] ?? 0)),
                },
              ]}
            />
          </ComposedChart>
        </ChartBox>
      ) : (
        <PanelEmptyState
          title="No runs in this window"
          description="Widen the date range or clear a filter to see run activity."
        />
      )}
    </ChartPanel>
  );
}
