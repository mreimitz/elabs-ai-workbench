import { ExternalLink, ListFilter } from "lucide-react";
import { Link } from "react-router-dom";
import { Button, Text } from "@elabs-ai/components-ui";
import { FailureEvidence } from "../../components/FailureEvidence";
import { drillDownHref } from "../dashboard/testing/dashboard-url-state";
import { formatDateTime, formatNumber } from "../../lib/format";
import { buildIssueRunFilter, type FleetIssue } from "./issue-lib";

/** Sentence-case a wire category token — mirrors `IssuesPanel.tsx`'s identical helper. */
function humanizeCategory(raw: string): string {
  const words = raw.replace(/[_-]+/g, " ").trim();
  if (words.length === 0) return "";
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}

/**
 * The detail's "linked runs" section (WP5.3 spec §Design) — every contributing run, oldest first,
 * each a direct link into the run console (the SAME `Link to={/testing/runs/:id}` recipe
 * `IssuesPanel.tsx` occurrence rows use — an unambiguous single-run link, not a RunFilter). The
 * header's "Open in feed" button is the RunFilter deep-link (acceptance #3): `buildIssueRunFilter`
 * composes the EXACT same filter object the occurrences chart drills into (`issue-lib.ts`), so the
 * chart and this button never disagree about what "this issue's runs" means.
 */
export function IssueLinkedRuns({ issue }: { issue: FleetIssue }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <Text variant="meta" tone="muted">
          Linked runs ({formatNumber(issue.occurrences.length)})
        </Text>
        <Button asChild variant="outline" size="sm">
          <Link to={drillDownHref(buildIssueRunFilter(issue))}>
            <ListFilter aria-hidden />
            <span>Open in feed</span>
          </Link>
        </Button>
      </div>
      {issue.occurrences.length === 0 ? (
        <Text variant="meta" tone="muted">
          No contributing runs recorded.
        </Text>
      ) : (
        <ul className="flex flex-col gap-2">
          {issue.occurrences.map((occurrence, index) => (
            <li
              key={`${occurrence.runId}:${index}`}
              className="flex min-w-0 flex-col gap-1 rounded-md border border-border bg-muted/20 p-2"
            >
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                <Button asChild variant="link" size="sm" className="h-auto gap-1 p-0">
                  <Link to={`/testing/runs/${occurrence.runId}`}>
                    <span>Run {shortId(occurrence.runId)}</span>
                    <ExternalLink aria-hidden className="size-3 shrink-0" />
                  </Link>
                </Button>
                {occurrence.suiteRunId ? (
                  <Button asChild variant="link" size="sm" className="h-auto gap-1 p-0">
                    <Link to={`/testing/suite-runs/${occurrence.suiteRunId}`}>
                      <span>Suite run {shortId(occurrence.suiteRunId)}</span>
                      <ExternalLink aria-hidden className="size-3 shrink-0" />
                    </Link>
                  </Button>
                ) : null}
                <Text variant="meta" tone="muted" className="shrink-0 tabular-nums">
                  {formatDateTime(occurrence.createdAt)}
                </Text>
                <Text variant="meta" tone="muted" className="shrink-0">
                  {humanizeCategory(occurrence.category)}
                </Text>
                <Text variant="meta" tone="muted" className="min-w-0 truncate" title={occurrence.message}>
                  {occurrence.message}
                </Text>
              </div>
              <FailureEvidence
                toolName={occurrence.toolName}
                sentArguments={occurrence.sentArguments}
                errorMessage={occurrence.errorMessage}
                className="pl-0.5"
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
