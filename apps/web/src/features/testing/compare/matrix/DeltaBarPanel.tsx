import { Text, cn } from "@brand/ui";
import { DELTA_BAR_TONE, DELTA_TEXT_TONE } from "../../../../lib/delta";
import { RunLetterBadge } from "../RunLetterBadge";
import { deriveDeltaBars, type DeltaBar, type DeltaTone, type SummaryRun } from "../summary-derive";
import { summaryFormatters } from "./summary-format";

/**
 * The ONE grouped horizontal delta-bar panel (audit §G13.4 / §H) — replaces the deleted per-metric
 * card zoo + radar (D-UX10). One row per metric (tokens in/out, cost, duration, tool calls, peak
 * context); within each row every non-baseline run is a bar whose length is its **Δ% vs the
 * baseline**, diverging from a **shared baseline line** (0) — left = a reduction, right = an increase
 * — coloured via the ONE delta authority (`lib/delta.ts`, D-IC3/D-UX9: green better, amber worse).
 * Every bar carries a **value label** (the run's own
 * value + the signed Δ), which the old charts lacked (T9e). A magnitude scale shared across the panel
 * makes "which metric moved most" legible at a glance. Zero-information metrics (all-$0.00, all-equal)
 * **collapse to a single text line** instead of an empty plot (T9e).
 *
 * Built from token-backed layout primitives (the sanctioned `TokenViz` pattern) because `@brand/charts`
 * cannot draw a diverging, per-value-signed, value-labelled bar with a centred zero — the honest shape
 * this metric needs. Semantic `--chart-N` + success/warning tokens only; reads in both themes.
 */
export function DeltaBarPanel({
  runs,
  perTurn,
  comparable,
}: {
  runs: SummaryRun[];
  perTurn: boolean;
  /** When false, bars render neutral (magnitude only) — no green/red on runs that aren't
   *  cleanly comparable (e.g. one died at turn 1). T9h: no fake precision. */
  comparable: boolean;
}) {
  const baseline = runs.find((r) => r.isBaseline) ?? runs[0]!;
  const fmt = summaryFormatters();
  const rawMetrics = deriveDeltaBars(runs, baseline, perTurn, fmt);
  const metrics = comparable
    ? rawMetrics
    : rawMetrics.map((m) => ({
        ...m,
        bars: m.bars.map((b) => ({ ...b, tone: "neutral" as const })),
      }));

  // Shared magnitude scale across every drawn bar so a −54% and a −8% read proportionally.
  const maxAbs = Math.max(
    1,
    ...metrics
      .filter((m) => !m.collapsed)
      .flatMap((m) => m.bars.map((b) => (b.deltaPercent != null ? Math.abs(b.deltaPercent) : 0))),
  );

  const drawn = metrics.filter((m) => !m.collapsed);
  const collapsed = metrics.filter((m) => m.collapsed);

  return (
    <div className="flex flex-col gap-4">
      {drawn.length === 0 ? (
        <Text variant="meta" tone="muted" className="text-pretty">
          Every metric ties across these runs — nothing to plot. See the notes below.
        </Text>
      ) : (
        <ul className="flex flex-col gap-3">
          {drawn.map((metric) => (
            <li
              key={metric.key}
              className="grid grid-cols-[minmax(6rem,9rem)_1fr] items-center gap-3"
            >
              <div className="flex flex-col">
                <Text as="span" variant="meta" className="font-medium">
                  {metric.label}
                </Text>
                <Text as="span" variant="meta" tone="muted" className="tabular-nums">
                  {baseline.letter} {metric.baselineText}
                </Text>
              </div>
              <MetricTrack bars={metric.bars} maxAbs={maxAbs} />
            </li>
          ))}
        </ul>
      )}

      {collapsed.length > 0 ? (
        <ul className="flex flex-col gap-1 border-t border-border pt-3">
          {collapsed.map((metric) => (
            <li key={metric.key} className="flex items-baseline gap-2">
              <Text as="span" variant="meta" className="font-medium">
                {metric.label}:
              </Text>
              <Text as="span" variant="meta" tone="muted" className="text-pretty">
                {metric.collapsedText}
              </Text>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** One metric's diverging track: a centred baseline line with each run's Δ bar left/right of it. */
function MetricTrack({ bars, maxAbs }: { bars: DeltaBar[]; maxAbs: number }) {
  return (
    <div className="flex flex-col gap-1.5">
      {bars.map((bar) => (
        <DeltaRow key={bar.runId} bar={bar} maxAbs={maxAbs} />
      ))}
    </div>
  );
}

function DeltaRow({ bar, maxAbs }: { bar: DeltaBar; maxAbs: number }) {
  const pct = bar.deltaPercent;
  // Bar half-width as a fraction of each side of the centre (max 50% of the track per side).
  const half = pct != null ? Math.min(50, (Math.abs(pct) / maxAbs) * 50) : 0;
  const grows = pct != null && pct > 0; // a positive Δ extends to the RIGHT of the baseline
  const shrinks = pct != null && pct < 0; // a negative Δ extends to the LEFT

  return (
    <div className="flex items-center gap-2">
      <RunLetterBadge letter={bar.letter} color={bar.color} />
      <div className="relative h-4 min-w-0 flex-1">
        {/* The shared baseline line (0) down the centre of every track. */}
        <span aria-hidden className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border" />
        {/* The diverging Δ bar. */}
        {half > 0 ? (
          <span
            aria-hidden
            className={cn("absolute inset-y-1 rounded-sm", DELTA_BAR_TONE[bar.tone])}
            style={grows ? { left: "50%", width: `${half}%` } : { right: "50%", width: `${half}%` }}
          />
        ) : null}
      </div>
      <Text
        as="span"
        variant="meta"
        className={cn("w-28 shrink-0 text-right tabular-nums", DELTA_TEXT_TONE[bar.tone])}
        aria-label={`${bar.letter}: ${bar.valueText}, ${describeTone(bar.tone)} ${bar.deltaText}`}
      >
        <span className="text-foreground">{bar.valueText}</span>{" "}
        <span>{shrinks || grows ? bar.deltaText : "±0"}</span>
      </Text>
    </div>
  );
}

function describeTone(tone: DeltaTone): string {
  return tone === "better" ? "better by" : tone === "worse" ? "worse by" : "unchanged";
}
