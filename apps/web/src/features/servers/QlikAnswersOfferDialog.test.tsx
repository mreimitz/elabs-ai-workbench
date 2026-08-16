import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { AvailableModelsResponse, ProviderCredential, QlikTenantProbe, Scenario } from "@mcp-token-footprint/shared";

// jsdom omits matchMedia/ResizeObserver — Radix (Dialog/Checkbox) reads them.
if (typeof window.matchMedia !== "function") {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false
  })) as unknown as typeof window.matchMedia;
}
if (typeof window.ResizeObserver !== "function") {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof window.ResizeObserver;
}

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    createProvider: vi.fn(),
    listProviderModels: vi.fn(),
    createScenario: vi.fn()
  };
});

import { createProvider, createScenario, listProviderModels } from "../../lib/api";
import { QlikAnswersOfferDialog } from "./QlikAnswersOfferDialog";

const PROBE_LINKED: QlikTenantProbe = { origin: "https://acme.us.qlikcloud.com", answersAvailable: true, assistantCount: 2 };
const PROBE_NEEDS_KEY: QlikTenantProbe = {
  origin: "https://acme.us.qlikcloud.com",
  answersAvailable: true,
  assistantCount: 2,
  needsOwnKey: true
};

const PROVIDER: ProviderCredential = {
  id: "provider-1",
  kind: "qlik_answers",
  label: "Qlik Answers — My server",
  baseUrl: "https://acme.us.qlikcloud.com",
  hasKey: false,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z"
};

const ROSTER: AvailableModelsResponse = {
  source: "provider",
  models: [
    { id: "asst-1", displayName: "Support assistant" },
    { id: "asst-2", displayName: "Sales assistant" }
  ]
};

function scenarioFixture(overrides: Partial<Scenario> = {}): Scenario {
  return {
    id: "scenario-1",
    name: "Qlik Answers — Support assistant",
    providerId: "provider-1",
    model: "asst-1",
    params: {},
    systemPrompt: "",
    allowedServers: [],
    allowedSkills: [],
    defaultProfiles: ["generic_o200k"],
    guardrails: {},
    toolLoadingMode: "eager",
    answersMode: { transport: "stream" },
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides
  };
}

beforeEach(() => {
  vi.mocked(createProvider).mockReset();
  vi.mocked(listProviderModels).mockReset();
  vi.mocked(createScenario).mockReset();
});

describe("QlikAnswersOfferDialog", () => {
  test("linked-auth path: accept creates the provider with mcpServerId, loads the roster, then creates one environment per selected assistant", async () => {
    vi.mocked(createProvider).mockResolvedValue(PROVIDER);
    vi.mocked(listProviderModels).mockResolvedValue(ROSTER);
    vi.mocked(createScenario).mockImplementation((input) => Promise.resolve(scenarioFixture(input)));

    render(
      <QlikAnswersOfferDialog
        open
        onOpenChange={() => {}}
        serverId="server-1"
        serverName="My server"
        probe={PROBE_LINKED}
      />
    );

    // The consent copy names the assistant count; nothing is created until the user clicks through.
    expect(screen.getByText(/tenant with 2 Qlik Answers assistants/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /set up assistants/i }));

    await waitFor(() => expect(createProvider).toHaveBeenCalledTimes(1));
    expect(createProvider).toHaveBeenCalledWith({
      kind: "qlik_answers",
      label: "Qlik Answers — My server",
      baseUrl: "https://acme.us.qlikcloud.com",
      mcpServerId: "server-1"
    });
    await waitFor(() => expect(listProviderModels).toHaveBeenCalledWith("provider-1"));

    // Both assistants are selected by default (D-QA — one click sets up everything on offer).
    await waitFor(() => expect(screen.getByText("Support assistant")).toBeInTheDocument());
    expect(screen.getByText("Sales assistant")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /create 2 environments/i }));

    await waitFor(() => expect(createScenario).toHaveBeenCalledTimes(2));
    for (const call of vi.mocked(createScenario).mock.calls) {
      const input = call[0];
      expect(input.providerId).toBe("provider-1");
      expect(input.allowedServers).toEqual([]);
      expect(input.allowedSkills).toEqual([]);
      expect(input.answersMode).toEqual({ transport: "stream" });
      expect(input.name).toMatch(/^Qlik Answers — /);
    }
    expect(vi.mocked(createScenario).mock.calls.map((call) => call[0].model).sort()).toEqual(["asst-1", "asst-2"]);
  });

  test("needsOwnKey path: accept reveals an API-key field first; the provider is created with the entered key, not mcpServerId", async () => {
    vi.mocked(createProvider).mockResolvedValue(PROVIDER);
    vi.mocked(listProviderModels).mockResolvedValue(ROSTER);

    render(
      <QlikAnswersOfferDialog
        open
        onOpenChange={() => {}}
        serverId="server-1"
        serverName="My server"
        probe={PROBE_NEEDS_KEY}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /set up assistants/i }));
    // No provider is created yet — the API-key step comes first.
    expect(createProvider).not.toHaveBeenCalled();
    const keyInput = await screen.findByLabelText(/qlik answers api key/i);
    fireEvent.change(keyInput, { target: { value: "tenant-key-123" } });
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));

    await waitFor(() => expect(createProvider).toHaveBeenCalledTimes(1));
    expect(createProvider).toHaveBeenCalledWith({
      kind: "qlik_answers",
      label: "Qlik Answers — My server",
      baseUrl: "https://acme.us.qlikcloud.com",
      apiKey: "tenant-key-123"
    });
  });

  test("declining at the consent step creates nothing", () => {
    const onOpenChange = vi.fn();
    render(
      <QlikAnswersOfferDialog
        open
        onOpenChange={onOpenChange}
        serverId="server-1"
        serverName="My server"
        probe={PROBE_LINKED}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /not now/i }));
    expect(createProvider).not.toHaveBeenCalled();
    expect(listProviderModels).not.toHaveBeenCalled();
    expect(createScenario).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  test("skipping at the assistants step creates no environments", async () => {
    vi.mocked(createProvider).mockResolvedValue(PROVIDER);
    vi.mocked(listProviderModels).mockResolvedValue(ROSTER);

    render(
      <QlikAnswersOfferDialog
        open
        onOpenChange={() => {}}
        serverId="server-1"
        serverName="My server"
        probe={PROBE_LINKED}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /set up assistants/i }));
    await screen.findByText("Support assistant");
    fireEvent.click(screen.getByRole("button", { name: /skip/i }));
    expect(createScenario).not.toHaveBeenCalled();
  });
});
