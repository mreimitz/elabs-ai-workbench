import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  AnswersStepPayload,
  RunDetail,
  RunStep,
  Scenario,
  Test as TestConfig,
} from "@mcp-token-footprint/shared";
import { createRunJsonReport, createRunMarkdownReport } from "../src/reports/reports.js";
import { deriveLegacyAnswerStep } from "../src/testing/qlik-answers-message.js";

// Qlik Answers Phase 5 (WP 5.6 — report parity): the run report (JSON + Markdown) must carry the
// derived answer-rendering fields (`blocks`, snapshot `data`, citations) for a `qlik_answers` run, both
// for a LIVE/post-5.2 run (payload already carries `blocks`) and for a LEGACY run (payload carries only
// `rawResponse` — the report route reuses `deriveLegacyAnswerStep`, the SAME projection `GET
// /api/runs/:id` applies, `apps/api/src/reports/routes.ts`'s `withDerivedAnswerSteps`). A non-qlik
// `llm_response` step (no `blocks`) must render byte-identically to before this WP — covered by the
// existing `run-report.test.ts` suite (still green) plus one explicit guard below.

const NOW = "2026-07-12T00:00:00.000Z";

function fixtureTest(): TestConfig {
  return {
    id: "test-qa",
    name: "Qlik Answers question",
    userPrompt: "How does American Airlines compare to its peers?",
    addedProfiles: [],
    attachments: [],
    createdAt: NOW,
    updatedAt: NOW,
  } as TestConfig;
}

function fixtureScenario(): Scenario {
  return {
    id: "scn-qa",
    name: "Qlik Answers scenario",
    providerId: "prov-qa",
    model: "qlik-answers-assistant-1",
    params: {},
    systemPrompt: "",
    allowedServers: [],
    defaultProfiles: [],
    guardrails: {},
    createdAt: NOW,
    updatedAt: NOW,
  } as Scenario;
}

function fixtureRun(step: RunStep): RunDetail {
  return {
    id: "run-qa",
    testId: "test-qa",
    scenarioId: "scn-qa",
    mode: "automated",
    status: "completed",
    outcome: "completed",
    startedAt: NOW,
    durationMs: 1000,
    turns: 1,
    toolCalls: 0,
    peakContextTokens: 0,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    steps: [step],
    events: [],
  } as unknown as RunDetail;
}

/** A LIVE/post-5.2 answer step — the payload already carries the ordered `blocks[]` sequence and two
 *  snapshots: a 1×1 KPI (index 0) and a capped multi-row/-column table (index 1, `totalRows` > rows).
 *  One text block cites an IN-range snapshot; the other cites both an in-range AND a DANGLING index
 *  (5 — no such snapshot); a trailing `snapshot` block references an out-of-range index (9). */
function liveAnswerStep(): RunStep {
  const payload: AnswersStepPayload = {
    appId: "app-1",
    promptMode: "oneshot",
    snapshots: [
      { title: "AA Market Share %", data: { columns: ["AA Market Share %"], rows: [[13.49]] } },
      {
        title: "Carrier Comparison",
        data: {
          columns: ["Carrier", "Flight Count"],
          rows: [
            ["AA", 100],
            ["DL", 120],
          ],
          totalRows: 5,
        },
      },
    ],
    blocks: [
      { kind: "text", markdown: "American Airlines ranks last in punctuality.", citations: [0] },
      { kind: "snapshot", index: 0 },
      { kind: "text", markdown: "Compared to peers, performance varies widely.", citations: [1, 5] },
      { kind: "snapshot", index: 1 },
      { kind: "snapshot", index: 9 }, // dangling snapshot reference — must render nothing, never throw
    ],
  };
  return {
    id: "step-llm",
    runId: "run-qa",
    index: 0,
    type: "llm_response",
    label: "qlik-answers-assistant-1",
    status: "ok",
    turnIndex: 0,
    profileTokens: {},
    assistantText:
      "American Airlines ranks last in punctuality. Compared to peers, performance varies widely.",
    payload,
  };
}

test("createRunMarkdownReport: renders the ordered blocks with a 1×1 compact line, a capped table, and footnote-style citations (incl. a dangling one)", () => {
  const md = createRunMarkdownReport(fixtureRun(liveAnswerStep()), {
    test: fixtureTest(),
    scenario: fixtureScenario(),
  });

  assert.match(md, /Answer \(structured\):/, "structured-answer subsection present");

  // Text block 1 — in-range citation.
  assert.match(
    md,
    /American Airlines ranks last in punctuality\. \[\^1\]/,
    "in-range citation marker appended to the text block",
  );

  // Snapshot block 1 (index 0) — 1×1 KPI as a compact "label: value" line.
  assert.match(md, /\*\*\[\^1\] AA Market Share %\*\*/, "1×1 snapshot heading");
  assert.match(md, /- \*\*AA Market Share %:\*\* 13\.49/, "1×1 compact label:value line");

  // Text block 2 — one in-range + one DANGLING citation (index 5, only 2 snapshots exist).
  assert.match(
    md,
    /Compared to peers, performance varies widely\. \[\^2\] \[\^6\] \(unavailable\)/,
    "in-range + dangling citation markers, dangling one marked unavailable (never throws)",
  );

  // Snapshot block 2 (index 1) — multi-row/-column table, honoring the row cap.
  assert.match(md, /\*\*\[\^2\] Carrier Comparison\*\*/, "multi-row snapshot heading");
  assert.match(md, /\| Carrier \| Flight Count \|/, "table header row");
  assert.match(md, /\|---\|---\|/, "table separator row");
  assert.match(md, /\| AA \| 100 \|/, "table data row 1");
  assert.match(md, /\| DL \| 120 \|/, "table data row 2");
  assert.match(md, /Showing 2 of 5 rows\./, "honest row-cap note from `totalRows`");

  // Snapshot block 3 (index 9) — dangling snapshot reference: nothing rendered, no throw (implicit —
  // createRunMarkdownReport above already completed without throwing).
});

test("createRunJsonReport: embeds the qlik_answers step's blocks/snapshots verbatim (JSON parity)", () => {
  const step = liveAnswerStep();
  const report = createRunJsonReport(fixtureRun(step), {
    test: fixtureTest(),
    scenario: fixtureScenario(),
  });
  const payload = report.run.steps[0]?.payload as AnswersStepPayload;
  assert.equal(payload.blocks?.length, 5, "all 5 ordered blocks embedded");
  assert.equal(payload.snapshots?.length, 2, "both snapshots embedded");
  assert.equal(payload.snapshots?.[1]?.data?.totalRows, 5, "capped snapshot's totalRows embedded");
});

/** A LEGACY answer step exactly as the pre-Phase-5 executor persisted it: `rawResponse` + `reasoning`
 *  captured, but NO `blocks`/`reasoningSections` (mirrors `qlik-answers-replay-derivation.test.ts`'s
 *  fixture). Proves the report path's reuse of `deriveLegacyAnswerStep` (not a fresh reimplementation). */
function legacyRawResponseStep(): RunStep {
  const payload: AnswersStepPayload = {
    appId: "app-1",
    threadId: "thread-1",
    messageId: "msg-1",
    promptMode: "oneshot",
    reasoning: "1. **Understanding**: Evaluate AA as a partner.",
    snapshots: [
      { title: "AA Market Share %", measures: [{ expression: "[Flights]", label: "AA Market Share %" }] },
    ],
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
    id: "step-legacy",
    runId: "run-legacy",
    index: 0,
    type: "llm_response",
    label: "assistant",
    status: "ok",
    turnIndex: 0,
    profileTokens: {},
    assistantText: "AA ranks last in punctuality.",
    reasoningText: payload.reasoning,
    payload,
  };
}

test("createRunMarkdownReport: a LEGACY rawResponse-only step, run through deriveLegacyAnswerStep (the report route's own projection), still produces the block table + citation", () => {
  const derived = deriveLegacyAnswerStep(legacyRawResponseStep());
  const md = createRunMarkdownReport(fixtureRun(derived), {
    test: fixtureTest(),
    scenario: fixtureScenario(),
  });

  assert.match(md, /Answer \(structured\):/, "structured section present for the derived legacy step");
  assert.match(md, /AA ranks last in punctuality\. \[\^1\]/, "derived citation marker");
  assert.match(md, /\*\*\[\^1\] AA Market Share %\*\*/, "derived 1×1 snapshot heading");
  assert.match(md, /- \*\*AA Market Share %:\*\* 13\.49/, "derived 1×1 compact value line");
});

test("createRunMarkdownReport: a non-qlik llm_response step (no `blocks`) adds no structured-answer subsection", () => {
  const step: RunStep = {
    id: "step-plain",
    runId: "run-plain",
    index: 0,
    type: "llm_response",
    label: "claude-sonnet-4",
    status: "ok",
    turnIndex: 0,
    profileTokens: {},
    assistantText: "Plain answer, no structured blocks.",
    payload: { deltas: {}, snapshot: {} },
  };
  const md = createRunMarkdownReport(fixtureRun(step), {
    test: fixtureTest(),
    scenario: fixtureScenario(),
  });
  assert.ok(!md.includes("Answer (structured):"), "no structured-answer subsection for a non-qlik step");
  assert.match(md, /Plain answer, no structured blocks\./, "the plain assistantText prose still renders");
});

test("createRunMarkdownReport: a citation/snapshot reference never throws even when `snapshots` is absent entirely", () => {
  const step: RunStep = {
    id: "step-no-snap",
    runId: "run-no-snap",
    index: 0,
    type: "llm_response",
    label: "assistant",
    status: "ok",
    turnIndex: 0,
    profileTokens: {},
    payload: {
      blocks: [
        { kind: "text", markdown: "Answer with a stray citation.", citations: [0] },
        { kind: "snapshot", index: 0 },
      ],
      // `snapshots` intentionally omitted — every reference above is dangling.
    } as AnswersStepPayload,
  };
  assert.doesNotThrow(() => {
    const md = createRunMarkdownReport(fixtureRun(step), {
      test: fixtureTest(),
      scenario: fixtureScenario(),
    });
    assert.match(
      md,
      /Answer with a stray citation\. \[\^1\] \(unavailable\)/,
      "a citation with no snapshots at all renders as an unavailable marker, never throws",
    );
  });
});

test("createRunMarkdownReport: a snapshot block with no hypercube `data` falls back to a title-only line", () => {
  const step: RunStep = {
    id: "step-no-data",
    runId: "run-no-data",
    index: 0,
    type: "llm_response",
    label: "assistant",
    status: "ok",
    turnIndex: 0,
    profileTokens: {},
    payload: {
      snapshots: [{ title: "Fleet Utilization", reason: "supporting context" }],
      blocks: [{ kind: "snapshot", index: 0 }],
    } as AnswersStepPayload,
  };
  const md = createRunMarkdownReport(fixtureRun(step), {
    test: fixtureTest(),
    scenario: fixtureScenario(),
  });
  assert.match(md, /_\[\^1\] Fleet Utilization_/, "title-only fallback when the snapshot has no data");
});
