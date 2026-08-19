import { useMemo } from "react";
import { Star } from "lucide-react";
import { ChartTooltip, Grid, Line, LineChart, XAxis } from "@elabs-ai/components-charts";
import type { MetricsBucket, RunFilter, RunMetricsSeries } from "@mcp-token-footprint/shared";
import { formatPercent } from "../../../lib/format";
import {
  bucketRangeIso,
  drillDownFilter,
  type TestingDashboardControls,
} from "./dashboard-url-state";
import { buildScoreTrendRows, datapointBucketStart } from "./metrics-derive";
import { ChartBox, ChartPanel, PanelEmptyState } from "./panel-shell";

/**
 * Panel 6 — Score trend. `meanScore` is ungrouped; there is no per-grader breakdown to expose (the
 * API's `meanScore` measure already resolves latest-per-grader → the primary-priority grader chain
 * server-side — the SAME selection Benchmarks' suite analytics uses). A grader Select was in the
 * original spec sketch but the metrics contract has no per-grader parameter for this measure, so a
 * picker with no effect would be a dead control (interaction-guidelines.md) — this note replaces it.
 *
 * Drill-down: activating a point (pointer or keyboard) opens the runs feed scoped to exactly that
 * bucket's window — the graded runs the mean was computed over.
 */
export function ScoreTrendPanel({
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
  const { rows, hasData } = useMemo(() => buildScoreTrendRows(series), [series]);

  return (
    <ChartPanel
      title="Score trend"
      subtitle="Mean grade — primary-priority grader chain"
      icon={<Star aria-hidden className="size-4" />}
    >
      {hasData ? (
        <ChartBox>
          <LineChart
            data={rows as unknown as Record<string, unknown>[]}
            xDataKey="x"
            aspectRatio="auto"
            className="h-full w-full"
            accessibleLabel="Mean grade over time"
            onDatapointClick={(point) => {
              const bucketStart = datapointBucketStart(point.datum);
              if (!bucketStart) return;
              const { from, to } = bucketRangeIso(bucketStart, bucket);
              onDrill(drillDownFilter(controls, { dateFrom: from, dateTo: to }));
            }}
          >
            <Grid horizontal />
            <Line dataKey="meanScore" stroke="var(--chart-1)" showMarkers />
            <XAxis />
            <ChartTooltip
              rows={(point) => [
                {
                  color: "var(--chart-1)",
                  label: "Mean score",
                  value:
                    point.meanScore != null ? formatPercent(Number(point.meanScore) * 100) : "n/a",
                },
              ]}
            />
          </LineChart>
        </ChartBox>
      ) : (
        <PanelEmptyState
          title="No graded runs"
          description="Score trend appears once a run in this window has a grade."
        />
      )}
    </ChartPanel>
  );
}
