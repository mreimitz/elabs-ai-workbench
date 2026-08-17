import { useEffect, useState } from "react";
import type { RunFilter } from "@mcp-token-footprint/shared";
import { Text, Tooltip, TooltipContent, TooltipTrigger } from "@elabs-ai/components-ui";
import { getRunMetrics } from "../../../lib/api";
import { formatDuration } from "../../../lib/format";
import { KpiStat } from "../../../components/KpiStat";
import { buildSessionDurationStats, type SessionEnvDurationStat } from "./session-columns";

/**
 * Sessions lens mini-stat (Observability WP 2.4 DESIGN): "Per-environment p50/p95 active-duration
 * mini-stat above the table" — a thin `GET /api/metrics/runs` call (`groupBy: "environment"`,
 * `measures: ["p50DurationMs","p95DurationMs"]`, WP1.2, already merged) folded through the pure
 * {@link buildSessionDurationStats}. Reuses the ACTIVE `filter` as-is (rather than a hand-rolled
 * `{interactiveOnly:true}`) so the mini-stat respects whatever ELSE the operator has narrowed
 * (environment/model/server/…), not just the Sessions preset's own `interactiveOnly` field.
 *
 * Renders NOTHING when the active filter isn't `interactiveOnly` (mirrors `RunsCompareBar`'s
 * "renders nothing when not applicable" convention — this is a supplementary strip, not a required
 * panel with its own empty state) or once loaded with zero environments to show. Best-effort on
 * failure (like the filter bar's servers/skills option loaders in `RunsView`): a transient metrics
 * failure hides the strip rather than blocking the table underneath it.
 */
export function SessionDurationStats({
  filter,
  environmentLabel,
}: {
  filter: RunFilter;
  /** `scenarioId` → display name (Runs feed already has this via `data.scenariosById`). */
  environmentLabel: (scenarioId: string) => string;
}) {
  const active = filter.interactiveOnly === true;
  const [rows, setRows] = useState<SessionEnvDurationStat[]>([]);
  const [loading, setLoading] = useState(active);

  useEffect(() => {
    if (!active) {
      setRows([]);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    getRunMetrics(
      {
        filter,
        bucket: "week",
        groupBy: "environment",
        measures: ["p50DurationMs", "p95DurationMs"],
      },
      controller.signal,
    )
      .then((response) => {
        if (cancelled) return;
        setRows(buildSessionDurationStats(response.series));
      })
      .catch(() => {
        // Best-effort — a supplementary mini-stat never blocks or errors the table beneath it.
        if (!cancelled) setRows([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
    // `filter` is a stable reference across re-renders (`RunsView` recomputes it via `useMemo` off
    // `searchParams`, only when the URL actually changes) — a plain dependency is correct here, not a
    // hand-rolled serialized-identity workaround.
  }, [active, filter]);

  if (!active) return null;
  if (!loading && rows.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border border-border bg-muted/30 px-4 py-2.5">
      <Text variant="meta" tone="muted" className="shrink-0">
        Active duration by environment
      </Text>
      {loading ? (
        <Text variant="meta" tone="muted">
          Loading…
        </Text>
      ) : (
        rows.map((row) => <EnvDurationChip key={row.scenarioId} row={row} label={environmentLabel(row.scenarioId)} />)
      )}
    </div>
  );
}

function EnvDurationChip({ row, label }: { row: SessionEnvDurationStat; label: string }) {
  const value = (
    <span className="tabular-nums">
      p50 {row.p50Ms != null ? formatDuration(row.p50Ms) : "n/a"} · p95{" "}
      {row.p95Ms != null ? formatDuration(row.p95Ms) : "n/a"}
      {row.fallback ? "*" : ""}
    </span>
  );
  const stat = <KpiStat orientation="inline" label={label} value={value} />;
  if (!row.fallback) return stat;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="cursor-help">{stat}</div>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-pretty">
        At least one run in this environment has no recorded active duration; its wall-clock total was
        used instead (D-US3 fallback).
      </TooltipContent>
    </Tooltip>
  );
}
