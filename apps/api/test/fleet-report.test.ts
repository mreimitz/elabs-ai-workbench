import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import {
  ADVISOR_VERSION,
  FLEET_REPORT_SUITE_RUN_LIMIT,
  fleetReportSchema,
  type AdvisorReport,
  type FleetPostureSummary,
  type FleetReport,
  type SuiteAggregates,
} from "@mcp-token-footprint/shared";
import { registerAdvisorRoutes } from "../src/advisor/routes.js";
import { createAdvisorContext } from "../src/advisor/repository.js";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { GradeRepository } from "../src/grading/grade-repository.js";
import { RunReportService } from "../src/grading/run-report.js";
import {
  createFleetReport,
  type FleetPostureProvider,
  type FleetReportDeps,
} from "../src/reports/fleet-report.js";
import { createFleetMarkdownReport } from "../src/reports/fleet-report-markdown.js";
import { DigestReportRepository, DigestScheduleService } from "../src/reports/digest.js";
import { AppSettingsRepository } from "../src/grading/app-settings-repository.js";
import { RatingIssueRepository } from "../src/grading/issue-repository.js";
import { registerReportRoutes } from "../src/reports/routes.js";
import { ScanRepository } from "../src/scans/repository.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { ServerRepository } from "../src/servers/repository.js";
import { SuiteRepository } from "../src/suites/repository.js";
import { SuiteReportRepository } from "../src/suites/suite-report-repository.js";
import { SuiteRunRepository } from "../src/suites/suite-run-repository.js";
import { SuiteService } from "../src/suites/service.js";
import { RunRepository } from "../src/testing/run-repository.js";
import { ScenarioRepository } from "../src/testing/scenario-repository.js";
import { ScenarioService } from "../src/testing/scenario-service.js";
import { TestRepository } from "../src/testing/test-repository.js";
import { TestService } from "../src/testing/test-service.js";

// Advisor WP 2.2 — the fleet report (`GET /api/reports/fleet/{json,markdown}`) over a REAL SQLite
// schema and the REAL repositories. What is under test: that the report renders from persisted data,
// that it is stamped `ADVISOR_VERSION`, that EVERY empty section names its gap instead of showing a
// silent zero, that the same inputs under the same clock produce byte-identical output, and that the
// Markdown twin renders both a populated and an empty section.
//
// Fully offline: no MCP connection, no provider key, no child process.

const databases: AppDatabase[] = [];
const apps: FastifyInstance[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const db of databases.splice(0)) db.close();
});

const FIXED_NOW = "2026-08-18T12:00:00.000Z";

type Harness = {
  db: AppDatabase;
  servers: ServerRepository;
  scans: ScanRepository;
  scenarios: ScenarioRepository;
  runs: RunRepository;
  suiteRuns: SuiteRunRepository;
  suites: SuiteService;
};

function makeHarness(): Harness {
  const db = new Database(":memory:") as unknown as AppDatabase;
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  databases.push(db);

  return {
    db,
    servers: new ServerRepository(db, new SecretStore(Buffer.alloc(32, 5))),
    scans: new ScanRepository(db),
    scenarios: new ScenarioRepository(db),
    runs: new RunRepository(db),
    suiteRuns: new SuiteRunRepository(db),
    suites: new SuiteService(new SuiteRepository(db)),
  };
}

/** The deps the composer runs on, with a FIXED clock so `generatedAt` is part of the determinism
 *  contract rather than an excuse for two runs to differ. */
function makeDeps(h: Harness, posture?: FleetPostureProvider): FleetReportDeps {
  return {
    advisor: createAdvisorContext(
      { servers: h.servers, scans: h.scans, scenarios: h.scenarios, runs: h.runs },
      () => new Date(FIXED_NOW),
    ),
    suiteRuns: h.suiteRuns,
    suites: h.suites,
    ...(posture ? { posture } : {}),
  };
}

// ── Seeding ─────────────────────────────────────────────────────────────────────────────────────

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

type SeedTool = { name: string; totalTokens: number; description?: string };

/**
 * A completed scan with an EXPLICIT `scanned_at`. The repository stamps `new Date()`, which two
 * scans created in the same millisecond would share — and "the two most recent successful scans" has
 * to be a fact, not a race.
 */
function addScan(
  h: Harness,
  serverId: string,
  scannedAt: string,
  tools: SeedTool[],
  opts: { profile?: "generic_o200k" | "generic_cl100k"; status?: "success" | "error" } = {},
): string {
  const scan = h.scans.createRunningScan(serverId, opts.profile ?? "generic_o200k");
  const totalTokens = tools.reduce((sum, t) => sum + t.totalTokens, 0);
  const largest = [...tools].sort((a, b) => b.totalTokens - a.totalTokens)[0];

  if (opts.status === "error") {
    h.scans.failScan(scan.id, "boom");
  } else {
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
        descriptionTokens: 0,
        schemaTokens: Math.max(t.totalTokens - 2, 0),
        annotationsTokens: 0,
        rawBytes: t.totalTokens * 4,
        contributionPercent: totalTokens === 0 ? 0 : (t.totalTokens / totalTokens) * 100,
      })),
    );
  }
  h.db.prepare("UPDATE mcp_scans SET scanned_at = ? WHERE id = ?").run(scannedAt, scan.id);
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

function addScenario(h: Harness, name: string, serverIds: string[] = []): string {
  return h.scenarios.create({
    name,
    providerId: "prov-1",
    model: "claude-sonnet-4",
    params: {},
    systemPrompt: "test",
    allowedServers: serverIds.map((serverId) => ({ serverId, allowedTools: null })),
    allowedSkills: [],
    defaultProfiles: [],
    guardrails: {},
    toolLoadingMode: "eager",
  }).id;
}

function addRun(
  h: Harness,
  opts: {
    id: string;
    scenarioId: string;
    startedAt: string;
    status?: string;
    costUsd?: number;
    costBasis?: string;
    tokensIn?: number;
    tokensOut?: number;
    toolCalls?: string[];
  },
): void {
  const toolCalls = opts.toolCalls ?? [];
  h.db
    .prepare(
      `INSERT INTO runs (
         id, test_id, scenario_id, mode, status, started_at, turns, tool_calls,
         peak_context_tokens, tokens_in, tokens_out, cost_usd, cost_basis
       ) VALUES (
         @id, 'test-1', @scenarioId, 'automated', @status, @startedAt, 1, @toolCallCount,
         0, @tokensIn, @tokensOut, @costUsd, @costBasis
       )`,
    )
    .run({
      id: opts.id,
      scenarioId: opts.scenarioId,
      startedAt: opts.startedAt,
      status: opts.status ?? "completed",
      toolCallCount: toolCalls.length,
      tokensIn: opts.tokensIn ?? 0,
      tokensOut: opts.tokensOut ?? 0,
      costUsd: opts.costUsd ?? 0,
      costBasis: opts.costBasis ?? null,
    });

  const insertStep = h.db.prepare(
    `INSERT INTO run_steps (id, run_id, idx, type, label, status, tool_name)
     VALUES (@id, @runId, @idx, 'tool_call', @label, 'ok', @toolName)`,
  );
  toolCalls.forEach((toolName, index) => {
    insertStep.run({
      id: `${opts.id}-step-${index}`,
      runId: opts.id,
      idx: index,
      label: toolName,
      toolName,
    });
  });
}

function addSuiteRun(
  h: Harness,
  opts: {
    id: string;
    startedAt: string;
    status?: string;
    suiteId?: string;
    source?: string;
    aggregates?: SuiteAggregates;
  },
): void {
  h.db
    .prepare(
      `INSERT INTO suite_runs (id, suite_id, status, config_snapshot_json, started_at, source, aggregates_json)
       VALUES (@id, @suiteId, @status, '{}', @startedAt, @source, @aggregates)`,
    )
    .run({
      id: opts.id,
      suiteId: opts.suiteId ?? null,
      status: opts.status ?? "completed",
      startedAt: opts.startedAt,
      source: opts.source ?? "adhoc",
      aggregates: opts.aggregates ? JSON.stringify(opts.aggregates) : null,
    });
}

const GRADED_AGGREGATES: SuiteAggregates = {
  cellsTotal: 4,
  cellsCompleted: 4,
  meanGrade: 0.75,
  gradeStdDev: 0.1,
  passRateAt05: 0.5,
  totalTokens: 12_000,
  execCostUsd: 0.25,
  judgeCostUsd: 0.05,
};

/** A fixture fleet exercising every section: two servers with drift (one comparable, one not), a
 *  never-scanned server, two environments (one run, one bare), and two suite runs. */
function seedFullFleet(h: Harness): { alpha: string; beta: string; env: string } {
  seedProviderAndTest(h);

  const alpha = addServer(h, "Alpha");
  const beta = addServer(h, "Beta");
  addServer(h, "Zeta");

  // Alpha: two comparable successful scans. HAND-COMPUTED drift below.
  addScan(h, alpha, "2026-08-01T00:00:00.000Z", [
    { name: "search", totalTokens: 400, description: "search the docs" },
    { name: "fetch", totalTokens: 300, description: "fetch a document by id" },
  ]);
  addScan(h, alpha, "2026-08-10T00:00:00.000Z", [
    { name: "search", totalTokens: 500, description: "search the docs, now with filters" },
    { name: "purge", totalTokens: 260, description: "delete every stored record permanently" },
  ]);

  // Beta: two scans counted under DIFFERENT token profiles — deltas must be refused, not zeroed.
  addScan(h, beta, "2026-08-02T00:00:00.000Z", [{ name: "b_one", totalTokens: 100 }], {
    profile: "generic_o200k",
  });
  addScan(h, beta, "2026-08-11T00:00:00.000Z", [{ name: "b_one", totalTokens: 900 }], {
    profile: "generic_cl100k",
  });

  const env = addScenario(h, "Docs env", [alpha]);
  addScenario(h, "Unused env", [beta]);

  // `search` is exercised, `purge` never is — enough for the advisor's unused-tool trim to have a
  // real finding to contribute to the report's recommendations section.
  addRun(h, {
    id: "run-1",
    scenarioId: env,
    startedAt: "2026-08-12T00:00:00.000Z",
    costUsd: 0.5,
    tokensIn: 1000,
    tokensOut: 200,
    toolCalls: ["search"],
  });
  addRun(h, {
    id: "run-2",
    scenarioId: env,
    startedAt: "2026-08-13T00:00:00.000Z",
    status: "error",
    costUsd: 0.25,
    tokensIn: 400,
    tokensOut: 10,
  });
  addRun(h, {
    id: "run-3",
    scenarioId: env,
    startedAt: "2026-08-14T00:00:00.000Z",
    costUsd: 1.5,
    costBasis: "subscription_reference",
    tokensIn: 100,
    tokensOut: 100,
  });

  addSuiteRun(h, {
    id: "sr-graded",
    startedAt: "2026-08-15T00:00:00.000Z",
    source: "adhoc",
    aggregates: GRADED_AGGREGATES,
  });
  addSuiteRun(h, { id: "sr-bare", startedAt: "2026-08-14T00:00:00.000Z", source: "collection" });

  return { alpha, beta, env };
}

// ── An empty install: every section names its gap ────────────────────────────────────────────────

test("an empty install renders a valid, stamped report in which EVERY section states its gap", () => {
  const h = makeHarness();
  const report = createFleetReport(makeDeps(h));

  assert.equal(fleetReportSchema.safeParse(report).success, true);
  assert.equal(report.advisorVersion, ADVISOR_VERSION);
  assert.equal(report.generatedAt, FIXED_NOW);

  // Not "no data" as an empty array with no explanation — each section says WHAT is missing.
  assert.match(report.servers.gap ?? "", /No MCP server is registered/);
  assert.match(report.environments.gap ?? "", /No environment is configured/);
  assert.match(report.suites.gap ?? "", /No suite run has been executed/);
  assert.match(report.posture.gap ?? "", /security-posture analyzer/);
  assert.equal(report.posture.summary, null);

  assert.deepEqual(report.servers.entries, []);
  assert.deepEqual(report.environments.entries, []);
  assert.deepEqual(report.suites.entries, []);
  assert.equal(report.suites.totalSuiteRuns, 0);

  // The advisor section is present and honest too: nothing to recommend, but the rules that could
  // not run say so — that is the section's content, not an absence.
  assert.deepEqual(report.advisor.report.recommendations, []);
  assert.ok(report.advisor.report.insufficientData.length > 0);
  for (const gap of report.advisor.report.insufficientData) {
    assert.ok(gap.reason.trim().length > 0);
  }
});

test("the Markdown of an empty install renders every section heading with its gap as prose", () => {
  const h = makeHarness();
  const md = createFleetMarkdownReport(createFleetReport(makeDeps(h)));

  for (const heading of [
    "# Fleet report",
    "## Servers & drift",
    "## Environment costs",
    "## Suite grades",
    "## Security posture",
    "## Advisor recommendations",
  ]) {
    assert.ok(md.includes(heading), `expected the document to contain "${heading}"`);
  }
  assert.ok(md.includes(`Advisor version ${ADVISOR_VERSION}`));
  assert.ok(md.includes("_No MCP server is registered, so there is no fleet to report on._"));
  assert.ok(md.includes("_No environment is configured"));
  assert.ok(md.includes("_No suite run has been executed"));
  assert.ok(md.includes("roadmap/security-posture/"));
  // No table headers at all — an empty section renders its sentence, never a header row with no rows
  // under it (which reads as "we looked and found none").
  assert.equal(md.includes("| Server | Transport |"), false);
});

// ── A populated fleet ───────────────────────────────────────────────────────────────────────────

test("servers + drift come from the two most recent SUCCESSFUL scans, with hand-checked arithmetic", () => {
  const h = makeHarness();
  seedFullFleet(h);
  const report = createFleetReport(makeDeps(h));

  assert.equal(fleetReportSchema.safeParse(report).success, true);
  // Ordered by name, so the document is stable regardless of the repository's `updated_at DESC`.
  assert.deepEqual(
    report.servers.entries.map((entry) => entry.serverName),
    ["Alpha", "Beta", "Zeta"],
  );
  assert.equal(report.servers.gap, undefined);

  const alpha = report.servers.entries[0];
  assert.equal(alpha?.latestScan?.scannedAt, "2026-08-10T00:00:00.000Z");
  assert.equal(alpha?.latestScan?.totalTokens, 760); // 500 + 260
  assert.equal(alpha?.drift?.previousScan.scannedAt, "2026-08-01T00:00:00.000Z");
  // HAND-COMPUTED: `purge` is new, `fetch` is gone, `search`'s description changed.
  assert.equal(alpha?.drift?.toolsAdded, 1);
  assert.equal(alpha?.drift?.toolsRemoved, 1);
  assert.equal(alpha?.drift?.toolsChanged, 1);
  // HAND-COMPUTED: 760 − 700 = +60, i.e. 60/700 = 8.571…%.
  assert.equal(alpha?.drift?.deltaTokens, 60);
  assert.equal(alpha?.drift?.deltasComparable, true);
  assert.ok(Math.abs((alpha?.drift?.deltaPercent ?? 0) - (60 / 700) * 100) < 1e-9);

  // Beta's two scans were counted under different profiles: the delta is REFUSED (null), not zeroed.
  const beta = report.servers.entries[1];
  assert.equal(beta?.drift?.deltasComparable, false);
  assert.equal(beta?.drift?.deltaTokens, null);
  assert.equal(beta?.drift?.deltaPercent, null);

  // A never-scanned server is listed with a named gap rather than dropped or shown as 0 tokens.
  const zeta = report.servers.entries[2];
  assert.equal(zeta?.latestScan, null);
  assert.match(zeta?.gap ?? "", /Never scanned successfully/);
});

test("a failed latest scan never becomes the reported footprint", () => {
  const h = makeHarness();
  const serverId = addServer(h, "Alpha");
  addScan(h, serverId, "2026-08-01T00:00:00.000Z", [{ name: "search", totalTokens: 400 }]);
  addScan(h, serverId, "2026-08-09T00:00:00.000Z", [], { status: "error" });

  const report = createFleetReport(makeDeps(h));
  const entry = report.servers.entries[0];
  // The successful scan, not the newer failed one (whose totals are structurally zero).
  assert.equal(entry?.latestScan?.scannedAt, "2026-08-01T00:00:00.000Z");
  assert.equal(entry?.latestScan?.totalTokens, 400);
  assert.equal(entry?.drift, null);
  assert.match(entry?.gap ?? "", /Only one successful scan/);
});

test("environment costs keep billed and subscription-reference money apart, and count every run", () => {
  const h = makeHarness();
  seedFullFleet(h);
  const report = createFleetReport(makeDeps(h));

  assert.deepEqual(
    report.environments.entries.map((entry) => entry.name),
    ["Docs env", "Unused env"],
  );

  const docs = report.environments.entries[0];
  // HAND-COMPUTED: three runs (two completed, one errored); billed = 0.5 + 0.25 over 2 runs.
  assert.equal(docs?.runs, 3);
  assert.equal(docs?.completedRuns, 2);
  assert.equal(docs?.billedRuns, 2);
  assert.ok(Math.abs((docs?.billedCostUsd ?? 0) - 0.75) < 1e-9);
  assert.ok(Math.abs((docs?.meanBilledCostUsd ?? 0) - 0.375) < 1e-9);
  // The subscription run's $1.50 is a reference price and is NEVER folded into the billed total.
  assert.equal(docs?.subscriptionReferenceRuns, 1);
  assert.ok(Math.abs((docs?.subscriptionReferenceCostUsd ?? 0) - 1.5) < 1e-9);
  assert.equal(docs?.tokensIn, 1500);
  assert.equal(docs?.tokensOut, 310);
  assert.equal(docs?.gap, undefined);

  // An environment that has never run says so, instead of publishing a row of zeros.
  const unused = report.environments.entries[1];
  assert.equal(unused?.runs, 0);
  assert.equal(unused?.meanBilledCostUsd, null);
  assert.match(unused?.gap ?? "", /No run has been recorded/);
});

test("suite grades are read off the persisted aggregates; a run without them says so", () => {
  const h = makeHarness();
  seedFullFleet(h);
  const report = createFleetReport(makeDeps(h));

  assert.equal(report.suites.totalSuiteRuns, 2);
  assert.deepEqual(
    report.suites.entries.map((entry) => entry.suiteRunId),
    ["sr-graded", "sr-bare"], // newest first
  );

  const graded = report.suites.entries[0];
  assert.equal(graded?.meanGrade, 0.75);
  assert.equal(graded?.passRateAt05, 0.5);
  assert.equal(graded?.execCostUsd, 0.25);
  assert.equal(graded?.judgeCostUsd, 0.05);
  assert.equal(graded?.label, "adhoc plan"); // no saved suite → labeled by what it was
  assert.equal(graded?.gap, undefined);

  const bare = report.suites.entries[1];
  assert.equal(bare?.meanGrade, null);
  assert.match(bare?.gap ?? "", /carries no aggregates/);
  assert.equal(report.suites.gap, undefined); // at least one run IS graded
});

test("a suite run whose grader produced no score is reported as ungraded, not as zero", () => {
  const h = makeHarness();
  addSuiteRun(h, {
    id: "sr-nograde",
    startedAt: "2026-08-15T00:00:00.000Z",
    aggregates: { ...GRADED_AGGREGATES, meanGrade: null, gradeStdDev: null, passRateAt05: null },
  });

  const report = createFleetReport(makeDeps(h));
  assert.equal(report.suites.entries[0]?.meanGrade, null);
  assert.match(report.suites.entries[0]?.gap ?? "", /no grader produced a score/);
  assert.match(report.suites.gap ?? "", /produced a graded score/);
});

test("the suite list is capped and always states the full count", () => {
  const h = makeHarness();
  const total = FLEET_REPORT_SUITE_RUN_LIMIT + 3;
  for (let i = 0; i < total; i += 1) {
    addSuiteRun(h, {
      id: `sr-${String(i).padStart(3, "0")}`,
      startedAt: `2026-08-${String(1 + i).padStart(2, "0")}T00:00:00.000Z`,
      aggregates: GRADED_AGGREGATES,
    });
  }

  const report = createFleetReport(makeDeps(h));
  assert.equal(report.suites.entries.length, FLEET_REPORT_SUITE_RUN_LIMIT);
  assert.equal(report.suites.totalSuiteRuns, total);

  const md = createFleetMarkdownReport(report);
  assert.ok(
    md.includes(`Showing the ${FLEET_REPORT_SUITE_RUN_LIMIT} most recent of ${total} suite runs.`),
  );
});

// ── Posture ─────────────────────────────────────────────────────────────────────────────────────

test("the posture section names the unbuilt analyzer instead of implying a clean fleet", () => {
  const h = makeHarness();
  seedFullFleet(h);
  const report = createFleetReport(makeDeps(h));

  assert.equal(report.posture.summary, null);
  assert.match(report.posture.gap ?? "", /not built yet/);
  assert.match(report.posture.gap ?? "", /unmeasured rather than clean/);
});

test("a posture provider, once one exists, renders a populated section", () => {
  const h = makeHarness();
  const summary: FleetPostureSummary = {
    analyzerVersion: 1,
    score: 82,
    findingCounts: [
      { severity: "high", count: 2 },
      { severity: "low", count: 5 },
    ],
    subjects: [{ kind: "server", id: "srv-1", name: "Alpha", score: 70, findings: 2 }],
  };
  const report = createFleetReport(makeDeps(h, { summarize: () => summary }));

  assert.equal(fleetReportSchema.safeParse(report).success, true);
  assert.deepEqual(report.posture.summary, summary);
  assert.equal(report.posture.gap, undefined);

  const md = createFleetMarkdownReport(report);
  assert.ok(md.includes("**Score:** 82.0 (analyzer version 1)"));
  assert.ok(md.includes("**Findings:** high 2, low 5"));
  assert.ok(md.includes("| Alpha | server | 70.0 | 2 |"));
});

// ── Markdown of a populated fleet ───────────────────────────────────────────────────────────────

test("the Markdown renders a populated section as a table AND the empty ones as prose", () => {
  const h = makeHarness();
  seedFullFleet(h);
  const md = createFleetMarkdownReport(createFleetReport(makeDeps(h)));

  // Populated: the servers table with real rows, including the refusal to subtract Beta's scans.
  assert.ok(md.includes("| Server | Transport | Latest successful scan | Tools +/−/~ | Token Δ |"));
  assert.ok(md.includes("+1 / −1 / ~1 vs 2026-08-01T00:00:00.000Z"));
  assert.ok(md.includes("+60 (8.6%)"));
  assert.ok(md.includes("not comparable"));
  assert.ok(md.includes("**Zeta** — Never scanned successfully"));

  // Populated: environment costs, with the subscription note and its separate figure.
  assert.ok(md.includes("| Docs env | claude-sonnet-4 | eager | 3 (2 completed) | $0.7500 |"));
  assert.ok(md.includes("Cost note — subscription reference"));
  assert.ok(md.includes("**Docs env** — 1 subscription run, $1.5000 reference."));
  assert.ok(md.includes("**Unused env** — No run has been recorded"));

  // Populated: suite grades.
  assert.ok(md.includes("| adhoc plan | completed | 2026-08-15T00:00:00.000Z | 4/4 | 0.75 |"));

  // Empty, in the SAME document: posture still renders its heading + its gap sentence.
  assert.ok(md.includes("## Security posture"));
  assert.ok(md.includes("roadmap/security-posture/"));
});

test("the Markdown renders each advisor recommendation with its labeled estimate and evidence", () => {
  const h = makeHarness();
  seedFullFleet(h);
  const report = createFleetReport(makeDeps(h));
  const md = createFleetMarkdownReport(report);

  assert.ok(report.advisor.report.recommendations.length > 0, "expected the fixture to advise");
  for (const rec of report.advisor.report.recommendations) {
    assert.ok(md.includes(`[${rec.severity.toUpperCase()}]`));
    assert.ok(md.includes(`\`${rec.ruleId}\``));
    if (rec.savings) {
      // The word "estimate" is in the sentence, never implied by the number alone.
      assert.ok(md.includes(`${rec.savings.unit} — estimate, basis:`));
    }
  }
  assert.ok(md.includes("### Data gaps"));
});

// ── Determinism ─────────────────────────────────────────────────────────────────────────────────

test("the same inputs under the same clock produce byte-identical JSON and Markdown", () => {
  const h = makeHarness();
  seedFullFleet(h);

  const first = createFleetReport(makeDeps(h));
  const second = createFleetReport(makeDeps(h));

  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(createFleetMarkdownReport(first), createFleetMarkdownReport(second));
  // `generatedAt` is part of that guarantee, not an exception to it.
  assert.equal(first.generatedAt, FIXED_NOW);
  assert.equal(second.generatedAt, FIXED_NOW);
});

// ── The routes ──────────────────────────────────────────────────────────────────────────────────

async function makeApp(h: Harness): Promise<string> {
  const testService = new TestService(new TestRepository(h.db));
  const scenarioService = new ScenarioService(h.scenarios, h.scans);
  const gradeRepository = new GradeRepository(h.db);
  const digestRepository = new DigestReportRepository(h.db);
  const digestSchedule = new DigestScheduleService(
    { db: h.db, runs: h.runs, issues: new RatingIssueRepository(h.db) },
    new AppSettingsRepository(h.db),
    digestRepository,
    () => {},
  );

  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: "Validation failed", issues: error.issues });
    }
    const typed = error as Error & { statusCode?: number };
    return reply.code(typed.statusCode ?? 500).send({ error: error.message });
  });

  const advisorDeps = {
    servers: h.servers,
    scans: h.scans,
    scenarios: h.scenarios,
    runs: h.runs,
  };
  await registerAdvisorRoutes(app, advisorDeps);
  await registerReportRoutes(
    app,
    h.scans,
    h.servers,
    h.runs,
    testService,
    scenarioService,
    h.suiteRuns,
    gradeRepository,
    h.suites,
    new RunReportService(gradeRepository, h.runs),
    new SuiteReportRepository(h.db),
    digestRepository,
    digestSchedule,
    advisorDeps,
  );
  await app.listen({ port: 0, host: "127.0.0.1" });
  apps.push(app);
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return `http://127.0.0.1:${port}`;
}

test("GET /api/reports/fleet/json renders from real persisted data, stamped ADVISOR_VERSION", async () => {
  const h = makeHarness();
  seedFullFleet(h);
  const baseUrl = await makeApp(h);

  const res = await fetch(`${baseUrl}/api/reports/fleet/json`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as FleetReport;

  assert.equal(fleetReportSchema.safeParse(body).success, true);
  assert.equal(body.advisorVersion, ADVISOR_VERSION);
  assert.equal(body.servers.entries.length, 3);
  assert.equal(body.environments.entries.length, 2);
  assert.equal(body.suites.totalSuiteRuns, 2);
  assert.equal(body.posture.summary, null);
  assert.ok((body.posture.gap ?? "").length > 0);

  // The embedded advisor report is the SAME document the advisor endpoint serves — one service, not
  // a second copy of the rules. (`generatedAt` differs: two requests, two instants.)
  const advisorRes = await fetch(`${baseUrl}/api/advisor/report?scope=fleet`);
  const advisorBody = (await advisorRes.json()) as AdvisorReport;
  assert.deepEqual(body.advisor.report.recommendations, advisorBody.recommendations);
  assert.deepEqual(body.advisor.report.insufficientData, advisorBody.insufficientData);
  assert.deepEqual(body.advisor.report.scope, { kind: "fleet" });
  assert.equal(body.advisor.report.advisorVersion, ADVISOR_VERSION);
});

test("GET /api/reports/fleet/markdown returns a Markdown attachment rendering the same document", async () => {
  const h = makeHarness();
  seedFullFleet(h);
  const baseUrl = await makeApp(h);

  const res = await fetch(`${baseUrl}/api/reports/fleet/markdown`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/markdown/);
  assert.match(res.headers.get("content-disposition") ?? "", /attachment; filename=/);

  const md = await res.text();
  assert.ok(md.startsWith("# Fleet report\n"));
  assert.ok(md.includes(`Advisor version ${ADVISOR_VERSION}`));
  assert.ok(md.includes("## Servers & drift"));
  assert.ok(md.includes("| Docs env | claude-sonnet-4 | eager |"));
  assert.ok(md.includes("## Security posture"));
});

test("both fleet routes render on a completely empty install", async () => {
  const h = makeHarness();
  const baseUrl = await makeApp(h);

  const json = await fetch(`${baseUrl}/api/reports/fleet/json`);
  assert.equal(json.status, 200);
  const body = (await json.json()) as FleetReport;
  assert.equal(fleetReportSchema.safeParse(body).success, true);
  for (const gap of [body.servers.gap, body.environments.gap, body.suites.gap, body.posture.gap]) {
    assert.ok((gap ?? "").trim().length > 0, "every empty section must name its gap");
  }

  const md = await fetch(`${baseUrl}/api/reports/fleet/markdown`);
  assert.equal(md.status, 200);
  const text = await md.text();
  assert.ok(text.includes("_No MCP server is registered"));
});
