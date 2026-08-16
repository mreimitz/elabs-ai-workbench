import assert from "node:assert/strict";
import { test } from "node:test";
import {
  insightSurplusEvidenceSchema,
  type JudgeSettings,
  type RunDetail,
  type RunStep,
  type Test,
} from "@mcp-token-footprint/shared";
import type { GradeContext } from "../src/grading/grader.js";
import {
  buildInsightSurplusPrompt,
  createInsightSurplusGrader,
  INSIGHT_SURPLUS_ID,
} from "../src/grading/insight-surplus.js";
import type { JudgeGenerate, JudgeGenerateResult } from "../src/grading/judge.js";
import { estimateCost } from "../src/providers/pricing.js";

const NOW = "2026-07-04T00:00:00.000Z";
const PRICED_MODEL = "claude-sonnet-4";
const UNPRICED_MODEL = "totally-made-up-model-zzz";
const USAGE = { inputTokens: 900, outputTokens: 60 };

const CONFIGURED: () => JudgeSettings = () => ({
  providerCredentialId: "prov-1",
  model: PRICED_MODEL,
});
const UNCONFIGURED: () => JudgeSettings | null = () => null;
const UNPRICED: () => JudgeSettings = () => ({
  providerCredentialId: "prov-1",
  model: UNPRICED_MODEL,
});

function stubGenerate(
  result: JudgeGenerateResult | (() => Promise<JudgeGenerateResult>),
): JudgeGenerate {
  return async () => (typeof result === "function" ? result() : result);
}

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

// ── Double-edged: valuable surplus RAISES the score; no surplusTokens ──────────────────────────────

test("insight_surplus: grounded valuable surplus → verdict valuable, score RAISED, no surplusTokens; schema validates", async () => {
  const grader = createInsightSurplusGrader({
    resolveJudge: CONFIGURED,
    generate: stubGenerate({
      text: '{"verdict":"valuable","rating":9,"quotes":["also note margins improved 3pts"],"reason":"A pertinent, grounded extra."}',
      usage: USAGE,
    }),
  });
  assert.equal(grader.id, INSIGHT_SURPLUS_ID);
  assert.equal(grader.kind, "llm");
  assert.equal(grader.mandatory, true);

  const steps = [llmStep(0, "Q1 revenue was $4.2M. Also note margins improved 3pts.")];
  const r = await grader.grade(
    ctx({ answer: "Q1 revenue was $4.2M. Also note margins improved 3pts.", steps }),
  );

  assert.equal(r.status, "graded");
  assert.equal(r.method, "insight_surplus_v1"); // AR15 version stamp
  assert.equal(r.score, 0.9);
  assert.ok(
    (r.score as number) > 0.5,
    "valuable surplus raises the score above the neutral baseline",
  );
  const evidence = insightSurplusEvidenceSchema.parse(r.evidence);
  assert.equal(evidence.verdict, "valuable");
  assert.equal(evidence.score, 0.9);
  assert.deepEqual(evidence.citedSteps, [0]);
  assert.equal(evidence.surplusTokens, undefined, "surplusTokens is named only for noise");
});

// ── Double-edged: padding/noise LOWERS the score and NAMES its token cost ──────────────────────────

test("insight_surplus: unrequested padding → verdict noise, score LOWERED, surplusTokens named; schema validates", async () => {
  const padding =
    "As a large language model, I am delighted to assist you today. Before we begin, it is worth noting that data can vary.";
  const grader = createInsightSurplusGrader({
    resolveJudge: CONFIGURED,
    generate: stubGenerate({
      text: JSON.stringify({
        verdict: "noise",
        rating: 2,
        quotes: [padding],
        reason: "Verbose unrequested preamble.",
      }),
      usage: USAGE,
    }),
  });
  const r = await grader.grade(ctx({ answer: `${padding} Q1 revenue was $4.2M.` }));

  assert.equal(r.status, "graded");
  assert.equal(r.score, 0.2);
  assert.ok((r.score as number) < 0.5, "padding pulls the score DOWN, never up (double-edged)");
  const evidence = insightSurplusEvidenceSchema.parse(r.evidence);
  assert.equal(evidence.verdict, "noise");
  assert.ok(typeof evidence.surplusTokens === "number", "the padding token cost is named on noise");
  assert.ok(Number.isInteger(evidence.surplusTokens), "surplusTokens is an integer");
  assert.ok((evidence.surplusTokens as number) > 0, "the named padding span has a real token cost");
});

test("insight_surplus: an on-ask answer with no surplus → verdict none, no surplusTokens", async () => {
  const grader = createInsightSurplusGrader({
    resolveJudge: CONFIGURED,
    generate: stubGenerate({
      text: '{"verdict":"none","rating":5,"quotes":[],"reason":"Stayed exactly on-ask."}',
      usage: USAGE,
    }),
  });
  const r = await grader.grade(ctx({ answer: "Q1 revenue was $4.2M." }));
  assert.equal(r.status, "graded");
  const evidence = insightSurplusEvidenceSchema.parse(r.evidence);
  assert.equal(evidence.verdict, "none");
  assert.equal(evidence.score, 0.5);
  assert.equal(evidence.surplusTokens, undefined);
});

// ── No final answer → none, score null (NOT 0), unevaluable, no judge call ─────────────────────────

test("insight_surplus: NO final answer → verdict none, score null, unevaluable, generate NOT called", async () => {
  const { gen, called } = trackedThrowingGenerate();
  const grader = createInsightSurplusGrader({ resolveJudge: CONFIGURED, generate: gen });
  const r = await grader.grade(ctx({ answer: "" }));
  assert.equal(r.status, "unevaluable");
  assert.strictEqual(r.score, null, "no answer → score is null, NEVER 0");
  assert.equal(r.method, "insight_surplus_no_answer");
  assert.equal(called(), false);
  const evidence = insightSurplusEvidenceSchema.parse(r.evidence);
  assert.equal(evidence.verdict, "none");
  assert.strictEqual(evidence.score, null);
});

// ── Unconfigured / unpriced judge → unevaluable, no spend ──────────────────────────────────────────

test("insight_surplus: unconfigured judge → unevaluable (score null), generate NOT called", async () => {
  const { gen, called } = trackedThrowingGenerate();
  const grader = createInsightSurplusGrader({ resolveJudge: UNCONFIGURED, generate: gen });
  const r = await grader.grade(ctx({ answer: "Q1 revenue was $4.2M" }));
  assert.equal(r.status, "unevaluable");
  assert.strictEqual(r.score, null);
  assert.equal(r.method, "judge_unconfigured");
  assert.equal(called(), false);
});

test("insight_surplus: unpriced judge model → unevaluable, NO spend (generate NOT called)", async () => {
  const { gen, called } = trackedThrowingGenerate();
  const grader = createInsightSurplusGrader({ resolveJudge: UNPRICED, generate: gen });
  const r = await grader.grade(ctx({ answer: "Q1 revenue was $4.2M" }));
  assert.equal(r.status, "unevaluable");
  assert.strictEqual(r.score, null);
  assert.equal(r.method, "judge_unpriced");
  assert.equal(called(), false);
  assert.equal(r.judgeCostUsd ?? 0, 0);
});

// ── Judge cost ledger (B5/AR13) populated from usage ──────────────────────────────────────────────

test("insight_surplus: the judge cost ledger is populated from usage via estimateCost", async () => {
  const grader = createInsightSurplusGrader({
    resolveJudge: CONFIGURED,
    generate: stubGenerate({
      text: '{"verdict":"none","rating":5,"quotes":[],"reason":"ok"}',
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
  assert.ok(expected > 0);
  assert.ok(
    Math.abs((r.judgeCostUsd ?? 0) - expected) < 1e-12,
    "judge cost == estimateCost(model, usage)",
  );
});

// ── Unparseable → error (never a silent 0) ─────────────────────────────────────────────────────────

test("insight_surplus: an unparseable judge response → error, score null (never 0)", async () => {
  const grader = createInsightSurplusGrader({
    resolveJudge: CONFIGURED,
    generate: stubGenerate({ text: "No JSON here at all.", usage: USAGE }),
  });
  const r = await grader.grade(ctx({ answer: "Q1 revenue was $4.2M" }));
  assert.equal(r.status, "error");
  assert.strictEqual(r.score, null);
  assert.match(r.reasoning ?? "", /no parseable rating/);
});

// ── Long answer → truncation disclosed; evidence still validates ───────────────────────────────────

test("insight_surplus: a very long answer is clipped and the clip is noted; evidence still validates", async () => {
  const long = `${"y".repeat(30_000)} plus one small tangent`;
  let seenPromptLen = 0;
  const grader = createInsightSurplusGrader({
    resolveJudge: CONFIGURED,
    generate: async (_s, prompt) => {
      seenPromptLen = prompt.length;
      return {
        text: '{"verdict":"noise","rating":3,"quotes":["plus one small tangent"],"reason":"padding"}',
        usage: USAGE,
      };
    },
  });
  const r = await grader.grade(ctx({ answer: long }));
  assert.equal(r.status, "graded");
  assert.ok(seenPromptLen < long.length, "the answer was clipped before being sent to the judge");
  assert.match(r.reasoning ?? "", /clipped to \d+ chars/);
  insightSurplusEvidenceSchema.parse(r.evidence);
});

// ── Prompt shape (deterministic, double-edged wording present) ────────────────────────────────────

test("buildInsightSurplusPrompt: carries the double-edged rubric + JSON contract", () => {
  const p = buildInsightSurplusPrompt({ question: "Q?", answer: "A.", truncated: false });
  assert.match(p, /BEYOND-ASK/);
  assert.match(p, /RAISES the score/);
  assert.match(p, /LOWERS the score/);
  assert.match(p, /"verdict": "valuable\|none\|noise"/);
});
