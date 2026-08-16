import type { GraderId, RunGrade } from "@mcp-token-footprint/shared";
import { describe, expect, test } from "vitest";
import {
  filterExpectationGrades,
  pickBaseVerdictEvidence,
  pickPrimaryGrade,
  scoreTone,
} from "./grade-format";

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

describe("filterExpectationGrades", () => {
  test("excludes the three base-rating graders and keeps everything else", () => {
    const grades = [
      grade({ graderId: "outcome_judge" }),
      grade({ graderId: "answer_validation" }),
      grade({ graderId: "insight_surplus" }),
      grade({ graderId: "error_forensics" }),
      grade({ graderId: "rouge1" }),
    ];
    expect(filterExpectationGrades(grades).map((g) => g.graderId)).toEqual([
      "outcome_judge",
      "rouge1",
    ]);
  });

  test("an all-base-rating list yields an empty expectation list", () => {
    const grades = [
      grade({ graderId: "answer_validation" }),
      grade({ graderId: "error_forensics" }),
    ];
    expect(filterExpectationGrades(grades)).toEqual([]);
  });
});

describe("pickPrimaryGrade (AR6 — never conflates a base-rating grader with the expectation pick)", () => {
  test("a base-rating-only run (the common case: no declared expectations) has NO primary expectation grade", () => {
    const grades = [
      grade({ graderId: "answer_validation", status: "graded", score: 0.92 }),
      grade({ graderId: "insight_surplus", status: "graded", score: 0.3 }),
    ];
    // Before the AR6 fix, `latest[0]` (the first graded fallback) would have picked `answer_validation`
    // here — silently rendering a base-rating score through the expectation `GradeChip`.
    expect(pickPrimaryGrade(grades)).toBeNull();
  });

  test("prefers a graded outcome_judge over a graded base grader even when the base grader sorts first", () => {
    const grades = [
      grade({ graderId: "answer_validation", status: "graded", score: 0.92 }),
      grade({ graderId: "outcome_judge", status: "graded", score: 0.7 }),
    ];
    expect(pickPrimaryGrade(grades)?.graderId).toBe("outcome_judge");
  });

  test("falls back to any graded EXPECTATION grader when outcome_judge isn't graded", () => {
    const grades = [
      grade({ graderId: "answer_validation", status: "graded", score: 0.92 }),
      grade({ graderId: "outcome_judge", status: "error", score: null }),
      grade({ graderId: "rouge1", status: "graded", score: 0.6 }),
    ];
    expect(pickPrimaryGrade(grades)?.graderId).toBe("rouge1");
  });

  test("null when the run carries no grades at all", () => {
    expect(pickPrimaryGrade([])).toBeNull();
  });
});

describe("pickBaseVerdictEvidence", () => {
  test("parses a real answer_validation verdict", () => {
    const grades = [
      grade({
        graderId: "answer_validation",
        status: "graded",
        evidence: { verdict: "answered", score: 0.9, quotes: ["yes"], citedSteps: [2] },
      }),
    ];
    expect(pickBaseVerdictEvidence(grades)).toEqual({
      verdict: "answered",
      score: 0.9,
      quotes: ["yes"],
      citedSteps: [2],
    });
  });

  test("an honest 'unanswered' verdict (no final answer) still parses — a REAL signal, not absence", () => {
    const grades = [
      grade({
        graderId: "answer_validation",
        status: "unevaluable",
        score: null,
        evidence: { verdict: "unanswered", score: null, quotes: [], citedSteps: [] },
      }),
    ];
    expect(pickBaseVerdictEvidence(grades)?.verdict).toBe("unanswered");
  });

  test("null when there is no answer_validation row at all", () => {
    expect(pickBaseVerdictEvidence([grade({ graderId: "outcome_judge" })])).toBeNull();
  });

  test("null when the row exists but carries no parseable evidence (unconfigured/unpriced/error judge)", () => {
    const grades = [
      grade({ graderId: "answer_validation", status: "unevaluable", score: null, evidence: null }),
    ];
    expect(pickBaseVerdictEvidence(grades)).toBeNull();
  });

  test("null when evidence is present but malformed (fails the schema)", () => {
    const grades = [
      grade({
        graderId: "answer_validation",
        status: "graded",
        evidence: { verdict: "not-a-real-verdict" },
      }),
    ];
    expect(pickBaseVerdictEvidence(grades)).toBeNull();
  });
});

describe("scoreTone (the ONE 0–1 score-color threshold — owner feedback 2026-07-12)", () => {
  test("< 0.6 is danger (red)", () => {
    expect(scoreTone(0)).toBe("danger");
    expect(scoreTone(0.3)).toBe("danger");
    expect(scoreTone(0.59)).toBe("danger");
  });

  test("0.6 – <0.8 is warning (amber) — a 60% judge score must never read green", () => {
    expect(scoreTone(0.6)).toBe("warning");
    expect(scoreTone(0.7)).toBe("warning");
    expect(scoreTone(0.79)).toBe("warning");
  });

  test("≥ 0.8 is success (green)", () => {
    expect(scoreTone(0.8)).toBe("success");
    expect(scoreTone(0.92)).toBe("success");
    expect(scoreTone(1)).toBe("success");
  });
});
