import { useEffect, useMemo, useState } from "react";
import type {
  DashboardChart,
  DashboardChartConfig,
  DashboardChartInput,
  DashboardChartScanMeasure,
  DashboardChartSource,
  DashboardChartType,
  MetricsBucket,
  RunFilter,
  RunMetricsGroupBy,
  RunMetricsMeasure,
} from "@mcp-token-footprint/shared";
import {
  DASHBOARD_CHART_MAX_MEASURES,
  DASHBOARD_CHART_SCAN_MEASURE_UNITS,
  DASHBOARD_CHART_SCAN_MEASURES,
  DASHBOARD_CHART_TYPES,
  METRICS_BUCKETS,
  RUN_METRICS_GROUP_BY,
  RUN_METRICS_MEASURE_UNITS,
  RUN_METRICS_MEASURES,
} from "@mcp-token-footprint/shared";
import {
  Alert,
  AlertDescription,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Text,
  ToggleGroup,
  ToggleGroupItem,
  toast,
} from "@brand/ui";
import { DialogSection, type WideDialogSection, WideDialog } from "../../../components/dialogs";
import { FieldRow } from "../../../components/FieldRow";
import { SegmentedField } from "../../../components/form";
import {
  ApiError,
  createDashboardChart,
  listScenarios,
  listServers,
  listSkills,
  listSuites,
  updateDashboardChart,
} from "../../../lib/api";
import { getErrorMessage } from "../../../lib/errors";
import { EMPTY_RUN_FILTER_OPTIONS, RunFilterBar, type RunFilterOptionData } from "../../testing/runs/RunFilterBar";
import { CustomChartCanvas } from "./CustomChartCanvas";
import type { TestingDashboardControls } from "./dashboard-url-state";
import { humanizeMeasure } from "./metrics-derive";
import { type ChartGroupLabelCatalog, useCustomChartData } from "./use-custom-chart-data";

export type ChartComposerMode = "create" | "edit";

/**
 * Custom chart composer dialog (WP 2.7) — create/edit share this `WideDialog`. Two sections:
 * "Configure" (name, source, chart type, bucket, the SAME-UNIT measure picker, groupBy/server scope,
 * and — for a `runs` chart — the REUSED WP2.3 `RunFilterBar`) and "Preview" (a LIVE render against
 * `/api/metrics/*` via the SAME `useCustomChartData` hook the persisted panel uses, composed with the
 * dashboard's current global controls — D-OB22's documented AND composition rule). No client-side
 * aggregation anywhere: the preview renders exactly what the metrics service returns.
 */
export function ChartComposerDialog({
  open,
  onOpenChange,
  mode,
  chart,
  controls,
  catalog,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: ChartComposerMode;
  /** The source chart for `edit`; `null` for `create`. */
  chart: DashboardChart | null;
  /** The dashboard's CURRENT global controls — composed into the live preview (never persisted). */
  controls: TestingDashboardControls;
  catalog: ChartGroupLabelCatalog;
  onSaved: (chart: DashboardChart) => void;
}) {
  const [state, setState] = useState<ChartFormState>(emptyFormState());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [issues, setIssues] = useState<{ path: (string | number)[]; message: string }[] | null>(null);
  const [activeSectionId, setActiveSectionId] = useState("configure");
  const filterOptions = useChartFilterOptions(open);

  useEffect(() => {
    if (!open) return;
    setState(mode === "edit" && chart ? chartToFormState(chart) : emptyFormState());
    setFormError(null);
    setIssues(null);
    setActiveSectionId("configure");
    setSaving(false);
  }, [open, mode, chart]);

  const activeMeasures = state.source === "runs" ? state.runsMeasures : state.scansMeasures;
  const draftConfig = useMemo(() => toDashboardChartConfig(state), [state]);

  async function handleSave() {
    setFormError(null);
    setIssues(null);
    if (!state.name.trim()) {
      setFormError("Name is required.");
      setActiveSectionId("configure");
      return;
    }
    if (activeMeasures.length === 0) {
      setFormError("Select at least one measure.");
      setActiveSectionId("configure");
      return;
    }
    setSaving(true);
    try {
      const input = toDashboardChartInput(state);
      const saved = mode === "edit" && chart ? await updateDashboardChart(chart.id, input) : await createDashboardChart(input);
      onOpenChange(false);
      onSaved(saved);
      toast.success(mode === "edit" ? "Chart updated" : "Chart created", { description: saved.name });
    } catch (err) {
      setActiveSectionId("configure");
      if (err instanceof ApiError && err.issues) {
        setIssues(err.issues);
        setFormError(err.message);
      } else {
        setFormError(`Couldn’t save the chart. ${getErrorMessage(err)} Try again.`);
      }
    } finally {
      setSaving(false);
    }
  }

  const sections: WideDialogSection[] = [
    {
      id: "configure",
      label: "Configure",
      content: (
        <ConfigureSection
          state={state}
          onChange={setState}
          options={filterOptions}
          formError={formError}
          issues={issues}
        />
      ),
    },
    {
      id: "preview",
      label: "Preview",
      content: <PreviewSection config={draftConfig} controls={controls} catalog={catalog} />,
    },
  ];

  return (
    <WideDialog
      open={open}
      onOpenChange={onOpenChange}
      title={mode === "edit" ? `Edit ${chart?.name ?? "chart"}` : "New chart"}
      description="Pick a measure, an optional filter/group-by, and a chart type — the live preview updates as you go."
      sections={sections}
      activeSectionId={activeSectionId}
      onActiveSectionChange={setActiveSectionId}
      primaryLabel={mode === "edit" ? "Save changes" : "Create chart"}
      onSubmit={() => void handleSave()}
      busy={saving}
      submitDisabled={saving || !state.name.trim() || activeMeasures.length === 0}
    />
  );
}

// ── Form state ───────────────────────────────────────────────────────────────────────────────────

type ChartFormState = {
  name: string;
  source: DashboardChartSource;
  chartType: DashboardChartType;
  bucket: MetricsBucket;
  runsMeasures: RunMetricsMeasure[];
  scansMeasures: DashboardChartScanMeasure[];
  groupBy: RunMetricsGroupBy | undefined;
  filter: RunFilter;
  serverId: string | undefined;
};

function emptyFormState(): ChartFormState {
  return {
    name: "",
    source: "runs",
    chartType: "line",
    bucket: "day",
    runsMeasures: [],
    scansMeasures: [],
    groupBy: undefined,
    filter: {},
    serverId: undefined,
  };
}

function chartToFormState(chart: DashboardChart): ChartFormState {
  const base = emptyFormState();
  const config = chart.config;
  if (config.source === "runs") {
    return {
      ...base,
      name: chart.name,
      source: "runs",
      chartType: config.chartType,
      bucket: config.bucket,
      runsMeasures: config.measures,
      groupBy: config.groupBy,
      filter: config.filter,
    };
  }
  return {
    ...base,
    name: chart.name,
    source: "scans",
    chartType: config.chartType,
    bucket: config.bucket,
    scansMeasures: config.measures,
    serverId: config.serverId,
  };
}

function toDashboardChartConfig(state: ChartFormState): DashboardChartConfig {
  if (state.source === "runs") {
    return {
      source: "runs",
      measures: state.runsMeasures,
      filter: state.filter,
      groupBy: state.groupBy,
      bucket: state.bucket,
      chartType: state.chartType,
    };
  }
  return {
    source: "scans",
    measures: state.scansMeasures,
    serverId: state.serverId,
    bucket: state.bucket,
    chartType: state.chartType,
  };
}

function toDashboardChartInput(state: ChartFormState): DashboardChartInput {
  return { name: state.name.trim(), config: toDashboardChartConfig(state) };
}

// ── "Configure" section ─────────────────────────────────────────────────────────────────────────

function ConfigureSection({
  state,
  onChange,
  options,
  formError,
  issues,
}: {
  state: ChartFormState;
  onChange: (next: ChartFormState) => void;
  options: RunFilterOptionData;
  formError: string | null;
  issues: { path: (string | number)[]; message: string }[] | null;
}) {
  const patch = (partial: Partial<ChartFormState>) => onChange({ ...state, ...partial });

  return (
    <div className="flex flex-col gap-5">
      {formError ? (
        <Alert variant="destructive">
          <AlertDescription>
            {formError}
            {issues && issues.length > 0 ? (
              <ul className="mt-1.5 list-inside list-disc">
                {issues.map((issue, index) => (
                  <li key={index}>
                    {issue.path.length > 0 ? `${issue.path.join(".")}: ` : ""}
                    {issue.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      <DialogSection title="Identity">
        <FieldRow id="chart-name" label="Name">
          <Input
            id="chart-name"
            value={state.name}
            placeholder="Error rate by model…"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => patch({ name: event.target.value })}
          />
        </FieldRow>
      </DialogSection>

      <DialogSection title="Source & type">
        <div className="grid gap-4 sm:grid-cols-2">
          <SegmentedField
            id="chart-source"
            label="Data source"
            value={state.source}
            onChange={(value) => patch({ source: value as DashboardChartSource })}
            options={[
              { value: "runs", label: "Runs" },
              { value: "scans", label: "Scans" },
            ]}
          />
          <SegmentedField
            id="chart-type"
            label="Chart type"
            value={state.chartType}
            onChange={(value) => patch({ chartType: value as DashboardChartType })}
            options={DASHBOARD_CHART_TYPES.map((t) => ({ value: t, label: t[0]?.toUpperCase() + t.slice(1) }))}
          />
          <FieldRow id="chart-bucket" label="Bucket">
            <Select value={state.bucket} onValueChange={(value) => patch({ bucket: value as MetricsBucket })}>
              <SelectTrigger id="chart-bucket">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {METRICS_BUCKETS.map((bucket) => (
                  <SelectItem key={bucket} value={bucket}>
                    {bucket}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldRow>
          {state.source === "runs" ? (
            <FieldRow id="chart-groupby" label="Group by (optional)">
              <Select
                value={state.groupBy ?? "__none__"}
                onValueChange={(value) =>
                  patch({ groupBy: value === "__none__" ? undefined : (value as RunMetricsGroupBy) })
                }
              >
                <SelectTrigger id="chart-groupby">
                  <SelectValue placeholder="Ungrouped" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Ungrouped</SelectItem>
                  {RUN_METRICS_GROUP_BY.map((dimension) => (
                    <SelectItem key={dimension} value={dimension}>
                      {dimension}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldRow>
          ) : (
            <FieldRow id="chart-server" label="Server (optional)">
              <Select
                value={state.serverId ?? "__all__"}
                onValueChange={(value) => patch({ serverId: value === "__all__" ? undefined : value })}
              >
                <SelectTrigger id="chart-server">
                  <SelectValue placeholder="All servers" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All servers</SelectItem>
                  {options.servers.map((server) => (
                    <SelectItem key={server.value} value={server.value}>
                      {server.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldRow>
          )}
        </div>
      </DialogSection>

      <DialogSection title="Measures" description="Same-unit measures only — never a mixed axis.">
        {state.source === "runs" ? (
          <MeasurePicker
            id="chart-measures-runs"
            values={RUN_METRICS_MEASURES}
            units={RUN_METRICS_MEASURE_UNITS}
            selected={state.runsMeasures}
            onChange={(next) => patch({ runsMeasures: next })}
          />
        ) : (
          <MeasurePicker
            id="chart-measures-scans"
            values={DASHBOARD_CHART_SCAN_MEASURES}
            units={DASHBOARD_CHART_SCAN_MEASURE_UNITS}
            selected={state.scansMeasures}
            onChange={(next) => patch({ scansMeasures: next })}
          />
        )}
      </DialogSection>

      {state.source === "runs" ? (
        <DialogSection title="Filter" description="Extra constraints for THIS chart — composed (AND) with the dashboard's global filter above it.">
          <RunFilterBar filter={state.filter} onChange={(filter) => patch({ filter })} options={options} />
        </DialogSection>
      ) : null}
    </div>
  );
}

function MeasurePicker<M extends string>({
  id,
  values,
  units,
  selected,
  onChange,
}: {
  id: string;
  values: readonly M[];
  units: Record<M, string>;
  selected: M[];
  onChange: (next: M[]) => void;
}) {
  const selectedUnit = selected.length > 0 ? units[selected[0] as M] : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <Label id={`${id}-label`}>Measures</Label>
      <ToggleGroup
        type="multiple"
        value={selected}
        onValueChange={(next) => onChange(next as M[])}
        aria-labelledby={`${id}-label`}
        className="flex flex-wrap justify-start gap-1.5"
      >
        {values.map((value) => {
          const isSelected = selected.includes(value);
          const wrongUnit = selectedUnit !== undefined && units[value] !== selectedUnit;
          const atCap = selected.length >= DASHBOARD_CHART_MAX_MEASURES;
          const disabled = !isSelected && (wrongUnit || atCap);
          return (
            <ToggleGroupItem key={value} value={value} disabled={disabled} aria-label={humanizeMeasure(value)}>
              {humanizeMeasure(value)}
            </ToggleGroupItem>
          );
        })}
      </ToggleGroup>
      <Text variant="meta" tone="muted">
        {selectedUnit
          ? `Only "${selectedUnit}" measures can join this chart. Up to ${DASHBOARD_CHART_MAX_MEASURES}.`
          : `Pick up to ${DASHBOARD_CHART_MAX_MEASURES} measures that share one unit.`}
      </Text>
    </div>
  );
}

// ── "Preview" section — live, against the SAME hook the persisted panel uses ───────────────────────

function PreviewSection({
  config,
  controls,
  catalog,
}: {
  config: DashboardChartConfig;
  controls: TestingDashboardControls;
  catalog: ChartGroupLabelCatalog;
}) {
  const data = useCustomChartData(config, controls, catalog);
  return (
    <div className="flex flex-col gap-3">
      <Text variant="meta" tone="muted">
        Composed with the dashboard's current date range + global filter (AND) — live against{" "}
        {config.source === "runs" ? "GET /api/metrics/runs" : "GET /api/metrics/scans"}.
      </Text>
      <div className="h-72 w-full">
        <CustomChartCanvas
          chartType={config.chartType}
          unit={data.unit}
          loading={data.loading}
          error={data.error}
          rows={data.rows}
          series={data.series}
          hasData={data.hasData}
          onRetry={data.reload}
          emptyTitle="No preview yet"
          emptyDescription="Select at least one measure to see a live preview."
        />
      </div>
    </div>
  );
}

// ── Filter-bar option data — a THIN, self-contained resolver (mirrors the watch rules editor's own
// `use-run-filter-options.ts`: reproduced here rather than cross-imported, so this composer doesn't
// depend on another feature cluster's internals). Best-effort: a failed fetch just leaves that
// dimension's options empty, never blocks the dialog. ──────────────────────────────────────────────

function useChartFilterOptions(active: boolean): RunFilterOptionData {
  const [options, setOptions] = useState<RunFilterOptionData>(EMPTY_RUN_FILTER_OPTIONS);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    Promise.all([listScenarios(), listSuites(), listServers(), listSkills()])
      .then(([scenarios, suites, servers, skills]) => {
        if (!alive) return;
        const environments = scenarios
          .map((s) => ({ value: s.id, label: s.name }))
          .sort((a, b) => a.label.localeCompare(b.label));
        const models = [...new Set(scenarios.map((s) => s.model).filter((m): m is string => Boolean(m)))]
          .sort((a, b) => a.localeCompare(b))
          .map((m) => ({ value: m, label: m }));
        setOptions({
          environments,
          models,
          servers: servers.map((s) => ({ value: s.id, label: s.name })),
          suites: suites.map((s) => ({ value: s.id, label: s.name })),
          skills: skills.map((s) => ({ value: s.id, label: s.displayName || s.name })),
        });
      })
      .catch(() => {
        // Best-effort — the filter bar / server picker just show fewer options.
      });
    return () => {
      alive = false;
    };
  }, [active]);

  return options;
}
