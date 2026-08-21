import { useMemo } from "react";
import type { WatchWindowPreview } from "@mcp-token-footprint/shared";
import { Bar, BarChart, BarXAxis, ChartTooltip, Grid } from "@elabs-ai/components-charts";
import { Alert, AlertDescription, Button, EmptyState, Spinner, Text } from "@elabs-ai/components-ui";
import { PlayCircle } from "lucide-react";
import { formatDateTime, formatNumber } from "../../lib/format";

/**
 * The rule editor's MANDATORY historical-preview step (Observability WP4.4, conventions §11): a bar
 * strip of the trailing completed windows `POST /api/watch-rules/preview` (WP4.2) scored, fired
 * windows marked in the destructive/breach tone. `BarChart` is the CATEGORICAL chart (a formatted
 * window-end label is a fine string x — unlike Line/Area, which need real `Date`s, per the house
 * gotcha). The Save button in the parent editor stays disabled until `preview` is non-null — this
 * component only RENDERS the API's own math, never recomputes it.
 */
export function WindowPreviewStrip({
  preview,
  loading,
  error,
  onRunPreview,
}: {
  preview: WatchWindowPreview | null;
  loading: boolean;
  error: string | null;
  onRunPreview: () => void;
}) {
  // Two mutually-exclusive stacked keys per window (`Bar` has no per-point conditional fill in this
  // library version) — exactly one of `okValue`/`firedValue` is non-null per row, so stacking renders
  // a single, correctly-colored segment per bar.
  const rows = useMemo(
    () =>
      (preview?.windows ?? []).map((point, index) => ({
        key: `${point.windowStart}-${index}`,
        label: formatDateTime(point.windowEnd),
        value: point.value,
        n: point.n,
        wouldHaveFired: point.wouldHaveFired,
        // AM-OB10 — a `no_data` window is NOT plotted as a zero-height "healthy" bar. It contributes
        // to neither series, so the chart shows a real GAP, and the count line below says how many.
        state: point.state,
        okValue: point.state === "no_data" || point.wouldHaveFired ? null : (point.value ?? 0),
        firedValue:
          point.state !== "no_data" && point.wouldHaveFired ? (point.value ?? 0) : null,
      })),
    [preview],
  );

  const firedCount = rows.filter((row) => row.wouldHaveFired).length;
  const noDataCount = rows.filter((row) => row.state === "no_data").length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Text variant="meta" tone="muted">
          Scores this rule&rsquo;s threshold against real history — required before saving a
          windowed rule.
        </Text>
        <Button type="button" variant="outline" size="sm" onClick={onRunPreview} disabled={loading}>
          {loading ? <Spinner className="size-4" aria-hidden /> : <PlayCircle aria-hidden />}
          <span>{preview ? "Re-run preview" : "Run preview"}</span>
        </Button>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {!preview && !loading ? (
        <div className="flex min-h-32 items-center justify-center rounded-lg border border-dashed border-border py-6">
          <EmptyState
            title="No preview yet"
            description="Run the preview to see how this threshold would have scored recent windows."
          />
        </div>
      ) : loading && !preview ? (
        <div className="flex min-h-32 items-center justify-center rounded-lg border border-border py-6">
          <Spinner label="Scoring trailing windows…" />
        </div>
      ) : preview ? (
        <div className="flex flex-col gap-2">
          <Text variant="meta" tone="muted" className="tabular-nums">
            {firedCount} of {rows.length} trailing window{rows.length === 1 ? "" : "s"} would have
            fired · bucket: {preview.bucket}
            {noDataCount > 0 ? ` · ${noDataCount} had no runs at all` : ""}
          </Text>
          {rows.length === 0 ? (
            <EmptyState
              title="No windows in range"
              description="Nothing scoreable yet for this window width."
            />
          ) : (
            <div className="h-40 w-full">
              <BarChart
                data={rows as unknown as Record<string, unknown>[]}
                xDataKey="label"
                stacked
                aspectRatio="auto"
                className="h-full w-full"
                accessibleLabel="Trailing windows scored against this rule's threshold"
              >
                <Grid horizontal />
                <Bar dataKey="okValue" fill="var(--chart-1)" />
                <Bar dataKey="firedValue" fill="var(--destructive)" />
                <BarXAxis maxLabels={8} />
                <ChartTooltip
                  showDatePill={false}
                  rows={(point) => [
                    {
                      color: point.wouldHaveFired ? "var(--destructive)" : "var(--chart-1)",
                      label:
                        point.state === "no_data"
                          ? "No runs in this window"
                          : point.wouldHaveFired
                            ? "Would have fired"
                            : "Value",
                      value:
                        point.value === null || point.value === undefined
                          ? "nothing ran"
                          : formatNumber(Number(point.value)),
                    },
                    { color: "transparent", label: "Samples", value: formatNumber(Number(point.n ?? 0)) },
                  ]}
                />
              </BarChart>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
