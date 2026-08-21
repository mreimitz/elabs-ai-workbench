import { useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { LineChart } from "lucide-react";
import { ScrollArea, Skeleton } from "@elabs-ai/components-ui";
import type { RunFilter } from "@mcp-token-footprint/shared";
import { InlineError } from "../../components/InlineError";
import { TabEmptyState } from "../../components/TabEmptyState";
import type { DashboardRange } from "./dashboard-range";
import { CachePanel } from "./testing/CachePanel";
import { CostPanel } from "./testing/CostPanel";
import { CustomChartsSection } from "./testing/CustomChartsSection";
import {
  drillDownHref,
  parseControlsFromSearchParams,
  type TestingDashboardControls,
  writeControlsToSearchParams,
} from "./testing/dashboard-url-state";
import { DurationPanel } from "./testing/DurationPanel";
import { FilterControls } from "./testing/FilterControls";
import { GuardrailStopsPanel } from "./testing/GuardrailStopsPanel";
import { KpiHeader } from "./testing/KpiHeader";
import { LeaderboardsPanel } from "./testing/LeaderboardsPanel";
import {
  buildCostResult,
  buildDurationRows,
  buildExpensiveRunRows,
  buildFailingLeaderboard,
  buildRunsOverTimeRows,
  buildTestingKpis,
  makeGroupLabelResolver,
} from "./testing/metrics-derive";
import { PanelGrid } from "./testing/panel-shell";
import { RunsErrorRatePanel } from "./testing/RunsErrorRatePanel";
import { ScansStripPanel } from "./testing/ScansStripPanel";
import { ScoreTrendPanel } from "./testing/ScoreTrendPanel";
import { TokensPanel } from "./testing/TokensPanel";
import { useTestingCatalog, useTestingMetrics } from "./testing/use-testing-dashboard-data";
import { WaitingForYouCard } from "./testing/WaitingForYouCard";

/**
 * TestingTab — the Dashboard's Testing tab (observability WP 2.2, fills the WP 2.1 shell). Prebuilt
 * panels over `/api/metrics/runs` (+ a scans strip from `/api/metrics/scans`), a facet/group-by
 * control row (URL-persisted), and drill-down from every chart/legend/leaderboard row into the runs
 * feed with the equivalent `RunFilter` (`packages/shared/src/run-filter.ts`'s `serializeRunFilter`).
 *
 * ── THE WINDOW COMES FROM THE PAGE (dashboard-bento WP 2.2) ──────────────────────────────────────
 * This tab used to own its own date range — a `DateRangePicker` inside its own `bg-card` toolbar
 * band, persisted as `?tFrom=`/`?tTo=`. Owner, 2026-08-20: *"If we introduce a new toolbar with
 * filter on timeline this need to work for Testing and issues as well."* So the range now arrives as
 * the `range` prop from `DashboardView`'s single page-level toolbar and is shared with the Overview
 * and Issues tabs; the ISO instants are copied onto `controls` verbatim, which is why every panel,
 * every drill-down href and the custom-chart composer keep working untouched.
 *
 * The band is gone with it. What remains is the FACET row — provider / server / environment / model
 * / suite / group-by, genuinely this tab's own — rendered frame-light (no `bg-card`, no border, no
 * gutter bleed) so it reads as this tab's content rather than a second chrome band under the page's
 * one toolbar (`planning/Roadmap/RM-30-ux-overhaul/toolbar-standard-2026-07-11.md`, D-TB2).
 *
 * DATA FLOW: `useTestingCatalog` fetches servers/environments/suites/tests ONCE (facet options +
 * leaderboard/expensive-run labels); `useTestingMetrics` re-fetches the whole metrics batch whenever
 * `controls` changes — including when the page range changes. Both hooks + all derivation live in
 * `./testing/*` (React-free derivation in `metrics-derive.ts`/`dashboard-url-state.ts`,
 * presentational panels here).
 */
export function TestingTab({ range }: { range: DashboardRange }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const controls = useMemo(
    () => parseControlsFromSearchParams(searchParams, undefined, { from: range.from, to: range.to }),
    [searchParams, range.from, range.to],
  );
  const setControls = (next: TestingDashboardControls) => {
    setSearchParams((prev) => writeControlsToSearchParams(prev, next), { replace: true });
  };

  const catalog = useTestingCatalog();
  const { loading, error, loadedOnce, data, bucket, reload } = useTestingMetrics(controls);

  const serversById = useMemo(() => new Map(catalog.servers.map((s) => [s.id, s.name])), [catalog.servers]);
  const scenariosById = useMemo(() => new Map(catalog.scenarios.map((s) => [s.id, s])), [catalog.scenarios]);
  const suitesById = useMemo(() => new Map(catalog.suites.map((s) => [s.id, s.name])), [catalog.suites]);
  const testsById = useMemo(() => new Map(catalog.tests.map((t) => [t.id, t])), [catalog.tests]);
  const testNames = useMemo(() => new Map(catalog.tests.map((t) => [t.id, t.name])), [catalog.tests]);
  const models = useMemo(
    () => [...new Set(catalog.scenarios.map((s) => s.model))].filter((m) => m.length > 0).sort(),
    [catalog.scenarios],
  );

  const groupLabel = useMemo(
    () =>
      makeGroupLabelResolver(controls.groupBy, {
        serverName: (id) => serversById.get(id) ?? id,
        suiteName: (id) => suitesById.get(id) ?? id,
      }),
    [controls.groupBy, serversById, suitesById],
  );

  // WP 2.7 — the same server/suite/test/environment name lookups, reshaped for the custom chart
  // composer's generic groupBy label resolution (`resolveGroupLabel` in metrics-derive.ts).
  const chartCatalog = useMemo(
    () => ({
      serverName: (id: string) => serversById.get(id) ?? id,
      suiteName: (id: string) => suitesById.get(id) ?? id,
      testName: (id: string) => testNames.get(id) ?? id,
      environmentName: (id: string) => scenariosById.get(id)?.name ?? id,
    }),
    [serversById, suitesById, testNames, scenariosById],
  );

  const runsOverTime = useMemo(() => buildRunsOverTimeRows(data.runsOverTime), [data.runsOverTime]);
  const costResult = useMemo(() => buildCostResult(data.cost), [data.cost]);
  const durationResult = useMemo(() => buildDurationRows(data.duration), [data.duration]);
  const kpis = useMemo(
    () => buildTestingKpis(runsOverTime, costResult, durationResult),
    [runsOverTime, costResult, durationResult],
  );
  const failingTests = useMemo(
    () => buildFailingLeaderboard(data.failingTests, (g) => testNames.get(g) ?? g),
    [data.failingTests, testNames],
  );
  const failingServers = useMemo(
    () => buildFailingLeaderboard(data.failingServers, (g) => serversById.get(g) ?? g),
    [data.failingServers, serversById],
  );
  const expensiveRuns = useMemo(
    () => buildExpensiveRunRows(data.expensiveRuns, testsById, scenariosById),
    [data.expensiveRuns, testsById, scenariosById],
  );

  const onDrill = (filter: RunFilter) => navigate(drillDownHref(filter));
  const onOpenServer = (serverId: string) => navigate(`/servers/${serverId}`);
  const onOpenRun = (runId: string) => navigate(`/testing/runs/${runId}`);

  const hasAnyData =
    data.runsOverTime.length > 0 ||
    data.guardrail.length > 0 ||
    data.duration.length > 0 ||
    data.tokens.length > 0 ||
    data.cache.length > 0 ||
    data.cost.length > 0 ||
    data.score.length > 0 ||
    data.scans.length > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {/* dashboard-bento WP 2.2 — the FACET row, frame-light. The `bg-card` + `border-b` +
          gutter-bleed band this used to sit in was a second toolbar under the page's one toolbar,
          which is the D-TB2 violation the owner reported; the page host (`DashboardView`) owns the
          only command-bar surface now, and these controls are simply this tab's own content. */}
      <div className="shrink-0">
        <FilterControls
          controls={controls}
          onChange={setControls}
          servers={catalog.servers.map((s) => ({ id: s.id, name: s.name }))}
          environments={catalog.scenarios.map((s) => ({ id: s.id, name: s.name }))}
          suites={catalog.suites.map((s) => ({ id: s.id, name: s.name }))}
          models={models}
          runCount={loadedOnce ? kpis.runCount : undefined}
        />
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-4 pr-3 pb-4">
          {loading ? (
            <TestingDashboardSkeleton />
          ) : error && !loadedOnce ? (
            <InlineError title="Couldn’t load testing metrics" detail={error} onRetry={reload} />
          ) : !hasAnyData ? (
            <TabEmptyState
              icon={<LineChart aria-hidden />}
              title="No runs in this window"
              description="Widen the date range or clear a filter to see run and suite trends here."
            />
          ) : (
            <>
              {error && loadedOnce ? (
                <InlineError
                  title="Couldn’t refresh testing metrics"
                  detail={`Showing the last successful load. ${error}`}
                  onRetry={reload}
                />
              ) : null}
              <KpiHeader kpis={kpis} extra={<WaitingForYouCard />} />
              <PanelGrid>
                <RunsErrorRatePanel
                  series={data.runsOverTime}
                  controls={controls}
                  bucket={bucket}
                  groupLabel={groupLabel}
                  onDrill={onDrill}
                />
                <GuardrailStopsPanel series={data.guardrail} controls={controls} onDrill={onDrill} />
                <DurationPanel series={data.duration} controls={controls} bucket={bucket} onDrill={onDrill} />
                <TokensPanel series={data.tokens} controls={controls} bucket={bucket} onDrill={onDrill} />
                <CachePanel
                  series={data.cache}
                  unavailableMeasures={data.cacheUnavailable}
                  controls={controls}
                  bucket={bucket}
                  onDrill={onDrill}
                />
                <CostPanel series={data.cost} controls={controls} bucket={bucket} onDrill={onDrill} />
                <ScoreTrendPanel series={data.score} controls={controls} bucket={bucket} onDrill={onDrill} />
              </PanelGrid>
              <LeaderboardsPanel
                failingTests={failingTests}
                failingServers={failingServers}
                expensiveRuns={expensiveRuns}
                controls={controls}
                onDrill={onDrill}
                onOpenRun={onOpenRun}
              />
              <ScansStripPanel series={data.scans} onOpenServer={onOpenServer} />
            </>
          )}

          {/* WP 2.7 — custom charts render UNDER the prebuilt panels regardless of the prebuilt
              panels' own loading/error/empty state (each custom panel fetches + reports its OWN
              state via useCustomChartData — an operator's custom chart may well have data even when
              the prebuilt panels' default view doesn't). */}
          <CustomChartsSection controls={controls} catalog={chartCatalog} />
        </div>
      </ScrollArea>
    </div>
  );
}

/** Layout-shaped placeholder for the FIRST load (loading-states rule — no spinner collapsing the
 *  grid; Skeletons sized like the eventual KPI row + panel grid). */
function TestingDashboardSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-72 w-full" />
        ))}
      </div>
    </div>
  );
}
