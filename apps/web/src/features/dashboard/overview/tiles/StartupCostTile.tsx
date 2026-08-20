import { useMemo } from "react";
import { Database } from "lucide-react";
import { Sparkline } from "@elabs-ai/components-charts";
import { BentoGridItem, MetricCard, StatePanel } from "@elabs-ai/components-ui";
import { MetricDelta } from "../../../../components/MetricDelta";
import { formatNumber, formatRelativeTime } from "../../../../lib/format";
import type { FootprintData, SectionEnvelope } from "../overview-contract";
import { isEmptySection } from "../overview-contract";

/**
 * Overview KPI (dashboard-bento WP 1.2) — the fleet's startup-token cost: the total, its Δ and a
 * sparkline of how it got there.
 *
 * **The figure is window-INDEPENDENT; only the sparkline is windowed.** `totalTokens`/`deltaTokens`
 * are the latest successful scan per server across all of history, so a week in which nobody
 * scanned removes the sparkline and nothing else — the tile still states what the fleet costs, and
 * its footer says when it was last measured. (Before that split, a 7-day window with no scan in it
 * emptied this tile off the bento on an instance holding 103 scans.)
 *
 * Three things this tile is deliberate about:
 *
 * 1. **Growth is the regression.** Startup tokens are context every request pays for, so the delta
 *    is rendered with `higherIsBetter={false}` — a bigger footprint must never read as a win.
 *    WP 2.2 (Defect 5): it goes through `MetricDelta`/`lib/delta.ts`, NOT `MetricCard`'s own
 *    `delta`/`positiveIsGood` props, because those paint an unfavourable delta **red** while this
 *    app reserves red for structural removal and colours a worsening magnitude **amber** (D-IC3).
 *    `InventoryTile` (WP 2.1) already obeys that rule and now sits on the same bento, so both had to
 *    land on one tone vocabulary; the app's own rule wins.
 * 2. **A missing figure is not a zero.** `deltaTokens === null` means nothing was comparable, so the
 *    tile renders NO delta rather than a "+0" that reads as "nothing moved".
 * 3. **The sparkline is normalised; the LABEL keeps the real figures.** `Sparkline` is
 *    ZERO-baselined (`max = Math.max(...values, 0)`, there is no min — verified in the package
 *    source), so handing it absolute fleet totals draws 580k → 590k as a flat line inside a 0..590k
 *    box. The series is shifted to its own window minimum so the variation spends the full height,
 *    exactly as `ScansTab.tsx`'s `trendProps` already does, and the accessible label states the
 *    REAL first → last figures.
 *
 * The tile nests a `MetricCard` **flush** inside its `BentoGridItem`: the bento item already
 * composes the `Card` surface, so the inner card drops its own border/fill/shadow (`className` is
 * otherwise layout-only) — nesting two opaque card surfaces would paint the double edge the bento
 * component's own docs flag. No colour is introduced; `bg-transparent` reads correctly in both
 * themes.
 */
export function StartupCostTile({ section }: { section: SectionEnvelope<FootprintData> }) {
  const perServer = section.data?.perServer ?? [];

  /**
   * The fleet total after each bucket of the WINDOW, oldest → newest — the same quantity the
   * headline states, recomputed per bucket so the shape under the number is the number's own
   * history. A server with no measurement in a bucket keeps its last known figure (and counts as 0
   * before its first), the same convention `ScansTab.tsx`'s `buildTileTrend` uses; anything else
   * would make adding a server look like a collapse.
   *
   * It is empty when the window holds no scan — the headline is standing, the sparkline is not, so
   * the visual is simply omitted (never a flat line at zero, which would claim a collapse).
   */
  const series = useMemo(() => {
    const byServer = perServer.map((s) => ({
      id: s.serverId,
      points: new Map(s.points.map((p) => [p.bucketStart, p.value])),
    }));
    const buckets = [
      ...new Set(perServer.flatMap((s) => s.points.map((p) => p.bucketStart))),
    ].sort();
    const latest = new Map<string, number>();
    return buckets.map((bucket) => {
      for (const s of byServer) {
        const value = s.points.get(bucket);
        if (value !== undefined) latest.set(s.id, value);
      }
      let total = 0;
      for (const value of latest.values()) total += value;
      return total;
    });
  }, [perServer]);

  if (isEmptySection(section)) return null;

  if (section.state === "error") {
    return (
      <BentoGridItem size="sm">
        <StatePanel
          kind="error"
          title="Startup tokens unavailable"
          description={section.error ?? undefined}
        />
      </BentoGridItem>
    );
  }

  const data = section.data;
  const delta = data?.deltaTokens ?? null;
  const floor = series.length > 0 ? Math.min(...series) : 0;
  const first = series[0] ?? 0;
  const last = series[series.length - 1] ?? 0;

  /**
   * The grounding footer. Both notes qualify the FIGURE, not the sparkline, so they survive a window
   * with no scan in it — which is the state that used to remove this tile entirely (see the module
   * doc). Each is stated only when it is true; nothing here is padded with a placeholder.
   */
  const notes: string[] = [];
  if (data?.noActivityInWindow === true) {
    notes.push(
      data.latestMeasuredAt !== null
        ? `No scans in this window — last measured ${formatRelativeTime(data.latestMeasuredAt)}`
        : "No scans in this window",
    );
  }
  if (data && data.firstTimeServers > 0) {
    notes.push(
      data.firstTimeServers === 1
        ? "Includes 1 server measured for the first time"
        : `Includes ${formatNumber(data.firstTimeServers)} servers measured for the first time`,
    );
  }

  return (
    <BentoGridItem size="sm">
      <MetricCard
        className="h-full border-0 bg-transparent shadow-none"
        loading={section.state === "loading"}
        icon={<Database aria-hidden />}
        label="Startup tokens"
        // The delta rides INSIDE `value` so it keeps `MetricCard`'s own baseline-aligned position
        // beside the figure while this tile owns its colour (see the module doc). `text-meta` on the
        // delta resets the size/weight the KPI type rung sets on this wrapper.
        value={
          <span className="flex items-baseline gap-2">
            <span>{data ? formatNumber(data.totalTokens) : "n/a"}</span>
            <MetricDelta
              delta={delta}
              higherIsBetter={false}
              format={(value) => `${value > 0 ? "+" : ""}${formatNumber(value)}`}
            />
          </span>
        }
        description="Tools + resources + prompts, latest scans"
        {...(notes.length > 0
          ? {
              evidence: notes.map((note) => (
                <span key={note} className="block">
                  {note}
                </span>
              )),
            }
          : {})}
        {...(series.length >= 2
          ? {
              visual: (
                <Sparkline
                  values={series.map((value) => value - floor)}
                  variant="line"
                  emphasizeLast
                  label={`Startup tokens: ${formatNumber(first)} → ${formatNumber(last)} across the last ${series.length} measurements`}
                />
              ),
            }
          : {})}
      />
    </BentoGridItem>
  );
}
