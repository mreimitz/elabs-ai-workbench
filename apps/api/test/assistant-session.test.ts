import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { afterEach, test } from "node:test";
import type { AssistantEvent, AssistantStreamFrame } from "@mcp-token-footprint/shared";
import { AssistantRepository } from "../src/assistant/repository.js";
import { deterministicTitle } from "../src/assistant/auto-title.js";
import {
  AssistantSessionManager,
  type AssistantSessionConfig,
} from "../src/assistant/session-manager.js";
import type {
  AgentSessionDriver,
  DriverEvent,
  DriverSession,
  DriverStartOptions,
  DriverUserMessage,
} from "../src/assistant/session-driver.js";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { ProviderRepository } from "../src/providers/repository.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { ASSISTANT_SYSTEM_PROMPT } from "../src/assistant/system-prompt.js";

// Assistant (WP 1.1) — session engine lifecycle, exercised entirely through a SCRIPTED FAKE driver.
// NO SDK is imported, NO child is spawned, NO Anthropic call is made — the manager drives the fake
// `AgentSessionDriver` and we assert on the persisted `assistant_events` log + the manager's state.

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

// ── The scripted fake driver ──────────────────────────────────────────────────────────────────────
// R2.2 — the ctx additionally carries the session's `options` so a script can branch on them (e.g. the
// title one-shot, which the manager starts with `maxTurns: 1` — distinct from a main session's 50).
type TurnScript = (ctx: {
  text: string;
  turn: number;
  emit: (event: DriverEvent) => void;
  options: DriverStartOptions;
}) => void;

class FakeSession implements DriverSession {
  private readonly out = new Pushable<DriverEvent>();
  readonly startOptions: DriverStartOptions;
  readonly sentTexts: string[] = [];
  interruptCount = 0;
  private turn = 0;
  private sid: string;
  constructor(
    options: DriverStartOptions,
    private readonly script: TurnScript,
    sessionId: string,
  ) {
    this.startOptions = options;
    this.sid = sessionId;
    // The SDK's `system/init` carries the session id — emit it up front (buffered → read first).
    this.out.push({ type: "session", sessionId });
    // Aborting the shared controller (park/detach/kill) ends the stream, exactly like the real driver.
    options.abortController.signal.addEventListener("abort", () => this.out.end(), { once: true });
  }
  get events(): AsyncIterable<DriverEvent> {
    return this.out;
  }
  send(message: DriverUserMessage): void {
    this.sentTexts.push(message.text);
    const turn = this.turn++;
    this.script({
      text: message.text,
      turn,
      emit: (event) => this.out.push(event),
      options: this.startOptions,
    });
  }
  async interrupt(): Promise<void> {
    // Interrupt ends the current turn but keeps the session warm — mirror by settling the turn.
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
  constructor(private readonly script: TurnScript) {}
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
  db: AppDatabase;
  repo: AssistantRepository;
  providers: ProviderRepository;
  manager: AssistantSessionManager;
  driver: FakeDriver;
};

function makeHarness(
  script: TurnScript,
  configOverrides: Partial<AssistantSessionConfig> = {},
  options: { signIn?: boolean; dataDir?: string } = {},
): Harness {
  const db = createDatabase();
  const secrets = new SecretStore(Buffer.alloc(32, 7));
  const repo = new AssistantRepository(db, secrets);
  const providers = new ProviderRepository(db, secrets);
  if (options.signIn !== false) {
    // Sign in with a subscription credential so the auth gate + subscription resolution pass.
    repo.createCredential({ kind: "claude_oauth", token: "sk-ant-oat01-testtoken1234" });
  }
  const driver = new FakeDriver(script);
  const manager = new AssistantSessionManager({
    repository: repo,
    providers,
    driver,
    buildTools: () => ({}), // SDK-free stub tool server; the fake driver ignores it
    config: {
      maxTurns: 50,
      idleTimeoutMs: 60_000,
      maxActiveSessions: 2,
      assistantDataDir:
        options.dataDir ?? `/tmp/mcp-assistant-test-${Math.random().toString(36).slice(2)}`,
      permissionTimeoutMs: 300_000,
      // R2.2 defaults: grace 0 = the real release-on-reply default (a completed turn releases the
      // session at once); autoTitle off by default so only the tests that opt in exercise the one-shot.
      releaseGraceMs: 0,
      autoTitle: false,
      titleModel: "claude-haiku-4-5",
      titleTimeoutMs: 15_000,
      ...configOverrides,
    },
  });
  return { db, repo, providers, manager, driver };
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) await delay(5);
  if (!predicate()) throw new Error("waitFor timed out");
}

function eventTypes(events: AssistantEvent[]): string[] {
  return events.map((event) => event.type);
}

// ── Scripts ─────────────────────────────────────────────────────────────────────────────────────
const echoScript: TurnScript = ({ text, turn, emit }) => {
  emit({ type: "assistant_delta", text: `partial-${turn}` }); // transient — never persisted
  emit({ type: "assistant_message", text: `answer-${turn}:${text}` });
  emit({ type: "turn_done", turnIndex: turn });
};

const toolScript: TurnScript = ({ emit, turn }) => {
  emit({ type: "tool_call", toolUseId: "tu-1", toolName: "runs_get", input: { runId: "r-1" } });
  emit({ type: "tool_result", toolUseId: "tu-1", result: { status: "completed" }, isError: false });
  emit({ type: "assistant_message", text: "I read the run." });
  emit({ type: "turn_done", turnIndex: turn });
};

// WP 3.3 — a turn that ALWAYS hits an auth-kind limit_error then settles (mirrors a subscription
// credential the SDK rejects), so `retrySource` tests have something to retry.
const authLimitScript: TurnScript = ({ emit, turn }) => {
  emit({ type: "limit_error", message: "Assistant authentication failed.", kind: "auth" });
  emit({ type: "turn_done", turnIndex: turn });
};

/** Register + point the fallback pointer at a fresh anthropic-kind provider credential (D-AS14's
 *  "api_key" source). Returns its id. */
function withFallback(h: Harness): string {
  const credential = h.providers.create({
    kind: "anthropic",
    label: "fallback",
    apiKey: "sk-test-fallback-key",
  });
  h.repo.setFallbackProviderCredentialId(credential.id);
  return credential.id;
}

// ── Tests ─────────────────────────────────────────────────────────────────────────────────────────

test("every session is started with the app system prompt (injection defense + D-AS9 identity, not inert)", async () => {
  const h = makeHarness(echoScript);
  const thread = h.manager.createThread({});
  await h.manager.sendMessage(thread.id, "hello");

  assert.equal(h.driver.starts.length, 1, "one session started");
  const prompt = h.driver.starts[0]?.startOptions.systemPrompt;
  assert.equal(
    prompt,
    ASSISTANT_SYSTEM_PROMPT,
    "the custom app system prompt is passed to the driver",
  );
  assert.ok(prompt && prompt.length > 0, "system prompt is non-empty");
});

test("multi-turn conversation: two messages persist an ordered, seq-monotonic settled log", async () => {
  const h = makeHarness(echoScript);
  const thread = h.manager.createThread({});

  await h.manager.sendMessage(thread.id, "first");
  await waitFor(() => h.repo.listEvents(thread.id).some((e) => e.type === "turn_done"));

  await h.manager.sendMessage(thread.id, "second");
  await waitFor(
    () => h.repo.listEvents(thread.id).filter((e) => e.type === "turn_done").length === 2,
  );

  const events = h.repo.listEvents(thread.id);
  // R2.2 (D-AS25) — release-on-reply: the first turn RELEASES its session, so the second message runs
  // on a FRESH session that RESUMES the prior conversation via the persisted sdkSessionId. Two starts.
  assert.equal(
    h.driver.starts.length,
    2,
    "each message runs on a fresh, resumed session (release-on-reply)",
  );
  assert.equal(
    h.driver.starts[1]?.startOptions.resume,
    "sdk-sess-1",
    "the second message's session resumes the first session's persisted id",
  );
  assert.deepEqual(
    eventTypes(events),
    [
      "user_message",
      "assistant_message",
      "turn_done",
      "user_message",
      "assistant_message",
      "turn_done",
    ],
    "the durable per-thread log spans both sessions as the two user/assistant/turn_done triples, in order",
  );
  // seq is per-thread monotonic 1..6 (the log is thread-level, continuous across the two sessions).
  assert.deepEqual(
    events.map((e) => e.seq),
    [1, 2, 3, 4, 5, 6],
  );
  const answers = events.filter((e) => e.type === "assistant_message");
  assert.equal((answers[0] as { text: string }).text, "answer-0:first");
  // The second turn runs on a fresh session, so its per-session turn counter restarts at 0.
  assert.equal((answers[1] as { text: string }).text, "answer-0:second");
});

test("a send while a turn is in flight is rejected (409) — no interleaved user_message (WP 1.3 review)", async () => {
  // A turn that emits a delta but never settles (no turn_done) keeps turnInFlight true.
  const hangingScript: TurnScript = ({ emit }) => {
    emit({ type: "assistant_delta", text: "still thinking" });
  };
  const h = makeHarness(hangingScript);
  const thread = h.manager.createThread({});

  await h.manager.sendMessage(thread.id, "first");
  await assert.rejects(() => h.manager.sendMessage(thread.id, "second"), /still responding/i);

  // Only the first user_message was persisted — the second never interleaved.
  const userMessages = h.repo.listEvents(thread.id).filter((e) => e.type === "user_message");
  assert.equal(userMessages.length, 1, "the rejected send left no second user_message");
});

test("settled-events-only persistence: streamed deltas are NEVER written to assistant_events", async () => {
  const h = makeHarness(echoScript);
  const thread = h.manager.createThread({});
  await h.manager.sendMessage(thread.id, "hi");
  await waitFor(() => h.repo.listEvents(thread.id).some((e) => e.type === "turn_done"));

  const events = h.repo.listEvents(thread.id);
  assert.ok(!events.some((e) => e.type === "assistant_delta"), "no delta row persisted");
  const rawDeltaRows = h.db
    .prepare("SELECT COUNT(*) AS n FROM assistant_events WHERE type = 'assistant_delta'")
    .get() as { n: number };
  assert.equal(rawDeltaRows.n, 0, "no assistant_delta row in the table at all");
});

test("tool_call/tool_result events map through, correlating the result's tool name by tool_use_id", async () => {
  const h = makeHarness(toolScript);
  const thread = h.manager.createThread({});
  await h.manager.sendMessage(thread.id, "read run r-1");
  await waitFor(() => h.repo.listEvents(thread.id).some((e) => e.type === "turn_done"));

  const events = h.repo.listEvents(thread.id);
  const call = events.find((e) => e.type === "tool_call") as
    | Extract<AssistantEvent, { type: "tool_call" }>
    | undefined;
  const result = events.find((e) => e.type === "tool_result") as
    | Extract<AssistantEvent, { type: "tool_result" }>
    | undefined;
  assert.ok(call, "a tool_call event persisted");
  assert.equal(call?.toolName, "runs_get");
  assert.deepEqual(call?.input, { runId: "r-1" });
  assert.ok(result, "a tool_result event persisted");
  // The driver's tool_result carries only the tool_use_id; the manager correlates the name back.
  assert.equal(result?.toolName, "runs_get", "tool_result tool name correlated from the tool_call");
  assert.equal(result?.isError, false);
});

// WP 3.1 — a successful ui_* tool result additionally settles a `ui_action` event (D-AS8/D-AS16). The
// fake driver's `result` mirrors what the real MCP `CallToolResult.content` looks like for a
// `jsonResult(...)`-shaped success: an array with one `{ type: "text", text: "<json>" }` block.
const uiToolScript: TurnScript = ({ emit, turn }) => {
  emit({
    type: "tool_call",
    toolUseId: "tu-ui-1",
    toolName: "ui_open_run_turn",
    input: { runId: "r-1", turnIndex: 2 },
  });
  emit({
    type: "tool_result",
    toolUseId: "tu-ui-1",
    result: [
      {
        type: "text",
        text: JSON.stringify({
          action: "open_run_turn",
          route: "/testing/runs/r-1?turn=2",
          label: "Run console — r-1, turn 3",
          params: { runId: "r-1", turnIndex: 2 },
        }),
      },
    ],
    isError: false,
  });
  emit({ type: "assistant_message", text: "Opened it." });
  emit({ type: "turn_done", turnIndex: turn });
};

test("a successful ui_* tool result additionally settles a ui_action event carrying { action, params }", async () => {
  const h = makeHarness(uiToolScript);
  const thread = h.manager.createThread({});
  await h.manager.sendMessage(thread.id, "open run r-1 at turn 3");
  await waitFor(() => h.repo.listEvents(thread.id).some((e) => e.type === "turn_done"));

  const events = h.repo.listEvents(thread.id);
  assert.deepEqual(
    eventTypes(events),
    ["user_message", "tool_call", "tool_result", "ui_action", "assistant_message", "turn_done"],
    "ui_action settles right after its tool_result, before the assistant's prose",
  );
  const uiAction = events.find((e) => e.type === "ui_action") as
    | Extract<AssistantEvent, { type: "ui_action" }>
    | undefined;
  assert.ok(uiAction, "a ui_action event persisted");
  assert.equal(uiAction?.action, "open_run_turn");
  // Only { action, params } are relayed — route/label are NOT re-sent over the wire event (the client
  // re-derives them from the shared registry).
  assert.deepEqual(uiAction?.params, { runId: "r-1", turnIndex: 2 });
  assert.equal((uiAction as unknown as { route?: unknown }).route, undefined);
});

const uiToolErrorScript: TurnScript = ({ emit, turn }) => {
  emit({
    type: "tool_call",
    toolUseId: "tu-ui-2",
    toolName: "ui_navigate",
    input: { view: "bogus" },
  });
  emit({
    type: "tool_result",
    toolUseId: "tu-ui-2",
    result: [{ type: "text", text: JSON.stringify({ error: 'Unknown view "bogus".' }) }],
    isError: true,
  });
  emit({ type: "assistant_message", text: "That view doesn't exist." });
  emit({ type: "turn_done", turnIndex: turn });
};

test("a FAILED ui_* tool result never settles a ui_action event — the browser never moves on a bad target", async () => {
  const h = makeHarness(uiToolErrorScript);
  const thread = h.manager.createThread({});
  await h.manager.sendMessage(thread.id, "go to bogus");
  await waitFor(() => h.repo.listEvents(thread.id).some((e) => e.type === "turn_done"));

  const events = h.repo.listEvents(thread.id);
  assert.ok(
    !events.some((e) => e.type === "ui_action"),
    "no ui_action event for an errored ui_* call",
  );
});

test("a non-ui tool's result never settles a ui_action event, even if its payload happens to look similar", async () => {
  // Defensive: a READ tool result is never mistaken for a ui_action just because it parses as JSON —
  // the `ui_` name-prefix gate runs first.
  const lookalikeScript: TurnScript = ({ emit, turn }) => {
    emit({ type: "tool_call", toolUseId: "tu-3", toolName: "runs_get", input: { runId: "r-1" } });
    emit({
      type: "tool_result",
      toolUseId: "tu-3",
      result: [{ type: "text", text: JSON.stringify({ action: "not_really_ui", params: {} }) }],
      isError: false,
    });
    emit({ type: "turn_done", turnIndex: turn });
  };
  const h = makeHarness(lookalikeScript);
  const thread = h.manager.createThread({});
  await h.manager.sendMessage(thread.id, "hi");
  await waitFor(() => h.repo.listEvents(thread.id).some((e) => e.type === "turn_done"));

  const events = h.repo.listEvents(thread.id);
  assert.ok(
    !events.some((e) => e.type === "ui_action"),
    "no ui_action for a non-ui_-prefixed tool",
  );
});

test("park after idle → resume: the parked child is killed, then the next message resumes via sdkSessionId", async () => {
  const h = makeHarness(echoScript, { idleTimeoutMs: 30 });
  const thread = h.manager.createThread({});

  await h.manager.sendMessage(thread.id, "first");
  await waitFor(() => h.repo.listEvents(thread.id).some((e) => e.type === "turn_done"));

  // The session id was persisted from the SDK init, and the thread is idle (turn settled).
  const afterTurn = h.repo.getThread(thread.id);
  assert.equal(afterTurn.status, "idle", "thread is idle after the turn settled");
  assert.equal(afterTurn.sdkSessionId, "sdk-sess-1", "the SDK session id was persisted for resume");

  // After the idle timeout the child is parked (killed) — the live session is dropped.
  await waitFor(() => !h.manager.isLive(thread.id));
  assert.equal(h.manager.isLive(thread.id), false, "the idle session was parked (child killed)");
  // Parking keeps the thread idle + its session id (resumable), never flips it to error.
  const parked = h.repo.getThread(thread.id);
  assert.equal(parked.status, "idle");
  assert.equal(parked.sdkSessionId, "sdk-sess-1", "the parked session id is retained for resume");

  // The next message starts a FRESH child that RESUMES the persisted session.
  await h.manager.sendMessage(thread.id, "second");
  await waitFor(() => h.driver.starts.length === 2);
  assert.equal(h.driver.starts.length, 2, "a new child was started after the park");
  assert.equal(
    h.driver.starts[1]?.startOptions.resume,
    "sdk-sess-1",
    "the resumed child was started with the parked SDK session id",
  );
});

test("stop interrupts the in-flight turn and settles it (thread returns to idle)", async () => {
  // A script that streams a delta but NEVER settles the turn on its own — only `interrupt()` ends it.
  const stallScript: TurnScript = ({ emit }) => {
    emit({ type: "assistant_delta", text: "thinking…" });
  };
  const h = makeHarness(stallScript);
  const thread = h.manager.createThread({});
  await h.manager.sendMessage(thread.id, "go");
  await waitFor(() => h.manager.isLive(thread.id));
  assert.equal(h.repo.getThread(thread.id).status, "running", "the turn is in flight before stop");

  h.manager.stop(thread.id);
  await waitFor(() => h.repo.getThread(thread.id).status === "idle");
  assert.equal(h.driver.starts[0]?.interruptCount, 1, "stop called the driver's interrupt once");
  assert.equal(
    h.repo.getThread(thread.id).status,
    "idle",
    "the interrupted turn settled the thread to idle",
  );
  assert.ok(
    h.repo.listEvents(thread.id).some((e) => e.type === "turn_done"),
    "interrupt produced a settled turn_done",
  );
  // R2.2 — stop still PARKS: the interrupt's settling turn_done drives the same release path, so the
  // session frees its cap slot (and resumes on the next message via its retained sdkSessionId).
  await waitFor(() => !h.manager.isLive(thread.id));
  assert.equal(
    h.manager.isLive(thread.id),
    false,
    "the stopped turn released the session (cap slot freed)",
  );
  assert.equal(
    h.repo.getThread(thread.id).sdkSessionId,
    "sdk-sess-1",
    "the session id is retained for resume",
  );
});

test("active-session cap: a message that would exceed the max active sessions is rejected with 409", async () => {
  // R2.2 — under release-on-reply a COMPLETED turn frees its slot, so the cap only bites while a turn is
  // actually in flight. A stall script (no `turn_done`) keeps thread A's session running, holding the
  // only slot, so B's send trips the cap 409.
  const stallScript: TurnScript = ({ emit }) => {
    emit({ type: "assistant_delta", text: "thinking…" });
  };
  const h = makeHarness(stallScript, { maxActiveSessions: 1, idleTimeoutMs: 60_000 });
  const a = h.manager.createThread({ title: "A" });
  const b = h.manager.createThread({ title: "B" });

  await h.manager.sendMessage(a.id, "hello");
  await waitFor(() => h.manager.isLive(a.id));

  await assert.rejects(
    () => h.manager.sendMessage(b.id, "hello too"),
    (error: unknown) => {
      assert.equal((error as { statusCode?: number }).statusCode, 409);
      assert.match((error as Error).message, /already running/i);
      return true;
    },
  );
  // The rejected thread never started a child and persisted no user message.
  assert.equal(h.manager.isLive(b.id), false, "the capped thread has no live session");
  assert.equal(h.repo.listEvents(b.id).length, 0, "the capped thread persisted nothing");
});

test("startup orphan reconciliation: a thread left `running` is reset to idle + gets a synthesized error event", () => {
  const h = makeHarness(echoScript);
  const thread = h.manager.createThread({});
  // Simulate a crash mid-turn: the row is `running` (its in-memory child is gone after restart).
  h.repo.setSessionState(thread.id, { status: "running", sdkSessionId: "sdk-sess-orphan" });

  const reconciled = h.repo.reconcileOrphanThreads();
  assert.equal(reconciled, 1, "one orphaned running thread reconciled");

  const after = h.repo.getThread(thread.id);
  assert.equal(after.status, "idle", "the orphaned thread is reset to idle");
  assert.equal(
    after.sdkSessionId,
    "sdk-sess-orphan",
    "its parked session id is retained (resumable)",
  );
  const events = h.repo.listEvents(thread.id);
  const last = events.at(-1);
  assert.equal(last?.type, "error", "a synthesized error event was appended");
  assert.match((last as { message: string }).message, /interrupted by a server restart/i);
  // A thread that was NOT running is untouched.
  const idleThread = h.manager.createThread({});
  assert.equal(
    h.repo.reconcileOrphanThreads(),
    0,
    "nothing to reconcile when no thread is running",
  );
  assert.equal(h.repo.listEvents(idleThread.id).length, 0);
});

test("no auth source configured → the auth gate + messaging both reject with 409", async () => {
  const h = makeHarness(echoScript, {}, { signIn: false });
  assert.equal(h.manager.isAuthConfigured(), false, "nothing configured");
  assert.throws(
    () => h.manager.assertConfigured(),
    (error: unknown) => (error as { statusCode?: number }).statusCode === 409,
  );
  const thread = h.manager.createThread({}); // thread rows can still be created (repo-level)
  await assert.rejects(
    () => h.manager.sendMessage(thread.id, "hi"),
    (error: unknown) => {
      assert.equal((error as { statusCode?: number }).statusCode, 409);
      return true;
    },
    "sending on a subscription thread with no credential is a 409",
  );
});

test("delete while streaming: detach drops the live session and later events never resurrect the row", async () => {
  const stallScript: TurnScript = ({ emit }) => {
    emit({ type: "assistant_delta", text: "working…" });
    // no turn_done — the turn is still 'in flight' when we delete
  };
  const h = makeHarness(stallScript);
  const thread = h.manager.createThread({});
  await h.manager.sendMessage(thread.id, "go");
  await waitFor(() => h.manager.isLive(thread.id));

  h.manager.deleteThread(thread.id);
  assert.equal(h.manager.isLive(thread.id), false, "the live session was detached on delete");
  // The row (and its cascaded events) are gone and stay gone.
  assert.throws(
    () => h.repo.getThread(thread.id),
    (e: unknown) => (e as { statusCode?: number }).statusCode === 404,
  );

  // Give the aborted fake session a beat to wind down; the detached pump must persist nothing more, so
  // the deleted thread's row can't be resurrected by a late event.
  await delay(30);
  const rows = h.db
    .prepare("SELECT COUNT(*) AS n FROM assistant_events WHERE thread_id = ?")
    .get(thread.id) as { n: number };
  assert.equal(rows.n, 0, "no events persisted for the deleted thread");
});

// ── WP 3.3 — the driver's limit_error `kind` threads through to the persisted event ────────────────

test("a limit_error event carries the driver's auth-vs-rate_limit kind through to the persisted event", async () => {
  const h = makeHarness(authLimitScript);
  const thread = h.manager.createThread({});
  await h.manager.sendMessage(thread.id, "hi");
  await waitFor(() => h.repo.listEvents(thread.id).some((e) => e.type === "turn_done"));

  const limitError = h.repo.listEvents(thread.id).find((e) => e.type === "limit_error") as
    | Extract<AssistantEvent, { type: "limit_error" }>
    | undefined;
  assert.ok(limitError, "a limit_error event persisted");
  assert.equal(limitError?.kind, "auth");
  assert.equal(limitError?.source, "subscription");
  assert.equal(
    h.repo.getThread(thread.id).status,
    "error",
    "the thread stays in error after settling",
  );
});

// ── WP 3.3 — retry-source (D-AS14): the ONLY way authSource ever changes is the explicit action ────

test("a normal sendMessage NEVER changes authSource, even across many turns and an error", async () => {
  const h = makeHarness(authLimitScript);
  const thread = h.manager.createThread({});
  assert.equal(thread.authSource, "subscription");

  await h.manager.sendMessage(thread.id, "first");
  await waitFor(() => h.repo.listEvents(thread.id).some((e) => e.type === "turn_done"));
  assert.equal(
    h.repo.getThread(thread.id).authSource,
    "subscription",
    "unchanged after an errored turn",
  );

  await h.manager.sendMessage(thread.id, "second");
  await waitFor(
    () => h.repo.listEvents(thread.id).filter((e) => e.type === "turn_done").length === 2,
  );
  assert.equal(
    h.repo.getThread(thread.id).authSource,
    "subscription",
    "unchanged after a second turn too",
  );
  assert.ok(
    !h.repo.listEvents(thread.id).some((e) => e.type === "source_switch"),
    "no source_switch event was ever recorded — only the explicit action records one",
  );
});

test("retrySource 400s when the target already matches the thread's current source", async () => {
  const h = makeHarness(echoScript);
  const thread = h.manager.createThread({});
  await assert.rejects(
    () => h.manager.retrySource(thread.id, "subscription"),
    (error: unknown) => {
      assert.equal((error as { statusCode?: number }).statusCode, 400);
      return true;
    },
  );
});

test("retrySource 409s when the target source isn't configured — and changes nothing", async () => {
  const h = makeHarness(echoScript); // signed in (subscription), no fallback configured
  const thread = h.manager.createThread({});
  await assert.rejects(
    () => h.manager.retrySource(thread.id, "api_key"),
    (error: unknown) => {
      assert.equal((error as { statusCode?: number }).statusCode, 409);
      return true;
    },
  );
  assert.equal(
    h.repo.getThread(thread.id).authSource,
    "subscription",
    "rejected attempt changed nothing",
  );
  assert.ok(!h.repo.listEvents(thread.id).some((e) => e.type === "source_switch"));
});

test("retrySource: switches the persisted authSource, records a settled source_switch event, tears down the old session, and starts a NEW one whose spawn env carries EXACTLY the api-key var", async () => {
  const h = makeHarness(authLimitScript);
  withFallback(h);
  const thread = h.manager.createThread({});

  await h.manager.sendMessage(thread.id, "please read the run");
  await waitFor(() => h.repo.listEvents(thread.id).some((e) => e.type === "turn_done"));
  assert.equal(h.repo.getThread(thread.id).status, "error");
  assert.equal(h.driver.starts.length, 1, "one session started so far, on the subscription source");
  assert.deepEqual(
    Object.keys(h.driver.starts[0]!.startOptions.env).sort(),
    ["CLAUDE_CODE_OAUTH_TOKEN", "HOME", "CLAUDE_CONFIG_DIR", "PATH"].sort(),
  );

  const updated = await h.manager.retrySource(thread.id, "api_key");
  assert.equal(updated.authSource, "api_key", "the returned thread reflects the switched source");
  assert.equal(h.repo.getThread(thread.id).authSource, "api_key", "persisted authSource flipped");

  const events = h.repo.listEvents(thread.id);
  const sourceSwitch = events.find((e) => e.type === "source_switch") as
    | Extract<AssistantEvent, { type: "source_switch" }>
    | undefined;
  assert.ok(sourceSwitch, "a settled source_switch event was recorded");
  assert.equal(sourceSwitch?.from, "subscription");
  assert.equal(sourceSwitch?.to, "api_key");

  // The retry re-sent the last user message — a SECOND user_message + a SECOND session (the old one
  // was torn down, not reused; the resume was attempted, but a fresh child was still spawned).
  const userMessages = events.filter((e) => e.type === "user_message");
  assert.equal(userMessages.length, 2, "the last user message was re-sent");
  assert.equal((userMessages[1] as { text: string }).text, "please read the run");

  await waitFor(() => h.driver.starts.length === 2);
  const retried = h.driver.starts[1]!;
  const envKeys = Object.keys(retried.startOptions.env);
  assert.ok(
    envKeys.includes("ANTHROPIC_API_KEY"),
    "the retried session's spawn env carries the api key",
  );
  assert.ok(
    !envKeys.includes("CLAUDE_CODE_OAUTH_TOKEN"),
    "…and NOT the subscription token — exactly one auth var",
  );
  // D-AS6 resume: the persisted sdkSessionId from the FIRST session is still what a fresh start offers
  // to resume (this app makes no auth-source special case — see retrySource's doc comment).
  assert.equal(retried.startOptions.resume, "sdk-sess-1");
});

test("retrySource with no prior user message just switches the source (nothing to resend)", async () => {
  const h = makeHarness(echoScript);
  withFallback(h);
  const thread = h.manager.createThread({});
  assert.equal(h.repo.listEvents(thread.id).length, 0, "a fresh thread has no messages yet");

  const updated = await h.manager.retrySource(thread.id, "api_key");
  assert.equal(updated.authSource, "api_key");
  assert.equal(h.driver.starts.length, 0, "no session was started — nothing to retry");
  const events = h.repo.listEvents(thread.id);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, "source_switch");
});

test("retrySource on an unknown thread 404s", async () => {
  const h = makeHarness(echoScript);
  await assert.rejects(
    () => h.manager.retrySource("nope", "api_key"),
    (error: unknown) => (error as { statusCode?: number }).statusCode === 404,
  );
});

// ── Refinement R2.2 (D-AS25) — release-on-reply lifecycle ──────────────────────────────────────────

test("release-on-reply (D-AS25): a completed turn releases the session + frees the cap slot immediately", async () => {
  const h = makeHarness(echoScript, { maxActiveSessions: 1 });
  const a = h.manager.createThread({});
  const b = h.manager.createThread({});

  await h.manager.sendMessage(a.id, "hi");
  await waitFor(() => h.repo.listEvents(a.id).some((e) => e.type === "turn_done"));
  await waitFor(() => !h.manager.isLive(a.id));
  assert.equal(h.manager.isLive(a.id), false, "A's session released the moment its turn completed");

  // The cap is 1 and A is released → B starts without a 409.
  await h.manager.sendMessage(b.id, "yo");
  await waitFor(() => h.repo.listEvents(b.id).some((e) => e.type === "turn_done"));
  assert.ok(
    h.repo.listEvents(b.id).some((e) => e.type === "turn_done"),
    "B ran under cap 1 after A released",
  );
});

test("release-on-reply: the next message resumes via resume: sdkSessionId", async () => {
  const h = makeHarness(echoScript);
  const thread = h.manager.createThread({});

  await h.manager.sendMessage(thread.id, "first");
  await waitFor(() => !h.manager.isLive(thread.id));
  assert.equal(
    h.repo.getThread(thread.id).sdkSessionId,
    "sdk-sess-1",
    "the SDK session id is retained after release",
  );

  await h.manager.sendMessage(thread.id, "second");
  await waitFor(() => h.driver.starts.length === 2);
  assert.equal(
    h.driver.starts[1]?.startOptions.resume,
    "sdk-sess-1",
    "the follow-up resumes the released session id",
  );
});

test("release-on-reply: several quick sequential threads no longer hit the cap 409", async () => {
  const h = makeHarness(echoScript, { maxActiveSessions: 1 });
  for (let i = 0; i < 4; i += 1) {
    const t = h.manager.createThread({});
    // None of these throw a 409 — each prior thread released as its turn completed.
    await h.manager.sendMessage(t.id, `message ${i}`);
    await waitFor(() => h.repo.listEvents(t.id).some((e) => e.type === "turn_done"));
    await waitFor(() => !h.manager.isLive(t.id));
  }
  assert.ok(true, "four quick threads each ran and released under cap 1 with no 409");
});

test("wedge closed (D-AS25): a limit_error with NO following turn_done still releases the session + frees the slot", async () => {
  // The driver emits a limit_error and then goes silent — no turn_done, stream never ends on its own.
  const limitNoDone: TurnScript = ({ emit }) => {
    emit({ type: "limit_error", message: "hit a usage limit", kind: "rate_limit" });
  };
  const h = makeHarness(limitNoDone, { maxActiveSessions: 1 });
  const a = h.manager.createThread({});

  await h.manager.sendMessage(a.id, "hi");
  await waitFor(() => h.repo.listEvents(a.id).some((e) => e.type === "limit_error"));
  await waitFor(() => !h.manager.isLive(a.id));
  assert.equal(h.manager.isLive(a.id), false, "the session released despite no turn_done");
  assert.equal(h.repo.getThread(a.id).status, "error", "the thread is left in error");

  // The slot is freed under cap 1 — a second thread can send (it errors too, but never 409s on a wedge).
  const b = h.manager.createThread({});
  await h.manager.sendMessage(b.id, "hi too");
  await waitFor(() => h.repo.listEvents(b.id).some((e) => e.type === "limit_error"));
  assert.ok(true, "B was not blocked by a wedged A session");
});

test("wedge closed: an error with NO following turn_done still releases the session", async () => {
  const errNoDone: TurnScript = ({ emit }) => {
    emit({ type: "error", message: "boom" });
  };
  const h = makeHarness(errNoDone, { maxActiveSessions: 1 });
  const a = h.manager.createThread({});

  await h.manager.sendMessage(a.id, "hi");
  await waitFor(() => h.repo.listEvents(a.id).some((e) => e.type === "error"));
  await waitFor(() => !h.manager.isLive(a.id));
  assert.equal(h.manager.isLive(a.id), false, "the errored session released without a turn_done");
  assert.equal(h.repo.getThread(a.id).status, "error");
});

test("SSE (D-AS25): a subscriber stays connected across release + resume and receives the resumed turn's events", async () => {
  const h = makeHarness(echoScript);
  const thread = h.manager.createThread({});
  const frames: AssistantStreamFrame[] = [];
  let closed = false;
  const unsub = h.manager.subscribe(
    thread.id,
    (frame) => frames.push(frame),
    () => {
      closed = true;
    },
  );

  await h.manager.sendMessage(thread.id, "first");
  await waitFor(() => frames.filter((f) => f.type === "turn_done").length === 1);
  await waitFor(() => !h.manager.isLive(thread.id)); // released
  assert.equal(
    closed,
    false,
    "release did not close the SSE subscription (the channel is thread-level)",
  );

  await h.manager.sendMessage(thread.id, "second");
  await waitFor(() => frames.filter((f) => f.type === "turn_done").length === 2);
  assert.equal(
    frames.filter((f) => f.type === "user_message").length,
    2,
    "both turns' events reached the same subscriber across the release/resume boundary",
  );
  assert.equal(closed, false, "the subscriber only closes on thread delete, not on release");
  unsub();
});

// ── Refinement R2.2 (D-AS26) — deterministic auto-title ───────────────────────────────────────────

test("auto-title (D-AS26): the first user message sets a deterministic title (only when still the default)", async () => {
  const h = makeHarness(echoScript);
  const thread = h.manager.createThread({});
  assert.equal(thread.title, "New thread", "a fresh thread starts at the default title");

  await h.manager.sendMessage(thread.id, "How many tools does the Qlik server expose?");
  const titled = h.repo.getThread(thread.id);
  assert.notEqual(titled.title, "New thread", "the first message set a real title");
  assert.ok(titled.title.length <= 60, "the deterministic title is capped at 60 chars");
  assert.match(titled.title, /Qlik/, "the title is derived from the message text");
});

test("auto-title: a user-renamed thread is never overwritten by the deterministic title", async () => {
  const h = makeHarness(echoScript);
  const thread = h.manager.createThread({});
  h.repo.updateThread(thread.id, { title: "My analysis" });
  await h.manager.sendMessage(thread.id, "some other message text entirely");
  assert.equal(h.repo.getThread(thread.id).title, "My analysis", "the rename stands");
});

test("auto-title: a thread created with an explicit title keeps it (titling only fills the default)", async () => {
  const h = makeHarness(echoScript);
  const thread = h.manager.createThread({ title: "Given name" });
  await h.manager.sendMessage(thread.id, "hello there");
  assert.equal(h.repo.getThread(thread.id).title, "Given name");
});

test("auto-title: never re-applied after the first message (the first-message signal is log-derived)", async () => {
  const h = makeHarness(echoScript);
  const thread = h.manager.createThread({});
  await h.manager.sendMessage(thread.id, "First question about tools");
  await waitFor(() => !h.manager.isLive(thread.id));
  const afterFirst = h.repo.getThread(thread.id).title;
  assert.notEqual(afterFirst, "New thread");

  // Rename back to the default to try to trick the guard — a prior user_message must still block a re-title.
  h.repo.updateThread(thread.id, { title: "New thread" });
  await h.manager.sendMessage(thread.id, "A completely different second question");
  assert.equal(
    h.repo.getThread(thread.id).title,
    "New thread",
    "no re-title: a prior user_message already exists",
  );
});

test("updated_at is bumped on send (so the switcher's ordering + relative age stay fresh)", async () => {
  const h = makeHarness(echoScript);
  const thread = h.manager.createThread({});
  // Backdate the row so any bump is unambiguous.
  h.db
    .prepare("UPDATE assistant_threads SET updated_at = ? WHERE id = ?")
    .run("2000-01-01T00:00:00.000Z", thread.id);

  await h.manager.sendMessage(thread.id, "hi");
  assert.notEqual(
    h.repo.getThread(thread.id).updatedAt,
    "2000-01-01T00:00:00.000Z",
    "the send refreshed updated_at",
  );
});

// ── Refinement R2.2 (D-AS26) — best-effort LLM-refined title one-shot ─────────────────────────────

// A main-session script that ALSO answers the title one-shot (routed by its `maxTurns: 1`).
const titleRefineScript: TurnScript = ({ text, turn, emit, options }) => {
  if (options.maxTurns === 1) {
    emit({ type: "assistant_message", text: "Qlik tool count" });
    emit({ type: "turn_done", turnIndex: 0 });
    return;
  }
  emit({ type: "assistant_message", text: `answer-${turn}:${text}` });
  emit({ type: "turn_done", turnIndex: turn });
};

// Same, but the title one-shot HANGS (never replies) so it relies on the hard timeout → fallback.
const titleHangScript: TurnScript = ({ text, turn, emit, options }) => {
  if (options.maxTurns === 1) return; // one-shot hangs → hits the hard timeout
  emit({ type: "assistant_message", text: `answer-${turn}:${text}` });
  emit({ type: "turn_done", turnIndex: turn });
};

test("auto-title refine (D-AS26): after the first successful turn a NON-cap-counted one-shot refines the title", async () => {
  const h = makeHarness(titleRefineScript, { autoTitle: true });
  const thread = h.manager.createThread({});

  await h.manager.sendMessage(thread.id, "How many tools does the Qlik server expose?");
  // The deterministic title lands immediately on send…
  assert.notEqual(
    h.repo.getThread(thread.id).title,
    "New thread",
    "the deterministic title is set on send",
  );
  // …then the one-shot refines it after the turn completes.
  await waitFor(() => h.repo.getThread(thread.id).title === "Qlik tool count");
  assert.equal(
    h.repo.getThread(thread.id).title,
    "Qlik tool count",
    "the refined title was PATCHed",
  );

  // The one-shot is a SECOND driver start, but it never entered the live map / the cap.
  await waitFor(() => h.driver.starts.length === 2);
  assert.equal(
    h.manager.isLive(thread.id),
    false,
    "the one-shot is not registered as the thread's live session",
  );
});

test("auto-title refine: the one-shot occupies no cap slot, and a timeout keeps the deterministic title", async () => {
  const h = makeHarness(titleHangScript, {
    autoTitle: true,
    maxActiveSessions: 1,
    titleTimeoutMs: 40,
  });
  const a = h.manager.createThread({});

  await h.manager.sendMessage(a.id, "first message about the servers list");
  await waitFor(() => h.repo.listEvents(a.id).some((e) => e.type === "turn_done"));
  // The main session released; the hanging one-shot started (start #2) but is NOT in the live map.
  await waitFor(() => h.driver.starts.length === 2);
  assert.equal(h.manager.isLive(a.id), false, "the one-shot holds no live-session entry");

  // Under cap 1, a real session on B still starts — proving the one-shot occupies no cap slot.
  const b = h.manager.createThread({});
  await h.manager.sendMessage(b.id, "second thread entirely");
  await waitFor(() => h.repo.listEvents(b.id).some((e) => e.type === "turn_done"));

  // The one-shot never replied → the hard timeout aborts it → the deterministic title stands.
  await waitFor(() => h.driver.starts[1]?.startOptions.abortController.signal.aborted === true);
  assert.equal(
    h.repo.getThread(a.id).title,
    deterministicTitle("first message about the servers list"),
    "the timed-out one-shot kept the deterministic title",
  );
});

test("auto-title refine: with the feature flag off, no title one-shot is attempted", async () => {
  const h = makeHarness(titleRefineScript, { autoTitle: false });
  const thread = h.manager.createThread({});

  await h.manager.sendMessage(thread.id, "How many tools does the Qlik server expose?");
  await waitFor(() => h.repo.listEvents(thread.id).some((e) => e.type === "turn_done"));
  await waitFor(() => !h.manager.isLive(thread.id));
  await delay(20); // give any (erroneous) refine a chance to have started

  assert.equal(h.driver.starts.length, 1, "no title one-shot when autoTitle is off");
  assert.equal(
    h.repo.getThread(thread.id).title,
    deterministicTitle("How many tools does the Qlik server expose?"),
    "the deterministic title stands (no refine)",
  );
});
