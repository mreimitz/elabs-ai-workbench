import type { HubAgentRole, HubCrew, HubUsageAggregates } from "@mcp-token-footprint/shared";
import { Button, TooltipProvider } from "@brand/ui";
import { useEffect } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

// WP2.1/2.3/2.4 — AgentsView is a thin shell over WorkforceView (self-fetches via OrgRail). The
// agent node route mounts AgentProfileModal; the crew node route mounts CrewProfileModal — both
// title avatars use @brand/ai's Persona (Rive/WebGL2, unrenderable in jsdom), so stub the surface
// with the shared mock, and mock the hub list/detail calls so the rail + modals settle
// deterministically. Frame/URL mechanics are covered in WorkforceView.test.tsx; each modal's
// behavior in AgentProfileModal/CrewProfileModal tests — this file proves the thin-shell WIRING.
vi.mock("@brand/ai", () => import("../test-support/brand-ai-mock"));
// @brand/charts pulls in @visx (unresolvable/unrenderable under vitest) — stub it inert. Sparkline
// backs the profile Usage sections; the rest back the WP2.8-wired Usage TAB (mounted when active).
vi.mock("@brand/charts", () => ({
  Sparkline: () => null,
  MetricGrid: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  MetricCard: ({ label, value }: { label?: React.ReactNode; value?: React.ReactNode }) => (
    <div>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  ),
  ComposedChart: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  BarChart: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  SeriesBar: () => null,
  Bar: () => null,
  BarXAxis: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Grid: () => null,
  ChartTooltip: () => null,
}));
// Assistant operability WP 3.2 — AgentProfileModal/CrewProfileModal now call `useAssistant()` for their
// "Ask the assistant" header action. This thin-shell suite mounts those modals via routes WITHOUT the
// app-root AssistantProvider, so stub the hook (same pattern as the AgentProfileModal/CrewProfileModal
// suites) — otherwise `useAssistant` throws "must be used within an AssistantProvider".
vi.mock("../../assistant/assistant-context", () => ({
  useAssistant: () => ({ authConfigured: true, openAssistant: vi.fn() }),
}));
vi.mock("../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api")>();
  return {
    ...actual,
    listHubAgentRoles: vi.fn(),
    listHubCrews: vi.fn(),
    getHubAgentRole: vi.fn(),
    getHubCrew: vi.fn(),
    listHubMemory: vi.fn(),
    getHubUsageSummary: vi.fn(),
    // WP2.8 — the Usage TAB (`UsageTab`) is now a real slot; it fetches these when it mounts.
    getHubUsage: vi.fn(),
    getHubUsageRollup: vi.fn(),
    listHubProjects: vi.fn(),
    // WP2.8 — the PageHeader "+ New" quick-create creates through these.
    createHubAgentRole: vi.fn(),
    createHubCrew: vi.fn(),
    listProviders: vi.fn(),
    listProviderModels: vi.fn(),
  };
});

// `WideDialog` -> `useIsMobile` reads `matchMedia`, which jsdom omits.
beforeAll(() => {
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
});

import * as api from "../../../lib/api";
import { AgentsView } from "./AgentsView";

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
    topology: "parallel",
    members: [],
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

/** A zeroed `GET /api/hub/usage` payload so the WP2.8-wired Usage tab renders without a live API. */
function usageAggregates(): HubUsageAggregates {
  return {
    range: {},
    totals: { sessions: 0, costUsd: 0, tokensIn: 0, tokensOut: 0 },
    byModel: [],
    byProvider: [],
    byProviderCredential: [],
    byMode: [],
    byDay: [],
    missions: [],
    planAcceptance: { approvedMissions: 0, uneditedApprovals: 0, uneditedPercent: 0 },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listHubAgentRoles).mockResolvedValue([]);
  vi.mocked(api.listHubCrews).mockResolvedValue([]);
  vi.mocked(api.getHubAgentRole).mockResolvedValue(role());
  vi.mocked(api.getHubCrew).mockResolvedValue(crew());
  vi.mocked(api.listHubMemory).mockResolvedValue([]);
  vi.mocked(api.getHubUsageSummary).mockResolvedValue({
    groupBy: "crew",
    id: "crew-1",
    label: "Research Team",
    totals: { sessions: 0, costUsd: 0, tokensIn: 0, tokensOut: 0 },
    strip: [],
  });
  vi.mocked(api.listProviders).mockResolvedValue([]);
  vi.mocked(api.listProviderModels).mockResolvedValue({ models: [], source: "provider" });
  vi.mocked(api.getHubUsage).mockResolvedValue(usageAggregates());
  vi.mocked(api.getHubUsageRollup).mockResolvedValue([]);
  vi.mocked(api.listHubProjects).mockResolvedValue([]);
  vi.mocked(api.createHubAgentRole).mockResolvedValue(role({ id: "role-new", name: "Fresh Agent" }));
  vi.mocked(api.createHubCrew).mockResolvedValue(
    crew({ id: "crew-new", name: "Fresh Crew", members: [] }),
  );
});

/** Reflects the current URL so navigation (quick-create → profile) is directly observable. */
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

function renderAgentsView(initialEntries: string[] = ["/assistant/agents"]) {
  render(
    // WorkforceView's ViewToolbar `info` tooltip (D-TB1 migration, WP 1.2) reads from a
    // `TooltipProvider` — the app root mounts one; wrap the render the same way the real tree does.
    <TooltipProvider>
      <MemoryRouter initialEntries={initialEntries}>
        {/* Outside <Routes> so it stays mounted wherever a test navigates (e.g. a node route). */}
        <LocationProbe />
        <Routes>
          <Route path="/assistant/agents" element={<AgentsView />} />
          <Route path="/assistant/agents/agent/:agentId" element={<AgentsView />} />
          <Route path="/assistant/agents/crew/:crewId" element={<AgentsView />} />
        </Routes>
      </MemoryRouter>
    </TooltipProvider>,
  );
}

// The PageHeader "+ New" split-button and the Directory toolbar's own "+ New" BOTH have the exact
// accessible name "New"; the PageHeader one renders first in DOM order (PageShell header precedes the
// tab content). Radix's DropdownMenuTrigger opens on keydown, not click (verified pattern).
function openPageHeaderNewMenu(): void {
  const newButtons = screen.getAllByRole("button", { name: "New" });
  fireEvent.keyDown(newButtons[0] as HTMLElement, { key: "Enter" });
}

describe("AgentsView — WP2.1 thin shell", () => {
  test("bare /assistant/agents renders the workforce frame with the Directory tab active", async () => {
    renderAgentsView();

    expect(screen.getByRole("heading", { name: "Agents & Crews" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Directory" })).toHaveAttribute("data-state", "active");
    expect(screen.getByRole("tab", { name: "Org chart" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Usage" })).toBeInTheDocument();
    // The old Roles/Crews TabPanel (and its h-[46rem] frame) is gone — no trace of its labels.
    expect(screen.queryByRole("tab", { name: "Roles" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Crews" })).not.toBeInTheDocument();
    await screen.findByRole("button", { name: /All agents/ }); // flush OrgRail's async fetch
  });

  test("the agent node route mounts the AgentProfileModal in the agentProfileModal slot (D-HUX5/D-HUX6)", async () => {
    renderAgentsView(["/assistant/agents/agent/role-1"]);
    // The open profile modal (a Radix Dialog) aria-hides the workforce background — correct modal
    // semantics — so we assert the MODAL itself (its consequence-labelled primary action), which is
    // proof the slot is wired, rather than the now-hidden background heading/rail.
    await screen.findByRole("button", { name: "Save changes" });
    expect(api.getHubAgentRole).toHaveBeenCalledWith("role-1");
  });

  test("WP2.4 — the crew node route mounts the REAL CrewProfileModal (loads the crew by id)", async () => {
    renderAgentsView(["/assistant/agents/crew/crew-1"]);
    expect(await screen.findByLabelText("Name")).toHaveValue("Research Team");
    expect(api.getHubCrew).toHaveBeenCalledWith("crew-1");
  });
});

describe("AgentsView — WP2.8 tab slots wired (Directory · Org chart · Usage)", () => {
  test("the bare route mounts the REAL Directory grid, not the WP2.1 placeholder", async () => {
    renderAgentsView();
    // DirectoryTab owns its own search field — proof its slot is filled, not the frame placeholder.
    expect(await screen.findByLabelText("Search agents")).toBeInTheDocument();
    expect(
      screen.queryByText("The agent + crew card grid isn’t wired up yet."),
    ).not.toBeInTheDocument();
  });

  test("?tab=org mounts the REAL Org chart tab (its own empty state), not the placeholder", async () => {
    renderAgentsView(["/assistant/agents?tab=org"]);
    expect(await screen.findByText("Nothing to chart yet")).toBeInTheDocument();
    expect(
      screen.queryByText("The crew organigram isn’t wired up yet."),
    ).not.toBeInTheDocument();
  });

  test("?tab=usage mounts the REAL Usage tab (fetches the rollup), not the placeholder", async () => {
    renderAgentsView(["/assistant/agents?tab=usage"]);
    await waitFor(() => expect(api.getHubUsageRollup).toHaveBeenCalled());
    expect(
      screen.queryByText("Spend and token analytics aren’t wired up yet."),
    ).not.toBeInTheDocument();
  });
});

describe("AgentsView — WP2.8 PageHeader '+ New' quick-create (never a silent no-op)", () => {
  test("New agent creates via createHubAgentRole, then opens the new agent's profile", async () => {
    renderAgentsView();
    await screen.findByLabelText("Search agents"); // Directory settled

    openPageHeaderNewMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: "New agent" }));

    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Fresh Agent" } });
    fireEvent.change(screen.getByLabelText("Default model"), {
      target: { value: "claude-sonnet-4-5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create agent" }));

    await waitFor(() => expect(api.createHubAgentRole).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/assistant/agents/agent/role-new",
      ),
    );
  });

  test("New crew creates via createHubCrew, then opens the new crew's profile", async () => {
    renderAgentsView();
    await screen.findByLabelText("Search agents");

    openPageHeaderNewMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: "New crew" }));

    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Fresh Crew" } });
    fireEvent.click(screen.getByRole("button", { name: "Create crew" }));

    await waitFor(() => expect(api.createHubCrew).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/assistant/agents/crew/crew-new",
      ),
    );
  });
});

describe("AgentsView — WP2.1 node-route stability (KNOWN OPEN ITEM resolved)", () => {
  // Reproduces App.tsx's EXACT `/assistant/agents` route block: three sibling <Route>s that all
  // render the SAME element type. react-router matches a different Route on the bare↔node hop, but
  // because those three render one component type at one tree position, React reuses the fiber — so
  // the shared subtree never REMOUNTS (only re-renders). That is why the Directory grid does not
  // flash/reset behind an opening profile modal, and why App.tsx needs no background-location fix.
  test("navigating bare ↔ node re-renders but never remounts the shared element", () => {
    let mounts = 0;
    function Probe() {
      useEffect(() => {
        mounts += 1;
      }, []);
      const navigate = useNavigate();
      return (
        <div>
          <Button type="button" onClick={() => navigate("/assistant/agents/agent/x1")}>
            to-node
          </Button>
          <Button type="button" onClick={() => navigate("/assistant/agents")}>
            to-bare
          </Button>
        </div>
      );
    }

    render(
      <MemoryRouter initialEntries={["/assistant/agents"]}>
        <Routes>
          <Route path="/assistant/agents" element={<Probe />} />
          <Route path="/assistant/agents/agent/:agentId" element={<Probe />} />
          <Route path="/assistant/agents/crew/:crewId" element={<Probe />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(mounts).toBe(1);
    act(() => {
      screen.getByRole("button", { name: "to-node" }).click();
    });
    expect(mounts).toBe(1); // node route matched a different <Route> — but no remount
    act(() => {
      screen.getByRole("button", { name: "to-bare" }).click();
    });
    expect(mounts).toBe(1); // back to bare — still the same fiber
  });
});
