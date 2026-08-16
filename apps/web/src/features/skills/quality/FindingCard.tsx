import type { QualityFinding } from "@mcp-token-footprint/shared";
import { Badge, Button, Card, Text, Tooltip, TooltipContent, TooltipTrigger } from "@brand/ui";
import { ArrowUpRight, HelpCircle, Wrench } from "lucide-react";
import { guideAnchorFor, SEVERITY_META } from "./quality-meta";

export type FindingCardProps = {
  finding: QualityFinding;
  /** Open the review-and-apply flow for this finding's `fix` ops. Omitted ⇒ no apply affordance (no
   *  `fix`, or the graph/version needed to draft the edit isn't loaded). */
  onApplyFix?: (finding: QualityFinding) => void;
  /** Best-effort anchor deep-link: jump to the Design tab (cross-tab node selection isn't wired, so
   *  the anchor's heading path + line range are surfaced here and this just switches tabs). Only
   *  offered for an anchored finding. */
  onOpenDesign?: () => void;
};

/**
 * One quality finding (WP 4.3): a severity badge + the rule id, the human-readable message, the
 * SKILL.md anchor (heading path + line range) when present, a "Why?" affordance revealing the
 * authoring-guide reference (`docs/skill-authoring.md#<ruleId>` — no in-app docs route yet, so it's
 * shown as the repo path), and — when the finding carries a `fix` and apply is possible — a
 * "Review & apply fix…" button that routes the ops through the normal edits/save flow (never
 * auto-applied). An anchored finding also offers "View in Design".
 */
export function FindingCard({ finding, onApplyFix, onOpenDesign }: FindingCardProps) {
  const meta = SEVERITY_META[finding.severity];
  const SeverityIcon = meta.icon;
  const guideAnchor = guideAnchorFor(finding.ruleId);
  const hasFix = (finding.fix?.length ?? 0) > 0;
  const headingPath = finding.anchor?.headingPath.join(" › ");

  return (
    <Card
      className="flex flex-col gap-2 p-3"
      data-testid="quality-finding"
      data-rule={finding.ruleId}
      data-severity={finding.severity}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={meta.badgeVariant} className="gap-1">
          <SeverityIcon aria-hidden className="size-3.5" />
          {meta.label}
        </Badge>
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs break-all">
          {finding.ruleId}
        </code>
      </div>

      <Text className="break-words">{finding.message}</Text>

      {finding.anchor ? (
        <Text variant="meta" tone="muted" className="break-words">
          <span className="font-mono">{headingPath || "(document root)"}</span>
          <span className="tabular-nums">
            {" · lines "}
            {finding.anchor.startLine}–{finding.anchor.endLine}
          </span>
        </Text>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {/* "Why?" — the authoring-guide reference. No in-app docs route yet (a future platform WP), so
            the tooltip surfaces the exact repo file path/anchor as reference rather than a live link. */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="link"
              size="sm"
              className="h-auto gap-1 p-0 text-xs"
              data-testid="quality-why"
            >
              <HelpCircle aria-hidden className="size-3.5" />
              Why?
            </Button>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            <span className="block">Authoring-guide rationale for this rule:</span>
            <code className="mt-1 block break-all text-xs">{guideAnchor}</code>
          </TooltipContent>
        </Tooltip>

        {finding.anchor && onOpenDesign ? (
          <Button variant="ghost" size="sm" onClick={onOpenDesign}>
            <ArrowUpRight aria-hidden className="size-3.5" />
            View in Design
          </Button>
        ) : null}

        {hasFix && onApplyFix ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onApplyFix(finding)}
            data-testid="quality-apply-fix"
          >
            <Wrench aria-hidden className="size-3.5" />
            Review &amp; apply fix…
          </Button>
        ) : null}
      </div>
    </Card>
  );
}
