import assert from "node:assert/strict";
import { test } from "node:test";
import type { AnswersAnswerBlock } from "@mcp-token-footprint/shared";
import { collectSnapshots, extractAnswerMessage } from "../src/testing/qlik-answers-message.js";

// WP 5.2 (Phase 5 — answer rendering, D-QA8/D-QA9/D-QA10): the ordered card-body `blocks[]` walk,
// per-block citation indices, and hypercube `data` extraction. Fixtures are trimmed from the REAL run
// `hHGgqkU…` (`.qa-fixtures/run-hHGgqkU.json`, `steps[1].payload.rawResponse`) — the interleaved
// Conclusion → TextBlock → Qlik.Snapshot card shape, real column labels + qMatrix cell values. Pure,
// no network. The pre-existing `qlik-answers-message.test.ts` stays untouched and green.

/** A 1×1 KPI hypercube (real cube0: AA Market Share %, 13.4869…). */
function kpiSnapshot(): unknown {
  return {
    type: "Qlik.Snapshot",
    source: {
      appId: "app-1",
      measures: [{ expression: "(([Flights]) / ([Flights])) * 100", label: "AA Market Share %" }],
      reason: "Establishes baseline partnership scale and market presence",
    },
    snapshot: {
      data: {
        qHyperCube: {
          qSize: { qcx: 1, qcy: 1 },
          qDimensionInfo: [],
          qMeasureInfo: [{ qFallbackTitle: "AA Market Share %" }],
          qDataPages: [
            { qMatrix: [[{ qNum: 13.486940374003463, qText: "13.486940374003", qState: "L" }]] },
          ],
        },
      },
    },
  };
}

/** An N×M carrier hypercube (real cube1 shape, trimmed to 3 rows): dimension + 3 measures. */
function carrierSnapshot(): unknown {
  return {
    type: "Qlik.Snapshot",
    source: {
      dimensions: [{ expression: "Carrier.airline_name", label: "Carrier.airline_name" }],
      measures: [
        { expression: "[Flights]", label: "Flight Count" },
        { expression: "[DepDelay]", label: "Avg Delay Minutes" },
        { expression: "[CarrierDelay]", label: "Avg Carrier-Caused Delay" },
      ],
    },
    snapshot: {
      data: {
        qHyperCube: {
          qSize: { qcx: 4, qcy: 3 },
          qDimensionInfo: [{ qFallbackTitle: "Carrier.airline_name" }],
          qMeasureInfo: [
            { qFallbackTitle: "Flight Count" },
            { qFallbackTitle: "Avg Delay Minutes" },
            { qFallbackTitle: "Avg Carrier-Caused Delay" },
          ],
          qDataPages: [
            {
              qMatrix: [
                // Dimension cells carry qNum:"NaN" (a STRING) — must fall back to qText, not become NaN.
                [
                  { qNum: "NaN", qText: "Alaska Airlines", qState: "O" },
                  { qNum: 2092174, qText: "2092174", qState: "L" },
                  { qNum: 8126827, qText: "8126827", qState: "L" },
                  { qNum: 5321563, qText: "5321563", qState: "L" },
                ],
                [
                  { qNum: "NaN", qText: "American Airlines", qState: "O" },
                  { qNum: 8500000, qText: "8500000", qState: "L" },
                  { qNum: 101100000, qText: "101100000", qState: "L" },
                  { qNum: 42300000, qText: "42300000", qState: "L" },
                ],
                [
                  { qNum: "NaN", qText: "Delta Air Lines", qState: "O" },
                  { qNum: 8901234, qText: "8901234", qState: "L" },
                  { qNum: 71000000, qText: "71000000", qState: "L" },
                  { qNum: 36700000, qText: "36700000", qState: "L" },
                ],
              ],
            },
          ],
        },
      },
    },
  };
}

/** The real interleaved answer card: Conclusion → text+cite → snapshot → spacer → text+cite → snapshot → ActionSet → hidden Container. */
function answerCard(): unknown {
  return {
    id: "0cf13385-e19c-4c1c-a9dd-5c33375c04ec",
    type: "ai",
    content: [
      {
        type: "adaptiveCard",
        card: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          body: [
            { type: "TextBlock", text: "Conclusion", weight: "bolder" },
            {
              type: "TextBlock",
              wrap: true,
              text: 'American Airlines holds roughly 13.5% of all flights at major and mid-sized US airports.<citation data-index="0">1</citation>',
            },
            kpiSnapshot(),
            { type: "TextBlock", text: "" }, // spacer
            {
              type: "TextBlock",
              wrap: true,
              text: 'On flight volume alone, AA is a strong partner, but punctuality tells a different story.<citation data-index="1">2</citation>',
            },
            carrierSnapshot(),
            { type: "ActionSet", actions: [{ type: "Action.ToggleVisibility", title: "View source" }] },
            { type: "Container", id: "details", isVisible: false, items: [{ type: "TextBlock", text: "hidden" }] },
          ],
        },
      },
    ],
  };
}

test("extractAnswerMessage.blocks: ordered text↔snapshot sequence with per-block citation indices (D-QA8/D-QA9)", () => {
  const extracted = extractAnswerMessage(answerCard());
  const blocks = extracted.blocks as AnswersAnswerBlock[];
  assert.ok(blocks, "blocks are derived");
  assert.deepEqual(blocks, [
    {
      kind: "text",
      markdown: "American Airlines holds roughly 13.5% of all flights at major and mid-sized US airports.",
      citations: [0],
    },
    { kind: "snapshot", index: 0 },
    {
      kind: "text",
      markdown: "On flight volume alone, AA is a strong partner, but punctuality tells a different story.",
      citations: [1],
    },
    { kind: "snapshot", index: 1 },
  ]);
  // The "Conclusion" marker, the blank spacer, the ActionSet, and the hidden Container are NOT blocks.
  assert.equal(blocks.filter((b) => b.kind === "text").length, 2);
  assert.equal(blocks.filter((b) => b.kind === "snapshot").length, 2);
  // Snapshot block indices line up with the collectSnapshots array order.
  assert.equal(extracted.snapshots.length, 2);
});

test("blocks text markdown joined equals answer (assistantText) — additive derivation, answer unchanged", () => {
  const extracted = extractAnswerMessage(answerCard());
  const textJoined = (extracted.blocks ?? [])
    .filter((b): b is Extract<AnswersAnswerBlock, { kind: "text" }> => b.kind === "text")
    .map((b) => b.markdown)
    .join("\n\n");
  assert.equal(textJoined, extracted.answer);
  assert.equal(
    extracted.answer,
    "American Airlines holds roughly 13.5% of all flights at major and mid-sized US airports.\n\nOn flight volume alone, AA is a strong partner, but punctuality tells a different story.",
  );
});

test("hypercube data: 1×1 KPI → single numeric cell; columns from qFallbackTitle (D-QA10)", () => {
  const snaps = collectSnapshots(answerCard());
  assert.deepEqual(snaps[0]?.data, {
    columns: ["AA Market Share %"],
    rows: [[13.486940374003463]],
  });
  assert.equal(snaps[0]?.data?.totalRows, undefined); // 1 row → no cap, no totalRows
});

test("hypercube data: N×M → dim label + measure labels; qNum:'NaN' dim cells fall back to qText (D-QA10)", () => {
  const snaps = collectSnapshots(answerCard());
  const data = snaps[1]?.data;
  assert.deepEqual(data?.columns, [
    "Carrier.airline_name",
    "Flight Count",
    "Avg Delay Minutes",
    "Avg Carrier-Caused Delay",
  ]);
  assert.deepEqual(data?.rows, [
    ["Alaska Airlines", 2092174, 8126827, 5321563],
    ["American Airlines", 8500000, 101100000, 42300000],
    ["Delta Air Lines", 8901234, 71000000, 36700000],
  ]);
  assert.equal(data?.totalRows, undefined);
});

test("hypercube data: rows are capped at 50 with an honest totalRows (D-QA10)", () => {
  const rows = Array.from({ length: 60 }, (_, i) => [
    { qNum: "NaN", qText: `Carrier ${i}`, qState: "O" },
    { qNum: i * 1000, qText: String(i * 1000), qState: "L" },
  ]);
  const message = {
    content: [
      {
        card: {
          body: [
            { type: "TextBlock", text: "Conclusion" },
            { type: "TextBlock", text: "Volume by carrier." },
            {
              type: "Qlik.Snapshot",
              source: { measures: [{ expression: "[Flights]", label: "Flight Volume" }] },
              snapshot: {
                data: {
                  qHyperCube: {
                    qSize: { qcx: 2, qcy: 60 },
                    qDimensionInfo: [{ qFallbackTitle: "Carrier" }],
                    qMeasureInfo: [{ qFallbackTitle: "Flight Volume" }],
                    qDataPages: [{ qMatrix: rows }],
                  },
                },
              },
            },
          ],
        },
      },
    ],
  };
  const data = collectSnapshots(message)[0]?.data;
  assert.equal(data?.rows.length, 50);
  assert.equal(data?.totalRows, 60);
  assert.deepEqual(data?.rows[0], ["Carrier 0", 0]);
  assert.deepEqual(data?.rows[49], ["Carrier 49", 49000]);
});

test("blocks: a snapshot with no usable source/hypercube is skipped and consumes NO index", () => {
  const message = {
    content: [
      {
        card: {
          body: [
            { type: "TextBlock", text: "Conclusion" },
            { type: "TextBlock", text: "First claim." },
            { type: "Qlik.Snapshot", source: { measures: [{ expression: "[A]", label: "A" }] }, snapshot: {} },
            { type: "Qlik.Snapshot" }, // empty — collectSnapshots skips it; must not consume an index
            { type: "TextBlock", text: "Second claim." },
            { type: "Qlik.Snapshot", source: { measures: [{ expression: "[B]", label: "B" }] }, snapshot: {} },
          ],
        },
      },
    ],
  };
  const extracted = extractAnswerMessage(message);
  assert.equal(extracted.snapshots.length, 2);
  assert.deepEqual(extracted.blocks, [
    { kind: "text", markdown: "First claim." },
    { kind: "snapshot", index: 0 },
    { kind: "text", markdown: "Second claim." },
    { kind: "snapshot", index: 1 },
  ]);
});

test("blocks: a text block can carry multiple de-duplicated citation indices; no citations → key omitted", () => {
  const message = {
    content: [
      {
        card: {
          body: [
            { type: "TextBlock", text: "Conclusion" },
            {
              type: "TextBlock",
              text: 'Delta and United<citation data-index="2">3</citation> lead, then Alaska<citation data-index="3">4</citation><citation data-index="2">3</citation>.',
            },
            { type: "TextBlock", text: "No citation here." },
          ],
        },
      },
    ],
  };
  const blocks = extractAnswerMessage(message).blocks as AnswersAnswerBlock[];
  assert.deepEqual(blocks[0], {
    kind: "text",
    markdown: "Delta and United lead, then Alaska.",
    citations: [2, 3],
  });
  assert.deepEqual(blocks[1], { kind: "text", markdown: "No citation here." });
});

test("blocks: absent for a plain message with no Conclusion card (renders as before this WP)", () => {
  const message = { type: "ai", content: [{ text: "just a plain answer" }] };
  const extracted = extractAnswerMessage(message);
  assert.equal(extracted.blocks, undefined);
});
