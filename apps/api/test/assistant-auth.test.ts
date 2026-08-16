import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Writable } from "node:stream";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { AssistantAuthService } from "../src/assistant/auth-service.js";
import {
  ClaudeOauthFlowManager,
  type FlowTimeouts,
  parseTokenOutcome,
  type PtyDriver,
  type PtyDriverHandle,
  type PtySpawnSpec,
} from "../src/assistant/claude-auth.js";
import { AssistantRepository } from "../src/assistant/repository.js";
import { registerAssistantRoutes } from "../src/assistant/routes.js";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { ProviderRepository } from "../src/providers/repository.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { toErrorMessage } from "../src/utils/errors.js";

// WP 0.2 — Claude sign-in. FULLY OFFLINE: the PTY boundary is a dependency-injected seam and every
// test injects a SCRIPTED FAKE that replays a captured `setup-token` transcript. No test spawns a real
// binary, opens a real PTY, or calls Anthropic. The command/binary path is a stub (`FAKE_SPAWN`).

// ── Distinctive secret material so the redaction assertions can grep for it unambiguously ────────────
const AUTH_URL =
  "https://claude.ai/oauth/authorize?code=true&client_id=abc123&scope=user:inference&state=STATE-xyz";
// A well-formed `sk-ant-oat01-…` token (valid base64url charset, comfortably longer than the min).
const REAL_TOKEN = `sk-ant-oat01-${"A".repeat(80)}_liveTOKEN-9f3a`;
// The "authorization code" the owner pastes back — echoed into the PTY buffer by the transcript below.
const PASTED_CODE = "authz-CODE-abc123-PASTED-SECRET";

/** A realistic transcript: a colour-wrapped (ANSI) banner + URL, then the token after the code. */
const HAPPY: ScriptedBehavior = {
  onSpawn: `[1mLong-lived token setup[0m\r\nVisit this URL to authorize:\r\n\r\n  [36m${AUTH_URL}[0m\r\n\r\nPaste code here: `,
  // complete() delivers the code and its Enter submit as TWO writes (paste-corruption fix). Echo the
  // code as a real PTY would; ONLY the carriage-return submit triggers the exchange → token, mirroring
  // the CLI (which exchanges on Enter, not on the paste). A no-op `{}` on the code write emits nothing.
  onWrite: (data) =>
    data.includes("\r")
      ? {
          emit: `\r\nExchanging…\r\n\r\nSuccess! Your token:\r\n\r\n${REAL_TOKEN}\r\n\r\nSaved.\r\n`,
          exit: 0,
        }
      : { emit: data },
};

// ── Scripted PTY fake ────────────────────────────────────────────────────────────────────────────────

interface ScriptedBehavior {
  /** Emitted (async, once listeners are attached) right after spawn — typically the auth-URL banner. */
  onSpawn?: string;
  /** If set, the pty exits with this code right after spawn (no URL) — the early-exit/garbage case. */
  exitAfterSpawn?: number;
  /** Reaction to a write (the pasted code): what to emit and whether to exit. */
  onWrite?: (data: string) => { emit?: string; exit?: number };
}

class ScriptedHandle implements PtyDriverHandle {
  killed = false;
  readonly writes: string[] = [];
  private readonly dataListeners: Array<(chunk: string) => void> = [];
  private readonly exitListeners: Array<(event: { exitCode: number }) => void> = [];

  constructor(private readonly behavior: ScriptedBehavior) {
    queueMicrotask(() => {
      if (this.killed) return;
      if (behavior.onSpawn) this.emit(behavior.onSpawn);
      if (behavior.exitAfterSpawn !== undefined) this.fireExit(behavior.exitAfterSpawn);
    });
  }

  onData(listener: (chunk: string) => void): void {
    this.dataListeners.push(listener);
  }

  onExit(listener: (event: { exitCode: number }) => void): void {
    this.exitListeners.push(listener);
  }

  write(data: string): void {
    this.writes.push(data);
    if (this.killed) return;
    const reaction = this.behavior.onWrite?.(data);
    if (!reaction) return;
    queueMicrotask(() => {
      if (this.killed) return;
      if (reaction.emit) this.emit(reaction.emit);
      if (reaction.exit !== undefined) this.fireExit(reaction.exit);
    });
  }

  kill(): void {
    this.killed = true;
  }

  private emit(chunk: string): void {
    for (const listener of this.dataListeners) listener(chunk);
  }

  private fireExit(exitCode: number): void {
    for (const listener of this.exitListeners) listener({ exitCode });
  }
}

class ScriptedPtyDriver implements PtyDriver {
  readonly handles: ScriptedHandle[] = [];
  constructor(private readonly behavior: ScriptedBehavior) {}
  spawn(_spec: PtySpawnSpec): PtyDriverHandle {
    const handle = new ScriptedHandle(this.behavior);
    this.handles.push(handle);
    return handle;
  }
  get last(): ScriptedHandle {
    const handle = this.handles.at(-1);
    if (!handle) throw new Error("no pty was spawned");
    return handle;
  }
}

const FAKE_SPAWN: PtySpawnSpec = { file: "fake-claude", args: ["setup-token"], env: {} };
const FAST_TIMEOUTS: FlowTimeouts = { urlMs: 120, tokenMs: 120, hardMs: 120 };

// ── Harness ──────────────────────────────────────────────────────────────────────────────────────────

const apps: FastifyInstance[] = [];
const databases: AppDatabase[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const db of databases.splice(0)) db.close();
});

interface Harness {
  app: FastifyInstance;
  db: AppDatabase;
  secrets: SecretStore;
  repo: AssistantRepository;
  providers: ProviderRepository;
  driver: ScriptedPtyDriver;
  auth: AssistantAuthService;
  logs: string[];
}

async function buildApp(
  behavior: ScriptedBehavior = HAPPY,
  timeouts: Partial<FlowTimeouts> = FAST_TIMEOUTS,
): Promise<Harness> {
  const db = new Database(":memory:") as AppDatabase;
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  databases.push(db);

  const secrets = new SecretStore(crypto.randomBytes(32));
  const repo = new AssistantRepository(db, secrets);
  const providers = new ProviderRepository(db, secrets);
  const driver = new ScriptedPtyDriver(behavior);
  // pasteDelayMs: 0 → the code + CR submit writes run synchronously so the scripted fake stays fast.
  const flow = new ClaudeOauthFlowManager({
    driver,
    resolveSpawn: () => FAKE_SPAWN,
    timeouts,
    pasteDelayMs: 0,
  });
  const auth = new AssistantAuthService(repo, providers, flow);

  // Capturing logger at info level: the redaction test greps EVERY log line for the token + code.
  const logs: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb): void {
      logs.push(chunk.toString());
      cb();
    },
  });
  const app = Fastify({ logger: { level: "info", stream } });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: "Validation failed", issues: error.issues });
    }
    const typed = error as Error & { statusCode?: number; code?: string };
    request.log.error(error); // exercise the log path so redaction is proven end-to-end
    const code =
      typeof typed.statusCode === "number" && typeof typed.code === "string"
        ? typed.code
        : undefined;
    return reply
      .code(typed.statusCode ?? 500)
      .send({ error: toErrorMessage(error), ...(code ? { code } : {}) });
  });
  await registerAssistantRoutes(app, { auth });
  await app.ready();
  apps.push(app);
  return { app, db, secrets, repo, providers, driver, auth, logs };
}

function seedProvider(
  providers: ProviderRepository,
  kind: "anthropic" | "openai",
  label: string,
): string {
  return providers.create({ kind, label, apiKey: "sk-test-provider-key" }).id;
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// ── Tests ──────────────────────────────────────────────────────────────────────────────────────────

test("parseTokenOutcome: token wins; a settled 'OAuth error' fails fast; otherwise keep waiting", () => {
  // The token is captured even if an error marker somehow co-exists (token is checked first).
  assert.deepEqual(parseTokenOutcome(`noise\r\n${REAL_TOKEN}\r\nSaved.`), { token: REAL_TOKEN });
  // A failed exchange: the CLI prints this and STAYS ALIVE — must be spotted so complete() fails fast
  // instead of blocking for the full tokenMs (the 2-minute spinner the owner hit).
  assert.deepEqual(
    parseTokenOutcome("OAuth error: Request failed with status code 400\r\nPress Enter to retry."),
    { error: true },
  );
  assert.deepEqual(parseTokenOutcome("Press Enter to retry."), { error: true });
  // Still just the prompt (no token, no error) → undefined so the wait continues.
  assert.equal(parseTokenOutcome("Paste code here if prompted >"), undefined);
});

test("PTY happy path: start returns the parsed URL, complete stores the token encrypted", async () => {
  const { app, db, secrets, repo, driver } = await buildApp();

  const start = await app.inject({ method: "POST", url: "/api/assistant/auth/oauth/start" });
  assert.equal(start.statusCode, 200);
  const startBody = start.json() as { flowId: string; authUrl: string };
  assert.ok(startBody.flowId, "start returns a flowId");
  assert.equal(startBody.authUrl, AUTH_URL, "the ANSI-wrapped URL is parsed cleanly");

  const complete = await app.inject({
    method: "POST",
    url: "/api/assistant/auth/oauth/complete",
    payload: { flowId: startBody.flowId, code: PASTED_CODE },
  });
  assert.equal(complete.statusCode, 200);
  const status = complete.json() as { signedIn: boolean; tokenAgeDays: number; models: string[] };
  assert.equal(status.signedIn, true, "signed in after completing the flow");
  assert.equal(status.tokenAgeDays, 0, "a fresh token is 0 days old");
  assert.deepEqual(status.models, [], "the roster is empty until WP 1.2");

  // Exactly one credential, stored ENCRYPTED, round-tripping back to the real token.
  const creds = repo.listCredentials();
  assert.equal(creds.length, 1, "exactly one stored credential");
  const row = db.prepare("SELECT token_encrypted FROM assistant_credentials").get() as {
    token_encrypted: string;
  };
  assert.ok(secrets.isEncrypted(row.token_encrypted), "token stored encrypted (enc:v1:…)");
  assert.notEqual(row.token_encrypted, REAL_TOKEN, "the raw token is never stored in cleartext");
  assert.equal(
    secrets.decryptText(row.token_encrypted),
    REAL_TOKEN,
    "decrypts back to the captured token",
  );

  // The PTY was cleaned up once the token was captured.
  assert.equal(driver.last.killed, true, "the pty is killed after the token is captured");
});

test("complete() writes the code and its Enter submit SEPARATELY (paste-corruption regression)", async () => {
  // Regression lock for the 400/invalid_grant paste bug: `claude setup-token` is an Ink TUI that can
  // submit before a glued ~90-char `code\r` fully registers, exchanging a truncated code. The CR MUST
  // be a separate write AFTER the code lands — never re-glue them into a single `${code}\r`.
  const { app, driver } = await buildApp();
  const start = await app.inject({ method: "POST", url: "/api/assistant/auth/oauth/start" });
  const { flowId } = start.json() as { flowId: string };
  const complete = await app.inject({
    method: "POST",
    url: "/api/assistant/auth/oauth/complete",
    payload: { flowId, code: PASTED_CODE },
  });
  assert.equal(complete.statusCode, 200, "the split-write flow still captures the token");
  assert.deepEqual(
    driver.last.writes,
    [PASTED_CODE, "\r"],
    "code is written first, then the CR alone",
  );
  assert.ok(!driver.last.writes[0]?.includes("\r"), "the code write carries no carriage return");
});

test("SECRETS: the token and pasted code never appear in any response body or log line", async () => {
  const { app, logs } = await buildApp();
  const bodies: string[] = [];

  const start = await app.inject({ method: "POST", url: "/api/assistant/auth/oauth/start" });
  bodies.push(start.body);
  const { flowId } = start.json() as { flowId: string };

  const complete = await app.inject({
    method: "POST",
    url: "/api/assistant/auth/oauth/complete",
    payload: { flowId, code: PASTED_CODE },
  });
  bodies.push(complete.body);

  const status = await app.inject({ method: "GET", url: "/api/assistant/auth/status" });
  bodies.push(status.body);

  // (a) No route response body carries the token or the pasted code.
  for (const body of bodies) {
    assert.ok(!body.includes(REAL_TOKEN), "response body never contains the token");
    assert.ok(!body.includes(PASTED_CODE), "response body never contains the pasted code");
  }

  // (b) The captured pino log stream (whole flow) carries neither the token nor the pasted code.
  const allLogs = logs.join("");
  assert.ok(allLogs.length > 0, "the logger actually captured request log lines");
  assert.ok(!allLogs.includes(REAL_TOKEN), "no log line contains the token");
  assert.ok(!allLogs.includes(PASTED_CODE), "no log line contains the pasted code");
});

test("SECRETS: a garbage-at-complete 502 logs an error but never leaks raw CLI output", async () => {
  // The transcript prints the URL, then on the code paste emits UNPARSEABLE noise (no token) + exits.
  // The noise carries a distinctive marker whose absence from the response + logs proves the raw CLI
  // transcript is never surfaced (the 502 path uses a static message, never echoes output).
  const RAW_NOISE_MARKER = "RAW-CLI-NOISE-MARKER-do-not-leak";
  const { app, logs } = await buildApp({
    onSpawn: `Authorize at: ${AUTH_URL}\r\n`,
    // React on the CR submit (complete() now writes code then CR separately); no-op the code write.
    onWrite: (data) =>
      data.includes("\r")
        ? { emit: `${RAW_NOISE_MARKER} unexpected output; no token here\r\n`, exit: 1 }
        : {},
  });

  const start = await app.inject({ method: "POST", url: "/api/assistant/auth/oauth/start" });
  const { flowId } = start.json() as { flowId: string };
  const complete = await app.inject({
    method: "POST",
    url: "/api/assistant/auth/oauth/complete",
    payload: { flowId, code: PASTED_CODE },
  });

  // 502 with the paste-remediation code; the raw noise is not echoed into the response, and the
  // error-log path (request.log.error) never carries it either.
  assert.equal(complete.statusCode, 502);
  const body = complete.json() as { error: string; code?: string };
  assert.equal(body.code, "ASSISTANT_AUTH_PARSE_FAILED");
  assert.ok(/paste/i.test(body.error), "the error points at the manual paste path");
  assert.ok(!complete.body.includes(RAW_NOISE_MARKER), "raw CLI output never reaches the response");
  const allLogs = logs.join("");
  assert.ok(allLogs.length > 0, "the error path actually logged something");
  assert.ok(!allLogs.includes(RAW_NOISE_MARKER), "raw CLI output is never logged");
  assert.ok(!allLogs.includes(PASTED_CODE), "the pasted code is never logged on the error path");
});

test("garbage at start (no URL) → 502 with a paste hint; the pty is cleaned up", async () => {
  const { app, driver } = await buildApp({
    onSpawn: "no url here, just noise\r\nstill nothing\r\n",
  });

  const start = await app.inject({ method: "POST", url: "/api/assistant/auth/oauth/start" });
  assert.equal(start.statusCode, 502);
  const body = start.json() as { error: string; code?: string };
  assert.equal(body.code, "ASSISTANT_AUTH_PARSE_FAILED");
  assert.ok(/paste/i.test(body.error));
  assert.equal(driver.last.killed, true, "the pty is killed when the URL never parses");
});

test("hard timeout auto-cancels an abandoned flow and cleans up the pty", async () => {
  // Emit the URL (start succeeds) but never react to the code — the idle hard-timeout must fire.
  const { app, driver, auth } = await buildApp(
    { onSpawn: `Authorize: ${AUTH_URL}\r\n` },
    { urlMs: 200, tokenMs: 200, hardMs: 40 },
  );

  const start = await app.inject({ method: "POST", url: "/api/assistant/auth/oauth/start" });
  assert.equal(start.statusCode, 200);
  const { flowId } = start.json() as { flowId: string };

  await delay(120); // let the 40ms hard-timeout fire

  assert.equal(driver.last.killed, true, "the abandoned flow's pty is killed by the hard timeout");
  // The flow state is cleared: completing the stale flow now 409s, and a fresh start succeeds.
  const stale = await app.inject({
    method: "POST",
    url: "/api/assistant/auth/oauth/complete",
    payload: { flowId, code: PASTED_CODE },
  });
  assert.equal(stale.statusCode, 409, "the timed-out flow no longer accepts a completion");
  assert.equal(auth.getStatus().signedIn, false, "no credential was stored for the abandoned flow");
  const restart = await app.inject({ method: "POST", url: "/api/assistant/auth/oauth/start" });
  assert.equal(restart.statusCode, 200, "a new sign-in can start after the timeout cleaned up");
});

test("single-flight: a second start while one is active is rejected (409)", async () => {
  const { app } = await buildApp({ onSpawn: `Authorize: ${AUTH_URL}\r\n` });

  const first = await app.inject({ method: "POST", url: "/api/assistant/auth/oauth/start" });
  assert.equal(first.statusCode, 200);

  const second = await app.inject({ method: "POST", url: "/api/assistant/auth/oauth/start" });
  assert.equal(second.statusCode, 409, "only one sign-in flow at a time");

  // Cancel clears the flow so a later start works again.
  const cancel = await app.inject({
    method: "POST",
    url: "/api/assistant/auth/oauth/cancel",
    payload: {},
  });
  assert.equal(cancel.statusCode, 200);
  const third = await app.inject({ method: "POST", url: "/api/assistant/auth/oauth/start" });
  assert.equal(third.statusCode, 200, "start works again after cancel");
});

test("paste path stores a valid token; rejects a bad prefix / too-short token with 400", async () => {
  const { app, db, secrets } = await buildApp();

  const ok = await app.inject({
    method: "POST",
    url: "/api/assistant/auth/token",
    payload: { token: REAL_TOKEN },
  });
  assert.equal(ok.statusCode, 200);
  assert.equal((ok.json() as { signedIn: boolean }).signedIn, true);
  const row = db.prepare("SELECT token_encrypted FROM assistant_credentials").get() as {
    token_encrypted: string;
  };
  assert.equal(
    secrets.decryptText(row.token_encrypted),
    REAL_TOKEN,
    "pasted token stored encrypted",
  );
  assert.ok(!ok.body.includes(REAL_TOKEN), "the paste response never echoes the token back");

  const wrongPrefix = await app.inject({
    method: "POST",
    url: "/api/assistant/auth/token",
    payload: { token: "sk-ant-api03-not-an-oauth-token" },
  });
  assert.equal(wrongPrefix.statusCode, 400, "a non-oauth prefix is rejected");

  const tooShort = await app.inject({
    method: "POST",
    url: "/api/assistant/auth/token",
    payload: { token: "sk-ant-oat01-x" },
  });
  assert.equal(tooShort.statusCode, 400, "a too-short token is rejected");
});

test("fallback: accepts an anthropic ref, rejects unknown / non-anthropic refs, clears with null", async () => {
  const { app, providers } = await buildApp();
  const anthropicId = seedProvider(providers, "anthropic", "Prod Anthropic");
  const openAiId = seedProvider(providers, "openai", "Prod OpenAI");

  const set = await app.inject({
    method: "PUT",
    url: "/api/assistant/auth/fallback",
    payload: { providerCredentialId: anthropicId },
  });
  assert.equal(set.statusCode, 200);
  const status = set.json() as {
    fallbackConfigured: boolean;
    fallbackProviderCredentialId?: string;
  };
  assert.equal(status.fallbackConfigured, true);
  assert.equal(status.fallbackProviderCredentialId, anthropicId);

  const missing = await app.inject({
    method: "PUT",
    url: "/api/assistant/auth/fallback",
    payload: { providerCredentialId: "does-not-exist" },
  });
  assert.equal(missing.statusCode, 400, "a non-existent provider ref is rejected");

  const nonAnthropic = await app.inject({
    method: "PUT",
    url: "/api/assistant/auth/fallback",
    payload: { providerCredentialId: openAiId },
  });
  assert.equal(nonAnthropic.statusCode, 400, "a non-anthropic provider ref is rejected");
  // The rejected writes never changed the stored fallback (still the anthropic one).
  assert.equal(
    (await app.inject({ method: "GET", url: "/api/assistant/auth/status" })).json()
      .fallbackProviderCredentialId,
    anthropicId,
  );

  const clear = await app.inject({
    method: "PUT",
    url: "/api/assistant/auth/fallback",
    payload: { providerCredentialId: null },
  });
  assert.equal(clear.statusCode, 200);
  assert.equal((clear.json() as { fallbackConfigured: boolean }).fallbackConfigured, false);
});

test("status reflects signed-out vs signed-in and computes token age / expiry signal", async () => {
  const { app, db } = await buildApp();

  const out = (await app.inject({ method: "GET", url: "/api/assistant/auth/status" })).json();
  assert.equal(out.signedIn, false);
  assert.equal(out.fallbackConfigured, false);
  assert.deepEqual(out.models, []);
  assert.equal(out.tokenAgeDays, undefined, "no age when signed out");

  await app.inject({
    method: "POST",
    url: "/api/assistant/auth/token",
    payload: { token: REAL_TOKEN },
  });
  // Backdate the credential 340 days so the age crosses the 335-day expiry-warning threshold.
  const past = new Date(Date.now() - 340 * 86_400_000).toISOString();
  db.prepare("UPDATE assistant_credentials SET created_at = ?").run(past);

  const inStatus = (await app.inject({ method: "GET", url: "/api/assistant/auth/status" })).json();
  assert.equal(inStatus.signedIn, true);
  assert.equal(inStatus.tokenAgeDays, 340, "age computed from created_at");
  assert.ok(inStatus.tokenAgeDays >= 335, "an old token crosses the expiry-warning threshold");
});

test("sign out deletes the credential and fires the (WP 1.1) kill-hook", async () => {
  const { app, repo, auth } = await buildApp();
  let killHookFired = false;
  auth.setSignOutHook(async () => {
    killHookFired = true;
  });

  await app.inject({
    method: "POST",
    url: "/api/assistant/auth/token",
    payload: { token: REAL_TOKEN },
  });
  assert.equal(repo.listCredentials().length, 1, "a credential exists before sign-out");

  const out = await app.inject({ method: "DELETE", url: "/api/assistant/auth" });
  assert.equal(out.statusCode, 200);
  assert.equal((out.json() as { signedIn: boolean }).signedIn, false);
  assert.equal(repo.listCredentials().length, 0, "the credential row is deleted");
  assert.equal(killHookFired, true, "the sign-out kill-hook fired");

  // Idempotent: signing out again is a no-op 200 (no 404).
  const again = await app.inject({ method: "DELETE", url: "/api/assistant/auth" });
  assert.equal(again.statusCode, 200);
});
