import { useCallback, useEffect, useMemo, useState } from "react";
import type { ContextSegment, RunSkill } from "@mcp-token-footprint/shared";
import { CONTEXT_SEGMENTS } from "@mcp-token-footprint/shared";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Descriptions,
  DescriptionsItem,
  EmptyState,
  ScrollArea,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Text,
} from "@elabs-ai/components-ui";
import { Bar, BarChart, BarXAxis, ChartTooltip, Grid, MetricCard, MetricGrid } from "@elabs-ai/components-charts";
import { DataTable } from "@elabs-ai/components-data";
import {
  AlertTriangle,
  BarChart3,
  BookOpenCheck,
  Clock,
  Coins,
  GanttChartSquare,
  GitBranch,
  Layers,
  MessageSquare,
  Puzzle,
  TriangleAlert,
} from "lucide-react";
import { getRunReport, getRunSkills } from "../../lib/api";
import { col } from "../../lib/table";
import { getErrorMessage } from "../../lib/errors";
import { chartSeriesColor, chartSwatchStyle } from "../../lib/chart-colors";
import { formatCostUsd, formatDuration, formatNumber, formatPercent } from "../../lib/format";
import { isTerminalRunStatus } from "../../lib/status";
import { InlineError } from "../../components/InlineError";
import type { RunStreamState } from "./use-run-stream";
import { RunGantt } from "./RunGantt";
import type { ConsoleNavRef, ConsolePane } from "./console-anchors";
import {
  deriveCachedTokenRows,
  deriveContextSegmentRows,
  deriveErrorRows,
  deriveEstimateVsActualRows,
  deriveOverviewKpis,
  deriveServerCalls,
  deriveToolAggregates,
  deriveTurnTrend,
  deriveUsedTools,
  hasCostData,
  type ErrorRow,
  type RunReport,
  type ToolAggregate,
} from "./analytics-derive";

/**
 * Wave-2 Analytics dashboard (findings/09 §4, Tracks C + D). Replaces the Track-B stub with a
 * second-level `Tabs` (Overview / Tokens / Tools / Timeline / Errors) inside the Analytics
 * `TabsContent` `RunConsole` mounts. KEEPS the exact `{ runId, stream }` prop contract.
 *
 * Two data sources, both degraded gracefully:
 *   - `stream` — the live/replay accumulator (always present; the only source mid-run).
 *   - the run report (`getRunReport`) — fetched once a `runId` exists; adds cumulative cost + run
 *     statistics. A not-yet-finished run's report can be partial/absent, so every figure falls back to
 *     the stream and nothing is fabricated.
 *
 * All series use `var(--chart-1..5)` (the Gantt is the lone exception — it colors by semantic status,
 * per its own rule). Both themes read from semantic tokens (no `dark:` overrides). Charts sit in
 * fixed-height boxes so they have a sizing context; flex children that truncate carry `min-w-0`.
 */
export type AnalyticsPanelProps = {
  /** The run id, or `null` before a run has been started (pre-run). The report endpoints key on it. */
  runId: string | null;
  /** The (as-of-k, in replay) accumulated run stream — the source the charts read. */
  stream: RunStreamState;
  /**
   * WP 3.2 — cross-link an Errors card to the failing step in Chat AND Trace. Omitted when the panel
   * isn't mounted in the run console (no navigable representations).
   */
  onNavigate?: (pane: ConsolePane, ref: ConsoleNavRef) => void;
};

type SubTab = "overview" | "tokens" | "tools" | "skills" | "timeline" | "errors";

const SEGMENT_LABELS: Record<ContextSegment, string> = {
  system: "System",
  tool_defs: "Tool defs",
  history: "History",
  tool_results: "Tool results",
  output: "Output",
};

/** Series → chart-token map in `CONTEXT_SEGMENTS` order (its index is the ramp index). */
const SEGMENT_FILL: Record<ContextSegment, string> = CONTEXT_SEGMENTS.reduce(
  (acc, seg, index) => ({ ...acc, [seg]: chartSeriesColor(index) }),
  {} as Record<ContextSegment, string>,
);

export function AnalyticsPanel({ runId, stream, onNavigate }: AnalyticsPanelProps) {
  const [tab, setTab] = useState<SubTab>("overview");
  const { report, error: reportError, reload: reloadReport } = useRunReport(runId, stream);
  // Only treat a failed report fetch as an ERROR once the run has SETTLED — a mid-run report is
  // legitimately partial/absent (loading-states rule: no error slot mid-stream), so we degrade to
  // stream-derived figures quietly while running and only surface "couldn't load" on a finished run.
  // WP3.fix (WP3.R Defect 1) — the shared terminal classifier (`lib/status.ts`), which includes
  // `ended`; the old inline 4-way OR omitted it, so an ended interactive session's report fetch was
  // treated as still-loading forever instead of settling.
  const settled = stream.status !== null && isTerminalRunStatus(stream.status);
  const settledReportError = settled && !report ? reportError : null;

  const hasAnySteps = stream.steps.length > 0;

  if (!runId || !hasAnySteps) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center p-6">
        <EmptyState
          icon={<BarChart3 aria-hidden />}
          title="Session analytics"
          description="Token, cost, tool and timeline analytics for this run land here once it starts producing steps."
        />
      </div>
    );
  }

  return (
    <Tabs
      value={tab}
      onValueChange={(v) => setTab(v as SubTab)}
      className="flex h-full min-h-0 flex-col gap-3 p-3"
    >
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="tokens">Tokens</TabsTrigger>
        <TabsTrigger value="tools">Tools</TabsTrigger>
        <TabsTrigger value="skills">Skills</TabsTrigger>
        <TabsTrigger value="timeline">Timeline</TabsTrigger>
        <TabsTrigger value="errors">Errors</TabsTrigger>
      </TabsList>

      <TabsContent value="overview" className="mt-0 min-h-0 flex-1 data-[state=inactive]:hidden">
        <ScrollArea className="h-full">
          <OverviewTab
            stream={stream}
            report={report}
            reportError={settledReportError}
            onRetryReport={reloadReport}
          />
        </ScrollArea>
      </TabsContent>
      <TabsContent value="tokens" className="mt-0 min-h-0 flex-1 data-[state=inactive]:hidden">
        <ScrollArea className="h-full">
          <TokensTab stream={stream} />
        </ScrollArea>
      </TabsContent>
      <TabsContent value="tools" className="mt-0 min-h-0 flex-1 data-[state=inactive]:hidden">
        <ScrollArea className="h-full">
          <ToolsTab stream={stream} />
        </ScrollArea>
      </TabsContent>
      <TabsContent value="skills" className="mt-0 min-h-0 flex-1 data-[state=inactive]:hidden">
        <ScrollArea className="h-full">
          <SkillsTab runId={runId} stream={stream} settled={settled} />
        </ScrollArea>
      </TabsContent>
      <TabsContent value="timeline" className="mt-0 min-h-0 flex-1 data-[state=inactive]:hidden">
        {/* Track D — the Gantt fills the pane (it sizes its own canvas via ResizeObserver). */}
        <RunGantt stream={stream} />
      </TabsContent>
      <TabsContent value="errors" className="mt-0 min-h-0 flex-1 data-[state=inactive]:hidden">
        <ScrollArea className="h-full">
          <ErrorsTab stream={stream} {...(onNavigate ? { onNavigate } : {})} />
        </ScrollArea>
      </TabsContent>
    </Tabs>
  );
}

// ── Report fetch hook ─────────────────────────────────────────────────────────────────────────

/**
 * Fetch the run report for cost + statistics. Re-fetches when the run id changes OR when the run
 * settles (the stream's terminal status), since the report is only complete once the run finishes —
 * a mid-run fetch is partial. A failure is kept as `error` (no longer swallowed to a bare `null`) so
 * the caller can tell "report absent because still running" from "report FAILED to load" — the panel
 * still degrades to stream-derived figures, but a settled-run failure gets a small retry surface.
 */
function useRunReport(
  runId: string | null,
  stream: RunStreamState,
): { report: RunReport | null; error: string | null; reload: () => void } {
  const [report, setReport] = useState<RunReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const status = stream.status;
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setReport(null);
    setError(null);
    if (!runId) return;
    getRunReport(runId)
      .then((r) => {
        if (!cancelled) setReport(r);
      })
      .catch((err) => {
        if (!cancelled) setError(getErrorMessage(err));
      });
    return () => {
      cancelled = true;
    };
    // `status` is a dep so a finished run re-fetches the now-complete report; `nonce` drives retry.
  }, [runId, status, nonce]);

  return { report, error, reload };
}

// ── Overview ───────────────────────────────────────────────────────────────────────────────────

function OverviewTab({
  stream,
  report,
  reportError,
  onRetryReport,
}: {
  stream: RunStreamState;
  report: RunReport | null;
  reportError: string | null;
  onRetryReport: () => void;
}) {
  const kpis = useMemo(() => deriveOverviewKpis(stream, report), [stream, report]);
  const trend = useMemo(() => deriveTurnTrend(stream, report), [stream, report]);
  // Categorical per-turn rows for the bar charts — `xDataKey="turn"` renders a real "Turn N" x-axis
  // label (T6c). The trend's synthetic `x: Date` is only there for the retired date-scale line/area
  // charts, whose date-formatted axis couldn't read as turns; a categorical bar axis can.
  const trendBars = useMemo(
    () =>
      trend.map((r) => ({
        turn: `Turn ${r.turn}`,
        costUsd: r.costUsd,
        contextTokens: r.contextTokens,
      })),
    [trend],
  );
  const showCost = hasCostData(trend);

  return (
    <div className="flex flex-col gap-4 pr-3">
      {reportError ? (
        <InlineError
          title="Couldn’t load run report"
          detail={`Cost and run statistics are unavailable; figures below are derived from the live stream. ${reportError}`}
          onRetry={onRetryReport}
        />
      ) : null}
      {/* S8/T6c — Analytics owns DISTRIBUTIONS, not the live scalars the KPI rail already shows. The
          per-turn cost/context/token/turn/tool-call scalars that duplicated the rail were removed; only
          the analytical figures with no other home stay (cache ratio, tool errors, peak context,
          duration). The time series live in the charts below + the Tokens/Tools tabs. */}
      <MetricGrid columns={4}>
        <MetricCard
          label="Cached"
          value={formatPercent(kpis.cachedPercent)}
          // RM-33 (D-CT2) — name the halves when we know them. "900 of input" says nothing about
          // whether that was a 0.1x discount or a 1.25x premium; "800 read · 100 written" does.
          description={
            kpis.cacheReadTokens === null
              ? `${formatNumber(kpis.cachedTokens)} of input`
              : `${formatNumber(kpis.cacheReadTokens)} read · ${formatNumber(kpis.cacheWriteTokens ?? 0)} written`
          }
        />
        <MetricCard
          label="Tool errors"
          value={formatNumber(kpis.toolErrors)}
          positiveIsGood={false}
          icon={<TriangleAlert aria-hidden />}
        />
        <MetricCard
          label="Peak context"
          value={
            kpis.peakContextPercent != null
              ? formatPercent(kpis.peakContextPercent)
              : formatNumber(kpis.peakContextTokens)
          }
          description={
            kpis.contextLimit
              ? `${formatNumber(kpis.peakContextTokens)} of ${formatNumber(kpis.contextLimit)}`
              : "limit unknown"
          }
          positiveIsGood={false}
        />
        <MetricCard
          label="Duration"
          value={kpis.durationMs != null ? formatDuration(kpis.durationMs) : "n/a"}
          icon={<Clock aria-hidden />}
        />
      </MetricGrid>

      <ChartGrid>
        <ChartPanel
          title="Cost development"
          subtitle="Cumulative estimated cost per turn"
          icon={<Coins aria-hidden className="size-4" />}
        >
          {showCost ? (
            <div className="h-56 w-full">
              <BarChart
                data={trendBars as unknown as Record<string, unknown>[]}
                xDataKey="turn"
                aspectRatio="auto"
                className="h-full w-full"
                accessibleLabel="Cumulative estimated cost per turn"
              >
                <Grid horizontal />
                <Bar dataKey="costUsd" fill="var(--chart-1)" />
                <BarXAxis maxLabels={8} />
                <ChartTooltip
                  showDatePill={false}
                  rows={(point) => [
                    {
                      color: "var(--chart-1)",
                      label: String(point.turn ?? "turn"),
                      value: formatCostUsd(toNumber(point.costUsd), { precision: 4 }),
                    },
                  ]}
                />
              </BarChart>
            </div>
          ) : (
            <EmptyState
              title="No cost data yet"
              description="Cumulative cost appears once the run report is available (after the run produces a settled turn)."
            />
          )}
        </ChartPanel>

        <ChartPanel
          title="Context growth"
          subtitle="Context-window total per turn toward the model limit"
          icon={<Layers aria-hidden className="size-4" />}
        >
          {trendBars.length > 0 ? (
            <div className="h-56 w-full">
              <BarChart
                data={trendBars as unknown as Record<string, unknown>[]}
                xDataKey="turn"
                aspectRatio="auto"
                className="h-full w-full"
                accessibleLabel="Context-window growth per turn"
              >
                <Grid
                  horizontal
                  highlightRowValues={kpis.contextLimit ? [kpis.contextLimit] : undefined}
                  highlightRowStroke="var(--chart-foreground-muted)"
                  highlightRowStrokeDasharray="4,4"
                />
                <Bar dataKey="contextTokens" fill="var(--chart-2)" />
                <BarXAxis maxLabels={8} />
                <ChartTooltip
                  showDatePill={false}
                  rows={(point) => [
                    {
                      color: "var(--chart-2)",
                      label: String(point.turn ?? "turn"),
                      value: formatNumber(toNumber(point.contextTokens)),
                    },
                  ]}
                />
              </BarChart>
            </div>
          ) : (
            <EmptyState
              title="No context snapshots yet"
              description="The context staircase fills as turns settle."
            />
          )}
        </ChartPanel>
      </ChartGrid>
    </div>
  );
}

// ── Tokens ─────────────────────────────────────────────────────────────────────────────────────

function TokensTab({ stream }: { stream: RunStreamState }) {
  const segmentRows = useMemo(() => deriveContextSegmentRows(stream.steps), [stream.steps]);
  const cachedRows = useMemo(() => deriveCachedTokenRows(stream.steps), [stream.steps]);
  const estimateRows = useMemo(() => deriveEstimateVsActualRows(stream.steps), [stream.steps]);
  const aggregates = useMemo(() => deriveToolAggregates(stream.steps), [stream.steps]);
  const perToolRows = useMemo(
    () =>
      aggregates
        .filter((t) => t.resultTokens > 0)
        .map((t) => ({ tool: t.toolName, tokens: t.resultTokens })),
    [aggregates],
  );

  return (
    <div className="flex flex-col gap-4 pr-3">
      <ChartGrid>
        <ChartPanel
          title="Context composition"
          subtitle="Per-turn stacked context segments"
          icon={<Layers aria-hidden className="size-4" />}
        >
          {segmentRows.length > 0 ? (
            <>
              <div className="h-56 w-full">
                <BarChart
                  data={segmentRows as unknown as Record<string, unknown>[]}
                  xDataKey="turn"
                  stacked
                  aspectRatio="auto"
                  className="h-full w-full"
                  accessibleLabel="Per-turn context composition by segment"
                >
                  <Grid horizontal />
                  {CONTEXT_SEGMENTS.map((seg) => (
                    <Bar key={seg} dataKey={seg} fill={SEGMENT_FILL[seg]} />
                  ))}
                  <BarXAxis maxLabels={8} />
                  <ChartTooltip
                    showDatePill={false}
                    rows={(point) =>
                      CONTEXT_SEGMENTS.map((seg) => ({
                        color: SEGMENT_FILL[seg],
                        label: SEGMENT_LABELS[seg],
                        value: formatNumber(toNumber(point[seg])),
                      }))
                    }
                  />
                </BarChart>
              </div>
              <SegmentLegend />
            </>
          ) : (
            <EmptyState
              title="No context snapshots"
              description="Per-turn composition fills as turns settle."
            />
          )}
        </ChartPanel>

        {/* RM-33 (D-CT2) — THREE series, not two. The old "Cached vs uncached" bar merged cache READS
            (~0.1x the input rate — a discount) with cache WRITES (1.25x — a premium) into one block
            that read as savings whichever it was. `mergedCache` is its own series so a turn whose
            provider reported only a merged figure is labelled as such instead of being attributed to
            the cheap side. */}
        <ChartPanel
          title="Input token composition"
          subtitle="Per-turn: uncached, served from cache, and written to cache"
        >
          {cachedRows.length > 0 ? (
            <div className="h-56 w-full">
              <BarChart
                data={cachedRows as unknown as Record<string, unknown>[]}
                xDataKey="turn"
                stacked
                aspectRatio="auto"
                className="h-full w-full"
                accessibleLabel="Per-turn input token composition: uncached, cache read, cache write"
              >
                <Grid horizontal />
                <Bar dataKey="uncached" fill="var(--chart-3)" />
                <Bar dataKey="cacheRead" fill="var(--chart-1)" />
                <Bar dataKey="cacheWrite" fill="var(--chart-5)" />
                <Bar dataKey="mergedCache" fill="var(--chart-8)" />
                <BarXAxis maxLabels={8} />
                <ChartTooltip
                  showDatePill={false}
                  rows={(point) => cachedTooltipRows(point)}
                />
              </BarChart>
            </div>
          ) : (
            <EmptyState
              title="No provider usage yet"
              description="The token composition needs provider-actual usage on a settled turn."
            />
          )}
        </ChartPanel>

        <ChartPanel
          title="Estimate vs actual"
          subtitle="Estimator profile tokens against provider-actual per turn"
        >
          {estimateRows.length > 0 ? (
            <div className="h-56 w-full">
              <BarChart
                data={estimateRows as unknown as Record<string, unknown>[]}
                xDataKey="turn"
                aspectRatio="auto"
                className="h-full w-full"
                accessibleLabel="Per-turn estimator tokens vs provider-actual"
              >
                <Grid horizontal />
                <Bar dataKey="estimate" fill="var(--chart-4)" />
                <Bar dataKey="actual" fill="var(--chart-5)" />
                <BarXAxis maxLabels={8} />
                <ChartTooltip
                  showDatePill={false}
                  rows={(point) => [
                    {
                      color: "var(--chart-4)",
                      label: "Estimate",
                      value: formatNumber(toNumber(point.estimate)),
                    },
                    {
                      color: "var(--chart-5)",
                      label: "Actual",
                      value: formatNumber(toNumber(point.actual)),
                    },
                  ]}
                />
              </BarChart>
            </div>
          ) : (
            <EmptyState
              title="No comparison yet"
              description="Estimate-vs-actual needs both an estimator lens and provider-actual usage."
            />
          )}
        </ChartPanel>

        <ChartPanel
          title="Tokens per tool"
          subtitle="Tool-result payload tokens by tool (primary profile)"
        >
          {perToolRows.length > 0 ? (
            <div className="h-56 w-full">
              <BarChart
                data={perToolRows as unknown as Record<string, unknown>[]}
                xDataKey="tool"
                aspectRatio="auto"
                className="h-full w-full"
                accessibleLabel="Tool-result token size per tool"
              >
                <Grid horizontal />
                <Bar dataKey="tokens" fill="var(--chart-2)" />
                <BarXAxis maxLabels={10} />
                <ChartTooltip
                  showDatePill={false}
                  rows={(point) => [
                    {
                      color: "var(--chart-2)",
                      label: String(point.tool ?? "tool"),
                      value: formatNumber(toNumber(point.tokens)),
                    },
                  ]}
                />
              </BarChart>
            </div>
          ) : (
            <EmptyState
              title="No tool-result tokens"
              description="Appears once a tool returns a measured result."
            />
          )}
        </ChartPanel>
      </ChartGrid>
    </div>
  );
}

// ── Tools ──────────────────────────────────────────────────────────────────────────────────────

function ToolsTab({ stream }: { stream: RunStreamState }) {
  const aggregates = useMemo(() => deriveToolAggregates(stream.steps), [stream.steps]);
  const serverCalls = useMemo(() => deriveServerCalls(aggregates), [aggregates]);
  const usedTools = useMemo(() => deriveUsedTools(aggregates), [aggregates]);

  const columns = useMemo(
    () => [
      col<ToolAggregate>({ id: "tool", header: "Tool", value: (r) => r.toolName }),
      col<ToolAggregate>({ id: "server", header: "Server", value: (r) => r.serverId || "—" }),
      col<ToolAggregate>({ id: "calls", header: "Calls", value: (r) => r.calls, numeric: true }),
      col<ToolAggregate>({
        id: "resultTokens",
        header: "Result tokens",
        value: (r) => r.resultTokens,
        numeric: true,
      }),
      col<ToolAggregate>({
        id: "avgLatency",
        header: "Avg latency",
        value: (r) => r.avgLatencyMs ?? 0,
        numeric: true,
        cell: (r) => (r.avgLatencyMs != null ? formatDuration(r.avgLatencyMs) : "—"),
      }),
      col<ToolAggregate>({
        id: "maxLatency",
        header: "Max latency",
        value: (r) => r.maxLatencyMs ?? 0,
        numeric: true,
        cell: (r) => (r.maxLatencyMs != null ? formatDuration(r.maxLatencyMs) : "—"),
      }),
      col<ToolAggregate>({
        id: "errorRate",
        header: "Error rate",
        value: (r) => r.errorRate,
        numeric: true,
        cell: (r) => formatPercent(r.errorRate * 100),
      }),
    ],
    [],
  );

  return (
    <div className="flex flex-col gap-4 pr-3">
      <Card>
        <CardHeader>
          <CardTitle>
            <span className="flex items-center gap-2">
              <BarChart3 aria-hidden className="size-4" />
              Tool usage
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {aggregates.length > 0 ? (
            <DataTable
              data={aggregates}
              columns={columns}
              maxBodyHeight="20rem"
              emptyMessage="No tool calls in this run."
            />
          ) : (
            <EmptyState title="No tool calls" description="This run made no tool calls." />
          )}
        </CardContent>
      </Card>

      <ChartGrid>
        <ChartPanel title="Calls per server" subtitle="Logical tool calls grouped by server">
          {serverCalls.length > 0 ? (
            <div className="h-56 w-full">
              <BarChart
                data={serverCalls as unknown as Record<string, unknown>[]}
                xDataKey="server"
                aspectRatio="auto"
                className="h-full w-full"
                accessibleLabel="Tool calls per server"
              >
                <Grid horizontal />
                <Bar dataKey="calls" fill="var(--chart-1)" />
                <BarXAxis maxLabels={10} />
                <ChartTooltip
                  showDatePill={false}
                  rows={(point) => [
                    {
                      color: "var(--chart-1)",
                      label: String(point.server ?? "server"),
                      value: formatNumber(toNumber(point.calls)),
                    },
                  ]}
                />
              </BarChart>
            </div>
          ) : (
            <EmptyState
              title="No server calls"
              description="Appears once a tool call is attributed to a server."
            />
          )}
        </ChartPanel>

        <ChartPanel title="Tool coverage" subtitle="Tools used in this run">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-1.5">
              {usedTools.length > 0 ? (
                usedTools.map((t) => (
                  <Badge key={t} variant="secondary" className="max-w-full truncate">
                    {t}
                  </Badge>
                ))
              ) : (
                <Text variant="meta" tone="muted">
                  No tools used.
                </Text>
              )}
            </div>
            <Alert>
              <AlertTitle>Unused tools not yet measured</AlertTitle>
              <AlertDescription>
                Unused-tool detection and wasted tool-definition tokens require a run-time
                allowed-tools snapshot, which is not yet captured. Only the used set is shown here —
                follow-up (findings/09 §3 E2).
              </AlertDescription>
            </Alert>
          </div>
        </ChartPanel>
      </ChartGrid>
    </div>
  );
}

// ── Skills ─────────────────────────────────────────────────────────────────────────────────────

/**
 * The skills this run loaded — the three signals the rest of the console hides: LOADED (which skills
 * resolved to which version, and whether the full SKILL.md was inlined eagerly vs. metadata-only),
 * USED (how many times the model opened each skill via the read-only `read_skill_file` tool), and
 * IMPACT (the always-on footprint re-sent every turn + the realized on-demand disclosure tokens).
 *
 * Fetched from the lightweight `GET /api/runs/:id/skills` (no full step/event replay). Degrades like
 * the report hook: a mid-run fetch can be partial, so a failure only surfaces as an error once the run
 * has SETTLED (loading-states rule — no error slot mid-stream).
 */
function SkillsTab({
  runId,
  stream,
  settled,
}: {
  runId: string | null;
  stream: RunStreamState;
  settled: boolean;
}) {
  const { skills, error, loading, reload } = useRunSkills(runId);
  const turns = stream.kpis?.turns ?? 0;

  if (loading && !skills) {
    return (
      <div className="flex flex-col gap-3 pr-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-44 w-full" />
      </div>
    );
  }

  // Only a SETTLED-run failure is a real error; while running, a missing fetch degrades quietly.
  if (settled && error && (!skills || skills.length === 0)) {
    return (
      <div className="pr-3">
        <InlineError title="Couldn’t load skills" detail={error} onRetry={reload} />
      </div>
    );
  }

  if (!skills || skills.length === 0) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center p-6">
        <EmptyState
          icon={<Puzzle aria-hidden />}
          title="No skills attached"
          description="This run’s environment had no attached skills, so none were loaded into the model’s context."
        />
      </div>
    );
  }

  const summary = deriveSkillSummary(skills);

  return (
    <div className="flex flex-col gap-4 pr-3">
      <MetricGrid columns={4}>
        <MetricCard
          label="Skills loaded"
          value={formatNumber(skills.length)}
          icon={<Puzzle aria-hidden />}
        />
        <MetricCard
          label="Always-on / turn"
          value={formatNumber(summary.alwaysOnPerTurn)}
          description="Resident every turn"
          positiveIsGood={false}
        />
        <MetricCard
          label="Est. always-on total"
          value={turns > 0 ? formatNumber(summary.alwaysOnPerTurn * turns) : "—"}
          description={turns > 0 ? `≈ across ${formatNumber(turns)} turn(s)` : "Awaiting turns"}
          positiveIsGood={false}
        />
        <MetricCard
          label="Disclosure tokens"
          value={formatNumber(summary.disclosureTokens)}
          description={`${formatNumber(summary.disclosureReads)} on-demand read(s)`}
          icon={<BookOpenCheck aria-hidden />}
        />
      </MetricGrid>

      <div className="flex flex-col gap-3">
        {skills.map((skill) => (
          <SkillCard key={skill.skillId} skill={skill} turns={turns} />
        ))}
      </div>

      {summary.unusedMetadataOnly > 0 ? (
        <Alert>
          <AlertTitle>
            {formatNumber(summary.unusedMetadataOnly)} metadata-only skill
            {summary.unusedMetadataOnly === 1 ? "" : "s"} loaded but never opened
          </AlertTitle>
          <AlertDescription>
            Their L1 metadata is always-on context the model never acted on. Detaching an unused
            skill, or switching it to eager only when the task needs it, trims that per-turn cost.
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

/** One loaded skill: its resolution, whether it was inlined vs. disclosed, and its per-turn impact. */
function SkillCard({ skill, turns }: { skill: RunSkill; turns: number }) {
  const alwaysOnPerTurn = skillAlwaysOnPerTurn(skill);
  const used = skill.disclosureReads > 0;
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Puzzle aria-hidden className="size-4 shrink-0" />
            <span className="min-w-0 truncate">{skill.name}</span>
            <Badge variant="secondary" className="tabular-nums">
              {skill.versionLabel}
            </Badge>
            <Badge variant={skill.eager ? "default" : "outline"}>
              {skill.eager ? "Eager · inlined" : "Metadata only"}
            </Badge>
            <Badge variant={used ? "success" : "outline"}>
              {used ? `Opened ×${formatNumber(skill.disclosureReads)}` : "Not opened"}
            </Badge>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Descriptions columns={2} layout="horizontal">
          <DescriptionsItem label="Loaded">
            {skill.eager
              ? "Full SKILL.md inlined into the system prompt up front (always-on)."
              : "Only the name + description are always-on; the body is disclosed on demand."}
          </DescriptionsItem>
          <DescriptionsItem label="Used">
            {used
              ? `Model read ${formatNumber(skill.disclosureReads)} file(s) — ${formatNumber(skill.disclosureTokens)} tokens added to context.`
              : skill.eager
                ? "Body already inlined — the model didn’t need the read tool."
                : "The model never opened this skill (no read_skill_file calls)."}
          </DescriptionsItem>
          <DescriptionsItem label="Always-on / turn" numeric>
            <span className="tabular-nums">{formatNumber(alwaysOnPerTurn)}</span> tokens
            {turns > 0 ? (
              <Text as="span" variant="meta" tone="muted" className="tabular-nums">
                {" "}
                · ≈ {formatNumber(alwaysOnPerTurn * turns)} across {formatNumber(turns)} turn(s)
              </Text>
            ) : null}
          </DescriptionsItem>
          <DescriptionsItem label="Footprint" numeric>
            {skill.footprint ? (
              <span className="tabular-nums">
                L1 {formatNumber(skill.footprint.l1MetadataTokens)} · L2{" "}
                {formatNumber(skill.footprint.l2BodyTokens)} · L3{" "}
                {formatNumber(skill.footprint.l3ResourceTokens)} · total{" "}
                {formatNumber(skill.footprint.totalTokens)}
              </span>
            ) : (
              "Version deleted — footprint unavailable."
            )}
          </DescriptionsItem>
        </Descriptions>
      </CardContent>
    </Card>
  );
}

/**
 * Fetch the run's loaded skills (`GET /api/runs/:id/skills`). Re-fetches when the run id changes or on
 * an explicit retry. A failure is kept as `error` so the caller can distinguish "still loading" from
 * "failed" — the tab shows the error only once the run has settled (mirrors {@link useRunReport}).
 */
function useRunSkills(runId: string | null): {
  skills: RunSkill[] | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
} {
  const [skills, setSkills] = useState<RunSkill[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setSkills(null);
    setError(null);
    if (!runId) return;
    setLoading(true);
    getRunSkills(runId)
      .then((result) => {
        if (!cancelled) setSkills(result);
      })
      .catch((err) => {
        if (!cancelled) setError(getErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [runId, nonce]);

  return { skills, error, loading, reload };
}

/** Per-turn always-on tokens a skill costs: eager inlines the body (L1+L2); else only the L1 entry. */
function skillAlwaysOnPerTurn(skill: RunSkill): number {
  if (!skill.footprint) return 0;
  return skill.eager
    ? skill.footprint.l1MetadataTokens + skill.footprint.l2BodyTokens
    : skill.footprint.l1MetadataTokens;
}

/** Run-level rollups for the Skills summary rail. */
function deriveSkillSummary(skills: RunSkill[]): {
  alwaysOnPerTurn: number;
  disclosureTokens: number;
  disclosureReads: number;
  unusedMetadataOnly: number;
} {
  return skills.reduce(
    (acc, skill) => ({
      alwaysOnPerTurn: acc.alwaysOnPerTurn + skillAlwaysOnPerTurn(skill),
      disclosureTokens: acc.disclosureTokens + skill.disclosureTokens,
      disclosureReads: acc.disclosureReads + skill.disclosureReads,
      unusedMetadataOnly:
        acc.unusedMetadataOnly + (!skill.eager && skill.disclosureReads === 0 ? 1 : 0),
    }),
    { alwaysOnPerTurn: 0, disclosureTokens: 0, disclosureReads: 0, unusedMetadataOnly: 0 },
  );
}

// ── Errors ─────────────────────────────────────────────────────────────────────────────────────

function ErrorsTab({
  stream,
  onNavigate,
}: {
  stream: RunStreamState;
  onNavigate?: (pane: ConsolePane, ref: ConsoleNavRef) => void;
}) {
  const rows = useMemo(() => deriveErrorRows(stream), [stream]);

  if (rows.length === 0) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center p-6">
        <EmptyState
          icon={<GanttChartSquare aria-hidden />}
          title="No errors"
          description="This run produced no failed steps, transport errors, or abnormal stop."
        />
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2 pr-3">
      {rows.map((row) => {
        const ref = errorNavRef(row);
        return (
          <li key={row.id}>
            <Card className="border-destructive/40">
              <CardContent className="flex items-start gap-3 py-3">
                <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="destructive">{row.kind}</Badge>
                    {row.turn != null ? (
                      <Text variant="meta" tone="muted" className="tabular-nums">
                        Turn {row.turn}
                      </Text>
                    ) : null}
                  </div>
                  {ref && onNavigate ? (
                    // WP 3.2 — the failing step's label jumps to it in the chat (Acceptance G9/S20).
                    <Button
                      variant="link"
                      className="h-auto justify-start whitespace-normal p-0 text-left font-medium"
                      onClick={() => onNavigate("chat", ref)}
                      title="Show this step in the chat"
                    >
                      <span className="break-words">{row.label}</span>
                    </Button>
                  ) : (
                    <Text className="break-words font-medium">{row.label}</Text>
                  )}
                  {row.detail ? (
                    <Text
                      variant="meta"
                      tone="muted"
                      className="max-h-48 overflow-auto whitespace-pre-wrap break-words"
                    >
                      {row.detail}
                    </Text>
                  ) : null}
                  {ref && onNavigate ? (
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button variant="outline" size="sm" onClick={() => onNavigate("chat", ref)}>
                        <MessageSquare aria-hidden />
                        <span>Show in chat</span>
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => onNavigate("trace", ref)}>
                        <GitBranch aria-hidden />
                        <span>Show in trace</span>
                      </Button>
                    </div>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * WP 3.2 — the cross-link ref for an Errors row: a tool error targets the exact call (with its turn
 * as the chat-side fallback), a non-tool failure targets its turn, and a terminal row with no turn
 * (e.g. a run-level stop) isn't navigable. `turn` is 1-based; the ref's `turnIndex` is 0-based.
 */
function errorNavRef(row: ErrorRow): ConsoleNavRef | null {
  if (row.toolCallId) {
    return {
      kind: "tool",
      toolCallId: row.toolCallId,
      ...(row.turn != null ? { turnIndex: row.turn - 1 } : {}),
    };
  }
  if (row.turn != null) return { kind: "turn", turnIndex: row.turn - 1 };
  return null;
}

// ── Shared layout primitives ──────────────────────────────────────────────────────────────────

/** A responsive 1→2 column grid for the chart panels. */
function ChartGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">{children}</div>;
}

/** A titled card wrapping a chart (or empty state) with a fixed-height body context. */
function ChartPanel({
  title,
  subtitle,
  icon,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>
          <span className="flex items-center gap-2">
            {icon}
            {title}
          </span>
        </CardTitle>
        {subtitle ? (
          <Text variant="meta" tone="muted">
            {subtitle}
          </Text>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">{children}</CardContent>
    </Card>
  );
}

/** Swatch legend for the context-segment series — painted from the SAME ramp token as each
 *  plotted series (never a template-literal `bg-chart-N` class: Tailwind cannot see one, so it
 *  paints only while an unrelated file spells that literal). */
function SegmentLegend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-2.5">
      {CONTEXT_SEGMENTS.map((seg, i) => (
        <li key={seg} className="flex items-center gap-1.5">
          <span className="size-2.5 shrink-0 rounded-sm" style={chartSwatchStyle(i)} aria-hidden />
          <Text variant="meta" tone="muted">
            {SEGMENT_LABELS[seg]}
          </Text>
        </li>
      ))}
    </ul>
  );
}

// ── Small formatters ──────────────────────────────────────────────────────────────────────────

/**
 * RM-33 — the tooltip rows for one bar of the input-composition chart. Only the series that actually
 * apply to this turn are listed: a `null` `cacheRead` means the split was never reported, and showing
 * it as "0" would claim there were no cache hits when the truth is that nobody said.
 */
function cachedTooltipRows(point: Record<string, unknown>) {
  const rows = [
    {
      color: "var(--chart-3)",
      label: "Uncached",
      value: formatNumber(toNumber(point.uncached)),
    },
  ];
  if (point.mergedCache !== null && point.mergedCache !== undefined) {
    rows.push({
      color: "var(--chart-8)",
      label: "Cached (split unavailable)",
      value: formatNumber(toNumber(point.mergedCache)),
    });
    return rows;
  }
  rows.push({
    color: "var(--chart-1)",
    label: "Cache read (~0.1× rate)",
    value: formatNumber(toNumber(point.cacheRead)),
  });
  // Listed only when it happened — and named a premium, since it costs MORE than an uncached token.
  if (toNumber(point.cacheWrite) > 0) {
    rows.push({
      color: "var(--chart-5)",
      label: "Cache write (1.25× rate)",
      value: formatNumber(toNumber(point.cacheWrite)),
    });
  }
  return rows;
}

function toNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
