import { useMemo } from "react";
import { Star } from "lucide-react";
import { ChartTooltip, Grid, Line, LineChart, XAxis } from "@brand/charts";
import type { MetricsBucket, RunFilter, RunMetricsSeries } from "@mcp-token-footprint/shared";
import { formatPercent } from "../../../lib/format";
import { bucketRangeIso, drillDownFilter, type TestingDashboardControls } from "./dashboard-url-state";
import { DrillList } from "./DrillList";
import { buildScoreTrendRows } from "./metrics-derive";
import { ChartBox, ChartPanel, PanelEmptyState } from "./panel-shell";

/**
 * Panel 6 — Score trend. `meanScore` is ungrouped; there is no per-grader breakdown to expose (the
 * API's `meanScore` measure already resolves latest-per-grader → the primary-priority grader chain
 * server-side — the SAME selection Benchmarks' suite analytics uses). A grader Select was in the
 * original spec sketch but the metrics contract has no per-grader parameter for this measure, so a
 * picker with no effect would be a dead control (interaction-guidelines.md) — this note replaces it.
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

  const drillRows = useMemo(
    () =>
      rows.map((row) => {
        const { from, to } = bucketRangeIso(row.bucketStart, bucket);
        return {
          key: row.bucketStart,
          label: new Date(row.bucketStart).toLocaleString(),
          value: formatPercent(typeof row.meanScore === "number" ? row.meanScore * 100 : 0),
          onOpen: () => onDrill(drillDownFilter(controls, { dateFrom: from, dateTo: to })),
        };
      }),
    [rows, bucket, controls, onDrill],
  );

  return (
    <ChartPanel
      title="Score trend"
      subtitle="Mean grade — primary-priority grader chain"
      icon={<Star aria-hidden className="size-4" />}
    >
      {hasData ? (
        <>
          <ChartBox>
            <LineChart
              data={rows as unknown as Record<string, unknown>[]}
              xDataKey="x"
              aspectRatio="auto"
              className="h-full w-full"
              accessibleLabel="Mean grade over time"
            >
              <Grid horizontal />
              <Line dataKey="meanScore" stroke="var(--chart-1)" showMarkers />
              <XAxis />
              <ChartTooltip
                rows={(point) => [
                  {
                    color: "var(--chart-1)",
                    label: "Mean score",
                    value: point.meanScore != null ? formatPercent(Number(point.meanScore) * 100) : "n/a",
                  },
                ]}
              />
            </LineChart>
          </ChartBox>
          <DrillList rows={drillRows} />
        </>
      ) : (
        <PanelEmptyState
          title="No graded runs"
          description="Score trend appears once a run in this window has a grade."
        />
      )}
    </ChartPanel>
  );
}
