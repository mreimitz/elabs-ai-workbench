import { ExternalLink, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { Button, Skeleton, Text } from "@brand/ui";
import { InlineError } from "../../components/InlineError";
import { StatusBadge } from "../../components/StatusBadge";
import { type IssueVerificationRun, listIssueVerificationRuns } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import { deriveStatusView } from "../../lib/status";
import { loadableData, useLoadable } from "../../lib/loadable";
import type { FleetIssue } from "./issue-lib";

function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}

/**
 * The detail's "Verification runs" section (Observability WP5.4) — the fork re-runs the assistant loop
 * launched to PROVE a fix for this issue (each recorded via the `runs_rerun` tool's issue⇆run link
 * mark). A verification run is a normal, gradeable run (D-OB15/AR6): this section is a LINK annotation
 * only, never a grade. Each row links straight into the run console and shows the derived run's live
 * status/outcome (hydrated server-side). Empty until the owner runs the loop and forks a run.
 */
export function IssueVerificationRuns({ issue }: { issue: FleetIssue }) {
  const { state, reload } = useLoadable<IssueVerificationRun[]>(
    () => listIssueVerificationRuns(issue.id),
    [issue.id],
  );
  const runs = loadableData(state);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <ShieldCheck aria-hidden className="size-3.5 text-muted-foreground" />
        <Text variant="meta" tone="muted">
          Verification runs{runs ? ` (${runs.length})` : ""}
        </Text>
      </div>

      {state.status === "loading" ? (
        <Skeleton className="h-9 w-full" />
      ) : state.status === "error" ? (
        <InlineError
          title="Couldn’t load verification runs"
          detail={state.error}
          onRetry={reload}
        />
      ) : runs && runs.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {runs.map((run) => (
            <li
              key={run.runId}
              className="flex min-w-0 flex-col gap-1 rounded-md border border-border bg-muted/20 p-2"
            >
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                <Button asChild variant="link" size="sm" className="h-auto gap-1 p-0">
                  <Link to={`/testing/runs/${run.runId}`}>
                    <span>Run {shortId(run.runId)}</span>
                    <ExternalLink aria-hidden className="size-3 shrink-0" />
                  </Link>
                </Button>
                <StatusBadge view={deriveStatusView(run.outcome ?? run.status)} />
                {run.sourceRunId ? (
                  <Text variant="meta" tone="muted" className="shrink-0">
                    forked from {shortId(run.sourceRunId)}
                  </Text>
                ) : null}
                <Text variant="meta" tone="muted" className="shrink-0 tabular-nums">
                  {formatDateTime(run.at)}
                </Text>
              </div>
              {run.note ? (
                <Text
                  variant="meta"
                  tone="muted"
                  className="min-w-0 truncate"
                  title={run.note}
                >
                  {run.note}
                </Text>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <Text variant="meta" tone="muted">
          No verification runs yet — analyze the issue with the assistant to draft a fix and prove it
          with a re-run.
        </Text>
      )}
    </div>
  );
}
