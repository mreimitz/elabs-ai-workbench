import type {
  RunOutcome,
  RunStatus,
  RunSummary,
  SuiteAggregates,
  SuiteAnalytics,
  SuiteRun,
} from "@mcp-token-footprint/shared";
import { DELTA_CELL_WASH, DELTA_TEXT_TONE } from "../../../../lib/delta";
import { getSuiteAnalytics, getSuiteRun } from "../../../../lib/api";
import { letterForIndex, runColor, type CompareData } from "../compare-runs";

/**
 * Suite-compare domain (WP 4.6, audit §G13.6 / §T9c) — suite-vs-suite comparison. Kept JSX-free +
 * self-contained (its own types + fetch) so the mode file stays a thin renderer and the pure
 * derivation is unit-testable without React. It deliberately owns ALL of the suite data plumbing so
 * it never collides with the run-compare domain (`compare-runs.ts`, owned elsewhere this round).
 *
 * DATA SOURCES (no API change — confirmed web-only):
 *   • `GET /api/suite-runs/:id`           → the {@link SuiteRun} + cached {@link SuiteAggregates}
 *                                            (pass rate, mean grade, exec cost) — the verdict strip.
 *   • `GET /api/suite-runs/:id/analytics` → the per-(test × environment) `meanScore` (the grade axis
 *                                            of each grid cell), repetitions averaged.
 *   • the already-loaded {@link CompareData.runs} (`GET /api/runs`) → every MEMBER run of a suite run
 *                                            (filtered by `run.suiteRunId`), carrying each member's
 *                                            terminal status/outcome, tokens and cost — the source of
 *                                            the errored-cell signal and the drill-through run ids.
 *
 * The two suite runs take the workspace's LETTER identity: `suiteRunIds[0]` → Ⓐ (baseline), `[1]` → Ⓑ
 * (comparison). Every Δ is comparison − baseline.
 */

// ── Delta tone (the ONE delta convention — lib/delta.ts, D-IC3/D-UX9) ─────────────────────────────────

/** A cell/metric's diff verdict. `error` forces a red cell regardless of the numbers (§G13.6). */
export type SuiteDeltaTone = "better" | "worse" | "neutral" | "error";

/** Whether a metric improves when it goes UP (grade, pass rate) or DOWN (cost, tokens). */
export type MetricDirection = "higher-better" | "lower-better";

/** Tone a signed Δ per its direction; a zero (tie) is neutral — NO "better/worse" judgement on a tie. */
export function toneForDelta(delta: number | null, direction: MetricDirection): SuiteDeltaTone {
  if (delta == null || delta === 0) return "neutral";
  const improved = direction === "higher-better" ? delta > 0 : delta < 0;
  return improved ? "better" : "worse";
}

/** tone → semantic foreground class. The better/worse/neutral tones come from the ONE delta authority
 *  (`lib/delta.ts`) — a WORSE magnitude is amber, not red — so the suite matrix matches Scans + the
 *  run-compare matrix exactly. `error` is a STRUCTURAL failure signal (a member run errored), not a
 *  magnitude, so it keeps `--destructive` (D-UX9's diff-semantics axis). Reads in both themes. */
export const SUITE_TONE_TEXT: Record<SuiteDeltaTone, string> = {
  ...DELTA_TEXT_TONE,
  error: "text-destructive",
};

/** tone → semantic cell wash (the green/amber grid cells; alpha washes are AA-checked upstream). The
 *  magnitude washes come from the shared authority; the `error` wash stays red (structural failure). */
export const SUITE_TONE_CELL: Record<SuiteDeltaTone, string> = {
  ...DELTA_CELL_WASH,
  error: "bg-destructive/15 hover:bg-destructive/25",
};

// ── One suite run, resolved for the comparison ──────────────────────────────────────────────────────

/** A single suite run resolved to everything the compare renders about it. */
export type SuiteCompareSide = {
  id: string;
  /** Comparison index (0 = baseline Ⓐ, 1 = comparison Ⓑ). */
  index: number;
  /** Display letter (A / B). */
  letter: string;
  /** Series colour token (`var(--chart-N)`), shared with the run workspace. */
  color: string;
  isBaseline: boolean;
  suiteRun: SuiteRun;
  aggregates: SuiteAggregates | null;
  /** Member runs of this suite run (from {@link CompareData.runs}), in feed order. */
  memberRuns: RunSummary[];
  /** Per-subject (`testId|scenarioId`) mean grade from the suite's analytics scatter (0..1). */
  gradeBySubject: Map<string, number>;
};

/** The resolved suite comparison: baseline (Ⓐ) vs comparison (Ⓑ), plus the reference catalogues. */
export type SuiteCompareData = {
  baseline: SuiteCompareSide;
  comparison: SuiteCompareSide;
  data: CompareData;
};

export function subjectKey(testId: string, scenarioId: string): string {
  return `${testId}|${scenarioId}`;
}

/** Fetch one suite run's snapshot + analytics + resolve its member runs from the already-loaded runs. */
async function loadSuiteSide(
  id: string,
  index: number,
  data: CompareData,
): Promise<SuiteCompareSide> {
  const [suiteRun, analytics] = await Promise.all([
    getSuiteRun(id),
    // Analytics are honestly empty (no grades) rather than an error — a fetch failure still shouldn't
    // sink the whole compare, so degrade to no grades (the cells then compare on cost only).
    getSuiteAnalytics(id).catch(() => ({ scatter: [], breakdowns: [] }) as SuiteAnalytics),
  ]);
  const gradeBySubject = new Map<string, number>();
  for (const point of analytics.scatter) {
    if (point.meanScore != null)
      gradeBySubject.set(subjectKey(point.testId, point.scenarioId), point.meanScore);
  }
  const memberRuns = data.runs.filter((run) => run.suiteRunId === id);
  return {
    id,
    index,
    letter: letterForIndex(index),
    color: runColor(index),
    isBaseline: index === 0,
    suiteRun,
    aggregates: suiteRun.aggregates ?? null,
    memberRuns,
    gradeBySubject,
  };
}

/** Load both suite runs (baseline = `suiteRunIds[0]`, comparison = `[1]`) for the comparison. */
export async function loadSuiteCompare(
  suiteRunIds: string[],
  data: CompareData,
): Promise<SuiteCompareData> {
  const [baselineId, comparisonId] = suiteRunIds;
  if (!baselineId || !comparisonId) {
    throw new Error("Suite compare needs exactly two suite runs.");
  }
  const [baseline, comparison] = await Promise.all([
    loadSuiteSide(baselineId, 0, data),
    loadSuiteSide(comparisonId, 1, data),
  ]);
  return { baseline, comparison, data };
}

// ── Verdict strip (pass rate · mean grade · exec cost deltas) ────────────────────────────────────────

/** One headline metric on the verdict strip: baseline vs comparison + the toned Δ. */
export type SuiteVerdictMetric = {
  key: "passRate" | "meanGrade" | "execCost" | "totalTokens";
  label: string;
  /** Formatted baseline (Ⓐ) value, or "—" when unavailable. */
  baseText: string;
  /** Formatted comparison (Ⓑ) value, or "—". */
  comparisonText: string;
  /** Formatted signed Δ (comparison − baseline), or null when either side is unavailable. */
  deltaText: string | null;
  tone: SuiteDeltaTone;
};

const MINUS = "−";

function signed(value: number, format: (v: number) => string): string {
  const sign = value > 0 ? "+" : value < 0 ? MINUS : "";
  return `${sign}${format(Math.abs(value))}`;
}

function percentText(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

function gradeText(score: number): string {
  return score.toFixed(2);
}

export function costText(usd: number): string {
  return `$${usd.toFixed(usd !== 0 && Math.abs(usd) < 0.01 ? 4 : 2)}`;
}

function tokenText(tokens: number): string {
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : `${Math.round(tokens)}`;
}

/**
 * Derive the four verdict-strip metrics from the two suite runs' cached aggregates. A metric whose
 * value is null on EITHER side (e.g. no grades yet → `meanGrade`/`passRate` null) yields no Δ (null),
 * so the strip shows the honest gap instead of a fake number.
 */
export function deriveSuiteVerdict(compare: SuiteCompareData): SuiteVerdictMetric[] {
  const a = compare.baseline.aggregates;
  const b = compare.comparison.aggregates;

  const metric = (
    key: SuiteVerdictMetric["key"],
    label: string,
    baseValue: number | null,
    compValue: number | null,
    format: (v: number) => string,
    direction: MetricDirection,
  ): SuiteVerdictMetric => {
    const delta = baseValue != null && compValue != null ? compValue - baseValue : null;
    return {
      key,
      label,
      baseText: baseValue != null ? format(baseValue) : "—",
      comparisonText: compValue != null ? format(compValue) : "—",
      deltaText: delta != null ? signed(delta, format) : null,
      tone: toneForDelta(delta, direction),
    };
  };

  return [
    metric(
      "passRate",
      "Pass rate",
      a?.passRateAt05 ?? null,
      b?.passRateAt05 ?? null,
      percentText,
      "higher-better",
    ),
    metric(
      "meanGrade",
      "Mean grade",
      a?.meanGrade ?? null,
      b?.meanGrade ?? null,
      gradeText,
      "higher-better",
    ),
    metric(
      "execCost",
      "Exec cost",
      a?.execCostUsd ?? null,
      b?.execCostUsd ?? null,
      costText,
      "lower-better",
    ),
    metric(
      "totalTokens",
      "Total tokens",
      a?.totalTokens ?? null,
      b?.totalTokens ?? null,
      tokenText,
      "lower-better",
    ),
  ];
}

// ── The test × environment grid ──────────────────────────────────────────────────────────────────────

/** One suite run's aggregate for a single (test × environment) subject. */
export type SuiteCellSide = {
  runIds: string[];
  /** The run to drill into — an errored member when present (so the drill lands on the failure). */
  representativeRunId: string | null;
  /** Any member run ended abnormally (error/aborted/stopped or a non-completed outcome). */
  errored: boolean;
  /** The representative member's terminal status/outcome value for a {@link StatusBadge}. */
  statusValue: string;
  meanCostUsd: number | null;
  grade: number | null;
};

/** One grid cell: baseline vs comparison for a (test × environment) subject + the derived deltas. */
export type SuiteGridCell = {
  testId: string;
  scenarioId: string;
  base: SuiteCellSide | null;
  comparison: SuiteCellSide | null;
  /** Δ grade (comparison − baseline), null when either side lacks a grade. */
  gradeDelta: number | null;
  /** Δ exec cost (comparison − baseline), null when either side has no cost. */
  costDelta: number | null;
  tone: SuiteDeltaTone;
  /** Both sides resolve to a member run → the cell drills into their side-by-side compare. */
  drillable: boolean;
};

/** The full grid: test rows × environment columns, cells keyed `testId|scenarioId`. */
export type SuiteGrid = {
  /** Ordered test-id rows (union across both suite runs). */
  testIds: string[];
  /** Ordered environment (scenario) id columns (union across both suite runs). */
  scenarioIds: string[];
  cells: Map<string, SuiteGridCell>;
};

/** A member run ended abnormally (its cell is a red cell). Mirrors the run-compare `isAbnormal` rule. */
export function isErroredMember(status: RunStatus, outcome: RunOutcome | undefined): boolean {
  if (status === "error" || status === "aborted" || status === "stopped") return true;
  if (outcome && outcome !== "completed" && outcome !== "assertions_failed") return true;
  return false;
}

/** Roll a suite run's member runs for one subject into a {@link SuiteCellSide}. Null when none exist. */
function buildCellSide(
  side: SuiteCompareSide,
  testId: string,
  scenarioId: string,
): SuiteCellSide | null {
  const members = side.memberRuns.filter(
    (run) => run.testId === testId && run.scenarioId === scenarioId,
  );
  if (members.length === 0) return null;
  const errored = members.some((run) => isErroredMember(run.status, run.outcome));
  // Drill into an errored member first (surfaces the failure), else the lowest-repetition run.
  const erroredMember = members.find((run) => isErroredMember(run.status, run.outcome));
  const ordered = [...members].sort((a, b) => (a.repetition ?? 0) - (b.repetition ?? 0));
  const representative = erroredMember ?? ordered[0] ?? null;
  const costs = members.map((run) => run.costUsd).filter((c) => Number.isFinite(c));
  return {
    runIds: ordered.map((run) => run.id),
    representativeRunId: representative?.id ?? null,
    errored,
    statusValue: representative?.outcome ?? representative?.status ?? "",
    meanCostUsd: costs.length > 0 ? costs.reduce((sum, c) => sum + c, 0) / costs.length : null,
    grade: side.gradeBySubject.get(subjectKey(testId, scenarioId)) ?? null,
  };
}

/**
 * Build the test × environment grid from the two suite runs' member runs + per-subject grades. Rows are
 * the union of tests, columns the union of environments, both ordered by their catalogue name (falling
 * back to id) so the matrix reads stably. A cell's tone: an errored member on EITHER side → `error`
 * (red); else the grade Δ decides (higher-better); with no grade on both sides it falls back to the
 * cost Δ (lower-better); a genuine tie stays neutral (NO ✓ on a tie).
 */
export function buildSuiteGrid(compare: SuiteCompareData): SuiteGrid {
  const { baseline, comparison, data } = compare;
  const allMembers = [...baseline.memberRuns, ...comparison.memberRuns];

  const testIds = uniqueSortedByName(
    allMembers.map((run) => run.testId),
    (id) => data.testsById.get(id)?.name ?? id,
  );
  const scenarioIds = uniqueSortedByName(
    allMembers.map((run) => run.scenarioId),
    (id) => data.scenariosById.get(id)?.name ?? id,
  );

  const cells = new Map<string, SuiteGridCell>();
  for (const testId of testIds) {
    for (const scenarioId of scenarioIds) {
      const base = buildCellSide(baseline, testId, scenarioId);
      const comp = buildCellSide(comparison, testId, scenarioId);
      if (!base && !comp) continue; // subject present in neither → no cell (rendered as "—")

      const gradeDelta =
        base?.grade != null && comp?.grade != null ? comp.grade - base.grade : null;
      const costDelta =
        base?.meanCostUsd != null && comp?.meanCostUsd != null
          ? comp.meanCostUsd - base.meanCostUsd
          : null;

      let tone: SuiteDeltaTone;
      if (base?.errored || comp?.errored) tone = "error";
      else if (gradeDelta != null) tone = toneForDelta(gradeDelta, "higher-better");
      else tone = toneForDelta(costDelta, "lower-better");

      cells.set(subjectKey(testId, scenarioId), {
        testId,
        scenarioId,
        base,
        comparison: comp,
        gradeDelta,
        costDelta,
        tone,
        drillable: Boolean(base?.representativeRunId && comp?.representativeRunId),
      });
    }
  }

  return { testIds, scenarioIds, cells };
}

/** Dedupe ids, then order by their display name (case-insensitive), falling back to the id. */
function uniqueSortedByName(ids: string[], nameOf: (id: string) => string): string[] {
  const unique = [...new Set(ids)];
  return unique.sort((a, b) =>
    nameOf(a).localeCompare(nameOf(b), undefined, { sensitivity: "base" }),
  );
}

// ── Signed Δ text for the grid cells (real minus, tabular-friendly) ──────────────────────────────────

export function signedGradeText(delta: number): string {
  return signed(delta, (v) => v.toFixed(2));
}

export function signedCostText(delta: number): string {
  return signed(delta, costText);
}

// ── Client-side export (self-contained; the same affordance as the run workspace) ────────────────────

/**
 * Compose a self-contained Markdown summary of the suite comparison — the verdict metrics + the full
 * test × environment grid (grade Δ / cost Δ per cell, an errored cell flagged). Purely client-side (no
 * export endpoint dependency), so the download works from the seam alone.
 */
export function buildSuiteCompareMarkdown(compare: SuiteCompareData): string {
  const { baseline, comparison, data } = compare;
  const verdict = deriveSuiteVerdict(compare);
  const grid = buildSuiteGrid(compare);
  const nameFor = (id: string) => data.scenariosById.get(id)?.name ?? id;
  const testName = (id: string) => data.testsById.get(id)?.name ?? id;

  const lines: string[] = [];
  lines.push("# Suite comparison");
  lines.push("");
  lines.push(`- **A (baseline):** suite run \`${baseline.id}\` — ${baseline.suiteRun.status}`);
  lines.push(
    `- **B (comparison):** suite run \`${comparison.id}\` — ${comparison.suiteRun.status}`,
  );
  lines.push("");
  lines.push("## Verdict");
  lines.push("");
  lines.push("| Metric | A | B | Δ |");
  lines.push("| --- | --- | --- | --- |");
  for (const m of verdict) {
    lines.push(`| ${m.label} | ${m.baseText} | ${m.comparisonText} | ${m.deltaText ?? "—"} |`);
  }
  lines.push("");
  lines.push("## Test × environment");
  lines.push("");
  const header = ["Test", ...grid.scenarioIds.map(nameFor)];
  lines.push(`| ${header.join(" | ")} |`);
  lines.push(`| ${header.map(() => "---").join(" | ")} |`);
  for (const testId of grid.testIds) {
    const row = [testName(testId)];
    for (const scenarioId of grid.scenarioIds) {
      const cell = grid.cells.get(subjectKey(testId, scenarioId));
      row.push(cell ? cellSummaryText(cell) : "—");
    }
    lines.push(`| ${row.join(" | ")} |`);
  }
  lines.push("");
  return lines.join("\n");
}

function cellSummaryText(cell: SuiteGridCell): string {
  if (cell.tone === "error") return "⚠ error";
  const parts: string[] = [];
  if (cell.gradeDelta != null) parts.push(`grade ${signedGradeText(cell.gradeDelta)}`);
  if (cell.costDelta != null) parts.push(`cost ${signedCostText(cell.costDelta)}`);
  return parts.length > 0 ? parts.join(", ") : "no change";
}
