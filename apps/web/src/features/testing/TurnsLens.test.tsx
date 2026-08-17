import type { RunStep } from "@mcp-token-footprint/shared";
import { TooltipProvider } from "@elabs-ai/components-ui";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { TimelineItem } from "./use-run-stream";

vi.mock("../../lib/api", () => ({
  listRunFeedback: vi.fn().mockResolvedValue([]),
  putRunFeedback: vi.fn(),
  deleteRunFeedback: vi.fn(),
}));

import { TurnsLens, type TurnsLensProps } from "./TurnsLens";

function step(over: Partial<RunStep>): RunStep {
  return {
    id: "s",
    runId: "run-1",
    index: 0,
    type: "tool_call",
    label: "tool",
    status: "ok",
    profileTokens: {},
    payload: {},
    ...over,
  };
}

// `FeedbackControl` (mounted per turn card) uses `@elabs-ai/components-ui` `Tooltip` internally — every render needs
// a `TooltipProvider` ancestor (mirrors `RunConsole.test.tsx`'s own wrapping).
function renderLens(props: TurnsLensProps) {
  return render(
    <TooltipProvider>
      <TurnsLens {...props} />
    </TooltipProvider>,
  );
}

describe("TurnsLens (WP3.4 acceptance #2 — per-turn summaries + chips)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test("renders an empty state before any turn exists", () => {
    renderLens({ runId: null, timeline: [], steps: [], onSelectTurn: vi.fn() });
    expect(screen.getByText("No turns yet")).toBeInTheDocument();
  });

  test("renders one card per turn with the first line of the prompt + reply and its chips", async () => {
    const timeline: TimelineItem[] = [
      { kind: "user", id: "u0", text: "How on-time are flights?\n(more detail)" },
      {
        kind: "assistant_turn",
        id: "t0",
        turnIndex: 0,
        stepId: "resp-0",
        assistantText: "About 82% on-time.\nSee the breakdown below.",
        toolCalls: [{ id: "c1", toolName: "flights_lookup", call: step({ id: "c1" }) }],
        usageActual: { inputTokens: 500, outputTokens: 120 },
        status: "ok",
        streaming: false,
      },
    ];
    const steps = [
      step({
        id: "resp-0",
        type: "llm_response",
        turnIndex: 0,
        startedAt: "2026-07-01T00:00:00.000Z",
        endedAt: "2026-07-01T00:00:02.000Z",
      }),
    ];

    renderLens({ runId: "run-1", timeline, steps, onSelectTurn: vi.fn() });

    // `findBy*` flushes the mocked `listRunFeedback` promise inside `act` (mirrors
    // `RunConsole.test.tsx`'s own pattern for the same async cosmetic-lookup shape).
    expect(await screen.findByText("Turn 1")).toBeInTheDocument();
    expect(screen.getByText("How on-time are flights?")).toBeInTheDocument();
    expect(screen.getByText("About 82% on-time.")).toBeInTheDocument();
    expect(screen.getByText("500↑")).toBeInTheDocument();
    expect(screen.getByText("120↓")).toBeInTheDocument();
    expect(screen.getByText("1 tool")).toBeInTheDocument();
    expect(screen.getByText("2.00 s")).toBeInTheDocument(); // formatDuration(2000)
  });

  test('clicking "Jump to turn" calls onSelectTurn with the 0-based turn index', () => {
    const timeline: TimelineItem[] = [
      {
        kind: "assistant_turn",
        id: "t0",
        turnIndex: 2,
        assistantText: "An answer.",
        toolCalls: [],
        status: "ok",
        streaming: false,
      },
    ];
    const onSelectTurn = vi.fn();
    renderLens({ runId: null, timeline, steps: [], onSelectTurn });
    fireEvent.click(screen.getByRole("button", { name: /jump to turn/i }));
    expect(onSelectTurn).toHaveBeenCalledWith(2);
  });

  test("an in-flight (streaming) turn with no reply text yet shows a Thinking placeholder + In progress badge", () => {
    const timeline: TimelineItem[] = [
      {
        kind: "assistant_turn",
        id: "t0",
        turnIndex: 0,
        toolCalls: [],
        status: "running",
        streaming: true,
      },
    ];
    renderLens({ runId: null, timeline, steps: [], onSelectTurn: vi.fn() });
    expect(screen.getByText("In progress")).toBeInTheDocument();
    expect(screen.getByText("Thinking…")).toBeInTheDocument();
  });

  test("highlights a literal match in the prompt/reply first-line text via highlightQuery", () => {
    const timeline: TimelineItem[] = [
      { kind: "user", id: "u0", text: "Tell me about widgets" },
      {
        kind: "assistant_turn",
        id: "t0",
        turnIndex: 0,
        assistantText: "Widgets are great.",
        toolCalls: [],
        status: "ok",
        streaming: false,
      },
    ];
    renderLens({
      runId: null,
      timeline,
      steps: [],
      onSelectTurn: vi.fn(),
      highlightQuery: "widgets",
    });
    const marks = document.querySelectorAll("mark");
    expect(marks.length).toBeGreaterThan(0);
    expect([...marks].some((m) => m.textContent?.toLowerCase() === "widgets")).toBe(true);
  });
});
