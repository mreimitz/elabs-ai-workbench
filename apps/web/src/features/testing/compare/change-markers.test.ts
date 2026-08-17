import { describe, expect, it } from "vitest";
import type { RunSkill, RunSummary, Scenario, ScanSummary } from "@mcp-token-footprint/shared";
import { deriveChangeMarkers, type CompareData, type WorkspaceRun } from "./compare-runs";

// Minimal fixtures — deriveChangeMarkers only reads scenariosById (allowedServers + toolLoadingMode),
// data.scans, and the per-run skill map, so the unread fields are filled just enough to satisfy the
// types (cast through `unknown` for the wide wire shapes we don't exercise).

function runSummary(over: Partial<RunSummary> = {}): RunSummary {
  return {
    id: "r",
    testId: "t1",
    scenarioId: "sc1",
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

function ws(
  over: Partial<WorkspaceRun> & { id: string },
  run: Partial<RunSummary> = {},
): WorkspaceRun {
  return {
    index: 0,
    letter: "A",
    color: "var(--chart-1)",
    isBaseline: false,
    scenarioName: "Env",
    model: "gpt-4o",
    providerLabel: "",
    statusLabel: "Completed",
    ...over,
    run: runSummary({ id: over.id, scenarioId: over.id, ...run }),
  };
}

function scenario(id: string, servers: string[], loading: "eager" | "deferred"): Scenario {
  return {
    id,
    allowedServers: servers.map((serverId) => ({ serverId, allowedTools: null })),
    toolLoadingMode: loading,
  } as unknown as Scenario;
}

function scan(
  over: Partial<ScanSummary> & { id: string; serverId: string; scannedAt: string },
): ScanSummary {
  return {
    serverName: over.serverId,
    status: "success",
    totalTools: 5,
    ...over,
  } as unknown as ScanSummary;
}

function data(over: Partial<CompareData> = {}): CompareData {
  return {
    runs: [],
    runsById: new Map(),
    testsById: new Map(),
    scenariosById: new Map(),
    providers: [],
    scans: [],
    ...over,
  };
}

const noSkills = new Map<string, RunSkill[]>();

describe("deriveChangeMarkers", () => {
  it("returns nothing for fewer than two runs", () => {
    expect(deriveChangeMarkers([ws({ id: "a" })], data(), noSkills)).toEqual([]);
  });

  it("flags a model difference and links the environment editor", () => {
    const runs = [ws({ id: "a", model: "gpt-4o" }), ws({ id: "b", model: "claude-3" })];
    const markers = deriveChangeMarkers(runs, data(), noSkills);
    const model = markers.find((m) => m.kind === "model");
    expect(model).toBeTruthy();
    expect(model?.label).toContain("gpt-4o");
    expect(model?.label).toContain("claude-3");
    expect(model?.href).toBe("/testing/environments");
  });

  it("flags an eager → deferred tool-loading difference", () => {
    const runs = [ws({ id: "a", model: "m" }), ws({ id: "b", model: "m" })];
    const scenariosById = new Map<string, Scenario>([
      ["a", scenario("a", ["s1"], "eager")],
      ["b", scenario("b", ["s1"], "deferred")],
    ]);
    const markers = deriveChangeMarkers(runs, data({ scenariosById }), noSkills);
    const loading = markers.find((m) => m.kind === "loading");
    expect(loading).toBeTruthy();
    expect(loading?.label.toLowerCase()).toContain("eager");
    expect(loading?.label.toLowerCase()).toContain("deferred");
  });

  it("flags a server re-scanned between the two runs and pre-fills the scan diff", () => {
    const runs = [
      ws({ id: "a", model: "m" }, { startedAt: "2026-07-04T12:00:00Z" }),
      ws({ id: "b", model: "m" }, { startedAt: "2026-07-05T12:00:00Z" }),
    ];
    const scenariosById = new Map<string, Scenario>([
      ["a", scenario("a", ["s1"], "eager")],
      ["b", scenario("b", ["s1"], "eager")],
    ]);
    const scans = [
      scan({
        id: "scanA",
        serverId: "s1",
        serverName: "acme-stage",
        scannedAt: "2026-07-04T06:00:00Z",
        totalTools: 5,
      }),
      scan({
        id: "scanB",
        serverId: "s1",
        serverName: "acme-stage",
        scannedAt: "2026-07-05T06:00:00Z",
        totalTools: 7,
      }),
    ];
    const markers = deriveChangeMarkers(runs, data({ scenariosById, scans }), noSkills);
    const serverScan = markers.find((m) => m.kind === "server-scan");
    expect(serverScan).toBeTruthy();
    expect(serverScan?.label).toContain("acme-stage");
    expect(serverScan?.label).toContain("+2 tools");
    expect(serverScan?.href).toBe("/compare/scans?serverA=s1&serverB=s1&scanA=scanA&scanB=scanB");
  });

  it("does NOT flag a server scan when both runs resolve to the same scan", () => {
    const runs = [
      ws({ id: "a", model: "m" }, { startedAt: "2026-07-05T12:00:00Z" }),
      ws({ id: "b", model: "m" }, { startedAt: "2026-07-05T13:00:00Z" }),
    ];
    const scenariosById = new Map<string, Scenario>([
      ["a", scenario("a", ["s1"], "eager")],
      ["b", scenario("b", ["s1"], "eager")],
    ]);
    const scans = [
      scan({ id: "scanA", serverId: "s1", scannedAt: "2026-07-04T06:00:00Z", totalTools: 5 }),
      scan({ id: "scanB", serverId: "s1", scannedAt: "2026-07-05T06:00:00Z", totalTools: 7 }),
    ];
    // Both runs started after scanB → same as-of scan → no marker.
    expect(
      deriveChangeMarkers(runs, data({ scenariosById, scans }), noSkills).some(
        (m) => m.kind === "server-scan",
      ),
    ).toBe(false);
  });

  it("flags a skill resolved to different versions across the runs and links the skill", () => {
    const runs = [ws({ id: "a", model: "m" }), ws({ id: "b", model: "m" })];
    const skillsByRun = new Map<string, RunSkill[]>([
      ["a", [{ skillId: "sk1", name: "Banking", versionLabel: "v1" } as unknown as RunSkill]],
      ["b", [{ skillId: "sk1", name: "Banking", versionLabel: "v2" } as unknown as RunSkill]],
    ]);
    const markers = deriveChangeMarkers(runs, data(), skillsByRun);
    const skill = markers.find((m) => m.kind === "skill-version");
    expect(skill).toBeTruthy();
    expect(skill?.label).toContain("Banking");
    expect(skill?.label).toContain("v1");
    expect(skill?.label).toContain("v2");
    expect(skill?.href).toBe("/skills/sk1");
  });
});
