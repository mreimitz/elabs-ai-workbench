import type { SuiteAggregates, SuiteCell, SuiteRunEvent } from "@mcp-token-footprint/shared";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cellKey, useSuiteStream } from "./use-suite-stream";

// ── The SSE state machine (`.claude/rules/loading-states.md`) ────────────────────────────────────
// Mirrors `../use-run-stream.test.ts`'s `FakeEventSource` harness exactly: a fake `EventSource`
// injected onto `globalThis`, driven purely through `.emit()`/`.fail()` — no real network, no timers
// (except in the watchdog describe block below, which layers `vi.useFakeTimers()` on top).
// `openSuiteRunStream` (lib/api) does `new EventSource(url)`, sets `.onmessage`/`.onerror`, and its
// cleanup calls `.close()`.

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

  /** Push one `SuiteRunEvent` down the stream exactly as the server would (JSON in `data`). */
  emit(event: SuiteRunEvent): void {
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

const CONNECTION_LOST = "Suite run stream connection lost.";

const cell = (over: Partial<SuiteCell> = {}): SuiteCell => ({
  testId: "test-1",
  scenarioId: "scenario-1",
  repetition: 0,
  status: "running",
  ...over,
});

const aggregates = (over: Partial<SuiteAggregates> = {}): SuiteAggregates => ({
  cellsTotal: 1,
  cellsCompleted: 0,
  meanGrade: null,
  gradeStdDev: null,
  passRateAt05: null,
  totalTokens: 0,
  execCostUsd: 0,
  judgeCostUsd: 0,
  ...over,
});

beforeEach(() => {
  FakeEventSource.instances = [];
  (globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
});

afterEach(() => {
  (globalThis as unknown as { EventSource: unknown }).EventSource = undefined;
});

describe("useSuiteStream", () => {
  test("null suiteRunId subscribes to nothing and stays empty", () => {
    const { result } = renderHook(() => useSuiteStream(null));
    expect(FakeEventSource.instances).toHaveLength(0);
    expect(result.current.status).toBeNull();
    expect(result.current.error).toBeNull();
  });

  test("accumulates cell/aggregates/status into console state", () => {
    const { result } = renderHook(() => useSuiteStream("suite-run-1"));
    const es = FakeEventSource.latest();

    act(() => {
      es.emit({ type: "status", status: "running" });
      es.emit({ type: "cell", cell: cell() });
      es.emit({ type: "aggregates", aggregates: aggregates({ cellsCompleted: 1 }) });
    });

    expect(result.current.status).toBe("running");
    expect(result.current.cells[cellKey(cell())]).toEqual(cell());
    expect(result.current.aggregates).toEqual(aggregates({ cellsCompleted: 1 }));
  });

  test("upserts a cell by its stable key — a replay never duplicates it", () => {
    const { result } = renderHook(() => useSuiteStream("suite-run-1"));
    const es = FakeEventSource.latest();

    act(() => {
      es.emit({ type: "cell", cell: cell({ status: "running" }) });
      es.emit({ type: "cell", cell: cell({ status: "completed", score: 0.9 }) });
    });

    expect(Object.keys(result.current.cells)).toHaveLength(1);
    expect(result.current.cells[cellKey(cell())]).toEqual(cell({ status: "completed", score: 0.9 }));
  });

  test("AR11 — a terminal status keeps the stream OPEN through the review; closes on settled rating", () => {
    const { result } = renderHook(() => useSuiteStream("suite-run-1"));
    const es = FakeEventSource.latest();

    act(() => {
      es.emit({ type: "status", status: "running" });
      es.emit({ type: "status", status: "completed" });
    });
    expect(es.closed).toBe(false);

    act(() => {
      es.emit({ type: "rating", state: "rating" });
    });
    expect(result.current.ratingState).toBe("rating");
    expect(es.closed).toBe(false);

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
    expect(result.current.error).toBeNull();
  });

  test("a genuine PRE-terminal drop surfaces the connection-lost error once", () => {
    const { result } = renderHook(() => useSuiteStream("suite-run-1"));
    const es = FakeEventSource.latest();

    act(() => {
      es.emit({ type: "status", status: "running" });
    });
    expect(result.current.error).toBeNull();

    act(() => {
      es.fail();
    });
    expect(result.current.error).toBe(CONNECTION_LOST);
    expect(es.closed).toBe(false); // a pre-terminal drop does NOT close — the browser reconnects

    act(() => {
      es.fail();
    });
    expect(result.current.error).toBe(CONNECTION_LOST);
  });

  test("reconnect dedupe: a replayed prefix after a drop does NOT double-apply cells/aggregates", () => {
    const { result } = renderHook(() => useSuiteStream("suite-run-1"));
    const es = FakeEventSource.latest();

    const live: SuiteRunEvent[] = [
      { type: "status", status: "running", seq: 0 },
      { type: "cell", cell: cell({ status: "running" }), seq: 1 },
      { type: "cell", cell: cell({ status: "completed", score: 0.5 }), seq: 2 },
    ];
    act(() => {
      for (const ev of live) es.emit(ev);
    });
    expect(result.current.cells[cellKey(cell())]?.status).toBe("completed");

    act(() => {
      es.fail();
    });
    expect(result.current.error).toBe(CONNECTION_LOST);

    // Browser reconnects; API replays the WHOLE buffer from the start (same `seq`s), then a genuinely
    // new event.
    act(() => {
      for (const ev of live) es.emit(ev); // replayed prefix — deduped by seq
      es.emit({
        type: "aggregates",
        aggregates: aggregates({ cellsCompleted: 1 }),
        seq: 3,
      });
    });
    expect(result.current.aggregates).toEqual(aggregates({ cellsCompleted: 1 }));
    expect(result.current.error).toBeNull();
  });
});

// ── Unified Sessions WP2.2 (D-US8) — the 45s staleness watchdog (suite stream) ────────────────────
// Same shape as `../use-run-stream.test.ts`'s watchdog block, using real fake timers. WP2.3 (D-US8
// follow-up) gave the suite SSE route a real `{type:"ping"}` event (see `use-suite-stream.ts`'s
// `WATCHDOG_STALE_MS` doc) — the ping-specific test lives at the bottom of this block; the rest of the
// watchdog is still exercised as "message-aware" (any real `cell`/`aggregates`/`status`/`rating` event
// resets it too), since either kind of message proves the socket is alive.
describe("useSuiteStream — WP2.2 staleness watchdog", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("45s of total silence while pre-terminal forces a reconnect + banner", () => {
    const { result } = renderHook(() => useSuiteStream("suite-run-1"));
    const es1 = FakeEventSource.latest();

    act(() => {
      es1.emit({ type: "status", status: "running" });
    });
    expect(result.current.error).toBeNull();
    expect(FakeEventSource.instances).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(45_000);
    });

    expect(FakeEventSource.instances).toHaveLength(2); // the watchdog forced a fresh connection
    expect(es1.closed).toBe(true);
    expect(FakeEventSource.latest()).not.toBe(es1);
    expect(result.current.error).toBe(CONNECTION_LOST);
    expect(result.current.status).toBe("running"); // the suite's own state is untouched
  });

  test("a real event within the window resets the watchdog — no false reconnect", () => {
    const { result } = renderHook(() => useSuiteStream("suite-run-1"));
    const es1 = FakeEventSource.latest();

    act(() => {
      es1.emit({ type: "status", status: "running" });
    });

    act(() => {
      vi.advanceTimersByTime(30_000); // well within the 45s window
    });
    expect(FakeEventSource.instances).toHaveLength(1);

    // A real cell transition — the closest this stream has to a "ping" — resets the clock.
    act(() => {
      es1.emit({ type: "cell", cell: cell() });
    });

    act(() => {
      vi.advanceTimersByTime(30_000); // 60s since mount, but only 30s since the cell event
    });
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(result.current.error).toBeNull();

    act(() => {
      vi.advanceTimersByTime(15_001); // now past 45s since the cell event
    });
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(result.current.error).toBe(CONNECTION_LOST);
  });

  test("no watchdog reconnect (and no banner) after an expected post-terminal close", () => {
    const { result } = renderHook(() => useSuiteStream("suite-run-1"));
    const es1 = FakeEventSource.latest();

    act(() => {
      es1.emit({ type: "status", status: "running" });
      es1.emit({ type: "status", status: "completed" });
      es1.emit({ type: "rating", state: "rated" }); // settles the AR11 close gate
    });
    expect(es1.closed).toBe(true);
    expect(result.current.error).toBeNull();

    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    expect(FakeEventSource.instances).toHaveLength(1); // no forced reconnect
    expect(result.current.error).toBeNull();
  });

  test("a reconnected (fresh) EventSource's replay is deduped by seq like any other reconnect", () => {
    const { result } = renderHook(() => useSuiteStream("suite-run-1"));
    const es1 = FakeEventSource.latest();

    act(() => {
      es1.emit({ type: "status", status: "running", seq: 0 });
      es1.emit({ type: "cell", cell: cell({ status: "running" }), seq: 1 });
    });

    act(() => {
      vi.advanceTimersByTime(45_000); // watchdog forces a fresh connection
    });
    const es2 = FakeEventSource.latest();
    expect(es2).not.toBe(es1);

    act(() => {
      es2.emit({ type: "status", status: "running", seq: 0 }); // replayed — deduped
      es2.emit({ type: "cell", cell: cell({ status: "running" }), seq: 1 }); // replayed — deduped
      es2.emit({ type: "cell", cell: cell({ status: "completed", score: 1 }), seq: 2 }); // genuinely new
    });
    expect(result.current.cells[cellKey(cell())]?.status).toBe("completed");
    expect(result.current.error).toBeNull();
  });

  // ── WP2.3 (D-US8 follow-up) — the suite stream's real `{type:"ping"}` keepalive ──────────────────
  // Mirrors `../use-run-stream.test.ts`'s "a ping within the window resets the watchdog" test: proves
  // the false-trip the WP2.R stream review found (a legitimately-quiet-but-alive suite run — a member
  // run > 45s with no suite-level event — false-tripping this watchdog) is closed now that the server
  // emits a real, parseable ping instead of an invisible `: ping` SSE comment.
  test("a real `{type:'ping'}` event within the window resets the watchdog — no false reconnect", () => {
    const { result } = renderHook(() => useSuiteStream("suite-run-1"));
    const es1 = FakeEventSource.latest();

    act(() => {
      es1.emit({ type: "status", status: "running" });
    });

    act(() => {
      vi.advanceTimersByTime(30_000); // well within the 45s window
    });
    expect(FakeEventSource.instances).toHaveLength(1);

    // The server's 15s heartbeat (WP2.3) — a `{type:"ping"}` SuiteRunEvent — resets the clock, exactly
    // like a real cell/aggregates/status/rating event does.
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

  test("a ping is a no-op for cell/aggregate/status state and is never subject to the seq dedupe", () => {
    const { result } = renderHook(() => useSuiteStream("suite-run-1"));
    const es = FakeEventSource.latest();

    act(() => {
      es.emit({ type: "status", status: "running", seq: 0 });
      es.emit({ type: "cell", cell: cell({ status: "running" }), seq: 1 });
      es.emit({ type: "aggregates", aggregates: aggregates({ cellsCompleted: 1 }), seq: 2 });
      // A ping never carries a `seq` (mirrors `RunEvent`'s `ping`) — repeat it a few times to prove it
      // never trips the `seq <= lastSeqRef.current` dedupe guard (which would otherwise be a no-op
      // anyway for an event with no `seq` at all) and never mutates any accumulated state.
      es.emit({ type: "ping" });
      es.emit({ type: "ping" });
    });

    expect(result.current.status).toBe("running");
    expect(result.current.cells[cellKey(cell())]).toEqual(cell());
    expect(result.current.aggregates).toEqual(aggregates({ cellsCompleted: 1 }));
    expect(result.current.error).toBeNull();

    // A genuinely new seq-carrying event after the pings still applies normally — the pings didn't
    // desync `lastSeqRef`.
    act(() => {
      es.emit({ type: "cell", cell: cell({ status: "completed", score: 1 }), seq: 3 });
    });
    expect(result.current.cells[cellKey(cell())]?.status).toBe("completed");
  });
});
