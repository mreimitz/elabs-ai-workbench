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
import { SecretStore } from "../src/secrets/secret-store.js";
import { SkillGitService } from "../src/skills/git-service.js";
import { SkillPublishService } from "../src/skills/publish-service.js";
import { SkillIngestService } from "../src/skills/ingest-service.js";
import { SkillRepository } from "../src/skills/repository.js";
import { registerSkillRoutes } from "../src/skills/routes.js";
import { toErrorMessage } from "../src/utils/errors.js";

// Offline, keyless GitHub tests: every "remote" is a local git repo exposed as a `file://` URL, so
// nothing hits the network. `git` (v2.43 here) is required; if it is entirely unavailable we skip.

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
  // Best-effort cleanup of ephemeral /tmp dirs. `git commit` can spawn a detached `git gc --auto`
  // that keeps writing into `.git` after the awaited git call returns, so under CI load the rmdir
  // races it (ENOTEMPTY) even with retries. A leaked temp dir does not affect correctness, so we
  // retry generously and then swallow — never let teardown fail the suite.
  for (const dir of tmpRoots.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch {
      // ignore — ephemeral temp dir, discarded by the OS/runner regardless
    }
  }
});

function mkTmp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpRoots.push(dir);
  return dir;
}

function git(cwd: string, args: string[]): void {
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

/** Init a git repo (default branch `main`), write `tree`, commit, return { dir, url, sha }. */
function initRepo(tree: Record<string, string>): { dir: string; url: string; sha: string } {
  const dir = mkTmp("skills-github-remote-");
  git(dir, ["init", "-q", "-b", "main"]);
  writeTree(dir, tree);
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "initial"]);
  return { dir, url: pathToFileURL(dir).toString(), sha: headSha(dir) };
}

function writeTree(dir: string, tree: Record<string, string>): void {
  for (const [rel, content] of Object.entries(tree)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
}

function commit(dir: string, tree: Record<string, string>, message: string): string {
  writeTree(dir, tree);
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", message]);
  return headSha(dir);
}

function headSha(dir: string): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir }).toString().trim();
}

type BuildAppOptions = {
  caps?: { maxFiles: number; maxFileBytes: number; maxTotalBytes: number };
};

async function buildApp(options: BuildAppOptions = {}): Promise<{
  app: FastifyInstance;
  repo: SkillRepository;
  secrets: SecretStore;
  git: SkillGitService;
}> {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  databases.push(db);

  const secrets = new SecretStore(Buffer.alloc(32, 9));
  const repo = new SkillRepository(db, secrets);
  const dataDir = mkTmp("skills-github-data-");
  const ingest = new SkillIngestService(repo, {
    dataDir,
    tokenProfile: "generic_o200k",
    caps: options.caps,
  });
  const gitService = new SkillGitService(repo, {
    dataDir,
    tokenProfile: "generic_o200k",
    gitTimeoutMs: 30_000,
    caps: options.caps,
  });
  const publish = new SkillPublishService(repo, { dataDir, gitTimeoutMs: 30_000 });

  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: "Validation failed" });
    const typed = error as Error & { statusCode?: number };
    return reply.code(typed.statusCode ?? 500).send({ error: toErrorMessage(error) });
  });
  await registerSkillRoutes(app, repo, ingest, gitService, publish);
  await app.ready();
  apps.push(app);
  return { app, repo, secrets, git: gitService };
}

// NOTE: the SSRF guard (schemas.ts `safeRepoUrlSchema`) blocks `file://` at the ROUTE boundary
// (POST /api/skills/probe, POST /api/skills). These offline tests use `file://` local repos to
// exercise the git INGESTION mechanics, so they drive the git service directly for the probe /
// import / cap flows (the URL guard itself is covered at the schema level in skills-security.test.ts).
// Routes that don't re-validate the repo URL (pull / upstream / version GETs) are still exercised
// over HTTP.

const SKILL_A =
  "---\nname: pdf-tools\ndescription: Work with PDF files.\n---\n\n# PDF Tools\n\nBody text.";
const SKILL_B =
  "---\nname: web-fetch\ndescription: Fetch and parse web pages.\n---\n\n# Web Fetch\n\nBody.";

test("probe returns all SKILL.md candidates + commit sha (monorepo aware)", async (t) => {
  if (!gitAvailable) return t.skip("git unavailable");
  const { git } = await buildApp();
  const remote = initRepo({
    "skills/pdf-tools/SKILL.md": SKILL_A,
    "skills/pdf-tools/references/API.md": "ref",
    "skills/web-fetch/SKILL.md": SKILL_B,
    "README.md": "top-level",
  });

  const probe = await git.probe(remote.url, "main");
  assert.equal(probe.ok, true);
  assert.equal(probe.requiresAuth, false);
  assert.equal(probe.commitSha, remote.sha);

  const bySubpath = new Map(probe.candidates.map((c: { subpath: string }) => [c.subpath, c]));
  assert.deepEqual([...bySubpath.keys()].sort(), ["skills/pdf-tools", "skills/web-fetch"]);
  assert.equal((bySubpath.get("skills/pdf-tools") as { name: string }).name, "pdf-tools");
  assert.equal(
    (bySubpath.get("skills/web-fetch") as { description: string }).description,
    "Fetch and parse web pages.",
  );
});

test("probe on a nonexistent repo reports a failure (not a crash)", async (t) => {
  if (!gitAvailable) return t.skip("git unavailable");
  const { git } = await buildApp();
  const missing = pathToFileURL(path.join(os.tmpdir(), "does-not-exist-abc123")).toString();
  const probe = await git.probe(missing, "main");
  assert.equal(probe.ok, false);
  assert.equal(probe.candidates.length, 0);
  assert.ok(typeof probe.errorMessage === "string" && probe.errorMessage.length > 0);
});

test("import binds a skill to (repo, ref, subpath) with v1; PAT stored encrypted, never returned", async (t) => {
  if (!gitAvailable) return t.skip("git unavailable");
  const { app, secrets, git, repo } = await buildApp();
  const remote = initRepo({
    "skills/pdf-tools/SKILL.md": SKILL_A,
    "skills/pdf-tools/references/API.md": "reference doc",
  });

  const imported = await git.importSkill({
    repoUrl: remote.url,
    ref: "main",
    subpath: "skills/pdf-tools",
    token: "ghp_secretpat",
  });
  const skill = repo.getPublic(imported.skillId);
  assert.equal(skill.sourceType, "github");
  assert.equal(skill.versionCount, 1);
  assert.ok(skill.currentVersionId);
  assert.equal(skill.description, "Work with PDF files.");

  // Binding is exposed via the redacted github view; the PAT is NOT — only `hasAuth`.
  assert.equal(skill.github!.repoUrl, remote.url);
  assert.equal(skill.github!.ref, "main");
  assert.equal(skill.github!.subpath, "skills/pdf-tools");
  assert.equal(skill.github!.lastSha, remote.sha);
  assert.equal(skill.github!.hasAuth, true);
  assert.equal("token" in skill.github!, false);
  assert.ok(!JSON.stringify(skill).includes("ghp_secretpat"), "PAT never appears in the wire body");

  // v1 has the subpath's files rebased to the skill root, with token levels populated.
  const version = (
    await app.inject({ url: `/api/skills/${skill.id}/versions/${skill.currentVersionId}` })
  ).json();
  assert.equal(version.sourceKind, "github");
  assert.equal(version.importedFrom, "github-pull");
  assert.equal(version.sourceRef, remote.sha);
  assert.ok(version.l1MetadataTokens > 0);
  assert.ok(version.l2BodyTokens > 0);
  assert.ok(version.l3ResourceTokens > 0);

  const files = (
    await app.inject({ url: `/api/skills/${skill.id}/versions/${skill.currentVersionId}/files` })
  ).json();
  assert.deepEqual(files.map((f: { path: string }) => f.path).sort(), [
    "SKILL.md",
    "references/API.md",
  ]);

  // The stored PAT is encrypted at rest and round-trips through SecretStore.
  const row = databases[databases.length - 1]!.prepare(
    "SELECT github_auth_ref FROM skills WHERE id = ?",
  ).get(skill.id) as { github_auth_ref: string | null };
  assert.ok(row.github_auth_ref, "PAT ref persisted");
  assert.ok(secrets.isEncrypted(row.github_auth_ref), "PAT stored encrypted");
  assert.notEqual(row.github_auth_ref, "ghp_secretpat");
  assert.equal(secrets.decryptText(row.github_auth_ref!), "ghp_secretpat");
});

test("pull is a no-op on an unchanged repo, then a new version after a subpath commit", async (t) => {
  if (!gitAvailable) return t.skip("git unavailable");
  const { app, git } = await buildApp();
  const remote = initRepo({ "skills/pdf-tools/SKILL.md": SKILL_A });

  const skill = await git.importSkill({
    repoUrl: remote.url,
    ref: "main",
    subpath: "skills/pdf-tools",
  });

  // No upstream change → { unchanged: true }.
  const noop = await app.inject({ method: "POST", url: `/api/skills/${skill.skillId}/pull` });
  assert.equal(noop.statusCode, 200);
  assert.deepEqual(noop.json(), { unchanged: true });

  // A commit that touches the subpath → a new version at the new sha.
  const newSha = commit(
    remote.dir,
    { "skills/pdf-tools/references/API.md": "new reference content" },
    "add reference",
  );
  const changed = await app.inject({ method: "POST", url: `/api/skills/${skill.skillId}/pull` });
  assert.equal(changed.statusCode, 201);
  const v2 = changed.json();
  assert.equal(v2.seq, 2);
  assert.equal(v2.sourceRef, newSha);

  const versions = (await app.inject({ url: `/api/skills/${skill.skillId}/versions` })).json();
  assert.equal(versions.length, 2);

  // The tracked sha advanced, so a follow-up pull is a no-op again.
  const again = await app.inject({ method: "POST", url: `/api/skills/${skill.skillId}/pull` });
  assert.deepEqual(again.json(), { unchanged: true });
});

test("upstream reports hasUpdate false→true using ls-remote (no clone)", async (t) => {
  if (!gitAvailable) return t.skip("git unavailable");
  const { app, git } = await buildApp();
  const remote = initRepo({ "skills/pdf-tools/SKILL.md": SKILL_A });

  const skill = await git.importSkill({
    repoUrl: remote.url,
    ref: "main",
    subpath: "skills/pdf-tools",
  });

  const before = (await app.inject({ url: `/api/skills/${skill.skillId}/upstream` })).json();
  assert.equal(before.hasUpdate, false);
  assert.equal(before.currentSha, remote.sha);
  assert.equal(before.upstreamSha, remote.sha);

  const newSha = commit(remote.dir, { "skills/pdf-tools/notes.md": "notes" }, "add notes");
  const after = (await app.inject({ url: `/api/skills/${skill.skillId}/upstream` })).json();
  assert.equal(after.hasUpdate, true);
  assert.equal(after.upstreamSha, newSha);
  assert.notEqual(after.upstreamSha, before.upstreamSha);
});

test("import over the file-count cap → 400, no partial rows (git path caps enforced)", async (t) => {
  if (!gitAvailable) return t.skip("git unavailable");
  // Same guard as the upload path: a huge repo tree can't slip in through the GitHub route.
  const { app, git } = await buildApp({
    caps: { maxFiles: 3, maxFileBytes: 1024, maxTotalBytes: 65536 },
  });
  const tree: Record<string, string> = { "SKILL.md": SKILL_A };
  for (let i = 0; i < 10; i += 1) tree[`references/f${i}.md`] = "x";
  const remote = initRepo(tree);

  await assert.rejects(
    git.importSkill({ repoUrl: remote.url, ref: "main", subpath: "" }),
    (err: Error & { statusCode?: number }) => {
      assert.equal(err.statusCode, 400);
      assert.match(err.message, /files/);
      return true;
    },
  );

  // No partial rows: the just-created skill shell was rolled back on the failed first version.
  const list = (await app.inject({ url: "/api/skills" })).json();
  assert.equal(list.length, 0);
});

test("import over the per-file byte cap → 400 (git path caps enforced)", async (t) => {
  if (!gitAvailable) return t.skip("git unavailable");
  const { app, git } = await buildApp({
    caps: { maxFiles: 100, maxFileBytes: 1024, maxTotalBytes: 1048576 },
  });
  const remote = initRepo({ "SKILL.md": SKILL_A, "big.txt": "z".repeat(2048) });

  await assert.rejects(
    git.importSkill({ repoUrl: remote.url, ref: "main", subpath: "" }),
    (err: Error & { statusCode?: number }) => {
      assert.equal(err.statusCode, 400);
      assert.match(err.message, /per-file limit/);
      return true;
    },
  );

  const list = (await app.inject({ url: "/api/skills" })).json();
  assert.equal(list.length, 0);
});

// M2 — path traversal via `subpath`: the schema (`safeSubpathSchema`, see skills-security.test.ts)
// already rejects a `..`/absolute subpath before a request ever reaches `SkillGitService`. This test
// drives the service DIRECTLY (bypassing the schema entirely) to prove the SECOND, independent layer
// inside `checkout()` (`assertWithinRoot`) also refuses a subpath that would otherwise resolve OUTSIDE
// the ephemeral clone dir — `git sparse-checkout set --no-cone` accepts an arbitrary pattern string
// with no error, so without this assertion `path.join(tmpDir, ...subpath.split("/"))` would happily
// walk out of `tmpDir` and `readTreeFiles` would read real host files into the stored skill.
test("M2: a subpath engineered to escape the checkout dir is rejected even when the schema is bypassed", async (t) => {
  if (!gitAvailable) return t.skip("git unavailable");
  const { app, git } = await buildApp();
  const remote = initRepo({ "SKILL.md": SKILL_A });

  // Enough "../" segments to escape ANY plausible tmpDir depth (os.tmpdir()/<prefix>/tmp/<nanoid>),
  // landing on a real, existing, readable host directory ("/tmp" is universally present).
  const escaping = `${"../".repeat(12)}tmp`;

  await assert.rejects(
    git.importSkill({ repoUrl: remote.url, ref: "main", subpath: escaping }),
    (err: Error & { statusCode?: number }) => {
      assert.equal(err.statusCode, 400);
      assert.match(err.message, /escapes the repository checkout/i);
      return true;
    },
  );

  // No partial rows: the just-created skill shell was rolled back.
  const list = (await app.inject({ url: "/api/skills" })).json();
  assert.equal(list.length, 0);
});

// Regression: a normal, safe, nested subpath still checks out correctly under the SAME containment
// assertion (it must accept every path it used to accept, not just reject the unsafe ones).
test("M2 regression: a normal in-tree subpath still imports successfully", async (t) => {
  if (!gitAvailable) return t.skip("git unavailable");
  const { git, repo } = await buildApp();
  const remote = initRepo({
    "skills/pdf-tools/SKILL.md": SKILL_A,
    "skills/pdf-tools/references/API.md": "reference doc",
  });

  const imported = await git.importSkill({
    repoUrl: remote.url,
    ref: "main",
    subpath: "skills/pdf-tools",
  });
  const skill = repo.getPublic(imported.skillId);
  assert.equal(skill.description, "Work with PDF files.");
});
