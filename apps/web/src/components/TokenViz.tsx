import type { ReactNode } from "react";
import {
  Button,
  Text,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
} from "@elabs-ai/components-ui";
import { formatNumber, formatPercent } from "../lib/format";

/** Chart-token classes for composition segments — theme-aware, no raw colors. */
const SEGMENT_BG = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-chart-5"] as const;

export type Segment = { label: string; value: number };

/**
 * One horizontal stacked bar split into labelled segments (e.g. a tool's
 * Name / Description / Schema / Annotations token split), with a compact legend.
 * Replaces the old "four separate Progress bars" encoding.
 */
export function SegmentedBar({ segments, ariaLabel }: { segments: Segment[]; ariaLabel?: string }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0) || 1;
  return (
    <div className="flex flex-col gap-2">
      <div
        className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={
          ariaLabel ??
          segments.map((s) => `${s.label} ${Math.round((s.value / total) * 100)}%`).join(", ")
        }
      >
        {segments.map((s, index) =>
          s.value > 0 ? (
            <div
              key={s.label}
              className={cn("h-full", SEGMENT_BG[index % SEGMENT_BG.length])}
              style={{ width: `${(s.value / total) * 100}%` }}
              title={`${s.label}: ${formatNumber(s.value)} (${Math.round((s.value / total) * 100)}%)`}
            />
          ) : null,
        )}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {segments.map((s, index) => (
          <li key={s.label} className="flex items-center gap-1.5">
            <span
              className={cn("size-2.5 shrink-0 rounded-sm", SEGMENT_BG[index % SEGMENT_BG.length])}
              aria-hidden
            />
            <Text variant="meta" tone="muted">
              {s.label}
            </Text>
            <Text variant="meta" className="tabular-nums">
              {formatNumber(s.value)} ({Math.round((s.value / total) * 100)}%)
            </Text>
          </li>
        ))}
      </ul>
    </div>
  );
}

export type RankedItem = {
  id: string;
  label: string;
  value: number;
  percent: number;
  aside?: ReactNode;
};

/** Compact ranked list: rank · name · inline bar · value/percent. Rows are clickable when `onSelect` is given. */
export function RankedTokenList({
  items,
  onSelect,
}: { items: RankedItem[]; onSelect?: (id: string) => void }) {
  const max = Math.max(...items.map((item) => item.value), 1);

  return (
    <ul className="flex flex-col">
      {items.map((item, index) => {
        const body = (
          <span className="grid w-full grid-cols-[1.25rem_minmax(0,1fr)] items-center gap-2.5">
            <Text as="span" variant="meta" tone="muted" className="text-right tabular-nums">
              {index + 1}
            </Text>
            <span className="flex min-w-0 flex-col gap-1">
              <span className="flex items-baseline justify-between gap-2">
                <Text className="truncate font-mono" title={item.label}>
                  {item.label}
                </Text>
                <Text variant="meta" className="shrink-0 tabular-nums">
                  {formatNumber(item.value)} · {item.percent.toFixed(1)}%
                </Text>
              </span>
              <span className="block h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <span
                  className="block h-full rounded-full bg-primary"
                  style={{ width: `${(item.value / max) * 100}%` }}
                />
              </span>
            </span>
          </span>
        );

        return (
          <li key={item.id} className="min-w-0">
            {onSelect ? (
              <Button
                variant="ghost"
                className="h-auto w-full justify-start rounded-md px-2 py-1.5 text-left"
                onClick={() => onSelect(item.id)}
              >
                {body}
              </Button>
            ) : (
              <span className="block px-2 py-1.5">{body}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Canonical Name/Description/Schema/Annotations split, in segment order. */
export type ContributorSplit = {
  name: number;
  description: number;
  schema: number;
  annotations: number;
};

export type ContributorRow = {
  id: string;
  label: string;
  /**
   * The tool's HEADLINE total — tokens of the serialized provider payload. Always `>=` the facet
   * sum; see {@link facetSegments} for why that difference is shown rather than scaled away.
   */
  total: number;
  percent: number;
  split: ContributorSplit;
};

/** Tokens by MCP surface. A scan's `totalTokens` is TOOLS ONLY; the other two are its own fields. */
export type SurfaceSplit = { tools: number; resources: number; prompts: number };

/** One labelled slice of a composition bar. */
export type CompositionSegment = { key: string; label: string; value: number };

const FACETS = [
  { key: "name", label: "Name" },
  { key: "description", label: "Description" },
  { key: "schema", label: "Schema" },
  { key: "annotations", label: "Annotations" },
] as const;

/** The four ISOLATED facet counts, summed. Never a tool's headline total — see {@link facetSegments}. */
export function facetSum(split: ContributorSplit): number {
  return split.name + split.description + split.schema + split.annotations;
}

/**
 * The four facets **plus the wire structure they leave unaccounted for**.
 *
 * A tool's headline `totalTokens` is the count of the serialized provider payload — envelope, JSON
 * keys, braces, quoting (`apps/api/src/token-counting/profiles.ts`: *"This is >= the facet sum
 * because the wire structure (keys, braces, envelope) is now included"*). The four facets are each
 * counted in ISOLATION, so they do not add up to it.
 *
 * That gap is not a rounding artifact. Measured across the owner's own registered servers it runs
 * from 4.5% to **59.7%** of a server's tool tokens (qlik-mreimitz: 48,860 total against a 19,707
 * facet sum). The bar this feeds used to scale to the facet sum, so it painted a full-width 100%
 * bar under the heading "Where startup tokens go" while three fifths of the tokens were missing
 * from it. Naming the remainder is the whole point: those tokens are real, the model ingests them,
 * and this app exists to meter them.
 *
 * The remainder is floored at 0 so a counting-version skew can never render a negative slice.
 */
export function facetSegments(split: ContributorSplit, total: number): CompositionSegment[] {
  return [
    ...FACETS.map((facet) => ({ key: facet.key, label: facet.label, value: split[facet.key] })),
    { key: "structure", label: "Wire structure", value: Math.max(0, total - facetSum(split)) },
  ];
}

/** Tools / Resources / Prompts, in a fixed order — the three surfaces a scan measures. */
export function surfaceSegments(split: SurfaceSplit): CompositionSegment[] {
  return [
    { key: "tools", label: "Tools", value: split.tools },
    { key: "resources", label: "Resources", value: split.resources },
    { key: "prompts", label: "Prompts", value: split.prompts },
  ];
}

function share(value: number, total: number): string {
  return formatPercent(total > 0 ? (value / total) * 100 : 0);
}

/**
 * One labelled composition bar: a proportional stacked track, then a legend that states each
 * segment's own tokens and share. Segments are separated by a 2px transparent border so the track
 * shows through — adjacent fills never touch, which is what makes a thin stack readable.
 *
 * Every segment is labelled in place. There is deliberately no detached legend: the previous
 * version put one at the bottom of the card, three hundred pixels from the bar it explained.
 */
function CompositionBar({
  segments,
  total,
  title,
  ariaLabel,
}: {
  segments: CompositionSegment[];
  total: number;
  title: string;
  ariaLabel: string;
}) {
  const denom = total > 0 ? total : 1;
  // Colour is keyed to the segment's OWN position, never to its position among the drawn ones. A
  // zero-valued slice is skipped in the bar but still listed in the legend, so indexing the filtered
  // array would shift every colour after it and a segment's fill would stop matching its own swatch
  // — a server with no resources but some prompts would paint Prompts in the Resources colour.
  const drawn = segments
    .map((segment, index) => ({ segment, index }))
    .filter((entry) => entry.segment.value > 0);

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <Text as="span" variant="meta" tone="muted">
          {title}
        </Text>
        <Text as="span" variant="meta" className="shrink-0 tabular-nums">
          {formatNumber(total)}
        </Text>
      </div>
      <span
        aria-label={ariaLabel}
        className="flex h-3 w-full overflow-hidden rounded-full bg-muted"
        role="img"
      >
        {drawn.map(({ segment, index }) => (
          <span
            className={cn(
              "h-full border-transparent last:border-r-0",
              drawn.length > 1 && "border-r-2",
              SEGMENT_BG[index % SEGMENT_BG.length],
            )}
            key={segment.key}
            style={{ width: `${(segment.value / denom) * 100}%` }}
          />
        ))}
      </span>
      <ul className="flex flex-col gap-1">
        {segments.map((segment, index) => (
          <li className="flex min-w-0 items-baseline gap-2" key={segment.key}>
            <span
              aria-hidden
              className={cn(
                "size-2 shrink-0 translate-y-px rounded-sm",
                SEGMENT_BG[index % SEGMENT_BG.length],
              )}
            />
            <Text as="span" variant="meta" tone="muted" className="min-w-0 truncate">
              {segment.label}
            </Text>
            <Text as="span" variant="meta" className="ml-auto shrink-0 tabular-nums">
              {formatNumber(segment.value)} · {share(segment.value, denom)}
            </Text>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * One ranked tool: a SINGLE-HUE magnitude bar, with the Name/Description/Schema/Annotations split
 * in a tooltip rather than painted into the bar.
 *
 * The ranking is the row's job, and colour encodes identity — not rank. The previous version
 * repeated the same four hues down eight rows, which said nothing the row order did not already
 * say, and compressed each facet into a 2.5px-tall sliver too small to compare.
 *
 * ## The split is NOT tooltip-only, and that is deliberate
 * `brand-ui docs Tooltip` names it as an anti-pattern — *"Putting essential information ONLY in a
 * Tooltip — it is unreachable on touch and transient"* — and a measurement against the running app
 * agreed: tabbing to a row (45 tabs in) opened no tooltip at all, so a keyboard user got nothing.
 * Wrapping the trigger in a focusable span, the shape `IconButton` uses, did not change that
 * either; it was tried and reverted rather than left in as scaffolding that fixes nothing.
 *
 * So the split ALSO rides in the row's accessible name as `sr-only` text, which assistive tech
 * announces on focus (verified: the focused row reads *"1 qlik_create_data_object 4,796 · 7.4%
 * Name 5, Description 2,002, Schema 1,905, Annotations 7, Wire structure 877"*). The tooltip is the
 * sighted-pointer convenience on top of that, not the only way in — and activating the row opens
 * the tool's own detail, where `SegmentedBar` draws the same split.
 */
function ToolTokenRow({
  row,
  rank,
  scaleMax,
  onSelect,
}: {
  row: ContributorRow;
  rank: number;
  scaleMax: number;
  onSelect?: (id: string) => void;
}) {
  const segments = facetSegments(row.split, row.total);
  const body = (
    <span className="grid w-full grid-cols-[1.25rem_minmax(0,1fr)] items-center gap-2.5">
      <Text as="span" variant="meta" tone="muted" className="text-right tabular-nums">
        {rank}
      </Text>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="flex items-baseline justify-between gap-2">
          <Text as="span" className="truncate font-mono" title={row.label}>
            {row.label}
          </Text>
          <Text as="span" variant="meta" className="shrink-0 tabular-nums">
            {formatNumber(row.total)} · {formatPercent(row.percent)}
          </Text>
        </span>
        <span className="block h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <span
            className="block h-full rounded-full bg-primary"
            style={{ width: `${(row.total / (scaleMax || 1)) * 100}%` }}
          />
        </span>
      </span>
      <span className="sr-only">
        {segments.map((segment) => `${segment.label} ${formatNumber(segment.value)}`).join(", ")}
      </span>
    </span>
  );

  return (
    <li className="min-w-0">
      <Tooltip>
        <TooltipTrigger asChild>
          {onSelect ? (
            <Button
              className="h-auto w-full justify-start rounded-md px-2 py-1.5 text-left"
              onClick={() => onSelect(row.id)}
              variant="ghost"
            >
              {body}
            </Button>
          ) : (
            <span className="block px-2 py-1.5">{body}</span>
          )}
        </TooltipTrigger>
        <TooltipContent>
          <ul className="flex flex-col gap-0.5">
            {segments.map((segment) => (
              <li className="flex items-baseline gap-3" key={segment.key}>
                <span>{segment.label}</span>
                <span className="ml-auto tabular-nums">{formatNumber(segment.value)}</span>
              </li>
            ))}
          </ul>
        </TooltipContent>
      </Tooltip>
    </li>
  );
}

/**
 * The server's token distribution, on two axes that answer two different questions.
 *
 * 1. **By surface** — Tools / Resources / Prompts. Which kind of definition the startup cost is in.
 * 2. **By part of a tool definition** — Name / Description / Schema / Annotations / Wire structure,
 *    over the TOOL total. What inside a tool definition to go after.
 *
 * Then the heaviest tools, ranked, each carrying its own split on hover/focus.
 */
export function TokenDistribution({
  surface,
  facets,
  rows,
  onSelect,
}: {
  surface: SurfaceSplit;
  /** Aggregate facet counts across every tool in the scan (`serverHealth().composition`). */
  facets: ContributorSplit;
  rows: ContributorRow[];
  onSelect?: (id: string) => void;
}) {
  const surfaceTotal = surface.tools + surface.resources + surface.prompts;
  const rowMax = Math.max(...rows.map((row) => row.total), 1);

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <CompositionBar
        ariaLabel="Startup tokens by surface: tools, resources and prompts"
        segments={surfaceSegments(surface)}
        title="By surface"
        total={surfaceTotal}
      />
      <CompositionBar
        ariaLabel="Tool tokens by part of the definition"
        segments={facetSegments(facets, surface.tools)}
        title="By part of a tool definition"
        total={surface.tools}
      />
      {rows.length > 0 ? (
        <div className="flex min-w-0 flex-col gap-1.5">
          <Text as="span" variant="meta" tone="muted">
            Heaviest tools — hover a row for its split
          </Text>
          <ul className="flex flex-col">
            {rows.map((row, index) => (
              <ToolTokenRow
                key={row.id}
                onSelect={onSelect}
                rank={index + 1}
                row={row}
                scaleMax={rowMax}
              />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
