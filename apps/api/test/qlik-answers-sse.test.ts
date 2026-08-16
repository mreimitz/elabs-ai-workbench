import assert from "node:assert/strict";
import { test } from "node:test";
import {
  extractDeltaText,
  extractMessageId,
  QlikAnswersSseParser,
  QlikReasoningCleaner,
  type QlikStreamChunk,
} from "../src/testing/qlik-answers-sse.js";

// Qlik Answers cloud-assistants `actions/stream` parser (Phase 4c). Each frame is a JSON-RPC/JSON-Patch
// op: structural `op:add`/`replace` frames build the card; text-append frames (no `op`, string path →
// …/text, string value) stream the tokens — the reasoning stepper (`/steps/…/toggleContent/…`) carries
// the live agent process, the main body carries the answer. The parser surfaces reasoning/answer/
// messageId chunks. NO network.

function collectAll(chunks: string[]): QlikStreamChunk[] {
  const parser = new QlikAnswersSseParser();
  const out: QlikStreamChunk[] = [];
  for (const chunk of chunks) out.push(...parser.push(chunk));
  out.push(...parser.finish());
  return out;
}

/** A JSON-Patch text-append frame at `path` with token `value` (the real streaming shape). */
function textFrame(path: string, value: string): string {
  return `data: ${JSON.stringify({ method: "delta", params: { path, value }, context: {} })}\n`;
}

const REASONING_PATH = "/content/0/card/body/0/steps/1/content/toggleContent/0/items/0/text";
const REASONING_PATH_2 = "/content/0/card/body/0/steps/1/content/toggleContent/0/items/2/text";
const ANSWER_PATH = "/content/0/card/body/2/text";

test("reasoning-stepper text-append frames become ordered `reasoning` chunks", () => {
  const chunks = collectAll([
    textFrame(REASONING_PATH, "I'll help "),
    textFrame(REASONING_PATH, "you find the count."),
    `data: {"method":"delta","params":{"messageId":"m1"}}\n`,
  ]);
  const reasoning = chunks.filter((c) => c.kind === "reasoning");
  assert.deepEqual(
    reasoning.map((c) => (c.kind === "reasoning" ? c.text : "")),
    ["I'll help ", "you find the count."],
  );
  assert.ok(chunks.some((c) => c.kind === "messageId" && c.messageId === "m1"));
});

test("a NEW reasoning section (different path) is separated by a blank line", () => {
  const chunks = collectAll([
    textFrame(REASONING_PATH, "Search findings:"),
    textFrame(REASONING_PATH_2, "Master Measures: [Flights]"),
  ]).filter((c) => c.kind === "reasoning");
  assert.deepEqual(
    chunks.map((c) => (c.kind === "reasoning" ? c.text : "")),
    ["Search findings:", "\n\nMaster Measures: [Flights]"],
  );
});

test("main-body text-append frames become `answer` chunks (not reasoning)", () => {
  const chunks = collectAll([textFrame(ANSWER_PATH, "There are 63,079,426 flights.")]);
  assert.deepEqual(chunks, [{ kind: "answer", text: "There are 63,079,426 flights." }]);
});

test("structural op:add/replace frames emit no text (only a messageId, if present)", () => {
  const chunks = collectAll([
    `data: ${JSON.stringify({ method: "delta", params: { op: "add", path: "/content/0/card/body/0/steps/0/content/toggleContent/0/items/-", value: { text: "", type: "TextBlock" }, messageId: "m2" } })}\n`,
    `data: ${JSON.stringify({ method: "delta", params: { op: "replace", path: "/x", value: { a: 1 } } })}\n`,
  ]);
  assert.deepEqual(
    chunks.filter((c) => c.kind !== "messageId"),
    [],
  );
  assert.ok(chunks.some((c) => c.kind === "messageId" && c.messageId === "m2"));
});

test("a frame can straddle chunks; finish() flushes a trailing frame with no newline", () => {
  const parser = new QlikAnswersSseParser();
  const out: QlikStreamChunk[] = [];
  out.push(...parser.push(`data: {"method":"delta","params":{"path":"${REASONING_PATH}","va`));
  out.push(...parser.push(`lue":"streamed"}}`)); // no newline yet → buffered
  assert.deepEqual(out, []);
  out.push(...parser.finish());
  assert.deepEqual(out, [{ kind: "reasoning", text: "streamed" }]);
});

test("tolerates blanks, comments, `[DONE]`, non-JSON; a legacy top-level {output} → answer chunk", () => {
  const chunks = collectAll([
    "\n",
    ": keep-alive\n",
    "event: message\n",
    "data: [DONE]\n",
    "not json\n",
    'data: {"output":"legacy text"}\n',
  ]);
  assert.deepEqual(chunks, [{ kind: "answer", text: "legacy text" }]);
});

test("extractMessageId: top-level and nested under params/data/payload", () => {
  assert.equal(extractMessageId({ messageId: "top" }), "top");
  assert.equal(extractMessageId({ params: { messageId: "p" } }), "p");
  assert.equal(extractMessageId({ data: { messageId: "d" } }), "d");
  assert.equal(extractMessageId({ nothing: true }), undefined);
});

test("extractDeltaText: returns undefined for a JSON-RPC/patch frame (params present)", () => {
  assert.equal(extractDeltaText({ method: "delta", params: { path: "/x", value: "y" } }), undefined);
  assert.equal(extractDeltaText({ output: "a" }), "a");
  assert.equal(extractDeltaText({ content: [{ text: "x" }, { text: "y" }] }), "xy");
});

// ── The reasoning tag cleaner ─────────────────────────────────────────────────────────────────────

test("QlikReasoningCleaner: strips <plan>/<final> wrapper tags, even split across chunks", () => {
  const cleaner = new QlikReasoningCleaner();
  // "<plan>" split as "<pla" + "n>" — the partial tag is held until it completes, then stripped.
  let out = cleaner.push("<pla");
  out += cleaner.push("n>1. Understand");
  out += cleaner.push("</plan>");
  out += cleaner.push("<final>63,079,426");
  out += cleaner.flush();
  assert.equal(out, "1. Understand63,079,426");
});

test("QlikReasoningCleaner: a real '<' in content is not swallowed", () => {
  const cleaner = new QlikReasoningCleaner();
  let out = cleaner.push("value < ");
  out += cleaner.push("5 is small");
  out += cleaner.flush();
  assert.equal(out, "value < 5 is small");
});
