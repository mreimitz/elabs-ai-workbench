import { useMemo } from "react";
import { Coins, ExternalLink } from "lucide-react";
import { Bar, BarChart, BarXAxis, ChartTooltip, Grid } from "@brand/charts";
import { Button, Separator, Text, cn } from "@brand/ui";
import type { RunFilter, RunMetricsSeries } from "@mcp-token-footprint/shared";
import { formatCostUsd, formatNumber } from "../../../lib/format";
import { drillDownFilter, type TestingDashboardControls } from "./dashboard-url-state";
import { buildCostResult } from "./metrics-derive";
import { ChartPanel, PanelEmptyState } from "./panel-shell";

/**
 * Panel 5 — Cost by cost-basis (D-OB14: NEVER blended), plus Questions as its OWN unit. `$ exact`
 * (API-metered) and `$ est. subscription` are DIFFERENT accounting fidelities — grouped (never
 * stacked) bars, same reasoning as `TokensPanel`. `questions` (Qlik Answers' own quota unit) is not
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
  const { costRows, costClasses, questionsRows, questionsTotal, hasData } = useMemo(
    () => buildCostResult(series),
    [series],
  );

  const costChartRows = costRows.map((r) => ({ ...r, bucketLabel: new Date(r.bucketStart).toLocaleDateString() }));
  const questionsChartRows = questionsRows.map((r) => ({
    ...r,
    bucketLabel: new Date(r.bucketStart).toLocaleDateString(),
  }));

  return (
    <ChartPanel
      title="Cost by basis"
      subtitle="$ exact vs $ est. subscription — questions are a separate unit, never summed into $"
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
                    <Bar key={c.cls} dataKey={c.cls} fill={`var(--chart-${(i % 5) + 1})`} />
                  ))}
                  <BarXAxis maxLabels={6} />
                  <ChartTooltip
                    showDatePill={false}
                    rows={(point) =>
                      costClasses.map((c, i) => ({
                        color: `var(--chart-${(i % 5) + 1})`,
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
                    <span className={cn("size-2.5 shrink-0 rounded-sm", `bg-chart-${(i % 5) + 1}`)} aria-hidden />
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

          {questionsRows.length > 0 ? (
            <>
              <Separator />
              <div className="flex flex-col gap-2">
                <Text variant="meta" tone="muted">
                  Questions (Qlik Answers usage unit — NOT a dollar figure)
                </Text>
                <div className="h-32 w-full">
                  <BarChart
                    data={questionsChartRows as unknown as Record<string, unknown>[]}
                    xDataKey="bucketLabel"
                    aspectRatio="auto"
                    className="h-full w-full"
                    accessibleLabel="Questions used over time"
                  >
                    <Grid horizontal />
                    <Bar dataKey="questions" fill="var(--chart-3)" />
                    <BarXAxis maxLabels={6} />
                    <ChartTooltip
                      showDatePill={false}
                      rows={(point) => [
                        { color: "var(--chart-3)", label: "Questions", value: formatNumber(Number(point.questions ?? 0)) },
                      ]}
                    />
                  </BarChart>
                </div>
                <Text variant="meta" tone="muted" className="tabular-nums">
                  Total: {formatNumber(questionsTotal)}
                </Text>
              </div>
            </>
          ) : null}
        </div>
      ) : (
        <PanelEmptyState title="No cost data" description="Cost figures appear once a run in this window carries usage." />
      )}
    </ChartPanel>
  );
}
