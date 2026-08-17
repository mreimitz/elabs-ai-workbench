import { useMemo } from "react";
import type {
  CompatibilityAffectedTool,
  CompatibilityCell,
  CompatibilityModelRef,
  CompatibilityResult,
  CompatibilityVerdict,
} from "@mcp-token-footprint/shared";
import {
  Badge,
  Button,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Text,
  cn,
} from "@elabs-ai/components-ui";
import { formatBytes, formatNumber } from "../../lib/format";
import { KpiStat } from "../../components/KpiStat";
import { BAND_META, SEVERITY_META, VERDICT_META } from "./meta";
import { EvidenceChip } from "./EvidenceChip";

/** Format a measured/limit value for the drill-down stat row (humanizes raw bytes). */
function formatStat(value: string | number | boolean | null, unit?: string): string {
  if (value === null) return "";
  if (unit === "bytes" && typeof value === "number") return formatBytes(value);
  const base =
    typeof value === "number"
      ? formatNumber(value)
      : typeof value === "boolean"
        ? value
          ? "yes"
          : "no"
        : value;
  return unit ? `${base} ${unit}` : base;
}

/**
 * The cell drill-down (WP 5.4): a right-side `Sheet` over the heatmap that opens when a cell is
 * clicked. It explains *why* a (subject × model) cell reads the colour it does — the failing/warning
 * tests first, each with its cited evidence + recommendation. Read-only; every value is engine output.
 *
 * Recommendations are DEDUPED across results (the same fix often covers several failing tests).
 */

export type CompatibilityCellSheetProps = {
  /** The clicked cell, or `null` when the sheet is closed. */
  cell: CompatibilityCell | null;
  /** Display label of the cell's subject (server name or tool name). */
  subjectLabel: string;
  /** The model column the cell belongs to. */
  model: CompatibilityModelRef | null;
  /** Jump to a tool's breakdown (server detail → Tools tab). Omitted when the server is unknown. */
  onOpenTool?: (toolName: string) => void;
  onClose: () => void;
};

/** Concern-first ordering: real findings (fail → warn) before pass/na noise. */
const VERDICT_RANK: Record<CompatibilityVerdict, number> = { fail: 0, warn: 1, pass: 2, na: 3 };

export function CompatibilityCellSheet({
  cell,
  subjectLabel,
  model,
  onOpenTool,
  onClose,
}: CompatibilityCellSheetProps) {
  const open = cell !== null;

  const sortedResults = useMemo<CompatibilityResult[]>(() => {
    if (!cell) return [];
    return [...cell.results].sort((a, b) => {
      const byVerdict = VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict];
      if (byVerdict !== 0) return byVerdict;
      return a.userFacingName.localeCompare(b.userFacingName);
    });
  }, [cell]);

  // Dedupe recommendations across the failing/warning results: one fix often resolves several tests.
  const dedupedRecommendations = useMemo<string[]>(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const result of sortedResults) {
      if (result.verdict === "pass" || result.verdict === "na") continue;
      const rec = result.recommendation.trim();
      if (!rec || seen.has(rec)) continue;
      seen.add(rec);
      out.push(rec);
    }
    return out;
  }, [sortedResults]);

  const concernCount = sortedResults.filter(
    (r) => r.verdict === "fail" || r.verdict === "warn",
  ).length;

  return (
    <Sheet open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      {/* p-0 + a dedicated header band so the title clears the top edge and the close (×) button
          (CP5), and the header + body share one 20px gutter. */}
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-xl"
      >
        <SheetHeader className="border-b border-border px-5 pb-4 pt-5 pr-12">
          <SheetTitle className="flex min-w-0 flex-wrap items-center gap-2">
            {cell ? (
              <>
                <span
                  aria-hidden
                  className={cn("size-2.5 shrink-0 rounded-full", BAND_META[cell.band].dot)}
                />
                <span className="min-w-0 truncate">{subjectLabel}</span>
                <span className="text-muted-foreground">·</span>
                <span className="min-w-0 truncate font-mono">
                  {model?.displayName ?? cell.modelId}
                </span>
              </>
            ) : (
              "Compatibility detail"
            )}
          </SheetTitle>
          <SheetDescription>
            {cell ? (
              <>
                Score{" "}
                <span className="tabular-nums font-medium text-foreground">
                  {cell.score === null ? "—" : cell.score}
                </span>
                {" · "}
                {concernCount > 0
                  ? `${concernCount} concern${concernCount === 1 ? "" : "s"} on this model`
                  : "No concerns on this model"}
                . Findings show their cited evidence and the fix.
              </>
            ) : (
              "Pick a heatmap cell to see why it reads the way it does."
            )}
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {cell ? (
            <div className="flex flex-col gap-5">
              {dedupedRecommendations.length > 0 ? (
                <section className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 p-3">
                  <Text variant="meta" tone="muted" className="font-medium uppercase tracking-wide">
                    What to do
                  </Text>
                  <ul className="flex flex-col gap-1.5">
                    {dedupedRecommendations.map((rec) => (
                      <li key={rec} className="flex gap-2">
                        <span
                          aria-hidden
                          className="mt-1 size-1.5 shrink-0 rounded-full bg-primary"
                        />
                        <Text variant="body">{rec}</Text>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <section className="flex flex-col gap-3">
                <Text variant="meta" tone="muted" className="font-medium uppercase tracking-wide">
                  Tests ({sortedResults.length})
                </Text>
                {sortedResults.length === 0 ? (
                  <Text variant="body" tone="muted">
                    No applicable tests scored this cell.
                  </Text>
                ) : (
                  <ul className="flex flex-col gap-3">
                    {sortedResults.map((result) => (
                      <li key={`${result.testId}:${result.subjectId}`}>
                        <ResultCard result={result} onOpenTool={onOpenTool} />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ResultCard({
  result,
  onOpenTool,
}: {
  result: CompatibilityResult;
  onOpenTool?: (toolName: string) => void;
}) {
  const verdict = VERDICT_META[result.verdict];
  const severity = SEVERITY_META[result.severity];
  const muted = result.verdict === "pass" || result.verdict === "na";
  const affected = result.affectedTools ?? [];

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-md border border-border p-3",
        muted ? "bg-card/40" : "bg-card",
      )}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Text as="span" className="min-w-0 truncate font-medium">
          {result.userFacingName}
        </Text>
        <Badge variant={verdict.variant}>{verdict.label}</Badge>
        {result.severity !== "na" ? (
          <Badge variant={severity.variant}>{severity.label}</Badge>
        ) : null}
        {result.failureMode && result.verdict !== "pass" && result.verdict !== "na" ? (
          <Badge variant="outline" className="font-mono font-normal">
            {result.failureMode}
          </Badge>
        ) : null}
      </div>

      {result.rationale ? <Text variant="body">{result.rationale}</Text> : null}

      {(() => {
        const measured = formatStat(result.measured.value, result.measured.unit);
        const limit = formatStat(result.threshold.value, result.threshold.unit);
        if (!measured && !limit) return null;
        return (
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {measured ? <KpiStat orientation="inline" label="Measured" value={measured} /> : null}
            {limit ? <KpiStat orientation="inline" label="Limit" value={limit} /> : null}
          </div>
        );
      })()}

      {result.evidence.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {result.evidence.map((evidence, index) => (
            <EvidenceChip key={`${evidence.field}:${index}`} evidence={evidence} />
          ))}
        </div>
      ) : null}

      {affected.length > 0 && !muted ? (
        <AffectedToolLinks tools={affected} onOpenTool={onOpenTool} />
      ) : null}
    </div>
  );
}

/**
 * The tools behind an aggregate finding, each linking to its breakdown (S20). Offenders (`over`) lead;
 * clicking navigates to the tool's server detail. Without a nav handler each is static text — never a
 * dead button.
 */
function AffectedToolLinks({
  tools,
  onOpenTool,
  limit = 12,
}: {
  tools: CompatibilityAffectedTool[];
  onOpenTool?: (toolName: string) => void;
  limit?: number;
}) {
  const offenders = tools.filter((tool) => tool.over);
  const shown = (offenders.length > 0 ? offenders : tools).slice(0, limit);
  const hidden = (offenders.length > 0 ? offenders.length : tools.length) - shown.length;
  return (
    <div className="flex flex-col gap-1.5">
      <Text as="span" variant="meta" tone="muted" className="font-medium uppercase tracking-wide">
        {offenders.length > 0 ? `Tools over the limit (${offenders.length})` : "Top contributors"}
      </Text>
      <div className="flex flex-wrap gap-1.5">
        {shown.map((tool) => {
          const detail = `${formatNumber(tool.value)}${tool.unit ? ` ${tool.unit}` : ""}`;
          const label = `${tool.namespacedName} · ${detail}`;
          return onOpenTool ? (
            <Button
              key={tool.toolName}
              variant="outline"
              size="sm"
              className="h-auto py-0.5 font-mono font-normal"
              onClick={() => onOpenTool(tool.toolName)}
            >
              {label}
            </Button>
          ) : (
            <Badge key={tool.toolName} variant="outline" className="font-mono font-normal">
              {label}
            </Badge>
          );
        })}
        {hidden > 0 ? (
          <Text as="span" variant="meta" tone="muted">
            +{hidden} more
          </Text>
        ) : null}
      </div>
    </div>
  );
}

/** A labelled measured/limit value in the drill-down (digits aligned with tabular-nums). */

/** One cited limit: field = value, with a source link (if any) and a verified/estimated signal. */
