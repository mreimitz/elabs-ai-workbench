import { useCallback, useMemo } from "react";
import { ShieldAlert } from "lucide-react";
import { Bar, BarChart, BarXAxis, ChartTooltip, Grid } from "@elabs-ai/components-charts";
import type { RunFilter, RunMetricsSeries, StopReasonCode } from "@mcp-token-footprint/shared";
import { chartSeriesColor } from "../../../lib/chart-colors";
import { formatNumber } from "../../../lib/format";
import { drillDownFilter, type TestingDashboardControls } from "./dashboard-url-state";
import { DrillList } from "./DrillList";
import { buildGuardrailStopRows } from "./metrics-derive";
import { DASHBOARD_PANEL_IDS } from "./panel-anchor";
import { ChartBox, ChartPanel, PanelEmptyState } from "./panel-shell";

/**
 * Panel 2 — Guardrail stops by `stopReasonCode` (stacked). `BarChart` is the CATEGORICAL chart
 * (string x is fine, per the GOTCHA — unlike Line/Area/Composed which need real `Date`s), so the
 * bucket label is a formatted string here. Stacking here is legitimate: this is the EXPLICITLY
 * requested "total stops broken into reasons" visualization, not a capability-class blend (D-OB14
 * governs `tokensIn`/`tokensOut`/`costUsd`/`questions` only — see `TokensPanel`/`CostPanel`).
 *
 * Drill-down: activating a bar (pointer or keyboard) opens the runs feed scoped to THAT bar's
 * `stopReasonCode` — the identical filter the breakdown row for the same reason composes, so the
 * two entry points can never disagree. The breakdown list stays: its rows are per-REASON totals
 * across the whole window, which no single bar expresses, and it is where each code's humanized
 * label is actually readable without hovering.
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

  /** The ONE place a reason resolves to a filter — the chart's datapoint click and the breakdown
   *  row below both go through this, so they cannot drift apart. */
  const drillToCode = useCallback(
    (code: string) => onDrill(drillDownFilter(controls, { stopReasonCode: [code as StopReasonCode] })),
    [controls, onDrill],
  );

  const drillRows = useMemo(
    () =>
      codes.map((code) => {
        const total = rows.reduce((sum, r) => sum + (typeof r[code] === "number" ? (r[code] as number) : 0), 0);
        return {
          key: code,
          label: labels[code] ?? code,
          value: `${formatNumber(total)} stops`,
          onOpen: () => drillToCode(code),
        };
      }),
    [codes, rows, labels, drillToCode],
  );

  return (
    <ChartPanel
      title="Guardrail stops by reason"
      panelId={DASHBOARD_PANEL_IDS.guardrailStops}
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
              onDatapointClick={(point) => {
                const code = String(point.seriesKey ?? "");
                if (!codes.includes(code)) return;
                drillToCode(code);
              }}
              // The default accessible name would read the raw `stopReasonCode`; the panel already
              // owns the humanized label the breakdown list shows.
              datapointLabel={(point) => {
                const code = String(point.seriesKey ?? "");
                const when = String(point.category ?? "");
                return `${labels[code] ?? code}, ${when}: ${formatNumber(Number(point.value ?? 0))} stops`;
              }}
            >
              <Grid horizontal />
              {codes.map((code, i) => (
                <Bar key={code} dataKey={code} fill={chartSeriesColor(i)} />
              ))}
              <BarXAxis maxLabels={8} />
              <ChartTooltip
                showDatePill={false}
                rows={(point) =>
                  codes.map((code, i) => ({
                    color: chartSeriesColor(i),
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
