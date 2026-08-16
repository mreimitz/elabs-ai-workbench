import type { RunStep } from "@mcp-token-footprint/shared";
import { describe, expect, test } from "vitest";
import { deriveTurnSummaries, firstLine } from "./turn-summary";
import type { TimelineItem } from "./use-run-stream";

describe("firstLine", () => {
  test("returns the first non-blank line, trimmed", () => {
    expect(firstLine("  Hello world  \nsecond line")).toBe("Hello world");
    expect(firstLine("\n\n  first real line\nmore")).toBe("first real line");
  });

  test("returns null for undefined/empty/all-blank text", () => {
    expect(firstLine(undefined)).toBeNull();
    expect(firstLine(null)).toBeNull();
    expect(firstLine("")).toBeNull();
    expect(firstLine("   \n   \n")).toBeNull();
  });
});

function step(over: Partial<RunStep>): RunStep {
  return {
    id: "s",
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

describe("deriveTurnSummaries", () => {
  test("pairs each assistant turn with the user item that immediately preceded it", () => {
    const timeline: TimelineItem[] = [
      { kind: "user", id: "u0", text: "First question\nmore detail" },
      {
        kind: "assistant_turn",
        id: "t0",
        turnIndex: 0,
        stepId: "resp-0",
        assistantText: "First answer.\nmore",
        toolCalls: [],
        status: "ok",
        streaming: false,
      },
      { kind: "user", id: "u1", text: "Second question" },
      {
        kind: "assistant_turn",
        id: "t1",
        turnIndex: 1,
        stepId: "resp-1",
        assistantText: "Second answer.",
        toolCalls: [],
        status: "ok",
        streaming: false,
      },
    ];
    const rows = deriveTurnSummaries(timeline, []);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      turnIndex: 0,
      turnNo: 1,
      promptFirstLine: "First question",
      replyFirstLine: "First answer.",
    });
    expect(rows[1]).toMatchObject({
      turnIndex: 1,
      turnNo: 2,
      promptFirstLine: "Second question",
      replyFirstLine: "Second answer.",
    });
  });

  test("a turn with no preceding user item (e.g. a second assistant turn with no interleaved user turn) carries a null prompt", () => {
    const timeline: TimelineItem[] = [
      { kind: "user", id: "u0", text: "Only question" },
      {
        kind: "assistant_turn",
        id: "t0",
        turnIndex: 0,
        assistantText: "First answer.",
        toolCalls: [],
        status: "ok",
        streaming: false,
      },
      {
        kind: "assistant_turn",
        id: "t1",
        turnIndex: 1,
        assistantText: "Follow-on answer with no new prompt.",
        toolCalls: [],
        status: "ok",
        streaming: false,
      },
    ];
    const rows = deriveTurnSummaries(timeline, []);
    expect(rows[1]?.promptFirstLine).toBeNull();
  });

  test("falls back to the reasoning's first line when there is no assistant text yet", () => {
    const timeline: TimelineItem[] = [
      {
        kind: "assistant_turn",
        id: "t0",
        turnIndex: 0,
        reasoningText: "Thinking about the answer…",
        toolCalls: [],
        status: "running",
        streaming: true,
      },
    ];
    const rows = deriveTurnSummaries(timeline, []);
    expect(rows[0]?.replyFirstLine).toBe("Thinking about the answer…");
    expect(rows[0]?.streaming).toBe(true);
  });

  test("hasError is true when the turn's own status errored OR any of its steps did", () => {
    const timeline: TimelineItem[] = [
      {
        kind: "assistant_turn",
        id: "t0",
        turnIndex: 0,
        assistantText: "…",
        toolCalls: [],
        status: "ok",
        streaming: false,
      },
    ];
    const steps = [step({ id: "s1", type: "tool_call", turnIndex: 0, status: "error" })];
    const rows = deriveTurnSummaries(timeline, steps);
    expect(rows[0]?.hasError).toBe(true);
  });

  test("computes duration from the turn's own steps' startedAt/endedAt span", () => {
    const timeline: TimelineItem[] = [
      {
        kind: "assistant_turn",
        id: "t0",
        turnIndex: 0,
        assistantText: "…",
        toolCalls: [],
        status: "ok",
        streaming: false,
      },
    ];
    const steps = [
      step({
        id: "s1",
        turnIndex: 0,
        startedAt: "2026-07-01T00:00:00.000Z",
        endedAt: "2026-07-01T00:00:01.500Z",
      }),
      step({
        id: "s2",
        turnIndex: 0,
        startedAt: "2026-07-01T00:00:01.500Z",
        endedAt: "2026-07-01T00:00:03.000Z",
      }),
      // A step from a DIFFERENT turn must not widen this turn's span.
      step({
        id: "s3",
        turnIndex: 1,
        startedAt: "2026-07-01T00:05:00.000Z",
        endedAt: "2026-07-01T00:05:01.000Z",
      }),
    ];
    const rows = deriveTurnSummaries(timeline, steps);
    expect(rows[0]?.durationMs).toBe(3000);
  });

  test("counts tool calls and sums provider-actual usage off the turn's own fields", () => {
    const timeline: TimelineItem[] = [
      {
        kind: "assistant_turn",
        id: "t0",
        turnIndex: 0,
        assistantText: "…",
        usageActual: { inputTokens: 120, outputTokens: 45 },
        toolCalls: [
          { id: "c1", toolName: "a", call: step({ id: "c1" }) },
          { id: "c2", toolName: "b", call: step({ id: "c2" }) },
        ],
        status: "ok",
        streaming: false,
      },
    ];
    const rows = deriveTurnSummaries(timeline, []);
    expect(rows[0]).toMatchObject({ tokensIn: 120, tokensOut: 45, toolCalls: 2, stepId: null });
  });
});
