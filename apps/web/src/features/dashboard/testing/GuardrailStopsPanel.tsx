import { useMemo } from "react";
import { ShieldAlert } from "lucide-react";
import { Bar, BarChart, BarXAxis, ChartTooltip, Grid } from "@brand/charts";
import type { RunFilter, RunMetricsSeries, StopReasonCode } from "@mcp-token-footprint/shared";
import { formatNumber } from "../../../lib/format";
import { drillDownFilter, type TestingDashboardControls } from "./dashboard-url-state";
import { DrillList } from "./DrillList";
import { buildGuardrailStopRows } from "./metrics-derive";
import { ChartBox, ChartPanel, PanelEmptyState } from "./panel-shell";

/**
 * Panel 2 — Guardrail stops by `stopReasonCode` (stacked). `BarChart` is the CATEGORICAL chart
 * (string x is fine, per the GOTCHA — unlike Line/Area/Composed which need real `Date`s), so the
 * bucket label is a formatted string here. Stacking here is legitimate: this is the EXPLICITLY
 * requested "total stops broken into reasons" visualization, not a capability-class blend (D-OB14
 * governs `tokensIn`/`tokensOut`/`costUsd`/`questions` only — see `TokensPanel`/`CostPanel`).
 */
export function GuardrailStopsPanel({
  series,
  controls,
  onDrill,
}: {
  series: RunMetricsSeries[];
  controls: TestingDashboardControls;
  onDrill: (filter: RunFilter) => void;
}) {
  const { rows, codes, labels, hasData } = useMemo(() => buildGuardrailStopRows(series), [series]);
  const chartRows = useMemo(
    () => rows.map((r) => ({ ...r, bucketLabel: new Date(r.bucketStart).toLocaleDateString() })),
    [rows],
  );

  const drillRows = useMemo(
    () =>
      codes.map((code, i) => {
        const total = rows.reduce((sum, r) => sum + (typeof r[code] === "number" ? (r[code] as number) : 0), 0);
        return {
          key: code,
          label: labels[code] ?? code,
          value: `${formatNumber(total)} stops`,
          onOpen: () => onDrill(drillDownFilter(controls, { stopReasonCode: [code as StopReasonCode] })),
        };
      }),
    [codes, rows, labels, controls, onDrill],
  );

  return (
    <ChartPanel
      title="Guardrail stops by reason"
      subtitle="Stacked stop count per stopReasonCode"
      icon={<ShieldAlert aria-hidden className="size-4" />}
    >
      {hasData ? (
        <>
          <ChartBox>
            <BarChart
              data={chartRows as unknown as Record<string, unknown>[]}
              xDataKey="bucketLabel"
              stacked
              aspectRatio="auto"
              className="h-full w-full"
              accessibleLabel="Guardrail stops by reason, stacked over time"
            >
              <Grid horizontal />
              {codes.map((code, i) => (
                <Bar key={code} dataKey={code} fill={`var(--chart-${(i % 5) + 1})`} />
              ))}
              <BarXAxis maxLabels={8} />
              <ChartTooltip
                showDatePill={false}
                rows={(point) =>
                  codes.map((code, i) => ({
                    color: `var(--chart-${(i % 5) + 1})`,
                    label: labels[code] ?? code,
                    value: formatNumber(Number(point[code] ?? 0)),
                  }))
                }
              />
            </BarChart>
          </ChartBox>
          <DrillList rows={drillRows} />
        </>
      ) : (
        <PanelEmptyState
          title="No guardrail stops"
          description="No run in this window was stopped by a guardrail — nothing to break down."
        />
      )}
    </ChartPanel>
  );
}
