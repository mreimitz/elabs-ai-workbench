// Observability — the windowed watch-rule TICKER (roadmap/observability/, WP4.2, D-OB19).
//
// A SINGLETON in-process ticker that evaluates enabled `windowed` rules on an interval (default every
// 5 min) and ONCE on boot (catch-up). It is HONEST about the app not always running (D-OB19): the
// {@link WatchWindowEvaluator} it drives persists a `last_evaluated_at` baseline per rule and, on
// startup, evaluates the windows that COMPLETED while the app was away — flagging those notifications
// `late` and recording the gap in the audit log. It NEVER fabricates continuity.
//
// ⚠️ TIMERS: the clock (`now`) and the interval seam (`setIntervalImpl`/`clearIntervalImpl`) are BOTH
// injectable. In production they default to `Date.now` + a self-unref'd `setInterval` (so the ticker
// never keeps the process alive at shutdown). In tests they are FAKED — a test drives `tick()` /
// `runBootCatchUp()` directly against a controlled clock with ZERO real waits and ZERO leaked timers.
//
// The ticker is a strict OBSERVER: it reads metrics and writes audit/notifications only — never run state.

import { WATCH_SCHEDULER_DEFAULT_INTERVAL_MS } from "@mcp-token-footprint/shared";
import type { WatchWindowEvaluator } from "./engine.js";

/** Opaque interval handle — a real `NodeJS.Timeout` in prod, a test token under a fake seam. */
type SchedulerTimerHandle = unknown;

/** Minimal logger shape (pino's `server.log` satisfies it; a test passes a silent stub or nothing). */
type SchedulerLogger = { error?: (obj: unknown, msg?: string) => void };

export interface WatchSchedulerDeps {
  evaluator: WatchWindowEvaluator;
  /** The clock. Defaults to `Date.now`; a test injects a mutable one to advance time deterministically. */
  now?: () => number;
  /** Evaluation cadence in ms. Defaults to {@link WATCH_SCHEDULER_DEFAULT_INTERVAL_MS}. */
  intervalMs?: number;
  /** The interval seam. Defaults to a self-unref'd global `setInterval`; a test injects a fake. */
  setIntervalImpl?: (cb: () => void, ms: number) => SchedulerTimerHandle;
  clearIntervalImpl?: (handle: SchedulerTimerHandle) => void;
  /**
   * Fleet issue aggregation (Observability WP5.1) — an ADDITIVE per-tick sweep that rides this same
   * ticker (boot catch-up + every interval), alongside the windowed evaluation. Guarded INDEPENDENTLY
   * (a sweep failure never blocks the windowed eval and vice versa). Absent → no sweep (existing
   * behavior). Wired in `index.ts` to the deterministic `IssueSweepService.runSweep`.
   */
  onSweep?: (nowMs: number, opts: { boot: boolean }) => void | Promise<void>;
  /**
   * Scheduled digest report (Observability WP5.5, D-OB22) — an ADDITIVE per-tick hook that rides this
   * SAME ticker (boot catch-up + every interval), alongside the windowed evaluation AND the WP5.1
   * sweep. Guarded INDEPENDENTLY of both (one failing generation never blocks the windowed eval or the
   * sweep, and vice versa). Absent → no digest generation (existing behavior). Wired in `index.ts` to
   * `DigestScheduleService.maybeGenerateDue` (a strict no-op when the schedule mode is `off`).
   */
  onDigest?: (nowMs: number, opts: { boot: boolean }) => void | Promise<void>;
  log?: SchedulerLogger;
}

const defaultSetIntervalImpl = (cb: () => void, ms: number): SchedulerTimerHandle => {
  const handle = setInterval(cb, ms);
  // Never let the ticker keep the event loop alive — a clean shutdown must not wait on it.
  handle.unref();
  return handle;
};

const defaultClearIntervalImpl = (handle: SchedulerTimerHandle): void => {
  clearInterval(handle as ReturnType<typeof setInterval>);
};

/**
 * The singleton windowed-rule ticker. {@link start} runs the boot catch-up ONCE then schedules the
 * interval; {@link stop} clears the interval (idempotent, shutdown-safe). A slow evaluation can never
 * overlap the next tick (the `running` re-entrancy guard). Every tick is fault-isolated — a throwing
 * evaluation is logged and swallowed so the ticker keeps running.
 */
export class WatchScheduler {
  private readonly evaluator: WatchWindowEvaluator;
  private readonly now: () => number;
  private readonly intervalMs: number;
  private readonly setIntervalImpl: (cb: () => void, ms: number) => SchedulerTimerHandle;
  private readonly clearIntervalImpl: (handle: SchedulerTimerHandle) => void;
  private readonly onSweep?: (nowMs: number, opts: { boot: boolean }) => void | Promise<void>;
  private readonly onDigest?: (nowMs: number, opts: { boot: boolean }) => void | Promise<void>;
  private readonly log?: SchedulerLogger;

  private handle: SchedulerTimerHandle | null = null;
  private started = false;
  private running = false;

  constructor(deps: WatchSchedulerDeps) {
    this.evaluator = deps.evaluator;
    this.now = deps.now ?? Date.now;
    this.intervalMs = deps.intervalMs ?? WATCH_SCHEDULER_DEFAULT_INTERVAL_MS;
    this.setIntervalImpl = deps.setIntervalImpl ?? defaultSetIntervalImpl;
    this.clearIntervalImpl = deps.clearIntervalImpl ?? defaultClearIntervalImpl;
    this.onSweep = deps.onSweep;
    this.onDigest = deps.onDigest;
    this.log = deps.log;
  }

  /** Start the ticker: boot catch-up ONCE, then schedule the interval. Double-start is a no-op (singleton). */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await this.runBootCatchUp();
    this.handle = this.setIntervalImpl(() => {
      void this.tick();
    }, this.intervalMs);
  }

  /** The startup catch-up pass (D-OB19) — evaluates windows missed while the app was away (late-flagged). */
  async runBootCatchUp(): Promise<void> {
    await this.evaluate(true);
  }

  /** One periodic evaluation (also directly callable in tests to advance the ticker deterministically). */
  async tick(): Promise<void> {
    await this.evaluate(false);
  }

  private async evaluate(boot: boolean): Promise<void> {
    if (this.running) return; // never overlap a slow evaluation with the next tick
    this.running = true;
    const nowMs = this.now();
    try {
      try {
        await this.evaluator.evaluateAll(nowMs, { boot });
      } catch (error) {
        this.log?.error?.({ err: error }, "watch scheduler evaluation failed (continuing)");
      }
      // The fleet-issue sweep (WP5.1) rides the same tick, INDEPENDENTLY guarded — a windowed-eval
      // failure above never skips the sweep, and a sweep failure never affects the windowed eval.
      if (this.onSweep) {
        try {
          await this.onSweep(nowMs, { boot });
        } catch (error) {
          this.log?.error?.({ err: error }, "issue sweep failed (continuing)");
        }
      }
      // The scheduled digest report (WP5.5) rides the same tick too, INDEPENDENTLY guarded — neither
      // the windowed eval nor the sweep above can block it, and a digest failure never affects them.
      if (this.onDigest) {
        try {
          await this.onDigest(nowMs, { boot });
        } catch (error) {
          this.log?.error?.({ err: error }, "digest generation failed (continuing)");
        }
      }
    } finally {
      this.running = false; // the re-entrancy guard is ALWAYS released (never wedges the singleton)
    }
  }

  /** Stop the ticker (shutdown-safe, idempotent) — clears the interval; a subsequent `start()` is fresh. */
  stop(): void {
    if (this.handle !== null) {
      this.clearIntervalImpl(this.handle);
      this.handle = null;
    }
    this.started = false;
  }
}
