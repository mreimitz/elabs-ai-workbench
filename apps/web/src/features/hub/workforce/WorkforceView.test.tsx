import type { HubAgentRole, HubCrew } from "@mcp-token-footprint/shared";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@elabs-ai/components-ui";

// The view's import chain now reaches the REAL `@elabs-ai/components-ai` (whose index.js imports
// `@xyflow/react/dist/style.css`, unresolvable under the jsdom ESM loader) — mock it with the shared
// hub stub, exactly as TopologyGraph.test / Mission.test do for the same chain.
vi.mock("@elabs-ai/components-ai", () => import("../test-support/brand-ai-mock"));

// WorkforceView's org rail self-fetches (`OrgRail.tsx`) — mock the two hub list calls so every test
// settles deterministically instead of hitting `fetch` against nothing in jsdom.
vi.mock("../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api")>();
  return {
    ...actual,
    listHubAgentRoles: vi.fn(),
    listHubCrews: vi.fn(),
  };
});

import * as api from "../../../lib/api";
import { WorkforceView } from "./WorkforceView";

function role(overrides: Partial<HubAgentRole> = {}): HubAgentRole {
  return {
    id: "role-1",
    name: "Research Analyst",
    systemPrompt: "You research topics thoroughly.",
    defaultModel: "claude-sonnet-4-5",
    toolGrants: { servers: {}, builtins: [] },
    skills: [],
    target: "Investigate the assigned topic",
    expectedOutcome: "A structured report",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    archivedAt: null,
    ...overrides,
  };
}

function crew(overrides: Partial<HubCrew> = {}): HubCrew {
  return {
    id: "crew-1",
    name: "Research Team",
    color: "chart-2",
    topology: "parallel",
    members: [{ agentId: "role-1" }],
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listHubAgentRoles).mockResolvedValue([]);
  vi.mocked(api.listHubCrews).mockResolvedValue([]);
});

/** Reflects the current URL so URL-driven state is directly observable. */
function LocationProbe() {
  const location = useLocation();
  return (
    <div data-testid="location">
      {location.pathname}
      {location.search}
    </div>
  );
}

function renderWorkforce(
  overrides: Partial<Parameters<typeof WorkforceView>[0]> = {},
  { initialEntries = ["/assistant/agents"] }: { initialEntries?: string[] } = {},
) {
  render(
    // WorkforceView's ViewToolbar `info` tooltip (D-TB1 migration, WP 1.2) reads from a
    // `TooltipProvider` — the app root mounts one; wrap the render the same way the real tree does
    // (mirrors AuditView.test.tsx / ViewToolbar.test.tsx's established pattern).
    <TooltipProvider>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route
            path="/assistant/agents"
            element={
              <>
                <LocationProbe />
                <WorkforceView {...overrides} />
              </>
            }
          />
          <Route
            path="/assistant/agents/agent/:agentId"
            element={
              <>
                <LocationProbe />
                <WorkforceView {...overrides} />
              </>
            }
          />
          <Route
            path="/assistant/agents/crew/:crewId"
            element={
              <>
                <LocationProbe />
                <WorkforceView {...overrides} />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </TooltipProvider>,
  );
}

// Radix tabs activate on mousedown (primary button), not a synthetic `click` (mirrors
// `components/TabPanel.test.tsx`'s own helper).
function activateTab(name: string): void {
  fireEvent.mouseDown(screen.getByRole("tab", { name }), { button: 0 });
}

// Radix's `DropdownMenuTrigger` only listens for pointerdown/keydown, not `click` (mirrors
// `ArtifactCanvas.test.tsx`'s verified pattern for the same component).
function openNewMenu(): void {
  fireEvent.keyDown(screen.getByRole("button", { name: "New" }), { key: "Enter" });
}

describe("WorkforceView — tab (D-HUX5, ?tab=)", () => {
  test("defaults to Directory with a clean URL (no ?tab= for the default)", async () => {
    renderWorkforce();
    expect(screen.getByRole("tab", { name: "Directory" })).toHaveAttribute("data-state", "active");
    expect(screen.getByTestId("location")).toHaveTextContent("/assistant/agents");
    expect(screen.getByTestId("location").textContent).not.toContain("tab=");
    await screen.findByRole("button", { name: /^All agents/ }); // flush OrgRail's async fetch
  });

  test("`?tab=org` deep-links directly into the Org chart tab on mount", async () => {
    renderWorkforce({}, { initialEntries: ["/assistant/agents?tab=org"] });
    expect(screen.getByRole("tab", { name: "Org chart" })).toHaveAttribute("data-state", "active");
    expect(screen.getByText("The crew organigram isn’t wired up yet.")).toBeInTheDocument();
    await screen.findByRole("button", { name: /^All agents/ }); // flush OrgRail's async fetch
  });

  test("an unrecognized ?tab= value falls back to Directory", async () => {
    renderWorkforce({}, { initialEntries: ["/assistant/agents?tab=bogus"] });
    expect(screen.getByRole("tab", { name: "Directory" })).toHaveAttribute("data-state", "active");
    await screen.findByRole("button", { name: /^All agents/ }); // flush OrgRail's async fetch
  });

  test("switching to Usage writes ?tab=usage and hides the org rail; switching back to Directory removes it and restores the rail", async () => {
    renderWorkforce();
    await waitFor(() => expect(screen.getByText("Organization")).toBeInTheDocument());

    activateTab("Usage");
    expect(screen.getByTestId("location")).toHaveTextContent("/assistant/agents?tab=usage");
    expect(screen.queryByText("Organization")).not.toBeInTheDocument(); // rail hidden on Usage

    activateTab("Directory");
    expect(screen.getByTestId("location")).toHaveTextContent("/assistant/agents");
    expect(screen.getByTestId("location").textContent).not.toContain("tab=");
    await waitFor(() => expect(screen.getByText("Organization")).toBeInTheDocument());
  });
});

describe("WorkforceView — org rail scope (D-HUX5, ?scope=)", () => {
  test("selecting Unassigned writes ?scope=unassigned; selecting All agents clears it", async () => {
    renderWorkforce();
    await waitFor(() => expect(screen.getByRole("button", { name: /^Unassigned/ })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /^Unassigned/ }));
    expect(screen.getByTestId("location")).toHaveTextContent("scope=unassigned");
    expect(screen.getByRole("button", { name: /^Unassigned/ })).toHaveAttribute("aria-current", "true");

    fireEvent.click(screen.getByRole("button", { name: /^All agents/ }));
    expect(screen.getByTestId("location").textContent).not.toContain("scope=");
  });

  test("selecting a crew writes ?scope=crew:<id>", async () => {
    vi.mocked(api.listHubAgentRoles).mockResolvedValue([role()]);
    vi.mocked(api.listHubCrews).mockResolvedValue([crew()]);
    renderWorkforce();

    await waitFor(() => expect(screen.getByRole("button", { name: /^Research Team/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^Research Team/ }));
    expect(screen.getByTestId("location")).toHaveTextContent("scope=crew%3Acrew-1");
  });

  test("`?scope=archived` deep-links directly into the Archived rail item", async () => {
    renderWorkforce({}, { initialEntries: ["/assistant/agents?scope=archived"] });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Archived/ })).toHaveAttribute("aria-current", "true"),
    );
  });

  test("an unresolvable ?scope= (dangling crew: with no id) falls back to All agents", async () => {
    renderWorkforce({}, { initialEntries: ["/assistant/agents?scope=crew:"] });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^All agents/ })).toHaveAttribute("aria-current", "true"),
    );
  });
});

describe("WorkforceView — node routes (D-HUX5)", () => {
  test("the agent node route mounts the agentProfileModal slot; the bare route does not", async () => {
    renderWorkforce(
      { agentProfileModal: <div data-testid="agent-modal">agent modal</div> },
      { initialEntries: ["/assistant/agents/agent/role-1"] },
    );
    expect(screen.getByTestId("agent-modal")).toBeInTheDocument();
    await screen.findByRole("button", { name: /^All agents/ }); // flush OrgRail's async fetch
  });

  test("the crew node route mounts the crewProfileModal slot", async () => {
    renderWorkforce(
      { crewProfileModal: <div data-testid="crew-modal">crew modal</div> },
      { initialEntries: ["/assistant/agents/crew/crew-1"] },
    );
    expect(screen.getByTestId("crew-modal")).toBeInTheDocument();
    await screen.findByRole("button", { name: /^All agents/ }); // flush OrgRail's async fetch
  });

  test("no profile-modal slot is provided on a node route: nothing renders (never a silent placeholder)", async () => {
    renderWorkforce({}, { initialEntries: ["/assistant/agents/agent/role-1"] });
    expect(screen.queryByTestId("agent-modal")).not.toBeInTheDocument();
    expect(screen.queryByTestId("crew-modal")).not.toBeInTheDocument();
    await screen.findByRole("button", { name: /^All agents/ }); // flush OrgRail's async fetch
  });

  test("a provided agentProfileModal slot does NOT render on the bare list route", async () => {
    renderWorkforce({ agentProfileModal: <div data-testid="agent-modal">agent modal</div> });
    expect(screen.queryByTestId("agent-modal")).not.toBeInTheDocument();
    await screen.findByRole("button", { name: /^All agents/ }); // flush OrgRail's async fetch
  });

  test("?settings= plumbing: a node URL keeps ?settings= alongside tab/scope, untouched by this view", async () => {
    renderWorkforce(
      {},
      { initialEntries: ["/assistant/agents/agent/role-1?tab=directory&scope=crew:crew-1&settings=access"] },
    );
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/assistant/agents/agent/role-1?tab=directory&scope=crew:crew-1&settings=access",
    );
    await screen.findByRole("button", { name: /^All agents/ }); // flush OrgRail's async fetch
  });
});

describe("WorkforceView — the '+ New' split button never ships a silent no-op", () => {
  test("with no handlers provided, both menu items render disabled", async () => {
    renderWorkforce();
    await screen.findByRole("button", { name: /^All agents/ }); // flush OrgRail's async fetch
    openNewMenu();
    expect(screen.getByRole("menuitem", { name: "New agent" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByRole("menuitem", { name: "New crew" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  test("with handlers provided, selecting an item fires it", async () => {
    const onNewAgent = vi.fn();
    const onNewCrew = vi.fn();
    renderWorkforce({ onNewAgent, onNewCrew });
    await screen.findByRole("button", { name: /^All agents/ }); // flush OrgRail's async fetch
    openNewMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: "New agent" }));
    expect(onNewAgent).toHaveBeenCalledTimes(1);
    expect(onNewCrew).not.toHaveBeenCalled();
  });
});
