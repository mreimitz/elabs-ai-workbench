import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type {
  AnswerValidationEvidence,
  AnswerValidationVerdict,
  ErrorFinding,
  FixTarget,
  GraderId,
  InsightSurplusEvidence,
  InsightSurplusVerdict,
  RatingIssue,
  RatingState,
  RootCauseBucket,
  RunFeedbackSummary,
  RunGrade,
  RunReport as RunRatingReport,
  RunStep,
} from "@mcp-token-footprint/shared";
import { CLAUDE_CLI_PROVIDER_ID } from "@mcp-token-footprint/shared";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  EmptyState,
  Skeleton,
  StatusBadge,
  Text,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
  toast,
} from "@brand/ui";
import {
  AlertTriangle,
  Bug,
  CheckCircle2,
  ChevronDown,
  Clock,
  Gavel,
  Loader2,
  RotateCcw,
  Sparkles,
  Wrench,
} from "lucide-react";
import {
  getRunGrades,
  getRunRatingReport,
  listIssuesForRun,
  listRunFeedback,
  regradeRun,
} from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";
import { formatNumber } from "../../lib/format";
import { FailureEvidence } from "../../components/FailureEvidence";
import { InlineError } from "../../components/InlineError";
import { AssertionResults } from "./AssertionResults";
import { FeedbackChips } from "./FeedbackControl";
import { GradeChip } from "./GradeChip";
import {
  citedStepIdxs,
  GRADE_STATUS_LABELS,
  GRADE_STATUS_TO_BRAND,
  GRADER_LABELS,
  GRADER_SHORT_LABELS,
  isJudgeGrader,
  SCORE_TONE_TEXT_CLASS,
  scoreTone,
} from "./grade-format";
// The donut/radar live in their own module so `@brand/charts` (visx) stays out of jsdom test
// bundles that import this tab (tests stub `./report-charts` — the ContextChart convention).
import { ScoreDonut, ScoreRadar, type RadarAxisScore } from "./report-charts";
import { isReviewInFlight } from "./RunBar";
import { toolCallIdOfStep, type ConsoleNavRef, type ConsolePane } from "./console-anchors";
import { notifyError } from "../../lib/notify";

/**
 * Auto-Rating WP 3.1 (AR1/AR6/AR11) — the run console's canonical rating + grading surface. Self-loads
 * the COMPOSED {@link RunRatingReport} from the NEW `GET /api/runs/:id/report` (via {@link getRunRatingReport};
 * NOT the analytics run-export payload) and renders it: a verdict header, the answer + surplus base-rating
 * cards, the error-forensics list (bucket + fixTarget chips + a labeled draft-fix SUGGESTION + evidence
 * step deep-links), the supplementary "Issues filed by this run" registry section (see
 * {@link RunIssuesSection}), the expectation grades, gate assertions, judge provenance, and a Re-rate
 * action — insights-first: verdict → answer/surplus → judge cards → forensics (+ issues) → grades →
 * assertions. Owner feedback 2026-07-12: every score-bearing card carries a compact `@brand/charts`
 * donut (threshold-toned, {@link scoreTone}), the summary card carries a graded-dimensions radar, and
 * the two LLM judges (outcome/trajectory) get their own {@link JudgeGradeCard} in the body.
 *
 * AR6 is enforced VISUALLY: the base-rating verdicts are their OWN dimension (plain {@link Badge} chips
 * with semantic variants) and are NEVER conflated with the expectation {@link GradeChip}s (design-system
 * `StatusBadge`s) below.
 *
 * Loading-states discipline (`.claude/rules/loading-states.md`):
 *   - POST-TERMINAL ONLY — the tab never fetches/renders a rating mid-stream. While the run is still
 *     live (`terminal === false`) it shows a calm "rating will appear when the run finishes" panel,
 *     NOT a skeleton and NOT an error.
 *   - While the run is terminal but its post-run review hasn't settled (`ratingState`
 *     pending|rating, AR11), the tab shows an ACTIVE "Rating in progress…" presentation (spinner
 *     headline + layout-shaped skeletons) and defers the fetch — it refetches automatically the
 *     moment the rating settles (the `ratingState` prop is reactive via the run's SSE stream).
 *   - `loading` (no content yet) → a layout-shaped {@link Skeleton}, never a spinner that collapses.
 *   - An error slot renders ONLY once the fetch has SETTLED into a failure — a still-live run is never
 *     an error.
 */
export function ReportTab({
  runId,
  steps,
  terminal,
  ratingState,
  onNavigate,
}: {
  runId: string;
  /** The finished run's steps — resolves a cited/evidence step `idx` to a cross-pane nav ref. */
  steps: RunStep[];
  /** True once the run has settled into a terminal status. The report only fetches/renders then (AR11). */
  terminal: boolean;
  /**
   * Auto-Rating (AR11) — the run's live review axis (from the `rating` SSE events).
   * `pending`/`rating` = the review is still in flight (active loading presentation + deferred
   * fetch); a settled state (or `null`/absent — an older payload) fetches immediately.
   */
  ratingState?: RatingState | null;
  /** RunConsole's cross-representation nav — reveals the Chat/Trace step for a cited-step deep link. */
  onNavigate: (pane: ConsolePane, ref: ConsoleNavRef) => void;
}) {
  const [report, setReport] = useState<RunRatingReport | null>(null);
  // The run's latest-per-grader grade rows — SUPPLEMENTARY to the composed report: they carry the
  // judges' own written `reasoning`, which the composed evidence payloads don't. A failed fetch
  // degrades silently (the reasoning collapsibles are simply absent); it never breaks the report.
  const [grades, setGrades] = useState<RunGrade[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [regrading, setRegrading] = useState(false);
  // Monotonic refetch trigger — retry after a settled failure, and refetch after a Re-rate.
  const [nonce, setNonce] = useState(0);

  // AR11 — the review is still in flight: defer the fetch (the report is being written right now)
  // and show the active "Rating in progress…" presentation below. When `ratingState` settles the
  // effect re-runs (it's a dependency) and fetches the finished report — the auto-refetch.
  const reviewing = isReviewInFlight(ratingState);

  useEffect(() => {
    // Post-terminal ONLY — never fetch a rating for a still-live run (loading-states rule). Clear any
    // prior state so a run re-opened live doesn't flash a stale report.
    if (!terminal) {
      setReport(null);
      setGrades(null);
      setError(null);
      setLoading(false);
      return;
    }
    // Review in flight — don't fetch a half-written report. Existing state is deliberately KEPT
    // (a background re-review over an already-loaded report keeps showing it, with the Re-rate
    // button spinning); the transition to a settled state re-runs this effect and refetches.
    if (reviewing) {
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    getRunRatingReport(runId)
      .then((response) => {
        if (active) setReport(response);
      })
      .catch((cause: unknown) => {
        if (active) setError(getErrorMessage(cause, "Couldn’t load the run report."));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    // Judge reasoning rides on the grade rows (`GET /api/runs/:id/grades`) — best-effort only.
    getRunGrades(runId)
      .then((response) => {
        if (active) setGrades(response.latest);
      })
      .catch(() => {
        // Supplementary — the report renders without the reasoning collapsibles.
      });
    return () => {
      active = false;
    };
  }, [runId, terminal, reviewing, nonce]);

  const rerate = useCallback(async () => {
    setRegrading(true);
    try {
      // Re-rate reuses the regrade endpoint — the roster now includes the base graders, so a plain
      // re-grade re-runs them (Auto-Rating README "Defaults"). Refetch the composed report after.
      await regradeRun(runId);
      toast.success("Re-rated");
      setNonce((current) => current + 1);
    } catch (cause) {
      notifyError("Couldn’t re-rate the run.", {
        description: `${getErrorMessage(cause)} Try again.`,
      });
    } finally {
      setRegrading(false);
    }
  }, [runId]);

  // Not terminal yet — a calm informational panel, never an error or a skeleton (loading-states rule).
  if (!terminal) {
    return (
      <ReportPane>
        <EmptyState
          icon={<Clock aria-hidden />}
          title="Rating pending"
          description="The run rating and grading report appears here once the run finishes — every terminal run is rated automatically."
        />
      </ReportPane>
    );
  }

  // AR11 — terminal, review in flight, nothing loaded yet: an ACTIVE loading presentation (the
  // rating is genuinely running right now — not the passive "pending" of a live run). A background
  // re-review over an ALREADY-loaded report falls through and keeps the report on screen instead.
  if (reviewing && !report) {
    return (
      <ReportPane>
        <RatingInProgress />
      </ReportPane>
    );
  }

  if (loading) {
    return (
      <ReportPane>
        <ReportSkeleton />
      </ReportPane>
    );
  }

  if (error) {
    return (
      <ReportPane>
        <InlineError
          title="Couldn’t load the run report"
          detail={error}
          onRetry={() => setNonce((current) => current + 1)}
        />
      </ReportPane>
    );
  }

  if (!report) return null;

  // The two LLM-judge expectation grades (outcome/trajectory) get their own detail cards in the
  // body — the written reasoning was previously findable only in the right-rail Quality grades panel
  // (owner feedback 2026-07-12). Rides on the same supplementary grades fetch as the reasoning.
  const judgeGrades = (grades ?? []).filter((grade) => isJudgeGrader(grade.graderId));

  return (
    <ReportPane>
      <div className="flex flex-col gap-4">
        <RatingSummaryCard
          report={report}
          grades={grades}
          // A BACKGROUND review (ratingState === "rating") disables Re-rate too — the judges are
          // already running; a second kick would race the one in flight.
          regrading={regrading || ratingState === "rating"}
          onRerate={() => void rerate()}
        />
        <AnswerCard
          evidence={report.baseRating.answerValidation}
          judgeReasoning={latestReasoning(grades, "answer_validation")}
          steps={steps}
          onNavigate={onNavigate}
        />
        <SurplusCard
          evidence={report.baseRating.insightSurplus}
          judgeReasoning={latestReasoning(grades, "insight_surplus")}
          steps={steps}
          onNavigate={onNavigate}
        />
        {/* Insights-first: the judge detail cards follow the answer/surplus story they conclude,
            ahead of the error forensics. Only rendered when the run actually has such a grade row. */}
        {judgeGrades.map((grade) => (
          <JudgeGradeCard key={grade.id} grade={grade} steps={steps} onNavigate={onNavigate} />
        ))}
        <ForensicsCard
          findings={report.baseRating.errorForensics}
          steps={steps}
          onNavigate={onNavigate}
        />
        <RunIssuesSection runId={report.runId} />
        <ExpectationGradesCard grades={report.expectationGrades} />
        {report.assertionResults.length > 0 ? (
          <AssertionResults results={report.assertionResults} runId={report.runId} />
        ) : null}
      </div>
    </ReportPane>
  );
}

/**
 * The report body's shared frame (owner feedback 2026-07-12): the tab's default-scroll body renders
 * this pane, which gives the card stack the same horizontal breathing room the Chat/Trace panes give
 * themselves (they pad their own content; the report was flush against the pane edges) plus a
 * comfortable reading width for the narrative-heavy cards. Layout-only.
 */
function ReportPane({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-4xl px-4 pb-6">{children}</div>;
}

/** The newest `reasoning` text the given grader wrote for this run, or `null` (row absent/blank). */
function latestReasoning(grades: RunGrade[] | null, graderId: GraderId): string | null {
  const reasoning = grades?.find((grade) => grade.graderId === graderId)?.reasoning?.trim();
  return reasoning ? reasoning : null;
}

// ── Verdict header + provenance + Re-rate ──────────────────────────────────────────────────────

/**
 * The run's GRADED dimensions (status `graded`, non-null score) as radar axes — base-rating scores
 * (answer validation / insight surplus) and expectation scores (ROUGE-1, outcome/trajectory judge,
 * tool hygiene, SkillFlow, value match) alike, deduped per grader. Error forensics carries a COUNT,
 * not a 0–1 score, so it is never an axis. Fewer than 3 axes can't draw a polygon — the summary card
 * then falls back to the chip row alone.
 */
function radarAxesFrom(grades: RunGrade[] | null): RadarAxisScore[] {
  if (!grades) return [];
  const seen = new Set<GraderId>();
  const axes: RadarAxisScore[] = [];
  for (const grade of grades) {
    if (grade.status !== "graded" || grade.score == null) continue;
    if (grade.graderId === "error_forensics" || seen.has(grade.graderId)) continue;
    seen.add(grade.graderId);
    axes.push({
      key: grade.graderId,
      label: GRADER_SHORT_LABELS[grade.graderId],
      score: grade.score,
    });
  }
  return axes;
}

function RatingSummaryCard({
  report,
  grades,
  regrading,
  onRerate,
}: {
  report: RunRatingReport;
  /** The run's latest-per-grader grade rows — the radar's data source (`null` = fetch not landed). */
  grades: RunGrade[] | null;
  regrading: boolean;
  onRerate: () => void;
}) {
  const answer = ANSWER_VERDICT_META[report.baseRating.answerValidation.verdict];
  const surplus = SURPLUS_VERDICT_META[report.baseRating.insightSurplus.verdict];
  const findingCount = report.baseRating.errorForensics.length;
  const axes = radarAxesFrom(grades);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <Sparkles aria-hidden className="size-4" />
            Run rating
          </span>
          <Button variant="outline" size="sm" onClick={onRerate} disabled={regrading}>
            <RotateCcw aria-hidden />
            <span>{regrading ? "Re-rating…" : "Re-rate"}</span>
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 lg:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {/* AR6 — base-rating verdicts are their OWN dimension: plain semantic-variant Badges, kept
              visually separate from the expectation GradeChips (StatusBadges) further down. */}
          <div className="flex flex-wrap items-center gap-2">
            <VerdictChip label="Answer" value={answer.label} variant={answer.variant} />
            <VerdictChip label="Surplus" value={surplus.label} variant={surplus.variant} />
            <Badge variant={findingCount > 0 ? "destructive" : "success"} className="tabular-nums">
              {findingCount === 0
                ? "No error findings"
                : `${formatNumber(findingCount)} error finding${findingCount === 1 ? "" : "s"}`}
            </Badge>
          </div>
          <Text variant="meta" tone="muted">
            Base rating — a separate dimension from the expectation grades below (it never changes
            their meaning).
          </Text>
          <div className="flex flex-wrap items-center gap-1.5">
            <Text variant="meta" tone="muted">
              Rated by:
            </Text>
            <Text variant="meta" className="font-medium">
              {judgeProvenanceLabel(report.judgeProvenance)}
            </Text>
          </div>
          {/* Observability WP 2.5 (D-OB15) — "Your feedback": RENDER-ONLY (reads the feedback API;
              writing happens in the RunBar header / per-turn hover controls, not here). A SEPARATE
              line from "Rated by" on purpose — human feedback is never part of the rating above it. */}
          <YourFeedbackLine runId={report.runId} />
        </div>
        {/* The graded-dimensions radar, right of the verdict text (≥3 axes only — fewer can't draw a
            polygon, and the chip row above already tells the story). Series color follows the
            scoreTone threshold of the MEAN score, via chart tokens — both themes read correctly. */}
        {axes.length >= 3 ? <ScoreRadar axes={axes} /> : null}
      </CardContent>
    </Card>
  );
}

/** One labeled base-rating verdict chip — the label names the dimension, the Badge carries the verdict. */
function VerdictChip({
  label,
  value,
  variant,
}: { label: string; value: string; variant: BadgeVariant }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Text variant="meta" tone="muted">
        {label}
      </Text>
      <Badge variant={variant}>{value}</Badge>
    </span>
  );
}

// ── Answer + Surplus base-rating cards ─────────────────────────────────────────────────────────

function AnswerCard({
  evidence,
  judgeReasoning,
  steps,
  onNavigate,
}: {
  evidence: AnswerValidationEvidence;
  /** The `answer_validation` grade row's own written reasoning (supplementary; `null` = absent). */
  judgeReasoning: string | null;
  steps: RunStep[];
  onNavigate: (pane: ConsolePane, ref: ConsoleNavRef) => void;
}) {
  const meta = ANSWER_VERDICT_META[evidence.verdict];
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-subtitle">
          <span className="flex items-center gap-2">
            <CheckCircle2 aria-hidden className="size-4" />
            Answer validation
          </span>
          <span className="flex items-center gap-2">
            <Badge variant={meta.variant}>{meta.label}</Badge>
            <ScoreReadout score={evidence.score} />
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 sm:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <Text variant="meta" tone="muted">
            Score 0–1 from the rating judge — 1.0 means the final answer fully addresses the test’s
            initial prompt; the verdict (answered / partial / unanswered) is the judge’s read, and
            the quotes below are its cited evidence.
          </Text>
          <Quotes quotes={evidence.quotes} />
          {/* The cited steps live in the conversation — reveal them in Chat. */}
          <StepLinks
            idxs={evidence.citedSteps}
            steps={steps}
            pane="chat"
            onNavigate={onNavigate}
            label="Cited steps:"
          />
          <JudgeReasoning reasoning={judgeReasoning} />
        </div>
        {evidence.score != null ? <ScoreDonut score={evidence.score} label="Answer" /> : null}
      </CardContent>
    </Card>
  );
}

function SurplusCard({
  evidence,
  judgeReasoning,
  steps,
  onNavigate,
}: {
  evidence: InsightSurplusEvidence;
  /** The `insight_surplus` grade row's own written reasoning (supplementary; `null` = absent). */
  judgeReasoning: string | null;
  steps: RunStep[];
  onNavigate: (pane: ConsolePane, ref: ConsoleNavRef) => void;
}) {
  const meta = SURPLUS_VERDICT_META[evidence.verdict];
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-subtitle">
          <span className="flex items-center gap-2">
            <Sparkles aria-hidden className="size-4" />
            Insight surplus
          </span>
          <span className="flex items-center gap-2">
            <Badge variant={meta.variant}>{meta.label}</Badge>
            <ScoreReadout score={evidence.score} />
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 sm:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <Text variant="meta" tone="muted">
            Grades content beyond what was asked: valuable grounded surplus raises the score,
            unrequested padding lowers it (and its token cost is counted); “on-ask” means the answer
            stuck to the question.
          </Text>
          {evidence.verdict === "noise" && evidence.surplusTokens != null ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <Text variant="meta" tone="muted">
                Surplus token cost:
              </Text>
              <Text variant="meta" className="font-medium tabular-nums">
                {formatNumber(evidence.surplusTokens)} tokens
              </Text>
            </div>
          ) : null}
          <Quotes quotes={evidence.quotes} />
          <StepLinks
            idxs={evidence.citedSteps}
            steps={steps}
            pane="chat"
            onNavigate={onNavigate}
            label="Cited steps:"
          />
          <JudgeReasoning reasoning={judgeReasoning} />
        </div>
        {evidence.score != null ? <ScoreDonut score={evidence.score} label="Surplus" /> : null}
      </CardContent>
    </Card>
  );
}

/**
 * A base-rating judge's own written reasoning, closed by default (mirrors GradePanel's `JudgeDetail`
 * collapsible). Renders nothing when the grade row carried no reasoning (or the grades fetch failed).
 */
function JudgeReasoning({ reasoning }: { reasoning: string | null }) {
  const [open, setOpen] = useState(false);
  if (!reasoning) return null;
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-md border border-border bg-muted/20"
    >
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="flex h-auto w-full items-center justify-between gap-2 px-3 py-2"
        >
          <span className="font-medium">Judge reasoning</span>
          <ChevronDown
            aria-hidden
            className={cn("size-4 shrink-0 transition-transform", open && "rotate-180")}
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-3">
        <Text variant="meta" tone="muted" className="whitespace-pre-wrap break-words">
          {reasoning}
        </Text>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * A grader's 0–1 score (tabular-nums), or a muted "n/a" when unevaluable — NEVER a forced 0. The
 * figure is colored by the {@link scoreTone} thresholds (<0.6 red · 0.6–<0.8 amber · ≥0.8 green) so
 * a mediocre score never reads green just because it was successfully graded.
 */
function ScoreReadout({ score }: { score: number | null }) {
  if (score == null) {
    return (
      <Text variant="meta" tone="muted">
        n/a
      </Text>
    );
  }
  return (
    <Text className={cn("font-medium tabular-nums", SCORE_TONE_TEXT_CLASS[scoreTone(score)])}>
      {score.toFixed(2)}
    </Text>
  );
}

/** Verbatim evidence excerpts (curly-quoted). Renders nothing when there are none. */
function Quotes({ quotes }: { quotes: string[] }) {
  if (quotes.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1.5">
      {quotes.map((quote, index) => (
        <li key={index} className="border-l-2 border-border pl-3">
          <Text variant="meta" tone="muted" className="break-words">
            “{quote}”
          </Text>
        </li>
      ))}
    </ul>
  );
}

// ── LLM-judge expectation-grade detail cards (outcome/trajectory judge) ─────────────────────────

/**
 * One LLM-judge expectation grade as a first-class report card (owner feedback 2026-07-12 — the
 * outcome judge scored the run with written reasoning, but the report body had no card for it; the
 * reasoning was only findable in the right-rail Quality grades panel). Renders the score (threshold-
 * toned readout + donut), the honest grade STATUS chip, what the grader measures (the same
 * plain-language method the chip tooltips use), the judge's own written reasoning verbatim, and its
 * cited steps as Chat deep-links. Rendered for `outcome_judge` AND `trajectory_judge` (the
 * {@link isJudgeGrader} family) whenever the run carries such a grade row.
 */
function JudgeGradeCard({
  grade,
  steps,
  onNavigate,
}: {
  grade: RunGrade;
  steps: RunStep[];
  onNavigate: (pane: ConsolePane, ref: ConsoleNavRef) => void;
}) {
  const graded = grade.status === "graded" && grade.score != null;
  const reasoning = grade.reasoning?.trim() || null;
  const idxs = citedStepIdxs(grade.evidence);
  const method = GRADER_METHOD_HELP[grade.graderId] ?? grade.method;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-subtitle">
          <span className="flex items-center gap-2">
            <Gavel aria-hidden className="size-4" />
            {GRADER_LABELS[grade.graderId]}
          </span>
          <span className="flex items-center gap-2">
            {/* The STATUS chip stays status-colored ("Graded" is a fact, not a quality signal) —
                the SCORE readout + donut carry the threshold tone. */}
            <StatusBadge status={GRADE_STATUS_TO_BRAND[grade.status]} size="sm">
              {GRADE_STATUS_LABELS[grade.status]}
            </StatusBadge>
            <ScoreReadout score={graded ? grade.score : null} />
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 sm:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <Text variant="meta" tone="muted">
            {method}
          </Text>
          {reasoning ? (
            <Text variant="meta" className="whitespace-pre-wrap break-words">
              {reasoning}
            </Text>
          ) : null}
          <StepLinks
            idxs={idxs}
            steps={steps}
            pane="chat"
            onNavigate={onNavigate}
            label="Cited steps:"
          />
        </div>
        {graded ? (
          <ScoreDonut score={grade.score as number} label={GRADER_SHORT_LABELS[grade.graderId]} />
        ) : null}
      </CardContent>
    </Card>
  );
}

// ── Error forensics ────────────────────────────────────────────────────────────────────────────

function ForensicsCard({
  findings,
  steps,
  onNavigate,
}: {
  findings: ErrorFinding[];
  steps: RunStep[];
  onNavigate: (pane: ConsolePane, ref: ConsoleNavRef) => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-subtitle">
          <span className="flex items-center gap-2">
            <AlertTriangle aria-hidden className="size-4" />
            Error forensics
          </span>
          <Badge
            variant={findings.length > 0 ? "destructive" : "secondary"}
            className="tabular-nums font-normal"
          >
            {formatNumber(findings.length)}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Text variant="meta" tone="muted">
          A deterministic inventory of everything that went wrong in the run (errors, failed tool
          calls, guardrail stops, context overflow, failed assertions); the judge then classifies
          each finding’s root cause and drafts a fix.
        </Text>
        {findings.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 aria-hidden />}
            title="No errors detected"
            description="The deterministic inventory found nothing that went wrong in this run."
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {findings.map((finding) => (
              <FindingRow
                key={finding.id}
                finding={finding}
                steps={steps}
                onNavigate={onNavigate}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function FindingRow({
  finding,
  steps,
  onNavigate,
}: {
  finding: ErrorFinding;
  steps: RunStep[];
  onNavigate: (pane: ConsolePane, ref: ConsoleNavRef) => void;
}) {
  const fix = FIX_TARGET_META[finding.fixTarget];
  return (
    <li className="flex flex-col gap-2 rounded-md border border-border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline">{BUCKET_LABELS[finding.bucket]}</Badge>
        <Badge variant={fix.variant}>{fix.label}</Badge>
        {finding.truncated ? (
          <Badge
            variant="secondary"
            title="Transcript truncated before classification — bucket may be less certain"
          >
            truncated
          </Badge>
        ) : null}
      </div>
      <Text className="break-words font-medium">{finding.description}</Text>
      {/* The concrete wrong call + exact error — so the finding shows what actually failed. */}
      <FailureEvidence
        toolName={finding.toolName}
        sentArguments={finding.sentArguments}
        errorMessage={finding.errorMessage}
      />
      {/* The draft fix is a SUGGESTION — the app never auto-applies it (labeled as such). */}
      <div className="rounded-md border border-border bg-card p-2.5">
        <div className="flex items-center gap-1.5">
          <Wrench aria-hidden className="size-3.5 text-muted-foreground" />
          <Text variant="meta" tone="muted" className="font-medium uppercase tracking-wide">
            Suggested fix
          </Text>
        </div>
        <Text className="mt-1 break-words">{finding.draftFix}</Text>
      </div>
      {/* Errors are best read in the Trace — reveal the evidence step there. */}
      <StepLinks
        idxs={finding.evidenceSteps}
        steps={steps}
        pane="trace"
        onNavigate={onNavigate}
        label="Evidence:"
      />
    </li>
  );
}

// ── Issues filed by this run (auto-learning loop — supplementary, never breaks the report) ──────

/**
 * The deduplicated registry issues this run contributed an occurrence to
 * (`GET /api/issues?runId=…` via {@link listIssuesForRun}), placed between the raw forensics and
 * the expectation grades (insights-first: the durable fix targets follow the findings that filed
 * them). STRICTLY supplementary — it must never break the report tab: loading renders one small
 * skeleton row, an EMPTY result renders NOTHING (no empty-state noise inside the report), and a
 * settled fetch failure silently omits the section.
 */
function RunIssuesSection({ runId }: { runId: string }) {
  const [issues, setIssues] = useState<RatingIssue[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setIssues(null);
    setFailed(false);
    listIssuesForRun(runId)
      .then((result) => {
        if (active) setIssues(result);
      })
      .catch(() => {
        // Silently omit — the section is supplementary and never surfaces its own error.
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [runId]);

  if (failed) return null;
  // No content yet — one small layout-shaped skeleton row (loading-states rule), no card chrome
  // so an empty/failed result collapsing to nothing causes no jarring frame.
  if (issues === null) return <Skeleton className="h-9 w-full" aria-hidden />;
  if (issues.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-subtitle">
          <span className="flex items-center gap-2">
            <Bug aria-hidden className="size-4" />
            Issues filed by this run
          </span>
          <Badge variant="secondary" className="tabular-nums font-normal">
            {formatNumber(issues.length)}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-2">
          {issues.map((issue) => (
            <RunIssueRow key={issue.id} issue={issue} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/**
 * One compact issue row: lifecycle + severity chips, the title as a deep link to the target's
 * detail view (its Issues tab lives there — skill → `/skills/:skillId`, server →
 * `/servers/:serverId`, see App.tsx routes), the target label, and the dedup count.
 */
function RunIssueRow({ issue }: { issue: RatingIssue }) {
  const status = ISSUE_STATUS_META[issue.status];
  const severity = ISSUE_SEVERITY_META[issue.severity];
  const targetHref =
    issue.targetKind === "skill"
      ? `/skills/${encodeURIComponent(issue.targetId)}`
      : `/servers/${encodeURIComponent(issue.targetId)}`;
  const targetLabel = `${issue.targetKind === "skill" ? "skill" : "MCP server"} · ${issue.targetName}`;
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-border bg-muted/20 px-3 py-2">
      <Badge variant={status.variant}>{status.label}</Badge>
      <Badge variant={severity.variant}>{severity.label}</Badge>
      <Button asChild variant="link" size="sm" className="h-auto min-w-0 p-0">
        <Link to={targetHref} title={`Open ${targetLabel} — Issues tab`}>
          <span className="truncate font-medium">{issue.title}</span>
        </Link>
      </Button>
      <Text variant="meta" tone="muted" className="min-w-0 truncate">
        {targetLabel}
      </Text>
      <Text variant="meta" tone="muted" className="ml-auto shrink-0 tabular-nums">
        seen {formatNumber(issue.timesSeen)}×
      </Text>
    </li>
  );
}

/** Issue lifecycle/severity chips — mirrors the Issues tab's vocabulary (module-private there). */
const ISSUE_STATUS_META: Record<RatingIssue["status"], { label: string; variant: BadgeVariant }> = {
  open: { label: "Open", variant: "warning" },
  resolved: { label: "Resolved", variant: "success" },
};

const ISSUE_SEVERITY_META: Record<
  RatingIssue["severity"],
  { label: string; variant: BadgeVariant }
> = {
  high: { label: "High", variant: "destructive" },
  medium: { label: "Medium", variant: "warning" },
  low: { label: "Low", variant: "secondary" },
};

// ── Expectation grades (the EXISTING dimension — reuse GradeChip, AR6) ──────────────────────────

/**
 * Plain-language method + computation for each EXPECTATION grader's chip tooltip (owner feedback
 * 2026-07-12 — every percentage must say what it means and how it was computed). Copy is verified
 * against the actual grader implementations in `apps/api/src/grading/*` — keep them in sync.
 */
const GRADER_METHOD_HELP: Partial<Record<GraderId, string>> = {
  rouge1:
    "ROUGE-1 — word-overlap (unigram F1) between the final answer and the test’s expected insight/value, shown as 0–100%. Deterministic string math, no judge call.",
  outcome_judge:
    "G-Eval outcome judge — an LLM judge rates the answer against the test’s expected ground truth on a 1–10 rubric, normalized to a percentage (logprob-weighted expected rating when the provider returns logprobs).",
  value_match:
    "Value match — parses the last JSON block in the answer and deep-compares it to the test’s expected value (numbers within a small relative tolerance; an expected object gets per-key partial credit). Deterministic, no judge call.",
  tool_hygiene:
    "Tool hygiene — deterministic check of the run’s tool calls against the server’s scanned input schemas: starts at 100% and each finding (missing/invalid arguments, tool not in the scan, failed or redundant calls) subtracts a documented weight.",
  trajectory_judge:
    "Trajectory judge — an LLM judge compares the run’s actual tool-call sequence against the test’s authored reference logic (0–10 rubric, normalized to a percentage).",
  skillflow_conformance:
    "SkillFlow conformance — how faithfully the run followed the attached skill’s designed flow: a weighted pass rate over the persisted gate/route/fracture verdicts. Deterministic, no judge call.",
};

function ExpectationGradesCard({ grades }: { grades: RunGrade[] }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-subtitle">Expectation grades</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Text variant="meta" tone="muted">
          Scored against the test’s declared expectations — hover a chip for what the grader
          measures and how its score was computed.
        </Text>
        {grades.length === 0 ? (
          <EmptyState
            icon={<Sparkles aria-hidden />}
            title="No expectation grades"
            description="This run’s test declared no expectations to grade against."
          />
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {grades.map((grade) => (
              <ExpectationGradeChip key={grade.id} grade={grade} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * One expectation grade chip with an explanatory tooltip: the grader's plain-language method +
 * computation, plus — for an n/a or errored chip — the grade row's own `reasoning` (the honest WHY it
 * couldn't be evaluated), so no percentage or "n/a" is ever left unexplained.
 */
function ExpectationGradeChip({ grade }: { grade: RunGrade }) {
  const method = GRADER_METHOD_HELP[grade.graderId] ?? grade.method;
  const why = grade.status !== "graded" ? grade.reasoning?.trim() : null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex cursor-help">
          <GradeChip latest={[grade]} />
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-sm">
        <div className="flex flex-col gap-1">
          <span>{method}</span>
          {why ? (
            <span>
              {grade.status === "unevaluable" ? "Not evaluable: " : "Grader error: "}
              {why}
            </span>
          ) : null}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

// ── Shared: cited-step deep links ──────────────────────────────────────────────────────────────

/**
 * A row of cited/evidence step deep-links. Each resolves its `run_steps.idx` to a cross-pane nav ref
 * (a turn, or a tool call within a turn) and reuses RunConsole's `onNavigate` to reveal it in the
 * Chat/Trace pane — the same anchor mechanic the turn rail + Analytics error cards use. A step with no
 * resolvable ref (e.g. a run-level signal with no turn) renders as a disabled, explained number.
 */
function StepLinks({
  idxs,
  steps,
  pane,
  onNavigate,
  label,
}: {
  idxs: number[];
  steps: RunStep[];
  pane: ConsolePane;
  onNavigate: (pane: ConsolePane, ref: ConsoleNavRef) => void;
  label: string;
}) {
  const unique = useMemo(() => [...new Set(idxs)].sort((a, b) => a - b), [idxs]);
  if (unique.length === 0) return null;
  const paneLabel = pane === "trace" ? "Trace" : "Chat";
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <Text variant="meta" tone="muted">
        {label}
      </Text>
      {unique.map((idx) => {
        const ref = navRefForStepIdx(steps, idx);
        return (
          <Button
            key={idx}
            variant="link"
            size="sm"
            className="h-auto p-0"
            disabled={!ref}
            onClick={() => ref && onNavigate(pane, ref)}
            title={
              ref
                ? `Reveal step #${idx + 1} in the ${paneLabel}`
                : `Step #${idx + 1} is not in this run`
            }
          >
            <span className="tabular-nums">#{idx + 1}</span>
          </Button>
        );
      })}
    </div>
  );
}

/**
 * Resolve a cited `run_steps.idx` to a {@link ConsoleNavRef}: a tool step targets its tool call (with a
 * turn fallback for the chat pane), any other turn-bearing step targets its assistant turn. `null` when
 * the step isn't in the run or carries no turn/tool anchor (then the link renders disabled).
 */
function navRefForStepIdx(steps: RunStep[], idx: number): ConsoleNavRef | null {
  const step = steps.find((candidate) => candidate.index === idx);
  if (!step) return null;
  const toolCallId = toolCallIdOfStep(step);
  if (toolCallId) {
    return {
      kind: "tool",
      toolCallId,
      ...(step.turnIndex != null ? { turnIndex: step.turnIndex } : {}),
    };
  }
  if (step.turnIndex != null) return { kind: "turn", turnIndex: step.turnIndex };
  return null;
}

// ── Verdict/chip metadata + provenance label ───────────────────────────────────────────────────

type BadgeVariant =
  | "default"
  | "secondary"
  | "outline"
  | "success"
  | "warning"
  | "destructive"
  | "info";

const ANSWER_VERDICT_META: Record<
  AnswerValidationVerdict,
  { label: string; variant: BadgeVariant }
> = {
  answered: { label: "Answered", variant: "success" },
  partial: { label: "Partial", variant: "warning" },
  unanswered: { label: "Unanswered", variant: "destructive" },
};

const SURPLUS_VERDICT_META: Record<
  InsightSurplusVerdict,
  { label: string; variant: BadgeVariant }
> = {
  none: { label: "On-ask", variant: "secondary" },
  valuable: { label: "Valuable", variant: "success" },
  noise: { label: "Noise", variant: "destructive" },
};

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
 * Which judge source produced the LLM base-rating facets (AR2/AR3) — CLI, a provider judge, or none.
 *
 * D-MI5 (`roadmap/model-identity/`, WP 2.3): qualified to "Claude CLI **judge**". The
 * `claude_subscription` RUN provider now displays as "Anthropic CLI" (`PROVIDER_KIND_META`); this is
 * the Auto-Rating judge provider (`CLAUDE_CLI_PROVIDER_ID`), a different thing that happens to run on
 * the same subscription. The word "judge" is what stops a reader merging the two.
 */
function judgeProvenanceLabel(provenance: RunRatingReport["judgeProvenance"]): string {
  const { judgeProviderId, judgeModel } = provenance;
  if (!judgeProviderId) return "Not rated by a judge";
  const model = judgeModel ? ` (${judgeModel})` : "";
  if (judgeProviderId === CLAUDE_CLI_PROVIDER_ID) return `Claude CLI judge${model}`;
  return `Provider judge${model}`;
}

/**
 * Observability WP 2.5 (D-OB15) — "Your feedback": a small RENDER-ONLY line reading the RUN-level
 * human feedback (`GET /api/runs/:id/feedback`, filtered to `stepId === undefined`, latest write per
 * key). Best-effort/supplementary (mirrors the judge-reasoning fetch above it) — a failed fetch just
 * renders nothing rather than an error, and a run with no feedback yet renders nothing at all (never
 * a fake "Not rated" line — that phrasing belongs to the base-rating verdicts, a DIFFERENT dimension).
 * The exported-report JSON/Markdown carrying this same line is explicitly DEFERRED (WP 2.5 scope note)
 * — this is web-only rendering of the already-persisted feedback, not a new API/report field.
 */
function YourFeedbackLine({ runId }: { runId: string }) {
  const [state, setState] = useState<{ entries: RunFeedbackSummary[]; comment: string | null } | null>(
    null,
  );

  useEffect(() => {
    let alive = true;
    listRunFeedback(runId)
      .then((rows) => {
        if (!alive) return;
        const runLevel = rows.filter((row) => row.stepId === undefined);
        // Rows come back oldest-first — last-write-wins per key, mirroring the API's own aggregate.
        const latestByKey = new Map<string, RunFeedbackSummary>();
        let comment: string | null = null;
        for (const row of runLevel) {
          latestByKey.set(row.key, { key: row.key, score: row.score ?? null });
          if (row.key === "verdict") comment = row.comment ?? null;
        }
        setState({ entries: [...latestByKey.values()], comment });
      })
      .catch(() => {
        /* supplementary — the line simply stays absent, like the judge-reasoning fetch above it */
      });
    return () => {
      alive = false;
    };
  }, [runId]);

  if (!state || state.entries.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Text variant="meta" tone="muted">
        Your feedback:
      </Text>
      <FeedbackChips feedback={state.entries} />
      {state.comment ? (
        <Text variant="meta" className="italic">
          “{state.comment}”
        </Text>
      ) : null}
    </div>
  );
}

// ── Loading skeleton (layout-shaped, no collapsing spinner — loading-states rule) ──────────────

/**
 * AR11 — the ACTIVE review-in-flight presentation: the run is terminal and the judges are rating it
 * RIGHT NOW (distinct from the passive "Rating pending" of a still-live run). A spinner headline
 * announces the activity; the layout-shaped skeletons below reserve the report's frame so the
 * settled report lands without a jump. Disappears (→ the fetched report) the moment `ratingState`
 * settles.
 */
function RatingInProgress() {
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
        The run finished — the judges are reviewing it now. The report appears here the moment the
        rating settles.
      </Text>
      <div aria-hidden>
        <ReportSkeleton />
      </div>
    </div>
  );
}

function ReportSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      {/* A live status announces "loading" to assistive tech; the shaped skeletons below are decorative.
          `<output>` (implicit role="status") is the semantic live region — no raw color/typography here. */}
      <output className="sr-only">Loading run report…</output>
      <div className="flex flex-col gap-4" aria-hidden>
        <Card>
          <CardHeader className="pb-3">
            <Skeleton className="h-5 w-32" />
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              <Skeleton className="h-6 w-28 rounded-full" />
              <Skeleton className="h-6 w-28 rounded-full" />
              <Skeleton className="h-6 w-24 rounded-full" />
            </div>
            <Skeleton className="h-4 w-64" />
          </CardContent>
        </Card>
        {[0, 1, 2].map((key) => (
          <Card key={key}>
            <CardHeader className="pb-3">
              <Skeleton className="h-5 w-40" />
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
