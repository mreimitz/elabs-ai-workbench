import type { RunStep, RunSummary } from "@mcp-token-footprint/shared";
import { describe, expect, test } from "vitest";
import { collectLiveSearchHits, findMatch, hitFromFtsSummary } from "./run-search";
import type { TimelineItem } from "./use-run-stream";

// ── findMatch — the ONE match/snippet primitive both data sources route through ──────────────────

describe("findMatch", () => {
  test("finds a case-insensitive substring and brackets it in a context snippet", () => {
    const hit = findMatch("The quick brown fox jumps over the lazy dog", "BROWN");
    expect(hit).not.toBeNull();
    expect(hit?.snippet).toContain("[brown]");
    expect(hit?.snippet.toLowerCase()).toContain("the quick");
  });

  test("truncates long context with ellipses on the clipped side(s)", () => {
    const text = `${"a".repeat(200)}NEEDLE${"b".repeat(200)}`;
    const hit = findMatch(text, "needle", 10);
    expect(hit?.snippet.startsWith("…")).toBe(true);
    expect(hit?.snippet.endsWith("…")).toBe(true);
    expect(hit?.snippet).toContain("[NEEDLE]");
  });

  test("returns null for an empty query, empty text, or no occurrence", () => {
    expect(findMatch("hello", "")).toBeNull();
    expect(findMatch("", "hello")).toBeNull();
    expect(findMatch("hello world", "xyz")).toBeNull();
  });
});

// ── collectLiveSearchHits — prompts / replies / tool text / errors (acceptance #1) ────────────────

function toolStep(over: Partial<RunStep>): RunStep {
  return {
    id: "step-1",
    runId: "run-1",
    index: 0,
    type: "tool_call",
    label: "tool",
    status: "ok",
    profileTokens: {},
    payload: {},
    ...over,
  };
}

describe("collectLiveSearchHits", () => {
  test("matches a user prompt", () => {
    const timeline: TimelineItem[] = [{ kind: "user", id: "u1", text: "How are flights doing?" }];
    const hits = collectLiveSearchHits({ timeline, runError: null, query: "flights" });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ kind: "prompt", stepId: "u1", source: "live" });
    expect(hits[0]?.snippet).toContain("[flights]");
  });

  test("matches an assistant reply and reasoning as separate hits", () => {
    const timeline: TimelineItem[] = [
      {
        kind: "assistant_turn",
        id: "turn-0",
        turnIndex: 0,
        stepId: "resp-0",
        assistantText: "The answer is forty-two.",
        reasoningText: "Let me compute forty-two carefully.",
        toolCalls: [],
        status: "ok",
        streaming: false,
      },
    ];
    const hits = collectLiveSearchHits({ timeline, runError: null, query: "forty-two" });
    expect(hits).toHaveLength(2);
    expect(hits.map((h) => h.kind)).toEqual(["assistant", "assistant"]);
    expect(hits.every((h) => h.turnIndex === 0)).toBe(true);
    expect(hits.every((h) => h.stepId === "resp-0")).toBe(true);
  });

  test("matches tool-call args and a tool result, and classifies an error result as kind=error", () => {
    const okCall = toolStep({
      id: "call-ok",
      type: "tool_call",
      toolName: "search_docs",
      payload: { toolCallId: "c1", args: { query: "widgets" } },
    });
    const okResult = toolStep({
      id: "result-ok",
      type: "tool_result",
      toolName: "search_docs",
      status: "ok",
      payload: { toolCallId: "c1", result: "found 3 widgets" },
    });
    const failCall = toolStep({
      id: "call-fail",
      type: "tool_call",
      toolName: "broken_tool",
      payload: { toolCallId: "c2", args: {} },
    });
    const failResult = toolStep({
      id: "result-fail",
      type: "tool_result",
      toolName: "broken_tool",
      status: "error",
      payload: { toolCallId: "c2", error: "widgets exploded" },
    });
    const timeline: TimelineItem[] = [
      {
        kind: "assistant_turn",
        id: "turn-0",
        turnIndex: 0,
        toolCalls: [
          { id: "c1", toolName: "search_docs", call: okCall, result: okResult },
          { id: "c2", toolName: "broken_tool", call: failCall, result: failResult },
        ],
        status: "ok",
        streaming: false,
      },
    ];
    const hits = collectLiveSearchHits({ timeline, runError: null, query: "widgets" });
    const kinds = hits.map((h) => h.kind).sort();
    expect(kinds).toEqual(["error", "tool", "tool_result"]);
    const errorHit = hits.find((h) => h.kind === "error");
    expect(errorHit?.stepId).toBe("result-fail");
    expect(errorHit?.toolCallId).toBe("c2");
  });

  test("matches the run-level terminal error", () => {
    const hits = collectLiveSearchHits({
      timeline: [],
      runError: "Provider rate limit exceeded",
      query: "rate limit",
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ kind: "error", stepId: null, turnIndex: null });
  });

  test("an empty query yields no hits at all", () => {
    const timeline: TimelineItem[] = [{ kind: "user", id: "u1", text: "hello" }];
    expect(collectLiveSearchHits({ timeline, runError: "hello", query: "" })).toEqual([]);
  });
});

// ── hitFromFtsSummary — the replay-only FTS supplement wraps the server's snippet as-is ───────────

describe("hitFromFtsSummary", () => {
  test("wraps the matching run's snippet/matchKind without re-matching", () => {
    const runs: RunSummary[] = [
      {
        id: "run-1",
        searchSnippet: "…the [widget] inventory…",
        searchMatchKind: "tool_result",
      } as RunSummary,
    ];
    const hit = hitFromFtsSummary("run-1", runs);
    expect(hit).toMatchObject({
      id: "fts:run-1",
      source: "fts",
      kind: "tool_result",
      snippet: "…the [widget] inventory…",
    });
  });

  test("returns null when the run isn't in the result set or carries no snippet", () => {
    expect(hitFromFtsSummary("run-x", [])).toBeNull();
    expect(hitFromFtsSummary("run-1", [{ id: "run-1" } as RunSummary])).toBeNull();
  });
});
