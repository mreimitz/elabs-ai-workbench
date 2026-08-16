import assert from "node:assert/strict";
import { test } from "node:test";
import type { AnswersStepPayload, RunStep } from "@mcp-token-footprint/shared";
import { deriveLegacyAnswerStep } from "../src/testing/qlik-answers-message.js";

// WP 5.2 (Phase 5 — answer rendering, D-QA8): the READ-TIME projection `GET /api/runs/:id` applies to a
// LEGACY qlik_answers answer step (rawResponse captured, but no blocks/reasoningSections). It derives
// the rendering fields from the ALREADY-PERSISTED payload without rewriting the stored row. Non-answer /
// non-qlik / already-derived steps pass through unchanged. Pure, no network.

const ANSWER = "American Airlines ranks last in punctuality; a multi-vendor strategy is recommended.";

/** A persisted LEGACY answer step exactly as the pre-Phase-5 executor wrote it: rawResponse + reasoning,
 *  snapshots WITHOUT `data`, and NO blocks / reasoningSections. */
function legacyStep(): RunStep {
  const payload: AnswersStepPayload = {
    sources: [],
    appId: "app-1",
    threadId: "thread-1",
    messageId: "msg-1",
    promptMode: "oneshot",
    estimatedTokens: true,
    questionsConsumed: 1,
    reasoning:
      "1. **Understanding**: Evaluate AA as a partner.\n\n## Draft\n\nAmerican Airlines ranks last in punctuality; a multi-vendor strategy is recommended.",
    // The legacy capture: snapshots without the hypercube `data`.
    snapshots: [{ title: "AA Market Share %", measures: [{ expression: "[Flights]", label: "AA Market Share %" }] }],
    rawResponse: {
      content: [
        {
          card: {
            body: [
              { type: "TextBlock", text: "Conclusion" },
              {
                type: "TextBlock",
                text: 'AA ranks last in punctuality.<citation data-index="0">1</citation>',
              },
              {
                type: "Qlik.Snapshot",
                source: { measures: [{ expression: "[Flights]", label: "AA Market Share %" }] },
                snapshot: {
                  data: {
                    qHyperCube: {
                      qSize: { qcx: 1, qcy: 1 },
                      qDimensionInfo: [],
                      qMeasureInfo: [{ qFallbackTitle: "AA Market Share %" }],
                      qDataPages: [{ qMatrix: [[{ qNum: 13.49, qText: "13.49" }]] }],
                    },
                  },
                },
              },
            ],
          },
        },
      ],
    },
  };
  return {
    id: "run:step:1",
    runId: "run",
    index: 1,
    type: "llm_response",
    label: "answer",
    status: "ok",
    profileTokens: {},
    assistantText: ANSWER,
    reasoningText: payload.reasoning,
    turnIndex: 0,
    payload,
  };
}

test("deriveLegacyAnswerStep: derives blocks + snapshot data + reasoningSections for a legacy step (D-QA8)", () => {
  const derived = deriveLegacyAnswerStep(legacyStep());
  const payload = derived.payload as AnswersStepPayload;

  // Ordered blocks with the citation index.
  assert.deepEqual(payload.blocks, [
    { kind: "text", markdown: "AA ranks last in punctuality.", citations: [0] },
    { kind: "snapshot", index: 0 },
  ]);
  // Snapshots re-derived WITH hypercube data.
  assert.deepEqual(payload.snapshots?.[0]?.data, {
    columns: ["AA Market Share %"],
    rows: [[13.49]],
  });
  // Reasoning structured into sections (understanding + a draft).
  assert.deepEqual(
    payload.reasoningSections?.map((s) => s.kind),
    ["understanding", "draft"],
  );
});

test("deriveLegacyAnswerStep: NEVER touches assistantText / reasoning (grader invariant)", () => {
  const original = legacyStep();
  const originalReasoning = (original.payload as AnswersStepPayload).reasoning;
  const derived = deriveLegacyAnswerStep(original);
  assert.equal(derived.assistantText, ANSWER);
  assert.equal(derived.reasoningText, originalReasoning);
  assert.equal((derived.payload as AnswersStepPayload).reasoning, originalReasoning);
});

test("deriveLegacyAnswerStep: a step already carrying blocks is returned UNCHANGED (no double derivation)", () => {
  const step = legacyStep();
  (step.payload as AnswersStepPayload).blocks = [{ kind: "text", markdown: "already there" }];
  const derived = deriveLegacyAnswerStep(step);
  assert.equal(derived, step); // identity — no new object
});

test("deriveLegacyAnswerStep: a non-answer step and a step without rawResponse pass through unchanged", () => {
  const toolStep: RunStep = {
    id: "run:step:0",
    runId: "run",
    index: 0,
    type: "tool_call",
    label: "search",
    status: "ok",
    profileTokens: {},
    payload: { args: { q: "x" } },
  };
  assert.equal(deriveLegacyAnswerStep(toolStep), toolStep);

  const noRaw: RunStep = { ...legacyStep(), payload: { promptMode: "oneshot", questionsConsumed: 1 } };
  assert.equal(deriveLegacyAnswerStep(noRaw), noRaw);
});
