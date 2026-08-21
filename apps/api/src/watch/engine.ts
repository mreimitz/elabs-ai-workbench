// Observability — the watch-rule engine (planning/Roadmap/RM-17-observability/, WP4.1, D-OB19/D-OB21).
//
// The ONE on-terminal evaluation entry point: {@link WatchEngine.onRunSettled} is called from the
// SINGLE post-finish choke point (testing/run-service.ts `reviewRun`, AFTER the run reaches a terminal
// status AND its rating axis settles — the SAME seam auto-rating uses). It:
//   1. materializes the run into a {@link RunFilterCandidate} (RunRepository.buildFilterCandidate),
//   2. evaluates every enabled `on_terminal` rule's {@link RunFilter} with the SHARED pure
//      `matchesRunFilter` predicate (NO SQL),
//   3. applies an optional DETERMINISTIC sample (a per-(rule,run) hash — reproducible, no RNG),
//   4. executes the rule's actions in their FIXED stored order, each AUDITED, each ISOLATED.
//
// ⚠️ NON-NEGOTIABLE: RULES ARE OBSERVERS. Nothing here may mutate run lifecycle/status/totals/grades
// or block/delay the run pipeline. The run is ALREADY terminal + rated before this runs, so nothing it
// does can change the run's outcome. The WHOLE method is guarded (it can never throw into the caller);
// each rule + each action is independently guarded, so one failing action NEVER blocks the next action,
// the next rule, or the run. This is strictly post-hoc.

import crypto from "node:crypto";
import {
  isWatchRulePaused,
  matchesRunFilter,
  resolveNoDataPolicy,
  WATCH_CATCHUP_MAX_WINDOWS,
  WATCH_MARKER_PAUSED,
  WATCH_MARKER_RATE_LIMITED,
  WATCH_MARKER_WINDOW_NO_DATA,
  WATCH_PREVIEW_DEFAULT_WINDOWS,
  watchWindowState,
  watchWindowStateFires,
  type MetricsBucket,
  type RunFilter,
  type RunMetricsRatioConfig,
  type RunFilterCandidate,
  type WatchRule,
  type WatchWindowConfig,
  type WatchWindowDuration,
  type WatchWindowLevel,
  type WatchWindowPreview,
  type WatchWindowPreviewPoint,
  type WatchWindowState,
} from "@mcp-token-footprint/shared";
import type { AppDatabase } from "../db/database.js";
import { computeRunMetrics } from "../observability/metrics.js";
import type { RunRepository } from "../testing/run-repository.js";
import {
  executeWatchAction,
  executeWatchWindowAction,
  type WatchActionServices,
  type WatchRunSummaryView,
  type WatchWindowSummaryView,
} from "./actions.js";
import type { WatchRuleRepository } from "./repository.js";

export class WatchEngine {
  constructor(
    private readonly rules: WatchRuleRepository,
    private readonly runs: RunRepository,
    private readonly services: WatchActionServices,
  ) {}

  /**
   * Evaluate every enabled `on_terminal` rule against ONE just-settled run. Fires EXACTLY ONCE per run
   * (called once from the choke point). FULLY GUARDED: an exception anywhere is caught + swallowed so
   * the post-terminal review chain (and thus run completion) is never affected — rules are observers.
   */
  async onRunSettled(runId: string, nowMs: number = Date.now()): Promise<void> {
    try {
      const candidate = this.runs.buildFilterCandidate(runId);
      if (!candidate) return; // run vanished between settle + here — nothing to observe

      const at = new Date(nowMs).toISOString();
      const run = toRunView(runId, candidate);
      const rules = this.rules.listEnabledByTrigger("on_terminal");
      for (const rule of rules) {
        try {
          if (!matchesRunFilter(candidate, rule.filter)) continue; // no match → no effect, no audit

          if (!sampleDecision(rule.id, runId, rule.sample)) {
            // Matched but sampled OUT — record the decision so the sample is auditable + reproducible.
            this.rules.recordEvent(
              rule.id,
              runId,
              "sampled_out",
              { ok: true, detail: `sampled out (rate ${rule.sample})` },
              at,
            );
            continue;
          }

          // AM-OB10 — PAUSED. The rule still matched and still gets an audit row; it just does not
          // DISPATCH. That is the whole difference from `enabled: false`, which never reaches here:
          // when the pause expires the operator can read back exactly what went by while it was
          // quiet, and the rule was never blind.
          if (isWatchRulePaused(rule, nowMs)) {
            this.rules.recordEvent(
              rule.id,
              runId,
              WATCH_MARKER_PAUSED,
              { ok: true, detail: `paused until ${rule.pausedUntil} — actions suppressed` },
              at,
            );
            continue;
          }

          // AM-OB10 — the minimum interval between dispatches. WITHOUT this an `on_terminal` rule had
          // NO suppression at all: a broken environment producing 50 failing runs produced 50
          // notifications. The baseline is the last time an ACTION row was written for this rule —
          // the audit IS the state, exactly as the windowed cooldown re-seeds from it (no new column,
          // nothing in memory to lose on restart).
          const minIntervalMs = (rule.minIntervalMinutes ?? 0) * 60_000;
          if (minIntervalMs > 0) {
            const lastActionAt = this.rules.getLastActionAt(rule.id);
            const lastMs = lastActionAt !== null ? Date.parse(lastActionAt) : Number.NaN;
            if (Number.isFinite(lastMs) && nowMs - lastMs < minIntervalMs) {
              this.rules.recordEvent(
                rule.id,
                runId,
                WATCH_MARKER_RATE_LIMITED,
                {
                  ok: true,
                  detail: `rate limited — last dispatch ${lastActionAt}, minimum interval ${rule.minIntervalMinutes} min`,
                },
                at,
              );
              continue;
            }
          }

          // Execute the rule's actions in their FIXED stored order; each is isolated + audited.
          for (const action of rule.actions) {
            const result = await executeWatchAction(action, { runId, run }, this.services);
            this.rules.recordEvent(rule.id, runId, action.type, result, at);
          }
        } catch (error) {
          // A rule-level failure (e.g. a faulty candidate/predicate path) is isolated + audited; the
          // next rule + the run continue untouched.
          this.rules.recordEvent(rule.id, runId, "error", {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } catch {
      // The engine is a strict observer — a catastrophic failure here NEVER propagates into the run
      // pipeline (the run is already terminal + rated).
    }
  }
}

/** The compact run view the webhook payload carries — built from the already-loaded candidate. */
function toRunView(runId: string, candidate: RunFilterCandidate): WatchRunSummaryView {
  return {
    id: runId,
    status: candidate.status,
    ...(candidate.outcome !== undefined ? { outcome: candidate.outcome } : {}),
    scenarioId: candidate.scenarioId,
    testId: candidate.testId,
    costUsd: candidate.costUsd,
    tokensIn: candidate.tokensIn,
    tokensOut: candidate.tokensOut,
    startedAt: candidate.startedAt,
  };
}

/**
 * The DETERMINISTIC per-(rule,run) sample gate (D-OB21). `sample` absent (or >= 1) → always fires;
 * `sample <= 0` → never. Otherwise the SHA-256 of `<ruleId>:<runId>` is mapped to a stable float in
 * [0,1) and the rule fires when that float < `sample`. NO RNG, NO wall-clock — the SAME (rule, run)
 * ALWAYS yields the SAME decision (acceptance #2), and different rules sample the same run
 * independently. Exported for the engine's unit test.
 */
export function sampleDecision(ruleId: string, runId: string, sample: number | undefined): boolean {
  if (sample === undefined || sample >= 1) return true;
  if (sample <= 0) return false;
  const digest = crypto.createHash("sha256").update(`${ruleId}:${runId}`).digest();
  // First 4 bytes → uint32 → [0,1). Deterministic + uniform enough for sampling.
  const value = digest.readUInt32BE(0) / 0x1_0000_0000;
  return value < sample;
}

// ══ Windowed rules (WP4.2, D-OB19) ══════════════════════════════════════════════════════════════
// Trailing-window threshold evaluation. THE DERIVED-ONCE INVARIANT: the measure math is NOT
// re-implemented here — every window's value comes from the WP1.2 metrics SERVICE
// (`computeRunMetrics`). Each window is grid-ALIGNED so it collapses to exactly ONE metrics bucket, so
// the service returns a SINGLE point whose value we read directly (correct even for percentiles, which
// could NEVER be re-aggregated from sub-buckets). This is why the preview matches `GET /api/metrics/runs`
// EXACTLY — it IS the same service call.

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

/** The width, in ms, of each trailing window. */
const WINDOW_MS: Record<WatchWindowDuration, number> = {
  "1h": MS_PER_HOUR,
  "6h": 6 * MS_PER_HOUR,
  "24h": MS_PER_DAY,
  "7d": 7 * MS_PER_DAY,
};

/**
 * The metrics bucket an aligned window of this width collapses to. A `1h` window is exactly one `hour`
 * bucket; a `6h` window (aligned to 0/6/12/18 UTC) sits within one `day`; a `24h` window IS a `day`
 * bucket; a `7d` window (Monday-aligned) IS a `week` bucket. Passing this bucket + from/to = the window
 * bounds to `computeRunMetrics` yields a single point (all in-range rows share one bucketStart).
 */
export function metricsBucketForWindow(window: WatchWindowDuration): MetricsBucket {
  switch (window) {
    case "1h":
      return "hour";
    case "6h":
    case "24h":
      return "day";
    case "7d":
      return "week";
  }
}

/** AM-OB4 — drop `q` from both sides of a ratio config, mirroring the rule's own filter. The wire
 *  rejects a `q` here, so this is belt-and-braces against a hand-edited stored rule; it exists so an
 *  FTS term can never be silently ignored while the threshold still fires on a wider population. */
function stripRatioQ(ratio: RunMetricsRatioConfig): RunMetricsRatioConfig {
  const { q: _omitNumQ, ...numerator } = ratio.numerator;
  if (ratio.denominator === undefined) return { numerator };
  const { q: _omitDenQ, ...denominator } = ratio.denominator;
  return { numerator, denominator };
}

/**
 * Floor `ms` to the START of the grid cell containing it — equivalently, the END of the most recent
 * COMPLETED window of this width. Hour/6h/day cells align to the UTC epoch (which starts at 00:00 UTC),
 * so simple modulo suffices; the `7d` grid aligns to Monday 00:00 UTC (matching the metrics `week`
 * bucket EXACTLY — see `bucketStartUtc`), so a 7d window is contained in one week bucket.
 */
export function floorToWindowGrid(ms: number, window: WatchWindowDuration): number {
  if (window === "7d") {
    const d = new Date(ms);
    const dayStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    const daysFromMonday = (new Date(dayStart).getUTCDay() + 6) % 7; // Mon→0 … Sun→6
    return dayStart - daysFromMonday * MS_PER_DAY;
  }
  const size = WINDOW_MS[window];
  return ms - (((ms % size) + size) % size); // euclidean floor (safe for pre-epoch, though unused)
}

/**
 * The grid boundaries E (window ENDS) with `afterMs < E <= completedEnd(nowMs)`, capped to the most
 * recent `maxCount` (older ones are dropped but the caller records the gap — never fabricated
 * continuity). `afterMs === null` (never evaluated) → only the single most recent completed window (no
 * infinite first-sight backlog).
 */
export function enumerateWindowEnds(
  afterMs: number | null,
  nowMs: number,
  window: WatchWindowDuration,
  maxCount: number,
): { ends: number[]; truncated: boolean } {
  const width = WINDOW_MS[window];
  const completedEnd = floorToWindowGrid(nowMs, window);
  if (completedEnd < width) return { ends: [], truncated: false }; // no full window has completed yet
  if (afterMs === null) return { ends: [completedEnd], truncated: false };
  const base = floorToWindowGrid(afterMs, window); // snap onto the grid (already aligned in practice)
  const ends: number[] = [];
  for (let e = base + width; e <= completedEnd; e += width) ends.push(e);
  if (ends.length <= maxCount) return { ends, truncated: false };
  return { ends: ends.slice(ends.length - maxCount), truncated: true };
}

/**
 * One window's aggregate, read from the metrics service (never recomputed).
 *
 * AM-OB10 replaced the old `breached: boolean` with a three-way {@link WatchWindowState}. That is
 * the whole bug fix: the boolean had NO way to say "the window contained nothing", so an empty
 * window returned `breached:false` and the state machine took the NOT-BREACHED branch — recording
 * `window_recover` and re-arming. A bench that went silent while a rule was firing was reported as
 * RECOVERED. `no_data` is now its own outcome and the per-rule policy decides what it means.
 */
type WindowValue = { value: number | null; n: number; state: WatchWindowState };

/**
 * Evaluate windowed rules against a trailing, grid-aligned window series (WP4.2). Owns:
 *  - the single-bucket delegation to `computeRunMetrics` (the ONLY aggregation path);
 *  - the fire / cooldown-suppress / recovery-re-arm state machine (re-seeded from the audit log each
 *    call, so it survives restarts with no extra persisted state);
 *  - boot catch-up with `late` flagging + a gap summary in the audit (D-OB19);
 *  - the historical preview.
 * It never mutates run state — it reads metrics and writes audit/notifications only (observer).
 */
export class WatchWindowEvaluator {
  constructor(
    private readonly db: AppDatabase,
    private readonly rules: WatchRuleRepository,
    private readonly services: WatchActionServices,
  ) {}

  /** Evaluate every enabled windowed rule. Each rule is isolated + guarded (one failure never blocks
   *  the next rule or the ticker). `boot` marks a startup catch-up pass (late flagging + gap summary). */
  async evaluateAll(nowMs: number, opts: { boot: boolean }): Promise<void> {
    for (const rule of this.rules.listEnabledByTrigger("windowed")) {
      try {
        await this.evaluateRule(rule, nowMs, opts);
      } catch {
        // A rule-level failure is isolated — the ticker + the other rules continue untouched.
      }
    }
  }

  /**
   * Evaluate ONE windowed rule up to `nowMs`. Enumerates the completed windows since `lastEvaluatedAt`,
   * scores each via the metrics service, and applies the fire/cooldown/recovery machine. Advances the
   * `last_evaluated_at` baseline afterward. A rule with no `window` config (or not `windowed`/disabled)
   * is inert.
   */
  async evaluateRule(rule: WatchRule, nowMs: number, opts: { boot: boolean }): Promise<void> {
    const config = rule.window;
    if (!config || rule.trigger !== "windowed" || !rule.enabled) return;

    const width = WINDOW_MS[config.window];
    const completedEnd = floorToWindowGrid(nowMs, config.window);
    const parsedLast = rule.lastEvaluatedAt ? Date.parse(rule.lastEvaluatedAt) : Number.NaN;
    const lastEndMs = Number.isNaN(parsedLast) ? null : parsedLast;

    if (lastEndMs !== null && completedEnd <= lastEndMs) return; // nothing new completed

    const { ends, truncated } = enumerateWindowEnds(
      lastEndMs,
      nowMs,
      config.window,
      WATCH_CATCHUP_MAX_WINDOWS,
    );
    if (ends.length === 0) return;

    const late = opts.boot && lastEndMs !== null; // completed while we were away
    const cooldownMs = config.cooldownMinutes * 60_000;
    const noDataPolicy = resolveNoDataPolicy(config); // AM-OB10 — absent = `hold`
    // AM-OB10 — a PAUSED rule still evaluates and still records its window state; only the action
    // DISPATCH is suppressed. A rule that stopped evaluating while paused would come back armed and
    // blind, which is exactly the failure mode `enabled: false` already covers.
    const paused = isWatchRulePaused(rule, nowMs);

    const seed = this.rules.getWindowState(rule.id);
    let armed = seed.armed;
    let lastFiredMs = seed.lastFiredAt ? Date.parse(seed.lastFiredAt) : null;
    if (lastFiredMs !== null && Number.isNaN(lastFiredMs)) lastFiredMs = null;
    let lastFiredLevel: WatchWindowLevel | undefined = seed.lastFiredLevel;

    for (const endMs of ends) {
      const startMs = endMs - width;
      const startIso = new Date(startMs).toISOString();
      const endIso = new Date(endMs).toISOString();
      const { value, state } = this.computeWindowValue(rule.filter, config, startMs, endMs);
      const level: WatchWindowLevel | undefined =
        state === "warn" || state === "alert" ? state : undefined;

      // ── NO DATA under the DEFAULT `hold` policy: neither fire nor recover. ───────────────────
      // The rule keeps whatever state it was in. A marker is written ONLY when we are actually
      // WITHHOLDING a recovery (the rule is currently firing) — a healthy window already writes
      // nothing at all, and an idle bench must not accrue one audit row per empty hour.
      if (state === "no_data" && noDataPolicy === "hold") {
        if (!armed) {
          this.rules.recordEvent(
            rule.id,
            undefined,
            WATCH_MARKER_WINDOW_NO_DATA,
            {
              ok: true,
              detail: "no runs in window — holding the fired state (no-data policy: hold)",
              windowStart: startIso,
              windowEnd: endIso,
              noData: true,
            },
            endIso,
          );
        }
        continue; // `armed` / `lastFiredMs` deliberately untouched
      }

      if (watchWindowStateFires(state, noDataPolicy)) {
        const cooldownElapsed = lastFiredMs !== null && endMs - lastFiredMs >= cooldownMs;
        // AM-OB10 — an ESCALATION (last fire was `warn`, this one is `alert`) is genuinely NEW
        // information, so it is not swallowed by a cooldown that was armed for the warning.
        const escalated = level === "alert" && lastFiredLevel === "warn";
        if (armed || cooldownElapsed || escalated) {
          await this.fireWindow(rule, config, {
            startIso,
            endIso,
            value,
            late,
            level,
            noData: state === "no_data",
            suppressed: paused,
          });
          armed = false;
          lastFiredMs = endMs;
          lastFiredLevel = level;
        }
        // else: continuously breached within cooldown → suppress (stay quiet, remain disarmed).
      } else {
        // Below every threshold — or an empty window under the EXPLICIT `ok` opt-in, which is the
        // pre-AM-OB10 behaviour kept as a deliberate choice rather than an accident.
        if (!armed) {
          this.rules.recordEvent(
            rule.id,
            undefined,
            "window_recover",
            {
              ok: true,
              detail:
                state === "no_data"
                  ? "no runs in window — treated as recovered (no-data policy: ok)"
                  : "recovered (below threshold)",
              windowStart: startIso,
              windowEnd: endIso,
              ...(value !== null ? { value } : {}),
              ...(state === "no_data" ? { noData: true } : {}),
            },
            endIso,
          );
        }
        armed = true; // recovery re-arms — the next breach fires immediately (ignores cooldown)
        lastFiredLevel = undefined;
      }
    }

    // Advance the baseline to the latest COMPLETED window end. Even if catch-up was truncated, we set it
    // to completedEnd (the dropped older windows are the recorded gap — never re-scanned).
    this.rules.setLastEvaluatedAt(rule.id, new Date(completedEnd).toISOString());

    // Boot catch-up summary — makes the gap visible in the audit (D-OB19: a gap is a gap).
    if (opts.boot && lastEndMs !== null) {
      const firstIso = new Date((ends[0] as number) - width).toISOString();
      const lastIso = new Date(ends[ends.length - 1] as number).toISOString();
      this.rules.recordEvent(rule.id, undefined, "window_catchup", {
        ok: true,
        detail:
          `boot catch-up: evaluated ${ends.length} window(s) ${firstIso}→${lastIso}` +
          `${truncated ? " (older windows skipped — gap)" : ""} — all late`,
      });
    }
  }

  /** Historical preview — the trailing `nWindows` completed windows, each scored via the metrics service
   *  (values MATCH `GET /api/metrics/runs` exactly). Pure read; never fires actions or writes audit. */
  preview(
    filter: RunFilter,
    config: WatchWindowConfig,
    nWindows: number,
    nowMs: number,
  ): WatchWindowPreview {
    const n = nWindows > 0 ? nWindows : WATCH_PREVIEW_DEFAULT_WINDOWS;
    const width = WINDOW_MS[config.window];
    const completedEnd = floorToWindowGrid(nowMs, config.window);
    const noDataPolicy = resolveNoDataPolicy(config);
    const windows: WatchWindowPreviewPoint[] = [];
    for (let i = n - 1; i >= 0; i--) {
      const endMs = completedEnd - i * width;
      if (endMs < width) continue; // skip pre-epoch windows (defensive)
      const startMs = endMs - width;
      const { value, n: backing, state } = this.computeWindowValue(filter, config, startMs, endMs);
      windows.push({
        windowStart: new Date(startMs).toISOString(),
        windowEnd: new Date(endMs).toISOString(),
        value,
        n: backing,
        // AM-OB10 — the preview now answers with the SAME three-way outcome the evaluator uses, so
        // the pre-save check an operator consults cannot show a healthy-looking gap where nothing
        // ran. `wouldHaveFired` reads the no-data policy too (arm/cooldown state is not replayed).
        wouldHaveFired: watchWindowStateFires(state, noDataPolicy),
        state,
      });
    }
    return { window: config, bucket: metricsBucketForWindow(config.window), windows };
  }

  /** Record the fire marker (its `at` = the window end, so the audit re-seeds the state machine) then
   *  execute the rule's actions through the windowed executor, each isolated + audited. */
  private async fireWindow(
    rule: WatchRule,
    config: WatchWindowConfig,
    w: {
      startIso: string;
      endIso: string;
      value: number | null;
      late: boolean;
      /** AM-OB10 — which threshold was crossed; absent on a single-threshold or no-data fire. */
      level?: WatchWindowLevel;
      /** AM-OB10 — the window was EMPTY and the rule's no-data policy is `notify`. */
      noData?: boolean;
      /** AM-OB10 — the rule is PAUSED: still record the marker (state must advance), dispatch nothing. */
      suppressed?: boolean;
    },
  ): Promise<void> {
    const crossed = w.level === "warn" ? config.warnThreshold : config.threshold;
    const detail = w.noData
      ? `no runs in window over ${config.window} (no-data policy: notify)${w.late ? " (late)" : ""}`
      : `${config.measure} ${config.op} ${crossed ?? config.threshold} over ${config.window}` +
        `${w.level === "warn" ? " [warning]" : ""}${w.late ? " (late)" : ""}`;
    // The marker is written even when PAUSED — it is the persisted state the machine re-seeds from,
    // and dropping it would make a paused rule come back armed as if nothing had happened.
    this.rules.recordEvent(
      rule.id,
      undefined,
      "window_fire",
      {
        ok: true,
        detail,
        windowStart: w.startIso,
        windowEnd: w.endIso,
        ...(w.value !== null ? { value: w.value } : {}),
        late: w.late,
        ...(w.level !== undefined ? { level: w.level } : {}),
        ...(w.noData ? { noData: true } : {}),
      },
      w.endIso,
    );
    if (w.suppressed) {
      this.rules.recordEvent(
        rule.id,
        undefined,
        WATCH_MARKER_PAUSED,
        {
          ok: true,
          detail: `paused until ${rule.pausedUntil} — actions suppressed`,
          windowStart: w.startIso,
          windowEnd: w.endIso,
        },
        w.endIso,
      );
      return;
    }
    const windowView: WatchWindowSummaryView = {
      ruleId: rule.id,
      ruleName: rule.name,
      measure: config.measure,
      op: config.op,
      threshold: config.threshold,
      window: config.window,
      windowStart: w.startIso,
      windowEnd: w.endIso,
      value: w.value,
      late: w.late,
      ...(config.warnThreshold !== undefined ? { warnThreshold: config.warnThreshold } : {}),
      ...(w.level !== undefined ? { level: w.level } : {}),
      ...(w.noData ? { noData: true } : {}),
    };
    for (const action of rule.actions) {
      const result = await executeWatchWindowAction(action, { window: windowView }, this.services);
      this.rules.recordEvent(rule.id, undefined, action.type, result, w.endIso);
    }
  }

  /**
   * ONE window's aggregate — DELEGATED to `computeRunMetrics` (the derived-once invariant). The window
   * is grid-aligned so it collapses to a single metrics bucket → one point per series; we read the
   * breach-direction extreme across any groups/capability classes.
   *
   * AM-OB10 — NO BACKING DATA is now reported as the distinct `no_data` state rather than collapsed
   * into "not breached". `computeRunMetrics` deliberately does not zero-fill empty buckets
   * (`observability/metrics.ts`, doctrine), so an empty window returns NO series at all; the fix
   * belongs here in the evaluator, not in the metrics service.
   */
  private computeWindowValue(
    filter: RunFilter,
    config: WatchWindowConfig,
    startMs: number,
    endMs: number,
  ): WindowValue {
    // Effective filter: strip `q` (FTS is not part of the metrics aggregation — never a silent
    // half-apply) and fold the config's grader into `filter.grader`.
    //
    // What `grader` ACTUALLY does, corrected here by AM-OB4 because the old comment said otherwise:
    // it NARROWS THE RUN SET to runs carrying a (latest) grade from that grader. It does NOT select
    // which grader's score `meanScore` averages — that selection is `PRIMARY_GRADER_PRIORITY` in
    // `metrics.ts` and no parameter changes it, so a rule naming a non-primary grader restricts
    // *which runs count* while still averaging the primary grader's score on each of them.
    const { q: _omitQ, ...withoutQ } = filter;
    const effectiveFilter: RunFilter = { ...withoutQ };
    if (config.grader !== undefined) effectiveFilter.grader = config.grader;

    const res = computeRunMetrics(this.db, {
      filter: effectiveFilter,
      from: new Date(startMs).toISOString(),
      to: new Date(endMs - 1).toISOString(), // exclusive end → inclusive last ms (single-bucket guard)
      bucket: metricsBucketForWindow(config.window),
      ...(config.groupBy !== undefined ? { groupBy: config.groupBy } : {}),
      measures: [config.measure],
      // AM-OB4 — a windowed rule can threshold an arbitrary share. Both sides get the same `q` strip
      // for the same reason: the metrics service has no FTS path, so a `q` here would be dropped
      // rather than applied, and a threshold over a silently-widened population is worse than an error.
      ...(config.ratio !== undefined ? { ratio: stripRatioQ(config.ratio) } : {}),
    });

    const points: { value: number; n: number }[] = [];
    for (const s of res.series) {
      for (const p of s.points) points.push({ value: p.value, n: p.n });
    }
    if (points.length === 0) return { value: null, n: 0, state: "no_data" };

    let rep = points[0] as { value: number; n: number };
    for (const p of points) {
      if (config.op === ">=" ? p.value > rep.value : p.value < rep.value) rep = p;
    }
    return { value: rep.value, n: rep.n, state: watchWindowState(rep.value, rep.n, config) };
  }
}
