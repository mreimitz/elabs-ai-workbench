// Unified Sessions — WP1.4 (subscription adoption): apps/api/src/testing/claude-subscription-executor.ts
// + subscription-concurrency.ts + config/env.ts's new SUBSCRIPTION_RUNS_MAX_CONCURRENCY.
//
// Exercised ENTIRELY through a SCRIPTED FAKE driver + a stub auth resolver + a fake throwaway-workspace
// factory + a deterministic FAKE SessionClock time source. NO SDK is imported, NO child is spawned, NO
// Anthropic call is made, and the real filesystem is never touched (mirrors
// claude-subscription-executor.test.ts's existing invariants).
//
// What this file proves (the WP1.4 acceptance list):
//   1. `queued` phase (with 1-based position) is emitted BEFORE `gate.acquire()` when the gate is
//      contended, and clears to `starting` once the permit is granted; an UNCONTENDED acquire emits
//      neither (byte-identical to the pre-WP1.4 shape — see claude-subscription-executor.test.ts).
//   2. The decoupled concurrency primitive (`SubscriptionConcurrencyPool.runs`, its own semaphore) is
//      genuinely independent of `.shared` (the judge budget): saturating one never blocks the other.
//   3. SessionClock replaces the old deadline/idle logic: a stall (no events for the stall window) and a
//      wait-budget expiry (no next interactive turn within the window) both end the run via the SAME
//      shared `terminalFor` table, honestly and deterministically (fake clock, no real waiting).
//   4. The capability manifest is recorded exactly once, at session start, via the `recordCapabilities`
//      DI seam — always `SUBSCRIPTION_SESSION_CAPABILITIES`.
//   5. Durations are recorded via `recordDurations` on every terminal.
//   6. Stop-verdict-before-kill ordering (D-US2): the terminal `status` event is ALREADY on the wire by
//      the time the driver's `abortController` signal actually fires — proven with an independent
//      abort-signal observer, not just code inspection.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { RunEvent, SessionCapabilities } from "@mcp-token-footprint/shared";
import type {
  AgentSessionDriver,
  DriverEvent,
  DriverSession,
  DriverStartOptions,
  DriverUserMessage,
} from "../src/assistant/session-driver.js";
import type { AssistantAuthSource } from "../src/assistant/spawn-env.js";
import {
  AsyncSemaphore,
  type ClaudeSubscriptionRunConfig,
  type ConcurrencyGate,
  type CreateThrowawayWorkspace,
  runClaudeSubscription,
  runClaudeSubscriptionInteractive,
} from "../src/testing/claude-subscription-executor.js";
import { SUBSCRIPTION_SESSION_CAPABILITIES } from "../src/testing/session-capabilities.js";
import { DEFAULT_STALL_MS, DEFAULT_WAIT_BUDGET_MS, type SessionClockTime } from "../src/testing/session-clock.js";
import { SubscriptionConcurrencyPool } from "../src/testing/subscription-concurrency.js";

// ── A tiny pushable async iterable (the fake's normalized event stream) — SDK-free ────────────────────
class Pushable<T> implements AsyncIterable<T> {
  private readonly buffer: T[] = [];
  private readonly waiters: Array<(r: IteratorResult<T>) => void> = [];
  private ended = false;
  push(item: T): void {
    if (this.ended) return;
    const w = this.waiters.shift();
    if (w) w({ value: item, done: false });
    else this.buffer.push(item);
  }
  end(): void {
    if (this.ended) return;
    this.ended = true;
    let w = this.waiters.shift();
    while (w) {
      w({ value: undefined as unknown as T, done: true });
      w = this.waiters.shift();
    }
  }
  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const b = this.buffer.shift();
        if (b !== undefined) return Promise.resolve({ value: b, done: false });
        if (this.ended) return Promise.resolve({ value: undefined as unknown as T, done: true });
        return new Promise<IteratorResult<T>>((resolve) => this.waiters.push(resolve));
      },
    };
  }
}

class FakeSession implements DriverSession {
  readonly out = new Pushable<DriverEvent>();
  readonly sent: string[] = [];
  readonly options: DriverStartOptions;
  onSend?: (text: string, session: FakeSession) => void;
  constructor(options: DriverStartOptions) {
    this.options = options;
    this.out.push({ type: "session", sessionId: "sess-fake" });
    options.abortController.signal.addEventListener("abort", () => this.out.end(), { once: true });
  }
  get events(): AsyncIterable<DriverEvent> {
    return this.out;
  }
  send(message: DriverUserMessage): void {
    this.sent.push(message.text);
    this.onSend?.(message.text, this);
  }
  async interrupt(): Promise<void> {}
  sessionId(): string | undefined {
    return "sess-fake";
  }
  emit(event: DriverEvent): void {
    this.out.push(event);
  }
}

class FakeDriver implements AgentSessionDriver {
  readonly sessions: FakeSession[] = [];
  active = 0;
  maxActive = 0;
  onStart?: (session: FakeSession) => void;
  onSend?: (text: string, session: FakeSession) => void;
  start(options: DriverStartOptions): DriverSession {
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    options.abortController.signal.addEventListener(
      "abort",
      () => {
        this.active -= 1;
      },
      { once: true },
    );
    const session = new FakeSession(options);
    session.onSend = this.onSend;
    this.sessions.push(session);
    this.onStart?.(session);
    return session;
  }
}

const AUTH: AssistantAuthSource = { kind: "claude_oauth", token: "sk-ant-oat01-fake-wp1.4-token" };
const MODEL = "claude-sonnet-4-5";
const PROMPT = "Summarize the taxi dataset.";
const USAGE: DriverEvent = {
  type: "turn_done",
  usage: { inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
};

function fakeWorkspaces(): CreateThrowawayWorkspace {
  let n = 0;
  return async () => ({ dir: `/fake/tmp/ws-${n++}`, cleanup: async () => {} });
}

function collector(): { emit: (e: RunEvent) => void; events: RunEvent[] } {
  const events: RunEvent[] = [];
  return { emit: (e) => events.push(e), events };
}

type StatusEvent = { type: "status"; status: string; outcome?: string; stopReason?: string; stopReasonCode?: string };
type PhaseEvent = { type: "phase"; phase: string | null; detail?: { position?: number; reason?: string; deadlineAt?: string } };
const statuses = (events: RunEvent[]): StatusEvent[] =>
  events.filter((e) => e.type === "status") as unknown as StatusEvent[];
const phases = (events: RunEvent[]): PhaseEvent[] =>
  events.filter((e) => e.type === "phase") as unknown as PhaseEvent[];

function makeConfig(
  driver: FakeDriver,
  overrides: Partial<ClaudeSubscriptionRunConfig> = {},
): ClaudeSubscriptionRunConfig {
  return {
    model: MODEL,
    prompt: PROMPT,
    system: "You are a data analyst agent.",
    maxTurns: 12,
    driver,
    resolveAuth: () => AUTH,
    concurrency: new AsyncSemaphore(1),
    createWorkspace: fakeWorkspaces(),
    ...overrides,
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

// A fully controllable, synchronous fake SessionClock time source (mirrors session-clock.test.ts).
type FakeTimerEntry = { id: number; at: number; fn: () => void; canceled: boolean; fired: boolean };
function createFakeClockTime(): { time: SessionClockTime; advance: (ms: number) => void } {
  let current = 0;
  let nextId = 1;
  const timers: FakeTimerEntry[] = [];
  const time: SessionClockTime = {
    now: () => current,
    schedule: (fn, ms) => {
      const entry: FakeTimerEntry = { id: nextId++, at: current + Math.max(0, ms), fn, canceled: false, fired: false };
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

// ── (1) queued phase + position, emitted BEFORE gate.acquire() ─────────────────────────────────────────

test("queued phase (with 1-based position) is emitted BEFORE the contended run acquires its permit, then clears to starting", async () => {
  const driver = new FakeDriver(); // manual scripting — do NOT auto-complete
  const gate: ConcurrencyGate = new AsyncSemaphore(1);
  const a = collector();
  const b = collector();

  // A holds the sole permit (uncontended acquire — no queued/starting phase for A at all). WP1.7 —
  // `startSessionLifecycle` now ALWAYS emits a `phase:null` clear right after `running` (harmless when,
  // as here, no phase was ever set), so A's phase log is that one clear and nothing else.
  const callA = runClaudeSubscription("run-A", makeConfig(driver, { concurrency: gate }), a.emit);
  await waitFor(() => driver.sessions.length === 1);
  assert.deepEqual(
    phases(a.events),
    [{ type: "phase", phase: null }],
    "an uncontended acquire emits only the WP1.7 post-running phase clear — no queued/starting phase",
  );

  // B is called while A holds the permit — B's acquire WILL queue.
  const callB = runClaudeSubscription("run-B", makeConfig(driver, { concurrency: gate }), b.emit);
  await waitFor(() => phases(b.events).length > 0);
  assert.deepEqual(phases(b.events), [{ type: "phase", phase: "queued", detail: { position: 1 } }]);
  assert.equal(
    statuses(b.events).length,
    0,
    "a queued run has not emitted `running` yet — it genuinely hasn't started",
  );

  // Release A → B is admitted → its queued phase clears to `starting`, then `running` follows.
  driver.sessions[0]!.emit(USAGE);
  const resultA = await callA;
  await waitFor(() => driver.sessions.length === 2);
  driver.sessions[1]!.emit(USAGE);
  const resultB = await callB;

  assert.equal(resultA.outcome, "completed");
  assert.equal(resultB.outcome, "completed");
  const bPhases = phases(b.events);
  assert.equal(bPhases[0]?.phase, "queued");
  assert.equal(bPhases[0]?.detail?.position, 1);
  assert.equal(bPhases[1]?.phase, "starting");
  // The `starting` phase precedes the `running` status in B's own event log.
  const startingIdx = b.events.findIndex((e) => e.type === "phase" && e.phase === "starting");
  const runningIdx = b.events.findIndex((e) => e.type === "status" && e.status === "running");
  assert.ok(startingIdx >= 0 && runningIdx > startingIdx, "starting precedes running");
  // WP1.7 — `starting` doesn't linger: a `phase:null` clear follows `running`, so B's phase never
  // stays stuck at `starting` once it's ordinarily running.
  assert.equal(bPhases[2]?.phase, null);
  const clearIdx = b.events.findIndex((e) => e.type === "phase" && e.phase === null);
  assert.ok(clearIdx >= 0 && clearIdx > runningIdx, "the phase clear follows running");
});

test("a THIRD contended run reports queue position 2 (one ahead of it, not zero)", async () => {
  const driver = new FakeDriver();
  const gate: ConcurrencyGate = new AsyncSemaphore(1);
  const a = collector();
  const b = collector();
  const c = collector();

  const callA = runClaudeSubscription("run-A", makeConfig(driver, { concurrency: gate }), a.emit);
  await waitFor(() => driver.sessions.length === 1);
  const callB = runClaudeSubscription("run-B", makeConfig(driver, { concurrency: gate }), b.emit);
  await waitFor(() => phases(b.events).length > 0);
  const callC = runClaudeSubscription("run-C", makeConfig(driver, { concurrency: gate }), c.emit);
  await waitFor(() => phases(c.events).length > 0);

  assert.equal(phases(b.events)[0]?.detail?.position, 1, "B is 1st in the queue (0 ahead of it)");
  assert.equal(phases(c.events)[0]?.detail?.position, 2, "C is 2nd in the queue (1 ahead of it)");

  // Drain them all so the test settles cleanly.
  driver.sessions[0]!.emit(USAGE);
  await callA;
  await waitFor(() => driver.sessions.length === 2);
  driver.sessions[1]!.emit(USAGE);
  await callB;
  await waitFor(() => driver.sessions.length === 3);
  driver.sessions[2]!.emit(USAGE);
  await callC;
});

// ── (2) decoupled concurrency — SubscriptionConcurrencyPool.runs vs .shared are independent ────────────

test("D-US6: SubscriptionConcurrencyPool.runs is a SEPARATE gate from .shared — saturating one never blocks the other", async () => {
  const pool = new SubscriptionConcurrencyPool(/* shared (judge) */ 1, /* maxPerProvider */ 1, /* runs */ 1);
  assert.notEqual(pool.runs, pool.shared, "two distinct gate instances");

  // Saturate the JUDGE-sized `.shared` gate.
  await pool.shared.acquire();
  let sharedSecondAcquired = false;
  const sharedSecond = pool.shared.acquire().then(() => {
    sharedSecondAcquired = true;
  });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(sharedSecondAcquired, false, "a 2nd `.shared` acquire is blocked at cap 1");

  // `.runs` (the subscription-RUN budget) is COMPLETELY unaffected — its own permit is free.
  let runsAcquired = false;
  await pool.runs.acquire().then(() => {
    runsAcquired = true;
  });
  assert.equal(runsAcquired, true, "`.runs` is NOT blocked by `.shared` being saturated");

  // And the reverse: saturate `.runs`, `.shared` (now released above) stays independently available.
  pool.shared.release();
  await sharedSecond;
  assert.equal(sharedSecondAcquired, true);

  let runsSecondAcquired = false;
  const runsSecond = pool.runs.acquire().then(() => {
    runsSecondAcquired = true;
  });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(runsSecondAcquired, false, "a 2nd `.runs` acquire is blocked at its OWN cap 1");
  pool.runs.release();
  await runsSecond;
  assert.equal(runsSecondAcquired, true);
});

test("D-US6: an N+1th subscription run queues on `.runs` while `.shared` (judge budget) has a free slot, and vice versa", async () => {
  const driver = new FakeDriver();
  const pool = new SubscriptionConcurrencyPool(/* shared */ 5, /* maxPerProvider */ 5, /* runs */ 1);
  const a = collector();
  const b = collector();

  // Two subscription runs draw from `.runs` (cap 1) — the second must queue even though `.shared` (the
  // judge budget) has 5 free permits sitting completely idle.
  const callA = runClaudeSubscription("run-A", makeConfig(driver, { concurrency: pool.runs }), a.emit);
  await waitFor(() => driver.sessions.length === 1);
  const callB = runClaudeSubscription("run-B", makeConfig(driver, { concurrency: pool.runs }), b.emit);
  await waitFor(() => phases(b.events).length > 0);
  assert.equal(phases(b.events)[0]?.phase, "queued", "B queues on `.runs` even though `.shared` is wide open");
  assert.equal(driver.sessions.length, 1, "only ONE child admitted — the runs budget, not the judge one, gates it");

  driver.sessions[0]!.emit(USAGE);
  await callA;
  await waitFor(() => driver.sessions.length === 2);
  driver.sessions[1]!.emit(USAGE);
  const resultB = await callB;
  assert.equal(resultB.outcome, "completed");

  // Independently: `.shared` can be fully saturated (simulating judges) with `.runs` completely idle.
  await pool.shared.acquire();
  await pool.shared.acquire();
  await pool.shared.acquire();
  await pool.shared.acquire();
  await pool.shared.acquire();
  let sharedBlocked = false;
  const sixth = pool.shared.acquire().then(() => {
    sharedBlocked = true;
  });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(sharedBlocked, false, "the 6th `.shared` acquirer (a judge) blocks at its own cap");
  assert.equal((pool.runs as AsyncSemaphore).willQueue, false, "`.runs` still has its own free permit");
  void sixth; // never released in this test — only proving independence, not draining it
});

// ── (3) SessionClock replaces the old deadline/idle logic — stall + wait-budget expiry ─────────────────

test("D-US3: a stalled run (no events for the stall window while running) ends via terminalFor(stalled) — stopped/stopped_guardrail/stalled", async () => {
  const driver = new FakeDriver(); // no onStart script — the turn never produces an event
  const { emit, events } = collector();
  const { time, advance } = createFakeClockTime();
  const capabilities: SessionCapabilities[] = [];
  const durations: Array<{ activeDurationMs?: number; totalDurationMs?: number }> = [];
  const resultPromise = runClaudeSubscription(
    "run-stall",
    makeConfig(driver, {
      clockTime: time,
      recordCapabilities: (c) => capabilities.push(c),
      recordDurations: (d) => durations.push(d),
    }),
    emit,
  );
  await waitFor(() => driver.sessions.length === 1);
  advance(DEFAULT_STALL_MS); // no events were emitted in this window → the stall timer fires
  const result = await resultPromise;

  assert.equal(result.status, "stopped");
  assert.equal(result.outcome, "stopped_guardrail");
  assert.match(result.stopReason ?? "", /stalled/);
  const terminal = statuses(events).at(-1);
  assert.equal(terminal?.status, "stopped");
  assert.equal(terminal?.outcome, "stopped_guardrail");
  assert.equal(terminal?.stopReasonCode, "stalled", "the machine-readable code comes straight from terminalFor");
  assert.equal(driver.sessions[0]!.options.abortController.signal.aborted, true);

  // Capabilities + durations were recorded via the DI seams.
  assert.deepEqual(capabilities, [SUBSCRIPTION_SESSION_CAPABILITIES]);
  assert.equal(durations.length, 1);
  assert.ok(typeof durations[0]?.activeDurationMs === "number");
  assert.ok(typeof durations[0]?.totalDurationMs === "number");
});

test("D-US3: an interactive run whose wait budget expires (no next turn in time) ends via terminalFor(wait_expired) — Expired", async () => {
  const driver = new FakeDriver();
  driver.onSend = (_text, s) => {
    s.emit({ type: "assistant_message", text: "answer" });
    s.emit(USAGE);
  };
  const { time, advance } = createFakeClockTime();
  const { emit, events } = collector();
  // nextTurn() never resolves — the operator walked away mid-conversation.
  const turns = { nextTurn: () => new Promise<string | null>(() => {}) };

  const resultPromise = runClaudeSubscriptionInteractive(
    "run-wait-expired",
    makeConfig(driver, { clockTime: time }),
    turns,
    emit,
  );
  await waitFor(() => driver.sessions.length === 1);
  // The opener turn is driven by the executor itself (session.send inside the executor, which triggers
  // the scripted onSend reply above) — just wait for the resulting `waiting_input` phase to land, then
  // advance past the wait budget.
  await waitFor(() => events.some((e) => e.type === "phase" && e.phase === "waiting_input"));
  const waitingPhase = phases(events).find((p) => p.phase === "waiting_input");
  assert.equal(waitingPhase?.detail?.reason, "next_turn");
  assert.ok(typeof waitingPhase?.detail?.deadlineAt === "string", "a server-authored absolute deadline is attached");

  advance(DEFAULT_WAIT_BUDGET_MS);
  const result = await resultPromise;

  assert.equal(result.status, "stopped");
  assert.equal(result.outcome, "stopped_guardrail");
  assert.match(result.stopReason ?? "", /wait budget expired/);
  const terminal = statuses(events).at(-1);
  assert.equal(terminal?.stopReasonCode, "wait_expired");
});

test("D-US3: pause accounting — activeDurationMs EXCLUDES a long waiting_input pause; totalDurationMs INCLUDES it", async () => {
  const driver = new FakeDriver();
  driver.onSend = (_text, s) => {
    s.emit({ type: "assistant_message", text: "answer" });
    s.emit(USAGE);
  };
  const { time, advance } = createFakeClockTime();
  const { emit, events } = collector();
  const durations: Array<{ activeDurationMs?: number; totalDurationMs?: number }> = [];
  let resolveNextTurn: ((value: string | null) => void) | undefined;
  const turns = {
    nextTurn: () =>
      new Promise<string | null>((resolve) => {
        resolveNextTurn = resolve;
      }),
  };

  const resultPromise = runClaudeSubscriptionInteractive(
    "run-pause-accounting",
    makeConfig(driver, { clockTime: time, recordDurations: (d) => durations.push(d) }),
    turns,
    emit,
  );
  await waitFor(() => driver.sessions.length === 1);
  await waitFor(() => events.some((e) => e.type === "phase" && e.phase === "waiting_input"));

  // A 5-minute pause on the operator — comfortably under the (10-min) wait budget, so it resolves
  // normally rather than expiring; long enough to be unmistakable in the duration split.
  const PAUSE_MS = 5 * 60_000;
  advance(PAUSE_MS);
  assert.equal(statuses(events).at(-1)?.status, "running", "still running — a bounded wait is not a stall");

  resolveNextTurn?.(null); // the operator ends the conversation cleanly, right after the pause
  const result = await resultPromise;
  assert.equal(result.status, "aborted");
  assert.equal(statuses(events).at(-1)?.stopReasonCode, "user_stop");

  assert.equal(durations.length, 1);
  const { activeDurationMs, totalDurationMs } = durations[0]!;
  assert.ok(typeof totalDurationMs === "number" && totalDurationMs >= PAUSE_MS, "total wall time includes the pause");
  assert.ok(
    typeof activeDurationMs === "number" && activeDurationMs < PAUSE_MS / 10,
    "active time excludes the pause almost entirely (only the negligible fake-time-0 processing ticks)",
  );
});

// ── (4) capabilities recorded once, at session start ────────────────────────────────────────────────

test("D-US4: recordCapabilities is called exactly once, with SUBSCRIPTION_SESSION_CAPABILITIES, even on an immediate auth failure", async () => {
  const driver = new FakeDriver();
  const seen: SessionCapabilities[] = [];
  const { emit } = collector();
  await runClaudeSubscription(
    "run-caps-autherr",
    makeConfig(driver, { resolveAuth: () => null, recordCapabilities: (c) => seen.push(c) }),
    emit,
  );
  assert.deepEqual(seen, [SUBSCRIPTION_SESSION_CAPABILITIES]);
});

test("D-US4: recordCapabilities defaults to a no-op when not injected (byte-identical to before this WP)", async () => {
  const driver = new FakeDriver();
  driver.onStart = (s) => {
    s.emit({ type: "assistant_message", text: "done" });
    s.emit(USAGE);
  };
  const { emit } = collector();
  const result = await runClaudeSubscription("run-caps-default", makeConfig(driver), emit);
  assert.equal(result.status, "completed"); // never throws when the seam is absent
});

// ── (5) durations recorded on every terminal ────────────────────────────────────────────────────────

test("D-US3: recordDurations is called on a normal completion too, with plausible non-negative durations", async () => {
  const driver = new FakeDriver();
  driver.onStart = (s) => {
    s.emit({ type: "assistant_message", text: "done" });
    s.emit(USAGE);
  };
  const durations: Array<{ activeDurationMs?: number; totalDurationMs?: number }> = [];
  const { emit } = collector();
  const result = await runClaudeSubscription(
    "run-durations-completed",
    makeConfig(driver, { recordDurations: (d) => durations.push(d) }),
    emit,
  );
  assert.equal(result.status, "completed");
  assert.equal(durations.length, 1);
  assert.ok((durations[0]?.activeDurationMs ?? -1) >= 0);
  assert.ok((durations[0]?.totalDurationMs ?? -1) >= 0);
});

// ── (6) stop-verdict-before-kill ordering (D-US2) ───────────────────────────────────────────────────

test("D-US2: the terminal status event is on the wire BEFORE the driver's abortController signal ever fires (user stop)", async () => {
  const controller = new AbortController();
  const driver = new FakeDriver();
  const order: string[] = [];
  driver.onStart = (s) => {
    // An INDEPENDENT observer on the SAME signal the executor kills the child with — registered here so
    // it fires in the SAME synchronous dispatch as the executor's own `controller.abort()` call.
    s.options.abortController.signal.addEventListener("abort", () => {
      order.push(statuses(events).length > 0 ? "verdict-already-written" : "verdict-missing");
    });
    controller.abort(); // the user stops the run right as it starts
  };
  const { emit, events } = collector();
  const result = await runClaudeSubscription(
    "run-order-user-stop",
    makeConfig(driver, { abortSignal: controller.signal }),
    emit,
  );
  assert.equal(result.status, "aborted");
  assert.equal(statuses(events).at(-1)?.stopReasonCode, "user_stop");
  assert.deepEqual(order, ["verdict-already-written"], "the verdict was written before the kill signal reached ANY listener");
});

test("D-US2: the terminal status event is on the wire BEFORE the driver's abortController signal fires (SessionClock max_duration fire)", async () => {
  const driver = new FakeDriver(); // never completes on its own
  const order: string[] = [];
  driver.onStart = (s) => {
    s.options.abortController.signal.addEventListener("abort", () => {
      order.push(statuses(events).length > 0 ? "verdict-already-written" : "verdict-missing");
    });
  };
  const { time, advance } = createFakeClockTime();
  const { emit, events } = collector();
  const resultPromise = runClaudeSubscription(
    "run-order-max-duration",
    makeConfig(driver, { maxRunDurationMs: 25, clockTime: time }),
    emit,
  );
  await waitFor(() => driver.sessions.length === 1);
  advance(25);
  const result = await resultPromise;
  assert.equal(result.outcome, "stopped_guardrail");
  assert.deepEqual(order, ["verdict-already-written"]);
});

test("D-US2: a genuine post-verdict driver error (the stream ending after an abort) is swallowed, not reclassified — exactly ONE terminal status is ever written", async () => {
  const driver = new FakeDriver(); // never completes → the abort-triggered stream-end races consumeTurn
  const { time, advance } = createFakeClockTime();
  const { emit, events } = collector();
  const resultPromise = runClaudeSubscription(
    "run-idempotent-terminal",
    makeConfig(driver, { maxRunDurationMs: 10, clockTime: time }),
    emit,
  );
  await waitFor(() => driver.sessions.length === 1);
  advance(10);
  const result = await resultPromise;
  assert.equal(result.outcome, "stopped_guardrail"); // NOT reclassified as a generic driver "error"
  // Exactly TWO status events total (the opening `running` + the ONE terminal) — the race between the
  // clock fire and the resulting stream-end never double-writes a SECOND terminal.
  const terminals = statuses(events).filter((s) => s.status !== "running");
  assert.equal(terminals.length, 1, "exactly one TERMINAL status event — the race never double-writes");
  assert.equal(terminals[0]?.stopReasonCode, "max_duration", "the FIRST (correct) cause wins, never reclassified");
});
