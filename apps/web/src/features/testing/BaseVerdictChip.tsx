import type {
  AnswerValidationEvidence,
  AnswerValidationVerdict,
  RunGrade,
} from "@mcp-token-footprint/shared";
import { Badge, type BadgeProps } from "@elabs-ai/components-ui";
import { pickBaseVerdictEvidence } from "./grade-format";

/**
 * Auto-Rating WP 3.2 (AR6) — the `answer_validation` base grader's compact verdict chip, for the Runs
 * feed and the suite matrix. This is a SEPARATE dimension from the expectation {@link ../GradeChip},
 * kept visually distinct on purpose: `GradeChip` is a design-system `StatusBadge` (execution-status
 * colored); `BaseVerdictChip`/`BaseVerdictBadge` is a plain semantic-variant `Badge` — the SAME
 * vocabulary the run console's Report tab uses for this exact verdict (`ReportTab.tsx`'s
 * `ANSWER_VERDICT_META`, WP 3.1) — so a reviewer never mistakes one dimension for the other, and the
 * same verdict always reads with the same word + color everywhere it appears.
 *
 * Always render this ALONGSIDE `GradeChip`, never nested inside it.
 */

/** Human labels for the `answer_validation` verdict (mirrors ReportTab's local vocabulary, WP 3.1). */
export const BASE_VERDICT_LABELS: Record<AnswerValidationVerdict, string> = {
  answered: "Answered",
  partial: "Partial",
  unanswered: "Unanswered",
};

/** Verdict → Badge semantic variant — success/warning/destructive, the same mapping ReportTab uses. */
export const BASE_VERDICT_BADGE_VARIANT: Record<
  AnswerValidationVerdict,
  NonNullable<BadgeProps["variant"]>
> = {
  answered: "success",
  partial: "warning",
  unanswered: "destructive",
};

/**
 * The base-rating verdict as a plain, semantic-variant `Badge`. `evidence: null` (no `answer_validation`
 * grade yet, or its evidence didn't parse) renders an honest muted "Not rated" — `variant="secondary"`,
 * the same neutral variant `ReportTab`'s `SURPLUS_VERDICT_META.none` uses — NEVER a fake verdict.
 */
export function BaseVerdictBadge({ evidence }: { evidence: AnswerValidationEvidence | null }) {
  if (!evidence) {
    return (
      <Badge variant="secondary" title="No base-rating verdict yet for this run">
        Not rated
      </Badge>
    );
  }
  const label = BASE_VERDICT_LABELS[evidence.verdict];
  return (
    <Badge
      variant={BASE_VERDICT_BADGE_VARIANT[evidence.verdict]}
      title={`Answer validation — ${label}`}
    >
      {label}
    </Badge>
  );
}

/**
 * Derives the verdict from a run's latest-per-grader grades (the SAME `RunGrade[]` the expectation
 * `GradeChip` reads) and renders it via {@link BaseVerdictBadge}. Renders nothing extra beyond the
 * badge itself — the caller places it alongside `GradeChip` in the layout.
 */
export function BaseVerdictChip({ latest }: { latest: RunGrade[] }) {
  return <BaseVerdictBadge evidence={pickBaseVerdictEvidence(latest)} />;
}
