import { useMemo } from "react";
import { Activity } from "lucide-react";
import { ChartTooltip, ComposedChart, Grid, Line, SeriesBar, XAxis, YAxis } from "@elabs-ai/components-charts";
import type { MetricsBucket, RunFilter, RunMetricsSeries } from "@mcp-token-footprint/shared";
import { CHART_RAMP_LENGTH, chartSeriesColor } from "../../../lib/chart-colors";
import { formatNumber, formatPercent } from "../../../lib/format";
import { bucketRangeIso, drillDownFilter, type TestingDashboardControls } from "./dashboard-url-state";
import { DrillList } from "./DrillList";
import { buildRunsOverTimeRows } from "./metrics-derive";
import { ChartBox, ChartPanel, PanelEmptyState } from "./panel-shell";

/**
 * The error-rate LINE is a different measure on a different axis, not one of the grouped count
 * series, so it reserves the LAST ramp slot and the bars cycle every slot before it. The old code
 * expressed the same reservation as `(i % 4) + 1` against a hard-coded fifth token — which both
 * under-used the twelve-token ramp AND collided again at the 5th group.
 */
const GROUP_RAMP_LENGTH = CHART_RAMP_LENGTH - 1;
const ERROR_RATE_COLOR = chartSeriesColor(CHART_RAMP_LENGTH - 1);

/**
 * Panel 1 — Runs & error rate over time. Grouped run-count bars (stacked by the dashboard's global
 * `groupBy`) + an OVERALL error-rate line on a secondary axis, via `ComposedChart` (the vendored
 * `@elabs-ai/components-charts` "mixed bar columns + lines on a shared time scale" chart — confirmed via the MCP
 * `docs`/`search` tools + `vendor/brand-ui-agent-kit`). `x` is fed real `Date` objects (the
 * Line/ComposedChart GOTCHA — a string x throws "Invalid time value").
 *
 * Drill-down: `@elabs-ai/components-charts` v1.6.0 exposes no per-bar/point `onClick` (verified — see the WP
 * report), so the click surface is the `DrillList` underneath — one row per bucket, opening the
 * runs feed scoped to exactly that bucket's window (an "error-rate point").
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

  const drillRows = useMemo(
    () =>
      rows.map((row) => {
        const { from, to } = bucketRangeIso(row.bucketStart, bucket);
        const total = groups.reduce((sum, g) => sum + (typeof row[g] === "number" ? (row[g] as number) : 0), 0);
        return {
          key: row.bucketStart,
          label: new Date(row.bucketStart).toLocaleString(),
          value: `${formatNumber(total)} runs · ${formatPercent(typeof row.errorRatePercent === "number" ? row.errorRatePercent : 0)} err`,
          onOpen: () => onDrill(drillDownFilter(controls, { dateFrom: from, dateTo: to })),
        };
      }),
    [rows, groups, bucket, controls, onDrill],
  );

  return (
    <ChartPanel
      title="Runs & error rate over time"
      subtitle={`Run count by ${groups.length > 0 ? "group" : "window"}, overall error rate`}
      icon={<Activity aria-hidden className="size-4" />}
    >
      {hasData ? (
        <>
          <ChartBox>
            <ComposedChart
              data={rows as unknown as Record<string, unknown>[]}
              xDataKey="x"
              aspectRatio="auto"
              className="h-full w-full"
              accessibleLabel="Run count and error rate over time"
            >
              <Grid horizontal />
              {groups.map((group, i) => (
                <SeriesBar key={group} dataKey={group} fill={chartSeriesColor(i, GROUP_RAMP_LENGTH)} />
              ))}
              <Line dataKey="errorRatePercent" yAxisId="right" stroke={ERROR_RATE_COLOR} showMarkers />
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
                    value: formatPercent(Number(point.errorRatePercent ?? 0)),
                  },
                ]}
              />
            </ComposedChart>
          </ChartBox>
          <DrillList rows={drillRows} />
        </>
      ) : (
        <PanelEmptyState
          title="No runs in this window"
          description="Widen the date range or clear a filter to see run activity."
        />
      )}
    </ChartPanel>
  );
}
