import type { SuiteAggregates } from "@mcp-token-footprint/shared";
import { MetricCard } from "@brand/ui";
import { Coins, Gauge, Gavel, Hash, LayoutGrid, MessageCircleQuestion, Target } from "lucide-react";
import { formatCostUsd, formatNumber, formatPercent } from "../../../lib/format";
import { formatGradePercent } from "../grade-format";

/**
 * Suite-run KPI rail — the suite-scope analogue of `../KpiRail.tsx`, a compact band of `MetricCard`s
 * rolling up the whole matrix. Tiles: Progress (cells done / total), Mean grade ± spread, Pass rate
 * @0.5, Tokens, and — the B9 requirement — **exec cost + judge cost side by side**. Every figure is
 * `tabular-nums` so digits line up (interaction-guidelines). Values come from the latest streamed
 * `aggregates` snapshot (falling back to the persisted suite-run snapshot before the first tick), so
 * the rail is never blank once a run exists.
 */
export type SuiteKpiRailProps = {
  /** Latest rolled-up aggregates, or `null` before any snapshot (renders dashes, never blank cards). */
  aggregates: SuiteAggregates | null;
  /** The aggregate soft-stop cost cap (USD), shown as context on the exec-cost tile when set. */
  costCapUsd?: number;
  /**
   * Qlik Answers (WP 3.2, D-QA5) — the suite's questions-consumed total, rolled up by the caller
   * (`SuiteRunConsole`) from the member runs' provider KIND (never a new wire field — see that
   * component's derivation comment). `null` when the suite has no `qlik_answers` environment at all,
   * which hides the tile entirely rather than showing a misleading "0 questions" for an all-LLM suite.
   */
  answersQuestions?: number | null;
};

// A grade fraction (0–1) rendered as a PERCENT via the single formatter (`formatGradePercent`), so
// the KPI rail agrees with the matrix/deltas/table beneath it — the critique's "0.10 in the KPI and
// 10% in the table" mismatch. `null` → an em dash.
function gradeText(value: number | null): string {
  return value === null ? "—" : formatGradePercent(value);
}

export function SuiteKpiRail({ aggregates, costCapUsd, answersQuestions }: SuiteKpiRailProps) {
  const cellsTotal = aggregates?.cellsTotal ?? 0;
  const cellsCompleted = aggregates?.cellsCompleted ?? 0;
  const progressPct = cellsTotal > 0 ? (cellsCompleted / cellsTotal) * 100 : 0;

  const meanGrade = aggregates?.meanGrade ?? null;
  const gradeStdDev = aggregates?.gradeStdDev ?? null;
  const passRate = aggregates?.passRateAt05 ?? null;
  const totalTokens = aggregates?.totalTokens ?? 0;
  const execCostUsd = aggregates?.execCostUsd ?? 0;
  const judgeCostUsd = aggregates?.judgeCostUsd ?? 0;

  const spreadText = gradeStdDev !== null ? ` ± ${formatGradePercent(gradeStdDev)}` : "";

  return (
    <section aria-label="Suite run KPIs">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <MetricCard
          className="min-w-0"
          emphasis="headline"
          icon={<LayoutGrid aria-hidden />}
          label="Progress"
          value={
            <span className="tabular-nums">
              {formatNumber(cellsCompleted)} / {formatNumber(cellsTotal)}
            </span>
          }
          description={<span className="tabular-nums">{formatPercent(progressPct)} of cells</span>}
        />
        <MetricCard
          className="min-w-0"
          icon={<Gauge aria-hidden />}
          label="Mean grade"
          value={
            <span className="tabular-nums">
              {gradeText(meanGrade)}
              {spreadText}
            </span>
          }
          description="mean grade · ± spread"
        />
        <MetricCard
          className="min-w-0"
          icon={<Target aria-hidden />}
          label="Pass rate"
          value={
            <span className="tabular-nums">
              {passRate === null ? "—" : formatPercent(passRate * 100)}
            </span>
          }
          description="graded ≥ 0.5"
        />
        <MetricCard
          className="min-w-0"
          icon={<Hash aria-hidden />}
          label="Tokens"
          value={<span className="tabular-nums">{formatNumber(totalTokens)}</span>}
          description="across the matrix"
        />
        <MetricCard
          className="min-w-0"
          icon={<Coins aria-hidden />}
          label="Exec cost"
          value={<span className="tabular-nums">{formatCostUsd(execCostUsd)}</span>}
          description={
            costCapUsd ? (
              <span className="tabular-nums">of {formatCostUsd(costCapUsd)} cap</span>
            ) : (
              "run spend"
            )
          }
        />
        <MetricCard
          className="min-w-0"
          icon={<Gavel aria-hidden />}
          label="Judge cost"
          value={<span className="tabular-nums">{formatCostUsd(judgeCostUsd)}</span>}
          description="grader spend"
        />
        {/* Qlik Answers (WP 3.2, D-QA5) — only shown when the suite has at least one qlik_answers
            environment; hidden (not "0 questions") for an all-LLM suite. */}
        {answersQuestions !== null && answersQuestions !== undefined ? (
          <MetricCard
            className="min-w-0"
            icon={<MessageCircleQuestion aria-hidden />}
            label="Questions"
            value={<span className="tabular-nums">{formatNumber(answersQuestions)}</span>}
            description="Qlik Answers · shared monthly quota"
          />
        ) : null}
      </div>
    </section>
  );
}
