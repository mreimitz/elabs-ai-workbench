import type { RunDetail, RunEvent } from "@mcp-token-footprint/shared";

// ── Per-step cumulative KPI snapshots (ported from the web replay path) ─────────────────────────────
// The C4 session-log report stamps EACH step with the cumulative KPIs in effect at that point (turns /
// tool-calls / tokens / context / cost). Steps carry turns/tool-calls/tokens/context, but COST lives
// ONLY on the `kpi` events (not on the step records), so the report walks `RunDetail.events` exactly the
// way the web console does. These three helpers are a verbatim PURE port of `finiteNumber` /
// `kpiSnapshotsByStepId` / `withSummaryTotals` from `apps/web/src/features/testing/RunConsole.tsx`
// (lines ~671–733). `apps/web` and `apps/api` can't share source (only the `shared` contract), so the
// logic is duplicated here behind a pure, unit-testable surface rather than re-imported across the wire
// boundary. Keep this in lockstep with the web copy if either changes.

/** Cumulative run KPIs in effect at a given point, mirroring the web `RunKpis` shape. */
export type RunKpis = {
  turns: number;
  toolCalls: number;
  tokensIn: number;
  tokensOut: number;
  contextTokens: number;
  costUsd: number;
};

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

  for (const event of events) {
    if (event.type === "step") {
      // A step inherits the latest-known cumulative kpi immediately (correct for tool_call steps and
      // a safe lower bound for llm steps until their trailing kpi lands and overwrites it below).
      if (running) byId.set(event.step.id, running);
      pendingIds.push(event.step.id);
    } else if (event.type === "kpi") {
      running = {
        turns: finiteNumber(event.turns),
        toolCalls: finiteNumber(event.toolCalls),
        tokensIn: finiteNumber(event.tokensIn),
        tokensOut: finiteNumber(event.tokensOut),
        contextTokens: finiteNumber(event.contextTokens),
        costUsd: finiteNumber(event.costUsd),
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
  map.set(lastStep.id, {
    turns: detail.turns,
    toolCalls: detail.toolCalls,
    tokensIn: detail.tokensIn,
    tokensOut: detail.tokensOut,
    contextTokens: prev?.contextTokens ?? detail.peakContextTokens,
    costUsd: detail.costUsd,
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
