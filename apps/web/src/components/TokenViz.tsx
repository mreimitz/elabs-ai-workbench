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
 * The four facets **plus everything else in the definition that nothing itemises**.
 *
 * A tool's headline `totalTokens` is the count of the serialized provider payload
 * (`apps/api/src/token-counting/profiles.ts`). The four facets — name, description, INPUT schema,
 * annotations — are each counted in ISOLATION, so they do not add up to it, and the bar this feeds
 * used to scale to their sum: a full-width 100% bar under the heading "Where startup tokens go"
 * with up to three fifths of the tokens missing from it.
 *
 * ## What the remainder actually is — measured, not assumed
 * The first version of this called it "wire structure" and told the reader it was JSON braces and
 * quoting they could not edit. That was wrong, and the numbers say so. Counted over the owner's own
 * registered servers:
 *
 * | server | tools declaring `outputSchema` | remainder | held by those tools |
 * |---|---|---|---|
 * | barc-benchmark | 77 / 77 | 38,376 | **100%** |
 * | qlik-stage | 143 / 146 | 63,939 | **100%** |
 * | qlik-mreimitz | 60 / 60 | 29,153 | **100%** |
 * | QSoW-MCP | 1 / 36 | 356 | 12% |
 * | databricks-sql | 0 / 3 | 35 | 0% |
 *
 * So the remainder is dominated by the tool's declared **`outputSchema`** — a real, editable
 * content field this app does not yet meter separately — and the true envelope overhead is the
 * ~10 tokens per tool left over on servers that declare none. `qlik_get_full_glossary_export`
 * carries a 8,356-character output schema against a 168-character input schema; it reads as 2,028
 * tokens of which 120 are itemised.
 *
 * Splitting the two exactly needs an `outputSchemaTokens` count that is neither computed nor
 * persisted today (`mcp_tool_scans` has no such column) — a schema change, deliberately not made
 * here. Until it exists the segment names both things and the note says which one dominates,
 * rather than asserting a split the data cannot support.
 *
 * The remainder is floored at 0 so a counting-version skew can never render a negative slice.
 */
export function facetSegments(split: ContributorSplit, total: number): CompositionSegment[] {
  return [
    ...FACETS.map((facet) => ({ key: facet.key, label: facet.label, value: split[facet.key] })),
    {
      key: "structure",
      label: "Output schema + envelope",
      value: Math.max(0, total - facetSum(split)),
    },
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
  note,
}: {
  segments: CompositionSegment[];
  total: number;
  title: string;
  ariaLabel: string;
  /** An always-visible line under the legend. Not a tooltip: see {@link RESIDUAL_SEGMENT_NOTE}. */
  note?: string;
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
      {note ? (
        <Text variant="meta" tone="muted" className="text-pretty">
          {note}
        </Text>
      ) : null}
    </div>
  );
}

/**
 * What the fifth segment is, stated on the page rather than hidden in a tooltip.
 *
 * The owner's reaction to the segment on first sight was *"what is wire structure ??"* — the
 * correct reaction to an unexplained label that happens to be the biggest slice on the chart. A
 * tooltip would not have answered it (unreachable by keyboard here, invisible until hovered), so
 * the answer is a line of text under the bar. See {@link facetSegments} for the measurement behind
 * the wording — and for why the earlier wording, which called it uneditable JSON punctuation, was
 * false.
 */
export const RESIDUAL_SEGMENT_NOTE =
  "Everything in the definition that the four parts above don’t itemise. On these servers it is " +
  "almost entirely the tool’s declared output schema — which IS editable — plus roughly ten tokens " +
  "of JSON envelope per tool. The two aren’t counted separately yet.";

/**
 * The Name / Description / Schema / Annotations / Wire structure bar — ONE component, used for a
 * whole server and for a single tool, so the two can never show different arithmetic.
 *
 * The tool detail used to draw its own four-segment bar and rescale it to their sum: on
 * `qlik_add_chart` that read Name 4 · Description 303 · Schema 2,197 · Annotations 7, which totals
 * 2,511 against a stated 2,601 — 90 tokens unaccounted for, in a panel headed "Token budget".
 */
export function ToolFacetBar({
  split,
  total,
  title = "By part of a tool definition",
  subject,
}: {
  split: ContributorSplit;
  /** The HEADLINE total (serialized payload), never the facet sum — that difference is a segment. */
  total: number;
  title?: string;
  /** Names the thing being broken down, for the bar's accessible label. */
  subject?: string;
}) {
  return (
    <CompositionBar
      ariaLabel={
        subject ? `Token composition for ${subject}` : "Tool tokens by part of the definition"
      }
      note={RESIDUAL_SEGMENT_NOTE}
      segments={facetSegments(split, total)}
      title={title}
      total={total}
    />
  );
}

/**
 * One ranked tool: a SINGLE-HUE magnitude bar, with the Name/Description/Schema/Annotations split
 * in a tooltip rather than painted into the bar.
 *
 * The ranking is the row's job, and colour encodes identity — not rank. The first version
 * repeated the same four hues down eight rows, which said nothing the row order did not already
 * say, and compressed each facet into a 2.5px-tall sliver too small to compare.
 *
 * ## One denominator: the bar and the percent beside it are the same measurement
 * The version after that scaled each bar to the LARGEST tool, so the top row drew a full-width bar
 * next to the number 6.9% — two denominators on one line, and the bar read as broken. The track is
 * the whole server now, so a bar's length IS the percent printed beside it. That costs some
 * comparability between adjacent rows and buys back something the old scaling actively hid: on
 * `barc-benchmark` the eight heaviest tools come to roughly 28% of the surface between them, which
 * a chart whose top bar is always full can never show.
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
  serverTotal,
  onSelect,
}: {
  row: ContributorRow;
  rank: number;
  /** The whole server's tool tokens — the bar's track, so bar and percent share one denominator. */
  serverTotal: number;
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
        {/* TWO bars, because the row answers two different questions and one bar cannot carry both.
            Squeezing them into one is exactly what made the earlier version read as broken: a
            full-width bar beside the number 6.9%.

            Top — how much of the SERVER this tool is. Its length is the percent printed above it,
            so bar and number are one measurement. Short by construction (the heaviest tool here is
            under 10% of its server), which is itself the finding.

            Bottom — what this tool is MADE OF, always full width because it is a part-to-whole of
            the tool itself. This is the breakdown the owner asked to see in the list rather than
            behind a hover; at full width its five segments are legible, which they would not be if
            painted inside the ~30px share bar above. Colours match the "By part of a tool
            definition" legend directly above the list, so it needs no legend of its own. */}
        <span className="block h-2 w-full overflow-hidden rounded-full bg-muted">
          <span
            className="block h-full rounded-full bg-primary"
            style={{ width: `${(row.total / (serverTotal || 1)) * 100}%` }}
          />
        </span>
        <span className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
          {segments.map((segment, index) =>
            segment.value > 0 ? (
              <span
                className={cn(
                  "h-full border-transparent last:border-r-0",
                  segments.filter((s) => s.value > 0).length > 1 && "border-r-2",
                  SEGMENT_BG[index % SEGMENT_BG.length],
                )}
                key={segment.key}
                style={{ width: `${(segment.value / (row.total || 1)) * 100}%` }}
              />
            ) : null,
          )}
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
  const listedShare =
    surface.tools > 0 ? (rows.reduce((sum, row) => sum + row.total, 0) / surface.tools) * 100 : 0;

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <CompositionBar
        ariaLabel="Startup tokens by surface: tools, resources and prompts"
        segments={surfaceSegments(surface)}
        title="By surface"
        total={surfaceTotal}
      />
      <ToolFacetBar split={facets} total={surface.tools} />
      {rows.length > 0 ? (
        <div className="flex min-w-0 flex-col gap-1.5">
          <Text as="span" variant="meta" tone="muted">
            Heaviest tools — top bar is its share of this server, bottom bar is what it’s made of
          </Text>
          <ul className="flex flex-col">
            {rows.map((row, index) => (
              <ToolTokenRow
                key={row.id}
                onSelect={onSelect}
                rank={index + 1}
                row={row}
                serverTotal={surface.tools}
              />
            ))}
          </ul>
          {/* What the old max-scaled bars could not say: whether the heavy tools are the problem, or
              whether the cost is spread across the whole surface. Both are actionable, and they call
              for opposite fixes. */}
          <Text variant="meta" tone="muted" className="text-pretty">
            {`These ${formatNumber(rows.length)} are ${formatPercent(listedShare)} of the server’s tool tokens.`}
          </Text>
        </div>
      ) : null}
    </div>
  );
}
