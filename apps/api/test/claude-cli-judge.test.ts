import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import type { JudgeSettings } from "@mcp-token-footprint/shared";
import { AssistantAuthService } from "../src/assistant/auth-service.js";
import type { ClaudeOauthFlowManager } from "../src/assistant/claude-auth.js";
import { AssistantRepository } from "../src/assistant/repository.js";
import type {
  AgentSessionDriver,
  DriverEvent,
  DriverSession,
  DriverStartOptions,
  DriverUserMessage,
} from "../src/assistant/session-driver.js";
import type { AssistantAuthSource } from "../src/assistant/spawn-env.js";
import { ASSISTANT_SYSTEM_PROMPT } from "../src/assistant/system-prompt.js";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import {
  CLI_JUDGE_DEFAULT_MODEL,
  CLI_JUDGE_DISALLOWED_TOOLS,
  ClaudeCliJudgeError,
  createClaudeCliJudgeGenerate,
  createThrowawayWorkspace,
  type CreateThrowawayWorkspace,
} from "../src/grading/claude-cli-judge.js";
import { ProviderRepository } from "../src/providers/repository.js";
import { SecretStore } from "../src/secrets/secret-store.js";

// Auto-Rating (WP 2.2) — the Claude-CLI judge, exercised entirely through a SCRIPTED FAKE driver + a fake
// auth resolver + a fake throwaway-workspace factory. NO SDK is imported, NO child is spawned, NO Anthropic
// call is made, and the real filesystem is touched by exactly ONE test (the default workspace factory).
// Live CLI/subscription behavior is OWNER-ACCEPTANCE — never faked or asserted here.

// ── A tiny pushable async iterable (the fake's normalized event stream) — SDK-free ────────────────────
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

// ── The scripted fake driver ──────────────────────────────────────────────────────────────────────────
class FakeSession implements DriverSession {
  readonly out = new Pushable<DriverEvent>();
  readonly sent: string[] = [];
  readonly options: DriverStartOptions;
  constructor(options: DriverStartOptions) {
    this.options = options;
    // The SDK's `system/init` carries the session id — emit it up front (ignored by the judge loop).
    this.out.push({ type: "session", sessionId: "sess-fake" });
    // Aborting the shared controller (timeout/teardown) ends the stream, exactly like the real driver.
    options.abortController.signal.addEventListener("abort", () => this.out.end(), { once: true });
  }
  get events(): AsyncIterable<DriverEvent> {
    return this.out;
  }
  send(message: DriverUserMessage): void {
    this.sent.push(message.text);
  }
  async interrupt(): Promise<void> {}
  sessionId(): string | undefined {
    return "sess-fake";
  }
  /** Test hook: push a scripted normalized event into this session's stream. */
  emit(event: DriverEvent): void {
    this.out.push(event);
  }
}

class FakeDriver implements AgentSessionDriver {
  readonly sessions: FakeSession[] = [];
  active = 0;
  maxActive = 0;
  /** Called synchronously after each `start()` so a test can auto-script (or leave it manual). */
  onStart?: (session: FakeSession) => void;
  start(options: DriverStartOptions): DriverSession {
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    // A one-shot is torn down (abortController.abort) when it settles — decrement then.
    options.abortController.signal.addEventListener(
      "abort",
      () => {
        this.active -= 1;
      },
      { once: true },
    );
    const session = new FakeSession(options);
    this.sessions.push(session);
    this.onStart?.(session);
    return session;
  }
}

// ── Shared fixtures ─────────────────────────────────────────────────────────────────────────────────
const AUTH: AssistantAuthSource = {
  kind: "claude_oauth",
  token: "sk-ant-oat01-fake-judge-token-1234",
};
const SETTINGS: JudgeSettings = { providerCredentialId: "prov-ignored", model: "claude-opus-4-1" };
const USAGE: DriverEvent = {
  type: "turn_done",
  turnIndex: 1,
  usage: {
    inputTokens: 123,
    outputTokens: 45,
    cacheReadInputTokens: 9,
    cacheCreationInputTokens: 3,
  },
};

/** A fake throwaway-workspace factory that never touches the FS; records created dirs + cleanup calls. */
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

function freshSignal(): AbortSignal {
  return new AbortController().signal;
}

// ── Happy path ────────────────────────────────────────────────────────────────────────────────────────
test("happy path: concatenated assistant text + mapped usage; tools-less one-shot forwards opts.system", async () => {
  const driver = new FakeDriver();
  driver.onStart = (s) => {
    s.emit({ type: "assistant_message", text: "<rating>8</rating>" });
    s.emit({ type: "assistant_message", text: " a solid match" });
    s.emit(USAGE);
  };
  const ws = fakeWorkspaces();
  const generate = createClaudeCliJudgeGenerate({
    driver,
    resolveJudgeAuth: () => AUTH,
    createWorkspace: ws.create,
  });

  const system = "DISTINCTIVE-JUDGE-SYSTEM-PROMPT (G-Eval rubric)";
  const result = await generate(SETTINGS, "PROMPT-body", { system, signal: freshSignal() });

  // Concatenated text + REAL usage mapped from WP 2.1's turn_done.usage (AR13); no logprobs from the CLI.
  assert.equal(result.text, "<rating>8</rating> a solid match");
  assert.deepEqual(result.usage, { inputTokens: 123, outputTokens: 45 });
  assert.equal("ratingLogprobs" in result, false);

  // One-shot shape on the injected driver — never AssistantSessionManager.
  const opts = driver.sessions[0]!.options;
  assert.equal(opts.maxTurns, 1);
  assert.deepEqual(opts.mcpServers, {});
  assert.equal(opts.model, "claude-opus-4-1");
  // D-AS9: the forwarded system prompt is EXACTLY the caller's — never the assistant persona.
  assert.equal(opts.systemPrompt, system);
  assert.notEqual(opts.systemPrompt, ASSISTANT_SYSTEM_PROMPT);
  // Tools-less: exec/network/native-file built-ins disallowed.
  assert.ok(opts.disallowedTools.includes("Bash"));
  assert.ok(opts.disallowedTools.includes("Read"));
  assert.deepEqual([...opts.disallowedTools], [...CLI_JUDGE_DISALLOWED_TOOLS]);
  // The prompt was actually sent.
  assert.deepEqual(driver.sessions[0]!.sent, ["PROMPT-body"]);

  // Child env: built by buildAssistantSpawnEnv with the THROWAWAY dir + the subscription token; no API key.
  assert.equal(opts.env.CLAUDE_CODE_OAUTH_TOKEN, AUTH.token);
  assert.equal(opts.env.ANTHROPIC_API_KEY, undefined);
  assert.ok(opts.env.HOME?.startsWith(ws.dirs[0]!), "HOME scoped under the throwaway dir");
  assert.ok(
    opts.env.CLAUDE_CONFIG_DIR?.startsWith(ws.dirs[0]!),
    "CLAUDE_CONFIG_DIR scoped under it",
  );

  // Throwaway workspace cleaned up.
  assert.equal(ws.cleanups(), 1);
});

test("defaults the model to the locked CLI-judge default when settings.model is null", async () => {
  const driver = new FakeDriver();
  driver.onStart = (s) => s.emit(USAGE);
  const generate = createClaudeCliJudgeGenerate({
    driver,
    resolveJudgeAuth: () => AUTH,
    createWorkspace: fakeWorkspaces().create,
  });
  await generate({ providerCredentialId: null, model: null }, "P", {
    system: "S",
    signal: freshSignal(),
  });
  assert.equal(driver.sessions[0]!.options.model, CLI_JUDGE_DEFAULT_MODEL);
});

test("turn_done without usage → zeroed JudgeUsage (never dropped)", async () => {
  const driver = new FakeDriver();
  driver.onStart = (s) => {
    s.emit({ type: "assistant_message", text: "<rating>5</rating>" });
    s.emit({ type: "turn_done" }); // no usage field
  };
  const generate = createClaudeCliJudgeGenerate({
    driver,
    resolveJudgeAuth: () => AUTH,
    createWorkspace: fakeWorkspaces().create,
  });
  const result = await generate(SETTINGS, "P", { system: "S", signal: freshSignal() });
  assert.deepEqual(result.usage, { inputTokens: 0, outputTokens: 0 });
});

// ── Auth absent (AR16) ────────────────────────────────────────────────────────────────────────────────
test("auth absent → distinguishable `auth` error; nothing spawned, no workspace created", async () => {
  const driver = new FakeDriver();
  const ws = fakeWorkspaces();
  const generate = createClaudeCliJudgeGenerate({
    driver,
    resolveJudgeAuth: () => null,
    createWorkspace: ws.create,
  });

  await assert.rejects(
    () => generate(SETTINGS, "P", { system: "S", signal: freshSignal() }),
    (err: unknown) => err instanceof ClaudeCliJudgeError && err.kind === "auth",
  );
  assert.equal(driver.sessions.length, 0, "never started a child");
  assert.equal(ws.dirs.length, 0, "never created a throwaway workspace");
});

// ── CLI limit / auth errors on the stream (AR16 fall-through triggers) ───────────────────────────────
test("driver limit_error → distinguishable error carrying the matching kind", async () => {
  for (const kind of ["rate_limit", "auth"] as const) {
    const driver = new FakeDriver();
    driver.onStart = (s) =>
      s.emit({ type: "limit_error", message: "the CLI judge hit a limit", kind });
    const ws = fakeWorkspaces();
    const generate = createClaudeCliJudgeGenerate({
      driver,
      resolveJudgeAuth: () => AUTH,
      createWorkspace: ws.create,
    });

    await assert.rejects(
      () => generate(SETTINGS, "P", { system: "S", signal: freshSignal() }),
      (err: unknown) => err instanceof ClaudeCliJudgeError && err.kind === kind,
    );
    // Torn down + cleaned up even on the error path.
    assert.equal(driver.sessions[0]!.options.abortController.signal.aborted, true);
    assert.equal(ws.cleanups(), 1);
  }
});

test("driver `error` event → distinguishable `driver` error", async () => {
  const driver = new FakeDriver();
  driver.onStart = (s) => s.emit({ type: "error", message: "the model failed" });
  const generate = createClaudeCliJudgeGenerate({
    driver,
    resolveJudgeAuth: () => AUTH,
    createWorkspace: fakeWorkspaces().create,
  });
  await assert.rejects(
    () => generate(SETTINGS, "P", { system: "S", signal: freshSignal() }),
    (err: unknown) => err instanceof ClaudeCliJudgeError && err.kind === "driver",
  );
});

// ── Timeout ───────────────────────────────────────────────────────────────────────────────────────────
test("timeout: a one-shot that never completes aborts the driver and throws `timeout` within the bound", async () => {
  const driver = new FakeDriver();
  driver.onStart = (s) => s.emit({ type: "assistant_message", text: "thinking…" }); // never turn_done
  const ws = fakeWorkspaces();
  const generate = createClaudeCliJudgeGenerate({
    driver,
    resolveJudgeAuth: () => AUTH,
    createWorkspace: ws.create,
    timeoutMs: 30,
  });

  const startedAt = Date.now();
  await assert.rejects(
    () => generate(SETTINGS, "P", { system: "S", signal: freshSignal() }),
    (err: unknown) => err instanceof ClaudeCliJudgeError && err.kind === "timeout",
  );
  assert.ok(Date.now() - startedAt < 2000, "settled well within the bound (no hang)");
  assert.equal(
    driver.sessions[0]!.options.abortController.signal.aborted,
    true,
    "driver torn down",
  );
  assert.equal(ws.cleanups(), 1, "cleaned up even on timeout");
});

test("an already-aborted caller signal → `timeout` error, no hang", async () => {
  const driver = new FakeDriver();
  driver.onStart = (s) => s.emit({ type: "assistant_message", text: "…" });
  const generate = createClaudeCliJudgeGenerate({
    driver,
    resolveJudgeAuth: () => AUTH,
    createWorkspace: fakeWorkspaces().create,
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => generate(SETTINGS, "P", { system: "S", signal: controller.signal }),
    (err: unknown) => err instanceof ClaudeCliJudgeError && err.kind === "timeout",
  );
});

// ── AR14 semaphore (concurrency 1) serializes CLI calls ───────────────────────────────────────────────
test("AR14 semaphore (concurrency 1): two overlapping calls never start() concurrently", async () => {
  const driver = new FakeDriver(); // manual scripting — do NOT auto-complete on start
  const ws = fakeWorkspaces();
  const generate = createClaudeCliJudgeGenerate({
    driver,
    resolveJudgeAuth: () => AUTH,
    createWorkspace: ws.create,
    maxConcurrency: 1,
  });

  const callA = generate(SETTINGS, "A", { system: "S", signal: freshSignal() });
  const callB = generate(SETTINGS, "B", { system: "S", signal: freshSignal() });

  // A acquires the sole permit and starts; B is blocked on `acquire`, so only ONE child exists.
  await waitFor(() => driver.sessions.length === 1);
  assert.equal(driver.active, 1);

  // Complete A → releases the permit → B may start.
  driver.sessions[0]!.emit(USAGE);
  const resultA = await callA;

  await waitFor(() => driver.sessions.length === 2);
  driver.sessions[1]!.emit(USAGE);
  const resultB = await callB;

  assert.equal(driver.maxActive, 1, "never two CLI children at once");
  assert.deepEqual(resultA.usage, { inputTokens: 123, outputTokens: 45 });
  assert.deepEqual(resultB.usage, { inputTokens: 123, outputTokens: 45 });
  assert.equal(ws.cleanups(), 2);
});

// ── The production throwaway-workspace factory (the ONE FS-touching test) ─────────────────────────────
test("createThrowawayWorkspace: creates a unique temp dir and removes it on cleanup", async () => {
  const factory = createThrowawayWorkspace();
  const a = await factory();
  const b = await factory();
  assert.notEqual(a.dir, b.dir, "each call is a fresh unique dir");
  assert.ok((await fs.stat(a.dir)).isDirectory());
  await a.cleanup();
  await assert.rejects(() => fs.stat(a.dir), "removed after cleanup");
  // cleanup is defensive: a second call on the already-removed dir does not throw.
  await a.cleanup();
  await b.cleanup();
});

// ── The judge auth resolver (WP 2.2) — decrypted server-side only; status stays redacted ──────────────
const databases: AppDatabase[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function makeAuthService(signedIn: boolean): { auth: AssistantAuthService; token: string } {
  const db: AppDatabase = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  databases.push(db);
  const secrets = new SecretStore(Buffer.alloc(32, 7));
  const repo = new AssistantRepository(db, secrets);
  const providers = new ProviderRepository(db, secrets);
  const token = "sk-ant-oat01-resolver-secret-9f3a";
  if (signedIn) repo.createCredential({ kind: "claude_oauth", token });
  // resolveJudgeAuth never touches the flow manager, so a stub is sufficient here.
  const auth = new AssistantAuthService(repo, providers, {} as unknown as ClaudeOauthFlowManager);
  return { auth, token };
}

test("resolveJudgeAuth: returns the decrypted subscription source when signed in; status stays redacted", () => {
  const { auth, token } = makeAuthService(true);
  const resolved = auth.resolveJudgeAuth();
  assert.deepEqual(resolved, { kind: "claude_oauth", token });

  // The redacted status never carries the token (secret boundary).
  const status = auth.getStatus();
  assert.equal(status.signedIn, true);
  assert.equal("token" in status, false);
  assert.equal(JSON.stringify(status).includes(token), false);
});

test("resolveJudgeAuth: returns null when no subscription is signed in", () => {
  const { auth } = makeAuthService(false);
  assert.equal(auth.resolveJudgeAuth(), null);
});
