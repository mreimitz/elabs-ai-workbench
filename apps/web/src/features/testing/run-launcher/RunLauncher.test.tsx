import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, test, vi } from "vitest";
import type {
  Collection,
  ProviderCredential,
  RunPlanEstimate,
  Scenario,
  Suite,
  Test,
} from "@mcp-token-footprint/shared";
import { TooltipProvider } from "@brand/ui";

// Unified Sessions (roadmap/unified-sessions/, WP3.4) — the launcher's Configure step fetches its
// harness on open (suites/tests/environments/providers/collections) and debounces a cost-preview
// estimate; stub every network call so the test never makes a real request (mirrors
// EnvironmentEditor.test.tsx's `listProviderModels` stub).
vi.mock("../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api")>();
  return {
    ...actual,
    listSuites: vi.fn(),
    listTests: vi.fn(),
    listScenarios: vi.fn(),
    listProviders: vi.fn(),
    listCollections: vi.fn(),
    estimateRunPlan: vi.fn(),
    createRunPlan: vi.fn(),
    createSuite: vi.fn(),
  };
});

import * as api from "../../../lib/api";
import { RunLauncher } from "./RunLauncher";

// jsdom omits matchMedia — Radix (Dialog/RadioGroup/Wizard) reads it (mirrors EnvironmentEditor.test.tsx).
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

const ANTHROPIC_PROVIDER: ProviderCredential = {
  id: "prov-anthropic",
  kind: "anthropic",
  label: "Claude",
  hasKey: true,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const QLIK_PROVIDER: ProviderCredential = {
  id: "prov-qlik",
  kind: "qlik_answers",
  label: "Tenant Assistant",
  hasKey: true,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

function scenario(overrides: Partial<Scenario> & { id: string; name: string }): Scenario {
  return {
    providerId: ANTHROPIC_PROVIDER.id,
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
    ...overrides,
  };
}

const API_ENV = scenario({ id: "scn-api", name: "API env" });
const QLIK_ENV = scenario({
  id: "scn-qlik",
  name: "Qlik env",
  providerId: QLIK_PROVIDER.id,
  model: "asst-123",
  answersMode: { transport: "invoke" },
});
const CAPPED_ENV = scenario({
  id: "scn-capped",
  name: "Capped env",
  guardrails: { maxRunDurationMs: 45 * 60_000 },
});

const TEST_1: Test = {
  id: "test-1",
  name: "Test one",
  userPrompt: "Do the thing",
  addedProfiles: [],
  attachments: [],
  tags: [],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const ESTIMATE: RunPlanEstimate = {
  testCount: 1,
  environmentCount: 1,
  repetitions: 1,
  totalRuns: 1,
  tokens: { low: 100, mid: 150, high: 200 },
  costUsd: { low: 0.01, mid: 0.015, high: 0.02 },
  unpricedEnvironmentCount: 0,
  uncappedEnvironmentCount: 0,
  environments: [],
};

function mockHarness(scenarios: Scenario[], providers: ProviderCredential[] = [ANTHROPIC_PROVIDER, QLIK_PROVIDER]) {
  vi.mocked(api.listSuites).mockResolvedValue([] as Suite[]);
  vi.mocked(api.listTests).mockResolvedValue([TEST_1]);
  vi.mocked(api.listScenarios).mockResolvedValue(scenarios);
  vi.mocked(api.listProviders).mockResolvedValue(providers);
  vi.mocked(api.listCollections).mockResolvedValue([] as Collection[]);
  vi.mocked(api.estimateRunPlan).mockResolvedValue(ESTIMATE);
}

/** Renders the launcher, waits for the harness fetch to settle, then advances Type → Select →
 *  ticks the given test + environment → Configure, where the effective-limits summary lives. */
async function openToConfigureStep(scenarios: Scenario[], envName: string) {
  mockHarness(scenarios);
  render(
    <MemoryRouter>
      <TooltipProvider>
        <RunLauncher open onOpenChange={() => {}} intent={{ kind: "choose" }} />
      </TooltipProvider>
    </MemoryRouter>,
  );
  await act(async () => {
    await Promise.resolve();
  });

  // Step 1 (Run type) defaults to "Single / interactive run" — advance to Select.
  fireEvent.click(screen.getByRole("button", { name: /^next$/i }));

  // Step 2 (Select) — tick the one test and the named environment.
  fireEvent.click(screen.getByRole("checkbox", { name: `Include ${TEST_1.name}` }));
  fireEvent.click(screen.getByRole("checkbox", { name: `Include ${envName}` }));
  fireEvent.click(screen.getByRole("button", { name: /^next$/i }));
}

/** A `KpiStat`'s value lives in the `<dd>` sibling of the `<dt>` carrying its label — scoped lookup
 *  so e.g. two stats that happen to both read "10m 0s" (stall timeout vs. a non-Qlik wait budget)
 *  never collide under a bare `getByText`. */
function kpiValue(label: string): string {
  const dt = screen.getByText(label);
  const dl = dt.closest("dl");
  if (!dl) throw new Error(`No <dl> ancestor for KpiStat label "${label}"`);
  return dl.querySelector("dd")?.textContent?.trim() ?? "";
}

describe("RunLauncher — effective-limits summary (WP3.4, D-US3/D-US7)", () => {
  test("a Qlik Answers environment shows the longer 30-minute wait budget", async () => {
    await openToConfigureStep([QLIK_ENV], "Qlik env");
    expect(screen.getByText("Effective limits")).toBeInTheDocument();
    expect(kpiValue("Stall timeout")).toBe("10m 0s");
    expect(kpiValue("Wait budget")).toBe("30m 0s");
    expect(kpiValue("Wall cap")).toBe("No cap");
  });

  test("a plain api environment shows the 10-minute default wait budget", async () => {
    await openToConfigureStep([API_ENV], "API env");
    expect(kpiValue("Stall timeout")).toBe("10m 0s");
    expect(kpiValue("Wait budget")).toBe("10m 0s");
    expect(kpiValue("Wall cap")).toBe("No cap");
  });

  test("an environment with a wall-cap guardrail shows that duration instead of 'No cap'", async () => {
    await openToConfigureStep([CAPPED_ENV], "Capped env");
    expect(kpiValue("Wall cap")).toBe("45m 0s");
  });
});
