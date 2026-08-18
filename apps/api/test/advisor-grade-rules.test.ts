import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ADVISOR_QUALITY_BAR,
  advisorReportSchema,
  GRADING_VERSION,
  type AdvisorRecommendation,
  type AdvisorReport,
  type AdvisorScope,
  type RunGrade,
  type RunSummary,
  type ScanDetail,
  type Scenario,
  type ServerConfig,
  type Skill,
  type SuiteRun,
  type SuiteVariant,
  type ToolScan,
} from "@mcp-token-footprint/shared";
import { runAdvisor } from "../src/advisor/engine.js";
import { ADVISOR_RULES } from "../src/advisor/registry.js";
import {
  MODEL_QUALITY_BAR_RULE_ID,
  modelQualityBarRule,
} from "../src/advisor/rules/model-quality-bar.js";
import {
  QUALITY_VALIDATED_TRIM_RULE_ID,
  qualityValidatedTrimRule,
} from "../src/advisor/rules/quality-validated-trim.js";
import { SKILL_EFFECT_RULE_ID, skillEffectRule } from "../src/advisor/rules/skill-effect.js";
import { DESCRIPTION_BLOAT_RULE_ID } from "../src/advisor/rules/description-bloat.js";
import { LOADING_MODE_RULE_ID } from "../src/advisor/rules/loading-mode.js";
import { TOOL_OVERLAP_RULE_ID } from "../src/advisor/rules/tool-overlap.js";
import {
  UNUSED_TOOL_TRIM_RULE_ID,
  unusedToolTrimRule,
} from "../src/advisor/rules/unused-tool-trim.js";
import { AdvisorRuleContractError, type AdvisorContext } from "../src/advisor/types.js";

// WP 2.1 (Advisor) — the three GRADE-AWARE rules, over fixed in-memory fixtures.
//
// Same discipline as `advisor-rules.test.ts`: every score, delta and saving asserted below is
// hand-computed IN THE TEST as an expression a reviewer can check by eye against the fixture
// (`(0.8 + 0.6) / 2`, `0.02 - 0.01`), never pasted from a run of the implementation. If the
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

type ToolSpec = { name: string; totalTokens: number };

function tool(scanId: string, spec: ToolSpec): ToolScan {
  return {
    id: `${scanId}:${spec.name}`,
    scanId,
    toolName: spec.name,
    rawTool: {},
    totalTokens: spec.totalTokens,
    nameTokens: 2,
    descriptionTokens: 0,
    schemaTokens: Math.max(spec.totalTokens - 2, 0),
    annotationsTokens: 0,
    rawBytes: spec.totalTokens * 4,
    contributionPercent: 0,
  };
}

function scan(id: string, serverId: string, serverName: string, tools: ToolSpec[]): ScanDetail {
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

/** One `outcome_judge` grade row — the FIRST entry of `PRIMARY_GRADER_PRIORITY`, so it is the score
 *  `selectRunScore` picks and therefore the score every rule here reads. */
function grade(runId: string, score: number | null, overrides: Partial<RunGrade> = {}): RunGrade {
  return {
    id: `grade-${runId}`,
    runId,
    graderId: "outcome_judge",
    kind: "llm",
    status: score === null ? "unevaluable" : "graded",
    score,
    rawScore: null,
    method: "single_sample",
    reasoning: null,
    evidence: null,
    judgeProviderId: null,
    judgeModel: null,
    judgeTokensIn: 0,
    judgeTokensOut: 0,
    judgeCostUsd: 0,
    gradingVersion: GRADING_VERSION,
    createdAt: "2026-08-02T01:00:00.000Z",
    ...overrides,
  };
}

function suiteRun(id: string, overrides: Partial<SuiteRun> = {}): SuiteRun {
  return {
    id,
    status: "completed",
    configSnapshot: { repetitions: 1, maxConcurrency: 3 },
    startedAt: "2026-08-02T00:00:00.000Z",
    ratingState: "rated",
    ...overrides,
  };
}

function skill(id: string, displayName: string): Skill {
  return {
    id,
    name: displayName.toLowerCase().replace(/\s+/g, "-"),
    displayName,
    slug: displayName.toLowerCase().replace(/\s+/g, "-"),
    sourceType: "upload",
    versionCount: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

type Fixture = {
  servers: ServerConfig[];
  scans: ScanDetail[];
  scenarios: Scenario[];
  runs: RunSummary[];
  /** runId → the ordered tool-call names of that run. */
  toolCalls: Record<string, string[]>;
  /** runId → its persisted grade rows (append-only order). */
  grades: Record<string, RunGrade[]>;
  suiteRuns: SuiteRun[];
  /** suiteRunId → its child run ids, in `started_at ASC` order. */
  suiteChildren: Record<string, string[]>;
  /** runId → the skill ids the run actually resolved (`run_skills`). */
  runSkills: Record<string, string[]>;
  skills: Skill[];
  /** modelId → its compatibility-dataset row (absent = unknown to the dataset). */
  models: Record<string, { displayName: string; contextWindowTokens: number | null }>;
};

function makeContext(fixture: Partial<Fixture>): AdvisorContext {
  const servers = fixture.servers ?? [];
  const scans = fixture.scans ?? [];
  const scenarios = fixture.scenarios ?? [];
  const runs = fixture.runs ?? [];
  const toolCalls = fixture.toolCalls ?? {};
  const grades = fixture.grades ?? {};
  const suiteRuns = fixture.suiteRuns ?? [];
  const suiteChildren = fixture.suiteChildren ?? {};
  const runSkills = fixture.runSkills ?? {};
  const skills = fixture.skills ?? [];
  const models = fixture.models ?? {};

  const notFound = (what: string, _id: string): never => {
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
      getRunSkills: (runId) => (runSkills[runId] ?? []).map((skillId) => ({ skill_id: skillId })),
    },
    grades: { listByRun: (runId) => grades[runId] ?? [] },
    suiteRuns: {
      listRuns: (suiteId) =>
        suiteId === undefined ? suiteRuns : suiteRuns.filter((s) => s.suiteId === suiteId),
      listChildRunIds: (suiteRunId) => suiteChildren[suiteRunId] ?? [],
    },
    skills: { list: () => skills },
    models: {
      get: (modelId) => {
        const model = models[modelId];
        return model ? { id: modelId, ...model } : null;
      },
    },
    now: () => FIXED_CLOCK,
  };
}

const SCENARIO_SCOPE = (id: string): AdvisorScope => ({ kind: "scenario", id });
const SERVER_SCOPE = (id: string): AdvisorScope => ({ kind: "server", id });
const FLEET: AdvisorScope = { kind: "fleet" };

function report(
  ctx: AdvisorContext,
  scope: AdvisorScope,
  rules = ADVISOR_RULES,
): AdvisorReport {
  return runAdvisor(ctx, scope, { rules });
}

function only(recommendations: AdvisorRecommendation[], ruleId: string): AdvisorRecommendation[] {
  return recommendations.filter((rec) => rec.ruleId === ruleId);
}

function reasons(result: AdvisorReport, ruleId: string): string[] {
  return result.insufficientData.filter((gap) => gap.ruleId === ruleId).map((gap) => gap.reason);
}

// ── Registry ─────────────────────────────────────────────────────────────────────────────────────

test("WP 2.1 appends the three grade-aware rules after WP 1.2's four, in the documented order", () => {
  assert.deepEqual(
    ADVISOR_RULES.map((rule) => rule.id),
    [
      UNUSED_TOOL_TRIM_RULE_ID,
      DESCRIPTION_BLOAT_RULE_ID,
      LOADING_MODE_RULE_ID,
      TOOL_OVERLAP_RULE_ID,
      QUALITY_VALIDATED_TRIM_RULE_ID,
      SKILL_EFFECT_RULE_ID,
      MODEL_QUALITY_BAR_RULE_ID,
    ],
  );
  // Exactly the three Phase 2 rules declare themselves grade-aware; the engine holds each of them to
  // stamping grade provenance, and holds the other four to NOT stamping it.
  assert.deepEqual(
    ADVISOR_RULES.filter((rule) => rule.gradeAware === true).map((rule) => rule.id),
    [QUALITY_VALIDATED_TRIM_RULE_ID, SKILL_EFFECT_RULE_ID, MODEL_QUALITY_BAR_RULE_ID],
  );
});

test("the between-models rule is fleet-only; the other two also answer an environment scope", () => {
  // A single environment has exactly ONE model, so a scenario-scoped "cheapest model" report would
  // be a comparison against nothing.
  assert.equal(modelQualityBarRule.appliesTo(FLEET), true);
  assert.equal(modelQualityBarRule.appliesTo(SCENARIO_SCOPE("scn-1")), false);
  assert.equal(modelQualityBarRule.appliesTo(SERVER_SCOPE("srv-1")), false);

  for (const rule of [qualityValidatedTrimRule, skillEffectRule]) {
    assert.equal(rule.appliesTo(FLEET), true);
    assert.equal(rule.appliesTo(SCENARIO_SCOPE("scn-1")), true);
    // A bare server has neither runs nor grades attached to it.
    assert.equal(rule.appliesTo(SERVER_SCOPE("srv-1")), false);
  }
});

// ── Rule 1 — quality-validated toolset trim ──────────────────────────────────────────────────────

/**
 * One environment, one server, four tools. Two runs, both members of suite run `sr-1`, both graded.
 *
 *   search  400 tokens  called in both graded members
 *   fetch   300 tokens  called in one graded member
 *   admin   260 tokens  NEVER called
 *   purge   240 tokens  NEVER called
 *
 * Scores: run-1 = 0.8, run-2 = 0.6  →  mean (0.8 + 0.6) / 2 = 0.7, which clears the 0.5 bar.
 */
function trimFixture(overrides: Partial<Fixture> = {}): AdvisorContext {
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
    scenarios: [scenario("scn-1", "Docs env", [{ serverId: "srv-1", allowedTools: null }])],
    runs: [
      run("run-1", "scn-1", { suiteRunId: "sr-1", startedAt: "2026-08-02T00:00:00.000Z" }),
      run("run-2", "scn-1", { suiteRunId: "sr-1", startedAt: "2026-08-02T00:10:00.000Z" }),
    ],
    toolCalls: { "run-1": ["search", "fetch"], "run-2": ["search"] },
    grades: { "run-1": [grade("run-1", 0.8)], "run-2": [grade("run-2", 0.6)] },
    suiteRuns: [suiteRun("sr-1")],
    suiteChildren: { "sr-1": ["run-1", "run-2"] },
    ...overrides,
  });
}

test("quality-validated trim: savings are the never-called tools' tokens, validated by the mean score", () => {
  const result = report(trimFixture(), SCENARIO_SCOPE("scn-1"), [qualityValidatedTrimRule]);
  const [rec] = result.recommendations;

  assert.equal(result.recommendations.length, 1);
  assert.equal(rec?.id, "advisor.quality-validated-trim:scn-1:srv-1");

  // HAND-COMPUTED: the two never-called tools are `admin` (260) and `purge` (240).
  assert.equal(rec?.savings?.value, 260 + 240);
  assert.equal(rec?.savings?.unit, "tokens_per_turn"); // the environment loads eagerly
  assert.equal(rec?.savings?.estimate, true);

  // HAND-COMPUTED severity: wasted share = 500 / (400+300+260+240) = 500/1200 = 41.7% → medium.
  assert.equal(rec?.severity, "medium");
  assert.match(rec?.detail ?? "", /41\.7%/);
  assert.match(rec?.detail ?? "", /Suggested allowedTools: fetch, search\./);

  // HAND-COMPUTED quality: (0.8 + 0.6) / 2 = 0.700, at or above the 0.5 bar.
  assert.equal((0.8 + 0.6) / 2, 0.7);
  assert.match(rec?.detail ?? "", /mean primary-grader score 0\.700/);
  assert.ok(0.7 >= ADVISOR_QUALITY_BAR);
});

test("quality-validated trim: the finding records GRADING_VERSION and the suite-run ids it read", () => {
  const result = report(trimFixture(), SCENARIO_SCOPE("scn-1"), [qualityValidatedTrimRule]);
  const [rec] = result.recommendations;

  assert.deepEqual(rec?.gradeProvenance, {
    gradingVersion: GRADING_VERSION,
    suiteRunIds: ["sr-1"],
  });
});

test("quality-validated trim: suite-run ids are the ids actually read, ascending and deduped", () => {
  // Three graded members across TWO suite runs, deliberately seeded so the newest run belongs to the
  // alphabetically-FIRST suite run — a rule that just took them in run order would emit them
  // unsorted, which the engine rejects.
  const ctx = trimFixture({
    runs: [
      run("run-1", "scn-1", { suiteRunId: "sr-b", startedAt: "2026-08-02T00:00:00.000Z" }),
      run("run-2", "scn-1", { suiteRunId: "sr-b", startedAt: "2026-08-02T00:10:00.000Z" }),
      run("run-3", "scn-1", { suiteRunId: "sr-a", startedAt: "2026-08-02T00:20:00.000Z" }),
    ],
    toolCalls: { "run-1": ["search", "fetch"], "run-2": ["search"], "run-3": ["search"] },
    grades: {
      "run-1": [grade("run-1", 0.8)],
      "run-2": [grade("run-2", 0.6)],
      "run-3": [grade("run-3", 0.7)],
    },
    suiteRuns: [suiteRun("sr-a"), suiteRun("sr-b")],
    suiteChildren: { "sr-a": ["run-3"], "sr-b": ["run-1", "run-2"] },
  });

  const [rec] = report(ctx, SCENARIO_SCOPE("scn-1"), [qualityValidatedTrimRule]).recommendations;
  assert.deepEqual(rec?.gradeProvenance?.suiteRunIds, ["sr-a", "sr-b"]);
});

test("quality-validated trim: NO suite-run members ⇒ insufficientData, never a trim", () => {
  // The exact same footprint + usage as the happy path, with the ONLY difference that the runs are
  // standalone rather than suite members. WP 1.2's rule would still emit a trim here; this one must
  // not, because there is no suite score to validate it against.
  const ctx = trimFixture({
    runs: [
      run("run-1", "scn-1", { startedAt: "2026-08-02T00:00:00.000Z" }),
      run("run-2", "scn-1", { startedAt: "2026-08-02T00:10:00.000Z" }),
    ],
    grades: { "run-1": [grade("run-1", 0.8)], "run-2": [grade("run-2", 0.6)] },
    suiteRuns: [],
    suiteChildren: {},
  });

  const result = report(ctx, SCENARIO_SCOPE("scn-1"), [qualityValidatedTrimRule]);
  assert.deepEqual(result.recommendations, []);
  assert.equal(reasons(result, QUALITY_VALIDATED_TRIM_RULE_ID).length, 1);
  assert.match(reasons(result, QUALITY_VALIDATED_TRIM_RULE_ID)[0] ?? "", /no completed runs belonging to a suite run/);

  // The contrast that makes the refusal meaningful: over the SAME fixture the Phase 1 rule happily
  // emits its (unvalidated) trim. So the gap above is this rule declining to speak without quality
  // evidence, not the fixture simply having nothing to trim.
  const phase1 = report(ctx, SCENARIO_SCOPE("scn-1"), [unusedToolTrimRule]);
  assert.equal(phase1.recommendations.length, 1);
  assert.equal(phase1.recommendations[0]?.savings?.value, 260 + 240);
});

test("quality-validated trim: suite members but NO grades ⇒ insufficientData, never a trim", () => {
  const ctx = trimFixture({ grades: {} });

  const result = report(ctx, SCENARIO_SCOPE("scn-1"), [qualityValidatedTrimRule]);
  assert.deepEqual(result.recommendations, []);
  assert.match(
    reasons(result, QUALITY_VALIDATED_TRIM_RULE_ID)[0] ?? "",
    /none of them carries a graded score/,
  );
});

test("quality-validated trim: an ungraded grade ROW is not a score — still insufficientData", () => {
  // A grader that ran and could not evaluate writes a row with `status: 'unevaluable'` and a NULL
  // score. Reading that as 0 would turn a failed grader into a failing environment.
  const ctx = trimFixture({
    grades: { "run-1": [grade("run-1", null)], "run-2": [grade("run-2", null)] },
  });

  const result = report(ctx, SCENARIO_SCOPE("scn-1"), [qualityValidatedTrimRule]);
  assert.deepEqual(result.recommendations, []);
  assert.match(
    reasons(result, QUALITY_VALIDATED_TRIM_RULE_ID)[0] ?? "",
    /none of them carries a graded score/,
  );
});

test("quality-validated trim: the score does NOT hold ⇒ insufficientData, never a trim", () => {
  // HAND-COMPUTED: (0.4 + 0.2) / 2 = 0.300, below the 0.5 bar.
  const ctx = trimFixture({
    grades: { "run-1": [grade("run-1", 0.4)], "run-2": [grade("run-2", 0.2)] },
  });
  assert.equal((0.4 + 0.2) / 2, 0.30000000000000004); // floating point, still < 0.5

  const result = report(ctx, SCENARIO_SCOPE("scn-1"), [qualityValidatedTrimRule]);
  assert.deepEqual(result.recommendations, []);
  assert.match(reasons(result, QUALITY_VALIDATED_TRIM_RULE_ID)[0] ?? "", /below the 0\.5 quality bar/);
});

test("quality-validated trim: exactly AT the bar still holds (>=, matching passRateAt05)", () => {
  // HAND-COMPUTED: (0.5 + 0.5) / 2 = 0.500 — the suite aggregates count `score >= 0.5` as passing,
  // so the advisor must too, or "clears the bar" would mean two different things in one app.
  const ctx = trimFixture({
    grades: { "run-1": [grade("run-1", 0.5)], "run-2": [grade("run-2", 0.5)] },
  });

  const result = report(ctx, SCENARIO_SCOPE("scn-1"), [qualityValidatedTrimRule]);
  assert.equal(result.recommendations.length, 1);
  assert.match(result.recommendations[0]?.detail ?? "", /mean primary-grader score 0\.500/);
});

test("quality-validated trim: grades spanning two grading versions ⇒ insufficientData", () => {
  const ctx = trimFixture({
    grades: {
      "run-1": [grade("run-1", 0.8, { gradingVersion: 1 })],
      "run-2": [grade("run-2", 0.6, { gradingVersion: 2 })],
    },
  });

  const result = report(ctx, SCENARIO_SCOPE("scn-1"), [qualityValidatedTrimRule]);
  assert.deepEqual(result.recommendations, []);
  assert.match(
    reasons(result, QUALITY_VALIDATED_TRIM_RULE_ID)[0] ?? "",
    /spanning more than one grading version/,
  );
});

test("quality-validated trim: usage is read from the GRADED members only", () => {
  // `purge` IS called — but only in an ungraded standalone run, which is not part of the evidence
  // base. The trim therefore still names it, and says so. (The Phase 1 rule, reading every completed
  // run, would drop `purge` from the trim — the two rules are allowed to disagree, and this is the
  // conservative direction: the graded evidence never showed `purge` being needed.)
  const ctx = trimFixture({
    runs: [
      run("run-1", "scn-1", { suiteRunId: "sr-1", startedAt: "2026-08-02T00:00:00.000Z" }),
      run("run-2", "scn-1", { suiteRunId: "sr-1", startedAt: "2026-08-02T00:10:00.000Z" }),
      run("run-3", "scn-1", { startedAt: "2026-08-02T00:20:00.000Z" }),
    ],
    toolCalls: { "run-1": ["search", "fetch"], "run-2": ["search"], "run-3": ["purge"] },
  });

  const [rec] = report(ctx, SCENARIO_SCOPE("scn-1"), [qualityValidatedTrimRule]).recommendations;
  // HAND-COMPUTED: unchanged from the happy path — 260 + 240.
  assert.equal(rec?.savings?.value, 260 + 240);
  assert.match(rec?.detail ?? "", /Never called: admin, purge\./);
});

test("quality-validated trim: a deferred environment reports plain tokens, not tokens per turn", () => {
  const ctx = trimFixture({
    scenarios: [
      scenario("scn-1", "Docs env", [{ serverId: "srv-1", allowedTools: null }], {
        toolLoadingMode: "deferred",
      }),
    ],
  });

  const [rec] = report(ctx, SCENARIO_SCOPE("scn-1"), [qualityValidatedTrimRule]).recommendations;
  assert.equal(rec?.savings?.value, 260 + 240);
  assert.equal(rec?.savings?.unit, "tokens");
  assert.match(rec?.savings?.basis ?? "", /one-off footprint, not a per-turn cost/);
});

test("quality-validated trim: evidence is drillable — environment, server, scan, graded runs, tools", () => {
  const [rec] = report(trimFixture(), SCENARIO_SCOPE("scn-1"), [
    qualityValidatedTrimRule,
  ]).recommendations;

  assert.deepEqual(
    rec?.evidence.map((e) => `${e.kind}:${e.id}`),
    [
      "scenario:scn-1",
      "server:srv-1",
      "scan:scan-1",
      "run:run-2", // graded members, newest first
      "run:run-1",
      "tool_scan:scan-1:admin",
      "tool_scan:scan-1:purge",
    ],
  );
  // The suggestion states plainly that the trimmed configuration was never actually run.
  assert.ok(
    rec?.assumptions.some((line) => /trimmed configuration was NOT run/.test(line)),
    "the finding does not claim the trim itself was measured",
  );
});

// ── Rule 2 — skill effect ────────────────────────────────────────────────────────────────────────

const WITH_SKILL: SuiteVariant = {
  label: "with docs skill",
  scenarioId: "scn-1",
  skillOverrides: { attach: [{ skillId: "skill-1", versionId: "latest" }] },
};
const BASE: SuiteVariant = { label: "base", scenarioId: "scn-1", skillOverrides: {} };

/**
 * One skill-effect suite run, two variants, two tests, one repetition each.
 *
 *   test-a  base    score 0.60  cost $0.0100      test-a  variant score 0.75  cost $0.0140
 *   test-b  base    score 0.50  cost $0.0200      test-b  variant score 0.57  cost $0.0260
 *
 * Per-test grade deltas: +0.15 and +0.07 → mean (0.15 + 0.07) / 2 = 0.11.
 * Per-test cost  deltas: +0.004 and +0.006 → mean (0.004 + 0.006) / 2 = 0.005.
 */
function skillEffectFixture(overrides: Partial<Fixture> = {}): AdvisorContext {
  return makeContext({
    scenarios: [scenario("scn-1", "Docs env", [])],
    skills: [skill("skill-1", "Docs skill")],
    runs: [
      run("r-a-base", "scn-1", { testId: "test-a", suiteRunId: "sr-1", costUsd: 0.01 }),
      run("r-a-var", "scn-1", { testId: "test-a", suiteRunId: "sr-1", costUsd: 0.014 }),
      run("r-b-base", "scn-1", { testId: "test-b", suiteRunId: "sr-1", costUsd: 0.02 }),
      run("r-b-var", "scn-1", { testId: "test-b", suiteRunId: "sr-1", costUsd: 0.026 }),
    ],
    grades: {
      "r-a-base": [grade("r-a-base", 0.6)],
      "r-a-var": [grade("r-a-var", 0.75)],
      "r-b-base": [grade("r-b-base", 0.5)],
      "r-b-var": [grade("r-b-var", 0.57)],
    },
    // Attribution is by the skills a run ACTUALLY resolved: the variant runs loaded `skill-1`.
    runSkills: { "r-a-var": ["skill-1"], "r-b-var": ["skill-1"] },
    suiteRuns: [suiteRun("sr-1", { configSnapshot: { repetitions: 1, maxConcurrency: 3, variants: [BASE, WITH_SKILL] } })],
    suiteChildren: { "sr-1": ["r-a-base", "r-a-var", "r-b-base", "r-b-var"] },
    ...overrides,
  });
}

test("skill effect: mean grade delta and mean cost delta over the suite run's tests", () => {
  const result = report(skillEffectFixture(), FLEET, [skillEffectRule]);
  const [rec] = result.recommendations;

  assert.equal(result.recommendations.length, 1);
  assert.equal(rec?.id, "advisor.skill-effect:sr-1:with docs skill");

  // HAND-COMPUTED grade deltas: (0.75 − 0.60) = 0.15 and (0.57 − 0.50) = 0.07 → mean 0.11.
  assert.match(rec?.detail ?? "", /mean grade \+0\.110 across 2 graded tests/);
  assert.match(rec?.title ?? "", /\+0\.110 grade/);

  // HAND-COMPUTED cost deltas: (0.014 − 0.010) = 0.004 and (0.026 − 0.020) = 0.006 → mean 0.005.
  assert.match(rec?.detail ?? "", /mean cost \+\$0\.0050 per run/);

  // Better but MORE expensive → a trade-off, never dressed up as a saving.
  assert.equal(rec?.savings, undefined);
  assert.equal(rec?.severity, "medium");
  assert.match(rec?.detail ?? "", /better but costs more/);

  assert.deepEqual(rec?.gradeProvenance, {
    gradingVersion: GRADING_VERSION,
    suiteRunIds: ["sr-1"],
  });
});

test("skill effect: a variant that is better AND cheaper is a high-severity saving in usd_per_run", () => {
  // Same grades, cheaper variant: test-a $0.006 (−0.004) and test-b $0.014 (−0.006) → mean −0.005.
  const ctx = skillEffectFixture({
    runs: [
      run("r-a-base", "scn-1", { testId: "test-a", suiteRunId: "sr-1", costUsd: 0.01 }),
      run("r-a-var", "scn-1", { testId: "test-a", suiteRunId: "sr-1", costUsd: 0.006 }),
      run("r-b-base", "scn-1", { testId: "test-b", suiteRunId: "sr-1", costUsd: 0.02 }),
      run("r-b-var", "scn-1", { testId: "test-b", suiteRunId: "sr-1", costUsd: 0.014 }),
    ],
  });

  const [rec] = report(ctx, FLEET, [skillEffectRule]).recommendations;
  // HAND-COMPUTED: mean cost delta = ((0.006 − 0.010) + (0.014 − 0.020)) / 2 = −0.005, so the
  // saving is +0.005 per run.
  assert.equal(rec?.savings?.unit, "usd_per_run");
  assert.ok(Math.abs((rec?.savings?.value ?? 0) - 0.005) < 1e-9);
  assert.equal(rec?.savings?.estimate, true);
  assert.equal(rec?.severity, "high");
  assert.match(rec?.detail ?? "", /better AND cheaper/);
});

test("skill effect: a variant that scores WORSE is surfaced as a warning, not hidden", () => {
  const ctx = skillEffectFixture({
    grades: {
      "r-a-base": [grade("r-a-base", 0.8)],
      "r-a-var": [grade("r-a-var", 0.6)],
      "r-b-base": [grade("r-b-base", 0.7)],
      "r-b-var": [grade("r-b-var", 0.5)],
    },
  });

  const [rec] = report(ctx, FLEET, [skillEffectRule]).recommendations;
  // HAND-COMPUTED: ((0.6 − 0.8) + (0.5 − 0.7)) / 2 = −0.2.
  assert.match(rec?.detail ?? "", /mean grade -0\.200 across 2 graded tests/);
  assert.equal(rec?.severity, "medium");
  assert.match(rec?.detail ?? "", /scored WORSE/);
});

test("skill effect: an ungraded side excludes that test from the grade mean, never counts it as 0", () => {
  // test-b's variant run is unevaluable, so only test-a contributes a grade delta: +0.15.
  const ctx = skillEffectFixture({
    grades: {
      "r-a-base": [grade("r-a-base", 0.6)],
      "r-a-var": [grade("r-a-var", 0.75)],
      "r-b-base": [grade("r-b-base", 0.5)],
      "r-b-var": [grade("r-b-var", null)],
    },
  });

  const [rec] = report(ctx, FLEET, [skillEffectRule]).recommendations;
  assert.match(rec?.detail ?? "", /mean grade \+0\.150 across 1 graded test/);
  // The cost delta still covers BOTH tests — real spend is compared even for an ungraded run.
  assert.match(rec?.detail ?? "", /mean cost \+\$0\.0050 per run/);
  assert.ok(
    rec?.assumptions.some((line) => /excluded from the grade delta \(never counted as 0\)/.test(line)),
  );
});

test("skill effect: no graded member at all ⇒ insufficientData, no fabricated quality claim", () => {
  const ctx = skillEffectFixture({ grades: {} });

  const result = report(ctx, FLEET, [skillEffectRule]);
  assert.deepEqual(result.recommendations, []);
  assert.match(reasons(result, SKILL_EFFECT_RULE_ID)[0] ?? "", /none of its attributed members carries a graded score/);
});

test("skill effect: runs that match no variant are excluded, and an all-unattributable run is a gap", () => {
  // Nothing loaded `skill-1`, so the `with docs skill` variant matches nothing; every run matches the
  // BASE variant only, which leaves no comparison to make.
  const ctx = skillEffectFixture({ runSkills: {} });

  const result = report(ctx, FLEET, [skillEffectRule]);
  assert.deepEqual(result.recommendations, []);
  assert.match(reasons(result, SKILL_EFFECT_RULE_ID)[0] ?? "", /no test ran under BOTH the base variant/);
});

test("skill effect: no variant axis anywhere ⇒ one honest gap naming what to run", () => {
  const ctx = skillEffectFixture({
    suiteRuns: [suiteRun("sr-1")], // a plain suite run, no variants
  });

  const result = report(ctx, FLEET, [skillEffectRule]);
  assert.deepEqual(result.recommendations, []);
  assert.match(reasons(result, SKILL_EFFECT_RULE_ID)[0] ?? "", /no suite run in the 20 most recent defines a ± skill variant axis/);
});

test("skill effect: evidence names the environment, the skill by NAME, and the variant's runs", () => {
  const [rec] = report(skillEffectFixture(), FLEET, [skillEffectRule]).recommendations;

  assert.deepEqual(
    rec?.evidence.map((e) => `${e.kind}:${e.id}`),
    ["scenario:scn-1", "skill:skill-1", "run:r-a-var", "run:r-b-var"],
  );
  assert.equal(rec?.evidence.find((e) => e.kind === "skill")?.label, "Docs skill");
  assert.match(rec?.detail ?? "", /\+Docs skill/);
  // The base variant is the FIRST in the frozen snapshot — stated, not silently assumed.
  assert.ok(rec?.assumptions.some((line) => /the FIRST variant in the suite run's frozen config snapshot/.test(line)));
});

test("skill effect: a scenario-scoped report only speaks about variants on that environment", () => {
  const ctx = skillEffectFixture({
    scenarios: [scenario("scn-1", "Docs env", []), scenario("scn-2", "Other env", [])],
  });

  const mine = report(ctx, SCENARIO_SCOPE("scn-1"), [skillEffectRule]);
  assert.equal(only(mine.recommendations, SKILL_EFFECT_RULE_ID).length, 1);

  const other = report(ctx, SCENARIO_SCOPE("scn-2"), [skillEffectRule]);
  assert.deepEqual(other.recommendations, []);
  assert.match(reasons(other, SKILL_EFFECT_RULE_ID)[0] ?? "", /variant axis for this environment/);
});

// ── Rule 3 — cheapest model clearing a quality bar ───────────────────────────────────────────────

/**
 * One suite run, the same two tests on three environments = three models.
 *
 *   premium   (scn-premium)  scores 0.90, 0.80 → mean 0.850   cost $0.0200, $0.0240 → mean $0.0220
 *   thrifty   (scn-thrifty)  scores 0.70, 0.60 → mean 0.650   cost $0.0020, $0.0040 → mean $0.0030
 *   feeble    (scn-feeble)   scores 0.30, 0.20 → mean 0.250   cost $0.0010, $0.0010 → mean $0.0010
 *
 * `feeble` is the cheapest of all three but does NOT clear the 0.5 bar, so the answer is `thrifty`,
 * and the saving against the dearest clearing model is $0.0220 − $0.0030 = $0.0190 per run.
 */
function modelFixture(overrides: Partial<Fixture> = {}): AdvisorContext {
  return makeContext({
    scenarios: [
      scenario("scn-premium", "Premium env", [], { model: "premium-1" }),
      scenario("scn-thrifty", "Thrifty env", [], { model: "thrifty-1" }),
      scenario("scn-feeble", "Feeble env", [], { model: "feeble-1" }),
    ],
    runs: [
      run("r-p1", "scn-premium", { testId: "test-a", suiteRunId: "sr-1", costUsd: 0.02, peakContextTokens: 30_000 }),
      run("r-p2", "scn-premium", { testId: "test-b", suiteRunId: "sr-1", costUsd: 0.024, peakContextTokens: 40_000 }),
      run("r-t1", "scn-thrifty", { testId: "test-a", suiteRunId: "sr-1", costUsd: 0.002, peakContextTokens: 28_000 }),
      run("r-t2", "scn-thrifty", { testId: "test-b", suiteRunId: "sr-1", costUsd: 0.004, peakContextTokens: 36_000 }),
      run("r-f1", "scn-feeble", { testId: "test-a", suiteRunId: "sr-1", costUsd: 0.001, peakContextTokens: 20_000 }),
      run("r-f2", "scn-feeble", { testId: "test-b", suiteRunId: "sr-1", costUsd: 0.001, peakContextTokens: 22_000 }),
    ],
    grades: {
      "r-p1": [grade("r-p1", 0.9)],
      "r-p2": [grade("r-p2", 0.8)],
      "r-t1": [grade("r-t1", 0.7)],
      "r-t2": [grade("r-t2", 0.6)],
      "r-f1": [grade("r-f1", 0.3)],
      "r-f2": [grade("r-f2", 0.2)],
    },
    suiteRuns: [suiteRun("sr-1")],
    suiteChildren: { "sr-1": ["r-p1", "r-p2", "r-t1", "r-t2", "r-f1", "r-f2"] },
    models: {
      "premium-1": { displayName: "Premium One", contextWindowTokens: 200_000 },
      "thrifty-1": { displayName: "Thrifty One", contextWindowTokens: 128_000 },
      "feeble-1": { displayName: "Feeble One", contextWindowTokens: 8_000 },
    },
    ...overrides,
  });
}

test("model quality bar: the cheapest CLEARING model wins, and the saving is per run", () => {
  const result = report(modelFixture(), FLEET, [modelQualityBarRule]);
  const [rec] = result.recommendations;

  assert.equal(result.recommendations.length, 1);
  assert.equal(rec?.id, "advisor.model-quality-bar:sr-1");

  // HAND-COMPUTED means: premium (0.9+0.8)/2 = 0.850; thrifty (0.7+0.6)/2 = 0.650;
  // feeble (0.3+0.2)/2 = 0.250 — the only one below the 0.5 bar.
  assert.match(rec?.detail ?? "", /"Thrifty One" \(thrifty-1\) — mean score 0\.650/);
  assert.match(rec?.detail ?? "", /"Premium One" \(premium-1\) — mean score 0\.850/);
  assert.ok(!/"Feeble One"/.test(rec?.detail ?? ""), "the sub-bar model is not offered");

  // HAND-COMPUTED costs: premium (0.020+0.024)/2 = 0.022; thrifty (0.002+0.004)/2 = 0.003.
  // Saving = 0.022 − 0.003 = 0.019 per run.
  assert.equal(rec?.savings?.unit, "usd_per_run");
  assert.ok(Math.abs((rec?.savings?.value ?? 0) - 0.019) < 1e-9);
  assert.equal(rec?.savings?.estimate, true);
  assert.equal(rec?.severity, "high");

  assert.deepEqual(rec?.gradeProvenance, {
    gradingVersion: GRADING_VERSION,
    suiteRunIds: ["sr-1"],
  });
});

test("model quality bar: the compatibility join excludes a model whose window can't carry the workload", () => {
  // `thrifty-1`'s window is shrunk below the workload's LARGEST observed peak (40,000, set by a
  // premium run) even though its own runs peaked at only 36,000 — switching the suite over means
  // carrying every one of those workloads, not just the ones it happened to draw.
  const ctx = modelFixture({
    models: {
      "premium-1": { displayName: "Premium One", contextWindowTokens: 200_000 },
      "thrifty-1": { displayName: "Thrifty One", contextWindowTokens: 32_000 },
      "feeble-1": { displayName: "Feeble One", contextWindowTokens: 8_000 },
    },
  });

  const [rec] = report(ctx, FLEET, [modelQualityBarRule]).recommendations;
  // Only `premium-1` remains usable, so there is no cheaper alternative and no saving.
  assert.match(rec?.title ?? "", /Only "Premium One" clears the quality bar/);
  assert.equal(rec?.savings, undefined);
  assert.equal(rec?.severity, "info");
  assert.match(rec?.detail ?? "", /thrifty-1 — context window 32,000 tokens is smaller than the workload's observed peak of 40,000/);
});

test("model quality bar: a model the compatibility dataset does not know is never recommended", () => {
  const ctx = modelFixture({
    models: {
      "premium-1": { displayName: "Premium One", contextWindowTokens: 200_000 },
      // thrifty-1 deliberately absent from the dataset
      "feeble-1": { displayName: "Feeble One", contextWindowTokens: 8_000 },
    },
  });

  const [rec] = report(ctx, FLEET, [modelQualityBarRule]).recommendations;
  assert.match(rec?.title ?? "", /Only "Premium One" clears the quality bar/);
  assert.match(rec?.detail ?? "", /thrifty-1 — not in the compatibility dataset/);
});

test("model quality bar: no model clears the bar ⇒ insufficientData, never a 'least bad' pick", () => {
  const ctx = modelFixture({
    grades: {
      "r-p1": [grade("r-p1", 0.4)],
      "r-p2": [grade("r-p2", 0.4)],
      "r-t1": [grade("r-t1", 0.3)],
      "r-t2": [grade("r-t2", 0.3)],
      "r-f1": [grade("r-f1", 0.2)],
      "r-f2": [grade("r-f2", 0.2)],
    },
  });

  const result = report(ctx, FLEET, [modelQualityBarRule]);
  assert.deepEqual(result.recommendations, []);
  // HAND-COMPUTED best mean: premium (0.4+0.4)/2 = 0.400.
  assert.match(reasons(result, MODEL_QUALITY_BAR_RULE_ID)[0] ?? "", /best mean score: 0\.400/);
});

test("model quality bar: a single-model suite run has nothing to compare ⇒ insufficientData", () => {
  const ctx = modelFixture({
    scenarios: [
      scenario("scn-premium", "Premium env", [], { model: "premium-1" }),
      scenario("scn-thrifty", "Thrifty env", [], { model: "premium-1" }),
      scenario("scn-feeble", "Feeble env", [], { model: "premium-1" }),
    ],
  });

  const result = report(ctx, FLEET, [modelQualityBarRule]);
  assert.deepEqual(result.recommendations, []);
  assert.match(reasons(result, MODEL_QUALITY_BAR_RULE_ID)[0] ?? "", /only one model \(premium-1\)/);
});

test("model quality bar: an ungraded suite run cannot show any model clearing the bar", () => {
  const result = report(modelFixture({ grades: {} }), FLEET, [modelQualityBarRule]);
  assert.deepEqual(result.recommendations, []);
  assert.match(
    reasons(result, MODEL_QUALITY_BAR_RULE_ID)[0] ?? "",
    /none of its members carries a graded score/,
  );
});

test("model quality bar: mixed grading versions are refused rather than averaged", () => {
  const ctx = modelFixture({
    grades: {
      "r-p1": [grade("r-p1", 0.9, { gradingVersion: 1 })],
      "r-p2": [grade("r-p2", 0.8, { gradingVersion: 2 })],
      "r-t1": [grade("r-t1", 0.7, { gradingVersion: 1 })],
      "r-t2": [grade("r-t2", 0.6, { gradingVersion: 1 })],
      "r-f1": [grade("r-f1", 0.3, { gradingVersion: 1 })],
      "r-f2": [grade("r-f2", 0.2, { gradingVersion: 1 })],
    },
  });

  const result = report(ctx, FLEET, [modelQualityBarRule]);
  assert.deepEqual(result.recommendations, []);
  assert.match(
    reasons(result, MODEL_QUALITY_BAR_RULE_ID)[0] ?? "",
    /more than one grading version/,
  );
});

test("model quality bar: the model is read from the environment, and that is declared", () => {
  const [rec] = report(modelFixture(), FLEET, [modelQualityBarRule]).recommendations;
  assert.ok(
    rec?.assumptions.some((line) =>
      /read from its environment's current `model` field/.test(line),
    ),
    "the misattribution risk of an edited environment is stated, not assumed away",
  );
  // Evidence resolves to the two compared models' environments and their runs.
  assert.deepEqual(
    rec?.evidence.map((e) => `${e.kind}:${e.id}`),
    ["scenario:scn-thrifty", "run:r-t1", "run:r-t2", "scenario:scn-premium", "run:r-p1", "run:r-p2"],
  );
});

// ── Cross-cutting: the engine's grade-provenance contract ────────────────────────────────────────

test("the engine REFUSES a grade-aware recommendation with no gradeProvenance", () => {
  const bad = {
    id: "advisor.fake:1",
    ruleId: "advisor.fake",
    title: "Unstamped",
    detail: "",
    severity: "info" as const,
    evidence: [{ kind: "server" as const, id: "srv-1", label: "Fixture" }],
    assumptions: [],
  };
  const rule = {
    id: "advisor.fake",
    description: "a grade-aware rule that forgot to stamp its provenance",
    gradeAware: true,
    appliesTo: () => true,
    run: () => ({ recommendations: [bad], insufficientData: [] }),
  };

  assert.throws(
    () => runAdvisor(makeContext({}), FLEET, { rules: [rule] }),
    (error: unknown) =>
      error instanceof AdvisorRuleContractError && /records no gradeProvenance/.test(error.message),
  );
});

test("the engine REFUSES gradeProvenance from a rule that reads no grades", () => {
  const rule = {
    id: "advisor.fake",
    description: "a deterministic rule claiming grade validation it never did",
    appliesTo: () => true,
    run: () => ({
      recommendations: [
        {
          id: "advisor.fake:1",
          ruleId: "advisor.fake",
          title: "Unearned",
          detail: "",
          severity: "info" as const,
          evidence: [{ kind: "server" as const, id: "srv-1", label: "Fixture" }],
          assumptions: [],
          gradeProvenance: { gradingVersion: 1, suiteRunIds: ["sr-1"] },
        },
      ],
      insufficientData: [],
    }),
  };

  assert.throws(
    () => runAdvisor(makeContext({}), FLEET, { rules: [rule] }),
    (error: unknown) =>
      error instanceof AdvisorRuleContractError &&
      /records gradeProvenance but its rule is not marked gradeAware/.test(error.message),
  );
});

test("the engine REFUSES grade provenance with no suite-run ids, or unsorted ones", () => {
  const withProvenance = (suiteRunIds: string[]) => ({
    id: "advisor.fake",
    description: "fixture",
    gradeAware: true,
    appliesTo: () => true,
    run: () => ({
      recommendations: [
        {
          id: "advisor.fake:1",
          ruleId: "advisor.fake",
          title: "Fixture",
          detail: "",
          severity: "info" as const,
          evidence: [{ kind: "server" as const, id: "srv-1", label: "Fixture" }],
          assumptions: [],
          gradeProvenance: { gradingVersion: 1, suiteRunIds },
        },
      ],
      insufficientData: [],
    }),
  });

  assert.throws(
    () => runAdvisor(makeContext({}), FLEET, { rules: [withProvenance([])] }),
    (error: unknown) =>
      error instanceof AdvisorRuleContractError && /no suite-run ids/.test(error.message),
  );
  assert.throws(
    () => runAdvisor(makeContext({}), FLEET, { rules: [withProvenance(["sr-b", "sr-a"])] }),
    (error: unknown) =>
      error instanceof AdvisorRuleContractError &&
      /not ascending and unique/.test(error.message),
  );
  assert.throws(
    () => runAdvisor(makeContext({}), FLEET, { rules: [withProvenance(["sr-a", "sr-a"])] }),
    (error: unknown) =>
      error instanceof AdvisorRuleContractError &&
      /not ascending and unique/.test(error.message),
  );
});

// ── Determinism ──────────────────────────────────────────────────────────────────────────────────

test("every grade-aware rule is deterministic: the same inputs twice are byte-identical", () => {
  for (const ctx of [trimFixture(), skillEffectFixture(), modelFixture()]) {
    const first = report(ctx, FLEET);
    const second = report(ctx, FLEET);
    assert.equal(JSON.stringify(first), JSON.stringify(second));
    assert.equal(advisorReportSchema.safeParse(first).success, true);
  }
});

test("the seven rules run together over one graded fleet and produce a schema-valid report", () => {
  // A fleet that exercises BOTH trims at once: two graded suite members with the same footprint and
  // usage, so the Phase 1 and Phase 2 rules agree on the number and disagree only in what they claim.
  const ctx = trimFixture();
  const result = report(ctx, FLEET);

  assert.equal(advisorReportSchema.safeParse(result).success, true);

  const phase1 = only(result.recommendations, UNUSED_TOOL_TRIM_RULE_ID)[0];
  const phase2 = only(result.recommendations, QUALITY_VALIDATED_TRIM_RULE_ID)[0];

  // HAND-COMPUTED: both read the same never-called tools — 260 + 240.
  assert.equal(phase1?.savings?.value, 260 + 240);
  assert.equal(phase2?.savings?.value, 260 + 240);
  // …but only the grade-aware one carries grade provenance, and the ids never collide.
  assert.equal(phase1?.gradeProvenance, undefined);
  assert.deepEqual(phase2?.gradeProvenance, {
    gradingVersion: GRADING_VERSION,
    suiteRunIds: ["sr-1"],
  });
  assert.notEqual(phase1?.id, phase2?.id);

  // Every published finding is drillable and every savings figure is a labeled estimate.
  for (const rec of result.recommendations) {
    assert.ok(rec.evidence.length >= 1);
    if (rec.savings) {
      assert.equal(rec.savings.estimate, true);
      assert.ok(rec.savings.basis.trim().length > 0);
    }
  }
  // Every gap names what is missing.
  for (const gap of result.insufficientData) assert.ok(gap.reason.trim().length > 0);
});
