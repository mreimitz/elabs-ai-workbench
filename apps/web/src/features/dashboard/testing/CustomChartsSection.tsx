import { useCallback, useEffect, useState } from "react";
import { Button, EmptyState, Heading, Skeleton, toast } from "@brand/ui";
import { LineChart as LineChartIcon, Plus } from "lucide-react";
import type { DashboardChart } from "@mcp-token-footprint/shared";
import { ConfirmDialog } from "../../../components/dialogs";
import { InlineError } from "../../../components/InlineError";
import {
  cloneDashboardChart,
  deleteDashboardChart,
  listDashboardCharts,
  reorderDashboardCharts,
} from "../../../lib/api";
import { getErrorMessage } from "../../../lib/errors";
import { ChartComposerDialog, type ChartComposerMode } from "./ChartComposerDialog";
import { CustomChartPanel } from "./CustomChartPanel";
import type { TestingDashboardControls } from "./dashboard-url-state";
import { PanelGrid } from "./panel-shell";
import type { ChartGroupLabelCatalog } from "./use-custom-chart-data";
import { notifyError } from "../../../lib/notify";

/**
 * Custom chart composer (WP 2.7) — the Testing dashboard's "Add chart" affordance + the operator's
 * custom panels, mounted UNDER the WP2.2 prebuilt panels (`TestingTab.tsx`). Owns the chart list +
 * the composer dialog (create/edit) + delete confirmation + reorder (move up/down — no drag-and-drop
 * library in the stack, so this is the keyboard-operable equivalent). Every panel gets the SAME
 * `controls` the prebuilt panels use, so a custom chart's global-filter composition (D-OB22's AND
 * rule) stays in sync with whatever the operator has the dashboard scoped to right now.
 */
export function CustomChartsSection({
  controls,
  catalog,
}: {
  controls: TestingDashboardControls;
  catalog: ChartGroupLabelCatalog;
}) {
  const [charts, setCharts] = useState<DashboardChart[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [composerOpen, setComposerOpen] = useState(false);
  const [composerMode, setComposerMode] = useState<ChartComposerMode>("create");
  const [composerChart, setComposerChart] = useState<DashboardChart | null>(null);

  const [pendingDelete, setPendingDelete] = useState<DashboardChart | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setCharts(await listDashboardCharts());
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    setComposerMode("create");
    setComposerChart(null);
    setComposerOpen(true);
  }

  function openEdit(chart: DashboardChart) {
    setComposerMode("edit");
    setComposerChart(chart);
    setComposerOpen(true);
  }

  function handleSaved(saved: DashboardChart) {
    setCharts((current) => {
      const exists = current.some((c) => c.id === saved.id);
      return exists ? current.map((c) => (c.id === saved.id ? saved : c)) : [...current, saved];
    });
  }

  async function handleClone(chart: DashboardChart) {
    try {
      const cloned = await cloneDashboardChart(chart.id);
      setCharts((current) => [...current, cloned]);
      toast.success("Chart cloned", { description: cloned.name });
    } catch (err) {
      notifyError("Couldn’t clone the chart.", {
        description: `${getErrorMessage(err)} Try again.`,
      });
    }
  }

  async function performDelete() {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setDeleting(true);
    try {
      await deleteDashboardChart(target.id);
      setPendingDelete(null);
      await load(); // re-fetch: positions were renumbered server-side
      toast.success("Chart deleted");
    } catch (err) {
      notifyError("Couldn’t delete the chart.", {
        description: `${getErrorMessage(err)} Try again.`,
      });
    } finally {
      setDeleting(false);
    }
  }

  async function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= charts.length) return;
    const reordered = [...charts];
    const [moved] = reordered.splice(index, 1);
    if (!moved) return;
    reordered.splice(target, 0, moved);
    const previous = charts;
    setCharts(reordered); // optimistic
    try {
      const result = await reorderDashboardCharts(reordered.map((c) => c.id));
      setCharts(result);
    } catch (err) {
      setCharts(previous);
      notifyError("Couldn’t reorder the charts.", {
        description: `${getErrorMessage(err)} Try again.`,
      });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <Heading level={2} size="subtitle">
          Custom charts
        </Heading>
        <Button variant="outline" size="sm" onClick={openCreate}>
          <Plus aria-hidden className="size-3.5" />
          <span>Add chart</span>
        </Button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Skeleton className="h-72 w-full" />
        </div>
      ) : error ? (
        <InlineError title="Couldn’t load custom charts" detail={error} onRetry={() => void load()} />
      ) : charts.length === 0 ? (
        <EmptyState
          icon={<LineChartIcon aria-hidden />}
          title="No custom charts yet"
          description="Build a chart from a measure, an optional filter/group-by, and a chart type."
          actions={
            <Button variant="outline" size="sm" onClick={openCreate}>
              <Plus aria-hidden className="size-3.5" />
              <span>Add chart</span>
            </Button>
          }
        />
      ) : (
        <PanelGrid>
          {charts.map((chart, index) => (
            <CustomChartPanel
              key={chart.id}
              chart={chart}
              controls={controls}
              catalog={catalog}
              index={index}
              count={charts.length}
              onEdit={() => openEdit(chart)}
              onClone={() => void handleClone(chart)}
              onDelete={() => setPendingDelete(chart)}
              onMoveUp={() => void move(index, -1)}
              onMoveDown={() => void move(index, 1)}
            />
          ))}
        </PanelGrid>
      )}

      <ChartComposerDialog
        open={composerOpen}
        onOpenChange={setComposerOpen}
        mode={composerMode}
        chart={composerChart}
        controls={controls}
        catalog={catalog}
        onSaved={handleSaved}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title={`Delete ${pendingDelete?.name ?? "chart"}?`}
        description="This removes the chart. It never affects the underlying runs or scans."
        confirmLabel="Delete chart"
        tone="destructive"
        busy={deleting}
        onConfirm={() => void performDelete()}
      />
    </div>
  );
}
