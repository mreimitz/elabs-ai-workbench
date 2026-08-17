import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@elabs-ai/components-ui";
import { ArrowDown, ArrowUp, Copy, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import type { DashboardChart } from "@mcp-token-footprint/shared";
import { IconButton } from "../../../components/IconButton";
import { CustomChartCanvas } from "./CustomChartCanvas";
import type { TestingDashboardControls } from "./dashboard-url-state";
import { humanizeMeasure } from "./metrics-derive";
import { ChartPanel } from "./panel-shell";
import { type ChartGroupLabelCatalog, useCustomChartData } from "./use-custom-chart-data";

/** A one-line summary of what the chart plots ("Runs · Error rate, Guardrail rate · by model" /
 *  "Scans · Total tokens") — shown as the `ChartPanel` subtitle. */
function chartSubtitle(config: DashboardChart["config"]): string {
  const sourceLabel = config.source === "runs" ? "Runs" : "Scans";
  const measures = config.measures.map(humanizeMeasure).join(", ");
  const groupBySuffix = config.source === "runs" && config.groupBy ? ` · by ${config.groupBy}` : "";
  return `${sourceLabel} · ${measures}${groupBySuffix}`;
}

/**
 * Custom chart composer (WP 2.7) — ONE persisted chart on the Testing dashboard: fetches + pivots via
 * `useCustomChartData` (the SAME hook the composer dialog's preview uses, so a saved chart re-renders
 * identically), then renders through the shared `CustomChartCanvas`. The header carries reorder
 * (move up/down — no drag-and-drop library in the stack) + an edit/clone/delete menu.
 */
export function CustomChartPanel({
  chart,
  controls,
  catalog,
  index,
  count,
  onEdit,
  onClone,
  onDelete,
  onMoveUp,
  onMoveDown,
}: {
  chart: DashboardChart;
  controls: TestingDashboardControls;
  catalog: ChartGroupLabelCatalog;
  index: number;
  count: number;
  onEdit: () => void;
  onClone: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const data = useCustomChartData(chart.config, controls, catalog);

  return (
    <ChartPanel
      title={chart.name}
      subtitle={chartSubtitle(chart.config)}
      actions={
        <div className="flex items-center gap-1">
          <IconButton
            variant="ghost"
            size="icon-sm"
            onClick={onMoveUp}
            disabled={index === 0}
            label={`Move ${chart.name} up`}
          >
            <ArrowUp aria-hidden className="size-3.5" />
          </IconButton>
          <IconButton
            variant="ghost"
            size="icon-sm"
            onClick={onMoveDown}
            disabled={index === count - 1}
            label={`Move ${chart.name} down`}
          >
            <ArrowDown aria-hidden className="size-3.5" />
          </IconButton>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton variant="ghost" size="icon-sm" label={`More actions for ${chart.name}`}>
                <MoreHorizontal aria-hidden className="size-3.5" />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onEdit}>
                <Pencil aria-hidden />
                <span>Edit</span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onClone}>
                <Copy aria-hidden />
                <span>Clone</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={onDelete}>
                <Trash2 aria-hidden />
                <span>Delete</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      }
    >
      <CustomChartCanvas
        chartType={chart.config.chartType}
        unit={data.unit}
        loading={data.loading}
        error={data.error}
        rows={data.rows}
        series={data.series}
        hasData={data.hasData}
        onRetry={data.reload}
      />
    </ChartPanel>
  );
}
