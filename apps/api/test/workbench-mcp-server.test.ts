import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import {
  DEFAULT_TOKEN_PROFILE,
  FEATURE_DISABLED_ERROR_CODE,
  WORKBENCH_MCP_DEFINITION_TOKEN_BUDGET,
  WORKBENCH_MCP_LLMS_TXT_PATH,
  WORKBENCH_MCP_MAX_LIST_LIMIT,
  WORKBENCH_MCP_MOUNT_PATH,
  WORKBENCH_MCP_READ_TOOL_NAMES,
  WORKBENCH_MCP_RESOURCE_TEMPLATES,
  WORKBENCH_MCP_SERVER_NAME,
  WORKBENCH_MCP_TOOL_FAMILIES,
  WORKBENCH_MCP_TOOL_NAMES,
  WORKBENCH_MCP_WRITE_TOOL_NAMES,
  workbenchRunReportUri,
  workbenchScanReportUri,
} from "@mcp-token-footprint/shared";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { CollectionRepository } from "../src/collections/repository.js";
import { applyMigrations, ensureLocalCollection, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { registerFeatureRoutes } from "../src/features/routes.js";
import { FeatureFlagsService } from "../src/features/service.js";
import { AppSettingsRepository } from "../src/grading/app-settings-repository.js";
import { GradeRepository } from "../src/grading/grade-repository.js";
import { RunReportService } from "../src/grading/run-report.js";
import { registerWorkbenchMcpRoutes } from "../src/mcp-server/routes.js";
import { ScanRepository, type ToolScanInsert } from "../src/scans/repository.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { ServerRepository } from "../src/servers/repository.js";
import { SkillRepository } from "../src/skills/repository.js";
import { SuiteRepository } from "../src/suites/repository.js";
import { SuiteRunRepository } from "../src/suites/suite-run-repository.js";
import { getTokenCounter } from "../src/token-counting/profiles.js";
import { RunRepository } from "../src/testing/run-repository.js";
import { ScenarioRepository } from "../src/testing/scenario-repository.js";
import { ScenarioService } from "../src/testing/scenario-service.js";
import { TestRepository } from "../src/testing/test-repository.js";
import { TestService } from "../src/testing/test-service.js";

// ==================================================================================================
// Workbench MCP server (planning/Roadmap/RM-08-ci/mcp-server.md, WP M.1) — driven by a REAL in-process MCP client
// ==================================================================================================
// The whole point of this WP is that an external agent can operate the bench over the protocol, so
// these tests speak the protocol: a `Client` + `StreamableHTTPClientTransport` pointed at a listening
// Fastify app, over an in-memory SQLite seeded through the SAME repositories the app uses. Fully
// offline — no MCP child process, no provider key, no network.

const databases: AppDatabase[] = [];
const apps: FastifyInstance[] = [];
const clients: Client[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) await client.close().catch(() => undefined);
  for (const app of apps.splice(0)) await app.close();
  for (const db of databases.splice(0)) db.close();
});

const SECRET_ENV_VALUE = "sk-super-secret-server-token-should-never-leak";
const SECRET_HEADER_VALUE = "Bearer never-leak-this-header";
const SECRET_PAT_VALUE = "ghp-never-leak-this-collection-pat";

type Harness = {
  baseUrl: string;
  mcpUrl: URL;
  /** The fixture database, so a test can seed a column the harness's event stream cannot produce. */
  db: AppDatabase;
  features: FeatureFlagsService;
  serverId: string;
  scanId: string;
  emptyServerId: string;
  runId: string;
  testId: string;
  environmentId: string;
  skillId: string;
  versionId: string;
  suiteRunId: string;
  suiteId: string;
};

function toolInsert(name: string, totalTokens: number): ToolScanInsert {
  return {
    toolName: name,
    description: `desc for ${name}`,
    inputSchema: { type: "object", properties: {} },
    annotations: undefined,
    rawTool: { name },
    totalTokens,
    nameTokens: 3,
    descriptionTokens: 8,
    schemaTokens: Math.max(totalTokens - 11, 1),
    annotationsTokens: 0,
    rawBytes: 100,
    contributionPercent: 0,
  };
}

function scanSummary(
  totalTools: number,
  totalTokens: number,
  largest: string,
  largestTokens: number,
) {
  return {
    totalTools,
    totalTokens,
    totalRawBytes: 500,
    averageTokensPerTool: totalTools > 0 ? totalTokens / totalTools : 0,
    largestToolName: largest,
    largestToolTokens: largestTokens,
    totalResources: 0,
    totalResourceTemplates: 0,
    totalPrompts: 0,
    totalResourceTokens: 0,
    totalPromptTokens: 0,
    largestResourceName: null,
    largestResourceTokens: 0,
    largestPromptName: null,
    largestPromptTokens: 0,
  };
}

/**
 * The write tools' dependencies, wired inert for this file (WP M.3). See the comment at the
 * `registerWorkbenchMcpRoutes` call below for why they throw rather than being real.
 */
function inertWriteDeps() {
  const refuse = (): never => {
    throw new Error("this harness never invokes a write tool");
  };
  return {
    scanService: { runScan: refuse },
    suiteOrchestrator: { startSuiteRun: refuse, startPlanRun: refuse },
    runPlans: {
      suites: { get: refuse },
      collections: { get: refuse },
      tests: { listIdsByCollection: refuse, list: refuse },
    },
    tests: { list: refuse },
    estimate: { scenarios: { list: refuse }, tests: { list: refuse }, scans: { getLatestForServer: refuse } },
  } as unknown as Pick<
    Parameters<typeof registerWorkbenchMcpRoutes>[1],
    "scanService" | "suiteOrchestrator" | "runPlans" | "estimate"
  >;
}

async function makeHarness(): Promise<Harness> {
  const db = new Database(":memory:") as unknown as AppDatabase;
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  ensureLocalCollection(db);
  databases.push(db);

  const secrets = new SecretStore(Buffer.alloc(32, 7));
  const servers = new ServerRepository(db, secrets);
  const scans = new ScanRepository(db);
  const skills = new SkillRepository(db, secrets);
  const runs = new RunRepository(db);
  const grades = new GradeRepository(db);
  const suites = new SuiteRepository(db);
  const suiteRuns = new SuiteRunRepository(db);
  const collections = new CollectionRepository(db, secrets);
  const scenarioRepository = new ScenarioRepository(db);
  const scenarios = new ScenarioService(scenarioRepository, scans, skills);
  const testRepository = new TestRepository(db);
  const tests = new TestService(
    testRepository,
    path.join(os.tmpdir(), `mcp-workbench-attachments-${Math.random().toString(36).slice(2)}`),
  );
  const runReportService = new RunReportService(grades, runs);
  const settings = new AppSettingsRepository(db);
  const features = new FeatureFlagsService(settings);

  // ── Seed ───────────────────────────────────────────────────────────────────────────────────
  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, api_key_encrypted, created_at, updated_at)
     VALUES ('prov-1', 'anthropic', 'Claude', 'enc:v1:abc', @now, @now)`,
  ).run({ now: "2026-08-19T00:00:00.000Z" });

  const server = servers.create({
    name: "Filesystem MCP",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem"],
    env: { API_TOKEN: SECRET_ENV_VALUE },
  });
  const httpServer = servers.create({
    name: "Never scanned",
    transport: "streamable_http",
    url: "https://example.invalid/mcp",
    headers: { Authorization: SECRET_HEADER_VALUE },
  });

  const scan = scans.createRunningScan(server.id, "generic_o200k");
  scans.completeScan(scan.id, scanSummary(2, 200, "alpha", 120), [
    toolInsert("alpha", 120),
    toolInsert("beta", 80),
  ]);

  const environment = scenarioRepository.create({
    name: "Baseline environment",
    providerId: "prov-1",
    model: "claude-sonnet-4",
    params: {},
    systemPrompt: "You are a test harness.",
    allowedServers: [{ serverId: server.id, allowedTools: null }],
    allowedSkills: [],
    defaultProfiles: ["generic_o200k"],
    guardrails: { maxTurns: 10 },
    toolLoadingMode: "eager",
  });
  const testRow = testRepository.create({
    name: "List files",
    userPrompt: "List the files, then answer.",
    addedProfiles: [],
    tags: [],
  });

  const skill = skills.create({ name: "pdf-tools", sourceType: "upload", description: "PDFs" });
  const version = skills.createVersion(
    skill.id,
    [
      {
        path: "SKILL.md",
        bytes: Buffer.from(
          "---\nname: pdf-tools\n---\nFetches https://example.com/spec for reference.",
          "utf8",
        ),
      },
      { path: "scripts/run.py", bytes: Buffer.from("print('hi')\n", "utf8") },
      { path: "scripts/tidy.sh", bytes: Buffer.from("echo hi\n", "utf8") },
    ],
    {
      sourceKind: "upload",
      importedFrom: "upload",
      manifest: { name: "pdf-tools", description: "PDFs" },
      // The real ingest path precomputes the L1/L2/L3 footprint and hands it in; the bare repository
      // call stores zeros, which would make the `skills_security` footprint assertion vacuous.
      footprint: {
        l1: 12,
        l2: 34,
        l3: 8,
        total: 54,
        byPath: new Map([
          ["SKILL.md", 34],
          ["scripts/run.py", 5],
          ["scripts/tidy.sh", 3],
        ]),
      },
    },
  );
  if (version.unchanged) throw new Error("fixture expected a fresh skill version");

  const runId = "run-main";
  runs.createRun(runId, { testId: testRow.id, scenarioId: environment.id, mode: "automated" });
  runs.onEvent(runId, {
    type: "step",
    step: {
      id: "step-0",
      runId,
      index: 0,
      type: "user_message",
      label: "user",
      status: "ok",
      profileTokens: { generic_o200k: 10 },
      payload: { text: "List the files, then answer." },
    },
  });
  runs.onEvent(runId, {
    type: "kpi",
    turns: 1,
    toolCalls: 1,
    tokensIn: 100,
    tokensOut: 20,
    contextTokens: 500,
    costUsd: 0.01,
  });
  runs.onEvent(runId, { type: "status", status: "completed", outcome: "completed" });
  grades.insert({
    runId,
    graderId: "tool_hygiene",
    kind: "deterministic",
    status: "graded",
    score: 0.9,
    method: "tool_hygiene_v1",
  });

  collections.create({
    name: "Bound to GitHub",
    repoUrl: "https://github.com/example/bench",
    repoPath: "bench",
    branch: "main",
    pat: SECRET_PAT_VALUE,
  });

  const suite = suites.create({
    name: "Nightly suite",
    testIds: [testRow.id],
    scenarioIds: [environment.id],
    config: { repetitions: 1, maxConcurrency: 1 },
  });
  const suiteRun = suiteRuns.create(suite.id, { repetitions: 1, maxConcurrency: 1 }, "suite");
  runs.linkRunToSuite(runId, suiteRun.id, 1);
  suiteRuns.updateStatus(suiteRun.id, "completed");

  // ── App ────────────────────────────────────────────────────────────────────────────────────
  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: "Validation failed", issues: error.issues });
    }
    const typed = error as Error & { statusCode?: number; code?: string };
    const statusCode = typeof typed.statusCode === "number" ? typed.statusCode : 500;
    const code =
      typeof typed.statusCode === "number" && typeof typed.code === "string"
        ? typed.code
        : undefined;
    return reply.code(statusCode).send({ error: error.message, ...(code ? { code } : {}) });
  });
  // Same order as `apps/api/src/index.ts`: the feature guard is installed on the ROOT instance FIRST,
  // so it covers the MCP mount registered after it.
  registerFeatureRoutes(app, features);
  registerWorkbenchMcpRoutes(app, {
    servers,
    scans,
    runs,
    grades,
    skills,
    suites,
    suiteRuns,
    collections,
    runReports: { runs, tests, scenarios, runReports: runReportService },
    // WP M.3 — this file measures and reads the SURFACE; the write tools' behaviour is
    // `mcp-server-write-tools.test.ts`'s subject. Wiring them to stubs that throw keeps that split
    // honest: nothing in this file can start a scan or a run even by accident, and a test that
    // accidentally reached a write handler would fail loudly rather than launch something.
    ...inertWriteDeps(),
  });

  await app.listen({ port: 0, host: "127.0.0.1" });
  apps.push(app);
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl,
    mcpUrl: new URL(`${baseUrl}${WORKBENCH_MCP_MOUNT_PATH}`),
    db,
    features,
    serverId: server.id,
    emptyServerId: httpServer.id,
    scanId: scan.id,
    runId,
    testId: testRow.id,
    environmentId: environment.id,
    skillId: skill.id,
    versionId: version.version.id,
    suiteRunId: suiteRun.id,
    suiteId: suite.id,
  };
}

async function connect(h: Harness): Promise<Client> {
  const client = new Client({ name: "workbench-mcp-test", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(h.mcpUrl));
  clients.push(client);
  return client;
}

/** The text payload of a `CallToolResult`, parsed as JSON. */
async function callJson(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content: Array<{ type: string; text?: string }>;
  };
  assert.equal(result.isError ?? false, false, `${name} unexpectedly returned isError`);
  const first = result.content[0];
  assert.ok(first?.text, `${name} returned no text content`);
  return JSON.parse(first.text) as Record<string, unknown>;
}

/** Assert a tool call came back as a clean `isError` result carrying a readable message. */
async function callExpectingError(client: Client, name: string, args: Record<string, unknown>) {
  const result = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content: Array<{ type: string; text?: string }>;
  };
  assert.equal(result.isError, true, `${name} should have reported an error`);
  const text = result.content[0]?.text ?? "";
  assert.ok(text.length > 0, `${name} error result carried no message`);
  assert.ok(!text.includes("    at "), `${name} leaked a stack trace: ${text}`);
  return text;
}

/**
 * Assert a tool call failed SCHEMA VALIDATION rather than lookup. The MCP SDK validates arguments
 * against the registered `inputSchema` before the handler runs and reports the failure as an
 * `isError` result (it catches its own `McpError` rather than rejecting the JSON-RPC call), so the
 * distinguishing signal is the message, not the transport.
 */
async function callExpectingValidationError(
  client: Client,
  name: string,
  args: Record<string, unknown>,
) {
  const text = await callExpectingError(client, name, args);
  assert.match(text, /validation error/i);
  return text;
}

// ── initialize / discovery ─────────────────────────────────────────────────────────────────────

test("initialize succeeds and advertises tools + resources", async () => {
  const h = await makeHarness();
  const client = await connect(h);

  const info = client.getServerVersion();
  assert.equal(info?.name, WORKBENCH_MCP_SERVER_NAME);
  const capabilities = client.getServerCapabilities();
  assert.ok(capabilities?.tools, "tools capability missing");
  assert.ok(capabilities?.resources, "resources capability missing");
  assert.ok((client.getInstructions() ?? "").length > 0, "no instructions advertised");
});

test("tools/list returns EXACTLY the declared tool set — reads AND writes", async () => {
  const h = await makeHarness();
  const client = await connect(h);
  const { tools } = await client.listTools();

  const actual = tools.map((tool) => tool.name).sort();
  const declared = [...WORKBENCH_MCP_TOOL_NAMES].sort();
  assert.deepEqual(actual, declared);
  // The two halves, asserted separately so a regression says WHICH half moved: WP M.1's 21 reads are
  // untouched by WP M.3, and WP M.3's three writes are all present.
  for (const name of WORKBENCH_MCP_READ_TOOL_NAMES) {
    assert.ok(actual.includes(name), `the read tool ${name} disappeared from the mount`);
  }
  for (const name of WORKBENCH_MCP_WRITE_TOOL_NAMES) {
    assert.ok(actual.includes(name), `the write tool ${name} is declared but not registered`);
  }
  assert.equal(tools.length, WORKBENCH_MCP_READ_TOOL_NAMES.length + 3);
  // Every tool carries a description and an object input schema — a host must be able to plan.
  for (const tool of tools) {
    assert.ok((tool.description ?? "").length > 0, `${tool.name} has no description`);
    assert.equal(tool.inputSchema.type, "object", `${tool.name} has a non-object input schema`);
  }
});

test("the tools/list definition footprint stays under its declared token budget (D-MCP5)", async () => {
  const h = await makeHarness();
  const client = await connect(h);
  const { tools } = await client.listTools();

  const counter = getTokenCounter(DEFAULT_TOKEN_PROFILE);
  const measured = await counter.countJson(tools);
  // Printed so the real number is recoverable from a test run, not just the pass/fail.
  console.log(
    `workbench MCP tools/list footprint: ${measured} tokens (${tools.length} tools, ` +
      `${DEFAULT_TOKEN_PROFILE}); budget ${WORKBENCH_MCP_DEFINITION_TOKEN_BUDGET}`,
  );
  assert.ok(
    measured < WORKBENCH_MCP_DEFINITION_TOKEN_BUDGET,
    `tool definitions cost ${measured} tokens, over the ${WORKBENCH_MCP_DEFINITION_TOKEN_BUDGET} budget`,
  );
});

// ── Servers & scans ────────────────────────────────────────────────────────────────────────────

test("servers & scans tools project the persisted scan surface", async () => {
  const h = await makeHarness();
  const client = await connect(h);

  const serverList = (await callJson(client, "servers_list")) as {
    servers: Array<{ id: string }>;
    total: number;
    truncated: boolean;
  };
  assert.equal(serverList.servers.length, 2);
  assert.equal(serverList.total, 2);
  assert.equal(serverList.truncated, false);

  const scans = (await callJson(client, "scans_list", { serverId: h.serverId })) as {
    scans: Array<{ id: string }>;
    total: number;
    truncated: boolean;
  };
  assert.deepEqual(
    scans.scans.map((s) => s.id),
    [h.scanId],
  );
  assert.equal(scans.total, 1);
  assert.equal(scans.truncated, false);

  const summary = await callJson(client, "scans_get", { scanId: h.scanId });
  assert.equal(summary.totalTools, 2);

  const latest = (await callJson(client, "scans_latest", { serverId: h.serverId })) as {
    scan: { id: string; tools: Array<{ toolName: string }> };
  };
  assert.equal(latest.scan.id, h.scanId);
  assert.deepEqual(latest.scan.tools.map((t) => t.toolName).sort(), ["alpha", "beta"]);

  // A server that never scanned answers honestly instead of erroring.
  const none = await callJson(client, "scans_latest", { serverId: h.emptyServerId });
  assert.equal(none.scan, null);

  const page = (await callJson(client, "scans_tools", { scanId: h.scanId, limit: 1 })) as {
    tools: unknown[];
    total: number;
    offset: number;
    truncated: boolean;
  };
  assert.equal(page.tools.length, 1);
  assert.equal(page.total, 2);
  assert.equal(page.truncated, true);

  const heatmap = await callJson(client, "compatibility_heatmap", { scanId: h.scanId });
  assert.ok(Array.isArray(heatmap.rows));

  const findings = await callJson(client, "compatibility_findings", { scanId: h.scanId });
  assert.ok(Array.isArray(findings.byTool));
});

test("a server config returned over MCP carries NO secret value, only the redacted booleans", async () => {
  const h = await makeHarness();
  const client = await connect(h);

  const result = (await client.callTool({ name: "servers_list", arguments: {} })) as {
    content: Array<{ text?: string }>;
  };
  const raw = result.content[0]?.text ?? "";
  assert.ok(raw.length > 0);
  assert.ok(!raw.includes(SECRET_ENV_VALUE), "an env secret VALUE leaked over the MCP mount");
  assert.ok(!raw.includes(SECRET_HEADER_VALUE), "a header secret VALUE leaked over the MCP mount");

  const servers = JSON.parse(raw).servers as Array<Record<string, unknown>>;
  const stdio = servers.find((s) => s.id === h.serverId);
  assert.equal(stdio?.hasEnvSecrets, true);
  assert.equal(stdio?.env, undefined);
  const http = servers.find((s) => s.id === h.emptyServerId);
  assert.equal(http?.hasHeaderSecrets, true);
  assert.equal(http?.headers, undefined);

  // Same contract for a collection's GitHub token: only `hasPat`, never the value.
  const collectionsRaw =
    (
      (await client.callTool({ name: "collections_list", arguments: {} })) as {
        content: Array<{ text?: string }>;
      }
    ).content[0]?.text ?? "";
  assert.ok(
    !collectionsRaw.includes(SECRET_PAT_VALUE),
    "a collection PAT leaked over the MCP mount",
  );
  const bound = (JSON.parse(collectionsRaw).collections as Array<Record<string, unknown>>).find(
    (collection) => collection.name === "Bound to GitHub",
  );
  assert.equal(bound?.hasPat, true);
  assert.equal(bound?.pat, undefined);
});

test("scan tools reject an unknown id with a clean error result, not a stack trace", async () => {
  const h = await makeHarness();
  const client = await connect(h);
  await callExpectingError(client, "scans_get", { scanId: "nope" });
  await callExpectingError(client, "scans_tools", { scanId: "nope" });
});

test("malformed scan arguments fail schema validation before the handler runs", async () => {
  const h = await makeHarness();
  const client = await connect(h);
  // `scanId` is `z.string().min(1)` — an empty string is not a bad id, it is a bad ARGUMENT.
  await callExpectingValidationError(client, "scans_get", { scanId: "" });
  // `limit` is capped, so a host cannot ask for an unbounded dump.
  await callExpectingValidationError(client, "scans_list", { limit: 10_000 });
});

// ── Runs, grades & reports ─────────────────────────────────────────────────────────────────────

test("run tools project the run, its grades and its report", async () => {
  const h = await makeHarness();
  const client = await connect(h);

  const list = (await callJson(client, "runs_list", { status: "completed" })) as {
    runs: Array<{ id: string }>;
    total: number;
  };
  assert.deepEqual(
    list.runs.map((r) => r.id),
    [h.runId],
  );

  const detail = (await callJson(client, "runs_get", { runId: h.runId })) as {
    id: string;
    steps: unknown[];
    stepsTotal: number;
    stepsTruncated: boolean;
  };
  assert.equal(detail.id, h.runId);
  assert.equal(detail.stepsTotal, 1);
  assert.equal(detail.stepsTruncated, false);
  // RM-33 (D-CT6) — this fixture's run reported no cache slice, so the summary must carry NO cache
  // keys at all. An agent cannot tell a fabricated `0` from "this run cached nothing", and the whole
  // point of the split is to stop making that claim on a run's behalf.
  assert.equal("cacheReadTokens" in detail, false, "absent ⇒ UNKNOWN, never a fabricated zero");
  assert.equal("cacheWriteTokens" in detail, false);

  const graded = (await callJson(client, "runs_grades", { runId: h.runId })) as {
    grades: Array<{ graderId: string }>;
    allGradesTotal: number;
  };
  assert.deepEqual(
    graded.grades.map((g) => g.graderId),
    ["tool_hygiene"],
  );
  assert.equal(graded.allGradesTotal, 1);

  // Markdown is the default format; JSON is the structured twin of the same document.
  const markdown = (await client.callTool({
    name: "run_report",
    arguments: { runId: h.runId },
  })) as { content: Array<{ text?: string }> };
  assert.match(markdown.content[0]?.text ?? "", /# MCP Token Footprint Run Report/);

  const json = await callJson(client, "run_report", { runId: h.runId, format: "json" });
  assert.ok(json && typeof json === "object");

  // Date-range filtering excludes a run outside the window.
  const empty = (await callJson(client, "runs_list", { since: "2999-01-01T00:00:00.000Z" })) as {
    runs: unknown[];
  };
  assert.equal(empty.runs.length, 0);
});

test("run tools reject an unknown run id cleanly, and a malformed one at validation", async () => {
  const h = await makeHarness();
  const client = await connect(h);
  await callExpectingError(client, "runs_get", { runId: "no-such-run" });
  await callExpectingError(client, "run_report", { runId: "no-such-run" });
  await callExpectingValidationError(client, "run_report", { runId: h.runId, format: "yaml" });
});

// ── Skills ─────────────────────────────────────────────────────────────────────────────────────

test("skill tools project the registry, the tree, file text and the security surface", async () => {
  const h = await makeHarness();
  const client = await connect(h);

  const list = (await callJson(client, "skills_list")) as { skills: Array<{ id: string }> };
  assert.deepEqual(
    list.skills.map((s) => s.id),
    [h.skillId],
  );

  const skill = await callJson(client, "skills_get", { skillId: h.skillId });
  assert.equal(skill.id, h.skillId);

  const versions = (await callJson(client, "skills_versions", { skillId: h.skillId })) as {
    versions: Array<{ id: string }>;
  };
  assert.deepEqual(
    versions.versions.map((v) => v.id),
    [h.versionId],
  );

  const files = (await callJson(client, "skills_files", { versionId: h.versionId })) as {
    files: Array<{ path: string }>;
  };
  assert.deepEqual(files.files.map((f) => f.path).sort(), [
    "SKILL.md",
    "scripts/run.py",
    "scripts/tidy.sh",
  ]);

  const content = (await callJson(client, "skills_file_content", {
    versionId: h.versionId,
    path: "SKILL.md",
  })) as { text: string; truncated: boolean };
  assert.match(content.text, /pdf-tools/);
  assert.equal(content.truncated, false);

  // The security surface comes from the SAME shared derivation the Skills inspector renders (D-MCP4).
  const surface = (await callJson(client, "skills_security", { versionId: h.versionId })) as {
    security: {
      scriptCount: number;
      scriptLangs: string[];
      networkRefs: boolean;
      fileCount: number;
    };
    footprint: { totalTokens: number };
  };
  assert.equal(surface.security.scriptCount, 2);
  assert.deepEqual(surface.security.scriptLangs, ["python", "shell"]);
  assert.equal(surface.security.networkRefs, true);
  assert.equal(surface.security.fileCount, 3);
  assert.ok(surface.footprint.totalTokens > 0);
});

test("skill tools reject an unknown id cleanly, and a missing path at validation", async () => {
  const h = await makeHarness();
  const client = await connect(h);
  await callExpectingError(client, "skills_get", { skillId: "ghost" });
  await callExpectingError(client, "skills_security", { versionId: "ghost" });
  await callExpectingValidationError(client, "skills_file_content", { versionId: h.versionId });
});

// ── Suites & collections ───────────────────────────────────────────────────────────────────────

test("suite and collection tools project their registries and member grades", async () => {
  const h = await makeHarness();
  const client = await connect(h);

  const suites = (await callJson(client, "suites_list")) as {
    suites: Array<{ id: string }>;
    total: number;
    truncated: boolean;
  };
  assert.deepEqual(
    suites.suites.map((s) => s.id),
    [h.suiteId],
  );
  assert.equal(suites.total, 1);
  assert.equal(suites.truncated, false);

  const runs = (await callJson(client, "suite_runs_list", { status: "completed" })) as {
    suiteRuns: Array<{ id: string }>;
  };
  assert.deepEqual(
    runs.suiteRuns.map((r) => r.id),
    [h.suiteRunId],
  );

  const detail = (await callJson(client, "suite_runs_get", { suiteRunId: h.suiteRunId })) as {
    memberRunIds: string[];
    memberGrades: Array<{ runId: string; grades: Array<{ graderId: string }> }>;
  };
  assert.deepEqual(detail.memberRunIds, [h.runId]);
  assert.deepEqual(
    detail.memberGrades[0]?.grades.map((g) => g.graderId),
    ["tool_hygiene"],
  );

  // The reserved default "Local" collection is always present.
  const collections = (await callJson(client, "collections_list")) as {
    collections: Array<{ name: string }>;
    total: number;
    truncated: boolean;
  };
  assert.ok(collections.collections.some((c) => c.name === "Local"));
  assert.equal(collections.total, collections.collections.length);
  assert.equal(collections.truncated, false);
});

test("suite tools reject an unknown id cleanly, and a bad status at validation", async () => {
  const h = await makeHarness();
  const client = await connect(h);
  await callExpectingError(client, "suite_runs_get", { suiteRunId: "ghost" });
  await callExpectingValidationError(client, "suite_runs_list", { status: "elsewhere" });
});

test("every list-shaped tool is bounded and self-describing, with no low-cardinality exemption", async () => {
  const h = await makeHarness();
  const client = await connect(h);

  // The three registry listings used to return a bare `{ x: [...] }` envelope with no cap, because
  // servers/suites/collections are few on a dev box. That is exactly the fleet case the bound exists
  // for: a host handed `{ servers: [8 rows] }` cannot tell 8 from the first 8 of 400. `limit: 1` on a
  // fixture with 2 servers proves the cut is real, not just an extra key.
  const bounded: Array<[string, string, number]> = [
    ["servers_list", "servers", 2],
    ["scans_list", "scans", 1],
    ["runs_list", "runs", 1],
    ["skills_list", "skills", 1],
    ["suites_list", "suites", 1],
    ["suite_runs_list", "suiteRuns", 1],
    ["collections_list", "collections", 2],
  ];

  for (const [name, key, seeded] of bounded) {
    const full = (await callJson(client, name)) as Record<string, unknown>;
    assert.deepEqual(
      Object.keys(full).sort(),
      [key, "total", "truncated"].sort(),
      `${name} envelope`,
    );
    assert.equal(full.total, seeded, `${name} total`);
    assert.equal(full.truncated, false, `${name} truncated at default limit`);

    const cut = (await callJson(client, name, { limit: 1 })) as Record<string, unknown>;
    assert.equal((cut[key] as unknown[]).length, 1, `${name} honoured limit: 1`);
    assert.equal(cut.total, seeded, `${name} reports the FULL total when cut`);
    assert.equal(cut.truncated, seeded > 1, `${name} truncated marker at limit: 1`);
  }

  // And the cap is enforced on all of them, so no caller can ask for an unbounded dump.
  for (const [name] of bounded) {
    await callExpectingValidationError(client, name, { limit: 10_000 });
  }
});

// ── Resources ──────────────────────────────────────────────────────────────────────────────────

test("resources/list enumerates the seeded run and scan reports, and read returns the document", async () => {
  const h = await makeHarness();
  const client = await connect(h);

  const { resources } = await client.listResources();
  const uris = resources.map((resource) => resource.uri);
  assert.ok(uris.includes(workbenchRunReportUri(h.runId, "markdown")), uris.join(", "));
  assert.ok(uris.includes(workbenchRunReportUri(h.runId, "json")));
  assert.ok(uris.includes(workbenchScanReportUri(h.scanId, "markdown")));
  assert.ok(uris.includes(workbenchScanReportUri(h.scanId, "json")));

  const runDoc = await client.readResource({ uri: workbenchRunReportUri(h.runId, "markdown") });
  assert.match(String(runDoc.contents[0]?.text ?? ""), /# MCP Token Footprint Run Report/);
  assert.equal(runDoc.contents[0]?.mimeType, "text/markdown");

  const scanDoc = await client.readResource({ uri: workbenchScanReportUri(h.scanId, "json") });
  const parsed = JSON.parse(String(scanDoc.contents[0]?.text ?? "{}"));
  assert.equal(parsed.scan?.id ?? parsed.id, h.scanId);

  await assert.rejects(() =>
    client.readResource({ uri: workbenchScanReportUri("no-such-scan", "markdown") }),
  );
});

// ── Transport shape ────────────────────────────────────────────────────────────────────────────

test("the stateless mount answers 405 on GET and DELETE", async () => {
  const h = await makeHarness();
  for (const method of ["GET", "DELETE"]) {
    const response = await fetch(h.mcpUrl, {
      method,
      headers: { accept: "application/json, text/event-stream" },
    });
    assert.equal(response.status, 405, method);
    assert.equal(response.headers.get("allow"), "POST", method);
  }
});

// ── Feature flag (D-MCP6) ──────────────────────────────────────────────────────────────────────

test("turning the mcp_server feature off 403s the mount, and turning it back on restores it", async () => {
  const h = await makeHarness();

  const before = await connect(h);
  assert.ok((await before.listTools()).tools.length > 0);
  await before.close();

  h.features.setFlags({ mcp_server: false });

  const blocked = await fetch(h.mcpUrl, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
  assert.equal(blocked.status, 403);
  const body = (await blocked.json()) as { error: string; code?: string };
  assert.equal(body.code, FEATURE_DISABLED_ERROR_CODE);
  assert.match(body.error, /Settings › Features/);

  // Even the 405 verbs are refused while the feature is off — the guard runs before any handler.
  assert.equal((await fetch(h.mcpUrl, { method: "GET" })).status, 403);

  // A real MCP client cannot connect at all while it is off.
  const deadClient = new Client({ name: "workbench-mcp-test", version: "1.0.0" });
  await assert.rejects(() => deadClient.connect(new StreamableHTTPClientTransport(h.mcpUrl)));

  h.features.setFlags({ mcp_server: true });
  const after = await connect(h);
  assert.equal((await after.listTools()).tools.length, WORKBENCH_MCP_TOOL_NAMES.length);

  // Turning the MCP server off never touches another feature's endpoints.
  assert.equal(h.features.getFlags().assistant, true);
});

// ── Agent onboarding doc (WP M.4) ──────────────────────────────────────────────────────────────

/** `GET /api/mcp/llms.txt` — the served document, asserted to be a 200 text/plain body. */
async function fetchLlmsTxt(h: Harness): Promise<string> {
  const response = await fetch(`${h.baseUrl}${WORKBENCH_MCP_LLMS_TXT_PATH}`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/plain/);
  return response.text();
}

test("the mount serves an llms.txt usage doc that names EVERY registered tool and template", async () => {
  const h = await makeHarness();
  const document = await fetchLlmsTxt(h);

  // The whole point of generating the doc: it cannot fall behind the surface it documents.
  for (const name of WORKBENCH_MCP_TOOL_NAMES) {
    assert.ok(document.includes(name), `llms.txt never mentions the tool ${name}`);
  }
  for (const template of Object.values(WORKBENCH_MCP_RESOURCE_TEMPLATES)) {
    assert.ok(
      document.includes(template),
      `llms.txt never mentions the resource template ${template}`,
    );
  }
  for (const family of WORKBENCH_MCP_TOOL_FAMILIES) {
    assert.ok(
      document.includes(family.label),
      `llms.txt never mentions the family ${family.label}`,
    );
  }

  // The operating facts an agent needs before its first call.
  assert.ok(document.includes(WORKBENCH_MCP_MOUNT_PATH), "llms.txt never states the mount path");
  assert.ok(document.includes(String(WORKBENCH_MCP_MAX_LIST_LIMIT)), "no list ceiling stated");
  assert.ok(
    document.includes(String(WORKBENCH_MCP_DEFINITION_TOKEN_BUDGET)),
    "no definition-footprint budget stated",
  );
  // The doc used to claim the mount was read-only. It is not any more (WP M.3), so the assertion is
  // the honest pair instead of the old blanket claim: the write tools are named, and the one absolute
  // that IS still true — nothing deletes — is still stated.
  assert.match(document, /Actions/);
  assert.match(document, /deletes/i);
  assert.ok(
    !/read-only, by construction/i.test(document),
    "llms.txt still claims the mount is read-only",
  );
  assert.match(document, /Settings › Features/);

  // A generated document must never become a data leak: it describes the surface, it does not read it.
  for (const secret of [SECRET_ENV_VALUE, SECRET_HEADER_VALUE, SECRET_PAT_VALUE]) {
    assert.ok(!document.includes(secret), "llms.txt leaked a stored secret");
  }
});

test("every tool line in llms.txt carries the SAME description tools/list returns", async () => {
  const h = await makeHarness();
  const client = await connect(h);
  const { tools } = await client.listTools();
  const document = await fetchLlmsTxt(h);

  for (const tool of tools) {
    assert.ok(
      document.includes(`- ${tool.name} — ${tool.description ?? ""}`),
      `llms.txt describes ${tool.name} differently from tools/list`,
    );
  }
});

test("the usage doc is a GET while the mount itself still answers 405, and both 403 while off", async () => {
  const h = await makeHarness();
  const docUrl = `${h.baseUrl}${WORKBENCH_MCP_LLMS_TXT_PATH}`;

  // Adding a GET under the mount must not soften the stateless mount's own GET.
  assert.equal((await fetch(h.mcpUrl, { method: "GET" })).status, 405);
  assert.equal((await fetch(docUrl)).status, 200);

  h.features.setFlags({ mcp_server: false });

  // The doc lives UNDER `/api/mcp`, so the feature's existing API prefix covers it with no second
  // declaration — the documentation disappears with the endpoint it documents.
  const blocked = await fetch(docUrl);
  assert.equal(blocked.status, 403);
  const body = (await blocked.json()) as { error: string; code?: string };
  assert.equal(body.code, FEATURE_DISABLED_ERROR_CODE);
  assert.equal((await fetch(h.mcpUrl, { method: "GET" })).status, 403);

  h.features.setFlags({ mcp_server: true });
  assert.equal((await fetch(docUrl)).status, 200);
});

test("runs_get carries the prompt-cache split so an agent can reconcile tokens with cost", async () => {
  const h = await makeHarness();
  // The migration-59 columns, as a real cached run leaves them: 1,000 gross input of which 800 was
  // served from cache (~0.1x — a discount) and 100 was written to cache (1.25x — a premium).
  h.db
    .prepare(
      `UPDATE runs SET tokens_in = 1000, cached_tokens = 900, cache_read_tokens = 800,
                       cache_write_tokens = 100 WHERE id = @id`,
    )
    .run({ id: h.runId });

  const client = await connect(h);
  const detail = (await callJson(client, "runs_get", { runId: h.runId })) as {
    tokensIn: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
  assert.equal(detail.tokensIn, 1000, "D-CT1 — tokensIn stays GROSS, cached slice included");
  assert.equal(detail.cacheReadTokens, 800);
  assert.equal(detail.cacheWriteTokens, 100);
});
