import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, test, vi } from "vitest";
import type { ReasoningSection, SessionCapabilities, Test } from "@mcp-token-footprint/shared";

/**
 * WP 5.4 — the ConversationPane REASONING render seam: a SETTLED turn whose payload carries the
 * derived `reasoningSections` renders through `AnswersReasoning` (in place of the live, verbatim
 * `ReasoningContent`); every other case — no sections (non-qlik run, legacy replay, or a total parse
 * miss) OR a still-streaming turn — keeps today's live, verbatim `ReasoningContent(reasoning)`,
 * unchanged. Only the REASONING block is exercised here; the PROSE block and SourcesPanel mount are
 * WP 5.3's concern and are asserted unchanged by `ConversationPane.answers.test.tsx`.
 *
 * `@brand/ai` can't load in jsdom (see RunConsole.test), so it's stubbed. `Reasoning`'s stub wraps
 * children in the REAL `@brand/ui` `Collapsible` (forced open) so the production code's real
 * `CollapsibleContent` (used for the structured branch, since `ReasoningContent`'s `children` are
 * typed as a raw markdown STRING and can't carry `AnswersReasoning`'s JSX) has a matching Radix
 * context to render into — `@brand/ui` itself is NOT mocked anywhere else in this file.
 */
vi.mock("@brand/ai", async () => {
  const ui = await import("@brand/ui");
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
    MessageAction: ({ children, label }: { children?: ReactNode; label?: string }) => (
      <button type="button" aria-label={label}>
        {" "}
        {/* brand-ui-allow: test-only stub of @brand/ai MessageAction, not app UI */}
        {children}
      </button>
    ),
    MessageActions: Pass,
    MessageContent: Pass,
    // Forced open (via the real `@brand/ui` Collapsible `defaultOpen`) so the content — verbatim or
    // structured — is inspectable without simulating a trigger click; open/close UX itself belongs to
    // `@brand/ai` and isn't this WP's concern. The WP 6.2 change to the `defaultOpen` PROP ConversationPane
    // passes (item A — `undefined` while streaming so the disclosure auto-opens, `false` when settled) is
    // still assertable: the stub surfaces the received prop as `data-default-open` on a wrapper.
    Reasoning: ({ children, defaultOpen }: { children?: ReactNode; defaultOpen?: boolean }) => (
      <div data-testid="reasoning-root" data-default-open={String(defaultOpen)}>
        <ui.Collapsible defaultOpen>{children}</ui.Collapsible>
      </div>
    ),
    ReasoningContent: ({ children }: { children: string }) => (
      <div data-testid="reasoning-verbatim">{children}</div>
    ),
    ReasoningTrigger: () => null,
    Shimmer: Pass,
    // SourcesPanel's disclosure (imported by ConversationPane) — stubbed like the rest.
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

// AnswersReasoning's own rendering is covered by AnswersReasoning.test.tsx — stub it to a sentinel
// here so this file only asserts WHICH renderer ConversationPane picked, with what sections, and
// whether it was handed the live `streaming` flag (WP 6.2). The sentinel surfaces the section KINDS so
// a test can tell SERVER sections (settled) from the LIVE client-parse of the reasoning text apart.
vi.mock("./AnswersReasoning", () => ({
  AnswersReasoning: ({
    sections,
    streaming,
  }: {
    sections: ReasoningSection[];
    streaming?: boolean;
  }) => (
    <div data-testid="answers-reasoning" data-streaming={String(streaming)}>
      sections:{sections.length} kinds:{sections.map((s) => s.kind).join(",")}
    </div>
  ),
}));
vi.mock("./ChatMarkdown", () => ({
  ChatMarkdown: ({ text, streaming }: { text: string; streaming?: boolean }) => (
    <div data-testid="chatmarkdown" data-streaming={streaming ? "true" : "false"}>
      {text}
    </div>
  ),
}));
vi.mock("./AnswersAnswerView", () => ({
  AnswersAnswerView: () => <div data-testid="answers-view" />,
}));
vi.mock("./SourcesPanel", () => ({ SourcesPanel: () => null }));
vi.mock("./ToolCallCard", () => ({ ToolCallCard: () => null }));
vi.mock("./Composer", () => ({ Composer: () => null }));

// useServerNames fetches /api/servers — resolve empty so the cosmetic lookup is a no-op. WP 2.5's
// `useTurnFeedback` batches a `listRunFeedback` call per run mount — stub it too (empty = no turn
// pre-carries a "Your verdict"; the turn-level control itself is exercised in FeedbackControl.test.tsx
// and use-run-stream.test.ts, not by re-driving the full ConversationPane render tree here).
vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    apiGet: vi.fn().mockResolvedValue([]),
    listRunFeedback: vi.fn().mockResolvedValue([]),
  };
});

import { ConversationPane, type ConversationPaneProps } from "./ConversationPane";
import type { RunStreamState, TimelineAssistantTurn } from "./use-run-stream";

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

const REASONING_TEXT = "Raw reasoning stream, verbatim.";

// WP 3.2 (Unified Sessions, D-US4) — the capability manifests this file exercises. `ENGINE_CAPS`
// (liveReasoning:"raw") is the default every `renderPane` call gets unless overridden; the individual
// tests override to `QLIK_CAPS` (liveReasoning:"structured", the old `providerKind: "qlik_answers"`
// cases) or `NONE_CAPS` (liveReasoning:"none").
const ENGINE_CAPS: SessionCapabilities = {
  liveText: true,
  liveReasoning: "raw",
  toolCalls: true,
  contextWindow: true,
  tokens: "exact",
  costBasis: "api_exact",
  followUps: true,
  askUser: true,
};
const QLIK_CAPS: SessionCapabilities = {
  liveText: true,
  liveReasoning: "structured",
  toolCalls: false,
  contextWindow: false,
  tokens: "estimated",
  costBasis: "questions",
  followUps: true,
  askUser: false,
  identity: { kind: "qlik_assistant", assistantId: "assistant-abc123" },
};
const NONE_CAPS: SessionCapabilities = { ...ENGINE_CAPS, liveReasoning: "none" };

function assistantTurn(over: Partial<TimelineAssistantTurn> = {}): TimelineAssistantTurn {
  return {
    kind: "assistant_turn",
    id: "turn-1",
    turnIndex: 0,
    reasoningText: REASONING_TEXT,
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

function renderPane(turn: TimelineAssistantTurn, over: Partial<ConversationPaneProps> = {}) {
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
    capabilities: ENGINE_CAPS,
    ...over,
  };
  return render(<ConversationPane {...props} />);
}

const SECTIONS: ReasoningSection[] = [
  { kind: "understanding", title: "Understanding", markdown: "Wants carrier delays." },
];

describe("ConversationPane — reasoning rendering (WP 5.4)", () => {
  test("a SETTLED turn WITH reasoningSections renders AnswersReasoning, not the verbatim ReasoningContent", () => {
    renderPane(
      assistantTurn({
        answersPayload: { promptMode: "oneshot", reasoningSections: SECTIONS },
      }),
    );
    const structured = screen.getByTestId("answers-reasoning");
    expect(structured).toHaveTextContent("sections:1");
    expect(screen.queryByTestId("reasoning-verbatim")).not.toBeInTheDocument();
  });

  test("a qlik turn WITHOUT reasoningSections falls back to the verbatim ReasoningContent(reasoning)", () => {
    renderPane(assistantTurn({ answersPayload: { promptMode: "oneshot" } }));
    const verbatim = screen.getByTestId("reasoning-verbatim");
    expect(verbatim).toHaveTextContent(REASONING_TEXT);
    expect(screen.queryByTestId("answers-reasoning")).not.toBeInTheDocument();
  });

  test("a qlik turn with an EMPTY reasoningSections array falls back to the verbatim ReasoningContent", () => {
    renderPane(assistantTurn({ answersPayload: { promptMode: "oneshot", reasoningSections: [] } }));
    expect(screen.getByTestId("reasoning-verbatim")).toHaveTextContent(REASONING_TEXT);
    expect(screen.queryByTestId("answers-reasoning")).not.toBeInTheDocument();
  });

  test("a STILL-STREAMING turn with liveReasoning:\"raw\" (the default here) keeps the live verbatim ReasoningContent even WITH reasoningSections", () => {
    // WP 3.2 (D-US4): live structuring is gated on `capabilities.liveReasoning === "structured"`.
    // The default `ENGINE_CAPS` (liveReasoning:"raw") is the non-structured path — the settled-only
    // guard still holds and the stream stays verbatim.
    renderPane(
      assistantTurn({
        streaming: true,
        status: "running",
        answersPayload: { promptMode: "oneshot", reasoningSections: SECTIONS },
      }),
    );
    expect(screen.getByTestId("reasoning-verbatim")).toHaveTextContent(REASONING_TEXT);
    expect(screen.queryByTestId("answers-reasoning")).not.toBeInTheDocument();
  });

  test("a non-qlik turn (no answersPayload at all) renders the verbatim ReasoningContent exactly as before", () => {
    renderPane(assistantTurn());
    expect(screen.getByTestId("reasoning-verbatim")).toHaveTextContent(REASONING_TEXT);
    expect(screen.queryByTestId("answers-reasoning")).not.toBeInTheDocument();
  });

  test("no reasoningText at all → no Reasoning disclosure renders (unchanged from before)", () => {
    renderPane(
      assistantTurn({ reasoningText: undefined, assistantText: "An answer with no reasoning." }),
    );
    expect(screen.queryByTestId("reasoning-verbatim")).not.toBeInTheDocument();
    expect(screen.queryByTestId("answers-reasoning")).not.toBeInTheDocument();
  });

  test("WP 3.2 — liveReasoning:\"none\" renders NO Reasoning disclosure at all, even with reasoningText present", () => {
    renderPane(assistantTurn(), { capabilities: NONE_CAPS });
    expect(screen.queryByTestId("reasoning-verbatim")).not.toBeInTheDocument();
    expect(screen.queryByTestId("answers-reasoning")).not.toBeInTheDocument();
  });
});

// A structured reasoning fixture with recognized phase markers — client-parses to
// [understanding, assets] (an "## " draft would add a `draft` section). Mirrors the shape a real
// qlik_answers reasoning stream carries mid-run.
const STRUCTURED_REASONING = [
  "1. **Understanding**: The user wants carrier delays.",
  "**Master Dimensions:**",
  "- [Carrier.airline_name] - dimension, similarity: 0.876 [GLOSSARY MATCH: airline]",
].join("\n");

describe("ConversationPane — LIVE structured reasoning (WP 6.2)", () => {
  test("a STREAMING qlik_answers turn (no settled payload) renders AnswersReasoning from a LIVE client-parse, not raw text", () => {
    renderPane(
      assistantTurn({
        streaming: true,
        status: "running",
        reasoningText: STRUCTURED_REASONING,
        assistantText: "American Airlines had the most delays.",
      }),
      { capabilities: QLIK_CAPS },
    );
    const structured = screen.getByTestId("answers-reasoning");
    // The recognized phases from the live text — NOT a single raw blob.
    expect(structured).toHaveTextContent("kinds:understanding,assets");
    // It was handed the live `streaming` flag (keeps a mid-stream draft expanded).
    expect(structured.getAttribute("data-streaming")).toBe("true");
    expect(screen.queryByTestId("reasoning-verbatim")).not.toBeInTheDocument();
  });

  test("the disclosure is OPEN while a qlik turn streams (item A — no forced-closed defaultOpen)", () => {
    renderPane(
      assistantTurn({ streaming: true, status: "running", reasoningText: STRUCTURED_REASONING }),
      { capabilities: QLIK_CAPS },
    );
    // ConversationPane passes `defaultOpen={undefined}` while streaming so @brand/ai auto-opens it
    // (`defaultOpen ?? isStreaming`), instead of the old forced `defaultOpen={false}`.
    expect(screen.getByTestId("reasoning-root").getAttribute("data-default-open")).toBe(
      "undefined",
    );
  });

  test("a SETTLED qlik turn (streaming false) still passes `defaultOpen={false}` so review opens collapsed", () => {
    renderPane(
      assistantTurn({ answersPayload: { promptMode: "oneshot", reasoningSections: SECTIONS } }),
      { capabilities: QLIK_CAPS },
    );
    expect(screen.getByTestId("reasoning-root").getAttribute("data-default-open")).toBe("false");
  });

  test("a partial/truncated live reasoningText still renders (no throw) — the tail flows, nothing dropped", () => {
    const partial = [
      "1. **Understanding**: carrier delays",
      "**Master Dimensions:**",
      "- [Carrier.airline_name] - dimension, similarity: 0.876",
      "- [Origin.airp", // truncated mid-delta
    ].join("\n");
    renderPane(assistantTurn({ streaming: true, status: "running", reasoningText: partial }), {
      capabilities: QLIK_CAPS,
    });
    const structured = screen.getByTestId("answers-reasoning");
    // The complete phases parse (understanding + assets); the half-formed row flows as trailing prose —
    // never a raw-only fallback, never a crash.
    expect(structured).toHaveTextContent("understanding");
    expect(structured).toHaveTextContent("assets");
    expect(structured).toHaveTextContent("prose");
    expect(screen.queryByTestId("reasoning-verbatim")).not.toBeInTheDocument();
  });

  test("a SETTLED qlik turn uses the canonical SERVER reasoningSections, NOT a client re-parse (byte-identical to WP 5.4)", () => {
    renderPane(
      assistantTurn({
        // The reasoning TEXT client-parses to a `raw` section; the SERVER sections are `understanding`.
        // A settled turn must render the server sections, proving the settled path is unchanged.
        reasoningText: REASONING_TEXT,
        answersPayload: { promptMode: "oneshot", reasoningSections: SECTIONS },
      }),
      { capabilities: QLIK_CAPS },
    );
    const structured = screen.getByTestId("answers-reasoning");
    expect(structured).toHaveTextContent("kinds:understanding");
    expect(structured).not.toHaveTextContent("raw");
    expect(structured.getAttribute("data-streaming")).toBe("false");
  });

  test("a STREAMING turn with liveReasoning:\"raw\" (not \"structured\") stays verbatim — live structuring is structured-only", () => {
    renderPane(
      assistantTurn({ streaming: true, status: "running", reasoningText: STRUCTURED_REASONING }),
      { capabilities: ENGINE_CAPS },
    );
    // The verbatim stream renders as-is (a distinctive substring proves it's the raw text, not the
    // structured sentinel — `toHaveTextContent` normalizes the multi-line whitespace).
    expect(screen.getByTestId("reasoning-verbatim")).toHaveTextContent("Master Dimensions");
    expect(screen.queryByTestId("answers-reasoning")).not.toBeInTheDocument();
  });
});
