import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@brand/ui";

// Observability WP5.4 acceptance #1 — the "Analyze with assistant" button opens the dock with the
// documented triage prompt. `useAssistant` is mocked so the click's effect (openAssistant call) is
// observed directly, without standing up the whole dock/stream machinery.
const mockOpenAssistant = vi.fn();
let authConfigured = true;

vi.mock("../assistant/assistant-context", () => ({
  useAssistant: () => ({ authConfigured, openAssistant: mockOpenAssistant }),
}));

import { OPEN_FLEET_ISSUE } from "./issue-fixtures";
import { IssueAssistantMount } from "./IssueAssistantMount";

function renderMount() {
  render(
    <TooltipProvider>
      <IssueAssistantMount issue={OPEN_FLEET_ISSUE} />
    </TooltipProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  authConfigured = true;
});

describe("IssueAssistantMount", () => {
  test("hidden entirely when the assistant is not configured", () => {
    authConfigured = false;
    renderMount();
    expect(screen.queryByRole("button", { name: /Analyze with assistant/i })).not.toBeInTheDocument();
  });

  test("clicking opens the dock with the prefilled 'triage this issue' prompt (never auto-sent)", () => {
    renderMount();
    fireEvent.click(screen.getByRole("button", { name: /Analyze with assistant/i }));
    expect(mockOpenAssistant).toHaveBeenCalledTimes(1);
    const arg = mockOpenAssistant.mock.calls[0]?.[0] as { prompt?: string; entity?: unknown };
    // A prompt is passed (the loop opener); NO entity is pinned (SHARED-FREE — "issue" is not an entity kind).
    expect(typeof arg.prompt).toBe("string");
    expect(arg.prompt).toContain(OPEN_FLEET_ISSUE.id);
    expect(arg.prompt).toContain("runs_rerun");
    expect(arg.entity).toBeUndefined();
  });
});
