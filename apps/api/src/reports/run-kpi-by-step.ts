import type {
  RunDetail,
  RunEvent,
  RunReportStepKpi,
  TokenUsageActual,
} from "@mcp-token-footprint/shared";
import { usageSplitKind } from "@mcp-token-footprint/shared";

// ── Per-step cumulative KPI snapshots (ported from the web replay path) ─────────────────────────────
// The C4 session-log report stamps EACH step with the cumulative KPIs in effect at that point (turns /
// tool-calls / tokens / context / cost). Steps carry turns/tool-calls/tokens/context, but COST lives
// ONLY on the `kpi` events (not on the step records), so the report walks `RunDetail.events` exactly the
// way the web console does. These three helpers are a verbatim PURE port of `finiteNumber` /
// `kpiSnapshotsByStepId` / `withSummaryTotals` from `apps/web/src/features/testing/RunConsole.tsx`
// (lines ~671–733). `apps/web` and `apps/api` can't share source (only the `shared` contract), so the
// logic is duplicated here behind a pure, unit-testable surface rather than re-imported across the wire
// boundary. Keep this in lockstep with the web copy if either changes.

/**
 * Cumulative run KPIs in effect at a given point, mirroring the web `RunKpis` shape.
 *
 * RM-33 WP 3.2 — this is now the SHARED {@link RunReportStepKpi} rather than a local literal: it is
 * the exact payload the run export serializes under `stepKpis`, so it belongs to the wire contract
 * and both ends import one definition.
 */
export type RunKpis = RunReportStepKpi;

/**
 * RM-33 WP 3.2 — the running cache composition, accumulated from the per-step `usageActual` while
 * the event log is walked.
 *
 * The `kpi` events of any run recorded before RM-33 carry NO cache fields, and those are the events
 * a finished run is replayed from — so without this the report's per-step snapshots would stay
 * cache-blind for almost every run in an existing database, even though the steps beside them have
 * always carried the full `TokenUsageActual`. Same fallback the console takes
 * (`RunConsole.tsx`'s `withCacheFromSteps`), applied per step rather than once at the end.
 *
 * Only an EXACT split contributes to the two halves: a turn that reported one merged figure leaves
 * them unknowable, and summing it as a "read" would present a possible 1.25x cache-WRITE premium as
 * a 0.1x cache-READ discount (D-CT2/D-CT6).
 */
type CacheAccumulator = {
  cachedTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  sawAnyCache: boolean;
  sawExactSplit: boolean;
};

function newCacheAccumulator(): CacheAccumulator {
  return {
    cachedTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    sawAnyCache: false,
    sawExactSplit: false,
  };
}

function accumulateUsage(acc: CacheAccumulator, usage: TokenUsageActual | undefined): void {
  if (!usage) return;
  const kind = usageSplitKind(usage);
  if (kind === "none") return;
  acc.sawAnyCache = true;
  acc.cachedTokens += finiteNumber(usage.cachedInputTokens);
  if (kind === "exact") {
    acc.sawExactSplit = true;
    acc.cacheReadTokens += finiteNumber(usage.cacheReadTokens);
    acc.cacheWriteTokens += finiteNumber(usage.cacheWriteTokens);
  }
}

/**
 * The cache trio for one snapshot: the `kpi` event's own values when it carries them, otherwise the
 * step-derived running totals. Each field is OMITTED when neither source knows it — absent means
 * UNKNOWN, never zero (D-CT6).
 */
function cacheFields(
  event: Extract<RunEvent, { type: "kpi" }> | undefined,
  acc: CacheAccumulator,
): Pick<RunKpis, "cachedTokens" | "cacheReadTokens" | "cacheWriteTokens"> {
  const cachedTokens = event?.cachedTokens ?? (acc.sawAnyCache ? acc.cachedTokens : undefined);
  const cacheReadTokens =
    event?.cacheReadTokens ?? (acc.sawExactSplit ? acc.cacheReadTokens : undefined);
  const cacheWriteTokens =
    event?.cacheWriteTokens ?? (acc.sawExactSplit ? acc.cacheWriteTokens : undefined);
  return {
    ...(cachedTokens === undefined ? {} : { cachedTokens }),
    ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
    ...(cacheWriteTokens === undefined ? {} : { cacheWriteTokens }),
  };
}

/**
 * Coerce a persisted numeric field to a finite number. The replay path rebuilds KPIs from the
 * persisted event log, where the API's secret-redaction over-matches the `*token*` count fields and
 * stores them as the string `"[redacted]"` (see `run-repository.ts`). `Number("[redacted]")` is NaN,
 * which would render literally as "NaN" — so anything non-finite collapses to 0. Future runs persist
 * real counts (the redaction bug is fixed server-side); this keeps already-persisted runs from
 * showing NaN on replay/report.
 */
export function finiteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Walk the persisted event log and tag every `step` event with the cumulative `kpi` in effect at
 * that point (the rolled-up totals — incl. exact cost — that the engine emitted alongside it). The
 * engine emits `kpi` right AFTER its step, so a step's snapshot is the next `kpi` that follows it;
 * steps that emit no immediate `kpi` (e.g. a bare `tool_call`) inherit the most recent one. Keyed by
 * stable `step.id` so it can't drift from the `idx`-ordered step list.
 */
export function kpiSnapshotsByStepId(events: RunEvent[]): Map<string, RunKpis> {
  const byId = new Map<string, RunKpis>();
  let running: RunKpis | null = null;
  // Step ids still awaiting the `kpi` that the engine emits right after them.
  let pendingIds: string[] = [];
  // RM-33 — the cache composition summed from the steps as they go past, the fallback for a run whose
  // persisted `kpi` events predate RM-33 and therefore carry no cache fields at all.
  const cache = newCacheAccumulator();

  for (const event of events) {
    if (event.type === "step") {
      accumulateUsage(cache, event.step.usageActual);
      // A step inherits the latest-known cumulative kpi immediately (correct for tool_call steps and
      // a safe lower bound for llm steps until their trailing kpi lands and overwrites it below).
      if (running) byId.set(event.step.id, { ...running, ...cacheFields(undefined, cache) });
      pendingIds.push(event.step.id);
    } else if (event.type === "kpi") {
      running = {
        turns: finiteNumber(event.turns),
        toolCalls: finiteNumber(event.toolCalls),
        tokensIn: finiteNumber(event.tokensIn),
        tokensOut: finiteNumber(event.tokensOut),
        contextTokens: finiteNumber(event.contextTokens),
        costUsd: finiteNumber(event.costUsd),
        ...cacheFields(event, cache),
      };
      // This kpi is the post-state of the steps emitted since the previous kpi — stamp them with it.
      for (const id of pendingIds) byId.set(id, running);
      pendingIds = [];
    }
  }
  return byId;
}

/**
 * Stamp the final step's KPI snapshot with the run SUMMARY's cumulative totals. A run's summary
 * (`tokensIn`/`tokensOut`/`turns`/…) always equals its final cumulative KPI and — unlike the per-event
 * replay log — is never redacted. For older runs whose persisted `*token*` counts were redacted to
 * `"[redacted]"` (now fixed at the source in `run-repository.ts`), this recovers the true end-state
 * totals instead of the 0 the redacted events reconstruct to; for clean runs it's a no-op (the values
 * already match). Context stays at the per-step snapshot (`step.context.total`, never redacted) — the
 * summary only carries the PEAK, which isn't the end-state context.
 */
export function withSummaryTotals(
  map: Map<string, RunKpis>,
  detail: RunDetail,
): Map<string, RunKpis> {
  if (detail.steps.length === 0) return map;
  const lastStep = detail.steps.reduce((latest, step) =>
    step.index > latest.index ? step : latest,
  );
  const prev = map.get(lastStep.id);
  // RM-33 — the same recovery, applied to the cache trio: `runs.cache_read_tokens` /
  // `cache_write_tokens` are the migration-59 columns, the authoritative end-state figures. A run
  // whose columns are NULL (unknowable — e.g. a legacy merged-only run) keeps whatever the step walk
  // could derive, and both being unknown leaves the field ABSENT rather than zero (D-CT6).
  const cachedTokens = detail.cachedTokens ?? prev?.cachedTokens;
  const cacheReadTokens = detail.cacheReadTokens ?? prev?.cacheReadTokens;
  const cacheWriteTokens = detail.cacheWriteTokens ?? prev?.cacheWriteTokens;
  map.set(lastStep.id, {
    turns: detail.turns,
    toolCalls: detail.toolCalls,
    tokensIn: detail.tokensIn,
    tokensOut: detail.tokensOut,
    contextTokens: prev?.contextTokens ?? detail.peakContextTokens,
    costUsd: detail.costUsd,
    ...(cachedTokens === undefined ? {} : { cachedTokens }),
    ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
    ...(cacheWriteTokens === undefined ? {} : { cacheWriteTokens }),
  });
  return map;
}

/**
 * Build the per-step cumulative-KPI map for a run: walk the event log, then patch the final step with
 * the never-redacted summary totals. This is the one call the report makes — it stamps each step with
 * the running turns/tool-calls/tokens/context/cost in effect at that step.
 */
export function buildRunKpiByStep(detail: RunDetail): Map<string, RunKpis> {
  return withSummaryTotals(kpiSnapshotsByStepId(detail.events), detail);
}
