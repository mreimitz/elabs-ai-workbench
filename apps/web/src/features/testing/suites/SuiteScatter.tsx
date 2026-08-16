import { useMemo, useState } from "react";
import type { SuiteAnalytics, SuiteCell, SuiteScatterPoint } from "@mcp-token-footprint/shared";
import { GRADER_IDS } from "@mcp-token-footprint/shared";
import { Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Text, cn } from "@brand/ui";
import { ChartTooltip, Grid, Scatter, ScatterChart, YAxis } from "@brand/charts";
import { ExternalLink, ScatterChart as ScatterIcon } from "lucide-react";
import { SelectField } from "../../../components/SelectField";
import { formatCostUsd, formatNumber, formatPercent } from "../../../lib/format";
import { GRADER_LABELS } from "../grade-format";
import type { SuiteMatrixRef } from "./SuiteMatrix";

/**
 * Suite-run QUALITY × COST scatter (WP 3.4, B9.3) — one `@brand/charts` ScatterChart point per
 * (test × scenario) subject (repetitions AVERAGED, server-computed). X toggles between mean tokens and
 * mean cost; Y is the mean score under the SELECTED grade dimension (the `grader` selector re-fetches
 * the analytics upstream). Points are colored by scenario (`--chart-1..5`). A subject with no graded rep
 * is omitted server-side, so the plot is honestly empty until something is graded.
 *
 * NOTE on the axes: the vendored ScatterChart maps its x through a time scale, which mislabels a numeric
 * axis, so the numeric X (tokens/cost) is carried by the tooltip + the subjects list (an accessible,
 * keyboard-navigable mirror of the points) rather than an on-canvas date axis; Y (score) is a real
 * linear axis formatted as a percentage.
 */
export type SuiteScatterProps = {
  analytics: SuiteAnalytics;
  scenarios: SuiteMatrixRef[];
  /** Test id → name (for point/legend/subject labels). */
  testName: Map<string, string>;
  /** Selected grade dimension: "" = default primary-grader priority, else a grader id. */
  grader: string;
  onGraderChange: (grader: string) => void;
  /** Live matrix cells (keyed) — used to resolve a subject's child run id for drill-through. */
  cells: Record<string, SuiteCell>;
  onOpenRun: (runId: string) => void;
};

type XMetric = "tokens" | "cost";

function chartVar(index: number): string {
  return `var(--chart-${(index % 5) + 1})`;
}

/** One scatter data row (wide by scenario) enriched with the labels the tooltip reads. */
type ScatterRow = Record<string, unknown> & {
  x: number;
  testId: string;
  testLabel: string;
  scenarioId: string;
  scenarioLabel: string;
  meanTokens: number;
  meanCostUsd: number;
  meanScore: number;
  reps: number;
};

export function SuiteScatter({
  analytics,
  scenarios,
  testName,
  grader,
  onGraderChange,
  cells,
  onOpenRun,
}: SuiteScatterProps) {
  const [xMetric, setXMetric] = useState<XMetric>("cost");
  const scenarioName = useMemo(() => new Map(scenarios.map((s) => [s.id, s.name])), [scenarios]);
  const colorOf = useMemo(() => new Map(scenarios.map((s, i) => [s.id, chartVar(i)])), [scenarios]);
  const indexOf = useMemo(() => new Map(scenarios.map((s, i) => [s.id, i])), [scenarios]);

  // Resolve a subject → a child run id from the live cells (works for a running / just-run suite; a
  // finished-and-reopened run has no streamed cells, so drill-through is simply unavailable then).
  const runIdOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const cell of Object.values(cells)) {
      if (!cell.runId) continue;
      const key = `${cell.testId} ${cell.scenarioId}`;
      if (!map.has(key)) map.set(key, cell.runId);
    }
    return map;
  }, [cells]);

  const rows = useMemo<ScatterRow[]>(
    () =>
      analytics.scatter.map((point) => {
        // The server omits scoreless subjects, so a scatter point's meanScore is a real number here;
        // `?? 0` only guards the nullable contract type. Y is the 0–1 score (axis formatted as %).
        const score = point.meanScore ?? 0;
        return {
          x: xMetric === "tokens" ? point.meanTokens : point.meanCostUsd,
          [point.scenarioId]: score,
          testId: point.testId,
          testLabel: testName.get(point.testId) ?? shortId(point.testId),
          scenarioId: point.scenarioId,
          scenarioLabel: scenarioName.get(point.scenarioId) ?? shortId(point.scenarioId),
          meanTokens: point.meanTokens,
          meanCostUsd: point.meanCostUsd,
          meanScore: score,
          reps: point.reps,
        };
      }),
    [analytics.scatter, xMetric, testName, scenarioName],
  );

  const seriesIds = useMemo(() => {
    const ids = new Set(analytics.scatter.map((p) => p.scenarioId));
    return scenarios.map((s) => s.id).filter((id) => ids.has(id));
  }, [analytics.scatter, scenarios]);

  const graderLabel = grader
    ? (GRADER_LABELS[grader as keyof typeof GRADER_LABELS] ?? grader)
    : "Primary grader";
  const formatX = (value: number) =>
    xMetric === "tokens" ? formatNumber(value) : formatCostUsd(value, { precision: 4 });

  return (
    <div className="flex flex-col gap-4 pr-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SelectField
          id="scatter-x"
          label="X axis (cost)"
          value={xMetric}
          onChange={(v) => setXMetric(v as XMetric)}
          options={[
            { value: "cost", label: "Mean cost (USD)" },
            { value: "tokens", label: "Mean tokens" },
          ]}
        />
        <SelectField
          id="scatter-grader"
          label="Y axis (score dimension)"
          value={grader}
          onChange={onGraderChange}
          options={[
            { value: "", label: "Primary grader (default)" },
            ...GRADER_IDS.map((id) => ({ value: id, label: GRADER_LABELS[id] })),
          ]}
        />
      </div>

      {analytics.scatter.length === 0 ? (
        <div className="flex h-full min-h-0 items-center justify-center p-6">
          <EmptyState
            icon={<ScatterIcon aria-hidden />}
            title="No graded subjects yet"
            description="Each point plots a test × environment subject's mean cost against its mean score. Points appear once the suite's cells finish and are graded."
          />
        </div>
      ) : (
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>
              <span className="flex items-center gap-2">
                <ScatterIcon aria-hidden className="size-4" />
                Quality × cost
              </span>
            </CardTitle>
            <Text variant="meta" tone="muted">
              Score ({graderLabel}) vs mean {xMetric === "tokens" ? "tokens" : "cost"} · one point
              per subject, repetitions averaged
            </Text>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="h-72 w-full">
              <ScatterChart
                data={rows as unknown as Record<string, unknown>[]}
                xDataKey="x"
                aspectRatio="auto"
                className="h-full w-full"
                accessibleLabel={`Mean score vs mean ${xMetric} per test-environment subject, colored by environment`}
              >
                <Grid horizontal />
                <YAxis formatValue={(v) => formatPercent(v * 100)} />
                {seriesIds.map((id) => (
                  <Scatter key={id} dataKey={id} fill={colorOf.get(id)} />
                ))}
                <ChartTooltip
                  showDatePill={false}
                  rows={(point) => [
                    {
                      color: colorOf.get(String(point.scenarioId)) ?? "var(--chart-1)",
                      label: `${String(point.testLabel)} · ${String(point.scenarioLabel)}`,
                      value: `${formatPercent(Number(point.meanScore) * 100)} · ${formatX(Number(point.x))} · ${formatNumber(Number(point.reps))} rep(s)`,
                    },
                  ]}
                />
              </ScatterChart>
            </div>
            <ScenarioLegend ids={seriesIds} names={scenarioName} indexOf={indexOf} />

            {/* Subjects — an accessible, keyboard-navigable mirror of the points that also drills through
                to a subject's child-run console when a run id is resolvable from the live matrix. */}
            <div className="flex flex-col gap-1.5 border-t border-border pt-3">
              <Text variant="meta" tone="muted">
                Subjects
                {runIdOf.size === 0 ? " (open a live suite run to drill into a subject's run)" : ""}
              </Text>
              <ul className="flex flex-col gap-1">
                {analytics.scatter.map((point) => (
                  <SubjectRow
                    key={`${point.testId} ${point.scenarioId} ${point.variantLabel ?? ""}`}
                    point={point}
                    testLabel={testName.get(point.testId) ?? shortId(point.testId)}
                    scenarioLabel={scenarioName.get(point.scenarioId) ?? shortId(point.scenarioId)}
                    runId={runIdOf.get(`${point.testId} ${point.scenarioId}`)}
                    onOpenRun={onOpenRun}
                  />
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SubjectRow({
  point,
  testLabel,
  scenarioLabel,
  runId,
  onOpenRun,
}: {
  point: SuiteScatterPoint;
  testLabel: string;
  scenarioLabel: string;
  runId: string | undefined;
  onOpenRun: (runId: string) => void;
}) {
  const label = (
    <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
      <span className="min-w-0 truncate font-medium">{testLabel}</span>
      <Text as="span" variant="meta" tone="muted" className="truncate">
        {scenarioLabel}
      </Text>
      <Text as="span" variant="meta" tone="muted" className="tabular-nums">
        {point.meanScore === null ? "—" : formatPercent(point.meanScore * 100)} ·{" "}
        {formatCostUsd(point.meanCostUsd, { precision: 4 })} · {point.reps} rep(s)
      </Text>
    </span>
  );
  return (
    <li>
      <Button
        variant="ghost"
        size="sm"
        className="h-auto w-full justify-start gap-2 py-1.5 text-left"
        disabled={!runId}
        onClick={() => runId && onOpenRun(runId)}
      >
        {label}
        {runId ? <ExternalLink aria-hidden className="size-3.5 shrink-0" /> : null}
      </Button>
    </li>
  );
}

function ScenarioLegend({
  ids,
  names,
  indexOf,
}: { ids: string[]; names: Map<string, string>; indexOf: Map<string, number> }) {
  if (ids.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1">
      {ids.map((id) => (
        <li key={id} className="flex items-center gap-1.5">
          <span
            className={cn(
              "size-2.5 shrink-0 rounded-full",
              `bg-chart-${((indexOf.get(id) ?? 0) % 5) + 1}`,
            )}
            aria-hidden
          />
          <Text variant="meta" tone="muted" className="max-w-40 truncate">
            {names.get(id) ?? id}
          </Text>
        </li>
      ))}
    </ul>
  );
}

function shortId(id: string): string {
  return `#${id.slice(0, 6)}`;
}
