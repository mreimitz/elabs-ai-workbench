// Assistant Hub (roadmap/assistant-hub/, WP2.2 · R-UX4) — the topology-graph renderer + the live
// mission-board mapping. Renders the REAL @brand/flow canvas under jsdom (the SkillGraphCanvas precedent
// — ResizeObserver is polyfilled in vitest.setup), asserting node labels reach the DOM.

import type { HubEvent, HubMissionPlan, HubPlannedAgent, HubToolGrants } from "@mcp-token-footprint/shared";
import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

// The `./MissionBoard` import chain pulls the REAL `@brand/ai`, whose index.js imports
// `@xyflow/react/dist/style.css` (unresolvable under the jsdom ESM loader). Mock `@brand/ai` (as
// Mission.test does) so that chain stays clean; the graph itself renders the REAL `@brand/flow` canvas.
vi.mock("@brand/ai", () => import("./test-support/brand-ai-mock"));

import { missionBoardToTopoInput, reconstructMissionBoard } from "./MissionBoard";
import { isTopoActivateKey, TopologyGraph, topoNodeIdFromEventTarget } from "./TopologyGraph";
import { TOPOLOGY_LEGEND, type TopoGraphInput } from "./topology-graph";

const EMPTY_GRANTS: HubToolGrants = { servers: {}, builtins: [] };
const planned = (key: string): HubPlannedAgent => ({
  key,
  name: `Role ${key}`,
  systemPrompt: "s",
  model: "gpt-4o",
  toolGrants: EMPTY_GRANTS,
  skillIds: [],
  brief: "b",
  target: "t",
  expectedOutcome: "o",
});

describe("TopologyGraph", () => {
  test("renders a node per member plus the terminal node", () => {
    const input: TopoGraphInput = {
      topology: "best_of_n",
      agents: [
        { id: "a", title: "Researcher", state: "reported" },
        { id: "b", title: "Analyst", state: "winner" },
      ],
      terminal: { state: "reported" },
    };
    render(<TopologyGraph input={input} ariaLabel="Best of N topology" />);
    expect(screen.getByRole("region", { name: "Best of N topology" })).toBeInTheDocument();
    expect(screen.getByText("Researcher")).toBeInTheDocument();
    expect(screen.getByText("Analyst")).toBeInTheDocument();
    expect(screen.getByText("Blind judge")).toBeInTheDocument();
  });

  test("an empty team renders a hint instead of a blank canvas", () => {
    render(<TopologyGraph input={{ topology: "parallel", agents: [] }} ariaLabel="empty" />);
    expect(screen.getByText(/Add at least one member/)).toBeInTheDocument();
  });

  test("the mission variant renders AGENT nodes as the rich card (name, technical, status, brief); synthesis stays plain", () => {
    const input: TopoGraphInput = {
      topology: "parallel",
      agents: [{ id: "a", title: "Researcher", subtitle: "claude-sonnet-5", state: "reported" }],
      terminal: { state: "reported" },
    };
    render(
      <TopologyGraph
        input={input}
        variant="mission"
        briefById={new Map([["a", "Investigate the regional sales numbers."]])}
        ariaLabel="Parallel topology"
      />,
    );
    // The rich MissionAgentNode: name + technical model line + 2-line brief preview + status label.
    expect(screen.getByText("Researcher")).toBeInTheDocument();
    expect(screen.getByText("claude-sonnet-5")).toBeInTheDocument();
    expect(screen.getByText("Investigate the regional sales numbers.")).toBeInTheDocument();
    expect(screen.getByText("reported")).toBeInTheDocument();
    // The synthesis terminal node still renders on the plain FlowNode (kind eyebrow + title).
    expect(screen.getAllByText("Synthesis").length).toBeGreaterThan(0);
  });

  test("renders the topology's one-line legend (RC6.1) — no empty-state hint, one per topology", () => {
    const input: TopoGraphInput = {
      topology: "debate",
      agents: [
        { id: "a", title: "Researcher", state: "reported" },
        { id: "b", title: "Analyst", state: "active" },
      ],
      terminal: { state: "waiting" },
    };
    render(<TopologyGraph input={input} ariaLabel="Debate topology" />);
    expect(screen.getByTestId("topology-graph-legend")).toHaveTextContent(TOPOLOGY_LEGEND.debate);
  });

  test("an empty team renders no legend (nothing to describe yet)", () => {
    render(<TopologyGraph input={{ topology: "debate", agents: [] }} ariaLabel="empty" />);
    expect(screen.queryByTestId("topology-graph-legend")).not.toBeInTheDocument();
  });

  // ── hub-fixes WP4.3 — selectable mode still renders the same nodes/legend (real canvas). ─────────
  test("a selectable graph renders its nodes + legend just like the read-only board graph", () => {
    const input: TopoGraphInput = {
      topology: "parallel",
      agents: [
        { id: "s-a", title: "Researcher", state: "active" },
        { id: "s-b", title: "Analyst", state: "reported" },
      ],
      terminal: { state: "active" },
    };
    render(
      <TopologyGraph
        input={input}
        ariaLabel="Parallel topology"
        selectable
        selectedNodeId="s-a"
        onSelectNode={() => {}}
      />,
    );
    expect(screen.getByRole("region", { name: "Parallel topology" })).toBeInTheDocument();
    expect(screen.getByText("Researcher")).toBeInTheDocument();
    expect(screen.getByText("Analyst")).toBeInTheDocument();
    expect(screen.getByTestId("topology-graph-legend")).toHaveTextContent(TOPOLOGY_LEGEND.parallel);
  });
});

// ── hub-fixes WP4.3 — the node-id / activation-key helpers (canvas-independent, unit-testable) ──────

describe("topoNodeIdFromEventTarget", () => {
  function reactFlowNode(id: string): { node: HTMLElement; inner: HTMLElement } {
    const node = document.createElement("div");
    node.className = "react-flow__node react-flow__node-brand";
    node.setAttribute("data-id", id);
    const inner = document.createElement("span");
    node.appendChild(inner);
    return { node, inner };
  }

  test("resolves the node id from the focused element or a descendant", () => {
    const { node, inner } = reactFlowNode("child-a");
    expect(topoNodeIdFromEventTarget(node)).toBe("child-a");
    expect(topoNodeIdFromEventTarget(inner)).toBe("child-a");
    // The synthetic terminal/judge ids resolve too — they're valid selection targets.
    expect(topoNodeIdFromEventTarget(reactFlowNode("__terminal__").node)).toBe("__terminal__");
  });

  test("returns null for canvas chrome (a zoom button, the pane) and non-elements", () => {
    expect(topoNodeIdFromEventTarget(document.createElement("button"))).toBeNull();
    expect(topoNodeIdFromEventTarget(null)).toBeNull();
    const bare = document.createElement("div");
    bare.className = "react-flow__node"; // missing data-id → not a valid target
    expect(topoNodeIdFromEventTarget(bare)).toBeNull();
  });
});

describe("isTopoActivateKey", () => {
  test("Enter and Space select a focused node; other keys don't", () => {
    expect(isTopoActivateKey("Enter")).toBe(true);
    expect(isTopoActivateKey(" ")).toBe(true);
    expect(isTopoActivateKey("Spacebar")).toBe(true);
    expect(isTopoActivateKey("Tab")).toBe(false);
    expect(isTopoActivateKey("a")).toBe(false);
  });
});

// ── missionBoardToTopoInput — live state derived from the event log (R-SES1 → R-UX4) ─────────────────

function ev<T extends HubEvent["type"]>(e: Extract<HubEvent, { type: T }>): HubEvent {
  return e as HubEvent;
}

describe("missionBoardToTopoInput", () => {
  const plan: HubMissionPlan = { topology: "best_of_n", autonomy: "auto", agents: [planned("a"), planned("b")] };

  test("maps reported/missing state and marks the best_of_n winner", () => {
    // A completed best_of_n mission: agent s-a reported (and won — it's the synthesis' sole ref), s-b never
    // reported.
    const events: HubEvent[] = [
      ev({ type: "plan_proposed", missionId: "m", plan }),
      ev({ type: "plan_approved", missionId: "m", auto: true }),
      ev({ type: "mission_started", missionId: "m", agentSessionIds: ["s-a", "s-b"] }),
      ev({ type: "agent_spawned", missionId: "m", agentSessionId: "s-a", key: "a", roleName: "Role a", model: "gpt-4o", index: 0 }),
      ev({ type: "agent_spawned", missionId: "m", agentSessionId: "s-b", key: "b", roleName: "Role b", model: "gpt-4o", index: 1 }),
      ev({
        type: "agent_report",
        missionId: "m",
        agentSessionId: "s-a",
        report: { findings: [], citations: [], artifacts: [], confidence: "high", openQuestions: [] },
      }),
      ev({ type: "mission_synthesis", missionId: "m", messageId: "syn", partial: true, agentReportRefs: ["s-a"] }),
    ];
    const board = reconstructMissionBoard(events)!;
    const input = missionBoardToTopoInput(board);
    expect(input.topology).toBe("best_of_n");
    const byId = new Map(input.agents.map((a) => [a.id, a]));
    expect(byId.get("s-a")!.state).toBe("winner"); // reported AND the synthesis' ref
    expect(byId.get("s-b")!.state).toBe("missing"); // never reported, mission done
    expect(input.terminal?.state).toBe("reported"); // phase done
  });

  test("a running agent that hasn't reported reads 'active'", () => {
    const events: HubEvent[] = [
      ev({ type: "plan_proposed", missionId: "m", plan: { ...plan, topology: "parallel" } }),
      ev({ type: "plan_approved", missionId: "m", auto: true }),
      ev({ type: "mission_started", missionId: "m", agentSessionIds: ["s-a"] }),
      ev({ type: "agent_spawned", missionId: "m", agentSessionId: "s-a", key: "a", roleName: "Role a", model: "gpt-4o", index: 0 }),
    ];
    const board = reconstructMissionBoard(events)!;
    const input = missionBoardToTopoInput(board);
    expect(input.agents[0]!.state).toBe("active"); // running, not yet reported
  });
});
