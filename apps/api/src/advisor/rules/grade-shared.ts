// Helpers shared by the three GRADE-AWARE advisor rules (WP 2.1).
//
// Phase 1's `shared.ts` joins footprints to behavior. This file adds the third input — GRADES — and
// nothing else: every helper here reads through the {@link AdvisorContext}'s WP 2.1 ports
// (`grades` / `suiteRuns` / `skills` / `models`), and each imposes its own total order for the same
// reason `shared.ts` does (a repository's `ORDER BY started_at DESC` ties freely, and SQLite makes
// no promise about the order of tied rows — the report's determinism contract would inherit that).
//
// THE ONE SCORE. A run's single quality number is `selectRunScore` from the benchmarks suite
// analytics (WP 3.4) — the SAME primary-grader priority the suite aggregate `meanGrade`, the
// quality×cost scatter and the WP 5.1 delta view all use. The advisor deliberately does not define
// its own: a recommendation that said "the score held" against a number nobody else in the app
// computes would be unfalsifiable, and would drift the moment the roster changed.

import {
  ADVISOR_QUALITY_BAR,
  type GraderId,
  type RunGrade,
  type RunSummary,
  type SuiteRun,
  type SuiteVariant,
} from "@mcp-token-footprint/shared";
import { advisorThresholds } from "../../data-pack/thresholds.js";
import { selectRunScore } from "../../suites/analytics.js";
import type { AdvisorContext } from "../types.js";
import { compareStrings } from "./shared.js";

// `suite_run_window` (how many suite runs one rule walks, newest first — a fleet can accumulate
// hundreds and an unbounded walk would make one report quadratic in the whole run history, while the
// OLDEST matrices are the least representative of how the fleet runs today) and
// `provenance_suite_run_limit` (how many suite-run ids one `AdvisorGradeProvenance` lists, the same
// bounded-evidence reasoning as `evidence_tool_limit`) both live in
// `data-pack/advisor/thresholds.json` since RM-38 WP 2.2. Each cap is stated in the emitting
// finding's assumptions, so a reader always knows the window they are looking at.

/**
 * The latest grade row per grader for a run, in the shape {@link selectRunScore} expects.
 *
 * `run_grades` is APPEND-ONLY, so the repository hands back the whole history oldest-first and the
 * LAST row per grader wins — the same latest-per-grader selection `GradeRepository.latestByGrader`
 * and the suite analytics both perform.
 */
export function latestGradesByGrader(
  ctx: AdvisorContext,
  runId: string,
): Map<GraderId, RunGrade> {
  const latest = new Map<GraderId, RunGrade>();
  for (const grade of ctx.grades.listByRun(runId)) latest.set(grade.graderId, grade);
  return latest;
}

/** A run's single primary-grader score, or `null` when NO grader produced a graded score for it.
 *  Never 0 — an ungraded run is excluded from a mean, never counted as a failure (invariant 3). */
export function runScore(ctx: AdvisorContext, runId: string): number | null {
  return selectRunScore(latestGradesByGrader(ctx, runId));
}

/** The `GRADING_VERSION` values actually stamped on these runs' grade rows, ascending + deduped.
 *  Read from the ROWS rather than assumed to be today's constant: a grade written under an older
 *  version keeps its own stamp, and a recommendation must record what it read, not what it hoped to
 *  read. Only `graded` rows count — an `error`/`unevaluable` row carries no score to be versioned
 *  ABOUT, and letting one contribute a version would gap out a finding over a grader that failed. */
export function gradingVersionsOf(ctx: AdvisorContext, runIds: readonly string[]): number[] {
  const versions = new Set<number>();
  for (const runId of runIds) {
    for (const grade of ctx.grades.listByRun(runId)) {
      if (grade.status === "graded" && grade.score !== null) versions.add(grade.gradingVersion);
    }
  }
  return [...versions].sort((a, b) => a - b);
}

/**
 * The ONE grading version these runs' scores were computed under, or `null` when there isn't one.
 *
 * `null` covers two different honest outcomes, and the caller must distinguish them in its gap
 * reason: **no graded rows at all** (nothing to be version-stamped) and **more than one version**
 * (scores that must not be averaged together). The second is the grading twin of `comparablyCounted`
 * in Phase 1 — `TOKEN_COUNTING_VERSION` / `GRADING_VERSION` / `ADVISOR_VERSION` all carry the same
 * never-silently-compare rule, so a mean taken across two grading versions is refused rather than
 * published with a version stamp that is true of only half its inputs.
 */
export function singleGradingVersion(ctx: AdvisorContext, runIds: readonly string[]): number | null {
  const versions = gradingVersionsOf(ctx, runIds);
  return versions.length === 1 ? (versions[0] as number) : null;
}

/** Ascending + deduped ids — the exact ordering the engine requires of
 *  `AdvisorGradeProvenance.suiteRunIds`, so a finding computed twice serializes identically. */
export function sortedUniqueIds(ids: Iterable<string>): string[] {
  return [...new Set(ids)].sort(compareStrings);
}

/** Whether a score clears the quality bar. One place, so "clears the bar" means the same `>= 0.5`
 *  in every rule — and the same `>= 0.5` the suite aggregates' `passRateAt05` already means. */
export function clearsQualityBar(score: number | null): score is number {
  return score !== null && score >= ADVISOR_QUALITY_BAR;
}

/** Suite runs newest first (id tie-break), capped at the pack's `suite_run_window`. */
export function recentSuiteRuns(ctx: AdvisorContext): SuiteRun[] {
  return [...ctx.suiteRuns.listRuns()]
    .sort((a, b) => {
      const byTime = compareStrings(b.startedAt, a.startedAt);
      return byTime !== 0 ? byTime : compareStrings(a.id, b.id);
    })
    .slice(0, advisorThresholds().suite_run_window);
}

/** A suite run's child run summaries, in the repository's `started_at ASC` id order, skipping any
 *  member that no longer resolves (deleted after the matrix ran — an honest omission, not an error). */
export function suiteRunMembers(ctx: AdvisorContext, suiteRunId: string): RunSummary[] {
  const members: RunSummary[] = [];
  for (const runId of ctx.suiteRuns.listChildRunIds(suiteRunId)) {
    try {
      members.push(ctx.runs.getSummary(runId));
    } catch {
      // Deleted member — it contributes to nothing, and its absence is not a data gap worth
      // reporting (the suite run's remaining members still answer the question).
    }
  }
  return members;
}

/** The variant axis frozen onto a suite run's config snapshot (benchmarks WP 5.1), or `[]`. */
export function variantsOf(suiteRun: SuiteRun): SuiteVariant[] {
  return suiteRun.configSnapshot.variants ?? [];
}

/**
 * The BASE variant of a skill-effect suite run: the FIRST variant in the frozen config snapshot.
 *
 * Not a new convention — it is exactly what `GET /api/suite-runs/:id/deltas` defaults to when no
 * `?base=` is given, so an advisor delta and the deltas the operator sees in the suite UI are the
 * same comparison. Stated as an assumption on every finding that uses it.
 */
export function baseVariantLabel(variants: readonly SuiteVariant[]): string | null {
  return variants[0]?.label ?? null;
}

/** The skill ids a run ACTUALLY resolved (`run_skills`) — the immutable input WP 5.1's variant
 *  attribution matches against. */
export function observedSkillIds(ctx: AdvisorContext, runId: string): Set<string> {
  return new Set(ctx.runs.getRunSkills(runId).map((row) => row.skill_id));
}

/** Skill display names by id. Built from `list()` (never `get`), so a skill deleted after the run
 *  that used it simply falls back to its id rather than throwing out of a rule. */
export function skillNamesById(ctx: AdvisorContext): Map<string, string> {
  const names = new Map<string, string>();
  for (const skill of ctx.skills.list()) names.set(skill.id, skill.displayName || skill.name);
  return names;
}

/** Arithmetic mean; `null` for an empty list — never `0`, which a reader would take for a measured
 *  zero rather than "nothing was measured". */
export function meanOrNull(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  let total = 0;
  for (const value of values) total += value;
  return total / values.length;
}

/** A 0..1 score as a 3-decimal string (`0.6125` → `"0.613"`). Fixed precision, no locale. */
export function formatScore(score: number): string {
  return score.toFixed(3);
}

/** A signed 3-decimal delta (`0.11` → `"+0.110"`), so a reader never has to infer the direction. */
export function formatSignedScore(delta: number): string {
  return `${delta >= 0 ? "+" : "-"}${Math.abs(delta).toFixed(3)}`;
}

/** A USD amount at 4 decimals — per-run costs here are routinely fractions of a cent, and rounding
 *  to 2 would render a real difference as `$0.00`. */
export function formatUsd(value: number): string {
  return `$${value.toFixed(4)}`;
}

/** A signed USD amount at 4 decimals. */
export function formatSignedUsd(delta: number): string {
  return `${delta >= 0 ? "+" : "-"}$${Math.abs(delta).toFixed(4)}`;
}
