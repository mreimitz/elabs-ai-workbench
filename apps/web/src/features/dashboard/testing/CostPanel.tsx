import { useMemo } from "react";
import { Coins, ExternalLink } from "lucide-react";
import { Bar, BarChart, BarXAxis, ChartTooltip, Grid } from "@elabs-ai/components-charts";
import { Button, Separator, Text } from "@elabs-ai/components-ui";
import type { RunFilter, RunMetricsSeries } from "@mcp-token-footprint/shared";
import { chartSeriesColor, chartSwatchStyle } from "../../../lib/chart-colors";
import { formatCostUsd, formatNumber } from "../../../lib/format";
import { drillDownFilter, type TestingDashboardControls } from "./dashboard-url-state";
import { buildCostResult } from "./metrics-derive";
import { ChartPanel, PanelEmptyState } from "./panel-shell";

/**
 * Panel 5 — Cost by cost-basis (D-OB14: NEVER blended), plus Questions as its OWN unit. `$ exact`
 * (API-metered) and `$ est. subscription` are DIFFERENT accounting fidelities — grouped (never
 * stacked) bars, same reasoning as `TokensPanel`. A non-dollar cost basis is not
 * a dollar figure at all, so it gets its own separate mini chart/total rather than being folded into
 * the `$` axis — mixing the two units into one number would be a worse blend than any capability-
 * class merge. Drill-down mirrors `TokensPanel`: cost basis isn't a `RunFilter` dimension, so the
 * action is ONE "Open runs" affordance for the panel's window/filter, not per-class buttons.
 */
export function CostPanel({
  series,
  controls,
  onDrill,
}: {
  series: RunMetricsSeries[];
  controls: TestingDashboardControls;
  onDrill: (filter: RunFilter) => void;
}) {
  const { costRows, costClasses, hasData } = useMemo(() => buildCostResult(series), [series]);

  const costChartRows = costRows.map((r) => ({ ...r, bucketLabel: new Date(r.bucketStart).toLocaleDateString() }));

  return (
    <ChartPanel
      title="Cost by basis"
      subtitle="$ exact vs $ est. subscription — one total per cost basis"
      icon={<Coins aria-hidden className="size-4" />}
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
        <div className="flex flex-col gap-4">
          {costClasses.length > 0 ? (
            <div className="flex flex-col gap-2">
              <div className="h-48 w-full">
                <BarChart
                  data={costChartRows as unknown as Record<string, unknown>[]}
                  xDataKey="bucketLabel"
                  aspectRatio="auto"
                  className="h-full w-full"
                  accessibleLabel="Cost by basis over time"
                >
                  <Grid horizontal />
                  {costClasses.map((c, i) => (
                    <Bar key={c.cls} dataKey={c.cls} fill={chartSeriesColor(i)} />
                  ))}
                  <BarXAxis maxLabels={6} />
                  <ChartTooltip
                    showDatePill={false}
                    rows={(point) =>
                      costClasses.map((c, i) => ({
                        color: chartSeriesColor(i),
                        label: c.label,
                        value: formatCostUsd(Number(point[c.cls] ?? 0)),
                      }))
                    }
                  />
                </BarChart>
              </div>
              <ul className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-2">
                {costClasses.map((c, i) => (
                  <li key={c.cls} className="flex items-center gap-1.5">
                    <span className="size-2.5 shrink-0 rounded-sm" style={chartSwatchStyle(i)} aria-hidden />
                    <Text variant="meta" tone="muted">
                      {c.label}
                    </Text>
                    <Text variant="meta" className="tabular-nums">
                      {formatCostUsd(c.total)}
                    </Text>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <PanelEmptyState title="No $ cost in this window" description="No API-metered or subscription-reference cost recorded." />
          )}

        </div>
      ) : (
        <PanelEmptyState title="No cost data" description="Cost figures appear once a run in this window carries usage." />
      )}
    </ChartPanel>
  );
}
