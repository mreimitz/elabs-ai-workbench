import { useCallback, useMemo } from "react";
import { DatabaseZap, ExternalLink } from "lucide-react";
import { ChartTooltip, ComposedChart, Grid, Line, SeriesBar, XAxis, YAxis } from "@elabs-ai/components-charts";
import { Button, Text } from "@elabs-ai/components-ui";
import type { MetricsBucket, RunFilter, RunMetricsMeasure, RunMetricsSeries } from "@mcp-token-footprint/shared";
import { CHART_RAMP_LENGTH, chartSeriesColor, chartSwatchStyle } from "../../../lib/chart-colors";
import { formatNumber, formatPercent } from "../../../lib/format";
import { bucketRangeIso, drillDownFilter, type TestingDashboardControls } from "./dashboard-url-state";
import {
  buildCacheResult,
  CACHE_HIT_RATE_KEY,
  CACHE_MEASURES,
  type CacheSeriesEntry,
  datapointBucketStart,
} from "./metrics-derive";
import { DASHBOARD_PANEL_IDS } from "./panel-anchor";
import { ChartBox, ChartPanel, PanelEmptyState } from "./panel-shell";

/**
 * Panel 4b — Prompt cache (RM-33 WP 3.3). The dashboard half of the cache-aware display: how much of
 * the window's input was served FROM the cache, how much was written INTO it, and what share of the
 * gross input that first number was.
 *
 * Three rules this panel exists to keep, all of them the difference between a useful chart and a
 * misleading one:
 *
 * 1. **Read and write are never one bar (D-CT2).** A cache READ is billed at ~0.1× — a discount. A
 *    cache WRITE is billed at 1.25× — a PREMIUM, more than an uncached token. A single "cached"
 *    series showing their sum renders a premium as a saving, which is precisely the defect this
 *    workstream exists to remove. Each half keeps its own colour and carries its rate multiplier in
 *    its label, in the chart legend and in the tooltip.
 * 2. **Grouped bars, never stacked** — the `TokensPanel` reasoning: a stack draws a combined height,
 *    and a combined height is a claim that the sum means something. Reads + writes do not add up to
 *    anything an operator should read off an axis.
 * 3. **A missing number is never a zero (D-CT6).** The hit rate is a RATE on its own right-hand
 *    axis: a bucket with no known split leaves the point out (the line breaks) rather than dipping
 *    to 0%, and when NO run in the window has a known split the API reports the measures in
 *    `unavailableMeasures` — which this panel renders as an explicit "not measured" state rather
 *    than as an empty chart ("no runs") or a flat 0% line ("caching stopped working").
 *
 * Drill-down: identical to `TokensPanel`'s. A capability class is an ACCOUNTING FACET, not a
 * `RunFilter` dimension, and "a run that used the cache" is not a filter either — so activating any
 * bar or hit-rate point (pointer or keyboard) opens the runs feed scoped to exactly that BUCKET's
 * window, via the shared `drillDownFilter` + `bucketRangeIso`. Two series' marks in one bucket can
 * therefore never resolve to two different destinations.
 */

/** The hit-rate LINE reserves the last ramp slot; the bars cycle every slot before it — the
 *  `RunsErrorRatePanel` convention for "a rate line among value bars". */
const BAR_RAMP_LENGTH = CHART_RAMP_LENGTH - 1;
const HIT_RATE_COLOR = chartSeriesColor(CHART_RAMP_LENGTH - 1);

export function CachePanel({
  series,
  unavailableMeasures,
  controls,
  bucket,
  onDrill,
}: {
  series: RunMetricsSeries[];
  /** `RunMetricsResponse.unavailableMeasures` from the cache request — the API's honest third answer
   *  between "here is the data" and "there were no runs". */
  unavailableMeasures: RunMetricsMeasure[];
  controls: TestingDashboardControls;
  bucket: MetricsBucket;
  onDrill: (filter: RunFilter) => void;
}) {
  const { rows, entries, hasHitRate, hasData } = useMemo(() => buildCacheResult(series), [series]);

  // The API reports the three cache measures TOGETHER (they share one backing pair of columns), so
  // any one of them coming back unavailable means the whole panel is unmeasurable for this window.
  const notMeasured = CACHE_MEASURES.some((m) => unavailableMeasures.includes(m));

  const drillToBucket = useCallback(
    (datum: unknown) => {
      const bucketStart = datapointBucketStart(datum);
      if (!bucketStart) return;
      const { from, to } = bucketRangeIso(bucketStart, bucket);
      onDrill(drillDownFilter(controls, { dateFrom: from, dateTo: to }));
    },
    [bucket, controls, onDrill],
  );

  const showChart = hasData && !notMeasured;

  return (
    <ChartPanel
      title="Prompt cache"
      panelId={DASHBOARD_PANEL_IDS.cache}
      subtitle="Cache reads (~0.1× rate) vs writes (1.25× — a premium), and the share of input served from cache"
      icon={<DatabaseZap aria-hidden className="size-4" />}
      actions={
        showChart ? (
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
      {notMeasured ? (
        // THE load-bearing state (WP 3.3 §4). Never a 0% line, never a bare empty chart: this window
        // holds runs, they simply never reported a cache read/write split, and saying so is the only
        // honest answer. A 0% cache-hit line is indistinguishable from a caching regression.
        <PanelEmptyState
          title="Cache split not measured"
          description="No run in this window reports a cache read/write split — they predate cache measurement, or reported only a merged “cached” total. Shown as unmeasured rather than as a zero, because a zero here would look exactly like caching that had stopped working."
        />
      ) : showChart ? (
        <>
          <ChartBox>
            <ComposedChart
              data={rows as unknown as Record<string, unknown>[]}
              xDataKey="x"
              aspectRatio="auto"
              className="h-full w-full"
              // GROUPED, never stacked — passed explicitly rather than relying on the default, because
              // a stacked read+write bar is exactly the D-CT2 lie this panel was built to avoid.
              stacked={false}
              accessibleLabel="Cache read and cache write tokens, with the cache hit rate, over time"
              onDatapointClick={(point) => drillToBucket(point.datum)}
              // The default accessible name would read the raw dataKey (`read:exact`) — which names
              // neither the half nor what it costs.
              datapointLabel={(point) => {
                const key = String(point.seriesKey ?? "");
                const when =
                  point.category instanceof Date ? point.category.toLocaleString() : String(point.category ?? "");
                if (key === CACHE_HIT_RATE_KEY) {
                  return `Cache hit rate, ${when}: ${formatPercent(Number(point.value ?? 0))}`;
                }
                const entry = entries.find((e) => e.key === key);
                return `${entry?.label ?? key}, ${when}: ${formatNumber(Number(point.value ?? 0))} tokens`;
              }}
            >
              <Grid horizontal />
              {entries.map((entry, i) => (
                <SeriesBar key={entry.key} dataKey={entry.key} fill={chartSeriesColor(i, BAR_RAMP_LENGTH)} />
              ))}
              {hasHitRate ? (
                <Line dataKey={CACHE_HIT_RATE_KEY} yAxisId="right" stroke={HIT_RATE_COLOR} showMarkers />
              ) : null}
              <XAxis />
              <YAxis yAxisId="left" />
              {/* The rate gets its OWN axis, labelled in %, so it can never be read as a token count. */}
              {hasHitRate ? <YAxis yAxisId="right" orientation="right" formatValue={(v) => `${v}%`} /> : null}
              <ChartTooltip rows={(point) => cacheTooltipRows(point, entries, hasHitRate)} />
            </ComposedChart>
          </ChartBox>
          <CacheLegend entries={entries} hasHitRate={hasHitRate} />
        </>
      ) : (
        <PanelEmptyState
          title="No cache data"
          description="Cache reads and writes appear once a run in this window reports them."
        />
      )}
    </ChartPanel>
  );
}

/**
 * The tooltip rows for one bucket. Exported for its own unit test: the mocked chart package every
 * other dashboard suite uses renders `ChartTooltip` as a no-op, so the one rule that matters most
 * here (an ABSENT value reads "n/a", never "0") is unreachable through the rendered panel.
 *
 * This deliberately diverges from `TokensPanel`'s `?? 0`: there, an absent bucket means "no runs of
 * that class"; here it means "nobody measured", and on THIS panel a fabricated zero is the specific
 * failure mode the WP names (a 0% hit rate reads as a caching regression, a 0-token cache read reads
 * as a cache that stopped being used).
 */
export function cacheTooltipRows(
  point: Record<string, unknown>,
  entries: CacheSeriesEntry[],
  hasHitRate: boolean,
): { color: string; label: string; value: string }[] {
  const rows = entries.map((entry, i) => {
    const raw = point[entry.key];
    return {
      color: chartSeriesColor(i, BAR_RAMP_LENGTH),
      label: entry.label,
      value: typeof raw === "number" ? formatNumber(raw) : "n/a",
    };
  });
  if (hasHitRate) {
    const raw = point[CACHE_HIT_RATE_KEY];
    rows.push({
      color: HIT_RATE_COLOR,
      label: "Cache hit rate",
      value: typeof raw === "number" ? formatPercent(raw) : "n/a",
    });
  }
  return rows;
}

/**
 * The honest legend — each half's OWN total beside the colour that plots it and the rate it is
 * billed at, never a combined "cached" figure. The hit-rate entry carries no number on purpose: the
 * API's per-bucket rate is `reads / gross input` over the runs whose split is known, and its `n` is a
 * RUN count, not that denominator — so any window-wide average computed here would be arithmetic
 * nobody can defend. The line and its right-hand axis carry the rate instead.
 */
function CacheLegend({ entries, hasHitRate }: { entries: CacheSeriesEntry[]; hasHitRate: boolean }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-2">
      {entries.map((entry, i) => (
        <li key={entry.key} className="flex items-center gap-1.5">
          <span className="size-2.5 shrink-0 rounded-sm" style={chartSwatchStyle(i, BAR_RAMP_LENGTH)} aria-hidden />
          <Text variant="meta" tone="muted">
            {entry.label}
          </Text>
          <Text variant="meta" className="tabular-nums">
            {formatNumber(entry.total)}
          </Text>
        </li>
      ))}
      {hasHitRate ? (
        <li className="flex items-center gap-1.5">
          <span
            className="size-2.5 shrink-0 rounded-sm"
            style={chartSwatchStyle(CHART_RAMP_LENGTH - 1)}
            aria-hidden
          />
          <Text variant="meta" tone="muted">
            Cache hit rate (right axis, %)
          </Text>
        </li>
      ) : null}
    </ul>
  );
}
