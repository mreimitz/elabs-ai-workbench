import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { GradeFeedback, RunGrade, RunStep } from "@mcp-token-footprint/shared";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  EmptyState,
  MetricCard,
  Skeleton,
  StatusBadge,
  Text,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
  toast,
} from "@elabs-ai/components-ui";
import { ChevronDown, ExternalLink, FileText, RotateCcw, Sparkles } from "lucide-react";
import { getRunGrades, listRunGradeFeedback, regradeRun } from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";
import { InlineError } from "../../components/InlineError";
import { BaseVerdictChip } from "./BaseVerdictChip";
import { GradeChip } from "./GradeChip";
import { GradeFeedbackControl, latestFeedbackByGrade } from "./GradeFeedbackControl";
import {
  citedStepIdxs,
  filterExpectationGrades,
  formatGradePercent,
  formatRawScore,
  GRADE_STATUS_LABELS,
  GRADE_STATUS_TO_BRAND,
  GRADER_LABELS,
  isJudgeGrader,
  SCORE_TONE_TEXT_CLASS,
  scoreTone,
} from "./grade-format";
import { notifyError } from "../../lib/notify";

/**
 * Auto-Rating WP 3.2 — a COMPACT summary on the run console's right rail: the run's latest-per-grader
 * grades reduced to a glance-able headline (one {@link GradeChip} per expectation grader, ALONGSIDE the
 * SEPARATE base-rating {@link BaseVerdictChip}, AR6 — never merged into one chip), plus an "Open full
 * report" action that reveals the left-pane **Report** tab (WP 3.1), now the canonical rating+grading
 * surface. Nothing is deleted: the full per-grader detail this panel used to show inline (WP 1.4 — a
 * {@link MetricCard} per grader, judge `reasoning` + cited-step evidence links) still lives here, in a
 * "Grader detail" {@link Collapsible} that starts CLOSED — the Report tab doesn't carry judge reasoning/
 * evidence-links today, so that detail stays reachable from this panel rather than disappearing.
 * "Re-grade" re-runs the graders (`POST /api/runs/:id/grade`) and refetches. An honest {@link EmptyState}
 * when a run has no grades at all (its test declared no expectations AND base rating hasn't run yet).
 * Grading stays in the API.
 */
export function GradePanel({
  runId,
  steps,
  onSelectStep,
  onOpenReport,
}: {
  runId: string;
  steps: RunStep[];
  onSelectStep: (stepId: string | null) => void;
  /** Reveals the run console's left-pane Report tab (WP 3.1) — the canonical rating+grading surface. */
  onOpenReport: () => void;
}) {
  const [latest, setLatest] = useState<RunGrade[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [regrading, setRegrading] = useState(false);
  // A monotonically-increasing refetch trigger: retry after a failed load, and after a re-grade.
  const [nonce, setNonce] = useState(0);
  // WP 6.1 — the human's call on each grade, fetched ONCE for the whole run (never per card) and
  // reduced to the newest verdict per grade. Best-effort: a failed feedback fetch leaves the panel's
  // grades fully usable with unset controls, because a missing verdict IS the honest empty state.
  const [feedback, setFeedback] = useState<Map<string, GradeFeedback>>(new Map());

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    getRunGrades(runId)
      .then((response) => {
        if (active) setLatest(response.latest);
      })
      .catch((cause: unknown) => {
        if (active) setError(getErrorMessage(cause, "Couldn’t load grades."));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [runId, nonce]);

  useEffect(() => {
    let active = true;
    listRunGradeFeedback(runId)
      .then((rows) => {
        if (active) setFeedback(latestFeedbackByGrade(rows));
      })
      .catch(() => {
        // Never blocks the grades themselves — see the state comment above.
      });
    return () => {
      active = false;
    };
  }, [runId, nonce]);

  const regrade = useCallback(async () => {
    setRegrading(true);
    try {
      await regradeRun(runId);
      toast.success("Re-graded");
      setNonce((current) => current + 1);
    } catch (cause) {
      notifyError("Couldn’t re-grade the run.", {
        description: `${getErrorMessage(cause)} Try again.`,
      });
    } finally {
      setRegrading(false);
    }
  }, [runId]);

  const judgeGrades = latest?.filter((grade) => isJudgeGrader(grade.graderId)) ?? [];
  const expectationGrades = latest ? filterExpectationGrades(latest) : [];
  // The "Grader detail" section (the full WP 1.4 MetricCard grid + judge reasoning) starts CLOSED —
  // it's the compact-by-default surface; "Open full report" is the primary way to the canonical view.
  const [detailOpen, setDetailOpen] = useState(false);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <Sparkles aria-hidden className="size-4" />
            Quality grades
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void regrade()}
            disabled={regrading || loading}
          >
            <RotateCcw aria-hidden />
            <span>{regrading ? "Re-grading…" : "Re-grade"}</span>
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <GradesSkeleton />
        ) : error ? (
          <InlineError
            title="Couldn’t load grades"
            detail={error}
            onRetry={() => setNonce((current) => current + 1)}
          />
        ) : !latest || latest.length === 0 ? (
          <EmptyState
            icon={<Sparkles aria-hidden />}
            title="No grades yet"
            description="This run has no grades — its test declared no expectations, and it hasn’t been rated. Configure the LLM judge, then re-grade."
            actions={<JudgeSetupLink />}
          />
        ) : (
          <div className="flex flex-col gap-3">
            {/* WP 3.2 — the compact headline: expectation grades as chips, ALONGSIDE (never merged
                with) the SEPARATE base-rating verdict chip (AR6). Each row is labeled so the two
                dimensions read distinctly even before noticing the different chip styles. */}
            <div className="flex flex-wrap items-center gap-1.5">
              <Text variant="meta" tone="muted">
                Expectation:
              </Text>
              {expectationGrades.length > 0 ? (
                expectationGrades.map((grade) => <GradeChip key={grade.id} latest={[grade]} />)
              ) : (
                <Text variant="meta" tone="muted">
                  none
                </Text>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Text variant="meta" tone="muted">
                Base rating:
              </Text>
              <BaseVerdictChip latest={latest} />
            </div>
            <Button variant="outline" size="sm" onClick={onOpenReport} className="mt-1 self-start">
              <FileText aria-hidden />
              <span>Open full report</span>
            </Button>
            <Collapsible open={detailOpen} onOpenChange={setDetailOpen}>
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-1 h-auto w-full justify-between px-0 text-muted-foreground hover:text-foreground"
                >
                  <span>Grader detail</span>
                  <ChevronDown
                    aria-hidden
                    className={cn(
                      "size-4 shrink-0 transition-transform",
                      detailOpen && "rotate-180",
                    )}
                  />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="flex flex-col gap-4 pt-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {latest.map((grade) => (
                    <GradeMetric
                      key={grade.id}
                      grade={grade}
                      feedback={feedback.get(grade.id)}
                      onFeedback={(row) =>
                        setFeedback((current) => new Map(current).set(row.gradeId, row))
                      }
                    />
                  ))}
                </div>
                {judgeGrades.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    {judgeGrades.map((grade) => (
                      <JudgeDetail
                        key={`detail-${grade.id}`}
                        grade={grade}
                        steps={steps}
                        onSelectStep={onSelectStep}
                      />
                    ))}
                  </div>
                ) : null}
              </CollapsibleContent>
            </Collapsible>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * One grader's KPI tile: normalized score (or a muted "n/a"/"—"), with the status as a badge — and
 * (WP 6.1) the human's call on whether the grader got it right.
 *
 * The two live in the same tile but never merge: the score is the grader's, the thumbs are the
 * reviewer's, and the tile shows exactly the same percentage before and after a thumb is clicked
 * (AR6). The feedback control sits BELOW the status row, in the tile's `description` slot, so it
 * reads as a footnote on the measurement rather than part of it.
 */
function GradeMetric({
  grade,
  feedback,
  onFeedback,
}: {
  grade: RunGrade;
  /** This grade's NEWEST human verdict, or `undefined` when nobody has judged it. */
  feedback: GradeFeedback | undefined;
  onFeedback: (next: GradeFeedback) => void;
}) {
  const graded = grade.status === "graded" && grade.score != null;
  const dash = grade.status === "unevaluable" ? "n/a" : "—";

  // Graded → the honest method (+ a grader-native raw score when it differs from the normalized one).
  // Not graded → the status reason (the grader's message, or a default hint) so "n/a"/"—" is never bare.
  const detail = graded
    ? grade.rawScore != null && grade.rawScore !== grade.score
      ? `raw ${formatRawScore(grade.rawScore)} · ${grade.method}`
      : grade.method
    : grade.reasoning?.trim() ||
      (grade.status === "unevaluable"
        ? "No ground truth for this grader — nothing to score against"
        : "The grader could not run — the LLM judge may not be configured");

  // WP 3.2 (G12) — a non-graded score never reads as a bare glyph: a tooltip explains WHY, and a
  // judge-grader that couldn't run links to the Settings judge card so the "—" has an enablement path.
  // The percent itself is colored by the scoreTone thresholds (<60% red · 60–79% amber · ≥80% green)
  // so a mediocre score never reads green just because the STATUS is "graded".
  const value = graded ? (
    <span className={cn("tabular-nums", SCORE_TONE_TEXT_CLASS[scoreTone(grade.score as number)])}>
      {formatGradePercent(grade.score as number)}
    </span>
  ) : (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help underline decoration-dotted underline-offset-4">{dash}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{detail}</TooltipContent>
    </Tooltip>
  );

  const needsJudge = !graded && isJudgeGrader(grade.graderId);

  return (
    <MetricCard
      label={GRADER_LABELS[grade.graderId]}
      value={value}
      description={
        <span className="flex min-w-0 flex-col gap-1">
          <span className="flex min-w-0 flex-wrap items-center gap-1.5">
            <StatusBadge status={GRADE_STATUS_TO_BRAND[grade.status]} size="sm">
              {GRADE_STATUS_LABELS[grade.status]}
            </StatusBadge>
            <span className="min-w-0 break-words">{detail}</span>
          </span>
          {needsJudge ? <JudgeSetupLink /> : null}
          <GradeFeedbackControl
            gradeId={grade.id}
            graderLabel={GRADER_LABELS[grade.graderId]}
            current={feedback}
            onAppended={onFeedback}
            size="sm"
          />
        </span>
      }
    />
  );
}

/**
 * WP 3.2 (G12) — the enablement path for a grade "—": a link to the Settings judge card, where the
 * LLM judge's provider credential + model are configured (the judge graders can't score without it).
 */
function JudgeSetupLink() {
  return (
    <Button variant="link" size="sm" className="h-auto justify-start p-0" asChild>
      <Link to="/settings" title="Configure the LLM judge (provider + model) in Settings">
        <span>Configure grading in Settings</span>
        <ExternalLink aria-hidden className="size-3" />
      </Link>
    </Button>
  );
}

/** A judge grade's collapsible reasoning + cited-step evidence (deep-links into the step log). */
function JudgeDetail({
  grade,
  steps,
  onSelectStep,
}: {
  grade: RunGrade;
  steps: RunStep[];
  onSelectStep: (stepId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const idxs = citedStepIdxs(grade.evidence);
  const reasoning = grade.reasoning?.trim();
  if (!reasoning && idxs.length === 0) return null;

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
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate font-medium">
              {GRADER_LABELS[grade.graderId]} — reasoning
            </span>
            <StatusBadge status={GRADE_STATUS_TO_BRAND[grade.status]} size="sm">
              {GRADE_STATUS_LABELS[grade.status]}
            </StatusBadge>
          </span>
          <ChevronDown
            aria-hidden
            className={cn("size-4 shrink-0 transition-transform", open && "rotate-180")}
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-2 px-3 pb-3">
        {reasoning ? (
          <Text variant="meta" tone="muted" className="whitespace-pre-wrap break-words">
            {reasoning}
          </Text>
        ) : null}
        {idxs.length > 0 ? (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Text variant="meta" tone="muted">
              Evidence:
            </Text>
            {idxs.map((idx) => {
              const step = steps.find((candidate) => candidate.index === idx);
              return (
                <Button
                  key={idx}
                  variant="link"
                  size="sm"
                  className="h-auto p-0"
                  disabled={!step}
                  onClick={() => step && onSelectStep(step.id)}
                  title={step ? `Open step #${idx + 1}` : `Step #${idx + 1} is not in this run`}
                >
                  <span className="tabular-nums">#{idx + 1}</span>
                </Button>
              );
            })}
          </div>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  );
}

/** Layout-shaped placeholder (no spinner that collapses the layout) — see loading-states rule. */
function GradesSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" aria-hidden>
      {[0, 1, 2, 3].map((key) => (
        <Skeleton key={key} className="h-20 w-full rounded-lg" />
      ))}
    </div>
  );
}
