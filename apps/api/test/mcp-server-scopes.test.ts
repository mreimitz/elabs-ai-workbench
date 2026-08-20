import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import {
  API_TOKEN_AUTH_REQUIRED_ERROR_CODE,
  API_TOKEN_PREFIX,
  API_TOKEN_ROUTE_SCOPES,
  WORKBENCH_MCP_LLMS_TXT_PATH,
  WORKBENCH_MCP_MOUNT_PATH,
  WORKBENCH_MCP_READ_TOOL_NAMES,
  WORKBENCH_MCP_TOOL_NAMES,
  WORKBENCH_MCP_TOOL_SCOPES,
  WORKBENCH_MCP_WRITE_TOOL_NAMES,
  type ApiTokenScope,
  type WorkbenchMcpToolName,
} from "@mcp-token-footprint/shared";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { registerApiTokenGuard } from "../src/api-tokens/guard.js";
import { ApiTokenRepository } from "../src/api-tokens/repository.js";
import { ApiTokenService } from "../src/api-tokens/service.js";
import { CollectionRepository } from "../src/collections/repository.js";
import { applyMigrations, ensureLocalCollection, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { GradeRepository } from "../src/grading/grade-repository.js";
import { RunReportService } from "../src/grading/run-report.js";
import { registerWorkbenchMcpRoutes } from "../src/mcp-server/routes.js";
import {
  buildWorkbenchToolDefinitions,
  type WorkbenchMcpToolDefinition,
} from "../src/mcp-server/tools.js";
import { ScanRepository } from "../src/scans/repository.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { ServerRepository } from "../src/servers/repository.js";
import { SkillRepository } from "../src/skills/repository.js";
import { SuiteRepository } from "../src/suites/repository.js";
import { SuiteRunRepository } from "../src/suites/suite-run-repository.js";
import { RunRepository } from "../src/testing/run-repository.js";
import { ScenarioRepository } from "../src/testing/scenario-repository.js";
import { ScenarioService } from "../src/testing/scenario-service.js";
import { TestRepository } from "../src/testing/test-repository.js";
import { TestService } from "../src/testing/test-service.js";

// ==================================================================================================
// Workbench MCP mount — SERVICE-TOKEN SCOPES (planning/Roadmap/RM-08-ci/wp-m.2-mount-scopes.md)
// ==================================================================================================
// Driven by a REAL in-process MCP client against a real Fastify app carrying the real WP 1.1 guard,
// because the thing under test is a join across three layers: the guard decides who the caller is,
// the route table decides whether they may open the mount at all, and the mount decides which tools
// they may call. Testing any one of those alone would prove nothing about the other two.
//
// The three postures this pins, which are easy to confuse:
//
//   • **No token at all (D-MCP7).** The local browser / a `curl` on the host. Every tool is reachable,
//     including a write-scoped one — the mount does not get a stricter rule than the API it is
//     mounted on. `grantedScopes` is `null`, which means "no credential was involved", NOT "a token
//     with no scopes".
//   • **A `read` token (D-MCP8).** Can open the mount and call every read tool; refused on a tool
//     that wants an execute scope, with an `isError` result that NAMES the scope.
//   • **`API_AUTH_REQUIRED=true`.** The one switch that closes the local door, for the whole API at
//     once — there is deliberately no mount-only knob.
//
// WP M.3's write tools do not exist yet, so the write-scope path is exercised with a **fabricated**
// tool definition injected through the documented test seam. Fully offline: no MCP child process, no
// provider key, no network.

/** Emitted by every stubbed write dependency, so "did the handler run?" is a string search. */
const HANDLER_MARKER = "WRITE_HANDLER_REACHED";

const databases: AppDatabase[] = [];
const apps: FastifyInstance[] = [];
const clients: Client[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) await client.close().catch(() => undefined);
  for (const app of apps.splice(0)) await app.close();
  for (const db of databases.splice(0)) db.close();
});

/**
 * Stand-ins for a tool this server does not have. WP M.3's REAL write tools now exercise the scope
 * gate on the real surface (see the `A3`/`A4` cases at the bottom of this file), so these exist for
 * the one path no real tool can reach: a tool that shipped with NO scope declaration at all. The names
 * are cast because `WorkbenchMcpToolDefinition.name` is deliberately narrowed to the REGISTERED tool
 * union — production code cannot invent a tool name, and a test that needs one says so out loud
 * rather than widening the production type.
 */
const WRITE_TOOL = "test_write_tool" as string as WorkbenchMcpToolName;
/** Absent from the scope map on purpose: the fail-closed path (a tool that shipped undeclared). */
const UNMAPPED_TOOL = "test_unmapped_tool" as string as WorkbenchMcpToolName;

const FABRICATED_TOOLS: WorkbenchMcpToolDefinition[] = [
  {
    name: WRITE_TOOL,
    description: "Test-only stand-in for a WP M.3 write tool; declared as needing `scan:run`.",
    inputSchema: {},
    handler: async () => ({ content: [{ type: "text", text: '{"did":"the write"}' }] }),
  },
  {
    name: UNMAPPED_TOOL,
    description: "Test-only tool deliberately absent from WORKBENCH_MCP_TOOL_SCOPES.",
    inputSchema: {},
    handler: async () => ({ content: [{ type: "text", text: '{"did":"the undeclared thing"}' }] }),
  },
];

const FABRICATED_SCOPES: Record<string, ApiTokenScope> = {
  ...WORKBENCH_MCP_TOOL_SCOPES,
  [WRITE_TOOL]: "scan:run",
  // UNMAPPED_TOOL is intentionally NOT here.
};

type Harness = {
  baseUrl: string;
  mcpUrl: URL;
  serverId: string;
  /** Which write handlers actually got as far as their dependency. Empty ⇒ the gate refused first. */
  reached: string[];
  /** Every pino line the app emitted, newest last. Used to assert on the audit trail. */
  logLines: string[];
  /** Mint a token and return its plaintext (the only place it exists). */
  mint: (scopes: ApiTokenScope[]) => { id: string; secret: string; tokenPrefix: string };
};

async function makeHarness(
  options: { authRequired?: boolean; fabricated?: boolean } = {},
): Promise<Harness> {
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
  const scenarios = new ScenarioService(new ScenarioRepository(db), scans, skills);
  const tests = new TestService(
    new TestRepository(db),
    path.join(os.tmpdir(), `mcp-scopes-attachments-${Math.random().toString(36).slice(2)}`),
  );
  const runReportService = new RunReportService(grades, runs);

  const server = servers.create({
    name: "Filesystem MCP",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem"],
  });

  // A REAL pino logger writing into a buffer, so the audit assertions are about what would ACTUALLY
  // be logged rather than about a stub. Every level is captured and request logging is left on, which
  // is what makes "the plaintext appears in NO log line" a meaningful claim.
  const logLines: string[] = [];
  const app = Fastify({
    logger: {
      level: "trace",
      stream: {
        write: (line: string) => {
          logLines.push(line);
        },
      },
    },
  });
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

  const apiTokens = new ApiTokenService(new ApiTokenRepository(db));
  // Same order as `apps/api/src/index.ts`: the guard is a ROOT hook installed before the feature
  // routes, so it covers the mount registered after it.
  registerApiTokenGuard(app, apiTokens, { authRequired: options.authRequired ?? false });
  // WP M.3 — the write tools' dependencies. This file is about the GATE, not about the work: every
  // write dependency throws a recognisable marker, so a refused call proves the handler never ran (the
  // marker is absent) and an ALLOWED call proves the gate let it through (the marker comes back inside
  // a normal isError result). Nothing here can actually start a scan or a run.
  const reached: string[] = [];
  const refuse = (what: string) => (): never => {
    reached.push(what);
    throw new Error(`${HANDLER_MARKER}:${what}`);
  };
  const deps = {
    servers,
    scans,
    runs,
    grades,
    skills,
    suites,
    suiteRuns,
    collections,
    runReports: { runs, tests, scenarios, runReports: runReportService },
    scanService: { runScan: refuse("scan_run") },
    suiteOrchestrator: {
      startSuiteRun: refuse("suite_run_start"),
      startPlanRun: refuse("run_plan_start"),
    },
    runPlans: {
      suites: { get: refuse("suite_run_start") },
      collections: { get: refuse("run_plan_start") },
      tests: { listIdsByCollection: refuse("run_plan_start"), list: refuse("run_plan_start") },
    },
    estimate: {
      scenarios: { list: refuse("estimate") },
      tests: { list: refuse("estimate") },
      scans: { getLatestForServer: refuse("estimate") },
    },
  } as unknown as Parameters<typeof registerWorkbenchMcpRoutes>[1];
  registerWorkbenchMcpRoutes(
    app,
    deps,
    // The fabricated tools are ADDED to the real surface rather than replacing it, so the same
    // harness exercises "a read tool a read token may call" and "a write tool it may not" side by
    // side — which is the comparison that makes the refusal meaningful.
    options.fabricated
      ? {
          tools: [...buildWorkbenchToolDefinitions(deps), ...FABRICATED_TOOLS],
          toolScopes: FABRICATED_SCOPES,
        }
      : undefined,
  );

  await app.listen({ port: 0, host: "127.0.0.1" });
  apps.push(app);
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl,
    mcpUrl: new URL(`${baseUrl}${WORKBENCH_MCP_MOUNT_PATH}`),
    serverId: server.id,
    reached,
    logLines,
    mint: (scopes) => {
      const created = apiTokens.create({ label: "test", scopes, expiresAt: null });
      return {
        id: created.token.id,
        secret: created.secret,
        tokenPrefix: created.token.tokenPrefix,
      };
    },
  };
}

/** Connect a real MCP client, optionally presenting a bearer token on every request. */
async function connect(h: Harness, secret?: string): Promise<Client> {
  const client = new Client({ name: "workbench-mcp-scope-test", version: "1.0.0" });
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

/** The audit entries this app emitted, in order. */
function auditEntries(h: Harness): Array<Record<string, unknown>> {
  return h.logLines
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is Record<string, unknown> => entry !== null)
    .filter((entry) => entry.msg === "workbench MCP tool call");
}

// ── A7 — the scope map's key set equals what the server ACTUALLY registers ─────────────────────────

test("A7/A2 — WORKBENCH_MCP_TOOL_SCOPES covers exactly the registered tools, reads and writes", async () => {
  const h = await makeHarness();
  const client = await connect(h);
  const { tools } = await client.listTools();

  // Both directions in one assertion: a registered tool with no scope, and a scope for a tool that is
  // not registered, are each a failure. (The shared-package twin pins the same equality against the
  // DECLARED name list, so declaration and registration are both covered.) Comparing against the FULL
  // name list rather than the read half is what makes a future undeclared write tool fail the gate.
  assert.deepEqual(
    tools.map((tool) => tool.name).sort(),
    Object.keys(WORKBENCH_MCP_TOOL_SCOPES).sort(),
  );
  assert.deepEqual(
    Object.keys(WORKBENCH_MCP_TOOL_SCOPES).sort(),
    [...WORKBENCH_MCP_TOOL_NAMES].sort(),
  );
  for (const name of WORKBENCH_MCP_READ_TOOL_NAMES) {
    assert.equal(WORKBENCH_MCP_TOOL_SCOPES[name], "read", `${name} is a read tool`);
  }
  // WP M.3 (D-MCP10) — one tool per execute scope, and the scope decides the tool.
  assert.deepEqual(
    Object.fromEntries(
      WORKBENCH_MCP_WRITE_TOOL_NAMES.map((name) => [name, WORKBENCH_MCP_TOOL_SCOPES[name]]),
    ),
    { scan_run: "scan:run", suite_run_start: "suites:run", run_plan_start: "runs:launch" },
  );
});

// ── A2 (D-MCP8) — a `read`-only token can open the mount and use it ───────────────────────────────

test("A2 — a read-only token completes initialize + tools/list + a real tool call", async () => {
  const h = await makeHarness();
  const token = h.mint(["read"]);
  const client = await connect(h, token.secret);

  assert.ok((client.getInstructions() ?? "").length > 0, "initialize completed");
  const { tools } = await client.listTools();
  assert.equal(tools.length, WORKBENCH_MCP_TOOL_NAMES.length);

  const result = await call(client, "servers_list");
  assert.equal(result.isError ?? false, false);
  const payload = JSON.parse(result.content[0]?.text ?? "{}") as {
    servers: Array<{ id: string }>;
    total: number;
  };
  assert.equal(payload.total, 1, "the tool really ran against the seeded DB");
  assert.equal(payload.servers[0]?.id, h.serverId);
});

test("A2 — a token WITHOUT `read` cannot open the mount at all (the door rule, not a tool rule)", async () => {
  const h = await makeHarness();
  // An execute-only token: plenty of authority to run things, none to read. D-MCP8 says it cannot
  // speak MCP here, because `initialize`/`tools/list` are reads.
  const token = h.mint(["scan:run"]);
  await assert.rejects(
    () => connect(h, token.secret),
    /403|forbidden|scope/i,
    "a scan:run-only token must be refused at the door",
  );
});

// ── A8 — per-tool enforcement, with a fabricated write-scoped tool ────────────────────────────────

test("A8 — a token lacking a tool's scope gets an isError result NAMING the scope", async () => {
  const h = await makeHarness({ fabricated: true });
  const token = h.mint(["read"]);
  const client = await connect(h, token.secret);

  const result = await call(client, WRITE_TOOL);
  assert.equal(result.isError, true, "a scope refusal is an isError RESULT, not a transport error");
  const text = result.content[0]?.text ?? "";
  assert.match(text, /scan:run/, "the refusal names the missing scope so the agent can ask for it");
  assert.match(text, /Settings/, "…and says where the operator grants it");
  assert.ok(!text.includes("    at "), `the refusal leaked a stack trace: ${text}`);
  // The handler must not have run: a refusal that still did the work would be worse than useless.
  assert.ok(!text.includes("the write"), "the refused tool's handler ran anyway");
});

test("A8 — a token HOLDING the scope succeeds", async () => {
  const h = await makeHarness({ fabricated: true });
  const token = h.mint(["read", "scan:run"]);
  const client = await connect(h, token.secret);

  const result = await call(client, WRITE_TOOL);
  assert.equal(result.isError ?? false, false);
  assert.match(result.content[0]?.text ?? "", /the write/);
});

test("A8 — a tool ABSENT from the scope map is refused, however scoped (fail closed)", async () => {
  const h = await makeHarness({ fabricated: true });
  // Every scope the vocabulary can express — the most privileged token there is.
  const token = h.mint(["read", "scan:run", "runs:launch", "suites:run"]);
  const client = await connect(h, token.secret);

  const result = await call(client, UNMAPPED_TOOL);
  assert.equal(result.isError, true, "an undeclared tool must not be reachable by a token");
  const text = result.content[0]?.text ?? "";
  assert.match(text, /undeclared/);
  // …and it must NOT invent a permission. "This tool needs the `X` scope" would send an operator off
  // to grant something that does not exist; the honest answer is that the server is broken.
  assert.ok(!/needs the `.+` scope/.test(text), `the refusal invented a scope: ${text}`);
  assert.ok(!text.includes("the undeclared thing"), "the refused tool's handler ran anyway");
});

// ── A9 (D-MCP7) — a tokenless loopback caller is unaffected ───────────────────────────────────────

test("A9 — a tokenless loopback call reaches EVERY tool, including the write-scoped one", async () => {
  const h = await makeHarness({ fabricated: true });
  const client = await connect(h);

  // The write-scoped tool: no token was presented, so there is no scope to check (D-MCP7). This is
  // the assertion that keeps the local browser and a `curl` on the host working exactly as before.
  const write = await call(client, WRITE_TOOL);
  assert.equal(write.isError ?? false, false, "a local caller must not be gated by a scope");
  assert.match(write.content[0]?.text ?? "", /the write/);

  // …and so is the tool that has no scope declared at all: fail-closed applies to TOKENS, not to the
  // open local path.
  const unmapped = await call(client, UNMAPPED_TOOL);
  assert.equal(unmapped.isError ?? false, false);
});

test("A9 — a tokenless loopback call reaches the real read surface too", async () => {
  const h = await makeHarness();
  const client = await connect(h);
  const result = await call(client, "servers_list");
  assert.equal(result.isError ?? false, false);
});

test("A9 — with API_AUTH_REQUIRED=true the same tokenless call is refused at the HTTP layer", async () => {
  const h = await makeHarness({ authRequired: true });

  const response = await fetch(h.mcpUrl, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "curl", version: "1.0.0" },
      },
    }),
  });
  assert.equal(response.status, 401, "the guard refuses before the mount is ever reached");
  assert.equal(
    ((await response.json()) as { code?: string }).code,
    API_TOKEN_AUTH_REQUIRED_ERROR_CODE,
  );
  // Nothing was dispatched, so nothing was audited.
  assert.deepEqual(auditEntries(h), []);

  // The same instance still works for a properly scoped token — the switch closes the door, it does
  // not break the mount.
  const token = h.mint(["read"]);
  const client = await connect(h, token.secret);
  assert.equal((await call(client, "servers_list")).isError ?? false, false);
});

// ── A10 — exactly one audit line per tool call, and never the credential ──────────────────────────

test("A10 — one audit line per call, carrying tool, outcome, duration and the DISPLAY prefix", async () => {
  const h = await makeHarness({ fabricated: true });
  const token = h.mint(["read"]);
  const client = await connect(h, token.secret);

  await call(client, "servers_list"); // allowed
  await call(client, WRITE_TOOL); // refused — no `scan:run`

  const entries = auditEntries(h);
  assert.equal(entries.length, 2, "exactly one audit line per tool call, no more and no fewer");

  const [allowed, refused] = entries as [Record<string, unknown>, Record<string, unknown>];
  assert.equal(allowed.mcpTool, "servers_list");
  assert.equal(allowed.ok, true);
  assert.equal(typeof allowed.durationMs, "number");
  assert.equal(allowed.tokenPrefix, `${API_TOKEN_PREFIX}${token.tokenPrefix}`);
  assert.equal(allowed.refusedScope, undefined, "an allowed call names no missing scope");

  assert.equal(refused.mcpTool, WRITE_TOOL);
  assert.equal(refused.ok, false);
  assert.equal(refused.refusedScope, "scan:run", "a refusal records WHICH scope was missing");
  assert.equal(refused.tokenPrefix, `${API_TOKEN_PREFIX}${token.tokenPrefix}`);

  // The credential itself is never anywhere in the log — not in the audit line, not in Fastify's own
  // request logging, not in an error. Only the 8-character display prefix, which cannot authenticate.
  const log = h.logLines.join("\n");
  assert.ok(h.logLines.length > 0, "sanity: the logger actually captured lines");
  assert.ok(!log.includes(token.secret), "the plaintext token reached a log line");
  const secretTail = token.secret.slice(API_TOKEN_PREFIX.length + token.tokenPrefix.length);
  assert.ok(
    secretTail.length > 0 && !log.includes(secretTail),
    "the secret half reached a log line",
  );
});

test("A10 — a tokenless call still audits, with a null prefix rather than a fabricated one", async () => {
  const h = await makeHarness();
  const client = await connect(h);
  await call(client, "servers_list");

  const entries = auditEntries(h);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.mcpTool, "servers_list");
  assert.equal(entries[0]?.ok, true);
  assert.equal(entries[0]?.tokenPrefix, null, "no token, no prefix — never an invented identity");
});

// ── A11 — the served usage doc states the requirement, and DERIVES it ─────────────────────────────

test("A11 — llms.txt states the mount's scope requirement, read from the declarations", async () => {
  const h = await makeHarness();
  const response = await fetch(`${h.baseUrl}${WORKBENCH_MCP_LLMS_TXT_PATH}`);
  assert.equal(response.status, 200);
  const document = await response.text();

  // The door rule, named from the route table rather than from a literal in this test — if the rule
  // were removed or changed, this assertion follows it instead of quietly passing on stale copy.
  const mountRule = API_TOKEN_ROUTE_SCOPES.find(
    (rule) => rule.method === "POST" && rule.path === WORKBENCH_MCP_MOUNT_PATH,
  );
  assert.ok(mountRule, "the mount rule this doc line is generated from");
  for (const scope of mountRule.scopes) {
    assert.ok(
      document.includes(`\`${scope}\` scope just`),
      `llms.txt never says a token needs \`${scope}\` to open the mount`,
    );
  }

  // The per-tool half, likewise derived. WP M.3 made the surface non-uniform, so the doc must now
  // list each tool that asks for MORE than the door scope, and must say the extra scope is ON TOP of
  // `read` rather than instead of it (D-MCP8 — the one thing an operator minting a token gets wrong).
  const doorScopes = new Set<string>(mountRule.scopes);
  const beyondDoor = Object.entries(WORKBENCH_MCP_TOOL_SCOPES).filter(
    ([, scope]) => !doorScopes.has(scope),
  );
  assert.equal(beyondDoor.length, WORKBENCH_MCP_WRITE_TOOL_NAMES.length, "the write surface");
  for (const [tool, scope] of beyondDoor) {
    assert.ok(
      document.includes(`  - ${tool} — \`${scope}\` plus`),
      `llms.txt never says ${tool} needs \`${scope}\``,
    );
  }
  assert.match(
    document,
    /ask for one MORE scope ON TOP of it/,
    "llms.txt never says the execute scope is IN ADDITION to `read`",
  );
  // …and the Actions family heading an agent onboards from.
  assert.match(document, /### Actions/);

  // …and the operator-facing facts an agent that gets refused needs next.
  assert.match(document, /Settings › API tokens/);
  assert.match(document, /Access & scopes/);
  assert.match(document, /From localhost: no credential/);
});

test("A10 — a tool that fails on its own merits is audited as a failure, not as a refusal", async () => {
  const h = await makeHarness();
  const token = h.mint(["read"]);
  const client = await connect(h, token.secret);

  // An unknown id: `safeTool` turns it into a readable isError result rather than a stack trace.
  const result = await call(client, "scans_get", { scanId: "no-such-scan" });
  assert.equal(result.isError, true);

  const entries = auditEntries(h);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.ok, false);
  assert.equal(
    entries[0]?.refusedScope,
    undefined,
    "not a scope refusal — the tool ran and failed",
  );
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// WP M.3 — the REAL write tools on the M.2 mechanism
// ══════════════════════════════════════════════════════════════════════════════════════════════════
// Everything above proved the gate with a fabricated tool, because no real write tool existed. Three
// now do, so the same three postures are re-asserted against the surface an agent actually connects
// to — no test seam, no `overrides` argument, no injected definition.
//
// The write dependencies in this harness throw a marker (see `makeHarness`), which is what makes
// "refused" and "ran and failed" distinguishable here: a refusal carries the scope sentence and NOT
// the marker; an allowed call carries the marker and NOT the scope sentence.

/** Args that get each write tool past SCHEMA validation, so the only thing left to fail is the gate. */
const WRITE_CALLS: ReadonlyArray<{
  tool: (typeof WORKBENCH_MCP_WRITE_TOOL_NAMES)[number];
  scope: ApiTokenScope;
  args: Record<string, unknown>;
}> = [
  { tool: "scan_run", scope: "scan:run", args: { serverId: "any-server" } },
  { tool: "suite_run_start", scope: "suites:run", args: { suiteId: "any-suite" } },
  {
    tool: "run_plan_start",
    scope: "runs:launch",
    args: { source: "adhoc", testIds: ["t1"], scenarioIds: ["e1"] },
  },
];

for (const { tool, scope, args } of WRITE_CALLS) {
  test(`A3 — a read-only token is refused on ${tool}, naming \`${scope}\``, async () => {
    const h = await makeHarness();
    const client = await connect(h, h.mint(["read"]).secret);

    const result = await call(client, tool, args);
    assert.equal(result.isError, true, "a scope refusal is an isError RESULT, not a transport error");
    const text = result.content[0]?.text ?? "";
    assert.match(text, new RegExp(scope.replace(":", ":")), "the refusal names the missing scope");
    assert.match(text, /Settings/, "…and says where the operator grants it");
    assert.ok(!text.includes("    at "), `the refusal leaked a stack trace: ${text}`);
    // The load-bearing half: the handler never ran, so nothing was scanned, resolved or launched.
    assert.ok(!text.includes(HANDLER_MARKER), "the refused tool's handler ran anyway");
    assert.deepEqual(h.reached, [], "a refused call must not reach a single dependency");
  });

  test(`A3 — a token holding read + \`${scope}\` reaches ${tool}'s handler`, async () => {
    const h = await makeHarness();
    const client = await connect(h, h.mint(["read", scope]).secret);

    const result = await call(client, tool, args);
    // The stubbed dependency throws, so this is an isError result — but it is the HANDLER's error,
    // carrying the marker, not the gate's refusal. That is exactly the distinction being proved.
    const text = result.content[0]?.text ?? "";
    assert.ok(text.includes(HANDLER_MARKER), `the gate refused a properly scoped token: ${text}`);
    assert.ok(!/needs the `.+` scope/.test(text), `a scoped token still got a scope refusal: ${text}`);
    assert.ok(h.reached.length > 0, "the handler never reached its dependency");
  });

  test(`A4 (D-MCP7) — a tokenless loopback caller reaches ${tool} with no scope at all`, async () => {
    const h = await makeHarness();
    const client = await connect(h);

    const result = await call(client, tool, args);
    const text = result.content[0]?.text ?? "";
    assert.ok(text.includes(HANDLER_MARKER), `a local caller was gated by a scope: ${text}`);
    assert.ok(h.reached.length > 0, "the local caller never reached the handler");
  });

  test(`A3 — a WRONG execute scope is still refused on ${tool}`, async () => {
    const h = await makeHarness();
    // Every execute scope EXCEPT this tool's own. `suites:run` must not open `scan_run`, and
    // `runs:launch` must not open `suite_run_start` — otherwise the three scopes are one scope.
    const others = (["scan:run", "runs:launch", "suites:run"] as ApiTokenScope[]).filter(
      (candidate) => candidate !== scope,
    );
    const client = await connect(h, h.mint(["read", ...others]).secret);

    const result = await call(client, tool, args);
    assert.equal(result.isError, true);
    assert.match(result.content[0]?.text ?? "", new RegExp(`\`${scope}\``));
    assert.deepEqual(h.reached, [], "a wrongly-scoped call must not reach the handler");
  });
}

test("A3 — the write tools' scope refusals are audited as refusals, with the scope that was missing", async () => {
  const h = await makeHarness();
  const token = h.mint(["read"]);
  const client = await connect(h, token.secret);

  for (const { args, tool } of WRITE_CALLS) await call(client, tool, args);

  const entries = auditEntries(h);
  assert.equal(entries.length, WRITE_CALLS.length, "one audit line per call, no more and no fewer");
  assert.deepEqual(
    entries.map((entry) => [entry.mcpTool, entry.ok, entry.refusedScope]),
    WRITE_CALLS.map(({ tool, scope }) => [tool, false, scope]),
  );
  assert.ok(!h.logLines.join("\n").includes(token.secret), "the plaintext token reached a log line");
});
