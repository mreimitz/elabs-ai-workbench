import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CLAUDE_CLI_PROVIDER_ID,
  type JudgeSettings,
  type RunDetail,
  type RunStep,
  type Test,
} from "@mcp-token-footprint/shared";
import {
  ANSWER_VALIDATION_ID,
  createAnswerValidationGrader,
} from "../src/grading/answer-validation.js";
import { ClaudeCliJudgeError } from "../src/grading/claude-cli-judge.js";
import type { GradeContext } from "../src/grading/grader.js";
import {
  chainJudgeResolver,
  createJudgeChainGenerate,
  type JudgeChainDeps,
  resolveJudgeSource,
} from "../src/grading/judge-chain.js";
import {
  createOutcomeJudge,
  type JudgeGenerate,
  type JudgeGenerateResult,
} from "../src/grading/judge.js";
import { OUTCOME_JUDGE_ID } from "../src/grading/judge.js";
import { estimateCost } from "../src/providers/pricing.js";

// Auto-Rating (WP 2.3) — the ONE judge resolution chain (Claude CLI → provider → none) shared by ALL
// FIVE LLM graders. Every judge call is a FAKE `generate` (fake CLI + fake provider) + a fake
// `cliAvailable` boolean — NO SDK, NO child, NO Anthropic/provider network. Live CLI/provider behaviour
// is OWNER-ACCEPTANCE — never faked or asserted here.

const CLI_MODEL = "claude-sonnet-4-5"; // priced Claude model
const PROVIDER_PRICED = "claude-sonnet-4"; // priced provider model (isModelPriced true, cost > 0)
const PROVIDER_UNPRICED = "totally-made-up-model-zzz";
const CLI_USAGE = { inputTokens: 100, outputTokens: 20 };
const PROVIDER_USAGE = { inputTokens: 300, outputTokens: 40 };
const PROVIDER: JudgeSettings = { providerCredentialId: "prov-1", model: PROVIDER_PRICED };

function freshSignal(): AbortSignal {
  return new AbortController().signal;
}

/** A fake CLI `generate` that returns a fixed result (records calls) or throws a ClaudeCliJudgeError. */
function fakeCli(result: JudgeGenerateResult | ClaudeCliJudgeError): {
  gen: JudgeGenerate;
  calls: () => number;
} {
  let calls = 0;
  const gen: JudgeGenerate = async () => {
    calls += 1;
    if (result instanceof ClaudeCliJudgeError) throw result;
    return result;
  };
  return { gen, calls: () => calls };
}

/** A fake provider `generate` that returns a fixed result (records calls). */
function fakeProvider(result: JudgeGenerateResult): { gen: JudgeGenerate; calls: () => number } {
  let calls = 0;
  const gen: JudgeGenerate = async () => {
    calls += 1;
    return result;
  };
  return { gen, calls: () => calls };
}

function chainDeps(over: Partial<JudgeChainDeps> = {}): JudgeChainDeps {
  return {
    cliGenerate: fakeCli({ text: "<rating>8</rating>", usage: CLI_USAGE }).gen,
    providerGenerate: fakeProvider({ text: "<rating>6</rating>", usage: PROVIDER_USAGE }).gen,
    cliAvailable: () => true,
    resolveCliModel: () => CLI_MODEL,
    resolveProviderJudge: () => PROVIDER,
    ...over,
  };
}

// ── The widened resolver (`chainJudgeResolver`) ──────────────────────────────────────────────────────

test("chainJudgeResolver: CLI available → the CLI-sentinel settings (regardless of a configured provider)", () => {
  const resolve = chainJudgeResolver({
    cliAvailable: () => true,
    resolveCliModel: () => CLI_MODEL,
    resolveProviderJudge: () => PROVIDER,
  });
  assert.deepEqual(resolve(), { providerCredentialId: CLAUDE_CLI_PROVIDER_ID, model: CLI_MODEL });
});

test("chainJudgeResolver: no CLI but a provider configured → the provider settings", () => {
  const resolve = chainJudgeResolver({
    cliAvailable: () => false,
    resolveCliModel: () => CLI_MODEL,
    resolveProviderJudge: () => PROVIDER,
  });
  assert.deepEqual(resolve(), PROVIDER);
});

test("chainJudgeResolver: neither CLI nor provider → null (a judge is unavailable)", () => {
  const resolve = chainJudgeResolver({
    cliAvailable: () => false,
    resolveCliModel: () => CLI_MODEL,
    resolveProviderJudge: () => null,
  });
  assert.equal(resolve(), null);
});

// ── The resolved source (`resolveJudgeSource`, for the Settings surface) ──────────────────────────────

test("resolveJudgeSource: CLI → claude_cli; provider-only → provider; neither → none", () => {
  assert.equal(
    resolveJudgeSource({ cliAvailable: () => true, resolveProviderJudge: () => PROVIDER }),
    "claude_cli",
  );
  assert.equal(
    resolveJudgeSource({ cliAvailable: () => false, resolveProviderJudge: () => PROVIDER }),
    "provider",
  );
  assert.equal(
    resolveJudgeSource({ cliAvailable: () => false, resolveProviderJudge: () => null }),
    "none",
  );
});

// ── The chain generate — provenance is CORRECT on every path ──────────────────────────────────────────

test("chain generate: subscription signed in → CLI used; provenance claude_cli, cost 0, real tokens", async () => {
  const cli = fakeCli({ text: "<rating>8</rating>", usage: CLI_USAGE });
  const provider = fakeProvider({ text: "x", usage: PROVIDER_USAGE });
  const generate = createJudgeChainGenerate(
    chainDeps({ cliGenerate: cli.gen, providerGenerate: provider.gen }),
  );

  const res = await generate(PROVIDER, "P", { system: "S", signal: freshSignal() });

  assert.equal(res.text, "<rating>8</rating>");
  assert.equal(res.judgeProviderId, CLAUDE_CLI_PROVIDER_ID);
  assert.equal(res.judgeModel, CLI_MODEL);
  assert.equal(res.judgeCostUsd, 0, "CLI runs on the subscription → cost 0 (AR13)");
  assert.deepEqual(res.usage, CLI_USAGE, "usage tokens are REAL");
  assert.equal(cli.calls(), 1);
  assert.equal(provider.calls(), 0, "the provider is never called when the CLI succeeds");
});

for (const kind of ["rate_limit", "auth", "timeout", "driver"] as const) {
  test(`chain generate: CLI ${kind} error + provider configured → falls through; provenance = the PROVIDER`, async () => {
    const cli = fakeCli(new ClaudeCliJudgeError(kind, `cli ${kind}`));
    const provider = fakeProvider({ text: "<rating>6</rating>", usage: PROVIDER_USAGE });
    const generate = createJudgeChainGenerate(
      chainDeps({ cliGenerate: cli.gen, providerGenerate: provider.gen }),
    );

    const res = await generate(PROVIDER, "P", { system: "S", signal: freshSignal() });

    assert.equal(res.text, "<rating>6</rating>");
    assert.equal(
      res.judgeProviderId,
      PROVIDER.providerCredentialId,
      "provenance is the ACTUAL source used",
    );
    assert.equal(res.judgeModel, PROVIDER_PRICED);
    const expected = estimateCost(PROVIDER_PRICED, PROVIDER_USAGE);
    assert.ok(
      expected > 0 && Math.abs((res.judgeCostUsd ?? -1) - expected) < 1e-12,
      "provider row → estimated cost",
    );
    assert.equal(cli.calls(), 1);
    assert.equal(provider.calls(), 1);
  });
}

test("chain generate: CLI rate_limit error but NO provider configured → surfaces (throws) for the grader's catch", async () => {
  const cli = fakeCli(new ClaudeCliJudgeError("rate_limit", "cli limited"));
  const generate = createJudgeChainGenerate(
    chainDeps({ cliGenerate: cli.gen, resolveProviderJudge: () => null }),
  );
  await assert.rejects(() => generate(PROVIDER, "P", { system: "S", signal: freshSignal() }));
});

test("chain generate: no subscription, provider configured → provider used (today's path unchanged)", async () => {
  const cli = fakeCli({ text: "should not run", usage: CLI_USAGE });
  const provider = fakeProvider({ text: "<rating>6</rating>", usage: PROVIDER_USAGE });
  const generate = createJudgeChainGenerate(
    chainDeps({ cliAvailable: () => false, cliGenerate: cli.gen, providerGenerate: provider.gen }),
  );
  const res = await generate(PROVIDER, "P", { system: "S", signal: freshSignal() });
  assert.equal(res.judgeProviderId, PROVIDER.providerCredentialId);
  assert.equal(cli.calls(), 0, "the CLI is not tried without a subscription");
  assert.equal(provider.calls(), 1);
});

test("chain generate: fall-through to an UNPRICED provider model is refused (no uncapped spend)", async () => {
  const provider = fakeProvider({ text: "<rating>6</rating>", usage: PROVIDER_USAGE });
  const generate = createJudgeChainGenerate(
    chainDeps({
      cliGenerate: fakeCli(new ClaudeCliJudgeError("rate_limit", "x")).gen,
      providerGenerate: provider.gen,
      resolveProviderJudge: () => ({ providerCredentialId: "prov-1", model: PROVIDER_UNPRICED }),
    }),
  );
  await assert.rejects(
    () => generate(PROVIDER, "P", { system: "S", signal: freshSignal() }),
    /no known pricing/,
  );
  assert.equal(provider.calls(), 0, "an unpriced provider model must not spend");
});

// ── The resolution is SHARED — a base grader AND outcome_judge both route through the chain ───────────

function outcomeCtx(): GradeContext {
  const test: Test = {
    id: "t1",
    name: "T",
    userPrompt: "What was Q1 revenue?",
    addedProfiles: [],
    attachments: [],
    tags: [],
    expectations: { expectedInsight: "Q1 revenue was $4.2M" },
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z",
  };
  return { run: { steps: [] } as RunDetail, test, finalAssistantText: "Q1 revenue was $4.2M" };
}

function answerStep(index: number, text: string): RunStep {
  return {
    id: `s${index}`,
    runId: "r1",
    index,
    type: "llm_response",
    label: "answer",
    status: "ok",
    profileTokens: {},
    assistantText: text,
    payload: null,
  };
}

function answerCtx(): GradeContext {
  const answer = "Q1 revenue was $4.2M";
  const test: Test = {
    id: "t1",
    name: "T",
    userPrompt: "What was Q1 revenue?",
    addedProfiles: [],
    attachments: [],
    tags: [],
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z",
  };
  return { run: { steps: [answerStep(0, answer)] } as RunDetail, test, finalAssistantText: answer };
}

test("shared resolution: subscription signed in → BOTH outcome_judge and answer_validation route through the CLI (provenance claude_cli, cost 0)", async () => {
  const deps = chainDeps({
    cliGenerate: fakeCli({
      text: '{"verdict":"answered","rating":8,"quotes":["Q1 revenue was $4.2M"],"reason":"ok"}',
      usage: CLI_USAGE,
    }).gen,
  });
  const generate = createJudgeChainGenerate(deps);
  const resolveJudge = chainJudgeResolver(deps);

  const outcome = createOutcomeJudge({ resolveJudge, generate });
  const answer = createAnswerValidationGrader({ resolveJudge, generate });
  assert.equal(outcome.id, OUTCOME_JUDGE_ID);
  assert.equal(answer.id, ANSWER_VALIDATION_ID);

  const outcomeGrade = await outcome.grade(outcomeCtx());
  assert.equal(outcomeGrade.status, "graded");
  assert.equal(outcomeGrade.judgeProviderId, CLAUDE_CLI_PROVIDER_ID);
  assert.equal(outcomeGrade.judgeModel, CLI_MODEL);
  assert.equal(outcomeGrade.judgeCostUsd, 0);
  assert.equal(outcomeGrade.judgeTokensIn, CLI_USAGE.inputTokens);

  const answerGrade = await answer.grade(answerCtx());
  assert.equal(answerGrade.status, "graded");
  assert.equal(
    answerGrade.judgeProviderId,
    CLAUDE_CLI_PROVIDER_ID,
    "the base grader ALSO used the CLI",
  );
  assert.equal(answerGrade.judgeModel, CLI_MODEL);
  assert.equal(answerGrade.judgeCostUsd, 0);
  assert.equal(answerGrade.judgeTokensOut, CLI_USAGE.outputTokens);
});

test("shared resolution: CLI rate_limit → both graders fall through to the provider; grade rows read the PROVIDER (not claude_cli)", async () => {
  const deps = chainDeps({
    cliGenerate: fakeCli(new ClaudeCliJudgeError("rate_limit", "limited")).gen,
    providerGenerate: fakeProvider({
      text: '{"verdict":"answered","rating":7,"quotes":[],"reason":"ok"}',
      usage: PROVIDER_USAGE,
    }).gen,
  });
  const generate = createJudgeChainGenerate(deps);
  const resolveJudge = chainJudgeResolver(deps);
  const expected = estimateCost(PROVIDER_PRICED, PROVIDER_USAGE);

  const answerGrade = await createAnswerValidationGrader({ resolveJudge, generate }).grade(
    answerCtx(),
  );
  assert.equal(answerGrade.status, "graded");
  assert.equal(
    answerGrade.judgeProviderId,
    PROVIDER.providerCredentialId,
    "provenance reflects the ACTUAL source on fall-through",
  );
  assert.equal(answerGrade.judgeModel, PROVIDER_PRICED);
  assert.ok(Math.abs((answerGrade.judgeCostUsd ?? -1) - expected) < 1e-12);
});

test("shared resolution: base grader runs the CLI even with NO provider configured (unpriced-provider guard does NOT block the CLI)", async () => {
  const deps = chainDeps({
    cliGenerate: fakeCli({
      text: '{"verdict":"answered","rating":9,"quotes":[],"reason":"ok"}',
      usage: CLI_USAGE,
    }).gen,
    resolveProviderJudge: () => null, // no provider at all
  });
  const grade = await createAnswerValidationGrader({
    resolveJudge: chainJudgeResolver(deps),
    generate: createJudgeChainGenerate(deps),
  }).grade(answerCtx());
  assert.equal(grade.status, "graded");
  assert.equal(grade.judgeProviderId, CLAUDE_CLI_PROVIDER_ID);
  assert.equal(grade.judgeCostUsd, 0);
});

test("shared resolution: neither CLI nor provider → graders emit unevaluable (never a fake score)", async () => {
  const deps = chainDeps({ cliAvailable: () => false, resolveProviderJudge: () => null });
  const resolveJudge = chainJudgeResolver(deps);
  const generate = createJudgeChainGenerate(deps);

  const outcomeGrade = await createOutcomeJudge({ resolveJudge, generate }).grade(outcomeCtx());
  assert.equal(outcomeGrade.status, "unevaluable");
  assert.strictEqual(outcomeGrade.score, null);

  const answerGrade = await createAnswerValidationGrader({ resolveJudge, generate }).grade(
    answerCtx(),
  );
  assert.equal(answerGrade.status, "unevaluable");
  assert.strictEqual(answerGrade.score, null);
});
