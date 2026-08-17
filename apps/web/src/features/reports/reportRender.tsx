import type {
  CompatibilityAffectedTool,
  CompatibilityReportModel,
  CompatibilitySeverity,
  CompatibilityTestEntry,
} from "@mcp-token-footprint/shared";
import {
  DETAIL_OPTIONS,
  FINDING_SEVERITIES,
  STATUS_ORDER,
  cleanRationale,
  formatEvidenceValue,
  formatLimit,
  groupExplanations,
  isDetailed,
  outcomeKey,
  shortModelName,
  worstSeverity,
  type DetailLevel,
  type Explanation,
  type StatusKey,
} from "@mcp-token-footprint/shared";
import { Badge, Text } from "@elabs-ai/components-ui";
import { formatNumber } from "../../lib/format";
import { KpiStat } from "../../components/KpiStat";
import { OUTCOME_META, SEVERITY_META } from "../compatibility/meta";
import { EvidenceChip } from "../compatibility/EvidenceChip";

// Print-optimized presentation atoms for the server report. The per-model reasoning is rendered
// INLINE (no popovers/accordions — a PDF is static), and identical results across models are grouped
// into one explanation so the report stays compact while still complete. The pure derivation logic
// (severity ordering, the detail filter, per-model grouping) + figure formatting now live in
// @mcp-token-footprint/shared — ONE source of truth shared by the live tabs, the PDF report, and the
// Markdown export, so they never drift on severity colours/labels or finding grouping. This module
// owns only the @elabs-ai/components-ui rendering; the moved symbols are re-exported below so existing
// `./reportRender` imports keep resolving unchanged.

export {
  DETAIL_OPTIONS,
  FINDING_SEVERITIES,
  STATUS_ORDER,
  cleanRationale,
  formatEvidenceValue,
  formatLimit,
  groupExplanations,
  isDetailed,
  outcomeKey,
  shortModelName,
  worstSeverity,
  type DetailLevel,
  type Explanation,
  type StatusKey,
};

// The outcome chip vocabulary + the leaf EvidenceChip now live in the compatibility feature (the
// owner of that vocabulary) so the live tabs, the PDF report, and the Markdown export never drift.
// Re-exported here so existing `./reportRender` importers (e.g. ServerReportView) keep resolving.
export { OUTCOME_META };
export { EvidenceChip };

/** The per-tool breakdown behind an aggregate server test — offenders (`over`) lead. Static (print). */
export function AffectedToolsList({
  tools,
  limit = 16,
}: { tools: CompatibilityAffectedTool[]; limit?: number }) {
  const offenders = tools.filter((t) => t.over);
  const lead = offenders.length > 0 ? offenders : tools;
  const shown = lead.slice(0, limit);
  const hidden = lead.length - shown.length;
  return (
    <div className="flex flex-col gap-1.5">
      <Text as="span" variant="meta" tone="muted" className="font-medium uppercase tracking-wide">
        {offenders.length > 0 ? `Tools over the limit (${offenders.length})` : "Top contributors"}
      </Text>
      <div className="flex flex-wrap gap-1.5">
        {shown.map((t) => (
          <Badge
            key={t.toolName}
            variant={t.over ? "warning" : "outline"}
            className="font-mono font-normal"
          >
            {/* Show the namespaced string when the count measured it, so the number reconciles. */}
            {t.namespacedName ?? t.toolName} · {formatNumber(t.value)}
            {t.unit ? ` ${t.unit}` : ""}
          </Badge>
        ))}
        {hidden > 0 ? (
          <Text as="span" variant="meta" tone="muted">
            +{hidden} more
          </Text>
        ) : null}
      </div>
    </div>
  );
}

/** Severity-count chips (e.g. "2 Blocker · 1 High"), worst-first. */
export function SeverityTally({
  counts,
}: { counts: Partial<Record<CompatibilitySeverity, number>> }) {
  const chips = FINDING_SEVERITIES.filter((s) => (counts[s] ?? 0) > 0);
  if (chips.length === 0) return null;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {chips.map((s) => (
        <Badge key={s} variant={SEVERITY_META[s].variant} className="tabular-nums">
          {counts[s]} {SEVERITY_META[s].label}
        </Badge>
      ))}
    </span>
  );
}

/** Outcome-count chips across ALL outcomes incl. pass/na (the full ledger tally). */
export function OutcomeTally({ counts }: { counts: CompatibilityTestEntry["statusCounts"] }) {
  const chips = STATUS_ORDER.filter((s) => (counts[s] ?? 0) > 0);
  if (chips.length === 0) return null;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {chips.map((s) => (
        <Badge key={s} variant={OUTCOME_META[s].variant} className="tabular-nums">
          {counts[s]} {OUTCOME_META[s].label}
        </Badge>
      ))}
    </span>
  );
}

// ── Per-model reasoning (grouped) ─────────────────────────────────────────────────────────────────

/**
 * The inline, per-model reasoning + evidence for one test — the R&D core. One block per distinct
 * explanation, listing the models it applies to, the model-specific rationale, measured-vs-threshold,
 * the offending tools (aggregate tests), and the cited evidence with source links.
 */
export function PerModelReasoning({
  entry,
  models,
}: {
  entry: CompatibilityTestEntry;
  models: CompatibilityReportModel[];
}) {
  const byId = new Map(models.map((m) => [m.id, m]));
  const groups: Explanation[] = groupExplanations(entry.results);

  return (
    <div className="flex flex-col gap-2">
      {groups.map((g, i) => {
        const r = g.rep;
        const rationale = cleanRationale(r.rationale);
        const failure =
          r.failureMode && r.failureMode !== "none" ? r.failureMode.replace(/_/g, " ") : null;
        const measured = formatLimit(r.measured.value, r.measured.unit);
        const limit = formatLimit(r.threshold.value, r.threshold.unit);
        return (
          <div
            key={i}
            className="report-avoid-break flex flex-col gap-2 rounded-md border border-border bg-muted/30 p-3"
          >
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant={OUTCOME_META[g.outcome].variant}>
                {OUTCOME_META[g.outcome].label}
              </Badge>
              {g.modelIds.map((id) => (
                <Badge key={id} variant="outline" className="font-normal">
                  {shortModelName(byId.get(id)?.displayName ?? id)}
                </Badge>
              ))}
            </div>
            {failure ? (
              <Text as="span" variant="meta" tone="muted" className="font-mono">
                {failure}
              </Text>
            ) : null}
            {rationale ? <Text variant="body">{rationale}</Text> : null}
            {measured || limit ? (
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {measured ? (
                  <KpiStat orientation="inline" label="Measured" value={measured} />
                ) : null}
                {/* Show just the limit value — the threshold.source is a developer path/note, not prose. */}
                {limit ? <KpiStat orientation="inline" label="Limit" value={limit} /> : null}
              </div>
            ) : null}
            {r.affectedTools && r.affectedTools.length > 0 ? (
              <AffectedToolsList tools={r.affectedTools} />
            ) : null}
            {r.evidence.length > 0 ? (
              <div className="flex flex-col gap-1">
                <Text
                  as="span"
                  variant="meta"
                  tone="muted"
                  className="font-medium uppercase tracking-wide"
                >
                  Evidence
                </Text>
                <div className="flex flex-wrap gap-1.5">
                  {r.evidence.map((ev, j) => (
                    <EvidenceChip key={`${ev.field}:${j}`} evidence={ev} />
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** The full outcome legend chip row (Pass / Blocker / High / Medium / Low / N/A). */
export function OutcomeLegend() {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {STATUS_ORDER.map((s) => (
        <Badge key={s} variant={OUTCOME_META[s].variant}>
          {OUTCOME_META[s].label}
        </Badge>
      ))}
    </span>
  );
}
