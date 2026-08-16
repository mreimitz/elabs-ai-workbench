import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { RunGrade, SuiteCell } from "@mcp-token-footprint/shared";

// Auto-Rating WP 3.2 (AR6) — SuiteMatrix self-fetches each settled cell's drill-through run grades to
// derive a base-rating verdict marker; mock the api client the same way RunsView/GradePanel do.
vi.mock("../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api")>();
  return {
    ...actual,
    getRunGrades: vi.fn(),
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
