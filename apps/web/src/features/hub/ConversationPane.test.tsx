import type {
  HubEvent,
  HubSession,
  HubTaskItem,
  HubToolPart,
  HubToolPartState,
} from "@mcp-token-footprint/shared";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

vi.mock("@elabs-ai/components-ai", () => import("./test-support/brand-ai-mock"));

import {
  ConversationPane,
  HUB_STARTER_SUGGESTIONS,
  reconstructSavedMemoryIds,
  TaskWidget,
} from "./ConversationPane";
import type { ConversationStream } from "./ConversationPane";
import type { HubTimelineAssistantTurn } from "./use-hub-stream";

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

const EMPTY_STREAM: ConversationStream = {
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
  timeline: [],
  tasks: [],
  pendingQueued: [],
};

function toolPart(state: HubToolPartState, overrides: Partial<HubToolPart> = {}): HubToolPart {
  return {
    type: "tool_call",
    toolCallId: "c1",
    toolName: "mcp__demo__lookup",
    source: "mcp",
    state,
    args: { query: "demo" },
    ...overrides,
  };
}

function turnWithToolPart(part: HubToolPart): HubTimelineAssistantTurn {
  return {
    kind: "assistant_turn",
    id: "turn-1",
    messageId: "m1",
    model: "claude-sonnet-5",
    parts: [part],
    toolCalls: [{ id: part.toolCallId, part }],
    citations: [],
    streaming: false,
  };
}

describe("ConversationPane — empty state (R-UX10)", () => {
  test("shows the starter chips, and a click sends the prompt", () => {
    const onStarterSelect = vi.fn();
    render(<ConversationPane stream={EMPTY_STREAM} onStarterSelect={onStarterSelect} />);
    const [firstStarter] = HUB_STARTER_SUGGESTIONS;
    expect(firstStarter).toBeDefined();
    const chip = screen.getByRole("button", { name: firstStarter });
    fireEvent.click(chip);
    expect(onStarterSelect).toHaveBeenCalledWith(firstStarter);
  });

  test("WP1.3 (D-HUX13): hideGenericEmptyState suppresses the generic empty state (superseded by EmptySessionIntro)", () => {
    render(
      <ConversationPane stream={EMPTY_STREAM} onStarterSelect={vi.fn()} hideGenericEmptyState />,
    );
    expect(screen.queryByText("Start a conversation")).not.toBeInTheDocument();
    const [firstStarter] = HUB_STARTER_SUGGESTIONS;
    expect(firstStarter).toBeDefined();
    expect(screen.queryByRole("button", { name: firstStarter })).not.toBeInTheDocument();
  });

  test("hideGenericEmptyState defaults to false — every existing caller keeps today's behavior", () => {
    render(<ConversationPane stream={EMPTY_STREAM} onStarterSelect={vi.fn()} />);
    expect(screen.getByText("Start a conversation")).toBeInTheDocument();
  });

  test("a live turn with no content yet shows a Shimmer, not an empty transcript", () => {
    const stream: ConversationStream = { ...EMPTY_STREAM, turnRunning: true, timeline: [] };
    render(<ConversationPane stream={stream} onStarterSelect={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Thinking…");
  });
});

describe("ConversationPane — transcript fade scrims (ends where the composer starts)", () => {
  // The two inert `from-background to-transparent` overlays that dissolve the transcript into the page
  // ground at its edges so content never scrolls visibly BEHIND the floating docked composer.
  function scrims(container: HTMLElement): { top: HTMLElement | null; bottom: HTMLElement | null } {
    const all = Array.from(
      container.querySelectorAll<HTMLElement>("[aria-hidden].pointer-events-none.absolute"),
    );
    return {
      top: all.find((el) => el.className.includes("bg-gradient-to-b")) ?? null,
      bottom: all.find((el) => el.className.includes("bg-gradient-to-t")) ?? null,
    };
  }

  test("renders a top and a bottom fade scrim, both fading to the page ground", () => {
    const { container } = render(
      <ConversationPane stream={EMPTY_STREAM} onStarterSelect={vi.fn()} />,
    );
    const { top, bottom } = scrims(container);
    expect(top).not.toBeNull();
    expect(bottom).not.toBeNull();
    // Token-driven fade (no raw colors) — dissolves to the shell's own ground in either theme.
    expect(top?.className).toContain("from-background");
    expect(bottom?.className).toContain("from-background");
  });

  test("the bottom scrim height tracks the measured composer clearance (composerInset)", () => {
    const { container } = render(
      <ConversationPane stream={EMPTY_STREAM} onStarterSelect={vi.fn()} composerInset={220} />,
    );
    const { bottom } = scrims(container);
    // A measured clearance covers the whole floating-composer band so content fades before it.
    expect(bottom?.style.height).toBe("220px");
  });
});

describe("ConversationPane — R-SES2 ordered parts + R-UX1 tool state machine", () => {
  test.each<[HubToolPartState, string]>([
    ["input-streaming", "input-streaming"],
    ["input-available", "input-available"],
    ["output-available", "output-available"],
    ["output-error", "output-error"],
  ])("renders the %s tool-part state", (state, expectedState) => {
    const turn = turnWithToolPart(toolPart(state));
    const stream: ConversationStream = { ...EMPTY_STREAM, timeline: [turn] };
    render(<ConversationPane stream={stream} onStarterSelect={vi.fn()} />);
    expect(screen.getByTestId("tool-header")).toHaveAttribute("data-state", expectedState);
  });

  test("approval-requested shows the ApprovalCard with a pending request (Approve/Deny visible)", () => {
    const turn = turnWithToolPart(
      toolPart("approval-requested", { approval: { options: ["allow-once", "always"] } }),
    );
    const stream: ConversationStream = { ...EMPTY_STREAM, timeline: [turn] };
    render(<ConversationPane stream={stream} onStarterSelect={vi.fn()} />);
    const card = screen.getByTestId("approval-card");
    expect(card).toHaveAttribute("data-state", "approval-requested");
    expect(screen.getByRole("button", { name: /approve/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /deny/i })).toBeInTheDocument();
  });

  test("output-denied shows the ApprovalCard's Rejected slot (Denied), not the pending request", () => {
    const turn = turnWithToolPart(
      toolPart("output-denied", {
        approval: { options: ["allow-once", "always"], resolution: "deny" },
      }),
    );
    const stream: ConversationStream = { ...EMPTY_STREAM, timeline: [turn] };
    render(<ConversationPane stream={stream} onStarterSelect={vi.fn()} />);
    expect(screen.getByTestId("approval-card")).toHaveAttribute("data-state", "output-denied");
    expect(screen.getByText("Denied.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /approve/i })).not.toBeInTheDocument();
  });

  test("input-streaming/input-available render NO approval card even if annotations exist", () => {
    const turn = turnWithToolPart(toolPart("input-available"));
    const stream: ConversationStream = { ...EMPTY_STREAM, timeline: [turn] };
    render(<ConversationPane stream={stream} onStarterSelect={vi.fn()} />);
    expect(screen.queryByTestId("approval-card")).not.toBeInTheDocument();
  });

  test("renders ordered text + tool parts from a settled assistant_message, in order", () => {
    const turn: HubTimelineAssistantTurn = {
      kind: "assistant_turn",
      id: "turn-1",
      messageId: "m1",
      model: "claude-sonnet-5",
      parts: [
        { type: "text", text: "Let me check that." },
        toolPart("output-available", { modelContent: { rows: 3 } }),
        { type: "text", text: "Found 3 rows." },
      ],
      toolCalls: [{ id: "c1", part: toolPart("output-available", { modelContent: { rows: 3 } }) }],
      citations: [],
      streaming: false,
    };
    const stream: ConversationStream = { ...EMPTY_STREAM, timeline: [turn] };
    render(<ConversationPane stream={stream} onStarterSelect={vi.fn()} />);
    expect(screen.getByText("Let me check that.")).toBeInTheDocument();
    expect(screen.getByText("Found 3 rows.")).toBeInTheDocument();
    expect(screen.getByTestId("tool-header")).toHaveAttribute("data-state", "output-available");
    // R-SES10 — the per-message model chip.
    expect(screen.getByText("claude-sonnet-5")).toBeInTheDocument();
  });

  test("WP2.6: a generative-ui part renders a valid widget; an unknown component is dropped (allowlist), never a crash", () => {
    // A VALID catalog component renders (R-GUI2/3).
    const valid: HubTimelineAssistantTurn = {
      kind: "assistant_turn",
      id: "turn-1",
      messageId: "m1",
      parts: [
        { type: "generative-ui", spec: { $type: "Heading", props: { text: "Live widget" } } },
      ],
      toolCalls: [],
      citations: [],
      streaming: false,
    };
    const { unmount } = render(
      <ConversationPane
        stream={{ ...EMPTY_STREAM, timeline: [valid] }}
        onStarterSelect={vi.fn()}
      />,
    );
    expect(screen.getByText("Live widget")).toBeInTheDocument();
    unmount();

    // An UNKNOWN component is dropped by the render-time allowlist — nothing renders, never a crash.
    const unknown: HubTimelineAssistantTurn = {
      kind: "assistant_turn",
      id: "turn-2",
      messageId: "m2",
      parts: [{ type: "generative-ui", spec: { $type: "StatTile" } }],
      toolCalls: [],
      citations: [],
      streaming: false,
    };
    render(
      <ConversationPane
        stream={{ ...EMPTY_STREAM, timeline: [unknown] }}
        onStarterSelect={vi.fn()}
      />,
    );
    expect(screen.queryByText("StatTile")).not.toBeInTheDocument();
  });
});

// a11y (critique 2026-07-25T20-00-10Z item 5): the trailing turn gets its OWN small, scoped status
// region (an `<output>`, implicit role=status — separate from the transcript-wide `role="log"` on
// `<Conversation>`, which the shared `@elabs-ai/components-ai` test-support mock drops all props from — see
// `AssistantTurnWithVariants` in ConversationPane.tsx) so a screen reader hears "responding…"/
// "finished" instead of the whole transcript being re-announced on every token. Scoped to the
// TRAILING turn only — an earlier, settled turn never changes again and gets no status region of its own.
describe("ConversationPane — trailing-turn status region (a11y)", () => {
  function assistantTurn(overrides: Partial<HubTimelineAssistantTurn> = {}): HubTimelineAssistantTurn {
    return {
      kind: "assistant_turn",
      id: "turn-1",
      messageId: "m1",
      model: "claude-sonnet-5",
      parts: [{ type: "text", text: "Here's what I found." }],
      toolCalls: [],
      citations: [],
      streaming: false,
      ...overrides,
    };
  }

  test("a streaming trailing turn announces 'responding' and is aria-busy", () => {
    const stream: ConversationStream = {
      ...EMPTY_STREAM,
      turnRunning: true,
      timeline: [assistantTurn({ streaming: true })],
    };
    render(<ConversationPane stream={stream} onStarterSelect={vi.fn()} />);
    // A native <output> (implicit role=status, matching ResultCount.tsx's precedent), not a raw
    // role="status" attribute. "status" doesn't compute an accessible NAME from its own text content
    // (same as the existing "Thinking…" Shimmer assertion above) — assert role + text separately.
    const status = screen.getByRole("status");
    expect(status.tagName).toBe("OUTPUT");
    expect(status).toHaveTextContent("Assistant is responding…");
    expect(status).toHaveAttribute("aria-busy", "true");
  });

  test("a settled trailing turn announces 'finished' and is NOT aria-busy", () => {
    const stream: ConversationStream = {
      ...EMPTY_STREAM,
      timeline: [assistantTurn({ streaming: false })],
    };
    render(<ConversationPane stream={stream} onStarterSelect={vi.fn()} />);
    const status = screen.getByRole("status");
    expect(status.tagName).toBe("OUTPUT");
    expect(status).toHaveTextContent("Assistant finished responding.");
    expect(status).toHaveAttribute("aria-busy", "false");
  });

  test("only the TRAILING turn gets a status region — an earlier, settled turn gets none", () => {
    const earlier = assistantTurn({ id: "turn-0", messageId: "m0", parts: [{ type: "text", text: "First reply." }] });
    const trailing = assistantTurn({ id: "turn-1", messageId: "m1", parts: [{ type: "text", text: "Second reply." }] });
    const stream: ConversationStream = { ...EMPTY_STREAM, timeline: [earlier, trailing] };
    render(<ConversationPane stream={stream} onStarterSelect={vi.fn()} />);
    // Exactly one status region for the whole transcript (the trailing turn's), not one per turn.
    const statuses = screen.getAllByRole("status");
    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toHaveTextContent("Assistant finished responding.");
  });
});

describe("ConversationPane — R-SES3 pending queued messages", () => {
  test("a still-pending queued message renders in the tray", () => {
    const stream: ConversationStream = {
      ...EMPTY_STREAM,
      pendingQueued: [
        { kind: "queued", id: "q1", queuedMessageId: "q1", text: "and one more thing" },
      ],
    };
    render(<ConversationPane stream={stream} onStarterSelect={vi.fn()} />);
    expect(screen.getByText("and one more thing")).toBeInTheDocument();
    expect(screen.getByText(/queued/i)).toBeInTheDocument();
  });
});

describe("TaskWidget (R-SES4)", () => {
  function task(id: string, status: HubTaskItem["status"] = "pending"): HubTaskItem {
    return { id, title: `Task ${id}`, status };
  }

  test("renders nothing for zero tasks", () => {
    const { container } = render(<TaskWidget tasks={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  test("shows at most 5 tasks, with a Show N more control that reveals the rest", () => {
    const tasks = Array.from({ length: 7 }, (_, i) => task(`t${i}`));
    render(<TaskWidget tasks={tasks} />);
    expect(screen.getAllByTestId("task-item")).toHaveLength(5);
    fireEvent.click(screen.getByRole("button", { name: /show 2 more/i }));
    expect(screen.getAllByTestId("task-item")).toHaveLength(7);
  });

  test("reconciles by id — status maps to the closed Status vocabulary", () => {
    render(<TaskWidget tasks={[task("t1", "in_progress"), task("t2", "blocked")]} />);
    const items = screen.getAllByTestId("task-item");
    expect(items[0]).toHaveAttribute("data-status", "running");
    expect(items[1]).toHaveAttribute("data-status", "skipped");
  });
});

describe("ConversationPane — WP3.2 memory-proposal chip (D-AH11)", () => {
  function memoryProposalPart(overrides: Partial<HubToolPart> = {}): HubToolPart {
    return toolPart("output-available", {
      toolName: "memory.propose_save",
      source: "builtin",
      modelContent: { memoryId: "mem-1", status: "proposed" },
      artifact: {
        kind: "hub_memory",
        data: {
          id: "mem-1",
          kind: "preference",
          content: "Prefers concise answers.",
          source: "assistant_proposed",
          status: "proposed",
          createdAt: "2026-07-17T12:00:00.000Z",
          updatedAt: "2026-07-17T12:00:00.000Z",
        },
      },
      ...overrides,
    });
  }

  test("a settled memory.propose_save call renders the proposal chip, not the generic tool card", () => {
    const turn = turnWithToolPart(memoryProposalPart());
    const stream: ConversationStream = { ...EMPTY_STREAM, timeline: [turn] };
    render(<ConversationPane stream={stream} onStarterSelect={vi.fn()} />);
    expect(screen.getByTestId("memory-proposal-chip")).toBeInTheDocument();
    expect(screen.getByText("Save to memory?")).toBeInTheDocument();
    expect(screen.getByText("Prefers concise answers.")).toBeInTheDocument();
    expect(screen.queryByTestId("tool-header")).not.toBeInTheDocument();
  });

  test("clicking Save to memory calls handlers.memory.onAccept with the memoryId + the proposal's own scope", () => {
    const onAccept = vi.fn();
    const turn = turnWithToolPart(memoryProposalPart());
    const stream: ConversationStream = { ...EMPTY_STREAM, timeline: [turn] };
    render(
      <ConversationPane
        stream={stream}
        onStarterSelect={vi.fn()}
        handlers={{ memory: { savedMemoryIds: new Set(), scopeOptions: [], onAccept } }}
      />,
    );
    // No scope was proposed (defaults to "profile") and no session-scoped options were offered, so the
    // picker has nothing to choose between — the chip saves at the proposal's own (default) scope.
    expect(screen.queryByLabelText("Memory scope")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /save to memory/i }));
    expect(onAccept).toHaveBeenCalledWith("mem-1", "profile", undefined);
  });

  // The full open-and-pick flow rides Radix's portal + pointer-capture, which jsdom doesn't model
  // (mirrors `AutonomyDial.test.tsx`'s own documented precedent) — these prove the picker RENDERS,
  // defaults to the proposal's own scope, and is omitted entirely when there's nothing to choose
  // between; `onAccept`'s multi-scope wiring (picking a different option) is covered by the pure
  // `memoryScopeOptionsForSession` shape + `hub-memory-scopes.test.ts`'s API-side scope-move coverage.
  test("the scope picker renders labelled + defaulted to the proposal's own scope when a session-scoped option is also available", () => {
    const turn = turnWithToolPart(
      memoryProposalPart({
        artifact: {
          kind: "hub_memory",
          data: {
            id: "mem-1",
            kind: "instruction",
            content: "Track the rollout.",
            source: "assistant_proposed",
            status: "proposed",
            scope: "profile",
            createdAt: "2026-07-17T12:00:00.000Z",
            updatedAt: "2026-07-17T12:00:00.000Z",
          },
        },
      }),
    );
    const stream: ConversationStream = { ...EMPTY_STREAM, timeline: [turn] };
    render(
      <ConversationPane
        stream={stream}
        onStarterSelect={vi.fn()}
        handlers={{
          memory: {
            savedMemoryIds: new Set(),
            scopeOptions: [
              { value: "profile", label: "Profile (global)" },
              { value: "project", scopeId: "proj-1", label: "This project" },
            ],
            onAccept: vi.fn(),
          },
        }}
      />,
    );
    const trigger = screen.getByRole("combobox", { name: "Memory scope" });
    expect(trigger).toHaveTextContent("Profile (global)");
  });

  test("a memoryId already in savedMemoryIds flips the chip to the saved state (no Save button)", () => {
    const turn = turnWithToolPart(memoryProposalPart());
    const stream: ConversationStream = { ...EMPTY_STREAM, timeline: [turn] };
    render(
      <ConversationPane
        stream={stream}
        onStarterSelect={vi.fn()}
        handlers={{
          memory: { savedMemoryIds: new Set(["mem-1"]), scopeOptions: [], onAccept: vi.fn() },
        }}
      />,
    );
    expect(screen.getByText("Saved to memory")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save to memory/i })).not.toBeInTheDocument();
  });

  test("a still-running memory.propose_save call falls through to the generic tool card (no artifact yet)", () => {
    const turn = turnWithToolPart(
      toolPart("input-available", { toolName: "memory.propose_save", source: "builtin" }),
    );
    const stream: ConversationStream = { ...EMPTY_STREAM, timeline: [turn] };
    render(<ConversationPane stream={stream} onStarterSelect={vi.fn()} />);
    expect(screen.getByTestId("tool-header")).toBeInTheDocument();
    expect(screen.queryByTestId("memory-proposal-chip")).not.toBeInTheDocument();
  });
});

describe("reconstructSavedMemoryIds — WP3.2 (R-SES1 pure fold)", () => {
  test("folds memory_saved events into a set of memoryIds; ignores every other event type", () => {
    const events = [
      {
        type: "memory_proposed",
        memoryId: "mem-1",
        kind: "preference",
        content: "x",
        seq: 1,
        at: "t1",
      },
      {
        type: "memory_saved",
        memoryId: "mem-1",
        kind: "preference",
        content: "x",
        source: "assistant_proposed",
        seq: 2,
        at: "t2",
      },
      {
        type: "memory_saved",
        memoryId: "mem-2",
        kind: "instruction",
        content: "y",
        source: "user",
        seq: 3,
        at: "t3",
      },
    ] as unknown as HubEvent[];
    const saved = reconstructSavedMemoryIds(events);
    expect(saved.has("mem-1")).toBe(true);
    expect(saved.has("mem-2")).toBe(true);
    expect(saved.has("mem-3")).toBe(false);
  });
});
