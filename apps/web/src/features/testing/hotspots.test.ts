import type { RunStep, SessionCapabilities } from "@mcp-token-footprint/shared";
import { describe, expect, test } from "vitest";
import { deriveHotspots } from "./hotspots";
import type { StepEconomics } from "./analytics-derive";

function step(over: Partial<RunStep> & Pick<RunStep, "id" | "type">): RunStep {
  return {
    runId: "run",
    index: 0,
    label: over.type,
    status: "ok",
    profileTokens: {},
    payload: {},
    ...over,
  } as RunStep;
}

function econ(over: Partial<StepEconomics> = {}): StepEconomics {
  return {
    tokensInDelta: 0,
    tokensOutDelta: 0,
    costUsdDelta: 0,
    // RM-33 — hotspots never read the cache deltas; null keeps the fixture honest (unknown, not 0).
    cacheReadDelta: null,
    cacheWriteDelta: null,
    durationMs: null,
    ...over,
  };
}

const FULL_CAPS: Pick<SessionCapabilities, "costBasis" | "contextWindow"> = {
  costBasis: "api_exact",
  contextWindow: true,
};

describe("deriveHotspots", () => {
  test("picks the TRUE slowest / costliest / largest-context-jump steps, one hotspot per kind", () => {
    const s1 = step({ id: "s1", index: 0, type: "tool_call", toolName: "fast", durationMs: 10 });
    const s2 = step({ id: "s2", index: 1, type: "tool_call", toolName: "slow", durationMs: 900 });
    const s3 = step({
      id: "s3",
      index: 2,
      type: "llm_response",
      context: { total: 500, limit: 8000, segments: { system: 0, tool_defs: 0, history: 0, tool_results: 0, output: 0 } },
    });
    const s4 = step({
      id: "s4",
      index: 3,
      type: "llm_response",
      context: { total: 5000, limit: 8000, segments: { system: 0, tool_defs: 0, history: 0, tool_results: 0, output: 0 } },
    });

    const perStep = new Map<string, StepEconomics>([
      ["s1", econ({ costUsdDelta: 0.001, durationMs: 10 })],
      ["s2", econ({ costUsdDelta: 0.5, durationMs: 900 })],
      ["s3", econ()],
      ["s4", econ({ costUsdDelta: 0.02 })],
    ]);

    const hotspots = deriveHotspots([s1, s2, s3, s4], perStep, FULL_CAPS);

    expect(hotspots).toHaveLength(3);
    const slowest = hotspots.find((h) => h.kind === "slowest");
    expect(slowest).toMatchObject({ stepId: "s2", durationMs: 900 });
    const costliest = hotspots.find((h) => h.kind === "costliest");
    expect(costliest).toMatchObject({ stepId: "s2", costUsdDelta: 0.5 });
    const jump = hotspots.find((h) => h.kind === "contextJump");
    // s4's jump (5000 - 500 = 4500) is bigger than s3's own jump (500 - 0 = 500).
    expect(jump).toMatchObject({ stepId: "s4", deltaTokens: 4500 });
  });

  test("costBasis:\"none\" omits the costliest hotspot entirely (never a fake $0 pick)", () => {
    const s1 = step({ id: "s1", index: 0, type: "tool_call", durationMs: 10 });
    const perStep = new Map<string, StepEconomics>([["s1", econ({ costUsdDelta: 5, durationMs: 10 })]]);
    const hotspots = deriveHotspots([s1], perStep, { costBasis: "none", contextWindow: true });
    expect(hotspots.some((h) => h.kind === "costliest")).toBe(false);
  });

  test("contextWindow:false omits the contextJump hotspot entirely", () => {
    const s1 = step({
      id: "s1",
      index: 0,
      type: "llm_response",
      context: { total: 1000, limit: 8000, segments: { system: 0, tool_defs: 0, history: 0, tool_results: 0, output: 0 } },
    });
    const hotspots = deriveHotspots([s1], new Map(), { costBasis: "api_exact", contextWindow: false });
    expect(hotspots.some((h) => h.kind === "contextJump")).toBe(false);
  });

  test("a null perStepEconomics map (not loaded yet) omits costliest but keeps slowest — HONEST degrade, never a stale/zero pick", () => {
    const s1 = step({ id: "s1", index: 0, type: "tool_call", durationMs: 42 });
    const hotspots = deriveHotspots([s1], null, FULL_CAPS);
    expect(hotspots).toHaveLength(1);
    expect(hotspots[0]).toMatchObject({ kind: "slowest", stepId: "s1", durationMs: 42 });
  });

  test("duration-only degrade: no timing, no cost, no context anywhere yields zero hotspots — never fabricated", () => {
    const s1 = step({ id: "s1", index: 0, type: "context_event" });
    const hotspots = deriveHotspots([s1], new Map(), { costBasis: "none", contextWindow: false });
    expect(hotspots).toEqual([]);
  });

  test("a run with only timing (matches a hypothetical tokens:\"none\" kind) gets duration-only hotspots", () => {
    const s1 = step({ id: "s1", index: 0, type: "tool_call", durationMs: 7 });
    const s2 = step({ id: "s2", index: 1, type: "tool_call", durationMs: 200 });
    const hotspots = deriveHotspots([s1, s2], null, { costBasis: "none", contextWindow: false });
    expect(hotspots).toEqual([{ kind: "slowest", stepId: "s2", label: "tool_call", durationMs: 200 }]);
  });

  test("never picks a non-positive cost/context delta as a hotspot", () => {
    const s1 = step({ id: "s1", index: 0, type: "tool_call", durationMs: 5 });
    const perStep = new Map<string, StepEconomics>([["s1", econ({ costUsdDelta: 0, durationMs: 5 })]]);
    const hotspots = deriveHotspots([s1], perStep, FULL_CAPS);
    expect(hotspots.some((h) => h.kind === "costliest")).toBe(false);
  });
});
