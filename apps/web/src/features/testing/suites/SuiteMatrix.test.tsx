import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { RunGrade, SuiteCell } from "@mcp-token-footprint/shared";
import { TooltipProvider } from "@elabs-ai/components-ui";

// Auto-Rating WP 3.2 (AR6) — SuiteMatrix self-fetches each settled cell's drill-through run grades to
// derive a base-rating verdict marker; mock the api client the same way RunsView/GradePanel do.
vi.mock("../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api")>();
  return {
    ...actual,
    getRunGrades: vi.fn(),
    // Benchmarks WP 6.1 — a settled cell also loads the human's call on its primary grade.
    listRunGradeFeedback: vi.fn(),
    appendGradeFeedback: vi.fn(),
  };
});

import * as api from "../../../lib/api";
import { SuiteMatrix, type SuiteMatrixRef } from "./SuiteMatrix";

const TESTS: SuiteMatrixRef[] = [{ id: "t1", name: "Test A" }];
const SCENARIOS: SuiteMatrixRef[] = [{ id: "s1", name: "Env A" }];

function answerValidationGrade(evidence: unknown): RunGrade {
  return {
    id: "g1",
    runId: "run_1",
    graderId: "answer_validation",
    kind: "llm",
    status: "graded",
    score: 0.9,
    rawScore: 9,
    method: "answer_validation_v1",
    reasoning: null,
    evidence,
    judgeProviderId: "prov_1",
    judgeModel: "gpt-4o",
    judgeTokensIn: 10,
    judgeTokensOut: 5,
    judgeCostUsd: 0.01,
    gradingVersion: 1,
    createdAt: "2026-07-11T00:00:00Z",
  };
}

function completedCell(over: Partial<SuiteCell> = {}): Record<string, SuiteCell> {
  return {
    c1: {
      testId: "t1",
      scenarioId: "s1",
      repetition: 0,
      runId: "run_1",
      status: "completed",
      score: 0.8,
      ...over,
    },
  };
}

beforeEach(() => {
  vi.mocked(api.getRunGrades).mockReset();
  vi.mocked(api.listRunGradeFeedback).mockReset();
  vi.mocked(api.listRunGradeFeedback).mockResolvedValue([]);
  vi.mocked(api.appendGradeFeedback).mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("SuiteMatrix — base-rating verdict marker (AR6)", () => {
  test("a settled cell with a real answer_validation verdict shows the marker, distinct from the rollup fill", async () => {
    vi.mocked(api.getRunGrades).mockResolvedValue({
      grades: [],
      latest: [
        answerValidationGrade({ verdict: "answered", score: 0.9, quotes: [], citedSteps: [] }),
      ],
    });
    render(
      <SuiteMatrix
        tests={TESTS}
        scenarios={SCENARIOS}
        cells={completedCell()}
        repetitions={1}
        onOpenRun={vi.fn()}
      />,
    );

    // The existing rollup fill (count + status label) still renders.
    expect(screen.getByText("1 / 1")).toBeInTheDocument();
    // The base-rating marker arrives once its fetch resolves.
    expect(await screen.findByText("Answered")).toBeInTheDocument();
    expect(api.getRunGrades).toHaveBeenCalledWith("run_1");
  });

  test("a settled cell with no answer_validation grade reads the honest muted 'Not rated'", async () => {
    vi.mocked(api.getRunGrades).mockResolvedValue({ grades: [], latest: [] });
    render(
      <SuiteMatrix
        tests={TESTS}
        scenarios={SCENARIOS}
        cells={completedCell()}
        repetitions={1}
        onOpenRun={vi.fn()}
      />,
    );
    expect(await screen.findByText("Not rated")).toBeInTheDocument();
  });

  test("a PENDING cell (no repetitions started) shows no marker at all and never fetches grades", () => {
    render(
      <SuiteMatrix
        tests={TESTS}
        scenarios={SCENARIOS}
        cells={{}}
        repetitions={2}
        onOpenRun={vi.fn()}
      />,
    );
    expect(screen.getByText("0 / 2")).toBeInTheDocument();
    expect(screen.queryByText("Not rated")).not.toBeInTheDocument();
    expect(screen.queryByText("Answered")).not.toBeInTheDocument();
    expect(api.getRunGrades).not.toHaveBeenCalled();
  });

  test("a RUNNING cell shows no marker yet — base rating only applies once the cell has settled", () => {
    render(
      <SuiteMatrix
        tests={TESTS}
        scenarios={SCENARIOS}
        cells={completedCell({ status: "running", runId: "run_1" })}
        repetitions={1}
        onOpenRun={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /running/i })).toBeInTheDocument();
    expect(screen.queryByText("Not rated")).not.toBeInTheDocument();
    expect(api.getRunGrades).not.toHaveBeenCalled();
  });
});

// ── Benchmarks WP 6.1 — the human's call on a cell's grade ──────────────────────────────────────

function outcomeJudgeGrade(): RunGrade {
  return {
    ...answerValidationGrade(null),
    id: "g_judge",
    graderId: "outcome_judge",
    method: "single_sample",
    evidence: null,
  };
}

function renderMatrix(cells: Record<string, SuiteCell>) {
  return render(
    <TooltipProvider>
      <SuiteMatrix
        tests={TESTS}
        scenarios={SCENARIOS}
        cells={cells}
        repetitions={1}
        onOpenRun={vi.fn()}
      />
    </TooltipProvider>,
  );
}

describe("SuiteMatrix — grade feedback (WP 6.1)", () => {
  test("a settled cell with an expectation grade gets a feedback control, named for the cell", async () => {
    vi.mocked(api.getRunGrades).mockResolvedValue({ grades: [], latest: [outcomeJudgeGrade()] });
    renderMatrix(completedCell());

    expect(
      await screen.findByRole("button", {
        name: "Test A × Env A — Outcome judge: Grader was right",
      }),
    ).toBeInTheDocument();
    expect(api.listRunGradeFeedback).toHaveBeenCalledWith("run_1");
  });

  test("the control is a SIBLING of the drill-through button, never nested inside it", async () => {
    vi.mocked(api.getRunGrades).mockResolvedValue({ grades: [], latest: [outcomeJudgeGrade()] });
    renderMatrix(completedCell());

    const toggle = await screen.findByRole("button", {
      name: "Test A × Env A — Outcome judge: Grader was wrong",
    });
    const drill = screen.getByRole("button", { name: /Open run\./ });
    // A button inside a button is invalid markup and would make one click mean two things.
    expect(drill.contains(toggle)).toBe(false);
  });

  test("clicking a cell's thumb appends a verdict against that cell's own grade", async () => {
    vi.mocked(api.getRunGrades).mockResolvedValue({ grades: [], latest: [outcomeJudgeGrade()] });
    vi.mocked(api.appendGradeFeedback).mockResolvedValue({
      id: "fb_1",
      gradeId: "g_judge",
      runId: "run_1",
      verdict: "disagree",
      createdAt: "2026-08-21T00:00:00Z",
    });
    renderMatrix(completedCell());

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Test A × Env A — Outcome judge: Grader was wrong",
      }),
    );
    await waitFor(() =>
      expect(api.appendGradeFeedback).toHaveBeenCalledWith("g_judge", { verdict: "disagree" }),
    );
    // AR6 — the cell's own score readout is untouched by the verdict.
    expect(screen.getByText("score 0.80")).toBeInTheDocument();
  });

  test("a cell whose run has ONLY base-rating grades gets no control (nothing to judge)", async () => {
    vi.mocked(api.getRunGrades).mockResolvedValue({
      grades: [],
      latest: [
        answerValidationGrade({ verdict: "answered", score: 0.9, quotes: [], citedSteps: [] }),
      ],
    });
    renderMatrix(completedCell());

    expect(await screen.findByText("Answered")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Grader was right/ })).not.toBeInTheDocument();
  });

  test("a PENDING cell never fetches feedback", () => {
    renderMatrix({});
    expect(api.listRunGradeFeedback).not.toHaveBeenCalled();
  });
});
