import { CheckCircle2 } from "lucide-react";
import { Sparkline } from "@elabs-ai/components-charts";
import { BentoGridItem, MetricCard, StatePanel } from "@elabs-ai/components-ui";
import { MetricDelta } from "../../../../components/MetricDelta";
import { formatNumber, formatPercent } from "../../../../lib/format";
import type { RunHealthData, SectionEnvelope } from "../overview-contract";
import { isEmptySection } from "../overview-contract";

/**
 * Overview KPI (dashboard-bento WP 1.2) — how the fleet's runs are doing: pass rate, its Δ in
 * percentage POINTS, and the run cadence behind it.
 *
 * **The polarity is the opposite of every other tile on this bento.** For tokens and spend, growth
 * is the regression; for a pass rate a RISE is the win, so this tile's delta is rendered with
 * `higherIsBetter` **true**. Getting that backwards paints an improving fleet in the failure colour,
 * which is why it is asserted directly in the tests.
 *
 * WP 2.2 (Defect 5): the delta goes through `MetricDelta`/`lib/delta.ts`, not `MetricCard`'s own
 * `delta`/`positiveIsGood` props — those paint an unfavourable delta **red**, while this app reserves
 * red for structural removal and colours a worsening magnitude **amber** (D-IC3). `InventoryTile`
 * (WP 2.1) already obeys that rule and now shares this bento, so the page lands on one tone
 * vocabulary: amber = worse, green = better, muted = neutral.
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
        // The delta rides INSIDE `value` so it keeps `MetricCard`'s own baseline-aligned position
        // beside the figure while this tile owns its colour (see the module doc).
        value={
          <span className="flex items-baseline gap-2">
            <span>{rate !== null ? formatPercent(rate) : "n/a"}</span>
            <MetricDelta
              delta={deltaPoints}
              higherIsBetter
              // Percentage POINTS (the contract's own unit), labelled so it can never be misread as
              // a relative percentage change.
              format={(value) => `${value > 0 ? "+" : "-"}${Math.abs(value).toFixed(1)} pts`}
            />
          </span>
        }
        description={
          data
            ? rate !== null
              ? `${formatNumber(data.runCount)} runs in this window`
              : `${formatNumber(data.runCount)} runs, none terminal yet`
            : "No runs in this window"
        }
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
