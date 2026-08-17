import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { WatchRule, WatchRuleEvent } from "@mcp-token-footprint/shared";
import { TooltipProvider } from "@elabs-ai/components-ui";

// jsdom can't resolve @elabs-ai/components-charts' @visx deep imports — see RuleEditorDialog.test.tsx's identical
// note (the editor dialog this view mounts pulls in the Preview section's BarChart).
vi.mock("@elabs-ai/components-charts", () => ({
  BarChart: ({ children }: { children: ReactNode }) => <div data-testid="bar-chart">{children}</div>,
  Bar: () => null,
  BarXAxis: () => null,
  Grid: () => null,
  ChartTooltip: () => null,
}));

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    listWatchRules: vi.fn(),
    listWatchRuleEvents: vi.fn().mockResolvedValue([]),
    updateWatchRule: vi.fn(),
    deleteWatchRule: vi.fn(),
    testFireWatchRule: vi.fn(),
    listScenarios: vi.fn().mockResolvedValue([]),
    listSuites: vi.fn().mockResolvedValue([]),
    listServers: vi.fn().mockResolvedValue([]),
    listSkills: vi.fn().mockResolvedValue([]),
    listCollections: vi.fn().mockResolvedValue([]),
    createWatchRule: vi.fn(),
    previewWatchWindow: vi.fn(),
  };
});

import { deleteWatchRule, listWatchRuleEvents, listWatchRules, updateWatchRule } from "../../lib/api";
import { WatchRulesView } from "./WatchRulesView";

const mockListRules = vi.mocked(listWatchRules);
const mockListEvents = vi.mocked(listWatchRuleEvents);
const mockUpdate = vi.mocked(updateWatchRule);
const mockDelete = vi.mocked(deleteWatchRule);

if (typeof window.matchMedia !== "function") {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

const ERROR_RATE_RULE: WatchRule = {
  id: "rule-1",
  name: "High error rate",
  enabled: true,
  trigger: "on_terminal",
  filter: { outcome: ["error"] },
  actions: [{ type: "pin" }, { type: "webhook", secretRef: "ref-1" }],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const WINDOWED_RULE: WatchRule = {
  id: "rule-2",
  name: "Cost over budget",
  enabled: false,
  trigger: "windowed",
  filter: {},
  window: {
    measure: "costUsd",
    bucket: "day",
    window: "24h",
    op: ">=",
    threshold: 5,
    cooldownMinutes: 120,
  },
  actions: [{ type: "notify", severity: "critical" }],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const FIRE_EVENTS: WatchRuleEvent[] = [
  {
    id: "evt-1",
    ruleId: "rule-1",
    runId: "run-1",
    at: "2026-07-10T00:00:00.000Z",
    action: "pin",
    result: { ok: true, detail: "pinned run" },
  },
];

function renderView() {
  return render(
    <MemoryRouter>
      <TooltipProvider>
        <WatchRulesView />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockListRules.mockReset();
  mockListEvents.mockReset();
  mockUpdate.mockReset();
  mockDelete.mockReset();
  mockListRules.mockResolvedValue([ERROR_RATE_RULE, WINDOWED_RULE]);
  mockListEvents.mockImplementation((id: string) =>
    Promise.resolve(id === "rule-1" ? FIRE_EVENTS : []),
  );
});

describe("WatchRulesView — list", () => {
  test("renders each rule with its trigger chip, actions summary, and fire stats", async () => {
    renderView();

    expect(await screen.findByText("High error rate")).toBeInTheDocument();
    expect(screen.getByText("Cost over budget")).toBeInTheDocument();
    expect(screen.getByText("On terminal")).toBeInTheDocument();
    expect(screen.getByText("Windowed")).toBeInTheDocument();
    expect(screen.getByText("Pin run, Webhook")).toBeInTheDocument();
    expect(screen.getByText("Notify")).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText(/Fired 1×/)).toBeInTheDocument());
    expect(screen.getByText("Never fired")).toBeInTheDocument();
  });

  test("an empty rule list renders the empty state", async () => {
    mockListRules.mockReset();
    mockListRules.mockResolvedValue([]);
    renderView();
    expect(await screen.findByText("No watch rules yet")).toBeInTheDocument();
  });

  test("toggling enabled calls updateWatchRule optimistically", async () => {
    mockUpdate.mockResolvedValueOnce({ ...WINDOWED_RULE, enabled: true });
    renderView();
    await screen.findByText("Cost over budget");

    const disabledSwitch = screen.getByRole("switch", { name: "Enable Cost over budget" });
    fireEvent.click(disabledSwitch);

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith("rule-2", { enabled: true }));
  });

  test("a failed toggle rolls back the optimistic update", async () => {
    mockUpdate.mockRejectedValueOnce(new Error("network down"));
    renderView();
    await screen.findByText("Cost over budget");

    const disabledSwitch = screen.getByRole("switch", { name: "Enable Cost over budget" });
    fireEvent.click(disabledSwitch);

    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: "Enable Cost over budget" })).not.toBeChecked(),
    );
  });
});

describe("WatchRulesView — edit / duplicate / delete round-trip", () => {
  test("Edit opens the editor prefilled with the rule's name", async () => {
    renderView();
    const row = (await screen.findByText("High error rate")).closest("li") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Edit" }));

    expect(await screen.findByText("Edit High error rate")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("High error rate");
  });

  test("Duplicate (overflow menu) opens the editor with a prefixed name", async () => {
    renderView();
    const row = (await screen.findByText("High error rate")).closest("li") as HTMLElement;
    // Radix's DropdownMenuTrigger only listens for pointerdown/keydown, not click (the established
    // AssistantDock.test.tsx precedent) — fireEvent.click alone never opens it in jsdom.
    fireEvent.keyDown(
      within(row).getByRole("button", { name: "More actions for High error rate" }),
      { key: "Enter" },
    );
    fireEvent.click(await screen.findByText("Duplicate"));

    expect(await screen.findByText("Duplicate rule")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Copy of High error rate");
  });

  test("Delete (overflow menu) confirms, then calls deleteWatchRule and reloads", async () => {
    mockDelete.mockResolvedValueOnce(undefined);
    renderView();
    const row = (await screen.findByText("High error rate")).closest("li") as HTMLElement;
    // Radix's DropdownMenuTrigger only listens for pointerdown/keydown, not click (the established
    // AssistantDock.test.tsx precedent) — fireEvent.click alone never opens it in jsdom.
    fireEvent.keyDown(
      within(row).getByRole("button", { name: "More actions for High error rate" }),
      { key: "Enter" },
    );
    fireEvent.click(await screen.findByText("Delete"));

    fireEvent.click(await screen.findByRole("button", { name: "Delete rule" }));

    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith("rule-1"));
    await waitFor(() => expect(mockListRules).toHaveBeenCalledTimes(2)); // initial + post-delete reload
  });
});

describe("WatchRulesView — audit", () => {
  test("Audit opens the per-rule audit log and renders fixture events", async () => {
    renderView();
    const row = (await screen.findByText("High error rate")).closest("li") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Audit" }));

    expect(await screen.findByText("Audit — High error rate")).toBeInTheDocument();
    expect(screen.getByText("pinned run")).toBeInTheDocument();
    expect(screen.getByText("Run run-1")).toBeInTheDocument();
  });
});
