// hub-fixes WP4.3 (RC6.4) — the slim read-only child-session transcript. Driven by a FAKE EventSource
// (the `use-hub-stream.test.ts` harness) so the streaming path, the tool-call card, the terminal-only
// error slot, and — critically — the unsubscribe-on-unmount (no polling loop left behind) are all
// proven with stubs, no real network. `@brand/ai` is the shared hub stub (jsdom never loads shiki/
// streamdown); `@brand/ui` stays real.

import type { HubSseFrame } from "../../lib/api";
import { render, screen, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@brand/ai", () => import("./test-support/brand-ai-mock"));

import { AgentTranscript } from "./AgentTranscript";

// ── FakeEventSource (mirrors use-hub-stream.test.ts / use-assistant-stream.test.ts) ─────────────────
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

beforeEach(() => {
  FakeEventSource.instances = [];
  (globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
});
afterEach(() => {
  (globalThis as unknown as { EventSource: unknown }).EventSource = undefined;
});

describe("AgentTranscript", () => {
  test("opens the child session's stream and shows a loading placeholder before any frame", () => {
    render(<AgentTranscript sessionId="child-1" />);
    const es = FakeEventSource.latest();
    expect(es.url).toBe("/api/hub/sessions/child-1/stream");
    // Loading = "no content yet" (loading-states.md) — a skeleton, not a broken empty box.
    expect(screen.getByTestId("agent-transcript-loading")).toBeInTheDocument();
  });

  test("renders a streaming transcript INCLUDING a tool-call card, then the settled result", () => {
    render(<AgentTranscript sessionId="child-1" ariaLabel="Live session — Researcher" />);
    const es = FakeEventSource.latest();

    // The brief + a live tool call + streaming answer text arrive.
    act(() => {
      es.emit({ type: "user_message", messageId: "u1", text: "Research Q3 revenue", seq: 1 });
      es.emit({
        type: "tool_call",
        messageId: "m1",
        part: {
          type: "tool_call",
          toolCallId: "c1",
          toolName: "mcp__qlik__search",
          source: "mcp",
          serverId: "qlik",
          state: "input-available",
          args: { q: "revenue" },
        },
        seq: 2,
      });
      es.emit({ type: "stream_delta", messageId: "m1", channel: "text", text: "Looking it up" });
    });

    // The panel is labelled for SR, the brief shows, and a tool-call card renders mid-stream.
    expect(screen.getByRole("log", { name: "Live session — Researcher" })).toBeInTheDocument();
    expect(screen.getByText("Research Q3 revenue")).toBeInTheDocument();
    const toolHeader = screen.getByTestId("tool-header");
    expect(toolHeader.dataset.toolName).toBe("mcp__qlik__search");
    expect(toolHeader.dataset.state).toBe("input-available");
    expect(screen.getByText("Looking it up")).toBeInTheDocument();

    // The tool settles and the turn finishes → the card reflects output-available, answer renders.
    act(() => {
      es.emit({
        type: "tool_result",
        toolCallId: "c1",
        state: "output-available",
        modelContent: { rows: 3 },
        seq: 3,
      });
      es.emit({
        type: "assistant_message",
        messageId: "m1",
        model: "claude-sonnet-5",
        parts: [
          {
            type: "tool_call",
            toolCallId: "c1",
            toolName: "mcp__qlik__search",
            source: "mcp",
            serverId: "qlik",
            state: "input-available",
          },
          { type: "text", text: "Q3 revenue was up." },
        ],
        citations: [],
        artifactsTouched: [],
        seq: 4,
      });
      es.emit({ type: "turn_done", messageId: "m1", seq: 5 });
    });

    expect(screen.getByTestId("tool-header").dataset.state).toBe("output-available");
    expect(screen.getByText("Q3 revenue was up.")).toBeInTheDocument();
  });

  test("surfaces an approval-waiting marker for an approval-gated tool call (read-only — no buttons)", () => {
    render(<AgentTranscript sessionId="child-1" />);
    const es = FakeEventSource.latest();
    act(() => {
      es.emit({ type: "user_message", messageId: "u1", text: "delete it", seq: 1 });
      es.emit({
        type: "tool_call",
        messageId: "m1",
        part: {
          type: "tool_call",
          toolCallId: "c1",
          toolName: "mcp__srv__delete",
          source: "mcp",
          serverId: "srv",
          state: "input-available",
        },
        seq: 2,
      });
      es.emit({
        type: "approval_requested",
        toolCallId: "c1",
        toolName: "mcp__srv__delete",
        source: "mcp",
        serverId: "srv",
        options: ["allow-once"],
        seq: 3,
      });
    });
    expect(screen.getByTestId("agent-transcript-approval-waiting")).toBeInTheDocument();
    // Read-only: no approve/deny controls in the transcript itself.
    expect(screen.queryByRole("button", { name: /approve/i })).toBeNull();
  });

  test("unsubscribes on unmount — no polling loop left behind (leak assertion)", () => {
    const { unmount } = render(<AgentTranscript sessionId="child-1" />);
    const es = FakeEventSource.latest();
    expect(es.closed).toBe(false);
    unmount();
    expect(es.closed).toBe(true);
  });

  test("switching the streamed session closes the old stream", () => {
    const { rerender } = render(<AgentTranscript sessionId="child-1" />);
    const first = FakeEventSource.latest();
    rerender(<AgentTranscript sessionId="child-2" />);
    expect(first.closed).toBe(true);
    expect(FakeEventSource.latest().url).toBe("/api/hub/sessions/child-2/stream");
  });

  test("a pre-close transport drop surfaces the terminal-only error slot", () => {
    render(<AgentTranscript sessionId="child-1" />);
    const es = FakeEventSource.latest();
    act(() => {
      es.emit({ type: "user_message", messageId: "u1", text: "hi", seq: 1 });
    });
    expect(screen.queryByTestId("agent-transcript-error")).toBeNull();
    act(() => {
      es.fail();
    });
    expect(screen.getByTestId("agent-transcript-error")).toBeInTheDocument();
  });
});
