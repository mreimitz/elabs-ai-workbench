import { useCallback, useEffect, useState } from "react";
import type {
  FailureBucket,
  FixTarget,
  RootCauseBucket,
  SuiteReport,
  SuiteReportBaseline,
  SuiteReportBaselinePerTest,
  SuiteReportTestGroup,
  SuiteReportVariance,
  SuiteRootCauseRollupEntry,
} from "@mcp-token-footprint/shared";
import { CLAUDE_CLI_PROVIDER_ID } from "@mcp-token-footprint/shared";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
  toast,
} from "@elabs-ai/components-ui";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Loader2,
  RotateCcw,
  Scale,
  Wrench,
} from "lucide-react";
import { getSuiteReport, regenerateSuiteReport } from "../../../lib/api";
import { getErrorMessage } from "../../../lib/errors";
import { formatCostUsd } from "../../../lib/format";
import { formatNumber, formatPercent } from "../../../lib/format";
import { InlineError } from "../../../components/InlineError";
import { SubscriptionCostMarker } from "../../../components/SubscriptionCostMarker";
import { notifyError } from "../../../lib/notify";

/**
 * Auto-Rating (WP 4.3, AR7/AR10–AR12) — the suite console's cross-run rating report. Self-loading: it
 * fetches the LATEST persisted {@link SuiteReport} via `GET /api/suite-runs/:id/report` on mount, follows
 * the failures/delta tabs' discipline (a component that owns its own loading/error/empty state rather
 * than depending on the shared analytics hook), and offers an explicit, append-only Regenerate action
 * (`POST /api/suite-runs/:id/report`).
 *
 * AR7 — a suite report exists only for suite runs with ≥2 members; fewer members is an HONEST empty
 * state (never a fake report), not an error. AR11 — rating never blocks/fails the suite run itself, so
 * this tab degrades quietly on any fetch/regenerate failure rather than affecting the run.
 *
 * Loading-states discipline (`.claude/rules/loading-states.md`):
 *   - `loading` (no content yet) → a layout-shaped {@link Skeleton}, never a collapsing spinner.
 *   - An error slot renders ONLY once the fetch has SETTLED into a failure.
 *   - A still-running suite run shows a calm "pending" panel, never a skeleton/error (the report only
 *     exists once the run — and its post-`finish()` report hook — have settled).
 */
export type SuiteReportTabProps = {
  suiteRunId: string;
  /** Only a settled suite run can carry a report (generation is chained off the orchestrator's `finish()`). */
  isTerminal: boolean;
  /**
   * Auto-Rating (AR11) — true while the TERMINAL suite run's post-run review (which writes this very
   * report) is still in flight (`ratingState` pending|rating). The tab then shows an ACTIVE "Rating
   * in progress…" presentation and defers the fetch, refetching automatically once the review
   * settles (the prop is reactive via the suite's SSE stream).
   */
  reviewing?: boolean;
  /** The suite run's current member count — informs the honest "needs ≥2 members" (AR7) empty state. */
  memberCount: number;
  /** Test id → name, for readable per-test-group rows. */
  testName: Map<string, string>;
  /** Drill from a clustered/rolled-up member run to its own console. */
  onOpenRun: (runId: string) => void;
};

export function SuiteReportTab({
  suiteRunId,
  isTerminal,
  reviewing = false,
  memberCount,
  testName,
  onOpenRun,
}: SuiteReportTabProps) {
  const [report, setReport] = useState<SuiteReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    // A still-running suite run has no report to fetch (AR11 — post-terminal only). Clear any stale
    // state so a run re-opened live doesn't flash a previous session's report.
    if (!isTerminal) {
      setReport(null);
      setError(null);
      setLoading(false);
      return;
    }
    // AR11 — the review that WRITES this report is still running: defer the fetch (existing state is
    // kept); the transition to a settled rating re-runs this effect and fetches the finished report.
    if (reviewing) {
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    getSuiteReport(suiteRunId)
      .then((result) => {
        if (active) setReport(result);
      })
      .catch((cause: unknown) => {
        if (active) setError(getErrorMessage(cause, "Couldn’t load the suite report."));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [suiteRunId, isTerminal, reviewing, nonce]);

  const regenerate = useCallback(async () => {
    setRegenerating(true);
    try {
      const result = await regenerateSuiteReport(suiteRunId);
      if (result.report) {
        setReport(result.report);
        setError(null);
        toast.success("Suite report regenerated");
      } else {
        toast(
          result.reason === "insufficient_members"
            ? "A cross-run report needs at least 2 member runs."
            : "Report generation produced nothing (the suite run may have changed). Try again shortly.",
        );
      }
    } catch (cause) {
      notifyError("Couldn’t regenerate the report.", {
        description: `${getErrorMessage(cause)} Try again.`,
      });
    } finally {
      setRegenerating(false);
    }
  }, [suiteRunId]);

  if (!isTerminal) {
    return (
      <EmptyState
        icon={<Scale aria-hidden />}
        title="Report pending"
        description="The cross-run rating report appears here once the suite run finishes — every ≥2-member suite run is rated automatically."
      />
    );
  }

  // AR11 — terminal, review in flight, nothing loaded yet: the ACTIVE presentation (the rating that
  // writes this report is genuinely running right now — not the passive "pending" of a live run).
  if (reviewing && !report) {
    return (
      <div className="flex flex-col gap-3">
        <output className="flex items-center gap-2">
          <Loader2
            aria-hidden
            className="size-4 animate-spin text-info-text motion-reduce:animate-none"
          />
          <Text className="font-medium">Rating in progress…</Text>
        </output>
        <Text variant="meta" tone="muted">
          The suite run finished — the cross-run review is rating it now. The report appears here
          the moment the rating settles.
        </Text>
        <div aria-hidden>
          <SuiteReportSkeleton />
        </div>
      </div>
    );
  }

  if (loading) return <SuiteReportSkeleton />;

  if (error) {
    return (
      <InlineError
        title="Couldn’t load the suite report"
        detail={error}
        onRetry={() => setNonce((current) => current + 1)}
      />
    );
  }

  if (!report) {
    return (
      <div className="flex flex-col gap-4">
        <EmptyState
          icon={<Scale aria-hidden />}
          title="No cross-run report yet"
          description={
            memberCount < 2
              ? "A cross-run rating report is generated only for suite runs with at least 2 member runs (AR7). This run has too few to report on."
              : "No report has been generated yet for this suite run. Press Regenerate to build one now."
          }
          actions={
            memberCount < 2 ? undefined : (
              <Button
                variant="default"
                size="sm"
                onClick={() => void regenerate()}
                disabled={regenerating}
              >
                <RotateCcw aria-hidden />
                <span>{regenerating ? "Generating…" : "Regenerate"}</span>
              </Button>
            )
          }
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Insights-first: the composed narrative verdict LEADS (inside the header card), then the
          summary chips, then the statistics/details cards below. */}
      <ConsistencyHeaderCard
        report={report}
        // A background review (AR11) disables Regenerate too — the report is being rewritten already.
        regenerating={regenerating || reviewing}
        onRegenerate={() => void regenerate()}
      />
      <TestGroupsCard
        testGroups={report.testGroups}
        testName={testName}
        baseline={report.baseline}
      />
      <RootCauseRollupCard entries={report.rootCauseRollup} onOpenRun={onOpenRun} />
      <ErrorClusteringCard buckets={report.errorClustering} onOpenRun={onOpenRun} />
    </div>
  );
}

// ── Consistency header — narrative verdict LEADS (insights-first), then chips + provenance ──────

function ConsistencyHeaderCard({
  report,
  regenerating,
  onRegenerate,
}: {
  report: SuiteReport;
  regenerating: boolean;
  onRegenerate: () => void;
}) {
  const agreeing = report.testGroups.filter((g) => !g.agreement.contradicts).length;
  const contradicting = report.testGroups.length - agreeing;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <Scale aria-hidden className="size-4" />
            Cross-run report
          </span>
          <Button variant="outline" size="sm" onClick={onRegenerate} disabled={regenerating}>
            <RotateCcw aria-hidden />
            <span>{regenerating ? "Regenerating…" : "Regenerate"}</span>
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {/* Insights-first — the composed verdict narrative is the LEAD content of the report; the
            static "how this report is built" explainer is demoted to muted meta text below. */}
        {report.narrative.trim().length > 0 ? (
          <Text className="whitespace-pre-wrap text-balance font-medium">{report.narrative}</Text>
        ) : (
          <Text variant="meta" tone="muted">
            No narrative composed yet — it appears once the per-test-group agreement calls resolve.
          </Text>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {report.status === "partial" ? (
            <Badge variant="warning">Partial — some member ratings missing</Badge>
          ) : null}
          {report.status === "error" ? (
            <Badge variant="destructive">Error — report generation failed</Badge>
          ) : null}
          <Badge variant="secondary" className="tabular-nums">
            {formatNumber(report.testGroups.length)} test group
            {report.testGroups.length === 1 ? "" : "s"}
          </Badge>
          <Badge variant={contradicting > 0 ? "warning" : "success"} className="tabular-nums">
            {agreeing} agree{agreeing === 1 ? "s" : ""}
          </Badge>
          {contradicting > 0 ? (
            <Badge variant="destructive" className="tabular-nums">
              {contradicting} contradict{contradicting === 1 ? "s" : ""}
            </Badge>
          ) : null}
        </div>
        <Text variant="meta" tone="muted">
          Deterministic per-test-group variance + one LLM agreement call per group (never pairwise),
          a cross-run root-cause roll-up, and error clustering — a separate dimension from any
          single run's own rating.
        </Text>
        <div className="flex flex-wrap items-center gap-1.5">
          <Text variant="meta" tone="muted">
            Rated by:
          </Text>
          <Text variant="meta" className="font-medium">
            {judgeProvenanceLabel(report.judgeProvenance)}
          </Text>
          <Text variant="meta" tone="muted">
            · generated {new Date(report.generatedAt).toLocaleString()}
          </Text>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Per-test-group consistency + variance ───────────────────────────────────────────────────────

function TestGroupsCard({
  testGroups,
  testName,
  baseline,
}: {
  testGroups: SuiteReportTestGroup[];
  testName: Map<string, string>;
  /** Cross-suite-run comparability — present only when a comparable earlier run had a report. */
  baseline?: SuiteReportBaseline;
}) {
  const deltaByTest = new Map(baseline?.perTest.map((entry) => [entry.testId, entry]) ?? []);
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-subtitle">Per-test-group agreement + variance</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {testGroups.length === 0 ? (
          <EmptyState
            icon={<ClipboardList aria-hidden />}
            title="No test groups"
            description="This suite run has no graded test groups to report on."
          />
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-40">Test</TableHead>
                  <TableHead className="min-w-48">Agreement</TableHead>
                  <TableHead className="min-w-32 text-right">Score</TableHead>
                  <TableHead className="min-w-32 text-right">Cost</TableHead>
                  <TableHead className="min-w-32 text-right">Turns</TableHead>
                  <TableHead className="min-w-24 text-right">Tool-path variance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {testGroups.map((group) => (
                  <TableRow key={group.testId}>
                    <TableCell className="align-top">
                      <div className="flex min-w-0 flex-col gap-1">
                        <span className="text-pretty font-medium">
                          {testName.get(group.testId) ?? `#${group.testId.slice(0, 6)}`}
                        </span>
                        <BaselineDeltaLine delta={deltaByTest.get(group.testId)} />
                      </div>
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="flex flex-col gap-1">
                        <Badge
                          variant={group.agreement.contradicts ? "destructive" : "success"}
                          className="w-fit tabular-nums"
                        >
                          {`${group.agreement.contradicts ? "Contradicts" : "Agrees"} (${group.agreement.agreeCount}/${group.agreement.totalCount})`}
                        </Badge>
                        {group.agreement.summary ? (
                          <Text variant="meta" tone="muted" className="text-pretty">
                            {group.agreement.summary}
                          </Text>
                        ) : null}
                        <FindingsList findings={group.findings} />
                      </div>
                    </TableCell>
                    <TableCell className="align-top text-right">
                      <VarianceReadout variance={group.score} format={(v) => v.toFixed(2)} />
                    </TableCell>
                    <TableCell className="align-top text-right">
                      {/* Claude subscription (WP 3.1, D-CS4) — mark the Cost mean "est." when this
                          group had a subscription shadow-priced member run. Consumes WP 2.2's finding
                          text (the service already surfaces the marker there) — no service re-touch. */}
                      {groupHasSubscriptionEstimate(group) ? (
                        <span className="inline-flex items-center justify-end gap-1.5">
                          <VarianceReadout
                            variance={group.costUsd}
                            format={(v) => formatCostUsd(v, { precision: 4 })}
                          />
                          <SubscriptionCostMarker />
                        </span>
                      ) : (
                        <VarianceReadout
                          variance={group.costUsd}
                          format={(v) => formatCostUsd(v, { precision: 4 })}
                        />
                      )}
                    </TableCell>
                    <TableCell className="align-top text-right">
                      <VarianceReadout variance={group.turns} format={(v) => v.toFixed(1)} />
                    </TableCell>
                    <TableCell className="align-top text-right tabular-nums">
                      {group.toolPathVariance}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {/* Column legend (owner feedback 2026-07-12) — every statistic says what it means and how it
            was computed. Copy verified against `apps/api/src/suites/suite-report-service.ts`. */}
        {testGroups.length > 0 ? (
          <div className="flex flex-col gap-1">
            <Text variant="meta" tone="muted" className="text-pretty">
              <span className="font-medium">Agreement</span> — one judge call per test comparing the
              repeated runs’ final answers; N/M = how many runs side with the majority conclusion.
            </Text>
            <Text variant="meta" tone="muted" className="text-pretty">
              <span className="font-medium">Score mean ± std</span> — the primary grader’s outcome
              score (0–1) across the test’s runs, ± population standard deviation (spread =
              inconsistency between repetitions).
            </Text>
            <Text variant="meta" tone="muted" className="text-pretty">
              <span className="font-medium">Cost / Turns mean ± std</span> — the same statistic over
              each run’s cost (USD) and turn count.
            </Text>
            <Text variant="meta" tone="muted" className="text-pretty">
              <span className="font-medium">Tool-path variance</span> — the number of distinct
              tool-call sequences across the runs; 1 = a perfectly consistent path.
            </Text>
            {baseline ? (
              <Text variant="meta" tone="muted" className="text-pretty">
                <span className="font-medium">vs previous run</span> — compared against the most
                recent earlier comparable suite run’s report (same suite, or the same set of tests).
              </Text>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** "mean ± std", or a muted "n/a" when unevaluable (zero graded members) — NEVER a forced 0. */
function VarianceReadout({
  variance,
  format,
}: { variance: SuiteReportVariance; format: (v: number) => string }) {
  if (variance.mean === null || variance.stdDev === null) {
    return (
      <Text variant="meta" tone="muted">
        n/a
      </Text>
    );
  }
  return (
    <Text className="tabular-nums">
      {format(variance.mean)} ± {format(variance.stdDev)}
    </Text>
  );
}

/**
 * Claude subscription (WP 3.1, D-CS4/D-CS8) — the marker phrase WP 2.2's suite-report service emits in
 * a test group's `findings` when any of its runs priced through the subscription's shadow-reference
 * estimate (`apps/api/src/suites/suite-report-service.ts` `computeTestGroupFindings`). Matching it lets
 * the Cost column render the shared "est." marker WITHOUT re-touching the service (a WP 3.1 boundary).
 */
const SUBSCRIPTION_FINDING_PHRASE = "est. · subscription";

/** True when this group's WP 2.2 findings flag a subscription shadow-priced member run (so the Cost
 *  mean is partly a reference estimate). Consumes the already-surfaced finding text, no new API field. */
function groupHasSubscriptionEstimate(group: SuiteReportTestGroup): boolean {
  return group.findings?.some((f) => f.includes(SUBSCRIPTION_FINDING_PHRASE)) ?? false;
}

/**
 * Deterministic, evidence-grounded findings highlights for one test group (suite-report enrichment).
 * Absent (pre-enrichment report) and empty (an honest quiet group) both render nothing.
 */
function FindingsList({ findings }: { findings?: string[] }) {
  if (!findings || findings.length === 0) return null;
  return (
    <ul className="flex flex-col gap-0.5">
      {findings.map((finding) => (
        <li key={finding} className="flex items-start gap-1.5">
          <AlertTriangle aria-hidden className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
          <Text variant="meta" tone="muted" className="min-w-0 text-pretty">
            {finding}
          </Text>
        </li>
      ))}
    </ul>
  );
}

/** Compact "vs previous run" current-minus-baseline deltas for one test group. Null deltas read "n/a". */
function BaselineDeltaLine({ delta }: { delta?: SuiteReportBaselinePerTest }) {
  if (!delta) return null;
  const parts = [
    `Δ score ${signedDelta(delta.scoreMeanDelta, (v) => v.toFixed(2))}`,
    `Δ cost ${signedDelta(delta.costMeanDelta, (v) => formatCostUsd(v, { precision: 4 }))}`,
    `Δ turns ${signedDelta(delta.turnsMeanDelta, (v) => v.toFixed(1))}`,
  ];
  if (delta.agreementFlipped) parts.push("agreement flipped");
  return (
    <Text variant="meta" tone="muted" className="tabular-nums text-pretty">
      vs previous run: {parts.join(" · ")}
    </Text>
  );
}

/** Signed delta readout ("+", "−", or "±0" for exactly zero); null (unevaluable side) reads "n/a". */
function signedDelta(value: number | null, format: (v: number) => string): string {
  if (value === null) return "n/a";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "±";
  return `${sign}${format(Math.abs(value))}`;
}

// ── Root-cause roll-up ───────────────────────────────────────────────────────────────────────────

function RootCauseRollupCard({
  entries,
  onOpenRun,
}: {
  entries: SuiteRootCauseRollupEntry[];
  onOpenRun: (runId: string) => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-subtitle">
          <span className="flex items-center gap-2">
            <Wrench aria-hidden className="size-4" />
            Root-cause roll-up
          </span>
          <Badge
            variant={entries.length > 0 ? "destructive" : "secondary"}
            className="tabular-nums font-normal"
          >
            {formatNumber(entries.length)}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Text variant="meta" tone="muted">
          Clustered from each member run’s error-forensics findings by root cause + fix target —
          deterministic, no extra judge call.
        </Text>
        {entries.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 aria-hidden />}
            title="Nothing to roll up"
            description="No cross-run error findings were clustered (operationally clean)."
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {entries.map((entry, index) => (
              <li
                key={`${entry.bucket}-${entry.fixTarget}-${index}`}
                className="flex flex-col gap-2 rounded-md border border-border bg-muted/20 p-3"
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline">{BUCKET_LABELS[entry.bucket]}</Badge>
                  <Badge variant={FIX_TARGET_META[entry.fixTarget].variant}>
                    {FIX_TARGET_META[entry.fixTarget].label}
                  </Badge>
                  <Badge variant="secondary" className="tabular-nums">
                    {formatNumber(entry.frequency)}× across{" "}
                    {formatNumber(entry.memberRunIds.length)} run
                    {entry.memberRunIds.length === 1 ? "" : "s"}
                  </Badge>
                </div>
                <div className="rounded-md border border-border bg-card p-2.5">
                  <div className="flex items-center gap-1.5">
                    <Wrench aria-hidden className="size-3.5 text-muted-foreground" />
                    <Text
                      variant="meta"
                      tone="muted"
                      className="font-medium uppercase tracking-wide"
                    >
                      Representative suggested fix
                    </Text>
                  </div>
                  <Text className="mt-1 break-words">{entry.draftFix}</Text>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {entry.memberRunIds.map((runId) => (
                    <Button
                      key={runId}
                      variant="outline"
                      size="sm"
                      className="h-6 px-2 font-mono text-caption"
                      onClick={() => onOpenRun(runId)}
                      title={`Open run ${runId}`}
                    >
                      #{runId.slice(0, 6)}
                    </Button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ── Error clustering (deterministic — always part of the mandatory report, AR12) ────────────────

function ErrorClusteringCard({
  buckets,
  onOpenRun,
}: { buckets: FailureBucket[]; onOpenRun: (runId: string) => void }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-subtitle">Error clustering</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Text variant="meta" tone="muted">
          Deterministic clusters of the member runs’ error findings by category; share = the
          fraction of member runs that hit the category.
        </Text>
        {buckets.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 aria-hidden />}
            title="No error clusters"
            description="No member run in this suite run carried a deterministic error-forensics finding."
          />
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-56">Cluster</TableHead>
                  <TableHead className="min-w-24 text-right">Share</TableHead>
                  <TableHead className="min-w-48">Member runs</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {buckets.map((bucket, index) => (
                  <TableRow key={`${bucket.label}-${index}`}>
                    <TableCell className="align-top">
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="font-medium text-pretty">{bucket.label}</span>
                        {bucket.description ? (
                          <Text variant="meta" tone="muted" className="text-pretty">
                            {bucket.description}
                          </Text>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="align-top text-right">
                      <Badge variant="secondary" className="tabular-nums">
                        {formatPercent(bucket.share * 100)}
                      </Badge>
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="flex flex-wrap gap-1.5">
                        {bucket.memberRunIds.map((runId) => (
                          <Button
                            key={runId}
                            variant="outline"
                            size="sm"
                            className="h-6 px-2 font-mono text-caption"
                            onClick={() => onOpenRun(runId)}
                            title={`Open run ${runId}`}
                          >
                            #{runId.slice(0, 6)}
                          </Button>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Metadata + provenance label ──────────────────────────────────────────────────────────────────

type BadgeVariant =
  | "default"
  | "secondary"
  | "outline"
  | "success"
  | "warning"
  | "destructive"
  | "info";

const BUCKET_LABELS: Record<RootCauseBucket, string> = {
  skill: "Skill",
  mcp_server: "MCP server",
  model_behavior: "Model behavior",
  test_setup: "Test setup",
  provider_infra: "Provider infra",
};

const FIX_TARGET_META: Record<FixTarget, { label: string; variant: BadgeVariant }> = {
  skill: { label: "Fix in skill", variant: "info" },
  mcp_server: { label: "Fix in MCP server", variant: "warning" },
  none: { label: "No fix target", variant: "outline" },
};

/**
 * Which judge source produced the per-test-group agreement calls (AR2/AR3) — CLI, provider, or none.
 *
 * D-MI5 (`roadmap/model-identity/`, WP 2.3): qualified to "Claude CLI **judge**", matching
 * `ReportTab.tsx` and Settings — see the note there. The `claude_subscription` RUN provider is
 * "Anthropic CLI"; this is the judge provider (`CLAUDE_CLI_PROVIDER_ID`), a different thing.
 */
function judgeProvenanceLabel(provenance: SuiteReport["judgeProvenance"]): string {
  const { judgeProviderId, judgeModel } = provenance;
  if (!judgeProviderId) return "Not rated by a judge";
  const model = judgeModel ? ` (${judgeModel})` : "";
  if (judgeProviderId === CLAUDE_CLI_PROVIDER_ID) return `Claude CLI judge${model}`;
  return `Provider judge${model}`;
}

// ── Loading skeleton (layout-shaped, no collapsing spinner — loading-states rule) ────────────────

function SuiteReportSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <output className="sr-only">Loading suite report…</output>
      <div className="flex flex-col gap-4" aria-hidden>
        <Card>
          <CardHeader className="pb-3">
            <Skeleton className="h-5 w-40" />
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              <Skeleton className="h-6 w-28 rounded-full" />
              <Skeleton className="h-6 w-28 rounded-full" />
            </div>
            <Skeleton className="h-4 w-64" />
          </CardContent>
        </Card>
        {[0, 1, 2].map((key) => (
          <Card key={key}>
            <CardHeader className="pb-3">
              <Skeleton className="h-5 w-48" />
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
