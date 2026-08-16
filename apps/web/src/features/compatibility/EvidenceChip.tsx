import type { CompatibilityEvidence } from "@mcp-token-footprint/shared";
import { formatEvidenceValue } from "@mcp-token-footprint/shared";
import { Badge } from "@brand/ui";
import { ExternalLink } from "lucide-react";
import { CONFIDENCE_META } from "./meta";

/**
 * One cited limit/measurement chip: `field = value`, an optional confidence signal
 * (verified/estimated), and a source link when present. The single shared version of what used to
 * be three near-identical `EvidenceChip` copies (CompatibilityTests, CompatibilityCellSheet,
 * reportRender). Long prose values are capped so the pill stays a pill; the full text is on hover.
 */
export function EvidenceChip({ evidence }: { evidence: CompatibilityEvidence }) {
  const confidence = evidence.confidence ? CONFIDENCE_META[evidence.confidence] : undefined;
  const variant = confidence?.variant ?? "outline";
  const value = formatEvidenceValue(evidence.value);
  const display = value.length > 72 ? `${value.slice(0, 72)}…` : value;
  const body = (
    <span className="inline-flex max-w-full items-baseline gap-1">
      <span className="shrink-0 text-muted-foreground">{evidence.field}</span>
      <span
        className="min-w-0 break-words font-medium tabular-nums"
        title={value === display ? undefined : value}
      >
        {display}
      </span>
      {confidence ? (
        <span className="shrink-0 text-muted-foreground">· {confidence.label}</span>
      ) : null}
      {evidence.sourceUrl ? (
        <ExternalLink aria-hidden className="size-3 shrink-0 self-center" />
      ) : null}
    </span>
  );
  if (evidence.sourceUrl) {
    return (
      <a
        href={evidence.sourceUrl}
        target="_blank"
        rel="noreferrer"
        className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Badge variant={variant}>{body}</Badge>
      </a>
    );
  }
  return <Badge variant={variant}>{body}</Badge>;
}
