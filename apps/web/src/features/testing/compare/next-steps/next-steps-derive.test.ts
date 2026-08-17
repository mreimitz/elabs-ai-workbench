import { describe, expect, it } from "vitest";
import type { RunSkill, RunStep, RunSummary, Scenario } from "@mcp-token-footprint/shared";
import type { CompareData, WorkspaceRun } from "../compare-runs";
import type { SummaryRun } from "../summary-derive";
import { deriveNextSteps, type NextStepsInput } from "./next-steps-derive";

function runSummary(id: string, over: Partial<RunSummary> = {}): RunSummary {
  return {
    id,
    testId: "t1",
    scenarioId: id,
    mode: "automated",
    status: "completed",
    outcome: "completed",
    startedAt: "2026-07-04T12:00:00Z",
    turns: 4,
    toolCalls: 3,
    peakContextTokens: 5000,
    tokensIn: 1000,
    tokensOut: 200,
    costUsd: 0.01,
    ...over,
  };
}

function ws(id: string, letter: string, over: Partial<WorkspaceRun> = {}): WorkspaceRun {
  return {
    id,
    index: 0,
    letter,
    color: "var(--chart-1)",
    isBaseline: letter === "A",
    run: runSummary(id),
    scenarioName: `Env ${letter}`,
    model: "gpt-4o",
    providerLabel: "",
    statusLabel: "Completed",
    ...over,
  };
}

function sum(id: string, letter: string, over: Partial<SummaryRun> = {}): SummaryRun {
  return {
    id,
    index: 0,
    letter,
    color: "var(--chart-1)",
    isBaseline: letter === "A",
    scenarioName: `Env ${letter}`,
    model: "gpt-4o",
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
    costUsd: 0.01,
    durationMs: 4000,
    peakContextTokens: 5000,
    contextLimit: 100_000,
    peakContextPercent: 5,
    peakSegments: { system: 0, tool_defs: 0, history: 0, tool_results: 0, output: 0 },
    contextTotals: [1000, 2000],
    qualityScore: null,
    ...over,
  };
}

function scenario(id: string, loading: "eager" | "deferred"): Scenario {
  return { id, allowedServers: [], toolLoadingMode: loading } as unknown as Scenario;
}

function data(scenarios: Array<[string, Scenario]>): CompareData {
  return {
    runs: [],
    runsById: new Map(),
    testsById: new Map(),
    scenariosById: new Map(scenarios),
    providers: [],
    scans: [],
  };
}

function input(over: Partial<NextStepsInput>): NextStepsInput {
  return {
    workspaceRuns: [],
    summaryRuns: [],
    data: data([]),
    stepsById: new Map(),
    skillsById: new Map(),
    ...over,
  };
}

describe("deriveNextSteps", () => {
  it("returns nothing for fewer than two runs", () => {
    expect(
      deriveNextSteps(input({ workspaceRuns: [ws("a", "A")], summaryRuns: [sum("a", "A")] })),
    ).toEqual([]);
  });

  it("returns nothing for two clean, unremarkable runs — no guaranteed floor card", () => {
    // Export used to be a guaranteed floor rule; it was removed (S2 — the compare bar's Export split
    // button is the one canonical export action) so a clean comparison with nothing to flag renders
    // zero next steps, not a padded "save this comparison" card.
    const steps = deriveNextSteps(
      input({
        workspaceRuns: [ws("a", "A"), ws("b", "B")],
        summaryRuns: [sum("a", "A"), sum("b", "B")],
      }),
    );
    expect(steps).toEqual([]);
  });

  it("never includes an export action — the bar's Export split button is canonical (S2)", () => {
    const steps = deriveNextSteps(
      input({
        workspaceRuns: [ws("a", "A"), ws("b", "B")],
        summaryRuns: [
          sum("a", "A", { abnormal: true, statusLabel: "Stopped by you" }),
          sum("b", "B", { abnormal: true, statusLabel: "Stopped by you" }),
        ],
      }),
    );
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.every((s) => s.action.kind === "link")).toBe(true);
    expect(steps.some((s) => s.id === "export-baseline")).toBe(false);
  });

  it("fires the deferred-loading-win rule with the token savings", () => {
    const steps = deriveNextSteps(
      input({
        workspaceRuns: [ws("a", "A"), ws("b", "B")],
        summaryRuns: [sum("a", "A", { totalTokens: 2000 }), sum("b", "B", { totalTokens: 1200 })],
        data: data([
          ["a", scenario("a", "eager")],
          ["b", scenario("b", "deferred")],
        ]),
      }),
    );
    const win = steps.find((s) => s.id === "deferred-loading-win");
    expect(win).toBeTruthy();
    expect(win?.tone).toBe("recommend");
    expect(win?.title).toContain("800");
    expect(win?.action).toEqual({
      kind: "link",
      to: "/testing/environments",
      label: "Open environment editor",
    });
  });

  it("does NOT fire deferred-loading-win when the deferred run used MORE tokens", () => {
    const steps = deriveNextSteps(
      input({
        workspaceRuns: [ws("a", "A"), ws("b", "B")],
        summaryRuns: [sum("a", "A", { totalTokens: 1200 }), sum("b", "B", { totalTokens: 2000 })],
        data: data([
          ["a", scenario("a", "eager")],
          ["b", scenario("b", "deferred")],
        ]),
      }),
    );
    expect(steps.some((s) => s.id === "deferred-loading-win")).toBe(false);
  });

  it("fires the failing-tool rule and links the server's playground", () => {
    const failStep = {
      id: "s1",
      type: "tool_result",
      status: "error",
      toolName: "acme_create_data_object",
      serverId: "srv-1",
    } as unknown as RunStep;
    const steps = deriveNextSteps(
      input({
        workspaceRuns: [ws("a", "A"), ws("b", "B")],
        summaryRuns: [sum("a", "A"), sum("b", "B")],
        stepsById: new Map([
          ["a", [failStep]],
          ["b", [failStep]],
        ]),
      }),
    );
    const fail = steps.find((s) => s.id === "failing-tool");
    expect(fail).toBeTruthy();
    expect(fail?.title).toContain("acme_create_data_object");
    expect(fail?.action).toEqual({
      kind: "link",
      to: "/servers/srv-1",
      label: "Test in playground",
    });
  });

  it("fires the unused-skill rule for a non-eager skill with zero disclosure reads", () => {
    const skill = {
      skillId: "sk1",
      name: "Banking Analyst",
      versionLabel: "v2",
      eager: false,
      disclosureReads: 0,
      footprint: {
        l1MetadataTokens: 1109,
        l2BodyTokens: 0,
        l3ResourceTokens: 0,
        totalTokens: 1109,
      },
    } as unknown as RunSkill;
    const steps = deriveNextSteps(
      input({
        workspaceRuns: [ws("a", "A"), ws("b", "B")],
        summaryRuns: [sum("a", "A"), sum("b", "B")],
        skillsById: new Map([["a", [skill]]]),
      }),
    );
    const unused = steps.find((s) => s.id === "unused-skill");
    expect(unused).toBeTruthy();
    expect(unused?.title).toContain("Banking Analyst");
    expect(unused?.body).toContain("1,109");
    expect(unused?.action).toEqual({
      kind: "link",
      to: "/skills/sk1",
      label: "Open SkillFlow trace",
    });
  });

  it("does NOT fire unused-skill for an eager skill (inlined on purpose)", () => {
    const eagerSkill = {
      skillId: "sk1",
      name: "Banking",
      versionLabel: "v1",
      eager: true,
      disclosureReads: 0,
      footprint: {
        l1MetadataTokens: 900,
        l2BodyTokens: 500,
        l3ResourceTokens: 0,
        totalTokens: 1400,
      },
    } as unknown as RunSkill;
    const steps = deriveNextSteps(
      input({
        workspaceRuns: [ws("a", "A"), ws("b", "B")],
        summaryRuns: [sum("a", "A"), sum("b", "B")],
        skillsById: new Map([["a", [eagerSkill]]]),
      }),
    );
    expect(steps.some((s) => s.id === "unused-skill")).toBe(false);
  });

  it("fires the all-abnormal rule when every run stopped abnormally", () => {
    const steps = deriveNextSteps(
      input({
        workspaceRuns: [ws("a", "A"), ws("b", "B")],
        summaryRuns: [
          sum("a", "A", { abnormal: true, statusLabel: "Stopped by you" }),
          sum("b", "B", { abnormal: true, statusLabel: "Stopped by you" }),
        ],
      }),
    );
    expect(steps.some((s) => s.id === "all-abnormal")).toBe(true);
  });
});
