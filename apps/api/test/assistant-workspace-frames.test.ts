import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, test } from "node:test";
import type { AssistantStreamFrame } from "@mcp-token-footprint/shared";
import { AssistantRepository } from "../src/assistant/repository.js";
import {
  AssistantSessionManager,
  threadScratchDir,
  type AssistantSessionConfig,
} from "../src/assistant/session-manager.js";
import type {
  AgentSessionDriver,
  DriverEvent,
  DriverSession,
  DriverStartOptions,
  DriverUserMessage,
} from "../src/assistant/session-driver.js";
import {
  materializeWorkspace,
  skillWorkspaceDir,
  workspaceRootFor,
} from "../src/assistant/workspace.js";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { ProviderRepository } from "../src/providers/repository.js";
import { SecretStore } from "../src/secrets/secret-store.js";

// Assistant R1.3 (D-AS22) — the three TRANSIENT skill-workspace progress frames the pump fans
// (`session-manager.ts`'s `tool_call`/`tool_result` cases + `fanWorkspaceFrame`), exercised entirely
// through a SCRIPTED FAKE driver (mirrors `assistant-session.test.ts`) — NO SDK, NO child, NO Anthropic
// call. The one deliberate exception is filesystem I/O for the native-write correlation tests: a "native
// Edit/Write tool call" is simulated exactly as it behaves at the SDK level (a real `file_path` the pump
// checks with `fs.existsSync`), against a REAL temp directory (local fs, not network — allowed by the
// ground rules).

// ── A tiny pushable async iterable (the fake's normalized event stream) — SDK-free, mirrors the other
// assistant test files exactly. ──────────────────────────────────────────────────────────────────────
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

type TurnScript = (ctx: { text: string; turn: number; emit: (event: DriverEvent) => void }) => void;

class FakeSession implements DriverSession {
  private readonly out = new Pushable<DriverEvent>();
  private turn = 0;
  constructor(
    options: DriverStartOptions,
    private readonly script: TurnScript,
    private readonly sid: string,
  ) {
    this.out.push({ type: "session", sessionId: sid });
    options.abortController.signal.addEventListener("abort", () => this.out.end(), { once: true });
  }
  get events(): AsyncIterable<DriverEvent> {
    return this.out;
  }
  send(message: DriverUserMessage): void {
    const turn = this.turn++;
    this.script({ text: message.text, turn, emit: (event) => this.out.push(event) });
  }
  async interrupt(): Promise<void> {
    this.out.push({ type: "turn_done" });
  }
  sessionId(): string | undefined {
    return this.sid;
  }
}

class FakeDriver implements AgentSessionDriver {
  private counter = 0;
  constructor(private readonly script: TurnScript) {}
  start(options: DriverStartOptions): DriverSession {
    return new FakeSession(options, this.script, `sdk-sess-${++this.counter}`);
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
  databases.push(db);
  return db;
}

function tmpDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-assistant-ws-frames-"));
  dirs.push(dir);
  return dir;
}

type Harness = { repo: AssistantRepository; manager: AssistantSessionManager; dataDir: string };

function makeHarness(
  script: TurnScript,
  configOverrides: Partial<AssistantSessionConfig> = {},
): Harness {
  const db = createDatabase();
  const secrets = new SecretStore(Buffer.alloc(32, 7));
  const repo = new AssistantRepository(db, secrets);
  const providers = new ProviderRepository(db, secrets);
  repo.createCredential({ kind: "claude_oauth", token: "sk-ant-oat01-testtoken1234" });

  const dataDir = tmpDataDir();
  const manager = new AssistantSessionManager({
    repository: repo,
    providers,
    driver: new FakeDriver(script),
    buildTools: () => ({}), // SDK-free stub tool server; the fake driver never dispatches through it
    config: {
      maxTurns: 50,
      idleTimeoutMs: 60_000,
      maxActiveSessions: 2,
      assistantDataDir: dataDir,
      permissionTimeoutMs: 300_000,
      // R2.2 (D-AS25/D-AS26) required fields — release-on-reply SYNCHRONOUSLY (grace 0, the production
      // default) so the frame-vs-release ordering is exercised on the real sync-park path, not the timer.
      releaseGraceMs: 0,
      autoTitle: false,
      titleModel: "claude-haiku-4-5",
      titleTimeoutMs: 15_000,
      ...configOverrides,
    },
  });
  return { repo, manager, dataDir };
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) await delay(5);
  if (!predicate()) throw new Error("waitFor timed out");
}

/** Collect every LIVE frame (settled + transient) a thread's channel fans, from right after this call. */
function collectFrames(h: Harness, threadId: string): AssistantStreamFrame[] {
  const frames: AssistantStreamFrame[] = [];
  h.manager.subscribe(threadId, (frame) => frames.push(frame));
  return frames;
}

/** Wrap a JS value as the MCP `CallToolResult.content` shape a `jsonResult(...)`-built tool produces —
 *  the exact shape `DriverEvent.tool_result.result` carries for a real tool call (see `tools/util.ts`). */
function jsonToolResult(value: unknown): unknown {
  return [{ type: "text", text: JSON.stringify(value) }];
}

// ── skills_open_workspace → workspace_opened ────────────────────────────────────────────────────────

test("a successful skills_open_workspace tool result fans a TRANSIENT workspace_opened frame (never persisted)", async () => {
  const script: TurnScript = ({ emit, turn }) => {
    emit({
      type: "tool_call",
      toolUseId: "tu-open",
      toolName: "skills_open_workspace",
      input: { skillId: "skill-a" },
    });
    emit({
      type: "tool_result",
      toolUseId: "tu-open",
      result: jsonToolResult({
        skillId: "skill-a",
        versionId: "v1",
        versionLabel: "v1",
        workspacePath: "/does/not/matter",
        files: [
          { path: "SKILL.md", size: 42, isBinary: false },
          { path: "assets/logo.png", size: 128, isBinary: true },
        ],
        fileCount: 2,
      }),
      isError: false,
    });
    emit({ type: "assistant_message", text: "Opened it." });
    emit({ type: "turn_done", turnIndex: turn });
  };
  const h = makeHarness(script);
  const thread = h.manager.createThread({});
  const frames = collectFrames(h, thread.id);

  await h.manager.sendMessage(thread.id, "open skill-a");
  await waitFor(() => frames.some((f) => f.type === "turn_done"));

  const opened = frames.find((f) => f.type === "workspace_opened");
  assert.ok(opened, "a workspace_opened frame was fanned");
  assert.deepEqual(opened, {
    type: "workspace_opened",
    skillId: "skill-a",
    versionId: "v1",
    // isBinary is deliberately stripped — the frame carries the SLIM {path,size} shape only.
    files: [
      { path: "SKILL.md", size: 42 },
      { path: "assets/logo.png", size: 128 },
    ],
  });

  // Never persisted: no seq, not in the durable replay log, not a member of AssistantEvent.
  assert.equal((opened as { seq?: number }).seq, undefined);
  assert.ok(
    !h.repo.listEvents(thread.id).some((e) => (e.type as string) === "workspace_opened"),
    "workspace_opened never lands in the persisted event log",
  );
});

// ── skills_commit_workspace → workspace_committed (and the unchanged dedup path) ───────────────────

test("a successful skills_commit_workspace tool result (a genuinely new version) fans workspace_committed", async () => {
  const script: TurnScript = ({ emit, turn }) => {
    emit({
      type: "tool_call",
      toolUseId: "tu-commit",
      toolName: "skills_commit_workspace",
      input: { skillId: "skill-a" },
    });
    emit({
      type: "tool_result",
      toolUseId: "tu-commit",
      result: jsonToolResult({
        unchanged: false,
        skillId: "skill-a",
        versionId: "v2",
        versionLabel: "v2",
        skillLink: "/skills/skill-a",
      }),
      isError: false,
    });
    emit({ type: "assistant_message", text: "Committed." });
    emit({ type: "turn_done", turnIndex: turn });
  };
  const h = makeHarness(script);
  const thread = h.manager.createThread({});
  const frames = collectFrames(h, thread.id);

  await h.manager.sendMessage(thread.id, "commit it");
  await waitFor(() => frames.some((f) => f.type === "turn_done"));

  const committed = frames.find((f) => f.type === "workspace_committed");
  assert.deepEqual(committed, { type: "workspace_committed", skillId: "skill-a", versionId: "v2" });
});

test("an unchanged: true commit result fans NOTHING — no new version to announce", async () => {
  const script: TurnScript = ({ emit, turn }) => {
    emit({
      type: "tool_call",
      toolUseId: "tu-commit-nc",
      toolName: "skills_commit_workspace",
      input: { skillId: "skill-a" },
    });
    emit({
      type: "tool_result",
      toolUseId: "tu-commit-nc",
      result: jsonToolResult({
        unchanged: true,
        skillId: "skill-a",
        versionId: "v1",
        message: "No changes to commit — the workspace tree matches the current skill version.",
      }),
      isError: false,
    });
    emit({ type: "assistant_message", text: "Nothing changed." });
    emit({ type: "turn_done", turnIndex: turn });
  };
  const h = makeHarness(script);
  const thread = h.manager.createThread({});
  const frames = collectFrames(h, thread.id);

  await h.manager.sendMessage(thread.id, "commit it");
  await waitFor(() => frames.some((f) => f.type === "turn_done"));

  assert.ok(
    !frames.some((f) => f.type === "workspace_committed"),
    "no workspace_committed for the dedup path",
  );
});

test("a FAILED skills_open_workspace / skills_commit_workspace result fans nothing", async () => {
  const script: TurnScript = ({ emit, turn }) => {
    emit({
      type: "tool_call",
      toolUseId: "tu-open-err",
      toolName: "skills_open_workspace",
      input: { skillId: "nope" },
    });
    emit({
      type: "tool_result",
      toolUseId: "tu-open-err",
      result: jsonToolResult({ error: 'Skill "nope" not found.' }),
      isError: true,
    });
    emit({
      type: "tool_call",
      toolUseId: "tu-commit-err",
      toolName: "skills_commit_workspace",
      input: { skillId: "nope" },
    });
    emit({
      type: "tool_result",
      toolUseId: "tu-commit-err",
      result: jsonToolResult({ error: "No open workspace." }),
      isError: true,
    });
    emit({ type: "turn_done", turnIndex: turn });
  };
  const h = makeHarness(script);
  const thread = h.manager.createThread({});
  const frames = collectFrames(h, thread.id);

  await h.manager.sendMessage(thread.id, "open nope");
  await waitFor(() => frames.some((f) => f.type === "turn_done"));

  assert.ok(!frames.some((f) => f.type === "workspace_opened" || f.type === "workspace_committed"));
});

// ── Native Edit/Write/MultiEdit correlation → workspace_file_changed ────────────────────────────────

test("a successful native Edit on an EXISTING workspace file fans workspace_file_changed with changeKind modified", async () => {
  let filePath = "";
  const script: TurnScript = ({ emit, turn }) => {
    emit({
      type: "tool_call",
      toolUseId: "tu-edit",
      toolName: "Edit",
      input: { file_path: filePath, old_string: "a", new_string: "b" },
    });
    emit({
      type: "tool_result",
      toolUseId: "tu-edit",
      result: [{ type: "text", text: "ok" }],
      isError: false,
    });
    emit({ type: "assistant_message", text: "Edited." });
    emit({ type: "turn_done", turnIndex: turn });
  };
  const h = makeHarness(script);
  const thread = h.manager.createThread({});
  const root = workspaceRootFor(h.dataDir, thread.id);
  materializeWorkspace(root, "skill-a", [
    { path: "SKILL.md", bytes: Buffer.from("original", "utf8") },
  ]);
  filePath = path.join(skillWorkspaceDir(root, "skill-a"), "SKILL.md");

  const frames = collectFrames(h, thread.id);
  await h.manager.sendMessage(thread.id, "edit SKILL.md");
  await waitFor(() => frames.some((f) => f.type === "turn_done"));

  const changed = frames.find((f) => f.type === "workspace_file_changed");
  assert.deepEqual(changed, {
    type: "workspace_file_changed",
    skillId: "skill-a",
    path: "SKILL.md",
    changeKind: "modified",
  });
});

test("a successful native Write for a file that did NOT exist yet fans changeKind created", async () => {
  let filePath = "";
  const script: TurnScript = ({ emit, turn }) => {
    emit({
      type: "tool_call",
      toolUseId: "tu-write",
      toolName: "Write",
      input: { file_path: filePath, content: "brand new" },
    });
    emit({
      type: "tool_result",
      toolUseId: "tu-write",
      result: [{ type: "text", text: "ok" }],
      isError: false,
    });
    emit({ type: "turn_done", turnIndex: turn });
  };
  const h = makeHarness(script);
  const thread = h.manager.createThread({});
  const root = workspaceRootFor(h.dataDir, thread.id);
  materializeWorkspace(root, "skill-a", [
    { path: "SKILL.md", bytes: Buffer.from("original", "utf8") },
  ]);
  // A NEW file, one directory deep — never materialized, so it does not exist on disk yet.
  filePath = path.join(skillWorkspaceDir(root, "skill-a"), "references", "NEW.md");

  const frames = collectFrames(h, thread.id);
  await h.manager.sendMessage(thread.id, "write a new reference file");
  await waitFor(() => frames.some((f) => f.type === "turn_done"));

  const changed = frames.find((f) => f.type === "workspace_file_changed");
  assert.deepEqual(changed, {
    type: "workspace_file_changed",
    skillId: "skill-a",
    path: "references/NEW.md",
    changeKind: "created",
  });
});

test("a native write OUTSIDE the thread's workspace root (the scratch cwd) fans nothing", async () => {
  let filePath = "";
  const script: TurnScript = ({ emit, turn }) => {
    emit({
      type: "tool_call",
      toolUseId: "tu-scratch",
      toolName: "Write",
      input: { file_path: filePath, content: "scratch note" },
    });
    emit({
      type: "tool_result",
      toolUseId: "tu-scratch",
      result: [{ type: "text", text: "ok" }],
      isError: false,
    });
    emit({ type: "turn_done", turnIndex: turn });
  };
  const h = makeHarness(script);
  const thread = h.manager.createThread({});
  // A write in the session's OWN scratch cwd (a sibling of the workspace root) — never a skill edit.
  filePath = path.join(threadScratchDir(h.dataDir, thread.id), "notes.txt");

  const frames = collectFrames(h, thread.id);
  await h.manager.sendMessage(thread.id, "jot a note");
  await waitFor(() => frames.some((f) => f.type === "turn_done"));

  assert.ok(
    !frames.some((f) => f.type === "workspace_file_changed"),
    "a scratch-cwd write is not a skill-workspace edit",
  );
});

test("a FAILED native Edit inside the workspace fans nothing, even though the path would otherwise match", async () => {
  let filePath = "";
  const script: TurnScript = ({ emit, turn }) => {
    emit({
      type: "tool_call",
      toolUseId: "tu-edit-err",
      toolName: "Edit",
      input: { file_path: filePath, old_string: "nope", new_string: "x" },
    });
    emit({
      type: "tool_result",
      toolUseId: "tu-edit-err",
      result: [{ type: "text", text: JSON.stringify({ error: "old_string not found" }) }],
      isError: true,
    });
    emit({ type: "turn_done", turnIndex: turn });
  };
  const h = makeHarness(script);
  const thread = h.manager.createThread({});
  const root = workspaceRootFor(h.dataDir, thread.id);
  materializeWorkspace(root, "skill-a", [
    { path: "SKILL.md", bytes: Buffer.from("original", "utf8") },
  ]);
  filePath = path.join(skillWorkspaceDir(root, "skill-a"), "SKILL.md");

  const frames = collectFrames(h, thread.id);
  await h.manager.sendMessage(thread.id, "edit SKILL.md badly");
  await waitFor(() => frames.some((f) => f.type === "turn_done"));

  assert.ok(
    !frames.some((f) => f.type === "workspace_file_changed"),
    "a failed edit never fans a change frame",
  );
});

test("MultiEdit is correlated the SAME way as Edit/Write (bare-name membership in ASSISTANT_NATIVE_WRITE_TOOL_NAMES)", async () => {
  let filePath = "";
  const script: TurnScript = ({ emit, turn }) => {
    emit({
      type: "tool_call",
      toolUseId: "tu-multi",
      toolName: "MultiEdit",
      input: { file_path: filePath, edits: [{ old_string: "a", new_string: "b" }] },
    });
    emit({
      type: "tool_result",
      toolUseId: "tu-multi",
      result: [{ type: "text", text: "ok" }],
      isError: false,
    });
    emit({ type: "turn_done", turnIndex: turn });
  };
  const h = makeHarness(script);
  const thread = h.manager.createThread({});
  const root = workspaceRootFor(h.dataDir, thread.id);
  materializeWorkspace(root, "skill-a", [
    { path: "SKILL.md", bytes: Buffer.from("original", "utf8") },
  ]);
  filePath = path.join(skillWorkspaceDir(root, "skill-a"), "SKILL.md");

  const frames = collectFrames(h, thread.id);
  await h.manager.sendMessage(thread.id, "multi-edit SKILL.md");
  await waitFor(() => frames.some((f) => f.type === "turn_done"));

  const changed = frames.find((f) => f.type === "workspace_file_changed");
  assert.deepEqual(changed, {
    type: "workspace_file_changed",
    skillId: "skill-a",
    path: "SKILL.md",
    changeKind: "modified",
  });
});

test("a non-write native tool (Read) never fans workspace_file_changed, even with a file_path input", async () => {
  let filePath = "";
  const script: TurnScript = ({ emit, turn }) => {
    emit({
      type: "tool_call",
      toolUseId: "tu-read",
      toolName: "Read",
      input: { file_path: filePath },
    });
    emit({
      type: "tool_result",
      toolUseId: "tu-read",
      result: [{ type: "text", text: "file contents" }],
      isError: false,
    });
    emit({ type: "turn_done", turnIndex: turn });
  };
  const h = makeHarness(script);
  const thread = h.manager.createThread({});
  const root = workspaceRootFor(h.dataDir, thread.id);
  materializeWorkspace(root, "skill-a", [
    { path: "SKILL.md", bytes: Buffer.from("original", "utf8") },
  ]);
  filePath = path.join(skillWorkspaceDir(root, "skill-a"), "SKILL.md");

  const frames = collectFrames(h, thread.id);
  await h.manager.sendMessage(thread.id, "read SKILL.md");
  await waitFor(() => frames.some((f) => f.type === "turn_done"));

  assert.ok(
    !frames.some((f) => f.type === "workspace_file_changed"),
    "Read is not a write tool — never stashed/correlated",
  );
});
