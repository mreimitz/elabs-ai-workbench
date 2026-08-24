// Pure comparison math for the Compare Workspace Summary mode (audit §H3 / §G13.2–4). Split out of
// the React mode file (like `analytics-derive.ts`) so the baseline-Δ math, the honest metric
// selection, the token-slice verdict decomposition, and the context-curve Date-x invariant are all
// unit tested WITHOUT rendering `@elabs-ai/components-charts`. No chart/React imports — node-testable.
//
// This module ABSORBS the reusable delta/context-curve logic from the deleted `compare-derive.ts`
// (radar removed per D-UX10) and `compare-curve.ts`: per-run metric rollups (peak-context %,
// per-turn normalization, tool-error counts) and the "x MUST be a Date" curve invariant that keeps
// `LineChart` from crashing on a string x (project MEMORY: LineChart/AreaChart x must be Dates).

import type {
  ContextSegment,
  ContextSnapshot,
  CostBasis,
  RunGrade,
  RunStep,
  TokenUsageActual,
} from "@mcp-token-footprint/shared";
import { CONTEXT_SEGMENTS, cacheHitRate } from "@mcp-token-footprint/shared";
import { fillSeriesGaps } from "../../../lib/chart-series";
import { countToolErrors, peakContextSnapshot, runDurationMs } from "../analytics-derive";
import type { CompareVerdict, CompareVerdictReason, WorkspaceRun } from "./compare-runs";
import { makeFocusToken } from "./flow/flow-types";

// ── Per-run resolved metrics ──────────────────────────────────────────────────────────────────────

/** Everything the Summary matrix / delta bars / curves read about one run, joined from its summary
 * (`WorkspaceRun.run`) plus its fetched detail steps (context snapshots, tool errors, wall-clock). */
export type SummaryRun = {
  id: string;
  index: number;
  letter: string;
  color: string;
  isBaseline: boolean;
  scenarioName: string;
  model: string;
  /** ISO start timestamp — optional (older callers/fixtures may omit it) — backs the compare-redesign
   *  §3.3.4 legend disambiguation (`ContextCurves`) when two runs share the same environment name. */
  startedAt?: string;
  statusLabel: string;
  status: WorkspaceRun["run"]["status"];
  outcome: WorkspaceRun["run"]["outcome"];
  /** Terminal outcome that isn't a clean completion — drives the row warning icon + verdict gating. */
  abnormal: boolean;
  turns: number;
  toolCalls: number;
  /** Errored tool steps (0 when the run detail wasn't available yet). */
  toolErrors: number;
  tokensIn: number;
  tokensOut: number;
  totalTokens: number;
  /**
   * RM-33 WP 3.2 — the prompt-cache composition of `tokensIn`, which stays GROSS (D-CT1). Compare had
   * NO cached row anywhere before this: two runs could differ by 900k tokens and 4x in cost with
   * nothing on the page to connect the two. `null` when the run cannot answer (a pre-migration-59 run,
   * or one whose turns only ever reported a merged figure) — never a fabricated 0 (D-CT6).
   */
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  /** Cache-read share of gross input, 0–1. `null` when the split is unknown — never 0 (D-CT6). */
  cacheHitRate: number | null;
  costUsd: number;
  /**
   * Claude subscription (WP 3.1, D-CS4/D-CS8) — HOW `costUsd` was derived. `"subscription_reference"`
   * marks a shadow price (exact tokens × list rate; marginal cost $0) so the Δ-matrix cost cell reads
   * "est. · subscription". Absent for every ordinary API-metered run.
   */
  costBasis?: CostBasis;
  durationMs: number | null;
  peakContextTokens: number;
  /** Model context window (0 when unknown) — from the run's context snapshots. */
  contextLimit: number;
  /** `peakContextTokens / contextLimit * 100`, or null when no window is known (honest fallback). */
  peakContextPercent: number | null;
  /** The peak snapshot's per-segment composition (the token-slice source for the H3 verdict). Zeroed
   * when no snapshot exists yet. */
  peakSegments: Record<ContextSegment, number>;
  /** Per-turn context totals, in turn order (drives the context-window curves). */
  contextTotals: number[];
  /** Mean graded score across this run's graders (0–1, higher better), or null when ungraded. */
  qualityScore: number | null;
};

const ZERO_SEGMENTS: Record<ContextSegment, number> = CONTEXT_SEGMENTS.reduce(
  (acc, seg) => ({ ...acc, [seg]: 0 }),
  {} as Record<ContextSegment, number>,
);

/** True for any terminal state that isn't a clean completion (abort/error/overflow/guardrail/etc). */
export function isAbnormal(
  status: WorkspaceRun["run"]["status"],
  outcome: WorkspaceRun["run"]["outcome"],
): boolean {
  if (status === "error" || status === "aborted" || status === "stopped") return true;
  if (outcome && outcome !== "completed") return true;
  return false;
}

/** Mean of the graded (status graded, non-null score) grades for a run — null when none are graded. */
export function meanQuality(grades: RunGrade[] | undefined): number | null {
  if (!grades) return null;
  const scored = grades.filter((g) => g.status === "graded" && g.score != null);
  if (scored.length === 0) return null;
  return scored.reduce((sum, g) => sum + (g.score ?? 0), 0) / scored.length;
}

/** The per-turn context totals from the run's settled `llm_response` snapshots, in turn order. */
function contextTotalsOf(steps: RunStep[]): number[] {
  return steps
    .filter((s) => s.type === "llm_response" && s.context != null)
    .map((s) => (s.context as ContextSnapshot).total);
}

/**
 * RM-33 — a run summary projected into the `TokenUsageActual` shape the shared cache helpers read, so
 * no surface re-derives "how much of this was cache" for itself.
 *
 * `undefined` when `cachedTokens` never reached the wire — the same rule the runs feed uses
 * (`RunTableRow`). That distinction is the whole point: at the RECORD level an absent cache slice
 * means the provider reported none, but at the RUN level it means the migration-59 columns are NULL,
 * i.e. UNKNOWABLE. Feeding that straight into `cacheHitRate` would come back `0` — "caching did
 * nothing" — about a run that may have been almost entirely served from cache.
 */
export function runSummaryUsage(summary: WorkspaceRun["run"]): TokenUsageActual | undefined {
  if (summary.cachedTokens === undefined) return undefined;
  return {
    inputTokens: summary.tokensIn,
    outputTokens: summary.tokensOut,
    cachedInputTokens: summary.cachedTokens,
    ...(summary.cacheReadTokens === undefined ? {} : { cacheReadTokens: summary.cacheReadTokens }),
    ...(summary.cacheWriteTokens === undefined
      ? {}
      : { cacheWriteTokens: summary.cacheWriteTokens }),
  };
}

/** The run's cache-read share, or `null` when the run cannot answer (never a 0 that means "unknown"). */
export function runCacheHitRate(summary: WorkspaceRun["run"]): number | null {
  const usage = runSummaryUsage(summary);
  return usage ? cacheHitRate(usage) : null;
}

/** The model context window for the run (first snapshot carrying a positive limit), or 0. */
function contextLimitOf(steps: RunStep[]): number {
  for (const s of steps) {
    if (s.context && s.context.limit > 0) return s.context.limit;
  }
  return 0;
}

/** Join one workspace run to its (optional) fetched steps and compute every derived Summary metric. */
export function buildSummaryRun(
  run: WorkspaceRun,
  steps: RunStep[] | undefined,
  grades: RunGrade[] | undefined,
): SummaryRun {
  const summary = run.run;
  const totalTokens = summary.tokensIn + summary.tokensOut;
  const stepList = steps ?? [];
  const peak = peakContextSnapshot(stepList);
  const contextLimit = contextLimitOf(stepList);
  // Prefer the summary's authoritative peakContextTokens; fall back to the peak snapshot total.
  const peakContextTokens = summary.peakContextTokens || peak?.total || 0;
  return {
    id: run.id,
    index: run.index,
    letter: run.letter,
    color: run.color,
    isBaseline: run.isBaseline,
    scenarioName: run.scenarioName,
    model: run.model,
    startedAt: summary.startedAt,
    statusLabel: run.statusLabel,
    status: summary.status,
    outcome: summary.outcome,
    abnormal: isAbnormal(summary.status, summary.outcome),
    turns: summary.turns,
    toolCalls: summary.toolCalls,
    toolErrors: countToolErrors(stepList),
    tokensIn: summary.tokensIn,
    tokensOut: summary.tokensOut,
    totalTokens,
    // RM-33 — straight off the run summary's migration-59 fields; `?? null` maps "the column was NULL"
    // to UNKNOWN rather than to a zero that would read as "this run cached nothing".
    cacheReadTokens: summary.cacheReadTokens ?? null,
    cacheWriteTokens: summary.cacheWriteTokens ?? null,
    cacheHitRate: runCacheHitRate(summary),
    costUsd: summary.costUsd,
    // Claude subscription (WP 3.1, D-CS4/D-CS8) — carry the run summary's cost basis (now populated by
    // the v29 data fix → toRunSummary → compareRuns) so the Δ-matrix cost cell can mark it "est.".
    ...(summary.costBasis ? { costBasis: summary.costBasis } : {}),
    durationMs: summary.durationMs ?? runDurationMs(stepList),
    peakContextTokens,
    contextLimit,
    peakContextPercent: contextLimit > 0 ? (peakContextTokens / contextLimit) * 100 : null,
    peakSegments: peak ? { ...ZERO_SEGMENTS, ...peak.segments } : { ...ZERO_SEGMENTS },
    contextTotals: contextTotalsOf(stepList),
    qualityScore: meanQuality(grades),
  };
}

/** Build the Summary run set from the workspace runs + (async-loaded) details/grades, letter order. */
export function buildSummaryRuns(
  runs: WorkspaceRun[],
  stepsById: Map<string, RunStep[]>,
  gradesById: Map<string, RunGrade[]>,
): SummaryRun[] {
  return runs.map((run) => buildSummaryRun(run, stepsById.get(run.id), gradesById.get(run.id)));
}

// ── Baseline-Δ math ─────────────────────────────────────────────────────────────────────────────

/** Which direction is "good" for a metric — decides the Δ colour (D-UX9: green better / red worse). */
export type MetricDirection = "lower-better" | "higher-better" | "neutral";

/** The tone a Δ cell renders: better (green) / worse (red) / neutral (tie or non-directional — NO ✓). */
export type DeltaTone = "better" | "worse" | "neutral";

/** Signed Δ% of `value` vs `baseline`. Null when a % is not expressible (baseline 0 and value ≠ 0). */
export function deltaPercent(value: number, baseline: number): number | null {
  if (baseline === value) return 0;
  if (baseline === 0) return null; // a % change from zero is undefined; the cell shows the raw Δ instead
  return ((value - baseline) / Math.abs(baseline)) * 100;
}

/** Map a signed delta to a tone given the metric direction. A zero (tie) is always neutral — no ✓. */
export function deltaTone(delta: number | null, direction: MetricDirection): DeltaTone {
  if (delta == null || delta === 0 || direction === "neutral") return "neutral";
  const better = direction === "lower-better" ? delta < 0 : delta > 0;
  return better ? "better" : "worse";
}

/** True when a metric carries no comparative information across the set (all equal, e.g. all $0.00) —
 *  the caller collapses it to a text line instead of drawing an empty/degenerate chart (T9e). */
export function isZeroInformation(values: Array<number | null>): boolean {
  const finite = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (finite.length === 0) return true;
  const first = finite[0]!;
  return finite.every((v) => v === first);
}

// ── Delta-bar panel (grouped horizontal, one row per metric) ────────────────────────────────────

/** One metric's row in the grouped delta-bar panel: each non-baseline run's Δ% vs the baseline. */
export type DeltaBarMetric = {
  key: string;
  label: string;
  direction: MetricDirection;
  baselineLabel: string;
  /** Human baseline value (formatted by the caller-injected formatter). */
  baselineText: string;
  bars: DeltaBar[];
  /** When true, every run ties (or only the baseline has data) — render one text line, not bars. */
  collapsed: boolean;
  /** The single-line summary shown when `collapsed` (e.g. "$0.00 for all runs — unpriced model"). */
  collapsedText: string;
};

export type DeltaBar = {
  runId: string;
  letter: string;
  color: string;
  /** Signed Δ% vs baseline (null when not expressible — then `valueText` carries the raw Δ). */
  deltaPercent: number | null;
  tone: DeltaTone;
  /** The run's own value, formatted (shown as the bar's value label). */
  valueText: string;
  /** The Δ label (e.g. "−54%" or "+2"), formatted by the caller. */
  deltaText: string;
};

/** A metric spec for the delta panel + matrix: how to read a value + how good higher/lower is. */
export type MetricAccessor = {
  key: string;
  label: string;
  direction: MetricDirection;
  /** Value for a run under the given mode (absolute vs per-turn); null when unavailable. */
  value: (run: SummaryRun, perTurn: boolean) => number | null;
  /** Whether the per-turn toggle changes this metric (accumulating metrics only). */
  perTurnAware: boolean;
  /** Format the raw value; injected so this module stays free of the app's Intl formatters. */
  format: (v: number) => string;
};

/** Format helpers the pure module needs, injected by the component (keeps this Intl-free). */
export type SummaryFormatters = {
  number: (v: number) => string;
  cost: (v: number) => string;
  duration: (v: number) => string;
  percent: (v: number) => string;
  /** Signed percentage for a Δ (e.g. -54 → "−54%"). */
  signedPercent: (v: number) => string;
  /** Signed integer for a raw Δ when a % is not expressible (e.g. +2). */
  signedNumber: (v: number) => string;
};

function perTurn(total: number, turns: number): number | null {
  return turns > 0 ? total / turns : null;
}

/** The canonical metric accessors, in delta-panel order (bound to the injected formatters). */
export function metricAccessors(fmt: SummaryFormatters): MetricAccessor[] {
  return [
    {
      key: "tokensIn",
      label: "Tokens in",
      direction: "lower-better",
      perTurnAware: true,
      value: (r, pt) => (pt ? perTurn(r.tokensIn, r.turns) : r.tokensIn),
      format: fmt.number,
    },
    {
      key: "tokensOut",
      label: "Tokens out",
      direction: "lower-better",
      perTurnAware: true,
      value: (r, pt) => (pt ? perTurn(r.tokensOut, r.turns) : r.tokensOut),
      format: fmt.number,
    },
    // RM-33 WP 3.2 — the cache composition, beside the gross token rows it decomposes.
    //
    // Read and write are separate metrics on purpose (D-CT2), and they point in OPPOSITE directions:
    // a cache read is billed at ~0.1x input, so more of it is better; a cache write is billed at
    // 1.25x — a premium — so more of it is worse. One merged "cached" row would have to pick a single
    // direction, and either choice would be wrong half the time.
    {
      key: "cacheRead",
      label: "Cache read",
      direction: "higher-better",
      perTurnAware: true,
      value: (r, pt) =>
        r.cacheReadTokens === null
          ? null
          : pt
            ? perTurn(r.cacheReadTokens, r.turns)
            : r.cacheReadTokens,
      format: fmt.number,
    },
    {
      key: "cacheWrite",
      label: "Cache write",
      direction: "lower-better",
      perTurnAware: true,
      value: (r, pt) =>
        r.cacheWriteTokens === null
          ? null
          : pt
            ? perTurn(r.cacheWriteTokens, r.turns)
            : r.cacheWriteTokens,
      format: fmt.number,
    },
    {
      // A ratio, so it is already per-turn-normalized — the toggle must not divide it a second time.
      key: "cacheHitRate",
      label: "Cache hit rate",
      direction: "higher-better",
      perTurnAware: false,
      value: (r) => (r.cacheHitRate === null ? null : r.cacheHitRate * 100),
      format: fmt.percent,
    },
    {
      key: "cost",
      label: "Cost",
      direction: "lower-better",
      perTurnAware: true,
      value: (r, pt) => (pt ? perTurn(r.costUsd, r.turns) : r.costUsd),
      format: fmt.cost,
    },
    {
      key: "duration",
      label: "Duration",
      direction: "lower-better",
      perTurnAware: false,
      value: (r) => r.durationMs,
      format: fmt.duration,
    },
    {
      key: "toolCalls",
      label: "Tool calls",
      direction: "lower-better",
      perTurnAware: true,
      value: (r, pt) => (pt ? perTurn(r.toolCalls, r.turns) : r.toolCalls),
      format: fmt.number,
    },
    {
      key: "peakContext",
      label: "Peak context",
      direction: "lower-better",
      perTurnAware: false,
      value: (r) => r.peakContextTokens,
      format: fmt.number,
    },
  ];
}

/** Build the grouped delta-bar rows: one metric per row, each non-baseline run's Δ% vs the baseline. */
export function deriveDeltaBars(
  runs: SummaryRun[],
  baseline: SummaryRun,
  perTurnMode: boolean,
  fmt: SummaryFormatters,
): DeltaBarMetric[] {
  const accessors = metricAccessors(fmt);
  return accessors.map((metric) => {
    const use = metric.perTurnAware && perTurnMode;
    const baselineValue = metric.value(baseline, use);
    const allValues = runs.map((r) => metric.value(r, use));
    const collapsed = isZeroInformation(allValues);
    const baselineText = baselineValue == null ? "—" : metric.format(baselineValue);

    const bars: DeltaBar[] = runs
      .filter((r) => !r.isBaseline)
      .map((r) => {
        const value = metric.value(r, use);
        const delta =
          value != null && baselineValue != null ? deltaPercent(value, baselineValue) : null;
        const rawDelta = value != null && baselineValue != null ? value - baselineValue : null;
        const deltaText =
          delta != null
            ? fmt.signedPercent(delta)
            : rawDelta != null && rawDelta !== 0
              ? fmt.signedNumber(rawDelta)
              : "±0";
        return {
          runId: r.id,
          letter: r.letter,
          color: r.color,
          deltaPercent: delta,
          tone: deltaTone(delta ?? rawDelta, metric.direction),
          valueText: value == null ? "—" : metric.format(value),
          deltaText,
        };
      });

    return {
      key: metric.key,
      label: metric.label + (use ? " / turn" : ""),
      direction: metric.direction,
      baselineLabel: baseline.letter,
      baselineText,
      bars,
      collapsed,
      // RM-33 (D-CT6) — "every run is the same" and "no run could answer" are different statements,
      // and before this the second rendered as the first ("— for all runs — no difference to
      // compare"), which reads as a measured tie. Say which one it is.
      collapsedText: collapsed
        ? allValues.every((v) => v == null)
          ? `${metric.label} is not measured for these runs — shown as unavailable rather than as a zero.`
          : `${baselineText} for all runs — no difference to compare${metric.key === "cost" && baselineValue === 0 ? " (unpriced model)" : ""}.`
        : "",
    };
  });
}

// ── Context-window curves (Date-x invariant preserved from compare-curve.ts) ────────────────────

/** One row of the curve chart: a synthetic Date x (REQUIRED — LineChart coerces x to a Date; a string
 *  x throws `RangeError: Invalid time value`) + each run's context total at that turn keyed by run id. */
export type CurveRow = { x: Date } & Record<string, number | Date>;

const CURVE_EPOCH = 0;
const CURVE_STEP_MS = 60_000;

/** Whether the context curves earn their space: only meaningful once a run has more than two turns
 *  (a 1–2 point line is noise; G13.4 gates the curves on >2 turns). */
export function shouldShowCurves(runs: SummaryRun[]): boolean {
  return runs.some((r) => r.contextTotals.length > 2);
}

/** The greatest known context window across the set (0 when none) — the model-limit reference line. */
export function curveLimit(runs: SummaryRun[]): number {
  return runs.reduce((max, r) => Math.max(max, r.contextLimit), 0);
}

/** Build the curve rows: one per turn index, each carrying a synthetic Date x + every run's context
 *  total (keyed by run id) at that turn. A shorter run contributes no point past its last turn. */
export function buildContextCurveRows(runs: SummaryRun[]): CurveRow[] {
  const maxLen = runs.reduce((max, r) => Math.max(max, r.contextTotals.length), 0);
  const rows: CurveRow[] = [];
  for (let turn = 0; turn < maxLen; turn += 1) {
    const row: CurveRow = { x: new Date(CURVE_EPOCH + turn * CURVE_STEP_MS) };
    for (const run of runs) {
      const value = run.contextTotals[turn];
      if (value !== undefined) row[run.id] = value;
    }
    rows.push(row);
  }
  // Runs end at different turns, so a shorter run leaves the tail of every longer run's row empty —
  // and an empty key is drawn at the TOP of the plot (see `lib/chart-series.ts`), i.e. the shortest
  // run reads as the one whose context exploded. Hold each curve flat at its final context instead:
  // the run stopped there, so its context stopped growing there.
  return fillSeriesGaps(
    rows,
    runs.map((run) => ({ key: run.id, fill: "hold" as const })),
  ) as CurveRow[];
}

// ── The verdict (H3) — differences WITH reasons ─────────────────────────────────────────────────

/** The top-N segment contributors to the context-token delta between two runs (for the H3 slice). */
function segmentDeltaReason(
  compared: SummaryRun,
  baseline: SummaryRun,
  fmt: SummaryFormatters,
): string | null {
  const deltas = CONTEXT_SEGMENTS.map((seg) => ({
    seg,
    delta: compared.peakSegments[seg] - baseline.peakSegments[seg],
  })).filter((d) => d.delta !== 0);
  if (deltas.length === 0) return null;
  const totalDelta = deltas.reduce((sum, d) => sum + d.delta, 0);
  if (totalDelta === 0) return null;
  const top = [...deltas].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 3);
  const parts = top.map((d) => `${fmt.signedNumber(d.delta)} ${SEGMENT_LABELS[d.seg]}`);
  return `${compared.letter} ${fmt.signedNumber(totalDelta)} peak context tokens vs ${baseline.letter}: ${parts.join(", ")}.`;
}

const SEGMENT_LABELS: Record<ContextSegment, string> = {
  system: "system",
  tool_defs: "tool definitions",
  history: "history",
  tool_results: "tool results",
  output: "output",
};

/**
 * The computed verdict (H3). Produces a positive recommendation ONLY when the set is cleanly
 * comparable — every run completed normally. When any run ended abnormally (aborted/error/overflow)
 * this returns `null` so the workspace's ⚠ comparability caveats lead instead of a fake winner
 * (acceptance: two aborted runs must NOT get a recommendation). The reasons decompose the token
 * delta by context slice + surface tool-behaviour differences (H3), rendered as sentences.
 */
export function deriveVerdict(runs: SummaryRun[], fmt: SummaryFormatters): CompareVerdict | null {
  if (runs.length < 2) return null;
  const baseline = runs.find((r) => r.isBaseline) ?? runs[0]!;
  const others = runs.filter((r) => r.id !== baseline.id);
  if (others.length === 0) return null;

  // Not cleanly comparable → no positive verdict; the caveats band leads with ⚠ (H3 / T9h).
  if (runs.some((r) => r.abnormal)) return null;

  // The "winner" among the non-baseline runs: fewest total tokens (ties broken by lower cost).
  const winner = [...others].sort(
    (a, b) => a.totalTokens - b.totalTokens || a.costUsd - b.costUsd,
  )[0]!;

  const tokenDelta = deltaPercent(winner.totalTokens, baseline.totalTokens);
  const durationDelta =
    winner.durationMs != null && baseline.durationMs != null && baseline.durationMs > 0
      ? deltaPercent(winner.durationMs, baseline.durationMs)
      : null;
  const costDelta = deltaPercent(winner.costUsd, baseline.costUsd);

  // Headline — the sentence the user came for. When the winner IS the baseline-beating run, recommend
  // it; when it's no better than the baseline, stay neutral.
  const metricPhrases: string[] = [];
  if (tokenDelta != null && tokenDelta !== 0)
    metricPhrases.push(`${fmt.signedPercent(tokenDelta)} tokens`);
  if (durationDelta != null && durationDelta !== 0)
    metricPhrases.push(`${fmt.signedPercent(durationDelta)} duration`);
  if (costDelta != null && costDelta !== 0)
    metricPhrases.push(`${fmt.signedPercent(costDelta)} cost`);
  else if (costDelta === 0) metricPhrases.push("equal cost");

  const improves = (tokenDelta ?? 0) < 0 || (durationDelta ?? 0) < 0 || (costDelta ?? 0) < 0;
  const regresses = (tokenDelta ?? 0) > 0 || (durationDelta ?? 0) > 0 || (costDelta ?? 0) > 0;
  const tone: CompareVerdict["tone"] = improves && !regresses ? "recommend" : "neutral";

  const same = winner.outcome === baseline.outcome;
  const headline =
    metricPhrases.length === 0
      ? `${winner.letter} and ${baseline.letter} completed with matching metrics — no meaningful difference.`
      : tone === "recommend"
        ? `${winner.letter} completed with the ${same ? "same outcome as" : "outcome of"} ${baseline.letter} at ${joinPhrases(metricPhrases)} — recommended.`
        : `${winner.letter} vs ${baseline.letter}: ${joinPhrases(metricPhrases)} — mixed, review before switching.`;

  // Reasons (capped at three in the band): token-slice decomposition + tool-behaviour differences.
  // Each reason that maps to a run carries a `focus` token so clicking it jumps to Flow mode with the
  // step drawer open at that run's preamble cell (the session-start block that carries the tool-def /
  // skill context these deltas decompose). The preamble is the finest-grained cell the Summary can
  // address without the Flow alignment model, and it is always present once ≥2 lanes render — so the
  // "reason → Flow" link (H3 level-1) always resolves. See CompareVerdictReason.focus.
  const winnerFocus = makeFocusToken(winner.letter, "pre");
  const reasons: CompareVerdictReason[] = [];
  const slice = segmentDeltaReason(winner, baseline, fmt);
  if (slice) reasons.push({ text: slice, focus: winnerFocus });

  const errDelta = winner.toolErrors - baseline.toolErrors;
  if (errDelta !== 0) {
    reasons.push({
      text:
        errDelta < 0
          ? `${winner.letter} hit ${Math.abs(errDelta)} fewer tool ${plural(Math.abs(errDelta), "error")} than ${baseline.letter}.`
          : `${winner.letter} hit ${errDelta} more tool ${plural(errDelta, "error")} than ${baseline.letter}.`,
      focus: winnerFocus,
    });
  }

  if (winner.qualityScore != null && baseline.qualityScore != null) {
    const qDelta = deltaPercent(winner.qualityScore * 100, baseline.qualityScore * 100);
    if (qDelta != null && Math.abs(qDelta) >= 1) {
      reasons.push({
        text: `Quality ${fmt.signedPercent(qDelta)} for ${winner.letter} vs ${baseline.letter}.`,
      });
    }
  }

  return { tone, headline, reasons: reasons.slice(0, 3) };
}

function joinPhrases(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

function plural(n: number, word: string): string {
  return n === 1 ? word : `${word}s`;
}
