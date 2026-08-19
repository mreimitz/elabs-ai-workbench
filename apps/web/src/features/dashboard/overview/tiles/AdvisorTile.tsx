import { Link } from "react-router-dom";
import { Badge, BentoGridItem, Button, Skeleton, Text } from "@elabs-ai/components-ui";
import { ExternalLink, Lightbulb, TrendingDown } from "lucide-react";
import type { AdvisorTeaserData, SectionEnvelope } from "../overview-contract";
import { isEmptySection } from "../overview-contract";
import { InlineError } from "../../../../components/InlineError";
import { SectionCardTitle } from "../../../../components/SectionCardTitle";

/**
 * AdvisorTile — the Overview bento's single top evidenced recommendation (dashboard-bento WP 1.3).
 * =============================================================================================
 * A full-width tile (`span={{ col: 4 }}`) carrying ONE recommendation — its severity, title, detail,
 * an optional estimated saving — plus the way through to the full report.
 *
 * ── SEVERITY IS NEVER COLOUR ALONE ────────────────────────────────────────────────────────────────
 * The chip's own text says the level out loud ("High severity"), so the ranking survives a
 * colour-blind reader, a greyscale print and a screen reader. That is the same rule
 * `features/advisor/RecommendationCard.tsx` follows via `ADVISOR_SEVERITY_META`; the map is
 * re-declared here rather than imported because the advisor wire union is `high | medium | info`
 * while this tile's contract union is `high | medium | low` — importing the wrong one would either
 * lose `low` or invent an `info` the contract cannot produce.
 *
 * ── NO FABRICATED FIGURE ──────────────────────────────────────────────────────────────────────────
 * `savingsLabel` is `null` when the advisor could not name a defensible number. The savings block is
 * then not rendered AT ALL — never a "0 tokens saved", never a dash standing in for a number. When a
 * label IS present it is printed verbatim (the advisor formats it with its own unit and never
 * converts units) inside a sentence that carries the word "Estimated", so the figure cannot be read
 * as a measurement even out of context — the advisor's own invariant 4.
 *
 * Empty behaviour: an advisor section with nothing to say removes the tile (the bento never renders
 * an empty box). The honest "no rule matched / not enough data yet" states are the `/advisor`
 * report's job, not a homepage teaser's.
 *
 * Every visible element is `@elabs-ai/components-*`; `className` is layout-only; no raw colour.
 */
export type AdvisorTileProps = {
  /** The contract's advisor section. */
  section: SectionEnvelope<AdvisorTeaserData>;
  /** Retry the section's fetch. Renders the `InlineError` retry affordance when given. */
  onRetry?: () => void;
};

/**
 * Severity → { text label, Badge variant }. The LABEL is the load-bearing half; the variant only
 * reinforces it. Mirrors `features/advisor/advisor-format.ts`'s `ADVISOR_SEVERITY_META` tones so a
 * "High" on the homepage reads the same as a "High" on `/advisor`.
 */
const SEVERITY_META: Record<
  AdvisorTeaserData["severity"],
  { label: string; variant: "destructive" | "warning" | "info" }
> = {
  high: { label: "High severity", variant: "destructive" },
  medium: { label: "Medium severity", variant: "warning" },
  low: { label: "Low severity", variant: "info" },
};

/** The fleet advisor report. `/advisor` with no query params IS the fleet report (D-TB10). */
const FULL_REPORT_HREF = "/advisor";

export function AdvisorTile({ section, onRetry }: AdvisorTileProps) {
  if (isEmptySection(section)) return null;

  return (
    <BentoGridItem span={{ col: 4 }} className="gap-3 p-4">
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 items-center gap-2">
          <Lightbulb aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <SectionCardTitle className="min-w-0 truncate">Top recommendation</SectionCardTitle>
        </div>
        <Button asChild variant="outline" size="sm" className="shrink-0">
          <Link to={FULL_REPORT_HREF}>
            <ExternalLink aria-hidden />
            <span>See all recommendations</span>
          </Link>
        </Button>
      </header>
      <AdvisorBody section={section} onRetry={onRetry} />
    </BentoGridItem>
  );
}

function AdvisorBody({ section, onRetry }: AdvisorTileProps) {
  if (section.state === "loading") {
    // Layout-shaped placeholder, not a spinner (.claude/rules/loading-states.md).
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-2" aria-busy="true">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-4 w-full" />
      </div>
    );
  }

  if (section.state === "error") {
    return (
      <InlineError
        level={3}
        title="Couldn’t load advisor recommendations"
        detail={section.error ?? undefined}
        onRetry={onRetry}
      />
    );
  }

  const data = section.data;
  if (!data) return null;

  const severity = SEVERITY_META[data.severity];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto md:flex-row md:items-start md:gap-6">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Text + variant, never colour alone. */}
          <Badge variant={severity.variant}>{severity.label}</Badge>
        </div>
        <Button
          asChild
          variant="link"
          size="sm"
          className="h-auto min-w-0 justify-start p-0 font-medium"
        >
          <Link to={data.href}>
            <span className="min-w-0 break-words text-left text-pretty">{data.title}</span>
          </Link>
        </Button>
        {/* CLAMPED, NEVER SLICED. On real data the top recommendation's `detail` is a full
            enumeration of every affected tool (131 of them on the instance this was found on),
            which rendered as a ~10-line paragraph that overflowed the tile and was cut mid-sentence
            by the bento item's `overflow-hidden`. The clamp is VISUAL: the DOM keeps the whole
            string, so a screen reader, a find-in-page and a copy all still get the real text — a
            `String.slice` here would cut mid-word and quietly misstate what the advisor said. The
            full text is reachable in two ways: the native `title` (the app's sanctioned recovery for
            clamped text, D-10) and the header's "See all recommendations" link. */}
        <Text
          variant="meta"
          tone="muted"
          className="line-clamp-3 break-words text-pretty"
          title={data.detail}
        >
          {data.detail}
        </Text>
      </div>

      {/* Rendered ONLY when the advisor gave a figure — see NO FABRICATED FIGURE above. */}
      {data.savingsLabel !== null ? (
        <div className="flex shrink-0 flex-col gap-1 rounded-md border border-border bg-muted/20 p-3 md:w-64">
          <div className="flex flex-wrap items-center gap-1.5">
            <TrendingDown aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            {/* The word "Estimate" lands in the chip AND in the sentence below, so the figure can
                never be read as a measurement — the advisor's own invariant 4. */}
            <Badge variant="info">Estimate</Badge>
          </div>
          {/* The label is printed VERBATIM — the advisor formats it with its own unit and this tile
              never converts one (advisor invariant 2). */}
          <Text className="break-words font-medium tabular-nums">
            {`Estimated saving ${data.savingsLabel}`}
          </Text>
        </div>
      ) : null}
    </div>
  );
}
