import type { GraderId } from "@mcp-token-footprint/shared";
import {
  RadarArea,
  RadarChart,
  RadarGrid,
  RadarLabels,
  Ring,
  RingCenter,
  RingChart,
} from "@brand/charts";
import { formatGradePercent, SCORE_TONE_CHART_COLOR, scoreTone } from "./grade-format";

/**
 * The Report tab's two score visuals (owner feedback 2026-07-12), kept in their OWN module so the
 * `@brand/charts` (visx) bundle stays out of any jsdom test that imports `ReportTab`/`RunConsole` —
 * the same convention `ContextChart`/`SuiteScatter` follow (tests stub this module). Both are pure
 * presentation; every fill is a chart-token reference via {@link SCORE_TONE_CHART_COLOR} (never a raw
 * color), so both themes read correctly.
 */

/** One radar axis: a graded dimension's short label + its normalized 0–1 score. */
export type RadarAxisScore = { key: GraderId; label: string; score: number };

/**
 * A compact score donut (the dead space right of a detail card's quotes): one `@brand/charts` ring at
 * the score's percent, filled with the {@link scoreTone} threshold color, percent as the center
 * label. Sits RIGHT of a detail card's text (the cards stack it below on narrow widths via their own
 * `sm:flex-row`).
 */
export function ScoreDonut({ score, label }: { score: number; label: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, score)) * 100);
  const color = SCORE_TONE_CHART_COLOR[scoreTone(score)];
  return (
    <div className="mx-auto shrink-0 self-center sm:mx-0">
      <RingChart
        data={[{ label, value: pct, maxValue: 100, color }]}
        size={112}
        strokeWidth={10}
        baseInnerRadius={40}
        accessibleLabel={`${label} score`}
        accessibleDescription={`${pct}%`}
      >
        <Ring index={0} />
        <RingCenter defaultLabel={label} suffix="%" valueClassName="tabular-nums" />
      </RingChart>
    </div>
  );
}

/**
 * The graded-dimensions radar on the "Run rating" summary card (one series, values normalized
 * 0–100). The series color follows the {@link scoreTone} threshold of the MEAN score. The CALLER
 * gates on ≥3 axes (fewer can't draw a polygon).
 */
export function ScoreRadar({ axes }: { axes: RadarAxisScore[] }) {
  const mean = axes.reduce((sum, axis) => sum + axis.score, 0) / axes.length;
  const color = SCORE_TONE_CHART_COLOR[scoreTone(mean)];
  const values = Object.fromEntries(
    axes.map((axis) => [axis.key, Math.round(Math.max(0, Math.min(1, axis.score)) * 100)]),
  );
  return (
    <div className="mx-auto shrink-0 lg:mx-0">
      <RadarChart
        data={[{ label: "This run", color, values }]}
        metrics={axes.map((axis) => ({ key: axis.key, label: axis.label }))}
        size={224}
        levels={4}
        margin={44}
        accessibleLabel="Graded dimensions"
        accessibleDescription={axes
          .map((axis) => `${axis.label} ${formatGradePercent(axis.score)}`)
          .join(", ")}
      >
        <RadarGrid showLabels={false} />
        <RadarLabels />
        <RadarArea index={0} />
      </RadarChart>
    </div>
  );
}
