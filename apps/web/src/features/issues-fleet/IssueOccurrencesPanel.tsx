import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { TrendingUp } from "lucide-react";
import { Bar, BarChart, BarXAxis, ChartTooltip, Grid } from "@elabs-ai/components-charts";
import type { MetricsBucket, RunFilter, RunMetricsSeries } from "@mcp-token-footprint/shared";
import { InlineError } from "../../components/InlineError";
import { getRunMetrics } from "../../lib/api";
import { formatNumber } from "../../lib/format";
import { type Loadable, useLoadable } from "../../lib/loadable";
import { bucketRangeIso, drillDownHref } from "../dashboard/testing/dashboard-url-state";
import { DrillList } from "../dashboard/testing/DrillList";
import { pivotToRows } from "../dashboard/testing/metrics-derive";
import { ChartBox, ChartPanel, PanelEmptyState } from "../dashboard/testing/panel-shell";
import { buildIssueRunFilter, type FleetIssue } from "./issue-lib";

/** ≤2 days spanned → hourly buckets, ≤60 days → daily, else weekly — mirrors
 *  `dashboard-url-state.ts` `resolveBucket`'s thresholds without needing a full
 *  `TestingDashboardControls` (this panel is scoped to ONE issue's own window, not the Testing tab's
 *  global date-range control). */
function resolveIssueBucket(filter: RunFilter): MetricsBucket {
  if (!filter.dateFrom || !filter.dateTo) return "day";
  const ms = Date.parse(filter.dateTo) - Date.parse(filter.dateFrom);
  const days = ms / 86_400_000;
  if (days <= 2) return "hour";
  if (days <= 60) return "day";
  return "week";
}

/**
 * Compact, DISTINCT x-axis tick label for a bucket's start (owner-directed Issues-tab redesign —
 * the fix for the "overlapping duplicate x-axis labels" bug). The old label was
 * `toLocaleDateString()` for EVERY bucket regardless of granularity, so an "hour" bucket's many
 * same-day bars all rendered the exact same date-only text back to back ("Jul 14" · "Jul 14" ·
 * "Jul 14" · …) — reading as overlapping duplicates once `BarXAxis` laid them out. An hourly bucket
 * now carries its hour so consecutive bars are distinct; day/week buckets stay a compact month+day
 * (no year — this panel is scoped to one issue's own observed window, which rarely spans a year
 * boundary). Never fabricates a tick — this only reformats the real bucket start `BarXAxis` is
 * already given, honest with however sparse the data is.
 */
export function formatOccurrenceBucketLabel(date: Date, bucket: MetricsBucket): string {
  if (bucket === "hour") {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
    }).format(date);
  }
  if (bucket === "week") {
    return `Wk of ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date)}`;
  }
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
}

/**
 * The detail's "metrics slice" (WP5.3 spec §Design) — occurrences over time for THIS issue's exact
 * scope. REUSES the WP2.2 panel building blocks (`ChartPanel`/`ChartBox`/`PanelEmptyState`/
 * `DrillList`, `dashboard-url-state.ts`'s `bucketRangeIso`/`drillDownHref`) rather than the tightly
 * coupled `RunsErrorRatePanel` component itself: that panel's drill-down composes its RunFilter via
 * `TestingDashboardControls`/`baseRunFilter`, which has no `skillId` dimension (only
 * `providerKind`/`serverId`/`scenarioId`/`suiteId`/`model` — the Testing dashboard's own narrower
 * control set), so a SKILL-targeted issue couldn't drill into an exact filter through it. This panel
 * fetches `GET /api/metrics/runs` directly with `buildIssueRunFilter(issue)` — the FULL RunFilter
 * grammar — so the chart, its drill-down, and the detail's "open in feed" action all compose the
 * SAME exact filter (`issue-lib.ts`).
 */
export function IssueOccurrencesPanel({ issue }: { issue: FleetIssue }) {
  const filter = useMemo(() => buildIssueRunFilter(issue), [issue]);
  const bucket = resolveIssueBucket(filter);

  const { state, reload } = useLoadable(
    () => getRunMetrics({ filter, bucket, measures: ["count"] }),
    [issue.id, bucket],
  );

  const navigate = useNavigate();

  return (
    <ChartPanel
      title="Occurrences over time"
      subtitle="Runs matching this issue’s affected servers/skills/tests/models, within its observed window."
      icon={<TrendingUp aria-hidden className="size-4" />}
    >
      <OccurrencesBody
        state={state}
        bucket={bucket}
        onReload={reload}
        onDrill={(f) => navigate(drillDownHref(f))}
      />
    </ChartPanel>
  );
}

function OccurrencesBody({
  state,
  bucket,
  onReload,
  onDrill,
}: {
  state: Loadable<{ series: RunMetricsSeries[] }>;
  bucket: MetricsBucket;
  onReload: () => void;
  onDrill: (filter: RunFilter) => void;
}) {
  if (state.status === "loading") {
    return <PanelEmptyState title="Loading…" description="Fetching this issue’s run history." />;
  }
  if (state.status === "error") {
    return (
      <InlineError title="Couldn’t load occurrences" detail={state.error} onRetry={onReload} />
    );
  }

  const countSeries = state.data.series.find((s) => s.measure === "count");
  const points = countSeries?.points ?? [];
  if (points.length === 0) {
    return (
      <PanelEmptyState
        title="No matching runs found"
        description="No runs in this issue’s window matched its affected servers/skills/tests/models."
      />
    );
  }

  // Never zero-fill/interpolate missing buckets (loading-states honesty rule) — `pivotToRows` already
  // omits a bucket a series has no point for; a sparse issue's chart is sparse, not smoothed.
  const rows = pivotToRows([{ key: "count", label: "Occurrences", points }]);
  // `BarChart` is the CATEGORICAL chart (a formatted string x is correct here — unlike Line/Area/
  // Composed, which need real `Date`s; see `GuardrailStopsPanel`'s identical recipe).
  const chartRows = rows.map((row) => ({
    ...row,
    bucketLabel: formatOccurrenceBucketLabel(new Date(row.bucketStart), bucket),
  }));

  const drillRows = rows.map((row) => {
    const { from, to } = bucketRangeIso(row.bucketStart, bucket);
    const value = typeof row.count === "number" ? row.count : 0;
    return {
      key: row.bucketStart,
      label: new Date(row.bucketStart).toLocaleString(),
      value: `${formatNumber(value)} run${value === 1 ? "" : "s"}`,
      onOpen: () => onDrill({ dateFrom: from, dateTo: to }),
    };
  });

  return (
    <>
      <ChartBox>
        <BarChart
          data={chartRows as unknown as Record<string, unknown>[]}
          xDataKey="bucketLabel"
          aspectRatio="auto"
          className="h-full w-full"
          accessibleLabel="Occurrences over time"
        >
          <Grid horizontal />
          <Bar dataKey="count" fill="var(--chart-1)" />
          <BarXAxis maxLabels={8} />
          <ChartTooltip
            showDatePill={false}
            rows={(point) => [
              { color: "var(--chart-1)", label: "Occurrences", value: formatNumber(Number(point.count ?? 0)) },
            ]}
          />
        </BarChart>
      </ChartBox>
      <DrillList rows={drillRows} />
    </>
  );
}
