import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type {
  ProviderCredential,
  Scenario,
  ScenarioInput,
  ServerConfig,
  ServerType,
} from "@mcp-token-footprint/shared";
import { TooltipProvider } from "@brand/ui";

// WP 2.3 — the editor fetches the live model roster via `listProviderModels`; stub it so the test
// never makes a real request (mirrors GradePanel.test.tsx's api mock).
vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    listProviderModels: vi.fn().mockResolvedValue({ models: [], source: "provider" }),
  };
});

import { EnvironmentEditor } from "./EnvironmentEditor";

// jsdom omits matchMedia/ResizeObserver — Radix (Dialog/ToggleGroup) reads them (mirrors ServerWizard.test.tsx).
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
if (typeof window.ResizeObserver !== "function") {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof window.ResizeObserver;
}

const QLIK_PROVIDER: ProviderCredential = {
  id: "prov-qlik",
  kind: "qlik_answers",
  label: "Tenant Assistant",
  hasKey: true,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const ANTHROPIC_PROVIDER: ProviderCredential = {
  id: "prov-anthropic",
  kind: "anthropic",
  label: "Claude",
  hasKey: true,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

function qlikScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    id: "scn-qlik",
    name: "Qlik env",
    providerId: "prov-qlik",
    model: "asst-123",
    params: {},
    systemPrompt: "",
    allowedServers: [],
    allowedSkills: [],
    defaultProfiles: ["generic_o200k"],
    guardrails: {},
    toolLoadingMode: "eager",
    answersMode: { transport: "invoke" },
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function anthropicScenario(): Scenario {
  return {
    id: "scn-anthropic",
    name: "Agent env",
    providerId: "prov-anthropic",
    model: "claude-sonnet-4-5",
    params: {},
    systemPrompt: "",
    allowedServers: [],
    allowedSkills: [],
    defaultProfiles: ["generic_o200k"],
    guardrails: {},
    toolLoadingMode: "eager",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

function renderEditor(scenario: Scenario) {
  const onSubmit = vi.fn<(input: ScenarioInput) => Promise<void>>().mockResolvedValue(undefined);
  render(
    <TooltipProvider>
      <EnvironmentEditor
        open
        scenario={scenario}
        providers={[QLIK_PROVIDER, ANTHROPIC_PROVIDER]}
        servers={[]}
        latestScans={new Map()}
        skills={[]}
        skillVersions={new Map()}
        onOpenChange={() => {}}
        onSubmit={onSubmit}
      />
    </TooltipProvider>,
  );
  return { onSubmit };
}

/** Renders, then flushes the mounting `listProviderModels()` effect's microtask so no assertion
 * races a post-render `setState` (avoids the React "not wrapped in act(...)" warning). */
async function renderEditorSettled(scenario: Scenario) {
  const result = renderEditor(scenario);
  await act(async () => {
    await Promise.resolve();
  });
  return result;
}

// WP 2.3 — environment-editor conditionals for the `qlik_answers` kind: hide Servers & skills and the
// guardrails meaningless to a tenant-assistant call, keep the run-duration cap, add the transport
// toggle. `environment-form.test.ts` covers the pure FormState<->ScenarioInput mapping; this covers
// what the editor actually renders/gates for the two kinds.
describe("EnvironmentEditor — Qlik Answers conditionals (WP 2.3)", () => {
  test("hides the Servers & skills section for a qlik_answers environment", async () => {
    await renderEditorSettled(qlikScenario());
    const nav = screen.getByRole("navigation", { name: "Sections" });
    expect(
      within(nav).queryByRole("button", { name: /servers & skills/i }),
    ).not.toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: /model/i })).toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: /guardrails/i })).toBeInTheDocument();
  });

  test("keeps the Servers & skills section for a non-qlik environment", async () => {
    await renderEditorSettled(anthropicScenario());
    const nav = screen.getByRole("navigation", { name: "Sections" });
    expect(within(nav).getByRole("button", { name: /servers & skills/i })).toBeInTheDocument();
  });

  test("shows the transport toggle, prefilled from the loaded scenario's answersMode, for qlik_answers only", async () => {
    await renderEditorSettled(qlikScenario());
    expect(screen.getByText("Qlik Answers transport")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Invoke" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Stream" })).toHaveAttribute("aria-checked", "false");
  });

  test("does not show the transport toggle for a non-qlik environment", async () => {
    await renderEditorSettled(anthropicScenario());
    expect(screen.queryByText("Qlik Answers transport")).not.toBeInTheDocument();
  });

  test("qlik_answers: hides maxTurns/maxToolCalls/maxContextTokens but keeps maxTokens/maxCost/maxRunDuration", async () => {
    await renderEditorSettled(qlikScenario());
    fireEvent.click(
      within(screen.getByRole("navigation", { name: "Sections" })).getByRole("button", {
        name: /guardrails/i,
      }),
    );
    expect(screen.queryByLabelText("Max turns")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Max tool calls")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Max context tokens")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Max tokens")).toBeInTheDocument();
    expect(screen.getByLabelText("Max cost in US dollars")).toBeInTheDocument();
    expect(screen.getByLabelText("Max run duration in milliseconds")).toBeInTheDocument();
  });

  test("non-qlik: every guardrail (incl. the new max run duration) stays visible", async () => {
    await renderEditorSettled(anthropicScenario());
    fireEvent.click(
      within(screen.getByRole("navigation", { name: "Sections" })).getByRole("button", {
        name: /guardrails/i,
      }),
    );
    expect(screen.getByLabelText("Max turns")).toBeInTheDocument();
    expect(screen.getByLabelText("Max tool calls")).toBeInTheDocument();
    expect(screen.getByLabelText("Max context tokens")).toBeInTheDocument();
    expect(screen.getByLabelText("Max run duration in milliseconds")).toBeInTheDocument();
  });

  test("flipping the transport toggle and saving submits the new answersMode", async () => {
    const { onSubmit } = await renderEditorSettled(qlikScenario());
    fireEvent.click(screen.getByRole("radio", { name: "Stream" }));
    fireEvent.click(screen.getByRole("button", { name: /save environment/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const input = onSubmit.mock.calls[0]?.[0];
    expect(input?.answersMode).toEqual({ transport: "stream" });
  });
});

// Unified Sessions (roadmap/unified-sessions/, WP3.4, D-US3/D-US7) — the Guardrails section's wall-cap
// field (`maxRunDurationMs`, the only stall/wait-adjacent field with a real backend surface — see
// GuardrailConfig in packages/shared) round-trips through the editor unchanged, and the two read-only
// stall/wait figures (no backend field exists for either) render the correct per-kind default.
describe("EnvironmentEditor — effective-limits guardrail fields (WP3.4)", () => {
  function openGuardrails() {
    fireEvent.click(
      within(screen.getByRole("navigation", { name: "Sections" })).getByRole("button", {
        name: /guardrails/i,
      }),
    );
  }

  /** A `KpiStat`'s value lives in the `<dd>` sibling of the `<dt>` carrying its label. */
  function kpiValue(label: string): string {
    const dt = screen.getByText(label);
    const dl = dt.closest("dl");
    if (!dl) throw new Error(`No <dl> ancestor for KpiStat label "${label}"`);
    return dl.querySelector("dd")?.textContent?.trim() ?? "";
  }

  test("a configured wall cap round-trips through the editor unchanged on save", async () => {
    const capped = anthropicScenario();
    capped.guardrails = { maxRunDurationMs: 2_700_000 };
    const { onSubmit } = await renderEditorSettled(capped);
    openGuardrails();

    fireEvent.click(screen.getByRole("button", { name: /save environment/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const input = onSubmit.mock.calls[0]?.[0];
    expect(input?.guardrails.maxRunDurationMs).toBe(2_700_000);
  });

  test("no wall cap stays unset on save — no hidden default is substituted", async () => {
    const { onSubmit } = await renderEditorSettled(anthropicScenario());
    openGuardrails();

    fireEvent.click(screen.getByRole("button", { name: /save environment/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const input = onSubmit.mock.calls[0]?.[0];
    expect(input?.guardrails.maxRunDurationMs).toBeUndefined();
  });

  test("a non-qlik environment shows the fixed 10-min stall timeout and 10-min wait budget, read-only", async () => {
    await renderEditorSettled(anthropicScenario());
    openGuardrails();

    expect(kpiValue("Stall timeout")).toBe("10 min");
    expect(kpiValue("Wait budget")).toBe("10 min");
  });

  test("a qlik_answers environment shows the longer 30-min wait budget, read-only", async () => {
    await renderEditorSettled(qlikScenario());
    openGuardrails();

    expect(kpiValue("Stall timeout")).toBe("10 min");
    expect(kpiValue("Wait budget")).toBe("30 min");
  });
});

// WP 4.1 — read-only server-type/status surfacing in the allowed-servers list, with deprecated
// de-emphasis and a dangling-typeId → "Untyped" fallback (must never crash).
describe("EnvironmentEditor — allowed-server type/status surfacing (WP 4.1)", () => {
  function server(overrides: Partial<ServerConfig> & { id: string; name: string }): ServerConfig {
    return {
      transport: "streamable_http",
      url: "https://example.com/mcp",
      hasEnvSecrets: false,
      hasHeaderSecrets: false,
      authType: "none",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      ...overrides,
    };
  }

  function type(
    overrides: Partial<ServerType> & { id: string; name: string; status: ServerType["status"] },
  ): ServerType {
    return {
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      memberCount: 1,
      ...overrides,
    };
  }

  const SERVERS: ServerConfig[] = [
    server({ id: "srv-prod", name: "Prod Qlik", typeId: "type-prod" }),
    server({ id: "srv-dep", name: "Legacy Qlik", typeId: "type-dep" }),
    server({ id: "srv-dangling", name: "Orphan Qlik", typeId: "type-gone" }),
    server({ id: "srv-untyped", name: "Plain Qlik" }),
  ];

  const TYPES: ServerType[] = [
    type({ id: "type-prod", name: "Qlik-SaaS", status: "production" }),
    type({ id: "type-dep", name: "Legacy", status: "deprecated" }),
  ];

  function scenarioWithServers(): Scenario {
    return {
      id: "scn-agent",
      name: "Agent env",
      providerId: "prov-anthropic",
      model: "claude-sonnet-4-5",
      params: {},
      systemPrompt: "",
      allowedServers: [
        { serverId: "srv-prod", allowedTools: null },
        { serverId: "srv-dep", allowedTools: null },
        { serverId: "srv-dangling", allowedTools: null },
        { serverId: "srv-untyped", allowedTools: null },
      ],
      allowedSkills: [],
      defaultProfiles: ["generic_o200k"],
      guardrails: {},
      toolLoadingMode: "eager",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
  }

  async function renderWithServers() {
    render(
      <TooltipProvider>
        <EnvironmentEditor
          open
          scenario={scenarioWithServers()}
          providers={[ANTHROPIC_PROVIDER]}
          servers={SERVERS}
          serverTypes={TYPES}
          latestScans={new Map()}
          skills={[]}
          skillVersions={new Map()}
          onOpenChange={() => {}}
          onSubmit={vi.fn<(input: ScenarioInput) => Promise<void>>().mockResolvedValue(undefined)}
        />
      </TooltipProvider>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    // The allowed-servers list lives in the "Servers & skills" section (rail nav renders only the
    // active section), so activate it first.
    fireEvent.click(
      within(screen.getByRole("navigation", { name: "Sections" })).getByRole("button", {
        name: /servers & skills/i,
      }),
    );
  }

  test("shows each server's type name + lifecycle status", async () => {
    await renderWithServers();
    expect(screen.getByText("Qlik-SaaS")).toBeInTheDocument();
    expect(screen.getByText("Production")).toBeInTheDocument();
    expect(screen.getByText("Legacy")).toBeInTheDocument();
    expect(screen.getByText("Deprecated")).toBeInTheDocument();
  });

  // Server names also appear in the right-hand footprint aside (RankedTokenList), so scope name
  // lookups to each server's row via its "Remove <name>" button.
  function serverRow(name: string): HTMLElement {
    const row = screen.getByRole("button", { name: `Remove ${name}` }).closest("li");
    if (!row) throw new Error(`row for ${name} not found`);
    return row as HTMLElement;
  }

  test("de-emphasizes a deprecated server's name and not a production one", async () => {
    await renderWithServers();
    expect(within(serverRow("Legacy Qlik")).getByText("Legacy Qlik").className).toContain(
      "text-muted-foreground",
    );
    expect(within(serverRow("Prod Qlik")).getByText("Prod Qlik").className).not.toContain(
      "text-muted-foreground",
    );
  });

  test("renders 'Untyped' for a server with no type or a dangling typeId (no crash)", async () => {
    await renderWithServers();
    // Both the untyped server and the dangling-typeId server fall back to "Untyped".
    expect(screen.getAllByText("Untyped")).toHaveLength(2);
    expect(within(serverRow("Orphan Qlik")).getByText("Untyped")).toBeInTheDocument();
    expect(within(serverRow("Plain Qlik")).getByText("Untyped")).toBeInTheDocument();
  });
});
