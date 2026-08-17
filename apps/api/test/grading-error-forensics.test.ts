import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type AssertionResult,
  type ErrorFinding,
  errorFindingSchema,
  type JudgeSettings,
  type RunDetail,
  type RunEvent,
  type RunStep,
  type Test,
} from "@mcp-token-footprint/shared";
import {
  createErrorForensicsGrader,
  DEFAULT_BUCKET_BY_CATEGORY,
  extractErrorInventory,
  forensicsHealthScore,
  METHOD_FORENSICS_CLASSIFIED,
  METHOD_FORENSICS_ERROR,
  METHOD_FORENSICS_INVENTORY_ONLY,
} from "../src/grading/error-forensics.js";
import type { GradeContext } from "../src/grading/grader.js";
import type { JudgeGenerate, JudgeGenerateResult } from "../src/grading/judge.js";
import { estimateCost } from "../src/providers/pricing.js";

const PRICED_MODEL = "claude-sonnet-4"; // in the pricing table → estimateCost > 0, isModelPriced true
const UNPRICED_MODEL = "totally-made-up-model-zzz"; // not priced anywhere → isModelPriced false
const USAGE = { inputTokens: 1200, outputTokens: 80 };

// ── Fixture builders ───────────────────────────────────────────────────────────────────────────────

function makeRun(fields: Partial<RunDetail>): RunDetail {
  return {
    id: "run-x",
    steps: [],
    events: [],
    skills: [],
    status: "error",
    ...fields,
  } as unknown as RunDetail;
}

function ctxFor(run: RunDetail): GradeContext {
  return { run, test: {} as Test, finalAssistantText: "" };
}

function toolErrorStep(index: number, toolName: string, serverId?: string): RunStep {
  return {
    id: `s${index}`,
    runId: "run-x",
    index,
    type: "tool_call",
    label: toolName,
    status: "error",
    toolName,
    ...(serverId ? { serverId } : {}),
    profileTokens: {},
    payload: null,
  };
}

function statusEvent(status: string, outcome?: string): RunEvent {
  return { type: "status", status, ...(outcome ? { outcome } : {}) } as unknown as RunEvent;
}

function errorEvent(message: string, serverIds?: string[]): RunEvent {
  return { type: "error", message, ...(serverIds ? { serverIds } : {}) } as unknown as RunEvent;
}

function failAssertion(reason: string, evidence?: number[]): AssertionResult {
  return {
    assertion: { kind: "noFractures" },
    status: "fail",
    reason,
    ...(evidence ? { evidence } : {}),
  };
}

const configured = (model: string = PRICED_MODEL): JudgeSettings => ({
  providerCredentialId: "prov-1",
  model,
});

/** A `generate` stub that records call count + the last prompt; returns fixed JSON (or a thunk). */
function spyGenerate(result: JudgeGenerateResult | ((prompt: string) => JudgeGenerateResult)): {
  generate: JudgeGenerate;
  calls: () => number;
} {
  let calls = 0;
  const generate: JudgeGenerate = async (_settings, prompt) => {
    calls += 1;
    return typeof result === "function" ? result(prompt) : result;
  };
  return { generate, calls: () => calls };
}

function findings(result: { evidence?: unknown }): ErrorFinding[] {
  return (result.evidence as ErrorFinding[]) ?? [];
}

/** Every finding a grader emits MUST validate against the shared `errorFindingSchema` (evidence cited). */
function assertAllSchemaValid(list: ErrorFinding[]): void {
  for (const finding of list) {
    const parsed = errorFindingSchema.safeParse(finding);
    assert.ok(
      parsed.success,
      `finding ${finding.id} must be schema-valid: ${JSON.stringify(finding)}`,
    );
  }
}

// ── (1) Deterministic inventory extraction ─────────────────────────────────────────────────────────

test("inventory: a failed tool call + a guardrail stop + a failed assertion → three categorized findings with cited evidence", () => {
  const run = makeRun({
    status: "stopped",
    outcome: "stopped_guardrail",
    steps: [toolErrorStep(3, "search", "srv-a")],
    events: [statusEvent("stopped", "stopped_guardrail")],
    assertionResults: [failAssertion("gate not entered", [2])],
  });

  const inventory = extractErrorInventory(run);
  const byCat = (c: string) => inventory.filter((f) => f.category === c);

  assert.equal(inventory.length, 3, "one finding per distinct signal");

  const tool = byCat("failed_tool_call");
  assert.equal(tool.length, 1);
  assert.deepEqual(
    tool[0]?.evidenceSteps,
    [3],
    "failed tool call cites the erroring RunStep.index",
  );

  const guardrail = byCat("guardrail_stop");
  assert.equal(guardrail.length, 1);
  assert.deepEqual(
    guardrail[0]?.evidenceEventIds,
    ["event:0"],
    "guardrail stop cites the terminal status event ordinal",
  );

  const asserted = byCat("assertions_failed");
  assert.equal(asserted.length, 1);
  assert.deepEqual(
    asserted[0]?.evidenceSteps,
    [2],
    "assertion finding reuses the assertion's cited trace evidence",
  );
});

test("inventory: error events split into error_event vs mcp_connection_failure (serverIds) with ordinal citations", () => {
  const run = makeRun({
    status: "error",
    outcome: "error",
    events: [errorEvent("plain boom"), errorEvent("connect refused", ["srv-a"])],
  });
  const inventory = extractErrorInventory(run);

  const plain = inventory.find((f) => f.category === "error_event");
  const conn = inventory.find((f) => f.category === "mcp_connection_failure");
  assert.ok(plain, "a server-less error event → error_event");
  assert.ok(conn, "an error event with serverIds → mcp_connection_failure");
  assert.deepEqual(plain?.evidenceEventIds, ["event:0"]);
  assert.deepEqual(conn?.evidenceEventIds, ["event:1"]);
  // No abnormal-termination catch-all duplicate, since discrete error events were captured.
  assert.equal(inventory.filter((f) => f.category === "error_event").length, 1);
});

test("inventory: a failed tool call is enriched with the sent arguments + exact error (structured evidence)", () => {
  // The args live on the `tool_call` step; the FAILURE is on the sibling `tool_result` step. The two
  // are paired by `toolCallId`. The finding must carry the tool, a JSON excerpt of the args actually
  // sent, and the exact error string — and fold the error into the description.
  const call: RunStep = {
    id: "s1",
    runId: "run-x",
    index: 1,
    type: "tool_call",
    label: "acme_get_app",
    status: "running",
    toolName: "acme_get_app",
    serverId: "srv-a",
    profileTokens: {},
    payload: { toolCallId: "call-1", args: { appId: "", fields: ["sales"] } },
  };
  const result: RunStep = {
    id: "s2",
    runId: "run-x",
    index: 2,
    type: "tool_result",
    label: "acme_get_app",
    status: "error",
    toolName: "acme_get_app",
    serverId: "srv-a",
    profileTokens: {},
    payload: { toolCallId: "call-1", error: "invalid arguments: 'appId' must be a non-empty string" },
  };
  const run = makeRun({ status: "error", outcome: "error", steps: [call, result] });

  const inventory = extractErrorInventory(run);
  const tool = inventory.find((f) => f.category === "failed_tool_call");
  assert.ok(tool, "the failed tool_result step produces a failed_tool_call finding");
  assert.equal(tool?.toolName, "acme_get_app");
  assert.equal(
    tool?.sentArguments,
    JSON.stringify({ appId: "", fields: ["sales"] }),
    "the sibling tool_call's args (by toolCallId) are the sent arguments",
  );
  assert.equal(tool?.errorMessage, "invalid arguments: 'appId' must be a non-empty string");
  assert.match(
    tool?.description ?? "",
    /invalid arguments: 'appId' must be a non-empty string/,
    "the exact error is folded into the description",
  );
});

test("inventory: an MCP { isError, content } result yields the error text; a call with no captured args omits sentArguments", () => {
  const result: RunStep = {
    id: "s1",
    runId: "run-x",
    index: 1,
    type: "tool_result",
    label: "search_docs",
    status: "error",
    toolName: "search_docs",
    profileTokens: {},
    payload: {
      toolCallId: "call-9",
      result: { isError: true, content: [{ type: "text", text: "rate limit exceeded" }] },
    },
  };
  const run = makeRun({ status: "error", outcome: "error", steps: [result] });

  const tool = extractErrorInventory(run).find((f) => f.category === "failed_tool_call");
  assert.equal(tool?.errorMessage, "rate limit exceeded", "text is pulled from the isError content");
  assert.equal(tool?.sentArguments, undefined, "no sibling tool_call → no sent arguments");
});

test("inventory: error events + failed assertions also carry the exact message as errorMessage", () => {
  const run = makeRun({
    status: "error",
    outcome: "error",
    events: [errorEvent("plain boom"), errorEvent("connect refused", ["srv-a"])],
    assertionResults: [failAssertion("gate not entered", [2])],
  });
  const inventory = extractErrorInventory(run);
  assert.equal(inventory.find((f) => f.category === "error_event")?.errorMessage, "plain boom");
  assert.equal(
    inventory.find((f) => f.category === "mcp_connection_failure")?.errorMessage,
    "connect refused",
  );
  assert.equal(
    inventory.find((f) => f.category === "assertions_failed")?.errorMessage,
    "gate not entered",
  );
});

test("inventory: a clean completed run yields no findings; health score is 1.0", () => {
  const run = makeRun({
    status: "completed",
    outcome: "completed",
    steps: [],
    events: [statusEvent("completed", "completed")],
  });
  const inventory = extractErrorInventory(run);
  assert.equal(inventory.length, 0);
  assert.equal(forensicsHealthScore(inventory), 1);
});

test("inventory: a user-STOPPED run (aborted) is NOT an error — no abnormal-termination finding, health 1.0", () => {
  // Stopping an interactive session is an INTENTIONAL termination, not a failure — it must not be
  // flagged as an error_event (the abnormal-termination catch-all only fires on `error`).
  const stopped = makeRun({
    status: "aborted",
    outcome: "aborted",
    stopReason: "Run aborted by user",
    steps: [],
    events: [statusEvent("aborted", "aborted")],
  });
  const inventory = extractErrorInventory(stopped);
  assert.equal(inventory.length, 0, "a deliberate stop produces no error findings");
  assert.equal(forensicsHealthScore(inventory), 1, "and stays operationally clean (1.0)");
});

test("inventory: a genuine `error` run with no discrete signal STILL gets the abnormal-termination catch-all", () => {
  const errored = makeRun({ status: "error", outcome: "error", steps: [], events: [] });
  const inventory = extractErrorInventory(errored);
  assert.equal(inventory.length, 1, "a real failure is never missed");
  assert.equal(inventory[0]?.category, "error_event");
});

test("health score: a terminal guardrail stop floors below a lone recoverable tool failure", () => {
  const guardrail = extractErrorInventory(
    makeRun({
      outcome: "stopped_guardrail",
      events: [statusEvent("stopped", "stopped_guardrail")],
    }),
  );
  const toolOnly = extractErrorInventory(
    makeRun({ status: "completed", outcome: "completed", steps: [toolErrorStep(0, "search")] }),
  );
  assert.equal(forensicsHealthScore(guardrail), 0, "guardrail stop penalty 1.0 → score 0");
  assert.equal(
    forensicsHealthScore(toolOnly),
    0.75,
    "one failed tool call penalty 0.25 → score 0.75",
  );
});

// ── (2) Grader — clean run (no judge call) ─────────────────────────────────────────────────────────

test("grader: clean run → graded, score 1.0, empty evidence, no judge call", async () => {
  const spy = spyGenerate({ text: "[]", usage: USAGE });
  const grader = createErrorForensicsGrader({
    resolveJudge: () => configured(),
    generate: spy.generate,
  });

  const result = await grader.grade(ctxFor(makeRun({ status: "completed", outcome: "completed" })));

  assert.equal(result.status, "graded");
  assert.equal(result.score, 1);
  assert.deepEqual(findings(result), []);
  assert.equal(result.method, METHOD_FORENSICS_INVENTORY_ONLY);
  assert.equal(spy.calls(), 0, "a clean run never calls the judge (no cost)");
  assert.ok(!result.judgeCostUsd, "no judge ledger on a clean run");
});

// ── (3) Grader — LLM classification ────────────────────────────────────────────────────────────────

test("grader: with a priced judge, findings are classified (bucket/fixTarget/draftFix) + schema-validated + cost metered", async () => {
  const run = makeRun({
    status: "completed",
    outcome: "completed",
    steps: [toolErrorStep(2, "search", "srv-a")],
  });
  const inventory = extractErrorInventory(run);
  assert.equal(inventory.length, 1);
  const id = inventory[0]?.id as string;

  const judgeJson = JSON.stringify([
    {
      id,
      bucket: "skill",
      fixTarget: "skill",
      draftFix: "add to SKILL.md: always pass `fields=…` to `search`",
    },
  ]);
  const spy = spyGenerate({ text: `\`\`\`json\n${judgeJson}\n\`\`\``, usage: USAGE });
  const grader = createErrorForensicsGrader({
    resolveJudge: () => configured(),
    generate: spy.generate,
  });

  const result = await grader.grade(ctxFor(run));
  const list = findings(result);

  assert.equal(result.status, "graded");
  assert.equal(result.method, METHOD_FORENSICS_CLASSIFIED);
  assert.equal(spy.calls(), 1, "exactly one classification call");
  assert.equal(list.length, 1);
  assert.equal(
    list[0]?.category,
    "failed_tool_call",
    "category stays the grader's (not the model's)",
  );
  assert.equal(list[0]?.bucket, "skill");
  assert.equal(list[0]?.fixTarget, "skill");
  assert.match(list[0]?.draftFix ?? "", /always pass/);
  assert.deepEqual(list[0]?.evidenceSteps, [2], "evidence stays the grader's trusted citation");
  assertAllSchemaValid(list);

  // Cost ledger (B5/AR13) — populated from the judge usage, in the SEPARATE judge ledger.
  assert.equal(result.judgeProviderId, "prov-1");
  assert.equal(result.judgeModel, PRICED_MODEL);
  assert.equal(result.judgeTokensIn, USAGE.inputTokens);
  assert.equal(result.judgeTokensOut, USAGE.outputTokens);
  assert.equal(result.judgeCostUsd, estimateCost(PRICED_MODEL, USAGE));
  assert.ok((result.judgeCostUsd ?? 0) > 0, "a priced classification call carries a real cost");
});

test("grader: the classification prompt carries the sent args + exact error, and classified findings keep them", async () => {
  const call: RunStep = {
    id: "s1",
    runId: "run-x",
    index: 1,
    type: "tool_call",
    label: "search",
    status: "running",
    toolName: "search",
    serverId: "srv-a",
    profileTokens: {},
    payload: { toolCallId: "c1", args: { limit: "ten" } },
  };
  const result: RunStep = {
    id: "s2",
    runId: "run-x",
    index: 2,
    type: "tool_result",
    label: "search",
    status: "error",
    toolName: "search",
    serverId: "srv-a",
    profileTokens: {},
    payload: { toolCallId: "c1", error: "limit must be an integer" },
  };
  const run = makeRun({ status: "error", outcome: "error", steps: [call, result] });
  const id = extractErrorInventory(run)[0]?.id as string;

  let seenPrompt = "";
  const generate: JudgeGenerate = async (_s, prompt) => {
    seenPrompt = prompt;
    return {
      text: JSON.stringify([{ id, bucket: "mcp_server", fixTarget: "mcp_server", draftFix: "fix" }]),
      usage: USAGE,
    };
  };
  const grader = createErrorForensicsGrader({ resolveJudge: () => configured(), generate });
  const list = findings(await grader.grade(ctxFor(run)));

  assert.match(seenPrompt, /arguments sent: .*limit.*ten/, "the prompt names the wrong argument sent");
  assert.match(seenPrompt, /exact error: limit must be an integer/, "the prompt names the exact error");
  // The structured evidence is grader-owned — it survives classification unchanged.
  assert.equal(list[0]?.toolName, "search");
  assert.equal(list[0]?.sentArguments, JSON.stringify({ limit: "ten" }));
  assert.equal(list[0]?.errorMessage, "limit must be an integer");
});

test("grader: a malformed judge classification is repaired to the deterministic default, never trusted", async () => {
  const run = makeRun({
    status: "completed",
    outcome: "completed",
    steps: [toolErrorStep(1, "fetch", "srv-b")],
  });
  const id = extractErrorInventory(run)[0]?.id as string;

  // Invalid bucket enum + invalid fixTarget + empty draftFix → all coerced to safe defaults.
  const judgeJson = JSON.stringify([
    { id, bucket: "nonsense_bucket", fixTarget: "whatever", draftFix: "   " },
  ]);
  const spy = spyGenerate({ text: judgeJson, usage: USAGE });
  const grader = createErrorForensicsGrader({
    resolveJudge: () => configured(),
    generate: spy.generate,
  });

  const list = findings(await grader.grade(ctxFor(run)));
  assert.equal(list.length, 1);
  assert.equal(
    list[0]?.bucket,
    DEFAULT_BUCKET_BY_CATEGORY.failed_tool_call,
    "garbage bucket → deterministic default",
  );
  assert.equal(list[0]?.fixTarget, "none", "garbage fixTarget → none");
  assert.match(
    list[0]?.draftFix ?? "",
    /No automated fix drafted/,
    "empty draftFix → generic default",
  );
  assertAllSchemaValid(list);
});

test("grader: a judge omitting a finding's id leaves that finding on its deterministic default", async () => {
  const run = makeRun({
    status: "completed",
    outcome: "completed",
    steps: [toolErrorStep(0, "search", "srv-a")],
  });
  const spy = spyGenerate({
    text: JSON.stringify([
      { id: "does-not-exist", bucket: "skill", fixTarget: "skill", draftFix: "x" },
    ]),
    usage: USAGE,
  });
  const grader = createErrorForensicsGrader({
    resolveJudge: () => configured(),
    generate: spy.generate,
  });

  const list = findings(await grader.grade(ctxFor(run)));
  assert.equal(list.length, 1);
  assert.equal(list[0]?.bucket, DEFAULT_BUCKET_BY_CATEGORY.failed_tool_call);
  assert.equal(list[0]?.fixTarget, "none");
  assertAllSchemaValid(list);
});

// ── (4) Grader — inventory-only degradation paths ──────────────────────────────────────────────────

test("grader: no judge configured → inventory-only findings with deterministic defaults, no judge call", async () => {
  const run = makeRun({
    status: "error",
    outcome: "error",
    steps: [toolErrorStep(0, "search", "srv-a")],
    events: [errorEvent("boom")],
  });
  const spy = spyGenerate({ text: "[]", usage: USAGE });
  const grader = createErrorForensicsGrader({ resolveJudge: () => null, generate: spy.generate });

  const result = await grader.grade(ctxFor(run));
  const list = findings(result);

  assert.equal(result.status, "graded");
  assert.equal(result.method, METHOD_FORENSICS_INVENTORY_ONLY);
  assert.equal(spy.calls(), 0, "no judge configured → no provider call");
  assert.ok(!result.judgeCostUsd, "no judge cost on the inventory-only path");
  assert.ok(list.length >= 2, "the inventory (failed tool call + error event) is still produced");
  for (const f of list)
    assert.equal(f.fixTarget, "none", "inventory-only findings default fixTarget to none");
  assertAllSchemaValid(list);
});

test("grader: an unpriced judge model → no spend, inventory-only fallback", async () => {
  const run = makeRun({
    status: "error",
    outcome: "error",
    steps: [toolErrorStep(0, "search", "srv-a")],
  });
  const spy = spyGenerate({ text: "[]", usage: USAGE });
  const grader = createErrorForensicsGrader({
    resolveJudge: () => configured(UNPRICED_MODEL),
    generate: spy.generate,
  });

  const result = await grader.grade(ctxFor(run));
  assert.equal(result.status, "graded");
  assert.equal(result.method, METHOD_FORENSICS_INVENTORY_ONLY);
  assert.equal(spy.calls(), 0, "an unpriced model is never called (spend would be uncapped)");
  assert.ok(!result.judgeCostUsd);
  assert.ok(findings(result).length >= 1, "findings are still produced");
});

test("grader: a judge call that throws falls back to inventory-only (findings preserved, never throws)", async () => {
  const run = makeRun({
    status: "error",
    outcome: "error",
    steps: [toolErrorStep(0, "search", "srv-a")],
  });
  const generate: JudgeGenerate = async () => {
    throw new Error("provider exploded");
  };
  const grader = createErrorForensicsGrader({ resolveJudge: () => configured(), generate });

  const result = await grader.grade(ctxFor(run));
  assert.equal(
    result.status,
    "graded",
    "a failed judge call is NOT an error verdict — the inventory still stands",
  );
  assert.equal(result.method, METHOD_FORENSICS_INVENTORY_ONLY);
  assert.ok(!result.judgeCostUsd, "a thrown call has no usage → no cost");
  assert.ok(findings(result).length >= 1);
});

// ── (5) Grader — never throws; error verdict is null-scored (never a silent 0) ─────────────────────

test("grader: a defensive internal failure yields an error verdict with a null score (never 0)", async () => {
  const run = makeRun({ status: "error", outcome: "error", steps: [toolErrorStep(0, "search")] });
  const generate: JudgeGenerate = async () => ({ text: "[]", usage: USAGE });
  const grader = createErrorForensicsGrader({
    resolveJudge: () => {
      throw new Error("resolver blew up");
    },
    generate,
  });

  const result = await grader.grade(ctxFor(run));
  assert.equal(result.status, "error");
  assert.strictEqual(result.score, null, "an error carries a null score, never a silent 0");
  assert.equal(result.method, METHOD_FORENSICS_ERROR);
});

test("grader: identity — id error_forensics, kind llm, mandatory true", () => {
  const grader = createErrorForensicsGrader({
    resolveJudge: () => null,
    generate: async () => ({ text: "[]", usage: USAGE }),
  });
  assert.equal(grader.id, "error_forensics");
  assert.equal(grader.kind, "llm");
  assert.equal(grader.mandatory, true);
});
