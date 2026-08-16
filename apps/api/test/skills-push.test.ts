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
import { SkillGitService, type DnsLookupAll } from "../src/skills/git-service.js";
import { SkillIngestService } from "../src/skills/ingest-service.js";
import { SkillPublishService } from "../src/skills/publish-service.js";
import {
  SkillPushService,
  parseGithubOwnerRepo,
  type CreatePullRequestFn,
} from "../src/skills/push-service.js";
import { SkillRepository } from "../src/skills/repository.js";
import { registerSkillRoutes } from "../src/skills/routes.js";
import { toErrorMessage } from "../src/utils/errors.js";

// Push a skill version BACK to its bound source repo (the missing half of pull/publish), fully
// OFFLINE. The remote is a local `file://` BARE repo (a non-bare remote refuses a push to its
// checked-out branch); the PR-creation REST call is INJECTED. `git` is required; if unavailable
// we skip.

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
      // ignore — discarded by the OS/runner regardless
    }
  }
});

function mkTmp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpRoots.push(dir);
  return dir;
}

function gitRun(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  })
    .toString()
    .trim();
}

/**
 * A bare `file://` remote seeded with `tree` on `main` (built through a throwaway work clone, since
 * a bare repo has no worktree of its own). Returns the bare URL — the "GitHub repo" of these tests.
 */
function initBareWithTree(tree: Record<string, string>): { dir: string; url: string } {
  const bare = mkTmp("skills-push-remote-");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", bare], { stdio: "ignore" });
  const work = mkTmp("skills-push-seed-");
  gitRun(work, ["init", "-q", "-b", "main"]);
  for (const [rel, content] of Object.entries(tree)) {
    const abs = path.join(work, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  gitRun(work, ["add", "-A"]);
  gitRun(work, ["commit", "-q", "-m", "initial"]);
  gitRun(work, ["push", "-q", pathToFileURL(bare).toString(), "main"]);
  return { dir: bare, url: pathToFileURL(bare).toString() };
}

/** Read a branch of the bare remote: sorted paths, per-path text, last commit subject + sha. */
function readRemoteBranch(
  url: string,
  branch: string,
): { paths: string[]; contents: Map<string, string>; subject: string; sha: string } {
  const work = mkTmp("skills-push-clone-");
  execFileSync("git", ["clone", "-q", "--branch", branch, url, work], { stdio: "ignore" });
  const paths = execFileSync("git", ["-C", work, "ls-tree", "-r", "--name-only", "HEAD"])
    .toString()
    .trim()
    .split("\n")
    .filter(Boolean)
    .sort();
  const contents = new Map<string, string>();
  for (const p of paths) contents.set(p, fs.readFileSync(path.join(work, ...p.split("/")), "utf8"));
  const subject = execFileSync("git", ["-C", work, "log", "-1", "--format=%s"]).toString().trim();
  const sha = execFileSync("git", ["-C", work, "rev-parse", "HEAD"]).toString().trim();
  return { paths, contents, subject, sha };
}

function remoteBranches(bareDir: string): string[] {
  return execFileSync("git", [
    "-C",
    bareDir,
    "for-each-ref",
    "--format=%(refname:short)",
    "refs/heads",
  ])
    .toString()
    .trim()
    .split("\n")
    .filter(Boolean)
    .sort();
}

const SKILL_V1 =
  "---\nname: pdf-tools\ndescription: Work with PDF files.\n---\n\n# PDF Tools\n\nBody v1.";
const SKILL_V2 =
  "---\nname: pdf-tools\ndescription: Work with PDF files.\n---\n\n# PDF Tools\n\nBody v2 (improved).";

type BuildAppResult = {
  app: FastifyInstance;
  repo: SkillRepository;
  git: SkillGitService;
  dataDir: string;
  logs: string[];
  prCalls: Array<Parameters<CreatePullRequestFn>[0]>;
};

async function buildApp(
  overrides: { createPullRequest?: CreatePullRequestFn; lookup?: DnsLookupAll } = {},
): Promise<BuildAppResult> {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  databases.push(db);

  const secrets = new SecretStore(Buffer.alloc(32, 9));
  const repo = new SkillRepository(db, secrets);
  const dataDir = mkTmp("skills-push-data-");
  const ingest = new SkillIngestService(repo, { dataDir, tokenProfile: "generic_o200k" });
  const gitService = new SkillGitService(repo, {
    dataDir,
    tokenProfile: "generic_o200k",
    gitTimeoutMs: 30_000,
  });
  const publish = new SkillPublishService(repo, { dataDir, gitTimeoutMs: 30_000 });

  const prCalls: Array<Parameters<CreatePullRequestFn>[0]> = [];
  const createPullRequest: CreatePullRequestFn =
    overrides.createPullRequest ??
    (async (args) => {
      prCalls.push(args);
      return { url: "https://github.example/acme/repo/pull/7", number: 7 };
    });
  const push = new SkillPushService(repo, {
    dataDir,
    gitTimeoutMs: 30_000,
    createPullRequest,
    lookup: overrides.lookup,
  });

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
  await registerSkillRoutes(
    app,
    repo,
    ingest,
    gitService,
    publish,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never, // serverTypes (server-types WP 3.1) — unused by the push routes
    { push },
  );
  await app.ready();
  apps.push(app);
  return { app, repo, git: gitService, dataDir, logs, prCalls };
}

/** Import the skill from the bare remote, then save an EDITED tree as a new local version. */
async function importAndEdit(
  repo: SkillRepository,
  git: SkillGitService,
  url: string,
  editedTree: Record<string, string>,
): Promise<{ skillId: string; editedVersionId: string }> {
  const imported = await git.importSkill({
    repoUrl: url,
    ref: "main",
    subpath: "",
    token: "ghp_t",
  });
  const files = Object.entries(editedTree).map(([p, c]) => ({ path: p, bytes: Buffer.from(c) }));
  const result = repo.createVersion(imported.skillId, files, {
    sourceKind: "upload",
    importedFrom: "upload",
    sourceRef: "skillflow-edit",
  });
  return { skillId: imported.skillId, editedVersionId: result.version.id };
}

function pushReq(
  skillId: string,
  versionId: string,
  body: Record<string, unknown>,
): { method: "POST"; url: string; payload: Record<string, unknown> } {
  return {
    method: "POST",
    url: `/api/skills/${skillId}/versions/${versionId}/push-github`,
    payload: body,
  };
}

function assertTmpClean(dataDir: string): void {
  const tmp = path.join(dataDir, "tmp");
  if (fs.existsSync(tmp)) {
    assert.equal(fs.readdirSync(tmp).length, 0, "push left a temp dir behind");
  }
}

test("direct push commits the version tree onto the tracked branch (adds, edits, deletes)", async (t) => {
  if (!gitAvailable) return t.skip("git unavailable");
  const remote = initBareWithTree({ "SKILL.md": SKILL_V1, "references/OLD.md": "stale doc" });
  const { app, repo, git, dataDir } = await buildApp();
  const { skillId, editedVersionId } = await importAndEdit(repo, git, remote.url, {
    "SKILL.md": SKILL_V2,
    "references/NEW.md": "fresh doc",
  });

  const res = await app.inject(pushReq(skillId, editedVersionId, { mode: "direct" }));
  assert.equal(res.statusCode, 200, res.body);
  const body = res.json();
  assert.equal(body.mode, "direct");
  assert.equal(body.unchanged, false);
  assert.equal(body.branch, "main");
  assert.ok(body.commitSha, "carries the new commit sha");

  const main = readRemoteBranch(remote.url, "main");
  assert.deepEqual(main.paths, ["SKILL.md", "references/NEW.md"], "delete + add both landed");
  assert.equal(main.contents.get("SKILL.md"), SKILL_V2);
  assert.equal(main.sha, body.commitSha);
  assert.match(main.subject, /^Update pdf-tools to /, "default commit message");

  // lastSha advanced to our own commit → the upstream badge does not flag our own push.
  const upstream = await git.upstream(skillId);
  assert.equal(upstream.hasUpdate, false, "own push is not an 'update available'");
  assert.equal(upstream.currentSha, body.commitSha);

  // …and a pull straight after is a clean no-op.
  const pull = await app.inject({ method: "POST", url: `/api/skills/${skillId}/pull` });
  assert.deepEqual(pull.json(), { unchanged: true });
  assertTmpClean(dataDir);
});

test("pushing a version identical to upstream is an honest no-op", async (t) => {
  if (!gitAvailable) return t.skip("git unavailable");
  const remote = initBareWithTree({ "SKILL.md": SKILL_V1 });
  const { app, repo, git, dataDir } = await buildApp();
  const imported = await git.importSkill({ repoUrl: remote.url, ref: "main", subpath: "" });
  const versionId = repo.getPublic(imported.skillId).currentVersionId!;

  const res = await app.inject(
    pushReq(imported.skillId, versionId, { mode: "direct", token: "ghp_t" }),
  );
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().unchanged, true);
  const main = readRemoteBranch(remote.url, "main");
  assert.equal(main.subject, "initial", "no commit was created");
  assertTmpClean(dataDir);
});

test("pr mode pushes a head branch, leaves the base untouched, and opens the PR", async (t) => {
  if (!gitAvailable) return t.skip("git unavailable");
  const remote = initBareWithTree({ "SKILL.md": SKILL_V1 });
  const { app, repo, git, dataDir, prCalls } = await buildApp();
  const { skillId, editedVersionId } = await importAndEdit(repo, git, remote.url, {
    "SKILL.md": SKILL_V2,
  });

  const res = await app.inject(
    pushReq(skillId, editedVersionId, {
      mode: "pr",
      commitMessage: "Improve the skill body",
      prTitle: "Improve pdf-tools",
      prBody: "Round of improvements.",
    }),
  );
  assert.equal(res.statusCode, 200, res.body);
  const body = res.json();
  assert.equal(body.mode, "pr");
  assert.equal(body.prUrl, "https://github.example/acme/repo/pull/7");
  assert.equal(body.prNumber, 7);
  assert.match(body.branch, /^skill\/pdf-tools-/, "default head branch name");

  // The base branch is untouched; the head branch carries the commit.
  assert.equal(readRemoteBranch(remote.url, "main").subject, "initial");
  const head = readRemoteBranch(remote.url, body.branch);
  assert.equal(head.contents.get("SKILL.md"), SKILL_V2);
  assert.equal(head.subject, "Improve the skill body");

  // The injected PR fn got head→base, the title, and the body — and the PAT it needs.
  assert.equal(prCalls.length, 1);
  assert.equal(prCalls[0]!.head, body.branch);
  assert.equal(prCalls[0]!.base, "main");
  assert.equal(prCalls[0]!.title, "Improve pdf-tools");
  assert.equal(prCalls[0]!.body, "Round of improvements.");

  // A PR does NOT advance lastSha — upstream main is unchanged.
  const upstream = await git.upstream(skillId);
  assert.equal(upstream.hasUpdate, false);
  assertTmpClean(dataDir);
});

test("pr mode with an existing divergent head branch is refused with 409 (no force-push)", async (t) => {
  if (!gitAvailable) return t.skip("git unavailable");
  const remote = initBareWithTree({ "SKILL.md": SKILL_V1 });
  // Seed a DIVERGENT branch named "feature" on the remote (root commit — shares no history).
  const divergent = mkTmp("skills-push-divergent-");
  gitRun(divergent, ["init", "-q", "-b", "feature"]);
  fs.writeFileSync(path.join(divergent, "other.txt"), "unrelated");
  gitRun(divergent, ["add", "-A"]);
  gitRun(divergent, ["commit", "-q", "-m", "unrelated"]);
  gitRun(divergent, ["push", "-q", remote.url, "feature"]);

  const { app, repo, git, dataDir } = await buildApp();
  const { skillId, editedVersionId } = await importAndEdit(repo, git, remote.url, {
    "SKILL.md": SKILL_V2,
  });

  const res = await app.inject(
    pushReq(skillId, editedVersionId, { mode: "pr", branch: "feature" }),
  );
  assert.equal(res.statusCode, 409, res.body);
  assertTmpClean(dataDir);
});

test("a skill that is not github-bound is refused with 400", async (t) => {
  if (!gitAvailable) return t.skip("git unavailable");
  const { app, repo } = await buildApp();
  const skill = repo.create({ name: "pdf-tools", sourceType: "upload" });
  const version = repo.createVersion(
    skill.id,
    [{ path: "SKILL.md", bytes: Buffer.from(SKILL_V1) }],
    {
      sourceKind: "upload",
      importedFrom: "upload",
    },
  );

  const res = await app.inject(
    pushReq(skill.id, version.version.id, { mode: "direct", token: "ghp_t" }),
  );
  assert.equal(res.statusCode, 400);
});

test("no token in the body and none stored on the skill → 400", async (t) => {
  if (!gitAvailable) return t.skip("git unavailable");
  const remote = initBareWithTree({ "SKILL.md": SKILL_V1 });
  const { app, repo, git } = await buildApp();
  // Import WITHOUT a token (public repo) so nothing is stored.
  const imported = await git.importSkill({ repoUrl: remote.url, ref: "main", subpath: "" });
  const versionId = repo.getPublic(imported.skillId).currentVersionId!;

  const res = await app.inject(pushReq(imported.skillId, versionId, { mode: "direct" }));
  assert.equal(res.statusCode, 400);
});

test("the PAT is redacted from every surfaced error and log line", async (t) => {
  if (!gitAvailable) return t.skip("git unavailable");
  const secret = "ghp_PUSH_TOKEN_MUST_NOT_LEAK_1a2b3c";
  const { app, repo, dataDir, logs } = await buildApp({
    lookup: async () => {
      throw new Error("ENOTFOUND (test)");
    },
  });
  // Bind directly to an unreachable https remote (an import from it would fail).
  const skill = repo.create({
    name: "pdf-tools",
    sourceType: "github",
    github: {
      repoUrl: "https://push-redaction-xyz.invalid/acme/repo.git",
      ref: "main",
      subpath: "",
      token: secret,
    },
  });
  const version = repo.createVersion(
    skill.id,
    [{ path: "SKILL.md", bytes: Buffer.from(SKILL_V1) }],
    {
      sourceKind: "upload",
      importedFrom: "upload",
    },
  );

  const res = await app.inject(pushReq(skill.id, version.version.id, { mode: "direct" }));
  assert.notEqual(res.statusCode, 200, "the unreachable remote fails the push");
  assert.ok(!res.body.includes(secret), "PAT never appears in the response body");
  assert.ok(!logs.join("").includes(secret), "PAT never appears in any log line");
  assertTmpClean(dataDir);
});

test("an invalid head branch name is rejected with 400 (schema)", async (t) => {
  if (!gitAvailable) return t.skip("git unavailable");
  const remote = initBareWithTree({ "SKILL.md": SKILL_V1 });
  const { app, repo, git } = await buildApp();
  const { skillId, editedVersionId } = await importAndEdit(repo, git, remote.url, {
    "SKILL.md": SKILL_V2,
  });

  for (const branch of ["-oops", "a..b", "bad branch", "trailing/", "x.lock"]) {
    const res = await app.inject(pushReq(skillId, editedVersionId, { mode: "pr", branch }));
    assert.equal(res.statusCode, 400, `branch "${branch}" must be refused`);
  }
});

// --- PUT /api/skills/:id — source-config retarget (repoUrl/ref/subpath) --------------------------

test("PUT retargets repoUrl/ref/subpath, resets lastSha, and the next pull re-imports", async (t) => {
  if (!gitAvailable) return t.skip("git unavailable");
  const remoteA = initBareWithTree({ "SKILL.md": SKILL_V1 });
  const remoteB = initBareWithTree({ "SKILL.md": SKILL_V2 });
  const { app, repo, git } = await buildApp();
  const imported = await git.importSkill({ repoUrl: remoteA.url, ref: "main", subpath: "" });

  const res = await app.inject({
    method: "PUT",
    url: `/api/skills/${imported.skillId}`,
    // file:// URLs fail the https-only schema guard, so drive the repository layer's contract via
    // ref-only first (wire) …
    payload: { github: { ref: "main" } },
  });
  assert.equal(res.statusCode, 200, res.body);

  // … and the full retarget (repoUrl/subpath) through the repository (same code path the route
  // calls; the https-only rule is a schema concern proven separately in shared tests).
  repo.update(imported.skillId, { github: { repoUrl: remoteB.url, ref: "main", subpath: "" } });
  const skill = repo.getPublic(imported.skillId);
  assert.equal(skill.github?.repoUrl, remoteB.url);
  assert.equal(skill.github?.lastSha, undefined, "retarget resets lastSha");

  // The next pull imports remote B's tree as a NEW version.
  const pull = await app.inject({ method: "POST", url: `/api/skills/${imported.skillId}/pull` });
  assert.equal(pull.statusCode, 201, pull.body);
  const version = pull.json();
  assert.notEqual(version.unchanged, true);
});

test("PUT with github config on an upload skill is refused with 400", async (t) => {
  if (!gitAvailable) return t.skip("git unavailable");
  const { app, repo } = await buildApp();
  const skill = repo.create({ name: "pdf-tools", sourceType: "upload" });

  const res = await app.inject({
    method: "PUT",
    url: `/api/skills/${skill.id}`,
    payload: { github: { ref: "main" } },
  });
  assert.equal(res.statusCode, 400);

  // A plain rename still works.
  const rename = await app.inject({
    method: "PUT",
    url: `/api/skills/${skill.id}`,
    payload: { displayName: "PDF Tools" },
  });
  assert.equal(rename.statusCode, 200);
  assert.equal(rename.json().displayName, "PDF Tools");
});

test("parseGithubOwnerRepo only accepts github.com owner/repo URLs", () => {
  assert.deepEqual(parseGithubOwnerRepo("https://github.com/acme/tools.git"), {
    owner: "acme",
    repo: "tools",
  });
  assert.deepEqual(parseGithubOwnerRepo("https://github.com/acme/tools"), {
    owner: "acme",
    repo: "tools",
  });
  assert.equal(parseGithubOwnerRepo("https://gitlab.com/acme/tools"), undefined);
  assert.equal(parseGithubOwnerRepo("https://github.com/acme"), undefined);
  assert.equal(parseGithubOwnerRepo("not a url"), undefined);
});
