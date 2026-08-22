import { useMemo } from "react";
import { Database } from "lucide-react";
import { ChartTooltip, Grid, Line, LineChart, XAxis } from "@elabs-ai/components-charts";
import type { ScanMetricsSeries } from "@mcp-token-footprint/shared";
import { chartSeriesColor } from "../../../lib/chart-colors";
import { formatNumber } from "../../../lib/format";
import { DrillList } from "./DrillList";
import { buildScansStripResult } from "./metrics-derive";
import { DASHBOARD_PANEL_IDS } from "./panel-anchor";
import { ChartBox, ChartPanel, PanelEmptyState } from "./panel-shell";

/**
 * Panel 8 — Scans strip: whole-surface footprint tokens over time, per server (from
 * `GET /api/metrics/scans`). This is server FOOTPRINT data, not run data — its natural drill target
 * is the server detail page (`/servers/:id`, the same route `ScansTab.tsx`'s own rows open), not the
 * runs feed a `RunFilter` would scope.
 *
 * Drill-down: activating any point on a server's line (pointer or keyboard) opens THAT server's
 * detail page — the identical destination the server's row below composes, so the two entry points
 * can never disagree. The per-server list stays: it is the panel's legend (the only place a
 * server's NAME and its latest footprint are readable without hovering a line keyed by an opaque
 * server id) and it carries one row per server, not one per plotted point.
 */
export function ScansStripPanel({
  series,
  onOpenServer,
}: {
  series: ScanMetricsSeries[];
  onOpenServer: (serverId: string) => void;
}) {
  const { rows, series: perServer, hasData } = useMemo(() => buildScansStripResult(series), [series]);

  /** serverId → display name, for the chart's accessible datapoint names (a `Line`'s `dataKey` here
   *  is an opaque server id, which is not a usable name for a keyboard/screen-reader user). */
  const serverNames = useMemo(
    () => new Map(perServer.map((s) => [s.serverId, s.serverName])),
    [perServer],
  );

  const drillRows = useMemo(
    () =>
      perServer.map((s) => ({
        key: s.serverId,
        label: s.serverName,
        value: formatNumber(s.points[s.points.length - 1]?.value ?? 0),
        onOpen: () => onOpenServer(s.serverId),
      })),
    [perServer, onOpenServer],
  );

  return (
    <ChartPanel
      title="Scans strip"
      panelId={DASHBOARD_PANEL_IDS.scans}
      subtitle="Whole-surface footprint tokens (tools + resources + prompts) per server"
      icon={<Database aria-hidden className="size-4" />}
    >
      {hasData ? (
        <>
          <ChartBox>
            <LineChart
              data={rows as unknown as Record<string, unknown>[]}
              xDataKey="x"
              aspectRatio="auto"
              className="h-full w-full"
              accessibleLabel="Server footprint tokens over time"
              onDatapointClick={(point) => {
                const serverId = String(point.seriesKey ?? "");
                if (!serverNames.has(serverId)) return;
                onOpenServer(serverId);
              }}
              datapointLabel={(point) => {
                const serverId = String(point.seriesKey ?? "");
                const name = serverNames.get(serverId) ?? serverId;
                const when =
                  point.category instanceof Date ? point.category.toLocaleDateString() : String(point.category ?? "");
                return `${name}, ${when}: ${formatNumber(Number(point.value ?? 0))} tokens`;
              }}
            >
              <Grid horizontal />
              {perServer.map((s, i) => (
                <Line key={s.serverId} dataKey={s.serverId} stroke={chartSeriesColor(i)} />
              ))}
              <XAxis />
              <ChartTooltip
                rows={(point) =>
                  perServer.map((s, i) => ({
                    color: chartSeriesColor(i),
                    label: s.serverName,
                    value: point[s.serverId] != null ? formatNumber(Number(point[s.serverId])) : "no scan",
                  }))
                }
              />
            </LineChart>
          </ChartBox>
          <DrillList rows={drillRows} />
        </>
      ) : (
        <PanelEmptyState
          title="No scans in this window"
          description="Run a footprint scan on a server to see its trend here."
        />
      )}
    </ChartPanel>
  );
}
