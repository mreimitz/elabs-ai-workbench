import { useMemo } from "react";
import { Database } from "lucide-react";
import { ChartTooltip, Grid, Line, LineChart, XAxis } from "@elabs-ai/components-charts";
import type { ScanMetricsSeries } from "@mcp-token-footprint/shared";
import { formatNumber } from "../../../lib/format";
import { DrillList } from "./DrillList";
import { buildScansStripResult } from "./metrics-derive";
import { ChartBox, ChartPanel, PanelEmptyState } from "./panel-shell";

/**
 * Panel 8 — Scans strip: whole-surface footprint tokens over time, per server (from
 * `GET /api/metrics/scans`). This is server FOOTPRINT data, not run data — its natural drill target
 * is the server detail page (`/servers/:id`, the same route `ScansTab.tsx`'s own rows open), not the
 * runs feed a `RunFilter` would scope.
 */
export function ScansStripPanel({
  series,
  onOpenServer,
}: {
  series: ScanMetricsSeries[];
  onOpenServer: (serverId: string) => void;
}) {
  const { rows, series: perServer, hasData } = useMemo(() => buildScansStripResult(series), [series]);

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
            >
              <Grid horizontal />
              {perServer.map((s, i) => (
                <Line key={s.serverId} dataKey={s.serverId} stroke={`var(--chart-${(i % 5) + 1})`} />
              ))}
              <XAxis />
              <ChartTooltip
                rows={(point) =>
                  perServer.map((s, i) => ({
                    color: `var(--chart-${(i % 5) + 1})`,
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
