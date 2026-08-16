import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button, StatePanel } from "@brand/ui";
import type {
  HubPlanAcceptanceMetric,
  HubProject,
  HubUsageBucket,
  HubUsageProviderCredentialBucket,
  HubUsageRow,
} from "@mcp-token-footprint/shared";
import {
  getHubUsage,
  getHubUsageRollup,
  getHubUsageSummary,
  listHubProjects,
} from "../../../../lib/api";
import { getErrorMessage } from "../../../../lib/errors";
import { UsageBilling } from "./UsageBilling";
import { UsageCharts } from "./UsageCharts";
import { UsageKpis } from "./UsageKpis";
import { UsageTable } from "./UsageTable";
import { UsageToolbar } from "./UsageToolbar";
import {
  buildStackedTimeRows,
  seriesKeyFor,
  sumUsageRows,
  topAttributedRows,
} from "./usage-derive";
import {
  parseUsageControlsFromSearchParams,
  summaryDaysFor,
  usageRangeQuery,
  writeUsageControlsToSearchParams,
  type UsageControls,
} from "./usage-url-state";

const MAX_STACKED_SERIES = 5;

/**
 * Assistant Hub UX WP2.6 (D-HUX10, §7.3) — the workforce Usage tab: everything the old full-page
 * `/assistant/usage` (the now-retired `UsageView.tsx`, deleted by WP3.4) did, plus the drill model D-HUX10 asks for (group by, click an
 * entity, regroup, end at sessions/replay). Mounted into `WorkforceView`'s `usageTab` slot by WP2.R
 * (Wave-2 review/integration — see that file's frame-API doc; this component is self-contained and
 * reads its own `useSearchParams()`, exactly as that doc specifies for a tab slot).
 *
 * DATA SOURCES (WP1.6, D-HUX10):
 *   • `GET /api/hub/usage/rollup` — the KPI totals (via `sumUsageRows`) + the ranked DataTable + the
 *     "top by spend" chart. Honors the tab's exact `from`/`to`/`projectId` — the numbers here are the
 *     reconciled ones (WP1.6's "sum(rows) === totals" invariant, see `usage-derive.ts`).
 *   • `GET /api/hub/usage` (existing, `getHubUsage`) — for `planAcceptance` (no rollup equivalent
 *     exists for that mission-level R-UX6 signal) and, since model-identity WP3.3 (D-MI10), for
 *     `byProviderCredential` (the "Billed to" panel — spend by the credential each session actually
 *     ran on, which is not one of `/rollup`'s five dimensions); same range filter for both.
 *   • `GET /api/hub/usage/summary` — ONLY for the stacked-over-time chart's daily strip, fetched once
 *     per top attributed entity (never the unattributed bucket — it has no `id`, see
 *     `usage-links.ts`). Its `totals` field is NEVER read here (see `UsageKpis.tsx`'s doc on why).
 */
export function UsageTab() {
  const [searchParams, setSearchParams] = useSearchParams();
  const controls = useMemo(() => parseUsageControlsFromSearchParams(searchParams), [searchParams]);

  const setControls = useCallback(
    (next: UsageControls) => {
      setSearchParams((prev) => writeUsageControlsToSearchParams(prev, next), { replace: true });
    },
    [setSearchParams],
  );

  const [projects, setProjects] = useState<HubProject[]>([]);
  const [rows, setRows] = useState<HubUsageRow[]>([]);
  const [planAcceptance, setPlanAcceptance] = useState<HubPlanAcceptanceMetric | undefined>(
    undefined,
  );
  // model-identity WP3.3 (D-MI10) — the "Billed to" panel's rows; same `getHubUsage` fetch.
  const [creditBuckets, setCreditBuckets] = useState<HubUsageProviderCredentialBucket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [stackedEntries, setStackedEntries] = useState<
    { row: HubUsageRow; strip: HubUsageBucket[] }[]
  >([]);
  const [stackedLoading, setStackedLoading] = useState(true);

  useEffect(() => {
    void listHubProjects()
      .then(setProjects)
      .catch(() => {
        /* the Project filter degrades to "All projects only" — not fatal to the tab. */
      });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = usageRangeQuery(controls);
      const [rollup, aggregate] = await Promise.all([
        getHubUsageRollup(controls.groupBy, query),
        getHubUsage(query),
      ]);
      setRows(rollup);
      setPlanAcceptance(aggregate.planAcceptance);
      setCreditBuckets(aggregate.byProviderCredential ?? []);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [controls]);

  useEffect(() => {
    void load();
  }, [load]);

  // The stacked-over-time chart: one `/summary` fetch per top attributed entity, re-run whenever the
  // rollup rows or the selected range change (`summaryDaysFor` depends on both).
  useEffect(() => {
    const top = topAttributedRows(rows, MAX_STACKED_SERIES);
    if (top.length === 0) {
      setStackedEntries([]);
      setStackedLoading(false);
      return;
    }
    let cancelled = false;
    setStackedLoading(true);
    const days = summaryDaysFor(controls);
    void Promise.all(
      top.map(async (row) => {
        const summary = await getHubUsageSummary({ groupBy: row.groupBy, id: row.key as string, days });
        return { row, strip: summary.strip };
      }),
    )
      .then((entries) => {
        if (!cancelled) setStackedEntries(entries);
      })
      .catch(() => {
        if (!cancelled) setStackedEntries([]); // the KPI/table numbers stay correct; only the chart degrades
      })
      .finally(() => {
        if (!cancelled) setStackedLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // `rows` (not `controls`) drives WHICH entities to fetch; `controls` (via `days`) sizes the window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, controls]);

  const totals = useMemo(() => sumUsageRows(rows), [rows]);
  const stackedRows = useMemo(() => buildStackedTimeRows(stackedEntries), [stackedEntries]);
  const stackedSeries = useMemo(
    () => stackedEntries.map(({ row }) => ({ key: seriesKeyFor(row), label: row.label })),
    [stackedEntries],
  );

  const handleNarrowToProject = useCallback(
    (projectId: string) => {
      // The only dimension `/api/hub/usage/rollup` can actually narrow by (`usage-links.ts`'s doc).
      // Regroup away from "project" — staying grouped by the one dimension just narrowed to a single
      // value would show a degenerate one-row table.
      setControls({ ...controls, projectId, groupBy: "agent" });
    },
    [controls, setControls],
  );

  if (loading && rows.length === 0) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-4">
        <UsageToolbar
          controls={controls}
          onControlsChange={setControls}
          projects={projects}
          entityCount={undefined}
        />
        <StatePanel kind="loading" title="Loading usage…" loadingLabel="Loading usage…" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-4">
        <UsageToolbar
          controls={controls}
          onControlsChange={setControls}
          projects={projects}
          entityCount={undefined}
        />
        <StatePanel
          kind="error"
          title="Couldn’t load usage"
          description={error}
          actions={
            <Button variant="outline" onClick={() => void load()}>
              Retry
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <UsageToolbar
        controls={controls}
        onControlsChange={setControls}
        projects={projects}
        entityCount={rows.length}
      />
      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
        <div className="flex flex-col gap-4 pb-1">
          <UsageKpis totals={totals} planAcceptance={planAcceptance} />
          <UsageBilling buckets={creditBuckets} />
          <UsageCharts
            rows={rows}
            groupByLabel={controls.groupBy}
            stackedRows={stackedRows}
            stackedSeries={stackedSeries}
            stackedLoading={stackedLoading}
          />
          <UsageTable rows={rows} totals={totals} onNarrowToProject={handleNarrowToProject} />
        </div>
      </div>
    </div>
  );
}
