import { MemoryRouter } from "react-router-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { GraderId, RunGrade, RunStep } from "@mcp-token-footprint/shared";

// Auto-Rating WP 3.2 — GradePanel is slimmed to a compact summary that links to the run console's
// Report tab; mock the api client the same way ReportTab.test.tsx does.
vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    getRunGrades: vi.fn(),
    regradeRun: vi.fn(),
  };
});

import * as api from "../../lib/api";
import { GradePanel } from "./GradePanel";

/** Minimal `RunGrade` builder — only the fields a given test asserts on get real values. */
function grade(over: Partial<RunGrade> & { graderId: GraderId }): RunGrade {
  return {
    id: `g_${over.graderId}`,
    runId: "run_1",
    kind: "deterministic",
    status: "graded",
    score: 0.5,
    rawScore: null,
    method: "test",
    reasoning: null,
    evidence: null,
    judgeProviderId: null,
    judgeModel: null,
    judgeTokensIn: 0,
    judgeTokensOut: 0,
    judgeCostUsd: 0,
    gradingVersion: 1,
    createdAt: "2026-07-11T00:00:00Z",
    ...over,
  };
}

const STEPS: RunStep[] = [];

function renderPanel(props: Partial<Parameters<typeof GradePanel>[0]> = {}) {
  const onSelectStep = vi.fn();
  const onOpenReport = vi.fn();
  render(
    <MemoryRouter>
      <GradePanel
        runId="run_1"
        steps={STEPS}
        onSelectStep={onSelectStep}
        onOpenReport={onOpenReport}
        {...props}
      />
    </MemoryRouter>,
  );
  return { onSelectStep, onOpenReport };
}

beforeEach(() => {
  vi.mocked(api.getRunGrades).mockReset();
  vi.mocked(api.regradeRun).mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("GradePanel", () => {
  test("empty state: a run with no grades at all reads honestly, no summary/report affordance", async () => {
    vi.mocked(api.getRunGrades).mockResolvedValue({ grades: [], latest: [] });
    renderPanel();

    expect(await screen.findByText("No grades yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /open full report/i })).not.toBeInTheDocument();
  });

  test("compact summary: expectation GradeChips ALONGSIDE the separate base-verdict chip (AR6)", async () => {
    vi.mocked(api.getRunGrades).mockResolvedValue({
      grades: [],
      latest: [
        grade({ graderId: "outcome_judge", status: "graded", score: 0.8 }),
        grade({
          graderId: "answer_validation",
          evidence: { verdict: "answered", score: 0.9, quotes: [], citedSteps: [] },
        }),
      ],
    });
    renderPanel();

    expect(await screen.findByText("Judge 80%")).toBeInTheDocument();
    expect(screen.getByText("Answered")).toBeInTheDocument();
    // Labeled rows name each dimension distinctly.
    expect(screen.getByText("Expectation:")).toBeInTheDocument();
    expect(screen.getByText("Base rating:")).toBeInTheDocument();
  });

  test("a base-rating-only run (no declared expectations) shows 'none' for expectation, a real base chip", async () => {
    vi.mocked(api.getRunGrades).mockResolvedValue({
      grades: [],
      latest: [
        grade({
          graderId: "answer_validation",
          evidence: { verdict: "partial", score: 0.5, quotes: [], citedSteps: [] },
        }),
      ],
    });
    renderPanel();

    expect(await screen.findByText("Partial")).toBeInTheDocument();
    expect(screen.getByText("none")).toBeInTheDocument();
  });

  test("'Open full report' calls onOpenReport (reveals the run console's Report tab)", async () => {
    vi.mocked(api.getRunGrades).mockResolvedValue({
      grades: [],
      latest: [grade({ graderId: "outcome_judge", status: "graded", score: 0.8 })],
    });
    const { onOpenReport } = renderPanel();

    const openReport = await screen.findByRole("button", { name: /open full report/i });
    fireEvent.click(openReport);
    expect(onOpenReport).toHaveBeenCalledTimes(1);
  });

  test("'Grader detail' starts closed and reveals the full per-grader breakdown on demand — nothing deleted", async () => {
    vi.mocked(api.getRunGrades).mockResolvedValue({
      grades: [],
      latest: [
        grade({
          graderId: "outcome_judge",
          status: "graded",
          score: 0.8,
          rawScore: 8,
          reasoning: "Reached the goal.",
          evidence: [2],
        }),
      ],
    });
    renderPanel();

    await screen.findByText("Judge 80%");
    // The detail (a MetricCard for the grader + its judge reasoning) is NOT visible by default — not
    // even the MetricCard grid, which only lives inside the closed "Grader detail" collapsible.
    expect(screen.queryByText("Outcome judge")).not.toBeInTheDocument();
    expect(screen.queryByText("Reached the goal.")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /grader detail/i }));
    // The MetricCard grid appears (its full label, distinct from the compact chip's short "Judge").
    expect(await screen.findByText("Outcome judge")).toBeInTheDocument();
    // The judge's own reasoning is a further nested disclosure — reveal it too.
    fireEvent.click(screen.getByRole("button", { name: /outcome judge . reasoning/i }));
    expect(await screen.findByText("Reached the goal.")).toBeInTheDocument();
  });

  test("Re-grade calls regradeRun and refetches", async () => {
    vi.mocked(api.getRunGrades).mockResolvedValue({
      grades: [],
      latest: [grade({ graderId: "outcome_judge", status: "graded", score: 0.8 })],
    });
    vi.mocked(api.regradeRun).mockResolvedValue({ inserted: [] });
    renderPanel();

    await screen.findByText("Judge 80%");
    expect(api.getRunGrades).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /re-grade/i }));
    await waitFor(() => expect(api.regradeRun).toHaveBeenCalledWith("run_1"));
    await waitFor(() => expect(api.getRunGrades).toHaveBeenCalledTimes(2));
  });

  test("error slot renders only on a settled fetch failure", async () => {
    vi.mocked(api.getRunGrades).mockRejectedValue(new Error("boom"));
    renderPanel();
    expect(await screen.findByText("Couldn’t load grades")).toBeInTheDocument();
  });
});
