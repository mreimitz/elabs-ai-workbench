import { describe, expect, it } from "vitest";
import type { SuiteCell, SuiteRunMember } from "@mcp-token-footprint/shared";
import { deriveSeedCells } from "./derive-cells";
import { cellKey } from "./use-suite-stream";

/** A minimal member fixture — only the fields the seed derivation reads matter. */
function member(
  over: Partial<SuiteRunMember> & { id: string; testId: string; scenarioId: string },
): SuiteRunMember {
  return {
    mode: "test",
    status: "completed",
    startedAt: "2026-07-10T00:00:00.000Z",
    turns: 1,
    toolCalls: 0,
    peakContextTokens: 0,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    repetition: 1,
    score: null,
    ...over,
  } as SuiteRunMember;
}

describe("deriveSeedCells", () => {
  it("projects each member into a SuiteCell keyed by cellKey with its runId/status/score", () => {
    const members: SuiteRunMember[] = [
      member({
        id: "run-a",
        testId: "t1",
        scenarioId: "s1",
        repetition: 1,
        status: "completed",
        score: 0.9,
      }),
      member({
        id: "run-b",
        testId: "t1",
        scenarioId: "s1",
        repetition: 2,
        status: "error",
        score: null,
      }),
    ];
    const seed = deriveSeedCells(members);

    const keyA = cellKey({ testId: "t1", scenarioId: "s1", repetition: 1 });
    const keyB = cellKey({ testId: "t1", scenarioId: "s1", repetition: 2 });
    expect(seed[keyA]).toEqual({
      testId: "t1",
      scenarioId: "s1",
      repetition: 1,
      runId: "run-a",
      status: "completed",
      score: 0.9,
    });
    expect(seed[keyB]?.runId).toBe("run-b");
    expect(seed[keyB]?.status).toBe("error");
    expect(seed[keyB]?.score).toBeNull();
  });

  it("keys distinct repetitions and variants separately (no collision)", () => {
    const members: SuiteRunMember[] = [
      member({ id: "base-1", testId: "t1", scenarioId: "s1", repetition: 1, variantLabel: "base" }),
      member({
        id: "var-1",
        testId: "t1",
        scenarioId: "s1",
        repetition: 1,
        variantLabel: "+skill",
      }),
    ];
    const seed = deriveSeedCells(members);
    expect(Object.keys(seed)).toHaveLength(2);
    expect(
      seed[cellKey({ testId: "t1", scenarioId: "s1", repetition: 1, variantLabel: "base" })]?.runId,
    ).toBe("base-1");
    expect(
      seed[cellKey({ testId: "t1", scenarioId: "s1", repetition: 1, variantLabel: "+skill" })]
        ?.runId,
    ).toBe("var-1");
  });

  it("omits variantLabel when a member has none (base matrix key)", () => {
    const seed = deriveSeedCells([
      member({ id: "run-a", testId: "t1", scenarioId: "s1", repetition: 1 }),
    ]);
    const cell = Object.values(seed)[0] as SuiteCell;
    expect("variantLabel" in cell).toBe(false);
  });

  it("merges UNDER the live stream — a live cell wins over its seed at the same key", () => {
    const seed = deriveSeedCells([
      member({
        id: "run-a",
        testId: "t1",
        scenarioId: "s1",
        repetition: 1,
        status: "completed",
        score: 0.5,
      }),
    ]);
    const key = cellKey({ testId: "t1", scenarioId: "s1", repetition: 1 });
    const liveCell: SuiteCell = {
      testId: "t1",
      scenarioId: "s1",
      repetition: 1,
      runId: "run-a",
      status: "running",
    };
    const merged = { ...seed, [key]: liveCell };
    expect(merged[key]?.status).toBe("running");
  });

  it("defaults a missing repetition to 1", () => {
    const seed = deriveSeedCells([
      member({ id: "run-a", testId: "t1", scenarioId: "s1", repetition: undefined }),
    ]);
    expect(seed[cellKey({ testId: "t1", scenarioId: "s1", repetition: 1 })]?.repetition).toBe(1);
  });
});
