import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import {
  ADVISOR_VERSION,
  advisorReportSchema,
  type AdvisorReport,
} from "@mcp-token-footprint/shared";
import { registerAdvisorRoutes } from "../src/advisor/routes.js";
import { DESCRIPTION_BLOAT_RULE_ID } from "../src/advisor/rules/description-bloat.js";
import { LOADING_MODE_RULE_ID } from "../src/advisor/rules/loading-mode.js";
import { MODEL_QUALITY_BAR_RULE_ID } from "../src/advisor/rules/model-quality-bar.js";
import { SKILL_EFFECT_RULE_ID } from "../src/advisor/rules/skill-effect.js";
import { TOOL_OVERLAP_RULE_ID } from "../src/advisor/rules/tool-overlap.js";
import { UNUSED_TOOL_TRIM_RULE_ID } from "../src/advisor/rules/unused-tool-trim.js";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { GradeRepository } from "../src/grading/grade-repository.js";
import { ScanRepository } from "../src/scans/repository.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { ServerRepository } from "../src/servers/repository.js";
import { SkillRepository } from "../src/skills/repository.js";
import { SuiteRunRepository } from "../src/suites/suite-run-repository.js";
import { RunRepository } from "../src/testing/run-repository.js";
import { ScenarioRepository } from "../src/testing/scenario-repository.js";

// WP 1.2 (Advisor) — `GET /api/advisor/report` over a REAL Fastify app, a real SQLite schema and the
// real repositories. Where `advisor-rules.test.ts` proves the arithmetic against fixtures, this file
// proves the wiring: that the concrete repositories really do satisfy the advisor's read ports at
// RUNTIME (not just structurally at compile time), that the query is validated, that an unknown id
// 404s, and that the report an operator receives is deterministic.
//
// Fully offline: no MCP connection, no provider key, no child process.

const databases: AppDatabase[] = [];
const apps: FastifyInstance[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const db of databases.splice(0)) db.close();
});

type Harness = {
  baseUrl: string;
  db: AppDatabase;
  servers: ServerRepository;
  scans: ScanRepository;
  scenarios: ScenarioRepository;
  runs: RunRepository;
  // WP 2.1 — the grade-aware ports, wired from the same real repositories the app uses.
  grades: GradeRepository;
  suiteRuns: SuiteRunRepository;
  skills: SkillRepository;
};

async function makeApp(): Promise<Harness> {
  const db = new Database(":memory:") as unknown as AppDatabase;
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  databases.push(db);

  const secrets = new SecretStore(Buffer.alloc(32, 7));
  const servers = new ServerRepository(db, secrets);
  const scans = new ScanRepository(db);
  const scenarios = new ScenarioRepository(db);
  const runs = new RunRepository(db);
  const grades = new GradeRepository(db);
  const suiteRuns = new SuiteRunRepository(db);
  const skills = new SkillRepository(db, secrets);

  const app = Fastify({ logger: false });
  // The same mapping the real app installs (`apps/api/src/index.ts`): ZodError → 400, otherwise the
  // typed error's own `statusCode` (so a repository's `httpError(404, …)` really is a 404 here too).
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: "Validation failed", issues: error.issues });
    }
    const typed = error as Error & { statusCode?: number };
    return reply.code(typed.statusCode ?? 500).send({ error: error.message });
  });
  await registerAdvisorRoutes(app, {
    servers,
    scans,
    scenarios,
    runs,
    grades,
    suiteRuns,
    skills,
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  apps.push(app);

  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    db,
    servers,
    scans,
    scenarios,
    runs,
    grades,
    suiteRuns,
    skills,
  };
}

// ── Seeding (the real repositories where they have a create path, SQL where a full pipeline would
//    otherwise have to be simulated — the READ path under test is repository code either way) ─────

function addServer(h: Harness, name: string): string {
  return h.servers.create({
    name,
    transport: "stdio",
    command: "node",
    args: [],
    env: {},
    headers: {},
  }).id;
}

type SeedTool = {
  name: string;
  totalTokens: number;
  descriptionTokens?: number;
  description?: string;
};

function addScan(h: Harness, serverId: string, tools: SeedTool[]): string {
  const scan = h.scans.createRunningScan(serverId, "generic_o200k");
  const totalTokens = tools.reduce((sum, t) => sum + t.totalTokens, 0);
  const largest = [...tools].sort((a, b) => b.totalTokens - a.totalTokens)[0];

  h.scans.completeScan(
    scan.id,
    {
      totalTools: tools.length,
      totalTokens,
      totalRawBytes: totalTokens * 4,
      averageTokensPerTool: tools.length === 0 ? 0 : totalTokens / tools.length,
      largestToolName: largest?.name ?? null,
      largestToolTokens: largest?.totalTokens ?? 0,
      totalResources: 0,
      totalResourceTemplates: 0,
      totalPrompts: 0,
      totalResourceTokens: 0,
      totalPromptTokens: 0,
      largestResourceName: null,
      largestResourceTokens: 0,
      largestPromptName: null,
      largestPromptTokens: 0,
    },
    tools.map((t) => ({
      toolName: t.name,
      ...(t.description === undefined ? {} : { description: t.description }),
      rawTool: { name: t.name },
      totalTokens: t.totalTokens,
      nameTokens: 2,
      descriptionTokens: t.descriptionTokens ?? 0,
      schemaTokens: Math.max(t.totalTokens - (t.descriptionTokens ?? 0) - 2, 0),
      annotationsTokens: 0,
      rawBytes: t.totalTokens * 4,
      contributionPercent: totalTokens === 0 ? 0 : (t.totalTokens / totalTokens) * 100,
    })),
  );
  return scan.id;
}

function seedProviderAndTest(h: Harness): void {
  const now = "2026-08-01T00:00:00.000Z";
  h.db
    .prepare(
      `INSERT INTO provider_credentials (id, kind, label, created_at, updated_at)
       VALUES ('prov-1', 'anthropic', 'Claude', @now, @now)`,
    )
    .run({ now });
  h.db
    .prepare(
      `INSERT INTO tests (id, name, user_prompt, created_at, updated_at)
       VALUES ('test-1', 'T', 'go', @now, @now)`,
    )
    .run({ now });
}

function addScenario(
  h: Harness,
  name: string,
  allowedServers: Array<{ serverId: string; allowedTools: string[] | null }>,
  toolLoadingMode: "eager" | "deferred" = "eager",
): string {
  return h.scenarios.create({
    name,
    providerId: "prov-1",
    model: "claude-sonnet-4",
    params: {},
    systemPrompt: "test",
    allowedServers,
    allowedSkills: [],
    defaultProfiles: [],
    guardrails: {},
    toolLoadingMode,
  }).id;
}

/** A completed run + its `tool_call` steps, inserted directly (the engine pipeline is not what is
 *  under test here; `listRuns` / `getToolCallSequence` still read it as real repository code). */
function addCompletedRun(
  h: Harness,
  opts: {
    id: string;
    scenarioId: string;
    startedAt: string;
    turns?: number;
    tokensIn?: number;
    peakContextTokens?: number;
    costUsd?: number;
    toolCalls?: string[];
  },
): void {
  h.db
    .prepare(
      `INSERT INTO runs (
         id, test_id, scenario_id, mode, status, started_at, turns, tool_calls,
         peak_context_tokens, tokens_in, tokens_out, cost_usd
       ) VALUES (
         @id, 'test-1', @scenarioId, 'automated', 'completed', @startedAt, @turns, @toolCallCount,
         @peak, @tokensIn, 0, @costUsd
       )`,
    )
    .run({
      id: opts.id,
      scenarioId: opts.scenarioId,
      startedAt: opts.startedAt,
      turns: opts.turns ?? 1,
      toolCallCount: opts.toolCalls?.length ?? 0,
      peak: opts.peakContextTokens ?? 0,
      tokensIn: opts.tokensIn ?? 0,
      costUsd: opts.costUsd ?? 0,
    });

  const insertStep = h.db.prepare(
    `INSERT INTO run_steps (id, run_id, idx, type, label, status, tool_name)
     VALUES (@id, @runId, @idx, 'tool_call', @label, 'ok', @toolName)`,
  );
  (opts.toolCalls ?? []).forEach((toolName, index) => {
    insertStep.run({
      id: `${opts.id}-step-${index}`,
      runId: opts.id,
      idx: index,
      label: toolName,
      toolName,
    });
  });
}

async function getReport(
  h: Harness,
  query: string,
): Promise<{ status: number; body: AdvisorReport }> {
  const res = await fetch(`${h.baseUrl}/api/advisor/report${query}`);
  return { status: res.status, body: (await res.json()) as AdvisorReport };
}

// ── Query validation ─────────────────────────────────────────────────────────────────────────────

test("the route validates its query with zod: no scope, unknown scope, and bad id/scope pairings are 400", async () => {
  const h = await makeApp();

  for (const query of [
    "", // no scope at all
    "?scope=", // blank
    "?scope=galaxy", // not an AdvisorScopeKind
    "?scope=server", // scoped report with no id
    "?scope=scenario", // scoped report with no id
    "?scope=fleet&id=srv-1", // fleet report carrying an id it would silently ignore
    "?scope=server&id=", // blank id
  ]) {
    const res = await fetch(`${h.baseUrl}/api/advisor/report${query}`);
    assert.equal(res.status, 400, `expected 400 for "${query}"`);
  }
});

test("an unknown id 404s rather than answering with an empty report", async () => {
  const h = await makeApp();
  seedProviderAndTest(h);

  const server = await fetch(`${h.baseUrl}/api/advisor/report?scope=server&id=does-not-exist`);
  assert.equal(server.status, 404);

  const scenario = await fetch(`${h.baseUrl}/api/advisor/report?scope=scenario&id=does-not-exist`);
  assert.equal(scenario.status, 404);
});

// ── The report ───────────────────────────────────────────────────────────────────────────────────

test("an empty install returns a valid, stamped, empty fleet report", async () => {
  const h = await makeApp();
  const { status, body } = await getReport(h, "?scope=fleet");

  assert.equal(status, 200);
  assert.equal(advisorReportSchema.safeParse(body).success, true);
  assert.equal(body.advisorVersion, ADVISOR_VERSION);
  assert.deepEqual(body.scope, { kind: "fleet" });
  assert.deepEqual(body.recommendations, []);
  // Four rules genuinely could not run: there is nothing to compare, nothing to observe, no suite
  // run to read a grade from, and no ± skill variant axis. WP 2.1 added the last two — the
  // grade-aware rules report an EMPTY install as a named gap, never as "nothing to improve".
  assert.deepEqual(
    body.insufficientData.map((gap) => gap.ruleId).sort(),
    [
      LOADING_MODE_RULE_ID,
      TOOL_OVERLAP_RULE_ID,
      SKILL_EFFECT_RULE_ID,
      MODEL_QUALITY_BAR_RULE_ID,
    ].sort(),
  );
  for (const gap of body.insufficientData) assert.ok(gap.reason.trim().length > 0);
});

test("environment scope: the unused-tool trim reaches the wire with hand-checkable arithmetic", async () => {
  const h = await makeApp();
  seedProviderAndTest(h);

  const serverId = addServer(h, "Docs server");
  addScan(h, serverId, [
    { name: "search", totalTokens: 400 },
    { name: "fetch", totalTokens: 300 },
    { name: "admin", totalTokens: 260 },
    { name: "purge", totalTokens: 240 },
  ]);
  const scenarioId = addScenario(h, "Docs env", [{ serverId, allowedTools: null }]);
  addCompletedRun(h, {
    id: "run-1",
    scenarioId,
    startedAt: "2026-08-05T00:00:00.000Z",
    turns: 2,
    toolCalls: ["search", "search", "fetch"],
  });

  const { status, body } = await getReport(h, `?scope=scenario&id=${scenarioId}`);
  assert.equal(status, 200);
  assert.equal(advisorReportSchema.safeParse(body).success, true);
  assert.deepEqual(body.scope, { kind: "scenario", id: scenarioId });

  const trim = body.recommendations.find((rec) => rec.ruleId === UNUSED_TOOL_TRIM_RULE_ID);
  // HAND-COMPUTED: `admin` (260) and `purge` (240) were never called → 500 tokens per turn.
  assert.equal(trim?.savings?.value, 260 + 240);
  assert.equal(trim?.savings?.unit, "tokens_per_turn");
  assert.equal(trim?.savings?.estimate, true);
  // HAND-COMPUTED severity: 500 / 1200 = 41.7% → medium.
  assert.equal(trim?.severity, "medium");
  assert.match(trim?.detail ?? "", /Suggested allowedTools: fetch, search\./);
  assert.ok(trim?.evidence.some((ref) => ref.kind === "scan"));
  assert.ok(trim?.evidence.some((ref) => ref.kind === "tool_scan" && ref.label === "admin"));
});

test("environment scope with no runs: an honest gap, and no fabricated zero", async () => {
  const h = await makeApp();
  seedProviderAndTest(h);

  const serverId = addServer(h, "Docs server");
  addScan(h, serverId, [{ name: "search", totalTokens: 400 }]);
  const scenarioId = addScenario(h, "Fresh env", [{ serverId, allowedTools: null }]);

  const { body } = await getReport(h, `?scope=scenario&id=${scenarioId}`);
  assert.deepEqual(body.recommendations, []);

  const trimGap = body.insufficientData.find((gap) => gap.ruleId === UNUSED_TOOL_TRIM_RULE_ID);
  assert.match(trimGap?.reason ?? "", /has no completed runs/);
  const modeGap = body.insufficientData.find((gap) => gap.ruleId === LOADING_MODE_RULE_ID);
  assert.match(modeGap?.reason ?? "", /no completed runs that started after it was last edited/);
  assert.equal(JSON.stringify(body).includes('"savings"'), false);
});

test("server scope: description bloat and cross-server overlap are computed from persisted scans", async () => {
  const h = await makeApp();

  const alpha = addServer(h, "Alpha");
  const beta = addServer(h, "Beta");
  addScan(h, alpha, [
    {
      name: "search_documents",
      totalTokens: 1000,
      descriptionTokens: 700,
      description: "search the docs",
    },
    { name: "alpha_only", totalTokens: 90, description: "zzz unique alpha capability" },
  ]);
  addScan(h, beta, [
    {
      name: "search_documents",
      totalTokens: 900,
      descriptionTokens: 600,
      description: "search the docs",
    },
    { name: "beta_only", totalTokens: 70, description: "qqq distinct beta feature" },
  ]);

  const { body } = await getReport(h, `?scope=server&id=${alpha}`);
  assert.equal(advisorReportSchema.safeParse(body).success, true);

  const bloat = body.recommendations.find((rec) => rec.ruleId === DESCRIPTION_BLOAT_RULE_ID);
  // HAND-COMPUTED: only `search_documents` is flagged on Alpha → 700 description tokens.
  assert.equal(bloat?.savings?.value, 700);
  assert.equal(bloat?.savings?.unit, "tokens");
  // HAND-COMPUTED severity: 700 / (1000 + 90) = 64.2% ≥ 30% → high.
  assert.equal(bloat?.severity, "high");

  const overlap = body.recommendations.find((rec) => rec.ruleId === TOOL_OVERLAP_RULE_ID);
  // HAND-COMPUTED: one duplicated pair → min(1000, 900) = 900.
  assert.equal(overlap?.savings?.value, 900);
  assert.equal(overlap?.severity, "info"); // one duplicate is below the medium threshold of 3
  assert.match(overlap?.detail ?? "", /search_documents ↔ search_documents/);

  // The run-dependent rules do not apply to a bare server scope, so they contribute nothing at all
  // — not even a gap (a scope a rule was never meant to cover is not a data gap).
  assert.equal(
    body.insufficientData.some((gap) => gap.ruleId === UNUSED_TOOL_TRIM_RULE_ID),
    false,
  );
  assert.equal(
    body.insufficientData.some((gap) => gap.ruleId === LOADING_MODE_RULE_ID),
    false,
  );
});

test("fleet scope: the eager-vs-deferred comparison only counts runs attributable to the current mode", async () => {
  const h = await makeApp();
  seedProviderAndTest(h);

  const serverId = addServer(h, "Docs server");
  addScan(h, serverId, [{ name: "search", totalTokens: 400 }]);
  const eager = addScenario(h, "Eager env", [{ serverId, allowedTools: null }], "eager");
  const deferred = addScenario(h, "Deferred env", [{ serverId, allowedTools: null }], "deferred");

  // Both environments were created just now, so every seeded run must start AFTER that instant to be
  // attributable to the mode they carry — which is exactly the guard under test.
  addCompletedRun(h, {
    id: "run-eager",
    scenarioId: eager,
    startedAt: "2030-01-01T00:00:00.000Z",
    turns: 3,
    tokensIn: 9000,
    toolCalls: ["search"],
  });
  addCompletedRun(h, {
    id: "run-defer",
    scenarioId: deferred,
    startedAt: "2030-01-01T00:00:00.000Z",
    turns: 2,
    tokensIn: 2000,
    toolCalls: ["search"],
  });
  // A run from BEFORE the environments existed: it cannot be attributed to any mode and must be
  // ignored, however dramatic its numbers.
  addCompletedRun(h, {
    id: "run-prehistoric",
    scenarioId: eager,
    startedAt: "2020-01-01T00:00:00.000Z",
    turns: 1,
    tokensIn: 999_999,
    toolCalls: ["search"],
  });

  const { body } = await getReport(h, "?scope=fleet");
  const comparison = body.recommendations.find((rec) => rec.ruleId === LOADING_MODE_RULE_ID);

  // HAND-COMPUTED: eager 9000 / 3 = 3000 per turn; deferred 2000 / 2 = 1000 per turn → 2000.
  assert.equal(comparison?.savings?.value, 9000 / 3 - 2000 / 2);
  assert.equal(comparison?.savings?.value, 2000);
  assert.equal(comparison?.savings?.unit, "tokens_per_turn");
  assert.match(
    comparison?.assumptions.join(" ") ?? "",
    /never recorded on a run/,
    "the mutable-mode assumption is stated on the finding",
  );
});

test("two calls over unchanged data return byte-identical reports (apart from the clock)", async () => {
  const h = await makeApp();
  seedProviderAndTest(h);

  const alpha = addServer(h, "Alpha");
  const beta = addServer(h, "Beta");
  addScan(h, alpha, [
    {
      name: "search_documents",
      totalTokens: 1000,
      descriptionTokens: 700,
      description: "search the docs",
    },
    { name: "admin", totalTokens: 260 },
  ]);
  addScan(h, beta, [
    {
      name: "search_documents",
      totalTokens: 900,
      descriptionTokens: 600,
      description: "search the docs",
    },
  ]);
  const scenarioId = addScenario(h, "Env", [
    { serverId: alpha, allowedTools: null },
    { serverId: beta, allowedTools: null },
  ]);
  addCompletedRun(h, {
    id: "run-1",
    scenarioId,
    startedAt: "2030-01-01T00:00:00.000Z",
    turns: 2,
    tokensIn: 4000,
    toolCalls: ["search_documents"],
  });

  const first = await getReport(h, "?scope=fleet");
  const second = await getReport(h, "?scope=fleet");

  const withoutClock = (report: AdvisorReport) =>
    JSON.stringify({ ...report, generatedAt: "<clock>" });
  assert.equal(withoutClock(first.body), withoutClock(second.body));
  assert.ok(first.body.recommendations.length > 0, "the fixture produces real findings");
  // `generatedAt` is a real ISO timestamp from the request's clock, not a frozen placeholder.
  assert.match(first.body.generatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

test("the same finding keeps one stable id whether it is reached from a server or a fleet report", async () => {
  const h = await makeApp();

  const alpha = addServer(h, "Alpha");
  const beta = addServer(h, "Beta");
  addScan(h, alpha, [
    { name: "search_documents", totalTokens: 1000, description: "search the docs" },
  ]);
  addScan(h, beta, [
    { name: "search_documents", totalTokens: 900, description: "search the docs" },
  ]);

  const fromServer = await getReport(h, `?scope=server&id=${beta}`);
  const fromFleet = await getReport(h, "?scope=fleet");

  const overlapId = (report: AdvisorReport) =>
    report.recommendations.find((rec) => rec.ruleId === TOOL_OVERLAP_RULE_ID)?.id;
  assert.ok(overlapId(fromServer.body));
  assert.equal(overlapId(fromServer.body), overlapId(fromFleet.body));
});
