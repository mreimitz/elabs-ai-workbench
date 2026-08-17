// Assistant Hub (roadmap/assistant-hub/, WP1.7) — the mission UI: the event-log reducer
// (`reconstructMissionBoard`, R-SES1), the editable plan card (D-AH6/R-UX6), the live board
// (R-UX4/R-UX9), and the in-band ConversationPane integration. The heavy `@elabs-ai/components-ai` surface is
// stubbed via the shared hub mock (see `test-support/brand-ai-mock.tsx`).

import type {
  HubAgentReport,
  HubEvent,
  HubMissionPlan,
  HubPlannedAgent,
} from "@mcp-token-footprint/shared";
import { TooltipProvider } from "@elabs-ai/components-ui";
import { fireEvent, render as rtlRender, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, test, vi } from "vitest";

vi.mock("@elabs-ai/components-ai", () => import("./test-support/brand-ai-mock"));

// ui-wave U1 — the SAME faithful @elabs-ai/components-flow stub MissionExpandDialog.test uses: real DOM contract
// (`[data-id]` nodes wired to `onNodeClick`) so the board's graph-driven selection is exercised.
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

import { ConversationPane, type ConversationStream } from "./ConversationPane";
import { MissionBoard, missionBoardToTopoInput, reconstructMissionBoard } from "./MissionBoard";
import { MissionPlanCard } from "./MissionPlanCard";

// MissionBoard/MissionPlanCard/ConversationPane all render `IconButton`s (D-TB5), which wrap every
// control in a Radix `Tooltip` — that throws without an ancestor `TooltipProvider` (the app root
// mounts one; this file's many render() call sites don't get it automatically), so `render` here is
// rebound to always supply one.
function render(ui: ReactElement) {
  return rtlRender(<TooltipProvider>{ui}</TooltipProvider>);
}

/** Radix `TabsTrigger` (the detail box's Status/Report strip, hub-fixes WP4.2) activates on mousedown
 *  — `fireEvent.click` alone never switches it in jsdom (mirrors `ArtifactCanvas.test.tsx`'s own
 *  verified pattern for the same `@elabs-ai/components-ui` component). */
function activateTab(container: HTMLElement, name: RegExp): void {
  const tab = within(container).getByRole("tab", { name });
  fireEvent.mouseDown(tab, { button: 0 });
  fireEvent.click(tab);
}

// ── Fixtures ────────────────────────────────────────────────────────────────────────────────────

function agent(over: Partial<HubPlannedAgent> & { key: string }): HubPlannedAgent {
  return {
    name: over.name ?? over.key,
    systemPrompt: "sys",
    model: "gpt-4o",
    toolGrants: { servers: {}, builtins: [] },
    skillIds: [],
    brief: `Brief for ${over.key}`,
    target: `Target ${over.key}`,
    expectedOutcome: "A report",
    ...over,
  };
}

const PLAN: HubMissionPlan = {
  topology: "parallel",
  autonomy: "always_ask",
  agents: [
    agent({ key: "a", name: "Researcher A", model: "claude-sonnet-5", rationale: "Because you asked about X.", estimatedCostUsd: 0.3 }),
    agent({ key: "b", name: "Researcher B", model: "gpt-4o", brief: "Investigate Y." }),
  ],
  rationale: "Two disjoint subtopics.",
  estimatedCostUsd: 0.6,
  budgets: { maxAgents: 6, maxParallel: 3, maxCostUsd: 2 },
};

function report(over: Partial<HubAgentReport> = {}): HubAgentReport {
  return {
    findings: [{ summary: "A finding" }],
    citations: [],
    artifacts: [],
    confidence: "high",
    openQuestions: [],
    ...over,
  };
}

let seq = 0;
function ev<T extends HubEvent["type"]>(e: Extract<HubEvent, { type: T }>): HubEvent {
  return { ...e, seq: ++seq } as HubEvent;
}

/** A parent session's event log for a mission at a given stage. */
function missionLog(stage: "proposed" | "running" | "done"): HubEvent[] {
  seq = 0;
  const missionId = "mis-1";
  const log: HubEvent[] = [
    ev({ type: "user_message", messageId: "u1", text: "Research X and Y" }),
    ev({ type: "plan_proposed", missionId, plan: PLAN }),
  ];
  if (stage === "proposed") {
    log.push(ev({ type: "turn_done" }));
    return log;
  }
  log.push(ev({ type: "plan_approved", missionId, autonomy: "always_ask", approvedBy: "user", auto: false }));
  log.push(ev({ type: "agent_spawned", missionId, agentSessionId: "child-a", key: "a", roleName: "Researcher A", model: "claude-sonnet-5", brief: "Investigate X.", index: 0 }));
  log.push(ev({ type: "agent_spawned", missionId, agentSessionId: "child-b", key: "b", roleName: "Researcher B", model: "gpt-4o", brief: "Investigate Y.", index: 1 }));
  log.push(ev({ type: "mission_started", missionId, agentSessionIds: ["child-a", "child-b"] }));
  if (stage === "running") {
    // Only agent A has reported so far.
    log.push(ev({ type: "agent_report", missionId, agentSessionId: "child-a", report: report({ agentSessionId: "child-a", roleName: "Researcher A", summary: "A summary", confidence: "high", openQuestions: ["What about Z?"] }) }));
    return log;
  }
  log.push(ev({ type: "agent_report", missionId, agentSessionId: "child-a", report: report({ agentSessionId: "child-a", roleName: "Researcher A", summary: "A summary", confidence: "high", openQuestions: ["What about Z?"], citations: [{ id: "1", title: "Src A", url: "https://a/x", agentRef: "child-a" }] }) }));
  log.push(ev({ type: "agent_report", missionId, agentSessionId: "child-b", report: report({ agentSessionId: "child-b", roleName: "Researcher B", summary: "B summary", confidence: "low" }) }));
  log.push(ev({ type: "mission_synthesis", missionId, messageId: "syn-1", partial: false, agentReportRefs: ["child-a", "child-b"] }));
  log.push(ev({ type: "assistant_message", messageId: "syn-1", model: "claude-sonnet-5", parts: [{ type: "text", text: "Final answer [1]." }], citations: [{ id: "1", title: "Src A", url: "https://a/x", agentRef: "child-a" }], artifactsTouched: [] }));
  log.push(ev({ type: "turn_done", messageId: "syn-1" }));
  return log;
}

// ── crew-nesting WP4.3 (D-CN7) fixtures — a nested mission TREE spans multiple `missionId`s in ONE log ──

/** A root plan with one ordinary agent ("lead") and one `crewId`-bearing sub-crew slot ("crew-slot"). */
const NESTED_ROOT_PLAN: HubMissionPlan = {
  topology: "parallel",
  autonomy: "always_ask",
  agents: [
    agent({ key: "lead", name: "Lead Researcher", model: "claude-sonnet-5" }),
    { ...agent({ key: "crew-slot", name: "Strategy Crew", model: "claude-sonnet-5" }), crewId: "crew-x" },
  ],
  budgets: { maxAgents: 6, maxParallel: 3, maxCostUsd: 5 },
};

const SUB_PLAN: HubMissionPlan = {
  topology: "parallel",
  autonomy: "auto",
  agents: [agent({ key: "sub-x", name: "BI Analyst", model: "gpt-4o" })],
};

/**
 * A 2-level nested tree: the root mission's own events PLUS the "crew-slot" agent's own sub-mission's
 * full event stream, appended to the SAME log (D-CN6 — every mission in a tree keeps `session_id` = the
 * root chat session). The root's "lead" agent settles with a real cost; the root's "crew-slot" agent's
 * OWN projected report (D-CN2 — one stamped `HubAgentReport` carrying `subMissionId`) lands with NO
 * `costUsd` of its own, so the rollup must fall back to the sub-mission's rolled cost.
 */
function nestedMissionLog(): HubEvent[] {
  seq = 0;
  const rootId = "mis-root";
  const childId = "mis-child";
  return [
    ev({ type: "user_message", messageId: "u1", text: "Plan strategy" }),
    ev({ type: "plan_proposed", missionId: rootId, plan: NESTED_ROOT_PLAN }),
    ev({ type: "plan_approved", missionId: rootId, autonomy: "always_ask", approvedBy: "user", auto: false }),
    ev({ type: "agent_spawned", missionId: rootId, agentSessionId: "child-lead", key: "lead", roleName: "Lead Researcher", model: "claude-sonnet-5", index: 0 }),
    ev({ type: "agent_spawned", missionId: rootId, agentSessionId: "child-crew", key: "crew-slot", roleName: "Strategy Crew", model: "claude-sonnet-5", index: 1 }),
    ev({ type: "mission_started", missionId: rootId, agentSessionIds: ["child-lead", "child-crew"] }),
    ev({ type: "agent_report", missionId: rootId, agentSessionId: "child-lead", report: report({ summary: "Lead summary" }), costUsd: 0.1 }),
    // The sub-mission's OWN full event stream (its own `plan_proposed` carries the load-bearing
    // parent-linkage back to the root's "crew-slot" agent, D-CN7).
    ev({ type: "plan_proposed", missionId: childId, plan: SUB_PLAN, parentMissionId: rootId, parentAgentKey: "crew-slot" }),
    ev({ type: "plan_approved", missionId: childId, auto: true }),
    ev({ type: "agent_spawned", missionId: childId, agentSessionId: "sub-x", key: "sub-x", roleName: "BI Analyst", model: "gpt-4o", index: 0, parentMissionId: rootId, parentAgentKey: "crew-slot" }),
    ev({ type: "mission_started", missionId: childId, agentSessionIds: ["sub-x"] }),
    ev({ type: "agent_report", missionId: childId, agentSessionId: "sub-x", report: report({ summary: "Sub summary" }), costUsd: 0.05 }),
    ev({ type: "mission_synthesis", missionId: childId, messageId: "sub-syn", partial: false, agentReportRefs: ["sub-x"] }),
    // The root's own "crew-slot" agent's projected report — D-CN2's up-flow envelope (no `costUsd` of
    // its own, forcing the rollup to fall back to the sub-mission's rolled cost).
    ev({
      type: "agent_report",
      missionId: rootId,
      agentSessionId: "child-crew",
      report: report({ summary: "Crew summary", subMissionId: childId, topology: "parallel", childReports: [] }),
    }),
    ev({ type: "mission_synthesis", missionId: rootId, messageId: "root-syn", partial: false, agentReportRefs: ["child-lead", "child-crew"] }),
  ];
}

/** Builds a straight-chain nested mission tree `root -> m1 -> m2 -> ... -> mN`, each level's sole agent
 *  ("next") expanding into the next mission via `crewId`. Proves the reducer's defensive depth guard
 *  stops recursion (rather than hanging) well short of an adversarially deep/corrupt replay log. */
function chainMissionLog(depth: number): HubEvent[] {
  seq = 0;
  const log: HubEvent[] = [];
  for (let level = 0; level <= depth; level++) {
    const missionId = level === 0 ? "root" : `chain-m${level}`;
    const parentLink =
      level === 0
        ? {}
        : { parentMissionId: level === 1 ? "root" : `chain-m${level - 1}`, parentAgentKey: "next" };
    const plan: HubMissionPlan = {
      topology: "parallel",
      autonomy: "auto",
      agents: [{ ...agent({ key: "next" }), crewId: `crew-${level}` }],
    };
    log.push(ev({ type: "plan_proposed", missionId, plan, ...parentLink }));
    log.push(ev({ type: "plan_approved", missionId, auto: true }));
    log.push(
      ev({
        type: "agent_spawned",
        missionId,
        agentSessionId: `child-${level}`,
        key: "next",
        roleName: "Next",
        model: "gpt-4o",
        index: 0,
        ...parentLink,
      }),
    );
    log.push(ev({ type: "mission_started", missionId, agentSessionIds: [`child-${level}`] }));
  }
  return log;
}

function streamOf(events: HubEvent[]): ConversationStream {
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
    // The timeline only carries user/assistant turns; the mission section renders from `events`.
    timeline: [
      { kind: "user", id: "u1", text: "Research X and Y" },
    ],
    tasks: [],
    pendingQueued: [],
  };
}

// ── reconstructMissionBoard (R-SES1 — replay from events alone) ─────────────────────────────────────

describe("reconstructMissionBoard", () => {
  test("a proposed log yields a proposed, un-approved board", () => {
    const board = reconstructMissionBoard(missionLog("proposed"));
    expect(board?.phase).toBe("proposed");
    expect(board?.approved).toBe(false);
    expect(board?.agents.length).toBe(0); // no agents spawned yet
    expect(board?.plan.agents.map((a) => a.key)).toEqual(["a", "b"]);
  });

  test("a completed log reconstructs the whole board (agents, reports, synthesis) INERT", () => {
    const events = missionLog("done");
    const board = reconstructMissionBoard(events);
    const board2 = reconstructMissionBoard(events);
    expect(board).toEqual(board2); // deterministic
    expect(board?.phase).toBe("done");
    expect(board?.approved).toBe(true);
    expect(board?.agents.length).toBe(2);
    expect(board?.agents.every((a) => a.reported && a.report)).toBe(true);
    expect(board?.agents.find((a) => a.key === "a")?.report?.openQuestions).toEqual(["What about Z?"]);
    expect(board?.synthesis?.partial).toBe(false);
  });

  test("undefined when the session has no mission", () => {
    expect(reconstructMissionBoard([ev({ type: "user_message", messageId: "u", text: "hi" })])).toBeUndefined();
  });

  // ── crew-nesting WP4.3 (D-CN7) — the reducer becomes a TREE, root selection stays a no-op on flat logs ──

  test("crew-nesting: every existing FLAT fixture reconstructs unchanged (no parent-linkage ⇒ every plan_proposed already qualifies as root)", () => {
    const flat = reconstructMissionBoard(missionLog("done"));
    expect(flat?.missionId).toBe("mis-1");
    expect(flat?.phase).toBe("done");
    expect(flat?.agents.every((a) => a.childBoard === undefined)).toBe(true);
    expect(flat?.rollup?.costKnown).toBe(false); // the pre-WP2.4-shaped fixture carries no per-agent cost
  });

  test("crew-nesting: a 2-level nested fixture attaches the sub-crew slot's own sub-mission as childBoard", () => {
    const board = reconstructMissionBoard(nestedMissionLog());
    expect(board?.missionId).toBe("mis-root");
    expect(board?.phase).toBe("done");

    const crewSlot = board?.agents.find((a) => a.key === "crew-slot");
    expect(crewSlot?.childBoard).toBeDefined();
    const childBoard = crewSlot!.childBoard!;
    // The sub-mission's OWN phase/agents/synthesis, not a copy of the root's.
    expect(childBoard.missionId).toBe("mis-child");
    expect(childBoard.plan).toBe(SUB_PLAN);
    expect(childBoard.phase).toBe("done");
    expect(childBoard.agents.map((a) => a.key)).toEqual(["sub-x"]);
    expect(childBoard.agents[0]?.reported).toBe(true);
    expect(childBoard.synthesis?.partial).toBe(false);
    expect(childBoard.synthesis?.agentReportRefs).toEqual(["sub-x"]);
  });

  test("crew-nesting: MissionBoardView.rollup sums the 2-level fixture's spend correctly", () => {
    const board = reconstructMissionBoard(nestedMissionLog());
    // Root's own "lead" settled at $0.10; "crew-slot" has NO costUsd of its own (its `agent_report`
    // never carried one) — the rollup must fall back to the sub-mission's OWN rolled cost ($0.05).
    const crewSlot = board?.agents.find((a) => a.key === "crew-slot");
    expect(crewSlot?.costUsd).toBeUndefined();
    expect(crewSlot?.childBoard?.rollup?.costUsd).toBeCloseTo(0.05);
    expect(board?.rollup?.costKnown).toBe(true);
    expect(board?.rollup?.costUsd).toBeCloseTo(0.15); // 0.10 (lead) + 0.05 (sub-mission's rolled cost)
  });

  test("crew-nesting: a cyclic parent-linkage (adversarial/malformed log) does not loop — the guard leaves childBoard undefined", () => {
    seq = 0;
    const rootPlan: HubMissionPlan = {
      topology: "parallel",
      autonomy: "auto",
      agents: [{ ...agent({ key: "toA" }), crewId: "crew-a" }],
    };
    const aPlan: HubMissionPlan = {
      topology: "parallel",
      autonomy: "auto",
      agents: [{ ...agent({ key: "toRoot" }), crewId: "crew-root" }],
    };
    const events: HubEvent[] = [
      ev({ type: "plan_proposed", missionId: "root", plan: rootPlan }),
      ev({ type: "plan_approved", missionId: "root", auto: true }),
      ev({ type: "agent_spawned", missionId: "root", agentSessionId: "child-toA", key: "toA", roleName: "To A", model: "gpt-4o", index: 0 }),
      ev({ type: "mission_started", missionId: "root", agentSessionIds: ["child-toA"] }),

      ev({ type: "plan_proposed", missionId: "mis-a", plan: aPlan, parentMissionId: "root", parentAgentKey: "toA" }),
      ev({ type: "plan_approved", missionId: "mis-a", auto: true }),
      ev({ type: "agent_spawned", missionId: "mis-a", agentSessionId: "child-toRoot", key: "toRoot", roleName: "Back to root", model: "gpt-4o", index: 0 }),
      ev({ type: "mission_started", missionId: "mis-a", agentSessionIds: ["child-toRoot"] }),

      // The adversarial link: "mis-a"'s own "toRoot" agent claims the ROOT mission as its own child
      // sub-mission — a direct cycle back to an ancestor already on the current recursion path.
      ev({ type: "plan_proposed", missionId: "root", plan: rootPlan, parentMissionId: "mis-a", parentAgentKey: "toRoot" }),
    ];

    const started = Date.now();
    const board = reconstructMissionBoard(events);
    expect(Date.now() - started).toBeLessThan(1000); // never hangs

    expect(board?.missionId).toBe("root"); // root selection still picks the ROOT-scoped plan_proposed
    const toA = board?.agents.find((a) => a.key === "toA");
    expect(toA?.childBoard?.missionId).toBe("mis-a");
    // "mis-a"'s own "toRoot" agent WOULD resolve back to "root" (already on the path) — the guard stops it.
    expect(toA?.childBoard?.agents.find((a) => a.key === "toRoot")?.childBoard).toBeUndefined();
  });

  test("crew-nesting: an adversarially deep chain does not hang — recursion stops well short of the full depth via the defensive cap", () => {
    const events = chainMissionLog(9); // root + 9 further nested levels — well past the defensive cap
    const started = Date.now();
    const board = reconstructMissionBoard(events);
    expect(Date.now() - started).toBeLessThan(1000); // never hangs / stack-overflows

    expect(board?.missionId).toBe("root");
    let current = board;
    let hops = 0;
    while (current?.agents[0]?.childBoard) {
      current = current.agents[0].childBoard;
      hops++;
    }
    // The guard bounds the walk well short of the full 9-level chain the log actually contains.
    expect(hops).toBeGreaterThan(0);
    expect(hops).toBeLessThan(9);
  });

  test("crew-nesting: missionBoardToTopoInput marks the sub-crew slot's node isCrew, with its member count; a plain agent node carries neither", () => {
    const board = reconstructMissionBoard(nestedMissionLog())!;
    const input = missionBoardToTopoInput(board);
    const byId = new Map(input.agents.map((a) => [a.id, a]));
    expect(byId.get("child-crew")?.isCrew).toBe(true);
    expect(byId.get("child-crew")?.memberCount).toBe(1); // the sub-mission's one agent, "sub-x"
    expect(byId.get("child-lead")?.isCrew).toBeUndefined();
    expect(byId.get("child-lead")?.memberCount).toBeUndefined();
  });
});

// ── MissionPlanCard (D-AH6 / R-UX6) ────────────────────────────────────────────────────────────────

describe("MissionPlanCard", () => {
  test("renders each agent (role, model, brief, per-agent rationale) and the plan meta", () => {
    render(<MissionPlanCard missionId="mis-1" plan={PLAN} />);
    expect(screen.getByText("Researcher A")).toBeTruthy();
    expect(screen.getByText("Researcher B")).toBeTruthy();
    expect(screen.getByText("Investigate Y.")).toBeTruthy();
    expect(screen.getByText("Because you asked about X.")).toBeTruthy(); // R-UX6 per-agent rationale
    expect(screen.getByText("Two disjoint subtopics.")).toBeTruthy();
  });

  test("Approve calls onApprove with the mission id", () => {
    const onApprove = vi.fn();
    render(<MissionPlanCard missionId="mis-1" plan={PLAN} onApprove={onApprove} />);
    fireEvent.click(screen.getByRole("button", { name: /approve & run/i }));
    expect(onApprove).toHaveBeenCalledWith("mis-1");
  });

  test("removing an agent PATCHes the plan minus that agent (editable — D-AH6)", () => {
    const onEditPlan = vi.fn();
    render(<MissionPlanCard missionId="mis-1" plan={PLAN} onEditPlan={onEditPlan} />);
    fireEvent.click(screen.getByRole("button", { name: /remove researcher b/i }));
    expect(onEditPlan).toHaveBeenCalledTimes(1);
    const [, editedPlan] = onEditPlan.mock.calls[0]!;
    expect((editedPlan as HubMissionPlan).agents.map((a) => a.key)).toEqual(["a"]);
  });

  test("Cancel calls onCancel", () => {
    const onCancel = vi.fn();
    render(<MissionPlanCard missionId="mis-1" plan={PLAN} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledWith("mis-1");
  });
});

// ── MissionBoard (R-UX4 / R-UX9) ───────────────────────────────────────────────────────────────────

describe("MissionBoard", () => {
  test("reported agent confidence renders in the detail box; queues the waiting; stop-all wired", () => {
    const board = reconstructMissionBoard(missionLog("running"))!;
    const onStopMission = vi.fn();
    render(<MissionBoard board={board} onStopMission={onStopMission} />);
    // ui-wave U1: the compact card grid is gone; confidence renders in the detail box's Status tab
    // for the selected (first reported) agent (R-UX9).
    const detail = screen.getByTestId("mission-agent-detail");
    expect(within(detail).getByText("high")).toBeTruthy();
    // Agent B is still waiting → in the queue.
    const queue = screen.getByTestId("mission-queue");
    expect(within(queue).getByText("Researcher B")).toBeTruthy();
    // Stop-all (running mission).
    fireEvent.click(screen.getByRole("button", { name: /stop mission/i }));
    expect(onStopMission).toHaveBeenCalledWith("mis-1");
  });

  test("the topology node represents the agent (brief preview moved onto the graph)", () => {
    const board = reconstructMissionBoard(missionLog("running"))!;
    render(<MissionBoard board={board} />);
    // ui-wave U1: the card grid is gone; the agent renders as a graph NODE (the flow stub renders
    // node titles), and its brief rides the node's preview slot.
    expect(screen.getByTestId("canvas-shell").querySelector('[data-id="child-a"]')).toBeTruthy();
  });

  test("WP2.3 — a running agent can be steered from the queue (R-SES3/R-UX4)", () => {
    const board = reconstructMissionBoard(missionLog("running"))!;
    const onSteerAgent = vi.fn();
    render(<MissionBoard board={board} onSteerAgent={onSteerAgent} />);
    // The still-waiting agent (Researcher B) gets an inline steer composer.
    const input = screen.getByRole("textbox", { name: /steer researcher b/i });
    fireEvent.change(input, { target: { value: "focus on pricing" } });
    fireEvent.click(screen.getByRole("button", { name: /send steering message/i }));
    expect(onSteerAgent).toHaveBeenCalledWith("mis-1", "child-b", "focus on pricing");
  });

  test("WP2.3 — no steer composer when steering isn't offered", () => {
    const board = reconstructMissionBoard(missionLog("running"))!;
    render(<MissionBoard board={board} />);
    expect(screen.queryByRole("textbox", { name: /steer/i })).toBeNull();
  });

  test("a partial synthesis is honestly marked (R-UX9)", () => {
    const events = missionLog("done");
    // Rewrite the synthesis event to partial.
    const partialEvents = events.map((e) =>
      e.type === "mission_synthesis" ? { ...e, partial: true } : e,
    );
    const board = reconstructMissionBoard(partialEvents)!;
    render(<MissionBoard board={board} />);
    expect(screen.getByText("partial")).toBeTruthy(); // header badge shows even while collapsed
    // A done mission auto-collapses; expand it to reveal the synthesis marker.
    fireEvent.click(screen.getByRole("button", { name: /expand mission details/i }));
    expect(screen.getByText(/Partial synthesis/i)).toBeTruthy();
  });

  test("a done mission board auto-collapses and toggles back open (owner feedback)", () => {
    const board = reconstructMissionBoard(missionLog("done"))!;
    render(<MissionBoard board={board} />);
    // Collapsed by default once done: the detail (synthesis marker) is hidden, header still shows.
    expect(screen.getByText("Mission")).toBeTruthy();
    expect(screen.queryByText(/Synthesis complete/i)).toBeNull();
    // Expand → detail appears.
    fireEvent.click(screen.getByRole("button", { name: /expand mission details/i }));
    expect(screen.getByText(/Synthesis complete/i)).toBeTruthy();
    // Collapse again → detail hidden.
    fireEvent.click(screen.getByRole("button", { name: /collapse mission details/i }));
    expect(screen.queryByText(/Synthesis complete/i)).toBeNull();
  });

  test("a running mission board stays expanded (details visible without a click)", () => {
    const board = reconstructMissionBoard(missionLog("running"))!;
    render(<MissionBoard board={board} />);
    // The topology graph / queue are visible immediately (no expand needed) while the mission runs.
    expect(screen.getByRole("button", { name: /collapse mission details/i })).toBeTruthy();
  });

  // ── ui-wave U1 — graph-driven selection, persistent detail tab, no duplicate grid ───────────────

  function boardNode(id: string): HTMLElement {
    const canvas = screen.getByTestId("canvas-shell");
    const el = canvas.querySelector<HTMLElement>(`[data-id="${id}"]`);
    if (!el) throw new Error(`no node ${id}`);
    return el;
  }

  test("U1 — the duplicate agent-card grid is GONE; the topology graph is the selector", () => {
    const board = reconstructMissionBoard(missionLog("done"))!;
    render(<MissionBoard board={board} />);
    fireEvent.click(screen.getByRole("button", { name: /expand mission details/i }));
    expect(screen.queryByTestId("mission-agent-grid")).toBeNull();
    // Both agent nodes exist on the canvas and act as the detail box's selectors.
    expect(boardNode("child-a")).toBeTruthy();
    expect(boardNode("child-b")).toBeTruthy();
  });

  test("U1 — clicking a graph node drives the detail box (default = first reported agent)", () => {
    const board = reconstructMissionBoard(missionLog("done"))!;
    render(<MissionBoard board={board} />);
    fireEvent.click(screen.getByRole("button", { name: /expand mission details/i }));

    // Zero-selection default: the first reported agent's detail is already shown.
    const detail = screen.getByTestId("mission-agent-detail");
    expect(within(detail).getByText("claude-sonnet-5")).toBeTruthy();

    // Clicking the OTHER agent's node swaps the detail box to it.
    fireEvent.click(boardNode("child-b"));
    const detail2 = screen.getByTestId("mission-agent-detail");
    expect(within(detail2).getByText("gpt-4o")).toBeTruthy();
  });

  test("U1 — the chosen detail tab PERSISTS across node switches (owner feedback)", () => {
    const board = reconstructMissionBoard(missionLog("done"))!;
    render(<MissionBoard board={board} />);
    fireEvent.click(screen.getByRole("button", { name: /expand mission details/i }));

    const detail = screen.getByTestId("mission-agent-detail");
    // Status tab is the default: model + confidence for the selected (first) agent, Researcher A.
    expect(within(detail).getByText("claude-sonnet-5")).toBeTruthy();
    expect(within(detail).getByText("high")).toBeTruthy();
    // The open question isn't visible yet — it lives in the (inactive) Report tab.
    expect(within(detail).queryByText("What about Z?")).toBeNull();

    // Switch to Report — the full findings/open-questions render.
    activateTab(detail, /report/i);
    expect(within(detail).getByText("A summary")).toBeTruthy();
    expect(within(detail).getByText("A finding")).toBeTruthy();
    expect(within(detail).getByText("What about Z?")).toBeTruthy();

    // Selecting another node swaps the agent but KEEPS the Report tab active (owner feedback: a tab
    // choice is a viewing mode, not per-agent state).
    fireEvent.click(boardNode("child-b"));
    const detail2 = screen.getByTestId("mission-agent-detail");
    expect(within(detail2).getByText("B summary")).toBeTruthy();
    expect(within(detail2).getByRole("tab", { name: /report/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    // And back — still Report.
    fireEvent.click(boardNode("child-a"));
    expect(
      within(screen.getByTestId("mission-agent-detail")).getByRole("tab", { name: /report/i }),
    ).toHaveAttribute("aria-selected", "true");
  });

  test("RC6.3 — a long/verbose report stays contained (min-w-0) and long findings/open-question lists truncate with a Show-more expand, not overflow", () => {
    const missionId = "mis-2";
    const longSummary = "A".repeat(400);
    const manyFindings = Array.from({ length: 7 }, (_, i) => ({
      summary: `Finding ${i + 1} — ${"y".repeat(150)}`,
    }));
    const manyQuestions = Array.from(
      { length: 8 },
      (_, i) => `Open question number ${i + 1} — ${"x".repeat(120)}`,
    );
    const events: HubEvent[] = [
      ev({ type: "user_message", messageId: "u1", text: "Go" }),
      ev({ type: "plan_proposed", missionId, plan: PLAN }),
      ev({ type: "plan_approved", missionId, autonomy: "always_ask", approvedBy: "user", auto: false }),
      ev({
        type: "agent_spawned",
        missionId,
        agentSessionId: "verbose-a",
        key: "a",
        roleName: "Verbose Researcher",
        model: "claude-sonnet-5",
        index: 0,
      }),
      ev({ type: "mission_started", missionId, agentSessionIds: ["verbose-a"] }),
      ev({
        type: "agent_report",
        missionId,
        agentSessionId: "verbose-a",
        report: report({ summary: longSummary, findings: manyFindings, openQuestions: manyQuestions }),
      }),
    ];
    const board = reconstructMissionBoard(events)!;
    render(<MissionBoard board={board} />);
    // Still running (no synthesis event) — the board stays expanded, no click needed; the single
    // reported agent is the zero-selection default (ui-wave U1: no grid, the graph selects).

    const detail = screen.getByTestId("mission-agent-detail");
    activateTab(detail, /report/i);

    // Only the visible cap renders up front; a "Show N more" affordance covers the rest — truncate
    // WITH expand, never an unbounded render (the design note's "not overflow").
    expect(within(detail).getAllByText(/^Finding \d+/).length).toBe(5);
    fireEvent.click(within(detail).getByRole("button", { name: /show 2 more findings/i }));
    expect(within(detail).getAllByText(/^Finding \d+/).length).toBe(7);

    expect(within(detail).getAllByText(/^Open question number/).length).toBe(5);
    fireEvent.click(within(detail).getByRole("button", { name: /^show 3 more$/i }));
    expect(within(detail).getAllByText(/^Open question number/).length).toBe(8);
  });

  // ── hub-fixes WP2.4 — real per-agent + mission spend on the board ──────────────────────────────

  test("WP2.4 — real per-agent cost renders on the Status tab + the header's spent/max (not the compact card)", () => {
    // Rewrite the `agent_report` events (missionLog's own fixture omits cost/tokens — an old-shaped
    // log) to carry real per-agent cost/tokens, exactly as `orchestrator.ts` now emits them.
    const events = missionLog("done").map((e) =>
      e.type === "agent_report"
        ? {
            ...e,
            costUsd: e.agentSessionId === "child-a" ? 0.42 : 0.18,
            tokensIn: e.agentSessionId === "child-a" ? 1200 : 800,
            tokensOut: e.agentSessionId === "child-a" ? 300 : 150,
          }
        : e,
    );
    const board = reconstructMissionBoard(events)!;
    render(<MissionBoard board={board} />);

    // Header (always visible, even collapsed): real spend $0.42 + $0.18 = $0.60 against the plan's
    // $2.00 budget (PLAN.budgets.maxCostUsd) — never the pre-fix fiction (analysis.md RC2).
    expect(screen.getByText(/spent \$0\.60 \/ \$2\.00/)).toBeTruthy();

    // A done mission auto-collapses; expand it to reach the detail box (ui-wave U1: no card grid).
    fireEvent.click(screen.getByRole("button", { name: /expand mission details/i }));

    // The Status tab (default-selected, Researcher A) shows the cost + real tokens.
    const detail = screen.getByTestId("mission-agent-detail");
    expect(within(detail).getByText("$0.42")).toBeTruthy();
    expect(within(detail).getByText(/1,200 in \/ 300 out/)).toBeTruthy();
  });

  test("WP2.4 — a pre-fix log with no cost on its agent_report events shows no fabricated spend", () => {
    // The ORIGINAL `missionLog("done")` fixture carries no costUsd/tokensIn/tokensOut on its
    // agent_report events (a pre-WP2.4 log) — the board must show real absence, not a fake $0.00.
    const board = reconstructMissionBoard(missionLog("done"))!;
    render(<MissionBoard board={board} />);
    // The budget is still known (from the plan), but "spent" is honestly unknown ("—"), not "$0.00".
    expect(screen.getByText(/spent — \/ \$2\.00/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /expand mission details/i }));
    const detail = screen.getByTestId("mission-agent-detail");
    expect(within(detail).queryByText("Cost")).toBeNull();
  });
});

// ── ConversationPane integration (in-band) ─────────────────────────────────────────────────────────

describe("ConversationPane — mission in-band", () => {
  test("renders the plan card for a proposed mission and approve is wired", () => {
    const onApproveMission = vi.fn();
    render(
      <ConversationPane
        stream={streamOf(missionLog("proposed"))}
        onStarterSelect={() => {}}
        mission={{ onApproveMission }}
      />,
    );
    expect(screen.getByTestId("mission-plan-card")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /approve & run/i }));
    expect(onApproveMission).toHaveBeenCalledWith("mis-1");
  });

  test("renders the board (not the plan card) once the mission is approved/running", () => {
    render(
      <ConversationPane stream={streamOf(missionLog("done"))} onStarterSelect={() => {}} mission={{}} />,
    );
    expect(screen.getByTestId("mission-board")).toBeTruthy();
    expect(screen.queryByTestId("mission-plan-card")).toBeNull();
  });
});

// ── v1-fixes (F7): follow-up chips from mission_followups ───────────────────────────────────────────

describe("mission followups (v1-fixes F7)", () => {
  function doneLogWithFollowups(): HubEvent[] {
    const log = missionLog("done");
    log.push(
      ev({
        type: "mission_followups",
        missionId: "mis-1",
        followups: [
          { question: "What about Z?", agentSessionId: "child-a", roleName: "Researcher A" },
          { question: "Is prior-year data available?", agentSessionId: "child-b", roleName: "Researcher B" },
        ],
      }),
    );
    return log;
  }

  test("reconstructMissionBoard surfaces the deduped open questions", () => {
    const board = reconstructMissionBoard(doneLogWithFollowups());
    expect(board?.followups?.map((f) => f.question)).toEqual([
      "What about Z?",
      "Is prior-year data available?",
    ]);
  });

  test("the board renders follow-up chips and clicking one proposes a follow-up mission", () => {
    const board = reconstructMissionBoard(doneLogWithFollowups());
    expect(board).toBeDefined();
    if (!board) return;
    const onProposeFollowup = vi.fn();
    render(<MissionBoard board={board} onProposeFollowup={onProposeFollowup} />);
    const chip = screen.getByRole("button", { name: /What about Z\?/ });
    fireEvent.click(chip);
    expect(onProposeFollowup).toHaveBeenCalledWith("What about Z?");
  });

  test("no chips render without a handler or without followups (pre-fix logs stay valid)", () => {
    const bare = reconstructMissionBoard(missionLog("done"));
    expect(bare?.followups).toBeUndefined();
    if (!bare) return;
    render(<MissionBoard board={bare} onProposeFollowup={vi.fn()} />);
    expect(screen.queryByText(/start a follow-up mission/i)).toBeNull();
  });
});
