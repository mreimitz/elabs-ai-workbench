import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { RunPlanEstimate, Suite, SuiteRun } from "@mcp-token-footprint/shared";
import { TooltipProvider } from "@elabs-ai/components-ui";

/**
 * Error Prevention (design-remediation T11, P1) — same fix as `SuitesView.test.tsx`'s list row,
 * applied to the suite detail page's toolbar Run action: it must open a confirm (cells/cap/estimate)
 * before `runSuite` is ever called.
 */
vi.mock("../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api")>();
  return {
    ...actual,
    getSuite: vi.fn(),
    listTests: vi.fn().mockResolvedValue([]),
    listScenarios: vi.fn().mockResolvedValue([]),
    listCollections: vi.fn().mockResolvedValue([]),
    listSuiteRuns: vi.fn().mockResolvedValue([]),
    listSkills: vi.fn().mockResolvedValue([]),
    runSuite: vi.fn(),
    deleteSuite: vi.fn(),
    estimateRunPlan: vi.fn(),
  };
});
// `SuiteDetail` imports `suiteStatusBadge` from `./SuiteRunConsole`, which pulls heavy `@elabs-ai/components-charts`
// (visx) children at module load — neutralized the same way `SuiteRunConsole.test.tsx` already does.
vi.mock("./SuiteScatter", () => ({ SuiteScatter: () => <div /> }));
vi.mock("./SuiteBreakdowns", () => ({ SuiteBreakdowns: () => <div /> }));

import * as api from "../../../lib/api";
import { SuiteDetail } from "./SuiteDetail";

const NO_CAP_SUITE: Suite = {
  id: "suite-1",
  name: "Regression suite",
  config: { repetitions: 2, maxConcurrency: 3 },
  testIds: ["test-1", "test-2"],
  scenarioIds: ["scn-1"],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const ESTIMATE: RunPlanEstimate = {
  testCount: 2,
  environmentCount: 1,
  repetitions: 2,
  totalRuns: 4,
  tokens: { low: 1000, mid: 1500, high: 2000 },
  costUsd: { low: 0.1, mid: 0.15, high: 0.2 },
  unpricedEnvironmentCount: 0,
  uncappedEnvironmentCount: 1,
  environments: [],
};

function renderDetail() {
  return render(
    <MemoryRouter initialEntries={["/testing/suites/suite-1"]}>
      <TooltipProvider>
        <Routes>
          <Route path="/testing/suites/:suiteId" element={<SuiteDetail />} />
        </Routes>
      </TooltipProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SuiteDetail — Run routes through a confirm (T11)", () => {
  test("clicking Run does NOT call runSuite immediately — it opens a confirm first", async () => {
    vi.mocked(api.getSuite).mockResolvedValue(NO_CAP_SUITE);
    vi.mocked(api.estimateRunPlan).mockResolvedValue(ESTIMATE);
    renderDetail();

    fireEvent.click(await screen.findByRole("button", { name: "Run" }));

    expect(await screen.findByRole("heading", { name: "Run Regression suite?" })).toBeInTheDocument();
    expect(api.runSuite).not.toHaveBeenCalled();
  });

  test("the confirm states the cell count and the honest 'no cap', with an estimated cost", async () => {
    vi.mocked(api.getSuite).mockResolvedValue(NO_CAP_SUITE);
    vi.mocked(api.estimateRunPlan).mockResolvedValue(ESTIMATE);
    renderDetail();

    fireEvent.click(await screen.findByRole("button", { name: "Run" }));
    await screen.findByRole("heading", { name: "Run Regression suite?" });

    expect(screen.getByText(/2 tests × 1 environment × 2 repetitions = 4 runs\./)).toBeInTheDocument();
    expect(screen.getByText(/No cap set — this run can spend without limit\./)).toBeInTheDocument();
    await waitFor(() => expect(api.estimateRunPlan).toHaveBeenCalledWith(["test-1", "test-2"], ["scn-1"], 2));
    await waitFor(() =>
      expect(
        screen.getByText(
          (_, element) =>
            element?.children.length === 0 && Boolean(element?.textContent?.includes("1,000–2,000 tokens")),
        ),
      ).toBeInTheDocument(),
    );
  });

  // --- RM-34 WP 1.3 (D-ET5) — the confirm says where the band's turn model came from -----------

  test("the confirm names the turn basis and sample size when the estimate carries one", async () => {
    vi.mocked(api.getSuite).mockResolvedValue(NO_CAP_SUITE);
    vi.mocked(api.estimateRunPlan).mockResolvedValue({
      ...ESTIMATE,
      environments: [
        {
          environmentId: "scn-1",
          name: "BARC-Benchmark-Sonnet",
          model: "claude-sonnet-4",
          priced: true,
          footprintTokens: 2000,
          hasCostCap: false,
          tokens: { low: 1000, mid: 1500, high: 2000 },
          costUsd: { low: 0.1, mid: 0.15, high: 0.2 },
          turnProfile: {
            basis: "environment",
            sampleSize: 79,
            turns: { low: 5, mid: 9, high: 20 },
            outputTokensPerTurn: 1036,
          },
        },
      ],
    });
    renderDetail();

    fireEvent.click(await screen.findByRole("button", { name: "Run" }));
    await screen.findByRole("heading", { name: "Run Regression suite?" });

    const note = await screen.findByText(/past runs on this environment\./);
    expect(note.textContent).toBe("Turn count from 79 past runs on this environment.");
  });

  test("a plan mixing a measured environment with an unmeasured one reports the ASSUMPTION", async () => {
    vi.mocked(api.getSuite).mockResolvedValue(NO_CAP_SUITE);
    vi.mocked(api.estimateRunPlan).mockResolvedValue({
      ...ESTIMATE,
      environmentCount: 2,
      environments: [
        {
          environmentId: "scn-1",
          name: "Measured",
          model: "claude-sonnet-4",
          priced: true,
          footprintTokens: 2000,
          hasCostCap: false,
          tokens: { low: 1000, mid: 1500, high: 2000 },
          costUsd: { low: 0.1, mid: 0.15, high: 0.2 },
          turnProfile: {
            basis: "pair",
            sampleSize: 51,
            turns: { low: 5, mid: 9, high: 19 },
            outputTokensPerTurn: 1036,
          },
        },
        {
          environmentId: "scn-2",
          name: "Brand new",
          model: "claude-sonnet-4",
          priced: true,
          footprintTokens: 2000,
          hasCostCap: false,
          tokens: { low: 1000, mid: 1500, high: 2000 },
          costUsd: { low: 0.1, mid: 0.15, high: 0.2 },
          turnProfile: {
            basis: "default",
            sampleSize: 0,
            turns: { low: 1, mid: 3, high: 8 },
            outputTokensPerTurn: 350,
          },
        },
      ],
    });
    renderDetail();

    fireEvent.click(await screen.findByRole("button", { name: "Run" }));
    await screen.findByRole("heading", { name: "Run Regression suite?" });

    expect(
      await screen.findByText("Turn count is an assumption — no past runs to measure."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/51 past runs/)).not.toBeInTheDocument();
  });

  test("with no turnProfile on the wire the confirm reads exactly as it does today", async () => {
    vi.mocked(api.getSuite).mockResolvedValue(NO_CAP_SUITE);
    vi.mocked(api.estimateRunPlan).mockResolvedValue(ESTIMATE);
    renderDetail();

    fireEvent.click(await screen.findByRole("button", { name: "Run" }));
    await screen.findByRole("heading", { name: "Run Regression suite?" });
    await waitFor(() => expect(api.estimateRunPlan).toHaveBeenCalled());

    expect(screen.queryByText(/Turn count/)).not.toBeInTheDocument();
  });

  test("confirming the dialog is what actually calls runSuite", async () => {
    vi.mocked(api.getSuite).mockResolvedValue(NO_CAP_SUITE);
    vi.mocked(api.estimateRunPlan).mockResolvedValue(ESTIMATE);
    vi.mocked(api.runSuite).mockResolvedValue({
      id: "suite-run-1",
      status: "running",
      configSnapshot: NO_CAP_SUITE.config,
      startedAt: "2026-01-01T00:00:00Z",
    } satisfies SuiteRun);
    renderDetail();

    fireEvent.click(await screen.findByRole("button", { name: "Run" }));
    await screen.findByRole("heading", { name: "Run Regression suite?" });

    fireEvent.click(screen.getByRole("button", { name: "Run suite" }));
    await waitFor(() => expect(api.runSuite).toHaveBeenCalledWith("suite-1"));
  });
});
