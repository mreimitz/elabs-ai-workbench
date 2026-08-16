import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@brand/ui";
import type {
  ProviderCredential,
  RunDetail,
  Scenario,
  SessionCapabilities,
  Test,
} from "@mcp-token-footprint/shared";
import { RunConsoleRoute } from "./RunConsoleRoute";

// ── toolbar-reach WP0.2 (A-2 + A-3) ──────────────────────────────────────────────────────────────
// The route's own logic is the unit under test: the param-less `/testing/runs/new` → launcher redirect
// (A-2), the genuine "params present but unresolvable" ErrorState, and the "Re-run with changes" fork
// launcher being threaded into `RunConsole` (→ RunBar) instead of a standalone chrome row (A-3). The
// three module-load-heavy / network-bound children are stubbed so importing the route stays jsdom-safe
// and side-effect-free:
//  - `./RunConsole` → a probe that just reports whether it received `reRunAction` (the A-3 wire);
//  - `./ForkDialog` / `./LineageBanner` → light probes (LineageBanner's presence proves the A-3
//    conditional-row gating — it is mounted ONLY inside the `hasLineage` wrapper).
// `../../lib/api` is mocked for the four functions the route calls (`getRun` + the three list loaders).
vi.mock("./RunConsole", () => ({
  RunConsole: (props: { reRunAction?: unknown }) => (
    <div data-testid="run-console" data-rerun={props.reRunAction ? "yes" : "no"} />
  ),
}));
vi.mock("./ForkDialog", () => ({ ForkDialog: () => null }));
vi.mock("./LineageBanner", () => ({ LineageBanner: () => <div data-testid="lineage-banner" /> }));

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    getRun: vi.fn(),
    listProviders: vi.fn(),
    listScenarios: vi.fn(),
    listTests: vi.fn(),
  };
});

import { getRun, listProviders, listScenarios, listTests } from "../../lib/api";

const mockGetRun = vi.mocked(getRun);
const mockListProviders = vi.mocked(listProviders);
const mockListScenarios = vi.mocked(listScenarios);
const mockListTests = vi.mocked(listTests);

const TEST: Test = {
  id: "test-1",
  name: "Flights on-time",
  userPrompt: "How on-time are flights?",
  addedProfiles: [],
  attachments: [],
  tags: [],
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-01T00:00:00Z",
};

const SCENARIO: Scenario = {
  id: "env-1",
  name: "BARC on-time",
  providerId: "prov-1",
  model: "gpt-x",
  params: {},
  systemPrompt: "You are a helpful analyst.",
  allowedServers: [],
  allowedSkills: [],
  defaultProfiles: [],
  guardrails: {},
  toolLoadingMode: "eager",
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-01T00:00:00Z",
};

const PROVIDER: ProviderCredential = {
  id: "prov-1",
  kind: "openai",
  label: "OpenAI",
  hasKey: true,
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-01T00:00:00Z",
};

const CAPS: SessionCapabilities = {
  liveText: true,
  liveReasoning: "raw",
  toolCalls: true,
  contextWindow: true,
  tokens: "exact",
  costBasis: "api_exact",
  followUps: true,
  askUser: true,
};

/** A minimal `RunDetail` carrying only the fields `RunConsoleRoute` reads. */
function makeRunDetail(over: Partial<RunDetail> = {}): RunDetail {
  return {
    testId: "test-1",
    scenarioId: "env-1",
    mode: "automated",
    status: "completed",
    capabilities: CAPS,
    steps: [],
    ...over,
  } as unknown as RunDetail;
}

/** Reflects the current route (path + search) so the A-2 redirect is directly observable. */
function LocationProbe() {
  const location = useLocation();
  return (
    <div data-testid="location">
      {location.pathname}
      {location.search}
    </div>
  );
}

function renderRoute(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <TooltipProvider>
        <Routes>
          <Route path="/testing/runs/new" element={<RunConsoleRoute />} />
          <Route path="/testing/runs/:runId" element={<RunConsoleRoute />} />
          {/* The A-2 redirect target — a probe so we can assert the exact path + query. */}
          <Route path="/testing/runs" element={<LocationProbe />} />
        </Routes>
      </TooltipProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockGetRun.mockReset();
  mockListProviders.mockReset().mockResolvedValue([PROVIDER]);
  mockListScenarios.mockReset().mockResolvedValue([SCENARIO]);
  mockListTests.mockReset().mockResolvedValue([TEST]);
});

describe("RunConsoleRoute — A-2 param-less new-run entry", () => {
  test("a param-less /testing/runs/new redirects to the runs feed with the launcher open", async () => {
    renderRoute("/testing/runs/new");
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/testing/runs?launch=1"),
    );
    // It is a redirect, not a dead-end — the "Couldn’t open the run." ErrorState never renders.
    expect(screen.queryByText("Couldn’t open the run.")).not.toBeInTheDocument();
  });

  test("params present but unresolvable still render the ErrorState (the genuine case)", async () => {
    renderRoute("/testing/runs/new?testId=nope&scenarioId=nope");
    expect(await screen.findByText("Couldn’t open the run.")).toBeInTheDocument();
    expect(
      screen.getByText("The test or environment for this run no longer exists."),
    ).toBeInTheDocument();
    // NOT redirected — it stayed on the new-run route (no launcher-feed probe rendered).
    expect(screen.queryByTestId("location")).not.toBeInTheDocument();
  });
});

describe("RunConsoleRoute — A-3 relocated re-run action", () => {
  test("a terminal run threads reRunAction into the console and renders NO standalone re-run row", async () => {
    mockGetRun.mockResolvedValue(makeRunDetail({ status: "completed" }));
    renderRoute("/testing/runs/run-1");

    const consoleEl = await screen.findByTestId("run-console");
    expect(consoleEl).toHaveAttribute("data-rerun", "yes");
    // The button now lives inside RunBar (rendered by the real console); the route no longer renders a
    // lone "Re-run with changes" button on its own chrome row.
    expect(
      screen.queryByRole("button", { name: /Re-run with changes/ }),
    ).not.toBeInTheDocument();
  });

  test("a live (non-terminal) run does not receive reRunAction", async () => {
    mockGetRun.mockResolvedValue(makeRunDetail({ status: "running" }));
    renderRoute("/testing/runs/run-1");

    const consoleEl = await screen.findByTestId("run-console");
    expect(consoleEl).toHaveAttribute("data-rerun", "no");
  });

  test("LineageBanner is its own conditional row — absent for an un-forked terminal run", async () => {
    mockGetRun.mockResolvedValue(makeRunDetail({ status: "completed" }));
    renderRoute("/testing/runs/run-1");

    await screen.findByTestId("run-console");
    expect(screen.queryByTestId("lineage-banner")).not.toBeInTheDocument();
  });

  test("LineageBanner renders as its own row when the run has lineage (forked from a parent)", async () => {
    mockGetRun.mockResolvedValue(
      makeRunDetail({ status: "completed", derivedFromRunId: "parent-1" }),
    );
    renderRoute("/testing/runs/run-1");

    expect(await screen.findByTestId("lineage-banner")).toBeInTheDocument();
  });
});
