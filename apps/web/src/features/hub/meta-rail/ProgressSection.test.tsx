import type { HubTaskItem } from "@mcp-token-footprint/shared";
import { fireEvent, render as rtlRender, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@elabs-ai/components-ui";
import type { ReactElement } from "react";

// Mirrors ArtifactCanvas.test.tsx's posture: stub the `@elabs-ai/components-ai`
// surface this section composes (`Task*`, and — indirectly, none here) with the shared hub stub.
vi.mock("@elabs-ai/components-ai", () => import("../test-support/brand-ai-mock"));

import type { MissionBoardView } from "../MissionBoard";
import { ProgressSection } from "./ProgressSection";

// The "send steering message" control renders an `IconButton` (D-TB5), which wraps every control
// in a Radix `Tooltip` — that throws without an ancestor `TooltipProvider` (the app root mounts
// one; this file's many render() call sites don't get it automatically).
function render(ui: ReactElement) {
  return rtlRender(<TooltipProvider>{ui}</TooltipProvider>);
}

function task(over: Partial<HubTaskItem> & { id: string }): HubTaskItem {
  return { title: over.id, status: "pending", ...over };
}

function missionFixture(over: Partial<MissionBoardView> = {}): MissionBoardView {
  return {
    missionId: "mis-1",
    plan: {
      topology: "parallel",
      autonomy: "always_ask",
      agents: [],
      rationale: "test",
    },
    phase: "running",
    approved: true,
    autoApproved: false,
    agents: [
      {
        agentSessionId: "a1",
        key: "a",
        roleName: "Researcher A",
        model: "claude-sonnet-5",
        index: 0,
        reported: true,
        report: {
          findings: [{ summary: "Found something" }],
          citations: [],
          artifacts: [],
          confidence: "high",
          openQuestions: [],
        },
      },
      {
        agentSessionId: "a2",
        key: "b",
        roleName: "Researcher B",
        model: "gpt-4o",
        index: 1,
        reported: false,
      },
    ],
    ...over,
  };
}

describe("ProgressSection (WP1.2, D-HUX3 — TaskWidget + mission agent summary)", () => {
  test("renders an EmptyState with no tasks and no mission", () => {
    render(<ProgressSection tasks={[]} />);
    expect(screen.getByText("No active work")).toBeInTheDocument();
  });

  test("renders the task list", () => {
    render(
      <ProgressSection
        tasks={[task({ id: "t1", title: "Scan the server", status: "in_progress" }), task({ id: "t2", title: "Write the report" })]}
      />,
    );
    expect(screen.getByText("Tasks (2)")).toBeInTheDocument();
    expect(screen.getByText("Scan the server")).toBeInTheDocument();
    expect(screen.getByText("Write the report")).toBeInTheDocument();
  });

  test("caps visible tasks at 5 with a Show N more control", () => {
    const tasks = Array.from({ length: 7 }, (_, i) => task({ id: `t${i}`, title: `Task ${i}` }));
    render(<ProgressSection tasks={tasks} />);
    expect(screen.getAllByTestId("task-item")).toHaveLength(5);
    const more = screen.getByRole("button", { name: /show 2 more/i });
    fireEvent.click(more);
    expect(screen.getAllByTestId("task-item")).toHaveLength(7);
  });

  test("renders a mission summary with per-agent status and no full topology graph/card grid", () => {
    render(<ProgressSection tasks={[]} missionBoard={missionFixture()} />);
    expect(screen.getByText("Mission")).toBeInTheDocument();
    expect(screen.getByText("Researcher A")).toBeInTheDocument();
    expect(screen.getByText("Researcher B")).toBeInTheDocument();
    expect(screen.getByText("1 of 2 agents reported")).toBeInTheDocument();
    // The full in-stream MissionBoard renders a topology graph + a Sparkles heading — this rail
    // summary intentionally has neither (§7.1: "the rail is its always-visible summary").
    expect(screen.queryByRole("img", { name: /topology/i })).not.toBeInTheDocument();
  });

  test("Stop mission fires onStopMission with the mission id while active", () => {
    const onStopMission = vi.fn();
    render(
      <ProgressSection tasks={[]} missionBoard={missionFixture({ phase: "running" })} onStopMission={onStopMission} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /stop mission/i }));
    expect(onStopMission).toHaveBeenCalledWith("mis-1");
  });

  test("steering a waiting agent fires onSteerAgent with the mission/agent id + text", () => {
    const onSteerAgent = vi.fn();
    render(
      <ProgressSection
        tasks={[]}
        missionBoard={missionFixture({ phase: "running" })}
        onSteerAgent={onSteerAgent}
      />,
    );
    const input = screen.getByLabelText("Steer Researcher B");
    fireEvent.change(input, { target: { value: "Focus on pricing" } });
    fireEvent.click(screen.getByRole("button", { name: /send steering message/i }));
    expect(onSteerAgent).toHaveBeenCalledWith("mis-1", "a2", "Focus on pricing");
  });

  test("no mid-word clipping contract: agent role name truncates inside a min-w-0 flex column", () => {
    render(
      <ProgressSection
        tasks={[]}
        missionBoard={missionFixture({
          agents: [
            {
              agentSessionId: "a1",
              key: "a",
              roleName: "A very long agent role name that must not clip mid-word in the 360px rail",
              model: "claude-sonnet-5",
              index: 0,
              reported: true,
            },
          ],
        })}
      />,
    );
    const name = screen.getByText(/A very long agent role name/);
    expect(name.className).toContain("truncate");
    expect(name.className).toContain("min-w-0");
  });
});
