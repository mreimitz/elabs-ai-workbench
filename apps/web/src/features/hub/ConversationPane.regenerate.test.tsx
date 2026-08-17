// Assistant Hub (WP2.5, R-SES6) — regenerate + `MessageBranch*` sibling switching. A separate file from
// `ConversationPane.test.tsx`/`.mcp.test.tsx` (mirrors that split) so this feature's `lib/api` mocking
// (branch/send/stream) doesn't leak into the other suites' module graph.
import type { HubEvent, HubSession } from "@mcp-token-footprint/shared";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@elabs-ai/components-ai", () => import("./test-support/brand-ai-mock"));

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    branchHubSession: vi.fn(),
    sendHubMessage: vi.fn(),
    openHubSessionStream: vi.fn(() => () => undefined),
  };
});

import * as api from "../../lib/api";
import { ConversationPane, reconstructVariantGroups } from "./ConversationPane";
import type { ConversationStream } from "./ConversationPane";
import { buildHubTimeline, type HubStreamState } from "./use-hub-stream";

function session(overrides: Partial<HubSession> = {}): HubSession {
  return {
    id: "s1",
    kind: "chat",
    title: "Untitled session",
    titleState: "pending",
    mode: "chat",
    model: "claude-sonnet-5",
    status: "completed",
    costUsd: 0,
    tokensIn: 0,
    tokensOut: 0,
    createdAt: "2026-07-17T12:00:00.000Z",
    updatedAt: "2026-07-17T12:00:00.000Z",
    seen: true,
    ...overrides,
  };
}

/** One settled user turn + its settled reply, seq 1/2/3 — the exact shape `handleRegenerate` reads
 *  (`turnKeys` + the `user_message` event's own `seq`). */
function baseState(events: HubEvent[]): HubStreamState {
  return {
    events,
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
}

function streamFromEvents(events: HubEvent[], overrides: Partial<ConversationStream> = {}): ConversationStream {
  const state = baseState(events);
  return {
    ...state,
    timeline: buildHubTimeline(state),
    tasks: [],
    pendingQueued: [],
    ...overrides,
  };
}

const ONE_TURN_EVENTS: HubEvent[] = [
  { type: "user_message", messageId: "u1", text: "What's 2+2?", seq: 1 },
  {
    type: "assistant_message",
    messageId: "m1",
    model: "claude-sonnet-5",
    parts: [{ type: "text", text: "4" }],
    citations: [],
    artifactsTouched: [],
    seq: 2,
  },
  { type: "turn_done", messageId: "m1", seq: 3 },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ConversationPane — regenerate (WP2.5, R-SES6)", () => {
  test("no session prop -> no Regenerate action (the honest not-yet-actionable gate)", () => {
    render(
      <ConversationPane stream={streamFromEvents(ONE_TURN_EVENTS)} onStarterSelect={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: /regenerate/i })).not.toBeInTheDocument();
  });

  test("a turn RUNNING has no Regenerate action; a settled last turn does, once a session is open", () => {
    render(
      <ConversationPane
        stream={streamFromEvents(ONE_TURN_EVENTS)}
        session={session()}
        onStarterSelect={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /regenerate/i })).toBeInTheDocument();
  });

  test("while the session's turn is running, Regenerate is withheld", () => {
    render(
      <ConversationPane
        stream={streamFromEvents(ONE_TURN_EVENTS, { turnRunning: true })}
        session={session()}
        onStarterSelect={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /regenerate/i })).not.toBeInTheDocument();
  });

  test("clicking Regenerate branches at (userSeq - 1) and resends the SAME user text to the new session", async () => {
    vi.mocked(api.branchHubSession).mockResolvedValue(session({ id: "branch-1", title: "s (branch)" }));
    vi.mocked(api.sendHubMessage).mockResolvedValue({
      sessionId: "branch-1",
      streamUrl: "/api/hub/sessions/branch-1/stream",
    });

    render(
      <ConversationPane
        stream={streamFromEvents(ONE_TURN_EVENTS)}
        session={session()}
        onStarterSelect={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /regenerate/i }));

    await waitFor(() =>
      expect(api.branchHubSession).toHaveBeenCalledWith("s1", { atSeq: 0, label: "Regenerate" }),
    );
    expect(api.sendHubMessage).toHaveBeenCalledWith("branch-1", { text: "What's 2+2?" });
  });

  test("after a successful regenerate lands its `branch_created` event, the new reply renders as a switchable sibling variant (MessageBranch*)", async () => {
    vi.mocked(api.branchHubSession).mockResolvedValue(session({ id: "branch-1" }));
    vi.mocked(api.sendHubMessage).mockResolvedValue({
      sessionId: "branch-1",
      streamUrl: "/api/hub/sessions/branch-1/stream",
    });
    vi.mocked(api.openHubSessionStream).mockImplementation((sessionId, onFrame) => {
      if (sessionId === "branch-1") {
        onFrame({
          type: "assistant_message",
          messageId: "m2",
          model: "claude-sonnet-5",
          parts: [{ type: "text", text: "Also 4, but let me show my work" }],
          citations: [],
          artifactsTouched: [],
          seq: 1,
        });
        onFrame({ type: "turn_done", messageId: "m2", seq: 2 });
      }
      return () => undefined;
    });

    const { rerender } = render(
      <ConversationPane
        stream={streamFromEvents(ONE_TURN_EVENTS)}
        session={session()}
        onStarterSelect={vi.fn()}
      />,
    );

    // Before regenerating: only the original reply is on screen, no selector (single variant).
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.queryByTestId("message-branch-selector")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /regenerate/i }));
    await waitFor(() => expect(api.sendHubMessage).toHaveBeenCalled());

    // R-SES1 fix: `variantGroups` is derived from `stream.events`, not written locally by the click
    // handler — in production the source session's OWN `branch_created` event streams back over the
    // SAME SSE connection `AssistantView`'s `useHubStream` already subscribes to. This test's `stream`
    // prop is hand-built (not routed through the real hook), so that live round trip is simulated by
    // re-rendering with the event appended — exactly the state a page reload would also replay from.
    rerender(
      <ConversationPane
        stream={streamFromEvents([
          ...ONE_TURN_EVENTS,
          {
            type: "branch_created",
            branchSessionId: "branch-1",
            fromSessionId: "s1",
            fromSeq: 0,
            label: "Regenerate",
            seq: 4,
          },
        ])}
        session={session()}
        onStarterSelect={vi.fn()}
      />,
    );

    // MessageBranch's mock `defaultBranch` jumps straight to the newest sibling (index 1) — the
    // original "4" is hidden, the fresh regenerated reply is what's on screen, with a 2-of-2 selector.
    await waitFor(() =>
      expect(screen.getByText("Also 4, but let me show my work")).toBeInTheDocument(),
    );
    await waitFor(() => expect(screen.getByTestId("message-branch-selector")).toBeInTheDocument());
    expect(screen.getByTestId("message-branch-page")).toHaveTextContent("2 of 2");

    // Paging back to variant 1 (Previous) shows the ORIGINAL session's own turn again.
    fireEvent.click(screen.getByRole("button", { name: /previous branch/i }));
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.queryByText("Also 4, but let me show my work")).not.toBeInTheDocument();
  });

  test("REPLAY (R-SES1, Wave-2 adversarial-review finding a): a persisted `branch_created` event alone — no live regenerate, no click — reconstructs the sibling variant switcher on render", () => {
    // Mirrors `ConversationPane.wp2r-variant-replay.test.tsx`'s Wave-2 review probe (a source session's
    // log AFTER a regenerate happened and the page was reloaded), which asserted these test ids were
    // ABSENT before this fix — `variantGroups` was live-only React state, never folded from the log.
    const EVENTS_WITH_PERSISTED_BRANCH: HubEvent[] = [
      ...ONE_TURN_EVENTS,
      {
        type: "branch_created",
        branchSessionId: "branch-1",
        fromSessionId: "s1",
        fromSeq: 0,
        label: "Regenerate",
        seq: 4,
      },
    ];

    render(
      <ConversationPane
        stream={streamFromEvents(EVENTS_WITH_PERSISTED_BRANCH)}
        session={session()}
        onStarterSelect={vi.fn()}
      />,
    );

    expect(screen.getByTestId("message-branch-selector")).toBeInTheDocument();
    expect(screen.getByTestId("message-branch-page")).toHaveTextContent("2 of 2");

    // Paging back to variant 1 surfaces the ORIGINAL session's own settled turn — real lineage, not a
    // synthetic placeholder.
    fireEvent.click(screen.getByRole("button", { name: /previous branch/i }));
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  test("a `branch_created` event with no matching turn (no cutoff, or an unknown fromSeq) is not guessed at", () => {
    const events: HubEvent[] = [
      ...ONE_TURN_EVENTS,
      // No `fromSeq` — a plain fork with no cutoff, not a regenerate of a known turn.
      { type: "branch_created", branchSessionId: "branch-2", fromSessionId: "s1", seq: 4 },
    ];
    render(
      <ConversationPane
        stream={streamFromEvents(events)}
        session={session()}
        onStarterSelect={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("message-branch-selector")).not.toBeInTheDocument();
  });

  test("a failed regenerate surfaces a toast and never appends a bogus sibling", async () => {
    vi.mocked(api.branchHubSession).mockRejectedValue(new Error("boom"));

    render(
      <ConversationPane
        stream={streamFromEvents(ONE_TURN_EVENTS)}
        session={session()}
        onStarterSelect={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /regenerate/i }));

    await waitFor(() => expect(api.branchHubSession).toHaveBeenCalled());
    expect(api.sendHubMessage).not.toHaveBeenCalled();
    // No selector ever appears — the failure left the turn exactly as it was.
    expect(screen.queryByTestId("message-branch-selector")).not.toBeInTheDocument();
  });

  test("regenerate is only offered on the LAST assistant turn, not an earlier settled one", () => {
    const twoTurnEvents: HubEvent[] = [
      ...ONE_TURN_EVENTS,
      { type: "user_message", messageId: "u2", text: "And 3+3?", seq: 4 },
      {
        type: "assistant_message",
        messageId: "m3",
        model: "claude-sonnet-5",
        parts: [{ type: "text", text: "6" }],
        citations: [],
        artifactsTouched: [],
        seq: 5,
      },
      { type: "turn_done", messageId: "m3", seq: 6 },
    ];
    render(
      <ConversationPane
        stream={streamFromEvents(twoTurnEvents)}
        session={session()}
        onStarterSelect={vi.fn()}
      />,
    );
    // Exactly one Regenerate action — on the LAST turn ("6"), not the first ("4").
    expect(screen.getAllByRole("button", { name: /regenerate/i })).toHaveLength(1);
  });
});

describe("reconstructVariantGroups (R-SES1 — replay from events alone, Wave-2 review finding a)", () => {
  test("no branch_created events -> no groups", () => {
    expect(reconstructVariantGroups(ONE_TURN_EVENTS)).toEqual({});
  });

  test("a branch_created event's fromSeq maps back to the turn key via the user_message at fromSeq + 1", () => {
    const events: HubEvent[] = [
      ...ONE_TURN_EVENTS,
      { type: "branch_created", branchSessionId: "branch-1", fromSessionId: "s1", fromSeq: 0, seq: 4 },
    ];
    expect(reconstructVariantGroups(events)).toEqual({ u1: { siblingSessionIds: ["branch-1"] } });
  });

  test("two regenerates of the SAME turn accumulate siblings in seq order", () => {
    const events: HubEvent[] = [
      ...ONE_TURN_EVENTS,
      { type: "branch_created", branchSessionId: "branch-1", fromSessionId: "s1", fromSeq: 0, seq: 4 },
      { type: "branch_created", branchSessionId: "branch-2", fromSessionId: "s1", fromSeq: 0, seq: 5 },
    ];
    expect(reconstructVariantGroups(events)).toEqual({
      u1: { siblingSessionIds: ["branch-1", "branch-2"] },
    });
  });

  test("a branch_created with no fromSeq (a plain fork, not a turn regenerate) is skipped", () => {
    const events: HubEvent[] = [
      ...ONE_TURN_EVENTS,
      { type: "branch_created", branchSessionId: "branch-1", fromSessionId: "s1", seq: 4 },
    ];
    expect(reconstructVariantGroups(events)).toEqual({});
  });

  test("a branch_created whose fromSeq matches no user_message is skipped, not guessed at", () => {
    const events: HubEvent[] = [
      ...ONE_TURN_EVENTS,
      { type: "branch_created", branchSessionId: "branch-1", fromSessionId: "s1", fromSeq: 99, seq: 4 },
    ];
    expect(reconstructVariantGroups(events)).toEqual({});
  });
});
