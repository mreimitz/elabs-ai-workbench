import type {
  ContextSegment,
  ContextSnapshot,
  RunOutcome,
  RunStep,
} from "@mcp-token-footprint/shared";
import {
  CONTEXT_SEGMENTS,
  usageInputSlices,
  usageSplitKind,
} from "@mcp-token-footprint/shared";
import type { RunStreamState } from "./use-run-stream";

/**
 * Pure derivation layer for the Wave-2 Analytics dashboard (findings/09 §4). ALL aggregation lives
 * here — typed, React-free, unit-testable — so `AnalyticsPanel`/`RunGantt` stay presentational. The
 * panel reads two sources and degrades gracefully on either:
 *   - `stream: RunStreamState` — the live/replay accumulator (steps + timeline + kpis). The source of
 *     truth while a run is in flight (the report endpoint is partial until the run finishes).
 *   - `RunReport` — the finished-run report payload (`GET /api/reports/run/:id/json`), which adds
 *     COST (per-step cumulative + total) + run statistics that the stream alone can't compute.
 *
 * Nothing here fabricates a figure: a value that can't be derived from the inputs is `null`/omitted,
 * never guessed (e.g. unused-tool detection needs a run-time allowed-tools snapshot we don't capture).
 */

// ── Report payload (mirror of apps/api/src/reports/reports.ts `createRunJsonReport`) ─────────────

/** Per-step cumulative KPI snapshot — the figure steps don't carry on their own is `costUsd`. */
export type RunReportStepKpi = {
  turns: number;
  toolCalls: number;
  tokensIn: number;
  tokensOut: number;
  contextTokens: number;
  costUsd: number;
};

/** Run-level statistics block of the report payload. */
export type RunReportStatistics = {
  turns: number;
  toolCalls: number;
  tokensIn: number;
  tokensOut: number;
  cachedTokens: number;
  peakContextTokens: number;
  contextLimit: number | null;
  endStateContextTokens?: number;
  estimatedCostUsd: number;
  peakContextSegments: Record<ContextSegment, number> | null;
};

/**
 * The fields of the run report this dashboard consumes. The API returns more (`run`, `test`,
 * `scenario`); we type only what we read so a not-yet-finished/partial fetch can be narrowed safely.
 */
export type RunReport = {
  statistics: RunReportStatistics;
  /** Cumulative KPI snapshot keyed by step id (`stepKpis[step.id]`). */
  stepKpis: Record<string, RunReportStepKpi>;
};

// ── Small numeric helpers ────────────────────────────────────────────────────────────────────────

export function toFiniteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** The first populated estimator-lens token count (lenses are partial — only effective profiles). */
export function firstProfileTokens(step: RunStep): number {
  for (const value of Object.values(step.profileTokens)) {
    if (typeof value === "number") return value;
  }
  return 0;
}

// ── Overview KPIs ─────────────────────────────────────────────────────────────────────────────

/** Headline KPI tiles for the Overview sub-tab — resolved from the report, falling back to `stream`. */
export type OverviewKpis = {
  tokensIn: number;
  tokensOut: number;
  cachedTokens: number;
  /** Cached input tokens as a % of all input tokens (0 when no input tokens). */
  cachedPercent: number;
  /**
   * RM-33 (D-CT2) — the read/write halves of `cachedTokens`, summed across the run's settled turns.
   * `null` when NO turn reported the split: the halves are then unknowable, and a 0 would state that
   * nothing was read and nothing written — a claim the data does not support.
   */
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  estimatedCostUsd: number;
  turns: number;
  toolCalls: number;
  toolErrors: number;
  peakContextTokens: number;
  contextLimit: number | null;
  /** Peak context as a % of the model limit, or `null` when the limit is unknown. */
  peakContextPercent: number | null;
  /** Wall-clock run duration (ms) from the first to last timed step, or `null` when untimed. */
  durationMs: number | null;
};

/** Count tool errors from the stream: any `tool_result`/`tool_call` step with `status === "error"`. */
export function countToolErrors(steps: RunStep[]): number {
  return steps.filter(
    (s) => (s.type === "tool_result" || s.type === "tool_call") && s.status === "error",
  ).length;
}

/** Sum provider-actual cached input tokens across the run's `llm_response` steps. */
export function sumCachedTokens(steps: RunStep[]): number {
  return steps.reduce((sum, s) => sum + toFiniteNumber(s.usageActual?.cachedInputTokens), 0);
}

/**
 * RM-33 — sum the cache READ/WRITE halves across the run's settled turns.
 *
 * Both come back `null` unless at least one step reported an EXACT split. A run whose steps carry
 * only a merged `cachedInputTokens` (the historical shape — 6 runs in a real 163-run database) must
 * not be summarised as "0 read, 0 written": the split is unknowable, and stating zero would present a
 * possible 1.25x cache-WRITE premium as though no premium had been paid.
 */
function sumCacheSplit(steps: RunStep[]): {
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
} {
  let read = 0;
  let write = 0;
  let anyExact = false;
  for (const step of steps) {
    const usage = step.usageActual;
    if (!usage || usageSplitKind(usage) !== "exact") continue;
    anyExact = true;
    read += toFiniteNumber(usage.cacheReadTokens);
    write += toFiniteNumber(usage.cacheWriteTokens);
  }
  return anyExact
    ? { cacheReadTokens: read, cacheWriteTokens: write }
    : { cacheReadTokens: null, cacheWriteTokens: null };
}

/** Sum provider-actual input tokens across the run's `llm_response` steps. */
function sumActualInputTokens(steps: RunStep[]): number {
  return steps.reduce((sum, s) => sum + toFiniteNumber(s.usageActual?.inputTokens), 0);
}

/** Sum provider-actual output tokens across the run's `llm_response` steps. */
function sumActualOutputTokens(steps: RunStep[]): number {
  return steps.reduce((sum, s) => sum + toFiniteNumber(s.usageActual?.outputTokens), 0);
}

/** Wall-clock run duration from the earliest `startedAt` to the latest `endedAt` (ms), or null. */
export function runDurationMs(steps: RunStep[]): number | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const s of steps) {
    if (s.startedAt) min = Math.min(min, Date.parse(s.startedAt));
    if (s.endedAt) max = Math.max(max, Date.parse(s.endedAt));
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null;
  return max - min;
}

/** The peak (largest-total) context snapshot across the run's steps, or null. */
export function peakContextSnapshot(steps: RunStep[]): ContextSnapshot | null {
  let peak: ContextSnapshot | null = null;
  for (const s of steps) {
    if (s.context && (!peak || s.context.total > peak.total)) peak = s.context;
  }
  return peak;
}

/**
 * Resolve the Overview KPIs. Prefers the report's `statistics` (it has cost + the canonical totals);
 * falls back to deriving from the stream so a still-running run shows live numbers. Tool errors,
 * cached % and duration come from the stream's steps either way (the report doesn't break them out).
 */
export function deriveOverviewKpis(stream: RunStreamState, report: RunReport | null): OverviewKpis {
  const steps = stream.steps;
  const stats = report?.statistics ?? null;

  const tokensIn = stats?.tokensIn ?? stream.kpis?.tokensIn ?? sumActualInputTokens(steps);
  const tokensOut = stats?.tokensOut ?? stream.kpis?.tokensOut ?? sumActualOutputTokens(steps);
  const cachedTokens = stats?.cachedTokens ?? sumCachedTokens(steps);
  const cachedPercent = tokensIn > 0 ? (cachedTokens / tokensIn) * 100 : 0;
  const { cacheReadTokens, cacheWriteTokens } = sumCacheSplit(steps);

  const peakContextTokens =
    stats?.peakContextTokens ??
    peakContextSnapshot(steps)?.total ??
    stream.kpis?.contextTokens ??
    0;
  const contextLimit = stats?.contextLimit ?? null;
  const peakContextPercent =
    contextLimit && contextLimit > 0 ? (peakContextTokens / contextLimit) * 100 : null;

  return {
    tokensIn,
    tokensOut,
    cachedTokens,
    cachedPercent,
    cacheReadTokens,
    cacheWriteTokens,
    estimatedCostUsd: stats?.estimatedCostUsd ?? stream.kpis?.costUsd ?? 0,
    turns: stats?.turns ?? stream.kpis?.turns ?? 0,
    toolCalls: stats?.toolCalls ?? stream.kpis?.toolCalls ?? 0,
    toolErrors: countToolErrors(steps),
    peakContextTokens,
    contextLimit,
    peakContextPercent,
    durationMs: runDurationMs(steps),
  };
}

// ── Per-turn trend series (cost + context) ───────────────────────────────────────────────────────

/**
 * One row of the per-turn cumulative trend (Overview cost line + context-growth area). `x` is a real
 * `Date` so the time-series charts (`LineChart`/`AreaChart`, whose x-axis is date-oriented) render
 * even though the underlying ordinal is the turn number — we synthesize evenly-spaced timestamps
 * (1 minute apart, anchored at epoch) so the axis is monotonic and the label is "turn N".
 */
export type TurnTrendRow = {
  /** Synthetic monotonic timestamp for the time-series x-axis (see above). */
  x: Date;
  /** 1-based turn ordinal (the human-facing label). */
  turn: number;
  /** Cumulative estimated cost ($) through this turn (from the report's step KPIs; 0 without it). */
  costUsd: number;
  /** Context-window total (tokens) after this turn — the monotonic staircase. */
  contextTokens: number;
};

/**
 * Build the per-turn trend rows from the settled `llm_response` steps (one per turn). Cost is read
 * from the report's `stepKpis[step.id].costUsd` (the only place cumulative cost lives); context is the
 * step's own `contextSnapshot.total`. Without a report, cost is 0 across the board (degrade gracefully)
 * but the context staircase still renders from the stream.
 */
export function deriveTurnTrend(stream: RunStreamState, report: RunReport | null): TurnTrendRow[] {
  const EPOCH = 0;
  const STEP_MS = 60_000;
  const rows: TurnTrendRow[] = [];
  let turn = 0;
  for (const step of stream.steps) {
    if (step.type !== "llm_response") continue;
    turn += 1;
    const kpi = report?.stepKpis[step.id];
    rows.push({
      x: new Date(EPOCH + turn * STEP_MS),
      turn,
      costUsd: toFiniteNumber(kpi?.costUsd),
      contextTokens: step.context?.total ?? toFiniteNumber(kpi?.contextTokens),
    });
  }
  return rows;
}

/** True when any turn carries a non-zero cumulative cost (so the cost chart is worth drawing). */
export function hasCostData(rows: TurnTrendRow[]): boolean {
  return rows.some((r) => r.costUsd > 0);
}

// ── Tokens sub-tab series ─────────────────────────────────────────────────────────────────────

/** One stacked-bar row of per-turn context composition (the 5 `CONTEXT_SEGMENTS` series). */
export type ContextSegmentRow = { turn: string } & Record<ContextSegment, number>;

/** Per-turn context-segment composition rows for the stacked BarChart (settled turns only). */
export function deriveContextSegmentRows(steps: RunStep[]): ContextSegmentRow[] {
  const rows: ContextSegmentRow[] = [];
  let turn = 0;
  for (const step of steps) {
    if (step.type !== "llm_response" || !step.context) continue;
    turn += 1;
    const turnOrdinal = typeof step.turnIndex === "number" ? step.turnIndex + 1 : turn;
    const row = { turn: `Turn ${turnOrdinal}` } as ContextSegmentRow;
    for (const seg of CONTEXT_SEGMENTS) {
      row[seg] = step.context.segments[seg] ?? 0;
    }
    rows.push(row);
  }
  return rows;
}

/**
 * One row of the per-turn input-token composition (RM-33).
 *
 * THREE series, not two (D-CT2). The pre-RM-33 chart stacked `cached` against `uncached`, which read
 * as "the green part was cheap" — but a cache WRITE is billed at **1.25×** the input rate while a
 * cache READ is billed at ~**0.1×**. Merging a premium and a discount into one bar is how an
 * expensive turn gets displayed as a saving.
 *
 * `cacheWrite` is `null` on a turn whose provider reported only a merged figure: that turn's split is
 * unknowable, so its whole cached slice stays in `cacheRead`… which would be a guess. It does not.
 * Instead `mergedCache` carries it and `cacheRead`/`cacheWrite` are both `null`, so a chart can render
 * the merged bar in a distinct, explicitly-labelled series rather than silently mis-attributing it.
 */
export type CachedTokenRow = {
  turn: string;
  uncached: number;
  cacheRead: number | null;
  cacheWrite: number | null;
  /** Set ONLY when the read/write split is unavailable for this turn; null otherwise. */
  mergedCache: number | null;
};

/** Per-turn input-token composition (from each `llm_response` step's `usageActual`). */
export function deriveCachedTokenRows(steps: RunStep[]): CachedTokenRow[] {
  const rows: CachedTokenRow[] = [];
  let turn = 0;
  for (const step of steps) {
    if (step.type !== "llm_response" || !step.usageActual) continue;
    turn += 1;
    const turnOrdinal = typeof step.turnIndex === "number" ? step.turnIndex + 1 : turn;
    const usage = step.usageActual;
    const input = toFiniteNumber(usage.inputTokens);
    const label = `Turn ${turnOrdinal}`;

    if (usageSplitKind(usage) === "merged") {
      const merged = Math.min(input, toFiniteNumber(usage.cachedInputTokens));
      rows.push({
        turn: label,
        uncached: Math.max(0, input - merged),
        cacheRead: null,
        cacheWrite: null,
        mergedCache: merged,
      });
      continue;
    }

    // `usageInputSlices` clamps a provider reporting more cache than input, and re-sums to the gross
    // `inputTokens` (D-CT1) so the stacked bar's height is the real send, not a derived one.
    const slices = usageInputSlices(usage);
    rows.push({
      turn: label,
      uncached: slices?.uncached ?? input,
      cacheRead: slices?.cacheRead ?? 0,
      cacheWrite: slices?.cacheWrite ?? 0,
      mergedCache: null,
    });
  }
  return rows;
}

/** One row comparing the estimator-profile token count against the provider-actual total, per turn. */
export type EstimateVsActualRow = { turn: string; estimate: number; actual: number };

/**
 * Per-turn estimate-vs-actual tokens: the run's effective estimator profile (`profileTokens`, first
 * populated lens) against the provider-actual input+output total (`usageActual`). Only turns carrying
 * actual usage are plotted (the estimator alone has no ground truth to compare against).
 */
export function deriveEstimateVsActualRows(steps: RunStep[]): EstimateVsActualRow[] {
  const rows: EstimateVsActualRow[] = [];
  let turn = 0;
  for (const step of steps) {
    if (step.type !== "llm_response" || !step.usageActual) continue;
    turn += 1;
    const turnOrdinal = typeof step.turnIndex === "number" ? step.turnIndex + 1 : turn;
    const actual =
      toFiniteNumber(step.usageActual.inputTokens) + toFiniteNumber(step.usageActual.outputTokens);
    rows.push({ turn: `Turn ${turnOrdinal}`, estimate: firstProfileTokens(step), actual });
  }
  return rows;
}

// ── Tools sub-tab aggregation ──────────────────────────────────────────────────────────────────

/** Per-tool aggregate row for the Tools DataTable (one row per distinct `toolName`). */
export type ToolAggregate = {
  toolName: string;
  serverId: string;
  /** Number of `tool_call` steps for this tool. */
  calls: number;
  /** Total result-payload tokens under the primary profile (from the MCP-sink step's `profileTokens`). */
  resultTokens: number;
  /** Mean tool latency (ms) over calls that carry `durationMs`, or null when none do. */
  avgLatencyMs: number | null;
  /** Max tool latency (ms), or null when no call carries `durationMs`. */
  maxLatencyMs: number | null;
  /** Errored calls / total calls, as a fraction 0–1. */
  errorRate: number;
};

/**
 * Aggregate tool usage by `toolName` over the run's `tool_call` steps. Latency + result tokens come
 * from the MCP-sink `tool_call` steps (the `:mcp:`-keyed ones carry real `durationMs` + the result's
 * `profileTokens`); errors from any `tool_call`/`tool_result` step of that tool with `status: "error"`.
 */
export function deriveToolAggregates(steps: RunStep[]): ToolAggregate[] {
  type Acc = {
    serverId: string;
    calls: number;
    resultTokens: number;
    latencies: number[];
    errors: number;
  };
  const byTool = new Map<string, Acc>();

  const ensure = (name: string): Acc => {
    let acc = byTool.get(name);
    if (!acc) {
      acc = { serverId: "", calls: 0, resultTokens: 0, latencies: [], errors: 0 };
      byTool.set(name, acc);
    }
    return acc;
  };

  for (const step of steps) {
    if (step.type !== "tool_call" && step.type !== "tool_result") continue;
    const name = step.toolName ?? step.label;
    const acc = ensure(name);
    if (step.serverId && !acc.serverId) acc.serverId = step.serverId;

    const isMcp = step.id.includes(":mcp:");
    if (step.type === "tool_call") {
      // Count one logical call per ENGINE tool_call step; the MCP-sink duplicate carries the timing +
      // result tokens but must not double the call count.
      if (!isMcp) acc.calls += 1;
      if (isMcp) {
        if (typeof step.durationMs === "number") acc.latencies.push(step.durationMs);
        acc.resultTokens += firstProfileTokens(step);
      } else if (typeof step.durationMs === "number") {
        acc.latencies.push(step.durationMs);
      }
    }
    if (step.status === "error") acc.errors += 1;
  }

  return [...byTool.entries()]
    .map(([toolName, acc]) => {
      const latencyCount = acc.latencies.length;
      const sum = acc.latencies.reduce((s, v) => s + v, 0);
      return {
        toolName,
        serverId: acc.serverId,
        calls: acc.calls,
        resultTokens: acc.resultTokens,
        avgLatencyMs: latencyCount > 0 ? sum / latencyCount : null,
        maxLatencyMs: latencyCount > 0 ? Math.max(...acc.latencies) : null,
        errorRate: acc.calls > 0 ? acc.errors / acc.calls : 0,
      };
    })
    .sort((a, b) => b.calls - a.calls || b.resultTokens - a.resultTokens);
}

/** One calls-per-server bar row. */
export type ServerCallsRow = { server: string; calls: number };

/** Calls grouped by server id over the distinct logical tool calls. */
export function deriveServerCalls(aggregates: ToolAggregate[]): ServerCallsRow[] {
  const byServer = new Map<string, number>();
  for (const t of aggregates) {
    const key = t.serverId || "unknown";
    byServer.set(key, (byServer.get(key) ?? 0) + t.calls);
  }
  return [...byServer.entries()]
    .map(([server, calls]) => ({ server, calls }))
    .sort((a, b) => b.calls - a.calls);
}

/** Distinct tool names that were actually called (the USED set). */
export function deriveUsedTools(aggregates: ToolAggregate[]): string[] {
  return aggregates.map((t) => t.toolName);
}

// ── Errors sub-tab ─────────────────────────────────────────────────────────────────────────────

/** One row in the Errors list — a failed step or the terminal abnormal outcome. */
export type ErrorRow = {
  id: string;
  /** Short kind label, e.g. "Tool error", "LLM error", "Transport", "Context overflow". */
  kind: string;
  /** Human label of the offending step / event. */
  label: string;
  /** Optional longer detail (the redacted error message / transport error), if available. */
  detail?: string;
  /** Turn ordinal (1-based) when known. */
  turn?: number;
  /**
   * WP 3.2 — the failing tool call's `toolCallId` (tool errors only). Lets an error card cross-link
   * to the exact call in the Chat/Trace; non-tool/terminal rows fall back to their turn (or nothing).
   */
  toolCallId?: string;
};

/**
 * The redacted error text for a failed step. The COMMON case is an MCP tool-level error: a tool that
 * returns `{ isError: true, content: [{ type:"text", text }] }` carries its message in
 * `payload.result.content[].text` (e.g. a server-side validation error) — NOT on a top-level `error`
 * key. We read that first, then fall back to a `transportError`/`error`/`message` string (or the
 * `.message` of such an object) for transport-level failures.
 */
function payloadError(step: RunStep): string | undefined {
  const p = step.payload;
  if (!p || typeof p !== "object") return undefined;
  const rec = p as Record<string, unknown>;
  // MCP tool-level error: payload.result = { content: [{ type:"text", text }], isError: true }.
  const result = rec.result;
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (r.isError === true && Array.isArray(r.content)) {
      const text = r.content
        .map((c) =>
          c && typeof c === "object" && typeof (c as { text?: unknown }).text === "string"
            ? (c as { text: string }).text
            : "",
        )
        .filter((t) => t.length > 0)
        .join("\n")
        .trim();
      if (text.length > 0) return text;
    }
  }
  // Transport / generic error: a string, or an object carrying a `message`.
  for (const key of ["transportError", "error", "message"] as const) {
    const v = rec[key];
    if (typeof v === "string" && v.length > 0) return v;
    if (v && typeof v === "object") {
      const m = (v as Record<string, unknown>).message;
      if (typeof m === "string" && m.length > 0) return m;
    }
  }
  return undefined;
}

/** The tool_use id a tool step belongs to (for de-duping the MCP-sink tool_call vs its tool_result). */
function toolCallIdOf(step: RunStep): string | undefined {
  const p = step.payload;
  if (p && typeof p === "object") {
    const v = (p as Record<string, unknown>).toolCallId;
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

/**
 * Collect the run's failures for the Errors sub-tab: every `status: "error"` step (tool or llm), any
 * step whose payload carries a `transportError`, plus the terminal abnormal outcome (context overflow
 * / guardrail stop) read from the stream's `outcome`/`stopReason`. Read-only — the rows are not wired
 * to open the inspector (findings/09 §4.5: clicking is optional and explicitly out of scope here).
 */
export function deriveErrorRows(stream: RunStreamState): ErrorRow[] {
  const rows: ErrorRow[] = [];
  // A failed tool call emits BOTH an MCP-sink `tool_call` (carries only the `isError` flag, no turn)
  // and a `tool_result` (carries the message + turn) under one `toolCallId`. Collapse the pair to a
  // single row, keeping whichever detail/turn is present — otherwise every failure shows twice, once
  // empty. Non-tool failures (and tool steps with no id) are never merged.
  const toolRowByCall = new Map<string, number>();

  for (const step of stream.steps) {
    const turn = typeof step.turnIndex === "number" ? step.turnIndex + 1 : undefined;
    const detail = payloadError(step);
    if (step.status === "error") {
      const isTool = step.type === "tool_call" || step.type === "tool_result";
      const kind = isTool
        ? "Tool error"
        : step.type === "llm_response" || step.type === "llm_request"
          ? "LLM error"
          : "Error";
      const callId = isTool ? toolCallIdOf(step) : undefined;
      const row: ErrorRow = {
        id: step.id,
        kind,
        label: step.toolName ?? step.label,
        ...(detail ? { detail } : {}),
        ...(turn !== undefined ? { turn } : {}),
        ...(callId !== undefined ? { toolCallId: callId } : {}),
      };
      const existingIdx = callId !== undefined ? toolRowByCall.get(callId) : undefined;
      const existing = existingIdx !== undefined ? rows[existingIdx] : undefined;
      if (callId !== undefined && existingIdx !== undefined && existing) {
        // Merge the sibling rows: fill in any missing detail / turn (the message lives on tool_result).
        rows[existingIdx] = {
          ...existing,
          ...(!existing.detail && row.detail ? { detail: row.detail } : {}),
          ...(existing.turn === undefined && row.turn !== undefined ? { turn: row.turn } : {}),
          ...(existing.toolCallId === undefined && row.toolCallId !== undefined
            ? { toolCallId: row.toolCallId }
            : {}),
        };
      } else {
        if (callId !== undefined) toolRowByCall.set(callId, rows.length);
        rows.push(row);
      }
    } else if (detail) {
      // A transport error surfaced on a non-error step (e.g. a recovered retry) is still worth listing.
      rows.push({
        id: `${step.id}:transport`,
        kind: "Transport",
        label: step.toolName ?? step.label,
        detail,
        ...(turn !== undefined ? { turn } : {}),
      });
    }
  }

  // Terminal abnormal outcome (the run-level stop), appended last so it reads as the closing event.
  const terminal = terminalErrorRow(stream.outcome, stream.stopReason, stream.error);
  if (terminal) rows.push(terminal);

  return rows;
}

// ── Per-step economics (WP 3.2 — tree StepLog + nested Gantt + per-step economics) ─────────────────
// The step tree (WP3.1's `parentStepId`) is priced by diffing the CUMULATIVE per-step KPI snapshot
// (`stepKpis` from `apps/api/src/reports/run-kpi-by-step.ts`'s payload, or the console's own identically
// shaped `kpiByStepId` — both keyed by step id) against the previous step's snapshot, in the run's flat
// `index` order (the same order the snapshots were captured in — the cumulative ledger is sequential
// over the FLAT stream regardless of tree depth). This mirrors `trace-tree.ts`'s existing per-turn cost
// diff (`prevTurnCostBase`), generalized to every step.

/** The minimal cumulative-KPI shape a per-step economics source must carry (the console's `RunKpis`
 *  and the report's `RunReportStepKpi` both satisfy this structurally — either Map works here). */
export type StepCumulativeKpi = {
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
};

/** A step's OWN (non-cumulative) economics — how much it moved the run's ledger, plus its own timing. */
export type StepEconomics = {
  tokensInDelta: number;
  tokensOutDelta: number;
  costUsdDelta: number;
  /** The step's own wall-clock duration, or null when untimed (never fabricated). */
  durationMs: number | null;
};

const ZERO_ECONOMICS: Omit<StepEconomics, "durationMs"> = {
  tokensInDelta: 0,
  tokensOutDelta: 0,
  costUsdDelta: 0,
};

/**
 * A `judge_call` child's OWN economics come from its `payload.judgeTokensIn`/`judgeTokensOut`/
 * `judgeCostUsd` (grade-service's SEPARATE judge ledger — grading tokens/cost never move the run's
 * main `tokensIn`/`tokensOut`/`costUsd`, so diffing the cumulative run ledger for a judge_call step
 * would dishonestly read 0). Every other step reads the generic cumulative-diff path. Not exported —
 * an internal special-case of {@link derivePerStepEconomics}.
 */
function judgeCallEconomics(step: RunStep): Omit<StepEconomics, "durationMs"> | null {
  if (step.spanKind !== "judge_call") return null;
  const payload = step.payload;
  if (!payload || typeof payload !== "object") return null;
  const rec = payload as Record<string, unknown>;
  return {
    tokensInDelta: toFiniteNumber(rec.judgeTokensIn),
    tokensOutDelta: toFiniteNumber(rec.judgeTokensOut),
    costUsdDelta: toFiniteNumber(rec.judgeCostUsd),
  };
}

/**
 * Per-step economics DELTA for every step: how much each step moved the run's cumulative tokens/cost
 * (diffing consecutive `cumulative` snapshots in flat `index` order), plus its own `durationMs`. A step
 * with no snapshot entry yet (a live/partial map, or a run recorded before per-step KPI snapshots)
 * contributes a zero delta rather than a guess — HONEST, matching the rest of this module. `steps` MUST
 * already be in flat index order (as every `RunStreamState.steps`/`RunDetail.steps` is).
 */
export function derivePerStepEconomics(
  steps: RunStep[],
  cumulative: ReadonlyMap<string, StepCumulativeKpi> | null,
): Map<string, StepEconomics> {
  const out = new Map<string, StepEconomics>();
  let prev: StepCumulativeKpi = { tokensIn: 0, tokensOut: 0, costUsd: 0 };

  for (const step of steps) {
    const durationMs = step.durationMs ?? null;
    const judgeOverride = judgeCallEconomics(step);
    if (judgeOverride) {
      out.set(step.id, { ...judgeOverride, durationMs });
      continue;
    }
    const snap = cumulative?.get(step.id);
    if (snap) {
      out.set(step.id, {
        tokensInDelta: Math.max(0, snap.tokensIn - prev.tokensIn),
        tokensOutDelta: Math.max(0, snap.tokensOut - prev.tokensOut),
        costUsdDelta: Math.max(0, snap.costUsd - prev.costUsd),
        durationMs,
      });
      prev = snap;
    } else {
      out.set(step.id, { ...ZERO_ECONOMICS, durationMs });
    }
  }
  return out;
}

/**
 * Subtree rollup: a parent's OWN economics PLUS every descendant's (WP3.1's `parentStepId` tree) — e.g.
 * a `tool_call` parent rolled up with its `tool_io` child, or a `rating` span rolled up with its
 * `judge_call` children (surfacing the run's actual LLM-judge token/cost spend, which the parent `rating`
 * span alone never carries). `durationMs` is NOT summed — a child's timed span already sits INSIDE its
 * parent's wall-clock window (WP3.1: a `tool_io` child mirrors its parent's timing), so summing would
 * double-count; the parent's OWN duration wins (null when the parent itself is untimed, e.g. `rating`).
 */
export function rollupSubtreeEconomics(
  stepId: string,
  childrenByParentId: ReadonlyMap<string, string[]>,
  perStep: ReadonlyMap<string, StepEconomics>,
): StepEconomics {
  const own = perStep.get(stepId) ?? { ...ZERO_ECONOMICS, durationMs: null };
  let tokensInDelta = own.tokensInDelta;
  let tokensOutDelta = own.tokensOutDelta;
  let costUsdDelta = own.costUsdDelta;
  for (const childId of childrenByParentId.get(stepId) ?? []) {
    const child = rollupSubtreeEconomics(childId, childrenByParentId, perStep);
    tokensInDelta += child.tokensInDelta;
    tokensOutDelta += child.tokensOutDelta;
    costUsdDelta += child.costUsdDelta;
  }
  return { tokensInDelta, tokensOutDelta, costUsdDelta, durationMs: own.durationMs };
}

/** Map the terminal outcome / stop reason / stream error to a closing Errors row, or null when clean. */
function terminalErrorRow(
  outcome: RunOutcome | undefined,
  stopReason: string | undefined,
  streamError: string | null,
): ErrorRow | null {
  if (outcome === "context_overflow") {
    return {
      id: "terminal:overflow",
      kind: "Context overflow",
      label: "Run stopped — context window exceeded",
      ...(stopReason ? { detail: stopReason } : {}),
    };
  }
  if (outcome === "stopped_guardrail") {
    return {
      id: "terminal:guardrail",
      kind: "Guardrail stop",
      label: "Run stopped by a guardrail",
      ...(stopReason ? { detail: stopReason } : {}),
    };
  }
  if (outcome === "error") {
    return {
      id: "terminal:error",
      kind: "Run error",
      label: "Run ended with an error",
      ...(streamError ? { detail: streamError } : stopReason ? { detail: stopReason } : {}),
    };
  }
  // A connection-lost stream error with no terminal outcome is still surfaced.
  if (!outcome && streamError) {
    return { id: "terminal:stream", kind: "Stream", label: streamError };
  }
  return null;
}
