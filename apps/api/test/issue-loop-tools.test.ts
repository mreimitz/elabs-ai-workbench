import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { afterEach, test } from "node:test";
import { CLUSTER_KEY_VERSION, type RunRerunRequest } from "@mcp-token-footprint/shared";
import {
  ASSISTANT_ISSUE_LOOP_ACTION_TOOL_NAMES,
  ASSISTANT_ISSUE_LOOP_READ_TOOL_NAMES,
  type IssueLoopRunLauncher,
  type IssueLoopToolDeps,
  buildIssueLoopToolDefinitions,
  isIssueLoopActionTool,
} from "../src/assistant/tools/issue-loop-tools.js";
import { CollectionRepository } from "../src/collections/repository.js";
import { applyMigrations, ensureLocalCollection, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { RatingIssueRepository } from "../src/grading/issue-repository.js";
import { IssueVerificationStore } from "../src/grading/issue-verification.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { ServerRepository } from "../src/servers/repository.js";
import { RunRepository } from "../src/testing/run-repository.js";
import { ScenarioRepository } from "../src/testing/scenario-repository.js";
import { TestRepository } from "../src/testing/test-repository.js";
import { TestService } from "../src/testing/test-service.js";

// Observability WP5.4 — the assistant issue-loop tools, exercised DIRECTLY (`.handler(args, {})`) against
// a seeded DB + a FAKE run launcher: NO SDK, NO MCP connection, NO real run launched (WP5.4 hard rule).

const databases: AppDatabase[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

const NOW = "2026-07-01T00:00:00.000Z";

function createDatabase(): AppDatabase {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db); // fleet-issue columns (cluster_key, lifecycle, …) are migration-added
  ensureLocalCollection(db);
  databases.push(db);
  return db;
}

/** A scripted run launcher — records the fork calls, returns a canned derived run id (no real run). */
class FakeRunLauncher implements IssueLoopRunLauncher {
  calls: Array<{ parentRunId: string; request: RunRerunRequest }> = [];
  nextRunId = "run-fork-1";
  rerun(parentRunId: string, request: RunRerunRequest): { runId: string; done?: Promise<unknown> } {
    this.calls.push({ parentRunId, request });
    return { runId: this.nextRunId, done: Promise.resolve() };
  }
}

type Fixture = {
  deps: IssueLoopToolDeps;
  launcher: FakeRunLauncher;
  issues: RatingIssueRepository;
  verification: IssueVerificationStore;
  issueId: string;
  runId: string;
  collectionId: string;
};

function buildFixture(): Fixture {
  const db = createDatabase();
  const secrets = new SecretStore(Buffer.alloc(32, 7));
  const servers = new ServerRepository(db, secrets);
  const runs = new RunRepository(db);
  const environments = new ScenarioRepository(db);
  const testRepo = new TestRepository(db);
  const testService = new TestService(testRepo);
  const collections = new CollectionRepository(db, secrets);
  const issues = new RatingIssueRepository(db);

  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, api_key_encrypted, created_at, updated_at)
     VALUES ('prov-1', 'anthropic', 'Claude', 'enc:v1:abc', @now, @now)`,
  ).run({ now: NOW });

  const server = servers.create({
    name: "Acme MCP",
    transport: "stdio",
    command: "npx",
    args: ["-y", "server"],
  });
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
  const testRow = testService.create({
    name: "Run a query",
    userPrompt: "Run the query.",
    addedProfiles: [],
    tags: [],
  });

  const runId = "run-main";
  runs.createRun(runId, { testId: testRow.id, scenarioId: environment.id, mode: "automated" });
  runs.onEvent(runId, { type: "status", status: "completed", outcome: "completed" });

  const collection = collections.create({ name: "Regressions" });

  // A deterministically-clustered FLEET issue, born with a contributing-run occurrence on `runId`.
  const issue = issues.insertFleetIssue({
    clusterKey: "srv-1::failed_tool_call::run_query",
    clusterKeyVersion: CLUSTER_KEY_VERSION,
    targetKind: "mcp_server",
    targetId: server.id,
    targetName: server.name,
    title: "run_query rejects a valid date filter",
    summary: "The tool rejects ISO date filters with a schema-validation error.",
    bucket: "mcp_server",
    fixTarget: "mcp_server",
    draftFix: "Loosen the date param schema.",
    severity: "high",
    ratingVersion: 3,
    affected: { servers: [server.id], skills: [], tests: [testRow.id], models: ["claude-sonnet-4"] },
    occurrence: {
      runId,
      findingDigest: "digest-1",
      category: "failed_tool_call",
      message: "run_query rejected the date filter",
      toolName: "run_query",
      errorMessage: "Invalid parameter: date",
    },
    observedAt: "2026-07-01T09:00:00.000Z",
  });

  const launcher = new FakeRunLauncher();
  const verification = new IssueVerificationStore(new IssueVerificationKv());
  const deps: IssueLoopToolDeps = {
    issues,
    runs,
    tests: testRepo,
    testService,
    collections,
    runService: launcher,
    verification,
  };
  return { deps, launcher, issues, verification, issueId: issue.id, runId, collectionId: collection.id };
}

/** In-memory `app_settings`-shaped KV for the verification store. */
class IssueVerificationKv {
  private readonly store = new Map<string, unknown>();
  get(key: string): unknown {
    return this.store.get(key);
  }
  put(key: string, value: unknown): void {
    this.store.set(key, value);
  }
}

function toolFor(deps: IssueLoopToolDeps, name: string) {
  const def = buildIssueLoopToolDefinitions(deps).find((d) => d.name === name);
  if (!def) throw new Error(`no issue-loop tool named "${name}"`);
  return def;
}

async function call<T = Record<string, unknown>>(
  deps: IssueLoopToolDeps,
  name: string,
  args: Record<string, unknown>,
): Promise<{ ok: T; isError: boolean }> {
  const def = toolFor(deps, name);
  const result = await def.handler(args as never, {});
  const block = result.content[0] as { type: "text"; text: string };
  return { ok: JSON.parse(block.text) as T, isError: result.isError === true };
}

// ── inventory + classification ──────────────────────────────────────────────────────────────────────

test("the issue-loop toolset registers exactly its read + action tools", () => {
  const { deps } = buildFixture();
  const names = buildIssueLoopToolDefinitions(deps).map((d) => d.name);
  assert.deepEqual(
    [...names].sort(),
    [...ASSISTANT_ISSUE_LOOP_READ_TOOL_NAMES, ...ASSISTANT_ISSUE_LOOP_ACTION_TOOL_NAMES].sort(),
  );
});

test("isIssueLoopActionTool covers ONLY the three gated action tools (not the reads)", () => {
  for (const name of ASSISTANT_ISSUE_LOOP_ACTION_TOOL_NAMES) assert.ok(isIssueLoopActionTool(name));
  for (const name of ASSISTANT_ISSUE_LOOP_READ_TOOL_NAMES) assert.ok(!isIssueLoopActionTool(name));
  assert.ok(!isIssueLoopActionTool("rating_issue_file"));
});

// ── read tools ────────────────────────────────────────────────────────────────────────────────────

test("issues_get returns the issue's identity, cluster, and bounded occurrences", async () => {
  const { deps, issueId, runId } = buildFixture();
  const { ok } = await call<{
    id: string;
    fleet?: { clusterKey: string; lifecycle: string };
    occurrences: Array<{ runId: string; toolName?: string }>;
  }>(deps, "issues_get", { issueId });
  assert.equal(ok.id, issueId);
  assert.equal(ok.fleet?.lifecycle, "open");
  assert.ok(ok.fleet?.clusterKey.includes("run_query"));
  assert.equal(ok.occurrences[0]?.runId, runId);
  assert.equal(ok.occurrences[0]?.toolName, "run_query");
});

test("issues_list filters by target + lifecycle", async () => {
  const { deps, issueId } = buildFixture();
  const all = await call<{ issues: unknown[]; count: number }>(deps, "issues_list", {});
  assert.equal(all.ok.count, 1);
  const open = await call<{ issues: Array<{ id: string }>; count: number }>(deps, "issues_list", {
    lifecycle: "open",
  });
  assert.equal(open.ok.count, 1);
  assert.equal(open.ok.issues[0]?.id, issueId);
  const resolved = await call<{ count: number }>(deps, "issues_list", { lifecycle: "resolved" });
  assert.equal(resolved.ok.count, 0);
});

test("issues_linked_runs returns contributing runs + (initially empty) verification runs", async () => {
  const { deps, issueId, runId } = buildFixture();
  const { ok } = await call<{
    linkedRuns: Array<{ runId: string }>;
    verificationRuns: unknown[];
  }>(deps, "issues_linked_runs", { issueId });
  assert.equal(ok.linkedRuns[0]?.runId, runId);
  assert.deepEqual(ok.verificationRuns, []);
});

test("a read tool errors cleanly (not a throw) on an unknown issue id", async () => {
  const { deps } = buildFixture();
  const { isError } = await call(deps, "issues_get", { issueId: "nope" });
  assert.equal(isError, true);
});

// ── issues_update (gated) ─────────────────────────────────────────────────────────────────────────

test("issues_update resolve transitions a fleet issue's lifecycle + records the note", async () => {
  const { deps, issues, issueId } = buildFixture();
  const { ok } = await call<{ lifecycle: string; resolutionNote?: string }>(deps, "issues_update", {
    issueId,
    action: "resolve",
    note: "loosened the schema",
  });
  assert.equal(ok.lifecycle, "resolved");
  assert.equal(ok.resolutionNote, "loosened the schema");
  assert.equal(issues.get(issueId).fleet?.lifecycle, "resolved");
});

test("issues_update reopen returns a resolved issue to open", async () => {
  const { deps, issues, issueId } = buildFixture();
  await call(deps, "issues_update", { issueId, action: "resolve" });
  await call(deps, "issues_update", { issueId, action: "reopen" });
  assert.equal(issues.get(issueId).fleet?.lifecycle, "open");
});

// ── tests_create_draft (gated) ─────────────────────────────────────────────────────────────────────

test("tests_create_draft promotes a linked run into a DRAFT test in the chosen collection", async () => {
  const { deps, runId, collectionId } = buildFixture();
  const { ok } = await call<{ testId: string; draft: boolean; collectionId: string; name: string }>(
    deps,
    "tests_create_draft",
    { runId, collectionId },
  );
  assert.equal(ok.draft, true);
  assert.equal(ok.collectionId, collectionId);
  assert.match(ok.name, /^\[Draft\]/);
  // The draft is persisted + marked draft (never auto-runs).
  const persisted = deps.testService.get(ok.testId);
  assert.equal(persisted.draft, true);
});

test("tests_create_draft errors cleanly on an unknown collection id", async () => {
  const { deps, runId } = buildFixture();
  const { isError } = await call(deps, "tests_create_draft", { runId, collectionId: "gone" });
  assert.equal(isError, true);
});

// ── runs_rerun (gated) — fork + record the verification link ──────────────────────────────────────

test("runs_rerun forks the linked run through the launcher and records a verification link", async () => {
  const { deps, launcher, verification, issueId, runId } = buildFixture();
  const { ok } = await call<{ runId: string; verifiesIssueId: string; sourceRunId?: string }>(
    deps,
    "runs_rerun",
    { parentRunId: runId, issueId, note: "pin the fixed schema", overrides: { skillVersionId: "skv-9" } },
  );
  // The fork was delegated to the launcher with the overrides (no real run launched).
  assert.equal(launcher.calls.length, 1);
  assert.equal(launcher.calls[0]?.parentRunId, runId);
  assert.deepEqual(launcher.calls[0]?.request.overrides, { skillVersionId: "skv-9" });
  // The derived run is returned + recorded on the issue as a verification run.
  assert.equal(ok.runId, "run-fork-1");
  assert.equal(ok.verifiesIssueId, issueId);
  assert.equal(ok.sourceRunId, runId);
  const links = verification.list(issueId);
  assert.equal(links.length, 1);
  assert.equal(links[0]?.runId, "run-fork-1");
  assert.equal(links[0]?.sourceRunId, runId);
  assert.equal(links[0]?.note, "pin the fixed schema");
});

test("runs_rerun surfaces on issues_linked_runs after it forks (the verification runs render)", async () => {
  const { deps, issueId, runId } = buildFixture();
  await call(deps, "runs_rerun", { parentRunId: runId, issueId });
  const { ok } = await call<{ verificationRuns: Array<{ runId: string }> }>(
    deps,
    "issues_linked_runs",
    { issueId },
  );
  assert.equal(ok.verificationRuns.length, 1);
  assert.equal(ok.verificationRuns[0]?.runId, "run-fork-1");
});

test("runs_rerun errors cleanly (no fork launched) on an unknown issue id", async () => {
  const { deps, launcher, runId } = buildFixture();
  const { isError } = await call(deps, "runs_rerun", { parentRunId: runId, issueId: "nope" });
  assert.equal(isError, true);
  assert.equal(launcher.calls.length, 0, "an unknown issue id must not launch a run");
});
