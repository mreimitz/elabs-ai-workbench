import { useMemo } from "react";
import type { RatingIssue } from "@mcp-token-footprint/shared";
import { formatNumber } from "@mcp-token-footprint/shared";
import { Area, AreaChart, ChartTooltip, Grid, XAxis } from "@elabs-ai/components-charts";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  StatePanel,
  Text,
} from "@elabs-ai/components-ui";
import { InlineError } from "../../components/InlineError";
import { SectionCardTitle } from "../../components/SectionCardTitle";
import type { Loadable } from "../../lib/loadable";
import { loadableData } from "../../lib/loadable";
import { openIssueTrendRows } from "./open-issue-trend";

/**
 * Open issues on this server, over time.
 *
 * The series is derived from the issue list the page already fetched (`useRatingIssues`) — no
 * endpoint, no second request. See `open-issue-trend.ts` for the derivation and, more importantly,
 * for what it CANNOT know: `resolved_at` is cleared on reopen and there is no status-history table,
 * so this is the current state projected backwards, not a record of what was open when. The card
 * says that in its own description rather than letting the line imply a history.
 */
export function OpenIssuesCard({
  state,
  onReload,
}: {
  state: Loadable<RatingIssue[]>;
  onReload: () => void;
}) {
  const issues = loadableData(state);
  const rows = useMemo(() => (issues ? openIssueTrendRows(issues) : []), [issues]);

  const openNow = issues?.filter((issue) => issue.status === "open").length ?? 0;
  const resolved = (issues?.length ?? 0) - openNow;

  return (
    <Card className="flex min-w-0 flex-col">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <SectionCardTitle>Open issues</SectionCardTitle>
            <CardDescription>
              {/* The caveat is only stated when a line is actually drawn — on a server with no
                  issues it would be explaining a limitation of a chart that isn't there. */}
              {rows.length > 1
                ? "Reconstructed from today’s issues — a resolve-then-reopen cycle isn’t visible."
                : "Issues filed against this server by a run’s auto-rating."}
            </CardDescription>
          </div>
          {issues && issues.length > 0 ? (
            <Badge variant={openNow > 0 ? "warning" : "success"} className="tabular-nums">
              {formatNumber(openNow)} open
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-2">
        {state.status === "error" ? (
          <InlineError title="Couldn’t load issues" detail={state.error} onRetry={onReload} />
        ) : rows.length > 1 ? (
          <>
            <div className="min-h-44 w-full min-w-0 flex-1">
              <AreaChart
                accessibleLabel="Open issues over time"
                accessibleDescription={`${formatNumber(openNow)} open today${
                  resolved > 0 ? `, ${formatNumber(resolved)} resolved` : ""
                }.`}
                aspectRatio="auto"
                className="h-full w-full"
                data={rows}
                xDataKey="x"
              >
                <Grid horizontal />
                <Area
                  dataKey="open"
                  fill="var(--chart-2)"
                  fillOpacity={0.25}
                  stroke="var(--chart-2)"
                />
                <XAxis />
                <ChartTooltip />
              </AreaChart>
            </div>
            <Text variant="meta" tone="muted" className="text-pretty">
              {resolved > 0
                ? `${formatNumber(resolved)} of ${formatNumber(issues?.length ?? 0)} resolved so far.`
                : "Nothing resolved yet — the line only falls when an issue is closed."}
            </Text>
          </>
        ) : (
          <StatePanel
            kind="empty"
            title={issues && issues.length > 0 ? "Not enough history" : "No issues"}
            description={
              issues && issues.length > 0
                ? "Every issue on this server was first seen today, so there is no trend to draw yet."
                : "Nothing has been filed against this server. Issues appear here once a run’s auto-rating finds one."
            }
          />
        )}
      </CardContent>
    </Card>
  );
}
