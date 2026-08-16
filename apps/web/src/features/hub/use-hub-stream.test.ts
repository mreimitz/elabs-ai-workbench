import type { HubEvent, HubTaskItem } from "@mcp-token-footprint/shared";
import type { HubSseFrame } from "../../lib/api";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  buildHubTimeline,
  deriveHubTasks,
  pendingHubQueuedMessages,
  reduceHubEvent,
  reduceHubFrame,
  useHubStream,
  type HubStreamState,
} from "./use-hub-stream";

// ── FakeEventSource (mirrors `use-assistant-stream.test.ts`'s harness) ──────────────────────────────
// A hub session's stream has NO terminal status (a long-lived thread across many turns, exactly like
// an assistant thread) — "terminal" errors here means "a drop before WE closed the subscription
// ourselves" (session switch / unmount), never a server-reported finish.

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

  emit(frame: HubSseFrame & { seq?: number }): void {
    if (this.closed) return;
    this.onmessage?.({ data: JSON.stringify(frame) });
  }

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

const CONNECTION_LOST = "Assistant session stream connection lost.";

beforeEach(() => {
  FakeEventSource.instances = [];
  (globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
});

afterEach(() => {
  (globalThis as unknown as { EventSource: unknown }).EventSource = undefined;
});

const EMPTY_STATE: HubStreamState = {
  events: [],
  deltaText: {},
  deltaReasoning: {},
  liveMessageId: null,
  turnRunning: false,
  phase: null,
  queuePosition: null,
  phaseDeadlineAt: null,
  waitingReason: null,
  error: null,
  authRequired: false,
  pendingElicitation: null,
  openQuestions: [],
};

// ── Pure reducer ──────────────────────────────────────────────────────────────────────────────────

describe("reduceHubEvent", () => {
  test("user_message starts a turn and clears any stale error/liveMessageId", () => {
    const dirty: HubStreamState = { ...EMPTY_STATE, liveMessageId: "old", error: "boom" };
    const next = reduceHubEvent(dirty, {
      type: "user_message",
      messageId: "u1",
      text: "hi",
      seq: 1,
    });
    expect(next.turnRunning).toBe(true);
    expect(next.liveMessageId).toBeNull();
    expect(next.error).toBeNull();
    expect(next.events).toHaveLength(1);
  });

  test("tool_call sets the live in-flight messageId", () => {
    const next = reduceHubEvent(EMPTY_STATE, {
      type: "tool_call",
      messageId: "m1",
      part: {
        type: "tool_call",
        toolCallId: "c1",
        toolName: "tasks.create",
        source: "builtin",
        state: "input-available",
      },
      seq: 2,
    });
    expect(next.liveMessageId).toBe("m1");
  });

  test("assistant_message clears liveMessageId only when it matches the settling message", () => {
    const running: HubStreamState = { ...EMPTY_STATE, liveMessageId: "m1" };
    const settled = reduceHubEvent(running, {
      type: "assistant_message",
      messageId: "m1",
      model: "claude-sonnet-5",
      parts: [{ type: "text", text: "hi" }],
      citations: [],
      artifactsTouched: [],
      seq: 3,
    });
    expect(settled.liveMessageId).toBeNull();

    // A DIFFERENT (stale/late) messageId settling must not clobber the CURRENT live one.
    const other: HubStreamState = { ...EMPTY_STATE, liveMessageId: "m2" };
    const untouched = reduceHubEvent(other, {
      type: "assistant_message",
      messageId: "m1",
      model: "claude-sonnet-5",
      parts: [],
      citations: [],
      artifactsTouched: [],
      seq: 3,
    });
    expect(untouched.liveMessageId).toBe("m2");
  });

  test("turn_done closes the turn (turnRunning false, liveMessageId cleared)", () => {
    const running: HubStreamState = { ...EMPTY_STATE, turnRunning: true, liveMessageId: "m1" };
    const next = reduceHubEvent(running, { type: "turn_done", messageId: "m1", seq: 4 });
    expect(next.turnRunning).toBe(false);
    expect(next.liveMessageId).toBeNull();
  });

  test("error settles the turn, surfaces the message, and stickily flags authRequired", () => {
    const running: HubStreamState = { ...EMPTY_STATE, turnRunning: true, liveMessageId: "m1" };
    const next = reduceHubEvent(running, {
      type: "error",
      message: "MCP server auth expired",
      authRequired: true,
      seq: 5,
    });
    expect(next.turnRunning).toBe(false);
    expect(next.error).toBe("MCP server auth expired");
    expect(next.authRequired).toBe(true);

    // A LATER error without authRequired must not clear the sticky flag.
    const again = reduceHubEvent(next, { type: "error", message: "transient", seq: 6 });
    expect(again.authRequired).toBe(true);
  });

  test("limit_error settles the turn and surfaces the message", () => {
    const running: HubStreamState = { ...EMPTY_STATE, turnRunning: true };
    const next = reduceHubEvent(running, {
      type: "limit_error",
      message: "Rate limited",
      retrySources: ["api_key"],
      seq: 5,
    });
    expect(next.turnRunning).toBe(false);
    expect(next.error).toBe("Rate limited");
  });

  test("phase folds position/deadline/reason and clears them when the phase changes away", () => {
    const queued = reduceHubEvent(EMPTY_STATE, {
      type: "phase",
      phase: "queued",
      detail: { position: 3 },
      seq: 1,
    });
    expect(queued.phase).toBe("queued");
    expect(queued.queuePosition).toBe(3);

    const running = reduceHubEvent(queued, { type: "phase", phase: null, seq: 2 });
    expect(running.phase).toBeNull();
    expect(running.queuePosition).toBeNull();
    expect(running.phaseDeadlineAt).toBeNull();
  });
});

describe("reduceHubFrame", () => {
  test("stream_delta accumulates per-messageId text/reasoning and sets liveMessageId", () => {
    const afterText = reduceHubFrame(EMPTY_STATE, {
      type: "stream_delta",
      messageId: "m1",
      channel: "text",
      text: "Hel",
    });
    const afterMore = reduceHubFrame(afterText, {
      type: "stream_delta",
      messageId: "m1",
      channel: "text",
      text: "lo",
    });
    expect(afterMore.deltaText.m1).toBe("Hello");
    expect(afterMore.liveMessageId).toBe("m1");

    const withReasoning = reduceHubFrame(afterMore, {
      type: "stream_delta",
      messageId: "m1",
      channel: "reasoning",
      text: "thinking…",
    });
    expect(withReasoning.deltaReasoning.m1).toBe("thinking…");
  });

  test("ping is a no-op", () => {
    const next = reduceHubFrame(EMPTY_STATE, { type: "ping" });
    expect(next).toBe(EMPTY_STATE);
  });
});

// ── buildHubTimeline — the frozen-part-merge quirk this hook exists to work around ─────────────────

describe("buildHubTimeline", () => {
  test("merges a tool_result onto the settled assistant_message's tool part (never stuck at input-available)", () => {
    const events: HubEvent[] = [
      { type: "user_message", messageId: "u1", text: "list my tasks", seq: 1 },
      {
        type: "tool_call",
        messageId: "m1",
        part: {
          type: "tool_call",
          toolCallId: "c1",
          toolName: "tasks.list",
          source: "builtin",
          state: "input-available",
        },
        seq: 2,
      },
      {
        type: "tool_result",
        toolCallId: "c1",
        state: "output-available",
        modelContent: { tasks: [] },
        seq: 3,
      },
      {
        type: "assistant_message",
        messageId: "m1",
        model: "claude-sonnet-5",
        // The ENGINE'S OWN persisted shape (turn-engine.ts): the tool part here is frozen at
        // input-available — buildHubTimeline must overlay the accurate, merged state.
        parts: [
          {
            type: "tool_call",
            toolCallId: "c1",
            toolName: "tasks.list",
            source: "builtin",
            state: "input-available",
          },
          { type: "text", text: "No tasks yet." },
        ],
        citations: [],
        artifactsTouched: [],
        seq: 4,
      },
      { type: "turn_done", messageId: "m1", seq: 5 },
    ];
    const state: HubStreamState = { ...EMPTY_STATE, events };
    const timeline = buildHubTimeline(state);
    expect(timeline).toHaveLength(2);
    const turn = timeline[1];
    if (turn?.kind !== "assistant_turn") throw new Error("expected an assistant turn");
    expect(turn.streaming).toBe(false);
    const toolPart = turn.parts.find((p) => p.type === "tool_call");
    expect(toolPart && "state" in toolPart ? toolPart.state : undefined).toBe("output-available");
    const textPart = turn.parts.find((p) => p.type === "text");
    expect(textPart && "text" in textPart ? textPart.text : undefined).toBe("No tasks yet.");
  });

  test("synthesizes the live in-flight turn from streaming deltas + live tool calls", () => {
    const events: HubEvent[] = [
      { type: "user_message", messageId: "u1", text: "hi", seq: 1 },
      {
        type: "tool_call",
        messageId: "m1",
        part: {
          type: "tool_call",
          toolCallId: "c1",
          toolName: "workspace.read",
          source: "builtin",
          state: "input-available",
        },
        seq: 2,
      },
    ];
    const state: HubStreamState = {
      ...EMPTY_STATE,
      events,
      turnRunning: true,
      liveMessageId: "m1",
      deltaText: { m1: "Working on it" },
    };
    const timeline = buildHubTimeline(state);
    const turn = timeline[1];
    if (turn?.kind !== "assistant_turn") throw new Error("expected a streaming assistant turn");
    expect(turn.streaming).toBe(true);
    expect(turn.parts.some((p) => p.type === "tool_call")).toBe(true);
    const textPart = turn.parts.find((p) => p.type === "text");
    expect(textPart && "text" in textPart ? textPart.text : undefined).toBe("Working on it");
  });

  // ── hub-fixes WP1.3 (RC3.4) — the event-to-timeline mapping for a dropped granted server. The
  // inline transcript notice itself is `ConversationPane.tsx`'s to render (WP3.1 owns that file); this
  // WP's deliverable is proving the DATA it would read is correctly folded here.

  test("mcp_server_status (error) attaches to the opening turn's mcpServerIssues; a connected status is not transcript-worthy", () => {
    const events: HubEvent[] = [
      { type: "user_message", messageId: "u1", text: "hi", seq: 1 },
      {
        type: "mcp_server_status",
        serverId: "srv-qlik",
        serverName: "qlik-mreimitz",
        status: "error",
        message: "connection refused",
        seq: 2,
      },
      {
        type: "assistant_message",
        messageId: "m1",
        model: "claude-sonnet-5",
        parts: [{ type: "text", text: "I couldn't reach qlik-mreimitz this turn." }],
        citations: [],
        artifactsTouched: [],
        seq: 3,
      },
      { type: "turn_done", messageId: "m1", seq: 4 },
    ];
    const state: HubStreamState = { ...EMPTY_STATE, events };
    const timeline = buildHubTimeline(state);
    const turn = timeline[1];
    if (turn?.kind !== "assistant_turn") throw new Error("expected an assistant turn");
    expect(turn.mcpServerIssues).toEqual([
      { serverId: "srv-qlik", serverName: "qlik-mreimitz", message: "connection refused" },
    ]);
  });

  test("mcp_server_status carries authRequired through to mcpServerIssues (auth-failure → Authenticate action)", () => {
    const events: HubEvent[] = [
      { type: "user_message", messageId: "u1", text: "hi", seq: 1 },
      {
        type: "mcp_server_status",
        serverId: "srv-qlik",
        serverName: "qlik-stage",
        status: "error",
        message: "Unauthorized",
        authRequired: true,
        seq: 2,
      },
      {
        type: "assistant_message",
        messageId: "m1",
        model: "claude-sonnet-5",
        parts: [{ type: "text", text: "reply" }],
        citations: [],
        artifactsTouched: [],
        seq: 3,
      },
      { type: "turn_done", messageId: "m1", seq: 4 },
    ];
    const timeline = buildHubTimeline({ ...EMPTY_STATE, events });
    const turn = timeline[1];
    if (turn?.kind !== "assistant_turn") throw new Error("expected an assistant turn");
    expect(turn.mcpServerIssues).toEqual([
      { serverId: "srv-qlik", serverName: "qlik-stage", message: "Unauthorized", authRequired: true },
    ]);
  });

  test("mcp_server_status (connected) never populates mcpServerIssues — the rail chip covers it, not the transcript", () => {
    const events: HubEvent[] = [
      { type: "user_message", messageId: "u1", text: "hi", seq: 1 },
      {
        type: "mcp_server_status",
        serverId: "srv-qlik",
        serverName: "qlik-mreimitz",
        status: "connected",
        seq: 2,
      },
      { type: "turn_done", messageId: "u1", seq: 3 },
    ];
    const state: HubStreamState = { ...EMPTY_STATE, events };
    const timeline = buildHubTimeline(state);
    const turn = timeline[1];
    if (turn?.kind !== "assistant_turn") throw new Error("expected an assistant turn");
    expect(turn.mcpServerIssues).toBeUndefined();
  });

  test("mcp_server_status (error) for the SAME serverId within one turn is deduped in the timeline too", () => {
    const events: HubEvent[] = [
      { type: "user_message", messageId: "u1", text: "hi", seq: 1 },
      {
        type: "mcp_server_status",
        serverId: "srv-qlik",
        serverName: "qlik-mreimitz",
        status: "error",
        message: "first",
        seq: 2,
      },
      {
        type: "mcp_server_status",
        serverId: "srv-qlik",
        serverName: "qlik-mreimitz",
        status: "error",
        message: "second",
        seq: 3,
      },
      { type: "turn_done", messageId: "u1", seq: 4 },
    ];
    const state: HubStreamState = { ...EMPTY_STATE, events };
    const timeline = buildHubTimeline(state);
    const turn = timeline[1];
    if (turn?.kind !== "assistant_turn") throw new Error("expected an assistant turn");
    expect(turn.mcpServerIssues).toHaveLength(1);
    expect(turn.mcpServerIssues?.[0]?.message).toBe("first");
  });

  test("mcp_server_status (error) for TWO different servers both land, in order", () => {
    const events: HubEvent[] = [
      { type: "user_message", messageId: "u1", text: "hi", seq: 1 },
      {
        type: "mcp_server_status",
        serverId: "srv-a",
        serverName: "Server A",
        status: "error",
        message: "down",
        seq: 2,
      },
      {
        type: "mcp_server_status",
        serverId: "srv-b",
        serverName: "Server B",
        status: "error",
        message: "auth expired",
        seq: 3,
      },
      { type: "turn_done", messageId: "u1", seq: 4 },
    ];
    const state: HubStreamState = { ...EMPTY_STATE, events };
    const timeline = buildHubTimeline(state);
    const turn = timeline[1];
    if (turn?.kind !== "assistant_turn") throw new Error("expected an assistant turn");
    expect(turn.mcpServerIssues).toEqual([
      { serverId: "srv-a", serverName: "Server A", message: "down" },
      { serverId: "srv-b", serverName: "Server B", message: "auth expired" },
    ]);
  });
});

// ── deriveHubTasks (R-SES4) ──────────────────────────────────────────────────────────────────────

describe("deriveHubTasks", () => {
  test("reconciles tasks.create/tasks.update pairs by id, in order, ignoring non-output-available results", () => {
    const item1: HubTaskItem = { id: "t1", title: "Scan server A", status: "pending" };
    const item1Updated: HubTaskItem = { ...item1, status: "completed" };
    const item2: HubTaskItem = { id: "t2", title: "Scan server B", status: "in_progress" };
    const events: HubEvent[] = [
      {
        type: "tool_call",
        part: {
          type: "tool_call",
          toolCallId: "c1",
          toolName: "tasks.create",
          source: "builtin",
          state: "input-available",
        },
        seq: 1,
      },
      {
        type: "tool_result",
        toolCallId: "c1",
        state: "output-available",
        modelContent: item1,
        seq: 2,
      },
      {
        type: "tool_call",
        part: {
          type: "tool_call",
          toolCallId: "c2",
          toolName: "tasks.create",
          source: "builtin",
          state: "input-available",
        },
        seq: 3,
      },
      {
        type: "tool_result",
        toolCallId: "c2",
        state: "output-available",
        modelContent: item2,
        seq: 4,
      },
      {
        type: "tool_call",
        part: {
          type: "tool_call",
          toolCallId: "c3",
          toolName: "tasks.update",
          source: "builtin",
          state: "input-available",
        },
        seq: 5,
      },
      {
        type: "tool_result",
        toolCallId: "c3",
        state: "output-available",
        modelContent: item1Updated,
        seq: 6,
      },
      // A DENIED/errored tools.update result must never mutate the list.
      {
        type: "tool_call",
        part: {
          type: "tool_call",
          toolCallId: "c4",
          toolName: "tasks.update",
          source: "builtin",
          state: "input-available",
        },
        seq: 7,
      },
      { type: "tool_result", toolCallId: "c4", state: "output-denied", seq: 8 },
    ];
    const tasks = deriveHubTasks(events);
    expect(tasks.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(tasks[0]?.status).toBe("completed"); // t1 was updated
    expect(tasks[1]?.status).toBe("in_progress");
  });
});

// ── pendingHubQueuedMessages (R-SES3) ────────────────────────────────────────────────────────────

describe("pendingHubQueuedMessages", () => {
  test("a queued message with no matching injected user_message is still pending", () => {
    const events: HubEvent[] = [
      { type: "user_message", messageId: "u1", text: "first", seq: 1 },
      { type: "queued_user_message", queuedMessageId: "q1", text: "second", seq: 2 },
    ];
    const pending = pendingHubQueuedMessages(events);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ queuedMessageId: "q1", text: "second" });
  });

  test("a queued message becomes NOT pending once injected as a user_message with the same id", () => {
    const events: HubEvent[] = [
      { type: "user_message", messageId: "u1", text: "first", seq: 1 },
      { type: "queued_user_message", queuedMessageId: "q1", text: "second", seq: 2 },
      { type: "user_message", messageId: "q1", text: "second", seq: 3 },
    ];
    expect(pendingHubQueuedMessages(events)).toHaveLength(0);
  });
});

// ── useHubStream — replay-then-live, seq-dedup, terminal-ONLY error ────────────────────────────────

describe("useHubStream", () => {
  test("null sessionId subscribes to nothing and stays empty", () => {
    const { result } = renderHook(() => useHubStream(null));
    expect(FakeEventSource.instances).toHaveLength(0);
    expect(result.current.events).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  test("replay-then-live: settled events accumulate; a duplicated seq (reconnect replay) is dropped", () => {
    const { result } = renderHook(() => useHubStream("s1"));
    const es = FakeEventSource.latest();
    expect(es.url).toBe("/api/hub/sessions/s1/stream");

    act(() => {
      es.emit({ type: "user_message", messageId: "u1", text: "hi", seq: 1 });
      es.emit({ type: "turn_done", messageId: "u1", seq: 2 });
    });
    expect(result.current.events).toHaveLength(2);

    // A reconnect replaying an already-applied seq must not duplicate it.
    act(() => {
      es.emit({ type: "user_message", messageId: "u1", text: "hi", seq: 1 });
    });
    expect(result.current.events).toHaveLength(2);

    // A genuinely new event still applies.
    act(() => {
      es.emit({ type: "user_message", messageId: "u2", text: "again", seq: 3 });
    });
    expect(result.current.events).toHaveLength(3);
  });

  test("a genuine pre-close drop surfaces the connection-lost error once, and clears on recovery", () => {
    const { result } = renderHook(() => useHubStream("s1"));
    const es = FakeEventSource.latest();

    act(() => {
      es.emit({ type: "user_message", messageId: "u1", text: "hi", seq: 1 });
    });
    expect(result.current.error).toBeNull();

    act(() => {
      es.fail();
    });
    expect(result.current.error).toBe(CONNECTION_LOST);
    expect(es.closed).toBe(false); // pre-close drop — the browser auto-reconnects, we don't close

    act(() => {
      es.emit({ type: "turn_done", messageId: "u1", seq: 2 });
    });
    expect(result.current.error).toBeNull();
  });

  test("switching sessions closes the old stream; its late error never surfaces on the new session", () => {
    const { result, rerender } = renderHook(({ sessionId }) => useHubStream(sessionId), {
      initialProps: { sessionId: "s1" as string | null },
    });
    const first = FakeEventSource.latest();

    act(() => {
      first.emit({ type: "user_message", messageId: "u1", text: "hi", seq: 1 });
    });

    rerender({ sessionId: "s2" });
    expect(first.closed).toBe(true);

    act(() => {
      first.fail(); // a no-op on a real closed EventSource — must not leak into the new session's state
    });
    expect(result.current.error).toBeNull();
    expect(result.current.events).toEqual([]);
  });
});

// ── WP2.3 — live HITL reducer/timeline (approvals + elicitation) ──────────────────────────────────

describe("WP2.3 live HITL", () => {
  test("approval_requested/responded move the tool part through the R-UX1 states", () => {
    const events: HubEvent[] = [
      { type: "user_message", messageId: "u1", text: "delete it", seq: 0 },
      {
        type: "tool_call",
        messageId: "m1",
        part: {
          type: "tool_call",
          toolCallId: "tc-1",
          toolName: "mcp__srv__delete",
          source: "mcp",
          serverId: "srv",
          state: "input-available",
        },
        seq: 1,
      },
      {
        type: "approval_requested",
        toolCallId: "tc-1",
        toolName: "mcp__srv__delete",
        source: "mcp",
        serverId: "srv",
        annotations: { destructiveHint: true },
        options: ["allow-once"],
        seq: 2,
      },
    ];
    let state = EMPTY_STATE;
    for (const e of events) state = reduceHubEvent(state, e);
    // While the turn is live, the tool part shows the approval-requested state.
    state = { ...state, turnRunning: true, liveMessageId: "m1" };
    let timeline = buildHubTimeline(state);
    let turn = timeline.find((i) => i.kind === "assistant_turn");
    let toolPart =
      turn?.kind === "assistant_turn" ? turn.toolCalls.find((t) => t.part.toolCallId === "tc-1") : undefined;
    expect(toolPart?.part.state).toBe("approval-requested");
    expect(toolPart?.part.approval?.options).toEqual(["allow-once"]);
    expect(toolPart?.part.annotations?.destructiveHint).toBe(true);

    // Respond → approval-responded with the resolution.
    state = reduceHubEvent(state, {
      type: "approval_responded",
      toolCallId: "tc-1",
      resolution: "allow-once",
      seq: 3,
    });
    timeline = buildHubTimeline(state);
    turn = timeline.find((i) => i.kind === "assistant_turn");
    toolPart =
      turn?.kind === "assistant_turn" ? turn.toolCalls.find((t) => t.part.toolCallId === "tc-1") : undefined;
    expect(toolPart?.part.state).toBe("approval-responded");
    expect(toolPart?.part.approval?.resolution).toBe("allow-once");
  });

  test("elicitation_requested sets a pending elicitation; the matching response clears it", () => {
    let state = reduceHubEvent(EMPTY_STATE, {
      type: "elicitation_requested",
      elicitationId: "el-1",
      message: "Which branch?",
      mode: "form",
      requestedSchema: { type: "object", properties: { branch: { type: "string" } } },
      seq: 0,
    });
    expect(state.pendingElicitation?.elicitationId).toBe("el-1");
    expect(state.pendingElicitation?.mode).toBe("form");
    expect(state.pendingElicitation?.message).toBe("Which branch?");

    // A response for a DIFFERENT id leaves it pending.
    state = reduceHubEvent(state, { type: "elicitation_responded", elicitationId: "other", action: "accept", seq: 1 });
    expect(state.pendingElicitation?.elicitationId).toBe("el-1");

    // The matching response clears it.
    state = reduceHubEvent(state, { type: "elicitation_responded", elicitationId: "el-1", action: "accept", seq: 2 });
    expect(state.pendingElicitation).toBeNull();
  });

  test("a URL-mode elicitation surfaces its url", () => {
    const state = reduceHubEvent(EMPTY_STATE, {
      type: "elicitation_requested",
      elicitationId: "el-2",
      message: "Sign in",
      mode: "url",
      url: "https://auth.example/authorize",
      seq: 0,
    });
    expect(state.pendingElicitation?.mode).toBe("url");
    expect(state.pendingElicitation?.url).toBe("https://auth.example/authorize");
  });

  test("a `question` adds an open question; `question_resolved` removes it (recoverable on replay)", () => {
    let state = reduceHubEvent(EMPTY_STATE, {
      type: "question",
      questionId: "q-1",
      prompt: "Which environment?",
      options: [{ label: "staging" }, { label: "prod" }],
      allowOther: true,
      seq: 0,
    });
    expect(state.openQuestions).toHaveLength(1);
    expect(state.openQuestions[0]?.questionId).toBe("q-1");
    expect(state.openQuestions[0]?.options?.map((o) => o.label)).toEqual(["staging", "prod"]);

    // A re-emit of the same id (replay) is idempotent, not a duplicate card.
    state = reduceHubEvent(state, {
      type: "question",
      questionId: "q-1",
      prompt: "Which environment?",
      seq: 1,
    });
    expect(state.openQuestions).toHaveLength(1);

    // Resolving it (answered OR stopped) clears the card.
    state = reduceHubEvent(state, { type: "question_resolved", questionId: "q-1", answer: "staging", seq: 2 });
    expect(state.openQuestions).toHaveLength(0);
  });
});
