// Assistant Hub (roadmap/assistant-hub/, WP0.5, §1.6) — the built-in tool catalog:
// files.{list,read,write,edit}, artifacts.{create,update}, memory.propose_save,
// mission.propose_plan, tasks.{create,update,list} + `safeExecuteBuiltin`'s error-containment
// guarantee.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import type { HubAgentReport, HubMissionPlan } from "@mcp-token-footprint/shared";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { getTokenCounter } from "../src/token-counting/profiles.js";
import { HubRepository } from "../src/hub/repository.js";
import {
  ALL_BUILTIN_NAMES,
  ARTIFACT_BUILTINS,
  DEFAULT_CHAT_BUILTIN_NAMES,
  MEMORY_BUILTINS,
  MISSION_BUILTINS,
  MISSION_READ_BUILTINS,
  TASK_BUILTINS,
  WORKSPACE_BUILTINS,
  artifactsCreate,
  artifactsRead,
  artifactsUpdate,
  missionList,
  missionReport,
  filesEdit,
  filesList,
  filesRead,
  filesWrite,
  memoryProposeSave,
  missionProposePlan,
  reconstructTasks,
  tasksCreate,
  tasksList,
  tasksUpdate,
} from "../src/hub/tools/builtins/index.js";
import { safeExecuteBuiltin, type HubToolExecutionContext } from "../src/hub/tools/types.js";
import { ensureHubWorkspaceRoot } from "../src/hub/workspace.js";

const databases: AppDatabase[] = [];
const tempDirs: string[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function openRepo(): HubRepository {
  const db = new Database(":memory:") as unknown as AppDatabase;
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  databases.push(db);
  return new HubRepository(db);
}

function tempWorkspace(sessionId: string): string {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-builtins-test-"));
  tempDirs.push(dataDir);
  return ensureHubWorkspaceRoot(dataDir, sessionId);
}

function makeCtx(overrides: Partial<HubToolExecutionContext> = {}): HubToolExecutionContext {
  const repository = overrides.repository ?? openRepo();
  const session = repository.createSession({ mode: "chat", model: "test-model" });
  return {
    sessionId: overrides.sessionId ?? session.id,
    workspaceRoot: overrides.workspaceRoot ?? tempWorkspace(session.id),
    repository,
    tokenCounter: overrides.tokenCounter ?? getTokenCounter("generic_o200k"),
  };
}

// ── Catalog composition ─────────────────────────────────────────────────────────────────────────

test("ALL_BUILTINS covers every §1.6 built-in family exactly once", () => {
  assert.deepEqual(new Set(ALL_BUILTIN_NAMES).size, ALL_BUILTIN_NAMES.length, "no duplicate names");
  const expected = [
    "files.list",
    "files.read",
    "files.write",
    "files.edit",
    "artifacts.create",
    // assistant-hub v1-fixes (F3) — the read side of artifacts + missions.
    "artifacts.read",
    "artifacts.update",
    "memory.propose_save",
    "tasks.create",
    "tasks.update",
    "tasks.list",
    "mission.propose_plan",
    "mission.list",
    "mission.report",
  ];
  assert.deepEqual([...ALL_BUILTIN_NAMES].sort(), [...expected].sort());
  assert.equal(WORKSPACE_BUILTINS.length, 4);
  assert.equal(ARTIFACT_BUILTINS.length, 3);
  assert.equal(MEMORY_BUILTINS.length, 1);
  assert.equal(TASK_BUILTINS.length, 3);
  assert.equal(MISSION_BUILTINS.length, 1);
  assert.equal(MISSION_READ_BUILTINS.length, 2);
});

test("DEFAULT_CHAT_BUILTIN_NAMES grants every built-in EXCEPT the planner-only mission.propose_plan", () => {
  assert.ok(!DEFAULT_CHAT_BUILTIN_NAMES.includes("mission.propose_plan"));
  assert.equal(DEFAULT_CHAT_BUILTIN_NAMES.length, ALL_BUILTIN_NAMES.length - 1);
});

// ── files.* ──────────────────────────────────────────────────────────────────────────────────────

test("files.write then files.read round-trip; files.list surfaces the entry", async () => {
  const ctx = makeCtx();
  const writeResult = await filesWrite.execute({ path: "notes.md", content: "hello" }, ctx);
  assert.equal(writeResult.isError, undefined);
  assert.deepEqual(writeResult.modelContent, { path: "notes.md", bytes: 5 });

  const readResult = await filesRead.execute({ path: "notes.md" }, ctx);
  assert.deepEqual(readResult.modelContent, { path: "notes.md", content: "hello" });

  const listResult = await filesList.execute({}, ctx);
  const entries = (listResult.modelContent as { entries: Array<{ path: string }> }).entries;
  assert.ok(entries.some((e) => e.path === "notes.md"));
});

test("files.edit replaces a unique span; a missing file is caught as isError (never throws)", async () => {
  const ctx = makeCtx();
  await filesWrite.execute({ path: "a.txt", content: "foo bar" }, ctx);
  const editResult = await filesEdit.execute({ path: "a.txt", oldText: "bar", newText: "baz" }, ctx);
  assert.deepEqual(editResult.modelContent, { path: "a.txt", bytes: 7, replacements: 1 });

  // A raw execute() call is expected to THROW on a workspace-guard failure (httpError) — that's what
  // `safeExecuteBuiltin` exists to contain. Assert the containment here.
  const missingResult = await safeExecuteBuiltin(filesEdit, { path: "missing.txt", oldText: "x", newText: "y" }, ctx);
  assert.equal(missingResult.isError, true);
  assert.match(missingResult.errorText ?? "", /No file/);
});

test("safeExecuteBuiltin converts a zod validation failure into isError, never throwing", async () => {
  const ctx = makeCtx();
  const result = await safeExecuteBuiltin(filesRead, { path: "" }, ctx);
  assert.equal(result.isError, true);
  assert.ok(result.errorText && result.errorText.length > 0);
});

test("path traversal via a built-in call is rejected, not silently clamped", async () => {
  const ctx = makeCtx();
  const result = await safeExecuteBuiltin(filesWrite, { path: "../escape.txt", content: "x" }, ctx);
  assert.equal(result.isError, true);
  assert.match(result.errorText ?? "", /Invalid workspace path/);
});

// ── artifacts.* (against the WP0.2 repo) ────────────────────────────────────────────────────────

test("artifacts.create persists via HubRepository and returns a modelContent + artifact channel", async () => {
  const ctx = makeCtx();
  const result = await artifactsCreate.execute(
    { kind: "markdown", title: "Report", content: "# Report" },
    ctx,
  );
  const modelContent = result.modelContent as { artifactId: string; version: number };
  assert.equal(modelContent.version, 1);
  const stored = ctx.repository.getArtifact(modelContent.artifactId);
  assert.equal(stored.title, "Report");
  assert.equal(stored.sessionId, ctx.sessionId);
  assert.equal(result.artifact?.kind, "hub_artifact");
});

test("artifacts.update appends a new IMMUTABLE version", async () => {
  const ctx = makeCtx();
  const created = await artifactsCreate.execute(
    { kind: "markdown", title: "Report", content: "v1" },
    ctx,
  );
  const artifactId = (created.modelContent as { artifactId: string }).artifactId;
  const updated = await artifactsUpdate.execute({ artifactId, content: "v2" }, ctx);
  assert.deepEqual(updated.modelContent, { artifactId, version: 2 });
  const versions = ctx.repository.listArtifactVersions(artifactId);
  assert.equal(versions.length, 2);
  assert.equal(versions[0]?.content, "v1");
  assert.equal(versions[1]?.content, "v2");
});

// ── artifacts.* event flow (WP1.6, §1.3 R-SES1) ─────────────────────────────────────────────────

test("artifacts.create appends a durable artifact_created event to the session log", async () => {
  const ctx = makeCtx();
  const result = await artifactsCreate.execute(
    { kind: "markdown", title: "Report", content: "# Report" },
    ctx,
  );
  const artifactId = (result.modelContent as { artifactId: string }).artifactId;
  const events = ctx.repository.listEvents(ctx.sessionId);
  const created = events.find((e) => e.type === "artifact_created");
  assert.ok(created, "expected an artifact_created event");
  assert.equal(created?.type === "artifact_created" && created.artifactId, artifactId);
  assert.equal(created?.type === "artifact_created" && created.kind, "markdown");
  assert.equal(created?.type === "artifact_created" && created.title, "Report");
  assert.equal(created?.type === "artifact_created" && created.version, 1);
});

test("artifacts.update appends a durable artifact_updated event carrying the new version + note", async () => {
  const ctx = makeCtx();
  const created = await artifactsCreate.execute(
    { kind: "markdown", title: "Report", content: "v1" },
    ctx,
  );
  const artifactId = (created.modelContent as { artifactId: string }).artifactId;
  await artifactsUpdate.execute({ artifactId, content: "v2", note: "fixed typo" }, ctx);
  const events = ctx.repository.listEvents(ctx.sessionId);
  const updated = events.find((e) => e.type === "artifact_updated");
  assert.ok(updated, "expected an artifact_updated event");
  assert.equal(updated?.type === "artifact_updated" && updated.artifactId, artifactId);
  assert.equal(updated?.type === "artifact_updated" && updated.version, 2);
  assert.equal(updated?.type === "artifact_updated" && updated.note, "fixed typo");
});

// ── memory.propose_save (D-AH11: propose, never silent) ─────────────────────────────────────────

test("memory.propose_save persists with status 'proposed', source 'assistant_proposed' — never active immediately", async () => {
  const ctx = makeCtx();
  const result = await memoryProposeSave.execute(
    { kind: "preference", content: "Prefers concise answers." },
    ctx,
  );
  const memoryId = (result.modelContent as { memoryId: string }).memoryId;
  const stored = ctx.repository.getMemory(memoryId);
  assert.equal(stored.status, "proposed");
  assert.equal(stored.source, "assistant_proposed");
});

// WP3.2 (§1.3 R-SES1) — mirrors the artifacts.* event-flow tests above.
test("memory.propose_save appends a durable memory_proposed event to the session log", async () => {
  const ctx = makeCtx();
  const result = await memoryProposeSave.execute(
    { kind: "instruction", content: "Always show token counts as tabular numbers." },
    ctx,
  );
  const memoryId = (result.modelContent as { memoryId: string }).memoryId;
  const events = ctx.repository.listEvents(ctx.sessionId);
  const proposed = events.find((e) => e.type === "memory_proposed");
  assert.ok(proposed, "expected a memory_proposed event");
  assert.equal(proposed?.type === "memory_proposed" && proposed.memoryId, memoryId);
  assert.equal(proposed?.type === "memory_proposed" && proposed.kind, "instruction");
  assert.equal(
    proposed?.type === "memory_proposed" && proposed.content,
    "Always show token counts as tabular numbers.",
  );
});

// ── mission.propose_plan (planner-only, validate + echo) ────────────────────────────────────────

test("mission.propose_plan validates against the shared hubMissionPlanSchema and echoes it back untouched", async () => {
  const ctx = makeCtx();
  const plan: HubMissionPlan = {
    topology: "parallel",
    autonomy: "always_ask",
    agents: [
      {
        key: "researcher",
        name: "Researcher",
        systemPrompt: "You research.",
        model: "test-model",
        toolGrants: { servers: {}, builtins: [] },
        skillIds: [],
        brief: "Find X",
        target: "Find X",
        expectedOutcome: "A summary of X",
      },
    ],
  };
  const result = await missionProposePlan.execute(plan, ctx);
  assert.deepEqual(result.modelContent, plan);
  assert.equal(result.artifact?.kind, "mission_plan");
});

test("mission.propose_plan does NOT create a hub_missions row (persistence is WP1.7's job)", async () => {
  const ctx = makeCtx();
  const plan: HubMissionPlan = { topology: "parallel", autonomy: "always_ask", agents: [] };
  await missionProposePlan.execute(plan, ctx);
  assert.equal(ctx.repository.getMissionBySession(ctx.sessionId), undefined);
});

test("mission.propose_plan rejects a malformed plan (safeExecuteBuiltin contains it)", async () => {
  const ctx = makeCtx();
  const result = await safeExecuteBuiltin(missionProposePlan, { topology: "not-a-real-topology" }, ctx);
  assert.equal(result.isError, true);
});

// ── tasks.{create,update,list} — event-sourced (R-SES4, no hub_tasks table) ────────────────────

/** Simulate the turn engine's GENERIC per-tool-call event persistence (tool_call + tool_result), the
 *  mechanism `reconstructTasks` reads back — see tasks.ts's module doc. */
function appendToolCallResult(
  repository: HubRepository,
  sessionId: string,
  toolCallId: string,
  toolName: string,
  args: unknown,
  modelContent: unknown,
  state: "output-available" | "output-error" | "output-denied" = "output-available",
): void {
  repository.appendEvent(sessionId, {
    type: "tool_call",
    part: {
      type: "tool_call",
      toolCallId,
      toolName,
      source: "builtin",
      state: "input-available",
      args,
    },
  });
  repository.appendEvent(sessionId, { type: "tool_result", toolCallId, state, modelContent });
}

test("tasks.create returns a fresh HubTaskItem (pending by default); tasks.list reconstructs it from the event log", async () => {
  const ctx = makeCtx();
  const created = await tasksCreate.execute({ title: "Write the report" }, ctx);
  const item = created.modelContent as { id: string; title: string; status: string };
  assert.equal(item.status, "pending");
  assert.equal(item.title, "Write the report");

  // Nothing is in the event log yet — tasks.create itself never appends (that's the ENGINE's generic
  // wrapper, simulated here).
  assert.deepEqual((await tasksList.execute({}, ctx)).modelContent, { tasks: [] });

  appendToolCallResult(ctx.repository, ctx.sessionId, "call-1", "tasks.create", { title: item.title }, item);
  const listed = (await tasksList.execute({}, ctx)).modelContent as { tasks: unknown[] };
  assert.deepEqual(listed.tasks, [item]);
});

test("tasks.update patches an existing task by id and preserves untouched fields", async () => {
  const ctx = makeCtx();
  const created = (await tasksCreate.execute({ title: "Ship it", dependsOn: ["x"] }, ctx))
    .modelContent as { id: string };
  appendToolCallResult(ctx.repository, ctx.sessionId, "call-1", "tasks.create", {}, created);

  const updated = await tasksUpdate.execute({ id: created.id, status: "in_progress" }, ctx);
  const item = updated.modelContent as { id: string; title: string; status: string; dependsOn?: string[] };
  assert.equal(item.status, "in_progress");
  assert.equal(item.title, "Ship it");
  assert.deepEqual(item.dependsOn, ["x"]);
});

test("tasks.update on an unknown id is isError, never a thrown exception", async () => {
  const ctx = makeCtx();
  const result = await tasksUpdate.execute({ id: "does-not-exist", status: "completed" }, ctx);
  assert.equal(result.isError, true);
  assert.match(result.errorText ?? "", /No task with id/);
});

test("reconstructTasks only folds output-available results; a denied/errored tasks.create never appears", () => {
  const ctx = makeCtx();
  appendToolCallResult(
    ctx.repository,
    ctx.sessionId,
    "call-1",
    "tasks.create",
    {},
    { id: "t1", title: "Ghost", status: "pending" },
    "output-denied",
  );
  const tasks = reconstructTasks(ctx.repository.listEvents(ctx.sessionId));
  assert.deepEqual(tasks, []);
});

test("reconstructTasks ignores tool_call/tool_result pairs from unrelated tools", () => {
  const ctx = makeCtx();
  appendToolCallResult(ctx.repository, ctx.sessionId, "call-1", "files.write", { path: "a" }, { path: "a", bytes: 1 });
  const tasks = reconstructTasks(ctx.repository.listEvents(ctx.sessionId));
  assert.deepEqual(tasks, []);
});

test("reconstructTasks preserves creation order across multiple tasks, last-write-wins per id on update", () => {
  const ctx = makeCtx();
  const first = { id: "t1", title: "First", status: "pending" as const };
  const second = { id: "t2", title: "Second", status: "pending" as const };
  appendToolCallResult(ctx.repository, ctx.sessionId, "c1", "tasks.create", {}, first);
  appendToolCallResult(ctx.repository, ctx.sessionId, "c2", "tasks.create", {}, second);
  appendToolCallResult(ctx.repository, ctx.sessionId, "c3", "tasks.update", {}, { ...first, status: "completed" });

  const tasks = reconstructTasks(ctx.repository.listEvents(ctx.sessionId));
  assert.equal(tasks.length, 2);
  assert.equal(tasks[0]?.id, "t1");
  assert.equal(tasks[0]?.status, "completed");
  assert.equal(tasks[1]?.id, "t2");
});

// ── HubAgentReport sanity (the structured contract this WP's mission plumbing echoes against) ────

test("HubAgentReport shape sanity — the report contract mission.propose_plan's neighbor plumbing assumes", () => {
  const report: HubAgentReport = {
    findings: [{ summary: "x" }],
    citations: [],
    artifacts: [],
    confidence: "medium",
    openQuestions: [],
  };
  assert.equal(report.confidence, "medium");
});

// ── assistant-hub v1-fixes (F3): mission.list / mission.report / artifacts.read ────────────────────

function minimalPlan(): HubMissionPlan {
  return {
    topology: "parallel",
    autonomy: "always_ask",
    agents: [
      {
        key: "regional",
        name: "regional",
        systemPrompt: "You are regional.",
        model: "assistant|t|a",
        toolGrants: { builtins: [], servers: {} },
        skillIds: [],
        brief: "Analyze regions.",
        target: "Regional picture",
        expectedOutcome: "A structured report.",
      },
    ],
  };
}

function minimalReport(): HubAgentReport {
  return {
    findings: [{ summary: "EU leads." }],
    citations: [],
    artifacts: [],
    confidence: "high",
    openQuestions: ["Why does EU lead?"],
  };
}

test("mission.list + mission.report expose a mission's agents and full reports from the event log", async () => {
  const repository = openRepo();
  const session = repository.createSession({ mode: "mission", model: "gpt-4o" });
  const ctx = makeCtx({ repository, sessionId: session.id });
  const mission = repository.createMission({
    sessionId: session.id,
    topology: "parallel",
    autonomy: "always_ask",
    plan: minimalPlan(),
  });
  repository.appendEvent(session.id, {
    type: "agent_spawned",
    missionId: mission.id,
    agentSessionId: "child-1",
    key: "regional",
    roleName: "regional-analyst",
    model: "assistant|t|a",
  });
  repository.appendEvent(session.id, {
    type: "agent_report",
    missionId: mission.id,
    agentSessionId: "child-1",
    report: minimalReport(),
  });
  repository.appendEvent(session.id, {
    type: "mission_followups",
    missionId: mission.id,
    followups: [{ question: "Why does EU lead?", agentSessionId: "child-1", roleName: "regional-analyst" }],
  });

  const list = await safeExecuteBuiltin(missionList, {}, ctx);
  assert.ok(!list.isError);
  const missions = list.modelContent as Array<{
    missionId: string;
    status: string;
    agents: Array<{ key: string; roleName: string; agentSessionId: string }>;
    followups: Array<{ question: string }>;
  }>;
  assert.equal(missions.length, 1);
  assert.equal(missions[0]?.missionId, mission.id);
  assert.equal(missions[0]?.agents[0]?.key, "regional");
  assert.equal(missions[0]?.followups[0]?.question, "Why does EU lead?");

  const all = await safeExecuteBuiltin(missionReport, {}, ctx);
  assert.ok(!all.isError);
  const reports = all.modelContent as Array<{
    agentSessionId: string;
    key?: string;
    roleName?: string;
    report: HubAgentReport;
  }>;
  assert.equal(reports.length, 1);
  assert.equal(reports[0]?.roleName, "regional-analyst");
  assert.equal(reports[0]?.report.findings[0]?.summary, "EU leads.");
  assert.deepEqual(reports[0]?.report.openQuestions, ["Why does EU lead?"]);

  const byKey = await safeExecuteBuiltin(missionReport, { key: "regional" }, ctx);
  assert.ok(!byKey.isError);
  assert.equal((byKey.modelContent as unknown[]).length, 1);

  const missingKey = await safeExecuteBuiltin(missionReport, { key: "nope" }, ctx);
  assert.equal(missingKey.isError, true);
  assert.match(missingKey.errorText ?? "", /Known keys: regional/);
});

test("mission.report with no missions is an honest isError, never a throw", async () => {
  const ctx = makeCtx();
  const result = await safeExecuteBuiltin(missionReport, {}, ctx);
  assert.equal(result.isError, true);
  assert.match(result.errorText ?? "", /No mission reports exist/);
});

test("artifacts.read lists this session's artifacts and reads current content; cross-session reads are refused", async () => {
  const repository = openRepo();
  const session = repository.createSession({ mode: "chat", model: "m" });
  const ctx = makeCtx({ repository, sessionId: session.id });
  await safeExecuteBuiltin(artifactsCreate, { kind: "markdown", title: "Report", content: "v1 body" }, ctx);

  const listRes = await safeExecuteBuiltin(artifactsRead, {}, ctx);
  assert.ok(!listRes.isError);
  const artifacts = listRes.modelContent as Array<{ artifactId: string; title: string; version: number }>;
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0]?.title, "Report");

  const read = await safeExecuteBuiltin(artifactsRead, { artifactId: artifacts[0]?.artifactId }, ctx);
  assert.ok(!read.isError);
  assert.equal((read.modelContent as { content: string }).content, "v1 body");

  const other = repository.createSession({ mode: "chat", model: "m" });
  const otherCtx = makeCtx({ repository, sessionId: other.id });
  const denied = await safeExecuteBuiltin(
    artifactsRead,
    { artifactId: artifacts[0]?.artifactId },
    otherCtx,
  );
  assert.equal(denied.isError, true);
  assert.match(denied.errorText ?? "", /different session/);
});
