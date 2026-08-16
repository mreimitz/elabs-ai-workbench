import { useMemo } from "react";
import { ExternalLink, Layers } from "lucide-react";
import { Bar, BarChart, BarXAxis, ChartTooltip, Grid } from "@brand/charts";
import { Button, Text, cn } from "@brand/ui";
import type { RunFilter, RunMetricsSeries } from "@mcp-token-footprint/shared";
import { formatNumber } from "../../../lib/format";
import { drillDownFilter, type TestingDashboardControls } from "./dashboard-url-state";
import { buildTokensResult, type CapabilityClassSeries } from "./metrics-derive";
import { ChartPanel, PanelEmptyState } from "./panel-shell";

/**
 * Panel 4 — Tokens by capability class (D-OB14: NEVER blended). `tokensIn`/`tokensOut` each render
 * as GROUPED (never stacked) bars, one per capability class present — stacking would visually imply
 * a summed total across an accounting-fidelity boundary (an "exact" provider-metered count next to
 * an "estimated" local one), which is exactly what D-OB14 forbids.
 *
 * Drill-down note: a capability class (`exact`/`estimated`/…) is an ACCOUNTING FACET, not a
 * `RunFilter` dimension — there is no "runs with estimated tokens" filter to scope to, so per-class
 * rows would all navigate to the identical destination (a misleading multi-button UI). Instead: a
 * non-interactive legend (the honest per-class totals) plus ONE real drill action for the panel's
 * whole window/filter, in the panel header.
 */
export function TokensPanel({
  series,
  controls,
  onDrill,
}: {
  series: RunMetricsSeries[];
  controls: TestingDashboardControls;
  onDrill: (filter: RunFilter) => void;
}) {
  const { inRows, outRows, inClasses, outClasses, hasData } = useMemo(() => buildTokensResult(series), [series]);

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
          <TokenDirection title="Input" rows={inRows} classes={inClasses} />
          <TokenDirection title="Output" rows={outRows} classes={outClasses} />
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
}: {
  title: string;
  rows: ReturnType<typeof buildTokensResult>["inRows"];
  classes: CapabilityClassSeries[];
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
        >
          <Grid horizontal />
          {classes.map((c, i) => (
            <Bar key={c.cls} dataKey={c.cls} fill={`var(--chart-${(i % 5) + 1})`} />
          ))}
          <BarXAxis maxLabels={6} />
          <ChartTooltip
            showDatePill={false}
            rows={(point) =>
              classes.map((c, i) => ({
                color: `var(--chart-${(i % 5) + 1})`,
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
            <span className={cn("size-2.5 shrink-0 rounded-sm", `bg-chart-${(i % 5) + 1}`)} aria-hidden />
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
