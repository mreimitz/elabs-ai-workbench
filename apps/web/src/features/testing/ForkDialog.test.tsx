import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { RunPlanEstimate, RunStep } from "@mcp-token-footprint/shared";

// Observability WP3.3 (D-OB18) — the fork dialog must call the ESTIMATE endpoint on open (estimate-
// first) and POST the rerun with the edited overrides + fork point on launch.
vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, estimateRunPlan: vi.fn(), rerunRun: vi.fn() };
});

import * as api from "../../lib/api";
import { ForkDialog } from "./ForkDialog";

const ESTIMATE: RunPlanEstimate = {
  testCount: 1,
  environmentCount: 1,
  repetitions: 1,
  totalRuns: 1,
  tokens: { low: 100, mid: 200, high: 300 },
  costUsd: { low: 0.001, mid: 0.002, high: 0.003 },
  unpricedEnvironmentCount: 0,
  uncappedEnvironmentCount: 0,
  environments: [],
};

const STEPS: RunStep[] = [
  {
    id: "run:step:0",
    runId: "run",
    index: 0,
    type: "user_message",
    label: "user",
    status: "ok",
    profileTokens: {},
    payload: { text: "Original question" },
  },
  {
    id: "run:step:1",
    runId: "run",
    index: 1,
    type: "llm_response",
    label: "assistant",
    status: "ok",
    profileTokens: {},
    assistantText: "The answer.",
    turnIndex: 0,
    payload: null,
  },
];

afterEach(() => {
  vi.mocked(api.estimateRunPlan).mockReset();
  vi.mocked(api.rerunRun).mockReset();
});

function renderDialog(over: Partial<Parameters<typeof ForkDialog>[0]> = {}) {
  const onLaunched = vi.fn();
  render(
    <ForkDialog
      open
      onOpenChange={vi.fn()}
      runId="parent-1"
      testId="t-1"
      scenarioId="scn-1"
      supportsMidRun
      steps={STEPS}
      defaultPrompt="Original question"
      currentModel="claude-sonnet-4"
      onLaunched={onLaunched}
      {...over}
    />,
  );
  return { onLaunched };
}

test("calls the estimate endpoint on open (estimate-first) and shows the band", async () => {
  vi.mocked(api.estimateRunPlan).mockResolvedValue(ESTIMATE);
  renderDialog();
  await waitFor(() =>
    expect(api.estimateRunPlan).toHaveBeenCalledWith(["t-1"], ["scn-1"], 1),
  );
  expect(await screen.findByText(/200 tokens/)).toBeInTheDocument();
});

test("launches a whole-run fork with the edited prompt override and navigates", async () => {
  vi.mocked(api.estimateRunPlan).mockResolvedValue(ESTIMATE);
  vi.mocked(api.rerunRun).mockResolvedValue({ runId: "derived-9", streamUrl: "/api/runs/derived-9/stream" });
  const { onLaunched } = renderDialog();

  const prompt = screen.getByLabelText("Prompt") as HTMLTextAreaElement;
  fireEvent.change(prompt, { target: { value: "A different question" } });
  fireEvent.click(screen.getByRole("button", { name: /launch fork/i }));

  await waitFor(() =>
    expect(api.rerunRun).toHaveBeenCalledWith("parent-1", {
      overrides: { prompt: "A different question" },
    }),
  );
  await waitFor(() => expect(onLaunched).toHaveBeenCalledWith("derived-9"));
});

test("mid-run fork: selecting a fork point sends fromStepId", async () => {
  vi.mocked(api.estimateRunPlan).mockResolvedValue(ESTIMATE);
  vi.mocked(api.rerunRun).mockResolvedValue({ runId: "derived-2", streamUrl: "/api/runs/derived-2/stream" });
  renderDialog({ initialFromStepId: "run:step:1", defaultPrompt: "" });

  fireEvent.click(screen.getByRole("button", { name: /launch fork/i }));
  await waitFor(() =>
    expect(api.rerunRun).toHaveBeenCalledWith("parent-1", { fromStepId: "run:step:1" }),
  );
});

test("a whole-run-only backend hides the fork-point selector", async () => {
  vi.mocked(api.estimateRunPlan).mockResolvedValue(ESTIMATE);
  renderDialog({ supportsMidRun: false });
  expect(screen.queryByText("Fork point")).not.toBeInTheDocument();
  expect(
    screen.getByText(/whole-run re-run only/i),
  ).toBeInTheDocument();
});

// --- RM-34 WP 1.3 (D-ET5) — the estimate says where its turn model came from -------------------

const MEASURED: RunPlanEstimate = {
  ...ESTIMATE,
  environments: [
    {
      environmentId: "scn-1",
      name: "Env",
      model: "claude-sonnet-4",
      priced: true,
      footprintTokens: 2000,
      hasCostCap: true,
      tokens: { low: 100, mid: 200, high: 300 },
      costUsd: { low: 0.001, mid: 0.002, high: 0.003 },
      turnProfile: {
        basis: "pair",
        sampleSize: 51,
        turns: { low: 5, mid: 9, high: 19 },
        outputTokensPerTurn: 1036,
      },
    },
  ],
};

test("the estimate names its turn basis and sample size when the response carries one", async () => {
  vi.mocked(api.estimateRunPlan).mockResolvedValue(MEASURED);
  renderDialog();
  const note = await screen.findByText(/past runs of this test on this environment\./);
  expect(note.textContent).toBe("Turn count from 51 past runs of this test on this environment.");
});

test("with no turnProfile on the wire (the pre-WP-1.2 response) it claims nothing", async () => {
  vi.mocked(api.estimateRunPlan).mockResolvedValue(ESTIMATE);
  renderDialog();
  expect(await screen.findByText(/200 tokens/)).toBeInTheDocument();
  expect(screen.queryByText(/Turn count/)).not.toBeInTheDocument();
});
