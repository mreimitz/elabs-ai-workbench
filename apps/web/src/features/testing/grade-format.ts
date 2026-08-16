import {
  answerValidationEvidenceSchema,
  BASE_RATING_GRADER_IDS,
  type AnswerValidationEvidence,
  type GradeStatus,
  type GraderId,
  type RunGrade,
} from "@mcp-token-footprint/shared";
import type { Status } from "@brand/ui";

/**
 * Presentational helpers shared by the grade panel (run console), the grade chips (runs list + run
 * compare), and any future grade surface. Pure — no JSX — so the label/score/status mapping lives in
 * exactly one place. The grader roster + status vocabulary are the shared contract (GRADER_IDS /
 * GRADE_STATUSES); these are just the human-facing labels for them.
 */

/** The base-rating grader ids as a Set, for O(1) membership tests below (AR6). */
const BASE_RATING_GRADER_ID_SET: ReadonlySet<GraderId> = new Set(BASE_RATING_GRADER_IDS);

/**
 * Full human labels for each grader in the roster (@see GRADER_IDS). The three base-rating graders
 * (`answer_validation`/`insight_surplus`/`error_forensics`, Auto-Rating WP 1.1) are listed here only
 * to keep this lookup exhaustive over {@link GraderId} — their real chip/column surfaces are
 * {@link BaseVerdictChip}/`BaseVerdictBadge` (Auto-Rating WP 3.2, `./BaseVerdictChip.tsx`), a dimension
 * kept separate from these expectation-grade labels (AR6) and never picked by {@link pickPrimaryGrade}.
 */
export const GRADER_LABELS: Record<GraderId, string> = {
  rouge1: "ROUGE-1 overlap",
  value_match: "Value match",
  outcome_judge: "Outcome judge",
  tool_hygiene: "Tool hygiene",
  trajectory_judge: "Trajectory judge",
  skillflow_conformance: "SkillFlow conformance",
  answer_validation: "Answer validation",
  insight_surplus: "Insight surplus",
  error_forensics: "Error forensics",
};

/** Compact labels for dense chips / tiles. See {@link GRADER_LABELS} for the base-rating caveat. */
export const GRADER_SHORT_LABELS: Record<GraderId, string> = {
  rouge1: "ROUGE-1",
  value_match: "Value",
  outcome_judge: "Judge",
  tool_hygiene: "Hygiene",
  trajectory_judge: "Trajectory",
  skillflow_conformance: "SkillFlow",
  answer_validation: "Answer",
  insight_surplus: "Surplus",
  error_forensics: "Forensics",
};

/** Human labels for a grade's honest evaluation status. */
export const GRADE_STATUS_LABELS: Record<GradeStatus, string> = {
  graded: "Graded",
  unevaluable: "Not evaluable",
  error: "Grader error",
};

/**
 * Map a grade's honest status onto the design-system's canonical execution {@link Status} so status
 * color/icon come from the design system (never hand-rolled): `graded` → complete (green),
 * `unevaluable` → skipped (muted, NOT red), `error` → failed (red).
 */
export const GRADE_STATUS_TO_BRAND: Record<GradeStatus, Status> = {
  graded: "complete",
  unevaluable: "skipped",
  error: "failed",
};

/** The two LLM-judge graders whose written `reasoning` + cited-step `evidence` the panel surfaces. */
const JUDGE_GRADERS = new Set<GraderId>(["outcome_judge", "trajectory_judge"]);

/** Whether a grader is an LLM judge (has reasoning + cited-step evidence to render). */
export function isJudgeGrader(id: GraderId): boolean {
  return JUDGE_GRADERS.has(id);
}

/**
 * A grade's normalized 0–1 score as a whole-percent string (render with `tabular-nums`).
 *
 * T10 ("numbers that do not reconcile," 2026-07-25 critique): the suite console has shown a mean
 * grade as a raw `0.10` (a local `.toFixed(2)` in `suites/SuiteKpiRail.tsx`, bypassing this module
 * entirely) on the SAME screen a matrix cell or table row shows the equivalent figure as `10%` — one
 * quantity, two units, no stated relationship. This function is the ONE place that turns a 0–1 score
 * into a percent string; a surface that instead hand-rolls `.toFixed(2)`/`Math.round(score * 100)` is
 * the exact duplication this module's own top-of-file doc warns against ("the label/score/status
 * mapping lives in exactly one place"). If you're fixing that gap: route BOTH surfaces through
 * `formatGradePercent` (or, if the raw 0–1 form is intentionally kept for one of them — e.g. a KPI
 * tile whose `description` already says "0–1 score" — make sure every OTHER rendering of the same
 * aggregate on the same screen uses the identical unit, never a mix of the two.
 */
export function formatGradePercent(score: number): string {
  const clamped = score < 0 ? 0 : score > 1 ? 1 : score;
  return `${Math.round(clamped * 100)}%`;
}

/** The three threshold buckets a rendered 0–1 score falls into (see {@link scoreTone}). */
export type ScoreTone = "danger" | "warning" | "success";

/**
 * The ONE threshold decision for coloring any rendered 0–1 score/percent (owner feedback
 * 2026-07-12): `< 0.6` → danger (red), `0.6 – <0.8` → warning (amber), `≥ 0.8` → success (green).
 * Every score readout — the report cards' `ScoreReadout`s + donuts + radar, the right-rail grade
 * tiles, the compact `GradeChip` — routes through here so "Judge 60%" can never render green just
 * because its STATUS is "graded". Callers map the tone onto design-system semantics (a `StatusBadge`
 * status, a `text-*-text` utility, a `var(--success|--warning|--destructive)` chart fill) — never a
 * raw color.
 */
export function scoreTone(score: number): ScoreTone {
  if (score >= 0.8) return "success";
  if (score >= 0.6) return "warning";
  return "danger";
}

/**
 * A graded score's tone mapped onto the design-system's canonical execution {@link Status}, for the
 * `StatusBadge`-based chips: success → `complete` (green wash), warning → `awaiting-approval` (the
 * system's amber attention state), danger → `failed` (red). Chips rendering a score through this
 * should pass `hideIcon` — the borrowed statuses' clock/alert glyphs would mislabel a plain score.
 */
export const SCORE_TONE_TO_BRAND: Record<ScoreTone, Status> = {
  success: "complete",
  warning: "awaiting-approval",
  danger: "failed",
};

/**
 * A score tone as a semantic-token TEXT utility (the same `-text` foregrounds the app `StatusBadge`
 * uses — AA-checked in both themes), for inline score readouts that aren't chips.
 */
export const SCORE_TONE_TEXT_CLASS: Record<ScoreTone, string> = {
  success: "text-success-text",
  warning: "text-warning-text",
  danger: "text-destructive-text",
};

/**
 * A score tone as a chart fill — a CSS token reference for `@brand/charts` `color` props (the same
 * `var(--…)` convention `ContextChart`/`SuiteScatter` use). Never a raw color literal.
 */
export const SCORE_TONE_CHART_COLOR: Record<ScoreTone, string> = {
  success: "var(--success)",
  warning: "var(--warning)",
  danger: "var(--destructive)",
};

/** A grader-native raw score (e.g. a 0–10 judge rating): integers verbatim, else two decimals. */
export function formatRawScore(raw: number): string {
  return Number.isInteger(raw) ? String(raw) : raw.toFixed(2);
}

/**
 * The single grade that summarizes a run in a chip: prefer the outcome judge's real score, else any
 * graded grader, else the outcome judge (even if unevaluable/error), else the first row. `null` when
 * the run carries no (expectation) grades at all.
 *
 * AR6 (WP 3.2) — the three base-rating graders (`answer_validation`/`insight_surplus`/
 * `error_forensics`) are filtered out FIRST: they are a separate dimension with their own chip
 * surface ({@link ./BaseVerdictChip.tsx}), so they must never be picked as "the" expectation-grade
 * chip a caller renders via {@link GradeChip} — that would silently conflate the two dimensions the
 * moment a run has a base grade but no expectation grade (the common case, since the base graders run
 * on EVERY terminal run while expectation graders only run when the test declares `expectations`).
 */
export function pickPrimaryGrade(latest: RunGrade[]): RunGrade | null {
  const expectationOnly = filterExpectationGrades(latest);
  return (
    expectationOnly.find(
      (grade) => grade.graderId === "outcome_judge" && grade.status === "graded",
    ) ??
    expectationOnly.find((grade) => grade.status === "graded") ??
    expectationOnly.find((grade) => grade.graderId === "outcome_judge") ??
    expectationOnly[0] ??
    null
  );
}

/**
 * The run's grades restricted to the EXPECTATION dimension — excludes the three always-on base-rating
 * graders (AR6). Used wherever a surface wants the FULL list of expectation grades rather than just
 * {@link pickPrimaryGrade}'s single summary pick (e.g. the run console `GradePanel`'s compact chip row,
 * WP 3.2).
 */
export function filterExpectationGrades(latest: RunGrade[]): RunGrade[] {
  return latest.filter((grade) => !BASE_RATING_GRADER_ID_SET.has(grade.graderId));
}

/**
 * Pull the `answer_validation` base grader's row out of a run's latest-per-grader grades (WP 3.2, AR6)
 * and parse its typed evidence. `null` when the run has no such row yet (predates Auto-Rating, or
 * grading hasn't run), or when a row exists but carries no parseable evidence — the grader's
 * unconfigured-judge / unpriced-judge / error short-circuits stamp NO typed evidence at all (see
 * `apps/api/src/grading/answer-validation.ts`) — an honest "not rated" rather than a guessed verdict.
 *
 * Deliberately does NOT default to `unanswered` the way the composed `RunReport` does
 * (`apps/api/src/grading/run-report.ts`'s `DEFAULT_ANSWER_VALIDATION`, AR1): that default suits a full
 * report that always shows SOME verdict, but a glance chip in a dense list/matrix must never read a
 * genuinely ungraded run as a fake negative signal.
 */
export function pickBaseVerdictEvidence(latest: RunGrade[]): AnswerValidationEvidence | null {
  const grade = latest.find((candidate) => candidate.graderId === "answer_validation");
  if (!grade) return null;
  const parsed = answerValidationEvidenceSchema.safeParse(grade.evidence);
  return parsed.success ? parsed.data : null;
}

/**
 * The step indices a judge grade cites in its `evidence`. The evidence shape is grader-defined
 * (`unknown`); a judge cites the steps it weighed as step `index`es — accept a bare `number[]` or a
 * `{ steps | stepIdxs | citedSteps: number[] }` envelope, ignoring anything else so a future evidence
 * shape can never throw. Returns a de-duplicated, ascending list (empty when there are none).
 */
export function citedStepIdxs(evidence: unknown): number[] {
  const raw = Array.isArray(evidence)
    ? evidence
    : isRecord(evidence)
      ? (evidence.steps ?? evidence.stepIdxs ?? evidence.citedSteps)
      : undefined;
  if (!Array.isArray(raw)) return [];
  const idxs = raw.filter(
    (value): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0,
  );
  return [...new Set(idxs)].sort((a, b) => a - b);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
