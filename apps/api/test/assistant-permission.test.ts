import assert from "node:assert/strict";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, test } from "node:test";
import type { AssistantContextEnvelope, AssistantEvent } from "@mcp-token-footprint/shared";
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
import { workspaceRootFor } from "../src/assistant/workspace.js";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { ProviderRepository } from "../src/providers/repository.js";
import { SecretStore } from "../src/secrets/secret-store.js";

// Assistant (WP 2.1) — the write-permission protocol (D-AS4), exercised through a SCRIPTED FAKE driver
// that actually INVOKES the manager's `canUseTool` (via `startOptions.canUseTool`) for a scripted tool,
// so the full ask→decision round-trip runs with NO SDK, NO child, NO Anthropic call. We assert on the
// persisted `assistant_events` log (audit trail + replay) and the DriverPermissionResult the SDK would
// have received.

// Prefixed exactly as the SDK reports an in-process MCP tool to `canUseTool` (mcp__<serverKey>__<tool>).
const WRITE_TOOL = "mcp__assistant-app__skills_commit_workspace";
// A REAL, delete-classified write tool that is in-scope under `scenario` scope (its allowlist includes
// tests_delete; target kind `test` ≠ scope kind `scenario`, so it's allowlist-guarded, not id-matched).
// The WP 2.1 delete-protocol tests below run it under SCENARIO_SCOPE so the scope lock (R1.1) passes it
// through to the delete-always-asks path they actually exercise.
const DELETE_TOOL = "mcp__assistant-app__tests_delete";
const READ_TOOL = "mcp__assistant-app__runs_get";
const UI_TOOL = "mcp__assistant-app__ui_navigate";
// R1.1 (D-AS19) — out-of-scope app-data write tools used by the page-scope-lock tests below.
const ENV_UPDATE_TOOL = "mcp__assistant-app__environments_update";
const SERVER_UPDATE_TOOL = "mcp__assistant-app__servers_update_config";
const SUITE_CREATE_TOOL = "mcp__assistant-app__suites_create";
const COLLECTION_MODIFY_TOOL = "mcp__assistant-app__collections_modify";
const TESTS_CREATE_TOOL = "mcp__assistant-app__tests_create";
// A DELETE-classified tool (ends `_delete`) used to prove the scope guard hard-denies an out-of-scope
// DELETE before the delete-always-asks path — the delete class must not slip past the scope lock.
const ENV_DELETE_TOOL = "mcp__assistant-app__environments_delete";

// The scope a message is sent under (route + pinned entity). deriveAssistantScope turns the pinned
// entity into the thread's write scope; an unscoped message (undefined) is read-only.
const SKILL_SCOPE: AssistantContextEnvelope = {
  route: "/skills/s1",
  entityKind: "skill",
  entityId: "s1",
};
const SCENARIO_SCOPE: AssistantContextEnvelope = {
  route: "/testing/environments",
  entityKind: "scenario",
  entityId: "env-1",
};
// A read-only analysis surface (SCOPE_WRITE_TOOLS.run === []) — every entity-config write is denied
// here. Used to prove the cross-entity ACTION tools are EXEMPT from that lock.
const RUN_SCOPE: AssistantContextEnvelope = {
  route: "/testing/runs/run-1",
  entityKind: "run",
  entityId: "run-1",
};
// A scope-EXEMPT cross-entity action tool (mcp__server__ prefixed, as the SDK reports it).
const MCP_CALL_TOOL = "mcp__assistant-app__mcp_tool_call";
// WP5.4 — an issue-loop ACTION tool (scope-exempt via the apps/api-local `isIssueLoopActionTool`, still
// gated). The issue dock is UNPINNED, so this must reach approval from a read-only surface just like a
// shared scope-exempt action tool does — an ordinary out-of-scope write would be hard-denied here.
const RERUN_TOOL = "mcp__assistant-app__runs_rerun";

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
type PermissionScriptCtx = {
  text: string;
  turn: number;
  emit: (event: DriverEvent) => void;
  /** Ask the manager's choke point about a tool exactly as the SDK would — resolves to its decision. */
  requestTool: (
    toolName: string,
    input: Record<string, unknown>,
  ) => Promise<DriverPermissionResult>;
};
type PermissionScript = (ctx: PermissionScriptCtx) => void | Promise<void>;

class FakeSession implements DriverSession {
  private readonly out = new Pushable<DriverEvent>();
  readonly startOptions: DriverStartOptions;
  interruptCount = 0;
  private turn = 0;
  constructor(
    options: DriverStartOptions,
    private readonly script: PermissionScript,
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
        // The signal MUST be the session's shared abort controller so a teardown (stop/detach) settles it.
        return canUse({
          toolName,
          input,
          toolUseId: `tu-${toolName}`,
          signal: this.startOptions.abortController.signal,
        });
      },
    });
  }
  async interrupt(): Promise<void> {
    this.interruptCount += 1;
    this.out.push({ type: "turn_done" });
  }
  sessionId(): string | undefined {
    return this.sid;
  }
}

class FakeDriver implements AgentSessionDriver {
  readonly starts: FakeSession[] = [];
  private counter = 0;
  constructor(private readonly script: PermissionScript) {}
  start(options: DriverStartOptions): DriverSession {
    const session = new FakeSession(options, this.script, `sdk-sess-${++this.counter}`);
    this.starts.push(session);
    return session;
  }
}

// ── Harness ───────────────────────────────────────────────────────────────────────────────────────
const databases: AppDatabase[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function createDatabase(): AppDatabase {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  databases.push(db);
  return db;
}

type Harness = {
  repo: AssistantRepository;
  manager: AssistantSessionManager;
  driver: FakeDriver;
};

function makeHarness(
  script: PermissionScript,
  configOverrides: Partial<AssistantSessionConfig> = {},
): Harness {
  const db = createDatabase();
  const secrets = new SecretStore(Buffer.alloc(32, 7));
  const repo = new AssistantRepository(db, secrets);
  const providers = new ProviderRepository(db, secrets);
  repo.createCredential({ kind: "claude_oauth", token: "sk-ant-oat01-testtoken1234" });
  const driver = new FakeDriver(script);
  const manager = new AssistantSessionManager({
    repository: repo,
    providers,
    driver,
    buildTools: () => ({}),
    config: {
      maxTurns: 50,
      idleTimeoutMs: 60_000,
      maxActiveSessions: 2,
      assistantDataDir: `/tmp/mcp-assistant-perm-${Math.random().toString(36).slice(2)}`,
      permissionTimeoutMs: 300_000,
      // R2.2 — keep pre-R2 warm-session behavior for these permission tests (a long grace keeps the
      // child live within the test window); title one-shot off so it never perturbs driver.start counts.
      releaseGraceMs: 60_000,
      autoTitle: false,
      titleModel: "claude-haiku-4-5",
      titleTimeoutMs: 15_000,
      ...configOverrides,
    },
  });
  return { repo, manager, driver };
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

function requestId(events: AssistantEvent[]): string {
  const req = eventsOfType(events, "permission_request")[0];
  if (!req) throw new Error("no permission_request persisted");
  return req.requestId;
}

// ── Scripts ─────────────────────────────────────────────────────────────────────────────────────
/** Ask about `tool`; on allow run it, on deny report the denial — then close the turn. */
function askThenAct(
  tool: string,
  input: Record<string, unknown> = { skillId: "s1" },
): PermissionScript {
  return async ({ requestTool, emit, turn }) => {
    const result = await requestTool(tool, input);
    if (result.behavior === "allow") {
      const args = result.updatedInput ?? input;
      emit({ type: "tool_call", toolUseId: "tu-1", toolName: tool, input: args });
      emit({ type: "tool_result", toolUseId: "tu-1", result: { ok: true }, isError: false });
      emit({ type: "assistant_message", text: "Done." });
    } else {
      emit({ type: "assistant_message", text: `Denied: ${result.message}` });
    }
    emit({ type: "turn_done", turnIndex: turn });
  };
}

/** Ask about `tool` and, whatever the decision, emit nothing more — the turn is closed by interrupt()
 *  (used for the stop test, where stopping auto-denies the pending write and ends the turn). */
function askThenWait(tool: string): PermissionScript {
  return async ({ requestTool }) => {
    await requestTool(tool, { skillId: "s1" });
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────────────────────────

test("write tool → ask → ALLOW: the tool runs and both the request and the allow decision persist", async () => {
  const h = makeHarness(askThenAct(WRITE_TOOL));
  const thread = h.manager.createThread({});
  await h.manager.sendMessage(thread.id, "commit the workspace", SKILL_SCOPE);

  await waitFor(
    () => eventsOfType(h.repo.listEvents(thread.id), "permission_request").length === 1,
  );
  const req = eventsOfType(h.repo.listEvents(thread.id), "permission_request")[0];
  assert.equal(req?.toolName, "skills_commit_workspace", "the request records the BARE tool name");
  assert.deepEqual(req?.input, { skillId: "s1" }, "the request records the tool's raw args");
  // No decision yet — the tool is blocked awaiting approval.
  assert.equal(eventsOfType(h.repo.listEvents(thread.id), "permission_decision").length, 0);

  h.manager.decidePermission(thread.id, { requestId: req!.requestId, behavior: "allow" });
  await waitFor(() => h.repo.listEvents(thread.id).some((e) => e.type === "turn_done"));

  const events = h.repo.listEvents(thread.id);
  const decision = eventsOfType(events, "permission_decision")[0];
  assert.equal(decision?.behavior, "allow", "an allow decision persisted");
  const call = eventsOfType(events, "tool_call")[0];
  assert.ok(call, "the tool actually ran after approval");
  assert.equal(eventsOfType(events, "tool_result").length, 1, "the tool produced a result");
});

test("write tool → ask → DENY: the tool never runs and the deny decision persists", async () => {
  const h = makeHarness(askThenAct(WRITE_TOOL));
  const thread = h.manager.createThread({});
  await h.manager.sendMessage(thread.id, "commit the workspace", SKILL_SCOPE);
  await waitFor(
    () => eventsOfType(h.repo.listEvents(thread.id), "permission_request").length === 1,
  );

  h.manager.decidePermission(thread.id, {
    requestId: requestId(h.repo.listEvents(thread.id)),
    behavior: "deny",
  });
  await waitFor(() => h.repo.listEvents(thread.id).some((e) => e.type === "turn_done"));

  const events = h.repo.listEvents(thread.id);
  assert.equal(eventsOfType(events, "permission_decision")[0]?.behavior, "deny");
  assert.equal(eventsOfType(events, "tool_call").length, 0, "a denied write never runs");
});

test("allow with owner-edited input: the tool runs with the updatedInput, not the model's args", async () => {
  const h = makeHarness(askThenAct(WRITE_TOOL, { skillId: "s1", note: "orig" }));
  const thread = h.manager.createThread({});
  await h.manager.sendMessage(thread.id, "commit", SKILL_SCOPE);
  await waitFor(
    () => eventsOfType(h.repo.listEvents(thread.id), "permission_request").length === 1,
  );

  h.manager.decidePermission(thread.id, {
    requestId: requestId(h.repo.listEvents(thread.id)),
    behavior: "allow",
    updatedInput: { skillId: "s1", note: "edited-by-owner" },
  });
  await waitFor(() => h.repo.listEvents(thread.id).some((e) => e.type === "turn_done"));

  const events = h.repo.listEvents(thread.id);
  assert.deepEqual(eventsOfType(events, "permission_decision")[0]?.updatedInput, {
    skillId: "s1",
    note: "edited-by-owner",
  });
  assert.deepEqual(eventsOfType(events, "tool_call")[0]?.input, {
    skillId: "s1",
    note: "edited-by-owner",
  });
});

test("auto-accept ON auto-allows a create/update write (no manual decision, tool runs immediately)", async () => {
  const h = makeHarness(askThenAct(WRITE_TOOL));
  const thread = h.manager.createThread({});
  h.repo.updateThread(thread.id, { autoAccept: true });

  await h.manager.sendMessage(thread.id, "commit the workspace", SKILL_SCOPE);
  // No decidePermission() call — auto-accept resolves it. The turn completes on its own.
  await waitFor(() => h.repo.listEvents(thread.id).some((e) => e.type === "turn_done"));

  const events = h.repo.listEvents(thread.id);
  // The audit trail STILL carries the request→decision pair (a complete record of the auto-allowed write).
  assert.equal(eventsOfType(events, "permission_request").length, 1);
  assert.equal(eventsOfType(events, "permission_decision")[0]?.behavior, "allow");
  assert.equal(eventsOfType(events, "tool_call").length, 1, "the auto-allowed write ran");
});

test("auto-accept ON but a *_delete tool STILL asks (never auto-allowed) — D-AS4", async () => {
  const h = makeHarness(askThenAct(DELETE_TOOL));
  const thread = h.manager.createThread({});
  h.repo.updateThread(thread.id, { autoAccept: true });

  await h.manager.sendMessage(thread.id, "delete a test", SCENARIO_SCOPE);
  await waitFor(
    () => eventsOfType(h.repo.listEvents(thread.id), "permission_request").length === 1,
  );
  // Give any (erroneous) auto-decision a beat to appear — it must NOT.
  await delay(30);
  assert.equal(
    eventsOfType(h.repo.listEvents(thread.id), "permission_decision").length,
    0,
    "a delete is not auto-decided under auto-accept — it waits for the owner",
  );
  assert.ok(
    !h.repo.listEvents(thread.id).some((e) => e.type === "turn_done"),
    "the turn is still blocked on approval",
  );

  // It only proceeds once the owner decides.
  h.manager.decidePermission(thread.id, {
    requestId: requestId(h.repo.listEvents(thread.id)),
    behavior: "deny",
  });
  await waitFor(() => h.repo.listEvents(thread.id).some((e) => e.type === "turn_done"));
  assert.equal(
    eventsOfType(h.repo.listEvents(thread.id), "permission_decision")[0]?.behavior,
    "deny",
  );
});

test("auto-accept OFF asks for a create/update write too (default posture)", async () => {
  const h = makeHarness(askThenAct(WRITE_TOOL));
  const thread = h.manager.createThread({}); // autoAccept defaults OFF
  await h.manager.sendMessage(thread.id, "commit", SKILL_SCOPE);
  await waitFor(
    () => eventsOfType(h.repo.listEvents(thread.id), "permission_request").length === 1,
  );
  await delay(30);
  assert.equal(
    eventsOfType(h.repo.listEvents(thread.id), "permission_decision").length,
    0,
    "with auto-accept off, even a plain write waits for a decision",
  );
});

test("timeout → auto-deny: an un-answered request denies itself and persists the decision", async () => {
  const h = makeHarness(askThenAct(WRITE_TOOL), { permissionTimeoutMs: 30 });
  const thread = h.manager.createThread({});
  await h.manager.sendMessage(thread.id, "commit", SKILL_SCOPE);

  await waitFor(() => h.repo.listEvents(thread.id).some((e) => e.type === "permission_decision"));
  const events = h.repo.listEvents(thread.id);
  assert.equal(
    eventsOfType(events, "permission_decision")[0]?.behavior,
    "deny",
    "the timeout auto-denied",
  );
  assert.equal(eventsOfType(events, "tool_call").length, 0, "the timed-out write never ran");
});

test("decision-after-stop settles safely: stop auto-denies the pending write; a later decide 404s", async () => {
  const h = makeHarness(askThenWait(WRITE_TOOL));
  const thread = h.manager.createThread({});
  await h.manager.sendMessage(thread.id, "commit", SKILL_SCOPE);
  await waitFor(
    () => eventsOfType(h.repo.listEvents(thread.id), "permission_request").length === 1,
  );
  const id = requestId(h.repo.listEvents(thread.id));

  h.manager.stop(thread.id);
  await waitFor(() => h.repo.listEvents(thread.id).some((e) => e.type === "permission_decision"));
  assert.equal(
    eventsOfType(h.repo.listEvents(thread.id), "permission_decision")[0]?.behavior,
    "deny",
    "stop auto-denied",
  );

  // The pending promise is settled — deciding it now is a 404 (no leaked/zombie request).
  assert.throws(
    () => h.manager.decidePermission(thread.id, { requestId: id, behavior: "allow" }),
    (error: unknown) => (error as { statusCode?: number }).statusCode === 404,
  );
});

test("delete-while-pending: detach auto-denies + settles the promise; the deleted thread is gone", async () => {
  const h = makeHarness(askThenWait(WRITE_TOOL));
  const thread = h.manager.createThread({});
  await h.manager.sendMessage(thread.id, "commit", SKILL_SCOPE);
  await waitFor(
    () => eventsOfType(h.repo.listEvents(thread.id), "permission_request").length === 1,
  );
  const id = requestId(h.repo.listEvents(thread.id));

  h.manager.deleteThread(thread.id);
  // The thread + its events are gone (the deny decision is dropped with the row — correct on delete).
  assert.throws(
    () => h.repo.getThread(thread.id),
    (e: unknown) => (e as { statusCode?: number }).statusCode === 404,
  );
  // The pending promise was settled (not leaked): deciding it now is a 404.
  assert.throws(
    () => h.manager.decidePermission(thread.id, { requestId: id, behavior: "allow" }),
    (e: unknown) => (e as { statusCode?: number }).statusCode === 404,
  );
  await delay(20); // let the aborted fake session wind down — nothing must resurrect the row
});

test("deciding an unknown / already-settled request is a 404", async () => {
  const h = makeHarness(askThenAct(WRITE_TOOL));
  const thread = h.manager.createThread({});
  assert.throws(
    () => h.manager.decidePermission(thread.id, { requestId: "does-not-exist", behavior: "allow" }),
    (e: unknown) => (e as { statusCode?: number }).statusCode === 404,
  );
});

test("read tools auto-allow: NO permission_request, NO prompt, the tool just runs", async () => {
  const h = makeHarness(askThenAct(READ_TOOL, { runId: "r-1" }));
  const thread = h.manager.createThread({});
  await h.manager.sendMessage(thread.id, "read run r-1");
  await waitFor(() => h.repo.listEvents(thread.id).some((e) => e.type === "turn_done"));

  const events = h.repo.listEvents(thread.id);
  assert.equal(eventsOfType(events, "permission_request").length, 0, "a read is never gated");
  assert.equal(eventsOfType(events, "permission_decision").length, 0);
  assert.equal(eventsOfType(events, "tool_call").length, 1, "the read ran transparently");
});

test("ui_ tools auto-allow: NO permission_request, NO prompt", async () => {
  const h = makeHarness(askThenAct(UI_TOOL, { route: "/scans/s1" }));
  const thread = h.manager.createThread({});
  await h.manager.sendMessage(thread.id, "open the scan");
  await waitFor(() => h.repo.listEvents(thread.id).some((e) => e.type === "turn_done"));

  const events = h.repo.listEvents(thread.id);
  assert.equal(
    eventsOfType(events, "permission_request").length,
    0,
    "a ui_ navigation tool is never gated",
  );
  assert.equal(eventsOfType(events, "tool_call").length, 1);
});

test("every request + decision persists in seq order and replays (audit trail)", async () => {
  const h = makeHarness(askThenAct(WRITE_TOOL));
  const thread = h.manager.createThread({});
  await h.manager.sendMessage(thread.id, "commit", SKILL_SCOPE);
  await waitFor(
    () => eventsOfType(h.repo.listEvents(thread.id), "permission_request").length === 1,
  );
  h.manager.decidePermission(thread.id, {
    requestId: requestId(h.repo.listEvents(thread.id)),
    behavior: "allow",
  });
  await waitFor(() => h.repo.listEvents(thread.id).some((e) => e.type === "turn_done"));

  // replayEvents is the durable log the SSE stream replays; the request precedes its decision, and
  // seq is strictly increasing (never renumbered).
  const replay = h.manager.replayEvents(thread.id);
  const reqIdx = replay.findIndex((e) => e.type === "permission_request");
  const decIdx = replay.findIndex((e) => e.type === "permission_decision");
  assert.ok(reqIdx >= 0 && decIdx >= 0 && reqIdx < decIdx, "request persists before its decision");
  const seqs = replay.map((e) => e.seq ?? 0);
  for (let i = 1; i < seqs.length; i++)
    assert.ok(seqs[i]! > seqs[i - 1]!, "seq strictly increases");
});

// ── R1.1 (D-AS19) — the PAGE-SCOPE write lock, exercised end-to-end through the manager's canUseTool ──
// The scope guard runs PER MESSAGE against the CURRENT envelope's scope (set on the live session at
// `sendMessage`), BEFORE auto-accept / the owner round-trip — so an out-of-scope write is HARD-denied
// and cannot be rescued. Reads are never scope-gated.

/** Collect every assistant_message text (the deny script echoes `result.message` into one). */
function assistantText(events: AssistantEvent[]): string {
  return eventsOfType(events, "assistant_message")
    .map((e) => e.text)
    .join(" ");
}

test("skill scope: an OUT-OF-SCOPE write (environments_update) is hard-denied with a reason and cannot be rescued", async () => {
  const h = makeHarness(askThenAct(ENV_UPDATE_TOOL, { environmentId: "env-9" }));
  const thread = h.manager.createThread({});
  await h.manager.sendMessage(thread.id, "rename an environment", SKILL_SCOPE);
  await waitFor(() => h.repo.listEvents(thread.id).some((e) => e.type === "turn_done"));

  const events = h.repo.listEvents(thread.id);
  assert.equal(
    eventsOfType(events, "permission_request").length,
    1,
    "the attempt is recorded for the audit trail",
  );
  assert.equal(
    eventsOfType(events, "permission_decision")[0]?.behavior,
    "deny",
    "the scope guard denied it",
  );
  assert.equal(eventsOfType(events, "tool_call").length, 0, "an out-of-scope write NEVER runs");
  // The deny reason is model-visible (the SDK receives it as the canUseTool deny `message`).
  assert.match(assistantText(events), /out of scope/i);
  assert.match(assistantText(events), /skill s1/);

  // No pending permission was created — an owner "allow" cannot rescue it (404, not a resolvable ask).
  assert.throws(
    () =>
      h.manager.decidePermission(thread.id, { requestId: requestId(events), behavior: "allow" }),
    (e: unknown) => (e as { statusCode?: number }).statusCode === 404,
  );
});

test("skill scope: a BATTERY of out-of-scope writes are ALL denied and never run", async () => {
  for (const tool of [
    ENV_UPDATE_TOOL,
    SERVER_UPDATE_TOOL,
    SUITE_CREATE_TOOL,
    COLLECTION_MODIFY_TOOL,
    TESTS_CREATE_TOOL,
  ]) {
    const h = makeHarness(
      askThenAct(tool, {
        environmentId: "x",
        serverId: "x",
        collectionId: "x",
        name: "x",
        action: "update_metadata",
      }),
    );
    const thread = h.manager.createThread({});
    await h.manager.sendMessage(thread.id, "attempt an out-of-scope write", SKILL_SCOPE);
    await waitFor(() => h.repo.listEvents(thread.id).some((e) => e.type === "turn_done"));
    const events = h.repo.listEvents(thread.id);
    assert.equal(
      eventsOfType(events, "permission_decision")[0]?.behavior,
      "deny",
      `${tool} must be scope-denied`,
    );
    assert.equal(eventsOfType(events, "tool_call").length, 0, `${tool} must never run`);
  }
});

test("skill scope: an OUT-OF-SCOPE DELETE (environments_delete) is hard-denied by the scope guard, not parked as a delete-ask", async () => {
  // R1.1 review finding 5: the delete class reaches the scope guard on the SAME code path as the write
  // class (classification precedes the guard). Prove a cross-entity delete is scope-denied outright — it
  // must NOT fall through to the delete-always-asks round-trip (which an owner could then approve).
  const h = makeHarness(askThenAct(ENV_DELETE_TOOL, { environmentId: "env-9" }));
  const thread = h.manager.createThread({});
  await h.manager.sendMessage(thread.id, "delete an environment from the skill page", SKILL_SCOPE);
  await waitFor(() => h.repo.listEvents(thread.id).some((e) => e.type === "turn_done"));

  const events = h.repo.listEvents(thread.id);
  assert.equal(
    eventsOfType(events, "permission_decision")[0]?.behavior,
    "deny",
    "the out-of-scope delete was scope-denied",
  );
  assert.equal(eventsOfType(events, "tool_call").length, 0, "the out-of-scope delete NEVER ran");
  assert.match(assistantText(events), /out of scope/i);
  // No resolvable pending ask — an owner cannot approve this cross-entity delete (404, not a parked ask).
  assert.throws(
    () =>
      h.manager.decidePermission(thread.id, { requestId: requestId(events), behavior: "allow" }),
    (e: unknown) => (e as { statusCode?: number }).statusCode === 404,
  );
});

test("auto-accept ON cannot rescue an out-of-scope write (the scope guard runs BEFORE auto-accept)", async () => {
  const h = makeHarness(askThenAct(SERVER_UPDATE_TOOL, { serverId: "srv-9" }));
  const thread = h.manager.createThread({});
  h.repo.updateThread(thread.id, { autoAccept: true });
  await h.manager.sendMessage(thread.id, "change a server from the skill page", SKILL_SCOPE);
  await waitFor(() => h.repo.listEvents(thread.id).some((e) => e.type === "turn_done"));

  const events = h.repo.listEvents(thread.id);
  assert.equal(
    eventsOfType(events, "permission_decision")[0]?.behavior,
    "deny",
    "auto-accept did NOT auto-allow it",
  );
  assert.equal(
    eventsOfType(events, "tool_call").length,
    0,
    "the out-of-scope write never ran despite auto-accept",
  );
});

test("run scope (read-only): a scope-EXEMPT action tool (mcp_tool_call) is NOT scope-denied — it reaches the approval round-trip and can be approved", async () => {
  // The owner's flow: analyzing a run (a read-only surface where SCOPE_WRITE_TOOLS.run === []), invoke a
  // tool on the server the run used. An ordinary out-of-scope write is hard-denied here; a scope-exempt
  // action tool must instead PARK for approval (request recorded, NO immediate deny) and run when allowed.
  const h = makeHarness(askThenAct(MCP_CALL_TOOL, { serverId: "srv-1", toolName: "list_files" }));
  const thread = h.manager.createThread({});
  await h.manager.sendMessage(thread.id, "call a tool on the server this run used", RUN_SCOPE);
  await waitFor(
    () => eventsOfType(h.repo.listEvents(thread.id), "permission_request").length === 1,
  );
  await delay(30);
  assert.equal(
    eventsOfType(h.repo.listEvents(thread.id), "permission_decision").length,
    0,
    "the exempt action is NOT scope-denied — it parks for the owner instead of being refused",
  );

  h.manager.decidePermission(thread.id, {
    requestId: requestId(h.repo.listEvents(thread.id)),
    behavior: "allow",
  });
  await waitFor(() => h.repo.listEvents(thread.id).some((e) => e.type === "turn_done"));
  const events = h.repo.listEvents(thread.id);
  assert.equal(eventsOfType(events, "permission_decision")[0]?.behavior, "allow");
  assert.equal(
    eventsOfType(events, "tool_call").length,
    1,
    "the approved cross-entity action ran (unlike an out-of-scope config write, which can never run)",
  );
});

test("WP5.4 — an UNPINNED issue dock: an issue-loop action (runs_rerun) is NOT scope-denied — it parks for approval and runs on allow", async () => {
  // The issue detail opens the dock UNPINNED (no envelope → read-only page scope). An ordinary write is
  // hard-denied when unscoped; an issue-loop action must instead PARK for the owner (request recorded, NO
  // immediate deny), then run when approved — proving the scope EXEMPTION while staying gated (D-AS4).
  const h = makeHarness(askThenAct(RERUN_TOOL, { parentRunId: "run-1", issueId: "issue-open-1" }));
  const thread = h.manager.createThread({});
  await h.manager.sendMessage(thread.id, "prove the fix by re-running this linked run"); // no envelope → unscoped
  await waitFor(
    () => eventsOfType(h.repo.listEvents(thread.id), "permission_request").length === 1,
  );
  await delay(30);
  assert.equal(
    eventsOfType(h.repo.listEvents(thread.id), "permission_decision").length,
    0,
    "the issue-loop action is NOT scope-denied while unscoped — it parks for approval",
  );

  h.manager.decidePermission(thread.id, {
    requestId: requestId(h.repo.listEvents(thread.id)),
    behavior: "allow",
  });
  await waitFor(() => h.repo.listEvents(thread.id).some((e) => e.type === "turn_done"));
  const events = h.repo.listEvents(thread.id);
  assert.equal(eventsOfType(events, "permission_decision")[0]?.behavior, "allow");
  assert.equal(
    eventsOfType(events, "tool_call").length,
    1,
    "the approved issue-loop action ran (unlike an ordinary write, which is hard-denied when unscoped)",
  );
});

test("WP5.4 — an issue-loop action under a DIFFERENT entity scope (skill) is still exempt (reachable, gated), not scope-denied", async () => {
  // Even with an unrelated entity pinned, the loop's cross-entity action tools stay reachable (they are
  // not edits to the pinned entity's config) — the exemption is unconditional, mirroring the mcp_tool_call
  // exemption under run scope.
  const h = makeHarness(askThenAct(RERUN_TOOL, { parentRunId: "run-9", issueId: "issue-x" }));
  const thread = h.manager.createThread({});
  await h.manager.sendMessage(thread.id, "re-run to verify", SKILL_SCOPE);
  await waitFor(
    () => eventsOfType(h.repo.listEvents(thread.id), "permission_request").length === 1,
  );
  await delay(30);
  assert.equal(
    eventsOfType(h.repo.listEvents(thread.id), "permission_decision").length,
    0,
    "not scope-denied under a mismatched pin — it parks for approval",
  );
});

test("skill scope: skills_commit_workspace with the SAME skillId reaches the normal approval path", async () => {
  const h = makeHarness(askThenAct(WRITE_TOOL, { skillId: "s1" }));
  const thread = h.manager.createThread({});
  await h.manager.sendMessage(thread.id, "commit this skill", SKILL_SCOPE);
  await waitFor(
    () => eventsOfType(h.repo.listEvents(thread.id), "permission_request").length === 1,
  );
  await delay(30);
  assert.equal(
    eventsOfType(h.repo.listEvents(thread.id), "permission_decision").length,
    0,
    "an in-scope write is NOT scope-denied — it parks for the owner",
  );

  h.manager.decidePermission(thread.id, {
    requestId: requestId(h.repo.listEvents(thread.id)),
    behavior: "allow",
  });
  await waitFor(() => h.repo.listEvents(thread.id).some((e) => e.type === "turn_done"));
  assert.equal(
    eventsOfType(h.repo.listEvents(thread.id), "tool_call").length,
    1,
    "the in-scope, approved write ran",
  );
});

test("skill scope: skills_commit_workspace with a DIFFERENT skillId is denied (id-mismatch attack blocked)", async () => {
  const h = makeHarness(askThenAct(WRITE_TOOL, { skillId: "s2" }));
  const thread = h.manager.createThread({});
  await h.manager.sendMessage(thread.id, "commit a different skill", SKILL_SCOPE);
  await waitFor(() => h.repo.listEvents(thread.id).some((e) => e.type === "turn_done"));
  const events = h.repo.listEvents(thread.id);
  assert.equal(
    eventsOfType(events, "permission_decision")[0]?.behavior,
    "deny",
    "an id-mismatched workspace tool is denied",
  );
  assert.equal(eventsOfType(events, "tool_call").length, 0);
});

test("unscoped (no envelope): a write is denied read-only, and the reason says so", async () => {
  const h = makeHarness(askThenAct(WRITE_TOOL, { skillId: "s1" }));
  const thread = h.manager.createThread({});
  await h.manager.sendMessage(thread.id, "commit"); // no envelope → unscoped = read-only
  await waitFor(() => h.repo.listEvents(thread.id).some((e) => e.type === "turn_done"));
  const events = h.repo.listEvents(thread.id);
  assert.equal(
    eventsOfType(events, "permission_decision")[0]?.behavior,
    "deny",
    "an unscoped write is denied",
  );
  assert.equal(eventsOfType(events, "tool_call").length, 0);
  assert.match(assistantText(events), /read-only/i);
});

test("unscoped and skill-scoped: a READ tool is never scope-gated — it just runs", async () => {
  for (const envelope of [undefined, SKILL_SCOPE]) {
    const h = makeHarness(askThenAct(READ_TOOL, { runId: "r-1" }));
    const thread = h.manager.createThread({});
    await h.manager.sendMessage(thread.id, "read a run", envelope);
    await waitFor(() => h.repo.listEvents(thread.id).some((e) => e.type === "turn_done"));
    const events = h.repo.listEvents(thread.id);
    assert.equal(
      eventsOfType(events, "permission_request").length,
      0,
      "reads are broad — never gated by scope",
    );
    assert.equal(eventsOfType(events, "tool_call").length, 1, "the read ran transparently");
  }
});

test("scenario scope: environments_update with the matching id reaches the approval path", async () => {
  const h = makeHarness(askThenAct(ENV_UPDATE_TOOL, { environmentId: "env-1" }));
  const thread = h.manager.createThread({});
  await h.manager.sendMessage(thread.id, "update this environment", SCENARIO_SCOPE);
  await waitFor(
    () => eventsOfType(h.repo.listEvents(thread.id), "permission_request").length === 1,
  );
  await delay(30);
  assert.equal(
    eventsOfType(h.repo.listEvents(thread.id), "permission_decision").length,
    0,
    "an in-scope environment edit awaits the owner, not a scope deny",
  );
  h.manager.decidePermission(thread.id, {
    requestId: requestId(h.repo.listEvents(thread.id)),
    behavior: "allow",
  });
  await waitFor(() => h.repo.listEvents(thread.id).some((e) => e.type === "turn_done"));
  assert.equal(eventsOfType(h.repo.listEvents(thread.id), "tool_call").length, 1);
});

test("scenario scope: a wrong-KIND write (skills_commit_workspace) is denied", async () => {
  const h = makeHarness(askThenAct(WRITE_TOOL, { skillId: "s1" }));
  const thread = h.manager.createThread({});
  await h.manager.sendMessage(
    thread.id,
    "commit a skill from the environment page",
    SCENARIO_SCOPE,
  );
  await waitFor(() => h.repo.listEvents(thread.id).some((e) => e.type === "turn_done"));
  const events = h.repo.listEvents(thread.id);
  assert.equal(eventsOfType(events, "permission_decision")[0]?.behavior, "deny");
  assert.equal(eventsOfType(events, "tool_call").length, 0);
});

test("scenario scope: a child TEST write (tests_create) is allowed by the allowlist (documented child-id caveat)", async () => {
  const h = makeHarness(askThenAct(TESTS_CREATE_TOOL, { name: "t", userPrompt: "p" }));
  const thread = h.manager.createThread({});
  await h.manager.sendMessage(thread.id, "create a test in this environment", SCENARIO_SCOPE);
  await waitFor(
    () => eventsOfType(h.repo.listEvents(thread.id), "permission_request").length === 1,
  );
  await delay(30);
  assert.equal(
    eventsOfType(h.repo.listEvents(thread.id), "permission_decision").length,
    0,
    "an allowlist-guarded child write is NOT scope-denied — it reaches the owner",
  );
  h.manager.decidePermission(thread.id, {
    requestId: requestId(h.repo.listEvents(thread.id)),
    behavior: "allow",
  });
  await waitFor(() => h.repo.listEvents(thread.id).some((e) => e.type === "turn_done"));
  assert.equal(eventsOfType(h.repo.listEvents(thread.id), "tool_call").length, 1);
});

// ── H-3 — the skill-authoring reference dir is READ-ONLY: native Edit/Write/MultiEdit writes into it
// must be hard-denied, even though native writes are otherwise EXEMPT from the R1.1 scope gate (see
// handlePermission's EXEMPTION comment). additionalDirectories widens to `assistantSkillAuthoringDir`
// on a skill-scoped session purely so native file-READ tools can read the bundled guides — the fix
// closes the resulting native-WRITE side door without touching read access or the legitimate
// skill-workspace write path.

// A fixed, deliberately non-existent path — the H-3 containment check is pure path arithmetic (no
// filesystem access), so the directory need not actually exist on disk for these tests.
const AUTHORING_DIR = "/tmp/mcp-assistant-h3-authoring-ref-fixture";

test("H-3: a native Write into the skill-authoring reference dir is hard-denied, fail closed", async () => {
  const h = makeHarness(
    askThenAct("Write", {
      file_path: path.join(AUTHORING_DIR, "skill-creator", "SKILL.md"),
      content: "overwritten by the agent",
    }),
    { assistantSkillAuthoringDir: AUTHORING_DIR },
  );
  const thread = h.manager.createThread({});
  await h.manager.sendMessage(thread.id, "please help with this skill", SKILL_SCOPE);
  await waitFor(() => h.repo.listEvents(thread.id).some((e) => e.type === "turn_done"));

  const events = h.repo.listEvents(thread.id);
  assert.equal(
    eventsOfType(events, "permission_decision")[0]?.behavior,
    "deny",
    "a native write into the read-only reference dir is denied",
  );
  assert.equal(eventsOfType(events, "tool_call").length, 0, "the write NEVER ran");
  assert.match(assistantText(events), /read-only/i);

  // No resolvable pending ask — an owner "allow" cannot rescue it (404, not a parked ask).
  assert.throws(
    () =>
      h.manager.decidePermission(thread.id, { requestId: requestId(events), behavior: "allow" }),
    (e: unknown) => (e as { statusCode?: number }).statusCode === 404,
  );
});

test("H-3: a native Edit into the skill-authoring reference dir is hard-denied, fail closed", async () => {
  const h = makeHarness(
    askThenAct("Edit", {
      file_path: path.join(AUTHORING_DIR, "skill-creator", "references", "notes.md"),
      old_string: "original guidance",
      new_string: "tampered guidance",
    }),
    { assistantSkillAuthoringDir: AUTHORING_DIR },
  );
  const thread = h.manager.createThread({});
  await h.manager.sendMessage(thread.id, "please help with this skill", SKILL_SCOPE);
  await waitFor(() => h.repo.listEvents(thread.id).some((e) => e.type === "turn_done"));

  const events = h.repo.listEvents(thread.id);
  assert.equal(
    eventsOfType(events, "permission_decision")[0]?.behavior,
    "deny",
    "a native Edit into the read-only reference dir is denied",
  );
  assert.equal(eventsOfType(events, "tool_call").length, 0, "the edit NEVER ran");
});

test("H-3: auto-accept ON cannot rescue a native write into the reference dir (fail closed beats auto-accept)", async () => {
  const h = makeHarness(
    askThenAct("Write", { file_path: path.join(AUTHORING_DIR, "SKILL.md"), content: "x" }),
    { assistantSkillAuthoringDir: AUTHORING_DIR },
  );
  const thread = h.manager.createThread({});
  h.repo.updateThread(thread.id, { autoAccept: true });
  await h.manager.sendMessage(thread.id, "please help with this skill", SKILL_SCOPE);
  await waitFor(() => h.repo.listEvents(thread.id).some((e) => e.type === "turn_done"));

  const events = h.repo.listEvents(thread.id);
  assert.equal(
    eventsOfType(events, "permission_decision")[0]?.behavior,
    "deny",
    "auto-accept did NOT rescue the denial",
  );
  assert.equal(eventsOfType(events, "tool_call").length, 0, "the write never ran despite auto-accept");
});

test("H-3: a `..`-traversal path that normalizes back under the reference dir is still denied", async () => {
  // Not a naive string-prefix bypass: path.resolve collapses the `..` BEFORE the containment check, so
  // this resolves to `${AUTHORING_DIR}/SKILL.md` — squarely inside the reference dir.
  const trickPath = path.join(AUTHORING_DIR, "some", "nested", "..", "..", "SKILL.md");
  const h = makeHarness(askThenAct("Write", { file_path: trickPath, content: "x" }), {
    assistantSkillAuthoringDir: AUTHORING_DIR,
  });
  const thread = h.manager.createThread({});
  await h.manager.sendMessage(thread.id, "please help with this skill", SKILL_SCOPE);
  await waitFor(() => h.repo.listEvents(thread.id).some((e) => e.type === "turn_done"));

  const events = h.repo.listEvents(thread.id);
  assert.equal(
    eventsOfType(events, "permission_decision")[0]?.behavior,
    "deny",
    "a `..`-normalized path landing inside the reference dir is still denied",
  );
  assert.equal(eventsOfType(events, "tool_call").length, 0);
});

test("H-3: a sibling directory that merely shares the reference dir as a string prefix is NOT falsely denied", async () => {
  // e.g. AUTHORING_DIR = "/tmp/…-fixture"; this path is "/tmp/…-fixture-other/…" — a naive
  // `startsWith(dir)` (no separator boundary) would wrongly treat this as contained.
  const siblingPath = `${AUTHORING_DIR}-other/SKILL.md`;
  const h = makeHarness(askThenAct("Write", { file_path: siblingPath, content: "x" }), {
    assistantSkillAuthoringDir: AUTHORING_DIR,
  });
  const thread = h.manager.createThread({});
  h.repo.updateThread(thread.id, { autoAccept: true });
  await h.manager.sendMessage(thread.id, "please help with this skill", SKILL_SCOPE);
  await waitFor(() => h.repo.listEvents(thread.id).some((e) => e.type === "turn_done"));

  const events = h.repo.listEvents(thread.id);
  assert.equal(
    eventsOfType(events, "permission_decision")[0]?.behavior,
    "allow",
    "a sibling dir sharing a string prefix is not falsely blocked",
  );
  assert.equal(eventsOfType(events, "tool_call").length, 1);
});

test("H-3: a native Write to a legitimate in-workspace path is still allowed (writes are not over-blocked)", async () => {
  const assistantDataDir = `/tmp/mcp-assistant-h3-ws-${Math.random().toString(36).slice(2)}`;
  let legitimatePath = "";
  // A bespoke script (not askThenAct) because the legitimate path depends on the thread id, which
  // only exists after `createThread()` — but the script itself only runs later, on `sendMessage`.
  const script: PermissionScript = async ({ requestTool, emit, turn }) => {
    const input = { file_path: legitimatePath, content: "ok" };
    const result = await requestTool("Write", input);
    if (result.behavior === "allow") {
      emit({ type: "tool_call", toolUseId: "tu-1", toolName: "Write", input });
      emit({ type: "tool_result", toolUseId: "tu-1", result: { ok: true }, isError: false });
      emit({ type: "assistant_message", text: "Done." });
    } else {
      emit({ type: "assistant_message", text: `Denied: ${result.message}` });
    }
    emit({ type: "turn_done", turnIndex: turn });
  };
  const h = makeHarness(script, { assistantSkillAuthoringDir: AUTHORING_DIR, assistantDataDir });
  const thread = h.manager.createThread({});
  legitimatePath = path.join(workspaceRootFor(assistantDataDir, thread.id), "s1", "SKILL.md");
  h.repo.updateThread(thread.id, { autoAccept: true });
  await h.manager.sendMessage(thread.id, "edit the skill file", SKILL_SCOPE);
  await waitFor(() => h.repo.listEvents(thread.id).some((e) => e.type === "turn_done"));

  const events = h.repo.listEvents(thread.id);
  assert.equal(
    eventsOfType(events, "permission_decision")[0]?.behavior,
    "allow",
    "a legitimate in-workspace native write is still allowed",
  );
  assert.equal(eventsOfType(events, "tool_call").length, 1, "the write ran");
});

test("H-3: a native Read of the skill-authoring reference dir is still allowed (only writes are blocked)", async () => {
  const h = makeHarness(
    askThenAct("Read", { file_path: path.join(AUTHORING_DIR, "skill-creator", "SKILL.md") }),
    { assistantSkillAuthoringDir: AUTHORING_DIR },
  );
  const thread = h.manager.createThread({});
  await h.manager.sendMessage(thread.id, "read the authoring guide", SKILL_SCOPE);
  await waitFor(() => h.repo.listEvents(thread.id).some((e) => e.type === "turn_done"));

  const events = h.repo.listEvents(thread.id);
  assert.equal(
    eventsOfType(events, "permission_request").length,
    0,
    "a native read is never gated, including reads of the reference dir",
  );
  assert.equal(eventsOfType(events, "tool_call").length, 1, "the read ran transparently");
});
