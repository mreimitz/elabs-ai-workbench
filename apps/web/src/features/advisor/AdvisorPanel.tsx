import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { AdvisorInsufficientData, AdvisorReportQuery } from "@mcp-token-footprint/shared";
import { Badge, Button, EmptyState, Skeleton, Text, cn } from "@elabs-ai/components-ui";
import { CircleHelp, ExternalLink, Lightbulb } from "lucide-react";
import { InlineError } from "../../components/InlineError";
import { getAdvisorReport } from "../../lib/api";
import { formatDateTime, formatNumber } from "../../lib/format";
import { useLoadable } from "../../lib/loadable";
import { advisorRuleLabel } from "./advisor-format";
import { RecommendationCard } from "./RecommendationCard";

/**
 * AdvisorPanel — the ONE advisor rendering, shared by the `/advisor` route and the inline panels on
 * the MCP-server detail view and the Environments list.
 * =============================================================================================
 * Owns nothing but the fetch of `GET /api/advisor/report` for one scope and the four states it can
 * settle into. The states are kept genuinely distinct (`.claude/rules/loading-states.md`):
 *
 *   loading            → layout-shaped `Skeleton` rows (never a spinner that collapses the layout).
 *   error              → `InlineError` + retry. A failed fetch is NEVER shown as "no advice".
 *   not enough data    → an honest `EmptyState` naming what is missing, followed by the API's own
 *                        per-rule reasons verbatim. This is the case the advisor plan calls out:
 *                        an empty list must never be passed off as "all good".
 *   recommendations    → the cards, plus (when the report also carries gaps) the gaps below them, so
 *                        a partially-blind report never looks complete.
 *
 * There is no write path here of any kind — the advisor is a read model and the app never
 * auto-applies a recommendation.
 */
export type AdvisorPanelProps = {
  /** The scope to report on. `server`/`scenario` MUST carry an id; `fleet` must not. */
  query: AdvisorReportQuery;
  /** What the report is about, in words — used for the list's accessible name and the empty copy. */
  scopeLabel: string;
  /** Deep link to the full `/advisor` report for this scope. Omitted on the `/advisor` route itself. */
  fullReportHref?: string;
  /** Layout-only classes for the panel wrapper. */
  className?: string;
};

export function AdvisorPanel({ query, scopeLabel, fullReportHref, className }: AdvisorPanelProps) {
  const { state, reload } = useLoadable(
    () => getAdvisorReport(query),
    [query.scope, query.id],
  );

  if (state.status === "loading") {
    return (
      <div className={cn("flex flex-col gap-3", className)} aria-busy="true">
        <Skeleton className="h-5 w-64" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <InlineError
        className={className}
        title="Couldn’t load advisor recommendations"
        detail={state.error}
        onRetry={reload}
      />
    );
  }

  const report = state.data;
  const { recommendations, insufficientData } = report;

  const fullReportLink = fullReportHref ? (
    <Button asChild variant="outline" size="sm">
      <Link to={fullReportHref}>
        <ExternalLink aria-hidden />
        <span>Open full report</span>
      </Link>
    </Button>
  ) : null;

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {/* ── Provenance row. `advisorVersion` is stated because reports produced under different
          versions are never silently compared (conventions.md invariant 2). ── */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">
            {`${formatNumber(recommendations.length)} ${
              recommendations.length === 1 ? "recommendation" : "recommendations"
            }`}
          </Badge>
          {insufficientData.length > 0 ? (
            <Badge variant="outline">
              {`${formatNumber(insufficientData.length)} data ${
                insufficientData.length === 1 ? "gap" : "gaps"
              }`}
            </Badge>
          ) : null}
          <Text variant="meta" tone="muted" className="tabular-nums">
            Advisor v{formatNumber(report.advisorVersion)} · generated{" "}
            {formatDateTime(report.generatedAt)}
          </Text>
        </div>
        {fullReportLink ? <div className="shrink-0">{fullReportLink}</div> : null}
      </div>

      {recommendations.length === 0 ? (
        <NoRecommendations
          scopeLabel={scopeLabel}
          gaps={insufficientData}
          action={fullReportLink}
        />
      ) : (
        <>
          <ul
            aria-label={`Advisor recommendations for ${scopeLabel}`}
            className="flex flex-col gap-3"
          >
            {recommendations.map((recommendation) => (
              <RecommendationCard key={recommendation.id} recommendation={recommendation} />
            ))}
          </ul>
          {insufficientData.length > 0 ? <InsufficientDataList gaps={insufficientData} /> : null}
        </>
      )}
    </div>
  );
}

/**
 * The honest empty state. Two genuinely different situations, told apart rather than blended:
 *   • the report carries gaps → "Not enough data yet", with the API's own reasons printed below it;
 *   • the report carries none → "No recommendations", stated as "no rule matched", explicitly NOT
 *     as "everything is fine" (the advisor cannot know that, and must not imply it).
 */
function NoRecommendations({
  scopeLabel,
  gaps,
  action,
}: {
  scopeLabel: string;
  gaps: AdvisorInsufficientData[];
  action: ReactNode;
}) {
  if (gaps.length > 0) {
    return (
      <div className="flex flex-col gap-3">
        <EmptyState
          icon={<CircleHelp aria-hidden />}
          title="Not enough data yet"
          description={`The advisor ran over ${scopeLabel} but its rules are missing inputs, so it has nothing it can honestly recommend. What is missing is listed below.`}
          actions={action}
        />
        <InsufficientDataList gaps={gaps} />
      </div>
    );
  }

  return (
    <EmptyState
      icon={<Lightbulb aria-hidden />}
      title="No recommendations"
      description={`The deterministic rules that apply to ${scopeLabel} ran and none of them matched. That means no rule found something to flag — not that nothing could be improved.`}
      actions={action}
    />
  );
}

/** The report's `insufficientData` entries, verbatim. The API states the gap; the UI does not
 *  paraphrase it (and never invents one of its own). */
function InsufficientDataList({ gaps }: { gaps: AdvisorInsufficientData[] }) {
  return (
    <section className="flex flex-col gap-1.5 rounded-md border border-border bg-card p-3">
      <div className="flex items-center gap-1.5">
        <CircleHelp aria-hidden className="size-3.5 text-muted-foreground" />
        <Text variant="meta" tone="muted" className="font-medium uppercase tracking-wide">
          Not enough data
        </Text>
      </div>
      <ul aria-label="Advisor rules with missing data" className="flex flex-col gap-1.5">
        {gaps.map((gap) => (
          <li key={`${gap.ruleId}:${gap.reason}`} className="flex min-w-0 flex-col">
            <Text variant="meta" className="font-medium">
              {advisorRuleLabel(gap.ruleId)}
            </Text>
            <Text variant="meta" tone="muted" className="break-words text-pretty">
              {gap.reason}
            </Text>
          </li>
        ))}
      </ul>
    </section>
  );
}
