import type { HubAgentRole, HubCrew, HubSession } from "@mcp-token-footprint/shared";
import { TooltipProvider } from "@brand/ui";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@brand/charts", () => ({
  Sparkline: () => <div data-testid="sparkline" />,
}));
vi.mock("@brand/ai", () => import("../test-support/brand-ai-mock"));
vi.mock("../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api")>();
  return {
    ...actual,
    listHubAgentRoles: vi.fn(),
    listHubCrews: vi.fn(),
    updateHubAgentRole: vi.fn(),
    createHubAgentRole: vi.fn(),
    createHubCrew: vi.fn(),
    createHubSession: vi.fn(),
    getHubUsageSummary: vi.fn(),
    listProviders: vi.fn(),
    listProviderModels: vi.fn(),
  };
});

import * as api from "../../../lib/api";
import { DirectoryTab } from "./DirectoryTab";

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
  vi.mocked(api.getHubUsageSummary).mockReturnValue(new Promise(() => {}));
  vi.mocked(api.listProviders).mockResolvedValue([]);
  vi.mocked(api.listProviderModels).mockResolvedValue({ models: [], source: "provider" });
});

function LocationProbe() {
  const location = useLocation();
  return (
    <div data-testid="location">
      {location.pathname}
      {location.search}
    </div>
  );
}

function renderDirectory({ initialEntries = ["/assistant/agents"] }: { initialEntries?: string[] } = {}) {
  render(
    <TooltipProvider>
      <MemoryRouter initialEntries={initialEntries}>
        {/* Outside `<Routes>` so it stays mounted no matter where a test navigates TO (a node route,
            or `/assistant?session=…` after Instantiate) — those destinations don't need their own
            element here, the test only cares that the URL updated. */}
        <LocationProbe />
        <Routes>
          <Route path="/assistant/agents" element={<DirectoryTab />} />
        </Routes>
      </MemoryRouter>
    </TooltipProvider>,
  );
}

describe("DirectoryTab — loading and error", () => {
  test("shows a spinner while the fetch is in flight", () => {
    vi.mocked(api.listHubAgentRoles).mockReturnValue(new Promise(() => {}));
    vi.mocked(api.listHubCrews).mockReturnValue(new Promise(() => {}));
    // The model roster (`useHubModelRoster`) fetches too — hang it here as well so NOTHING settles
    // asynchronously after this test returns (an unawaited resolution firing a state update once a
    // LATER test is already mid-flight is exactly the class of bug that makes a suite order-flaky).
    vi.mocked(api.listProviders).mockReturnValue(new Promise(() => {}));
    renderDirectory();
    expect(screen.queryByText("Research Analyst")).not.toBeInTheDocument();
  });

  test("a failed fetch shows InlineError with a working retry", async () => {
    vi.mocked(api.listHubAgentRoles).mockRejectedValueOnce(new Error("network down"));
    vi.mocked(api.listHubCrews).mockResolvedValue([]);
    renderDirectory();
    await waitFor(() => expect(screen.getByText("network down")).toBeInTheDocument());

    vi.mocked(api.listHubAgentRoles).mockResolvedValue([]);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByText("No agents yet")).toBeInTheDocument());
  });
});

describe("DirectoryTab — scope filtering (?scope=)", () => {
  test("the default (all) scope shows every ACTIVE agent, excluding archived", async () => {
    vi.mocked(api.listHubAgentRoles).mockResolvedValue([
      role({ id: "role-1", name: "Research Analyst" }),
      role({ id: "role-2", name: "Archived One", archivedAt: "2026-07-10T00:00:00.000Z" }),
    ]);
    vi.mocked(api.listHubCrews).mockResolvedValue([]);
    renderDirectory();

    await waitFor(() => expect(screen.getByText("Research Analyst")).toBeInTheDocument());
    expect(screen.queryByText("Archived One")).not.toBeInTheDocument();
  });

  test("?scope=unassigned shows only active agents with no crew membership", async () => {
    vi.mocked(api.listHubAgentRoles).mockResolvedValue([
      role({ id: "role-1", name: "In A Crew" }),
      role({ id: "role-2", name: "Free Agent" }),
    ]);
    vi.mocked(api.listHubCrews).mockResolvedValue([
      crew({ members: [{ agentId: "role-1" }] }),
    ]);
    renderDirectory({ initialEntries: ["/assistant/agents?scope=unassigned"] });

    await waitFor(() => expect(screen.getByText("Free Agent")).toBeInTheDocument());
    expect(screen.queryByText("In A Crew")).not.toBeInTheDocument();
  });

  test("?scope=archived shows only archived agents", async () => {
    vi.mocked(api.listHubAgentRoles).mockResolvedValue([
      role({ id: "role-1", name: "Active One" }),
      role({ id: "role-2", name: "Archived One", archivedAt: "2026-07-10T00:00:00.000Z" }),
    ]);
    vi.mocked(api.listHubCrews).mockResolvedValue([]);
    renderDirectory({ initialEntries: ["/assistant/agents?scope=archived"] });

    await waitFor(() => expect(screen.getByText("Archived One")).toBeInTheDocument());
    expect(screen.queryByText("Active One")).not.toBeInTheDocument();
  });

  test("?scope=crew:<id> shows the crew header card + only that crew's members", async () => {
    vi.mocked(api.listHubAgentRoles).mockResolvedValue([
      role({ id: "role-1", name: "Member One" }),
      role({ id: "role-2", name: "Not A Member" }),
    ]);
    vi.mocked(api.listHubCrews).mockResolvedValue([
      crew({ id: "crew-1", name: "Research Team", members: [{ agentId: "role-1" }] }),
    ]);
    renderDirectory({ initialEntries: ["/assistant/agents?scope=crew:crew-1"] });

    await waitFor(() => expect(screen.getAllByText("Research Team").length).toBeGreaterThan(0));
    expect(screen.getByText("Member One")).toBeInTheDocument();
    expect(screen.queryByText("Not A Member")).not.toBeInTheDocument();
  });

  test("?scope=crew:<unknown> shows an honest 'crew not found', never a crash", async () => {
    vi.mocked(api.listHubAgentRoles).mockResolvedValue([]);
    vi.mocked(api.listHubCrews).mockResolvedValue([]);
    renderDirectory({ initialEntries: ["/assistant/agents?scope=crew:ghost"] });
    await waitFor(() => expect(screen.getByText("Crew not found")).toBeInTheDocument());
    // WP3.R-D1 (single-EmptyState rule, D-HUX14): "Crew not found" must NOT stack a second
    // "no members yet" EmptyState below it.
    expect(screen.queryByText("This crew has no members yet")).not.toBeInTheDocument();
  });
});

// Crew nesting (WP4.2 / D-CN8) — `assignedRoleIds`/`scopedCrewMembers` go recursive: an agent reachable
// only through a nested sub-crew member counts as assigned, and a scoped crew's grid shows every agent
// reachable through the whole subtree, not just its direct members.
describe("DirectoryTab — crew nesting (WP4.2 / D-CN8)", () => {
  test("?scope=unassigned excludes an agent reachable only via a nested sub-crew", async () => {
    vi.mocked(api.listHubAgentRoles).mockResolvedValue([
      role({ id: "role-1", name: "Nested Agent" }),
      role({ id: "role-2", name: "Truly Unassigned" }),
    ]);
    vi.mocked(api.listHubCrews).mockResolvedValue([
      crew({ id: "sub-1", name: "Intel Squad", members: [{ agentId: "role-1" }] }),
      crew({ id: "crew-1", name: "Research Team", members: [{ crewId: "sub-1" }] }),
    ]);
    renderDirectory({ initialEntries: ["/assistant/agents?scope=unassigned"] });

    await waitFor(() => expect(screen.getByText("Truly Unassigned")).toBeInTheDocument());
    expect(screen.queryByText("Nested Agent")).not.toBeInTheDocument();
  });

  test("?scope=crew:<id> for a crew with a nested sub-crew shows agents reachable through the WHOLE subtree", async () => {
    vi.mocked(api.listHubAgentRoles).mockResolvedValue([
      role({ id: "role-1", name: "Direct Member" }),
      role({ id: "role-2", name: "Nested Member" }),
      role({ id: "role-3", name: "Unrelated Agent" }),
    ]);
    vi.mocked(api.listHubCrews).mockResolvedValue([
      crew({ id: "sub-1", name: "Intel Squad", members: [{ agentId: "role-2" }] }),
      crew({
        id: "crew-1",
        name: "Research Team",
        members: [{ agentId: "role-1" }, { crewId: "sub-1" }],
      }),
    ]);
    renderDirectory({ initialEntries: ["/assistant/agents?scope=crew:crew-1"] });

    await waitFor(() => expect(screen.getAllByText("Research Team").length).toBeGreaterThan(0));
    expect(screen.getByText("Direct Member")).toBeInTheDocument();
    expect(screen.getByText("Nested Member")).toBeInTheDocument();
    expect(screen.queryByText("Unrelated Agent")).not.toBeInTheDocument();
  });

  test("a cyclic crew graph does not crash the scoped grid — bounded, honest result", async () => {
    vi.mocked(api.listHubAgentRoles).mockResolvedValue([role({ id: "role-1", name: "Agent A" })]);
    vi.mocked(api.listHubCrews).mockResolvedValue([
      crew({ id: "crew-a", name: "Crew A", members: [{ agentId: "role-1" }, { crewId: "crew-b" }] }),
      crew({ id: "crew-b", name: "Crew B", members: [{ crewId: "crew-a" }] }),
    ]);
    renderDirectory({ initialEntries: ["/assistant/agents?scope=crew:crew-a"] });

    await waitFor(() => expect(screen.getAllByText("Crew A").length).toBeGreaterThan(0));
    expect(screen.getByText("Agent A")).toBeInTheDocument();
  });
});

describe("DirectoryTab — search + sort", () => {
  test("search filters the visible grid by name/description", async () => {
    vi.mocked(api.listHubAgentRoles).mockResolvedValue([
      role({ id: "role-1", name: "Research Analyst" }),
      role({ id: "role-2", name: "Growth Marketer" }),
    ]);
    vi.mocked(api.listHubCrews).mockResolvedValue([]);
    renderDirectory();

    await waitFor(() => expect(screen.getByText("Growth Marketer")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Search agents"), {
      target: { value: "growth" },
    });
    expect(screen.queryByText("Research Analyst")).not.toBeInTheDocument();
    expect(screen.getByText("Growth Marketer")).toBeInTheDocument();
  });

  test("a search with no matches shows an honest empty state, not a broken grid", async () => {
    vi.mocked(api.listHubAgentRoles).mockResolvedValue([role({ name: "Research Analyst" })]);
    vi.mocked(api.listHubCrews).mockResolvedValue([]);
    renderDirectory();

    await waitFor(() => expect(screen.getByText("Research Analyst")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Search agents"), {
      target: { value: "nonexistent" },
    });
    expect(screen.getByText("No agents match “nonexistent”")).toBeInTheDocument();
  });

  test("the empty state's Clear filter action clears the search and restores the grid", async () => {
    vi.mocked(api.listHubAgentRoles).mockResolvedValue([role({ name: "Research Analyst" })]);
    vi.mocked(api.listHubCrews).mockResolvedValue([]);
    renderDirectory();

    await waitFor(() => expect(screen.getByText("Research Analyst")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Search agents"), {
      target: { value: "nonexistent" },
    });
    expect(screen.getByText("No agents match “nonexistent”")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear filter" }));

    expect(screen.getByText("Research Analyst")).toBeInTheDocument();
    expect(screen.queryByText(/No agents match/)).not.toBeInTheDocument();
  });
});

describe("DirectoryTab — empty states with one primary action (D-HUX14)", () => {
  test("zero agents in the all scope offers a New agent action that opens quick-create", async () => {
    vi.mocked(api.listHubAgentRoles).mockResolvedValue([]);
    vi.mocked(api.listHubCrews).mockResolvedValue([]);
    renderDirectory();

    await waitFor(() => expect(screen.getByText("No agents yet")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "New agent" }));
    expect(screen.getByText("A minimal starting identity — you'll finish setting it up (instructions, access, budgets…) in its profile next.")).toBeInTheDocument();
  });
});

describe("DirectoryTab — interactions + navigation (D-HUX5)", () => {
  test("double-click on a card navigates to its agent node route, preserving ?scope=", async () => {
    vi.mocked(api.listHubAgentRoles).mockResolvedValue([role({ id: "role-1" })]);
    vi.mocked(api.listHubCrews).mockResolvedValue([
      crew({ id: "crew-1", members: [{ agentId: "role-1" }] }),
    ]);
    renderDirectory({ initialEntries: ["/assistant/agents?scope=crew:crew-1"] });

    await waitFor(() => expect(screen.getByText("Research Analyst")).toBeInTheDocument());
    fireEvent.doubleClick(screen.getByRole("button", { name: "Research Analyst" }));
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/assistant/agents/agent/role-1?scope=crew%3Acrew-1",
    );
  });

  test("a plain click selects (aria-current) without navigating", async () => {
    vi.mocked(api.listHubAgentRoles).mockResolvedValue([role({ id: "role-1" })]);
    vi.mocked(api.listHubCrews).mockResolvedValue([]);
    renderDirectory();

    await waitFor(() => expect(screen.getByText("Research Analyst")).toBeInTheDocument());
    const card = screen.getByRole("button", { name: "Research Analyst" });
    expect(card).not.toHaveAttribute("aria-current");
    fireEvent.click(card);
    expect(card).toHaveAttribute("aria-current", "true");
    expect(screen.getByTestId("location")).toHaveTextContent("/assistant/agents");
  });

  test("the card's ⋯ menu archives it, and the list reflects the change after reload", async () => {
    vi.mocked(api.listHubAgentRoles).mockResolvedValueOnce([role({ id: "role-1" })]);
    vi.mocked(api.listHubCrews).mockResolvedValue([]);
    vi.mocked(api.updateHubAgentRole).mockResolvedValue(
      role({ id: "role-1", archivedAt: "2026-07-15T00:00:00.000Z" }),
    );
    renderDirectory();

    await waitFor(() => expect(screen.getByText("Research Analyst")).toBeInTheDocument());
    // After archiving, a reload re-fetches — simulate the agent now excluded from the (active-only)
    // all-scope grid.
    vi.mocked(api.listHubAgentRoles).mockResolvedValueOnce([
      role({ id: "role-1", archivedAt: "2026-07-15T00:00:00.000Z" }),
    ]);

    fireEvent.keyDown(screen.getByRole("button", { name: "Research Analyst actions" }), {
      key: "Enter",
    });
    fireEvent.click(screen.getByRole("menuitem", { name: /Archive/ }));

    await waitFor(() =>
      expect(api.updateHubAgentRole).toHaveBeenCalledWith("role-1", { archived: true }),
    );
    await waitFor(() => expect(screen.getByText("No agents yet")).toBeInTheDocument());
  });
});

describe("DirectoryTab — quick-create (D-HUX6 'Create, then open profile'; ui-wave U5: the toolbar '+ New' menu was removed as a duplicate of the PageHeader's — crew creation lives on the org rail / header, covered by OrgRail.test)", () => {
  test("the toolbar no longer carries a duplicate 'New' menu; the empty state offers 'New agent' directly", async () => {
    vi.mocked(api.listHubAgentRoles).mockResolvedValue([]);
    vi.mocked(api.listHubCrews).mockResolvedValue([]);
    renderDirectory();

    await waitFor(() => expect(screen.getByText("No agents yet")).toBeInTheDocument());
    // The old toolbar menu trigger (exact name "New") is gone (ui-wave U5, owner feedback: the
    // Directory toolbar duplicated the header's affordance).
    expect(screen.queryByRole("button", { name: "New" })).toBeNull();
    // The empty state's own CTA remains the direct path.
    expect(screen.getByRole("button", { name: "New agent" })).toBeInTheDocument();
  });

  test("the empty state's 'New agent' opens the quick-create dialog; creating navigates to its profile", async () => {
    vi.mocked(api.listHubAgentRoles).mockResolvedValue([]);
    vi.mocked(api.listHubCrews).mockResolvedValue([]);
    vi.mocked(api.createHubAgentRole).mockResolvedValue(
      role({ id: "role-new", name: "Fresh Agent" }),
    );
    renderDirectory();

    await waitFor(() => expect(screen.getByText("No agents yet")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "New agent" }));

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Fresh Agent" } });
    fireEvent.change(screen.getByLabelText("Default model"), {
      target: { value: "claude-sonnet-4-5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create agent" }));

    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/assistant/agents/agent/role-new",
      ),
    );
  });
});

describe("DirectoryTab — crew Instantiate", () => {
  test("Instantiate creates a mission session with the crew and navigates to it", async () => {
    vi.mocked(api.listHubAgentRoles).mockResolvedValue([role({ id: "role-1" })]);
    vi.mocked(api.listHubCrews).mockResolvedValue([
      crew({ id: "crew-1", members: [{ agentId: "role-1" }] }),
    ]);
    vi.mocked(api.createHubSession).mockResolvedValue({ id: "session-1" } as HubSession);
    renderDirectory({ initialEntries: ["/assistant/agents?scope=crew:crew-1"] });

    await waitFor(() => expect(screen.getByRole("button", { name: "Instantiate" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Instantiate" }));

    await waitFor(() =>
      expect(api.createHubSession).toHaveBeenCalledWith({
        mode: "mission",
        model: "claude-sonnet-4-5",
        crewId: "crew-1",
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/assistant?session=session-1"),
    );
  });

  // model-identity WP 4.1 (D-MI7) — the coordinating session's model is an operator CHOICE now, not
  // a silent `roster.models[0]`; an explicit pick carries its own credential to `createHubSession`.
  test("picking a coordinating model sends THAT model and its credential", async () => {
    vi.mocked(api.listHubAgentRoles).mockResolvedValue([role({ id: "role-1" })]);
    vi.mocked(api.listHubCrews).mockResolvedValue([
      crew({ id: "crew-1", members: [{ agentId: "role-1" }] }),
    ]);
    vi.mocked(api.listProviders).mockResolvedValue([
      {
        id: "cred-1",
        kind: "openai",
        label: "OpenAI",
        hasKey: true,
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
      },
    ]);
    vi.mocked(api.listProviderModels).mockResolvedValue({
      models: [{ id: "gpt-5", displayName: "GPT-5" }],
      source: "provider",
    });
    vi.mocked(api.createHubSession).mockResolvedValue({ id: "session-2" } as HubSession);
    renderDirectory({ initialEntries: ["/assistant/agents?scope=crew:crew-1"] });

    fireEvent.click(await screen.findByRole("button", { name: /^Coordinating model:/ }));
    fireEvent.click(
      within(screen.getByTestId("model-selector-content")).getByRole("button", { name: /^GPT-5/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Instantiate" }));

    await waitFor(() =>
      expect(api.createHubSession).toHaveBeenCalledWith({
        mode: "mission",
        model: "gpt-5",
        providerCredentialId: "cred-1",
        crewId: "crew-1",
      }),
    );
  });
});

describe("DirectoryTab — reloadKey refresh signal (WP2.8)", () => {
  test("bumping reloadKey re-fetches the roles + crews (so a PageHeader-created entity appears)", async () => {
    vi.mocked(api.listHubAgentRoles).mockResolvedValue([role({ id: "role-1" })]);
    vi.mocked(api.listHubCrews).mockResolvedValue([]);
    const tree = (reloadKey: number) => (
      <TooltipProvider>
        <MemoryRouter initialEntries={["/assistant/agents"]}>
          <Routes>
            <Route path="/assistant/agents" element={<DirectoryTab reloadKey={reloadKey} />} />
          </Routes>
        </MemoryRouter>
      </TooltipProvider>
    );

    const { rerender } = render(tree(0));
    await waitFor(() => expect(screen.getByText("Research Analyst")).toBeInTheDocument());
    expect(api.listHubAgentRoles).toHaveBeenCalledTimes(1);

    // Same tree (router reused), only the reloadKey prop changes — DirectoryTab re-renders (no
    // remount) and re-fetches, mirroring AgentsView bumping the key after a PageHeader quick-create.
    rerender(tree(1));
    await waitFor(() => expect(api.listHubAgentRoles).toHaveBeenCalledTimes(2));
  });
});
