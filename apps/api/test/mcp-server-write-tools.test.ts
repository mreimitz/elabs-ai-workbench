import assert from "node:assert/strict";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import {
  WORKBENCH_MCP_MOUNT_PATH,
  WORKBENCH_MCP_WRITE_TOOL_NAMES,
  type ApiTokenScope,
  type RunPlanEstimate,
} from "@mcp-token-footprint/shared";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { ZodError } from "zod";
import { registerApiTokenGuard } from "../src/api-tokens/guard.js";
import { ApiTokenRepository } from "../src/api-tokens/repository.js";
import { ApiTokenService } from "../src/api-tokens/service.js";
import { CollectionRepository } from "../src/collections/repository.js";
import { CollectionService } from "../src/collections/service.js";
import { applyMigrations, ensureLocalCollection, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { GradeRepository } from "../src/grading/grade-repository.js";
import { RunReportService } from "../src/grading/run-report.js";
import { registerWorkbenchMcpRoutes } from "../src/mcp-server/routes.js";
import {
  buildWorkbenchToolDefinitions,
  type WorkbenchMcpDeps,
} from "../src/mcp-server/tools.js";
import { OAuthRepository } from "../src/oauth/repository.js";
import { OAuthService } from "../src/oauth/service.js";
import { ScanRepository } from "../src/scans/repository.js";
import { ScanService } from "../src/scans/service.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { ServerRepository } from "../src/servers/repository.js";
import { SkillRepository } from "../src/skills/repository.js";
import {
  SuiteOrchestrator,
  type SuiteRunStarter,
  type SuiteRunStopper,
} from "../src/suites/orchestrator.js";
import { SuiteRepository } from "../src/suites/repository.js";
import { SuiteRunManager } from "../src/suites/suite-run-manager.js";
import { SuiteRunRepository } from "../src/suites/suite-run-repository.js";
import { SuiteService } from "../src/suites/service.js";
import { RunRepository } from "../src/testing/run-repository.js";
import type { RunHandle } from "../src/testing/run-service.js";
import { ScenarioRepository } from "../src/testing/scenario-repository.js";
import { ScenarioService } from "../src/testing/scenario-service.js";
import { TestRepository } from "../src/testing/test-repository.js";
import { TestService } from "../src/testing/test-service.js";

// ==================================================================================================
// Workbench MCP mount — the three WRITE tools (roadmap/ci/wp-m.3-write-tools.md)
// ==================================================================================================
// Driven end to end: a real Fastify app carrying the real WP 1.1 token guard and the real mount, a
// real in-process MCP client, real repositories over an in-memory SQLite, a REAL `ScanService`, and a
// REAL `SuiteOrchestrator` whose only stub is the run STARTER (that is the one thing that would need
// a provider key). Nothing about the tools themselves is faked.
//
// `scan_run`'s happy path is the app scanning **its own mount** on an ephemeral loopback port — the
// same trick `pnpm mcp:self-scan` uses, and the only way to exercise a real discovery scan with no
// network and no MCP child process. Its failure path points at a closed port.
//
// What each test is for:
//   • the ticket shape (D-MCP11) — a summary + a `next` naming the read tool, never a full ScanDetail
//     and never a wall-clock wait for a matrix;
//   • the advisory estimate (D-MCP12) — present on both launches, and a throwing estimate does not
//     take the launch down with it;
//   • the `"suite"` refusal (D-MCP10) — refused twice, by the enum and by the handler, and no suite
//     run created either way;
//   • D-MCP7 — a `read`-only token is refused on all three while a tokenless loopback caller is not.

const databases: AppDatabase[] = [];
const apps: FastifyInstance[] = [];
const clients: Client[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) await client.close().catch(() => undefined);
  for (const app of apps.splice(0)) await app.close();
  for (const db of databases.splice(0)) db.close();
});

type Harness = {
  baseUrl: string;
  mcpUrl: URL;
  db: AppDatabase;
  deps: WorkbenchMcpDeps;
  orchestrator: SuiteOrchestrator;
  /** A registered server whose URL IS this app's own MCP mount — scanning it really works. */
  selfServerId: string;
  /** A registered server pointing at a closed port — scanning it really fails. */
  deadServerId: string;
  suiteId: string;
  testId: string;
  environmentId: string;
  localCollectionId: string;
  /** Every child run the stubbed starter was asked to create. */
  startedRuns: string[];
  mint: (scopes: ApiTokenScope[]) => string;
};

/**
 * The run STARTER, stubbed. It writes a real, already-terminal `runs` row and hands back a resolved
 * handle, so a launched matrix settles on its own within a tick or two and no test has to drive a
 * scheduling loop. This is the ONLY stub in the harness: it stands in for the provider call, which is
 * the one thing that cannot run offline.
 */
function makeStarter(db: AppDatabase, started: string[]): SuiteRunStarter {
  return (testId, scenarioId, mode): RunHandle => {
    const runId = nanoid();
    db.prepare(
      `INSERT INTO runs (id, test_id, scenario_id, mode, status, outcome, started_at, cost_usd, duration_ms)
       VALUES (@id, @testId, @scenarioId, @mode, 'completed', 'completed', @now, 0, 0)`,
    ).run({ id: runId, testId, scenarioId, mode, now: new Date().toISOString() });
    started.push(runId);
    return {
      runId,
      mode,
      done: Promise.resolve({
        status: "completed" as const,
        outcome: "completed" as const,
        turns: 0,
        toolCalls: 0,
        tokensIn: 0,
        tokensOut: 0,
      }),
    };
  };
}

async function makeHarness(): Promise<Harness> {
  const db = new Database(":memory:") as unknown as AppDatabase;
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  ensureLocalCollection(db);
  databases.push(db);

  const secrets = new SecretStore(crypto.randomBytes(32));
  const servers = new ServerRepository(db, secrets);
  const scans = new ScanRepository(db);
  const skills = new SkillRepository(db, secrets);
  const runs = new RunRepository(db);
  const grades = new GradeRepository(db);
  const suiteRepository = new SuiteRepository(db);
  const suiteRuns = new SuiteRunRepository(db);
  const collectionRepository = new CollectionRepository(db, secrets);
  const scenarioRepository = new ScenarioRepository(db);
  const scenarios = new ScenarioService(scenarioRepository, scans, skills);
  const tests = new TestService(
    new TestRepository(db),
    path.join(os.tmpdir(), `mcp-write-attachments-${Math.random().toString(36).slice(2)}`),
  );
  const runReportService = new RunReportService(grades, runs);

  // The REAL scan service — the same construction `index.ts` performs.
  const scanService = new ScanService(
    servers,
    scans,
    new OAuthService(servers, new OAuthRepository(db, secrets)),
  );

  const startedRuns: string[] = [];
  const stopRun: SuiteRunStopper = () => undefined;
  const orchestrator = new SuiteOrchestrator(
    makeStarter(db, startedRuns),
    stopRun,
    runs,
    suiteRuns,
    suiteRepository,
    grades,
    new SuiteRunManager(),
  );

  // ── Seed ────────────────────────────────────────────────────────────────────────────────────
  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, api_key_encrypted, created_at, updated_at)
     VALUES ('prov-1', 'anthropic', 'Claude', 'enc:v1:abc', @now, @now)`,
  ).run({ now: "2026-08-20T00:00:00.000Z" });

  const environment = scenarioRepository.create({
    name: "Baseline environment",
    providerId: "prov-1",
    model: "claude-sonnet-4",
    params: {},
    systemPrompt: "You are a test harness.",
    allowedServers: [],
    allowedSkills: [],
    defaultProfiles: ["generic_o200k"],
    guardrails: { maxTurns: 4 },
    toolLoadingMode: "eager",
  });
  const testRow = tests.create({
    name: "List files",
    userPrompt: "List the files, then answer.",
    addedProfiles: [],
    tags: [],
  });
  const suite = suiteRepository.create({
    name: "Nightly suite",
    testIds: [testRow.id],
    scenarioIds: [environment.id],
    config: { repetitions: 1, maxConcurrency: 1 },
  });
  const localCollectionId = (
    db.prepare("SELECT id FROM collections WHERE is_default = 1").get() as { id: string }
  ).id;

  // ── App ─────────────────────────────────────────────────────────────────────────────────────
  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: "Validation failed", issues: error.issues });
    }
    const typed = error as Error & { statusCode?: number; code?: string };
    return reply.code(typed.statusCode ?? 500).send({ error: error.message });
  });
  const apiTokens = new ApiTokenService(new ApiTokenRepository(db));
  registerApiTokenGuard(app, apiTokens, { authRequired: false });

  const deps: WorkbenchMcpDeps = {
    servers,
    scans,
    runs,
    grades,
    skills,
    suites: suiteRepository,
    suiteRuns,
    collections: collectionRepository,
    runReports: { runs, tests, scenarios, runReports: runReportService },
    scanService,
    suiteOrchestrator: orchestrator,
    runPlans: {
      suites: new SuiteService(suiteRepository),
      collections: new CollectionService(collectionRepository),
      tests,
    },
    estimate: { scenarios, tests, scans },
  };
  registerWorkbenchMcpRoutes(app, deps);

  await app.listen({ port: 0, host: "127.0.0.1" });
  apps.push(app);
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  // The app registers ITSELF as a scannable streamable-HTTP MCP server. Scanning it exercises the
  // real discovery path (initialize + tools/list + resources/prompts) with no network and no child
  // process — exactly what `pnpm mcp:self-scan` does, inside a test.
  const selfServer = servers.create({
    name: "This workbench's own mount",
    transport: "streamable_http",
    url: `${baseUrl}${WORKBENCH_MCP_MOUNT_PATH}`,
  });
  // Port 1 on loopback is closed on every platform this runs on — a scan of it fails honestly.
  const deadServer = servers.create({
    name: "Nothing listening here",
    transport: "streamable_http",
    url: "http://127.0.0.1:1/mcp",
  });

  return {
    baseUrl,
    mcpUrl: new URL(`${baseUrl}${WORKBENCH_MCP_MOUNT_PATH}`),
    db,
    deps,
    orchestrator,
    selfServerId: selfServer.id,
    deadServerId: deadServer.id,
    suiteId: suite.id,
    testId: testRow.id,
    environmentId: environment.id,
    localCollectionId,
    startedRuns,
    mint: (scopes) => apiTokens.create({ label: "test", scopes, expiresAt: null }).secret,
  };
}

async function connect(h: Harness, secret?: string): Promise<Client> {
  const client = new Client({ name: "workbench-mcp-write-test", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(h.mcpUrl, {
      requestInit: secret ? { headers: { authorization: `Bearer ${secret}` } } : undefined,
    }),
  );
  clients.push(client);
  return client;
}

type ToolResult = { isError?: boolean; content: Array<{ type: string; text?: string }> };

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  return (await client.callTool({ name, arguments: args })) as ToolResult;
}

/** The JSON body of a tool result, whether it came back clean or as an `isError`. */
function payload(result: ToolResult): Record<string, unknown> {
  const text = result.content[0]?.text ?? "{}";
  return JSON.parse(text) as Record<string, unknown>;
}

/** Call one tool's handler directly — the only way to reach a path the SDK's schema refuses first. */
async function callHandler(
  deps: WorkbenchMcpDeps,
  name: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const definition = buildWorkbenchToolDefinitions(deps).find((tool) => tool.name === name);
  assert.ok(definition, `no such tool: ${name}`);
  return definition.handler(args);
}

const suiteRunCount = (h: Harness): number =>
  (h.db.prepare("SELECT COUNT(*) AS n FROM suite_runs").get() as { n: number }).n;

const scanCount = (h: Harness): number =>
  (h.db.prepare("SELECT COUNT(*) AS n FROM mcp_scans").get() as { n: number }).n;

/** Let a started matrix settle, so nothing is still scheduling when the app closes. */
async function settle(h: Harness, suiteRunId: string): Promise<void> {
  await h.orchestrator.whenSettled(suiteRunId);
}

// ── scan_run (A6, D-MCP11) ────────────────────────────────────────────────────────────────────────

test("scan_run really scans, and answers with a TICKET rather than the whole scan", async () => {
  const h = await makeHarness();
  const client = await connect(h);

  const result = await call(client, "scan_run", { serverId: h.selfServerId });
  assert.equal(result.isError ?? false, false, JSON.stringify(result));
  const body = payload(result);

  assert.equal(body.status, "success");
  assert.equal(body.serverId, h.selfServerId);
  assert.equal(typeof body.scanId, "string");
  // It really ran: the row exists, and it found this app's own tool surface.
  assert.equal(scanCount(h), 1);
  assert.ok((body.totalTools as number) > 20, `only ${body.totalTools} tools found`);
  assert.ok((body.totalTokens as number) > 0);
  assert.equal(typeof body.countingVersion, "number");

  // D-MCP11 — a ticket, not the outcome: the per-tool definitions (the expensive half of a
  // `ScanDetail`) are NOT in the result, and the result names the read tool that has them.
  assert.equal(body.tools, undefined, "scan_run returned the full ScanDetail");
  assert.equal(body.events, undefined, "scan_run returned the scan event log");
  assert.match(String(body.next), /scans_get/);

  // …and the id it handed back is a real one `scans_get` can resolve.
  const detail = payload(await call(client, "scans_get", { scanId: body.scanId }));
  assert.equal(detail.id, body.scanId);
});

test("scan_run reports a FAILED scan as an isError result, not as a clean zero-tool scan", async () => {
  const h = await makeHarness();
  const client = await connect(h);

  const result = await call(client, "scan_run", { serverId: h.deadServerId });
  assert.equal(result.isError, true, "a failed scan must not read as a clean bill of health");
  const body = payload(result);
  assert.equal(body.status, "failed");
  assert.equal(body.totalTools, 0);
  assert.ok(String(body.errorMessage ?? "").length > 0, "a failed scan must say why");
  assert.ok(!String(body.errorMessage).includes("    at "), "the failure leaked a stack trace");
  // The scan row still exists — the request succeeded, the scan did not.
  assert.equal(scanCount(h), 1);
});

test("scan_run honours the tokenProfile argument, and rejects one that is not a profile", async () => {
  const h = await makeHarness();
  const client = await connect(h);

  const body = payload(
    await call(client, "scan_run", { serverId: h.selfServerId, tokenProfile: "generic_cl100k" }),
  );
  assert.equal(body.tokenProfile, "generic_cl100k");

  const bad = await call(client, "scan_run", { serverId: h.selfServerId, tokenProfile: "gpt-9" });
  assert.equal(bad.isError, true);
  assert.equal(scanCount(h), 1, "a rejected call must not have started a scan");
});

test("scan_run on an unknown server is a readable isError, never a stack trace", async () => {
  const h = await makeHarness();
  const client = await connect(h);

  const result = await call(client, "scan_run", { serverId: "no-such-server" });
  assert.equal(result.isError, true);
  assert.ok(!(result.content[0]?.text ?? "").includes("    at "));
  assert.equal(scanCount(h), 0, "an unknown server must not create a scan row");
});

// ── suite_run_start (A6, A7) ──────────────────────────────────────────────────────────────────────

test("suite_run_start returns a suite-run ticket immediately, with the advisory estimate", async () => {
  const h = await makeHarness();
  const client = await connect(h);

  const result = await call(client, "suite_run_start", { suiteId: h.suiteId });
  assert.equal(result.isError ?? false, false, JSON.stringify(result));
  const body = payload(result);

  assert.equal(typeof body.suiteRunId, "string");
  assert.equal(body.suiteId, h.suiteId);
  assert.equal(body.status, "running", "the launch tools do not wait for the matrix");
  assert.equal(body.source, "suite");
  assert.match(String(body.next), /suite_runs_get/);

  // D-MCP12 — the estimate is the launcher's own, built from the SAVED suite's membership.
  const estimate = body.estimate as RunPlanEstimate;
  assert.ok(estimate, "no advisory estimate on the launch");
  assert.equal(estimate.testCount, 1);
  assert.equal(estimate.environmentCount, 1);
  assert.equal(estimate.repetitions, 1);
  assert.equal(estimate.totalRuns, 1);
  assert.equal(body.estimateNote, undefined, "a working estimate must carry no excuse");

  // …and the ticket resolves through the read tool it names.
  const suiteRun = payload(await call(client, "suite_runs_get", { suiteRunId: body.suiteRunId }));
  assert.equal(suiteRun.id, body.suiteRunId);
  await settle(h, String(body.suiteRunId));
});

test("suite_run_start on an unknown suite 404s once, and starts nothing", async () => {
  const h = await makeHarness();
  const client = await connect(h);

  const result = await call(client, "suite_run_start", { suiteId: "no-such-suite" });
  assert.equal(result.isError, true);
  assert.ok(!(result.content[0]?.text ?? "").includes("    at "));
  assert.equal(suiteRunCount(h), 0, "an unknown suite must not create a suite-run row");
});

// ── run_plan_start (A5, A6, A7) ───────────────────────────────────────────────────────────────────

test("run_plan_start launches an ad-hoc plan and returns a ticket with an estimate", async () => {
  const h = await makeHarness();
  const client = await connect(h);

  const body = payload(
    await call(client, "run_plan_start", {
      source: "adhoc",
      testIds: [h.testId],
      scenarioIds: [h.environmentId],
    }),
  );
  assert.equal(typeof body.suiteRunId, "string");
  assert.equal(body.status, "running");
  assert.equal(body.source, "adhoc");
  assert.equal(body.suiteId, undefined, "an ad-hoc plan creates no Suite row, so it has no suiteId");
  assert.equal(body.testCount, 1);
  assert.equal(body.environmentCount, 1);
  assert.match(String(body.next), /suite_runs_get/);
  assert.equal((body.estimate as RunPlanEstimate).totalRuns, 1);
  await settle(h, String(body.suiteRunId));
});

test("run_plan_start launches a collection plan over the collection's CURRENT tests", async () => {
  const h = await makeHarness();
  const client = await connect(h);

  const body = payload(
    await call(client, "run_plan_start", {
      source: "collection",
      collectionId: h.localCollectionId,
      scenarioIds: [h.environmentId],
      repetitions: 2,
    }),
  );
  assert.equal(body.source, "collection");
  assert.equal(body.testCount, 1, "the seeded test lives in the default Local collection");
  assert.equal((body.estimate as RunPlanEstimate).repetitions, 2);
  assert.equal((body.estimate as RunPlanEstimate).totalRuns, 2);
  await settle(h, String(body.suiteRunId));
  assert.equal(h.startedRuns.length, 2, "repetitions=2 really produced two child runs");
});

test("A5 (D-MCP10) — run_plan_start refuses source:'suite' twice: at the schema AND at the handler", async () => {
  const h = await makeHarness();
  const client = await connect(h);

  // 1. Over the protocol the SDK refuses it before the handler, because the enum has no such member.
  const overWire = await call(client, "run_plan_start", {
    source: "suite",
    suiteId: h.suiteId,
  });
  assert.equal(overWire.isError, true);
  assert.match(overWire.content[0]?.text ?? "", /validation error/i);
  assert.equal(suiteRunCount(h), 0, "the schema refusal must not have started anything");

  // 2. And the handler refuses it AGAIN, in words — so an agent that somehow gets past the enum is
  //    told which tool to use rather than handed a schema dump. This is the belt behind that brace,
  //    and it is why `runs:launch` can never be a back door onto a saved suite.
  const direct = await callHandler(h.deps, "run_plan_start", {
    source: "suite",
    suiteId: h.suiteId,
  });
  assert.equal(direct.isError, true);
  const text = (direct.content[0] as { text?: string } | undefined)?.text ?? "";
  assert.match(text, /suite_run_start/, "the refusal must name the tool to use instead");
  assert.match(text, /suites:run/, "…and the scope that tool needs");
  assert.equal(suiteRunCount(h), 0, "the handler refusal must not have started anything");
});

test("run_plan_start validates through the SAME parser POST /api/run-plans uses", async () => {
  const h = await makeHarness();
  const client = await connect(h);

  // `collection` with no collectionId, and `adhoc` with no testIds: both are shapes the flat MCP
  // input schema cannot reject (it cannot express a discriminated union), so they must fail in
  // `runPlanInputSchema` and surface as readable isError results.
  for (const args of [
    { source: "collection", scenarioIds: [h.environmentId] },
    { source: "adhoc", scenarioIds: [h.environmentId] },
    { source: "adhoc", testIds: [h.testId] },
  ]) {
    const result = await call(client, "run_plan_start", args);
    assert.equal(result.isError, true, `${JSON.stringify(args)} should not have been accepted`);
    assert.ok(!(result.content[0]?.text ?? "").includes("    at "));
  }
  assert.equal(suiteRunCount(h), 0, "no invalid plan may leave a suite_runs row behind");
});

test("run_plan_start on an empty collection is refused BEFORE a suite run exists", async () => {
  const h = await makeHarness();
  const client = await connect(h);
  const empty = h.deps.runPlans.collections.create({ name: "Empty" });

  const result = await call(client, "run_plan_start", {
    source: "collection",
    collectionId: empty.id,
    scenarioIds: [h.environmentId],
  });
  assert.equal(result.isError, true);
  assert.match(result.content[0]?.text ?? "", /no tests/i);
  assert.equal(suiteRunCount(h), 0, "resolve happens before start, so nothing is left behind");
});

// ── A7 (D-MCP12) — the estimate is advisory, and never the reason a launch fails ──────────────────

test("A7 — a throwing estimate does NOT fail the launch; it degrades to a note", async () => {
  const h = await makeHarness();
  // Break only the estimate's view of the world. Everything else — the resolver, the orchestrator —
  // is untouched, so this isolates exactly the "advisory" claim.
  const broken: WorkbenchMcpDeps = {
    ...h.deps,
    estimate: {
      ...h.deps.estimate,
      tests: {
        list: () => {
          throw new Error("pricing table exploded");
        },
      } as unknown as WorkbenchMcpDeps["estimate"]["tests"],
    },
  };

  const result = await callHandler(broken, "suite_run_start", { suiteId: h.suiteId });
  assert.equal(result.isError ?? false, false, "a broken cost preview must not block a launch");
  const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
  assert.equal(body.estimate, null);
  assert.match(String(body.estimateNote), /pricing table exploded/);
  assert.match(String(body.estimateNote), /unaffected/i, "the note must say the launch still ran");
  assert.equal(body.status, "running", "the suite run really started");
  assert.equal(suiteRunCount(h), 1);
  await settle(h, String(body.suiteRunId));
});

test("A7 — the estimate is buildRunPlanEstimate's own output, not a look-alike", async () => {
  const h = await makeHarness();
  const client = await connect(h);
  const body = payload(await call(client, "suite_run_start", { suiteId: h.suiteId }));
  const estimate = body.estimate as RunPlanEstimate;

  // The fields that only the real estimator produces — including the "unpriced, not zero" contract a
  // hand-rolled preview would get wrong by reporting 0 dollars for an unknown model.
  for (const key of [
    "testCount",
    "environmentCount",
    "repetitions",
    "totalRuns",
    "tokens",
    "costUsd",
    "unpricedEnvironmentCount",
    "uncappedEnvironmentCount",
    "environments",
  ]) {
    assert.ok(key in estimate, `the estimate is missing ${key}`);
  }
  assert.equal(estimate.environments.length, 1);
  assert.equal(estimate.environments[0]?.environmentId, h.environmentId);
  await settle(h, String(body.suiteRunId));
});

// ── A3/A4 (D-MCP7/D-MCP8) — scopes on the real write surface, end to end ──────────────────────────

const CALLS: ReadonlyArray<{ tool: string; scope: ApiTokenScope; args: Record<string, unknown> }> =
  [
    { tool: "scan_run", scope: "scan:run", args: {} },
    { tool: "suite_run_start", scope: "suites:run", args: {} },
    { tool: "run_plan_start", scope: "runs:launch", args: { source: "adhoc" } },
  ];

test("A3 — a `read`-only token is refused on every write tool, and changes nothing", async () => {
  const h = await makeHarness();
  const client = await connect(h, h.mint(["read"]));

  for (const { tool, scope, args } of CALLS) {
    const result = await call(client, tool, {
      ...args,
      serverId: h.selfServerId,
      suiteId: h.suiteId,
      testIds: [h.testId],
      scenarioIds: [h.environmentId],
    });
    assert.equal(result.isError, true, `${tool} was not refused`);
    assert.match(result.content[0]?.text ?? "", new RegExp(scope), `${tool}: no scope named`);
  }
  // The load-bearing half of A3: a refusal is not a no-op that happened to fail late.
  assert.equal(scanCount(h), 0, "a refused scan_run created a scan row");
  assert.equal(suiteRunCount(h), 0, "a refused launch created a suite-run row");
  assert.deepEqual(h.startedRuns, [], "a refused launch started a child run");
});

test("A3 — a token holding `read` + the right scope succeeds on each write tool", async () => {
  const h = await makeHarness();
  const client = await connect(h, h.mint(["read", "scan:run", "suites:run", "runs:launch"]));

  assert.equal(
    (await call(client, "scan_run", { serverId: h.selfServerId })).isError ?? false,
    false,
  );
  const suiteRun = payload(await call(client, "suite_run_start", { suiteId: h.suiteId }));
  assert.equal(suiteRun.status, "running");
  const plan = payload(
    await call(client, "run_plan_start", {
      source: "adhoc",
      testIds: [h.testId],
      scenarioIds: [h.environmentId],
    }),
  );
  assert.equal(plan.status, "running");

  assert.equal(scanCount(h), 1);
  assert.equal(suiteRunCount(h), 2);
  await settle(h, String(suiteRun.suiteRunId));
  await settle(h, String(plan.suiteRunId));
});

test("A4 (D-MCP7) — a TOKENLESS loopback caller reaches all three write tools", async () => {
  const h = await makeHarness();
  const client = await connect(h);

  assert.equal(
    (await call(client, "scan_run", { serverId: h.selfServerId })).isError ?? false,
    false,
  );
  const suiteRun = payload(await call(client, "suite_run_start", { suiteId: h.suiteId }));
  const plan = payload(
    await call(client, "run_plan_start", {
      source: "adhoc",
      testIds: [h.testId],
      scenarioIds: [h.environmentId],
    }),
  );
  assert.equal(suiteRun.status, "running");
  assert.equal(plan.status, "running");
  await settle(h, String(suiteRun.suiteRunId));
  await settle(h, String(plan.suiteRunId));
});

test("A8 — no write tool exposes a delete, and the write set is exactly the declared three", async () => {
  const h = await makeHarness();
  const client = await connect(h);
  const { tools } = await client.listTools();

  const registered = new Set(tools.map((tool) => tool.name));
  for (const name of WORKBENCH_MCP_WRITE_TOOL_NAMES) {
    assert.ok(registered.has(name), `${name} is declared but not registered`);
  }
  for (const name of registered) {
    assert.ok(
      !/delete|remove|revoke|prune|drop/i.test(name),
      `${name} names a destructive operation (D-MCP3)`,
    );
  }
  // Every write tool's description must warn about what it costs and name the scope it needs — an
  // agent chooses from `tools/list` alone, so a description that omits either is a real defect.
  for (const name of WORKBENCH_MCP_WRITE_TOOL_NAMES) {
    const description = tools.find((tool) => tool.name === name)?.description ?? "";
    assert.match(description, /scope/i, `${name} never mentions the scope it needs`);
    assert.match(
      description,
      /SPENDS|REAL connection/,
      `${name} never says what it costs to call it`,
    );
  }
});
