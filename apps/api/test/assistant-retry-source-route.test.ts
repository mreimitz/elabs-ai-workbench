import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { afterEach, test } from "node:test";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
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

// WP 3.3 (D-AS14) — HTTP surface for `POST /api/assistant/threads/:id/retry-source`, over a real
// Fastify app + in-memory DB, with a scripted FAKE driver (mirrors assistant-stream-routes.test.ts's
// harness exactly). No SDK, no child, no Anthropic.

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
  readonly startOptions: DriverStartOptions;
  private turn = 0;
  constructor(
    options: DriverStartOptions,
    private readonly script: TurnScript,
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
  readonly starts: FakeSession[] = [];
  private counter = 0;
  constructor(private readonly script: TurnScript) {}
  start(options: DriverStartOptions): DriverSession {
    const session = new FakeSession(options, this.script, `sdk-sess-${++this.counter}`);
    this.starts.push(session);
    return session;
  }
}

// Every turn hits an auth-kind limit_error (mirrors a subscription credential the SDK rejects).
const authLimitScript: TurnScript = ({ emit, turn }) => {
  emit({ type: "limit_error", message: "Assistant authentication failed.", kind: "auth" });
  emit({ type: "turn_done", turnIndex: turn });
};
const echoScript: TurnScript = ({ text, turn, emit }) => {
  emit({ type: "assistant_message", text: `answer-${turn}:${text}` });
  emit({ type: "turn_done", turnIndex: turn });
};

type Harness = {
  app: FastifyInstance;
  baseUrl: string;
  repo: AssistantRepository;
  providers: ProviderRepository;
};
const harnesses: Harness[] = [];
const databases: AppDatabase[] = [];

afterEach(async () => {
  for (const h of harnesses.splice(0)) await h.app.close();
  for (const db of databases.splice(0)) db.close();
});

async function makeApp(options: { script?: TurnScript } = {}): Promise<Harness> {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  databases.push(db);

  const secrets = new SecretStore(Buffer.alloc(32, 9));
  const repo = new AssistantRepository(db, secrets);
  const providers = new ProviderRepository(db, secrets);
  repo.createCredential({ kind: "claude_oauth", token: "sk-ant-oat01-testtoken1234" });

  const manager = new AssistantSessionManager({
    repository: repo,
    providers,
    driver: new FakeDriver(options.script ?? authLimitScript),
    buildTools: () => ({}),
    config: {
      maxTurns: 50,
      idleTimeoutMs: 60_000,
      maxActiveSessions: 2,
      assistantDataDir: `/tmp/mcp-assistant-retry-${Math.random().toString(36).slice(2)}`,
      permissionTimeoutMs: 300_000,
      // R2.2 — keep pre-R2 warm-session behavior for these retry-source tests (a long grace keeps the
      // child live within the test window); title one-shot off so it never perturbs driver.start counts.
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
  await registerAssistantRoutes(app, {
    auth: {} as unknown as AssistantAuthService,
    sessions: manager,
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const harness: Harness = { app, baseUrl: `http://127.0.0.1:${port}`, repo, providers };
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

function addFallback(h: Harness): void {
  const credential = h.providers.create({
    kind: "anthropic",
    label: "fallback",
    apiKey: "sk-test-fallback-key",
  });
  h.repo.setFallbackProviderCredentialId(credential.id);
}

// ── Tests ─────────────────────────────────────────────────────────────────────────────────────────

test("POST retry-source: 409 when the target source isn't configured (no fallback set)", async () => {
  const h = await makeApp();
  const thread = (await (await postJson(h, "/api/assistant/threads", {})).json()) as { id: string };

  const res = await postJson(h, `/api/assistant/threads/${thread.id}/retry-source`, {
    source: "api_key",
  });
  assert.equal(res.status, 409);
});

test("POST retry-source: 400 when the target already matches the thread's current source", async () => {
  const h = await makeApp();
  const thread = (await (await postJson(h, "/api/assistant/threads", {})).json()) as { id: string };

  const res = await postJson(h, `/api/assistant/threads/${thread.id}/retry-source`, {
    source: "subscription",
  });
  assert.equal(res.status, 400);
});

test("POST retry-source: 400 on an invalid source value (zod)", async () => {
  const h = await makeApp();
  const thread = (await (await postJson(h, "/api/assistant/threads", {})).json()) as { id: string };

  const res = await postJson(h, `/api/assistant/threads/${thread.id}/retry-source`, {
    source: "bogus",
  });
  assert.equal(res.status, 400);
});

test("POST retry-source: 404 on an unknown thread id", async () => {
  const h = await makeApp();
  addFallback(h);
  const res = await postJson(h, "/api/assistant/threads/does-not-exist/retry-source", {
    source: "api_key",
  });
  assert.equal(res.status, 404);
});

test("POST retry-source: 409 (assertConfigured) when the assistant has no auth source at all", async () => {
  // A bespoke app with NO signed-in credential and NO fallback — the whole thread surface 409s.
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  databases.push(db);
  const secrets = new SecretStore(Buffer.alloc(32, 3));
  const repo = new AssistantRepository(db, secrets);
  const providers = new ProviderRepository(db, secrets);
  const manager = new AssistantSessionManager({
    repository: repo,
    providers,
    driver: new FakeDriver(echoScript),
    buildTools: () => ({}),
    config: {
      maxTurns: 50,
      idleTimeoutMs: 60_000,
      maxActiveSessions: 2,
      assistantDataDir: `/tmp/mcp-assistant-retry-unconfigured-${Math.random().toString(36).slice(2)}`,
      permissionTimeoutMs: 300_000,
      // R2.2 — see the note on the other harness above; pre-R2 warm behavior + title one-shot off.
      releaseGraceMs: 60_000,
      autoTitle: false,
      titleModel: "claude-haiku-4-5",
      titleTimeoutMs: 15_000,
    },
  });
  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _req, reply) => {
    const typed = error as Error & { statusCode?: number };
    return reply.code(typed.statusCode ?? 500).send({ error: toErrorMessage(error) });
  });
  await registerAssistantRoutes(app, {
    auth: {} as unknown as AssistantAuthService,
    sessions: manager,
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const h: Harness = { app, baseUrl: `http://127.0.0.1:${port}`, repo, providers };
  harnesses.push(h);

  const res = await postJson(h, "/api/assistant/threads/whatever/retry-source", {
    source: "api_key",
  });
  assert.equal(res.status, 409);
});

test("POST retry-source: 200 success — flips authSource, resends the last message, and the retried turn's events surface on the SAME thread's replay log", async () => {
  const h = await makeApp();
  addFallback(h);
  const thread = (await (await postJson(h, "/api/assistant/threads", {})).json()) as {
    id: string;
    authSource: string;
  };
  assert.equal(thread.authSource, "subscription");

  const msgRes = await postJson(h, `/api/assistant/threads/${thread.id}/messages`, {
    text: "read the run",
  });
  assert.equal(msgRes.status, 202);
  // Wait for the errored turn to settle.
  for (let i = 0; i < 100; i += 1) {
    const events = (await (
      await fetch(`${h.baseUrl}/api/assistant/threads/${thread.id}`)
    ).json()) as {
      events: Array<{ type: string }>;
    };
    if (events.events.some((e) => e.type === "turn_done")) break;
    await new Promise((r) => setTimeout(r, 10));
  }

  const retryRes = await postJson(h, `/api/assistant/threads/${thread.id}/retry-source`, {
    source: "api_key",
  });
  assert.equal(retryRes.status, 200);
  const updated = (await retryRes.json()) as { authSource: string };
  assert.equal(updated.authSource, "api_key");

  const detail = (await (
    await fetch(`${h.baseUrl}/api/assistant/threads/${thread.id}`)
  ).json()) as {
    events: Array<{ type: string; from?: string; to?: string; text?: string }>;
  };
  const sourceSwitch = detail.events.find((e) => e.type === "source_switch");
  assert.ok(sourceSwitch, "a source_switch event is in the replay log");
  assert.equal(sourceSwitch?.from, "subscription");
  assert.equal(sourceSwitch?.to, "api_key");
  const userMessages = detail.events.filter((e) => e.type === "user_message");
  assert.equal(userMessages.length, 2, "the original + the retried resend");
});
