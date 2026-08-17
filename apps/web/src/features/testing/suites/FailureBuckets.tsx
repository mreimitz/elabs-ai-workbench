import { useMemo, useState } from "react";
import {
  FAILURE_BUCKET_SCORE_THRESHOLD,
  type FailureBucket,
  type SuiteAggregates,
  type SuiteRun,
} from "@mcp-token-footprint/shared";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  EmptyState,
  Heading,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
  toast,
} from "@elabs-ai/components-ui";
import { CircleDollarSign, Info, Loader2, Sparkles, TriangleAlert } from "lucide-react";
import { triggerFailureBuckets } from "../../../lib/api";
import { InlineError } from "../../../components/InlineError";
import { getErrorMessage } from "../../../lib/errors";
import { formatPercent } from "../../../lib/format";
import { notifyError } from "../../../lib/notify";

/**
 * WP 3.5 (B9.4) — the OPT-IN failure-bucket clustering tab of the suite-run console. Clustering NEVER
 * runs unprompted: the user must press "Analyze failures", which fires ONE judge call (billed to the
 * grading ledger, never run cost) that clusters the suite run's low-score judge reasons into a taxonomy.
 * The button carries an explicit cost notice. Results are the DERIVED `aggregates.failureBuckets`
 * persisted on the suite run — a table of clusters, each drilling down to its member runs (which link to
 * the child run console). Honest empty states distinguish "not analyzed yet" from "analyzed, no failures".
 *
 * `aggregates` seeds the initial state (a re-opened suite run shows a taxonomy analyzed in a past session);
 * a fresh trigger returns the updated {@link SuiteRun}, held locally so the table refreshes without a reload.
 */
export type FailureBucketsProps = {
  suiteRunId: string;
  /** The effective aggregates (live stream ?? persisted snapshot) — seeds any previously-analyzed taxonomy. */
  aggregates: SuiteAggregates | null;
  /** Only a settled suite run can be analyzed (a live run's aggregates are still being recomputed). */
  isTerminal: boolean;
  /** Drill from a member run to its own run console. */
  onOpenRun: (runId: string) => void;
};

const LOW_SCORE_PERCENT = `${Math.round(FAILURE_BUCKET_SCORE_THRESHOLD * 100)}%`;

export function FailureBuckets({
  suiteRunId,
  aggregates,
  isTerminal,
  onOpenRun,
}: FailureBucketsProps) {
  const [result, setResult] = useState<SuiteRun | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The freshest taxonomy: a just-triggered result, else the seeded aggregates. `undefined` = never
  // analyzed; `[]` = analyzed with nothing below the low-score threshold (both are honest empty states).
  const buckets: FailureBucket[] | undefined =
    result?.aggregates?.failureBuckets ?? aggregates?.failureBuckets;
  const analyzed = buckets !== undefined;

  const failingRunCount = useMemo(
    () => (buckets ?? []).reduce((sum, bucket) => sum + bucket.memberRunIds.length, 0),
    [buckets],
  );

  async function handleAnalyze() {
    setAnalyzing(true);
    setError(null);
    try {
      const updated = await triggerFailureBuckets(suiteRunId);
      setResult(updated);
      const count = updated.aggregates?.failureBuckets?.length ?? 0;
      toast("Failure analysis complete", {
        description:
          count > 0
            ? `${count} failure cluster${count === 1 ? "" : "s"} identified.`
            : "Nothing scored below the threshold.",
      });
    } catch (caught) {
      const message = getErrorMessage(caught);
      setError(message);
      notifyError("Couldn’t analyze failures.", { description: `${message} Try again.` });
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 pr-3">
      {/* Header + the explicitly-costed trigger. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <Heading level={3} className="text-balance">
            Failure buckets
          </Heading>
          <Text variant="meta" tone="muted" className="text-pretty">
            Cluster the runs scoring below <span className="tabular-nums">{LOW_SCORE_PERCENT}</span>{" "}
            into a failure taxonomy. This runs a judge call on demand — it never runs on its own.
          </Text>
        </div>
        <Button
          variant="default"
          size="sm"
          onClick={() => void handleAnalyze()}
          disabled={analyzing || !isTerminal}
          className="shrink-0"
        >
          {analyzing ? <Loader2 className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />}
          <span>
            {analyzing ? "Analyzing…" : analyzed ? "Re-analyze failures" : "Analyze failures"}
          </span>
        </Button>
      </div>

      {/* Cost notice — the analysis costs money; it's billed to the grading ledger, not run cost. */}
      <Alert variant="info">
        <CircleDollarSign aria-hidden />
        <AlertTitle>Analyzing failures costs money</AlertTitle>
        <AlertDescription>
          Each analysis makes one LLM judge call using your configured default judge. Its cost is
          recorded on the grading ledger (never charged to a run). Re-analyzing overwrites the
          previous clusters and leaves the underlying grades untouched.
        </AlertDescription>
      </Alert>

      {!isTerminal ? (
        <Alert variant="warning">
          <Info aria-hidden />
          <AlertTitle>Suite run still in progress</AlertTitle>
          <AlertDescription>
            Failure clustering analyzes a finished suite run. It becomes available once this run
            settles.
          </AlertDescription>
        </Alert>
      ) : null}

      {error ? (
        <InlineError
          title="Couldn’t analyze failures"
          detail={error}
          onRetry={() => void handleAnalyze()}
        />
      ) : null}

      {/* Results — honest empty states distinguish "not analyzed" from "analyzed, no failures". */}
      {!analyzed ? (
        <EmptyState
          icon={<Sparkles aria-hidden />}
          title="Not analyzed yet"
          description="Press “Analyze failures” to cluster this run’s low-score judge reasons into a failure taxonomy. Nothing runs until you do."
        />
      ) : (buckets ?? []).length === 0 ? (
        <EmptyState
          icon={<TriangleAlert aria-hidden />}
          title="No failure clusters"
          description={`Nothing in this suite run scored below ${LOW_SCORE_PERCENT}, so there are no failures to cluster.`}
        />
      ) : (
        <div className="flex flex-col gap-3">
          <Text variant="meta" tone="muted">
            <span className="tabular-nums">{failingRunCount}</span> failing run
            {failingRunCount === 1 ? "" : "s"} across{" "}
            <span className="tabular-nums">{(buckets ?? []).length}</span> cluster
            {(buckets ?? []).length === 1 ? "" : "s"}.
          </Text>
          <div className="overflow-x-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-64">Failure cluster</TableHead>
                  <TableHead className="min-w-24 text-right">Share</TableHead>
                  <TableHead className="min-w-48">Member runs</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(buckets ?? []).map((bucket, index) => (
                  <TableRow key={`${bucket.label}-${index}`}>
                    <TableCell className="align-top">
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="font-medium text-pretty">{bucket.label}</span>
                        {bucket.description ? (
                          <Text variant="meta" tone="muted" className="text-pretty">
                            {bucket.description}
                          </Text>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="align-top text-right">
                      <Badge variant="secondary" className="tabular-nums">
                        {formatPercent(bucket.share * 100)}
                      </Badge>
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="flex flex-wrap gap-1.5">
                        {bucket.memberRunIds.map((runId) => (
                          <Button
                            key={runId}
                            variant="outline"
                            size="sm"
                            className="h-6 px-2 font-mono text-xs"
                            onClick={() => onOpenRun(runId)}
                            title={`Open run ${runId}`}
                          >
                            #{runId.slice(0, 6)}
                          </Button>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}
