// Assistant Hub UX WP2.4 (D-HUX6) — the crew profile `WideDialog`: loads a crew by `useParams().crewId`,
// edits it as ONE unified form across Profile/Members/Topology/Budgets (Memory/Usage are read-only),
// and proves the two documented cross-component slots (`topologyRenderer`/`memorySection`).

import {
  buildHubCrewAnalyzePrompt,
  type HubAgentRole,
  type HubCrew,
  type HubSession,
  type HubUsageSummary,
} from "@mcp-token-footprint/shared";
import { TooltipProvider } from "@elabs-ai/components-ui";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

// `RoleAvatar` reaches for the real `@elabs-ai/components-ai` Persona (Rive/WebGL2 — unavailable in jsdom); mock it
// exactly like `CrewEditor.test.tsx`/`TopologyGraph.test.tsx` do.
vi.mock("@elabs-ai/components-ai", () => import("../../test-support/brand-ai-mock"));

// Assistant operability WP 3.2 (D-AO5) — the "Ask the assistant" header action. `useAssistant` is
// mocked so the click's effect (`openAssistant`) is observed directly — same pattern as
// `AgentProfileModal.test.tsx` / `IssueAssistantMount.test.tsx`.
const mockOpenAssistant = vi.fn();
let authConfigured = true;

vi.mock("../../../assistant/assistant-context", () => ({
  useAssistant: () => ({ authConfigured, openAssistant: mockOpenAssistant }),
}));

// `UsageSection`'s `Sparkline` pulls in `@visx/gradient`, which fails to resolve under vitest/jsdom
// (a genuine module-resolution break, not a jsdom-capability gap) — every other chart-touching test
// in this repo mocks `@elabs-ai/components-charts` rather than render the real thing (see e.g. `CostPanel.test.tsx`).
vi.mock("@elabs-ai/components-charts", () => ({
  Sparkline: ({ label }: { label?: string }) => <div data-testid="usage-sparkline">{label}</div>,
}));

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

vi.mock("../../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../lib/api")>();
  return {
    ...actual,
    getHubCrew: vi.fn(),
    updateHubCrew: vi.fn(),
    listHubAgentRoles: vi.fn(),
    listHubCrews: vi.fn(),
    listHubMemory: vi.fn(),
    getHubUsageSummary: vi.fn(),
    createHubSession: vi.fn(),
    listProviders: vi.fn(),
    listProviderModels: vi.fn(),
  };
});

import * as api from "../../../../lib/api";
import { CrewProfileModal } from "./CrewProfileModal";

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
    description: "Digs through scan results.",
    color: "chart-2",
    topology: "parallel",
    members: [{ agentId: "role-1" }],
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

const USAGE_SUMMARY: HubUsageSummary = {
  groupBy: "crew",
  id: "crew-1",
  label: "Research Team",
  totals: { sessions: 4, costUsd: 1.23, tokensIn: 1000, tokensOut: 500 },
  strip: [
    { key: "2026-06-30", label: "Jun 30", sessions: 1, costUsd: 0.5, tokensIn: 100, tokensOut: 50 },
    { key: "2026-07-01", label: "Jul 1", sessions: 3, costUsd: 0.73, tokensIn: 900, tokensOut: 450 },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  authConfigured = true;
  vi.mocked(api.getHubCrew).mockResolvedValue(crew());
  vi.mocked(api.updateHubCrew).mockResolvedValue(crew());
  vi.mocked(api.listHubAgentRoles).mockResolvedValue([role(), role({ id: "role-2", name: "Writer" })]);
  // Crew nesting (WP4.1) — a default snapshot including the crew being edited (crew-1) plus one
  // clean, nestable crew.
  vi.mocked(api.listHubCrews).mockResolvedValue([crew(), crew({ id: "crew-2", name: "Ops Crew" })]);
  vi.mocked(api.listHubMemory).mockResolvedValue([]);
  vi.mocked(api.getHubUsageSummary).mockResolvedValue(USAGE_SUMMARY);
  vi.mocked(api.createHubSession).mockResolvedValue({ id: "session-1" } as HubSession);
  vi.mocked(api.listProviders).mockResolvedValue([
    {
      id: "cred-1",
      kind: "anthropic",
      label: "Anthropic",
      hasKey: true,
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    },
  ]);
  vi.mocked(api.listProviderModels).mockResolvedValue({
    models: [{ id: "claude-sonnet-4-5", displayName: "Claude Sonnet 4.5" }],
    source: "provider",
  });
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

// The Members section's move-up/move-down/remove controls are `IconButton`s (D-TB5), which wrap
// every control in a Radix `Tooltip` — that throws without an ancestor `TooltipProvider` (the app
// root mounts one).
function renderModal(
  props: Partial<Parameters<typeof CrewProfileModal>[0]> = {},
  { initialEntries = ["/assistant/agents/crew/crew-1"] }: { initialEntries?: string[] } = {},
) {
  render(
    <TooltipProvider>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route
            path="/assistant/agents/crew/:crewId"
            element={
              <>
                <LocationProbe />
                <CrewProfileModal {...props} />
              </>
            }
          />
          <Route path="/assistant/agents" element={<LocationProbe />} />
          <Route path="/assistant" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </TooltipProvider>,
  );
}

/** Switch the WideDialog rail to a named section (each rail entry is a `role="button"`). */
function openSection(name: string): void {
  fireEvent.click(screen.getByRole("button", { name }));
}

describe("CrewProfileModal — load", () => {
  test("shows a loading state, then the crew's Profile section by default", async () => {
    renderModal();
    expect(screen.getByText("Loading crew…")).toBeInTheDocument();

    await screen.findByText("Research Team");
    expect(api.getHubCrew).toHaveBeenCalledWith("crew-1");
    expect(screen.getByLabelText("Name")).toHaveValue("Research Team");
    expect(screen.getByLabelText("Description")).toHaveValue("Digs through scan results.");
    expect(screen.getByRole("button", { name: "Members" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Topology" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Budgets" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Memory" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Usage" })).toBeInTheDocument();
  });

  test("a crew that fails to load shows an error state with retry", async () => {
    vi.mocked(api.getHubCrew).mockRejectedValueOnce(new Error("boom"));
    renderModal();
    await screen.findByText("Couldn’t load this crew");
    expect(screen.getByText("boom")).toBeInTheDocument();
  });

  test("`?settings=members` deep-links directly into the Members section", async () => {
    renderModal({}, { initialEntries: ["/assistant/agents/crew/crew-1?settings=members"] });
    await screen.findByText("Research Team");
    expect(screen.getByLabelText("Add a role from the library")).toBeInTheDocument();
  });
});

describe("CrewProfileModal — Profile section (D-HUX6/D-HUX8)", () => {
  test("editing the name/description marks the form dirty; Save persists the trimmed patch", async () => {
    renderModal();
    await screen.findByText("Research Team");

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "  Renamed Team  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save crew" }));

    await waitFor(() => expect(api.updateHubCrew).toHaveBeenCalledTimes(1));
    expect(api.updateHubCrew).toHaveBeenCalledWith(
      "crew-1",
      expect.objectContaining({ name: "Renamed Team" }),
    );
  });

  test("the color picker offers exactly the five chart-N swatches + a 'no color' option, and writes chart-N on save", async () => {
    renderModal();
    await screen.findByText("Research Team");

    for (const n of [1, 2, 3, 4, 5]) {
      expect(screen.getByRole("radio", { name: `Color ${n}` })).toBeInTheDocument();
    }
    expect(screen.getByRole("radio", { name: "No color" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Color 4" }));
    fireEvent.click(screen.getByRole("button", { name: "Save crew" }));

    await waitFor(() => expect(api.updateHubCrew).toHaveBeenCalledTimes(1));
    expect(api.updateHubCrew).toHaveBeenCalledWith(
      "crew-1",
      expect.objectContaining({ color: "chart-4" }),
    );
  });

  test("picking 'No color' clears the accent (color: null) on save", async () => {
    renderModal();
    await screen.findByText("Research Team");

    fireEvent.click(screen.getByRole("radio", { name: "No color" }));
    fireEvent.click(screen.getByRole("button", { name: "Save crew" }));

    await waitFor(() => expect(api.updateHubCrew).toHaveBeenCalledTimes(1));
    expect(api.updateHubCrew).toHaveBeenCalledWith("crew-1", expect.objectContaining({ color: null }));
  });

  test("Save works even with no changes (matches the EnvironmentEditor precedent — no dirty-gating on submit)", async () => {
    renderModal();
    await screen.findByText("Research Team");
    fireEvent.click(screen.getByRole("button", { name: "Save crew" }));
    await waitFor(() => expect(api.updateHubCrew).toHaveBeenCalledTimes(1));
  });
});

describe("CrewProfileModal — Members section (add/remove/order)", () => {
  test("removing the only member shows the 'add at least one role' validation on Save", async () => {
    renderModal();
    await screen.findByText("Research Team");
    openSection("Members");

    fireEvent.click(screen.getByRole("button", { name: /Remove Research Analyst/ }));
    expect(screen.getByText("No members yet")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save crew" }));
    expect(await screen.findByText("Add at least one role.")).toBeInTheDocument();
    expect(api.updateHubCrew).not.toHaveBeenCalled();
  });

  test("reordering members changes save order; a boundary move is a no-op", async () => {
    vi.mocked(api.getHubCrew).mockResolvedValue(
      crew({ members: [{ agentId: "role-1" }, { agentId: "role-2" }] }),
    );
    renderModal();
    await screen.findByText("Research Team");
    openSection("Members");

    // The first member can't move up, the last can't move down.
    expect(screen.getByRole("button", { name: /Move Research Analyst up/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Move Writer down/ })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /Move Writer up/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save crew" }));

    await waitFor(() => expect(api.updateHubCrew).toHaveBeenCalledTimes(1));
    expect(api.updateHubCrew).toHaveBeenCalledWith(
      "crew-1",
      expect.objectContaining({ members: [{ agentId: "role-2" }, { agentId: "role-1" }] }),
    );
  });

  test("adding a role from the library grows the crew (Save reflects the new member)", async () => {
    renderModal();
    await screen.findByText("Research Team");
    openSection("Members");

    fireEvent.click(screen.getByRole("combobox", { name: "Add a role from the library" }));
    fireEvent.click(await screen.findByRole("option", { name: "Writer" }));
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    fireEvent.click(screen.getByRole("button", { name: "Save crew" }));
    await waitFor(() => expect(api.updateHubCrew).toHaveBeenCalledTimes(1));
    expect(api.updateHubCrew).toHaveBeenCalledWith(
      "crew-1",
      expect.objectContaining({ members: [{ agentId: "role-1" }, { agentId: "role-2" }] }),
    );
  });
});

describe("CrewProfileModal — crew-nesting cycle guard (WP4.1, D-CN4)", () => {
  test("blocks Save (no updateHubCrew call) when a member would create a crew-nesting cycle", async () => {
    // "crew-1" (the crew being edited) already has a `crewId` member pointing at "crew-2" — and
    // "crew-2" ALREADY nests "crew-1" back, so saving as-is would close the loop.
    vi.mocked(api.getHubCrew).mockResolvedValue(
      crew({ members: [{ agentId: "role-1" }, { crewId: "crew-2" }] }),
    );
    vi.mocked(api.listHubCrews).mockResolvedValue([
      crew({ members: [{ agentId: "role-1" }, { crewId: "crew-2" }] }),
      crew({ id: "crew-2", name: "Ops Crew", members: [{ crewId: "crew-1" }] }),
    ]);

    renderModal();
    await screen.findByText("Research Team");
    openSection("Members");

    fireEvent.click(screen.getByRole("button", { name: "Save crew" }));

    expect(
      await screen.findByText("“Ops Crew” would create a circular crew reference — remove it."),
    ).toBeInTheDocument();
    expect(api.updateHubCrew).not.toHaveBeenCalled();
  });

  test("saves normally when no member would create a cycle or breach the max depth", async () => {
    vi.mocked(api.getHubCrew).mockResolvedValue(
      crew({ members: [{ agentId: "role-1" }, { crewId: "crew-2" }] }),
    );
    vi.mocked(api.listHubCrews).mockResolvedValue([
      crew({ members: [{ agentId: "role-1" }, { crewId: "crew-2" }] }),
      crew({ id: "crew-2", name: "Ops Crew" }), // a clean leaf — no cycle, no depth breach
    ]);

    renderModal();
    await screen.findByText("Research Team");
    fireEvent.click(screen.getByRole("button", { name: "Save crew" }));

    await waitFor(() => expect(api.updateHubCrew).toHaveBeenCalledTimes(1));
    expect(api.updateHubCrew).toHaveBeenCalledWith(
      "crew-1",
      expect.objectContaining({ members: [{ agentId: "role-1" }, { crewId: "crew-2" }] }),
    );
  });
});

describe("CrewProfileModal — Topology section (shared renderer, D-HUX9)", () => {
  test("the default preview is WP2.5's CrewTopologyGraph (topology-true, wired WP2.8)", async () => {
    renderModal();
    await screen.findByText("Research Team");
    openSection("Topology");
    // WP2.8 — the DEFAULT is now the org-chart `CrewTopologyGraph` (built from the LIVE form),
    // labelled by the live topology + member count.
    expect(screen.getByTestId("crew-topology-graph")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /Parallel topology/ })).toBeInTheDocument();
  });

  test("the topologyRenderer slot replaces the default when provided", async () => {
    renderModal({ topologyRenderer: <div data-testid="org-chart-topology">WP2.5's renderer</div> });
    await screen.findByText("Research Team");
    openSection("Topology");
    expect(screen.getByTestId("org-chart-topology")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /Parallel topology/ })).not.toBeInTheDocument();
  });
});

describe("CrewProfileModal — Memory section (ScopedMemoryList default + memorySection slot)", () => {
  test("the default is WP2.7's ScopedMemoryList, filtered to this crew's memory (wired WP2.8)", async () => {
    vi.mocked(api.listHubMemory).mockResolvedValue([
      {
        id: "mem-1",
        kind: "instruction",
        content: "Always cite sources.",
        source: "user",
        status: "active",
        scope: "crew",
        scopeId: "crew-1",
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
      },
    ]);
    renderModal();
    await screen.findByText("Research Team");
    openSection("Memory");

    await screen.findByText("Always cite sources.");
    // ScopedMemoryList fetches the full list and filters by scope client-side (WP2.7) + offers Add.
    expect(api.listHubMemory).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Add/ })).toBeInTheDocument();
  });

  test("the memorySection slot replaces the default when provided", async () => {
    renderModal({ memorySection: <div data-testid="scoped-memory-list">WP2.7's list</div> });
    await screen.findByText("Research Team");
    openSection("Memory");
    expect(screen.getByTestId("scoped-memory-list")).toBeInTheDocument();
  });
});

describe("CrewProfileModal — Usage section (WP1.6 per-entity summary)", () => {
  test("shows totals + a daily-cost sparkline for the crew", async () => {
    renderModal();
    await screen.findByText("Research Team");
    openSection("Usage");

    await screen.findByText("$1.23");
    expect(api.getHubUsageSummary).toHaveBeenCalledWith({ groupBy: "crew", id: "crew-1" });
    expect(screen.getByText("4")).toBeInTheDocument(); // sessions
  });
});

describe("CrewProfileModal — Instantiate action", () => {
  test("disabled when the crew has no members", async () => {
    vi.mocked(api.getHubCrew).mockResolvedValue(crew({ members: [] }));
    renderModal();
    await screen.findByText("Research Team");
    expect(screen.getByRole("button", { name: /Instantiate/ })).toBeDisabled();
  });

  test("starts a mission session from this crew and navigates into the workspace", async () => {
    renderModal();
    await screen.findByText("Research Team");
    const button = await screen.findByRole("button", { name: /Instantiate/ });
    await waitFor(() => expect(button).toBeEnabled());

    fireEvent.click(button);
    await waitFor(() =>
      expect(api.createHubSession).toHaveBeenCalledWith({
        mode: "mission",
        model: "claude-sonnet-4-5",
        // model-identity WP 3.1 (D-MI1) — the coordinating session pins the credential the model was
        // picked from, instead of leaving the API to re-guess a provider from the model NAME.
        providerCredentialId: "cred-1",
        crewId: "crew-1",
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/assistant?session=session-1"),
    );
  });

  // model-identity WP 4.1 (D-MI7) — the coordinating model is a visible, changeable choice now.
  test("the coordinating model can be CHANGED before instantiating; the pick carries its credential", async () => {
    vi.mocked(api.listProviders).mockResolvedValue([
      {
        id: "cred-1",
        kind: "anthropic",
        label: "Anthropic",
        hasKey: true,
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
      },
      {
        id: "cred-2",
        kind: "openai",
        label: "OpenAI",
        hasKey: true,
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
      },
    ]);
    vi.mocked(api.listProviderModels).mockImplementation(async (id: string) =>
      id === "cred-1"
        ? { models: [{ id: "claude-sonnet-4-5", displayName: "Claude Sonnet 4.5" }], source: "provider" }
        : { models: [{ id: "gpt-5", displayName: "GPT-5" }], source: "provider" },
    );
    renderModal();
    await screen.findByText("Research Team");

    fireEvent.click(await screen.findByRole("button", { name: /^Coordinating model:/ }));
    fireEvent.click(
      within(screen.getByTestId("model-selector-content")).getByRole("button", { name: /^GPT-5/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Instantiate/ }));

    await waitFor(() =>
      expect(api.createHubSession).toHaveBeenCalledWith({
        mode: "mission",
        model: "gpt-5",
        providerCredentialId: "cred-2",
        crewId: "crew-1",
      }),
    );
  });
});

describe("CrewProfileModal — member model override (model-identity WP 4.1)", () => {
  test("picking a member's model override saves BOTH the id and its credential", async () => {
    renderModal({}, { initialEntries: ["/assistant/agents/crew/crew-1?settings=members"] });
    await screen.findByText("Research Team");

    // Expand the first member's accordion, then pick from the shared picker.
    fireEvent.click(screen.getByRole("button", { name: "Research Analyst" }));
    fireEvent.click(await screen.findByRole("button", { name: /^Model override:/ }));
    fireEvent.click(
      within(screen.getByTestId("model-selector-content")).getByRole("button", {
        name: /^Claude Sonnet 4\.5/,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save crew" }));

    await waitFor(() => expect(api.updateHubCrew).toHaveBeenCalledTimes(1));
    const [, patch] = vi.mocked(api.updateHubCrew).mock.calls[0]!;
    expect(patch.members?.[0]).toMatchObject({
      agentId: "role-1",
      model: "claude-sonnet-4-5",
      // D-MI1 — `HubCrewMember.providerCredentialId` has existed since WP 1.1 but was unreachable
      // from the UI: the override was a bare free-text field.
      providerCredentialId: "cred-1",
    });
  });
});

describe("CrewProfileModal — close + dirty guard", () => {
  test("Save closes the modal, navigating back to /assistant/agents", async () => {
    renderModal();
    await screen.findByText("Research Team");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save crew" }));

    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/assistant/agents"),
    );
  });

  test("Cancel with unsaved changes warns before discarding", async () => {
    renderModal();
    await screen.findByText("Research Team");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Renamed" } });

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await screen.findByRole("heading", { name: /discard/i })).toBeInTheDocument();
    // Still on the crew route — nothing navigated away yet.
    expect(screen.getByTestId("location")).toHaveTextContent("/assistant/agents/crew/crew-1");
  });

  test("Cancel with no changes closes immediately", async () => {
    renderModal();
    await screen.findByText("Research Team");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/assistant/agents"),
    );
  });
});

describe("CrewProfileModal — Ask the assistant header action (assistant-operability WP 3.2)", () => {
  test("hidden entirely when the assistant is not configured", async () => {
    authConfigured = false;
    renderModal();
    await screen.findByText("Research Team");
    expect(screen.queryByRole("button", { name: "Ask the assistant" })).not.toBeInTheDocument();
    // The unrelated "Instantiate" header action is unaffected by this gate.
    expect(screen.getByRole("button", { name: /Instantiate/ })).toBeInTheDocument();
  });

  test("renders alongside Instantiate and opens the dock with the built prompt (never auto-sent)", async () => {
    renderModal();
    await screen.findByText("Research Team");

    const button = screen.getByRole("button", { name: "Ask the assistant" });
    fireEvent.click(button);

    expect(mockOpenAssistant).toHaveBeenCalledTimes(1);
    expect(mockOpenAssistant).toHaveBeenCalledWith({
      prompt: buildHubCrewAnalyzePrompt("Research Team"),
    });
    const arg = mockOpenAssistant.mock.calls[0]?.[0] as { prompt?: string; entity?: unknown };
    expect(arg.entity).toBeUndefined();
  });
});
