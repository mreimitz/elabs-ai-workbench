import { buildHubAgentAnalyzePrompt, type HubAgentRole, type HubUsageSummary } from "@mcp-token-footprint/shared";
import { fireEvent, render as rtlRender, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@elabs-ai/components-ui";
import type { ReactElement } from "react";

// The modal's title avatar is `@elabs-ai/components-ai`'s `Persona` (Rive/WebGL2 — jsdom can't render it); stub it
// with the shared hub test-support mock, as every other hub suite does.
vi.mock("@elabs-ai/components-ai", () => import("../../test-support/brand-ai-mock"));

// Assistant operability WP 3.2 (D-AO5) — the "Ask the assistant" header action. `useAssistant` is
// mocked so the click's effect (`openAssistant`) is observed directly, without standing up the whole
// dock/stream machinery — same pattern as `IssueAssistantMount.test.tsx`.
const mockOpenAssistant = vi.fn();
let authConfigured = true;

vi.mock("../../../assistant/assistant-context", () => ({
  useAssistant: () => ({ authConfigured, openAssistant: mockOpenAssistant }),
}));

vi.mock("../../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../lib/api")>();
  return {
    ...actual,
    getHubAgentRole: vi.fn(),
    updateHubAgentRole: vi.fn(),
    listServers: vi.fn(),
    apiGet: vi.fn(),
    listSkills: vi.fn(),
    listProviders: vi.fn(),
    listProviderModels: vi.fn(),
    listHubMemory: vi.fn(),
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

import * as api from "../../../../lib/api";
import { AgentProfileModal } from "./AgentProfileModal";

function role(overrides: Partial<HubAgentRole> = {}): HubAgentRole {
  return {
    id: "role-1",
    name: "Research Analyst",
    displayName: "Ada",
    description: "Investigates topics",
    icon: "search",
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

function usageSummary(): HubUsageSummary {
  return {
    groupBy: "agent",
    id: "role-1",
    label: "Research Analyst",
    totals: { sessions: 2, costUsd: 0.5, tokensIn: 1000, tokensOut: 500 },
    strip: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  authConfigured = true;
  vi.mocked(api.getHubAgentRole).mockResolvedValue(role());
  vi.mocked(api.updateHubAgentRole).mockResolvedValue(role());
  vi.mocked(api.listServers).mockResolvedValue([]);
  vi.mocked(api.listSkills).mockResolvedValue([]);
  vi.mocked(api.listProviders).mockResolvedValue([]);
  vi.mocked(api.listProviderModels).mockResolvedValue({ models: [], source: "provider" });
  vi.mocked(api.listHubMemory).mockResolvedValue([]);
  vi.mocked(api.apiGet).mockImplementation(async (path: string) => {
    if (path.startsWith("/api/hub/usage/summary")) return usageSummary() as never;
    throw new Error(`unexpected apiGet(${path})`);
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

function render(ui: ReactElement) {
  return rtlRender(<TooltipProvider>{ui}</TooltipProvider>);
}

function renderModal(initialEntries: string[] = ["/assistant/agents/agent/role-1"]) {
  // The Memory section renders `ScopedMemoryList`, which uses `IconButton`s (D-TB5) — those wrap
  // every control in a Radix `Tooltip`, which throws without an ancestor `TooltipProvider` (the app
  // root mounts one; this file's render doesn't get it automatically).
  render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route path="/assistant/agents" element={<LocationProbe />} />
        <Route
          path="/assistant/agents/agent/:agentId"
          element={
            <>
              <LocationProbe />
              <AgentProfileModal />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("AgentProfileModal — shell + section navigation (D-HUX6)", () => {
  test("opens at Profile by default with the eight-section rail and the identity fields", async () => {
    renderModal();
    await screen.findByRole("button", { name: "Save changes" });
    // The rail lists all eight D-HUX6 sections.
    for (const label of [
      "Profile",
      "Instructions",
      "Model",
      "Access",
      "Skills",
      "Memory",
      "Budgets",
      "Usage",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    // Profile fields (incl. the D-HUX8 display name) are the default view.
    expect(await screen.findByLabelText("Display name (optional)")).toHaveValue("Ada");
    expect(screen.getByLabelText("Role title")).toHaveValue("Research Analyst");
  });

  test("?settings= deep-links straight into a section", async () => {
    renderModal(["/assistant/agents/agent/role-1?settings=instructions"]);
    expect(await screen.findByLabelText("System prompt")).toHaveValue(
      "You research topics thoroughly.",
    );
  });

  test("clicking a rail item writes ?settings= and swaps the section", async () => {
    renderModal();
    await screen.findByRole("button", { name: "Save changes" });

    fireEvent.click(screen.getByRole("button", { name: "Model" }));
    expect(screen.getByTestId("location")).toHaveTextContent("settings=model");
    expect(await screen.findByLabelText("Default model")).toHaveValue("claude-sonnet-4-5");
  });

  test("every one of the eight sections is reachable (each field of the old editor + the new ones)", async () => {
    renderModal();
    await screen.findByLabelText("Role title");

    fireEvent.click(screen.getByRole("button", { name: "Instructions" }));
    expect(await screen.findByLabelText("Target (objective)")).toBeInTheDocument();
    expect(screen.getByLabelText("Expected outcome")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Model" }));
    expect(await screen.findByLabelText("Default model")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Access" }));
    expect(await screen.findByText("Granted footprint")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Skills" }));
    expect(await screen.findByText(/No skills are registered yet/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Memory" }));
    // WP2.8 — the Memory section's default is now WP2.7's `ScopedMemoryList` (its empty state), not
    // the WP2.3 read-only fallback ("No agent-scoped memory").
    expect(await screen.findByText("No memory saved yet")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Budgets" }));
    expect(await screen.findByText("Max turns")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Usage" }));
    expect(await screen.findByText("Sessions")).toBeInTheDocument();
  });
});

describe("AgentProfileModal — Model section is a searchable, family-grouped card grid", () => {
  function withOpenAiRoster() {
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
      models: [{ id: "gpt-4o", displayName: "GPT-4o" }, { id: "gpt-4o-mini" }],
      source: "provider",
    });
  }

  /** Opens the Model section, then the shared picker's palette, and scopes queries to it. */
  async function openModelPalette() {
    await screen.findByRole("button", { name: "Save changes" });
    fireEvent.click(screen.getByRole("button", { name: "Model" }));
    fireEvent.click(await screen.findByRole("button", { name: /^Default model:/ }));
    return within(screen.getByTestId("model-selector-content"));
  }

  test("renders the provider group, the roster rows, and the off-roster current value", async () => {
    withOpenAiRoster(); // the role's defaultModel ("claude-sonnet-4-5") is NOT in this roster
    renderModal();
    const palette = await openModelPalette();

    // The live roster loads (async) and renders as rows, grouped under the OpenAI family.
    expect(palette.getByRole("button", { name: /^GPT-4o/ })).toBeInTheDocument();
    expect(palette.getByRole("button", { name: /^gpt-4o-mini/ })).toBeInTheDocument();
    expect(palette.getByText("OpenAI")).toBeInTheDocument();
    // The assigned, off-roster id stays visible + selected so it is never silently dropped — and
    // says so, rather than being re-attributed to whatever credential happens to be first.
    expect(palette.getByText("Current selection")).toBeInTheDocument();
    expect(palette.getByText(/not in the live roster/i)).toBeInTheDocument();
  });

  test("the search box filters the rows", async () => {
    withOpenAiRoster();
    renderModal();
    const palette = await openModelPalette();

    fireEvent.change(palette.getByRole("textbox", { name: /search models/i }), {
      target: { value: "mini" },
    });

    expect(palette.queryByRole("button", { name: /^GPT-4o/ })).not.toBeInTheDocument();
    expect(palette.getByRole("button", { name: /^gpt-4o-mini/ })).toBeInTheDocument();
  });

  // D-MI7's search fix: the palette finds a row by its PROVIDER, not only by model id.
  test("searching by provider name finds the row", async () => {
    withOpenAiRoster();
    renderModal();
    const palette = await openModelPalette();

    fireEvent.change(palette.getByRole("textbox", { name: /search models/i }), {
      target: { value: "openai" },
    });
    expect(palette.getByRole("button", { name: /^GPT-4o/ })).toBeVisible();
  });

  test("picking a row sets the default model AND its credential, and both save in the PATCH", async () => {
    withOpenAiRoster();
    renderModal();
    const palette = await openModelPalette();

    fireEvent.click(palette.getByRole("button", { name: /^GPT-4o/ }));
    // Selection makes the draft dirty; the picked model persists in the PATCH.
    fireEvent.click(await screen.findByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(api.updateHubAgentRole).toHaveBeenCalledTimes(1));
    const [, patch] = vi.mocked(api.updateHubAgentRole).mock.calls[0]!;
    expect(patch.defaultModel).toBe("gpt-4o");
    // D-MI1 (WP 4.1) — the credential travels with the id, so the API never has to re-guess it.
    expect(patch.providerCredentialId).toBe("cred-1");
  });
});

describe("AgentProfileModal — Memory section default is WP2.7's ScopedMemoryList (wired WP2.8)", () => {
  test("lists this agent's scoped memory and offers the Add affordance", async () => {
    vi.mocked(api.listHubMemory).mockResolvedValue([
      {
        id: "mem-1",
        kind: "preference",
        content: "Prefers concise bullet summaries.",
        source: "user",
        status: "active",
        scope: "agent",
        scopeId: "role-1",
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
      },
    ]);
    renderModal();
    await screen.findByRole("button", { name: "Save changes" });
    fireEvent.click(screen.getByRole("button", { name: "Memory" }));

    // ScopedMemoryList surfaces the entry + its own Add control (the read-only fallback had neither).
    expect(await screen.findByText("Prefers concise bullet summaries.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add/ })).toBeInTheDocument();
  });
});

describe("AgentProfileModal — dirty guard + save roundtrip (D-HUX6)", () => {
  test("Save changes is disabled until the draft is dirty", async () => {
    renderModal();
    const save = await screen.findByRole("button", { name: "Save changes" });
    expect(save).toBeDisabled();

    fireEvent.change(await screen.findByLabelText("Display name (optional)"), {
      target: { value: "Grace" },
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled());
  });

  test("saving PATCHes the full role shape (incl. the D-HUX8 displayName) and closes to the list", async () => {
    renderModal();
    await screen.findByLabelText("Display name (optional)");
    fireEvent.change(screen.getByLabelText("Display name (optional)"), {
      target: { value: "Grace" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(api.updateHubAgentRole).toHaveBeenCalledTimes(1));
    const [id, patch] = vi.mocked(api.updateHubAgentRole).mock.calls[0]!;
    expect(id).toBe("role-1");
    expect(patch.displayName).toBe("Grace");
    expect(patch.name).toBe("Research Analyst");
    expect(patch.systemPrompt).toBe("You research topics thoroughly.");
    // Closed back to the bare list (node path + ?settings= dropped).
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/assistant/agents"),
    );
  });

  test("a submit with a required field cleared routes the rail to that field's section and blocks the save", async () => {
    renderModal(["/assistant/agents/agent/role-1?settings=instructions"]);
    // Clear the system prompt (Instructions), then jump to another section before saving.
    fireEvent.change(await screen.findByLabelText("System prompt"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Model" }));
    expect(screen.getByTestId("location")).toHaveTextContent("settings=model");

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    // Routed BACK to Instructions with the inline error; no PATCH fired.
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("settings=instructions"));
    expect(await screen.findByText("A system prompt is required.")).toBeInTheDocument();
    expect(api.updateHubAgentRole).not.toHaveBeenCalled();
  });
});

describe("AgentProfileModal — Ask the assistant header action (assistant-operability WP 3.2)", () => {
  test("hidden entirely when the assistant is not configured", async () => {
    authConfigured = false;
    renderModal();
    await screen.findByRole("button", { name: "Save changes" });
    expect(screen.queryByRole("button", { name: "Ask the assistant" })).not.toBeInTheDocument();
  });

  test("renders next to the title and opens the dock with the built prompt (never auto-sent)", async () => {
    renderModal();
    await screen.findByRole("button", { name: "Save changes" });

    const button = screen.getByRole("button", { name: "Ask the assistant" });
    fireEvent.click(button);

    expect(mockOpenAssistant).toHaveBeenCalledTimes(1);
    expect(mockOpenAssistant).toHaveBeenCalledWith({ prompt: buildHubAgentAnalyzePrompt("Ada") });
    // Prefill only — no navigation/entity pin, matches the class doc's "unpinned" contract.
    const arg = mockOpenAssistant.mock.calls[0]?.[0] as { prompt?: string; entity?: unknown };
    expect(arg.entity).toBeUndefined();
  });
});
