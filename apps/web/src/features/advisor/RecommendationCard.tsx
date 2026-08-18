import { Link } from "react-router-dom";
import type { AdvisorEvidenceKind, AdvisorRecommendation } from "@mcp-token-footprint/shared";
import { Badge, Button, Text } from "@elabs-ai/components-ui";
import {
  Boxes,
  ExternalLink,
  PlayCircle,
  ScanLine,
  Server,
  Sparkles,
  TrendingDown,
  Wrench,
} from "lucide-react";
import { advisorEvidenceHref, advisorEvidenceKindLabel } from "./advisor-evidence";
import { ADVISOR_SEVERITY_META, advisorRuleLabel, formatAdvisorSavings } from "./advisor-format";

/**
 * One advisor recommendation, rendered as an evidenced suggestion — never an action.
 * =============================================================================================
 * The card is deliberately shaped around the README's four invariants, in reading order:
 *   1. severity chip + title — what the advisor is flagging;
 *   2. the ESTIMATE block — labelled as an estimate in the sentence itself (not only by a chip),
 *      with the rule's own `basis` printed underneath so the number is reproducible by hand;
 *   3. assumptions — what the suggestion takes for granted, stated plainly;
 *   4. evidence — the scans/runs/tools/servers it was derived from, as real links.
 * There is no "apply" affordance anywhere on it, by design: the app never auto-applies advice.
 *
 * Bordered `<li>` on the flat surface (the `IssuesPanel` recipe) rather than a `Card`, so a panel
 * embedded inside an existing Card/tab body never nests cards.
 */
export function RecommendationCard({ recommendation }: { recommendation: AdvisorRecommendation }) {
  const severity = ADVISOR_SEVERITY_META[recommendation.severity];
  const savings = recommendation.savings ? formatAdvisorSavings(recommendation.savings) : null;

  return (
    <li className="flex flex-col gap-2 rounded-md border border-border bg-muted/20 p-3">
      {/* Chip row — severity is this feature's own dimension → semantic-variant Badge + TEXT label
          (never colour alone), alongside the rule that produced the finding. */}
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <Badge variant={severity.variant}>{severity.label}</Badge>
        <Badge variant="outline">{advisorRuleLabel(recommendation.ruleId)}</Badge>
      </div>

      <Text className="break-words font-medium text-pretty">{recommendation.title}</Text>
      <Text variant="meta" tone="muted" className="break-words text-pretty">
        {recommendation.detail}
      </Text>

      {/* ── The estimate. Present only when the rule could name a defensible number AND its basis. ── */}
      {savings ? (
        <div className="rounded-md border border-border bg-card p-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <TrendingDown aria-hidden className="size-3.5 text-muted-foreground" />
            <Text variant="meta" tone="muted" className="font-medium uppercase tracking-wide">
              Estimated saving
            </Text>
            {/* The word "estimate" appears in the chip AND in the sentence below, so the figure can
                never be read as a measurement — README invariant 4. */}
            <Badge variant="info">Estimate</Badge>
          </div>
          <Text className="mt-1 font-medium tabular-nums">{savings.sentence}</Text>
          <Text variant="meta" tone="muted" className="mt-1 break-words text-pretty">
            How it was estimated: {savings.basis}
          </Text>
        </div>
      ) : null}

      {/* ── Assumptions — what the suggestion takes for granted. ── */}
      {recommendation.assumptions.length > 0 ? (
        <div className="flex flex-col gap-1">
          <Text variant="meta" tone="muted" className="font-medium uppercase tracking-wide">
            Assumptions
          </Text>
          <ul className="flex list-disc flex-col gap-0.5 pl-5">
            {recommendation.assumptions.map((assumption) => (
              <li key={assumption}>
                <Text variant="meta" tone="muted" className="break-words text-pretty">
                  {assumption}
                </Text>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* ── Evidence — the drill-through path. A recommendation always carries at least one. ── */}
      <div className="flex flex-col gap-1">
        <Text variant="meta" tone="muted" className="font-medium uppercase tracking-wide">
          Evidence
        </Text>
        <ul
          aria-label={`Evidence for ${recommendation.title}`}
          className="flex flex-wrap items-center gap-x-3 gap-y-1"
        >
          {recommendation.evidence.map((ref) => (
            <li key={`${ref.kind}:${ref.id}`} className="flex min-w-0 items-center">
              <EvidenceLink evidence={ref} />
            </li>
          ))}
        </ul>
      </div>
    </li>
  );
}

const EVIDENCE_ICONS: Record<AdvisorEvidenceKind, typeof Server> = {
  server: Server,
  scan: ScanLine,
  tool_scan: Wrench,
  run: PlayCircle,
  scenario: Boxes,
  skill: Sparkles,
};

/** One evidence ref. Resolvable → a real router link; otherwise plain labelled text (never a link
 *  that quietly goes nowhere). */
function EvidenceLink({
  evidence,
}: {
  evidence: AdvisorRecommendation["evidence"][number];
}) {
  const href = advisorEvidenceHref(evidence);
  const kindLabel = advisorEvidenceKindLabel(evidence.kind);
  const Icon = EVIDENCE_ICONS[evidence.kind] ?? ScanLine;

  if (!href) {
    return (
      <Text variant="meta" tone="muted" className="min-w-0 truncate">
        {kindLabel}: {evidence.label}
      </Text>
    );
  }

  return (
    <Button asChild variant="link" size="sm" className="h-auto max-w-full gap-1 p-0">
      <Link to={href}>
        <Icon aria-hidden className="size-3 shrink-0" />
        <span className="min-w-0 truncate">
          {kindLabel}: {evidence.label}
        </span>
        <ExternalLink aria-hidden className="size-3 shrink-0" />
      </Link>
    </Button>
  );
}
