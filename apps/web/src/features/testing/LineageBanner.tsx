import { Link } from "react-router-dom";
import type { RunForkRef } from "@mcp-token-footprint/shared";
import { Badge, Button, Text } from "@elabs-ai/components-ui";
import { GitFork } from "lucide-react";

/** Short id for display — the run ids are nanoids; the first 8 chars are plenty to recognize. */
function shortId(id: string): string {
  return id.slice(0, 8);
}

/**
 * Observability (roadmap/observability/, WP3.3, D-OB18) — the run console's fork LINEAGE banner, shown
 * in BOTH directions:
 *  - child → parent: a DERIVED run says "Forked from run … at step …" and links back to its parent.
 *  - parent → child: a run that has been forked shows a "forks" indicator listing its derived runs.
 * Additive + brand-ui only; renders nothing for an ordinary, un-forked run.
 */
export function LineageBanner(props: {
  derivedFromRunId?: string;
  forkStepId?: string;
  forks?: RunForkRef[];
  /** Optional Compare pre-seed: parent vs derived (D-OB18). */
  onCompareWithParent?: () => void;
}) {
  const { derivedFromRunId, forkStepId, forks, onCompareWithParent } = props;
  const hasForks = (forks?.length ?? 0) > 0;
  if (!derivedFromRunId && !hasForks) return null;

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
      {derivedFromRunId ? (
        <div className="flex flex-wrap items-center gap-2">
          <GitFork className="size-4 text-muted-foreground" aria-hidden />
          <Text variant="caption" className="text-muted-foreground">
            Forked from run{" "}
            <Link
              to={`/testing/runs/${derivedFromRunId}`}
              className="font-medium text-foreground underline underline-offset-2"
            >
              {shortId(derivedFromRunId)}
            </Link>
            {forkStepId ? " at a step" : " (whole run)"}.
          </Text>
          {onCompareWithParent ? (
            <Button variant="outline" size="sm" onClick={onCompareWithParent}>
              Compare with parent
            </Button>
          ) : null}
        </div>
      ) : null}

      {hasForks ? (
        <div className="flex flex-wrap items-center gap-2">
          <GitFork className="size-4 text-muted-foreground" aria-hidden />
          <Text variant="caption" className="text-muted-foreground">
            Forked into
          </Text>
          <Badge variant="secondary" className="tabular-nums">
            {forks!.length}
          </Badge>
          <div className="flex flex-wrap items-center gap-1.5">
            {forks!.map((fork) => (
              <Link
                key={fork.runId}
                to={`/testing/runs/${fork.runId}`}
                className="text-caption font-medium text-foreground underline underline-offset-2"
              >
                {shortId(fork.runId)}
              </Link>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
