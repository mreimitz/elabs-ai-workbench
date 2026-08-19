import { CheckCircle2 } from "lucide-react";
import { Sparkline } from "@elabs-ai/components-charts";
import { BentoGridItem, MetricCard, StatePanel } from "@elabs-ai/components-ui";
import { formatNumber, formatPercent } from "../../../../lib/format";
import type { RunHealthData, SectionEnvelope } from "../overview-contract";
import { isEmptySection } from "../overview-contract";

/**
 * Overview KPI (dashboard-bento WP 1.2) — how the fleet's runs are doing: pass rate, its Δ in
 * percentage POINTS, and the run cadence behind it.
 *
 * **The polarity is the opposite of every other tile on this bento.** For tokens and spend, growth
 * is the regression; for a pass rate a RISE is the win, so this tile passes
 * `positiveIsGood` **true**. Getting that backwards paints an improving fleet in the failure colour,
 * which is why it is asserted directly in the tests.
 *
 * Two honesty constraints:
 *
 * - `passRatePercent === null` means no run reached a terminal state in the window. The tile shows
 *   `n/a` with the run count beside it — never a fabricated 0%, which would read as "everything
 *   failed".
 * - The Δ is in percentage POINTS (the contract's own unit) and is labelled `pts`, so it can never
 *   be misread as a relative percentage change.
 *
 * The sparkline plots **runs per bucket**, the only series the contract carries for this section —
 * and its accessible label says so, because a series on a pass-rate tile that silently meant
 * something else would be worse than no series at all. It is shifted to the window minimum for the
 * same reason as `StartupCostTile` (`Sparkline` is zero-baselined and has no `min`), with the real
 * counts in the label.
 */
export function PassRateTile({ section }: { section: SectionEnvelope<RunHealthData> }) {
  if (isEmptySection(section)) return null;

  if (section.state === "error") {
    return (
      <BentoGridItem size="sm">
        <StatePanel
          kind="error"
          title="Run health unavailable"
          description={section.error ?? undefined}
        />
      </BentoGridItem>
    );
  }

  const data = section.data;
  const rate = data?.passRatePercent ?? null;
  const deltaPoints = data?.passRateDeltaPoints ?? null;
  const series = (data?.runsOverTime ?? []).map((point) => point.value);
  const floor = series.length > 0 ? Math.min(...series) : 0;
  const first = series[0] ?? 0;
  const last = series[series.length - 1] ?? 0;

  return (
    <BentoGridItem size="sm">
      <MetricCard
        className="h-full border-0 bg-transparent shadow-none"
        loading={section.state === "loading"}
        icon={<CheckCircle2 aria-hidden />}
        label="Pass rate"
        value={rate !== null ? formatPercent(rate) : "n/a"}
        description={
          data
            ? rate !== null
              ? `${formatNumber(data.runCount)} runs in this window`
              : `${formatNumber(data.runCount)} runs, none terminal yet`
            : "No runs in this window"
        }
        {...(deltaPoints !== null
          ? {
              delta:
                deltaPoints === 0
                  ? "No change"
                  : `${deltaPoints > 0 ? "+" : "-"}${Math.abs(deltaPoints).toFixed(1)} pts`,
              deltaDirection:
                deltaPoints > 0
                  ? ("up" as const)
                  : deltaPoints < 0
                    ? ("down" as const)
                    : ("neutral" as const),
              // A RISING pass rate is the win — the one tile on this bento where up is good.
              positiveIsGood: true,
            }
          : {})}
        {...(series.length >= 2
          ? {
              visual: (
                <Sparkline
                  values={series.map((value) => value - floor)}
                  variant="line"
                  emphasizeLast
                  label={`Runs per bucket: ${formatNumber(first)} → ${formatNumber(last)} across the last ${series.length} buckets`}
                />
              ),
            }
          : {})}
      />
    </BentoGridItem>
  );
}
