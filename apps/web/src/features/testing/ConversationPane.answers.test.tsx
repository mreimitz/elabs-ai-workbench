import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import type { AnswersStepPayload, SessionCapabilities, Test } from "@mcp-token-footprint/shared";
import { TooltipProvider } from "@brand/ui";

/**
 * WP 5.3 — the ConversationPane render seam: a SETTLED `qlik_answers` turn whose payload carries the
 * derived `blocks` renders through `AnswersAnswerView`; EVERY other case — no `blocks`, a non-qlik
 * run, or a still-streaming turn — falls back to the verbatim `ChatMarkdown(assistantText)` path,
 * unchanged. The copy action always copies `assistantText`, never the block projection.
 *
 * `@brand/ai` can't load in jsdom (see RunConsole.test), so its components are stubbed to
 * passthroughs; `ChatMarkdown` and `AnswersAnswerView` are stubbed to sentinels so we assert WHICH
 * one rendered. Heavy sibling panes are stubbed to keep the import graph jsdom-safe.
 */
vi.mock("@brand/ai", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    AgentMessage: Pass,
    ChatShell: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Conversation: ({
      children,
    }: {
      children?: ReactNode | ((ctx: { scrollRef: { current: null } }) => ReactNode);
    }) => (
      <div>
        {typeof children === "function" ? children({ scrollRef: { current: null } }) : children}
      </div>
    ),
    ConversationContent: Pass,
    ConversationEmptyState: ({ title, description }: { title?: string; description?: string }) => (
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
    ),
    ConversationScrollButton: () => null,
    MessageAction: ({
      children,
      onClick,
      label,
    }: {
      children?: ReactNode;
      onClick?: () => void;
      label?: string;
    }) => (
      <button type="button" onClick={onClick} aria-label={label}>
        {" "}
        {/* brand-ui-allow: test-only stub of @brand/ai MessageAction, not app UI */}
        {children}
      </button>
    ),
    MessageActions: Pass,
    MessageContent: Pass,
    Reasoning: Pass,
    ReasoningContent: Pass,
    ReasoningTrigger: () => null,
    Shimmer: Pass,
    // SourcesPanel's disclosure (imported by ConversationPane) — trigger as a real button so the
    // citations fold stays clickable/assertable; content always-mounted (open/close is Radix's).
    Sources: Pass,
    SourcesContent: Pass,
    SourcesTrigger: ({
      count,
      children,
      ...props
    }: { count: number; children?: ReactNode } & Record<string, unknown>) => (
      <button type="button" {...props}>
        {children ?? `Used ${count} sources`}
      </button>
    ),
    Task: Pass,
    TaskContent: Pass,
    TaskTrigger: () => null,
    UserMessage: Pass,
  };
});

vi.mock("./ChatMarkdown", () => ({
  ChatMarkdown: ({ text, streaming }: { text: string; streaming?: boolean }) => (
    <div data-testid="chatmarkdown" data-streaming={streaming ? "true" : "false"}>
      {text}
    </div>
  ),
}));
vi.mock("./AnswersAnswerView", () => ({
  AnswersAnswerView: ({ blocks }: { blocks: unknown[] }) => (
    <div data-testid="answers-view">blocks:{blocks.length}</div>
  ),
}));
vi.mock("./SourcesPanel", () => ({ SourcesPanel: () => null }));
vi.mock("./ToolCallCard", () => ({ ToolCallCard: () => null }));
vi.mock("./Composer", () => ({ Composer: () => null }));

// useServerNames fetches /api/servers — resolve empty so the cosmetic lookup is a no-op. WP 2.5's
// `useTurnFeedback` batches a `listRunFeedback` call per run mount — stub it too (see the identical
// note in ConversationPane.reasoning.test.tsx). `putRunFeedback` backs the turn-level control's own
// write (exercised by the WP 2.5 describe block below).
vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    apiGet: vi.fn().mockResolvedValue([]),
    listRunFeedback: vi.fn().mockResolvedValue([]),
    putRunFeedback: vi.fn(),
  };
});

import { ConversationPane, type ConversationPaneProps } from "./ConversationPane";
import { listRunFeedback, putRunFeedback } from "../../lib/api";
import type { RunStreamState, TimelineAssistantTurn } from "./use-run-stream";

const mockListRunFeedback = vi.mocked(listRunFeedback);
const mockPutRunFeedback = vi.mocked(putRunFeedback);

beforeAll(() => {
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

const ANSWER_TEXT = "American Airlines held the largest market share.";

// A generic engine-kind manifest — the reasoning/composer/ask-user gating this WP added isn't what
// this file tests (it's the WP 5.3 answer-rendering seam), so a fixed default is enough here.
const CAPS: SessionCapabilities = {
  liveText: true,
  liveReasoning: "raw",
  toolCalls: true,
  contextWindow: true,
  tokens: "exact",
  costBasis: "api_exact",
  followUps: true,
  askUser: true,
};

function assistantTurn(over: Partial<TimelineAssistantTurn> = {}): TimelineAssistantTurn {
  return {
    kind: "assistant_turn",
    id: "turn-1",
    turnIndex: 0,
    assistantText: ANSWER_TEXT,
    toolCalls: [],
    status: "ok",
    streaming: false,
    ...over,
  };
}

function streamWith(turn: TimelineAssistantTurn): RunStreamState {
  return {
    status: "completed",
    ratingState: null,
    steps: [],
    kpis: null,
    deltas: { text: "", reasoning: "" },
    deltasByTurn: {},
    error: null,
    questions: [],
    timeline: [turn],
    phase: null,
    queuePosition: null,
    phaseDeadlineAt: null,
  };
}

function renderPane(turn: TimelineAssistantTurn) {
  const props: ConversationPaneProps = {
    test: { id: "test-1", attachments: [] } as unknown as Test,
    mode: "automated",
    runId: "run-1",
    stream: streamWith(turn),
    phase: "completed",
    selectedStepId: null,
    onSelectStep: () => {},
    reviewMode: false,
    navTarget: null,
    onShowInTrace: () => {},
    capabilities: CAPS,
  };
  // WP 2.5 — the turn-level feedback control renders a real `@brand/ui` Tooltip (only `@brand/ai` is
  // mocked in this file), which needs a `TooltipProvider` ancestor, mirroring the app root's real
  // provider stack.
  return render(
    <TooltipProvider>
      <ConversationPane {...props} />
    </TooltipProvider>,
  );
}

const answersPayload = (over: Partial<AnswersStepPayload> = {}): AnswersStepPayload => ({
  promptMode: "oneshot",
  ...over,
});

beforeEach(() => {
  mockListRunFeedback.mockReset();
  mockListRunFeedback.mockResolvedValue([]);
  mockPutRunFeedback.mockReset();
});

describe("ConversationPane — qlik answer rendering (WP 5.3)", () => {
  test("a SETTLED qlik turn WITH blocks renders AnswersAnswerView, not ChatMarkdown", () => {
    renderPane(
      assistantTurn({
        answersPayload: answersPayload({
          blocks: [{ kind: "text", markdown: ANSWER_TEXT }],
          snapshots: [],
        }),
      }),
    );
    expect(screen.getByTestId("answers-view")).toBeInTheDocument();
    expect(screen.queryByTestId("chatmarkdown")).not.toBeInTheDocument();
  });

  test("a qlik turn WITHOUT blocks falls back to ChatMarkdown(assistantText) — byte-identical", () => {
    renderPane(assistantTurn({ answersPayload: answersPayload() }));
    const md = screen.getByTestId("chatmarkdown");
    expect(md).toHaveTextContent(ANSWER_TEXT);
    expect(screen.queryByTestId("answers-view")).not.toBeInTheDocument();
  });

  test("a non-qlik turn (no answersPayload) renders ChatMarkdown exactly as before", () => {
    renderPane(assistantTurn());
    expect(screen.getByTestId("chatmarkdown")).toHaveTextContent(ANSWER_TEXT);
    expect(screen.queryByTestId("answers-view")).not.toBeInTheDocument();
  });

  test("a STREAMING qlik turn with blocks keeps the live ChatMarkdown (no half-parsed blocks)", () => {
    renderPane(
      assistantTurn({
        streaming: true,
        status: "running",
        answersPayload: answersPayload({
          blocks: [{ kind: "text", markdown: ANSWER_TEXT }],
        }),
      }),
    );
    const md = screen.getByTestId("chatmarkdown");
    expect(md).toHaveAttribute("data-streaming", "true");
    expect(screen.queryByTestId("answers-view")).not.toBeInTheDocument();
  });

  test("the copy action copies the verbatim assistantText even when blocks render", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    renderPane(
      assistantTurn({
        answersPayload: answersPayload({
          blocks: [{ kind: "text", markdown: "projected block text (NOT copied)" }],
          snapshots: [],
        }),
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy message" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(ANSWER_TEXT));
  });
});

/**
 * Observability WP 2.5 (D-OB15) — per-turn "Your verdict" hover thumbs. Proves the wiring end-to-end:
 * `buildTimeline` threads the settled `llm_response` step's OWN id onto `turn.stepId` (unit-tested in
 * `use-run-stream.test.ts`); `ConversationPane`/`AssistantTurn` render a `FeedbackControl` gated on
 * that `stepId`; clicking it writes STEP-scoped feedback (`stepId` in the body), never conflated with
 * a DIFFERENT turn's or the run-level control's feedback.
 */
describe("ConversationPane — per-turn feedback control (WP 2.5, D-OB15)", () => {
  test("a SETTLED turn with a stepId renders the 'Your verdict' thumbs", async () => {
    renderPane(assistantTurn({ stepId: "run-1:step:3" }));
    expect(
      await screen.findByRole("button", { name: "Your verdict: thumbs up" }),
    ).toBeInTheDocument();
  });

  test("a turn with NO stepId (never settled) renders no feedback control", () => {
    renderPane(assistantTurn({ stepId: undefined }));
    expect(screen.queryByRole("button", { name: /Your verdict/ })).not.toBeInTheDocument();
  });

  test("clicking a turn's thumb writes feedback scoped to THAT turn's own stepId", async () => {
    mockPutRunFeedback.mockResolvedValueOnce({
      id: "fb-turn",
      runId: "run-1",
      stepId: "run-1:step:3",
      key: "verdict",
      score: 1,
      source: "human",
      createdAt: "2026-07-16T00:00:00Z",
    });
    renderPane(assistantTurn({ stepId: "run-1:step:3" }));

    fireEvent.click(await screen.findByRole("button", { name: "Your verdict: thumbs up" }));

    await waitFor(() =>
      expect(mockPutRunFeedback).toHaveBeenCalledWith("run-1", {
        key: "verdict",
        score: 1,
        stepId: "run-1:step:3",
      }),
    );
  });

  test("batches ONE listRunFeedback call for the whole run, not one per turn", async () => {
    renderPane(assistantTurn({ stepId: "run-1:step:3" }));
    await waitFor(() => expect(mockListRunFeedback).toHaveBeenCalledWith("run-1"));
    expect(mockListRunFeedback).toHaveBeenCalledTimes(1);
  });
});
