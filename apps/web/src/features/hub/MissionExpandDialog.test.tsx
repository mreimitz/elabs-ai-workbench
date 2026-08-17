// hub-fixes WP4.3 (RC6.2/RC6.4) — the expand modal + selectable topology + per-node panel. `@elabs-ai/components-ai`
// is the shared hub stub; `@elabs-ai/components-flow`'s CanvasShell is stubbed to a FAITHFUL DOM (each node a
// `.react-flow__node[data-id]` element wired to `onNodeClick`) so both node-CLICK selection and the
// KEYBOARD capture handlers (`onKeyDownCapture` → Enter selects) can be driven deterministically in
// jsdom — the same "mock the canvas, assert the model/interaction" posture as
// `SkillGraphCanvas.selection.test.tsx` / `OrgChartTab.test.tsx`. AgentTranscript's SSE runs on a fake
// EventSource so the Live panel's stream + its unsubscribe-on-deselect are proven without a network.

import type {
  HubAgentReport,
  HubEvent,
  HubMissionPlan,
  HubPlannedAgent,
  HubToolGrants,
} from "@mcp-token-footprint/shared";
import type { HubSseFrame } from "../../lib/api";
import { act, fireEvent, render as rtlRender, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@elabs-ai/components-ui";
import type { ReactElement } from "react";

vi.mock("@elabs-ai/components-ai", () => import("./test-support/brand-ai-mock"));

// MissionBoard/MissionExpandDialog render `IconButton`s (D-TB5), which wrap every control in a
// Radix `Tooltip` — that throws without an ancestor `TooltipProvider` (the app root mounts one;
// this file's many render() call sites don't get it automatically).
function render(ui: ReactElement) {
  return rtlRender(<TooltipProvider>{ui}</TooltipProvider>);
}

// A faithful @elabs-ai/components-flow stub: renders each node as the SAME DOM contract the real canvas exposes
// (`.react-flow__node[data-id]`, focusable) and wires `onNodeClick`, so the WP's real selection code
// (click handler + the section's keyboard/focus capture handlers) is exercised, not mocked away.
vi.mock("@elabs-ai/components-flow", () => ({
  FlowNode: () => null,
  ZoomControls: () => null,
  CanvasShell: ({
    nodes,
    onNodeClick,
    children,
  }: {
    nodes?: Array<{ id: string; selected?: boolean; data?: { title?: string } }>;
    onNodeClick?: (event: unknown, node: { id: string }) => void;
    children?: React.ReactNode;
  }) => (
    <div data-testid="canvas-shell">
      {(nodes ?? []).map((node) => (
        // A <button> stands in for xyflow's focusable `.react-flow__node` wrapper — it carries the
        // same class+data-id DOM contract the WP's real click/keyboard handlers read, and being
        // natively interactive it needs no tabIndex/keyboard-handler a11y shims in this stub.
        <button
          type="button"
          key={node.id}
          className="react-flow__node react-flow__node-brand"
          data-id={node.id}
          data-selected={node.selected ? "true" : "false"}
          onClick={(event) => onNodeClick?.(event, node)}
        >
          {node.data?.title}
        </button>
      ))}
      {children}
    </div>
  ),
}));

import { MissionBoard, reconstructMissionBoard, type MissionBoardView } from "./MissionBoard";
import { MissionExpandDialog } from "./MissionExpandDialog";

// ── FakeEventSource (AgentTranscript's Live stream) ─────────────────────────────────────────────────
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
  static bySession(sessionId: string): FakeEventSource | undefined {
    return FakeEventSource.instances.find((es) => es.url.includes(`/sessions/${sessionId}/`));
  }
}

beforeEach(() => {
  FakeEventSource.instances = [];
  (globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
});
afterEach(() => {
  (globalThis as unknown as { EventSource: unknown }).EventSource = undefined;
});

// ── Fixtures ────────────────────────────────────────────────────────────────────────────────────────
function ev<T extends HubEvent["type"]>(e: Extract<HubEvent, { type: T }>): HubEvent {
  return e as HubEvent;
}
const GRANTS: HubToolGrants = { servers: {}, builtins: [] };
function planned(key: string, name: string, model: string): HubPlannedAgent {
  return {
    key,
    name,
    systemPrompt: "s",
    model,
    toolGrants: GRANTS,
    skillIds: [],
    brief: "b",
    target: "t",
    expectedOutcome: "o",
  };
}
const PLAN: HubMissionPlan = {
  topology: "best_of_n",
  autonomy: "auto",
  agents: [planned("a", "Researcher A", "claude-sonnet-5"), planned("b", "Researcher B", "gpt-4o")],
};
function report(over: Partial<HubAgentReport> = {}): HubAgentReport {
  return {
    summary: "A summary",
    findings: [{ summary: "A finding" }],
    citations: [],
    artifacts: [],
    confidence: "high",
    openQuestions: ["What about Z?"],
    ...over,
  };
}

/** best_of_n, mission RUNNING: child-a reported, child-b still working. Has agent + judge + terminal
 *  nodes; child-b's default panel tab is Live (it hasn't reported). */
function runningBoard(): MissionBoardView {
  const events: HubEvent[] = [
    ev({ type: "plan_proposed", missionId: "m", plan: PLAN }),
    ev({ type: "plan_approved", missionId: "m", auto: true }),
    ev({ type: "mission_started", missionId: "m", agentSessionIds: ["child-a", "child-b"] }),
    ev({ type: "agent_spawned", missionId: "m", agentSessionId: "child-a", key: "a", roleName: "Researcher A", model: "claude-sonnet-5", index: 0 }),
    ev({ type: "agent_spawned", missionId: "m", agentSessionId: "child-b", key: "b", roleName: "Researcher B", model: "gpt-4o", index: 1 }),
    ev({ type: "agent_report", missionId: "m", agentSessionId: "child-a", report: report() }),
  ];
  const board = reconstructMissionBoard(events);
  if (!board) throw new Error("no board");
  return board;
}

/** best_of_n, mission DONE: both reported, child-a is the synthesis' sole ref (the best_of_n winner). */
function doneBoard(): MissionBoardView {
  const events: HubEvent[] = [
    ev({ type: "plan_proposed", missionId: "m", plan: PLAN }),
    ev({ type: "plan_approved", missionId: "m", auto: true }),
    ev({ type: "mission_started", missionId: "m", agentSessionIds: ["child-a", "child-b"] }),
    ev({ type: "agent_spawned", missionId: "m", agentSessionId: "child-a", key: "a", roleName: "Researcher A", model: "claude-sonnet-5", index: 0 }),
    ev({ type: "agent_spawned", missionId: "m", agentSessionId: "child-b", key: "b", roleName: "Researcher B", model: "gpt-4o", index: 1 }),
    ev({ type: "agent_report", missionId: "m", agentSessionId: "child-a", report: report() }),
    ev({ type: "agent_report", missionId: "m", agentSessionId: "child-b", report: report({ summary: "B summary", findings: [] }) }),
    ev({ type: "mission_synthesis", missionId: "m", messageId: "syn", partial: false, agentReportRefs: ["child-a"] }),
  ];
  const board = reconstructMissionBoard(events);
  if (!board) throw new Error("no board");
  return board;
}

function nodeEl(id: string): HTMLElement {
  const canvas = screen.getByTestId("canvas-shell");
  const el = canvas.querySelector<HTMLElement>(`[data-id="${id}"]`);
  if (!el) throw new Error(`no node ${id}`);
  return el;
}

const noop = () => {};

// ── Tests ─────────────────────────────────────────────────────────────────────────────────────────

describe("MissionExpandDialog", () => {
  test("the board's Expand button opens the full modal (topology + panel)", () => {
    render(<MissionBoard board={runningBoard()} />);
    // Closed by default: the modal's panel isn't in the DOM yet.
    expect(screen.queryByTestId("mission-expand-panel")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /expand mission graph/i }));
    expect(screen.getByTestId("mission-expand-panel")).toBeInTheDocument();
  });

  test("node selection (click) drives the right panel: agent → synthesis → judge", () => {
    render(<MissionExpandDialog board={doneBoard()} open onOpenChange={noop} />);
    const panel = screen.getByTestId("mission-expand-panel");

    // Default selection is the first agent (Researcher A, reported) — its report renders.
    expect(within(panel).getByText("A summary")).toBeInTheDocument();

    // Click the terminal node → the synthesis panel.
    fireEvent.click(nodeEl("__terminal__"));
    expect(within(panel).getByTestId("mission-expand-synthesis")).toBeInTheDocument();
    expect(within(panel).getByText(/Synthesis complete/i)).toBeInTheDocument();

    // Click the judge node → the judge step panel (a step, not a session), naming the winner.
    fireEvent.click(nodeEl("__judge__"));
    const judge = within(panel).getByTestId("mission-expand-judge");
    expect(judge).toBeInTheDocument();
    expect(within(judge).getByText("Researcher A")).toBeInTheDocument();
  });

  test("a finished agent node shows its report", () => {
    render(<MissionExpandDialog board={doneBoard()} open onOpenChange={noop} />);
    // Select the SECOND agent explicitly; a reported agent lands on its Report tab.
    fireEvent.click(nodeEl("child-b"));
    const panel = screen.getByTestId("mission-expand-panel");
    expect(within(panel).getByText("B summary")).toBeInTheDocument();
  });

  test("a running agent node streams a LIVE transcript incl. a tool-call card", () => {
    render(<MissionExpandDialog board={runningBoard()} open onOpenChange={noop} />);
    // child-b hasn't reported → selecting it lands on the Live tab, opening its session stream.
    fireEvent.click(nodeEl("child-b"));
    const es = FakeEventSource.bySession("child-b");
    if (!es) throw new Error("child-b stream not opened");

    act(() => {
      es.emit({ type: "user_message", messageId: "u1", text: "Investigate B", seq: 1 });
      es.emit({
        type: "tool_call",
        messageId: "m1",
        part: {
          type: "tool_call",
          toolCallId: "c1",
          toolName: "mcp__acme__search",
          source: "mcp",
          serverId: "acme",
          state: "input-available",
        },
        seq: 2,
      });
      es.emit({ type: "stream_delta", messageId: "m1", channel: "text", text: "Working" });
    });

    const panel = screen.getByTestId("mission-expand-panel");
    expect(within(panel).getByText("Investigate B")).toBeInTheDocument();
    expect(within(panel).getByTestId("tool-header").dataset.toolName).toBe("mcp__acme__search");
    expect(within(panel).getByText("Working")).toBeInTheDocument();
  });

  test("keyboard: Enter on a focused node selects it (drives the panel)", () => {
    render(<MissionExpandDialog board={doneBoard()} open onOpenChange={noop} />);
    // Enter on the judge node selects it — no mouse.
    fireEvent.keyDown(nodeEl("__judge__"), { key: "Enter" });
    expect(screen.getByTestId("mission-expand-judge")).toBeInTheDocument();
  });

  test("leaving a live node (or closing) unsubscribes the stream — no leak", () => {
    const { unmount } = render(
      <MissionExpandDialog board={runningBoard()} open onOpenChange={noop} />,
    );
    fireEvent.click(nodeEl("child-b"));
    const es = FakeEventSource.bySession("child-b");
    if (!es) throw new Error("child-b stream not opened");
    expect(es.closed).toBe(false);

    // Selecting a NON-agent node unmounts the Live transcript → its subscription tears down.
    fireEvent.click(nodeEl("__terminal__"));
    expect(es.closed).toBe(true);

    // And a full unmount (modal close) leaves nothing behind either.
    unmount();
  });

  test("closing the modal (open→false) tears the live subscription down", () => {
    const { rerender } = render(
      <MissionExpandDialog board={runningBoard()} open onOpenChange={noop} />,
    );
    fireEvent.click(nodeEl("child-b"));
    const es = FakeEventSource.bySession("child-b");
    if (!es) throw new Error("child-b stream not opened");
    expect(es.closed).toBe(false);
    rerender(
      <TooltipProvider>
        <MissionExpandDialog board={runningBoard()} open={false} onOpenChange={noop} />
      </TooltipProvider>,
    );
    expect(es.closed).toBe(true);
  });
});

// ── crew-nesting WP4.3 (D-CN2/D-CN5/D-CN8) — the sub-crew slot drills into a NESTED MissionExpandDialog ──

/** A 2-level nested board: "child-crew" is a sub-crew slot whose own sub-mission ("mis-child") has
 *  reported its one agent ("sub-x"). Built the same way `Mission.test.tsx`'s `nestedMissionLog` proves
 *  the reducer resolves `childBoard` — this file only needs the resulting BOARD, not the log mechanics. */
function nestedBoard(): MissionBoardView {
  const rootPlan: HubMissionPlan = {
    topology: "parallel",
    autonomy: "auto",
    agents: [
      planned("lead", "Lead Researcher", "claude-sonnet-5"),
      { ...planned("crew-slot", "Strategy Crew", "claude-sonnet-5"), crewId: "crew-x" },
    ],
  };
  const subPlan: HubMissionPlan = {
    topology: "parallel",
    autonomy: "auto",
    agents: [planned("sub-x", "BI Analyst", "gpt-4o")],
  };
  const events: HubEvent[] = [
    ev({ type: "plan_proposed", missionId: "mis-root", plan: rootPlan }),
    ev({ type: "plan_approved", missionId: "mis-root", auto: true }),
    ev({ type: "agent_spawned", missionId: "mis-root", agentSessionId: "child-lead", key: "lead", roleName: "Lead Researcher", model: "claude-sonnet-5", index: 0 }),
    ev({ type: "agent_spawned", missionId: "mis-root", agentSessionId: "child-crew", key: "crew-slot", roleName: "Strategy Crew", model: "claude-sonnet-5", index: 1 }),
    ev({ type: "mission_started", missionId: "mis-root", agentSessionIds: ["child-lead", "child-crew"] }),
    ev({ type: "agent_report", missionId: "mis-root", agentSessionId: "child-lead", report: report({ summary: "Lead summary" }) }),
    ev({ type: "plan_proposed", missionId: "mis-child", plan: subPlan, parentMissionId: "mis-root", parentAgentKey: "crew-slot" }),
    ev({ type: "plan_approved", missionId: "mis-child", auto: true }),
    ev({ type: "agent_spawned", missionId: "mis-child", agentSessionId: "sub-x", key: "sub-x", roleName: "BI Analyst", model: "gpt-4o", index: 0 }),
    ev({ type: "mission_started", missionId: "mis-child", agentSessionIds: ["sub-x"] }),
    ev({ type: "agent_report", missionId: "mis-child", agentSessionId: "sub-x", report: report({ summary: "Sub summary" }) }),
    ev({ type: "mission_synthesis", missionId: "mis-child", messageId: "sub-syn", partial: false, agentReportRefs: ["sub-x"] }),
    ev({
      type: "agent_report",
      missionId: "mis-root",
      agentSessionId: "child-crew",
      report: report({ summary: "Crew summary", subMissionId: "mis-child", topology: "parallel", childReports: [] }),
    }),
    ev({ type: "mission_synthesis", missionId: "mis-root", messageId: "root-syn", partial: false, agentReportRefs: ["child-lead", "child-crew"] }),
  ];
  const board = reconstructMissionBoard(events);
  if (!board) throw new Error("no board");
  return board;
}

describe("MissionExpandDialog — sub-crew drill-in (crew-nesting WP4.3)", () => {
  test("a sub-crew slot's node shows its summary + 'Open sub-crew board'; clicking it renders a SECOND, nested MissionExpandDialog scoped to the sub-mission, showing the child's OWN topology/agents", () => {
    render(<MissionExpandDialog board={nestedBoard()} open onOpenChange={noop} />);

    fireEvent.click(nodeEl("child-crew"));
    const panel = screen.getByTestId("mission-expand-panel");
    const subcrew = within(panel).getByTestId("mission-expand-subcrew");
    expect(within(subcrew).getByText(/1 of 1 agents reported/)).toBeInTheDocument();

    // Not the ordinary agent panel (no Live/Report/Status tab strip for a resolved sub-crew slot).
    expect(within(panel).queryByRole("tab", { name: /live/i })).toBeNull();

    fireEvent.click(within(subcrew).getByRole("button", { name: /open sub-crew board/i }));

    // A second, nested `MissionExpandDialog` now renders — its own topology graph (+ default-selected
    // agent panel) shows the SUB-MISSION's own agent ("BI Analyst"), never the root's ("Lead
    // Researcher"/"Strategy Crew").
    expect(screen.getAllByTestId("canvas-shell")).toHaveLength(2);
    expect(screen.getAllByText("BI Analyst").length).toBeGreaterThan(0);
  });

  test("a still-unresolved sub-crew slot (no childBoard yet) falls through to the ordinary agent panel", () => {
    // The plain best_of_n `doneBoard()` fixture's agents carry no `crewId`/`childBoard` at all.
    render(<MissionExpandDialog board={doneBoard()} open onOpenChange={noop} />);
    const panel = screen.getByTestId("mission-expand-panel");
    expect(within(panel).queryByTestId("mission-expand-subcrew")).toBeNull();
  });
});
