import { Link } from "react-router-dom";
import type {
  AssertionRef,
  AssertionResult,
  AssertionResultStatus,
} from "@mcp-token-footprint/shared";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  StatusBadge,
  Text,
  type Status,
} from "@elabs-ai/components-ui";
import { ExternalLink } from "lucide-react";

/**
 * WP 5.1 — validation-gate assertion results on the run console. Renders the per-assertion pass/fail/
 * unevaluable outcomes the API evaluated from the run's trace alignment (D4: read-only, no execution).
 * A failed gate/route deep-links to its skill (`/skills/:skillId`) — the Trace tab is component-state,
 * not routed (WP 2.3), so the link opens the skill and the row notes which run to pick there.
 */

/** Map the assertion status onto the design-system's canonical execution `Status`. */
const STATUS_MAP: Record<AssertionResultStatus, Status> = {
  pass: "complete",
  fail: "failed",
  unevaluable: "skipped",
};

/** Label to display in the chip — assertion's own vocabulary, not design-system status word. */
const STATUS_LABEL: Record<AssertionResultStatus, string> = {
  pass: "Pass",
  fail: "Fail",
  unevaluable: "Unevaluable",
};

/** A human label for the echoed assertion (ids only — the console has no skill-name lookup here). */
function assertionLabel(assertion: AssertionRef): string {
  switch (assertion.kind) {
    case "skillGate":
      return `Gate — node "${assertion.nodeId}" expect ${assertion.expect}`;
    case "skillRoute":
      return `Route — gatekeeper "${assertion.gatekeeperId}" → edge "${assertion.expectedEdgeId}"`;
    case "noFractures":
      return "No fractures across attached skills";
  }
}

/** The skill a gate/route assertion targets (for the deep link), or undefined for noFractures. */
function skillIdOf(assertion: AssertionRef): string | undefined {
  return assertion.kind === "noFractures" ? undefined : assertion.skillId;
}

export function AssertionResults(props: { results: AssertionResult[]; runId: string }) {
  const { results, runId } = props;
  if (results.length === 0) return null;

  const failed = results.filter((r) => r.status === "fail").length;
  const unevaluable = results.filter((r) => r.status === "unevaluable").length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between gap-2 text-subtitle">
          <span>Gate assertions</span>
          <Badge
            variant={failed > 0 ? "destructive" : "secondary"}
            className="tabular-nums font-normal"
          >
            {failed > 0
              ? `${failed} failed`
              : unevaluable > 0
                ? `${results.length - unevaluable} passed · ${unevaluable} unevaluable`
                : `${results.length} passed`}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-2">
          {results.map((result, index) => {
            const skillId = skillIdOf(result.assertion);
            return (
              <li
                key={index}
                className="flex flex-col gap-1 rounded-md border border-border bg-muted/20 px-2.5 py-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate font-medium">
                    {assertionLabel(result.assertion)}
                  </span>
                  <Badge
                    variant={
                      result.status === "pass"
                        ? "secondary"
                        : result.status === "fail"
                          ? "destructive"
                          : "secondary"
                    }
                    className="shrink-0 font-normal"
                  >
                    {STATUS_LABEL[result.status]}
                  </Badge>
                </div>
                <Text variant="meta" tone="muted" className="break-words">
                  {result.reason}
                </Text>
                {skillId ? (
                  <Text variant="meta" tone="muted" className="flex items-center gap-1">
                    <Link
                      to={`/skills/${skillId}`}
                      className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground"
                      title={`Open this skill, then select the Trace tab and pick run ${runId}`}
                    >
                      Open skill
                      <ExternalLink className="size-3" aria-hidden />
                    </Link>
                    <span>· Trace tab, run {runId.slice(0, 8)}…</span>
                  </Text>
                ) : null}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
