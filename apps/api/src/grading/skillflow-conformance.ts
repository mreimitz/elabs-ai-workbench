import type { AssertionResult } from "@mcp-token-footprint/shared";
import type { GradeContext, Grader, GraderResult } from "./grader.js";

/**
 * skillflow_conformance grader (B6.3, WP 2.3) — a DETERMINISTIC grade of HOW FAITHFULLY a run followed
 * the designed flows of its attached skills. It derives ONE 0–1 number from the run's ALREADY-PERSISTED
 * SkillFlow verdicts (`RunDetail.assertionResults`, produced by the WP 5.1 assertion evaluator over the
 * WP 2.2 trace alignment). No model, no MCP session, no execution, and — critically — NO re-alignment
 * and NO graph re-projection: it consumes the persisted `AssertionResult[]` and nothing else.
 *
 * HARD invariants (planning/Roadmap/RM-07-benchmarks/conventions.md):
 *   - NEVER re-projects a skill graph, re-aligns a trace, or calls a model. It reads `ctx.run`'s
 *     persisted verdicts ONLY. (Enforced by a static import assertion in
 *     `test/grading-skillflow-conformance.test.ts`: this file imports neither the skillflow
 *     aligner/projector nor any `generate`/model.)
 *   - Grading never blocks/fails/mutates the run.
 *   - `unevaluable` (score `null`) — NEVER 0 — when there is nothing to score: the run resolved NO
 *     skills, the test declared NO flow assertions, or every persisted verdict was itself `unevaluable`
 *     (a misconfigured assertion the WP 5.1 evaluator could not judge).
 *
 * SCORING (documented, weighted, renormalized over the facets actually present):
 *   Each assertion facet contributes `passed / evaluated`, where `evaluated = pass + fail` for that
 *   facet (persisted `unevaluable` verdicts are EXCLUDED from the denominator — they never lower the
 *   score and never count as a failure). A facet is PRESENT only when it has ≥ 1 evaluated verdict.
 *
 *     score = Σ_present( w_facet · passed_facet / evaluated_facet ) / Σ_present( w_facet )
 *
 *   A run whose only flow assertions are gates is scored purely on its gates (absent routes /
 *   noFractures do not drag it down — they simply drop out of both sums). An all-pass run scores 1.0.
 */

const METHOD = "skillflow_conformance_v1";

/** The three assertion facets a `TestAssertions` can carry — the keys the weights are indexed by. */
type FacetKey = "skillGate" | "skillRoute" | "noFractures";

/**
 * Per-facet weight in the conformance score. EXPORTED so the weighting is auditable and stable. The
 * absolute values matter only relative to one another: the score is renormalized over the facets that
 * are actually present in a given run (see the formula above), so a run missing a facet is never
 * penalized for its absence. Rationale for the ordering:
 *   - `skillGate`  (0.5) — the strongest conformance signal: did the run reach and PASS the skill's
 *     designed validation gates / required nodes.
 *   - `skillRoute` (0.3) — routing fidelity: did the run take the designed branch at each gatekeeper.
 *   - `noFractures`(0.2) — a coarse, run-wide binary: did the run avoid any off-graph fracture.
 */
export const SKILLFLOW_CONFORMANCE_WEIGHTS: Readonly<Record<FacetKey, number>> = {
  skillGate: 0.5,
  skillRoute: 0.3,
  noFractures: 0.2,
};

/** Per-facet tally of the persisted verdicts. `evaluated = pass + fail` (excludes `unevaluable`). */
type FacetTally = { pass: number; fail: number; unevaluable: number };

function emptyTally(): FacetTally {
  return { pass: 0, fail: 0, unevaluable: 0 };
}

export class SkillflowConformanceGrader implements Grader {
  readonly id = "skillflow_conformance" as const;
  readonly kind = "deterministic" as const;

  grade(ctx: GradeContext): GraderResult {
    const assertionResults: AssertionResult[] = ctx.run.assertionResults ?? [];
    const resolvedSkills = ctx.run.skills ?? [];

    // (1) Nothing to score against: the run attached no skill, so it has no designed flow to conform to.
    if (resolvedSkills.length === 0) {
      return unevaluable(
        "run resolved no skills — no attached-skill flow to score conformance against",
      );
    }
    // (2) The test declared no flow assertions → the run carries no persisted SkillFlow verdicts.
    if (assertionResults.length === 0) {
      return unevaluable(
        "run carries no SkillFlow assertion verdicts (the test declared no flow assertions)",
      );
    }

    // Tally the persisted verdicts per facet (a fixed, stable key order for deterministic evidence).
    const tallies: Record<FacetKey, FacetTally> = {
      skillGate: emptyTally(),
      skillRoute: emptyTally(),
      noFractures: emptyTally(),
    };
    const failingStepIdxs = new Set<number>();
    for (const result of assertionResults) {
      const key = result.assertion.kind as FacetKey;
      const tally = tallies[key];
      if (result.status === "pass") tally.pass += 1;
      else if (result.status === "fail") {
        tally.fail += 1;
        for (const idx of result.evidence ?? []) failingStepIdxs.add(idx);
      } else tally.unevaluable += 1;
    }

    // Weighted, renormalized score over the PRESENT facets (evaluated = pass + fail > 0).
    let weightedSum = 0;
    let weightTotal = 0;
    const present: FacetKey[] = [];
    for (const key of ["skillGate", "skillRoute", "noFractures"] as const) {
      const tally = tallies[key];
      const evaluated = tally.pass + tally.fail;
      if (evaluated === 0) continue; // absent (or only unevaluable) → excluded from both sums
      const weight = SKILLFLOW_CONFORMANCE_WEIGHTS[key];
      weightedSum += weight * (tally.pass / evaluated);
      weightTotal += weight;
      present.push(key);
    }

    // (3) Every persisted verdict was itself `unevaluable` → nothing scorable. Never a 0.
    if (weightTotal === 0) {
      return unevaluable(
        "every persisted SkillFlow verdict was unevaluable — no pass/fail signal to score conformance",
      );
    }

    const score = weightedSum / weightTotal;
    const evidence = {
      facets: {
        skillGate: facetSummary(tallies.skillGate),
        skillRoute: facetSummary(tallies.skillRoute),
        noFractures: facetSummary(tallies.noFractures),
      },
      scoredFacets: present,
      failingStepIdxs: [...failingStepIdxs].sort((a, b) => a - b),
    };

    return {
      status: "graded",
      score,
      method: METHOD,
      reasoning: `${present.map((key) => `${key} ${tallies[key].pass}/${tallies[key].pass + tallies[key].fail}`).join(", ")} → ${score.toFixed(4)} (weighted over ${present.length} facet(s))`,
      evidence,
    };
  }
}

function facetSummary(tally: FacetTally): {
  pass: number;
  fail: number;
  unevaluable: number;
  evaluated: number;
  total: number;
} {
  return {
    pass: tally.pass,
    fail: tally.fail,
    unevaluable: tally.unevaluable,
    evaluated: tally.pass + tally.fail,
    total: tally.pass + tally.fail + tally.unevaluable,
  };
}

function unevaluable(reasoning: string): GraderResult {
  return { status: "unevaluable", score: null, method: METHOD, reasoning };
}
