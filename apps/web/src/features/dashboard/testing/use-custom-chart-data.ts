import { useEffect, useState } from "react";
import type { DashboardChartConfig, RunFilter, RunMetricsMeasure } from "@mcp-token-footprint/shared";
import { DASHBOARD_CHART_SCAN_MEASURE_UNITS, RUN_METRICS_MEASURE_UNITS } from "@mcp-token-footprint/shared";
import { getRunMetrics, getScanMetrics } from "../../../lib/api";
import { getErrorMessage } from "../../../lib/errors";
import {
  composeChartRunFilterForControls,
  composeChartScanServerId,
} from "./custom-chart-query";
import { type TestingDashboardControls, metricsWindow } from "./dashboard-url-state";
import {
  buildGenericRunSeriesRows,
  buildGenericScanSeriesRows,
  COST_CLASS_LABELS,
  type GenericChartResult,
  humanize,
  TOKEN_CLASS_LABELS,
} from "./metrics-derive";

/**
 * Custom chart composer (WP 2.7) — the ONE fetch+pivot hook shared by BOTH the persisted
 * `CustomChartPanel` and the composer dialog's live preview, so a saved chart re-renders IDENTICALLY
 * whether it's being previewed or displayed after a reload (same hook, same query composition, same
 * generic pivot). Calls `/api/metrics/{runs,scans}` DIRECTLY with the composed query — no separate
 * preview endpoint, no client-side aggregation (this hook only PIVOTS the response's own series/points
 * into chart rows; every number is the metrics service's own).
 */

export type CustomChartData = {
  /** True until the FIRST fetch for the current `config`/`controls` settles. */
  loading: boolean;
  error: string | null;
  rows: GenericChartResult["rows"];
  series: GenericChartResult["series"];
  hasData: boolean;
  /** The unit every selected measure shares (same-unit constraint) — drives axis/tooltip formatting. */
  unit: string;
  /** Re-fire the SAME query (a terminal-error retry action — mirrors `useTestingMetrics`'s `reload`). */
  reload: () => void;
};

export type ChartGroupLabelCatalog = {
  serverName?: (id: string) => string;
  suiteName?: (id: string) => string;
  testName?: (id: string) => string;
  environmentName?: (id: string) => string;
};

const EMPTY: Omit<CustomChartData, "loading" | "error" | "unit" | "reload"> = {
  rows: [],
  series: [],
  hasData: false,
};

function capabilityClassLabel(measure: RunMetricsMeasure, cls: string): string {
  if (measure === "costUsd") {
    return (COST_CLASS_LABELS as Record<string, string>)[cls] ?? humanize(cls);
  }
  if (measure === "tokensIn" || measure === "tokensOut") {
    return (TOKEN_CLASS_LABELS as Record<string, string>)[cls] ?? humanize(cls);
  }
  return humanize(cls); // `questions` — a single, self-describing class
}

// Narrow on `config.source` FIRST, then index `measures[0]` inside each branch — indexing before
// narrowing would leave `first` typed as the UNION of both measure vocabularies (TS can't correlate
// a separately-extracted variable back to the discriminant), which neither lookup map accepts.
function unitFor(config: DashboardChartConfig): string {
  if (config.source === "runs") {
    const first = config.measures[0];
    return first === undefined ? "count" : (RUN_METRICS_MEASURE_UNITS[first] ?? "count");
  }
  const first = config.measures[0];
  return first === undefined ? "count" : (DASHBOARD_CHART_SCAN_MEASURE_UNITS[first] ?? "count");
}

/** Resolve a `RunMetricsGroupBy` group value's label via whichever catalog lookup applies —
 *  duplicated here (not imported) as a THIN wrapper so this hook stays the single call site that
 *  knows how `groupLabel`/`resolveGroupLabel` compose; see `metrics-derive.ts`'s `resolveGroupLabel`
 *  for the actual per-dimension resolution rules. */
function makeGroupLabel(
  config: Extract<DashboardChartConfig, { source: "runs" }>,
  catalog: ChartGroupLabelCatalog,
): ((group: string) => string) | undefined {
  if (config.groupBy === undefined) return undefined;
  const groupBy = config.groupBy;
  return (group: string) => {
    if (groupBy === "server" && catalog.serverName) return catalog.serverName(group);
    if (groupBy === "suite" && catalog.suiteName) return catalog.suiteName(group);
    if (groupBy === "test" && catalog.testName) return catalog.testName(group);
    if (groupBy === "environment" && catalog.environmentName) return catalog.environmentName(group);
    return group;
  };
}

export function useCustomChartData(
  config: DashboardChartConfig,
  controls: TestingDashboardControls,
  catalog: ChartGroupLabelCatalog = {},
): CustomChartData {
  const [state, setState] = useState<Omit<CustomChartData, "reload">>({
    loading: true,
    error: null,
    unit: unitFor(config),
    ...EMPTY,
  });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState((prev) => ({ ...prev, loading: true, error: null, unit: unitFor(config) }));

    // Guard against an in-progress DRAFT config (the composer dialog calls this hook with the live
    // form state, which is momentarily invalid while the operator is still picking measures) — never
    // fire a request the API would 400 on; just report the honest empty state instead.
    if (config.measures.length === 0) {
      setState({ loading: false, error: null, unit: unitFor(config), ...EMPTY });
      return;
    }

    if (config.source === "runs") {
      const filter: RunFilter = composeChartRunFilterForControls(controls, config.filter);
      getRunMetrics(
        { filter, bucket: config.bucket, groupBy: config.groupBy, measures: config.measures },
        controller.signal,
      )
        .then((response) => {
          if (controller.signal.aborted) return;
          const result = buildGenericRunSeriesRows(
            response.series,
            config.measures.length,
            makeGroupLabel(config, catalog),
            capabilityClassLabel,
          );
          setState({ loading: false, error: null, unit: unitFor(config), ...result });
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
          setState((prev) => ({ ...prev, loading: false, error: getErrorMessage(err) }));
        });
    } else {
      const window = metricsWindow(controls);
      const serverId = composeChartScanServerId(controls, config.serverId);
      getScanMetrics({ from: window.from, to: window.to, bucket: config.bucket, serverId }, controller.signal)
        .then((response) => {
          if (controller.signal.aborted) return;
          const result = buildGenericScanSeriesRows(response.servers, config.measures);
          setState({ loading: false, error: null, unit: unitFor(config), ...result });
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
          setState((prev) => ({ ...prev, loading: false, error: getErrorMessage(err) }));
        });
    }

    return () => controller.abort();
    // Depend on the SERIALIZED shape (config/controls are fresh objects per render from the caller) so
    // the effect only re-fires on an ACTUAL change — mirrors `useTestingMetrics`'s own guard
    // (`useExhaustiveDependencies` is off repo-wide, see biome.json).
  }, [JSON.stringify(config), JSON.stringify(controls), nonce]);

  return { ...state, reload: () => setNonce((n) => n + 1) };
}
