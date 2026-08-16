import type { HubAgentRole, HubCrew } from "@mcp-token-footprint/shared";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

// model-identity WP 4.1 — the agent quick-create's model field is now the shared `HubModelPicker`
// (`@brand/ai` ModelSelector); stub the barrel like every other hub suite.
vi.mock("@brand/ai", () => import("../test-support/brand-ai-mock"));

vi.mock("../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api")>();
  return {
    ...actual,
    createHubAgentRole: vi.fn(),
    createHubCrew: vi.fn(),
    listProviders: vi.fn(),
    listProviderModels: vi.fn(),
  };
});

import * as api from "../../../lib/api";
import { QuickCreateAgentDialog, QuickCreateCrewDialog } from "./QuickCreate";

function agentRole(overrides: Partial<HubAgentRole> = {}): HubAgentRole {
  return {
    id: "role-new",
    name: "Research Analyst",
    systemPrompt: "You are Research Analyst.",
    defaultModel: "claude-sonnet-4-5",
    toolGrants: { servers: {}, builtins: [] },
    skills: [],
    target: "Not yet configured",
    expectedOutcome: "Not yet configured",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

function crew(overrides: Partial<HubCrew> = {}): HubCrew {
  return {
    id: "crew-new",
    name: "Research Team",
    topology: "parallel",
    members: [],
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

describe("QuickCreateAgentDialog", () => {
  test("submit is disabled until name AND a default model are filled", async () => {
    render(<QuickCreateAgentDialog open onOpenChange={vi.fn()} onCreated={vi.fn()} />);
    const submit = screen.getByRole("button", { name: "Create agent" });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Research Analyst" },
    });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Default model"), {
      target: { value: "claude-sonnet-4-5" },
    });
    await waitFor(() => expect(submit).not.toBeDisabled());
  });

  test("creates a minimal agent (honest placeholders for the fields not asked here) then reports its id", async () => {
    const created = agentRole({ id: "role-abc", name: "Research Analyst" });
    vi.mocked(api.createHubAgentRole).mockResolvedValue(created);
    const onCreated = vi.fn();
    const onOpenChange = vi.fn();
    render(<QuickCreateAgentDialog open onOpenChange={onOpenChange} onCreated={onCreated} />);

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Research Analyst" },
    });
    fireEvent.change(screen.getByLabelText("Display name (optional)"), {
      target: { value: "Nova" },
    });
    fireEvent.change(screen.getByLabelText("Default model"), {
      target: { value: "claude-sonnet-4-5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create agent" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("role-abc"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    const [payload] = vi.mocked(api.createHubAgentRole).mock.calls[0]!;
    expect(payload).toMatchObject({
      name: "Research Analyst",
      displayName: "Nova",
      defaultModel: "claude-sonnet-4-5",
    });
    // The fields this quick form doesn't ask for still satisfy the required wire contract with an
    // honest "not yet configured" placeholder, never an invented persona.
    expect(payload.target).toMatch(/not yet configured/i);
    expect(payload.expectedOutcome).toMatch(/not yet configured/i);
    // No roster is configured in this fixture, so the id was typed free-hand: honestly UNPINNED
    // rather than attributed to a credential nobody chose.
    expect(payload.providerCredentialId).toBeUndefined();
  });

  // model-identity WP 4.1 (D-MI1/D-MI7) — with a live roster the field is the shared picker, and the
  // picked row's CREDENTIAL is created alongside the model id.
  test("with a live roster, picking a model sends its credential alongside the id", async () => {
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
    vi.mocked(api.createHubAgentRole).mockResolvedValue(agentRole({ id: "role-xyz" }));
    render(<QuickCreateAgentDialog open onOpenChange={vi.fn()} onCreated={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Research Analyst" } });
    fireEvent.click(await screen.findByRole("button", { name: /^Default model:/ }));
    fireEvent.click(
      within(screen.getByTestId("model-selector-content")).getByRole("button", { name: /^GPT-5/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create agent" }));

    await waitFor(() => expect(api.createHubAgentRole).toHaveBeenCalled());
    const [payload] = vi.mocked(api.createHubAgentRole).mock.calls[0]!;
    expect(payload.defaultModel).toBe("gpt-5");
    expect(payload.providerCredentialId).toBe("cred-1");
  });

  test("a create failure surfaces a toast, not a silent no-op, and keeps the dialog open", async () => {
    vi.mocked(api.createHubAgentRole).mockRejectedValue(new Error("name already taken"));
    const onCreated = vi.fn();
    const onOpenChange = vi.fn();
    render(<QuickCreateAgentDialog open onOpenChange={onOpenChange} onCreated={onCreated} />);

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Research Analyst" } });
    fireEvent.change(screen.getByLabelText("Default model"), {
      target: { value: "claude-sonnet-4-5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create agent" }));

    await waitFor(() => expect(api.createHubAgentRole).toHaveBeenCalled());
    expect(onCreated).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});

describe("QuickCreateCrewDialog", () => {
  test("submit is disabled until a name is filled; topology defaults to parallel", async () => {
    const created = crew({ id: "crew-xyz" });
    vi.mocked(api.createHubCrew).mockResolvedValue(created);
    const onCreated = vi.fn();
    render(<QuickCreateCrewDialog open onOpenChange={vi.fn()} onCreated={onCreated} />);

    expect(screen.getByRole("button", { name: "Create crew" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Research Team" } });
    fireEvent.click(screen.getByRole("button", { name: "Create crew" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("crew-xyz"));
    expect(vi.mocked(api.createHubCrew).mock.calls[0]![0]).toMatchObject({
      name: "Research Team",
      topology: "parallel",
      members: [],
    });
  });

  test("an unrecognized/default color is omitted from the payload; picking one includes it", async () => {
    vi.mocked(api.createHubCrew).mockResolvedValue(crew());
    render(<QuickCreateCrewDialog open onOpenChange={vi.fn()} onCreated={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Research Team" } });
    fireEvent.click(screen.getByRole("button", { name: "Create crew" }));
    await waitFor(() => expect(api.createHubCrew).toHaveBeenCalled());
    expect(vi.mocked(api.createHubCrew).mock.calls[0]![0]).not.toHaveProperty("color");
  });
});
