import assert from "node:assert/strict";
import { test } from "node:test";
import {
  advisorReportSchema,
  type AdvisorRecommendation,
  type AdvisorReport,
  type AdvisorScope,
  type RunSummary,
  type ScanDetail,
  type Scenario,
  type ServerConfig,
  type ToolScan,
} from "@mcp-token-footprint/shared";
import { runAdvisor } from "../src/advisor/engine.js";
import {
  DESCRIPTION_BLOAT_RULE_ID,
  descriptionBloatRule,
} from "../src/advisor/rules/description-bloat.js";
import {
  LOADING_MODE_RULE_ID,
  loadingModeComparisonRule,
} from "../src/advisor/rules/loading-mode.js";
import { TOOL_OVERLAP_RULE_ID, toolOverlapRule } from "../src/advisor/rules/tool-overlap.js";
import {
  UNUSED_TOOL_TRIM_RULE_ID,
  unusedToolTrimRule,
} from "../src/advisor/rules/unused-tool-trim.js";
import { ADVISOR_RULES } from "../src/advisor/registry.js";
import type { AdvisorContext } from "../src/advisor/types.js";

// WP 1.2 (Advisor) — the four deterministic rules, over fixed in-memory fixtures.
//
// EVERY savings number below is hand-computed IN THE TEST as an expression a reviewer can check by
// eye against the fixture (e.g. `260 + 240`), never pasted from a run of the implementation. If the
// arithmetic ever changes, these expressions have to be re-derived by hand — which is the point.

const FIXED_CLOCK = new Date("2026-08-18T09:30:00.000Z");

// ── Fixture builders ─────────────────────────────────────────────────────────────────────────────

function server(id: string, name: string): ServerConfig {
  return {
    id,
    name,
    transport: "stdio",
    command: "node",
    args: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    hasEnvSecrets: false,
    hasHeaderSecrets: false,
    authType: "none",
  };
}

type ToolSpec = {
  name: string;
  totalTokens: number;
  descriptionTokens?: number;
  description?: string;
};

function tool(scanId: string, spec: ToolSpec): ToolScan {
  const descriptionTokens = spec.descriptionTokens ?? 0;
  return {
    id: `${scanId}:${spec.name}`,
    scanId,
    toolName: spec.name,
    ...(spec.description === undefined ? {} : { description: spec.description }),
    rawTool: {},
    totalTokens: spec.totalTokens,
    nameTokens: 2,
    descriptionTokens,
    schemaTokens: Math.max(spec.totalTokens - descriptionTokens - 2, 0),
    annotationsTokens: 0,
    rawBytes: spec.totalTokens * 4,
    contributionPercent: 0,
  };
}

function scan(
  id: string,
  serverId: string,
  serverName: string,
  tools: ToolSpec[],
  overrides: Partial<ScanDetail> = {},
): ScanDetail {
  const built = tools.map((spec) => tool(id, spec));
  const totalTokens = built.reduce((sum, t) => sum + t.totalTokens, 0);
  return {
    id,
    serverId,
    serverName,
    tokenProfile: "generic_o200k",
    scannedAt: "2026-08-01T00:00:00.000Z",
    status: "success",
    totalTools: built.length,
    totalTokens,
    totalRawBytes: totalTokens * 4,
    averageTokensPerTool: built.length === 0 ? 0 : totalTokens / built.length,
    largestToolTokens: built.reduce((max, t) => Math.max(max, t.totalTokens), 0),
    totalResources: 0,
    totalResourceTemplates: 0,
    totalPrompts: 0,
    totalResourceTokens: 0,
    totalPromptTokens: 0,
    largestResourceTokens: 0,
    largestPromptTokens: 0,
    countingVersion: 2,
    tools: built,
    resources: [],
    prompts: [],
    events: [],
    ...overrides,
  };
}

function scenario(
  id: string,
  name: string,
  allowedServers: Scenario["allowedServers"],
  overrides: Partial<Scenario> = {},
): Scenario {
  return {
    id,
    name,
    providerId: "prov-1",
    model: "gpt-4o",
    params: {},
    systemPrompt: "you are a test agent",
    allowedServers,
    allowedSkills: [],
    defaultProfiles: [],
    guardrails: {},
    toolLoadingMode: "eager",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function run(id: string, scenarioId: string, overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    id,
    testId: "test-1",
    scenarioId,
    mode: "automated",
    status: "completed",
    startedAt: "2026-08-02T00:00:00.000Z",
    turns: 1,
    toolCalls: 0,
    peakContextTokens: 0,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    ...overrides,
  };
}

type Fixture = {
  servers: ServerConfig[];
  scans: ScanDetail[];
  scenarios: Scenario[];
  runs: RunSummary[];
  /** runId → the ordered tool-call names of that run (what `getToolCallSequence` returns). */
  toolCalls: Record<string, string[]>;
};

function makeContext(fixture: Partial<Fixture>): AdvisorContext {
  const servers = fixture.servers ?? [];
  const scans = fixture.scans ?? [];
  const scenarios = fixture.scenarios ?? [];
  const runs = fixture.runs ?? [];
  const toolCalls = fixture.toolCalls ?? {};

  const notFound = (what: string, id: string): never => {
    const error = new Error(`${what} not found`) as Error & { statusCode: number };
    error.statusCode = 404;
    throw error;
  };

  return {
    servers: {
      list: () => servers,
      getPublic: (id) => servers.find((s) => s.id === id) ?? notFound("Server", id),
    },
    scans: {
      listSummariesByServer: (serverId) => scans.filter((s) => s.serverId === serverId),
      getLatestForServer: (serverId) => scans.filter((s) => s.serverId === serverId).at(0) ?? null,
      getDetail: (scanId) => scans.find((s) => s.id === scanId) ?? notFound("Scan", scanId),
    },
    scenarios: {
      list: () => scenarios,
      get: (id) => scenarios.find((s) => s.id === id) ?? notFound("Scenario", id),
      listServers: (scenarioId) => scenarios.find((s) => s.id === scenarioId)?.allowedServers ?? [],
    },
    runs: {
      listRuns: (filter = {}) =>
        runs.filter(
          (r) =>
            (filter.scenarioId === undefined || r.scenarioId === filter.scenarioId) &&
            (filter.status === undefined || r.status === filter.status) &&
            (filter.testId === undefined || r.testId === filter.testId),
        ),
      getRun: (runId) => notFound("Run", runId),
      getToolCallSequence: (runId) => toolCalls[runId] ?? [],
      getSummary: (runId) => runs.find((r) => r.id === runId) ?? notFound("Run", runId),
      getRunSkills: () => [],
    },
    // WP 2.1 — the grade-aware ports answer with NOTHING here. `advisor-grade-rules.test.ts` owns
    // the fixtures that populate them; this file's four deterministic rules must never read one, and
    // the three grade-aware rules must produce honest gaps over an empty grade model.
    grades: { listByRun: () => [] },
    suiteRuns: { listRuns: () => [], listChildRunIds: () => [] },
    skills: { list: () => [] },
    models: { get: () => null },
    now: () => FIXED_CLOCK,
  };
}

const SCENARIO_SCOPE = (id: string): AdvisorScope => ({ kind: "scenario", id });
const SERVER_SCOPE = (id: string): AdvisorScope => ({ kind: "server", id });
const FLEET: AdvisorScope = { kind: "fleet" };

function report(ctx: AdvisorContext, scope: AdvisorScope, rule = ADVISOR_RULES): AdvisorReport {
  return runAdvisor(ctx, scope, { rules: rule });
}

function only(recommendations: AdvisorRecommendation[], ruleId: string): AdvisorRecommendation[] {
  return recommendations.filter((rec) => rec.ruleId === ruleId);
}

// ── Registry ─────────────────────────────────────────────────────────────────────────────────────

test("the four deterministic rules lead the registry, in the documented order", () => {
  // WP 2.1 APPENDED three grade-aware rules after these four (see `advisor-grade-rules.test.ts`,
  // which pins the full seven-rule list). What this file locks is that the Phase 1 rules keep their
  // relative order and their leading position — that position is their precedence in the engine's
  // first-wins dedup, so appending must never reshuffle them.
  assert.deepEqual(
    ADVISOR_RULES.slice(0, 4).map((rule) => rule.id),
    [
      UNUSED_TOOL_TRIM_RULE_ID,
      DESCRIPTION_BLOAT_RULE_ID,
      LOADING_MODE_RULE_ID,
      TOOL_OVERLAP_RULE_ID,
    ],
  );
  // None of the four reads grades, so none of them may stamp grade provenance.
  for (const rule of ADVISOR_RULES.slice(0, 4)) assert.notEqual(rule.gradeAware, true);
});

// ── Rule 1 — unused-tool trim ────────────────────────────────────────────────────────────────────

/**
 * One environment, one server, four tools. Two are called; two never are.
 *
 *   search  400 tokens  called
 *   fetch   300 tokens  called
 *   admin   260 tokens  NEVER
 *   purge   240 tokens  NEVER
 */
function unusedToolFixture(scenarioOverrides: Partial<Scenario> = {}): AdvisorContext {
  return makeContext({
    servers: [server("srv-1", "Docs server")],
    scans: [
      scan("scan-1", "srv-1", "Docs server", [
        { name: "search", totalTokens: 400 },
        { name: "fetch", totalTokens: 300 },
        { name: "admin", totalTokens: 260 },
        { name: "purge", totalTokens: 240 },
      ]),
    ],
    scenarios: [
      scenario("scn-1", "Docs env", [{ serverId: "srv-1", allowedTools: null }], scenarioOverrides),
    ],
    runs: [run("run-1", "scn-1"), run("run-2", "scn-1")],
    toolCalls: { "run-1": ["search", "search", "fetch"], "run-2": ["search"] },
  });
}

test("unused-tool trim: savings are the never-called tools' definition tokens, per turn", () => {
  const result = report(unusedToolFixture(), SCENARIO_SCOPE("scn-1"), [unusedToolTrimRule]);
  const [rec] = result.recommendations;

  assert.equal(result.recommendations.length, 1);
  assert.equal(rec?.ruleId, UNUSED_TOOL_TRIM_RULE_ID);
  assert.equal(rec?.id, "advisor.unused-tool-trim:scn-1:srv-1");

  // HAND-COMPUTED: the two never-called tools are `admin` (260) and `purge` (240).
  assert.equal(rec?.savings?.value, 260 + 240);
  assert.equal(rec?.savings?.unit, "tokens_per_turn");
  assert.equal(rec?.savings?.estimate, true);
  assert.match(
    rec?.savings?.basis ?? "",
    /scan scan-1 \(profile generic_o200k, counting version 2\)/,
  );

  // HAND-COMPUTED severity: wasted share = 500 / (400+300+260+240) = 500/1200 = 41.7% → medium
  // (≥ 20% but < 50%).
  assert.equal(rec?.severity, "medium");
  assert.match(rec?.detail ?? "", /41\.7%/);
  assert.match(rec?.detail ?? "", /Suggested allowedTools: fetch, search\./);

  // Evidence is drillable: the environment, the server, the scan, and each unused tool.
  assert.deepEqual(
    rec?.evidence.map((e) => `${e.kind}:${e.id}`),
    [
      "scenario:scn-1",
      "server:srv-1",
      "scan:scan-1",
      "tool_scan:scan-1:admin",
      "tool_scan:scan-1:purge",
    ],
  );
  assert.equal(advisorReportSchema.safeParse(result).success, true);
});

test("unused-tool trim: a deferred environment reports plain tokens, NOT tokens-per-turn", () => {
  const result = report(
    unusedToolFixture({ toolLoadingMode: "deferred" }),
    SCENARIO_SCOPE("scn-1"),
    [unusedToolTrimRule],
  );
  const savings = result.recommendations[0]?.savings;

  assert.equal(savings?.value, 260 + 240); // same tokens…
  assert.equal(savings?.unit, "tokens"); // …but they do not ride every turn
  assert.match(savings?.basis ?? "", /NOT resident in every turn/);
});

test("unused-tool trim: only allow-listed tools are considered", () => {
  const ctx = makeContext({
    servers: [server("srv-1", "Docs server")],
    scans: [
      scan("scan-1", "srv-1", "Docs server", [
        { name: "search", totalTokens: 400 },
        { name: "admin", totalTokens: 260 },
        { name: "purge", totalTokens: 240 },
      ]),
    ],
    // `purge` is not exposed to this environment at all, so it is not part of its footprint.
    scenarios: [
      scenario("scn-1", "Docs env", [{ serverId: "srv-1", allowedTools: ["search", "admin"] }]),
    ],
    runs: [run("run-1", "scn-1")],
    toolCalls: { "run-1": ["search"] },
  });

  const [rec] = report(ctx, SCENARIO_SCOPE("scn-1"), [unusedToolTrimRule]).recommendations;
  // HAND-COMPUTED: only `admin` (260) is both allowed and never called. `purge` is out of scope.
  assert.equal(rec?.savings?.value, 260);
  // HAND-COMPUTED severity: 260 / (400 + 260) = 39.4% → medium.
  assert.equal(rec?.severity, "medium");
  assert.match(rec?.detail ?? "", /Never called: admin\./);
});

test("unused-tool trim: a tool called on ANY of the environment's servers counts as used everywhere", () => {
  const ctx = makeContext({
    servers: [server("srv-1", "Alpha"), server("srv-2", "Beta")],
    scans: [
      scan("scan-1", "srv-1", "Alpha", [{ name: "search", totalTokens: 400 }]),
      scan("scan-2", "srv-2", "Beta", [{ name: "search", totalTokens: 900 }]),
    ],
    scenarios: [
      scenario("scn-1", "Both", [
        { serverId: "srv-1", allowedTools: null },
        { serverId: "srv-2", allowedTools: null },
      ]),
    ],
    runs: [run("run-1", "scn-1")],
    toolCalls: { "run-1": ["search"] },
  });

  // The name-keyed match cannot tell WHICH server's `search` ran, so neither is claimed unused.
  // That is the safe direction: it can hide a trim, never invent one.
  assert.deepEqual(report(ctx, SCENARIO_SCOPE("scn-1"), [unusedToolTrimRule]).recommendations, []);
});

test("unused-tool trim: severity crosses to high above a 50% wasted share", () => {
  const ctx = makeContext({
    servers: [server("srv-1", "Docs server")],
    scans: [
      scan("scan-1", "srv-1", "Docs server", [
        { name: "search", totalTokens: 100 },
        { name: "admin", totalTokens: 900 },
      ]),
    ],
    scenarios: [scenario("scn-1", "Docs env", [{ serverId: "srv-1", allowedTools: null }])],
    runs: [run("run-1", "scn-1")],
    toolCalls: { "run-1": ["search"] },
  });

  const [rec] = report(ctx, SCENARIO_SCOPE("scn-1"), [unusedToolTrimRule]).recommendations;
  // HAND-COMPUTED: 900 / (100 + 900) = 90% → high.
  assert.equal(rec?.savings?.value, 900);
  assert.equal(rec?.severity, "high");
});

test("unused-tool trim: no runs → an honest gap naming what is missing, and NO zero-saving finding", () => {
  const ctx = makeContext({
    servers: [server("srv-1", "Docs server")],
    scans: [scan("scan-1", "srv-1", "Docs server", [{ name: "search", totalTokens: 400 }])],
    scenarios: [scenario("scn-1", "Docs env", [{ serverId: "srv-1", allowedTools: null }])],
    runs: [],
  });

  const result = report(ctx, SCENARIO_SCOPE("scn-1"), [unusedToolTrimRule]);
  assert.deepEqual(result.recommendations, []);
  assert.equal(result.insufficientData.length, 1);
  assert.equal(result.insufficientData[0]?.ruleId, UNUSED_TOOL_TRIM_RULE_ID);
  assert.match(result.insufficientData[0]?.reason ?? "", /has no completed runs/);
  // Nothing anywhere in the report stands in for the measurement that could not be taken.
  assert.equal(JSON.stringify(result).includes('"savings"'), false);
});

test("unused-tool trim: runs that made NO tool calls are a gap, not a 100%-waste finding", () => {
  const ctx = makeContext({
    servers: [server("srv-1", "Docs server")],
    scans: [scan("scan-1", "srv-1", "Docs server", [{ name: "search", totalTokens: 400 }])],
    scenarios: [scenario("scn-1", "Docs env", [{ serverId: "srv-1", allowedTools: null }])],
    runs: [run("run-1", "scn-1")],
    toolCalls: { "run-1": [] },
  });

  const result = report(ctx, SCENARIO_SCOPE("scn-1"), [unusedToolTrimRule]);
  assert.deepEqual(result.recommendations, []);
  assert.match(result.insufficientData[0]?.reason ?? "", /no tool calls in any of them/);
});

test("unused-tool trim: only COMPLETED runs are evidence of behavior", () => {
  const ctx = makeContext({
    servers: [server("srv-1", "Docs server")],
    scans: [
      scan("scan-1", "srv-1", "Docs server", [
        { name: "search", totalTokens: 400 },
        { name: "admin", totalTokens: 260 },
      ]),
    ],
    scenarios: [scenario("scn-1", "Docs env", [{ serverId: "srv-1", allowedTools: null }])],
    runs: [
      run("run-ok", "scn-1"),
      run("run-error", "scn-1", { status: "error" }),
      run("run-stopped", "scn-1", { status: "stopped" }),
    ],
    // A stopped run happened to call `admin` — but it never finished, so it says nothing about
    // whether the model would have needed the tool.
    toolCalls: { "run-ok": ["search"], "run-error": ["admin"], "run-stopped": ["admin"] },
  });

  const [rec] = report(ctx, SCENARIO_SCOPE("scn-1"), [unusedToolTrimRule]).recommendations;
  assert.equal(rec?.savings?.value, 260);
  assert.match(rec?.detail ?? "", /Across 1 completed run/);
});

test("unused-tool trim: a server with no successful scan is a gap, not a silent skip", () => {
  const ctx = makeContext({
    servers: [server("srv-1", "Docs server")],
    scans: [scan("scan-failed", "srv-1", "Docs server", [], { status: "failed", totalTokens: 0 })],
    scenarios: [scenario("scn-1", "Docs env", [{ serverId: "srv-1", allowedTools: null }])],
    runs: [run("run-1", "scn-1")],
    toolCalls: { "run-1": ["search"] },
  });

  const result = report(ctx, SCENARIO_SCOPE("scn-1"), [unusedToolTrimRule]);
  assert.deepEqual(result.recommendations, []);
  assert.match(result.insufficientData[0]?.reason ?? "", /has no successful scan/);
});

test("unused-tool trim: the FLEET scope sweeps every environment, ordered deterministically", () => {
  const ctx = makeContext({
    servers: [server("srv-1", "Docs server")],
    scans: [
      scan("scan-1", "srv-1", "Docs server", [
        { name: "search", totalTokens: 400 },
        { name: "admin", totalTokens: 260 },
      ]),
    ],
    scenarios: [
      // Deliberately listed newest-first (as `ScenarioRepository.list()` does) to prove the rule
      // imposes its own order.
      scenario("scn-b", "Env B", [{ serverId: "srv-1", allowedTools: null }]),
      scenario("scn-a", "Env A", [{ serverId: "srv-1", allowedTools: null }]),
    ],
    runs: [run("run-a", "scn-a"), run("run-b", "scn-b")],
    toolCalls: { "run-a": ["search"], "run-b": ["search"] },
  });

  const first = report(ctx, FLEET, [unusedToolTrimRule]);
  const second = report(ctx, FLEET, [unusedToolTrimRule]);
  assert.deepEqual(
    first.recommendations.map((rec) => rec.id),
    ["advisor.unused-tool-trim:scn-a:srv-1", "advisor.unused-tool-trim:scn-b:srv-1"],
  );
  assert.equal(JSON.stringify(first), JSON.stringify(second));
});

test("unused-tool trim: does not apply to a server scope (a server has no runs of its own)", () => {
  assert.equal(unusedToolTrimRule.appliesTo(SERVER_SCOPE("srv-1")), false);
  assert.equal(unusedToolTrimRule.appliesTo(SCENARIO_SCOPE("scn-1")), true);
  assert.equal(unusedToolTrimRule.appliesTo(FLEET), true);
});

// ── Rule 2 — description bloat ───────────────────────────────────────────────────────────────────

/**
 * One server whose two biggest tools are mostly prose.
 *
 *   1. search   1000 tokens, 700 description  → 70% ≥ 50%, 700 ≥ 100  → FLAGGED
 *   2. fetch     800 tokens, 600 description  → 75%                    → FLAGGED
 *   3. compact   500 tokens, 100 description  → 20%                    → not flagged
 *   4. listing   450 tokens,  10 description  → 2%                     → not flagged
 *   5. extra     420 tokens,  10 description  → 2%                     → not flagged
 *   6. sixth     400 tokens, 390 description  → 98%, but OUTSIDE the top 5 → not flagged
 *      tiny       90 tokens,  80 description  → 89%, but only 80 tokens    → not flagged (too small)
 */
function bloatFixture(): AdvisorContext {
  return makeContext({
    servers: [server("srv-1", "Docs server")],
    scans: [
      scan("scan-1", "srv-1", "Docs server", [
        { name: "search", totalTokens: 1000, descriptionTokens: 700 },
        { name: "fetch", totalTokens: 800, descriptionTokens: 600 },
        { name: "compact", totalTokens: 500, descriptionTokens: 100 },
        { name: "listing", totalTokens: 450, descriptionTokens: 10 },
        { name: "extra", totalTokens: 420, descriptionTokens: 10 },
        { name: "sixth", totalTokens: 400, descriptionTokens: 390 },
        { name: "tiny", totalTokens: 90, descriptionTokens: 80 },
      ]),
    ],
  });
}

test("description bloat: savings are the flagged descriptions' tokens (a ceiling, labeled as one)", () => {
  const result = report(bloatFixture(), SERVER_SCOPE("srv-1"), [descriptionBloatRule]);
  const [rec] = result.recommendations;

  assert.equal(result.recommendations.length, 1);
  assert.equal(rec?.id, "advisor.description-bloat:srv-1");
  // HAND-COMPUTED: only `search` (700) and `fetch` (600) clear both bars inside the top 5.
  assert.equal(rec?.savings?.value, 700 + 600);
  assert.equal(rec?.savings?.unit, "tokens");
  assert.match(rec?.savings?.basis ?? "", /CEILING/);

  // HAND-COMPUTED severity: scan total = 1000+800+500+450+420+400+90 = 3660;
  // 1300 / 3660 = 35.5% ≥ 30% → high.
  assert.equal(rec?.severity, "high");
  assert.match(rec?.detail ?? "", /35\.5% of the scan's 3,660 tool tokens/);
  assert.match(rec?.detail ?? "", /search: 1,000 tokens, 700 of them description \(70\.0%\)/);

  assert.deepEqual(
    rec?.evidence.map((e) => `${e.kind}:${e.id}`),
    ["server:srv-1", "scan:scan-1", "tool_scan:scan-1:search", "tool_scan:scan-1:fetch"],
  );
  assert.equal(advisorReportSchema.safeParse(result).success, true);
});

test("description bloat: the 6th-largest tool is out of the window even when it is almost all prose", () => {
  const [rec] = report(bloatFixture(), SERVER_SCOPE("srv-1"), [
    descriptionBloatRule,
  ]).recommendations;
  assert.equal(rec?.detail.includes("sixth"), false);
  assert.equal(rec?.detail.includes("tiny"), false);
});

test("description bloat: a schema-heavy server produces NO finding (and no fabricated gap)", () => {
  const ctx = makeContext({
    servers: [server("srv-1", "Schema server")],
    scans: [
      scan("scan-1", "srv-1", "Schema server", [
        { name: "search", totalTokens: 1000, descriptionTokens: 200 },
        { name: "fetch", totalTokens: 800, descriptionTokens: 50 },
      ]),
    ],
  });

  const result = report(ctx, SERVER_SCOPE("srv-1"), [descriptionBloatRule]);
  assert.deepEqual(result.recommendations, []);
  assert.deepEqual(result.insufficientData, []);
});

test("description bloat: an environment scope adds real call counts to each flagged tool", () => {
  const ctx = makeContext({
    servers: [server("srv-1", "Docs server")],
    scans: [
      scan("scan-1", "srv-1", "Docs server", [
        { name: "search", totalTokens: 1000, descriptionTokens: 700 },
        { name: "fetch", totalTokens: 800, descriptionTokens: 600 },
      ]),
    ],
    scenarios: [scenario("scn-1", "Docs env", [{ serverId: "srv-1", allowedTools: null }])],
    runs: [run("run-1", "scn-1"), run("run-2", "scn-1")],
    toolCalls: { "run-1": ["search", "search"], "run-2": ["search"] },
  });

  const [rec] = report(ctx, SCENARIO_SCOPE("scn-1"), [descriptionBloatRule]).recommendations;
  // HAND-COMPUTED: `search` was called 2 + 1 = 3 times; `fetch` never.
  assert.match(rec?.detail ?? "", /search: .*called 3 times in 2 completed runs/);
  assert.match(rec?.detail ?? "", /fetch: .*called 0 times in 2 completed runs/);
  // …and the savings arithmetic is unchanged by the enrichment.
  assert.equal(rec?.savings?.value, 700 + 600);
  assert.ok(rec?.evidence.some((e) => e.kind === "scenario" && e.id === "scn-1"));
});

test("description bloat: a server with no successful scan is an honest gap", () => {
  const ctx = makeContext({
    servers: [server("srv-1", "Docs server")],
    scans: [scan("scan-run", "srv-1", "Docs server", [], { status: "running", totalTokens: 0 })],
  });

  const result = report(ctx, SERVER_SCOPE("srv-1"), [descriptionBloatRule]);
  assert.deepEqual(result.recommendations, []);
  assert.match(result.insufficientData[0]?.reason ?? "", /has no successful scan/);
});

test("description bloat: the latest SUCCESSFUL scan wins over a newer failed one", () => {
  const ctx = makeContext({
    servers: [server("srv-1", "Docs server")],
    scans: [
      scan("scan-new-failed", "srv-1", "Docs server", [], {
        status: "failed",
        scannedAt: "2026-08-10T00:00:00.000Z",
        totalTokens: 0,
      }),
      scan(
        "scan-old-ok",
        "srv-1",
        "Docs server",
        [{ name: "search", totalTokens: 1000, descriptionTokens: 700 }],
        { scannedAt: "2026-08-05T00:00:00.000Z" },
      ),
    ],
  });

  const [rec] = report(ctx, SERVER_SCOPE("srv-1"), [descriptionBloatRule]).recommendations;
  assert.equal(rec?.savings?.value, 700);
  assert.ok(rec?.evidence.some((e) => e.kind === "scan" && e.id === "scan-old-ok"));
});

// ── Rule 3 — loading-mode comparison ─────────────────────────────────────────────────────────────

/**
 * The trap: `tool_loading_mode` lives ONLY on `scenarios` and is mutable, and no run records the
 * mode it ran under. So the rule compares two DIFFERENT environments and counts only runs that
 * started strictly after each environment's own last edit.
 *
 *   scn-eager   (eager,    edited 2026-08-01)  runs of test-1 and test-2 on 2026-08-05
 *   scn-defer   (deferred, edited 2026-08-01)  runs of test-1 and test-2 on 2026-08-05
 */
function loadingModeFixture(overrides: { staleRun?: boolean } = {}): AdvisorContext {
  const runs: RunSummary[] = [
    run("run-e1", "scn-eager", {
      testId: "test-1",
      startedAt: "2026-08-05T00:00:00.000Z",
      turns: 3,
      tokensIn: 9000,
      peakContextTokens: 6000,
      costUsd: 0.02,
    }),
    run("run-e2", "scn-eager", {
      testId: "test-2",
      startedAt: "2026-08-05T01:00:00.000Z",
      turns: 3,
      tokensIn: 9000,
      peakContextTokens: 6000,
      costUsd: 0.02,
    }),
    run("run-d1", "scn-defer", {
      testId: "test-1",
      startedAt: "2026-08-05T00:00:00.000Z",
      turns: 2,
      tokensIn: 2000,
      peakContextTokens: 1500,
      costUsd: 0.005,
    }),
    run("run-d2", "scn-defer", {
      testId: "test-2",
      startedAt: "2026-08-05T01:00:00.000Z",
      turns: 2,
      tokensIn: 2000,
      peakContextTokens: 1500,
      costUsd: 0.005,
    }),
  ];
  if (overrides.staleRun) {
    // A run from BEFORE the environment's last edit: enormous, and deliberately ignored.
    runs.push(
      run("run-e-stale", "scn-eager", {
        testId: "test-1",
        startedAt: "2026-07-01T00:00:00.000Z",
        turns: 1,
        tokensIn: 999_999,
        peakContextTokens: 999_999,
        costUsd: 9.99,
      }),
    );
  }

  return makeContext({
    scenarios: [
      scenario("scn-eager", "Eager env", [], {
        toolLoadingMode: "eager",
        updatedAt: "2026-08-01T00:00:00.000Z",
      }),
      scenario("scn-defer", "Deferred env", [], {
        toolLoadingMode: "deferred",
        updatedAt: "2026-08-01T00:00:00.000Z",
      }),
    ],
    runs,
  });
}

test("loading mode: the per-turn saving is the difference of the two sides' mean prompt tokens", () => {
  const result = report(loadingModeFixture(), FLEET, [loadingModeComparisonRule]);
  const [rec] = result.recommendations;

  assert.equal(result.recommendations.length, 1);
  assert.equal(rec?.id, "advisor.loading-mode-comparison:scn-eager:scn-defer");
  // HAND-COMPUTED: eager (9000 + 9000) / (3 + 3) = 3000 tokens/turn;
  //                deferred (2000 + 2000) / (2 + 2) = 1000 tokens/turn; difference 2000.
  assert.equal(rec?.savings?.value, (9000 + 9000) / (3 + 3) - (2000 + 2000) / (2 + 2));
  assert.equal(rec?.savings?.value, 2000);
  assert.equal(rec?.savings?.unit, "tokens_per_turn");
  assert.equal(rec?.severity, "medium");
  // HAND-COMPUTED means: peak context 6000 vs 1500; cost (0.02+0.02)/2 = 0.0200 vs 0.0050.
  assert.match(rec?.detail ?? "", /Mean peak context: 6,000 vs 1,500 tokens/);
  assert.match(rec?.detail ?? "", /Mean cost per run: \$0\.0200 vs \$0\.0050/);
  assert.equal(advisorReportSchema.safeParse(result).success, true);
});

test("loading mode: a run from BEFORE the environment's last edit is excluded, not attributed", () => {
  const withStale = report(loadingModeFixture({ staleRun: true }), FLEET, [
    loadingModeComparisonRule,
  ]);
  const without = report(loadingModeFixture(), FLEET, [loadingModeComparisonRule]);

  // The 999,999-token pre-edit run would have swamped the eager side had it been counted.
  assert.equal(withStale.recommendations[0]?.savings?.value, 2000);
  assert.equal(
    JSON.stringify(withStale.recommendations[0]?.savings),
    JSON.stringify(without.recommendations[0]?.savings),
  );
});

test("loading mode: an environment whose runs ALL predate its last edit yields a gap, never a comparison", () => {
  const ctx = makeContext({
    scenarios: [
      scenario("scn-eager", "Eager env", [], {
        toolLoadingMode: "eager",
        // Edited AFTER every run below — so no run can be attributed to the current mode.
        updatedAt: "2026-08-09T00:00:00.000Z",
      }),
      scenario("scn-defer", "Deferred env", [], {
        toolLoadingMode: "deferred",
        updatedAt: "2026-08-01T00:00:00.000Z",
      }),
    ],
    runs: [
      run("run-e1", "scn-eager", { startedAt: "2026-08-05T00:00:00.000Z", turns: 3, tokensIn: 9 }),
      run("run-d1", "scn-defer", { startedAt: "2026-08-05T00:00:00.000Z", turns: 2, tokensIn: 2 }),
    ],
  });

  const result = report(ctx, SCENARIO_SCOPE("scn-eager"), [loadingModeComparisonRule]);
  assert.deepEqual(result.recommendations, []);
  assert.equal(result.insufficientData.length, 1);
  assert.match(
    result.insufficientData[0]?.reason ?? "",
    /no completed runs that started after it was last edited/,
  );
  assert.match(result.insufficientData[0]?.reason ?? "", /the mode is never recorded on a run/);
});

test("loading mode: two environments on DIFFERENT models are never compared", () => {
  const ctx = makeContext({
    scenarios: [
      scenario("scn-eager", "Eager env", [], {
        model: "gpt-4o",
        updatedAt: "2026-08-01T00:00:00.000Z",
      }),
      scenario("scn-defer", "Deferred env", [], {
        model: "claude-sonnet-4",
        toolLoadingMode: "deferred",
        updatedAt: "2026-08-01T00:00:00.000Z",
      }),
    ],
    runs: [
      run("run-e1", "scn-eager", { startedAt: "2026-08-05T00:00:00.000Z", turns: 3, tokensIn: 9 }),
      run("run-d1", "scn-defer", { startedAt: "2026-08-05T00:00:00.000Z", turns: 2, tokensIn: 2 }),
    ],
  });

  const result = report(ctx, FLEET, [loadingModeComparisonRule]);
  assert.deepEqual(result.recommendations, []);
  assert.match(result.insufficientData[0]?.reason ?? "", /no two environments on the same model/);
});

test("loading mode: only the tests BOTH environments have run are compared", () => {
  const ctx = makeContext({
    scenarios: [
      scenario("scn-eager", "Eager env", [], { updatedAt: "2026-08-01T00:00:00.000Z" }),
      scenario("scn-defer", "Deferred env", [], {
        toolLoadingMode: "deferred",
        updatedAt: "2026-08-01T00:00:00.000Z",
      }),
    ],
    runs: [
      run("run-e1", "scn-eager", {
        testId: "shared",
        startedAt: "2026-08-05T00:00:00.000Z",
        turns: 2,
        tokensIn: 4000,
      }),
      // Only the eager side ever ran `eager-only`; counting it would compare different work.
      run("run-e2", "scn-eager", {
        testId: "eager-only",
        startedAt: "2026-08-05T01:00:00.000Z",
        turns: 10,
        tokensIn: 500_000,
      }),
      run("run-d1", "scn-defer", {
        testId: "shared",
        startedAt: "2026-08-05T00:00:00.000Z",
        turns: 2,
        tokensIn: 1000,
      }),
    ],
  });

  const [rec] = report(ctx, FLEET, [loadingModeComparisonRule]).recommendations;
  // HAND-COMPUTED over the ONE shared test: eager 4000/2 = 2000, deferred 1000/2 = 500 → 1500.
  assert.equal(rec?.savings?.value, 4000 / 2 - 1000 / 2);
  assert.equal(rec?.savings?.value, 1500);
  assert.match(rec?.detail ?? "", /over the 1 test both have run/);
});

test("loading mode: when deferred is NOT cheaper, no saving is claimed", () => {
  const ctx = makeContext({
    scenarios: [
      scenario("scn-eager", "Eager env", [], { updatedAt: "2026-08-01T00:00:00.000Z" }),
      scenario("scn-defer", "Deferred env", [], {
        toolLoadingMode: "deferred",
        updatedAt: "2026-08-01T00:00:00.000Z",
      }),
    ],
    runs: [
      run("run-e1", "scn-eager", {
        startedAt: "2026-08-05T00:00:00.000Z",
        turns: 2,
        tokensIn: 1000,
      }),
      run("run-d1", "scn-defer", {
        startedAt: "2026-08-05T00:00:00.000Z",
        turns: 2,
        tokensIn: 3000,
      }),
    ],
  });

  const [rec] = report(ctx, FLEET, [loadingModeComparisonRule]).recommendations;
  // HAND-COMPUTED: eager 1000/2 = 500, deferred 3000/2 = 1500 → deferred is 1000 MORE expensive.
  assert.equal(rec?.savings, undefined);
  assert.equal(rec?.severity, "info");
  assert.match(rec?.detail ?? "", /Deferred did not read cheaper here/);
});

test("loading mode: every finding states the mutable-mode + not-a-controlled-experiment assumptions", () => {
  const [rec] = report(loadingModeFixture(), FLEET, [loadingModeComparisonRule]).recommendations;
  const assumptions = (rec?.assumptions ?? []).join(" | ");
  assert.match(assumptions, /never recorded on a run/);
  assert.match(assumptions, /not a controlled experiment/);
});

// ── Rule 4 — cross-server tool overlap ───────────────────────────────────────────────────────────

/**
 *   srv-a `search_documents` 300 · `list_files` 150 · `alpha_only` 90
 *   srv-b `search_documents` 280 · `listFiles`  120 · `beta_only`  70
 *
 *   search_documents ↔ search_documents  exact       → min(300, 280) = 280
 *   list_files       ↔ listFiles         normalized  → min(150, 120) = 120
 *   alpha_only / beta_only: no shared tokens at all  → unmatched
 */
function overlapFixture(overrides: Partial<ScanDetail> = {}): AdvisorContext {
  return makeContext({
    servers: [server("srv-a", "Alpha"), server("srv-b", "Beta")],
    scans: [
      scan("scan-a", "srv-a", "Alpha", [
        { name: "search_documents", totalTokens: 300, description: "search the docs" },
        { name: "list_files", totalTokens: 150, description: "list the files" },
        { name: "alpha_only", totalTokens: 90, description: "zzz unique alpha capability" },
      ]),
      scan(
        "scan-b",
        "srv-b",
        "Beta",
        [
          { name: "search_documents", totalTokens: 280, description: "search the docs" },
          { name: "listFiles", totalTokens: 120, description: "list the files" },
          { name: "beta_only", totalTokens: 70, description: "qqq distinct beta feature" },
        ],
        overrides,
      ),
    ],
  });
}

test("overlap: savings sum the SMALLER side of every duplicated pair", () => {
  const result = report(overlapFixture(), FLEET, [toolOverlapRule]);
  const [rec] = result.recommendations;

  assert.equal(result.recommendations.length, 1);
  assert.equal(rec?.id, "advisor.tool-overlap:srv-a:srv-b");
  // HAND-COMPUTED: min(300, 280) + min(150, 120) = 280 + 120.
  assert.equal(rec?.savings?.value, 280 + 120);
  assert.equal(rec?.savings?.value, 400);
  assert.equal(rec?.savings?.unit, "tokens");
  // 2 duplicates < the 3 needed for `medium`.
  assert.equal(rec?.severity, "info");
  assert.match(
    rec?.detail ?? "",
    /search_documents ↔ search_documents \(exact; 300 \/ 280 tokens\)/,
  );
  assert.match(rec?.detail ?? "", /list_files ↔ listFiles \(normalized; 150 \/ 120 tokens\)/);
  assert.equal(rec?.detail.includes("alpha_only"), false);
  assert.equal(advisorReportSchema.safeParse(result).success, true);
});

test("overlap: three or more duplicates raise the severity to medium", () => {
  const ctx = makeContext({
    servers: [server("srv-a", "Alpha"), server("srv-b", "Beta")],
    scans: [
      scan("scan-a", "srv-a", "Alpha", [
        { name: "one", totalTokens: 100 },
        { name: "two", totalTokens: 100 },
        { name: "three", totalTokens: 100 },
      ]),
      scan("scan-b", "srv-b", "Beta", [
        { name: "one", totalTokens: 60 },
        { name: "two", totalTokens: 60 },
        { name: "three", totalTokens: 60 },
      ]),
    ],
  });

  const [rec] = report(ctx, FLEET, [toolOverlapRule]).recommendations;
  // HAND-COMPUTED: three exact pairs, each min(100, 60) = 60 → 180.
  assert.equal(rec?.savings?.value, 60 * 3);
  assert.equal(rec?.severity, "medium");
});

test("overlap: tokens are NEVER summed across two differently-counted scans", () => {
  const ctx = overlapFixture({ countingVersion: 1 });
  const result = report(ctx, FLEET, [toolOverlapRule]);
  const [rec] = result.recommendations;

  // The overlap itself still holds (names/descriptions need no arithmetic)…
  assert.equal(rec?.detail.includes("search_documents ↔ search_documents"), true);
  // …but no token figure is published, and the mismatch is named.
  assert.equal(rec?.savings, undefined);
  assert.match(result.insufficientData[0]?.reason ?? "", /different counting methods/);
  assert.equal(result.insufficientData[0]?.ruleId, TOOL_OVERLAP_RULE_ID);
});

test("overlap: a different token profile is treated the same way as a different counting version", () => {
  const result = report(overlapFixture({ tokenProfile: "generic_cl100k" }), FLEET, [
    toolOverlapRule,
  ]);
  assert.equal(result.recommendations[0]?.savings, undefined);
  assert.match(result.insufficientData[0]?.reason ?? "", /different counting methods/);
});

test("overlap: a server scope compares the named server against every other one, with a stable id", () => {
  const fromServer = report(overlapFixture(), SERVER_SCOPE("srv-b"), [toolOverlapRule]);
  const fromFleet = report(overlapFixture(), FLEET, [toolOverlapRule]);

  // The pair is keyed by ascending server id whichever direction it was found from, so the same
  // finding dedups against itself across scopes.
  assert.equal(fromServer.recommendations[0]?.id, "advisor.tool-overlap:srv-a:srv-b");
  assert.equal(fromServer.recommendations[0]?.id, fromFleet.recommendations[0]?.id);
  assert.equal(fromServer.recommendations[0]?.savings?.value, 400);
});

test("overlap: an environment scope only compares the tools it actually exposes", () => {
  const ctx = makeContext({
    servers: [server("srv-a", "Alpha"), server("srv-b", "Beta")],
    scans: [
      scan("scan-a", "srv-a", "Alpha", [
        { name: "search_documents", totalTokens: 300, description: "search the docs" },
        { name: "list_files", totalTokens: 150, description: "list the files" },
      ]),
      scan("scan-b", "srv-b", "Beta", [
        { name: "search_documents", totalTokens: 280, description: "search the docs" },
        { name: "list_files", totalTokens: 120, description: "list the files" },
      ]),
    ],
    scenarios: [
      scenario("scn-1", "Trimmed env", [
        { serverId: "srv-a", allowedTools: ["search_documents"] },
        { serverId: "srv-b", allowedTools: ["search_documents"] },
      ]),
    ],
  });

  const [rec] = report(ctx, SCENARIO_SCOPE("scn-1"), [toolOverlapRule]).recommendations;
  // HAND-COMPUTED: `list_files` is not exposed to this environment, so only min(300, 280) counts.
  assert.equal(rec?.savings?.value, 280);
  assert.equal(rec?.detail.includes("list_files"), false);
});

test("overlap: fewer than two scanned servers is an honest gap, not an empty success", () => {
  const ctx = makeContext({
    servers: [server("srv-a", "Alpha")],
    scans: [scan("scan-a", "srv-a", "Alpha", [{ name: "search", totalTokens: 100 }])],
  });

  const result = report(ctx, FLEET, [toolOverlapRule]);
  assert.deepEqual(result.recommendations, []);
  assert.match(result.insufficientData[0]?.reason ?? "", /fewer than two/);
});

test("overlap: reuses the shared compare matcher (fuzzy pairing agrees with `similarity`)", async () => {
  const { similarity } = await import("../src/compare/matching.js");
  const ctx = makeContext({
    servers: [server("srv-a", "Alpha"), server("srv-b", "Beta")],
    scans: [
      scan("scan-a", "srv-a", "Alpha", [
        {
          name: "fetch_user_profile",
          totalTokens: 200,
          description: "fetch the user profile record",
        },
      ]),
      scan("scan-b", "srv-b", "Beta", [
        {
          name: "fetch_user_profile_v2",
          totalTokens: 180,
          description: "fetch the user profile record",
        },
      ]),
    ],
  });

  const score = similarity(
    { toolName: "fetch_user_profile", description: "fetch the user profile record" },
    { toolName: "fetch_user_profile_v2", description: "fetch the user profile record" },
  );
  assert.ok(score >= 0.7, `the fixture pair must clear the rule's threshold (got ${score})`);

  const [rec] = report(ctx, FLEET, [toolOverlapRule]).recommendations;
  assert.equal(rec?.savings?.value, 180); // min(200, 180)
  assert.match(rec?.detail ?? "", new RegExp(`fuzzy, ${score.toFixed(2)} similar`));
});

// ── All four together ────────────────────────────────────────────────────────────────────────────

test("the four deterministic rules run together and produce a deterministic, schema-valid report", () => {
  const ctx = makeContext({
    servers: [server("srv-a", "Alpha"), server("srv-b", "Beta")],
    scans: [
      scan("scan-a", "srv-a", "Alpha", [
        {
          name: "search_documents",
          totalTokens: 1000,
          descriptionTokens: 700,
          description: "search the docs",
        },
        { name: "admin_purge", totalTokens: 260, description: "purge everything" },
      ]),
      scan("scan-b", "srv-b", "Beta", [
        {
          name: "search_documents",
          totalTokens: 900,
          descriptionTokens: 600,
          description: "search the docs",
        },
      ]),
    ],
    scenarios: [
      scenario("scn-eager", "Eager env", [{ serverId: "srv-a", allowedTools: null }], {
        updatedAt: "2026-08-01T00:00:00.000Z",
      }),
      scenario("scn-defer", "Deferred env", [{ serverId: "srv-b", allowedTools: null }], {
        toolLoadingMode: "deferred",
        updatedAt: "2026-08-01T00:00:00.000Z",
      }),
    ],
    runs: [
      run("run-e1", "scn-eager", {
        startedAt: "2026-08-05T00:00:00.000Z",
        turns: 2,
        tokensIn: 6000,
      }),
      run("run-d1", "scn-defer", {
        startedAt: "2026-08-05T00:00:00.000Z",
        turns: 2,
        tokensIn: 2000,
      }),
    ],
    toolCalls: { "run-e1": ["search_documents"], "run-d1": ["search_documents"] },
  });

  const first = report(ctx, FLEET);
  const second = report(ctx, FLEET);

  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(advisorReportSchema.safeParse(first).success, true);

  // Each rule contributed exactly what its own fixture implies.
  // HAND-COMPUTED: `admin_purge` (260) is the only never-called tool of the eager environment.
  assert.equal(only(first.recommendations, UNUSED_TOOL_TRIM_RULE_ID)[0]?.savings?.value, 260);
  // HAND-COMPUTED: srv-a's flagged description is 700; srv-b's is 600.
  assert.deepEqual(
    only(first.recommendations, DESCRIPTION_BLOAT_RULE_ID).map((rec) => rec.savings?.value),
    [700, 600],
  );
  // HAND-COMPUTED: eager 6000/2 = 3000 minus deferred 2000/2 = 1000 → 2000.
  assert.equal(only(first.recommendations, LOADING_MODE_RULE_ID)[0]?.savings?.value, 2000);
  // HAND-COMPUTED: the one duplicated pair contributes min(1000, 900) = 900.
  assert.equal(only(first.recommendations, TOOL_OVERLAP_RULE_ID)[0]?.savings?.value, 900);

  // Every published recommendation is drillable and every savings figure is a labeled estimate.
  for (const rec of first.recommendations) {
    assert.ok(rec.evidence.length >= 1, `${rec.id} carries evidence`);
    if (rec.savings) {
      assert.equal(rec.savings.estimate, true);
      assert.ok(rec.savings.basis.trim().length > 0);
    }
  }

  // WP 2.1 — this fixture has runs but NO suite runs and NO grades, so the three grade-aware rules
  // contribute nothing but honest gaps here. A grade-aware recommendation over an ungraded fleet
  // would be exactly the fabrication the plan's invariant 3 forbids.
  for (const ruleId of [
    "advisor.quality-validated-trim",
    "advisor.skill-effect",
    "advisor.model-quality-bar",
  ]) {
    assert.equal(only(first.recommendations, ruleId).length, 0, `${ruleId} emits no finding`);
    assert.ok(
      first.insufficientData.some((gap) => gap.ruleId === ruleId),
      `${ruleId} names what is missing`,
    );
  }
  // And no deterministic rule stamped grade provenance it did not earn.
  for (const rec of first.recommendations) assert.equal(rec.gradeProvenance, undefined);
});
