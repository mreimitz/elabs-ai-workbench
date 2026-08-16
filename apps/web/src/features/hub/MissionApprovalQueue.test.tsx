// Assistant Hub — hub-fixes WP2.5 (D-HF6): the mission board's `always_ask` APPROVAL QUEUE. The board
// reconstructs its pending approvals from the parent event log ALONE (R-SES1) — the `agent_approval_*`
// board-mirror events — and reuses the `@brand/ai` `ApprovalCard`; Approve/Deny route to the CHILD
// session's own `/approvals` endpoint via `decideHubApproval`. The heavy `@brand/ai` surface is stubbed
// via the shared hub mock; `lib/api` is spied so no real fetch fires. The live round-trip + both-theme
// look are owner-acceptance.

import type { HubEvent, HubMissionPlan } from "@mcp-token-footprint/shared";
import { fireEvent, render as rtlRender, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@brand/ui";
import type { ReactElement } from "react";

vi.mock("@brand/ai", () => import("./test-support/brand-ai-mock"));

// MissionBoard renders `IconButton`s (D-TB5), which wrap every control in a Radix `Tooltip` — that
// throws without an ancestor `TooltipProvider` (the app root mounts one; this file's render doesn't
// get it automatically).
function render(ui: ReactElement) {
  return rtlRender(<TooltipProvider>{ui}</TooltipProvider>);
}

const decideHubApproval = vi.fn((..._args: unknown[]): Promise<void> => Promise.resolve());
vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  decideHubApproval: (...args: unknown[]) => decideHubApproval(...args),
}));

import { MissionBoard, reconstructMissionBoard } from "./MissionBoard";

let seq = 0;
function ev<T extends HubEvent["type"]>(e: Extract<HubEvent, { type: T }>): HubEvent {
  return { ...e, seq: ++seq } as HubEvent;
}

const PLAN: HubMissionPlan = {
  topology: "parallel",
  autonomy: "always_ask",
  agents: [
    {
      key: "a",
      name: "Researcher A",
      systemPrompt: "sys",
      model: "gpt-4o",
      toolGrants: { servers: { "srv-1": "all" }, builtins: [] },
      skillIds: [],
      brief: "Investigate X.",
      target: "Investigate X.",
      expectedOutcome: "A report",
    },
  ],
};

/** A running always_ask mission whose one child agent has a gated tool call queued to the board. */
function runningLogWithPendingApproval(): HubEvent[] {
  seq = 0;
  const missionId = "mis-1";
  return [
    ev({ type: "user_message", messageId: "u1", text: "Investigate X." }),
    ev({ type: "plan_proposed", missionId, plan: PLAN }),
    ev({ type: "plan_approved", missionId, autonomy: "always_ask", approvedBy: "user", auto: false }),
    ev({
      type: "agent_spawned",
      missionId,
      agentSessionId: "child-a",
      key: "a",
      roleName: "Researcher A",
      model: "gpt-4o",
      brief: "Investigate X.",
      index: 0,
    }),
    ev({ type: "mission_started", missionId, agentSessionIds: ["child-a"] }),
    ev({
      type: "agent_approval_requested",
      missionId,
      agentSessionId: "child-a",
      roleName: "Researcher A",
      toolCallId: "tc-1",
      toolName: "mcp__srv-1__readtool",
      source: "mcp",
      serverId: "srv-1",
      annotations: { readOnlyHint: true },
      options: ["allow-once", "always"],
    }),
  ];
}

describe("reconstructMissionBoard — WP2.5 approval queue (R-SES1)", () => {
  test("an agent_approval_requested folds into pendingApprovals", () => {
    const board = reconstructMissionBoard(runningLogWithPendingApproval())!;
    expect(board.pendingApprovals).toHaveLength(1);
    const approval = board.pendingApprovals![0]!;
    expect(approval).toMatchObject({
      agentSessionId: "child-a",
      roleName: "Researcher A",
      toolCallId: "tc-1",
      toolName: "mcp__srv-1__readtool",
    });
  });

  test("a matching agent_approval_responded clears it from the queue", () => {
    const log = runningLogWithPendingApproval();
    log.push(
      ev({
        type: "agent_approval_responded",
        missionId: "mis-1",
        agentSessionId: "child-a",
        toolCallId: "tc-1",
        resolution: "allow-once",
        reason: "decided",
      }),
    );
    const board = reconstructMissionBoard(log)!;
    expect(board.pendingApprovals).toHaveLength(0);
  });
});

describe("MissionBoard — WP2.5 approval queue rendering + decision routing", () => {
  test("renders an ApprovalCard for a pending approval; Approve routes to the child /approvals", () => {
    decideHubApproval.mockClear();
    const board = reconstructMissionBoard(runningLogWithPendingApproval())!;
    render(<MissionBoard board={board} />);

    const queue = screen.getByTestId("mission-approval-queue");
    expect(within(queue).getByTestId("approval-card")).toBeTruthy();
    // The card names the role + the (pretty) tool name.
    expect(within(queue).getByText(/Researcher A/)).toBeTruthy();

    fireEvent.click(within(queue).getByRole("button", { name: /approve/i }));
    expect(decideHubApproval).toHaveBeenCalledWith("child-a", "tc-1", "allow-once");
  });

  test("Deny routes a `deny` decision to the child /approvals", () => {
    decideHubApproval.mockClear();
    const board = reconstructMissionBoard(runningLogWithPendingApproval())!;
    render(<MissionBoard board={board} />);
    const queue = screen.getByTestId("mission-approval-queue");
    fireEvent.click(within(queue).getByRole("button", { name: /deny/i }));
    expect(decideHubApproval).toHaveBeenCalledWith("child-a", "tc-1", "deny");
  });

  test("no approval queue renders when there are no pending approvals", () => {
    const log = runningLogWithPendingApproval();
    log.push(
      ev({
        type: "agent_approval_responded",
        missionId: "mis-1",
        agentSessionId: "child-a",
        toolCallId: "tc-1",
        resolution: "deny",
        reason: "timeout",
      }),
    );
    const board = reconstructMissionBoard(log)!;
    render(<MissionBoard board={board} />);
    expect(screen.queryByTestId("mission-approval-queue")).toBeNull();
  });
});
