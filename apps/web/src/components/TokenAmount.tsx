import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
} from "@elabs-ai/components-ui";
import {
  cacheHitRate,
  formatNumber,
  formatPercent,
  usageInputSlices,
  usageSplitKind,
  type TokenUsageActual,
} from "@mcp-token-footprint/shared";
import { useId } from "react";

/**
 * TokenAmount — the ONE way this app renders a token count (RM-33 WP 3.1).
 * =============================================================================================
 *
 * WHY IT EXISTS
 *   The app had NO token formatter. `lib/format.ts` re-exports `formatNumber`/`formatPercent`/
 *   `formatBytes` and nothing token-shaped, so ~15 sites each hand-wrote `formatNumber(x)` plus a
 *   literal `↑`/`↓`/`tok`. That is *why* the prompt-cache composition could not be surfaced
 *   consistently: there was no single place to put it. A run console could show **Tokens ↑ 958,457**
 *   while, two tabs away, a chart revealed that ~99.99% of a turn was served from cache — and nothing
 *   between the two said so.
 *
 * WHAT IT SHOWS
 *   The gross figure, unchanged (D-CT1 — `inputTokens` stays the provider-billed total and still
 *   INCLUDES the cached slice), plus a tooltip decomposing it when the split is known.
 *
 * THE THREE FIDELITIES (D-CT2/D-CT6) — this component's whole job is to keep them apart:
 *   - `exact`  — the provider reported the read/write split. Tooltip shows uncached / cache read /
 *                cache write and the hit rate, and labels a WRITE as a premium rather than letting it
 *                read as a saving (a read is ~0.1x input, a write is 1.25x — merging them into one
 *                "cached" number is how a premium gets displayed as a discount).
 *   - `merged` — only a merged figure survived (a historical run). The tooltip shows it and SAYS the
 *                split is unavailable. It does not guess.
 *   - `none` / no usage at all — renders exactly what the call site rendered before RM-33: bare text,
 *                no tooltip, no fabricated zeros. This is the majority case for old runs and must stay
 *                pixel-stable.
 *
 * ACCESSIBILITY
 *   A tooltip is transient and unreachable on touch, so the breakdown is ALSO emitted as an
 *   `sr-only` node wired via `aria-describedby` — the `IconButton` disabled-reason pattern, applied
 *   to a non-interactive figure. The trigger span is `tabIndex={0}` only when there is something to
 *   read, so no empty tab stop is added to a table of plain numbers.
 *
 * Every visible element is `@elabs-ai/components-ui`; `className` is layout-only; `tabular-nums` so
 * digits line up in a column (the micro-typography rule). Needs the app-root `TooltipProvider`.
 */

export type TokenDirection = "in" | "out";

export type TokenAmountProps = {
  /** The GROSS figure to render, unchanged by this component (D-CT1). */
  value: number;
  /** Appends the `↑`/`↓` affix the call sites used to write by hand. Omit for a bare count. */
  direction?: TokenDirection;
  /**
   * The usage record this figure decomposes. Omit (or pass one with no cache slice) and the component
   * renders exactly as the raw `formatNumber` call it replaced. Only the input side has a cache
   * composition, so an `out` figure never gets a breakdown even when a record is supplied.
   */
  usage?: Pick<
    TokenUsageActual,
    "inputTokens" | "cachedInputTokens" | "cacheReadTokens" | "cacheWriteTokens"
  >;
  className?: string;
};

const AFFIX: Record<TokenDirection, string> = { in: "↑", out: "↓" };

/** The tooltip/`sr-only` lines for a usage record, or `null` when there is nothing worth saying. */
function breakdownLines(
  usage: TokenAmountProps["usage"],
  direction: TokenDirection | undefined,
): string[] | null {
  // An OUTPUT figure has no cache composition — the model generated those tokens, it did not read
  // them. Rendering a breakdown there would attach input economics to an output number.
  if (!usage || direction === "out") return null;

  const kind = usageSplitKind(usage as TokenUsageActual);
  if (kind === "none") return null;

  if (kind === "merged") {
    return [
      `Cached: ${formatNumber(usage.cachedInputTokens ?? 0)}`,
      "Read/write split unavailable for this run.",
    ];
  }

  const slices = usageInputSlices(usage as TokenUsageActual);
  if (!slices) return null;
  const hit = cacheHitRate(usage as TokenUsageActual);
  const lines = [
    `Uncached: ${formatNumber(slices.uncached)}`,
    `Cache read: ${formatNumber(slices.cacheRead)} (billed ~0.1×)`,
  ];
  // Only mention a write when there was one — and say plainly that it costs MORE, because the merged
  // "cached" number every pre-RM-33 screen showed made a write look like a saving.
  if (slices.cacheWrite > 0) {
    lines.push(`Cache write: ${formatNumber(slices.cacheWrite)} (billed 1.25× — a premium)`);
  }
  if (hit !== null) lines.push(`${formatPercent(hit * 100)} served from cache`);
  return lines;
}

export function TokenAmount({ value, direction, usage, className }: TokenAmountProps) {
  const describedById = useId();
  const lines = breakdownLines(usage, direction);
  const figure = (
    <span className={cn("tabular-nums", className)}>
      {formatNumber(value)}
      {direction ? AFFIX[direction] : null}
    </span>
  );

  if (!lines) return figure;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* The wrapper span is the Radix trigger, so the figure gets the tooltip on HOVER.
            Deliberately NOT `tabIndex={0}`: a token count is a static readout, and a runs table or a
            step log renders dozens of them — making each one a tab stop would turn a scan of the
            table into an obstacle course, which is exactly what `a11y/noNoninteractiveTabindex`
            protects against. The breakdown is not lost: the `sr-only` node below is always in the DOM
            and wired via `aria-describedby`, so assistive tech reads it with the number itself,
            without needing focus or hover (and touch, where a tooltip never fires, gets it too).
            This is the OPPOSITE trade-off from `IconButton`'s disabled-reason tab stop, and for a
            reason: there, the reason is otherwise completely unreachable; here, it is not. */}
        <span className="inline-flex rounded-sm" aria-describedby={describedById}>
          {figure}
          {/* A tooltip is transient and absent on touch; this is the durable copy. */}
          <span id={describedById} className="sr-only">
            {lines.join(". ")}
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <span className="flex flex-col gap-0.5">
          {lines.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </span>
      </TooltipContent>
    </Tooltip>
  );
}
