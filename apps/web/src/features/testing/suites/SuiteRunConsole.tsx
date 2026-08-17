import { type ReactNode, useCallback, useMemo, useState } from "react";
import type {
  ProviderCredential,
  RatingState,
  Scenario,
  Suite,
  SuiteRun,
  SuiteRunStatus,
  Test,
} from "@mcp-token-footprint/shared";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Heading,
  Skeleton,
  Text,
  toast,
} from "@elabs-ai/components-ui";
import {
  ArrowLeft,
  ChevronDown,
  Download,
  Grid3x3,
  Loader2,
  StopCircle,
  WifiOff,
} from "lucide-react";
import { stopSuiteRun, suiteRunReportJsonHref, suiteRunReportMarkdownHref } from "../../../lib/api";
import { getErrorMessage } from "../../../lib/errors";
import { formatDateTime } from "../../../lib/format";
import { CLOSED_BADGE_STATUS_TONE, type StatusTone } from "../../../lib/status";
import { GRADER_LABELS, scoreTone } from "../grade-format";
import { isReviewInFlight, REVIEWING_BADGE } from "../RunBar";
import { InlineError } from "../../../components/InlineError";
import { StatusBadge } from "../../../components/StatusBadge";
// One tab shell everywhere (audit §S21/§S22) — the suite console uses the SAME TabPanel as the
// run console and every detail page: text-only triggers, pinned strip, default-scroll tab bodies.
import { TabPanel, TabPanelContent } from "../../../components/TabPanel";
import { FailureBuckets } from "./FailureBuckets";
import { deriveSeedCells } from "./derive-cells";
import { SuiteBreakdowns } from "./SuiteBreakdowns";
import { SuiteDeltas } from "./SuiteDeltas";
import { SuiteKpiRail } from "./SuiteKpiRail";
import { SuiteMatrix, SuiteMatrixLegend, type SuiteMatrixRef } from "./SuiteMatrix";
import { SuiteMembersTab } from "./SuiteMembersTab";
import { SuiteReportTab } from "./SuiteReportTab";
import { SuiteScatter } from "./SuiteScatter";
import { useSuiteAnalytics } from "./use-suite-analytics";
import { useSuiteMembers } from "./use-suite-members";
import { useSuiteStream } from "./use-suite-stream";
import { notifyError } from "../../../lib/notify";

/**
 * The live suite-run console (B9.1) — a KPI rail + the test×scenario matrix, streamed. Mirrors the
 * discipline of the single-run console (`../RunConsole` + `../use-run-stream`): cells BUILD UP as the
 * SSE stream delivers them, aggregates tick live, and a "connection lost" banner appears ONLY on a
 * genuine pre-terminal drop (a normal end-of-stream after a terminal suite status is not an error —
 * `useSuiteStream` swallows it). The persisted `suiteRun` snapshot seeds status + aggregates so the
 * rail is never blank, and a finished run reopened shows its rolled-up totals immediately.
 *
 * Clicking a cell that has a resolved child `runId` drills through to that run's own console.
 */
export type SuiteRunConsoleProps = {
  suiteRunId: string;
  /** The suite (its ordered test + scenario membership drives the matrix axes + planned repetitions). */
  suite: Suite;
  /** The persisted suite-run snapshot — seeds status + aggregates before the first live tick. */
  suiteRun: SuiteRun;
  tests: Test[];
  scenarios: Scenario[];
  /**
   * Acme Answers (WP 3.2) — used ONLY to resolve each scenario's provider KIND, so the rail can roll
   * up a questions-consumed total for `acme_answers` members (never fetched — a lightweight,
   * already-redacted list, same client `listProviders()` `RunConsoleRoute` uses for the single-run
   * console's "est." labels).
   */
  providers: ProviderCredential[];
  onBack: () => void;
  onOpenRun: (runId: string) => void;
};

const TERMINAL_SUITE_STATUSES = new Set<SuiteRunStatus>([
  "completed",
  "capped",
  "stopped",
  "error",
]);

/** The suite-run console tabs: the member-runs table (grouped by test), the live matrix, the two derived
 *  analytics views (WP 3.4), the opt-in failure-bucket taxonomy (WP 3.5), the skill-effect delta
 *  (WP 5.1, shown only for variant suites), and the Auto-Rating cross-run report (WP 4.3, AR7). */
type ConsoleTab = "runs" | "matrix" | "breakdowns" | "scatter" | "failures" | "delta" | "report";

/**
 * Suite status → the `@elabs-ai/components-ui` StatusBadge status + a human label (capped/stopped/error read
 * clearly). Auto-Rating (AR11): a TERMINAL suite run whose `ratingState` is still `pending`/`rating`
 * reads as a blue-spinner "Reviewing…" chip until the post-run suite review settles — a `failed`
 * review never turns the run red (the Report tab surfaces it); `skipped` behaves like settled.
 */
export function suiteStatusBadge(
  status: SuiteRunStatus,
  ratingState?: RatingState | null,
): {
  status: "pending" | "running" | "complete" | "denied" | "skipped" | "failed";
  label: string;
} {
  if (TERMINAL_SUITE_STATUSES.has(status) && isReviewInFlight(ratingState)) {
    return REVIEWING_BADGE;
  }
  switch (status) {
    case "pending":
      return { status: "pending", label: "Pending" };
    case "running":
      return { status: "running", label: "Running" };
    case "completed":
      return { status: "complete", label: "Completed" };
    case "capped":
      return { status: "denied", label: "Cost-capped" };
    case "stopped":
      return { status: "skipped", label: "Stopped" };
    case "error":
      return { status: "failed", label: "Error" };
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

/** {@link scoreTone}'s three buckets, restated as {@link StatusTone} members (identical string
 *  values — kept as an explicit map rather than a cast so the two vocabularies can drift safely). */
const SCORE_TONE_TO_STATUS_TONE: Record<ReturnType<typeof scoreTone>, StatusTone> = {
  success: "success",
  warning: "warning",
  danger: "danger",
};

/**
 * T10 ("numbers that do not reconcile") — the suite-run header chip used to tone PURELY off execution
 * state: any `"completed"` run rendered the same flat green "Completed" chip regardless of how the
 * matrix actually scored, so a run that finished but graded terribly (e.g. a 0.0% pass rate) still
 * painted as an unqualified success directly above the KPI rail's own "Pass rate 0.0%" — a green chip
 * sitting on top of a number that says the opposite. This separates the two axes explicitly: the
 * LABEL still says "Completed" (execution genuinely finished — that fact doesn't change), but the
 * TONE now reflects the graded OUTCOME once one exists, via the SAME threshold `scoreTone` uses for
 * every other rendered 0–1 score in the app (danger `< 0.6`, warning `0.6–<0.8`, success `≥ 0.8`).
 * Every other status (`running`/`pending`/`capped`/`stopped`/`error`) already carries its own
 * non-green tone from execution state alone — nothing to reconcile there, so they pass through
 * unchanged. `passRate === null` (no grades yet, or an ungraded suite) also passes through unchanged
 * — there's no outcome signal to contradict the execution state with, so inventing one would be worse
 * than the bug this fixes.
 */
export function suiteHeaderTone(
  badgeStatus: ReturnType<typeof suiteStatusBadge>["status"],
  passRate: number | null,
): StatusTone {
  if (badgeStatus !== "complete" || passRate === null) {
    return CLOSED_BADGE_STATUS_TONE[badgeStatus];
  }
  return SCORE_TONE_TO_STATUS_TONE[scoreTone(passRate)];
}

export function SuiteRunConsole({
  suiteRunId,
  suite,
  suiteRun,
  tests,
  scenarios,
  providers,
  onBack,
  onOpenRun,
}: SuiteRunConsoleProps) {
  const stream = useSuiteStream(suiteRunId);
  const [stopping, setStopping] = useState(false);
  // Default to the Runs table for a FINISHED run (the complaint this view fixes — show what executed);
  // keep the live Matrix as the default while a run is still streaming.
  const [tab, setTab] = useState<ConsoleTab>(() =>
    TERMINAL_SUITE_STATUSES.has(suiteRun.status) ? "runs" : "matrix",
  );
  // The score dimension the analytics are computed under: "" = default primary-grader priority.
  const [grader, setGrader] = useState("");

  // Effective status/aggregates: prefer the live stream, fall back to the persisted snapshot so the
  // console is never blank on open (loading-states: seed, then build up).
  const status = stream.status ?? suiteRun.status;
  const aggregates = stream.aggregates ?? suiteRun.aggregates ?? null;
  const isTerminal = TERMINAL_SUITE_STATUSES.has(status);
  // T10 — the SAME pass-rate figure the KPI rail's own "Pass rate" tile reads (`SuiteKpiRail.tsx`'s
  // `aggregates?.passRateAt05`), read here too so the header chip's tone can be reconciled against it
  // (see `suiteHeaderTone`) instead of silently contradicting it.
  const passRate = aggregates?.passRateAt05 ?? null;
  // Auto-Rating (AR11) — the suite-level review axis: prefer the live stream's rating events, fall
  // back to the persisted snapshot (a row from a plain list fetch renders "Reviewing…" the same way,
  // no polling). Drives the header chip, the Report tab-label spinner, and the Report tab's state.
  const ratingState = stream.ratingState ?? suiteRun.ratingState ?? null;
  const reviewing = isTerminal && isReviewInFlight(ratingState);

  // The persisted member runs (test × scenario × repetition), re-fetched as the run settles. Unlike the
  // live-only cell stream, these exist for a FINISHED run — so they both back the Runs tab AND seed the
  // matrix (below), which is what makes a finished run's matrix real + clickable again.
  const members = useSuiteMembers(suiteRunId, status);
  // Seed the matrix from the persisted members, letting live stream cells win (they carry fresher status
  // + a monotonic seq). For a finished run `stream.cells` is empty, so the seed IS the matrix.
  const seedCells = useMemo(() => deriveSeedCells(members.members), [members.members]);
  const mergedCells = useMemo(() => ({ ...seedCells, ...stream.cells }), [seedCells, stream.cells]);

  const analytics = useSuiteAnalytics(suiteRunId, grader, status);
  const graderLabel = grader
    ? (GRADER_LABELS[grader as keyof typeof GRADER_LABELS] ?? grader)
    : "Primary grader";

  const testName = useMemo(() => new Map(tests.map((t) => [t.id, t.name])), [tests]);
  const scenarioName = useMemo(() => new Map(scenarios.map((s) => [s.id, s.name])), [scenarios]);

  // Matrix axes: the suite's ordered membership first, then any id that streamed a cell but isn't in
  // the suite any more (it changed since this run) so a live cell is never dropped.
  const testRefs = useMemo<SuiteMatrixRef[]>(
    () =>
      axisRefs(
        suite.testIds,
        Object.values(mergedCells).map((c) => c.testId),
        testName,
      ),
    [suite.testIds, mergedCells, testName],
  );
  const scenarioRefs = useMemo<SuiteMatrixRef[]>(
    () =>
      axisRefs(
        suite.scenarioIds,
        Object.values(mergedCells).map((c) => c.scenarioId),
        scenarioName,
      ),
    [suite.scenarioIds, mergedCells, scenarioName],
  );

  const badge = suiteStatusBadge(status, ratingState);
  const hasMatrix = testRefs.length > 0 && scenarioRefs.length > 0;
  // WP 5.1 — the Delta tab exists only for a skill-effect suite run (one with variants in its snapshot).
  const variants = useMemo(
    () => suiteRun.configSnapshot.variants ?? [],
    [suiteRun.configSnapshot.variants],
  );
  const hasVariants = variants.length > 0;

  const handleStop = useCallback(async () => {
    setStopping(true);
    try {
      await stopSuiteRun(suiteRunId);
      toast("Stopping suite run…", {
        description: "Scheduling halted; in-flight cells are being aborted.",
      });
    } catch (error) {
      notifyError("Couldn’t stop the suite run.", {
        description: `${getErrorMessage(error)} Try again.`,
      });
    } finally {
      setStopping(false);
    }
  }, [suiteRunId]);

  return (
    // §S22 — the console is a definite-height, non-scrolling column (the route mounts full-bleed, like
    // the run console): the header + KPI rail are PINNED (`shrink-0`), the TabPanel fills the rest, and
    // each tab BODY owns the scroll (TabPanelContent's default mode). The `max-w-6xl` centering +
    // horizontal padding move onto the pinned/content regions so the frame itself spans full height.
    <div className="flex h-full min-h-0 flex-col bg-background" aria-label="Suite run console">
      <div className="mx-auto flex w-full max-w-6xl shrink-0 flex-col gap-4 px-6 pt-5">
        {/* Header — suite identity + live status + controls. */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <Heading level={2} className="min-w-0 truncate text-balance">
                {suite.name}
              </Heading>
              {/* Unified Sessions (WP3.1) — the app-local `StatusBadge` (single renderer everywhere),
                  not `@elabs-ai/components-ui`'s own closed-enum one. `suiteStatusBadge`'s logic/tests are UNCHANGED
                  (a suite-run status is its own, smaller vocabulary — outside the run/session locked
                  table); only the CHIP TECHNOLOGY it renders through moves onto the shared component,
                  via `CLOSED_BADGE_STATUS_TONE` (the same bridge `RunBar`'s legacy helpers use). */}
              <StatusBadge
                view={{
                  kind: "chip",
                  label: badge.label,
                  // T10 — toned by OUTCOME (pass rate) when the run finished, not just execution
                  // state; see `suiteHeaderTone`'s doc for why "Completed" alone isn't the whole
                  // story once a matrix has actually been graded.
                  tone: suiteHeaderTone(badge.status, passRate),
                  spinner: badge.status === "running",
                  dashed: badge.status === "pending",
                }}
              />
            </div>
            <Text variant="meta" tone="muted">
              Started {formatDateTime(suiteRun.startedAt)}
              {suiteRun.endedAt ? ` · ended ${formatDateTime(suiteRun.endedAt)}` : ""} · repetitions{" "}
              <span className="tabular-nums">{suite.config.repetitions}</span> · concurrency{" "}
              <span className="tabular-nums">{suite.config.maxConcurrency}</span>
            </Text>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onBack}>
              <ArrowLeft aria-hidden />
              <span>Suites</span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Download aria-hidden />
                  <span>Export report</span>
                  <ChevronDown aria-hidden className="size-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <a href={suiteRunReportMarkdownHref(suiteRunId)}>Markdown</a>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a href={suiteRunReportJsonHref(suiteRunId)} target="_blank" rel="noreferrer">
                    JSON
                  </a>
                </DropdownMenuItem>
                {/* embed=full — embeds each member run's complete session log (steps/events), so the file
                  carries what actually happened inside every run, not just links to them. */}
                <DropdownMenuItem asChild>
                  <a href={suiteRunReportMarkdownHref(suiteRunId, "full")}>
                    Markdown — full run details
                  </a>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a
                    href={suiteRunReportJsonHref(suiteRunId, "full")}
                    target="_blank"
                    rel="noreferrer"
                  >
                    JSON — full run details
                  </a>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {!isTerminal ? (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => void handleStop()}
                disabled={stopping}
              >
                {stopping ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <StopCircle aria-hidden />
                )}
                <span>{stopping ? "Stopping…" : "Stop"}</span>
              </Button>
            ) : null}
          </div>
        </div>

        {/* Pre-terminal connection drop — surfaced ONLY while the run is still live (terminal-only error). */}
        {stream.error && !isTerminal ? (
          <Alert variant="warning">
            <WifiOff aria-hidden />
            <AlertTitle>Live updates interrupted</AlertTitle>
            <AlertDescription>
              {stream.error} Reconnecting automatically — the matrix and KPIs resume when the stream
              recovers.
            </AlertDescription>
          </Alert>
        ) : null}

        <SuiteKpiRail
          aggregates={aggregates}
          costCapUsd={suite.config.aggregateCostCapUsd}
        />
      </div>

      {/* Matrix + the two DERIVED analytics views (WP 3.4). The matrix streams live; the analytics are
          server-computed from the child runs + grades, so they justify the feature even for a finished
          run whose per-cell stream isn't re-materialised. The strip is the SHARED TabPanel (text-only
          labels — no per-tab icons anywhere in the app, owner feedback 2026-07-12); each tab's BODY is
          the scroll container (TabPanelContent default mode — the old capped `ScrollArea` hacks that
          left content unscrollable are gone). */}
      <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col px-6 pb-6">
        <TabPanel
          value={tab}
          onValueChange={(v) => setTab(v as ConsoleTab)}
          className="pt-4"
          tabs={[
            { value: "runs", label: "Runs" },
            // Insights-first: the cross-run Report sits directly after Runs so the verdict/narrative
            // comes early in the strip; Runs stays the default tab for a finished run. While the
            // post-terminal suite review is in flight the label carries a small spinner (AR11) —
            // mirrors the run console's Report tab.
            {
              value: "report",
              label: reviewing ? (
                <span className="flex items-center gap-1.5">
                  Report
                  <Loader2
                    aria-hidden
                    className="size-3.5 animate-spin motion-reduce:animate-none"
                  />
                  <span className="sr-only">(rating in progress)</span>
                </span>
              ) : (
                "Report"
              ),
            },
            { value: "matrix", label: "Matrix" },
            { value: "breakdowns", label: "Breakdowns" },
            { value: "scatter", label: "Quality × cost" },
            { value: "failures", label: "Failure buckets" },
            ...(hasVariants ? [{ value: "delta", label: "Skill effect" }] : []),
          ]}
        >
          <TabPanelContent value="runs">
            <SuiteMembersTab
              members={members.members}
              loading={members.loading}
              error={members.error}
              onRetry={members.reload}
              tests={testRefs}
              scenarioName={scenarioName}
              onOpenRun={onOpenRun}
            />
          </TabPanelContent>

          <TabPanelContent value="report">
            <SuiteReportTab
              suiteRunId={suiteRunId}
              isTerminal={isTerminal}
              reviewing={reviewing}
              memberCount={members.members.length}
              testName={testName}
              onOpenRun={onOpenRun}
            />
          </TabPanelContent>

          <TabPanelContent value="matrix">
            {!hasMatrix ? (
              <EmptyState
                icon={<Grid3x3 aria-hidden />}
                title="No matrix to show"
                description="This suite has no tests or environments bound, so there is no test × environment matrix to run."
              />
            ) : (
              <section className="flex flex-col gap-3" aria-label="Suite matrix">
                <SuiteMatrix
                  tests={testRefs}
                  scenarios={scenarioRefs}
                  cells={mergedCells}
                  repetitions={suite.config.repetitions}
                  onOpenRun={onOpenRun}
                />
                <SuiteMatrixLegend />
              </section>
            )}
          </TabPanelContent>

          <TabPanelContent value="breakdowns">
            <AnalyticsTab
              loading={analytics.loading}
              error={analytics.error}
              hasData={analytics.analytics !== null}
              onRetry={analytics.reload}
            >
              {analytics.analytics ? (
                <SuiteBreakdowns
                  analytics={analytics.analytics}
                  scenarios={scenarioRefs}
                  graderLabel={graderLabel}
                />
              ) : null}
            </AnalyticsTab>
          </TabPanelContent>

          <TabPanelContent value="scatter">
            <AnalyticsTab
              loading={analytics.loading}
              error={analytics.error}
              hasData={analytics.analytics !== null}
              onRetry={analytics.reload}
            >
              {analytics.analytics ? (
                <SuiteScatter
                  analytics={analytics.analytics}
                  scenarios={scenarioRefs}
                  testName={testName}
                  grader={grader}
                  onGraderChange={setGrader}
                  cells={mergedCells}
                  onOpenRun={onOpenRun}
                />
              ) : null}
            </AnalyticsTab>
          </TabPanelContent>

          <TabPanelContent value="failures">
            <FailureBuckets
              suiteRunId={suiteRunId}
              aggregates={aggregates}
              isTerminal={isTerminal}
              onOpenRun={onOpenRun}
            />
          </TabPanelContent>

          {hasVariants ? (
            <TabPanelContent value="delta">
              <SuiteDeltas
                suiteRunId={suiteRunId}
                variants={variants}
                testName={testName}
                repetitions={suite.config.repetitions}
                status={status}
              />
            </TabPanelContent>
          ) : null}
        </TabPanel>
      </div>
    </div>
  );
}

/**
 * Shared loading/error frame for an analytics tab: a layout-shaped skeleton before the first fetch
 * settles (loading-states rule — no collapsing spinner), a retry surface only on a settled failure with
 * no data, else the rendered analytics. The analytics themselves handle their own honest EmptyState.
 * Scrolling is owned by the surrounding `TabPanelContent` body (§S22) — no inner scroll container.
 */
function AnalyticsTab({
  loading,
  error,
  hasData,
  onRetry,
  children,
}: {
  loading: boolean;
  error: string | null;
  hasData: boolean;
  onRetry: () => void;
  children: ReactNode;
}) {
  if (error && !hasData) {
    return <InlineError title="Couldn’t load suite analytics" detail={error} onRetry={onRetry} />;
  }
  if (loading && !hasData) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }
  return <>{children}</>;
}

/** Ordered axis refs: the suite's own ids first, then any extra id seen in a streamed cell. */
function axisRefs(
  suiteIds: string[],
  seenIds: string[],
  names: Map<string, string>,
): SuiteMatrixRef[] {
  const ordered: string[] = [...suiteIds];
  for (const id of seenIds) {
    if (!ordered.includes(id)) ordered.push(id);
  }
  return ordered.map((id) => ({ id, name: names.get(id) ?? shortId(id) }));
}

/** A readable fallback label for an id whose entity no longer resolves (deleted since the run). */
function shortId(id: string): string {
  return `#${id.slice(0, 6)}`;
}
