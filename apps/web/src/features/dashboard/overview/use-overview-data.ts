import { useEffect, useMemo, useState } from "react";
import type {
  AdvisorReport,
  RatingIssue,
  RunMetricsResponse,
  ScanMetricsResponse,
  ScanSummary,
  ServerConfig,
} from "@mcp-token-footprint/shared";
import {
  getAdvisorReport,
  getRunMetrics,
  getScanMetrics,
  listIssues,
  listScans,
  listServers,
} from "../../../lib/api";
import { getErrorMessage } from "../../../lib/errors";
import type { OverviewData, OverviewRange, SectionEnvelope } from "./overview-contract";
import {
  buildAdvisorTeaser,
  buildAttentionData,
  buildFootprintData,
  buildRunHealthData,
  previousRange,
  resolveOverviewBucket,
} from "./overview-derive";

/**
 * `useOverviewData` — the Dashboard Overview tab's one data layer (dashboard-bento WP 1.1).
 *
 * Fills the committed {@link OverviewData} from **existing** endpoints only: `GET /api/metrics/scans`
 * (footprint), `GET /api/metrics/runs` (run health, current + previous window),
 * `GET /api/advisor/report?scope=fleet` (advisor teaser), and `GET /api/issues` + the app's
 * servers/scans (attention). No new endpoint, no migration, no new dependency.
 *
 * Shape of the work:
 *
 * - **Sections are independent.** Each has its own fetch, its own state and its own error, so a
 *   failing advisor never blanks the hero — the acceptance rule that a section settles to
 *   `loading → ready | empty | error` on its own.
 * - **Parallel, and never per-server.** Five requests in total on mount (four of them fired
 *   simultaneously by separate effects), three on a range change. `GET /api/metrics/scans` already
 *   returns every server's series in one response — this hook never fans out one request per server.
 * - **Aborts on `range` change.** The range-scoped effects carry an `AbortController` whose
 *   `cleanup` aborts the in-flight request, so a fast preset switch cannot land a stale window's
 *   numbers under the new window's label (last-write-wins).
 * - **A range change goes back to `loading`,** rather than holding the previous window's figures
 *   under the new label. The contract has four states by design; showing 30-day numbers while the
 *   header says 24 h would be the exact class of lie this plan exists to remove.
 * - **`feedbackRate` is never requested** — it has no backing computation and would come back in
 *   `unavailableMeasures`.
 */

/**
 * Optional inputs the host page already has in memory. `App.tsx` loads `servers` + `scans` app-wide
 * and hands them down, so passing them here avoids a duplicate fetch; omit them and the hook fetches
 * its own copy, which keeps `useOverviewData(range)` self-sufficient (and testable) on its own.
 */
export type OverviewInput = {
  servers?: readonly ServerConfig[];
  scans?: readonly ScanSummary[];
  /** Injectable clock — the dense bucket axis is clamped to "now" so a window running to the end of
   *  today does not sprout fabricated future buckets. Tests pin it; production uses the real clock. */
  now?: Date;
};

/** A source's raw fetch state, before it is mapped onto a {@link SectionEnvelope}. */
type Source<T> = { status: "loading" | "ready" | "error"; payload: T | null; error: string | null };

const LOADING: Source<never> = { status: "loading", payload: null, error: null };

/** Stable empty catalog — a fresh `[]` per render would invalidate the footprint memo every time. */
const EMPTY_SERVERS: readonly ServerConfig[] = [];

function ready<T>(payload: T): Source<T> {
  return { status: "ready", payload, error: null };
}

function failed<T>(error: unknown): Source<T> {
  return { status: "error", payload: null, error: getErrorMessage(error) };
}

/**
 * Map a settled source onto a section envelope. `derive` returns `null` for "settled with nothing to
 * show", which becomes `empty` — the tile then removes itself instead of rendering an empty box.
 */
function toSection<S, T>(source: Source<S>, derive: (payload: S) => T | null): SectionEnvelope<T> {
  if (source.status === "loading") return { state: "loading", data: null, error: null };
  if (source.status === "error") return { state: "error", data: null, error: source.error };
  const data = source.payload === null ? null : derive(source.payload);
  if (data === null) return { state: "empty", data: null, error: null };
  return { state: "ready", data, error: null };
}

export type UseOverviewDataResult = OverviewData & {
  /** Re-fires every section's fetch (the tab's manual refresh / a post-scan refresh). */
  reload: () => void;
};

export function useOverviewData(
  range: OverviewRange,
  input: OverviewInput = {},
): UseOverviewDataResult {
  const [scanMetrics, setScanMetrics] = useState<Source<ScanMetricsResponse>>(LOADING);
  const [runMetrics, setRunMetrics] =
    useState<Source<{ current: RunMetricsResponse; previous: RunMetricsResponse | null }>>(LOADING);
  const [advisor, setAdvisor] = useState<Source<AdvisorReport>>(LOADING);
  const [issues, setIssues] = useState<Source<RatingIssue[]>>(LOADING);
  const [servers, setServers] = useState<Source<readonly ServerConfig[]>>(LOADING);
  const [scans, setScans] = useState<Source<readonly ScanSummary[]>>(LOADING);
  const [nonce, setNonce] = useState(0);

  const bucket = resolveOverviewBucket(range);
  const { from, to } = range;

  // The host may hand us `servers`/`scans` it already has. The fetch effects depend on the BOOLEAN
  // "was it supplied", never on the array identity, so a host re-rendering with a fresh array does
  // not re-fire (or start) a request.
  const providedServers = input.servers;
  const providedScans = input.scans;
  const hasProvidedServers = providedServers !== undefined;
  const hasProvidedScans = providedScans !== undefined;
  // Compared BY VALUE, not by Date identity — a caller passing `new Date(...)` inline must not
  // invalidate a memo on every render.
  const nowMs = input.now?.getTime();

  // ── Footprint — range-scoped, aborts on range change. ─────────────────────────────────────────
  useEffect(() => {
    const controller = new AbortController();
    setScanMetrics(LOADING);
    getScanMetrics({ from, to, bucket }, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return;
        setScanMetrics(ready(response));
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setScanMetrics(failed(error));
      });
    return () => controller.abort();
  }, [from, to, bucket, nonce]);

  // ── Run health — range-scoped; the previous, equal-length window comes along so pass rate and
  //    spend have a baseline. Both requests share one controller, so both abort together. ────────
  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;
    setRunMetrics(LOADING);
    const previous = previousRange({ from, to, preset: range.preset });
    const measures = ["count", "errorRate", "costUsd"] as const;
    Promise.all([
      getRunMetrics({ filter: {}, from, to, bucket, measures: [...measures] }, signal),
      previous === null
        ? Promise.resolve(null)
        : getRunMetrics(
            { filter: {}, from: previous.from, to: previous.to, bucket, measures: [...measures] },
            signal,
          ),
    ])
      .then(([current, previousResponse]) => {
        if (signal.aborted) return;
        setRunMetrics(ready({ current, previous: previousResponse }));
      })
      .catch((error) => {
        if (signal.aborted) return;
        setRunMetrics(failed(error));
      });
    return () => controller.abort();
  }, [from, to, bucket, range.preset, nonce]);

  // ── Advisor — NOT range-scoped (`GET /api/advisor/report` takes no window), so it is fetched once
  //    per mount and never refetched by a preset switch. ─────────────────────────────────────────
  useEffect(() => {
    const controller = new AbortController();
    setAdvisor(LOADING);
    getAdvisorReport({ scope: "fleet" }, controller.signal)
      .then((report) => {
        if (controller.signal.aborted) return;
        setAdvisor(ready(report));
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setAdvisor(failed(error));
      });
    return () => controller.abort();
  }, [nonce]);

  // ── Attention sources — also NOT range-scoped: an unscanned server or an open regression is a
  //    statement about the fleet's CURRENT state, and narrowing it to the window would hide work
  //    that still needs doing. `servers`/`scans` are fetched only when the host did not supply them.
  useEffect(() => {
    const controller = new AbortController();
    setIssues(LOADING);
    listIssues(controller.signal)
      .then((list) => {
        if (controller.signal.aborted) return;
        setIssues(ready(list));
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setIssues(failed(error));
      });
    return () => controller.abort();
  }, [nonce]);

  useEffect(() => {
    if (hasProvidedServers) return;
    const controller = new AbortController();
    setServers(LOADING);
    listServers(controller.signal)
      .then((list) => {
        if (controller.signal.aborted) return;
        setServers(ready(list));
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setServers(failed(error));
      });
    return () => controller.abort();
  }, [hasProvidedServers, nonce]);

  useEffect(() => {
    if (hasProvidedScans) return;
    const controller = new AbortController();
    setScans(LOADING);
    listScans(controller.signal)
      .then((list) => {
        if (controller.signal.aborted) return;
        setScans(ready(list));
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setScans(failed(error));
      });
    return () => controller.abort();
  }, [hasProvidedScans, nonce]);

  const serverSource = useMemo<Source<readonly ServerConfig[]>>(
    () => (providedServers !== undefined ? ready(providedServers) : servers),
    [providedServers, servers],
  );
  const scanSource = useMemo<Source<readonly ScanSummary[]>>(
    () => (providedScans !== undefined ? ready(providedScans) : scans),
    [providedScans, scans],
  );

  // The footprint's display-name fallback needs the server catalog, but must NOT wait for it — a
  // series carries its own `serverName`, so an unresolved catalog degrades to the id, not a stall.
  const serverCatalog = serverSource.payload ?? EMPTY_SERVERS;

  const footprint = useMemo(
    () => toSection(scanMetrics, (response) => buildFootprintData(response, serverCatalog)),
    [scanMetrics, serverCatalog],
  );

  const runHealth = useMemo(
    () =>
      toSection(runMetrics, (payload) =>
        buildRunHealthData(payload.current, payload.previous, {
          range: { from, to, preset: range.preset },
          bucket,
          ...(nowMs === undefined ? {} : { now: new Date(nowMs) }),
        }),
      ),
    [runMetrics, from, to, range.preset, bucket, nowMs],
  );

  // Attention joins three sources: it is loading while any is loading, errors if any errored (the
  // first error wins, surfaced verbatim), and otherwise derives from all three together.
  const attention = useMemo(() => {
    const sources = [serverSource, scanSource, issues];
    const errored = sources.find((source) => source.status === "error");
    if (errored !== undefined) {
      return { state: "error" as const, data: null, error: errored.error };
    }
    if (sources.some((source) => source.status === "loading")) {
      return { state: "loading" as const, data: null, error: null };
    }
    const data = buildAttentionData(
      serverSource.payload ?? [],
      scanSource.payload ?? [],
      issues.payload ?? [],
    );
    return data === null
      ? { state: "empty" as const, data: null, error: null }
      : { state: "ready" as const, data, error: null };
  }, [serverSource, scanSource, issues]);

  const advisorSection = useMemo(() => toSection(advisor, buildAdvisorTeaser), [advisor]);

  return useMemo(
    () => ({
      footprint,
      runHealth,
      attention,
      advisor: advisorSection,
      reload: () => setNonce((value) => value + 1),
    }),
    [footprint, runHealth, attention, advisorSection],
  );
}
