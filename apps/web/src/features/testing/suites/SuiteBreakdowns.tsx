import { useMemo, useState } from "react";
import type { SuiteAnalytics, SuiteBreakdownSlice } from "@mcp-token-footprint/shared";
import { Card, CardContent, CardHeader, CardTitle, EmptyState, Text, cn } from "@brand/ui";
import { Bar, BarChart, BarXAxis, ChartTooltip, Grid } from "@brand/charts";
import { BarChart3, Layers } from "lucide-react";
import { SelectField } from "../../../components/SelectField";
import { formatCostUsd, formatPercent } from "../../../lib/format";
import type { SuiteMatrixRef } from "./SuiteMatrix";

/**
 * Suite-run METADATA BREAKDOWNS (WP 3.4, B9.2) — for each metadata dimension present (category /
 * difficulty / each tag), a grouped `@brand/charts` BarChart with a categorical x (the dimension's
 * values) and one series per scenario (`--chart-1..5`). One metric toggle (mean score % vs mean cost)
 * governs all charts. Server-computed + derived: every bar is a {@link SuiteBreakdownSlice}. BarChart is
 * categorical (string x is safe — unlike Line/Area which need Dates). Honest EmptyState when no test in
 * the run carries category/difficulty/tag metadata (or nothing is graded, so no slice has a score).
 */
export type SuiteBreakdownsProps = {
  analytics: SuiteAnalytics;
  /** Ordered scenarios (id + name) — drives the series set, stable colors, and the legend. */
  scenarios: SuiteMatrixRef[];
  /** Human label of the score dimension the means were computed under (for the score-metric subtitle). */
  graderLabel: string;
};

type Metric = "score" | "cost";
const DIMENSIONS: SuiteBreakdownSlice["dimension"][] = ["category", "difficulty", "tag"];
const DIMENSION_LABELS: Record<SuiteBreakdownSlice["dimension"], string> = {
  category: "Category",
  difficulty: "Difficulty",
  tag: "Tag",
};

/** Semantic series color for a scenario index (cycles the five `--chart-*` tokens). */
function chartVar(index: number): string {
  return `var(--chart-${(index % 5) + 1})`;
}

export function SuiteBreakdowns({ analytics, scenarios, graderLabel }: SuiteBreakdownsProps) {
  const [metric, setMetric] = useState<Metric>("score");
  const scenarioName = useMemo(() => new Map(scenarios.map((s) => [s.id, s.name])), [scenarios]);
  const colorOf = useMemo(() => new Map(scenarios.map((s, i) => [s.id, chartVar(i)])), [scenarios]);

  const present = DIMENSIONS.filter((d) => analytics.breakdowns.some((s) => s.dimension === d));

  if (present.length === 0) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center p-6">
        <EmptyState
          icon={<Layers aria-hidden />}
          title="No breakdowns yet"
          description="Breakdowns slice graded results by the tests' category, difficulty, and tags. They appear once the suite's tests carry that metadata and at least one cell has a graded score."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 pr-3">
      <div className="max-w-xs">
        <SelectField
          id="breakdown-metric"
          label="Metric"
          value={metric}
          onChange={(v) => setMetric(v as Metric)}
          options={[
            { value: "score", label: "Mean score" },
            { value: "cost", label: "Mean cost" },
          ]}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {present.map((dimension) => (
          <DimensionChart
            key={dimension}
            dimension={dimension}
            metric={metric}
            graderLabel={graderLabel}
            slices={analytics.breakdowns}
            scenarios={scenarios}
            scenarioName={scenarioName}
            colorOf={colorOf}
          />
        ))}
      </div>
    </div>
  );
}

function DimensionChart({
  dimension,
  metric,
  graderLabel,
  slices,
  scenarios,
  scenarioName,
  colorOf,
}: {
  dimension: SuiteBreakdownSlice["dimension"];
  metric: Metric;
  graderLabel: string;
  slices: SuiteBreakdownSlice[];
  scenarios: SuiteMatrixRef[];
  scenarioName: Map<string, string>;
  colorOf: Map<string, string>;
}) {
  const dimSlices = useMemo(
    () => slices.filter((s) => s.dimension === dimension),
    [slices, dimension],
  );

  // Wide rows: one per dimension key, a numeric column per scenario (mean score % or mean cost).
  const { rows, seriesIds } = useMemo(() => {
    const byKey = new Map<string, Record<string, unknown>>();
    const ids = new Set<string>();
    for (const slice of dimSlices) {
      const row = byKey.get(slice.key) ?? { key: slice.key };
      row[slice.scenarioId] = metric === "score" ? (slice.meanScore ?? 0) * 100 : slice.meanCostUsd;
      byKey.set(slice.key, row);
      ids.add(slice.scenarioId);
    }
    // Keep the scenario order stable (matches the color assignment + legend).
    const orderedIds = scenarios.map((s) => s.id).filter((id) => ids.has(id));
    return { rows: [...byKey.values()], seriesIds: orderedIds };
  }, [dimSlices, metric, scenarios]);

  const format = (value: number) =>
    metric === "score" ? formatPercent(value) : formatCostUsd(value, { precision: 4 });

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>
          <span className="flex items-center gap-2">
            <BarChart3 aria-hidden className="size-4" />
            {DIMENSION_LABELS[dimension]}
          </span>
        </CardTitle>
        <Text variant="meta" tone="muted">
          {metric === "score"
            ? `Mean score (${graderLabel}) by environment`
            : "Mean cost by environment"}
        </Text>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="h-56 w-full">
          <BarChart
            data={rows as unknown as Record<string, unknown>[]}
            xDataKey="key"
            aspectRatio="auto"
            className="h-full w-full"
            accessibleLabel={`Mean ${metric === "score" ? "score" : "cost"} by ${DIMENSION_LABELS[dimension]} and environment`}
          >
            <Grid horizontal />
            {seriesIds.map((id) => (
              <Bar key={id} dataKey={id} fill={colorOf.get(id)} />
            ))}
            <BarXAxis maxLabels={10} />
            <ChartTooltip
              showDatePill={false}
              rows={(point) =>
                seriesIds
                  .filter((id) => typeof point[id] === "number")
                  .map((id) => ({
                    color: colorOf.get(id) ?? "var(--chart-1)",
                    label: scenarioName.get(id) ?? id,
                    value: format(Number(point[id])),
                  }))
              }
            />
          </BarChart>
        </div>
        <ScenarioLegend
          ids={seriesIds}
          names={scenarioName}
          colors={colorOf}
          scenarios={scenarios}
        />
      </CardContent>
    </Card>
  );
}

/** Swatch legend mapping each scenario series to its `--chart-*` color. */
function ScenarioLegend({
  ids,
  names,
  scenarios,
}: {
  ids: string[];
  names: Map<string, string>;
  colors: Map<string, string>;
  scenarios: SuiteMatrixRef[];
}) {
  const indexOf = useMemo(() => new Map(scenarios.map((s, i) => [s.id, i])), [scenarios]);
  if (ids.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-2.5">
      {ids.map((id) => (
        <li key={id} className="flex items-center gap-1.5">
          <span
            className={cn(
              "size-2.5 shrink-0 rounded-sm",
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
