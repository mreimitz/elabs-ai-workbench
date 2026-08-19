import { useCallback, useMemo } from "react";
import { ExternalLink, Layers } from "lucide-react";
import { Bar, BarChart, BarXAxis, ChartTooltip, Grid } from "@elabs-ai/components-charts";
import { Button, Text } from "@elabs-ai/components-ui";
import type { MetricsBucket, RunFilter, RunMetricsSeries } from "@mcp-token-footprint/shared";
import { chartSeriesColor, chartSwatchStyle } from "../../../lib/chart-colors";
import { formatNumber } from "../../../lib/format";
import { bucketRangeIso, drillDownFilter, type TestingDashboardControls } from "./dashboard-url-state";
import { buildTokensResult, type CapabilityClassSeries, datapointBucketStart } from "./metrics-derive";
import { ChartPanel, PanelEmptyState } from "./panel-shell";

/**
 * Panel 4 — Tokens by capability class (D-OB14: NEVER blended). `tokensIn`/`tokensOut` each render
 * as GROUPED (never stacked) bars, one per capability class present — stacking would visually imply
 * a summed total across an accounting-fidelity boundary (an "exact" provider-metered count next to
 * an "estimated" local one), which is exactly what D-OB14 forbids.
 *
 * Drill-down: a capability class (`exact`/`estimated`/…) is an ACCOUNTING FACET, not a `RunFilter`
 * dimension — there is no "runs with estimated tokens" filter to scope to. What a bar DOES identify
 * is its BUCKET, so activating one (pointer or keyboard) opens the runs feed scoped to exactly that
 * bucket's window — the same `drillDownFilter` + `bucketRangeIso` path every other time-bucketed
 * panel uses. The class stays out of the filter, so two classes' bars in one bucket resolve to the
 * same destination rather than to a fabricated one. The legend below stays non-interactive (the
 * honest per-class totals), and the header keeps ONE drill for the panel's whole window.
 */
export function TokensPanel({
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
  const { inRows, outRows, inClasses, outClasses, hasData } = useMemo(() => buildTokensResult(series), [series]);

  const drillToBucket = useCallback(
    (datum: unknown) => {
      const bucketStart = datapointBucketStart(datum);
      if (!bucketStart) return;
      const { from, to } = bucketRangeIso(bucketStart, bucket);
      onDrill(drillDownFilter(controls, { dateFrom: from, dateTo: to }));
    },
    [bucket, controls, onDrill],
  );

  return (
    <ChartPanel
      title="Tokens by capability class"
      subtitle="Exact (provider-metered) vs estimated — always separate series, never summed"
      icon={<Layers aria-hidden className="size-4" />}
      actions={
        hasData ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onDrill(drillDownFilter(controls))}
            aria-label="Open these runs in the runs feed"
          >
            <ExternalLink aria-hidden />
            <span>Open runs</span>
          </Button>
        ) : undefined
      }
    >
      {hasData ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TokenDirection title="Input" rows={inRows} classes={inClasses} onDrillBucket={drillToBucket} />
          <TokenDirection title="Output" rows={outRows} classes={outClasses} onDrillBucket={drillToBucket} />
        </div>
      ) : (
        <PanelEmptyState
          title="No token data"
          description="Token counts appear once a run in this window carries usage."
        />
      )}
    </ChartPanel>
  );
}

function TokenDirection({
  title,
  rows,
  classes,
  onDrillBucket,
}: {
  title: string;
  rows: ReturnType<typeof buildTokensResult>["inRows"];
  classes: CapabilityClassSeries[];
  onDrillBucket: (datum: unknown) => void;
}) {
  if (classes.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <Text variant="meta" tone="muted">
          {title}
        </Text>
        <PanelEmptyState title={`No ${title.toLowerCase()} tokens`} description="No usage in this window." />
      </div>
    );
  }
  const chartRows = rows.map((r) => ({ ...r, bucketLabel: new Date(r.bucketStart).toLocaleDateString() }));
  return (
    <div className="flex flex-col gap-2">
      <Text variant="meta" tone="muted">
        {title}
      </Text>
      <div className="h-48 w-full">
        <BarChart
          data={chartRows as unknown as Record<string, unknown>[]}
          xDataKey="bucketLabel"
          aspectRatio="auto"
          className="h-full w-full"
          accessibleLabel={`${title} tokens by capability class over time`}
          onDatapointClick={(point) => onDrillBucket(point.datum)}
        >
          <Grid horizontal />
          {classes.map((c, i) => (
            <Bar key={c.cls} dataKey={c.cls} fill={chartSeriesColor(i)} />
          ))}
          <BarXAxis maxLabels={6} />
          <ChartTooltip
            showDatePill={false}
            rows={(point) =>
              classes.map((c, i) => ({
                color: chartSeriesColor(i),
                label: c.label,
                value: formatNumber(Number(point[c.cls] ?? 0)),
              }))
            }
          />
        </BarChart>
      </div>
      {/* The honest legend — each class's OWN total, side by side, never a combined figure. */}
      <ul className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-2">
        {classes.map((c, i) => (
          <li key={c.cls} className="flex items-center gap-1.5">
            <span className="size-2.5 shrink-0 rounded-sm" style={chartSwatchStyle(i)} aria-hidden />
            <Text variant="meta" tone="muted">
              {c.label}
            </Text>
            <Text variant="meta" className="tabular-nums">
              {formatNumber(c.total)}
            </Text>
          </li>
        ))}
      </ul>
    </div>
  );
}
