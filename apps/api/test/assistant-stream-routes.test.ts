import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { afterEach, test } from "node:test";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { AssistantStreamFrame } from "@mcp-token-footprint/shared";
import { AssistantRepository } from "../src/assistant/repository.js";
import { registerAssistantRoutes } from "../src/assistant/routes.js";
import { AssistantSessionManager } from "../src/assistant/session-manager.js";
import type {
  AgentSessionDriver,
  DriverEvent,
  DriverSession,
  DriverStartOptions,
  DriverUserMessage,
} from "../src/assistant/session-driver.js";
import type { AssistantAuthService } from "../src/assistant/auth-service.js";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { ProviderRepository } from "../src/providers/repository.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { toErrorMessage } from "../src/utils/errors.js";

// Assistant (WP 1.1) — the HTTP + SSE surface, over a real Fastify app + in-memory DB, with a scripted
// FAKE driver (no SDK, no child, no Anthropic). Copies the `run-stream-routes.test.ts` SSE-client shape.

// ── SDK-free pushable + scripted fake driver (mirrors assistant-session.test.ts) ──────────────────
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
    this.script({ text: message.text, turn: this.turn++, emit: (event) => this.out.push(event) });
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

const echoScript: TurnScript = ({ text, turn, emit }) => {
  emit({ type: "assistant_delta", text: `partial-${turn}` });
  emit({ type: "assistant_message", text: `answer-${turn}:${text}` });
  emit({ type: "turn_done", turnIndex: turn });
};

// ── App harness ───────────────────────────────────────────────────────────────────────────────────
type Harness = { app: FastifyInstance; baseUrl: string; manager: AssistantSessionManager };
const harnesses: Harness[] = [];
const databases: AppDatabase[] = [];

afterEach(async () => {
  for (const h of harnesses.splice(0)) await h.app.close();
  for (const db of databases.splice(0)) db.close();
});

async function makeApp(options: { signIn?: boolean; script?: TurnScript } = {}): Promise<Harness> {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  databases.push(db);

  const secrets = new SecretStore(Buffer.alloc(32, 5));
  const repo = new AssistantRepository(db, secrets);
  const providers = new ProviderRepository(db, secrets);
  if (options.signIn !== false)
    repo.createCredential({ kind: "claude_oauth", token: "sk-ant-oat01-testtoken1234" });

  const manager = new AssistantSessionManager({
    repository: repo,
    providers,
    driver: new FakeDriver(options.script ?? echoScript),
    buildTools: () => ({}),
    config: {
      maxTurns: 50,
      idleTimeoutMs: 60_000,
      maxActiveSessions: 2,
      assistantDataDir: `/tmp/mcp-assistant-sse-${Math.random().toString(36).slice(2)}`,
      permissionTimeoutMs: 300_000,
      // R2.2 — keep pre-R2 warm-session behavior for these SSE tests (a long grace keeps the child live
      // within the test window); title one-shot off so it never perturbs driver.start counts.
      releaseGraceMs: 60_000,
      autoTitle: false,
      titleModel: "claude-haiku-4-5",
      titleTimeoutMs: 15_000,
    },
  });

  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: "Validation failed" });
    const typed = error as Error & { statusCode?: number };
    return reply.code(typed.statusCode ?? 500).send({ error: toErrorMessage(error) });
  });
  // The auth service is unused by these route tests, but the route module requires it — a bare stub.
  await registerAssistantRoutes(app, {
    auth: {} as unknown as AssistantAuthService,
    sessions: manager,
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const harness: Harness = { app, baseUrl: `http://127.0.0.1:${port}`, manager };
  harnesses.push(harness);
  return harness;
}

async function postJson(h: Harness, path: string, body?: unknown): Promise<Response> {
  return fetch(`${h.baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

/**
 * Open the SSE stream and collect parsed frames until `until(frames)` is true OR the server closes the
 * stream (reader `done`), whichever first; an abort timer bounds it. `onOpen` runs once, right after the
 * connection is established (the route has already written its SSE head + replay + subscribed by then),
 * so a message posted in `onOpen` arrives LIVE over this same socket. Reads are strictly sequential (a
 * `ReadableStreamDefaultReader` forbids concurrent `read()`s).
 */
async function collectFrames(
  url: string,
  until: (frames: AssistantStreamFrame[]) => boolean,
  onOpen?: () => Promise<void>,
  timeoutMs = 3000,
): Promise<{ frames: AssistantStreamFrame[]; sawPing: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const res = await fetch(url, { signal: controller.signal }).catch((error) => {
    clearTimeout(timer);
    throw error;
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const frames: AssistantStreamFrame[] = [];
  let buffer = "";
  let sawPing = false;

  if (onOpen) await onOpen();

  try {
    while (!until(frames)) {
      let done = false;
      let value: Uint8Array | undefined;
      try {
        ({ done, value } = await reader.read());
      } catch {
        break; // aborted by the timeout
      }
      if (done) break; // the server closed the stream
      if (!value) continue;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const record = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        // WP 3.1 — a record may carry an explicit `event:` field (the replay→live boundary marker,
        // `event: replay_complete`); a real `EventSource.onmessage` only ever fires for the DEFAULT
        // event type (no `event:` line), so mirror that here rather than parsing every `data:` line
        // as an `AssistantStreamFrame` regardless of its event type.
        let eventType: string | null = null;
        let dataLine: string | null = null;
        for (const line of record.split("\n")) {
          if (line.startsWith(":"))
            sawPing = true; // `: ping` heartbeat comment
          else if (line.startsWith("event:")) eventType = line.slice(6).trim();
          else if (line.startsWith("data:")) dataLine = line.slice(5).trim();
        }
        if (dataLine !== null && eventType === null) {
          frames.push(JSON.parse(dataLine) as AssistantStreamFrame);
        }
      }
    }
  } finally {
    clearTimeout(timer);
    controller.abort();
    await reader.cancel().catch(() => undefined);
  }
  return { frames, sawPing };
}

const typesOf = (frames: AssistantStreamFrame[]) => frames.map((f) => f.type);

// ── Tests ─────────────────────────────────────────────────────────────────────────────────────────

test("POST /threads → 201, POST /messages → 202, and the thread detail replays the persisted log", async () => {
  const h = await makeApp();
  const createRes = await postJson(h, "/api/assistant/threads", { title: "T" });
  assert.equal(createRes.status, 201);
  const thread = (await createRes.json()) as { id: string; status: string };
  assert.ok(thread.id);

  const msgRes = await postJson(h, `/api/assistant/threads/${thread.id}/messages`, {
    text: "hello",
  });
  assert.equal(msgRes.status, 202);

  // Poll the detail route until the first turn settled.
  let detail: { events: AssistantStreamFrame[] } | undefined;
  for (let i = 0; i < 100; i += 1) {
    detail = (await (await fetch(`${h.baseUrl}/api/assistant/threads/${thread.id}`)).json()) as {
      events: AssistantStreamFrame[];
    };
    if (detail.events.some((e) => e.type === "turn_done")) break;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.deepEqual(
    typesOf(detail!.events),
    ["user_message", "assistant_message", "turn_done"],
    "detail replay is the settled triple (no delta persisted)",
  );
});

test("SSE replay-then-live: persisted history replays, then live frames (incl. a delta) arrive without dupes", async () => {
  const h = await makeApp();
  const thread = (await (await postJson(h, "/api/assistant/threads", {})).json()) as { id: string };

  // Turn 1 completes BEFORE we connect → it becomes the persisted replay history.
  await postJson(h, `/api/assistant/threads/${thread.id}/messages`, { text: "one" });
  await new Promise((r) => setTimeout(r, 60));

  // Connect, THEN (onOpen) post turn 2 so its frames arrive live over the same socket.
  const { frames } = await collectFrames(
    `${h.baseUrl}/api/assistant/threads/${thread.id}/stream`,
    (f) => f.filter((e) => e.type === "turn_done").length >= 2,
    async () => {
      await postJson(h, `/api/assistant/threads/${thread.id}/messages`, { text: "two" });
    },
  );

  // The replayed turn-1 triple came first (settled, carries seq), exactly once.
  const settled = frames.filter((f) => f.type !== "assistant_delta");
  assert.deepEqual(
    typesOf(settled),
    [
      "user_message",
      "assistant_message",
      "turn_done",
      "user_message",
      "assistant_message",
      "turn_done",
    ],
    "settled frames = turn-1 replay + turn-2 live, no duplication",
  );
  assert.deepEqual(
    settled.map((f) => (f as { seq?: number }).seq),
    [1, 2, 3, 4, 5, 6],
    "each settled frame carries its monotonic seq, deduped across the replay→live handoff",
  );
  // The transient delta for turn 2 streamed LIVE (and carries no seq — it is never persisted).
  const delta = frames.find((f) => f.type === "assistant_delta");
  assert.ok(delta, "the live turn-2 delta streamed over SSE");
  assert.equal(
    (delta as { seq?: number }).seq,
    undefined,
    "the delta frame has no seq (transient)",
  );
  // A live assistant_message for turn 2 has the expected text.
  const answers = settled.filter((f) => f.type === "assistant_message") as Array<{ text: string }>;
  assert.equal(answers[1]?.text, "answer-1:two");
});

test("WP 3.1: the SSE stream writes a `replay_complete` marker after replay and before any live frame", async () => {
  const h = await makeApp();
  const thread = (await (await postJson(h, "/api/assistant/threads", {})).json()) as { id: string };

  // One turn completes BEFORE connecting → it is replay history; the live turn happens after connect.
  await postJson(h, `/api/assistant/threads/${thread.id}/messages`, { text: "one" });
  await new Promise((r) => setTimeout(r, 60));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  const res = await fetch(`${h.baseUrl}/api/assistant/threads/${thread.id}/stream`, {
    signal: controller.signal,
  });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let raw = "";
  let markerIndex = -1;
  let liveIndex = -1;
  try {
    // Post the live turn now that the connection is open (mirrors collectFrames' onOpen timing).
    void postJson(h, `/api/assistant/threads/${thread.id}/messages`, { text: "two" });
    while (markerIndex === -1 || liveIndex === -1) {
      const { done, value } = await reader.read();
      if (done) break;
      raw += decoder.decode(value, { stream: true });
      if (markerIndex === -1) markerIndex = raw.indexOf("event: replay_complete");
      // The turn-2 live user_message text distinguishes it from the replayed turn-1 one.
      if (liveIndex === -1 && raw.includes('"text":"two"')) liveIndex = raw.indexOf('"text":"two"');
    }
  } finally {
    clearTimeout(timer);
    controller.abort();
    await reader.cancel().catch(() => undefined);
  }
  assert.ok(markerIndex >= 0, "the replay_complete marker was written");
  assert.ok(liveIndex > markerIndex, "the live turn's frames arrive strictly after the marker");
});

test("deleting a thread while a client is streaming closes the stream", async () => {
  const h = await makeApp();
  const thread = (await (await postJson(h, "/api/assistant/threads", {})).json()) as { id: string };

  // Connect, then delete the thread — the stream must end (onClosed → close), so the reader completes.
  const start = Date.now();
  const { frames } = await collectFrames(
    `${h.baseUrl}/api/assistant/threads/${thread.id}/stream`,
    () => false, // never satisfied by frames — only the server-side close ends the read
    async () => {
      await new Promise((r) => setTimeout(r, 20));
      const del = await fetch(`${h.baseUrl}/api/assistant/threads/${thread.id}`, {
        method: "DELETE",
      });
      assert.equal(del.status, 204);
    },
    2000,
  );
  // The read loop returned well before the 2s timeout because the server closed the stream on delete.
  assert.ok(Date.now() - start < 1800, "the stream closed promptly after the thread was deleted");
  assert.ok(!frames.some((f) => f.type === "turn_done"), "no turn ran; the stream just closed");
});

test("SSE on an unknown thread → 404 (existence checked before the socket is hijacked)", async () => {
  const h = await makeApp();
  const res = await fetch(`${h.baseUrl}/api/assistant/threads/does-not-exist/stream`);
  assert.equal(res.status, 404);
});

test("no auth source configured → every thread route returns 409 (auth routes excepted)", async () => {
  const h = await makeApp({ signIn: false });
  const list = await fetch(`${h.baseUrl}/api/assistant/threads`);
  assert.equal(list.status, 409, "GET /threads is gated");
  const create = await postJson(h, "/api/assistant/threads", {});
  assert.equal(create.status, 409, "POST /threads is gated");
  const stream = await fetch(`${h.baseUrl}/api/assistant/threads/x/stream`);
  assert.equal(stream.status, 409, "GET /stream is gated");
});

// WP R1.3 (D-AS22) — the three transient skill-workspace progress frames actually reach the wire, over
// the SAME default "message" SSE channel as every other live frame (option (a): a plain
// `AssistantStreamFrame` union member — see `session-manager.ts`'s `fanWorkspaceFrame` +
// `routes.ts`'s `onFrame`), carrying NO `seq` (never replayed on a reconnect).
const workspaceFrameScript: TurnScript = ({ emit, turn }) => {
  emit({
    type: "tool_call",
    toolUseId: "tu-open",
    toolName: "skills_open_workspace",
    input: { skillId: "skill-a" },
  });
  emit({
    type: "tool_result",
    toolUseId: "tu-open",
    result: [
      {
        type: "text",
        text: JSON.stringify({
          skillId: "skill-a",
          versionId: "v1",
          versionLabel: "v1",
          workspacePath: "/does/not/matter",
          files: [{ path: "SKILL.md", size: 10, isBinary: false }],
          fileCount: 1,
        }),
      },
    ],
    isError: false,
  });
  emit({ type: "assistant_message", text: "Opened it." });
  emit({ type: "turn_done", turnIndex: turn });
};

test("a workspace_opened frame reaches the SSE wire on the default message channel, with no seq", async () => {
  const h = await makeApp({ script: workspaceFrameScript });
  const thread = (await (await postJson(h, "/api/assistant/threads", {})).json()) as { id: string };

  const { frames } = await collectFrames(
    `${h.baseUrl}/api/assistant/threads/${thread.id}/stream`,
    (f) => f.some((e) => e.type === "turn_done"),
    async () => {
      await postJson(h, `/api/assistant/threads/${thread.id}/messages`, { text: "open skill-a" });
    },
  );

  const opened = frames.find((f) => f.type === "workspace_opened") as
    | Extract<AssistantStreamFrame, { type: "workspace_opened" }>
    | undefined;
  assert.ok(opened, "the workspace_opened frame arrived over SSE");
  assert.equal(opened?.skillId, "skill-a");
  assert.equal(opened?.versionId, "v1");
  assert.deepEqual(opened?.files, [{ path: "SKILL.md", size: 10 }]);
  assert.equal(
    (opened as unknown as { seq?: number }).seq,
    undefined,
    "never carries a seq — transient, never replayed",
  );
});
