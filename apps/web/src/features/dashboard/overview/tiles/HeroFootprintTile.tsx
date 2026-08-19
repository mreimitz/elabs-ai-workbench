import { useMemo } from "react";
import { CalendarRange, Database } from "lucide-react";
import { ChartTooltip, Grid, Line, LineChart, XAxis } from "@elabs-ai/components-charts";
import {
  BentoGridItem,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  StatePanel,
  Text,
  cn,
} from "@elabs-ai/components-ui";
import { chartSeriesColor, chartSwatchStyle } from "../../../../lib/chart-colors";
import { deltaTextTone } from "../../../../lib/delta";
import { formatNumber, formatRelativeTime } from "../../../../lib/format";
import { pivotToRows } from "../../testing/metrics-derive";
import type { FootprintData, SectionEnvelope } from "../overview-contract";
import { isEmptySection } from "../overview-contract";

/**
 * Overview hero (dashboard-bento WP 1.2) — the fleet's whole-surface footprint over time, one line
 * per server, with the fleet total, its Δ and the first-measured disclosure in the tile header.
 *
 * ## Why a `LineChart` and not an `AreaChart`
 * `Area` has no `stackId` (verified in `@elabs-ai/components-charts`'s `index.d.ts`), so N servers
 * would render as N overlapping translucent washes rather than a composition — unreadable past two
 * servers, and it would imply a stacked total that isn't drawn. One `Line` per server is the shape
 * `ScansStripPanel` already ships against the same data.
 *
 * ## Two clocks, one tile
 * The headline figures (total, Δ, mix, first-measured) are a **standing measurement** — the latest
 * successful scan per server, whatever window is selected — while the plotted lines are the
 * **window's** trend. So a window containing no scan removes the LINES and nothing else: the tile
 * states the fleet's startup cost, says plainly that nothing was scanned in this window, and names
 * when the fleet was last measured. It does NOT vanish, which is what it used to do on a real
 * instance holding 103 scans whose newest was 19 days old.
 *
 * ## The three traps this tile is written against
 * 1. **`xDataKey` defaults to `"date"`.** The pivoted rows carry the timestamp under `x`; forgetting
 *    `xDataKey="x"` crashes the tab with `RangeError: Invalid time value` (the regression
 *    `features/dashboard/testing/time-axis-charts.test.tsx` locks). `pivotToRows` is reused verbatim
 *    for the same reason — it already skips an unparseable bucket instead of feeding an Invalid Date.
 * 2. **A tile whose section is empty removes itself** (`isEmptySection`) — the bento must never show
 *    a grid of empty boxes. The first-run CTA is the tab shell's job (WP 1.4), not this tile's.
 * 3. **Growth is BAD here.** Startup tokens are context the model pays for on every request, so the
 *    Δ's tone comes from `deltaTextTone(delta, false)` (higher is NOT better) — the app's one
 *    magnitude-delta colour authority (D-IC3) — and the sign is stated in text, never colour alone.
 *
 * Loading rides the chart's own `status="loading"` (a real prop on `LineChart`/`AreaChart`/
 * `BarChart`/`ComposedChart` only), so the tile keeps its shape instead of collapsing to a spinner.
 * Drill-down: activating any point — pointer or keyboard — opens THAT server's detail page, the
 * same destination the legend names.
 */
export function HeroFootprintTile({
  section,
  onOpenServer,
}: {
  section: SectionEnvelope<FootprintData>;
  /** Where a datapoint drills to — that server's scan/detail page. Wired by the tab shell (WP 1.4). */
  onOpenServer: (serverId: string) => void;
}) {
  const perServer = section.data?.perServer ?? [];

  // Hooks run before any early return (a tile that self-hides must not change hook order).
  const rows = useMemo(
    () =>
      pivotToRows(
        perServer.map((s) => ({ key: s.serverId, label: s.serverName, points: s.points })),
      ),
    [perServer],
  );
  /** serverId → display name: a `Line`'s `dataKey` here is an opaque id, useless as an accessible name. */
  const serverNames = useMemo(
    () => new Map(perServer.map((s) => [s.serverId, s.serverName])),
    [perServer],
  );

  if (isEmptySection(section)) return null;

  const data = section.data;
  const delta = data?.deltaTokens ?? null;

  return (
    <BentoGridItem size="hero">
      <CardHeader className="gap-1 p-4 pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <Database aria-hidden className="size-4" />
              Fleet footprint
            </CardTitle>
            <CardDescription>
              Startup tokens per server — the total is your fleet's current surface
            </CardDescription>
          </div>
          {data ? (
            <div className="flex shrink-0 flex-col items-end gap-0.5">
              <Text as="span" variant="kpi" className="tabular-nums">
                {formatNumber(data.totalTokens)}
              </Text>
              {/* Never a fabricated delta: `null` means nothing comparable, so nothing is rendered. */}
              {delta !== null ? (
                <Text
                  as="span"
                  variant="meta"
                  className={cn("tabular-nums", deltaTextTone(delta, false))}
                >
                  {delta === 0
                    ? "No change vs previous"
                    : `${delta > 0 ? "+" : "-"}${formatNumber(Math.abs(delta))} vs previous`}
                </Text>
              ) : null}
            </div>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-2 p-4 pt-0">
        {section.state === "error" ? (
          <StatePanel
            kind="error"
            title="Footprint unavailable"
            description={section.error ?? "The scan metrics could not be loaded."}
          />
        ) : data?.noActivityInWindow ? (
          // The window is quiet — the TREND is genuinely empty, the standing figures above are not.
          // Say so, and name when the fleet was last measured, instead of removing the tile.
          <StatePanel
            kind="empty"
            className="min-h-0 flex-1"
            icon={<CalendarRange aria-hidden />}
            title="No scan activity in this window"
            description={
              data.latestMeasuredAt !== null
                ? `Nothing was scanned in the selected window, so there is no trend to plot. The fleet was last measured ${formatRelativeTime(data.latestMeasuredAt)}; the figures above are its current surface.`
                : "Nothing was scanned in the selected window, so there is no trend to plot. The figures above are the fleet's current surface."
            }
          />
        ) : (
          <>
            <div className="min-h-0 w-full flex-1">
              <LineChart
                data={rows as unknown as Record<string, unknown>[]}
                xDataKey="x"
                aspectRatio="auto"
                className="h-full w-full"
                status={section.state === "loading" ? "loading" : "ready"}
                loadingLabel="Loading footprint…"
                accessibleLabel="Fleet footprint tokens over time, one line per server"
                accessibleDescription={
                  // The two counts are deliberately NOT joined into one sentence: the total is the
                  // whole fleet's current surface, while the lines are only the servers scanned
                  // inside this window. "N tokens across <plotted> servers" would state a total over
                  // a population it does not cover — the exact class of mismatch this plan exists to
                  // remove.
                  data
                    ? `Fleet total ${formatNumber(data.totalTokens)} tokens; ${formatNumber(perServer.length)} ${perServer.length === 1 ? "server" : "servers"} plotted in this window`
                    : undefined
                }
                onDatapointClick={(point) => {
                  const serverId = String(point.seriesKey ?? "");
                  if (!serverNames.has(serverId)) return;
                  onOpenServer(serverId);
                }}
                datapointLabel={(point) => {
                  const serverId = String(point.seriesKey ?? "");
                  const name = serverNames.get(serverId) ?? serverId;
                  const when =
                    point.category instanceof Date
                      ? point.category.toLocaleDateString()
                      : String(point.category ?? "");
                  return `${name}, ${when}: ${formatNumber(Number(point.value ?? 0))} tokens`;
                }}
              >
                <Grid horizontal />
                {perServer.map((s, i) => (
                  <Line key={s.serverId} dataKey={s.serverId} stroke={chartSeriesColor(i)} />
                ))}
                <XAxis />
                <ChartTooltip
                  rows={(point) =>
                    perServer.map((s, i) => ({
                      color: chartSeriesColor(i),
                      label: s.serverName,
                      value:
                        point[s.serverId] != null
                          ? `${formatNumber(Number(point[s.serverId]))} tokens`
                          : "no scan",
                    }))
                  }
                />
              </LineChart>
            </div>
            {/* The legend is the only place a server's NAME sits beside its colour — the lines are
                keyed by opaque ids. `min-w-0` + `truncate` so a long server name cannot blow out
                the tile. */}
            {perServer.length > 0 ? (
              <ul className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-2">
                {perServer.map((s, i) => (
                  <li key={s.serverId} className="flex min-w-0 items-center gap-1.5">
                    <span
                      className="size-2.5 shrink-0 rounded-sm"
                      style={chartSwatchStyle(i)}
                      aria-hidden
                    />
                    <Text as="span" variant="meta" tone="muted" className="truncate">
                      {s.serverName}
                    </Text>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
        {/* Part of the Δ can be a FIRST measurement rather than a change — disclose it, rather than
            letting a newly scanned server's whole footprint read as growth. The Δ it qualifies is
            in the header, so this line belongs to the FIGURES, not to the chart: it stays on screen
            in a window with no scan activity too. */}
        {section.state !== "error" && data && data.firstTimeServers > 0 ? (
          <Text variant="meta" tone="muted">
            {data.firstTimeServers === 1
              ? "Includes 1 server measured for the first time"
              : `Includes ${formatNumber(data.firstTimeServers)} servers measured for the first time`}
          </Text>
        ) : null}
      </CardContent>
    </BentoGridItem>
  );
}
