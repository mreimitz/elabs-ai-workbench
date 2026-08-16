import { describe, expect, it } from "vitest";
import { summarizeArgs, unwrapToolResult } from "./tool-call-view";

// ── summarizeArgs — the collapsed row's one-line human args summary ───────────────────────────────

describe("summarizeArgs", () => {
  it("renders scalar entries as key: value pairs", () => {
    expect(summarizeArgs({ query: "Demo Banking", resourceType: "app" })).toBe(
      'query: "Demo Banking" · resourceType: "app"',
    );
  });

  it("compresses nested objects and arrays", () => {
    expect(summarizeArgs({ filter: { region: "EU" }, ids: [1, 2, 3] })).toBe(
      "filter: {…} · ids: [3]",
    );
  });

  it("renders numbers, booleans and null plainly", () => {
    expect(summarizeArgs({ limit: 5, dryRun: false, cursor: null })).toBe(
      "limit: 5 · dryRun: false · cursor: null",
    );
  });

  it("returns null when there is nothing to show", () => {
    expect(summarizeArgs(undefined)).toBeNull();
    expect(summarizeArgs(null)).toBeNull();
    expect(summarizeArgs({})).toBeNull();
  });

  it("truncates a long string value inside its quotes", () => {
    const summary = summarizeArgs({ text: "x".repeat(300) });
    expect(summary).not.toBeNull();
    expect((summary as string).length).toBeLessThanOrEqual(96);
    expect(summary).toMatch(/…"$/);
  });

  it("truncates the whole summary when many entries overflow the cap", () => {
    const args = Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => [`key${i}`, `value-${i}`]),
    );
    const summary = summarizeArgs(args);
    expect(summary).not.toBeNull();
    expect((summary as string).length).toBeLessThanOrEqual(96);
    expect(summary).toMatch(/…$/);
  });
});

// ── unwrapToolResult — MCP envelope → meaningful payload for the Result view ──────────────────────

describe("unwrapToolResult", () => {
  it("prefers structuredContent when present", () => {
    const envelope = {
      content: [{ type: "text", text: '{"a":1}' }],
      structuredContent: { result: [{ id: "x" }] },
      isError: false,
    };
    expect(unwrapToolResult(envelope)).toEqual({ result: [{ id: "x" }] });
  });

  it("parses a single JSON-in-string text part into the real object", () => {
    const envelope = {
      content: [{ type: "text", text: '{"result":[{"id":"a5aff609","name":"Demo Banking"}]}' }],
      isError: false,
    };
    expect(unwrapToolResult(envelope)).toEqual({
      result: [{ id: "a5aff609", name: "Demo Banking" }],
    });
  });

  it("keeps plain prose text parts as strings", () => {
    const envelope = { content: [{ type: "text", text: "All good." }], isError: false };
    expect(unwrapToolResult(envelope)).toBe("All good.");
  });

  it("returns an array for multiple text parts", () => {
    const envelope = {
      content: [
        { type: "text", text: "part one" },
        { type: "text", text: '{"b":2}' },
      ],
    };
    expect(unwrapToolResult(envelope)).toEqual(["part one", { b: 2 }]);
  });

  it("passes a non-envelope value through untouched", () => {
    expect(unwrapToolResult({ rows: [1, 2] })).toEqual({ rows: [1, 2] });
    expect(unwrapToolResult("plain")).toBe("plain");
    expect(unwrapToolResult([1, 2])).toEqual([1, 2]);
  });

  it("keeps the envelope when content carries no text parts (e.g. images)", () => {
    const envelope = { content: [{ type: "image", data: "…" }] };
    expect(unwrapToolResult(envelope)).toEqual(envelope);
  });

  it("tolerates malformed JSON in a text part (stays a string)", () => {
    const envelope = { content: [{ type: "text", text: "{not json" }] };
    expect(unwrapToolResult(envelope)).toBe("{not json");
  });
});
