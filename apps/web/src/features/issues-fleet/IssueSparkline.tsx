import { Sparkline } from "@brand/charts";
import { Text } from "@brand/ui";
import type { FleetIssue } from "./issue-lib";
import { sparklineValues } from "./issue-lib";

/**
 * The triage list's per-row trend sparkline, fed by `fleet.trend` (WP5.1's derived per-day
 * occurrence counts) — never re-derived here. HONEST with sparse data: `sparklineValues` returns the
 * trend's real points unpadded, so a brand-new cluster with one or two occurrences renders exactly
 * that many marks, not a zero-filled bar chart (loading-states rule). A cluster with NO trend yet
 * (an edge case — the sweep always derives at least one point for a clustered occurrence) reads as a
 * plain em dash rather than an empty/misleading chart.
 */
export function IssueSparkline({ issue }: { issue: FleetIssue }) {
  const values = sparklineValues(issue);
  if (values.length === 0) {
    return (
      <Text variant="meta" tone="muted">
        —
      </Text>
    );
  }
  return (
    <Sparkline
      values={values}
      variant="bar"
      label={`Occurrence trend, ${values.length} day${values.length === 1 ? "" : "s"} of data`}
      width={72}
      height={24}
    />
  );
}
