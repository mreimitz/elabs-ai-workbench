import type { HubToolPart } from "@mcp-token-footprint/shared";
import { describe, expect, test } from "vitest";
import {
  isApprovalRelevantState,
  prettyToolName,
  taskStatusToStatus,
  toolUiPartApproval,
} from "./hub-tool-parts";

function part(overrides: Partial<HubToolPart> = {}): HubToolPart {
  return {
    type: "tool_call",
    toolCallId: "c1",
    toolName: "mcp__demo-server__demo_tool",
    source: "mcp",
    state: "input-available",
    ...overrides,
  };
}

describe("prettyToolName", () => {
  test("strips the mcp__<server>__ namespace", () => {
    expect(prettyToolName("mcp__demo-server__demo_tool")).toBe("demo_tool");
  });

  test("leaves a bare/builtin name unchanged", () => {
    expect(prettyToolName("tasks.create")).toBe("tasks.create");
  });
});

describe("toolUiPartApproval", () => {
  test("undefined when the part carries no approval at all", () => {
    expect(toolUiPartApproval(part())).toBeUndefined();
  });

  test("a pending approval-requested part maps to {id} only (no approved/reason yet)", () => {
    const result = toolUiPartApproval(
      part({ state: "approval-requested", approval: { options: ["allow-once", "always"] } }),
    );
    expect(result).toEqual({ id: "c1" });
  });

  test("a deny resolution maps to approved:false, carrying the note as reason", () => {
    const result = toolUiPartApproval(
      part({
        state: "output-denied",
        approval: { options: ["allow-once", "always"], resolution: "deny", note: "too risky" },
      }),
    );
    expect(result).toEqual({ id: "c1", approved: false, reason: "too risky" });
  });

  test("an allow-once/always resolution maps to approved:true", () => {
    const once = toolUiPartApproval(
      part({
        state: "approval-responded",
        approval: { options: ["allow-once", "always"], resolution: "allow-once" },
      }),
    );
    expect(once).toEqual({ id: "c1", approved: true });

    const always = toolUiPartApproval(
      part({
        state: "approval-responded",
        approval: { options: ["allow-once", "always"], resolution: "always" },
      }),
    );
    expect(always).toEqual({ id: "c1", approved: true });
  });
});

describe("isApprovalRelevantState", () => {
  test("true only for the three approval-leg states", () => {
    expect(isApprovalRelevantState("approval-requested")).toBe(true);
    expect(isApprovalRelevantState("approval-responded")).toBe(true);
    expect(isApprovalRelevantState("output-denied")).toBe(true);
  });

  test("false for the non-approval states", () => {
    expect(isApprovalRelevantState("input-streaming")).toBe(false);
    expect(isApprovalRelevantState("input-available")).toBe(false);
    expect(isApprovalRelevantState("output-available")).toBe(false);
    expect(isApprovalRelevantState("output-error")).toBe(false);
  });
});

describe("taskStatusToStatus", () => {
  test("maps every HubTaskStatus to a Status", () => {
    expect(taskStatusToStatus("pending")).toBe("pending");
    expect(taskStatusToStatus("in_progress")).toBe("running");
    expect(taskStatusToStatus("completed")).toBe("complete");
    expect(taskStatusToStatus("blocked")).toBe("skipped");
    expect(taskStatusToStatus("cancelled")).toBe("skipped");
  });
});
