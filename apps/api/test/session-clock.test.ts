// Unified Sessions WP1.2 — SessionClock (apps/api/src/testing/session-clock.ts).
//
// Every test here drives the clock through a fully deterministic FAKE time source
// (createFakeSessionClockTime below) — no real `setTimeout` waits, no flakiness. `advance(ms)` moves the
// fake clock forward and synchronously fires every timer due within that window, in chronological order,
// including timers newly scheduled by an already-firing callback (so a fire's own cleanup can never leave
// a stray timer that reawakens later in the SAME advance).

import assert from "node:assert/strict";
import { test } from "node:test";
import { terminalFor } from "../src/testing/session-terminal.js";
import {
  DEFAULT_STALL_MS,
  DEFAULT_WAIT_BUDGET_MS,
  REAL_SESSION_CLOCK_TIME,
  SessionClock,
  type SessionClockFireEvent,
  type SessionClockTime,
} from "../src/testing/session-clock.js";

type FakeTimerEntry = {
  id: number;
  at: number;
  fn: () => void;
  canceled: boolean;
  fired: boolean;
};

/** A fully controllable, synchronous fake {@link SessionClockTime}. `advance(ms)` fires every timer due
 *  within the window in chronological order (ties broken by scheduling order), then lands `now()`
 *  exactly on the target instant regardless of whether anything fired. */
function createFakeSessionClockTime(): { time: SessionClockTime; advance: (ms: number) => void } {
  let current = 0;
  let nextId = 1;
  const timers: FakeTimerEntry[] = [];

  const time: SessionClockTime = {
    now: () => current,
    schedule: (fn, ms) => {
      const entry: FakeTimerEntry = {
        id: nextId++,
        at: current + Math.max(0, ms),
        fn,
        canceled: false,
        fired: false,
      };
      timers.push(entry);
      return () => {
        entry.canceled = true;
      };
    },
  };

  function advance(ms: number): void {
    const target = current + ms;
    for (;;) {
      const due = timers
        .filter((t) => !t.canceled && !t.fired && t.at <= target)
        .sort((a, b) => a.at - b.at || a.id - b.id);
      const next = due[0];
      if (!next) break;
      current = next.at;
      next.fired = true;
      next.fn();
    }
    current = target;
  }

  return { time, advance };
}

// ---- start() / call-order guards -------------------------------------------------------------------

test("start() throws if called more than once", () => {
  const { time } = createFakeSessionClockTime();
  const clock = new SessionClock({ time });
  clock.start();
  assert.throws(() => clock.start(), /called more than once/);
});

test("every other method throws if called before start()", () => {
  const { time } = createFakeSessionClockTime();
  const clock = new SessionClock({ time });
  assert.throws(() => clock.noteEvent(), /called before start\(\)/);
  assert.throws(() => clock.enterWaiting(), /called before start\(\)/);
  assert.throws(() => clock.resumeFromWaiting(), /called before start\(\)/);
});

test("stop() is safe before start() (idempotent no-op) and never throws", () => {
  const { time } = createFakeSessionClockTime();
  const clock = new SessionClock({ time });
  assert.doesNotThrow(() => clock.stop());
  assert.equal(clock.totalDurationMs, 0);
  assert.equal(clock.activeDurationMs, 0);
});

test("enterWaiting() throws when already waiting; resumeFromWaiting() throws when not waiting", () => {
  const { time } = createFakeSessionClockTime();
  const clock = new SessionClock({ time });
  clock.start();
  assert.throws(() => clock.resumeFromWaiting(), /called while not waiting/);
  clock.enterWaiting();
  assert.throws(() => clock.enterWaiting(), /called while already waiting/);
  clock.resumeFromWaiting();
  assert.throws(() => clock.resumeFromWaiting(), /called while not waiting/);
});

// ---- stall timer --------------------------------------------------------------------------------

test("stall timer fires `stalled` after the stall window with zero events", () => {
  const { time, advance } = createFakeSessionClockTime();
  const fires: SessionClockFireEvent[] = [];
  const clock = new SessionClock({ stallMs: 10 * 60_000, time, onFire: (e) => fires.push(e) });
  clock.start();
  advance(10 * 60_000);
  assert.equal(fires.length, 1);
  assert.equal(fires[0]?.cause, "stalled");
  assert.equal(clock.fired?.cause, "stalled");
  assert.equal(clock.activeDurationMs, 10 * 60_000);
  assert.equal(clock.totalDurationMs, 10 * 60_000);
});

test("default stall window is DEFAULT_STALL_MS (10 min) when unconfigured", () => {
  assert.equal(DEFAULT_STALL_MS, 10 * 60_000);
  const { time, advance } = createFakeSessionClockTime();
  const clock = new SessionClock({ time });
  clock.start();
  advance(DEFAULT_STALL_MS - 1);
  assert.equal(clock.fired, undefined);
  advance(1);
  assert.equal(clock.fired?.cause, "stalled");
});

test("stall-roll-on-event: noteEvent() resets the window so a run that stays busy never stalls", () => {
  const { time, advance } = createFakeSessionClockTime();
  const clock = new SessionClock({ stallMs: 10 * 60_000, time });
  clock.start();
  // Tick along, always checking in just under the window — the stall must never fire.
  for (let i = 0; i < 5; i++) {
    advance(9 * 60_000);
    assert.equal(clock.fired, undefined, `iteration ${i}: must not have stalled`);
    clock.noteEvent();
  }
  // Now stop checking in — the FULL window (freshly rolled by the last noteEvent) must elapse before it fires.
  advance(9 * 60_000);
  assert.equal(clock.fired, undefined, "still inside the freshly-rolled window");
  advance(60_000);
  assert.equal(clock.fired?.cause, "stalled");
});

test("stallMs <= 0 disables the stall detector entirely", () => {
  const { time, advance } = createFakeSessionClockTime();
  const clock = new SessionClock({ stallMs: 0, time });
  clock.start();
  advance(365 * 24 * 60 * 60_000); // a full year of silence
  assert.equal(clock.fired, undefined);
});

// ---- wait budget + pause-in-waiting --------------------------------------------------------------

test("enterWaiting() pauses the stall timer — a long wait alone never stalls", () => {
  const { time, advance } = createFakeSessionClockTime();
  const clock = new SessionClock({ stallMs: 10 * 60_000, waitBudgetMs: 0, time });
  clock.start();
  clock.enterWaiting();
  advance(365 * 24 * 60 * 60_000); // way past the stall window; wait budget disabled for this test
  assert.equal(clock.fired, undefined, "waiting must not be mistaken for a stall");
});

test("wait budget exhausted while waiting_input fires `wait_expired`", () => {
  const { time, advance } = createFakeSessionClockTime();
  const fires: SessionClockFireEvent[] = [];
  const clock = new SessionClock({ waitBudgetMs: 10 * 60_000, time, onFire: (e) => fires.push(e) });
  clock.start();
  advance(60_000); // some active time first
  clock.enterWaiting();
  advance(10 * 60_000);
  assert.equal(fires.length, 1);
  assert.equal(fires[0]?.cause, "wait_expired");
  assert.equal(clock.fired?.cause, "wait_expired");
});

test("default wait budget is DEFAULT_WAIT_BUDGET_MS (10 min) when unconfigured", () => {
  assert.equal(DEFAULT_WAIT_BUDGET_MS, 10 * 60_000);
  const { time, advance } = createFakeSessionClockTime();
  const clock = new SessionClock({ time });
  clock.start();
  clock.enterWaiting();
  advance(DEFAULT_WAIT_BUDGET_MS - 1);
  assert.equal(clock.fired, undefined);
  advance(1);
  assert.equal(clock.fired?.cause, "wait_expired");
});

test("per-call waitBudgetMsOverride (e.g. Acme's 30-min budget) overrides the clock default", () => {
  const { time, advance } = createFakeSessionClockTime();
  const clock = new SessionClock({ waitBudgetMs: 10 * 60_000, time });
  clock.start();
  const thirtyMin = 30 * 60_000;
  clock.enterWaiting(thirtyMin);
  advance(10 * 60_000); // past the clock default, but not the override
  assert.equal(clock.fired, undefined);
  advance(20 * 60_000); // now past the override too
  assert.equal(clock.fired?.cause, "wait_expired");
});

test("waitBudgetMsOverride <= 0 disables expiry for just that wait", () => {
  const { time, advance } = createFakeSessionClockTime();
  const clock = new SessionClock({ waitBudgetMs: 10 * 60_000, time });
  clock.start();
  clock.enterWaiting(0);
  advance(365 * 24 * 60 * 60_000);
  assert.equal(clock.fired, undefined);
  assert.equal(clock.deadlineAt, undefined, "no expiry armed ⇒ no deadline to show");
});

test("resumeFromWaiting() re-arms the stall timer FRESH — it does not fire immediately nor carry over stale time", () => {
  const { time, advance } = createFakeSessionClockTime();
  const clock = new SessionClock({ stallMs: 10 * 60_000, waitBudgetMs: 60 * 60_000, time });
  clock.start();
  advance(9 * 60_000); // 9 min of active running, just under the stall window
  clock.enterWaiting();
  advance(30 * 60_000); // long wait — must not affect the (paused) stall timer at all
  clock.resumeFromWaiting();
  advance(9 * 60_000); // fresh window, not primed by the pre-wait 9 minutes
  assert.equal(clock.fired, undefined, "resumed stall window must be FULL 10 min, not 1 min");
  advance(60_000);
  assert.equal(clock.fired?.cause, "stalled");
});

test("resumeFromWaiting() cancels the wait-budget timer — it never fires after resuming", () => {
  const { time, advance } = createFakeSessionClockTime();
  const clock = new SessionClock({ stallMs: 0, waitBudgetMs: 10 * 60_000, time });
  clock.start();
  clock.enterWaiting();
  advance(5 * 60_000);
  clock.resumeFromWaiting();
  advance(10 * 60_000); // would have expired the wait budget had it not been canceled
  assert.equal(clock.fired, undefined);
});

// ---- pause accounting: activeDurationMs excludes waiting, totalDurationMs does not -----------------

test("activeDurationMs excludes waiting time; totalDurationMs includes it (single wait segment)", () => {
  const { time, advance } = createFakeSessionClockTime();
  const clock = new SessionClock({ stallMs: 0, waitBudgetMs: 0, time });
  clock.start();
  advance(2 * 60_000); // 2 min active
  clock.enterWaiting();
  advance(5 * 60_000); // 5 min waiting (excluded from active)
  clock.resumeFromWaiting();
  advance(3 * 60_000); // 3 min active
  assert.equal(clock.totalDurationMs, 10 * 60_000);
  assert.equal(clock.activeDurationMs, 5 * 60_000);
});

test("pause accounting across MULTIPLE wait segments accumulates correctly", () => {
  const { time, advance } = createFakeSessionClockTime();
  const clock = new SessionClock({ stallMs: 0, waitBudgetMs: 0, time });
  clock.start();
  advance(60_000); // 1 active
  clock.enterWaiting();
  advance(60_000); // 1 waiting
  clock.resumeFromWaiting();
  advance(60_000); // 1 active
  clock.enterWaiting();
  advance(2 * 60_000); // 2 waiting
  clock.resumeFromWaiting();
  advance(60_000); // 1 active
  assert.equal(clock.totalDurationMs, 6 * 60_000);
  assert.equal(clock.activeDurationMs, 3 * 60_000);
});

test("activeDurationMs/totalDurationMs live-query correctly WHILE still waiting (not yet resumed)", () => {
  const { time, advance } = createFakeSessionClockTime();
  const clock = new SessionClock({ stallMs: 0, waitBudgetMs: 0, time });
  clock.start();
  advance(60_000);
  clock.enterWaiting();
  advance(90_000);
  assert.equal(clock.totalDurationMs, 150_000);
  assert.equal(clock.activeDurationMs, 60_000, "the still-open wait segment must already be excluded");
});

test("stop() freezes activeDurationMs/totalDurationMs at the stop instant", () => {
  const { time, advance } = createFakeSessionClockTime();
  const clock = new SessionClock({ stallMs: 0, waitBudgetMs: 0, time });
  clock.start();
  advance(60_000);
  clock.stop();
  advance(60_000); // must not move the frozen readings
  assert.equal(clock.totalDurationMs, 60_000);
  assert.equal(clock.activeDurationMs, 60_000);
});

// ---- optional wall cap: hard, unpaused, fires regardless of phase ---------------------------------

test("wall cap fires `max_duration` even though noteEvent() keeps the stall timer from ever firing", () => {
  const { time, advance } = createFakeSessionClockTime();
  const clock = new SessionClock({ stallMs: 60_000, maxDurationMs: 5 * 60_000, time });
  clock.start();
  for (let i = 0; i < 20; i++) {
    if (clock.fired) break;
    advance(30_000);
    clock.noteEvent();
  }
  assert.equal(clock.fired?.cause, "max_duration");
  assert.equal(clock.fired?.totalDurationMs, 5 * 60_000);
});

test("wall cap fires `max_duration` (not `wait_expired`) even while genuinely waiting, when it elapses first", () => {
  const { time, advance } = createFakeSessionClockTime();
  const clock = new SessionClock({
    stallMs: 0,
    waitBudgetMs: 60 * 60_000, // a wait budget generous enough that the cap wins the race
    maxDurationMs: 5 * 60_000,
    time,
  });
  clock.start();
  clock.enterWaiting();
  advance(5 * 60_000);
  assert.equal(clock.fired?.cause, "max_duration", "the hard cap is not paused by waiting_input");
});

test("maxDurationMs is undefined (no cap) by default — D-US3 opt-in only", () => {
  const { time, advance } = createFakeSessionClockTime();
  const clock = new SessionClock({ stallMs: 0, time });
  clock.start();
  advance(365 * 24 * 60 * 60_000);
  assert.equal(clock.fired, undefined);
  assert.equal(clock.deadlineAt, undefined);
});

test("maxDurationMs <= 0 is treated as disabled, same as undefined", () => {
  const { time, advance } = createFakeSessionClockTime();
  const clock = new SessionClock({ stallMs: 0, maxDurationMs: -1, time });
  clock.start();
  advance(365 * 24 * 60 * 60_000);
  assert.equal(clock.fired, undefined);
});

// ---- first-cause-wins / cleanup on fire and on stop ------------------------------------------------

test("first cause wins: once fired, later-due timers never fire a second cause", () => {
  const { time, advance } = createFakeSessionClockTime();
  const fires: SessionClockFireEvent[] = [];
  const clock = new SessionClock({
    stallMs: 60_000,
    waitBudgetMs: 30_000, // due BEFORE the stall window
    time,
    onFire: (e) => fires.push(e),
  });
  clock.start();
  clock.enterWaiting();
  advance(5 * 60_000); // both the (paused, so irrelevant) stall and the wait budget are long past
  assert.equal(fires.length, 1);
  assert.equal(fires[0]?.cause, "wait_expired");
});

test("stop() cancels every pending timer — nothing fires after stop()", () => {
  const { time, advance } = createFakeSessionClockTime();
  const clock = new SessionClock({ stallMs: 60_000, maxDurationMs: 2 * 60_000, time });
  clock.start();
  clock.stop();
  advance(10 * 60_000);
  assert.equal(clock.fired, undefined);
});

test("noteEvent() is a silent no-op after firing or after stop() — it never throws or re-arms", () => {
  const { time, advance } = createFakeSessionClockTime();
  const clock = new SessionClock({ stallMs: 60_000, time });
  clock.start();
  advance(60_000);
  assert.equal(clock.fired?.cause, "stalled");
  assert.doesNotThrow(() => clock.noteEvent());
  advance(10 * 60_000);
  assert.equal(clock.fired?.cause, "stalled", "still the original fire — noteEvent() must not re-arm");
});

test("enterWaiting() after a fire is a silent no-op (does not throw, does not arm a new timer, does not flip isWaiting)", () => {
  const { time, advance } = createFakeSessionClockTime();
  const clock = new SessionClock({ stallMs: 60_000, waitBudgetMs: 5 * 60_000, time });
  clock.start();
  advance(60_000);
  assert.equal(clock.fired?.cause, "stalled");
  assert.doesNotThrow(() => clock.enterWaiting());
  // A settled clock is FROZEN — enterWaiting() bails out before touching any bookkeeping at all, so a
  // subsequent legitimate resumeFromWaiting() call would still correctly throw "not waiting".
  assert.equal(clock.isWaiting, false, "settled clock ignores enterWaiting entirely");
  advance(10 * 60_000);
  assert.equal(clock.fired?.cause, "stalled");
});

// ---- deadlineAt: server-authored absolute countdown -------------------------------------------------

test("deadlineAt is undefined while running with no wall cap and not waiting", () => {
  const { time } = createFakeSessionClockTime();
  const clock = new SessionClock({ time });
  clock.start();
  assert.equal(clock.deadlineAt, undefined);
});

test("deadlineAt reflects the wall cap while running (not waiting) when one is set", () => {
  const { time, advance } = createFakeSessionClockTime();
  const clock = new SessionClock({ stallMs: 0, maxDurationMs: 5 * 60_000, time });
  clock.start();
  advance(60_000);
  assert.equal(clock.deadlineAt, new Date(5 * 60_000).toISOString());
});

test("deadlineAt reflects the wait-budget deadline while waiting, overriding the wall cap", () => {
  const { time, advance } = createFakeSessionClockTime();
  const clock = new SessionClock({
    stallMs: 0,
    waitBudgetMs: 3 * 60_000,
    maxDurationMs: 60 * 60_000,
    time,
  });
  clock.start();
  advance(60_000);
  clock.enterWaiting();
  // waitStartedAt = 60_000; deadline = 60_000 + 3*60_000 = 240_000 — NOT the (much later) wall cap.
  assert.equal(clock.deadlineAt, new Date(240_000).toISOString());
});

test("deadlineAt falls back to the wall cap while waiting if this wait has no budget armed", () => {
  const { time, advance } = createFakeSessionClockTime();
  const clock = new SessionClock({ stallMs: 0, maxDurationMs: 10 * 60_000, time });
  clock.start();
  advance(60_000);
  clock.enterWaiting(0); // this wait's own expiry disabled
  assert.equal(clock.deadlineAt, new Date(10 * 60_000).toISOString());
});

test("deadlineAt clears on resumeFromWaiting() back to the wall-cap deadline (or undefined)", () => {
  const { time, advance } = createFakeSessionClockTime();
  const clock = new SessionClock({ stallMs: 0, waitBudgetMs: 5 * 60_000, time });
  clock.start();
  clock.enterWaiting();
  assert.notEqual(clock.deadlineAt, undefined);
  clock.resumeFromWaiting();
  assert.equal(clock.deadlineAt, undefined, "no wall cap configured ⇒ nothing to show once resumed");
});

test("deadlineAt is undefined once the clock has fired, and once stopped", () => {
  const { time, advance } = createFakeSessionClockTime();
  const clock = new SessionClock({ stallMs: 60_000, time });
  clock.start();
  advance(60_000);
  assert.equal(clock.deadlineAt, undefined);

  const { time: time2 } = createFakeSessionClockTime();
  const clock2 = new SessionClock({ maxDurationMs: 60_000, time: time2 });
  clock2.start();
  clock2.stop();
  assert.equal(clock2.deadlineAt, undefined);
});

// ---- fired event payload + integration with terminalFor ---------------------------------------------

test("the fired event's duration snapshot matches the getters read at that same instant", () => {
  const { time, advance } = createFakeSessionClockTime();
  let snapshot: SessionClockFireEvent | undefined;
  const clock = new SessionClock({
    stallMs: 0,
    waitBudgetMs: 2 * 60_000,
    time,
    onFire: (e) => {
      snapshot = e;
    },
  });
  clock.start();
  advance(60_000);
  clock.enterWaiting();
  advance(2 * 60_000);
  assert.ok(snapshot);
  assert.equal(snapshot?.activeDurationMs, clock.activeDurationMs);
  assert.equal(snapshot?.totalDurationMs, clock.totalDurationMs);
  assert.equal(snapshot?.firedAt, clock.fired?.firedAt);
});

test("a fired SessionClockCause plugs directly into terminalFor without a cast, and matches the shared table", () => {
  const { time, advance } = createFakeSessionClockTime();
  const clock = new SessionClock({ stallMs: 60_000, time });
  clock.start();
  advance(60_000);
  const cause = clock.fired?.cause;
  assert.ok(cause);
  // No `as TerminalCause` cast needed here — SessionClockCause is an Extract<TerminalCause, …>.
  const verdict = terminalFor(cause);
  assert.deepEqual(verdict, {
    status: "stopped",
    outcome: "stopped_guardrail",
    stopReasonCode: "stalled",
  });
});

test("terminalFor(cause) round-trips correctly for all three SessionClock causes", () => {
  assert.deepEqual(terminalFor("stalled"), {
    status: "stopped",
    outcome: "stopped_guardrail",
    stopReasonCode: "stalled",
  });
  assert.deepEqual(terminalFor("wait_expired"), {
    status: "stopped",
    outcome: "stopped_guardrail",
    stopReasonCode: "wait_expired",
  });
  assert.deepEqual(terminalFor("max_duration"), {
    status: "stopped",
    outcome: "stopped_guardrail",
    stopReasonCode: "max_duration",
  });
});

// ---- the real time source (sanity, using genuinely short real timers) -------------------------------

test("REAL_SESSION_CLOCK_TIME.now() tracks Date.now() and schedule()/cancel() actually use real timers", async () => {
  const before = Date.now();
  const now = REAL_SESSION_CLOCK_TIME.now();
  assert.ok(now >= before && now <= Date.now() + 5);

  let fired = false;
  const cancel = REAL_SESSION_CLOCK_TIME.schedule(() => {
    fired = true;
  }, 5);
  cancel();
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(fired, false, "canceled real timer must never fire");
});

test("SessionClock over REAL_SESSION_CLOCK_TIME fires a real (short) stall timer end-to-end", async () => {
  // REAL_SESSION_CLOCK_TIME.schedule() deliberately `unref`s its handle (so a lone pending SessionClock
  // timer never blocks process shutdown — mirrors the existing engine.ts deadline timer). In production
  // the server always has other ref'd handles (the HTTP listener, …) keeping the event loop alive; here
  // we stand in for that with an explicit ref'd keep-alive so this real (unref'd) timer still gets to
  // fire instead of the test runner concluding the event loop has nothing left to wait on.
  const keepAlive = setInterval(() => {}, 1000);
  try {
    await new Promise<void>((resolve) => {
      const clock = new SessionClock({
        stallMs: 10,
        onFire: (event) => {
          assert.equal(event.cause, "stalled");
          assert.equal(clock.fired?.cause, "stalled");
          resolve();
        },
      });
      clock.start();
    });
  } finally {
    clearInterval(keepAlive);
  }
});
