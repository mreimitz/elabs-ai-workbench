import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, before, test } from "node:test";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { AppSettingsRepository } from "../src/grading/app-settings-repository.js";
import { GITHUB_ACCOUNT_SETTING_KEY, GithubAccountService } from "../src/github-account/service.js";
import { registerGithubAccountRoutes } from "../src/github-account/routes.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { SkillGitService } from "../src/skills/git-service.js";
import { SkillIngestService } from "../src/skills/ingest-service.js";
import { SkillPublishService } from "../src/skills/publish-service.js";
import { SkillPushService } from "../src/skills/push-service.js";
import { SkillRepository } from "../src/skills/repository.js";
import { registerSkillRoutes } from "../src/skills/routes.js";
import { toErrorMessage } from "../src/utils/errors.js";

// The app-wide GitHub account (Settings sign-in via the OAuth DEVICE FLOW), fully OFFLINE: every
// github.com call goes through an injected fetch script. Asserted invariants: the token is stored
// ENCRYPTED in the app_settings KV, never appears in any response, and acts as the LAST fallback in
// the skills token resolution (dialog token → per-skill PAT → account).

const apps: FastifyInstance[] = [];
const databases: AppDatabase[] = [];
const tmpRoots: string[] = [];
let gitAvailable = false;

before(() => {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    gitAvailable = true;
  } catch {
    gitAvailable = false;
  }
});

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const db of databases.splice(0)) db.close();
  for (const dir of tmpRoots.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch {
      // ignore
    }
  }
});

function mkTmp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpRoots.push(dir);
  return dir;
}

/** A scripted fetch: each call shifts the next queued responder (throws when the script runs dry). */
type Responder = (url: string, init?: RequestInit) => Response;
function scriptedFetch(queue: Responder[]): { fetchImpl: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    const responder = queue.shift();
    if (!responder) throw new Error(`Unexpected fetch: ${url}`);
    return responder(url, init);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const json = (body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
  });

function buildService(queue: Responder[]): {
  service: GithubAccountService;
  settings: AppSettingsRepository;
  secrets: SecretStore;
  db: AppDatabase;
} {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  databases.push(db);
  const settings = new AppSettingsRepository(db);
  const secrets = new SecretStore(Buffer.alloc(32, 7));
  const { fetchImpl } = scriptedFetch(queue);
  const service = new GithubAccountService(settings, secrets, { fetchImpl });
  return { service, settings, secrets, db };
}

async function buildRoutesApp(service: GithubAccountService): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: "Validation failed" });
    const typed = error as Error & { statusCode?: number };
    return reply.code(typed.statusCode ?? 500).send({ error: toErrorMessage(error) });
  });
  registerGithubAccountRoutes(app, service);
  await app.ready();
  apps.push(app);
  return app;
}

test("device flow: start → pending → slow_down → connected; token encrypted, never surfaced", async () => {
  const token = "gho_DEVICE_FLOW_TOKEN_abc123";
  const { service, settings, secrets } = buildService([
    // start → device/code
    () =>
      json({
        device_code: "devcode-1",
        user_code: "ABCD-1234",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 5,
      }),
    // poll 1 → pending
    () => json({ error: "authorization_pending" }),
    // poll 2 → slow_down (interval 10)
    () => json({ error: "slow_down", interval: 10 }),
    // poll 3 → token
    () => json({ access_token: token, token_type: "bearer", scope: "repo" }),
    // identity → GET /user
    () =>
      json(
        { login: "mreimitz", name: "Manuel Reimitz", avatar_url: "https://avatars.example/1" },
        { "x-oauth-scopes": "repo" },
      ),
  ]);
  const app = await buildRoutesApp(service);

  // No client id yet → start refuses with 400.
  const early = await app.inject({ method: "POST", url: "/api/github/device/start", payload: {} });
  assert.equal(early.statusCode, 400);

  const cfg = await app.inject({
    method: "PUT",
    url: "/api/github/client-id",
    payload: { clientId: "Iv1.testclient" },
  });
  assert.equal(cfg.statusCode, 200);
  assert.equal(cfg.json().clientIdConfigured, true);

  const start = await app.inject({ method: "POST", url: "/api/github/device/start", payload: {} });
  assert.equal(start.statusCode, 200, start.body);
  const flow = start.json();
  assert.equal(flow.userCode, "ABCD-1234");
  assert.equal(flow.verificationUri, "https://github.com/login/device");
  assert.ok(flow.flowId);
  assert.ok(!start.body.includes("devcode-1"), "the GitHub device_code never leaves the server");

  const poll = (): Promise<ReturnType<FastifyInstance["inject"]>> =>
    app.inject({
      method: "POST",
      url: "/api/github/device/poll",
      payload: { flowId: flow.flowId },
    });

  const p1 = await poll();
  assert.deepEqual(p1.json(), { status: "pending", interval: 5 });
  const p2 = await poll();
  assert.deepEqual(p2.json(), { status: "pending", interval: 10 }, "slow_down bumps the interval");
  const p3 = await poll();
  assert.equal(p3.statusCode, 200, p3.body);
  const connected = p3.json();
  assert.equal(connected.status, "connected");
  assert.equal(connected.account.login, "mreimitz");
  assert.deepEqual(connected.account.scopes, ["repo"]);
  assert.ok(!p3.body.includes(token), "the access token never appears in a response");

  // Status reflects the signed-in identity — still no token anywhere in the body.
  const status = await app.inject({ method: "GET", url: "/api/github/account" });
  assert.equal(status.json().connected, true);
  assert.equal(status.json().login, "mreimitz");
  assert.ok(!status.body.includes(token));

  // The persisted record carries only an ENCRYPTED blob; it round-trips through SecretStore.
  const stored = settings.get(GITHUB_ACCOUNT_SETTING_KEY) as { tokenEncrypted?: string };
  assert.ok(stored.tokenEncrypted && secrets.isEncrypted(stored.tokenEncrypted));
  assert.equal(secrets.decryptText(stored.tokenEncrypted), token);
  assert.equal(service.token(), token);

  // A finished flow handle is gone (404), not replayable.
  const replay = await poll();
  assert.equal(replay.statusCode, 404);

  // Sign out drops token + identity but keeps the configured client id.
  const out = await app.inject({ method: "DELETE", url: "/api/github/account" });
  assert.equal(out.json().connected, false);
  assert.equal(out.json().clientIdConfigured, true);
  assert.equal(service.token(), undefined);
});

test("device flow terminal failures: access_denied and expired_token → 400, flow dropped", async () => {
  const { service } = buildService([
    () => json({ device_code: "d1", user_code: "U1", expires_in: 900, interval: 5 }),
    () => json({ error: "access_denied" }),
    () => json({ device_code: "d2", user_code: "U2", expires_in: 900, interval: 5 }),
    () => json({ error: "expired_token" }),
  ]);
  const app = await buildRoutesApp(service);
  await app.inject({ method: "PUT", url: "/api/github/client-id", payload: { clientId: "c1" } });

  const s1 = (
    await app.inject({ method: "POST", url: "/api/github/device/start", payload: {} })
  ).json();
  const denied = await app.inject({
    method: "POST",
    url: "/api/github/device/poll",
    payload: { flowId: s1.flowId },
  });
  assert.equal(denied.statusCode, 400);
  assert.match(denied.json().error, /declined/);

  const s2 = (
    await app.inject({ method: "POST", url: "/api/github/device/start", payload: {} })
  ).json();
  const expired = await app.inject({
    method: "POST",
    url: "/api/github/device/poll",
    payload: { flowId: s2.flowId },
  });
  assert.equal(expired.statusCode, 400);
  assert.match(expired.json().error, /expired/);
});

// --- Skills token-resolution fallback (dialog → per-skill → account) ------------------------------

const SKILL_V1 =
  "---\nname: pdf-tools\ndescription: Work with PDF files.\n---\n\n# PDF Tools\n\nBody v1.";
const SKILL_V2 =
  "---\nname: pdf-tools\ndescription: Work with PDF files.\n---\n\n# PDF Tools\n\nBody v2.";

function gitRun(cwd: string, args: string[]): void {
  execFileSync("git", args, {
    cwd,
    stdio: "ignore",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  });
}

function initBareWithTree(tree: Record<string, string>): { url: string } {
  const bare = mkTmp("gh-account-remote-");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", bare], { stdio: "ignore" });
  const work = mkTmp("gh-account-seed-");
  gitRun(work, ["init", "-q", "-b", "main"]);
  for (const [rel, content] of Object.entries(tree)) {
    const abs = path.join(work, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  gitRun(work, ["add", "-A"]);
  gitRun(work, ["commit", "-q", "-m", "initial"]);
  gitRun(work, ["push", "-q", pathToFileURL(bare).toString(), "main"]);
  return { url: pathToFileURL(bare).toString() };
}

test("push with NO dialog token and NO per-skill PAT falls back to the signed-in account", async (t) => {
  if (!gitAvailable) return t.skip("git unavailable");

  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  databases.push(db);
  const secrets = new SecretStore(Buffer.alloc(32, 7));
  const settings = new AppSettingsRepository(db);
  // A signed-in account, seeded directly (the device-flow mechanics are proven above).
  settings.put(GITHUB_ACCOUNT_SETTING_KEY, {
    clientId: "c1",
    tokenEncrypted: secrets.encryptText("gho_account_token"),
    login: "mreimitz",
  });
  const account = new GithubAccountService(settings, secrets, {
    fetchImpl: (async () => {
      throw new Error("no network expected");
    }) as typeof fetch,
  });

  const repo = new SkillRepository(db, secrets);
  const dataDir = mkTmp("gh-account-data-");
  const ingest = new SkillIngestService(repo, { dataDir, tokenProfile: "generic_o200k" });
  const gitService = new SkillGitService(repo, {
    dataDir,
    tokenProfile: "generic_o200k",
    gitTimeoutMs: 30_000,
    accountToken: () => account.token(),
  });
  const publish = new SkillPublishService(repo, { dataDir, gitTimeoutMs: 30_000 });
  const push = new SkillPushService(repo, { dataDir, gitTimeoutMs: 30_000 });

  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: "Validation failed" });
    const typed = error as Error & { statusCode?: number };
    return reply.code(typed.statusCode ?? 500).send({ error: toErrorMessage(error) });
  });
  await registerSkillRoutes(
    app,
    repo,
    ingest,
    gitService,
    publish,
    undefined as never,
    undefined as never,
    undefined as never,
    // Server-types WP 3.1 (D-ST3) inserted `serverTypes?` before `options`; this offline
    // account-fallback test omits it (type resolution is inert here) so the options object below
    // keeps its correct parameter slot and the github-account push fallback stays wired.
    undefined as never,
    { push, githubAccountToken: () => account.token() },
  );
  await app.ready();
  apps.push(app);

  // Import WITHOUT a token (public repo, nothing stored per-skill), then edit locally.
  const remote = initBareWithTree({ "SKILL.md": SKILL_V1 });
  const imported = await gitService.importSkill({ repoUrl: remote.url, ref: "main", subpath: "" });
  const edited = repo.createVersion(
    imported.skillId,
    [{ path: "SKILL.md", bytes: Buffer.from(SKILL_V2) }],
    { sourceKind: "upload", importedFrom: "upload" },
  );

  // No body token + no per-skill PAT: WITHOUT the account this is the documented 400 — with the
  // signed-in account it resolves and the push lands.
  const res = await app.inject({
    method: "POST",
    url: `/api/skills/${imported.skillId}/versions/${edited.version.id}/push-github`,
    payload: { mode: "direct" },
  });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().unchanged, false);
  assert.ok(!res.body.includes("gho_account_token"), "the account token never leaks");

  // Signed out → the same request is back to the honest 400.
  account.disconnect();
  const after = await app.inject({
    method: "POST",
    url: `/api/skills/${imported.skillId}/versions/${edited.version.id}/push-github`,
    payload: { mode: "direct" },
  });
  assert.equal(after.statusCode, 400);
  assert.match(after.json().error, /sign in with GitHub/i);
});
