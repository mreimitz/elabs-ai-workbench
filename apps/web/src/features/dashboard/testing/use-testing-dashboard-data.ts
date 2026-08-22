import { useEffect, useRef, useState } from "react";
import type {
  MetricsBucket,
  RunMetricsMeasure,
  RunMetricsSeries,
  RunSummary,
  ScanMetricsSeries,
  Scenario,
  ServerConfig,
  Suite,
  Test,
} from "@mcp-token-footprint/shared";
import { getErrorMessage } from "../../../lib/errors";
import { getMostExpensiveRuns, getRunMetrics, getScanMetrics, listScenarios, listServers, listSuites, listTests } from "../../../lib/api";
import {
  baseRunFilter,
  metricsWindow,
  resolveBucketSelection,
  type TestingBucketSelection,
  type TestingDashboardControls,
} from "./dashboard-url-state";

// ── Catalog (servers/environments/suites/tests) — fetched ONCE, independent of the date/filter
// controls. Feeds the filter bar's options + the leaderboard/expensive-runs labels. ─────────────

export type TestingCatalog = {
  loading: boolean;
  error: string | null;
  servers: ServerConfig[];
  scenarios: Scenario[];
  suites: Suite[];
  tests: Test[];
};

export function useTestingCatalog(): TestingCatalog {
  const [state, setState] = useState<TestingCatalog>({
    loading: true,
    error: null,
    servers: [],
    scenarios: [],
    suites: [],
    tests: [],
  });

  useEffect(() => {
    let cancelled = false;
    Promise.all([listServers(), listScenarios(), listSuites(), listTests()])
      .then(([servers, scenarios, suites, tests]) => {
        if (cancelled) return;
        setState({ loading: false, error: null, servers, scenarios, suites, tests });
      })
      .catch((err) => {
        if (cancelled) return;
        setState((prev) => ({ ...prev, loading: false, error: getErrorMessage(err) }));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

// ── Metrics (WP 2.2) — refetches whenever the URL-persisted controls change. ────────────────────

export type TestingMetricsData = {
  runsOverTime: RunMetricsSeries[];
  guardrail: RunMetricsSeries[];
  duration: RunMetricsSeries[];
  tokens: RunMetricsSeries[];
  /** RM-33 WP 3.3 — `cacheReadTokens`/`cacheWriteTokens` (capability-split) + `cacheHitRate`. */
  cache: RunMetricsSeries[];
  /** The cache request's `unavailableMeasures`. Carried all the way to the panel because "the API
   *  could not measure this" is a DIFFERENT state from "the series is empty", and collapsing the two
   *  is what produces a 0% cache-hit line that reads as a caching regression (D-CT6). */
  cacheUnavailable: RunMetricsMeasure[];
  cost: RunMetricsSeries[];
  score: RunMetricsSeries[];
  failingTests: RunMetricsSeries[];
  failingServers: RunMetricsSeries[];
  expensiveRuns: RunSummary[];
  scans: ScanMetricsSeries[];
};

const EMPTY_METRICS_DATA: TestingMetricsData = {
  runsOverTime: [],
  guardrail: [],
  duration: [],
  tokens: [],
  cache: [],
  cacheUnavailable: [],
  cost: [],
  score: [],
  failingTests: [],
  failingServers: [],
  expensiveRuns: [],
  scans: [],
};

export type UseTestingMetricsResult = {
  /** True until the FIRST fetch for the CURRENT mount settles (drives the full-panel skeleton). */
  loading: boolean;
  /** True while a REFETCH (controls changed after an initial success) is in flight — the panels keep
   *  showing the last-good data rather than collapsing (loading-states rule: build up, don't flash). */
  refetching: boolean;
  error: string | null;
  /** True once ANY fetch has ever succeeded — lets the caller tell "no data has EVER loaded, show a
   *  full error/skeleton" from "a REFETCH failed, keep showing the last-good `data` + a small banner"
   *  (an `error` alone doesn't distinguish those — `data` is never cleared on a refetch failure). */
  loadedOnce: boolean;
  data: TestingMetricsData;
  bucket: MetricsBucket;
  /** AM-OB3 — the bucket WITH its provenance: what the operator asked for, what auto would pick,
   *  and whether the request had to be coarsened for this window (which the tab has to say out
   *  loud). `bucket` above stays the plain effective value every panel already consumes. */
  bucketSelection: TestingBucketSelection;
  reload: () => void;
};

/**
 * Fires every `GET /api/metrics/{runs,scans}` call the Testing dashboard's 9 panels + KPI header
 * need for the current `controls`, in parallel. A `controls` change re-fires the whole batch; an
 * in-flight batch is aborted if `controls` changes again before it resolves (last-write-wins, no
 * stale-response overwrite — mirrors `AnalyticsPanel`'s report-fetch cancellation guard).
 */
export function useTestingMetrics(controls: TestingDashboardControls): UseTestingMetricsResult {
  const [data, setData] = useState<TestingMetricsData>(EMPTY_METRICS_DATA);
  const [loading, setLoading] = useState(true);
  const [refetching, setRefetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [nonce, setNonce] = useState(0);
  const loadedOnceRef = useRef(false);
  // AM-OB3 — the operator's `?tBucket=` choice wins over the span-derived rule, unless honouring it
  // would ask the API for thousands of buckets, in which case it is coarsened and the tab says so.
  const bucketSelection = resolveBucketSelection(controls);
  const bucket = bucketSelection.bucket;

  useEffect(() => {
    const controller = new AbortController();
    const filter = baseRunFilter(controls);
    const window = metricsWindow(controls);
    const signal = controller.signal;

    if (loadedOnceRef.current) setRefetching(true);
    setError(null);

    Promise.all([
      getRunMetrics(
        { filter, ...window, bucket, groupBy: controls.groupBy, measures: ["count", "errorRate"] },
        signal,
      ),
      getRunMetrics(
        { filter, ...window, bucket, groupBy: "stopReasonCode", measures: ["count"] },
        signal,
      ),
      getRunMetrics(
        { filter, ...window, bucket, measures: ["p50DurationMs", "p95DurationMs"] },
        signal,
      ),
      getRunMetrics({ filter, ...window, bucket, measures: ["tokensIn", "tokensOut"] }, signal),
      // RM-33 WP 3.3 — a SEPARATE call on purpose, not three more measures on the tokens request:
      // `cacheHitRate` is a `rate` and the other two are `tokens`, and folding them into one series
      // bag invites a blended axis. `costUsd` and `meanScore` are already requested this way.
      getRunMetrics(
        { filter, ...window, bucket, measures: ["cacheReadTokens", "cacheWriteTokens", "cacheHitRate"] },
        signal,
      ),
      getRunMetrics({ filter, ...window, bucket, measures: ["costUsd"] }, signal),
      getRunMetrics({ filter, ...window, bucket, measures: ["meanScore"] }, signal),
      getRunMetrics(
        { filter, ...window, bucket: "week", groupBy: "test", measures: ["count", "errorRate"] },
        signal,
      ),
      getRunMetrics(
        { filter, ...window, bucket: "week", groupBy: "server", measures: ["count", "errorRate"] },
        signal,
      ),
      getMostExpensiveRuns({ ...filter, dateFrom: window.from, dateTo: window.to }, 8, signal),
      getScanMetrics({ ...window, bucket }, signal),
    ])
      .then(
        ([
          runsOverTime,
          guardrail,
          duration,
          tokens,
          cache,
          cost,
          score,
          failingTests,
          failingServers,
          expensiveRuns,
          scans,
        ]) => {
          if (signal.aborted) return;
          setData({
            runsOverTime: runsOverTime.series,
            guardrail: guardrail.series,
            duration: duration.series,
            tokens: tokens.series,
            cache: cache.series,
            cacheUnavailable: cache.unavailableMeasures,
            cost: cost.series,
            score: score.series,
            failingTests: failingTests.series,
            failingServers: failingServers.series,
            expensiveRuns,
            scans: scans.servers,
          });
          loadedOnceRef.current = true;
          setLoadedOnce(true);
          setLoading(false);
          setRefetching(false);
        },
      )
      .catch((err) => {
        if (signal.aborted) return;
        setError(getErrorMessage(err));
        setLoading(false);
        setRefetching(false);
      });

    return () => {
      controller.abort();
    };
    // `controls` is a fresh object per render from the caller (parsed from URLSearchParams each
    // time) — depend on its serialized shape (not the object identity) so the effect only re-fires
    // on an ACTUAL change, not every render.
  }, [JSON.stringify(controls), bucket, nonce]);

  return {
    loading,
    refetching,
    error,
    loadedOnce,
    data,
    bucket,
    bucketSelection,
    reload: () => setNonce((n) => n + 1),
  };
}
