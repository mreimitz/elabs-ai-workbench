import type { HubAgentRole, HubCrew } from "@mcp-token-footprint/shared";
import { TooltipProvider } from "@elabs-ai/components-ui";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";

// The rail's agent rows render `RoleAvatar` → `@elabs-ai/components-ai`'s `ModelSelectorLogo` (a logo surface
// jsdom can't render) — stub the whole package with the shared mock, mirroring DirectoryTab.test.
vi.mock("@elabs-ai/components-ai", () => import("../test-support/brand-ai-mock"));
vi.mock("../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api")>();
  return {
    ...actual,
    listHubAgentRoles: vi.fn(),
    listHubCrews: vi.fn(),
    // ui-wave U5 — the treeview's inline create + reassign surface.
    updateHubCrew: vi.fn(),
    createHubAgentRole: vi.fn(),
    createHubCrew: vi.fn(),
    // QuickCreateAgentDialog's model roster (`useHubModelRoster`) fetches these on mount — mock them
    // so nothing settles asynchronously outside a test's control (the order-flakiness class of bug).
    listProviders: vi.fn(),
    listProviderModels: vi.fn(),
  };
});

import * as api from "../../../lib/api";
import {
  OrgRail,
  type OrgRailScope,
  encodeOrgRailScope,
  orgRailScopesEqual,
  parseOrgRailScope,
} from "./OrgRail";

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
  vi.mocked(api.listProviders).mockResolvedValue([]);
  vi.mocked(api.listProviderModels).mockResolvedValue({ models: [], source: "provider" });
});

const SCOPE_ALL: OrgRailScope = { kind: "all" };

/** Reflects the current URL so agent-row navigation (ui-wave U5) is directly observable. */
function LocationProbe() {
  const location = useLocation();
  return (
    <div data-testid="location">
      {location.pathname}
      {location.search}
    </div>
  );
}

// A router is now required: agent rows navigate to the profile node route (the same D-HUX5 target
// the Directory card opens). The probe sits OUTSIDE <Routes> so it stays mounted after navigation.
// The rail also renders `IconButton`s (D-TB5 — New crew, tree chevrons, per-row ⋯ actions), which
// wrap every control in a Radix `Tooltip` — that throws without an ancestor `TooltipProvider` (the
// app root mounts one).
function renderRail(
  scope: OrgRailScope = SCOPE_ALL,
  {
    initialEntries = ["/assistant/agents"],
    onMutated,
  }: { initialEntries?: string[]; onMutated?: () => void } = {},
) {
  const onScopeChange = vi.fn();
  render(
    <TooltipProvider>
      <MemoryRouter initialEntries={initialEntries}>
        <LocationProbe />
        <Routes>
          <Route
            path="/assistant/agents"
            element={<OrgRail scope={scope} onScopeChange={onScopeChange} onMutated={onMutated} />}
          />
        </Routes>
      </MemoryRouter>
    </TooltipProvider>,
  );
  return { onScopeChange };
}

describe("OrgRail — scope codec (pure functions)", () => {
  test("encodes/parses the default (all) scope as absent from the URL", () => {
    expect(encodeOrgRailScope(SCOPE_ALL)).toBeNull();
    expect(parseOrgRailScope(null)).toEqual(SCOPE_ALL);
    expect(parseOrgRailScope("")).toEqual(SCOPE_ALL);
  });

  test("round-trips unassigned/archived/crew scopes", () => {
    for (const scope of [
      { kind: "unassigned" } as const,
      { kind: "archived" } as const,
      { kind: "crew", crewId: "crew-1" } as const,
    ]) {
      const encoded = encodeOrgRailScope(scope);
      expect(encoded).not.toBeNull();
      expect(parseOrgRailScope(encoded)).toEqual(scope);
    }
  });

  test("an unresolvable value (dangling crew:, garbage) falls back to all", () => {
    expect(parseOrgRailScope("crew:")).toEqual(SCOPE_ALL);
    expect(parseOrgRailScope("not-a-real-scope")).toEqual(SCOPE_ALL);
  });

  test("orgRailScopesEqual compares crew scopes by id", () => {
    expect(orgRailScopesEqual({ kind: "all" }, { kind: "all" })).toBe(true);
    expect(orgRailScopesEqual({ kind: "crew", crewId: "a" }, { kind: "crew", crewId: "a" })).toBe(
      true,
    );
    expect(orgRailScopesEqual({ kind: "crew", crewId: "a" }, { kind: "crew", crewId: "b" })).toBe(
      false,
    );
    expect(orgRailScopesEqual({ kind: "all" }, { kind: "unassigned" })).toBe(false);
  });
});

describe("OrgRail — loading and error", () => {
  test("shows a spinner while the fetch is in flight", () => {
    vi.mocked(api.listHubAgentRoles).mockReturnValue(new Promise(() => {}));
    vi.mocked(api.listHubCrews).mockReturnValue(new Promise(() => {}));
    renderRail();
    expect(screen.queryByText("All agents")).not.toBeInTheDocument();
  });

  test("a failed fetch shows InlineError with a working retry, never a silent empty rail", async () => {
    vi.mocked(api.listHubAgentRoles).mockRejectedValueOnce(new Error("network down"));
    vi.mocked(api.listHubCrews).mockResolvedValue([]);
    renderRail();

    await waitFor(() => expect(screen.getByText("network down")).toBeInTheDocument());

    vi.mocked(api.listHubAgentRoles).mockResolvedValue([]);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByText(/All agents/)).toBeInTheDocument());
  });
});

describe("OrgRail — counts (D-HUX5)", () => {
  test("empty roles/crews: every count is zero, no saved crews", async () => {
    vi.mocked(api.listHubAgentRoles).mockResolvedValue([]);
    vi.mocked(api.listHubCrews).mockResolvedValue([]);
    renderRail();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "All agents 0" })).toBeInTheDocument(),
    );
    expect(screen.getByText("No saved crews yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unassigned 0" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archived 0" })).toBeInTheDocument();
  });

  test("All agents excludes archived; Unassigned excludes both archived AND crew members; Archived counts only archived; a crew's count is its member count", async () => {
    vi.mocked(api.listHubAgentRoles).mockResolvedValue([
      role({ id: "role-1" }), // in the crew below
      role({ id: "role-2" }), // unassigned, active
      role({ id: "role-3", archivedAt: "2026-07-10T00:00:00.000Z" }), // archived
    ]);
    vi.mocked(api.listHubCrews).mockResolvedValue([crew({ members: [{ agentId: "role-1" }] })]);
    renderRail();

    // 2 active roles (role-1, role-2) — role-3 is archived and excluded.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "All agents 2" })).toBeInTheDocument(),
    );
    // role-2 is active and not a member of any crew.
    expect(screen.getByRole("button", { name: "Unassigned 1" })).toBeInTheDocument();
    // Exactly role-3.
    expect(screen.getByRole("button", { name: "Archived 1" })).toBeInTheDocument();
    // The crew has one member — a flat crew's count is "N agents" (WP4.2/D-CN8's recursive
    // formatting; a plain honest count, no visible regression for the common flat case).
    expect(screen.getByRole("button", { name: "Research Team 1 agent" })).toBeInTheDocument();
  });
});

describe("OrgRail — crew search (local, not a URL concern)", () => {
  test("filters the crew list by name; the fixed scopes (All/Unassigned/Archived) stay visible", async () => {
    vi.mocked(api.listHubAgentRoles).mockResolvedValue([]);
    vi.mocked(api.listHubCrews).mockResolvedValue([
      crew({ id: "crew-1", name: "Research Team", members: [] }),
      crew({ id: "crew-2", name: "Growth Squad", members: [] }),
    ]);
    renderRail();

    await waitFor(() => expect(screen.getByText("Research Team")).toBeInTheDocument());
    expect(screen.getByText("Growth Squad")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Search crews…"), {
      target: { value: "growth" },
    });

    expect(screen.queryByText("Research Team")).not.toBeInTheDocument();
    expect(screen.getByText("Growth Squad")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /All agents/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unassigned 0" })).toBeInTheDocument();
  });

  test("a search with no matches shows an honest 'no crews match' message, not a broken empty rail", async () => {
    vi.mocked(api.listHubAgentRoles).mockResolvedValue([]);
    vi.mocked(api.listHubCrews).mockResolvedValue([crew()]);
    renderRail();

    await waitFor(() => expect(screen.getByText("Research Team")).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText("Search crews…"), {
      target: { value: "nonexistent" },
    });
    expect(screen.getByText("No crews match “nonexistent”.")).toBeInTheDocument();
  });
});

describe("OrgRail — selection (branch rows scope, unchanged URL contract)", () => {
  test("clicking each branch row reports the right scope, and aria-current reflects the controlled prop", async () => {
    vi.mocked(api.listHubAgentRoles).mockResolvedValue([role()]);
    vi.mocked(api.listHubCrews).mockResolvedValue([crew()]);
    const { onScopeChange } = renderRail({ kind: "crew", crewId: "crew-1" });

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Research Team 1 agent" })).toHaveAttribute(
        "aria-current",
        "true",
      ),
    );
    expect(screen.getByRole("button", { name: "All agents 1" })).not.toHaveAttribute(
      "aria-current",
    );

    fireEvent.click(screen.getByRole("button", { name: "Unassigned 0" }));
    expect(onScopeChange).toHaveBeenCalledWith({ kind: "unassigned" });

    fireEvent.click(screen.getByRole("button", { name: "Archived 0" }));
    expect(onScopeChange).toHaveBeenCalledWith({ kind: "archived" });

    fireEvent.click(screen.getByRole("button", { name: "All agents 1" }));
    expect(onScopeChange).toHaveBeenCalledWith({ kind: "all" });

    fireEvent.click(screen.getByRole("button", { name: "Research Team 1 agent" }));
    expect(onScopeChange).toHaveBeenCalledWith({ kind: "crew", crewId: "crew-1" });
  });
});

describe("OrgRail — treeview expansion (ui-wave U5)", () => {
  test("crews are collapsed by default; the chevron expands to the member rows (name + role title) and collapses back", async () => {
    vi.mocked(api.listHubAgentRoles).mockResolvedValue([
      role({ id: "role-1", displayName: "Nova", name: "Research Analyst" }),
    ]);
    vi.mocked(api.listHubCrews).mockResolvedValue([crew({ members: [{ agentId: "role-1" }] })]);
    renderRail();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Research Team 1 agent" })).toBeInTheDocument(),
    );
    expect(screen.queryByText("Nova")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Expand Research Team" }));
    // The member row shows the persona name AND the library role title (avatar + name + role).
    const memberRow = screen.getByRole("button", { name: "Nova Research Analyst" });
    expect(memberRow).toBeInTheDocument();
    // The child list is labelled as the crew's members (indent-guide group).
    expect(screen.getByLabelText("Research Team members")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Collapse Research Team" }));
    expect(screen.queryByText("Nova")).not.toBeInTheDocument();
  });

  test("the currently-scoped crew mounts expanded (deep link lands with its context visible)", async () => {
    vi.mocked(api.listHubAgentRoles).mockResolvedValue([
      role({ id: "role-1", displayName: "Nova", name: "Research Analyst" }),
    ]);
    vi.mocked(api.listHubCrews).mockResolvedValue([crew({ members: [{ agentId: "role-1" }] })]);
    renderRail({ kind: "crew", crewId: "crew-1" });

    expect(
      await screen.findByRole("button", { name: "Nova Research Analyst" }),
    ).toBeInTheDocument();
  });

  test("Unassigned and Archived expand to their agent rows; an empty crew expands to an honest hint", async () => {
    vi.mocked(api.listHubAgentRoles).mockResolvedValue([
      role({ id: "role-2", name: "Free Agent" }),
      role({ id: "role-3", name: "Old Timer", archivedAt: "2026-07-10T00:00:00.000Z" }),
    ]);
    vi.mocked(api.listHubCrews).mockResolvedValue([crew({ members: [] })]);
    renderRail();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Unassigned 1" })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Expand Unassigned" }));
    expect(screen.getByRole("button", { name: "Free Agent" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Expand Archived" }));
    expect(screen.getByRole("button", { name: "Old Timer" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Expand Research Team" }));
    expect(screen.getByText("No members yet.")).toBeInTheDocument();
  });
});

describe("OrgRail — agent rows navigate to the profile (ui-wave U5, same target as the Directory card)", () => {
  test("clicking a member row opens /assistant/agents/agent/:id preserving ?scope=", async () => {
    vi.mocked(api.listHubAgentRoles).mockResolvedValue([
      role({ id: "role-1", displayName: "Nova", name: "Research Analyst" }),
    ]);
    vi.mocked(api.listHubCrews).mockResolvedValue([crew({ members: [{ agentId: "role-1" }] })]);
    renderRail(
      { kind: "crew", crewId: "crew-1" },
      { initialEntries: ["/assistant/agents?scope=crew%3Acrew-1"] },
    );

    fireEvent.click(await screen.findByRole("button", { name: "Nova Research Analyst" }));
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/assistant/agents/agent/role-1?scope=crew%3Acrew-1",
    );
  });
});

describe("OrgRail — inline create (ui-wave U5, reusing the existing quick-create flows)", () => {
  test("the CREWS header '+' opens the crew quick-create; creating reloads and opens the crew profile", async () => {
    vi.mocked(api.listHubAgentRoles).mockResolvedValue([]);
    vi.mocked(api.listHubCrews).mockResolvedValue([]);
    vi.mocked(api.createHubCrew).mockResolvedValue(
      crew({ id: "crew-new", name: "Fresh Crew", members: [] }),
    );
    renderRail();

    await waitFor(() => expect(screen.getByText("No saved crews yet.")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "New crew" }));

    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Fresh Crew" } });
    fireEvent.click(screen.getByRole("button", { name: "Create crew" }));

    await waitFor(() => expect(api.createHubCrew).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/assistant/agents/crew/crew-new"),
    );
    // The rail re-fetched so the new crew appears without a remount.
    expect(vi.mocked(api.listHubCrews).mock.calls.length).toBeGreaterThan(1);
  });

  test("a crew row's '+' opens the agent quick-create pre-scoped: the created agent is added to THAT crew", async () => {
    vi.mocked(api.listHubAgentRoles).mockResolvedValue([role()]);
    vi.mocked(api.listHubCrews).mockResolvedValue([crew()]);
    vi.mocked(api.createHubAgentRole).mockResolvedValue(
      role({ id: "role-new", name: "Fresh Agent" }),
    );
    vi.mocked(api.updateHubCrew).mockResolvedValue(crew());
    const onMutated = vi.fn();
    renderRail(SCOPE_ALL, { onMutated });

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Research Team 1 agent" })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Add agent to Research Team" }));

    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Fresh Agent" } });
    fireEvent.change(screen.getByLabelText("Default model"), {
      target: { value: "claude-sonnet-4-5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create agent" }));

    // Create, then the SAME members-array mutation the crew profile saves — appended to crew-1.
    await waitFor(() =>
      expect(api.updateHubCrew).toHaveBeenCalledWith("crew-1", {
        members: [{ agentId: "role-1" }, { agentId: "role-new" }],
      }),
    );
    expect(onMutated).toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/assistant/agents/agent/role-new"),
    );
  });
});

describe("OrgRail — drag an agent between crew branches to reassign (ui-wave U5)", () => {
  function reassignFixtures() {
    vi.mocked(api.listHubAgentRoles).mockResolvedValue([
      role({ id: "role-1", displayName: "Nova", name: "Research Analyst" }),
    ]);
    vi.mocked(api.listHubCrews).mockResolvedValue([
      crew({ id: "crew-1", name: "Research Team", members: [{ agentId: "role-1" }] }),
      crew({ id: "crew-2", name: "Growth Squad", members: [], color: "chart-3" }),
    ]);
    vi.mocked(api.updateHubCrew).mockResolvedValue(crew());
  }

  test("drop on another crew calls updateHubCrew add-to-target then remove-from-source, with a drop highlight", async () => {
    reassignFixtures();
    const onMutated = vi.fn();
    renderRail(SCOPE_ALL, { onMutated });

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Research Team 1 agent" })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Expand Research Team" }));
    const agentRow = screen.getByRole("button", { name: "Nova Research Analyst" });
    const targetRow = screen.getByRole("button", { name: "Growth Squad 0 agents" });

    // React's synthetic drag events bubble from the inner buttons to the row handlers.
    fireEvent.dragStart(agentRow);
    fireEvent.dragOver(targetRow);
    // The target crew row shows the drop highlight while hovered.
    expect(targetRow.parentElement).toHaveAttribute("data-drop-target", "true");
    fireEvent.drop(targetRow);

    await waitFor(() => expect(api.updateHubCrew).toHaveBeenCalledTimes(2));
    // Add to the target FIRST (never silently lose the agent mid-move), then remove from the source.
    expect(api.updateHubCrew).toHaveBeenNthCalledWith(1, "crew-2", {
      members: [{ agentId: "role-1" }],
    });
    expect(api.updateHubCrew).toHaveBeenNthCalledWith(2, "crew-1", { members: [] });
    expect(onMutated).toHaveBeenCalled();
  });

  test("the row's ⋯ menu 'Move to crew' drives the SAME mutation (the keyboard-accessible path)", async () => {
    reassignFixtures();
    renderRail();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Research Team 1 agent" })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Expand Research Team" }));

    // Radix's DropdownMenuTrigger opens on keydown, not click (the suite's verified pattern).
    fireEvent.keyDown(screen.getByRole("button", { name: "Nova actions" }), { key: "Enter" });
    expect(await screen.findByText("Move to crew")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Growth Squad" }));

    await waitFor(() => expect(api.updateHubCrew).toHaveBeenCalledTimes(2));
    expect(api.updateHubCrew).toHaveBeenNthCalledWith(1, "crew-2", {
      members: [{ agentId: "role-1" }],
    });
    expect(api.updateHubCrew).toHaveBeenNthCalledWith(2, "crew-1", { members: [] });
  });
});

// Crew nesting (WP4.2 / D-CN8) — the org rail's tree goes N-level: a `crewId` member renders a nested,
// expandable branch (recursing the SAME `BranchRow`/`AgentRow` machinery), a cycle/dangling reference
// renders a contained, non-interactive placeholder instead of hanging or crashing, and every count/
// assignment computation is recursive via `crew-membership.ts`'s cycle-safe closure.
describe("OrgRail — N-level crew nesting (WP4.2 / D-CN8)", () => {
  test("a crew with a nested sub-crew member reveals an expandable sub-branch, which reveals its own agent leaves", async () => {
    vi.mocked(api.listHubAgentRoles).mockResolvedValue([
      role({ id: "role-1", displayName: "Nova", name: "Research Analyst" }),
      role({ id: "role-2", displayName: "Scout", name: "Field Agent" }),
    ]);
    vi.mocked(api.listHubCrews).mockResolvedValue([
      crew({
        id: "sub-1",
        name: "Intel Squad",
        members: [{ agentId: "role-2" }],
      }),
      crew({
        id: "crew-1",
        name: "Research Team",
        members: [{ agentId: "role-1" }, { crewId: "sub-1" }],
      }),
    ]);
    renderRail();

    // The top-level crew's count is recursive: 2 agents (1 direct + 1 via the sub-crew), 1 crew.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Research Team 2 agents, 1 crew (3 total)" }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Expand Research Team" }));

    // Intel Squad is ALSO independently top-level (every saved crew is browsable on its own, nested
    // or not — D-CN8), so scope queries to Research Team's own expanded children to disambiguate from
    // its separate top-level branch.
    const nestedList = screen.getByLabelText("Research Team members");
    // The direct agent member renders as usual, and the nested crew renders its OWN expandable branch
    // (same BranchRow machinery) rather than a flattened/omitted entry.
    expect(within(nestedList).getByRole("button", { name: "Nova Research Analyst" })).toBeInTheDocument();
    expect(
      within(nestedList).getByRole("button", { name: "Intel Squad 1 agent" }),
    ).toBeInTheDocument();
    expect(within(nestedList).queryByText("Scout")).not.toBeInTheDocument();

    fireEvent.click(within(nestedList).getByRole("button", { name: "Expand Intel Squad" }));
    expect(
      within(nestedList).getByRole("button", { name: "Scout Field Agent" }),
    ).toBeInTheDocument();
  });

  test("a flat crew (no crewId members) still shows a plain 'N agents' count — no visible regression", async () => {
    vi.mocked(api.listHubAgentRoles).mockResolvedValue([role({ id: "role-1" })]);
    vi.mocked(api.listHubCrews).mockResolvedValue([crew({ members: [{ agentId: "role-1" }] })]);
    renderRail();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Research Team 1 agent" })).toBeInTheDocument(),
    );
  });

  test("a synthetic cyclic fixture (A ↔ B) renders a non-interactive warning placeholder instead of hanging or crashing", async () => {
    vi.mocked(api.listHubAgentRoles).mockResolvedValue([role({ id: "role-1" })]);
    vi.mocked(api.listHubCrews).mockResolvedValue([
      crew({ id: "crew-a", name: "Crew A", members: [{ agentId: "role-1" }, { crewId: "crew-b" }] }),
      crew({ id: "crew-b", name: "Crew B", members: [{ crewId: "crew-a" }] }),
    ]);
    renderRail();

    await waitFor(() => expect(screen.getByText("Crew A")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Expand Crew A" }));
    // Crew B renders TWICE — its own top-level branch (it's a standalone saved crew) AND a nested
    // occurrence under Crew A — sharing ONE expansion key (`crew:crew-b`, not path-scoped, D-CN8), so
    // toggling either expands both (each occurrence still resolves via its OWN local ancestor path,
    // so this doubled entry point still terminates — it's simply a second, independent way to reach
    // the same cyclic pair, not a bug).
    fireEvent.click(screen.getAllByRole("button", { name: "Expand Crew B" })[0]!);

    // The test reaching this line at all (vs. a timeout/stack overflow) already proves termination.
    // Descending into a "crewId: crew-a"/"crewId: crew-b" member from either entry point reaches the
    // cycle — a contained warning row, never a hang, never a crash, never another interactive branch.
    expect(screen.getAllByText("Circular reference — hidden to avoid a loop").length).toBeGreaterThan(0);
  });

  test("a dangling crewId member (the referenced crew no longer exists) renders a disabled '(deleted crew)' leaf", async () => {
    vi.mocked(api.listHubAgentRoles).mockResolvedValue([role({ id: "role-1" })]);
    vi.mocked(api.listHubCrews).mockResolvedValue([
      crew({
        id: "crew-1",
        name: "Research Team",
        members: [{ agentId: "role-1" }, { crewId: "ghost-crew" }],
      }),
    ]);
    renderRail();

    await waitFor(() => expect(screen.getByText("Research Team")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Expand Research Team" }));
    expect(screen.getByText(/\(deleted crew/)).toBeInTheDocument();
  });

  test("an agent reachable only through a nested sub-crew does not appear under Unassigned", async () => {
    vi.mocked(api.listHubAgentRoles).mockResolvedValue([
      role({ id: "role-1", name: "Nested Agent" }),
      role({ id: "role-2", name: "Free Agent" }),
    ]);
    vi.mocked(api.listHubCrews).mockResolvedValue([
      crew({ id: "sub-1", name: "Intel Squad", members: [{ agentId: "role-1" }] }),
      crew({ id: "crew-1", name: "Research Team", members: [{ crewId: "sub-1" }] }),
    ]);
    renderRail();

    // Only Free Agent (truly unassigned) counts — Nested Agent is reachable via the sub-crew.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Unassigned 1" })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Expand Unassigned" }));
    expect(screen.getByRole("button", { name: "Free Agent" })).toBeInTheDocument();
    expect(screen.queryByText("Nested Agent")).not.toBeInTheDocument();
  });
});
