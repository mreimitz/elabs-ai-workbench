import assert from "node:assert/strict";
import { test } from "node:test";
import {
  answerValidationEvidenceSchema,
  type JudgeSettings,
  type RunDetail,
  type RunStep,
  type Test,
} from "@mcp-token-footprint/shared";
import {
  ANSWER_VALIDATION_ID,
  buildAnswerValidationPrompt,
  createAnswerValidationGrader,
} from "../src/grading/answer-validation.js";
import type { GradeContext } from "../src/grading/grader.js";
import type { JudgeGenerate, JudgeGenerateResult } from "../src/grading/judge.js";
import { estimateCost } from "../src/providers/pricing.js";

const NOW = "2026-07-04T00:00:00.000Z";
const PRICED_MODEL = "claude-sonnet-4"; // priced → estimateCost > 0, isModelPriced true
const UNPRICED_MODEL = "totally-made-up-model-zzz"; // not priced anywhere → isModelPriced false
const USAGE = { inputTokens: 1200, outputTokens: 40 };

const CONFIGURED: () => JudgeSettings = () => ({
  providerCredentialId: "prov-1",
  model: PRICED_MODEL,
});
const UNCONFIGURED: () => JudgeSettings | null = () => null;
const UNPRICED: () => JudgeSettings = () => ({
  providerCredentialId: "prov-1",
  model: UNPRICED_MODEL,
});

/** A stub `generate` returning a fixed result (or via a thunk). No network, no provider. */
function stubGenerate(
  result: JudgeGenerateResult | (() => Promise<JudgeGenerateResult>),
): JudgeGenerate {
  return async () => (typeof result === "function" ? result() : result);
}

/** A `generate` that records whether it was called (proves the no-answer/unpriced short-circuits skip it). */
function trackedThrowingGenerate(): { gen: JudgeGenerate; called: () => boolean } {
  let wasCalled = false;
  const gen: JudgeGenerate = async () => {
    wasCalled = true;
    throw new Error("generate must not be called on this path");
  };
  return { gen, called: () => wasCalled };
}

function llmStep(index: number, text: string): RunStep {
  return {
    id: `s${index}`,
    runId: "run-1",
    index,
    type: "llm_response",
    label: "answer",
    status: "ok",
    profileTokens: {},
    assistantText: text,
    payload: null,
  };
}

function userStep(index: number, text: string): RunStep {
  return {
    id: `s${index}`,
    runId: "run-1",
    index,
    type: "user_message",
    label: "user",
    status: "ok",
    profileTokens: {},
    payload: { text },
  };
}

function ctx(opts: { question?: string; answer: string; steps?: RunStep[] }): GradeContext {
  const steps = opts.steps ?? (opts.answer ? [llmStep(0, opts.answer)] : []);
  const test: Test = {
    id: "test-x",
    name: "T",
    userPrompt: opts.question ?? "What was Q1 revenue?",
    addedProfiles: [],
    attachments: [],
    tags: [],
    createdAt: NOW,
    updatedAt: NOW,
  };
  return { run: { steps } as RunDetail, test, finalAssistantText: opts.answer };
}

// ── Happy path: verdict + score + evidence (quotes/citedSteps); schema validates ───────────────────

test("answer_validation: a good answer → verdict answered, score, evidence quotes/citedSteps; schema validates", async () => {
  const grader = createAnswerValidationGrader({
    resolveJudge: CONFIGURED,
    generate: stubGenerate({
      text: '{"verdict":"answered","rating":9,"quotes":["Q1 revenue was $4.2M"],"reason":"Directly answers the question."}',
      usage: USAGE,
    }),
  });
  assert.equal(grader.id, ANSWER_VALIDATION_ID);
  assert.equal(grader.kind, "llm");
  assert.equal(grader.mandatory, true);

  // Two llm_response steps produced the answer; a non-answer step must NOT be cited.
  const steps = [llmStep(0, "Q1 revenue was $4.2M"), llmStep(2, "It grew 15% YoY.")];
  const r = await grader.grade(ctx({ answer: "Q1 revenue was $4.2M\nIt grew 15% YoY.", steps }));

  assert.equal(r.status, "graded");
  assert.equal(r.rawScore, 9);
  assert.equal(r.score, 0.9);
  assert.equal(r.method, "answer_validation_v1"); // AR15 version stamp

  const evidence = answerValidationEvidenceSchema.parse(r.evidence);
  assert.equal(evidence.verdict, "answered");
  assert.equal(evidence.score, 0.9);
  assert.deepEqual(evidence.quotes, ["Q1 revenue was $4.2M"]);
  assert.deepEqual(
    evidence.citedSteps,
    [0, 2],
    "citedSteps are the answer-producing step idxs (deep-link)",
  );
});

test("answer_validation: an INTERACTIVE multi-turn session validates the WHOLE conversation (not just the opener)", async () => {
  let capturedPrompt = "";
  const generate: JudgeGenerate = async (_settings, prompt) => {
    capturedPrompt = prompt;
    return {
      text: '{"verdict":"answered","rating":8,"quotes":["63M flights","AA has 8.5M"],"reason":"Both turns answered."}',
      usage: USAGE,
    };
  };
  const grader = createAnswerValidationGrader({ resolveJudge: CONFIGURED, generate });

  // A stopped/settled interactive session: opener + a follow-up, each with its own answer.
  const steps = [
    userStep(0, "How many flights in total?"),
    llmStep(1, "There are 63M flights."),
    userStep(2, "And how does it break down by carrier?"),
    llmStep(3, "AA has 8.5M, Delta 8.9M."),
  ];
  const grade = await grader.grade({
    run: { steps } as RunDetail,
    test: {
      id: "test-x",
      name: "T",
      userPrompt: "How many flights in total?",
      addedProfiles: [],
      attachments: [],
      tags: [],
      createdAt: NOW,
      updatedAt: NOW,
    },
    finalAssistantText: "There are 63M flights.\nAA has 8.5M, Delta 8.9M.",
  });

  assert.equal(grade.status, "graded");
  assert.equal(grade.rawScore, 8);
  // The judge saw the FULL conversation — the follow-up question AND its answer, not just the opener.
  assert.match(capturedPrompt, /conversation/i);
  assert.ok(
    capturedPrompt.includes("And how does it break down by carrier?"),
    "the follow-up QUESTION was included",
  );
  assert.ok(capturedPrompt.includes("AA has 8.5M"), "the follow-up ANSWER was included");
  const evidence = answerValidationEvidenceSchema.parse(grade.evidence);
  assert.deepEqual(evidence.citedSteps, [1, 3], "citedSteps are the answer-producing steps");
});

test("answer_validation: a partial answer maps to verdict partial (mid rating)", async () => {
  const grader = createAnswerValidationGrader({
    resolveJudge: CONFIGURED,
    generate: stubGenerate({
      text: '{"verdict":"partial","rating":5,"quotes":[],"reason":"Only part addressed."}',
      usage: USAGE,
    }),
  });
  const r = await grader.grade(
    ctx({ answer: "Revenue was up, but I could not find the exact Q1 figure." }),
  );
  assert.equal(r.status, "graded");
  const evidence = answerValidationEvidenceSchema.parse(r.evidence);
  assert.equal(evidence.verdict, "partial");
  assert.equal(evidence.score, 0.5);
});

// ── No final answer → unanswered, score null (NOT 0), unevaluable, no judge call ───────────────────

test("answer_validation: NO final answer → verdict unanswered, score null, unevaluable, generate NOT called", async () => {
  const { gen, called } = trackedThrowingGenerate();
  const grader = createAnswerValidationGrader({ resolveJudge: CONFIGURED, generate: gen });
  const r = await grader.grade(ctx({ answer: "" }));

  assert.equal(r.status, "unevaluable");
  assert.strictEqual(r.score, null, "no answer → score is null, NEVER 0");
  assert.equal(r.method, "answer_validation_no_answer");
  assert.equal(called(), false, "no judge call is made when there is no answer");
  const evidence = answerValidationEvidenceSchema.parse(r.evidence);
  assert.equal(evidence.verdict, "unanswered");
  assert.strictEqual(evidence.score, null);
  assert.deepEqual(evidence.citedSteps, []);
});

// ── Unconfigured / unpriced judge → unevaluable, no spend (never 0) ────────────────────────────────

test("answer_validation: unconfigured judge → unevaluable (score null), generate NOT called", async () => {
  const { gen, called } = trackedThrowingGenerate();
  const grader = createAnswerValidationGrader({ resolveJudge: UNCONFIGURED, generate: gen });
  const r = await grader.grade(ctx({ answer: "Q1 revenue was $4.2M" }));
  assert.equal(r.status, "unevaluable");
  assert.strictEqual(r.score, null);
  assert.equal(r.method, "judge_unconfigured");
  assert.equal(called(), false);
});

test("answer_validation: unpriced judge model → unevaluable, NO spend (generate NOT called)", async () => {
  const { gen, called } = trackedThrowingGenerate();
  const grader = createAnswerValidationGrader({ resolveJudge: UNPRICED, generate: gen });
  const r = await grader.grade(ctx({ answer: "Q1 revenue was $4.2M" }));
  assert.equal(r.status, "unevaluable");
  assert.strictEqual(r.score, null);
  assert.equal(r.method, "judge_unpriced");
  assert.equal(called(), false, "an unpriced judge model must not spend");
  assert.equal(r.judgeCostUsd ?? 0, 0, "no cost when the call is refused");
});

// ── Judge cost ledger (B5/AR13) populated from usage; never folded into run cost ──────────────────

test("answer_validation: the judge cost ledger is populated from usage via estimateCost", async () => {
  const grader = createAnswerValidationGrader({
    resolveJudge: CONFIGURED,
    generate: stubGenerate({
      text: '{"verdict":"answered","rating":8,"quotes":[],"reason":"ok"}',
      usage: USAGE,
    }),
  });
  const r = await grader.grade(ctx({ answer: "Q1 revenue was $4.2M" }));
  assert.equal(r.status, "graded");
  assert.equal(r.judgeProviderId, "prov-1");
  assert.equal(r.judgeModel, PRICED_MODEL);
  assert.equal(r.judgeTokensIn, USAGE.inputTokens);
  assert.equal(r.judgeTokensOut, USAGE.outputTokens);
  const expected = estimateCost(PRICED_MODEL, USAGE);
  assert.ok(expected > 0, "the priced judge model has a real cost");
  assert.ok(
    Math.abs((r.judgeCostUsd ?? 0) - expected) < 1e-12,
    "judge cost == estimateCost(model, usage)",
  );
});

// ── Unparseable judge response → error (never a silent 0) ──────────────────────────────────────────

test("answer_validation: an unparseable judge response → error, score null (never 0), cost still recorded", async () => {
  const grader = createAnswerValidationGrader({
    resolveJudge: CONFIGURED,
    generate: stubGenerate({ text: "I really cannot produce a JSON verdict here.", usage: USAGE }),
  });
  const r = await grader.grade(ctx({ answer: "Q1 revenue was $4.2M" }));
  assert.equal(r.status, "error");
  assert.strictEqual(r.score, null);
  assert.match(r.reasoning ?? "", /no parseable rating/);
  // The call still spent tokens → the cost is recorded honestly on the error row.
  assert.equal(r.judgeTokensIn, USAGE.inputTokens);
});

test("answer_validation: a throwing/timed-out provider call → error (never throws into the caller)", async () => {
  const grader = createAnswerValidationGrader({
    resolveJudge: CONFIGURED,
    generate: stubGenerate(async () => {
      throw new Error("provider exploded");
    }),
  });
  const r = await grader.grade(ctx({ answer: "Q1 revenue was $4.2M" }));
  assert.equal(r.status, "error");
  assert.match(r.reasoning ?? "", /provider exploded/);
});

// ── Long answer → truncation disclosed; evidence still validates ───────────────────────────────────

test("answer_validation: a very long answer is clipped and the clip is noted; evidence still validates", async () => {
  const long = `${"x".repeat(30_000)} the answer is $4.2M`;
  let seenPromptLen = 0;
  const grader = createAnswerValidationGrader({
    resolveJudge: CONFIGURED,
    generate: async (_s, prompt) => {
      seenPromptLen = prompt.length;
      return {
        text: '{"verdict":"answered","rating":8,"quotes":["$4.2M"],"reason":"ok"}',
        usage: USAGE,
      };
    },
  });
  const r = await grader.grade(ctx({ answer: long }));
  assert.equal(r.status, "graded");
  assert.ok(seenPromptLen < long.length, "the answer was clipped before being sent to the judge");
  assert.match(r.reasoning ?? "", /clipped to \d+ chars/, "truncation is stamped in the reasoning");
  answerValidationEvidenceSchema.parse(r.evidence); // still schema-valid
});

// ── Prompt shape (deterministic) ───────────────────────────────────────────────────────────────────

test("buildAnswerValidationPrompt: carries the question + answer + JSON contract, and the clip note", () => {
  const p = buildAnswerValidationPrompt({ question: "Q?", answer: "A.", truncated: true });
  assert.match(p, /## The user's question/);
  assert.match(p, /Q\?/);
  assert.match(p, /A\./);
  assert.match(p, /"verdict": "answered\|partial\|unanswered"/);
  assert.match(p, /clipped to fit/);
  const noClip = buildAnswerValidationPrompt({ question: "Q?", answer: "A.", truncated: false });
  assert.doesNotMatch(noClip, /clipped to fit/);
});
