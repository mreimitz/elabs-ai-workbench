import type { AssistantEvent, AssistantStreamFrame } from "@mcp-token-footprint/shared";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  buildAssistantTimeline,
  reduceAssistantFrame,
  useAssistantStream,
  type AssistantStreamState,
} from "./use-assistant-stream";

// ── The SSE state machine (`.claude/rules/loading-states.md`) ────────────────────────────────────
// Mirrors `features/testing/use-run-stream.test.ts`'s FakeEventSource harness. One deliberate
// protocol difference from a run's stream: an assistant thread has NO terminal status — the API
// keeps the stream open indefinitely (see `use-assistant-stream.ts`'s doc comment). So "an expected
// post-terminal close is not an error" becomes, here, "an expected close WE ourselves initiated
// (switching threads / unmounting) is not an error" — tested via unmount/threadId-change instead of a
// terminal status event.

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  closed = false;
  private readonly listeners = new Map<string, Set<() => void>>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  close(): void {
    this.closed = true;
  }

  /** Real `EventSource.addEventListener` — used by `openAssistantStream`'s `onReplayComplete` (a NAMED
   *  `replay_complete` SSE event, not the default "message" type the `on`/`onmessage` path handles). */
  addEventListener(type: string, listener: () => void): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  /** Fire the WP 3.1 replay→live boundary marker (`event: replay_complete`). A no-op once closed. */
  emitReplayComplete(): void {
    if (this.closed) return;
    for (const listener of this.listeners.get("replay_complete") ?? []) listener();
  }

  /** Push one `AssistantStreamFrame` down the stream exactly as the server would (JSON in `data`).
   *  A no-op once `.close()` has been called — a real `EventSource` never delivers events after that. */
  emit(frame: AssistantStreamFrame): void {
    if (this.closed) return;
    this.onmessage?.({ data: JSON.stringify(frame) });
  }

  /** Fire the error the browser raises on a socket drop. A no-op once `.close()` has been called — a
   *  real `EventSource` never fires `onerror` after an explicit close (readyState goes straight to
   *  CLOSED); this keeps the fake faithful so the hook's ref-based active/closed guards are exercised
   *  under realistic conditions rather than an event a real browser could never deliver. */
  fail(): void {
    if (this.closed) return;
    this.onerror?.(new Event("error"));
  }

  static latest(): FakeEventSource {
    const es = FakeEventSource.instances.at(-1);
    if (!es) throw new Error("no EventSource opened");
    return es;
  }
}

const CONNECTION_LOST = "Assistant stream connection lost.";

beforeEach(() => {
  FakeEventSource.instances = [];
  (globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
});

afterEach(() => {
  (globalThis as unknown as { EventSource: unknown }).EventSource = undefined;
});

describe("useAssistantStream", () => {
  test("null threadId subscribes to nothing and stays empty", () => {
    const { result } = renderHook(() => useAssistantStream(null));
    expect(FakeEventSource.instances).toHaveLength(0);
    expect(result.current.events).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.awaitingResponse).toBe(false);
  });

  test("accumulates settled events and live deltas into a turn timeline", () => {
    const { result } = renderHook(() => useAssistantStream("thread-1"));
    const es = FakeEventSource.latest();

    act(() => {
      es.emit({ type: "user_message", text: "How many tools does the scan server have?", seq: 1 });
    });
    expect(result.current.awaitingResponse).toBe(true);

    act(() => {
      es.emit({ type: "assistant_delta", text: "Look" });
      es.emit({ type: "assistant_delta", text: "ing..." });
    });
    expect(result.current.deltaText).toBe("Looking...");
    // The trailing (streaming) turn renders the live delta text as its prose.
    const streamingTurn = result.current.timeline.at(-1);
    expect(streamingTurn?.kind).toBe("assistant_turn");
    expect(streamingTurn && "text" in streamingTurn ? streamingTurn.text : undefined).toBe(
      "Looking...",
    );

    act(() => {
      es.emit({
        type: "tool_call",
        toolUseId: "call-1",
        toolName: "scans_get",
        input: { scanId: "s1" },
        seq: 2,
      });
      es.emit({
        type: "tool_result",
        toolUseId: "call-1",
        toolName: "scans_get",
        result: { tools: 12 },
        seq: 3,
      });
      es.emit({ type: "assistant_message", text: "It has 12 tools.", seq: 4 });
      es.emit({ type: "turn_done", seq: 5 });
    });

    expect(result.current.awaitingResponse).toBe(false);
    expect(result.current.deltaText).toBe("");
    expect(result.current.timeline).toHaveLength(2);
    const [userItem, turnItem] = result.current.timeline;
    expect(userItem?.kind).toBe("user");
    expect(turnItem?.kind).toBe("assistant_turn");
    if (turnItem?.kind === "assistant_turn") {
      expect(turnItem.text).toBe("It has 12 tools.");
      expect(turnItem.toolCalls).toHaveLength(1);
      expect(turnItem.toolCalls[0]).toMatchObject({
        toolName: "scans_get",
        result: { value: { tools: 12 }, isError: false },
      });
      expect(turnItem.streaming).toBe(false);
    }
  });

  test("switching threads closes the old stream; its late error is not surfaced as a drop", () => {
    const { result, rerender } = renderHook(({ threadId }) => useAssistantStream(threadId), {
      initialProps: { threadId: "thread-1" as string | null },
    });
    const first = FakeEventSource.latest();

    act(() => {
      first.emit({ type: "user_message", text: "hi", seq: 1 });
    });

    // Switching to a different thread tears down the old subscription (mirrors closing the dock /
    // picking another thread) — the hook itself closes the old EventSource.
    rerender({ threadId: "thread-2" });
    expect(first.closed).toBe(true);

    // A late `onerror` on the now-abandoned old instance (a no-op on a real, already-closed
    // EventSource — see `FakeEventSource.fail`) must never surface on the new thread's state.
    act(() => {
      first.fail();
    });
    expect(result.current.error).toBeNull();
    expect(result.current.events).toEqual([]); // state reset for the new thread
  });

  test("a genuine pre-terminal drop surfaces the connection-lost error once, and clears on recovery", () => {
    const { result } = renderHook(() => useAssistantStream("thread-1"));
    const es = FakeEventSource.latest();

    act(() => {
      es.emit({ type: "user_message", text: "hi", seq: 1 });
      es.emit({ type: "assistant_delta", text: "partial" });
    });
    expect(result.current.error).toBeNull();

    act(() => {
      es.fail();
    });
    expect(result.current.error).toBe(CONNECTION_LOST);
    expect(es.closed).toBe(false); // a pre-terminal drop does NOT close — the browser auto-reconnects

    // A second error before recovery must not stack a different message.
    act(() => {
      es.fail();
    });
    expect(result.current.error).toBe(CONNECTION_LOST);

    // Recovery: the browser reconnects, the API replays the persisted log (deduped by seq), and the
    // sentinel clears on the first freshly-applied event.
    act(() => {
      es.emit({ type: "user_message", text: "hi", seq: 1 }); // replayed — already applied, dropped
      es.emit({ type: "turn_done", seq: 2 }); // genuinely new
    });
    expect(result.current.error).toBeNull();
    expect(result.current.events).toHaveLength(2); // user_message + turn_done, not duplicated
  });

  test("reconnect dedupe: a replayed prefix of settled events is not double-applied", () => {
    const { result } = renderHook(() => useAssistantStream("thread-1"));
    const es = FakeEventSource.latest();

    const settled: AssistantStreamFrame[] = [
      { type: "user_message", text: "hi", seq: 1 },
      { type: "assistant_message", text: "hello!", seq: 2 },
      { type: "turn_done", seq: 3 },
    ];
    act(() => {
      for (const frame of settled) es.emit(frame);
    });
    expect(result.current.events).toHaveLength(3);

    act(() => {
      es.fail();
    });
    expect(result.current.error).toBe(CONNECTION_LOST);

    act(() => {
      for (const frame of settled) es.emit(frame); // full replay from the start (same seqs)
      es.emit({ type: "user_message", text: "again", seq: 4 }); // genuinely new
    });

    expect(result.current.events).toHaveLength(4);
    expect(result.current.error).toBeNull();
  });

  // ── WP 3.1 (D-AS8/D-AS16) — the replay→live boundary for ui_action isReplay ────────────────────

  test("a ui_action replayed BEFORE the replay_complete marker is isReplay: true (inert)", () => {
    const { result } = renderHook(() => useAssistantStream("thread-1"));
    const es = FakeEventSource.latest();

    act(() => {
      es.emit({ type: "user_message", text: "open the run", seq: 1 });
      es.emit({
        type: "ui_action",
        action: "open_run_turn",
        params: { runId: "r-1", turnIndex: 0 },
        seq: 2,
      });
      es.emit({ type: "turn_done", seq: 3 });
      es.emitReplayComplete(); // the marker arrives AFTER this history, as the server guarantees
    });

    const turn = result.current.timeline[1];
    if (turn?.kind !== "assistant_turn") throw new Error("expected an assistant turn");
    expect(turn.uiActions).toHaveLength(1);
    expect(turn.uiActions[0]).toMatchObject({ action: "open_run_turn", isReplay: true });
  });

  test("a ui_action that arrives AFTER the replay_complete marker is isReplay: false (live)", () => {
    const { result } = renderHook(() => useAssistantStream("thread-1"));
    const es = FakeEventSource.latest();

    // A brand-new thread: replay is empty, the marker fires immediately (mirrors the real server).
    act(() => {
      es.emitReplayComplete();
    });
    act(() => {
      es.emit({ type: "user_message", text: "open the run", seq: 1 });
      es.emit({
        type: "ui_action",
        action: "open_run_turn",
        params: { runId: "r-1", turnIndex: 0 },
        seq: 2,
      });
      es.emit({ type: "turn_done", seq: 3 });
    });

    const turn = result.current.timeline[1];
    if (turn?.kind !== "assistant_turn") throw new Error("expected an assistant turn");
    expect(turn.uiActions[0]).toMatchObject({ action: "open_run_turn", isReplay: false });
  });

  test("before any replay_complete marker has arrived, a ui_action defaults to isReplay: true (fail-safe)", () => {
    const { result } = renderHook(() => useAssistantStream("thread-1"));
    const es = FakeEventSource.latest();

    act(() => {
      es.emit({ type: "user_message", text: "hi", seq: 1 });
      es.emit({
        type: "ui_action",
        action: "open_run_turn",
        params: { runId: "r-1", turnIndex: 0 },
        seq: 2,
      });
    });

    const turn = result.current.timeline[1];
    if (turn?.kind !== "assistant_turn") throw new Error("expected an assistant turn");
    expect(turn.uiActions[0]?.isReplay).toBe(true);
  });

  test("switching threads resets the replay→live boundary for the new subscription", () => {
    const { result, rerender } = renderHook(({ threadId }) => useAssistantStream(threadId), {
      initialProps: { threadId: "thread-1" as string | null },
    });
    const first = FakeEventSource.latest();
    act(() => {
      first.emitReplayComplete();
      first.emit({ type: "user_message", text: "hi", seq: 1 });
      first.emit({ type: "ui_action", action: "open_run_turn", params: { runId: "r-1" }, seq: 2 });
    });
    expect(
      (result.current.timeline[1] as { uiActions: Array<{ isReplay: boolean }> }).uiActions[0]
        ?.isReplay,
    ).toBe(false);

    rerender({ threadId: "thread-2" });
    const second = FakeEventSource.latest();
    // The new subscription has NOT seen its own replay_complete yet — a ui_action arriving now is
    // fail-safe replay/inert, not carried over as "live" from the old thread's boundary.
    act(() => {
      second.emit({ type: "user_message", text: "hi again", seq: 1 });
      second.emit({ type: "ui_action", action: "open_run_turn", params: { runId: "r-2" }, seq: 2 });
    });
    const turn = result.current.timeline[1];
    if (turn?.kind !== "assistant_turn") throw new Error("expected an assistant turn");
    expect(turn.uiActions[0]?.isReplay).toBe(true);
  });
});

// ── Pure reducer/timeline unit tests (no React) ───────────────────────────────────────────────────

const EMPTY_STATE: AssistantStreamState = {
  events: [],
  deltaText: "",
  awaitingResponse: false,
  error: null,
};

describe("reduceAssistantFrame", () => {
  test("a fresh user_message clears a stale error from an earlier failed turn", () => {
    const afterError = reduceAssistantFrame(EMPTY_STATE, { type: "error", message: "boom" });
    expect(afterError.error).toBe("boom");
    expect(afterError.awaitingResponse).toBe(false);

    const afterRetry = reduceAssistantFrame(afterError, {
      type: "user_message",
      text: "try again",
    });
    expect(afterRetry.error).toBeNull();
    expect(afterRetry.awaitingResponse).toBe(true);
  });

  test("assistant_delta frames append to deltaText; turn_done resets it", () => {
    let state = reduceAssistantFrame(EMPTY_STATE, { type: "user_message", text: "hi" });
    state = reduceAssistantFrame(state, { type: "assistant_delta", text: "Hel" });
    state = reduceAssistantFrame(state, { type: "assistant_delta", text: "lo" });
    expect(state.deltaText).toBe("Hello");
    state = reduceAssistantFrame(state, { type: "turn_done" });
    expect(state.deltaText).toBe("");
    expect(state.awaitingResponse).toBe(false);
  });

  test("a limit_error closes the turn and records the auth source", () => {
    let state = reduceAssistantFrame(EMPTY_STATE, { type: "user_message", text: "hi" });
    state = reduceAssistantFrame(state, {
      type: "limit_error",
      message: "Usage limit reached",
      source: "subscription",
    });
    expect(state.awaitingResponse).toBe(false);
    expect(state.error).toBe("Usage limit reached");
  });

  // WP R1.3 (D-AS22) — the three transient skill-workspace progress frames are NOT conversation state:
  // this dock ignores them (a type-safe no-op — R1.4 adds the real Files-view consumer). Mid-turn state
  // (deltaText/awaitingResponse/error/events) must come through completely untouched, not just "no crash".
  test("the three workspace_* frames are a no-op — mid-turn state passes through untouched", () => {
    let state = reduceAssistantFrame(EMPTY_STATE, { type: "user_message", text: "edit the skill" });
    state = reduceAssistantFrame(state, { type: "assistant_delta", text: "Working on it" });
    const beforeWorkspaceFrames = state;

    state = reduceAssistantFrame(state, {
      type: "workspace_opened",
      skillId: "skill-a",
      versionId: "v1",
      files: [{ path: "SKILL.md", size: 42 }],
    });
    state = reduceAssistantFrame(state, {
      type: "workspace_file_changed",
      skillId: "skill-a",
      path: "SKILL.md",
      changeKind: "modified",
    });
    state = reduceAssistantFrame(state, {
      type: "workspace_committed",
      skillId: "skill-a",
      versionId: "v2",
    });

    expect(state).toEqual(beforeWorkspaceFrames);
    expect(state.events.some((e) => (e.type as string).startsWith("workspace_"))).toBe(false);
  });
});

describe("buildAssistantTimeline", () => {
  test("groups tool_call/tool_result pairs and permission events into their turn", () => {
    const events: AssistantEvent[] = [
      { type: "user_message", text: "check server foo", seq: 1 },
      { type: "tool_call", toolUseId: "c1", toolName: "servers_list", input: {}, seq: 2 },
      {
        type: "permission_request",
        requestId: "p1",
        toolName: "skills_commit_workspace",
        input: { skillId: "s1" },
        seq: 3,
      },
      { type: "permission_decision", requestId: "p1", behavior: "deny", seq: 4 },
      {
        type: "tool_result",
        toolUseId: "c1",
        toolName: "servers_list",
        result: { servers: [] },
        seq: 5,
      },
      { type: "assistant_message", text: "Server foo is healthy.", seq: 6 },
      { type: "turn_done", seq: 7 },
    ];

    const timeline = buildAssistantTimeline(events, "", false);
    expect(timeline).toHaveLength(2);
    const turn = timeline[1];
    expect(turn?.kind).toBe("assistant_turn");
    if (turn?.kind !== "assistant_turn") throw new Error("expected an assistant turn");
    expect(turn.toolCalls).toHaveLength(1);
    expect(turn.toolCalls[0]?.result).toEqual({ value: { servers: [] }, isError: false });
    expect(turn.permissions).toHaveLength(1);
    expect(turn.permissions[0]?.decision).toEqual({ behavior: "deny" });
    expect(turn.text).toBe("Server foo is healthy.");
    expect(turn.streaming).toBe(false);
  });

  test("a second user_message opens a new turn even without a prior turn_done", () => {
    const events: AssistantEvent[] = [
      { type: "user_message", text: "first", seq: 1 },
      { type: "assistant_message", text: "reply one", seq: 2 },
      { type: "turn_done", seq: 3 },
      { type: "user_message", text: "second", seq: 4 },
      { type: "assistant_message", text: "reply two", seq: 5 },
      { type: "turn_done", seq: 6 },
    ];
    const timeline = buildAssistantTimeline(events, "", false);
    expect(timeline.map((item) => item.kind)).toEqual([
      "user",
      "assistant_turn",
      "user",
      "assistant_turn",
    ]);
  });

  // WP 3.3 — the driver's auth-vs-rate_limit kind threads through onto the turn's limitError facet.
  test("a limit_error's kind threads through onto the turn's limitError; an event with no kind omits it", () => {
    const withKind: AssistantEvent[] = [
      { type: "user_message", text: "hi", seq: 1 },
      { type: "limit_error", message: "Auth failed", source: "subscription", kind: "auth", seq: 2 },
      { type: "turn_done", seq: 3 },
    ];
    const turnWithKind = buildAssistantTimeline(withKind, "", false).at(-1);
    if (turnWithKind?.kind !== "assistant_turn") throw new Error("expected an assistant turn");
    expect(turnWithKind.limitError).toEqual({
      message: "Auth failed",
      source: "subscription",
      kind: "auth",
    });

    // A legacy-shaped event (no kind field, e.g. persisted before this WP) still replays cleanly.
    const withoutKind: AssistantEvent[] = [
      { type: "user_message", text: "hi", seq: 1 },
      { type: "limit_error", message: "Rate limited", source: "api_key", seq: 2 },
      { type: "turn_done", seq: 3 },
    ];
    const turnWithoutKind = buildAssistantTimeline(withoutKind, "", false).at(-1);
    if (turnWithoutKind?.kind !== "assistant_turn") throw new Error("expected an assistant turn");
    expect(turnWithoutKind.limitError).toEqual({ message: "Rate limited", source: "api_key" });
    expect(turnWithoutKind.limitError?.kind).toBeUndefined();
  });

  test("an in-flight (awaiting) turn renders the live delta as its trailing streaming block", () => {
    const events: AssistantEvent[] = [{ type: "user_message", text: "hi", seq: 1 }];
    const timeline = buildAssistantTimeline(events, "Thinking about it", true);
    const turn = timeline.at(-1);
    expect(turn?.kind).toBe("assistant_turn");
    if (turn?.kind !== "assistant_turn") throw new Error("expected an assistant turn");
    expect(turn.streaming).toBe(true);
    expect(turn.text).toBe("Thinking about it");
  });

  // ── WP 3.1 (D-AS8/D-AS16) — liveSinceSeq → ui_action.isReplay ────────────────────────────────

  test("a ui_action at or below liveSinceSeq is isReplay: true; above it, isReplay: false", () => {
    const events: AssistantEvent[] = [
      { type: "user_message", text: "hi", seq: 1 },
      { type: "ui_action", action: "open_run_turn", params: { runId: "r-1" }, seq: 2 },
      { type: "turn_done", seq: 3 },
      { type: "user_message", text: "again", seq: 4 },
      { type: "ui_action", action: "open_skill", params: { skillId: "s-1" }, seq: 5 },
      { type: "turn_done", seq: 6 },
    ];
    // liveSinceSeq = 3: the subscription's replay had reached seq 3 when it caught up to live.
    const timeline = buildAssistantTimeline(events, "", false, 3);
    const [, firstTurn, , secondTurn] = timeline;
    if (firstTurn?.kind !== "assistant_turn" || secondTurn?.kind !== "assistant_turn") {
      throw new Error("expected two assistant turns");
    }
    expect(firstTurn.uiActions[0]).toMatchObject({ action: "open_run_turn", isReplay: true });
    expect(secondTurn.uiActions[0]).toMatchObject({ action: "open_skill", isReplay: false });
  });

  test("liveSinceSeq defaults to null (every ui_action is isReplay: true) when the 4th arg is omitted", () => {
    const events: AssistantEvent[] = [
      { type: "user_message", text: "hi", seq: 1 },
      { type: "ui_action", action: "open_run_turn", params: { runId: "r-1" }, seq: 2 },
    ];
    const timeline = buildAssistantTimeline(events, "", false);
    const turn = timeline[1];
    if (turn?.kind !== "assistant_turn") throw new Error("expected an assistant turn");
    expect(turn.uiActions[0]?.isReplay).toBe(true);
  });
});
