import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { pathToFileURL } from "node:url";
import { afterEach, before, test } from "node:test";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { SkillGitService } from "../src/skills/git-service.js";
import { SkillIngestService } from "../src/skills/ingest-service.js";
import type { CreateRepoFn, CreateRepoResult } from "../src/skills/publish-service.js";
import { SkillPublishService } from "../src/skills/publish-service.js";
import type { DnsLookupAll } from "../src/skills/git-service.js";
import { SkillRepository } from "../src/skills/repository.js";
import { registerSkillRoutes } from "../src/skills/routes.js";
import { toErrorMessage } from "../src/utils/errors.js";

// WP 7.1 (I6) — publish a skill version to a NEW GitHub repo, fully OFFLINE. The repo-creation REST
// call is INJECTED (a local `file://` bare repo stands in for the created remote), so nothing hits
// the network; the git init/commit/push mechanics run against that bare repo exactly as they would
// against a real GitHub clone URL. `git` (v2.43 here) is required; if unavailable we skip.

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
  // Best-effort cleanup: `git commit` can spawn a detached `git gc --auto` that races the rmdir; a
  // leaked ephemeral temp dir never affects correctness, so retry generously then swallow.
  for (const dir of tmpRoots.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch {
      // ignore — discarded by the OS/runner regardless
    }
  }
});

function mkTmp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpRoots.push(dir);
  return dir;
}

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

/** A brand-new, empty bare repo (default branch `main`) exposed as a `file://` clone URL. */
function initBare(): { dir: string; url: string } {
  const dir = mkTmp("skill-ide-publish-remote-");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", dir], { stdio: "ignore" });
  return { dir, url: pathToFileURL(dir).toString() };
}

/** A non-bare repo with an initial commit (drives the "already github-bound" import). */
function initRepo(tree: Record<string, string>): { dir: string; url: string } {
  const dir = mkTmp("skill-ide-publish-source-");
  gitRun(dir, ["init", "-q", "-b", "main"]);
  for (const [rel, content] of Object.entries(tree)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  gitRun(dir, ["add", "-A"]);
  gitRun(dir, ["commit", "-q", "-m", "initial"]);
  return { dir, url: pathToFileURL(dir).toString() };
}

/** Clone the pushed remote back and read its tree: sorted paths, per-path bytes, commit subject. */
function readRemoteTree(url: string): {
  paths: string[];
  contents: Map<string, Buffer>;
  subject: string;
} {
  const work = mkTmp("skill-ide-publish-clone-");
  execFileSync("git", ["clone", "-q", url, work], { stdio: "ignore" });
  const paths = execFileSync("git", ["-C", work, "ls-tree", "-r", "--name-only", "HEAD"])
    .toString()
    .trim()
    .split("\n")
    .filter(Boolean)
    .sort();
  const contents = new Map<string, Buffer>();
  for (const p of paths) contents.set(p, fs.readFileSync(path.join(work, ...p.split("/"))));
  const subject = execFileSync("git", ["-C", work, "log", "-1", "--format=%s"]).toString().trim();
  return { paths, contents, subject };
}

const SKILL_A =
  "---\nname: pdf-tools\ndescription: Work with PDF files.\n---\n\n# PDF Tools\n\nBody text.";

type BuildAppResult = {
  app: FastifyInstance;
  repo: SkillRepository;
  secrets: SecretStore;
  git: SkillGitService;
  dataDir: string;
  logs: string[];
};

async function buildApp(
  createRepo?: CreateRepoFn,
  overrides: { lookup?: DnsLookupAll } = {},
): Promise<BuildAppResult> {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  databases.push(db);

  const secrets = new SecretStore(Buffer.alloc(32, 9));
  const repo = new SkillRepository(db, secrets);
  const dataDir = mkTmp("skill-ide-publish-data-");
  const ingest = new SkillIngestService(repo, { dataDir, tokenProfile: "generic_o200k" });
  const gitService = new SkillGitService(repo, {
    dataDir,
    tokenProfile: "generic_o200k",
    gitTimeoutMs: 30_000,
  });
  const publish = new SkillPublishService(repo, {
    dataDir,
    gitTimeoutMs: 30_000,
    createRepo,
    lookup: overrides.lookup,
  });

  // Capturing logger: the redaction test asserts the PAT never reaches ANY log line.
  const logs: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb): void {
      logs.push(chunk.toString());
      cb();
    },
  });
  const app = Fastify({ logger: { level: "error", stream } });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: "Validation failed" });
    const typed = error as Error & { statusCode?: number };
    request.log.error(error); // exercise the log path so redaction is proven end-to-end
    return reply.code(typed.statusCode ?? 500).send({ error: toErrorMessage(error) });
  });
  await registerSkillRoutes(app, repo, ingest, gitService, publish);
  await app.ready();
  apps.push(app);
  return { app, repo, secrets, git: gitService, dataDir, logs };
}

/** Seed an upload skill with a known tree → { skillId, versionId, files }. */
function seedSkill(
  repo: SkillRepository,
  tree: Record<string, Buffer | string>,
): { skillId: string; versionId: string; files: Array<{ path: string; bytes: Buffer }> } {
  const skill = repo.create({ name: "pdf-tools", sourceType: "upload" });
  const files = Object.entries(tree).map(([p, c]) => ({
    path: p,
    bytes: Buffer.isBuffer(c) ? c : Buffer.from(c),
  }));
  const result = repo.createVersion(skill.id, files, {
    sourceKind: "upload",
    importedFrom: "upload",
  });
  return { skillId: skill.id, versionId: result.version.id, files };
}

/** Assert the publisher left no residue under `DATA_DIR/tmp` (every clone/materialize is cleaned). */
function assertTmpClean(dataDir: string): void {
  const tmp = path.join(dataDir, "tmp");
  if (fs.existsSync(tmp)) {
    assert.equal(fs.readdirSync(tmp).length, 0, "publish left a temp dir behind");
  }
}

const fileRepo: (bare: { url: string }, html?: string) => CreateRepoFn =
  (bare, html = "https://github.example/acme/repo") =>
  async (): Promise<CreateRepoResult> => ({ cloneUrl: bare.url, htmlUrl: html });

function publishReq(
  skillId: string,
  versionId: string,
  body: Record<string, unknown>,
): { method: "POST"; url: string; payload: Record<string, unknown> } {
  return {
    method: "POST",
    url: `/api/skills/${skillId}/versions/${versionId}/publish-github`,
    payload: body,
  };
}

test("publish pushes the version tree verbatim as the initial commit", async (t) => {
  if (!gitAvailable) return t.skip("git unavailable");
  const bare = initBare();
  const { app, repo, dataDir } = await buildApp(fileRepo(bare, "https://github.example/acme/repo"));
  const seed = seedSkill(repo, {
    "SKILL.md": SKILL_A,
    "references/API.md": "reference doc",
    "scripts/run.sh": "#!/bin/sh\necho hi\n",
    "logo.bin": Buffer.from([0, 1, 2, 255, 0, 7]), // a real binary blob (NUL bytes)
  });

  const res = await app.inject(
    publishReq(seed.skillId, seed.versionId, {
      repoName: "repo",
      private: false,
      token: "ghp_publish",
      bindAsSource: false,
    }),
  );
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.repoUrl, "https://github.example/acme/repo"); // the html url, NOT the clone url
  assert.equal(body.bound, false);
  assert.ok(!res.body.includes("ghp_publish"), "PAT never appears in the response");

  const remote = readRemoteTree(bare.url);
  assert.deepEqual(
    remote.paths,
    seed.files.map((f) => f.path).sort(),
    "remote tree paths match the version exactly",
  );
  for (const f of seed.files) {
    assert.ok(
      remote.contents.get(f.path)?.equals(f.bytes),
      `content of ${f.path} matches byte-for-byte`,
    );
  }
  assert.equal(remote.subject, "Initial commit from pdf-tools v1");
  assertTmpClean(dataDir);
});

test("a second publish to the same (now non-empty) target is refused with 409", async (t) => {
  if (!gitAvailable) return t.skip("git unavailable");
  const bare = initBare();
  const { app, repo, dataDir } = await buildApp(fileRepo(bare));
  const seed = seedSkill(repo, { "SKILL.md": SKILL_A });

  const first = await app.inject(
    publishReq(seed.skillId, seed.versionId, {
      repoName: "repo",
      private: false,
      token: "ghp_x",
      bindAsSource: false,
    }),
  );
  assert.equal(first.statusCode, 200);

  const second = await app.inject(
    publishReq(seed.skillId, seed.versionId, {
      repoName: "repo",
      private: false,
      token: "ghp_x",
      bindAsSource: false,
    }),
  );
  assert.equal(second.statusCode, 409, "non-empty remote → 409 (no force-push)");
  assertTmpClean(dataDir);
});

test("bindAsSource binds the new repo as the skill's github source; pull then sees no change", async (t) => {
  if (!gitAvailable) return t.skip("git unavailable");
  const bare = initBare();
  const { app, repo, secrets, dataDir } = await buildApp(fileRepo(bare));
  const seed = seedSkill(repo, { "SKILL.md": SKILL_A, "references/API.md": "ref" });

  const res = await app.inject(
    publishReq(seed.skillId, seed.versionId, {
      repoName: "repo",
      private: true,
      token: "ghp_bindsecret",
      bindAsSource: true,
    }),
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().bound, true);

  // The skill now presents as a github source (redacted view: repoUrl/ref/subpath + hasAuth only).
  const skill = repo.getPublic(seed.skillId);
  assert.equal(skill.sourceType, "github");
  assert.equal(skill.github?.repoUrl, bare.url);
  assert.equal(skill.github?.ref, "main");
  assert.equal(skill.github?.subpath, "");
  assert.equal(skill.github?.hasAuth, true);
  assert.equal("token" in (skill.github ?? {}), false);
  assert.ok(!JSON.stringify(skill).includes("ghp_bindsecret"), "PAT never in the wire body");

  // The PAT was persisted encrypted (round-trips through SecretStore).
  const row = databases[databases.length - 1]!.prepare(
    "SELECT github_auth_ref FROM skills WHERE id = ?",
  ).get(seed.skillId) as { github_auth_ref: string | null };
  assert.ok(
    row.github_auth_ref && secrets.isEncrypted(row.github_auth_ref),
    "PAT stored encrypted",
  );
  assert.equal(secrets.decryptText(row.github_auth_ref!), "ghp_bindsecret");

  // Pull the freshly-bound repo: the recorded sha == remote HEAD, so it is a clean no-op.
  const pull = await app.inject({ method: "POST", url: `/api/skills/${seed.skillId}/pull` });
  assert.equal(pull.statusCode, 200);
  assert.deepEqual(pull.json(), { unchanged: true });
  assertTmpClean(dataDir);
});

test("publishing-as-source an already github-bound skill is refused with 409", async (t) => {
  if (!gitAvailable) return t.skip("git unavailable");
  const bare = initBare();
  const { app, repo, git, dataDir } = await buildApp(fileRepo(bare));
  const source = initRepo({ "SKILL.md": SKILL_A });
  const imported = await git.importSkill({
    repoUrl: source.url,
    ref: "main",
    subpath: "",
    token: "ghp_import",
  });
  const skill = repo.getPublic(imported.skillId);

  const res = await app.inject(
    publishReq(imported.skillId, skill.currentVersionId!, {
      repoName: "repo",
      private: false,
      token: "ghp_x",
      bindAsSource: true,
    }),
  );
  assert.equal(res.statusCode, 409, "already-bound skill refuses a silent rebind");
  assertTmpClean(dataDir);
});

test("an invalid repo name is rejected with 400 (schema pattern)", async (t) => {
  if (!gitAvailable) return t.skip("git unavailable");
  const { app, repo } = await buildApp(fileRepo({ url: "unused" }));
  const seed = seedSkill(repo, { "SKILL.md": SKILL_A });

  const res = await app.inject(
    publishReq(seed.skillId, seed.versionId, {
      repoName: "bad name!!",
      private: false,
      token: "ghp_x",
      bindAsSource: false,
    }),
  );
  assert.equal(res.statusCode, 400);
});

test("no token in the body and none stored on the skill → 400", async (t) => {
  if (!gitAvailable) return t.skip("git unavailable");
  const { app, repo } = await buildApp(fileRepo({ url: "unused" }));
  const seed = seedSkill(repo, { "SKILL.md": SKILL_A }); // upload skill, no stored PAT

  const res = await app.inject(
    publishReq(seed.skillId, seed.versionId, {
      repoName: "repo",
      private: false,
      bindAsSource: false,
    }),
  );
  assert.equal(res.statusCode, 400);
});

test("the PAT is redacted from every surfaced error and log line", async (t) => {
  if (!gitAvailable) return t.skip("git unavailable");
  const secret = "ghp_TOKEN_MUST_NOT_LEAK_9f8a7b6c5d";
  // A createRepo returning an https URL that will fail to resolve → the git subprocess emits the
  // credential-bearing URL in its error, which MUST be redacted before it reaches the response/logs.
  const cloneUrl = "https://publish-redaction-xyz.invalid/acme/repo.git";
  const { app, repo, dataDir, logs } = await buildApp(
    async () => ({ cloneUrl, htmlUrl: "https://publish-redaction-xyz.invalid/acme/repo" }),
    // Force the SSRF guard's DNS lookup to fail (so it defers to git) without any real resolution.
    {
      lookup: async () => {
        throw new Error("ENOTFOUND (test)");
      },
    },
  );
  const seed = seedSkill(repo, { "SKILL.md": SKILL_A });

  const res = await app.inject(
    publishReq(seed.skillId, seed.versionId, {
      repoName: "repo",
      private: false,
      token: secret,
      bindAsSource: false,
    }),
  );

  assert.notEqual(res.statusCode, 200, "the unreachable remote fails the publish");
  assert.ok(!res.body.includes(secret), "PAT never appears in the response body");
  assert.ok(!logs.join("").includes(secret), "PAT never appears in any log line");
  assertTmpClean(dataDir);
});
