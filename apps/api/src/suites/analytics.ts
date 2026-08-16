import {
  GRADER_IDS,
  type GraderId,
  type RunGrade,
  type RunSummary,
  type SuiteAnalytics,
  type SuiteBreakdownSlice,
  type SuiteDeltaRow,
  type SuiteRunMember,
  type SuiteScatterPoint,
  type SuiteVariant,
} from "@mcp-token-footprint/shared";
import type { GradeRepository } from "../grading/grade-repository.js";
import type { RunRepository } from "../testing/run-repository.js";
import type { TestService } from "../testing/test-service.js";
import { httpError } from "../utils/errors.js";
import { PRIMARY_GRADER_PRIORITY } from "./orchestrator.js";

/**
 * Benchmarks (WP 3.4, B9.2–B9.3) — suite-run ANALYTICS, DERIVED purely from a suite run's child runs +
 * their grades + each run's test metadata. Analytics are NEVER a source of truth: the same numbers are
 * recomputable at any time from the persisted `runs`/`run_grades`/`tests` (mirroring the aggregate
 * derivation in {@link import("./orchestrator.js")}). Two products:
 *   - `scatter`   — one quality×cost point per (test × scenario × variant) SUBJECT, repetitions AVERAGED.
 *   - `breakdowns`— metadata-dimension slices (category / difficulty / each tag) × scenario.
 *
 * SCORE DIMENSION (documented, single source): a point/slice `meanScore` is the mean over the
 * repetitions that produced a GRADED score for the SELECTED grader; a run with no such graded score is
 * EXCLUDED from the mean (counted in neither numerator nor denominator) — it is NEVER treated as a 0.
 * The DEFAULT (no `grader` passed) is the PRIMARY-grader priority — the same single-score selection the
 * suite aggregate `meanGrade` uses (`outcome_judge` → `trajectory_judge` → `rouge1` → `value_match` →
 * `tool_hygiene` → `skillflow_conformance`, see {@link PRIMARY_GRADER_PRIORITY}). A caller may pass a
 * specific grader id (`?grader=`) to re-score every subject/slice against that one grader instead — the
 * web scatter's Y-axis selector drives exactly this re-fetch. `meanTokens`/`meanCostUsd`/`reps` (scatter)
 * and `meanCostUsd`/`count` (breakdown) are averaged/counted over ALL repetitions of the subject/slice
 * (real spend is counted even for an ungraded run).
 *
 * QUALITY GATE: because this is a QUALITY×cost view, a subject/slice with NO graded score at all (its
 * `meanScore` would be null) is OMITTED entirely — it has no y position to plot. So a suite run with no
 * grades yields an honest EMPTY `{scatter:[],breakdowns:[]}` rather than a cloud of scoreless points.
 */

/**
 * The single per-run outcome-score selection the analytics use. With a `grader` it is that grader's
 * latest graded score (else null); without one it walks {@link PRIMARY_GRADER_PRIORITY} and returns the
 * first grader that produced a graded score (null when none did). Mirrors the orchestrator's
 * `pickOutcomeScore` so the analytics' default score dimension equals the aggregate `meanGrade`'s.
 */
export function selectRunScore(
  latestByGrader: Map<GraderId, RunGrade>,
  grader?: GraderId,
): number | null {
  if (grader) {
    const grade = latestByGrader.get(grader);
    return grade && grade.status === "graded" && grade.score !== null ? grade.score : null;
  }
  for (const graderId of PRIMARY_GRADER_PRIORITY) {
    const grade = latestByGrader.get(graderId);
    if (grade && grade.status === "graded" && grade.score !== null) return grade.score;
  }
  return null;
}

/**
 * The per-child data the analytics read — derived purely from a child run row + its grade rows + its
 * test's metadata. `score` is already resolved via {@link selectRunScore} for the selected grader.
 * `variantLabel` is front-loaded for WP 5.1 skill-effect suites (runs don't carry one today, so it is
 * absent — the subject key still folds it in so base/variant subjects never collide once they exist).
 */
export type AnalyticsChildRun = {
  runId: string;
  testId: string;
  scenarioId: string;
  variantLabel?: string;
  tokens: number;
  costUsd: number;
  score: number | null;
  category?: string;
  difficulty?: string;
  tags: string[];
};

type TestMeta = { category?: string; difficulty?: string; tags: string[] };

/**
 * Collect the per-child analytics inputs from persisted state ONLY — the run rows, their grade rows, and
 * their tests' metadata. A run id that no longer resolves (deleted) is skipped; a test that no longer
 * resolves contributes to the scatter (test/scenario id come from the run) but not to any breakdown
 * (no metadata). Test metadata is cached per test id so a large matrix hits `tests.get` once per test.
 */
export function collectAnalyticsChildren(
  runs: RunRepository,
  grades: GradeRepository,
  tests: TestService,
  runIds: readonly string[],
  grader?: GraderId,
): AnalyticsChildRun[] {
  const metaCache = new Map<string, TestMeta>();
  const children: AnalyticsChildRun[] = [];
  for (const runId of runIds) {
    let summary: ReturnType<RunRepository["getSummary"]>;
    try {
      summary = runs.getSummary(runId);
    } catch {
      continue; // run was deleted — it no longer contributes to the derived analytics
    }
    const latestByGrader = new Map<GraderId, RunGrade>();
    for (const grade of grades.listByRun(runId)) latestByGrader.set(grade.graderId, grade);
    const meta = resolveTestMeta(tests, summary.testId, metaCache);
    const child: AnalyticsChildRun = {
      runId,
      testId: summary.testId,
      scenarioId: summary.scenarioId,
      tokens: summary.tokensIn + summary.tokensOut,
      costUsd: summary.costUsd,
      score: selectRunScore(latestByGrader, grader),
      tags: meta.tags,
    };
    if (meta.category !== undefined) child.category = meta.category;
    if (meta.difficulty !== undefined) child.difficulty = meta.difficulty;
    children.push(child);
  }
  return children;
}

function resolveTestMeta(
  tests: TestService,
  testId: string,
  cache: Map<string, TestMeta>,
): TestMeta {
  const cached = cache.get(testId);
  if (cached) return cached;
  let meta: TestMeta = { tags: [] };
  try {
    const test = tests.get(testId);
    meta = {
      ...(test.category ? { category: test.category } : {}),
      ...(test.difficulty ? { difficulty: test.difficulty } : {}),
      tags: test.tags ?? [],
    };
  } catch {
    // Test deleted after the run — the run keeps its scatter point, but has no breakdown metadata.
  }
  cache.set(testId, meta);
  return meta;
}

/**
 * The PURE analytics core — roll the collected children into {@link SuiteAnalytics}. Deterministic and
 * side-effect-free, so it is hand-checkable in isolation and drives both the endpoint and the report.
 */
export function computeSuiteAnalytics(children: readonly AnalyticsChildRun[]): SuiteAnalytics {
  return { scatter: buildScatter(children), breakdowns: buildBreakdowns(children) };
}

/** The endpoint/report entry point: collect from the repos, then compute. */
export function buildSuiteAnalytics(
  runs: RunRepository,
  grades: GradeRepository,
  tests: TestService,
  runIds: readonly string[],
  grader?: GraderId,
): SuiteAnalytics {
  return computeSuiteAnalytics(collectAnalyticsChildren(runs, grades, tests, runIds, grader));
}

/**
 * Testing UX — the suite run's MEMBER runs, one {@link SuiteRunMember} per child run, DERIVED purely
 * from persisted state (`runs` + `run_grades` + `run_skills`). This is the per-member analogue of the
 * subject-averaged {@link collectAnalyticsChildren}: it returns each repetition as its own row (full
 * {@link RunSummary} + selected-grader `score` + attributed variant), so it materialises IDENTICALLY
 * for a LIVE and a FINISHED suite run — the fix for a finished-run console whose per-cell SSE stream is
 * never re-emitted. `score` uses the SAME {@link selectRunScore} selection as the aggregate `meanGrade`
 * + scatter (so a matrix seeded from these members shows scores consistent with the analytics tabs).
 *
 * `repetition` prefers the persisted 1-based ordinal ({@link RunRepository.linkRunToSuite}); a
 * legacy/null row falls back to a started-order per-subject counter (`runIds` is `started_at ASC`).
 * `variantLabel` is attributed via {@link attributeVariant} ONLY for a skill-effect suite (variants
 * present) — and, UNLIKE the deltas view, an unattributable run is KEPT (it honestly ran) with the
 * label simply absent. A run id that no longer resolves (deleted) is skipped.
 */
export function buildSuiteRunMembers(
  runs: RunRepository,
  grades: GradeRepository,
  runIds: readonly string[],
  variants: readonly SuiteVariant[],
  grader?: GraderId,
): SuiteRunMember[] {
  const hasVariants = variants.length > 0;
  const repCounter = new Map<string, number>();
  const members: SuiteRunMember[] = [];
  for (const runId of runIds) {
    let summary: RunSummary;
    try {
      summary = runs.getSummary(runId);
    } catch {
      continue; // run was deleted — nothing to report for it
    }
    const latestByGrader = new Map<GraderId, RunGrade>();
    for (const grade of grades.listByRun(runId)) latestByGrader.set(grade.graderId, grade);
    const subjectKey = `${summary.testId} ${summary.scenarioId}`;
    const nextOrdinal = (repCounter.get(subjectKey) ?? 0) + 1;
    repCounter.set(subjectKey, nextOrdinal);
    const member: SuiteRunMember = {
      ...summary,
      repetition: summary.repetition ?? nextOrdinal,
      score: selectRunScore(latestByGrader, grader),
    };
    if (hasVariants) {
      const observed = new Set(runs.getRunSkills(runId).map((row) => row.skill_id));
      const variantLabel = attributeVariant(variants, summary.scenarioId, observed);
      if (variantLabel !== null) member.variantLabel = variantLabel;
    }
    members.push(member);
  }
  return members;
}

/**
 * Parse + validate a `?grader=` query value. Absent/empty → undefined (the default primary-grader
 * priority). A non-empty value MUST be a known {@link GRADER_IDS} member, else 400 (never silently
 * fall back, so a typo'd grader is surfaced rather than masked as the default dimension).
 */
export function parseGraderQuery(value: string | undefined): GraderId | undefined {
  if (value === undefined || value === "") return undefined;
  if (!(GRADER_IDS as readonly string[]).includes(value)) {
    throw httpError(400, `Unknown grader '${value}'`);
  }
  return value as GraderId;
}

// ── Pure builders ────────────────────────────────────────────────────────────────────────────────

/** One scatter point per (testId × scenarioId × variantLabel) subject; repetitions averaged. */
function buildScatter(children: readonly AnalyticsChildRun[]): SuiteScatterPoint[] {
  const groups = new Map<string, AnalyticsChildRun[]>();
  for (const child of children) {
    const key = subjectKey(child.testId, child.scenarioId, child.variantLabel);
    const bucket = groups.get(key);
    if (bucket) bucket.push(child);
    else groups.set(key, [child]);
  }
  const points: SuiteScatterPoint[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    if (!first) continue;
    const meanScore = meanOfScores(group);
    if (meanScore === null) continue; // no graded rep — no quality to plot (honest omission)
    const point: SuiteScatterPoint = {
      testId: first.testId,
      scenarioId: first.scenarioId,
      meanScore,
      meanTokens: mean(group.map((c) => c.tokens)),
      meanCostUsd: mean(group.map((c) => c.costUsd)),
      reps: group.length,
    };
    if (first.variantLabel !== undefined) point.variantLabel = first.variantLabel;
    points.push(point);
  }
  points.sort(
    (a, b) =>
      a.testId.localeCompare(b.testId) ||
      a.scenarioId.localeCompare(b.scenarioId) ||
      (a.variantLabel ?? "").localeCompare(b.variantLabel ?? ""),
  );
  return points;
}

/** Breakdown slices by category / difficulty / each tag, grouped by scenario. */
function buildBreakdowns(children: readonly AnalyticsChildRun[]): SuiteBreakdownSlice[] {
  type Bucket = {
    dimension: SuiteBreakdownSlice["dimension"];
    key: string;
    scenarioId: string;
    runs: AnalyticsChildRun[];
  };
  const groups = new Map<string, Bucket>();
  const add = (dimension: Bucket["dimension"], key: string, child: AnalyticsChildRun) => {
    const gk = `${dimension} ${key} ${child.scenarioId}`;
    let bucket = groups.get(gk);
    if (!bucket) {
      bucket = { dimension, key, scenarioId: child.scenarioId, runs: [] };
      groups.set(gk, bucket);
    }
    bucket.runs.push(child);
  };
  for (const child of children) {
    if (child.category) add("category", child.category, child);
    if (child.difficulty) add("difficulty", child.difficulty, child);
    for (const tag of child.tags) if (tag) add("tag", tag, child);
  }
  const slices: SuiteBreakdownSlice[] = [];
  for (const bucket of groups.values()) {
    const meanScore = meanOfScores(bucket.runs);
    if (meanScore === null) continue; // no graded run in this slice — omit (honest empty when no grades)
    slices.push({
      dimension: bucket.dimension,
      key: bucket.key,
      scenarioId: bucket.scenarioId,
      meanScore,
      meanCostUsd: mean(bucket.runs.map((c) => c.costUsd)),
      count: bucket.runs.length,
    });
  }
  slices.sort(
    (a, b) =>
      DIMENSION_ORDER[a.dimension] - DIMENSION_ORDER[b.dimension] ||
      a.key.localeCompare(b.key) ||
      a.scenarioId.localeCompare(b.scenarioId),
  );
  return slices;
}

const DIMENSION_ORDER: Record<SuiteBreakdownSlice["dimension"], number> = {
  category: 0,
  difficulty: 1,
  tag: 2,
};

function subjectKey(testId: string, scenarioId: string, variantLabel: string | undefined): string {
  return `${testId} ${scenarioId} ${variantLabel ?? ""}`;
}

/** Mean of the graded scores in the group (nulls excluded); null when NONE was graded (never 0). */
function meanOfScores(items: readonly AnalyticsChildRun[]): number | null {
  const scores = items.map((c) => c.score).filter((score): score is number => score !== null);
  return scores.length > 0 ? mean(scores) : null;
}

/** Arithmetic mean; 0 for an empty list (only reached by score-free helpers that guard length first). */
function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

// ── WP 5.1 (skill-effect) — per-test base-vs-variant DELTAS ────────────────────────────────────────
/**
 * Benchmarks (WP 5.1, B14) — "does attaching skill X make the agent better, cheaper, or both?" answered
 * on the SAME suite run. A skill-effect suite runs each test under N VARIANTS (base vs ± skill/version).
 * The delta view is, per test, each variant's grade/tokens/cost MINUS the chosen base variant's, MEANED
 * over repetitions. DERIVED purely from the suite run's child runs + their grades + the config-snapshot
 * variant definitions — nothing new is persisted, so a past suite run replays its exact deltas.
 *
 * ATTRIBUTION (which variant produced a run): variants are NEVER stamped on a run; instead a run is
 * matched to a variant by its SCENARIO plus its RECORDED resolved skills (`run_skills` — the concrete
 * skills the run actually loaded). A variant matches a run iff the run is on the variant's scenario, all
 * of the variant's `attach` skills are present in the run's resolved set, and none of its `detach` skills
 * are — the most SPECIFIC (most attach+detach constraints) match wins. This uses only immutable inputs
 * (the frozen override intent + the run's own recorded skills), so it is stable across later skill-version
 * or scenario edits — and it doubles as the proof that the override actually changed resolution. A run
 * that matches no variant (or, degenerately, two equally-specific variants) is EXCLUDED (honest omission).
 */

/** One attributed child run the delta rollup reads — its variant + primary-grader score + tokens + cost. */
export type DeltaChildRun = {
  runId: string;
  testId: string;
  variantLabel: string;
  score: number | null;
  tokens: number;
  costUsd: number;
};

/**
 * Attribute a run to at most one variant by (scenario + observed resolved skill ids). Returns the winning
 * variant's label, or null when no variant matches OR two match at the same top specificity (ambiguous —
 * genuinely indistinguishable variants). Pure + side-effect-free, so it is unit-tested in isolation.
 */
export function attributeVariant(
  variants: readonly SuiteVariant[],
  scenarioId: string,
  observedSkillIds: ReadonlySet<string>,
): string | null {
  let best: { label: string; specificity: number } | null = null;
  let ambiguous = false;
  for (const variant of variants) {
    if (variant.scenarioId !== scenarioId) continue;
    const attach = variant.skillOverrides.attach ?? [];
    const detach = variant.skillOverrides.detach ?? [];
    const matches =
      attach.every((a) => observedSkillIds.has(a.skillId)) &&
      detach.every((skillId) => !observedSkillIds.has(skillId));
    if (!matches) continue;
    const specificity = attach.length + detach.length;
    if (!best || specificity > best.specificity) {
      best = { label: variant.label, specificity };
      ambiguous = false;
    } else if (specificity === best.specificity) {
      ambiguous = true;
    }
  }
  if (!best || ambiguous) return null;
  return best.label;
}

/**
 * Collect the attributed child runs from persisted state ONLY — each child run's summary + grades +
 * recorded `run_skills`. A run id that no longer resolves, or that can't be attributed to a variant, is
 * skipped. `score` is the same primary-grader selection the aggregate `meanGrade` uses (via
 * {@link selectRunScore}), so the delta's grade axis matches the rest of the suite analytics.
 */
export function collectDeltaChildren(
  runs: RunRepository,
  grades: GradeRepository,
  variants: readonly SuiteVariant[],
  runIds: readonly string[],
): DeltaChildRun[] {
  const children: DeltaChildRun[] = [];
  for (const runId of runIds) {
    let summary: ReturnType<RunRepository["getSummary"]>;
    try {
      summary = runs.getSummary(runId);
    } catch {
      continue; // run was deleted — it no longer contributes to the derived deltas
    }
    const observed = new Set(runs.getRunSkills(runId).map((row) => row.skill_id));
    const variantLabel = attributeVariant(variants, summary.scenarioId, observed);
    if (variantLabel === null) continue; // unattributable → excluded (honest)
    const latestByGrader = new Map<GraderId, RunGrade>();
    for (const grade of grades.listByRun(runId)) latestByGrader.set(grade.graderId, grade);
    children.push({
      runId,
      testId: summary.testId,
      variantLabel,
      score: selectRunScore(latestByGrader),
      tokens: summary.tokensIn + summary.tokensOut,
      costUsd: summary.costUsd,
    });
  }
  return children;
}

/**
 * The PURE delta rollup: per test, each non-base variant's mean grade/tokens/cost MINUS the base
 * variant's, over its repetitions. `gradeDelta` is null when EITHER side lacks a graded score (no honest
 * comparison — never a fake 0); `tokensDelta`/`costDelta` are always the mean difference (real spend is
 * compared even for an ungraded run). A test with no base-variant runs yields no rows for that test.
 * Deterministic + side-effect-free, so it is hand-checkable and drives the endpoint + any report.
 */
export function computeSuiteDeltas(
  children: readonly DeltaChildRun[],
  baseLabel: string,
): SuiteDeltaRow[] {
  // Group by test → variant → runs.
  const byTest = new Map<string, Map<string, DeltaChildRun[]>>();
  for (const child of children) {
    let byVariant = byTest.get(child.testId);
    if (!byVariant) {
      byVariant = new Map();
      byTest.set(child.testId, byVariant);
    }
    const bucket = byVariant.get(child.variantLabel);
    if (bucket) bucket.push(child);
    else byVariant.set(child.variantLabel, [child]);
  }

  const rows: SuiteDeltaRow[] = [];
  for (const [testId, byVariant] of byTest) {
    const baseRuns = byVariant.get(baseLabel);
    if (!baseRuns || baseRuns.length === 0) continue; // no base to compare against for this test
    const baseScore = meanScoreOf(baseRuns);
    const baseTokens = mean(baseRuns.map((c) => c.tokens));
    const baseCost = mean(baseRuns.map((c) => c.costUsd));
    for (const [variantLabel, variantRuns] of byVariant) {
      if (variantLabel === baseLabel) continue;
      const variantScore = meanScoreOf(variantRuns);
      rows.push({
        testId,
        baseLabel,
        variantLabel,
        gradeDelta: baseScore !== null && variantScore !== null ? variantScore - baseScore : null,
        tokensDelta: mean(variantRuns.map((c) => c.tokens)) - baseTokens,
        costDelta: mean(variantRuns.map((c) => c.costUsd)) - baseCost,
      });
    }
  }
  rows.sort(
    (a, b) => a.testId.localeCompare(b.testId) || a.variantLabel.localeCompare(b.variantLabel),
  );
  return rows;
}

/** The endpoint entry point: collect the attributed children from the repos, then roll up the deltas. */
export function buildSuiteDeltas(
  runs: RunRepository,
  grades: GradeRepository,
  variants: readonly SuiteVariant[],
  runIds: readonly string[],
  baseLabel: string,
): SuiteDeltaRow[] {
  if (variants.length === 0) return []; // not a skill-effect suite — no variant axis, honest empty
  return computeSuiteDeltas(collectDeltaChildren(runs, grades, variants, runIds), baseLabel);
}

/** Mean of the graded scores in the group (nulls excluded); null when NONE was graded (never 0). */
function meanScoreOf(items: readonly DeltaChildRun[]): number | null {
  const scores = items.map((c) => c.score).filter((score): score is number => score !== null);
  return scores.length > 0 ? mean(scores) : null;
}
