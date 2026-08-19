import { useMemo } from "react";
import { Database } from "lucide-react";
import { Sparkline } from "@elabs-ai/components-charts";
import { BentoGridItem, MetricCard, StatePanel } from "@elabs-ai/components-ui";
import { formatNumber } from "../../../../lib/format";
import type { FootprintData, SectionEnvelope } from "../overview-contract";
import { isEmptySection } from "../overview-contract";

/**
 * Overview KPI (dashboard-bento WP 1.2) — the fleet's startup-token cost: the total, its Δ and a
 * sparkline of how it got there.
 *
 * Three things this tile is deliberate about:
 *
 * 1. **Growth is the regression.** Startup tokens are context every request pays for, so
 *    `positiveIsGood={false}` — a bigger footprint must never render in the success colour.
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
   * The fleet total after each bucket, oldest → newest — the tile's OWN value recomputed over the
   * window, so the series and the headline measure the same quantity. A server with no measurement
   * in a bucket keeps its last known figure (and counts as 0 before its first), the same convention
   * `ScansTab.tsx`'s `buildTileTrend` uses; anything else would make adding a server look like a
   * collapse.
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

  return (
    <BentoGridItem size="sm">
      <MetricCard
        className="h-full border-0 bg-transparent shadow-none"
        loading={section.state === "loading"}
        icon={<Database aria-hidden />}
        label="Startup tokens"
        value={data ? formatNumber(data.totalTokens) : "n/a"}
        description="Tools + resources + prompts, latest scans"
        {...(delta !== null
          ? {
              delta: delta === 0 ? "No change" : `${delta > 0 ? "+" : ""}${formatNumber(delta)}`,
              deltaDirection:
                delta > 0 ? ("up" as const) : delta < 0 ? ("down" as const) : ("neutral" as const),
              // Growth in startup context is a REGRESSION, never a win.
              positiveIsGood: false,
            }
          : {})}
        {...(data && data.firstTimeServers > 0
          ? {
              evidence:
                data.firstTimeServers === 1
                  ? "Includes 1 server measured for the first time"
                  : `Includes ${formatNumber(data.firstTimeServers)} servers measured for the first time`,
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
