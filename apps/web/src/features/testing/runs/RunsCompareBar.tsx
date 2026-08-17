import { Button, Card, CardContent, Text } from "@elabs-ai/components-ui";
import { GitCompareArrows, Layers, Trash2 } from "lucide-react";

/**
 * The multi-select action bar — "Compare runs" (≥2 runs of a SINGLE test across environments) and/or
 * "Compare suites" (≥2 suite runs), plus an optional "Delete" for the current selection. Extracted from
 * the Runs feed so the suite-run console's Runs tab reuses the exact same affordance + copy (the console
 * passes `suiteCount={0}` and no `onDelete`, so only the run-compare half shows). Renders nothing when
 * nothing is selected.
 */
export function RunsCompareBar({
  runCount,
  canCompare,
  multiTest,
  suiteCount,
  onCompareRuns,
  onCompareSuites,
  onClear,
  onDelete,
  deleting,
}: {
  runCount: number;
  canCompare: boolean;
  multiTest: boolean;
  suiteCount: number;
  onCompareRuns: () => void;
  onCompareSuites: () => void;
  onClear: () => void;
  /** When provided, a destructive "Delete" button removes the current selection (Runs feed only). */
  onDelete?: () => void;
  /** True while a delete is in flight — disables the Delete button. */
  deleting?: boolean;
}) {
  if (runCount === 0 && suiteCount === 0) return null;
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <Text className="font-medium">
            {runCount > 0 ? (
              <span>
                <span className="tabular-nums">{runCount}</span> run{runCount === 1 ? "" : "s"}
              </span>
            ) : null}
            {runCount > 0 && suiteCount > 0 ? (
              <span className="text-muted-foreground"> · </span>
            ) : null}
            {suiteCount > 0 ? (
              <span>
                <span className="tabular-nums">{suiteCount}</span> suite run
                {suiteCount === 1 ? "" : "s"}
              </span>
            ) : null}{" "}
            selected
          </Text>
          <Text variant="meta" tone="muted">
            {multiTest
              ? "Compare needs runs of a single test across environments — narrow your run selection to one test."
              : "Compare runs of one test across environments, or two suite runs side by side."}
          </Text>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onClear}>
            Clear
          </Button>
          {onDelete ? (
            <Button variant="destructive" size="sm" onClick={onDelete} disabled={deleting}>
              <Trash2 aria-hidden />
              <span>Delete</span>
            </Button>
          ) : null}
          {suiteCount > 0 ? (
            <Button variant="outline" size="sm" disabled={suiteCount < 2} onClick={onCompareSuites}>
              <Layers aria-hidden />
              <span>Compare suites</span>
            </Button>
          ) : null}
          <Button size="sm" disabled={!canCompare} onClick={onCompareRuns}>
            <GitCompareArrows aria-hidden />
            <span>Compare runs</span>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
