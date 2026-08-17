import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
} from "@elabs-ai/components-ui";
import { AlertTriangle, Info } from "lucide-react";
import { DELTA_TEXT_TONE } from "../../../../lib/delta";
import { StatusBadge } from "../../../../components/StatusBadge";
import {
  SubscriptionCostMarker,
  isSubscriptionReference,
} from "../../../../components/SubscriptionCostMarker";
import { formatCostUsd, formatDuration, formatNumber } from "../../../../lib/format";
import { RunLetterBadge } from "../RunLetterBadge";
import {
  deltaPercent,
  deltaTone,
  type MetricDirection,
  type SummaryRun,
} from "../summary-derive";
import { signedNumber, signedPercent } from "./summary-format";

/**
 * The baseline-Δ environment matrix (audit §G13.3 / §H) — the Summary mode centrepiece. Rows are the
 * compared runs (letter-badged, baseline first), columns are the metrics. The baseline row shows raw
 * values; every other row shows **value + Δ% vs the baseline**, colour-coded via the ONE delta
 * authority (`lib/delta.ts`, D-IC3/D-UX9: green better, amber worse, neutral on ties — NO ✓ on a
 * tie). An **absolute↔per-turn** toggle (owned by the parent)
 * makes unequal-length runs compare honestly; a **warning icon** flags any run whose terminal status
 * breaks comparability; **Peak context** shows the actual % of the model window (honest absolute
 * fallback when the window is unknown); **Quality** wires to grades where available. When any run in
 * the set is ungraded, the "enable grading" teach moves to a SINGLE header hint (compare-redesign
 * §3.3/S3) instead of a link on every ungraded row — a per-row cell with no score just shows "—".
 */
export function DeltaMatrix({
  runs,
  perTurn,
  comparable,
}: {
  runs: SummaryRun[];
  perTurn: boolean;
  /** When false (a run ended abnormally / turn counts diverge), Δs render in a NEUTRAL tone — the
   *  magnitude + sign still show, but no green/red "better/worse" judgement the data can't support
   *  (a run that died at turn 1 is not "−94% better"). T9h: no fake precision. */
  comparable: boolean;
}) {
  const baseline = runs.find((r) => r.isBaseline) ?? runs[0]!;
  // Peak context reads as a true % only when EVERY run knows its model window; otherwise the column
  // falls back to absolute tokens with an honest header (never a % the data can't back — T9h).
  const peakAsPercent = runs.every((r) => r.peakContextPercent != null);
  // At least one run is ungraded → the Quality column earns ONE muted header hint (S3), never a link
  // repeated per row.
  const anyUngraded = runs.some((r) => r.qualityScore == null);

  return (
    <div className="w-full overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-[12rem]">Run</TableHead>
            <TableHead>Outcome</TableHead>
            <TableHead className="text-right">Turns</TableHead>
            <TableHead className="text-right">{perTurn ? "Tokens / turn" : "Tokens"}</TableHead>
            <TableHead className="text-right">{perTurn ? "Cost / turn" : "Cost"}</TableHead>
            <TableHead className="text-right">
              {perTurn ? "Tool calls / turn" : "Tool calls"}
            </TableHead>
            <TableHead className="text-right">
              {peakAsPercent ? "Peak context %" : "Peak context (tokens)"}
            </TableHead>
            <TableHead className="text-right">
              {anyUngraded ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Link
                      to="/settings"
                      className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
                      aria-label="Quality — enable grading to compare output quality across these runs"
                    >
                      <span>Quality</span>
                      <Info aria-hidden className="size-3.5 text-muted-foreground" />
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent>
                    Quality — enable grading to compare output quality across these runs.
                  </TooltipContent>
                </Tooltip>
              ) : (
                "Quality"
              )}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((run) => (
            <MatrixRow
              key={run.id}
              run={run}
              baseline={baseline}
              perTurn={perTurn}
              peakAsPercent={peakAsPercent}
              comparable={comparable}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function MatrixRow({
  run,
  baseline,
  perTurn,
  peakAsPercent,
  comparable,
}: {
  run: SummaryRun;
  baseline: SummaryRun;
  perTurn: boolean;
  peakAsPercent: boolean;
  comparable: boolean;
}) {
  const isBaseline = run.id === baseline.id;
  const turnsDivisor = run.turns > 0 ? run.turns : 0;
  const baseTurns = baseline.turns > 0 ? baseline.turns : 0;

  const tokens = perTurn ? (turnsDivisor ? run.totalTokens / turnsDivisor : null) : run.totalTokens;
  const baseTokens = perTurn
    ? baseTurns
      ? baseline.totalTokens / baseTurns
      : null
    : baseline.totalTokens;

  const cost = perTurn ? (turnsDivisor ? run.costUsd / turnsDivisor : null) : run.costUsd;
  const baseCost = perTurn ? (baseTurns ? baseline.costUsd / baseTurns : null) : baseline.costUsd;

  const toolCalls = perTurn ? (turnsDivisor ? run.toolCalls / turnsDivisor : null) : run.toolCalls;
  const baseToolCalls = perTurn
    ? baseTurns
      ? baseline.toolCalls / baseTurns
      : null
    : baseline.toolCalls;

  const peakValue = peakAsPercent ? run.peakContextPercent : run.peakContextTokens;
  const basePeak = peakAsPercent ? baseline.peakContextPercent : baseline.peakContextTokens;

  return (
    <TableRow>
      <TableCell>
        <span className="flex items-center gap-2">
          <RunLetterBadge letter={run.letter} color={run.color} baseline={run.isBaseline} />
          <span className="flex min-w-0 flex-col">
            <span className="flex items-center gap-1.5">
              <Text as="span" className="truncate font-medium" title={run.scenarioName}>
                {run.scenarioName}
              </Text>
              {run.abnormal ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex" aria-label="Terminal status breaks comparability">
                      <AlertTriangle aria-hidden className="size-3.5 text-warning-text" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    This run ended abnormally — its deltas reflect where it stopped, not efficiency.
                  </TooltipContent>
                </Tooltip>
              ) : null}
            </span>
            {run.model && run.model !== "—" ? (
              <Text as="span" variant="meta" tone="muted" className="truncate">
                {run.model}
              </Text>
            ) : null}
          </span>
        </span>
      </TableCell>
      <TableCell>
        <StatusBadge status={run.outcome ?? run.status} />
      </TableCell>
      <TableCell className="text-right tabular-nums">{formatNumber(run.turns)}</TableCell>
      <DeltaCell
        value={tokens}
        baseline={baseTokens}
        isBaseline={isBaseline}
        direction="lower-better"
        comparable={comparable}
        format={(v) => formatNumber(v)}
      />
      <DeltaCell
        value={cost}
        baseline={baseCost}
        isBaseline={isBaseline}
        direction="lower-better"
        comparable={comparable}
        format={(v) => formatCostUsd(v)}
        // Claude subscription (WP 3.1, D-CS4) — a subscription run's cost is a shadow-price estimate;
        // mark this run's cost figure "est." (the Δ% still compares honestly).
        marker={isSubscriptionReference(run.costBasis) ? <SubscriptionCostMarker /> : undefined}
      />
      <DeltaCell
        value={toolCalls}
        baseline={baseToolCalls}
        isBaseline={isBaseline}
        direction="lower-better"
        comparable={comparable}
        format={(v) => formatNumber(v)}
      />
      <DeltaCell
        value={peakValue}
        baseline={basePeak}
        isBaseline={isBaseline}
        direction="lower-better"
        comparable={comparable}
        format={(v) => (peakAsPercent ? `${v.toFixed(1)}%` : formatNumber(v))}
      />
      <QualityCell run={run} baseline={baseline} isBaseline={isBaseline} comparable={comparable} />
    </TableRow>
  );
}

/** A metric cell: the run's own value + (for non-baseline rows) the tone-coloured Δ% vs baseline. An
 *  optional `marker` (e.g. the "est." subscription-cost badge) renders inline beside the value. */
function DeltaCell({
  value,
  baseline,
  isBaseline,
  direction,
  comparable,
  format,
  marker,
}: {
  value: number | null;
  baseline: number | null;
  isBaseline: boolean;
  direction: MetricDirection;
  comparable: boolean;
  format: (v: number) => string;
  marker?: ReactNode;
}) {
  if (value == null) {
    return (
      <TableCell className="text-right">
        <Text variant="meta" tone="muted">
          —
        </Text>
      </TableCell>
    );
  }
  const delta = !isBaseline && baseline != null ? deltaPercent(value, baseline) : null;
  const rawDelta = !isBaseline && baseline != null ? value - baseline : null;
  // Not cleanly comparable → show the Δ magnitude but never a green/red judgement (T9h).
  const tone = comparable ? deltaTone(delta ?? rawDelta, direction) : "neutral";
  return (
    <TableCell className="text-right">
      <span className="flex flex-col items-end leading-tight">
        {marker ? (
          <span className="inline-flex items-center gap-1.5">
            <Text as="span" className="tabular-nums">
              {format(value)}
            </Text>
            {marker}
          </span>
        ) : (
          <Text as="span" className="tabular-nums">
            {format(value)}
          </Text>
        )}
        {isBaseline ? (
          <Text as="span" variant="meta" tone="muted">
            baseline
          </Text>
        ) : delta != null ? (
          <Text as="span" variant="meta" className={cn("tabular-nums", DELTA_TEXT_TONE[tone])}>
            {delta === 0 ? "no change" : signedPercent(delta)}
          </Text>
        ) : rawDelta != null && rawDelta !== 0 ? (
          <Text as="span" variant="meta" className={cn("tabular-nums", DELTA_TEXT_TONE[tone])}>
            {signedNumber(rawDelta)}
          </Text>
        ) : (
          <Text as="span" variant="meta" tone="muted">
            no change
          </Text>
        )}
      </span>
    </TableCell>
  );
}

/** The Quality column: a graded score (Δ higher-better), or a plain "—" for an ungraded run — the
 *  "enable grading" teach lives ONCE, on the column header (S3), not repeated per row. */
function QualityCell({
  run,
  baseline,
  isBaseline,
  comparable,
}: {
  run: SummaryRun;
  baseline: SummaryRun;
  isBaseline: boolean;
  comparable: boolean;
}) {
  if (run.qualityScore == null) {
    return (
      <TableCell className="text-right">
        <Text as="span" tone="muted">
          —
        </Text>
      </TableCell>
    );
  }
  const value = run.qualityScore * 100;
  const baseValue = baseline.qualityScore != null ? baseline.qualityScore * 100 : null;
  const delta = !isBaseline && baseValue != null ? deltaPercent(value, baseValue) : null;
  const tone = comparable ? deltaTone(delta, "higher-better") : "neutral";
  return (
    <TableCell className="text-right">
      <span className="flex flex-col items-end leading-tight">
        <Text as="span" className="tabular-nums">
          {value.toFixed(0)}%
        </Text>
        {isBaseline ? (
          <Text as="span" variant="meta" tone="muted">
            baseline
          </Text>
        ) : baseValue == null ? null : delta != null && delta !== 0 ? (
          <Text as="span" variant="meta" className={cn("tabular-nums", DELTA_TEXT_TONE[tone])}>
            {signedPercent(delta)}
          </Text>
        ) : (
          <Text as="span" variant="meta" tone="muted">
            no change
          </Text>
        )}
      </span>
    </TableCell>
  );
}
