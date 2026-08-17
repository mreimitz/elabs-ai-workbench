import type { RunGrade } from "@mcp-token-footprint/shared";
import { StatusBadge } from "@elabs-ai/components-ui";
import {
  formatGradePercent,
  GRADE_STATUS_TO_BRAND,
  GRADER_SHORT_LABELS,
  pickPrimaryGrade,
  SCORE_TONE_TO_BRAND,
  scoreTone,
} from "./grade-format";

/**
 * Compact quality-grade chip for dense rows (the runs list + the run-compare matrix). Shows the run's
 * PRIMARY grade (the outcome judge, else the first graded grader) as a whole-percent score on a
 * design-system `StatusBadge`. A GRADED score is colored by the {@link scoreTone} thresholds
 * (<60% red · 60–79% amber · ≥80% green) — "graded" alone never earns green (owner feedback
 * 2026-07-12: "Judge 60%" used to render green because graded→complete); the icon is hidden on those
 * chips so a borrowed status glyph can't mislabel a plain score. A non-graded chip keeps the honest
 * STATUS coloring: an `unevaluable` primary reads as a muted "n/a" (the `skipped` status), NEVER a
 * red 0, so it is visually distinct from a genuine low score. Renders nothing when the run has no
 * grades.
 */
export function GradeChip({ latest }: { latest: RunGrade[] }) {
  const primary = pickPrimaryGrade(latest);
  if (!primary) return null;

  const label = GRADER_SHORT_LABELS[primary.graderId];
  const graded = primary.status === "graded" && primary.score != null;
  const value = graded
    ? formatGradePercent(primary.score as number)
    : primary.status === "unevaluable"
      ? "n/a"
      : "error";
  const status = graded
    ? SCORE_TONE_TO_BRAND[scoreTone(primary.score as number)]
    : GRADE_STATUS_TO_BRAND[primary.status];

  return (
    <StatusBadge
      status={status}
      size="sm"
      hideIcon={graded}
      className="tabular-nums"
      title={`${label} — ${value}`}
    >
      {label} {value}
    </StatusBadge>
  );
}
