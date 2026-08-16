import type { RunMetricsSeries, RunSummary } from "@mcp-token-footprint/shared";

/**
 * Sessions lens (Observability WP 2.4) — pure duration/activity math over already-fetched
 * `RunSummary`/`RunMetricsSeries` data. No network, no React; unit-tested directly.
 *
 * D-US3: duration DEFAULTS to ACTIVE (`activeDurationMs`), waiting time is the total-minus-active
 * remainder as its OWN figure, and a run persisted before Unified Sessions WP1.6 (carrying neither
 * `activeDurationMs` nor `totalDurationMs`) degrades HONESTLY — every helper below returns `null`
 * (never a fabricated 0) when it cannot compute a real figure, and flags a wall-clock fallback so the
 * caller can mark it rather than silently passing it off as the real active duration.
 */

export type ActiveDurationResult = {
  /** The duration to show, or `null` when genuinely unknown (no `activeDurationMs` AND no wall
   *  `durationMs` — e.g. a still-live run with no terminal duration yet). */
  ms: number | null;
  /** `true` when `ms` is the WALL-CLOCK fallback (`durationMs`), not the real active figure. */
  wallOnly: boolean;
};

/** Active duration, defaulting to `activeDurationMs` (D-US3); a legacy/pre-contract run with no
 *  active figure falls back to wall-clock `durationMs`, flagged `wallOnly` so the caller marks it. */
export function activeOrWallDuration(
  run: Pick<RunSummary, "activeDurationMs" | "durationMs">,
): ActiveDurationResult {
  if (run.activeDurationMs != null) return { ms: run.activeDurationMs, wallOnly: false };
  if (run.durationMs != null) return { ms: run.durationMs, wallOnly: true };
  return { ms: null, wallOnly: false };
}

/** Waiting time = `totalDurationMs - activeDurationMs` (D-US3), floored at 0. `null` unless BOTH
 *  figures are known — never invents a number from a partial pair (e.g. a still-live waiting run
 *  whose `totalDurationMs` isn't finalized yet). */
export function waitingTimeMs(
  run: Pick<RunSummary, "activeDurationMs" | "totalDurationMs">,
): number | null {
  if (run.activeDurationMs == null || run.totalDurationMs == null) return null;
  return Math.max(0, run.totalDurationMs - run.activeDurationMs);
}

export type LastActivityResult = {
  /** ISO-8601 timestamp — the best-known "last touched" instant. */
  at: string;
  /** `true` when `at` is the session START rather than a genuine terminal/last-touched marker (a
   *  still-open session, or a pre-WP1.6 legacy run with no `endedAt`) — the caller should read it as
   *  "since start", not "last activity". */
  approx: boolean;
};

/**
 * Last activity: `endedAt` (WP1.6 stamps it for EVERY terminal disposition, not only `status:"ended"`)
 * when known; otherwise `startedAt`, flagged `approx`. `RunSummary` carries no persisted "last event
 * at" timestamp independent of its terminal stamp, so a still-live/waiting session's best-known
 * instant IS its start — this is an honest proxy, documented in the WP 2.4 handback, not a fabricated
 * live-activity clock.
 */
export function lastActivityAt(run: Pick<RunSummary, "endedAt" | "startedAt">): LastActivityResult {
  if (run.endedAt) return { at: run.endedAt, approx: false };
  return { at: run.startedAt, approx: true };
}

/** One environment's rolled-up active-duration percentiles (the Sessions lens mini-stat). */
export type SessionEnvDurationStat = {
  /** The `groupBy: "environment"` key — a `scenarioId`, or `"unknown"` for an ungrouped/null series
   *  (shouldn't occur once the query actually sets `groupBy: "environment"`). */
  scenarioId: string;
  p50Ms: number | null;
  p95Ms: number | null;
  /** `true` when at least one contributing run had no `activeDurationMs` (D-US3 wall-clock fallback,
   *  from `RunMetricsSeries.durationFallback`) — mark the figure, never hide the fallback. */
  fallback: boolean;
};

/**
 * Fold a `groupBy: "environment"`, `measures: ["p50DurationMs","p95DurationMs"]` metrics response
 * into one row per environment — the LATEST (most recent) bucket per group/measure, mirroring the
 * Testing dashboard's own "latest bucket" convention (`dashboard/testing/metrics-derive.ts`
 * `buildTestingKpis`). Sorted by p95 descending (the slowest environment first). Pure; no network.
 */
export function buildSessionDurationStats(series: RunMetricsSeries[]): SessionEnvDurationStat[] {
  const byGroup = new Map<string, SessionEnvDurationStat>();
  for (const s of series) {
    if (s.measure !== "p50DurationMs" && s.measure !== "p95DurationMs") continue;
    const key = s.group ?? "unknown";
    const existing = byGroup.get(key) ?? {
      scenarioId: key,
      p50Ms: null,
      p95Ms: null,
      fallback: false,
    };
    const latest = s.points[s.points.length - 1];
    const value = latest ? latest.value : null;
    if (s.measure === "p50DurationMs") existing.p50Ms = value;
    else existing.p95Ms = value;
    if (s.durationFallback) existing.fallback = true;
    byGroup.set(key, existing);
  }
  return [...byGroup.values()].sort((a, b) => (b.p95Ms ?? -1) - (a.p95Ms ?? -1));
}
