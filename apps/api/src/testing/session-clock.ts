// Unified Sessions — SessionClock (planning/Roadmap/completed/RM-29-unified-sessions/, WP1.2, D-US3/D-US7).
//
// Before this module each executor hand-rolled its own timer logic: the engine raced an idle timeout
// against a hard-coded 30-min wall deadline (`DEFAULT_MAX_RUN_DURATION_MS` in engine.ts), the
// executor built its own `createDeadline` AbortController, and none of them distinguished "no one is
// looking at this run" (a stall) from "the run is correctly waiting on the operator" (a bounded wait) —
// which is exactly how a long interactive session used to mis-terminate as `aborted` once the wall
// clock silently expired mid-conversation. SessionClock is the ONE timer engine every executor (WP1.3
// engine, WP1.4 subscription) now drives, so the three independent knobs behave identically
// everywhere:
//
//   - a STALL timer (default 10 min) that only ticks while the run is actively RUNNING and is ROLLED
//     (reset to a fresh window) by every emitted event — no events for the whole window fires `stalled`;
//   - a WAIT BUDGET (default 10 min, per-kind override) that is armed the moment the
//     run enters `waiting_input` and, while it is ticking, the stall timer is paused (waiting on the
//     operator is not a stall) — exhausting it fires `wait_expired`;
//   - an OPTIONAL hard wall cap (off by default; an env/guardrail value the caller supplies) that ticks
//     in REAL time from `start()` regardless of phase — unlike the other two it is never paused — and
//     fires `max_duration` if it elapses.
//
// The clock also owns PAUSE ACCOUNTING (D-US3): `activeDurationMs` excludes every second spent waiting
// on the operator, `totalDurationMs` is plain wall time end-to-end, and `deadlineAt` exposes whichever
// deadline currently governs as an ABSOLUTE ISO-8601 timestamp, ready to ride straight into the `phase`
// RunEvent's `detail.deadlineAt` (WP1.1) so the client renders a countdown against the SERVER's clock,
// never its own.
//
// SessionClock is deliberately a pure, injectable-time unit: it never touches the DB, never emits a
// RunEvent, never calls `terminalFor` itself. It only reports — via the `onFire` callback AND the
// `fired` getter — WHICH cause (if any) has fired; the owning executor is the one that reacts (calls
// `terminalFor(event.cause)`, emits the terminal `status`/`phase` events, tears down the child/stream).
// That keeps this module trivially unit-testable with a fake time source (see session-clock.test.ts)
// and keeps the "write the terminal verdict before signaling the child" stop-ordering rule (execution
// plan §1) entirely in the executor's hands, where it belongs.

import type { TerminalCause } from "./session-terminal.js";

/**
 * The subset of {@link TerminalCause} a SessionClock can fire. Defined via `Extract` against the shared
 * terminal-cause union (not repeated as a literal list) so a rename/removal of any of these three causes
 * in `session-terminal.ts` fails this file's typecheck instead of silently drifting apart.
 */
export type SessionClockCause = Extract<TerminalCause, "stalled" | "wait_expired" | "max_duration">;

/** Default stall window (D-US3/D-US7): no events for this long while running fires `stalled`. */
export const DEFAULT_STALL_MS = 10 * 60_000;

/** Default wait budget (D-US3/D-US7): armed on `enterWaiting`; per-kind override at construction (e.g.
 *  session-capabilities.ts) or per-call in {@link SessionClock.enterWaiting}. */
export const DEFAULT_WAIT_BUDGET_MS = 10 * 60_000;

/** Cancels a previously scheduled timer. Calling it more than once, or after the timer already fired, is
 *  always safe (a no-op). */
type CancelTimer = () => void;

/**
 * The injectable time/timer seam. Production uses {@link REAL_SESSION_CLOCK_TIME}; tests substitute a
 * fully deterministic fake (see `createFakeSessionClockTime` in session-clock.test.ts) so every timer
 * transition — stall roll-on-event, pause-in-waiting, wall-cap-while-waiting, etc. — can be driven and
 * asserted synchronously without a real `setTimeout` in sight.
 */
export type SessionClockTime = {
  /** Current time, epoch ms. */
  now: () => number;
  /** Schedule `fn` to run once, `ms` from now; returns a canceler. */
  schedule: (fn: () => void, ms: number) => CancelTimer;
};

/**
 * The real wall-clock time source (`Date.now` + `setTimeout`). The scheduled handle is `unref`d — same
 * as the existing `engine.ts` deadline timer — so a still-pending SessionClock timer never by itself
 * keeps the Node process alive past an otherwise-finished run.
 */
export const REAL_SESSION_CLOCK_TIME: SessionClockTime = {
  now: () => Date.now(),
  schedule: (fn, ms) => {
    const handle = setTimeout(fn, ms);
    (handle as unknown as { unref?: () => void }).unref?.();
    return () => clearTimeout(handle);
  },
};

/**
 * Reported once, the first time any timer fires (via {@link SessionClockOptions.onFire} and thereafter
 * readable via {@link SessionClock.fired}). Carries a duration snapshot at the fire instant so the
 * executor doesn't need a second call before finalizing the run.
 */
export type SessionClockFireEvent = {
  cause: SessionClockCause;
  /** Epoch ms (per the injected time source) when the cause fired. */
  firedAt: number;
  activeDurationMs: number;
  totalDurationMs: number;
};

export type SessionClockOptions = {
  /** Stall window (ms). `<= 0` disables the stall detector entirely. Default {@link DEFAULT_STALL_MS}. */
  stallMs?: number;
  /** Wait budget (ms) armed on `enterWaiting` (absent a per-call override). `<= 0` disables wait expiry.
   *  Default {@link DEFAULT_WAIT_BUDGET_MS} — callers pass the resolved capability value (e.g. the
   *  per-kind override) here so the whole run uses one consistent budget. */
  waitBudgetMs?: number;
  /** Optional hard wall cap (ms) measured from `start()`. Undefined (default) = no cap (D-US3, opt-in
   *  only). Unlike the other two timers this ticks in REAL time regardless of phase — it is NOT paused
   *  while `waiting_input`, because it is meant as a hard, unconditional ceiling. */
  maxDurationMs?: number;
  /**
   * Invoked exactly once, the first time any timer fires. The clock never persists or emits anything
   * itself — this callback (or a later poll of {@link SessionClock.fired}) is how the owning executor
   * learns to react: call `terminalFor(event.cause)`, write the terminal verdict, THEN tear down the
   * child/stream (execution plan §1 stop-ordering rule).
   */
  onFire?: (event: SessionClockFireEvent) => void;
  /** Time/timer seam. Defaults to {@link REAL_SESSION_CLOCK_TIME}; tests inject a fake one. */
  time?: SessionClockTime;
};

/**
 * The one timer engine every run executor drives (WP1.3/1.4/1.5). See the module header for the full
 * rationale. Lifecycle: `start()` once, then `noteEvent()` on every emitted event while running,
 * `enterWaiting()`/`resumeFromWaiting()` bracketing every `waiting_input` phase, and `stop()` once the
 * run reaches ANY terminal state (whether the clock itself fired or the executor finished/stopped for
 * its own reason) to release the pending timers.
 */
export class SessionClock {
  private readonly stallMs: number;
  private readonly waitBudgetMs: number;
  private readonly maxDurationMs: number | undefined;
  private readonly onFireCallback: ((event: SessionClockFireEvent) => void) | undefined;
  private readonly time: SessionClockTime;

  private _startedAt: number | undefined;
  private _endedAt: number | undefined;
  private _fired: SessionClockFireEvent | undefined;

  private stallCancel: CancelTimer | undefined;
  private waitCancel: CancelTimer | undefined;
  private capCancel: CancelTimer | undefined;

  /** Set while `waiting_input`; the instant the current wait segment started. */
  private waitStartedAt: number | undefined;
  /** Set while `waiting_input`, only when this wait segment has an expiry armed. */
  private waitDeadlineAt: number | undefined;
  /** Sum of every PRIOR (already-resumed) wait segment's duration. */
  private accumulatedWaitMs = 0;

  constructor(options: SessionClockOptions = {}) {
    this.stallMs = options.stallMs ?? DEFAULT_STALL_MS;
    this.waitBudgetMs = options.waitBudgetMs ?? DEFAULT_WAIT_BUDGET_MS;
    this.maxDurationMs =
      options.maxDurationMs !== undefined && options.maxDurationMs > 0 ? options.maxDurationMs : undefined;
    this.onFireCallback = options.onFire;
    this.time = options.time ?? REAL_SESSION_CLOCK_TIME;
  }

  /** The cause that fired, if any — undefined while the clock is still ticking normally (or before
   *  `start()`/after a clean `stop()` with no fire). */
  get fired(): SessionClockFireEvent | undefined {
    return this._fired;
  }

  /** Epoch ms `start()` was called, or undefined before that. */
  get startedAt(): number | undefined {
    return this._startedAt;
  }

  /** Epoch ms `stop()` was called, or undefined while still open. */
  get endedAt(): number | undefined {
    return this._endedAt;
  }

  /** True between `enterWaiting()` and the matching `resumeFromWaiting()`. */
  get isWaiting(): boolean {
    return this.waitStartedAt !== undefined;
  }

  /** Time actively spent RUNNING — excludes every second paused in `waiting_input` — through now (or
   *  through the fire/stop instant once the clock has settled). */
  get activeDurationMs(): number {
    return this.durationsAt(this.endInstant()).activeDurationMs;
  }

  /** Plain wall time end-to-end, INCLUDING any time paused in `waiting_input`. */
  get totalDurationMs(): number {
    return this.durationsAt(this.endInstant()).totalDurationMs;
  }

  /**
   * The current server-authored ABSOLUTE deadline (ISO-8601), or undefined when none applies right now:
   * the WAIT-BUDGET deadline while `waiting_input` (if this wait has one armed), else the WALL-CAP
   * deadline while running (if one is set), else undefined. Undefined once the clock has fired or
   * stopped — there is nothing left to count down to. Ships straight into the `phase` RunEvent's
   * `detail.deadlineAt` (WP1.1).
   */
  get deadlineAt(): string | undefined {
    if (this._fired || this._endedAt !== undefined || this._startedAt === undefined) return undefined;
    if (this.waitDeadlineAt !== undefined) return new Date(this.waitDeadlineAt).toISOString();
    if (this.maxDurationMs !== undefined) return new Date(this._startedAt + this.maxDurationMs).toISOString();
    return undefined;
  }

  /**
   * Arms the clock: records `startedAt`, starts the stall timer (unless disabled) and the wall cap (if
   * one is configured). Call exactly once, right when the session begins executing. Throws if called
   * more than once — a genuine caller bug, not a race that can happen legitimately.
   */
  start(): void {
    if (this._startedAt !== undefined) {
      throw new Error("SessionClock.start() called more than once");
    }
    this._startedAt = this.time.now();
    this.armStall();
    if (this.maxDurationMs !== undefined) {
      this.capCancel = this.time.schedule(() => this.fire("max_duration"), this.maxDurationMs);
    }
  }

  /**
   * Roll the stall timer — call on every emitted event while the run is actively RUNNING (D-US3: "no
   * events for the stall window while running"). A no-op while `waiting_input`, after a fire, or after
   * `stop()`: an event arriving at an odd transition boundary must never throw.
   */
  noteEvent(): void {
    this.assertStarted("noteEvent");
    if (this.isWaiting || this._fired || this._endedAt !== undefined) return;
    this.armStall();
  }

  /**
   * Enter `waiting_input`: pauses active-duration accounting from this instant, cancels the stall timer
   * (it only applies while actively running — a session correctly waiting on the operator is not a
   * stall), and arms the wait-budget timer. `waitBudgetMsOverride` lets one particular wait use a
   * different budget than the clock's default (WP1.3 arms the SAME default for both a `nextTurn` wait
   * and an `ask_user` wait unless it chooses to override); `<= 0` disables expiry for just this wait.
   * Throws if called while already waiting (call `resumeFromWaiting()` first) — a caller bug, not a
   * legitimate race in this single-threaded scheduler.
   */
  enterWaiting(waitBudgetMsOverride?: number): void {
    this.assertStarted("enterWaiting");
    if (this.isWaiting) {
      throw new Error("SessionClock.enterWaiting() called while already waiting");
    }
    if (this._fired || this._endedAt !== undefined) return; // settled — nothing left to arm
    this.cancelStall();
    const now = this.time.now();
    this.waitStartedAt = now;
    const budget = waitBudgetMsOverride ?? this.waitBudgetMs;
    if (budget > 0) {
      this.waitDeadlineAt = now + budget;
      this.waitCancel = this.time.schedule(() => this.fire("wait_expired"), budget);
    } else {
      this.waitDeadlineAt = undefined;
    }
  }

  /**
   * Resume from `waiting_input`: cancels the wait-budget timer, folds the just-finished wait segment
   * into the excluded (paused) total, and re-arms the stall timer fresh — resuming IS itself an event.
   * Throws if called while not waiting.
   */
  resumeFromWaiting(): void {
    this.assertStarted("resumeFromWaiting");
    if (!this.isWaiting) {
      throw new Error("SessionClock.resumeFromWaiting() called while not waiting");
    }
    const now = this.time.now();
    this.accumulatedWaitMs += now - (this.waitStartedAt ?? now);
    this.waitStartedAt = undefined;
    this.waitDeadlineAt = undefined;
    this.cancelWait();
    if (this._fired || this._endedAt !== undefined) return;
    this.armStall();
  }

  /**
   * Finalize and cancel every pending timer — call once the run reaches ANY terminal state, whether the
   * clock itself fired or the executor finished/stopped for its own reason (normal completion, a user
   * stop, …). Idempotent, and safe even before `start()`. Freezes {@link activeDurationMs} /
   * {@link totalDurationMs} at this instant.
   */
  stop(): void {
    if (this._endedAt !== undefined) return;
    this._endedAt = this.time.now();
    this.cancelStall();
    this.cancelWait();
    if (this.capCancel) {
      this.capCancel();
      this.capCancel = undefined;
    }
  }

  // ---- internals ---------------------------------------------------------------------------------

  private assertStarted(method: string): void {
    if (this._startedAt === undefined) {
      throw new Error(`SessionClock.${method}() called before start()`);
    }
  }

  private armStall(): void {
    this.cancelStall();
    if (this.stallMs > 0) {
      this.stallCancel = this.time.schedule(() => this.fire("stalled"), this.stallMs);
    }
  }

  private cancelStall(): void {
    if (this.stallCancel) {
      this.stallCancel();
      this.stallCancel = undefined;
    }
  }

  private cancelWait(): void {
    if (this.waitCancel) {
      this.waitCancel();
      this.waitCancel = undefined;
    }
  }

  /** The instant duration getters should measure UP TO: the stop instant once stopped, else the fire
   *  instant once fired, else "now". */
  private endInstant(): number {
    if (this._endedAt !== undefined) return this._endedAt;
    if (this._fired !== undefined) return this._fired.firedAt;
    return this.time.now();
  }

  private durationsAt(end: number): { activeDurationMs: number; totalDurationMs: number } {
    const start = this._startedAt ?? end;
    const waitedMs =
      this.accumulatedWaitMs + (this.waitStartedAt !== undefined ? Math.max(0, end - this.waitStartedAt) : 0);
    const totalDurationMs = Math.max(0, end - start);
    const activeDurationMs = Math.max(0, totalDurationMs - waitedMs);
    return { activeDurationMs, totalDurationMs };
  }

  private fire(cause: SessionClockCause): void {
    if (this._fired || this._endedAt !== undefined) return; // first cause wins
    const firedAt = this.time.now();
    this.cancelStall();
    this.cancelWait();
    if (this.capCancel) {
      this.capCancel();
      this.capCancel = undefined;
    }
    const event: SessionClockFireEvent = { cause, firedAt, ...this.durationsAt(firedAt) };
    this._fired = event;
    this.onFireCallback?.(event);
  }
}
