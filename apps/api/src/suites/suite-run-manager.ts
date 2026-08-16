import { EventEmitter } from "node:events";
import {
  isSettledRatingState,
  type SuiteRunEvent,
  type SuiteRunStatus,
} from "@mcp-token-footprint/shared";

/**
 * Benchmarks (WP 3.2, B8) — the suite-run SSE fan-out. A direct MIRROR of
 * {@link import("../testing/run-manager.js").RunManager} at SUITE scope: one {@link EventEmitter} per
 * active suite run, a bounded replay buffer so a late `/stream` subscriber backfills the opening
 * events, a per-run monotonic `seq` stamped on every event (so an SSE client can dedupe a reconnect's
 * replay by `seq > lastAppliedSeq`), and terminal cleanup. Process-local by design (single container).
 *
 * The suite stream carries three event kinds — cell-status transitions, rolled-up aggregate snapshots,
 * and the suite-run lifecycle `status`. On a terminal status the run is flushed + dropped. There is no
 * persistence sink here: aggregates + status are the orchestrator's to persist onto `suite_runs`
 * (derived data), so this manager is purely the live-streaming seam.
 */

/**
 * A terminal {@link SuiteRunStatus} ends the suite run's EXECUTION. Since the rating axis (AR11) the
 * manager no longer cleans up on it alone — it stays registered through the post-`finish()` report
 * hook and drops the run's state once a SETTLED `rating` event has ALSO been emitted (mirrors
 * {@link import("../testing/run-manager.js").RunManager}). The orchestrator guarantees a settled
 * rating event after every terminal status; `detach` still force-drops without either.
 */
const TERMINAL_SUITE_STATUSES: ReadonlySet<SuiteRunStatus> = new Set<SuiteRunStatus>([
  "completed",
  "capped",
  "stopped",
  "error",
]);

export function isTerminalSuiteStatus(status: SuiteRunStatus): boolean {
  return TERMINAL_SUITE_STATUSES.has(status);
}

/**
 * The suite SSE event envelope now lives in `@mcp-token-footprint/shared` as {@link SuiteRunEvent}
 * (lifted from here in WP 3.3 so the web console can consume the stream contract-first). `cell`
 * announces a matrix-cell state transition (started / settled); `aggregates` carries a recomputed
 * rolled-up snapshot; `status` is the suite-run lifecycle. `seq` is stamped by
 * {@link SuiteRunManager.emit} (the single choke point), so subscribers see it on both the live stream
 * and the replay buffer. Re-exported so `apps/api` callers can keep importing it from this module.
 */
export type { SuiteRunEvent };

/** A subscriber receives every {@link SuiteRunEvent} emitted for a suite run, in order. */
export type SuiteRunEventListener = (event: SuiteRunEvent) => void;

const SUITE_RUN_EVENT = "suite-run-event";

/**
 * Bound the per-run replay buffer (as {@link RunManager} does): a long suite run can't grow it without
 * limit — the live stream already saw every event; this buffer only backfills a late subscriber. When
 * the cap is exceeded the OLDEST events are dropped (a beat-late subscriber still gets the opening
 * events; an hours-late one falls back to the persisted `suite_runs` snapshot via the route).
 */
const MAX_BUFFERED_EVENTS = 2000;

type ActiveSuiteRun = {
  emitter: EventEmitter;
  status: SuiteRunStatus;
  /** Events seen so far, so a late subscriber replays the backlog in order. */
  buffered: SuiteRunEvent[];
  /** Per-run monotonic sequence stamped on EVERY event (dedupe key for a reconnecting client). */
  eventSeq: number;
  /** Rating axis (AR11) — set on a settled `rating` event; cleanup fires only once terminal AND settled. */
  ratingSettled: boolean;
};

/**
 * In-memory registry of active suite runs. Each owns an {@link EventEmitter}; `emit` fans an event out
 * to live subscribers (the SSE stream). On a terminal `status` event the run is flushed + cleaned up.
 */
export class SuiteRunManager {
  private readonly runs = new Map<string, ActiveSuiteRun>();

  /** Register a suite run before scheduling starts so subscribers can attach immediately. */
  create(suiteRunId: string): void {
    if (this.runs.has(suiteRunId)) return;
    const emitter = new EventEmitter();
    // Many SSE subscribers may attach; lift the default listener cap.
    emitter.setMaxListeners(0);
    this.runs.set(suiteRunId, {
      emitter,
      status: "pending",
      buffered: [],
      eventSeq: 0,
      ratingSettled: false,
    });
  }

  /** True while the suite run is registered (i.e. before terminal cleanup). */
  isActive(suiteRunId: string): boolean {
    return this.runs.has(suiteRunId);
  }

  status(suiteRunId: string): SuiteRunStatus | undefined {
    return this.runs.get(suiteRunId)?.status;
  }

  /**
   * Subscribe to a suite run's events. Returns an unsubscribe function. Buffered events emitted before
   * the subscription are replayed synchronously first so a subscriber never misses early cells.
   */
  subscribe(suiteRunId: string, listener: SuiteRunEventListener): () => void {
    const run = this.runs.get(suiteRunId);
    if (!run) {
      // The suite run already ended (or never existed); nothing to stream live.
      return () => undefined;
    }
    for (const event of run.buffered) listener(event);
    run.emitter.on(SUITE_RUN_EVENT, listener);
    return () => run.emitter.off(SUITE_RUN_EVENT, listener);
  }

  /**
   * Emit one event for a suite run. Stamps the monotonic `seq` (the single choke point, so live +
   * replay agree), updates the cached status from `status` events, fans out, then — on a terminal
   * status — flushes and cleans up.
   */
  emit(suiteRunId: string, event: SuiteRunEvent): void {
    const run = this.runs.get(suiteRunId);
    if (!run) return;

    if (event.type === "status") {
      run.status = event.status;
    }
    // Rating axis (AR11) — a settled rating event marks the post-terminal report hook as over.
    if (event.type === "rating" && isSettledRatingState(event.state)) {
      run.ratingSettled = true;
    }
    event.seq = run.eventSeq++;
    run.buffered.push(event);
    if (run.buffered.length > MAX_BUFFERED_EVENTS) {
      run.buffered.splice(0, run.buffered.length - MAX_BUFFERED_EVENTS);
    }
    run.emitter.emit(SUITE_RUN_EVENT, event);

    // Cleanup fires only once the suite run is BOTH terminal AND rating-settled (AR11), so the
    // post-`finish()` report hook's `rating` events still reach subscribers. The orchestrator
    // guarantees a settled rating event after every terminal status (detach covers force-removal).
    if (isTerminalSuiteStatus(run.status) && run.ratingSettled) {
      this.cleanup(suiteRunId);
    }
  }

  /**
   * Forcibly detach a suite run WITHOUT emitting a terminal status: drop its listeners + state so any
   * later {@link SuiteRunManager.emit} is a no-op. Used by `DELETE /api/suite-runs/:id` to stop
   * streaming before the row is removed, so a late event can't race the delete. Idempotent.
   */
  detach(suiteRunId: string): void {
    this.cleanup(suiteRunId);
  }

  /** Remove all listeners and drop the suite run's state (idempotent). */
  private cleanup(suiteRunId: string): void {
    const run = this.runs.get(suiteRunId);
    if (!run) return;
    run.emitter.removeAllListeners();
    this.runs.delete(suiteRunId);
  }
}
