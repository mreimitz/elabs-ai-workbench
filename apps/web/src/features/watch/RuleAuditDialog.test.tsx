import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { WatchRule, WatchRuleEvent } from "@mcp-token-footprint/shared";
import { TooltipProvider, toast } from "@elabs-ai/components-ui";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    listWatchRuleEvents: vi.fn(),
    testFireWatchRule: vi.fn(),
  };
});

import { listWatchRuleEvents, testFireWatchRule } from "../../lib/api";
import { RuleAuditDialog } from "./RuleAuditDialog";

const mockListEvents = vi.mocked(listWatchRuleEvents);
const mockTestFire = vi.mocked(testFireWatchRule);

const RULE_NO_WEBHOOK: WatchRule = {
  id: "rule-1",
  name: "High error rate",
  enabled: true,
  trigger: "on_terminal",
  filter: { outcome: ["error"] },
  actions: [{ type: "pin" }],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const RULE_WITH_WEBHOOK: WatchRule = {
  ...RULE_NO_WEBHOOK,
  id: "rule-2",
  actions: [{ type: "webhook", secretRef: "ref-1" }],
};

const EVENTS: WatchRuleEvent[] = [
  {
    id: "evt-1",
    ruleId: "rule-1",
    runId: "run-9",
    at: "2026-07-10T00:00:00.000Z",
    action: "pin",
    result: { ok: true, detail: "pinned run" },
  },
  {
    id: "evt-2",
    ruleId: "rule-1",
    runId: "run-8",
    at: "2026-07-09T00:00:00.000Z",
    action: "pin",
    result: { ok: false, error: "run not found" },
  },
];

function renderDialog(rule: WatchRule | null) {
  return render(
    <TooltipProvider>
      <RuleAuditDialog open={rule !== null} onOpenChange={() => {}} rule={rule} />
    </TooltipProvider>,
  );
}

beforeEach(() => {
  mockListEvents.mockReset();
  mockTestFire.mockReset();
});

describe("RuleAuditDialog", () => {
  test("renders fixture events with ok/failed badges + details", async () => {
    mockListEvents.mockResolvedValueOnce(EVENTS);
    renderDialog(RULE_NO_WEBHOOK);

    expect(await screen.findByText("pinned run")).toBeInTheDocument();
    expect(screen.getByText("run not found")).toBeInTheDocument();
    expect(screen.getByText("ok")).toBeInTheDocument();
    expect(screen.getByText("failed")).toBeInTheDocument();
  });

  test("an empty audit log renders the empty state, not broken UI", async () => {
    mockListEvents.mockResolvedValueOnce([]);
    renderDialog(RULE_NO_WEBHOOK);

    expect(await screen.findByText("No activity yet")).toBeInTheDocument();
  });

  test("no webhook action -> no test-fire button", async () => {
    mockListEvents.mockResolvedValueOnce([]);
    renderDialog(RULE_NO_WEBHOOK);
    await screen.findByText("No activity yet");
    expect(screen.queryByRole("button", { name: "Send test webhook" })).not.toBeInTheDocument();
  });

  test("a webhook action shows the test-fire button, wired to POST /api/watch-rules/:id/test-fire", async () => {
    mockListEvents.mockResolvedValue([]);
    mockTestFire.mockResolvedValueOnce({ ok: true, detail: "webhook responded 204" });
    const successSpy = vi.spyOn(toast, "success").mockImplementation(() => "" as never);

    renderDialog(RULE_WITH_WEBHOOK);
    const button = await screen.findByRole("button", { name: "Send test webhook" });
    fireEvent.click(button);

    await waitFor(() => expect(mockTestFire).toHaveBeenCalledWith("rule-2"));
    await waitFor(() =>
      expect(successSpy).toHaveBeenCalledWith(
        "Test webhook sent",
        expect.objectContaining({ description: "webhook responded 204" }),
      ),
    );
    successSpy.mockRestore();
  });
});
