import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { afterEach, test } from "node:test";
import type { ToolCallResult } from "@mcp-token-footprint/shared";
import {
  ASSISTANT_ACTION_READ_TOOL_NAMES,
  ASSISTANT_ACTION_WRITE_TOOL_NAMES,
  buildActionToolDefinitions,
  type ActionToolDeps,
} from "../src/assistant/tools/action-tools.js";
import { ensureLocalCollection, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { RatingIssueRepository } from "../src/grading/issue-repository.js";
import type { ListToolsResult } from "../src/scans/service.js";
import type { ScanService } from "../src/scans/service.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { ServerRepository } from "../src/servers/repository.js";
import { SkillRepository } from "../src/skills/repository.js";
import { RunRepository } from "../src/testing/run-repository.js";
import { ScenarioRepository } from "../src/testing/scenario-repository.js";
import { TestRepository } from "../src/testing/test-repository.js";

// Cross-entity ACTION tools (owner refinement), exercised DIRECTLY (each tool's `.handler(args, {})`)
// against a seeded DB + a scripted-fake `ScanService` — no SDK, no MCP connection, no Anthropic call.
// The fake records what the MCP-bridge tools passed through so we assert delegation, not re-implement it.

const databases: AppDatabase[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

const NOW = "2026-07-01T00:00:00.000Z";

function createDatabase(): AppDatabase {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  ensureLocalCollection(db);
  databases.push(db);
  return db;
}

function seedProvider(db: AppDatabase): void {
  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, api_key_encrypted, created_at, updated_at)
     VALUES ('prov-1', 'anthropic', 'Claude', 'enc:v1:abc', @now, @now)`,
  ).run({ now: NOW });
}

/** A scripted `ScanService` stand-in: records the last listTools/callTool args, returns canned results. */
class FakeScanService {
  listToolsCalls: string[] = [];
  callToolCalls: Array<{ serverId: string; toolName: string; args: Record<string, unknown> }> = [];
  listToolsResult: ListToolsResult = { serverId: "srv-1", serverName: "Filesystem", tools: [] };
  callToolResult: ToolCallResult = {
    toolName: "list_files",
    isError: false,
    durationMs: 12,
    tokenProfile: "generic_o200k",
    requestTokens: 5,
    requestBytes: 40,
    responseTokens: 9,
    responseBytes: 80,
    content: [{ type: "text", text: "a.txt\nb.txt" }],
    raw: { content: [{ type: "text", text: "a.txt\nb.txt" }] },
  };
  listTools(serverId: string): Promise<ListToolsResult> {
    this.listToolsCalls.push(serverId);
    return Promise.resolve(this.listToolsResult);
  }
  callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<ToolCallResult> {
    this.callToolCalls.push({ serverId, toolName, args });
    return Promise.resolve({ ...this.callToolResult, toolName });
  }
}

type Fixture = {
  deps: ActionToolDeps;
  fakeScan: FakeScanService;
  issues: RatingIssueRepository;
  serverId: string;
  skillId: string;
  skillVersionId: string;
  runId: string;
};

function buildFixture(): Fixture {
  const db = createDatabase();
  const secrets = new SecretStore(Buffer.alloc(32, 7));
  const servers = new ServerRepository(db, secrets);
  const skills = new SkillRepository(db, secrets);
  const runs = new RunRepository(db);
  const environments = new ScenarioRepository(db);
  const tests = new TestRepository(db);
  const issues = new RatingIssueRepository(db);
  seedProvider(db);

  const server = servers.create({
    name: "Filesystem MCP",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem"],
  });

  const skill = skills.create({ name: "pdf-tools", sourceType: "upload", description: "PDFs" });
  const version = skills.createVersion(
    skill.id,
    [{ path: "SKILL.md", bytes: Buffer.from("---\nname: pdf-tools\n---\nBody.", "utf8") }],
    { sourceKind: "upload", importedFrom: "upload", manifest: { name: "pdf-tools" } },
  );

  const environment = environments.create({
    name: "Env",
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
  const testRow = tests.create({
    name: "List files",
    userPrompt: "List the files.",
    addedProfiles: [],
    tags: [],
  });

  const runId = "run-main";
  runs.createRun(runId, { testId: testRow.id, scenarioId: environment.id, mode: "automated" });
  runs.onEvent(runId, { type: "status", status: "completed", outcome: "completed" });
  runs.recordRunSkills(runId, [
    {
      skillId: skill.id,
      skillVersionId: version.version.id,
      versionLabel: version.version.versionLabel,
      eager: true,
    },
  ]);

  const fakeScan = new FakeScanService();
  const deps: ActionToolDeps = {
    scanService: fakeScan as unknown as ScanService,
    issues,
    skills,
    servers,
    runs,
  };
  return {
    deps,
    fakeScan,
    issues,
    serverId: server.id,
    skillId: skill.id,
    skillVersionId: version.version.id,
    runId,
  };
}

function toolFor(deps: ActionToolDeps, name: string) {
  const def = buildActionToolDefinitions(deps).find((d) => d.name === name);
  if (!def) throw new Error(`no action tool named "${name}"`);
  return def;
}

async function call<T = Record<string, unknown>>(
  deps: ActionToolDeps,
  name: string,
  args: Record<string, unknown>,
): Promise<{ ok: T; isError: boolean }> {
  const def = toolFor(deps, name);
  const result = await def.handler(args as never, {});
  const block = result.content[0] as { type: "text"; text: string };
  return { ok: JSON.parse(block.text) as T, isError: result.isError === true };
}

// ── inventory ─────────────────────────────────────────────────────────────────────────────────────

test("the action toolset registers exactly its read + write tools", () => {
  const { deps } = buildFixture();
  const names = buildActionToolDefinitions(deps).map((d) => d.name);
  assert.deepEqual(
    [...names].sort(),
    [...ASSISTANT_ACTION_READ_TOOL_NAMES, ...ASSISTANT_ACTION_WRITE_TOOL_NAMES].sort(),
  );
});

// ── mcp_tools_list ──────────────────────────────────────────────────────────────────────────────────

test("mcp_tools_list delegates to ScanService.listTools and returns the normalized tools", async () => {
  const { deps, fakeScan, serverId } = buildFixture();
  fakeScan.listToolsResult = {
    serverId,
    serverName: "Filesystem MCP",
    tools: [
      { name: "list_files", description: "List files", inputSchema: { type: "object" } },
      { name: "read_file", description: "Read a file", inputSchema: { type: "object" } },
    ],
  };
  const { ok } = await call<{ tools: Array<{ name: string }>; total: number; truncated: boolean }>(
    deps,
    "mcp_tools_list",
    { serverId },
  );
  assert.deepEqual(fakeScan.listToolsCalls, [serverId]);
  assert.deepEqual(
    ok.tools.map((t) => t.name),
    ["list_files", "read_file"],
  );
  assert.equal(ok.total, 2);
  assert.equal(ok.truncated, false);
});

test("mcp_tools_list surfaces a connection failure as an error result (not a throw)", async () => {
  const { deps, fakeScan, serverId } = buildFixture();
  fakeScan.listTools = () => Promise.reject(new Error("ECONNREFUSED"));
  const { isError, ok } = await call<{ error: string }>(deps, "mcp_tools_list", { serverId });
  assert.equal(isError, true);
  assert.match(ok.error, /ECONNREFUSED/);
});

// ── mcp_tool_call ───────────────────────────────────────────────────────────────────────────────────

test("mcp_tool_call delegates to ScanService.callTool and returns the result + measured cost", async () => {
  const { deps, fakeScan, serverId } = buildFixture();
  const { ok } = await call<{
    toolName: string;
    isError: boolean;
    cost: { requestTokens: number; responseTokens: number };
    result: unknown;
  }>(deps, "mcp_tool_call", { serverId, toolName: "list_files", arguments: { path: "/tmp" } });
  assert.deepEqual(fakeScan.callToolCalls, [
    { serverId, toolName: "list_files", args: { path: "/tmp" } },
  ]);
  assert.equal(ok.toolName, "list_files");
  assert.equal(ok.isError, false);
  assert.equal(ok.cost.requestTokens, 5);
  assert.equal(ok.cost.responseTokens, 9);
});

test("mcp_tool_call defaults missing arguments to {} (no crash)", async () => {
  const { deps, fakeScan, serverId } = buildFixture();
  await call(deps, "mcp_tool_call", { serverId, toolName: "list_files" });
  assert.deepEqual(fakeScan.callToolCalls[0]?.args, {});
});

test("mcp_tool_call bounds a huge tool result with an explicit truncation marker", async () => {
  const { deps, fakeScan, serverId } = buildFixture();
  const huge = "x".repeat(30_000); // serializes well past the 20,000-char result bound
  fakeScan.callToolResult = {
    ...fakeScan.callToolResult,
    content: [{ type: "text", text: huge }],
    structuredContent: { blob: huge },
  };
  const { ok } = await call<{ result: { truncated?: boolean; preview?: string } }>(
    deps,
    "mcp_tool_call",
    { serverId, toolName: "list_files" },
  );
  assert.equal(ok.result.truncated, true);
  assert.ok(typeof ok.result.preview === "string" && ok.result.preview.includes("truncated"));
});

// ── rating_issues_list / rating_issue_file ────────────────────────────────────────────────────────────

test("rating_issue_file creates an issue against the run's skill, resolving name + pinned version", async () => {
  const { deps, issues, skillId, skillVersionId, runId } = buildFixture();
  const { ok } = await call<{
    issueId: string;
    targetKind: string;
    targetId: string;
    targetName: string;
    timesSeen: number;
    link: string;
  }>(deps, "rating_issue_file", {
    targetKind: "skill",
    targetId: skillId,
    title: "SKILL.md over-instructs the model",
    summary: "The skill body tells the model to always call read_file even when unneeded.",
    severity: "high",
    runId,
  });
  assert.equal(ok.targetKind, "skill");
  assert.equal(ok.targetId, skillId);
  assert.equal(ok.targetName, "pdf-tools"); // resolved from SkillRepository.getPublic
  assert.equal(ok.timesSeen, 1);
  assert.equal(ok.link, `/skills/${skillId}`);

  const persisted = issues.get(ok.issueId);
  assert.equal(persisted.severity, "high");
  assert.equal(persisted.skillVersionId, skillVersionId); // pinned from the run's resolution
  assert.equal(persisted.bucket, "skill");
  assert.equal(persisted.fixTarget, "skill");
  assert.equal(persisted.occurrences.length, 1);
  assert.equal(persisted.occurrences[0]?.runId, runId);
  assert.equal(persisted.occurrences[0]?.category, "manual");
});

test("rating_issue_file re-filing the same title against the same target dedups (one issue, times_seen++)", async () => {
  const { deps, issues, skillId, runId } = buildFixture();
  const args = {
    targetKind: "skill" as const,
    targetId: skillId,
    title: "Same underlying problem",
    summary: "First sighting.",
    runId,
  };
  const first = await call<{ issueId: string; timesSeen: number }>(deps, "rating_issue_file", args);
  const second = await call<{ issueId: string; timesSeen: number }>(deps, "rating_issue_file", {
    ...args,
    summary: "Second sighting, same title.",
  });
  assert.equal(first.ok.issueId, second.ok.issueId, "same issue, not a duplicate");
  assert.equal(second.ok.timesSeen, 2);
  assert.equal(issues.listByTarget("skill", skillId).length, 1);
});

test("rating_issue_file can target an MCP server (resolves the server's name)", async () => {
  const { deps, serverId, runId } = buildFixture();
  const { ok } = await call<{ targetName: string; link: string; targetKind: string }>(
    deps,
    "rating_issue_file",
    {
      targetKind: "mcp_server",
      targetId: serverId,
      title: "Tool schema is wrong",
      summary: "list_files rejects the documented path argument.",
      runId,
    },
  );
  assert.equal(ok.targetKind, "mcp_server");
  assert.equal(ok.targetName, "Filesystem MCP");
  assert.equal(ok.link, `/servers/${serverId}`);
});

test("rating_issue_file errors cleanly on an unknown run id", async () => {
  const { deps, skillId } = buildFixture();
  const { isError } = await call(deps, "rating_issue_file", {
    targetKind: "skill",
    targetId: skillId,
    title: "x",
    summary: "y",
    runId: "run-does-not-exist",
  });
  assert.equal(isError, true);
});

test("rating_issues_list returns filed issues, filterable by target", async () => {
  const { deps, skillId, serverId, runId } = buildFixture();
  await call(deps, "rating_issue_file", {
    targetKind: "skill",
    targetId: skillId,
    title: "Skill issue",
    summary: "s",
    runId,
  });
  await call(deps, "rating_issue_file", {
    targetKind: "mcp_server",
    targetId: serverId,
    title: "Server issue",
    summary: "s",
    runId,
  });
  const all = await call<{ issues: unknown[]; count: number }>(deps, "rating_issues_list", {});
  assert.equal(all.ok.count, 2);
  const skillOnly = await call<{ issues: Array<{ targetId: string }>; count: number }>(
    deps,
    "rating_issues_list",
    { targetKind: "skill" },
  );
  assert.equal(skillOnly.ok.count, 1);
  assert.equal(skillOnly.ok.issues[0]?.targetId, skillId);
});
