import { Sparkles } from "lucide-react";
import { Badge, Descriptions, DescriptionsItem, Heading, Text } from "@brand/ui";
import { StatusBadge } from "../../components/StatusBadge";
import { deriveIssueLifecycleView } from "../../lib/status";
import { formatDateTime } from "../../lib/format";
import { IssueAssistantMount } from "./IssueAssistantMount";
import { IssueFixesSection } from "./IssueFixesSection";
import { IssueLifecycleActions } from "./IssueLifecycleActions";
import { IssueLinkedRuns } from "./IssueLinkedRuns";
import { IssueVerificationRuns } from "./IssueVerificationRuns";
import { BUCKET_LABELS, type FleetIssue, SEVERITY_META, issueAiAssisted } from "./issue-lib";
import { IssueOccurrencesPanel } from "./IssueOccurrencesPanel";

/**
 * The Issues tab's detail pane (WP5.3 spec §Design) — everything the WP5.1 fixtures carry, surfaced
 * somewhere: identity + lifecycle + severity + AI-assisted provenance, the summary/rationale, the
 * affected-entity breakdown, the occurrences-over-time metrics slice, linked runs, drafted fixes,
 * lifecycle actions, and the "Analyze with Assistant" mount. Read-only except for
 * `IssueLifecycleActions` (the one mutating surface) and the copy button in `IssueFixesSection`.
 */
export function IssueDetail({
  issue,
  onChanged,
  entityLabel,
}: {
  issue: FleetIssue;
  onChanged: () => void;
  entityLabel: (id: string) => string;
}) {
  const severity = SEVERITY_META[issue.severity];
  const affectedIds = [...issue.fleet.affected.servers, ...issue.fleet.affected.skills];
  const hasAffected =
    affectedIds.length > 0 ||
    issue.fleet.affected.tests.length > 0 ||
    issue.fleet.affected.models.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {issueAiAssisted(issue) ? (
            <Badge variant="info" className="gap-1">
              <Sparkles aria-hidden className="size-3" />
              AI-refined
            </Badge>
          ) : null}
          <StatusBadge view={deriveIssueLifecycleView(issue.fleet.lifecycle)} />
          <Badge variant={severity.variant}>{severity.label}</Badge>
          <Badge variant="outline">{BUCKET_LABELS[issue.bucket]}</Badge>
        </div>
        <Heading level={2} className="break-words text-pretty">
          {issue.title}
        </Heading>
        <Text variant="meta" tone="muted">
          {issue.targetKind === "skill" ? "Skill" : "MCP server"} · {issue.targetName}
        </Text>
      </div>

      <Text className="break-words text-pretty">{issue.summary}</Text>

      <div className="flex flex-col gap-1.5">
        <Text variant="meta" tone="muted">
          Affected
        </Text>
        {hasAffected ? (
          <div className="flex flex-wrap gap-1.5">
            {affectedIds.map((id) => (
              <Badge key={id} variant="outline">
                {entityLabel(id)}
              </Badge>
            ))}
            {issue.fleet.affected.tests.map((id) => (
              <Badge key={id} variant="secondary">
                Test {id}
              </Badge>
            ))}
            {issue.fleet.affected.models.map((model) => (
              <Badge key={model} variant="secondary">
                {model}
              </Badge>
            ))}
          </div>
        ) : (
          <Text variant="meta" tone="muted">
            No affected entities recorded.
          </Text>
        )}
      </div>

      <IssueOccurrencesPanel issue={issue} />

      <IssueLinkedRuns issue={issue} />

      <IssueVerificationRuns issue={issue} />

      <IssueFixesSection issue={issue} />

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <IssueLifecycleActions issue={issue} onChanged={onChanged} />
        <IssueAssistantMount issue={issue} />
      </div>

      <Descriptions columns={2}>
        <DescriptionsItem label="First seen">{formatDateTime(issue.fleet.firstSeenAt)}</DescriptionsItem>
        <DescriptionsItem label="Last seen">{formatDateTime(issue.fleet.lastSeenAt)}</DescriptionsItem>
        <DescriptionsItem label="Occurrences">{issue.fleet.occurrenceCount}</DescriptionsItem>
        <DescriptionsItem label="Times seen (per-run)">{issue.timesSeen}</DescriptionsItem>
        <DescriptionsItem label="Cluster key">
          <span className="break-all font-mono text-caption">
            {issue.fleet.clusterKey} (v{issue.fleet.clusterKeyVersion})
          </span>
        </DescriptionsItem>
        <DescriptionsItem label="Base status">{issue.status}</DescriptionsItem>
        {issue.skillVersionId ? (
          <DescriptionsItem label="First seen on skill version">
            <span className="break-all font-mono text-caption">{issue.skillVersionId}</span>
          </DescriptionsItem>
        ) : null}
        {issue.judgeModel ? (
          <DescriptionsItem label="Triage judge">
            {issue.judgeModel}
            {issue.judgeProviderId ? ` (${issue.judgeProviderId})` : ""}
          </DescriptionsItem>
        ) : null}
        {issue.fleet.resolutionNote ? (
          <DescriptionsItem label="Resolution note">{issue.fleet.resolutionNote}</DescriptionsItem>
        ) : null}
        {issue.fleet.resolvedAt ? (
          <DescriptionsItem label="Resolved at">{formatDateTime(issue.fleet.resolvedAt)}</DescriptionsItem>
        ) : null}
      </Descriptions>
    </div>
  );
}
