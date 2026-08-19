import { useMemo } from "react";
import { Clock } from "lucide-react";
import { ChartTooltip, Grid, Line, LineChart, XAxis } from "@elabs-ai/components-charts";
import { Alert, AlertDescription, AlertTitle } from "@elabs-ai/components-ui";
import type { MetricsBucket, RunFilter, RunMetricsSeries } from "@mcp-token-footprint/shared";
import { formatDuration } from "../../../lib/format";
import { bucketRangeIso, drillDownFilter, type TestingDashboardControls } from "./dashboard-url-state";
import { buildDurationRows, datapointBucketStart } from "./metrics-derive";
import { ChartBox, ChartPanel, PanelEmptyState } from "./panel-shell";

/**
 * Panel 3 — Duration p50/p95 (ACTIVE duration, D-US3). `LineChart` needs real `Date` x values (the
 * GOTCHA) — `rows[].x` from `buildDurationRows`/`pivotToRows` already are. A bucket that fell back
 * to wall-clock `totalDurationMs` (no `activeDurationMs` recorded) is MARKED via an inline note,
 * never silently hidden.
 *
 * Drill-down: activating a p50 or p95 point (pointer or keyboard) opens the runs feed scoped to
 * exactly that bucket's window. Both series in a bucket resolve to the same target — the percentile
 * is a summary OF those runs, not a filter over them.
 */
export function DurationPanel({
  series,
  controls,
  bucket,
  onDrill,
}: {
  series: RunMetricsSeries[];
  controls: TestingDashboardControls;
  bucket: MetricsBucket;
  onDrill: (filter: RunFilter) => void;
}) {
  const { rows, fallbackUsed, hasData } = useMemo(() => buildDurationRows(series), [series]);

  return (
    <ChartPanel
      title="Duration (p50 / p95)"
      subtitle="Active duration — wall-clock excludes waiting-on-operator pauses"
      icon={<Clock aria-hidden className="size-4" />}
    >
      {hasData ? (
        <>
          {fallbackUsed ? (
            <Alert>
              <AlertTitle>Some buckets use wall-clock duration</AlertTitle>
              <AlertDescription>
                At least one run in this window has no recorded active duration; its wall-clock
                total was used instead (D-US3 fallback).
              </AlertDescription>
            </Alert>
          ) : null}
          <ChartBox>
            <LineChart
              data={rows as unknown as Record<string, unknown>[]}
              xDataKey="x"
              aspectRatio="auto"
              className="h-full w-full"
              accessibleLabel="p50 and p95 duration over time"
              onDatapointClick={(point) => {
                const bucketStart = datapointBucketStart(point.datum);
                if (!bucketStart) return;
                const { from, to } = bucketRangeIso(bucketStart, bucket);
                onDrill(drillDownFilter(controls, { dateFrom: from, dateTo: to }));
              }}
            >
              <Grid horizontal />
              <Line dataKey="p50" stroke="var(--chart-1)" />
              <Line dataKey="p95" stroke="var(--chart-2)" />
              <XAxis />
              <ChartTooltip
                rows={(point) => [
                  {
                    color: "var(--chart-1)",
                    label: "p50",
                    value: point.p50 != null ? formatDuration(Number(point.p50)) : "n/a",
                  },
                  {
                    color: "var(--chart-2)",
                    label: "p95",
                    value: point.p95 != null ? formatDuration(Number(point.p95)) : "n/a",
                  },
                ]}
              />
            </LineChart>
          </ChartBox>
        </>
      ) : (
        <PanelEmptyState
          title="No duration data"
          description="Duration percentiles appear once a run settles in this window."
        />
      )}
    </ChartPanel>
  );
}
