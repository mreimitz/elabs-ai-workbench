import type { RunSummary } from "@mcp-token-footprint/shared";
import { describe, expect, it } from "vitest";
import type { WorkspaceRun } from "../compare-runs";
import { buildComparisonExport, buildComparisonMarkdown } from "./compare-export";

// RM-33 WP 3.2 — the comparison export's cache rows.
//
// Compare had NO cached row anywhere: two runs could differ by 900k tokens and 4x in cost with
// nothing on the page — or in the exported artifact — to connect the two. These pin the three rows
// and, more importantly, the difference between "this run cached nothing" and "we cannot tell"
// (D-CT6): the first is a number, the second is an em dash.

function summary(id: string, over: Partial<RunSummary> = {}): RunSummary {
  return {
    id,
    testId: "t1",
    scenarioId: `scn-${id}`,
    mode: "automated",
    status: "completed",
    outcome: "completed",
    startedAt: "2026-08-21T12:00:00.000Z",
    durationMs: 4000,
    turns: 4,
    toolCalls: 3,
    peakContextTokens: 5000,
    tokensIn: 1000,
    tokensOut: 200,
    costUsd: 0.01,
    ...over,
  };
}

function ws(id: string, letter: string, run: RunSummary): WorkspaceRun {
  return {
    id,
    index: letter === "A" ? 0 : 1,
    letter,
    color: "var(--chart-1)",
    isBaseline: letter === "A",
    run,
    scenarioName: `Env ${letter}`,
    model: "claude-sonnet-4",
    providerLabel: "",
    statusLabel: "Completed",
  };
}

const cached = ws(
  "a",
  "A",
  summary("a", { cachedTokens: 900, cacheReadTokens: 800, cacheWriteTokens: 100 }),
);
/** A pre-migration-59 run: the columns were never written, so the split is unknowable. */
const unknown = ws("b", "B", summary("b"));

describe("buildComparisonExport — cache rows", () => {
  it("carries the split and the hit rate for a run that can answer", () => {
    const row = buildComparisonExport([cached], null).runs[0]!;
    expect(row.tokensIn).toBe(1000); // D-CT1 — GROSS, never netted by the cached slice
    expect(row.cacheReadTokens).toBe(800);
    expect(row.cacheWriteTokens).toBe(100);
    expect(row.cacheHitRate).toBeCloseTo(0.8, 10);
  });

  it("carries null — not zero — for a run that cannot answer (D-CT6)", () => {
    const row = buildComparisonExport([unknown], null).runs[0]!;
    expect(row.cacheReadTokens).toBeNull();
    expect(row.cacheWriteTokens).toBeNull();
    expect(row.cacheHitRate).toBeNull();
  });

  it("keeps every pre-RM-33 field intact — the export shape is additive", () => {
    const row = buildComparisonExport([cached], null).runs[0]!;
    expect(row).toMatchObject({
      letter: "A",
      environment: "Env A",
      model: "claude-sonnet-4",
      baseline: true,
      turns: 4,
      toolCalls: 3,
      tokensIn: 1000,
      tokensOut: 200,
      totalTokens: 1200,
      peakContextTokens: 5000,
      costUsd: 0.01,
      durationMs: 4000,
    });
  });
});

describe("buildComparisonMarkdown — cache rows", () => {
  const md = buildComparisonMarkdown([cached, unknown], null);

  it("names each row with what it costs, so a read cannot be read as a premium", () => {
    expect(md).toContain("| Cache read (~0.1×) | 800 | — |");
    expect(md).toContain("| Cache write (1.25×) | 100 | — |");
  });

  it("prints the hit rate for the measured run and an em dash for the unmeasured one", () => {
    expect(md).toMatch(/\| Cache hit rate \| 80(\.0)?% \| — \|/);
  });

  it("still renders every row it rendered before", () => {
    for (const label of [
      "| Environment |",
      "| Model |",
      "| Outcome |",
      "| Turns |",
      "| Tool calls |",
      "| Tokens in |",
      "| Tokens out |",
      "| Total tokens |",
      "| Peak context |",
      "| Cost |",
      "| Duration |",
    ]) {
      expect(md).toContain(label);
    }
  });
});
