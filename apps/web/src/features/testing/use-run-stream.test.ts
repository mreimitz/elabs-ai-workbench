import type { RunEvent, RunStep } from "@mcp-token-footprint/shared";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  buildTimeline,
  INITIAL_ANNOUNCE_GATE,
  type AnnounceGate,
  stepAnnounceGate,
  suppressFinishToast,
  useRunStream,
} from "./use-run-stream";

// ── The SSE state machine (`.claude/rules/loading-states.md`) ────────────────────────────────────
// Driven entirely by a FAKE EventSource injected onto `globalThis` — no real network, no timers.
// `openRunStream` (lib/api) does `new EventSource(url)`, sets `.onmessage`/`.onerror`, and its cleanup
// calls `.close()`. The fake exposes helpers to push one JSON-encoded `RunEvent` (mirroring the wire)
// and to fire the error event the browser raises when the socket closes. A native EventSource
// auto-reconnects on a non-fatal drop and the API replays its in-order buffer FROM THE START, so a
// "reconnect + replay" is modelled by re-emitting the same events on the same (still-open) instance.

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  close(): void {
    this.closed = true;
  }

  /** Push one `RunEvent` down the stream exactly as the server would (JSON in `data`). */
  emit(event: RunEvent): void {
    this.onmessage?.({ data: JSON.stringify(event) });
  }

  /** Fire the error the browser raises when the socket closes (end-of-run OR a mid-run drop). */
  fail(): void {
    this.onerror?.(new Event("error"));
  }

  static latest(): FakeEventSource {
    const es = FakeEventSource.instances.at(-1);
    if (!es) throw new Error("no EventSource opened");
    return es;
  }
}

const CONNECTION_LOST = "Run stream connection lost.";

beforeEach(() => {
  FakeEventSource.instances = [];
  (globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
});

afterEach(() => {
  (globalThis as unknown as { EventSource: unknown }).EventSource = undefined;
});

describe("useRunStream", () => {
  test("null runId subscribes to nothing and stays empty", () => {
    const { result } = renderHook(() => useRunStream(null));
    expect(FakeEventSource.instances).toHaveLength(0);
    expect(result.current.status).toBeNull();
    expect(result.current.error).toBeNull();
  });

  test("accumulates status/kpi/delta into console state", () => {
    const { result } = renderHook(() => useRunStream("run-1"));
    const es = FakeEventSource.latest();

    act(() => {
      es.emit({ type: "status", status: "running" });
      es.emit({ type: "delta", channel: "text", text: "Hel", turnIndex: 0 });
      es.emit({ type: "delta", channel: "text", text: "lo", turnIndex: 0 });
      es.emit({ type: "delta", channel: "reasoning", text: "why", turnIndex: 0 });
      es.emit({
        type: "kpi",
        turns: 1,
        toolCalls: 2,
        tokensIn: 10,
        tokensOut: 5,
        contextTokens: 15,
        costUsd: 0.01,
      });
    });

    expect(result.current.status).toBe("running");
    expect(result.current.deltas).toEqual({ text: "Hello", reasoning: "why" });
    expect(result.current.deltasByTurn[0]).toEqual({ text: "Hello", reasoning: "why" });
    expect(result.current.kpis).toEqual({
      turns: 1,
      toolCalls: 2,
      tokensIn: 10,
      tokensOut: 5,
      contextTokens: 15,
      costUsd: 0.01,
    });
  });

  // Unified Sessions (WP3.3, D-US1) — the live phase/stopReasonCode facets folded from the stream, so
  // the console can render "Queued — position N" / "Waiting for you" / "Stopping…" chips + the
  // deadline countdown, and the terminal `stopReasonCode` for the locked label table's guardrail rows.
  test("folds {type:'phase'} events into phase/queuePosition/phaseDeadlineAt", () => {
    const { result } = renderHook(() => useRunStream("run-1"));
    const es = FakeEventSource.latest();

    expect(result.current.phase).toBeNull();
    expect(result.current.queuePosition).toBeNull();
    expect(result.current.phaseDeadlineAt).toBeNull();

    act(() => {
      es.emit({ type: "phase", phase: "queued", detail: { position: 3 } });
    });
    expect(result.current.phase).toBe("queued");
    expect(result.current.queuePosition).toBe(3);
    expect(result.current.phaseDeadlineAt).toBeNull();

    act(() => {
      es.emit({
        type: "phase",
        phase: "waiting_input",
        detail: { reason: "next_turn", deadlineAt: "2026-07-16T12:00:00.000Z" },
      });
    });
    // A DIFFERENT phase's detail replaces the previous one WHOLESALE — no stale queue position.
    expect(result.current.phase).toBe("waiting_input");
    expect(result.current.queuePosition).toBeNull();
    expect(result.current.phaseDeadlineAt).toBe("2026-07-16T12:00:00.000Z");

    // A plain "stopping" phase (no detail) drops the earlier deadline too.
    act(() => {
      es.emit({ type: "phase", phase: "stopping" });
    });
    expect(result.current.phase).toBe("stopping");
    expect(result.current.phaseDeadlineAt).toBeNull();

    // WP1.7 — `phase: null` explicitly CLEARS it back to "no distinct phase".
    act(() => {
      es.emit({ type: "phase", phase: null });
    });
    expect(result.current.phase).toBeNull();
    expect(result.current.queuePosition).toBeNull();
    expect(result.current.phaseDeadlineAt).toBeNull();
  });

  test("the terminal status event's stopReasonCode is mirrored onto state", () => {
    const { result } = renderHook(() => useRunStream("run-1"));
    const es = FakeEventSource.latest();

    act(() => {
      es.emit({ type: "status", status: "running" });
    });
    expect(result.current.stopReasonCode).toBeUndefined();

    act(() => {
      es.emit({
        type: "status",
        status: "stopped",
        outcome: "stopped_guardrail",
        stopReason: "Turn cap reached",
        stopReasonCode: "max_turns",
      });
    });
    expect(result.current.stopReasonCode).toBe("max_turns");
  });

  test("{type:'ping'} is a no-op on the accumulated state", () => {
    const { result } = renderHook(() => useRunStream("run-1"));
    const es = FakeEventSource.latest();

    act(() => {
      es.emit({ type: "status", status: "running" });
      es.emit({ type: "phase", phase: "waiting_input", detail: { reason: "next_turn" } });
    });
    const before = result.current;

    act(() => {
      es.emit({ type: "ping" });
    });
    // Every accumulated facet is untouched by a ping — only the (untested-here) watchdog timer reacts.
    expect(result.current.status).toBe(before.status);
    expect(result.current.phase).toBe(before.phase);
    expect(result.current.error).toBeNull();
  });

  test("folds ask_user question/question_resolved events into pending questions", () => {
    const { result } = renderHook(() => useRunStream("run-1"));
    const es = FakeEventSource.latest();

    act(() => {
      es.emit({ type: "status", status: "running" });
      es.emit({
        type: "question",
        questionId: "q1",
        prompt: "Which environment?",
        options: [{ label: "staging" }, { label: "prod" }],
        allowOther: true,
      });
      es.emit({ type: "question", questionId: "q2", prompt: "Confirm?" });
    });
    expect(result.current.questions.map((q) => q.questionId)).toEqual(["q1", "q2"]);
    expect(result.current.questions[0]).toEqual({
      questionId: "q1",
      prompt: "Which environment?",
      options: [{ label: "staging" }, { label: "prod" }],
      allowOther: true,
    });
    // No options → the field is omitted; allowOther defaults to true.
    expect(result.current.questions[1]).toEqual({
      questionId: "q2",
      prompt: "Confirm?",
      allowOther: true,
    });

    // Answering q1 removes only it; a replayed duplicate `question` never double-adds.
    act(() => {
      es.emit({ type: "question", questionId: "q2", prompt: "Confirm?" });
      es.emit({ type: "question_resolved", questionId: "q1", answer: "staging" });
    });
    expect(result.current.questions.map((q) => q.questionId)).toEqual(["q2"]);
  });

  test("a question with allowOther:false is preserved as false", () => {
    const { result } = renderHook(() => useRunStream("run-1"));
    const es = FakeEventSource.latest();
    act(() => {
      es.emit({ type: "status", status: "running" });
      es.emit({
        type: "question",
        questionId: "q1",
        prompt: "Pick",
        options: [{ label: "a" }],
        allowOther: false,
      });
    });
    expect(result.current.questions[0]?.allowOther).toBe(false);
  });

  test("AR11 — a terminal status keeps the stream OPEN through the review; it closes on the settled rating", () => {
    const { result } = renderHook(() => useRunStream("run-1"));
    const es = FakeEventSource.latest();

    act(() => {
      es.emit({ type: "status", status: "running" });
      es.emit({ type: "delta", channel: "text", text: "done", turnIndex: 0 });
      es.emit({ type: "status", status: "completed", outcome: "completed" });
    });

    // Terminal alone no longer closes — the server keeps the socket open through the post-terminal
    // review and the client mirrors it (the settled `rating` event is the second half of the gate).
    expect(es.closed).toBe(false);

    // The review runs: pending → rating fold into `ratingState` (the console reads "Reviewing…").
    act(() => {
      es.emit({ type: "rating", state: "pending" });
    });
    expect(result.current.ratingState).toBe("pending");
    expect(es.closed).toBe(false);
    act(() => {
      es.emit({ type: "rating", state: "rating" });
    });
    expect(result.current.ratingState).toBe("rating");
    expect(es.closed).toBe(false);

    // The settled rating closes the stream (no reconnect-and-replay loop).
    act(() => {
      es.emit({ type: "rating", state: "rated" });
    });
    expect(result.current.ratingState).toBe("rated");
    expect(es.closed).toBe(true);

    // The expected post-terminal `onerror` must be swallowed — never surfaced as "connection lost".
    act(() => {
      es.fail();
    });
    expect(result.current.status).toBe("completed");
    expect(result.current.outcome).toBe("completed");
    expect(result.current.error).toBeNull();
  });

  test("AR11 — a post-terminal drop MID-REVIEW is benign: closes, keeps ratingState as-is, no error", () => {
    const { result } = renderHook(() => useRunStream("run-1"));
    const es = FakeEventSource.latest();

    act(() => {
      es.emit({ type: "status", status: "running" });
      es.emit({ type: "status", status: "completed", outcome: "completed" });
      es.emit({ type: "rating", state: "rating" });
    });
    expect(es.closed).toBe(false);

    // An API restart mid-review drops the socket: the hook closes the source itself (a reconnect
    // would replay the seq-less persisted log and double-fold deltas), leaves `ratingState` AS-IS
    // (an honest unknown — a refresh re-reads the persisted state) and never flashes an error.
    act(() => {
      es.fail();
    });
    expect(es.closed).toBe(true);
    expect(result.current.ratingState).toBe("rating");
    expect(result.current.error).toBeNull();
  });

  test("AR11 — a failed rating settles the stream too (the run chip stays its terminal self)", () => {
    const { result } = renderHook(() => useRunStream("run-1"));
    const es = FakeEventSource.latest();

    act(() => {
      es.emit({ type: "status", status: "completed", outcome: "completed" });
      es.emit({ type: "rating", state: "failed" });
    });
    expect(result.current.ratingState).toBe("failed");
    expect(es.closed).toBe(true);
    // The run's own status/outcome are untouched by the review axis.
    expect(result.current.status).toBe("completed");
    expect(result.current.outcome).toBe("completed");
  });

  test("a genuine PRE-terminal drop surfaces the connection-lost error once", () => {
    const { result } = renderHook(() => useRunStream("run-1"));
    const es = FakeEventSource.latest();

    act(() => {
      es.emit({ type: "status", status: "running" });
      es.emit({ type: "delta", channel: "text", text: "partial", turnIndex: 0 });
    });
    expect(result.current.error).toBeNull();

    act(() => {
      es.fail();
    });
    expect(result.current.error).toBe(CONNECTION_LOST);
    expect(es.closed).toBe(false); // a pre-terminal drop does NOT close — the browser reconnects

    // A second error before any recovery must not stack a different message.
    act(() => {
      es.fail();
    });
    expect(result.current.error).toBe(CONNECTION_LOST);
  });

  test("reconnect dedupe: a replayed prefix after a drop does NOT double the streamed deltas", () => {
    const { result } = renderHook(() => useRunStream("run-1"));
    const es = FakeEventSource.latest();

    // Live events applied before the drop. Each carries the server-stamped monotonic `seq` (F6).
    const live: RunEvent[] = [
      { type: "status", status: "running", seq: 0 },
      { type: "delta", channel: "text", text: "Hello", turnIndex: 0, seq: 1 },
      { type: "delta", channel: "text", text: " world", turnIndex: 0, seq: 2 },
    ];
    act(() => {
      for (const ev of live) es.emit(ev);
    });
    expect(result.current.deltas.text).toBe("Hello world");

    // Mid-run drop → connection-lost sentinel.
    act(() => {
      es.fail();
    });
    expect(result.current.error).toBe(CONNECTION_LOST);

    // Browser reconnects; API replays the WHOLE buffer from the start (same `seq`s), then resumes live.
    act(() => {
      for (const ev of live) es.emit(ev); // replayed prefix — deduped by seq
      es.emit({ type: "delta", channel: "text", text: "!", turnIndex: 0, seq: 3 }); // genuinely new
    });

    // Deltas are appended exactly once (no duplication) and the sentinel is cleared on recovery.
    expect(result.current.deltas.text).toBe("Hello world!");
    expect(result.current.deltasByTurn[0]?.text).toBe("Hello world!");
    expect(result.current.error).toBeNull();

    // Clean terminal close afterwards.
    act(() => {
      es.emit({ type: "status", status: "completed", outcome: "completed", seq: 4 });
      es.fail();
    });
    expect(result.current.status).toBe("completed");
    expect(result.current.error).toBeNull();
  });

  test("reconnect where prior-applied exceeds the replayed suffix does NOT drop new live events", () => {
    // F6 — the server's replay buffer is BOUNDED, so on reconnect it replays only a SUFFIX of the
    // events already applied. The old fix armed `skip = events-applied`, so when prior-applied (here 5)
    // exceeded the replayed suffix (here 2) it skipped the suffix AND kept discarding genuinely-new
    // live events until the larger count drained → lost deltas/steps. Seq-based dedup skips ONLY the
    // events with `seq <= lastAppliedSeq`, so new live events (higher seq) always land.
    const { result } = renderHook(() => useRunStream("run-1"));
    const es = FakeEventSource.latest();

    act(() => {
      es.emit({ type: "status", status: "running", seq: 0 });
      es.emit({ type: "delta", channel: "text", text: "A", turnIndex: 0, seq: 1 });
      es.emit({ type: "delta", channel: "text", text: "B", turnIndex: 0, seq: 2 });
      es.emit({ type: "delta", channel: "text", text: "C", turnIndex: 0, seq: 3 });
      es.emit({ type: "delta", channel: "text", text: "D", turnIndex: 0, seq: 4 });
    });
    expect(result.current.deltas.text).toBe("ABCD");

    // Mid-run drop.
    act(() => {
      es.fail();
    });
    expect(result.current.error).toBe(CONNECTION_LOST);

    // Reconnect: the bounded buffer replays ONLY the suffix (seq 3, 4) — the earlier events (0–2) have
    // aged out — then resumes with genuinely-new live events (seq 5, 6). prior-applied (5) far exceeds
    // the 2 replayed.
    act(() => {
      es.emit({ type: "delta", channel: "text", text: "C", turnIndex: 0, seq: 3 }); // replayed suffix
      es.emit({ type: "delta", channel: "text", text: "D", turnIndex: 0, seq: 4 }); // replayed suffix
      es.emit({ type: "delta", channel: "text", text: "E", turnIndex: 0, seq: 5 }); // genuinely new
      es.emit({ type: "delta", channel: "text", text: "F", turnIndex: 0, seq: 6 }); // genuinely new
    });

    // The replayed suffix is ignored (no doubling), and BOTH new live events land.
    expect(result.current.deltas.text).toBe("ABCDEF");
    expect(result.current.error).toBeNull();

    act(() => {
      es.emit({ type: "status", status: "completed", outcome: "completed", seq: 7 });
      es.fail();
    });
    expect(result.current.status).toBe("completed");
    expect(result.current.error).toBeNull();
  });

  test("authRequired is sticky once a terminal auth error sets it", () => {
    const { result } = renderHook(() => useRunStream("run-1"));
    const es = FakeEventSource.latest();

    act(() => {
      es.emit({ type: "status", status: "running" });
      es.emit({ type: "error", message: "Reauth needed", authRequired: true });
      es.emit({ type: "error", message: "later non-fatal" }); // no flag — must not clear it
    });

    expect(result.current.error).toBe("later non-fatal");
    expect(result.current.authRequired).toBe(true);
  });
});

// ── Unified Sessions WP2.2 (D-US8) — the 45s ping-aware staleness watchdog ────────────────────────
// Uses REAL fake timers (`vi.useFakeTimers()`), scoped to this describe block only, layered on top of
// the same `FakeEventSource` wiring the outer `beforeEach`/`afterEach` already installs for the whole
// file. A forced reconnect opens a NEW `FakeEventSource` instance (via `openRunStream` → `connect()`),
// so `FakeEventSource.instances` growing (and the prior instance's `.closed` flipping true) is the
// observable signal a reconnect happened.
describe("useRunStream — WP2.2 staleness watchdog", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("45s of total silence (no event, no ping) while pre-terminal forces a reconnect + banner", () => {
    const { result } = renderHook(() => useRunStream("run-1"));
    const es1 = FakeEventSource.latest();

    act(() => {
      es1.emit({ type: "status", status: "running" });
    });
    expect(result.current.error).toBeNull();
    expect(FakeEventSource.instances).toHaveLength(1);

    // Nothing at all arrives for the full watchdog window.
    act(() => {
      vi.advanceTimersByTime(45_000);
    });

    expect(FakeEventSource.instances).toHaveLength(2); // the watchdog forced a fresh connection
    expect(es1.closed).toBe(true); // the stale one was closed
    expect(FakeEventSource.latest()).not.toBe(es1);
    expect(result.current.error).toBe(CONNECTION_LOST); // the SAME reconnect banner a real drop shows
    // The run's own state is untouched by the watchdog — only the connection banner reacts.
    expect(result.current.status).toBe("running");
  });

  test("a ping within the window resets the watchdog — no false reconnect", () => {
    const { result } = renderHook(() => useRunStream("run-1"));
    const es1 = FakeEventSource.latest();

    act(() => {
      es1.emit({ type: "status", status: "running" });
    });

    act(() => {
      vi.advanceTimersByTime(30_000); // well within the 45s window
    });
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(result.current.error).toBeNull();

    // The server's 15s heartbeat (WP2.1) — a `{type:"ping"}` RunEvent — resets the clock.
    act(() => {
      es1.emit({ type: "ping" });
    });

    act(() => {
      vi.advanceTimersByTime(30_000); // 60s since mount, but only 30s since the ping — must NOT fire
    });
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(es1.closed).toBe(false);
    expect(result.current.error).toBeNull();

    // Now push past 45s since the ping — the watchdog fires on its own fresh window.
    act(() => {
      vi.advanceTimersByTime(15_001);
    });
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(result.current.error).toBe(CONNECTION_LOST);
  });

  test("no watchdog reconnect (and no banner) after an expected post-terminal close", () => {
    const { result } = renderHook(() => useRunStream("run-1"));
    const es1 = FakeEventSource.latest();

    act(() => {
      es1.emit({ type: "status", status: "running" });
      es1.emit({ type: "status", status: "completed", outcome: "completed" });
      es1.emit({ type: "rating", state: "rated" }); // settles the AR11 close gate — the hook closes es1
    });
    expect(es1.closed).toBe(true);
    expect(result.current.error).toBeNull();

    // Long past the watchdog window: a finished run's silence is expected, not a dead socket.
    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    expect(FakeEventSource.instances).toHaveLength(1); // no forced reconnect
    expect(result.current.error).toBeNull(); // no banner
  });

  test("the watchdog re-arms after a forced reconnect and keeps retrying if the fresh one also goes silent", () => {
    const { result } = renderHook(() => useRunStream("run-1"));
    const es1 = FakeEventSource.latest();
    act(() => {
      es1.emit({ type: "status", status: "running" });
    });

    act(() => {
      vi.advanceTimersByTime(45_000);
    });
    expect(FakeEventSource.instances).toHaveLength(2);
    const es2 = FakeEventSource.latest();
    expect(es2).not.toBe(es1);

    // The fresh connection ALSO goes silent — the watchdog must fire again, not just once.
    act(() => {
      vi.advanceTimersByTime(45_000);
    });
    expect(FakeEventSource.instances).toHaveLength(3);
    expect(es2.closed).toBe(true);
    expect(result.current.error).toBe(CONNECTION_LOST);
  });

  test("a reconnected (fresh) EventSource's replay is deduped by seq like any other reconnect", () => {
    const { result } = renderHook(() => useRunStream("run-1"));
    const es1 = FakeEventSource.latest();

    act(() => {
      es1.emit({ type: "status", status: "running", seq: 0 });
      es1.emit({ type: "delta", channel: "text", text: "Hello", turnIndex: 0, seq: 1 });
    });
    expect(result.current.deltas.text).toBe("Hello");

    act(() => {
      vi.advanceTimersByTime(45_000); // watchdog forces a fresh connection
    });
    const es2 = FakeEventSource.latest();
    expect(es2).not.toBe(es1);

    // The fresh connection replays what it has (including the already-applied seq 0/1) before
    // resuming live — the belt-and-braces `seq` guard must drop the replayed prefix, not double it.
    act(() => {
      es2.emit({ type: "status", status: "running", seq: 0 });
      es2.emit({ type: "delta", channel: "text", text: "Hello", turnIndex: 0, seq: 1 });
      es2.emit({ type: "delta", channel: "text", text: " world", turnIndex: 0, seq: 2 }); // genuinely new
    });
    expect(result.current.deltas.text).toBe("Hello world");
    expect(result.current.error).toBeNull();
  });
});

// ── WP 0.2 / S13 — the terminal-announcement gate ────────────────────────────────────────────────
// Locks the fix for the false "Run completed" toast: opening an already-finished run replays its
// whole event log (including the historical `running` status), which must NOT fire a completion
// toast — only a genuinely live→terminal transition observed this session announces.
describe("stepAnnounceGate", () => {
  /** Drive a phase sequence through the gate and collect the phases that announced. */
  function announcedPhases(
    runId: string,
    observations: Array<{ isLive: boolean; isReplay: boolean; phase: string }>,
  ): string[] {
    let gate: AnnounceGate = INITIAL_ANNOUNCE_GATE;
    const announced: string[] = [];
    for (const obs of observations) {
      const stepped = stepAnnounceGate(gate, { ...obs, runId });
      gate = stepped.gate;
      if (stepped.announce) announced.push(obs.phase);
    }
    return announced;
  }

  test("opening a FINISHED run (replay of running→completed) announces nothing", () => {
    // Replay re-streams: pending → running → completed, all with isReplay=true (opened as replay).
    const announced = announcedPhases("run-done", [
      { isLive: true, isReplay: true, phase: "pending" },
      { isLive: true, isReplay: true, phase: "running" },
      { isLive: false, isReplay: true, phase: "completed" },
    ]);
    expect(announced).toEqual([]);
  });

  test("opening three different finished runs stays silent for every one", () => {
    for (const id of ["run-a", "run-b", "run-c"]) {
      const announced = announcedPhases(id, [
        { isLive: true, isReplay: true, phase: "running" },
        { isLive: false, isReplay: true, phase: "completed" },
      ]);
      expect(announced).toEqual([]);
    }
  });

  test("a genuinely live run announces exactly once on completion", () => {
    // Non-replay while live; once terminal the console flips isReplay=true (streamIsTerminal) — the
    // completion still announces because the gate was armed during the live `running` phase.
    const announced = announcedPhases("run-live", [
      { isLive: true, isReplay: false, phase: "pending" },
      { isLive: true, isReplay: false, phase: "running" },
      { isLive: false, isReplay: true, phase: "completed" },
    ]);
    expect(announced).toEqual(["completed"]);
  });

  test("a settled phase never re-announces on re-render", () => {
    const announced = announcedPhases("run-live", [
      { isLive: true, isReplay: false, phase: "running" },
      { isLive: false, isReplay: true, phase: "completed" },
      { isLive: false, isReplay: true, phase: "completed" }, // re-render / dep change
      { isLive: false, isReplay: true, phase: "completed" },
    ]);
    expect(announced).toEqual(["completed"]);
  });

  test("non-completed terminal outcomes (stopped/error) also announce once when live", () => {
    expect(
      announcedPhases("run-stopped", [
        { isLive: true, isReplay: false, phase: "running" },
        { isLive: false, isReplay: true, phase: "stopped" },
      ]),
    ).toEqual(["stopped"]);
    expect(
      announcedPhases("run-error", [
        { isLive: true, isReplay: false, phase: "running" },
        { isLive: false, isReplay: true, phase: "error" },
      ]),
    ).toEqual(["error"]);
  });

  test("a run that is terminal before any live phase (pure replay, no historical running) is silent", () => {
    const announced = announcedPhases("run-x", [
      { isLive: false, isReplay: true, phase: "completed" },
    ]);
    expect(announced).toEqual([]);
  });
});

// ── Unified Sessions (WP3.3, D-US2) — the finish-toast suppression predicate ─────────────────────
// A deliberate Stop/End click is an expected, operator-caused disposition — the terminal toast for
// IT specifically is noise; every OTHER terminal (a guardrail, a provider error, a clean finish) still
// announces normally, even for a run the operator was watching.
describe("suppressFinishToast", () => {
  test("suppresses the 'stopped' phase toast when the operator caused it", () => {
    expect(suppressFinishToast("stopped", true)).toBe(true);
  });

  test("does NOT suppress 'stopped' when the operator did not initiate it", () => {
    expect(suppressFinishToast("stopped", false)).toBe(false);
  });

  test("never suppresses an outcome the operator didn't cause, even if (implausibly) flagged", () => {
    expect(suppressFinishToast("completed", true)).toBe(false);
    expect(suppressFinishToast("stopped_guardrail", true)).toBe(false);
    expect(suppressFinishToast("error", true)).toBe(false);
    expect(suppressFinishToast("context_overflow", true)).toBe(false);
    expect(suppressFinishToast("assertions_failed", true)).toBe(false);
  });

  test("the 'ended' phase is covered defensively even though it never reaches the toast switch today", () => {
    expect(suppressFinishToast("ended", true)).toBe(true);
    expect(suppressFinishToast("ended", false)).toBe(false);
  });
});

// ── Observability WP 2.5 (D-OB15) — the settled turn's `stepId` thread ──────────────────────────────
// The turn-level "Your verdict" control scopes its feedback to `RunFeedbackInput.stepId`, which MUST
// be a real `run_steps.id` (the API 400s a foreign one). `buildTimeline` is the ONLY place that knows
// the settled `llm_response` step's own id, so it threads it onto `TimelineAssistantTurn.stepId` —
// this is the mechanism the console's turn-level targeting relies on end-to-end.
describe("buildTimeline — turn.stepId threading (WP 2.5, D-OB15)", () => {
  function llmResponseStep(id: string, turnIndex: number, over: Partial<RunStep> = {}): RunStep {
    return {
      id,
      runId: "run-1",
      index: turnIndex,
      type: "llm_response",
      label: "assistant",
      status: "ok",
      profileTokens: {},
      turnIndex,
      payload: { deltas: { text: "", reasoning: "" }, snapshot: {} },
      assistantText: `turn ${turnIndex}`,
      ...over,
    };
  }

  test("a settled turn carries its OWN llm_response step's id as stepId", () => {
    const items = buildTimeline({
      steps: [llmResponseStep("run-1:step:7", 0)],
      deltas: { text: "", reasoning: "" },
      status: "completed",
    });
    const turn = items[0];
    if (turn?.kind !== "assistant_turn") throw new Error("expected an assistant turn");
    expect(turn.stepId).toBe("run-1:step:7");
  });

  test("multiple turns each get their OWN distinct stepId — never conflated", () => {
    const items = buildTimeline({
      steps: [llmResponseStep("run-1:step:1", 0), llmResponseStep("run-1:step:5", 1)],
      deltas: { text: "", reasoning: "" },
      status: "completed",
    });
    const [first, second] = items;
    if (first?.kind !== "assistant_turn" || second?.kind !== "assistant_turn") {
      throw new Error("expected two assistant turns");
    }
    expect(first.stepId).toBe("run-1:step:1");
    expect(second.stepId).toBe("run-1:step:5");
  });

  test("a turn with no closing llm_response yet (still in-flight) has no stepId", () => {
    const items = buildTimeline({
      steps: [],
      deltas: { text: "in progress", reasoning: "" },
      deltasByTurn: { 0: { text: "in progress", reasoning: "" } },
      status: "running",
    });
    const turn = items[0];
    if (turn?.kind !== "assistant_turn") throw new Error("expected an assistant turn");
    expect(turn.stepId).toBeUndefined();
  });
});
