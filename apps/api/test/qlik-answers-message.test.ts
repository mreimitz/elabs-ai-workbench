import assert from "node:assert/strict";
import { test } from "node:test";
import {
  collectQDefExpressions,
  collectSnapshots,
  extractAnswerMessage,
  findMessageById,
} from "../src/testing/qlik-answers-message.js";

// Qlik Answers cloud-assistants message extraction (Phase 4 rework). Fixtures mirror the shape the
// customer's proven `call_answers.py` reads: an Adaptive-Card message whose answer is the first
// TextBlock after a "Conclusion" block, plus hypercube `qMeasures[].qDef.qDef` expressions anywhere in
// the tree. NO network — these are pure functions.

/** A realistic cloud-assistants answer message for a Qlik-app-backed (NYC-taxi-style) assistant. */
function cardMessage(): unknown {
  return {
    id: "msg-42",
    type: "ai",
    content: [
      {
        card: {
          type: "AdaptiveCard",
          body: [
            { type: "TextBlock", text: "Reasoning: I aggregated the fare amounts across all trips." },
            { type: "TextBlock", text: "Conclusion" },
            {
              type: "TextBlock",
              text: "The average fare was $18.50.<citation id=\"1\">taxi-app</citation>",
            },
          ],
        },
      },
    ],
    analysis: {
      qHyperCubeDef: {
        qMeasures: [
          { qDef: { qDef: "Avg([fare_amount])" } },
          { qDef: { qDef: "Count([trip_id])" } },
        ],
      },
    },
  };
}

test("extractAnswerMessage: answer = first TextBlock after Conclusion, citations stripped; reasoning = pre-Conclusion", () => {
  const result = extractAnswerMessage(cardMessage());
  assert.equal(result.answer, "The average fare was $18.50.");
  assert.equal(result.reasoning, "Reasoning: I aggregated the fare amounts across all trips.");
  assert.deepEqual(result.expressions, ["Avg([fare_amount])", "Count([trip_id])"]);
});

test("extractAnswerMessage: a mid-text citation is removed in place", () => {
  const message = {
    content: [
      {
        card: {
          body: [
            { type: "TextBlock", text: "Conclusion" },
            { type: "TextBlock", text: "Revenue <citation id=\"7\">x</citation> grew 12%." },
          ],
        },
      },
    ],
  };
  assert.equal(extractAnswerMessage(message).answer, "Revenue  grew 12%.");
});

test("extractAnswerMessage: no Conclusion marker → falls back to the last ai text", () => {
  const message = {
    type: "root",
    nested: {
      type: "ai",
      content: [{ text: "Fallback answer from the last ai node." }],
    },
  };
  const result = extractAnswerMessage(message);
  assert.equal(result.answer, "Fallback answer from the last ai node.");
  assert.equal(result.reasoning, undefined);
  assert.deepEqual(result.expressions, []);
});

test("extractAnswerMessage: an empty message yields an empty answer, no throw", () => {
  assert.deepEqual(extractAnswerMessage({}), { answer: "", expressions: [], snapshots: [] });
  assert.deepEqual(extractAnswerMessage(null), { answer: "", expressions: [], snapshots: [] });
});

test("extractAnswerMessage: the FULL multi-paragraph narrative is captured (all TextBlocks after Conclusion, joined)", () => {
  // A real Qlik Answers report is several insight paragraphs interleaved with Qlik.Snapshot charts +
  // empty spacers — the answer must be ALL the paragraphs, not just the first.
  const message = {
    content: [
      {
        card: {
          body: [
            { type: "TextBlock", text: "Conclusion" },
            { type: "TextBlock", text: "Paragraph one.<citation data-index=\"0\">1</citation>" },
            { type: "Qlik.Snapshot", snapshot: {}, source: {} },
            { type: "TextBlock", text: "" }, // spacer
            { type: "TextBlock", text: "Paragraph two." },
            { type: "Qlik.Snapshot", snapshot: {}, source: {} },
            { type: "TextBlock", text: "Paragraph three — the recommendation." },
          ],
        },
      },
    ],
  };
  assert.equal(
    extractAnswerMessage(message).answer,
    "Paragraph one.\n\nParagraph two.\n\nParagraph three — the recommendation.",
  );
});

test("collectSnapshots: extracts each Qlik.Snapshot's title, reason, measures + dimensions", () => {
  const message = {
    content: [
      {
        card: {
          body: [
            { type: "TextBlock", text: "Conclusion" },
            { type: "TextBlock", text: "AA is the 3rd largest carrier." },
            {
              type: "Qlik.Snapshot",
              snapshot: { data: {}, language: "en" },
              source: {
                appId: "app-1",
                dimensions: [{ expression: "Carrier", label: "Carrier" }],
                measures: [{ expression: "{<[x]={'y'}>} [Flights]", label: "Total Flights by Carrier" }],
                reason: "Understanding market share.",
              },
            },
          ],
        },
      },
    ],
  };
  const snaps = collectSnapshots(message);
  assert.equal(snaps.length, 1);
  assert.equal(snaps[0]?.title, "Total Flights by Carrier");
  assert.equal(snaps[0]?.reason, "Understanding market share.");
  assert.deepEqual(snaps[0]?.measures, [
    { expression: "{<[x]={'y'}>} [Flights]", label: "Total Flights by Carrier" },
  ]);
  assert.deepEqual(snaps[0]?.dimensions, [{ expression: "Carrier", label: "Carrier" }]);
  // A snapshot with no usable source is skipped, not emitted as an empty object.
  assert.deepEqual(collectSnapshots({ content: [{ card: { body: [{ type: "Qlik.Snapshot" }] } }] }), []);
});

test("collectQDefExpressions: deep, tree-ordered, de-duplicated", () => {
  const obj = {
    a: { qMeasures: [{ qDef: { qDef: "Sum([x])" } }, { qDef: { qDef: "Sum([x])" } }] },
    b: [{ deeper: { qMeasures: [{ qDef: { qDef: "Max([y])" } }] } }],
  };
  assert.deepEqual(collectQDefExpressions(obj), ["Sum([x])", "Max([y])"]);
});

test("findMessageById: matches by id across list / {data} / {items} / bare shapes; falls back to last", () => {
  const a = { id: "a", v: 1 };
  const b = { id: "b", v: 2 };
  assert.equal(findMessageById([a, b], "a"), a);
  assert.equal(findMessageById({ data: [a, b] }, "b"), b);
  assert.equal(findMessageById({ items: [a, b] }, "a"), a);
  assert.equal(findMessageById({ messages: [a, b] }, "b"), b);
  assert.equal(findMessageById(a, "a"), a); // bare single-message object
  // No id / unmatched id → the LAST message (mirrors the script's fallback).
  assert.equal(findMessageById([a, b], undefined), b);
  assert.equal(findMessageById([a, b], "missing"), b);
  assert.equal(findMessageById([], "a"), undefined);
});
