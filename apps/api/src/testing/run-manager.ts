import { EventEmitter } from "node:events";
import { isSettledRatingState, type RunEvent, type RunStatus } from "@mcp-token-footprint/shared";

/**
 * A terminal RunStatus ends the run's EXECUTION. Since the rating axis (AR11) the manager no longer
 * cleans up on it alone — it stays registered through the post-terminal review and flushes/drops the
 * run's state once a SETTLED `rating` event ({@link isSettledRatingState}) has ALSO been emitted, so
 * the rating events reach live subscribers + the persistence sink through the same choke point. The
 * run service guarantees a settled rating event after every terminal status (finally-style), so this
 * cannot leak; `detach` still force-drops without either.
 *
 * Unified Sessions (planning/Roadmap/completed/RM-29-unified-sessions/, WP1.6, D-US2) — `ended` JOINS this set: an interactive
 * session the operator explicitly closed (`POST /api/runs/:id/end`) is just as terminal as any other
 * disposition for terminal-detection, stream-close (routes.ts `isTerminalSseStatus`), and orphan
 * reconciliation (`RunRepository.abortOrphanedRuns`) purposes.
 */
const TERMINAL_STATUSES: ReadonlySet<RunStatus> = new Set<RunStatus>([
  "completed",
  "stopped",
  "error",
  "aborted",
  "ended",
]);

export function isTerminalStatus(status: RunStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/** A subscriber receives every {@link RunEvent} emitted for a run, in order. */
export type RunEventListener = (event: RunEvent) => void;

/**
 * Unified Sessions (planning/Roadmap/completed/RM-29-unified-sessions/, WP1.6, D-US3) — SessionClock-derived durations that ride
 * ALONGSIDE a terminal `status` event on the emit path, NOT as part of the wire {@link RunEvent} itself
 * (the WP1.1 contract's `status` member carries no duration fields — only `RunSummary.activeDurationMs`/
 * `totalDurationMs` do, both populated server-side from here). Optional on every field: an executor that
 * hasn't adopted {@link SessionClock} yet (every executor as of WP1.6) simply omits `meta` entirely, and
 * {@link RunRepository.finalize} persists NULL for both columns — exactly the pre-existing behavior.
 */
export type RunEmitMeta = {
  activeDurationMs?: number;
  totalDurationMs?: number;
};

/**
 * A persistence sink fed every emitted {@link RunEvent} (WP 1.6 persists runs/steps from this). It
 * runs alongside live subscribers; a throwing sink must not break the live stream, so the manager
 * isolates its errors. `meta` (WP1.6, D-US3) is the optional SessionClock duration side-channel — see
 * {@link RunEmitMeta}.
 */
export type RunPersistenceSink = {
  onEvent(runId: string, event: RunEvent, meta?: RunEmitMeta): void | Promise<void>;
};

const RUN_EVENT = "run-event";

/**
 * Bound the per-run replay buffer so a long run can't grow it without limit (the live SSE stream and
 * the WP 1.6 persistence sink both see every event regardless — this buffer only backfills a late
 * subscriber). When the cap is exceeded the OLDEST events are dropped (a beat-late subscriber still
 * gets the opening events; an hours-late subscriber falls back to the persisted replay via `getRun`).
 */
const MAX_BUFFERED_EVENTS = 2000;

type ActiveRun = {
  emitter: EventEmitter;
  status: RunStatus;
  /** Events seen so far, so a late subscriber can be replayed the backlog (SSE in WP 2.2). */
  buffered: RunEvent[];
  /**
   * F1 — per-run monotonic STEP ordinal. Every `step` event flowing through {@link RunManager.emit}
   * is stamped with `event.step.index = stepSeq++` BEFORE buffering/fan-out/persistence. This is the
   * single choke point all RunEvents pass through, so it makes `step.index` globally UNIQUE and
   * emission-ordered in BOTH the live stream and the replay buffer — killing the old collision where
   * the engine, the accounting sink, and the MCP sink each kept their own 0-based counter (so live
   * `step.index` duplicated and clients deduping by it clobbered steps). The persisted ordinal source
   * of truth stays `RunRepository`'s own `cursor.stepIdx++`, which increments once per step event in
   * the same emission order — so the live `step.index` and the replayed `index` cannot drift.
   */
  stepSeq: number;
  /**
   * F6 — per-run monotonic EVENT sequence stamped on EVERY emitted event (`event.seq = eventSeq++`),
   * not just steps. It lets an SSE client dedupe a reconnect's replayed buffer by `seq > lastAppliedSeq`
   * — correct regardless of {@link MAX_BUFFERED_EVENTS}, killing the old bug where a client that had
   * applied more events than the buffer holds over-skipped genuinely-new live events after a drop.
   */
  eventSeq: number;
  /**
   * Rating axis (AR11) — set when a SETTLED `rating` event (`rated`/`failed`/`skipped`) flows through
   * {@link RunManager.emit}. Cleanup fires only once the run is BOTH terminal AND rating-settled, so
   * the post-terminal review events still reach subscribers/persistence (see the class doc).
   */
  ratingSettled: boolean;
  /**
   * Unified Sessions (planning/Roadmap/completed/RM-29-unified-sessions/, WP1.6) — set true once {@link RunManager.
   * markUserInitiatedStop} has been called for this run: its upcoming terminal disposition was an
   * OPERATOR action (Stop or End session), not a guardrail/error/provider terminal the engine reached
   * on its own. Read via {@link RunManager.wasUserInitiatedStop} — a caller (the `/stop`/`/end` route
   * handlers) must read it BEFORE the run settles (terminal + rating-settled), since `cleanup` drops
   * this state along with everything else. This is the server-side half of the finish-toast
   * suppression WP3.3 wires client-side; the flag exists so a future emit-path consumer (e.g. an
   * eventual server-driven notification) can also make the same "the operator already knows" call
   * without re-deriving it from `stopReasonCode` string-sniffing.
   */
  userInitiatedStop: boolean;
};

/**
 * In-memory registry of active runs. Each run owns an {@link EventEmitter}; `emit` fans an event out
 * to (a) live subscribers (the SSE stream in WP 2.2) and (b) the optional persistence sink (WP 1.6).
 * On a terminal `status` event the run is flushed and its state cleaned up.
 *
 * This is process-local by design — the app is a single Docker container (no cluster, no broker).
 */
export class RunManager {
  private readonly runs = new Map<string, ActiveRun>();

  constructor(private readonly persistence?: RunPersistenceSink) {}

  /** Register a run before the loop starts so subscribers can attach immediately. */
  create(runId: string): void {
    if (this.runs.has(runId)) return;
    const emitter = new EventEmitter();
    // Many SSE subscribers + the persistence sink may attach; lift the default cap.
    emitter.setMaxListeners(0);
    this.runs.set(runId, {
      emitter,
      status: "pending",
      buffered: [],
      stepSeq: 0,
      eventSeq: 0,
      ratingSettled: false,
      userInitiatedStop: false,
    });
  }

  /** True while the run is registered (i.e. before terminal cleanup). */
  isActive(runId: string): boolean {
    return this.runs.has(runId);
  }

  status(runId: string): RunStatus | undefined {
    return this.runs.get(runId)?.status;
  }

  /**
   * Subscribe to a run's events. Returns an unsubscribe function. Buffered events emitted before the
   * subscription are replayed synchronously first so a subscriber never misses early steps.
   */
  subscribe(runId: string, listener: RunEventListener): () => void {
    const run = this.runs.get(runId);
    if (!run) {
      // The run already ended (or never existed); nothing to stream.
      return () => undefined;
    }
    for (const event of run.buffered) listener(event);
    run.emitter.on(RUN_EVENT, listener);
    return () => run.emitter.off(RUN_EVENT, listener);
  }

  /**
   * Unified Sessions (planning/Roadmap/completed/RM-29-unified-sessions/, WP1.6) — mark this run's upcoming terminal as
   * OPERATOR-initiated (the `/stop` or `/end` route). Call BEFORE aborting the live loop / emitting the
   * terminal event, so {@link wasUserInitiatedStop} can be read synchronously while the run is still
   * registered. No-op for an unknown/already-settled run.
   */
  markUserInitiatedStop(runId: string): void {
    const run = this.runs.get(runId);
    if (run) run.userInitiatedStop = true;
  }

  /**
   * True when {@link markUserInitiatedStop} was called for this run before it settled. Always false
   * once the run has been cleaned up (terminal + rating-settled, or `detach`) — a caller that needs
   * this must read it before then (i.e. synchronously alongside emitting the terminal event).
   */
  wasUserInitiatedStop(runId: string): boolean {
    return this.runs.get(runId)?.userInitiatedStop ?? false;
  }

  /**
   * Emit one event for a run. Updates the cached status from `status` events, fans out to live
   * subscribers and the persistence sink, then — on a terminal status — flushes and cleans up. `meta`
   * (WP1.6, D-US3) is the optional SessionClock duration side-channel forwarded to the persistence sink
   * verbatim — see {@link RunEmitMeta}; omitted by every emitter that hasn't adopted SessionClock yet.
   */
  emit(runId: string, event: RunEvent, meta?: RunEmitMeta): void {
    const run = this.runs.get(runId);
    if (!run) return;

    if (event.type === "status") {
      run.status = event.status;
    }
    // Rating axis (AR11) — a settled rating event marks the post-terminal review as over; together
    // with the terminal status it releases the run's state (see the cleanup condition below).
    if (event.type === "rating" && isSettledRatingState(event.state)) {
      run.ratingSettled = true;
    }
    // F1 — stamp the single monotonic STEP ordinal BEFORE buffering/fan-out/persistence so the same
    // value reaches live subscribers, the replay buffer, AND the persistence sink. Mutating in place is
    // intentional: the engine/accounting/MCP sinks emit a fresh RunStep object each time, and stamping
    // here (the one choke point) overrides their independent per-component counters with a globally
    // unique, emission-ordered index.
    if (event.type === "step") {
      event.step.index = run.stepSeq++;
    }
    // F6 — stamp the per-run monotonic event sequence on EVERY event (the single choke point), so the
    // same value reaches live subscribers AND the replay buffer. An SSE client dedupes a reconnect's
    // replayed buffer by `seq > lastAppliedSeq` — correct no matter how far behind the bounded buffer is.
    event.seq = run.eventSeq++;
    run.buffered.push(event);
    // Bounded replay buffer: drop the oldest events past the cap (the live stream + persistence sink
    // already received every event; this only backfills a late subscriber).
    if (run.buffered.length > MAX_BUFFERED_EVENTS) {
      run.buffered.splice(0, run.buffered.length - MAX_BUFFERED_EVENTS);
    }
    run.emitter.emit(RUN_EVENT, event);

    if (this.persistence) {
      // Isolate persistence failures from the live stream.
      void Promise.resolve()
        .then(() => this.persistence?.onEvent(runId, event, meta))
        .catch(() => undefined);
    }

    // Cleanup fires only once the run is BOTH terminal AND rating-settled (AR11): the terminal
    // status alone no longer drops the run, so the post-terminal review's `rating` events still
    // reach live subscribers + the persistence sink. The run service guarantees a settled rating
    // event after every terminal status, so this always fires (detach covers force-removal).
    if (isTerminalStatus(run.status) && run.ratingSettled) {
      this.cleanup(runId);
    }
  }

  /**
   * F3 — forcibly detach a run WITHOUT emitting a terminal status: drop its listeners + state so any
   * later {@link RunManager.emit} (e.g. the `aborted` terminal from a still-winding-down loop) is a
   * no-op and never reaches a subscriber OR the persistence sink. Used by `DELETE /api/runs/:id` to
   * stop an active run before removing its row, so a late event can't race the delete. Idempotent.
   */
  detach(runId: string): void {
    this.cleanup(runId);
  }

  /** Remove all listeners and drop the run's state (idempotent). */
  private cleanup(runId: string): void {
    const run = this.runs.get(runId);
    if (!run) return;
    run.emitter.removeAllListeners();
    this.runs.delete(runId);
  }
}
