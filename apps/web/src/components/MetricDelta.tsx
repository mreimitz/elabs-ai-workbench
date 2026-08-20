import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "@elabs-ai/components-ui";
import { deltaOutcome, deltaTextTone } from "../lib/delta";

/**
 * MetricDelta — a signed magnitude delta beside a KPI figure, coloured by the app's ONE delta
 * authority (`lib/delta.ts`, D-IC3).
 * =============================================================================================
 * WHY THIS EXISTS (dashboard-bento WP 2.2, Defect 5). `MetricCard`'s own `delta`/`deltaDirection`/
 * `positiveIsGood` props hardcode
 * `deltaColor = good ? "text-success-text" : "text-destructive-text"` — **red** for a worse figure.
 * This app's locked rule says otherwise: a magnitude that merely got worse is **amber**
 * (`text-warning-text`); `--destructive`/red is reserved for a structural REMOVAL (D-IC3,
 * consolidating D-UX9 — see `lib/delta.ts`). Before WP 2.1 the two vocabularies never met on one
 * screen; the merged Overview bento puts them side by side, so the page has to pick one, and it
 * picks the app's own.
 *
 * The markup deliberately reproduces `MetricCard`'s delta contract **verbatim** — the same
 * `data-polarity` hook (`good` | `bad` | `neutral`) and the same accessible-label form
 * (`"up +250, unfavorable"`) — so a tile that switches to this reads identically to assistive tech
 * and to every existing assertion. Only the colour changes, which is the entire point.
 *
 * A `null`/`undefined` delta renders NOTHING: a figure with nothing to compare against says nothing,
 * never a "+0" that would read as "nothing moved". A genuine zero is worth saying, so it renders
 * `zeroLabel` with no direction and no polarity.
 */
export type MetricDeltaProps = {
  /** The signed change (new − baseline). `null`/`undefined` renders nothing at all. */
  delta: number | null | undefined;
  /** `true` for score/quality/pass-rate; `false` for tokens/cost/latency (where growth is worse). */
  higherIsBetter: boolean;
  /** Renders the magnitude WITH its sign and unit, e.g. `+10,000` / `-1.4 pts`. */
  format: (delta: number) => string;
  /** What a genuine zero says. */
  zeroLabel?: string;
  /** Layout-only. */
  className?: string;
};

export function MetricDelta({
  delta,
  higherIsBetter,
  format,
  zeroLabel = "No change",
  className,
}: MetricDeltaProps) {
  if (delta == null || Number.isNaN(delta)) return null;

  if (delta === 0) {
    // No direction, no polarity — just the fact that it held still.
    return (
      <span
        data-polarity="neutral"
        className={cn("text-meta text-muted-foreground tabular-nums", className)}
      >
        {zeroLabel}
      </span>
    );
  }

  const rose = delta > 0;
  const outcome = deltaOutcome(delta, higherIsBetter);
  const text = format(delta);

  return (
    <span
      data-polarity={outcome === "better" ? "good" : outcome === "worse" ? "bad" : "neutral"}
      aria-label={`${rose ? "up" : "down"} ${text}, ${outcome === "better" ? "favorable" : "unfavorable"}`}
      className={cn(
        "inline-flex items-center gap-0.5 text-meta tabular-nums",
        deltaTextTone(delta, higherIsBetter),
        className,
      )}
    >
      {rose ? (
        <ArrowUp aria-hidden className="size-3" />
      ) : (
        <ArrowDown aria-hidden className="size-3" />
      )}
      {text}
    </span>
  );
}
