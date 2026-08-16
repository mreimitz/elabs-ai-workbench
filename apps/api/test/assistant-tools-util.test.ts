import assert from "node:assert/strict";
import { test } from "node:test";
import {
  boundText,
  errorResult,
  jsonResult,
  safeTool,
  truncate,
  truncateFields,
} from "../src/assistant/tools/util.js";

// Assistant (WP 1.2) — pure unit tests for the read-toolset's shared helpers: compact JSON results,
// explicit truncation markers, and the safe-tool error boundary. No DB.

test("jsonResult produces a single text content block with the value JSON-encoded", () => {
  const result = jsonResult({ a: 1, b: "two" });
  assert.equal(result.content.length, 1);
  assert.equal(result.content[0]?.type, "text");
  assert.deepEqual(JSON.parse((result.content[0] as { text: string }).text), { a: 1, b: "two" });
  assert.equal(result.isError, undefined);
});

test("errorResult sets isError and carries the message, never a stack trace", () => {
  const result = errorResult("Run not found");
  assert.equal(result.isError, true);
  const parsed = JSON.parse((result.content[0] as { text: string }).text) as { error: string };
  assert.equal(parsed.error, "Run not found");
});

test("safeTool passes through a successful result unchanged", async () => {
  const result = await safeTool(() => jsonResult({ ok: true }));
  assert.equal(result.isError, undefined);
});

test("safeTool converts a thrown httpError into a clean isError result (no uncaught exception)", async () => {
  const result = await safeTool(() => {
    const error = new Error("Run not found") as Error & { statusCode: number };
    error.statusCode = 404;
    throw error;
  });
  assert.equal(result.isError, true);
  const parsed = JSON.parse((result.content[0] as { text: string }).text) as { error: string };
  assert.equal(parsed.error, "Run not found");
});

test("safeTool catches a thrown non-Error value too", async () => {
  const result = await safeTool(() => {
    throw "a plain string error";
  });
  assert.equal(result.isError, true);
  const parsed = JSON.parse((result.content[0] as { text: string }).text) as { error: string };
  assert.equal(parsed.error, "a plain string error");
});

// ── truncate ──────────────────────────────────────────────────────────────────────────────────────

test("truncate returns everything untouched when under the limit", () => {
  const result = truncate([1, 2, 3], 10);
  assert.deepEqual(result.items, [1, 2, 3]);
  assert.equal(result.total, 3);
  assert.equal(result.truncated, false);
});

test("truncate caps to the limit and reports the ORIGINAL total + truncated: true", () => {
  const result = truncate([1, 2, 3, 4, 5], 2);
  assert.deepEqual(result.items, [1, 2]);
  assert.equal(result.total, 5);
  assert.equal(result.truncated, true);
});

test("truncate at exactly the limit is NOT truncated", () => {
  const result = truncate([1, 2, 3], 3);
  assert.equal(result.truncated, false);
  assert.equal(result.items.length, 3);
});

test("truncate does not mutate the input array", () => {
  const input = [1, 2, 3, 4];
  const result = truncate(input, 2);
  assert.equal(input.length, 4, "original array untouched");
  result.items.push(99);
  assert.equal(input.length, 4, "returned items is a fresh copy");
});

// ── boundText ─────────────────────────────────────────────────────────────────────────────────────

test("boundText passes short strings through unchanged", () => {
  assert.equal(boundText("short", 100), "short");
});

test("boundText cuts an over-long string and appends an explicit char-count marker", () => {
  const long = "a".repeat(50);
  const bounded = boundText(long, 10);
  assert.equal(bounded, `${"a".repeat(10)}…+40 chars truncated`);
});

// ── truncateFields ────────────────────────────────────────────────────────────────────────────────

test("truncateFields caps only the named array fields, leaving scalars and other arrays alone", () => {
  const obj = { keep: "unchanged", big: [1, 2, 3, 4, 5], untouchedArray: [1, 2, 3, 4, 5] };
  const out = truncateFields(obj, ["big"], 2);
  assert.equal(out.keep, "unchanged");
  assert.deepEqual(out.big, [1, 2]);
  assert.equal(out.bigTruncated, true);
  assert.equal(out.bigTotal, 5);
  // A field not named in `keys` is passed through even though it's also an oversized array.
  assert.deepEqual(out.untouchedArray, [1, 2, 3, 4, 5]);
  assert.equal(out.untouchedArrayTruncated, undefined);
});

test("truncateFields marks an under-limit field truncated: false with its real total", () => {
  const out = truncateFields({ small: [1, 2] }, ["small"], 10);
  assert.deepEqual(out.small, [1, 2]);
  assert.equal(out.smallTruncated, false);
  assert.equal(out.smallTotal, 2);
});

test("truncateFields is a no-op for a field that's absent or not an array", () => {
  const out = truncateFields({ name: "x" } as { name: string; missing?: number[] }, ["missing"], 5);
  assert.equal(out.missing, undefined);
  assert.equal(out.missingTruncated, undefined);
});
