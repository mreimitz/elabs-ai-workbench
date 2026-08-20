// Assistant Hub (planning/Roadmap/RM-03-assistant-hub/, WP1.5, §1.5 / D-AH3 / D-AH17) — the `claude_subscription`
// turn executor, exercised ENTIRELY through a SCRIPTED FAKE `AgentSessionDriver` + a stub auth resolver
// + a fake throwaway-workspace factory (the SAME DI-seam discipline `claude-subscription-executor.test.ts`
// uses). NO SDK is imported, NO child is spawned, NO Anthropic call is made, and the real filesystem is
// never touched.
//
// Proves (per-Acceptance): a queued phase (with 1-based position) is emitted under semaphore contention,
// then clears to `starting`; an uncontended acquire emits neither; exact tokens/usage come straight from
// the driver's `turn_done.usage`; the shadow cost is marked `costBasis: "subscription_reference"`
// (D-AH17); a driver `limit_error` (auth or rate_limit) surfaces a `limit_error` Hub event with the
// retry-on-other-source options; `abortSignal` (Stop) preserves the partial reply with an explicit
// cut-off note; only SETTLED events are persisted (deltas are forwarded live and never land in
// `hub_events`); and a steering message queued mid-run is injected as its own turn on the same warm
// child (R-SES3).

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import type { HubEvent, HubSession, HubTextPart } from "@mcp-token-footprint/shared";
import type {
  AgentSessionDriver,
  DriverEvent,
  DriverSession,
  DriverStartOptions,
  DriverUserMessage,
} from "../src/assistant/session-driver.js";
import type { AssistantAuthSource } from "../src/assistant/spawn-env.js";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import {
  createHubSubscriptionAdapter,
  HUB_SUBSCRIPTION_DISALLOWED_TOOLS,
} from "../src/hub/subscription-adapter.js";
import { HubRepository } from "../src/hub/repository.js";
import {
  HubSteeringQueue,
  retrySourcesFor,
  type HubStreamDelta,
  type HubTurnSink,
} from "../src/hub/turn-engine.js";
import {
  SUBSCRIPTION_DISALLOWED_TOOLS,
  type CreateThrowawayWorkspace,
} from "../src/testing/claude-subscription-executor.js";
import type { SessionClockTime } from "../src/testing/session-clock.js";
import { AsyncSemaphore, type ConcurrencyGate } from "../src/testing/subscription-concurrency.js";

// ── A tiny pushable async iterable (the fake's normalized event stream) — SDK-free, mirrors
//    claude-subscription-executor.test.ts's identical helper. ──────────────────────────────────────
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
        return new Promise<IteratorResult<T>>((resolve) => this.waiters.push(resolve));
      },
    };
  }
}

class FakeSession implements DriverSession {
  readonly out = new Pushable<DriverEvent>();
  readonly sent: string[] = [];
  readonly options: DriverStartOptions;
  /** Test hook: invoked on every `send()` so a turn's events can be scripted in response. */
  onSend?: (text: string, session: FakeSession) => void;
  constructor(options: DriverStartOptions) {
    this.options = options;
    this.out.push({ type: "session", sessionId: "sess-fake" });
    options.abortController.signal.addEventListener("abort", () => this.out.end(), { once: true });
  }
  get events(): AsyncIterable<DriverEvent> {
    return this.out;
  }
  send(message: DriverUserMessage): void {
    this.sent.push(message.text);
    this.onSend?.(message.text, this);
  }
  async interrupt(): Promise<void> {}
  sessionId(): string | undefined {
    return "sess-fake";
  }
  emit(event: DriverEvent): void {
    this.out.push(event);
  }
}

class FakeDriver implements AgentSessionDriver {
  readonly sessions: FakeSession[] = [];
  onStart?: (session: FakeSession) => void;
  onSend?: (text: string, session: FakeSession) => void;
  start(options: DriverStartOptions): DriverSession {
    const session = new FakeSession(options);
    session.onSend = this.onSend;
    this.sessions.push(session);
    this.onStart?.(session);
    return session;
  }
  async supportedModels(): Promise<never[]> {
    return [];
  }
}

// ── Shared fixtures ──────────────────────────────────────────────────────────────────────────────
const AUTH: AssistantAuthSource = { kind: "claude_oauth", token: "sk-ant-oat01-fake-1234" };
const MODEL = "claude-sonnet-4-5";
const USAGE: DriverEvent = {
  type: "turn_done",
  usage: {
    inputTokens: 100,
    outputTokens: 40,
    cacheReadInputTokens: 20,
    cacheCreationInputTokens: 5,
  },
};

function fakeWorkspaces(): {
  create: CreateThrowawayWorkspace;
  dirs: string[];
  cleanups: () => number;
} {
  const dirs: string[] = [];
  let cleanups = 0;
  const create: CreateThrowawayWorkspace = async () => {
    const dir = `/fake/tmp/ws-${dirs.length}`;
    dirs.push(dir);
    return {
      dir,
      cleanup: async () => {
        cleanups += 1;
      },
    };
  };
  return { create, dirs, cleanups: () => cleanups };
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const databases: AppDatabase[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function openRepo(): HubRepository {
  const db = new Database(":memory:") as unknown as AppDatabase;
  databases.push(db);
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  return new HubRepository(db);
}

/** Create a chat session and persist its opener `user_message` (what the session-service does before
 *  dispatching to the subscription executor), returning the fresh session snapshot. */
function seedSession(repo: HubRepository, text: string, model = MODEL): HubSession {
  const session = repo.createSession({ mode: "chat", model });
  repo.appendEvent(session.id, { type: "user_message", messageId: "u1", text });
  return repo.getSession(session.id);
}

function collectSink(): {
  sink: HubTurnSink;
  events: HubEvent[];
  deltas: HubStreamDelta[];
  state: { onDelta?: (delta: HubStreamDelta) => void };
} {
  const events: HubEvent[] = [];
  const deltas: HubStreamDelta[] = [];
  const state: { onDelta?: (delta: HubStreamDelta) => void } = {};
  const sink: HubTurnSink = {
    onEvent: (e) => events.push(e),
    onDelta: (d) => {
      deltas.push(d);
      state.onDelta?.(d);
    },
  };
  return { sink, events, deltas, state };
}

function textOf(parts: readonly { type: string }[]): string {
  return parts
    .filter((p): p is HubTextPart => p.type === "text")
    .map((p) => p.text)
    .join("");
}

function phases(events: HubEvent[]) {
  return events.filter((e): e is Extract<HubEvent, { type: "phase" }> => e.type === "phase");
}

// ── (1) full turn: exact tokens + shadow cost marked per D-AH17 ─────────────────────────────────────

test("a full turn drives the warm child, persists exact tokens, and marks the shadow cost per D-AH17", async () => {
  const repo = openRepo();
  const session = seedSession(repo, "What is the capital of France?");
  const { sink, events, deltas } = collectSink();
  const steering = new HubSteeringQueue(session.id, repo);
  const workspaces = fakeWorkspaces();
  const driver = new FakeDriver();
  driver.onStart = (s) => {
    s.onSend = () => {
      s.emit({ type: "assistant_delta", text: "The capital of France " });
      s.emit({ type: "assistant_delta", text: "is Paris." });
      s.emit({ type: "assistant_message", text: "The capital of France is Paris." });
      s.emit(USAGE);
    };
  };

  const executor = createHubSubscriptionAdapter({
    repository: repo,
    driver,
    resolveAuth: () => AUTH,
    concurrency: new AsyncSemaphore(1),
    createWorkspace: workspaces.create,
  });

  const result = await executor({
    session,
    modelId: MODEL,
    abortSignal: new AbortController().signal,
    steering,
    sink,
  });

  assert.equal(result.status, "completed");
  assert.equal(result.outcome, "completed");
  assert.equal(result.completed, true);
  // EXACT tokens straight from turn_done.usage — includes the cache slice (D-CS4 convention).
  assert.equal(result.tokensIn, 100 + 20 + 5);
  assert.equal(result.tokensOut, 40);
  assert.ok(result.costUsd > 0, "a priced model yields a non-zero shadow cost");

  // Deltas were forwarded live…
  assert.equal(deltas.map((d) => d.text).join(""), "The capital of France is Paris.");
  // …but the persisted log holds SETTLED events only — no delta ever lands in hub_events.
  const persisted = repo.listEvents(session.id);
  assert.ok(!persisted.some((e) => (e as { type: string }).type === "assistant_delta"));

  const am = persisted.find(
    (e): e is Extract<HubEvent, { type: "assistant_message" }> => e.type === "assistant_message",
  );
  assert.ok(am);
  assert.equal(textOf(am.parts), "The capital of France is Paris.");
  assert.equal(am.model, MODEL);
  assert.equal(am.costBasis, "subscription_reference", "D-AH17 shadow-cost marker");
  assert.ok(am.costUsd && am.costUsd > 0);
  assert.equal(am.usage?.tokensIn, 125);
  assert.equal(am.usage?.tokensOut, 40);
  assert.equal(am.citations.length, 0);

  const turnDone = persisted.find(
    (e): e is Extract<HubEvent, { type: "turn_done" }> => e.type === "turn_done",
  );
  assert.ok(turnDone);
  assert.equal(turnDone.costBasis, "subscription_reference");

  // Session lifecycle folded the turn's totals; capability manifest persisted; workspace torn down.
  const finalSession = repo.getSession(session.id);
  assert.equal(finalSession.status, "completed");
  assert.equal(finalSession.tokensIn, 125);
  assert.equal(finalSession.tokensOut, 40);
  assert.ok(finalSession.capabilities);
  assert.equal(workspaces.cleanups(), 1, "the throwaway workspace was cleaned up exactly once");

  // No queued/starting phase for an uncontended acquire — only the running→null clear (mirrors the
  // Testing executor's adversarially-locked behavior).
  assert.deepEqual(
    phases(events).map((p) => p.phase),
    [null],
  );
});

// ── (2) queued phase (with position) under contention, then clears to starting ──────────────────────

test("queued phase (with 1-based position) is emitted under semaphore contention, then clears to starting", async () => {
  const repo = openRepo();
  const sessionA = seedSession(repo, "Run A.");
  const sessionB = seedSession(repo, "Run B.");
  const a = collectSink();
  const b = collectSink();
  const steeringA = new HubSteeringQueue(sessionA.id, repo);
  const steeringB = new HubSteeringQueue(sessionB.id, repo);
  const gate: ConcurrencyGate = new AsyncSemaphore(1);
  const driver = new FakeDriver(); // manual scripting — do NOT auto-complete

  const executor = createHubSubscriptionAdapter({
    repository: repo,
    driver,
    resolveAuth: () => AUTH,
    concurrency: gate,
    createWorkspace: fakeWorkspaces().create,
  });

  // A holds the sole permit — uncontended, so it starts immediately.
  const callA = executor({
    session: sessionA,
    modelId: MODEL,
    abortSignal: new AbortController().signal,
    steering: steeringA,
    sink: a.sink,
  });
  await waitFor(() => driver.sessions.length === 1);
  assert.deepEqual(
    phases(a.events).map((p) => p.phase),
    [null],
  );

  // B is dispatched while A holds the permit — B's acquire WILL queue.
  const callB = executor({
    session: sessionB,
    modelId: MODEL,
    abortSignal: new AbortController().signal,
    steering: steeringB,
    sink: b.sink,
  });
  await waitFor(() => phases(b.events).length > 0);
  assert.deepEqual(
    phases(b.events).map((p) => ({ type: p.type, phase: p.phase, detail: p.detail })),
    [{ type: "phase", phase: "queued", detail: { position: 1 } }],
  );
  assert.equal(
    repo.getSession(sessionB.id).phase,
    "queued",
    "the DB snapshot reflects the queued phase too",
  );

  // Release A (it settles once its child produces turn_done) → B is admitted → queued clears to starting.
  driver.sessions[0]!.emit(USAGE);
  const resultA = await callA;
  await waitFor(() => driver.sessions.length === 2);
  driver.sessions[1]!.emit(USAGE);
  const resultB = await callB;

  assert.equal(resultA.status, "completed");
  assert.equal(resultB.status, "completed");
  const bPhases = phases(b.events);
  assert.equal(bPhases[0]?.phase, "queued");
  assert.equal(bPhases[0]?.detail?.position, 1);
  assert.equal(bPhases[1]?.phase, "starting");
  assert.equal(bPhases[2]?.phase, null);
});

// ── (3) limit error → retry-on-other-source event (D-AH17) ─────────────────────────────────────────

for (const kind of ["rate_limit", "auth"] as const) {
  test(`a driver limit_error (${kind}) surfaces a limit_error event with retry-on-other-source options`, async () => {
    const repo = openRepo();
    const session = seedSession(repo, "Summarize this.");
    const { sink } = collectSink();
    const steering = new HubSteeringQueue(session.id, repo);
    const driver = new FakeDriver();
    driver.onStart = (s) => {
      s.onSend = () => s.emit({ type: "limit_error", message: `hit a ${kind} limit`, kind });
    };

    const executor = createHubSubscriptionAdapter({
      repository: repo,
      driver,
      resolveAuth: () => AUTH,
      concurrency: new AsyncSemaphore(1),
      createWorkspace: fakeWorkspaces().create,
    });

    const result = await executor({
      session,
      modelId: MODEL,
      abortSignal: new AbortController().signal,
      steering,
      sink,
    });

    assert.equal(result.status, "error");
    assert.equal(result.stopReasonCode, kind);

    const events = repo.listEvents(session.id);
    const limit = events.filter(
      (e): e is Extract<HubEvent, { type: "limit_error" }> => e.type === "limit_error",
    );
    assert.equal(limit.length, 1);
    assert.ok(limit[0]?.message.includes(kind));
    assert.equal(limit[0]?.limitKind, kind);
    assert.equal(limit[0]?.provider, "claude_subscription");
    assert.deepEqual(
      limit[0]?.retrySources,
      ["api_key", "other_model"],
      "the OTHER sources to retry on — never a silent switch",
    );
    assert.deepEqual(retrySourcesFor("claude_subscription"), ["api_key", "other_model"]);
    assert.equal(repo.getSession(session.id).status, "error");
    assert.equal(repo.getSession(session.id).stopReasonCode, kind);
  });
}

// ── (4) Stop preserves partial work with an explicit cut-off note (R-SES11) ────────────────────────

test("Stop (abortSignal) cancels the in-flight child turn but preserves the partial reply with a cut-off note", async () => {
  const repo = openRepo();
  const session = seedSession(repo, "Write a long essay.");
  const collector = collectSink();
  const steering = new HubSteeringQueue(session.id, repo);
  const abort = new AbortController();
  const driver = new FakeDriver();
  // Abort the moment the first delta streams (the operator pressing Stop mid-reply) — the child is NEVER
  // told turn_done, mirroring a genuine mid-generation stop.
  collector.state.onDelta = (delta) => {
    if (delta.text.includes("Partial")) abort.abort();
  };
  driver.onStart = (s) => {
    s.onSend = () => {
      s.emit({ type: "assistant_delta", text: "Partial draft so far" });
      s.emit({ type: "assistant_delta", text: " and more" });
      // No turn_done — the abort tears the child down before one would ever arrive.
    };
  };

  const executor = createHubSubscriptionAdapter({
    repository: repo,
    driver,
    resolveAuth: () => AUTH,
    concurrency: new AsyncSemaphore(1),
    createWorkspace: fakeWorkspaces().create,
  });

  const result = await executor({
    session,
    modelId: MODEL,
    abortSignal: abort.signal,
    steering,
    sink: collector.sink,
  });

  assert.equal(result.status, "aborted");
  assert.equal(result.outcome, "aborted");
  assert.equal(result.stopReasonCode, "user_stop");
  assert.equal(result.completed, false);

  const events = repo.listEvents(session.id);
  const am = events.find(
    (e): e is Extract<HubEvent, { type: "assistant_message" }> => e.type === "assistant_message",
  );
  assert.ok(am, "the partial reply was still persisted");
  assert.ok(
    textOf(am.parts).includes("Partial draft so far and more"),
    "streamed text is preserved",
  );
  assert.ok(
    am.parts.some((p) => p.type === "text" && (p as HubTextPart).text.includes("Response stopped")),
    "an explicit cut-off note is appended",
  );
  assert.ok(
    events.some((e) => e.type === "phase" && e.phase === "stopping"),
    "a stopping phase preceded the terminal",
  );
  assert.equal(
    driver.sessions[0]!.options.abortController.signal.aborted,
    true,
    "the child was torn down",
  );
  assert.equal(repo.getSession(session.id).status, "aborted");
});

// ── (5) steering: a message queued mid-run injects as its own turn on the same warm child (R-SES3) ──

test("a message typed mid-run queues durably and is sent as its own turn on the same warm child", async () => {
  const repo = openRepo();
  const session = seedSession(repo, "Compare Paris and Berlin.");
  const { sink } = collectSink();
  const steering = new HubSteeringQueue(session.id, repo);
  const driver = new FakeDriver();
  let call = 0;
  driver.onStart = (s) => {
    s.onSend = () => {
      call += 1;
      if (call === 1) {
        // Simulate the operator typing WHILE the opener turn is running.
        steering.enqueue({ text: "Also add Rome." });
        s.emit({ type: "assistant_message", text: "Paris and Berlin are both large capitals." });
        s.emit(USAGE);
      } else {
        s.emit({ type: "assistant_message", text: "Rome is the largest of the three." });
        s.emit(USAGE);
      }
    };
  };

  const executor = createHubSubscriptionAdapter({
    repository: repo,
    driver,
    resolveAuth: () => AUTH,
    concurrency: new AsyncSemaphore(1),
    createWorkspace: fakeWorkspaces().create,
  });

  const result = await executor({
    session,
    modelId: MODEL,
    abortSignal: new AbortController().signal,
    steering,
    sink,
  });

  assert.equal(result.status, "completed");
  assert.equal(driver.sessions.length, 1, "the SAME warm child handled both turns");
  assert.deepEqual(driver.sessions[0]!.sent, ["Compare Paris and Berlin.", "Also add Rome."]);

  const events = repo.listEvents(session.id);
  const queued = events.filter(
    (e): e is Extract<HubEvent, { type: "queued_user_message" }> =>
      e.type === "queued_user_message",
  );
  assert.equal(queued.length, 1);
  assert.equal(queued[0]?.text, "Also add Rome.");

  const injected = events.filter(
    (e): e is Extract<HubEvent, { type: "user_message" }> =>
      e.type === "user_message" && e.text === "Also add Rome.",
  );
  assert.equal(injected.length, 1, "the queued message injected exactly once");
  assert.equal(injected[0]?.messageId, queued[0]?.queuedMessageId);

  const ams = events.filter(
    (e): e is Extract<HubEvent, { type: "assistant_message" }> => e.type === "assistant_message",
  );
  assert.equal(ams.length, 2, "two assistant turns (opener + steering continuation)");
  assert.equal(textOf(ams[1]!.parts), "Rome is the largest of the three.");
  assert.deepEqual(HubSteeringQueue.reconstructPending(events), []);
});

// ── (6) no signed-in subscription → honest auth error, never spawns a child ─────────────────────────

test("no signed-in subscription → an honest auth error, no gate leak, no child spawned", async () => {
  const repo = openRepo();
  const session = seedSession(repo, "Hello.");
  const { sink } = collectSink();
  const steering = new HubSteeringQueue(session.id, repo);
  const driver = new FakeDriver();
  const gate = new AsyncSemaphore(1);

  const executor = createHubSubscriptionAdapter({
    repository: repo,
    driver,
    resolveAuth: () => null,
    concurrency: gate,
    createWorkspace: fakeWorkspaces().create,
  });

  const result = await executor({
    session,
    modelId: MODEL,
    abortSignal: new AbortController().signal,
    steering,
    sink,
  });

  assert.equal(result.status, "error");
  assert.equal(result.stopReasonCode, "auth");
  assert.equal(driver.sessions.length, 0, "no child was ever spawned");
  assert.equal((gate as AsyncSemaphore).willQueue, false, "the permit was released back");

  const events = repo.listEvents(session.id);
  const error = events.find((e): e is Extract<HubEvent, { type: "error" }> => e.type === "error");
  assert.ok(error);
  assert.equal(error.authRequired, true);
});

// ── Interactive ask_user wiring (subscription path reuses the Testing primitive) ────────────────────

test("ask_user exposure: a waitForQuestion seam wires the in-process ask server + blocks native AskUserQuestion", async () => {
  const repo = openRepo();
  const session = seedSession(repo, "deploy the app");
  const { sink } = collectSink();
  const steering = new HubSteeringQueue(session.id, repo);
  const workspaces = fakeWorkspaces();
  const driver = new FakeDriver();
  driver.onStart = (s) => {
    s.onSend = () => {
      s.emit({ type: "assistant_message", text: "done." });
      s.emit(USAGE);
    };
  };
  const executor = createHubSubscriptionAdapter({
    repository: repo,
    driver,
    resolveAuth: () => AUTH,
    concurrency: new AsyncSemaphore(1),
    createWorkspace: workspaces.create,
  });

  await executor({
    session,
    modelId: MODEL,
    abortSignal: new AbortController().signal,
    steering,
    sink,
    waitForQuestion: async () => "staging",
  });

  const opts = driver.sessions[0]!.options;
  assert.ok(Object.keys(opts.mcpServers).includes("ask"), "the in-process ask_user MCP server is wired");
  assert.ok(
    (opts.allowedTools ?? []).some((p) => /mcp__ask__ask_user/.test(p)),
    "ask_user is allow-listed",
  );
  assert.ok(
    opts.disallowedTools.includes("AskUserQuestion"),
    "the SDK-native AskUserQuestion is blocked (the hub can't render/route it)",
  );
  assert.equal(repo.getSession(session.id).capabilities?.askUser, true, "askUser is advertised");
});

test("ask_user absence: no seam ⇒ byte-identical no-ask wiring (askUser:false, native tool not blocked)", async () => {
  const repo = openRepo();
  const session = seedSession(repo, "hello");
  const { sink } = collectSink();
  const steering = new HubSteeringQueue(session.id, repo);
  const workspaces = fakeWorkspaces();
  const driver = new FakeDriver();
  driver.onStart = (s) => {
    s.onSend = () => {
      s.emit({ type: "assistant_message", text: "hi." });
      s.emit(USAGE);
    };
  };
  const executor = createHubSubscriptionAdapter({
    repository: repo,
    driver,
    resolveAuth: () => AUTH,
    concurrency: new AsyncSemaphore(1),
    createWorkspace: workspaces.create,
  });

  await executor({
    session,
    modelId: MODEL,
    abortSignal: new AbortController().signal,
    steering,
    sink,
  });

  const opts = driver.sessions[0]!.options;
  assert.deepEqual(opts.mcpServers, {}, "no in-process ask server");
  assert.equal(opts.allowedTools, undefined, "no allow-list");
  assert.ok(!opts.disallowedTools.includes("AskUserQuestion"), "native tool not specially blocked");
  assert.equal(repo.getSession(session.id).capabilities?.askUser, false, "askUser stays off");
});

// ── web-access-fix (2026-07-27, owner decision) — a subscription session can reach the internet ─────
//
// The defect these lock: the hub reused the TESTING executor's `SUBSCRIPTION_DISALLOWED_TOOLS`, which
// blocks `WebSearch` + `WebFetch` (correct there — an agent doing its own research would pollute an MCP
// measurement). A `claude_subscription` hub session is also not an AI-SDK kind, so it never reaches
// `composeWebTools` either. Net effect: it had NO internet at all, silently, while the API-keyed twin of
// the very same model got `web.search` + `web.fetch` by default.

test("web tools: a subscription session gets WebSearch/WebFetch — the rest of the sandbox stays blocked", async () => {
  const repo = openRepo();
  const session = seedSession(repo, "what shipped this week?");
  const { sink } = collectSink();
  const steering = new HubSteeringQueue(session.id, repo);
  const workspaces = fakeWorkspaces();
  const driver = new FakeDriver();
  driver.onStart = (s) => {
    s.onSend = () => {
      s.emit({ type: "assistant_message", text: "hi." });
      s.emit(USAGE);
    };
  };
  const executor = createHubSubscriptionAdapter({
    repository: repo,
    driver,
    resolveAuth: () => AUTH,
    concurrency: new AsyncSemaphore(1),
    createWorkspace: workspaces.create,
  });

  await executor({
    session,
    modelId: MODEL,
    abortSignal: new AbortController().signal,
    steering,
    sink,
  });

  const { disallowedTools, canUseTool } = driver.sessions[0]!.options;
  assert.ok(!disallowedTools.includes("WebSearch"), "WebSearch reaches the model");
  assert.ok(!disallowedTools.includes("WebFetch"), "WebFetch reaches the model");
  // This session has NO grants, so no default-deny gate is installed and the SDK's own default
  // permits anything not disallowed. Asserted explicitly because the FIRST version of this test
  // proved only this branch and was therefore a false green: with grants present the gate WOULD have
  // refused WebSearch by name. The gated path is covered in hub-subscription-mcp-tools.test.ts (1c).
  assert.equal(canUseTool, undefined, "tool-less session ⇒ no gate to allow-list against");
  // The rest of the posture is deliberately UNCHANGED: the SDK child must not touch the real
  // filesystem or shell (the hub's own sandboxed `files.*` builtins own the session workspace), and the
  // meta-tools have no API-path equivalent, so allowing them would make a subscription turn diverge
  // from its metered twin.
  for (const blocked of ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "Task", "Agent", "Skill"]) {
    assert.ok(disallowedTools.includes(blocked), `${blocked} stays blocked`);
  }
});

test("web tools: HUB_WEB_TOOLS=off re-blocks them on this path too — the kill switch is absolute", async () => {
  const repo = openRepo();
  const session = seedSession(repo, "what shipped this week?");
  const { sink } = collectSink();
  const steering = new HubSteeringQueue(session.id, repo);
  const workspaces = fakeWorkspaces();
  const driver = new FakeDriver();
  driver.onStart = (s) => {
    s.onSend = () => {
      s.emit({ type: "assistant_message", text: "hi." });
      s.emit(USAGE);
    };
  };
  const executor = createHubSubscriptionAdapter({
    repository: repo,
    driver,
    resolveAuth: () => AUTH,
    concurrency: new AsyncSemaphore(1),
    createWorkspace: workspaces.create,
    webToolsEnabled: false,
  });

  await executor({
    session,
    modelId: MODEL,
    abortSignal: new AbortController().signal,
    steering,
    sink,
  });

  const { disallowedTools } = driver.sessions[0]!.options;
  assert.ok(disallowedTools.includes("WebSearch"), "WebSearch blocked again");
  assert.ok(disallowedTools.includes("WebFetch"), "WebFetch blocked again");
});

test("web tools: the hub block list is the Testing one minus EXACTLY the two web tools", () => {
  assert.ok(!HUB_SUBSCRIPTION_DISALLOWED_TOOLS.includes("WebSearch"));
  assert.ok(!HUB_SUBSCRIPTION_DISALLOWED_TOOLS.includes("WebFetch"));
  assert.deepEqual(
    [...SUBSCRIPTION_DISALLOWED_TOOLS].filter((t) => !HUB_SUBSCRIPTION_DISALLOWED_TOOLS.includes(t)),
    ["WebSearch", "WebFetch"],
    "nothing else was quietly unblocked along with them",
  );
});
