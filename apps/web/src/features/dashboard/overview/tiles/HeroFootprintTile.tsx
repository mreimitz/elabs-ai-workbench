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
 * ## One clock: this tile is standing, top to bottom (WP 2.3)
 * The headline figures (total, Δ, mix, first-measured) were always a **standing measurement** — the
 * latest successful scan per server, whatever window is selected. As of WP 2.3 the LINES are too.
 *
 * Owner, 2026-08-20: *"fleet footprint shows only scanned MCP servers which have been scanned during
 * the selected time and the result drops if a scan wasnt successfull. but we should show all MCP
 * servers there and get the number from the last successfull scan."* So the chart now plots
 * `standingSeries` — one line per server that has ever been measured, each carried forward from its
 * last successful scan — and every configured server is accounted for on the tile: measured ones as
 * a line in the legend, never-measured ones by NAME in the footer. A server is never drawn at 0 to
 * make it appear; that would be a measurement nobody took.
 *
 * A window containing no scan therefore no longer empties the chart. It becomes a NOTE beside a
 * chart that still draws the fleet's standing footprint ("no scans in this window; last measured
 * …"). The tile also does not vanish, which is what it used to do on a real instance holding 103
 * scans whose newest was 19 days old.
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
/** How many never-measured servers are named inline before the note falls back to a count. */
export const MAX_NAMED_UNMEASURED = 3;

/**
 * The tile's "every server is accounted for" footnote (dashboard-bento WP 2.3).
 *
 * A server with no successful scan cannot be plotted — there is no measurement to draw, and a 0 line
 * would state one nobody took — so it is NAMED instead of silently dropped. The wording is
 * deliberately "no successful scan yet" rather than "not scanned yet": a server whose every scan
 * FAILED has been scanned, repeatedly, and telling its owner otherwise would send them looking in
 * the wrong place.
 *
 * Long fleets degrade to `first, second, third +N more` rather than an unbounded name list — the
 * footnote sits under a chart, not in a table.
 */
export function unmeasuredNote(servers: readonly { serverName: string }[]): string {
  const named = servers.slice(0, MAX_NAMED_UNMEASURED).map((entry) => entry.serverName);
  const remaining = servers.length - named.length;
  const names =
    remaining > 0 ? `${named.join(", ")} +${formatNumber(remaining)} more` : named.join(", ");
  return servers.length === 1
    ? `1 server has no successful scan yet: ${names}`
    : `${formatNumber(servers.length)} servers have no successful scan yet: ${names}`;
}

export function HeroFootprintTile({
  section,
  onOpenServer,
}: {
  section: SectionEnvelope<FootprintData>;
  /** Where a datapoint drills to — that server's scan/detail page. Wired by the tab shell (WP 1.4). */
  onOpenServer: (serverId: string) => void;
}) {
  // The PLOTTED population is the standing one (WP 2.3) — every server ever measured, carried
  // forward from its last successful scan — NOT `perServer`, which stays the window's raw trace for
  // `MoversTile`/`StartupCostTile`.
  const plotted = section.data?.standingSeries ?? [];
  const unmeasured = section.data?.unmeasuredServers ?? [];

  // Hooks run before any early return (a tile that self-hides must not change hook order).
  const rows = useMemo(
    () =>
      pivotToRows(plotted.map((s) => ({ key: s.serverId, label: s.serverName, points: s.points }))),
    [plotted],
  );
  /** serverId → display name: a `Line`'s `dataKey` here is an opaque id, useless as an accessible name. */
  const serverNames = useMemo(
    () => new Map(plotted.map((s) => [s.serverId, s.serverName])),
    [plotted],
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
        ) : section.state !== "loading" && plotted.length === 0 ? (
          // Defensive only. Since WP 2.3 the lines are standing, and the producer returns `null`
          // (⇒ an empty section, handled above) when nothing has ever been measured — so this branch
          // is reachable only if a future producer hands over a ready section with no series. Better
          // an honest empty axis notice than a chart drawn over nothing.
          <StatePanel
            kind="empty"
            className="min-h-0 flex-1"
            icon={<CalendarRange aria-hidden />}
            title="No footprint to plot"
            description={
              data?.latestMeasuredAt != null
                ? `No per-server measurement is available to draw. The fleet was last measured ${formatRelativeTime(data.latestMeasuredAt)}; the figures above are its current surface.`
                : "No per-server measurement is available to draw. The figures above are the fleet's current surface."
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
                  // fleet's current surface, while the lines are one per MEASURED server. "N tokens
                  // across <plotted> servers" would state a total over a population it does not
                  // cover — the exact class of mismatch this plan exists to remove. Since WP 2.3 the
                  // lines are standing, so the sentence no longer says "in this window" (which would
                  // now be false); it says instead what each line's value actually is.
                  data
                    ? `Fleet total ${formatNumber(data.totalTokens)} tokens; ${formatNumber(plotted.length)} ${plotted.length === 1 ? "server" : "servers"} plotted, each held at its last successful scan`
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
                {plotted.map((s, i) => (
                  <Line key={s.serverId} dataKey={s.serverId} stroke={chartSeriesColor(i)} />
                ))}
                <XAxis />
                <ChartTooltip
                  rows={(point) =>
                    plotted.map((s, i) => ({
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
            {plotted.length > 0 ? (
              <ul className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-2">
                {plotted.map((s, i) => (
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
        {/* WP 2.3 — "show ALL MCP servers" is honoured by accounting for every configured server:
            the measured ones are lines in the legend above, and the rest are NAMED here. Plotting a
            never-measured server at 0 would state a measurement nobody took, so it is named instead
            of drawn. */}
        {section.state !== "error" && unmeasured.length > 0 ? (
          <Text variant="meta" tone="muted" className="break-words">
            {unmeasuredNote(unmeasured)}
          </Text>
        ) : null}
        {/* WP 2.3 — a quiet window is now a FOOTNOTE, not a replacement for the chart: the lines are
            standing, so "nothing was scanned in the last 7 days" no longer means "nothing to plot".
            It still has to be said, because a flat line in this state is flat for a reason. */}
        {section.state !== "error" && data?.noActivityInWindow === true && plotted.length > 0 ? (
          <Text variant="meta" tone="muted">
            {data.latestMeasuredAt !== null
              ? `No scan activity in this window — each line is held at its last successful scan; the fleet was last measured ${formatRelativeTime(data.latestMeasuredAt)}`
              : "No scan activity in this window — each line is held at its last successful scan"}
          </Text>
        ) : null}
      </CardContent>
    </BentoGridItem>
  );
}
