import { PieChart } from "lucide-react";
import { ChartCard, Ring, RingChart } from "@elabs-ai/components-charts";
import { BentoGridItem, StatePanel, Text } from "@elabs-ai/components-ui";
import { chartSeriesColor, chartSwatchStyle } from "../../../../lib/chart-colors";
import { formatNumber } from "../../../../lib/format";
import type { FootprintData, SectionEnvelope } from "../overview-contract";
import { isEmptySection } from "../overview-contract";

/** The three surfaces a scan measures, in the order they are ringed and legended. */
const SEGMENTS = [
  { key: "tools", label: "Tools", of: (mix: NonNullable<FootprintData["mix"]>) => mix.toolTokens },
  {
    key: "resources",
    label: "Resources",
    of: (mix: NonNullable<FootprintData["mix"]>) => mix.resourceTokens,
  },
  {
    key: "prompts",
    label: "Prompts",
    of: (mix: NonNullable<FootprintData["mix"]>) => mix.promptTokens,
  },
] as const;

/**
 * Overview composition tile (dashboard-bento WP 1.2) — what the fleet's startup context is actually
 * made of: tools vs resources vs prompts.
 *
 * **`RingChart` has no `status` prop** (only `LineChart`/`AreaChart`/`BarChart`/`ComposedChart` do —
 * verified in the package's `index.d.ts`), so the loading state comes from the library's
 * `ChartCard loading`, which renders a layout-shaped skeleton at the real body height plus its own
 * live-region label. No bespoke spinner is invented here.
 *
 * `ChartCard` is nested **flush**: the `BentoGridItem` already composes the `Card` surface, so the
 * inner card drops its own border/fill/shadow — two stacked opaque card surfaces would paint the
 * double edge the bento component's docs flag. `className` is otherwise layout-only and no colour
 * is introduced.
 *
 * Ring colours come from `chartSeriesColor` (the one 12-token ramp), and the legend swatches from
 * `chartSwatchStyle`, so a swatch and its ring are pinned to the SAME token by construction. Colour
 * is never the only signal: every segment's name, token count and share are in the legend text and
 * in the chart's accessible description.
 *
 * Self-hides when the section is empty, when no successful scan produced a `mix`, or when the whole
 * measured surface is zero — a ring of three empty arcs is the empty box the bento must not show.
 */
export function SurfaceMixTile({
  section,
  onOpenSegment,
}: {
  section: SectionEnvelope<FootprintData>;
  /** Optional drill-down: activating a ring (pointer or keyboard) reports which surface was picked. */
  onOpenSegment?: (segment: (typeof SEGMENTS)[number]["key"]) => void;
}) {
  if (isEmptySection(section)) return null;

  if (section.state === "error") {
    return (
      <BentoGridItem size="sm">
        <StatePanel
          kind="error"
          title="Surface mix unavailable"
          description={section.error ?? undefined}
        />
      </BentoGridItem>
    );
  }

  const mix = section.data?.mix ?? null;
  const loading = section.state === "loading";
  const segments = mix
    ? SEGMENTS.map((s) => ({ key: s.key, label: s.label, value: s.of(mix) }))
    : [];
  const total = segments.reduce((sum, s) => sum + s.value, 0);

  // Nothing measured (no successful scan, or an all-zero surface) → remove the tile rather than draw
  // three empty arcs. `maxValue: 0` would also make every ring's progress NaN.
  if (!loading && total <= 0) return null;

  const rings = segments.map((s, i) => ({
    label: s.label,
    value: s.value,
    maxValue: total,
    color: chartSeriesColor(i),
  }));
  const share = (value: number) => (total > 0 ? Math.round((value / total) * 100) : 0);

  return (
    <BentoGridItem size="sm">
      <ChartCard
        className="h-full border-0 bg-transparent shadow-none"
        title={
          <span className="flex items-center gap-2">
            <PieChart aria-hidden className="size-4" />
            Surface mix
          </span>
        }
        height={120}
        loading={loading}
      >
        <div className="flex h-full min-w-0 items-center gap-3">
          <RingChart
            data={rings}
            size={104}
            className="shrink-0"
            accessibleLabel="Startup token surface mix"
            accessibleDescription={segments
              .map((s) => `${s.label} ${formatNumber(s.value)} tokens, ${share(s.value)}%`)
              .join("; ")}
            {...(onOpenSegment
              ? {
                  onDatapointClick: (point) => {
                    const segment = segments[point.index];
                    if (segment) onOpenSegment(segment.key);
                  },
                  datapointLabel: (point) => {
                    const segment = segments[point.index];
                    if (!segment) return String(point.category ?? "");
                    return `${segment.label}: ${formatNumber(segment.value)} tokens, ${share(segment.value)}%`;
                  },
                }
              : {})}
          >
            {rings.map((ring, i) => (
              <Ring key={ring.label} index={i} color={chartSeriesColor(i)} />
            ))}
          </RingChart>
          <ul className="flex min-w-0 flex-col gap-1">
            {segments.map((s, i) => (
              <li key={s.key} className="flex min-w-0 items-center gap-1.5">
                <span
                  className="size-2.5 shrink-0 rounded-sm"
                  style={chartSwatchStyle(i)}
                  aria-hidden
                />
                <Text as="span" variant="meta" tone="muted" className="truncate">
                  {s.label}
                </Text>
                <Text as="span" variant="meta" className="tabular-nums">
                  {share(s.value)}%
                </Text>
              </li>
            ))}
          </ul>
        </div>
      </ChartCard>
    </BentoGridItem>
  );
}
