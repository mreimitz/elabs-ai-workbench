import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SummaryRun } from "../summary-derive";
import { DeltaBarPanel } from "./DeltaBarPanel";

// RM-33 WP 3.2 — the compare workspace RENDERS the cache rows.
//
// `summary-derive.test.ts` pins the math; this pins that the panel actually paints it, which is the
// half of the acceptance a pure-derivation test cannot prove. The two states that matter are a
// measured comparison (three labelled rows) and an unmeasured one (an honest "not measured" line
// rather than a plotted tie).

function run(over: Partial<SummaryRun>): SummaryRun {
  return {
    id: "r",
    index: 0,
    letter: "A",
    color: "var(--chart-1)",
    isBaseline: false,
    scenarioName: "Env",
    model: "claude-sonnet-4",
    statusLabel: "Completed",
    status: "completed",
    outcome: "completed",
    abnormal: false,
    turns: 4,
    toolCalls: 3,
    toolErrors: 0,
    tokensIn: 1000,
    tokensOut: 200,
    totalTokens: 1200,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    cacheHitRate: null,
    costUsd: 0.01,
    durationMs: 4000,
    peakContextTokens: 5000,
    contextLimit: 100_000,
    peakContextPercent: 5,
    peakSegments: { system: 0, tool_defs: 0, history: 0, tool_results: 0, output: 0 },
    contextTotals: [1000, 2000, 3000, 4000],
    qualityScore: null,
    ...over,
  };
}

describe("DeltaBarPanel — cache rows", () => {
  it("labels cache read, cache write and the hit rate as their own metrics", () => {
    const a = run({
      id: "a",
      letter: "A",
      isBaseline: true,
      cacheReadTokens: 400,
      cacheWriteTokens: 100,
      cacheHitRate: 0.4,
    });
    const b = run({
      id: "b",
      letter: "B",
      cacheReadTokens: 800,
      cacheWriteTokens: 50,
      cacheHitRate: 0.8,
    });
    render(<DeltaBarPanel runs={[a, b]} perTurn={false} comparable />);
    expect(screen.getByText("Cache read")).toBeInTheDocument();
    expect(screen.getByText("Cache write")).toBeInTheDocument();
    expect(screen.getByText("Cache hit rate")).toBeInTheDocument();
    // A read is a discount, so more of it is BETTER; a write is a 1.25x premium, so less is better.
    // B reads more AND writes less than the baseline, so both of its bars read as an improvement.
    expect(screen.getByLabelText(/^B: 800, better/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^B: 50, better/)).toBeInTheDocument();
  });

  it("says 'not measured' — not 'no difference to compare' — when no run can answer", () => {
    const a = run({ id: "a", letter: "A", isBaseline: true });
    const b = run({ id: "b", letter: "B", tokensIn: 500 });
    render(<DeltaBarPanel runs={[a, b]} perTurn={false} comparable />);
    // All three cache metrics collapse to the honest line — one each for read, write and hit rate.
    expect(screen.getByText(/Cache read is not measured for these runs/)).toBeInTheDocument();
    expect(screen.getByText(/Cache write is not measured for these runs/)).toBeInTheDocument();
    expect(screen.getByText(/Cache hit rate is not measured for these runs/)).toBeInTheDocument();
    expect(screen.getAllByText(/rather than as a zero/)).toHaveLength(3);
    expect(screen.queryByText(/Cache read.*no difference to compare/)).not.toBeInTheDocument();
  });
});
