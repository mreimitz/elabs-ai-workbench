import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import type { GraderId, RunGrade } from "@mcp-token-footprint/shared";
import { BaseVerdictChip } from "./BaseVerdictChip";
import { GradeChip } from "./GradeChip";

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

describe("BaseVerdictChip", () => {
  test("renders 'Answered' for a real answered verdict", () => {
    render(
      <BaseVerdictChip
        latest={[
          grade({
            graderId: "answer_validation",
            evidence: { verdict: "answered", score: 0.9, quotes: [], citedSteps: [] },
          }),
        ]}
      />,
    );
    expect(screen.getByText("Answered")).toBeInTheDocument();
  });

  test("renders 'Partial' for a partial verdict", () => {
    render(
      <BaseVerdictChip
        latest={[
          grade({
            graderId: "answer_validation",
            evidence: { verdict: "partial", score: 0.5, quotes: [], citedSteps: [] },
          }),
        ]}
      />,
    );
    expect(screen.getByText("Partial")).toBeInTheDocument();
  });

  test("renders 'Unanswered' for an honest no-final-answer verdict", () => {
    render(
      <BaseVerdictChip
        latest={[
          grade({
            graderId: "answer_validation",
            status: "unevaluable",
            score: null,
            evidence: { verdict: "unanswered", score: null, quotes: [], citedSteps: [] },
          }),
        ]}
      />,
    );
    expect(screen.getByText("Unanswered")).toBeInTheDocument();
  });

  test("absent grade → an honest muted 'Not rated', never a fake verdict", () => {
    render(<BaseVerdictChip latest={[grade({ graderId: "outcome_judge" })]} />);
    expect(screen.getByText("Not rated")).toBeInTheDocument();
    expect(screen.queryByText("Answered")).not.toBeInTheDocument();
    expect(screen.queryByText("Unanswered")).not.toBeInTheDocument();
  });

  test("a row present with no parseable evidence (e.g. unconfigured judge) also reads 'Not rated'", () => {
    render(
      <BaseVerdictChip
        latest={[
          grade({
            graderId: "answer_validation",
            status: "unevaluable",
            score: null,
            evidence: null,
          }),
        ]}
      />,
    );
    expect(screen.getByText("Not rated")).toBeInTheDocument();
  });

  test("AR6 — structurally distinct from the expectation GradeChip: different DOM shape for the same run", () => {
    const grades = [
      grade({ graderId: "outcome_judge", status: "graded", score: 0.8 }),
      grade({
        graderId: "answer_validation",
        evidence: { verdict: "answered", score: 0.9, quotes: [], citedSteps: [] },
      }),
    ];
    render(
      <div>
        <GradeChip latest={grades} />
        <BaseVerdictChip latest={grades} />
      </div>,
    );
    // GradeChip renders the design-system StatusBadge (execution-status colored); BaseVerdictChip
    // renders a plain semantic-variant Badge. The two never collapse into a single chip: each verdict
    // word renders in its OWN element, and the expectation chip's label ("Judge 80%") never carries
    // the base verdict's word ("Answered").
    const judgeChip = screen.getByText("Judge 80%");
    const verdictChip = screen.getByText("Answered");
    expect(judgeChip).not.toBe(verdictChip);
    expect(judgeChip.closest("span")).not.toBe(verdictChip.closest("span"));
    expect(judgeChip.textContent).not.toContain("Answered");
    expect(verdictChip.textContent).not.toContain("Judge");
  });
});
