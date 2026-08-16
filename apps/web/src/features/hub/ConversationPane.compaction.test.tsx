// Assistant Hub (roadmap/assistant-hub/, WP3.3, R-SES8) — the in-transcript compaction marker. Proves
// the marker renders at the compaction boundary, is COLLAPSED by default, EXPANDS to reveal the exact
// summary the model now carries (incl. the preserved user constraint), and surfaces the honest window
// saving + what was cleared / re-attached / aimed at.

import type { HubEvent, HubSession } from "@mcp-token-footprint/shared";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

vi.mock("@brand/ai", () => import("./test-support/brand-ai-mock"));

import { ConversationPane, reconstructCompactionMarkers } from "./ConversationPane";
import type { ConversationStream } from "./ConversationPane";
import type { HubTimelineItem } from "./use-hub-stream";

function session(overrides: Partial<HubSession> = {}): HubSession {
  return {
    id: "s1",
    kind: "chat",
    title: "Untitled session",
    titleState: "pending",
    mode: "chat",
    model: "claude-sonnet-5",
    status: "running",
    costUsd: 0,
    tokensIn: 0,
    tokensOut: 0,
    createdAt: "2026-07-17T12:00:00.000Z",
    updatedAt: "2026-07-17T12:00:00.000Z",
    seen: true,
    ...overrides,
  };
}

const CONSTRAINT = "IMPORTANT: always respond in French.";

function compactionEvent(overrides: Partial<Extract<HubEvent, { type: "compaction" }>> = {}): HubEvent {
  return {
    type: "compaction",
    seq: 3,
    summaryId: "sum-1",
    uptoSeq: 2,
    summary: `## Summary of earlier assistant activity\ndid work\n\n## User messages & constraints (preserved verbatim — still binding)\n1. ${CONSTRAINT}`,
    summaryTokens: 40,
    clearedToolOutputs: 2,
    clearedToolOutputTokens: 900,
    windowBefore: 120000,
    windowAfter: 30000,
    reattachedSkillIds: ["skill-a"],
    userAim: "keep the pricing rules",
    ...overrides,
  } as HubEvent;
}

/** A session log with an early turn (u1/a1), a compaction at that boundary, then a later turn (u2). */
function eventsWithCompaction(): HubEvent[] {
  return [
    { type: "user_message", seq: 1, messageId: "u1", text: `${CONSTRAINT} …a long question` },
    {
      type: "assistant_message",
      seq: 2,
      messageId: "a1",
      model: "claude-sonnet-5",
      parts: [{ type: "text", text: "an earlier reply" }],
      citations: [],
      artifactsTouched: [],
    },
    compactionEvent(),
    { type: "user_message", seq: 4, messageId: "u2", text: "the newest question" },
  ];
}

const timeline: HubTimelineItem[] = [
  { kind: "user", id: "u1", text: `${CONSTRAINT} …a long question` },
  {
    kind: "assistant_turn",
    id: "a1",
    messageId: "a1",
    model: "claude-sonnet-5",
    parts: [{ type: "text", text: "an earlier reply" }],
    toolCalls: [],
    citations: [],
    streaming: false,
  },
  { kind: "user", id: "u2", text: "the newest question" },
];

function streamOf(): ConversationStream {
  return {
    events: eventsWithCompaction(),
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
    timeline,
    tasks: [],
    pendingQueued: [],
  };
}

describe("reconstructCompactionMarkers", () => {
  test("anchors a compaction to the last message at or before its boundary", () => {
    const markers = reconstructCompactionMarkers(eventsWithCompaction());
    expect(markers).toHaveLength(1);
    expect(markers[0]!.anchorId).toBe("a1");
    expect(markers[0]!.event.uptoSeq).toBe(2);
  });

  test("a compaction whose boundary predates every visible message anchors to the top (null)", () => {
    const markers = reconstructCompactionMarkers([compactionEvent({ uptoSeq: 0 })]);
    expect(markers).toHaveLength(1);
    expect(markers[0]!.anchorId).toBeNull();
  });
});

describe("ConversationPane — compaction marker (R-SES8)", () => {
  test("renders the marker with the honest saving + cleared/re-attached badges, collapsed by default", () => {
    render(<ConversationPane stream={streamOf()} session={session()} onStarterSelect={vi.fn()} />);

    const marker = screen.getByTestId("compaction-marker");
    expect(marker).toBeInTheDocument();
    expect(marker).toHaveTextContent(/Earlier turns compacted/i);
    // windowBefore 120000 − windowAfter 30000 = 90,000 freed.
    expect(marker).toHaveTextContent(/freed ~90,000 tokens/);
    expect(marker).toHaveTextContent(/2 tool outputs cleared/);
    expect(marker).toHaveTextContent(/1 skill re-attached/);
    expect(marker).toHaveTextContent(/keep the pricing rules/);

    // Collapsed by default — the summary body is not shown yet.
    expect(screen.queryByTestId("compaction-summary")).not.toBeInTheDocument();
  });

  test("expanding reveals the summary — with the preserved user constraint verbatim", () => {
    render(<ConversationPane stream={streamOf()} session={session()} onStarterSelect={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /show summary/i }));
    const summary = screen.getByTestId("compaction-summary");
    expect(summary).toBeInTheDocument();
    expect(summary).toHaveTextContent(CONSTRAINT);
    expect(summary).toHaveTextContent(/preserved verbatim/i);

    // Collapsing hides it again.
    fireEvent.click(screen.getByRole("button", { name: /hide summary/i }));
    expect(screen.queryByTestId("compaction-summary")).not.toBeInTheDocument();
  });

  test("the full transcript still renders every turn (compaction hides nothing from the human)", () => {
    render(<ConversationPane stream={streamOf()} session={session()} onStarterSelect={vi.fn()} />);
    expect(screen.getByText(/the newest question/)).toBeInTheDocument();
    expect(screen.getByText(/an earlier reply/)).toBeInTheDocument();
  });
});
