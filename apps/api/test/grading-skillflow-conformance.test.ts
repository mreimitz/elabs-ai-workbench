import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import type {
  AssertionResult,
  AssertionResultStatus,
  RunDetail,
  SkillGateExpectation,
  Test,
} from "@mcp-token-footprint/shared";
import type { GradeContext } from "../src/grading/grader.js";
import {
  SKILLFLOW_CONFORMANCE_WEIGHTS,
  SkillflowConformanceGrader,
} from "../src/grading/skillflow-conformance.js";

// ── Fixture builders — persisted verdicts + a RunDetail carrying them ────────────────────────────────

function gate(
  status: AssertionResultStatus,
  opts: { nodeId?: string; expect?: SkillGateExpectation; evidence?: number[] } = {},
): AssertionResult {
  return {
    assertion: {
      kind: "skillGate",
      skillId: "s1",
      nodeId: opts.nodeId ?? "n1",
      expect: opts.expect ?? "pass",
    },
    status,
    reason: "fixture",
    ...(opts.evidence ? { evidence: opts.evidence } : {}),
  };
}

function route(
  status: AssertionResultStatus,
  opts: { edgeId?: string; evidence?: number[] } = {},
): AssertionResult {
  return {
    assertion: {
      kind: "skillRoute",
      skillId: "s1",
      gatekeeperId: "g1",
      expectedEdgeId: opts.edgeId ?? "e1",
    },
    status,
    reason: "fixture",
    ...(opts.evidence ? { evidence: opts.evidence } : {}),
  };
}

function noFractures(
  status: AssertionResultStatus,
  opts: { evidence?: number[] } = {},
): AssertionResult {
  return {
    assertion: { kind: "noFractures" },
    status,
    reason: "fixture",
    ...(opts.evidence ? { evidence: opts.evidence } : {}),
  };
}

/** A `GradeContext` whose `run` carries the given persisted verdicts + resolved skills (default: 1 skill). */
function makeCtx(opts: {
  assertionResults?: AssertionResult[];
  skills?: Array<{ skillId: string }>;
}): GradeContext {
  const run = {
    id: "run-x",
    steps: [],
    events: [],
    skills: opts.skills ?? [{ skillId: "s1" }],
    ...(opts.assertionResults ? { assertionResults: opts.assertionResults } : {}),
  } as unknown as RunDetail;
  return { run, test: {} as Test, finalAssistantText: "" };
}

const grader = new SkillflowConformanceGrader();

function approx(actual: number | null, expected: number): void {
  assert.equal(typeof actual, "number");
  assert.ok(
    Math.abs((actual as number) - expected) < 1e-9,
    `expected ≈ ${expected}, got ${actual}`,
  );
}

// ── (1) Fixture verdict sets → hand-computed weighted scores ─────────────────────────────────────────

test("all-pass verdicts → score 1.0", () => {
  const r = grader.grade(
    makeCtx({
      assertionResults: [
        gate("pass", { nodeId: "n1" }),
        gate("pass", { nodeId: "n2" }),
        route("pass"),
        noFractures("pass"),
      ],
    }),
  );
  assert.equal(r.status, "graded");
  assert.equal(r.method, "skillflow_conformance_v1");
  approx(r.score, 1);
});

test("mixed verdicts → hand-computed weighted value (2/3 gates, 1/1 route, noFractures pass)", () => {
  const r = grader.grade(
    makeCtx({
      assertionResults: [
        gate("pass", { nodeId: "n1" }),
        gate("pass", { nodeId: "n2" }),
        gate("fail", { nodeId: "n3" }),
        route("pass"),
        noFractures("pass"),
      ],
    }),
  );
  // w_gate·(2/3) + w_route·1 + w_nofracture·1 = 0.5·(2/3) + 0.3 + 0.2 = 5/6, over Σw = 1.0.
  assert.equal(r.status, "graded");
  approx(r.score, 5 / 6);
});

test("renormalization: only gates present → scored purely on gates (absent facets drop out)", () => {
  const r = grader.grade(
    makeCtx({ assertionResults: [gate("pass", { nodeId: "n1" }), gate("fail", { nodeId: "n2" })] }),
  );
  // 1/2 gates pass; routes + noFractures absent → score = 0.5·0.5 / 0.5 = 0.5 (not dragged by absence).
  assert.equal(r.status, "graded");
  approx(r.score, 0.5);
  assert.deepEqual((r.evidence as { scoredFacets: string[] }).scoredFacets, ["skillGate"]);
});

test("renormalization across present facets: gates 1/2 + noFractures fail (no routes)", () => {
  const r = grader.grade(
    makeCtx({
      assertionResults: [
        gate("pass", { nodeId: "n1" }),
        gate("fail", { nodeId: "n2" }),
        noFractures("fail"),
      ],
    }),
  );
  // (0.5·0.5 + 0.2·0) / (0.5 + 0.2) = 0.25 / 0.7.
  assert.equal(r.status, "graded");
  approx(r.score, 0.25 / 0.7);
  assert.deepEqual((r.evidence as { scoredFacets: string[] }).scoredFacets, [
    "skillGate",
    "noFractures",
  ]);
});

// ── (2) `unevaluable` verdicts are excluded from denominators (not fails, don't lower the score) ─────

test("unevaluable verdicts drop out of denominators (don't count as fails, don't lower the score)", () => {
  const r = grader.grade(
    makeCtx({
      assertionResults: [
        gate("pass", { nodeId: "n1" }),
        gate("pass", { nodeId: "n2" }),
        gate("unevaluable", { nodeId: "n3" }), // excluded — gate facet stays 2/2
        route("unevaluable"), // the ONLY route verdict → route facet is absent, not 0
        noFractures("pass"),
      ],
    }),
  );
  // gate 2/2 = 1 (unevaluable excluded), route absent, noFractures 1 → (0.5·1 + 0.2·1)/(0.5+0.2) = 1.0.
  assert.equal(r.status, "graded");
  approx(r.score, 1);
  const evidence = r.evidence as {
    scoredFacets: string[];
    facets: {
      skillGate: { evaluated: number; unevaluable: number };
      skillRoute: { evaluated: number };
    };
  };
  assert.deepEqual(evidence.scoredFacets, ["skillGate", "noFractures"]); // route excluded (only unevaluable)
  assert.equal(evidence.facets.skillGate.evaluated, 2); // the unevaluable gate is NOT in the denominator
  assert.equal(evidence.facets.skillGate.unevaluable, 1);
  assert.equal(evidence.facets.skillRoute.evaluated, 0);
});

test("evidence carries the failing assertions' step idxs (deduped + sorted)", () => {
  const r = grader.grade(
    makeCtx({
      assertionResults: [
        gate("pass", { nodeId: "n1" }),
        gate("fail", { nodeId: "n2", evidence: [5, 2] }),
        noFractures("fail", { evidence: [2, 9] }),
      ],
    }),
  );
  assert.deepEqual((r.evidence as { failingStepIdxs: number[] }).failingStepIdxs, [2, 5, 9]);
});

// ── (3) No-skill / no-assertion-results / all-unevaluable → `unevaluable` (score null, NEVER 0) ───────

test("run resolved NO skills → unevaluable (score null, not 0)", () => {
  const r = grader.grade(
    makeCtx({ skills: [], assertionResults: [gate("pass"), noFractures("pass")] }),
  );
  assert.equal(r.status, "unevaluable");
  assert.strictEqual(r.score, null);
  assert.notStrictEqual(r.score, 0);
});

test("no persisted assertion results (test declared no flow assertions) → unevaluable (score null)", () => {
  const r = grader.grade(makeCtx({ skills: [{ skillId: "s1" }] })); // skills resolved, but no verdicts
  assert.equal(r.status, "unevaluable");
  assert.strictEqual(r.score, null);
  assert.notStrictEqual(r.score, 0);
});

test("every persisted verdict is itself unevaluable → unevaluable (never a 0)", () => {
  const r = grader.grade(
    makeCtx({
      assertionResults: [gate("unevaluable"), route("unevaluable"), noFractures("unevaluable")],
    }),
  );
  assert.equal(r.status, "unevaluable");
  assert.strictEqual(r.score, null);
  assert.notStrictEqual(r.score, 0);
});

// ── Determinism ──────────────────────────────────────────────────────────────────────────────────────

test("determinism: same persisted verdicts → identical result twice", () => {
  const verdicts = [
    gate("pass", { nodeId: "n1" }),
    gate("fail", { nodeId: "n2", evidence: [3] }),
    route("pass"),
    noFractures("pass"),
  ];
  assert.deepEqual(
    grader.grade(makeCtx({ assertionResults: verdicts })),
    grader.grade(makeCtx({ assertionResults: verdicts })),
  );
});

test("weights are exported, documented, and cover the three facets", () => {
  assert.deepEqual(Object.keys(SKILLFLOW_CONFORMANCE_WEIGHTS).sort(), [
    "noFractures",
    "skillGate",
    "skillRoute",
  ]);
  for (const w of Object.values(SKILLFLOW_CONFORMANCE_WEIGHTS)) assert.ok(w > 0);
});

// ── (4) Consumes persisted verdicts ONLY — static import assertion ───────────────────────────────────

test("never re-aligns/re-projects/calls a model: imports no aligner, projector, or generate", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const source = fs.readFileSync(
    path.resolve(here, "../src/grading/skillflow-conformance.ts"),
    "utf8",
  );
  // Scan the CODE, not the prose: strip block + line comments (the docstring legitimately NAMES the
  // forbidden concepts to describe the invariant). No `://` appears in this source, so the simple
  // line-comment strip is safe.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const forbidden = [
    /skillflow\/aligner/,
    /skillflow\/projector/,
    /\balignTrace\b/,
    /\bprojectSkillGraph\b/,
    /from ["'][^"']*skillflow/,
    /\bgenerate\b/, // no generateText / streamText / model call
    /\bstreamText\b/,
    /from ["']ai["']/,
  ];
  for (const pattern of forbidden) {
    assert.ok(
      !pattern.test(code),
      `skillflow-conformance.ts must not reference ${pattern} (it consumes persisted verdicts only)`,
    );
  }
  // Positive: it DOES read the persisted assertion verdicts and nothing more.
  assert.ok(/assertionResults/.test(code), "the grader reads ctx.run.assertionResults");
});
