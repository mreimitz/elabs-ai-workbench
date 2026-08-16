import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, test } from "node:test";
import type { AssistantContextEnvelope, AssistantEvent } from "@mcp-token-footprint/shared";
import { ASSISTANT_EDIT_SOURCE_REF } from "@mcp-token-footprint/shared";
import { AssistantRepository } from "../src/assistant/repository.js";
import {
  AssistantSessionManager,
  type AssistantSessionConfig,
} from "../src/assistant/session-manager.js";
import type {
  AgentSessionDriver,
  DriverEvent,
  DriverPermissionResult,
  DriverSession,
  DriverStartOptions,
  DriverUserMessage,
} from "../src/assistant/session-driver.js";
import {
  buildAssistantTools,
  buildAssistantToolDefinitions,
  type AssistantToolDeps,
} from "../src/assistant/tools/index.js";
import { skillWorkspaceDir, workspaceRootFor } from "../src/assistant/workspace.js";
import type { AppDatabase } from "../src/db/database.js";
import { ensureLocalCollection } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { CollectionRepository } from "../src/collections/repository.js";
import { GradeRepository } from "../src/grading/grade-repository.js";
import { ProviderRepository } from "../src/providers/repository.js";
import { ScanRepository } from "../src/scans/repository.js";
import { ServerRepository } from "../src/servers/repository.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { SkillRepository } from "../src/skills/repository.js";
import { SuiteRunRepository } from "../src/suites/suite-run-repository.js";
import { RunRepository } from "../src/testing/run-repository.js";
import { ScenarioRepository } from "../src/testing/scenario-repository.js";
import { TestRepository } from "../src/testing/test-repository.js";

// R1.1 (D-AS19) — the skill-workspace flow runs under the skill's own page scope: the workspace tools
// (skills_open/commit_workspace) are id-matched to this skill, and the native Edit/Write tools are the
// scope-exempt in-workspace edit mechanism (see session-manager's canUseTool guard).
const skillScope = (skillId: string): AssistantContextEnvelope => ({
  route: `/skills/${skillId}`,
  entityKind: "skill",
  entityId: skillId,
});

// Assistant (WP 2.2) — the skill-workspace edit loop wired end-to-end through the REAL session engine
// (AssistantSessionManager), the REAL permission classifier, and the REAL workspace tools, driven by a
// SCRIPTED FAKE driver (mirrors assistant-permission.test.ts's harness) so there is NO SDK, NO child
// process, NO Anthropic call — everything is offline. The one deliberate exception is filesystem I/O:
// the workspace lives under a REAL temp directory (local fs, not network — allowed by the ground
// rules), and a "native Edit tool" call is simulated exactly as it would behave for real: a raw
// `fs.writeFileSync` on the materialized file, nothing more.

// ── A tiny pushable async iterable (the fake's normalized event stream) — SDK-free ────────────────
class Pushable<T> implements AsyncIterable<T> {
  private readonly buffer: T[] = [];
  private readonly waiters: Array<(r: IteratorResult<T>) => void> = [];
  private ended = false;
  push(item: T): void {
    if (this.ended) return;
    const w = this.waiters.shift();
    if (w) w({ value: item, done: false });
    else this.buffer.push(item);
  }
  end(): void {
    if (this.ended) return;
    this.ended = true;
    let w = this.waiters.shift();
    while (w) {
      w({ value: undefined as unknown as T, done: true });
      w = this.waiters.shift();
    }
  }
  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const b = this.buffer.shift();
        if (b !== undefined) return Promise.resolve({ value: b, done: false });
        if (this.ended) return Promise.resolve({ value: undefined as unknown as T, done: true });
        return new Promise((resolve) => this.waiters.push(resolve));
      },
    };
  }
}

// ── The scripted fake driver — a script that can call the manager's canUseTool for a scripted tool ──
type ScriptCtx = {
  text: string;
  turn: number;
  emit: (event: DriverEvent) => void;
  /** Ask the manager's choke point about a tool exactly as the SDK would — resolves to its decision. */
  requestTool: (
    toolName: string,
    input: Record<string, unknown>,
  ) => Promise<DriverPermissionResult>;
};
type Script = (ctx: ScriptCtx) => void | Promise<void>;

class FakeSession implements DriverSession {
  private readonly out = new Pushable<DriverEvent>();
  readonly startOptions: DriverStartOptions;
  private turn = 0;
  constructor(
    options: DriverStartOptions,
    private readonly script: Script,
    private readonly sid: string,
  ) {
    this.startOptions = options;
    this.out.push({ type: "session", sessionId: sid });
    options.abortController.signal.addEventListener("abort", () => this.out.end(), { once: true });
  }
  get events(): AsyncIterable<DriverEvent> {
    return this.out;
  }
  send(message: DriverUserMessage): void {
    const turn = this.turn++;
    void this.script({
      text: message.text,
      turn,
      emit: (event) => this.out.push(event),
      requestTool: (toolName, input) => {
        const canUse = this.startOptions.canUseTool;
        if (!canUse) throw new Error("the manager wired no canUseTool onto the session");
        return canUse({
          toolName,
          input,
          toolUseId: `tu-${toolName}-${Math.random()}`,
          signal: this.startOptions.abortController.signal,
        });
      },
    });
  }
  async interrupt(): Promise<void> {
    this.out.push({ type: "turn_done" });
  }
  sessionId(): string | undefined {
    return this.sid;
  }
}

class FakeDriver implements AgentSessionDriver {
  readonly starts: FakeSession[] = [];
  private counter = 0;
  constructor(private readonly script: Script) {}
  start(options: DriverStartOptions): DriverSession {
    const session = new FakeSession(options, this.script, `sdk-sess-${++this.counter}`);
    this.starts.push(session);
    return session;
  }
}

// ── Harness ───────────────────────────────────────────────────────────────────────────────────────
const databases: AppDatabase[] = [];
const dirs: string[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function createDatabase(): AppDatabase {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  ensureLocalCollection(db);
  databases.push(db);
  return db;
}

function tmpDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-assistant-ws-e2e-"));
  dirs.push(dir);
  return dir;
}

const SKILL_MD_V1 = "---\nname: pdf-tools\ndescription: Work with PDFs\n---\nOriginal body.";

type Harness = {
  repo: AssistantRepository;
  manager: AssistantSessionManager;
  driver: FakeDriver;
  skills: SkillRepository;
  skillId: string;
  versionId: string;
  dataDir: string;
  /** The REAL tool definitions the last-started session's `buildTools` produced — lets the script
   *  invoke a tool's `.handler()` exactly as the SDK would, after `canUseTool` allows it. */
  capturedDefs: () => ReturnType<typeof buildAssistantToolDefinitions>;
};

function makeHarness(
  script: Script,
  configOverrides: Partial<AssistantSessionConfig> = {},
): Harness {
  const db = createDatabase();
  const secrets = new SecretStore(Buffer.alloc(32, 7));
  const repo = new AssistantRepository(db, secrets);
  const providers = new ProviderRepository(db, secrets);
  repo.createCredential({ kind: "claude_oauth", token: "sk-ant-oat01-testtoken1234" });

  const skills = new SkillRepository(db, secrets);
  const skill = skills.create({
    name: "pdf-tools",
    sourceType: "upload",
    description: "Work with PDFs",
  });
  const v1 = skills.createVersion(
    skill.id,
    [{ path: "SKILL.md", bytes: Buffer.from(SKILL_MD_V1, "utf8") }],
    {
      sourceKind: "upload",
      importedFrom: "upload",
      manifest: { name: "pdf-tools", description: "Work with PDFs" },
    },
  );
  if (v1.unchanged) throw new Error("fixture setup expected a fresh version");

  const dataDir = tmpDataDir();
  const baseDeps: Omit<AssistantToolDeps, "threadId"> = {
    runs: new RunRepository(db),
    suiteRuns: new SuiteRunRepository(db),
    grades: new GradeRepository(db),
    skills,
    scans: new ScanRepository(db),
    servers: new ServerRepository(db, secrets),
    tests: new TestRepository(db),
    environments: new ScenarioRepository(db),
    collections: new CollectionRepository(db, secrets),
    // model-identity WP3.3 — the Hub read tools' credential store (this fixture only drives the skill
    // workspace tools; reusing the manager's own `providers` keeps the bag honest).
    providers,
    assistantDataDir: dataDir,
  };

  let lastDefs: ReturnType<typeof buildAssistantToolDefinitions> | null = null;
  const driver = new FakeDriver(script);
  const manager = new AssistantSessionManager({
    repository: repo,
    providers,
    driver,
    // Mirrors the REAL index.ts wiring exactly (buildAssistantTools({...assistantToolDeps, threadId})),
    // plus capturing the raw definitions so the script can invoke a tool's handler directly (the
    // FakeDriver never dispatches through a real MCP server — that's the one thing it can't do).
    buildTools: (ctx) => {
      const fullDeps: AssistantToolDeps = { ...baseDeps, threadId: ctx.threadId };
      lastDefs = buildAssistantToolDefinitions(fullDeps);
      return buildAssistantTools(fullDeps);
    },
    config: {
      maxTurns: 50,
      idleTimeoutMs: 60_000,
      maxActiveSessions: 2,
      assistantDataDir: dataDir,
      permissionTimeoutMs: 300_000,
      // R2.2 — keep pre-R2 warm-session behavior for this workspace e2e (a long grace keeps the child
      // live across the multi-step tool flow); title one-shot off so it never perturbs start counts.
      releaseGraceMs: 60_000,
      autoTitle: false,
      titleModel: "claude-haiku-4-5",
      titleTimeoutMs: 15_000,
      ...configOverrides,
    },
  });

  return {
    repo,
    manager,
    driver,
    skills,
    skillId: skill.id,
    versionId: v1.version.id,
    dataDir,
    capturedDefs: () => {
      if (!lastDefs)
        throw new Error("no session has started yet — capturedDefs() called too early");
      return lastDefs;
    },
  };
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) await delay(5);
  if (!predicate()) throw new Error("waitFor timed out");
}

function eventsOfType<T extends AssistantEvent["type"]>(
  events: AssistantEvent[],
  type: T,
): Array<Extract<AssistantEvent, { type: T }>> {
  return events.filter((e) => e.type === type) as Array<Extract<AssistantEvent, { type: T }>>;
}

/** Call a real tool handler (as captured off `buildTools`) and return its parsed JSON result. */
async function invokeTool(
  defs: ReturnType<typeof buildAssistantToolDefinitions>,
  bareName: string,
  args: Record<string, unknown>,
): Promise<{ parsed: unknown; isError: boolean }> {
  const def = defs.find((d) => d.name === bareName);
  if (!def) throw new Error(`no tool named "${bareName}"`);
  const result = await def.handler(args as never, {});
  const block = result.content[0] as { type: "text"; text: string };
  return { parsed: JSON.parse(block.text), isError: result.isError === true };
}

// ── The acceptance-centerpiece E2E conversation ─────────────────────────────────────────────────────
// "analyze runs → open workspace → edit a skill file → (approve) → commit → new version", asserted
// end-to-end: every permission ask/decision + tool_call/tool_result event, AND the resulting version.

test("E2E: analyze runs, open a skill workspace, edit SKILL.md via a native tool, approve, commit → new version", async () => {
  let editedWorkspacePath: string | undefined;
  let newVersionId: string | undefined;

  const script: Script = async ({ emit, turn, requestTool }) => {
    // 1. "Analyze runs" — a WP 1.2 READ tool. Auto-allows transparently (no permission_request).
    const readDecision = await requestTool("mcp__assistant-app__runs_list", {});
    assert.equal(readDecision.behavior, "allow", "a read tool is never denied by the classifier");
    emit({
      type: "tool_call",
      toolUseId: "tu-runs",
      toolName: "mcp__assistant-app__runs_list",
      input: {},
    });
    emit({
      type: "tool_result",
      toolUseId: "tu-runs",
      result: { runs: [], total: 0 },
      isError: false,
    });

    // 2. Open the skill workspace — a WP 2.2 app-data WRITE tool. Gated: parks until the test decides it.
    const openDecision = await requestTool("mcp__assistant-app__skills_open_workspace", {
      skillId: h.skillId,
    });
    assert.equal(openDecision.behavior, "allow", "the test approves the open");
    const opened = await invokeTool(h.capturedDefs(), "skills_open_workspace", {
      skillId: h.skillId,
    });
    emit({
      type: "tool_call",
      toolUseId: "tu-open",
      toolName: "mcp__assistant-app__skills_open_workspace",
      input: { skillId: h.skillId },
    });
    emit({
      type: "tool_result",
      toolUseId: "tu-open",
      result: opened.parsed,
      isError: opened.isError,
    });
    editedWorkspacePath = (opened.parsed as { workspacePath: string }).workspacePath;

    // 3. Edit SKILL.md with the native Edit tool. Gated the SAME way (an ordinary create/update write).
    // Simulating the native tool means doing exactly what it does at the SDK level: a real fs write —
    // no in-process MCP tool backs "Edit", so there is no handler to invoke, only the side effect.
    const editDecision = await requestTool("Edit", {
      file_path: `${editedWorkspacePath}/SKILL.md`,
      old_string: "Original body.",
      new_string: "Edited by the agent.",
    });
    assert.equal(editDecision.behavior, "allow", "the test approves the edit");
    fs.writeFileSync(
      `${editedWorkspacePath}/SKILL.md`,
      "---\nname: pdf-tools\ndescription: Work with PDFs\n---\nEdited by the agent.",
    );
    emit({
      type: "tool_call",
      toolUseId: "tu-edit",
      toolName: "Edit",
      input: { file_path: `${editedWorkspacePath}/SKILL.md` },
    });
    emit({ type: "tool_result", toolUseId: "tu-edit", result: { success: true }, isError: false });

    // 4. Commit the workspace — a WP 2.2 app-data WRITE tool. Gated again.
    const commitDecision = await requestTool("mcp__assistant-app__skills_commit_workspace", {
      skillId: h.skillId,
      note: "assistant edit",
    });
    assert.equal(commitDecision.behavior, "allow", "the test approves the commit");
    const committed = await invokeTool(h.capturedDefs(), "skills_commit_workspace", {
      skillId: h.skillId,
      note: "assistant edit",
    });
    emit({
      type: "tool_call",
      toolUseId: "tu-commit",
      toolName: "mcp__assistant-app__skills_commit_workspace",
      input: { skillId: h.skillId },
    });
    emit({
      type: "tool_result",
      toolUseId: "tu-commit",
      result: committed.parsed,
      isError: committed.isError,
    });
    newVersionId = (committed.parsed as { versionId: string }).versionId;

    emit({
      type: "assistant_message",
      text: "Analyzed the runs, edited pdf-tools, and committed a new version.",
    });
    emit({ type: "turn_done", turnIndex: turn });
  };

  const h = makeHarness(script);
  const thread = h.manager.createThread({});
  await h.manager.sendMessage(
    thread.id,
    "Analyze recent runs, then edit the pdf-tools skill and commit a new version.",
    skillScope(h.skillId),
  );

  // Approve the three gated writes IN ORDER as each permission_request lands (open → Edit → commit —
  // the script awaits each requestTool() call before issuing the next), mirroring how the owner
  // actually interacts with the dock: one Allow click per card, in sequence.
  for (let i = 0; i < 3; i += 1) {
    await waitFor(() => {
      const requests = eventsOfType(h.repo.listEvents(thread.id), "permission_request");
      const decisions = eventsOfType(h.repo.listEvents(thread.id), "permission_decision");
      return requests.length === i + 1 && decisions.length === i;
    });
    const pending = eventsOfType(h.repo.listEvents(thread.id), "permission_request")[i]!;
    h.manager.decidePermission(thread.id, { requestId: pending.requestId, behavior: "allow" });
  }

  await waitFor(() => h.repo.listEvents(thread.id).some((e) => e.type === "turn_done"));

  // ── Assert the FULL event trail ──────────────────────────────────────────────────────────────────
  const events = h.repo.listEvents(thread.id);
  const requests = eventsOfType(events, "permission_request");
  const decisions = eventsOfType(events, "permission_decision");
  assert.equal(requests.length, 3, "three gated writes asked: open, Edit, commit");
  assert.deepEqual(
    requests.map((r) => r.toolName),
    ["skills_open_workspace", "Edit", "skills_commit_workspace"],
    "asked in the order the agent actually issued them",
  );
  assert.equal(decisions.length, 3);
  assert.ok(
    decisions.every((d) => d.behavior === "allow"),
    "all three approvals landed",
  );

  const calls = eventsOfType(events, "tool_call");
  assert.equal(calls.length, 4, "read (auto-allow) + open + Edit + commit");
  assert.equal(eventsOfType(events, "tool_result").length, 4);
  assert.ok(!eventsOfType(events, "tool_result").some((r) => r.isError), "nothing errored");

  // ── Assert the RESULTING skill version ───────────────────────────────────────────────────────────
  assert.ok(newVersionId, "a new version id was captured from the commit result");
  assert.notEqual(newVersionId, h.versionId, "a genuinely NEW version");
  const newVersion = h.skills.getVersion(newVersionId!);
  assert.equal(newVersion.sourceRef, ASSISTANT_EDIT_SOURCE_REF);
  const files = h.skills.getVersionFiles(newVersionId!);
  assert.equal(
    files.find((f) => f.path === "SKILL.md")?.bytes.toString("utf8"),
    "---\nname: pdf-tools\ndescription: Work with PDFs\n---\nEdited by the agent.",
  );

  // The skill's workspace directory was cleaned up on the successful commit (D-AS13 lifecycle).
  assert.equal(
    fs.existsSync(skillWorkspaceDir(workspaceRootFor(h.dataDir, thread.id), h.skillId)),
    false,
  );
});

// ── Session wiring + lifecycle ──────────────────────────────────────────────────────────────────────

test("additionalDirectories is wired to the thread's workspace root on session start", async () => {
  const script: Script = ({ emit, turn }) => {
    emit({ type: "assistant_message", text: "ok" });
    emit({ type: "turn_done", turnIndex: turn });
  };
  const h = makeHarness(script);
  const thread = h.manager.createThread({});
  await h.manager.sendMessage(thread.id, "hi");
  await waitFor(() => h.repo.listEvents(thread.id).some((e) => e.type === "turn_done"));

  const startOptions = h.driver.starts[0]?.startOptions;
  assert.deepEqual(startOptions?.additionalDirectories, [workspaceRootFor(h.dataDir, thread.id)]);
});

test("park after idle → resume: an open workspace's edited tree survives the park (real fs, unaffected by killing the child)", async () => {
  const script: Script = async ({ emit, turn, requestTool }) => {
    const decision = await requestTool("mcp__assistant-app__skills_open_workspace", {
      skillId: h.skillId,
    });
    if (decision.behavior === "allow") {
      await invokeTool(h.capturedDefs(), "skills_open_workspace", { skillId: h.skillId });
    }
    emit({ type: "assistant_message", text: "opened" });
    emit({ type: "turn_done", turnIndex: turn });
  };
  const h = makeHarness(script, { idleTimeoutMs: 30 });
  const thread = h.manager.createThread({});

  await h.manager.sendMessage(thread.id, "open the workspace", skillScope(h.skillId));
  await waitFor(
    () => eventsOfType(h.repo.listEvents(thread.id), "permission_request").length === 1,
  );
  h.manager.decidePermission(thread.id, {
    requestId: eventsOfType(h.repo.listEvents(thread.id), "permission_request")[0]!.requestId,
    behavior: "allow",
  });
  await waitFor(() => h.repo.listEvents(thread.id).some((e) => e.type === "turn_done"));

  const root = workspaceRootFor(h.dataDir, thread.id);
  const skillMdPath = path.join(skillWorkspaceDir(root, h.skillId), "SKILL.md");
  fs.writeFileSync(skillMdPath, "a DIRTY, uncommitted edit");

  // Idle-park: the child is killed, but the workspace lives on the real fs, untouched.
  await waitFor(() => !h.manager.isLive(thread.id));
  assert.equal(
    fs.readFileSync(skillMdPath, "utf8"),
    "a DIRTY, uncommitted edit",
    "the dirty tree survives the park",
  );

  // Resume with a second message — a NEW child starts, but additionalDirectories points at the SAME
  // root (workspaceRootFor is deterministic per threadId), so the dirty file is still reachable.
  await h.manager.sendMessage(thread.id, "still there?", skillScope(h.skillId));
  await waitFor(() => h.driver.starts.length === 2);
  assert.deepEqual(h.driver.starts[1]?.startOptions.additionalDirectories, [root]);
  assert.equal(
    fs.readFileSync(skillMdPath, "utf8"),
    "a DIRTY, uncommitted edit",
    "still dirty after resume — nothing reset it",
  );
});

test("thread delete cleans up the ENTIRE workspace (every skill it ever opened)", async () => {
  const script: Script = async ({ emit, turn, requestTool }) => {
    const decision = await requestTool("mcp__assistant-app__skills_open_workspace", {
      skillId: h.skillId,
    });
    if (decision.behavior === "allow") {
      await invokeTool(h.capturedDefs(), "skills_open_workspace", { skillId: h.skillId });
    }
    emit({ type: "assistant_message", text: "opened" });
    emit({ type: "turn_done", turnIndex: turn });
  };
  const h = makeHarness(script);
  const thread = h.manager.createThread({});
  await h.manager.sendMessage(thread.id, "open the workspace", skillScope(h.skillId));
  await waitFor(
    () => eventsOfType(h.repo.listEvents(thread.id), "permission_request").length === 1,
  );
  h.manager.decidePermission(thread.id, {
    requestId: eventsOfType(h.repo.listEvents(thread.id), "permission_request")[0]!.requestId,
    behavior: "allow",
  });
  await waitFor(() => h.repo.listEvents(thread.id).some((e) => e.type === "turn_done"));

  const root = workspaceRootFor(h.dataDir, thread.id);
  assert.ok(
    fs.existsSync(skillWorkspaceDir(root, h.skillId)),
    "the workspace was actually materialized",
  );

  h.manager.deleteThread(thread.id);
  assert.equal(fs.existsSync(root), false, "the entire thread workspace root is gone");
});
