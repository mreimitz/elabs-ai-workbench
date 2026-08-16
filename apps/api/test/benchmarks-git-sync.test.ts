import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, before, test } from "node:test";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { ZodError } from "zod";
import {
  COLLECTION_FILE_FORMAT_VERSION,
  type CollectionSyncResult,
} from "@mcp-token-footprint/shared";
import { CollectionGitSyncService } from "../src/collections/git-sync.js";
import {
  assertSafeRelativePath,
  assertWithinBase,
  isSafeRelativePath,
} from "../src/collections/path-safety.js";
import { CollectionRepository } from "../src/collections/repository.js";
import { registerCollectionRoutes } from "../src/collections/routes.js";
import { serializeFile } from "../src/collections/serializer.js";
import { CollectionService } from "../src/collections/service.js";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { redactUrl } from "../src/git/git-credential.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { SuiteRepository } from "../src/suites/repository.js";
import { TestRepository } from "../src/testing/test-repository.js";
import { toErrorMessage } from "../src/utils/errors.js";

// WP 4.2 (Benchmarks, B11) — collection two-way git sync, fully OFFLINE. Every "remote" is a local
// `git init --bare` repo exposed as a `file://` URL (the skill-ide WP 7.1 pattern); nothing hits the
// network. `git` is required; if absent we skip.

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
      // ignore — ephemeral temp dir
    }
  }
});

function mkTmp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpRoots.push(dir);
  return dir;
}

/** Run git with a fixed neutral identity (for test-side remote setup only). */
function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Seed",
      GIT_AUTHOR_EMAIL: "seed@example.com",
      GIT_COMMITTER_NAME: "Seed",
      GIT_COMMITTER_EMAIL: "seed@example.com",
      GIT_TERMINAL_PROMPT: "0",
    },
  });
}

/** A fresh bare repo (default branch `main`), returned as a `file://` URL. */
function initBareRemote(): string {
  const dir = mkTmp("git-sync-remote-");
  git(dir, ["init", "--bare", "-b", "main"]);
  return pathToFileURL(dir).toString();
}

/** Clone the bare remote, apply `mutate` (write/delete files), commit, push `main` — a "someone else" change. */
function mutateRemote(
  remoteUrl: string,
  message: string,
  mutate: (worktree: string) => void,
): void {
  const wt = mkTmp("git-sync-seed-");
  git(path.dirname(wt), ["clone", remoteUrl, wt]);
  // Ensure we're on main (empty clones start on an unborn branch).
  try {
    git(wt, ["checkout", "-B", "main"]);
  } catch {
    git(wt, ["symbolic-ref", "HEAD", "refs/heads/main"]);
  }
  mutate(wt);
  git(wt, ["add", "-A"]);
  git(wt, ["commit", "-q", "-m", message]);
  git(wt, ["push", "-q", "origin", "HEAD:main"]);
}

/** Clone the bare remote read-only and return the file at `relPath` (or undefined if absent). */
function readRemoteFile(remoteUrl: string, relPath: string): string | undefined {
  const wt = mkTmp("git-sync-read-");
  git(path.dirname(wt), ["clone", "-q", remoteUrl, wt]);
  const abs = path.join(wt, ...relPath.split("/"));
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : undefined;
}

/** List the files under `tests/` in the remote (posix names). */
function listRemoteTests(remoteUrl: string): string[] {
  const wt = mkTmp("git-sync-list-");
  git(path.dirname(wt), ["clone", "-q", remoteUrl, wt]);
  const dir = path.join(wt, "tests");
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
}

/** A minimal on-disk TestFile JSON, byte-identical to what the engine's exporter emits for a plain test. */
function testFileJson(externalKey: string, name: string, userPrompt: string): string {
  return serializeFile({
    formatVersion: COLLECTION_FILE_FORMAT_VERSION,
    externalKey,
    name,
    userPrompt,
    tags: [],
    addedProfiles: [],
  });
}

type Env = {
  db: AppDatabase;
  collections: CollectionRepository;
  tests: TestRepository;
  suites: SuiteRepository;
  sync: CollectionGitSyncService;
  secrets: SecretStore;
  baseDir: string;
  app: FastifyInstance;
  logs: string[];
};

/**
 * Seed a git-bound collection whose "remote" is a local `file://` URL, BYPASSING the https-only
 * `collectionInputSchema` guard (H-1). `file://` is a test stand-in for a remote and is now rejected by
 * the route / service / repository validation on purpose; this raw INSERT mirrors
 * `CollectionRepository.create`'s own INSERT so the git engine sees an identical row. Returns the id.
 */
function seedBoundCollection(
  db: AppDatabase,
  opts: {
    name: string;
    repoUrl: string;
    repoPath: string;
    branch: string;
    patEncrypted?: string | null;
  },
): { id: string } {
  const id = nanoid();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO collections (
       id, name, repo_url, repo_path, branch, pat_encrypted, last_synced_sha, created_at, updated_at
     ) VALUES (@id, @name, @repoUrl, @repoPath, @branch, @patEncrypted, NULL, @now, @now)`,
  ).run({
    id,
    name: opts.name,
    repoUrl: opts.repoUrl,
    repoPath: opts.repoPath,
    branch: opts.branch,
    patEncrypted: opts.patEncrypted ?? null,
    now,
  });
  return { id };
}

/** In-memory DB at the latest schema + the full service stack + a Fastify app with a capturing logger. */
async function setup(): Promise<Env> {
  const db = new Database(":memory:") as unknown as AppDatabase;
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  databases.push(db);

  const secrets = new SecretStore(crypto.randomBytes(32));
  const collections = new CollectionRepository(db, secrets);
  const tests = new TestRepository(db);
  const suites = new SuiteRepository(db);
  const baseDir = mkTmp("git-sync-clones-");
  const sync = new CollectionGitSyncService(db, collections, tests, suites, {
    baseDir,
    gitTimeoutMs: 30_000,
  });

  const logs: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb): void {
      logs.push(chunk.toString());
      cb();
    },
  });
  const app = Fastify({ logger: { level: "info", stream } });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: "Validation failed" });
    const typed = error as Error & { statusCode?: number };
    request.log.error(error); // exercise the log path so redaction is proven end-to-end
    return reply.code(typed.statusCode ?? 500).send({ error: toErrorMessage(error) });
  });
  await registerCollectionRoutes(app, new CollectionService(collections), sync);
  await app.ready();
  apps.push(app);
  return { db, collections, tests, suites, sync, secrets, baseDir, app, logs };
}

function externalKeyOf(db: AppDatabase, testId: string): string {
  const row = db.prepare("SELECT external_key FROM tests WHERE id = ?").get(testId) as {
    external_key: string | null;
  };
  return row.external_key ?? "";
}

function localTestByKey(
  db: AppDatabase,
  collectionId: string,
  externalKey: string,
): { id: string; name: string; user_prompt: string } | undefined {
  return db
    .prepare("SELECT id, name, user_prompt FROM tests WHERE collection_id = ? AND external_key = ?")
    .get(collectionId, externalKey) as
    | { id: string; name: string; user_prompt: string }
    | undefined;
}

// --- 1. Clean push -------------------------------------------------------------------------------

test(
  "1 · clean push: a local member is committed + pushed to the remote",
  { skip: !gitAvailable },
  async () => {
    const remoteUrl = initBareRemote();
    const { db, collections, tests, sync } = await setup();
    const col = seedBoundCollection(db, {
      name: "C1",
      repoUrl: remoteUrl,
      repoPath: "",
      branch: "main",
    });
    const t = tests.create({ name: "Alpha Test", userPrompt: "do the thing" });
    collections.assignTest(col.id, t.id);

    const result = await sync.sync(col.id);
    assert.equal(result.status, "pushed");
    assert.equal(result.state.conflicts.length, 0);

    const key = externalKeyOf(db, t.id);
    const onRemote = readRemoteFile(remoteUrl, "tests/alpha-test.json");
    assert.ok(onRemote, "the exported file is on the remote");
    assert.equal(onRemote, testFileJson(key, "Alpha Test", "do the thing"));
    // last_synced_sha advanced.
    assert.ok(collections.get(col.id).lastSyncedSha, "last_synced_sha recorded after push");
  },
);

// --- 2. Clean pull -------------------------------------------------------------------------------

test(
  "2 · clean pull: a remote-only file is imported into the local DB",
  { skip: !gitAvailable },
  async () => {
    const remoteUrl = initBareRemote();
    const extKey = "ext-remote-1";
    mutateRemote(remoteUrl, "seed remote test", (wt) => {
      fs.mkdirSync(path.join(wt, "tests"), { recursive: true });
      fs.writeFileSync(
        path.join(wt, "tests", "remote-test.json"),
        testFileJson(extKey, "Remote Test", "from remote"),
      );
    });

    const { db, collections, sync } = await setup();
    const col = seedBoundCollection(db, {
      name: "C2",
      repoUrl: remoteUrl,
      repoPath: "",
      branch: "main",
    });

    const result = await sync.sync(col.id);
    assert.equal(result.status, "pulled");

    const local = localTestByKey(db, col.id, extKey);
    assert.ok(local, "the remote test was imported locally");
    assert.equal(local?.name, "Remote Test");
    assert.equal(local?.user_prompt, "from remote");
  },
);

// --- 3. Both-changed merge (no conflict) ---------------------------------------------------------

test(
  "3 · both-changed merge (disjoint): merged, both present, pushed",
  { skip: !gitAvailable },
  async () => {
    const remoteUrl = initBareRemote();
    mutateRemote(remoteUrl, "seed A", (wt) => {
      fs.mkdirSync(path.join(wt, "tests"), { recursive: true });
      fs.writeFileSync(
        path.join(wt, "tests", "remote-a.json"),
        testFileJson("ext-a", "Remote A", "a"),
      );
    });

    const { db, collections, tests, sync } = await setup();
    const col = seedBoundCollection(db, {
      name: "C3",
      repoUrl: remoteUrl,
      repoPath: "",
      branch: "main",
    });
    await sync.sync(col.id); // pull remote-a into the local DB

    // Local: add a NEW test (disjoint file). Remote: add ANOTHER new file (disjoint).
    const localB = tests.create({ name: "Local B", userPrompt: "b" });
    collections.assignTest(col.id, localB.id);
    mutateRemote(remoteUrl, "add C", (wt) => {
      fs.mkdirSync(path.join(wt, "tests"), { recursive: true });
      fs.writeFileSync(
        path.join(wt, "tests", "remote-c.json"),
        testFileJson("ext-c", "Remote C", "c"),
      );
    });

    const result = await sync.sync(col.id);
    assert.equal(result.status, "merged");
    assert.equal(result.state.conflicts.length, 0);

    // All three present locally and on the remote.
    assert.ok(localTestByKey(db, col.id, "ext-a"), "remote-a still local");
    assert.ok(localTestByKey(db, col.id, "ext-c"), "remote-c imported");
    assert.ok(localTestByKey(db, col.id, externalKeyOf(db, localB.id)), "local-b still local");
    const remoteFiles = listRemoteTests(remoteUrl);
    assert.deepEqual(remoteFiles, ["local-b.json", "remote-a.json", "remote-c.json"]);
  },
);

// --- 4. True conflict + resolution ---------------------------------------------------------------

test(
  "4 · true conflict on the same file → status conflicts → resolve take-remote converges + pushes",
  { skip: !gitAvailable },
  async () => {
    const remoteUrl = initBareRemote();
    const extKey = "ext-shared";
    mutateRemote(remoteUrl, "seed shared", (wt) => {
      fs.mkdirSync(path.join(wt, "tests"), { recursive: true });
      fs.writeFileSync(
        path.join(wt, "tests", "shared.json"),
        testFileJson(extKey, "Shared", "base"),
      );
    });

    const { db, collections, tests, sync } = await setup();
    const col = seedBoundCollection(db, {
      name: "C4",
      repoUrl: remoteUrl,
      repoPath: "",
      branch: "main",
    });
    await sync.sync(col.id); // pull shared

    // Local edit vs remote edit of the SAME file → conflict.
    const localId = localTestByKey(db, col.id, extKey)!.id;
    const cur = tests.get(localId);
    tests.update(localId, {
      name: cur.name,
      userPrompt: "local edit",
      addedProfiles: cur.addedProfiles,
      tags: cur.tags,
    });
    mutateRemote(remoteUrl, "remote edit", (wt) => {
      fs.writeFileSync(
        path.join(wt, "tests", "shared.json"),
        testFileJson(extKey, "Shared", "remote edit"),
      );
    });

    const conflicted = await sync.sync(col.id);
    assert.equal(conflicted.status, "conflicts");
    assert.equal(conflicted.state.conflicts.length, 1);
    const conflict = conflicted.state.conflicts[0]!;
    assert.ok(conflict.path.endsWith("shared.json"));
    assert.ok(conflict.local.includes("local edit"), "local side carries the local edit");
    assert.ok(conflict.remote.includes("remote edit"), "remote side carries the remote edit");

    // Resolve by taking the remote side → converges, pushed, DB reconciled to the remote value.
    const resolved = await sync.resolve(col.id, [
      { path: conflict.path, resolution: "take-remote" },
    ]);
    assert.equal(resolved.status, "merged");
    assert.equal(resolved.state.conflicts.length, 0);
    assert.equal(localTestByKey(db, col.id, extKey)?.user_prompt, "remote edit");
    assert.ok(
      readRemoteFile(remoteUrl, "tests/shared.json")?.includes("remote edit"),
      "remote has the resolved value",
    );
  },
);

// --- 5. Remote-deleted vs local-edited -----------------------------------------------------------

test(
  "5 · remote-deleted vs local-edited surfaces as a conflict (honest)",
  { skip: !gitAvailable },
  async () => {
    const remoteUrl = initBareRemote();
    const extKey = "ext-doomed";
    mutateRemote(remoteUrl, "seed doomed", (wt) => {
      fs.mkdirSync(path.join(wt, "tests"), { recursive: true });
      fs.writeFileSync(
        path.join(wt, "tests", "doomed.json"),
        testFileJson(extKey, "Doomed", "base"),
      );
    });

    const { db, collections, tests, sync } = await setup();
    const col = seedBoundCollection(db, {
      name: "C5",
      repoUrl: remoteUrl,
      repoPath: "",
      branch: "main",
    });
    await sync.sync(col.id); // pull doomed

    // Local edits it; remote deletes it.
    const localId = localTestByKey(db, col.id, extKey)!.id;
    const cur = tests.get(localId);
    tests.update(localId, {
      name: cur.name,
      userPrompt: "local edit",
      addedProfiles: cur.addedProfiles,
      tags: cur.tags,
    });
    mutateRemote(remoteUrl, "delete doomed", (wt) => {
      fs.rmSync(path.join(wt, "tests", "doomed.json"), { force: true });
    });

    const result = await sync.sync(col.id);
    assert.equal(result.status, "conflicts");
    const conflict = result.state.conflicts.find((c) => c.path.endsWith("doomed.json"));
    assert.ok(conflict, "the modify/delete surfaces as a conflict");
    assert.ok(conflict!.local.includes("local edit"), "local side present");
    assert.equal(conflict!.remote, "", "remote side is empty (deleted)");
  },
);

// --- 6. PAT never leaks (responses AND logs) + redaction -----------------------------------------

test(
  "6 · the PAT never appears in any route response or log line",
  { skip: !gitAvailable },
  async () => {
    const secret = "super-secret-pat-abc123";
    const remoteUrl = initBareRemote();
    const { db, app, collections, tests, secrets, logs } = await setup();

    // Route-level create redaction: an HTTPS binding is accepted (created, not cloned) and its response
    // omits the PAT while flagging hasPat. (A `file://` binding is now rejected at the route — H-1 — so
    // the sync target below is seeded directly with an encrypted PAT.)
    const created = await app.inject({
      method: "POST",
      url: "/api/collections",
      payload: {
        name: "C6-https",
        repoUrl: "https://github.com/example/repo.git",
        repoPath: "",
        branch: "main",
        pat: secret,
      },
    });
    assert.equal(created.statusCode, 201);
    assert.ok(!created.body.includes(secret), "create response omits the PAT");
    const createdCol = created.json() as { hasPat: boolean };
    assert.equal(createdCol.hasPat, true);

    // The sync target: a `file://` remote seeded past the https-only guard, carrying the encrypted PAT.
    const col = seedBoundCollection(db, {
      name: "C6",
      repoUrl: remoteUrl,
      repoPath: "",
      branch: "main",
      patEncrypted: secrets.encryptText(secret),
    });

    const t = tests.create({ name: "Secret Bearer", userPrompt: "p" });
    collections.assignTest(col.id, t.id);

    const synced = await app.inject({ method: "POST", url: `/api/collections/${col.id}/sync` });
    assert.equal(synced.statusCode, 200);
    assert.ok(!synced.body.includes(secret), "sync response omits the PAT");
    assert.equal((synced.json() as CollectionSyncResult).status, "pushed");

    const status = await app.inject({ method: "GET", url: `/api/collections/${col.id}/status` });
    assert.ok(!status.body.includes(secret), "status response omits the PAT");
    const got = await app.inject({ method: "GET", url: `/api/collections/${col.id}` });
    assert.ok(!got.body.includes(secret), "GET response omits the PAT");

    assert.ok(!logs.join("").includes(secret), "PAT never appears in any log line");

    // The redaction primitive the engine routes every git error through strips a token-bearing URL.
    const redacted = redactUrl(
      `fatal: unable to access 'https://x-access-token:${secret}@example.com/r.git'`,
    );
    assert.ok(!redacted.includes(secret), "redactUrl strips the embedded token");
    assert.ok(redacted.includes("https://***@"));
  },
);

test(
  "6b · a failing sync surfaces a redacted error, no PAT in response or logs",
  { skip: !gitAvailable },
  async () => {
    const secret = "another-secret-pat-xyz";
    const { db, app, collections, tests, secrets, logs } = await setup();
    // A nonexistent local remote → clone fails cleanly (offline), error is redacted. Seeded past the
    // https-only route guard (H-1) with the encrypted PAT so the failure path carries a real secret.
    const missing = pathToFileURL(
      path.join(os.tmpdir(), `nope-${crypto.randomUUID()}`, "repo.git"),
    ).toString();
    const col = seedBoundCollection(db, {
      name: "C6b",
      repoUrl: missing,
      repoPath: "",
      branch: "main",
      patEncrypted: secrets.encryptText(secret),
    });
    const t = tests.create({ name: "X", userPrompt: "p" });
    collections.assignTest(col.id, t.id);

    const res = await app.inject({ method: "POST", url: `/api/collections/${col.id}/sync` });
    assert.ok(res.statusCode >= 400, "the failing sync surfaces an error status");
    assert.ok(!res.body.includes(secret), "error response omits the PAT");
    assert.ok(!logs.join("").includes(secret), "no PAT in logs on the failure path");
  },
);

// --- 7. No force-push (source guard) -------------------------------------------------------------

test("7 · the sync engine never force-pushes or rebases (source guard)", () => {
  const src = fs.readFileSync(
    fileURLToPath(new URL("../src/collections/git-sync.ts", import.meta.url)),
    "utf8",
  );
  // Strip comments so a doc-comment mention of `--force` doesn't trip the guard — we assert on CODE.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.ok(!/--force/.test(code), "no --force anywhere in the command construction");
  assert.ok(!/force-with-lease/.test(code), "no --force-with-lease");
  assert.ok(!/\brebase\b/.test(code), "no rebase — only merge");
  // Every `git push` argv is force-free. (The only `-f` in the file is `git rm -f` during conflict
  // resolution, which is legitimate and unrelated to pushing.)
  const pushCalls = code.match(/\[\s*"push"[^\]]*\]/g) ?? [];
  assert.ok(pushCalls.length >= 1, "there is a push code path to check");
  for (const call of pushCalls) {
    assert.ok(!/(-f\b|--force)/.test(call), `push argv carries no force flag: ${call}`);
  }
});

// --- 8. Idempotent -------------------------------------------------------------------------------

test("8 · a no-op re-sync is `unchanged` with no new commit", { skip: !gitAvailable }, async () => {
  const remoteUrl = initBareRemote();
  const { db, collections, tests, sync } = await setup();
  const col = seedBoundCollection(db, {
    name: "C8",
    repoUrl: remoteUrl,
    repoPath: "",
    branch: "main",
  });
  const t = tests.create({ name: "Stable", userPrompt: "unchanging" });
  collections.assignTest(col.id, t.id);

  const first = await sync.sync(col.id);
  assert.equal(first.status, "pushed");
  const headAfterFirst = readRemoteFile(remoteUrl, "tests/stable.json");

  const second = await sync.sync(col.id);
  assert.equal(second.status, "unchanged");
  assert.equal(second.state.ahead, 0);
  assert.equal(second.state.behind, 0);
  assert.equal(second.state.dirty, false);
  // The exported file is byte-identical (round-trip stable) so nothing new was committed.
  assert.equal(readRemoteFile(remoteUrl, "tests/stable.json"), headAfterFirst);
});

// --- 9. Zod-invalid remote file ------------------------------------------------------------------

test(
  "9 · a malformed remote file fails cleanly (naming the file), DB untouched",
  { skip: !gitAvailable },
  async () => {
    const remoteUrl = initBareRemote();
    mutateRemote(remoteUrl, "seed mixed", (wt) => {
      fs.mkdirSync(path.join(wt, "tests"), { recursive: true });
      // A valid file AND an invalid one — the whole reconcile must abort with NEITHER imported.
      fs.writeFileSync(path.join(wt, "tests", "good.json"), testFileJson("ext-good", "Good", "ok"));
      fs.writeFileSync(
        path.join(wt, "tests", "broken.json"),
        '{ "formatVersion": 1, "name": "no required fields" }',
      );
    });

    const { db, collections, sync } = await setup();
    const col = seedBoundCollection(db, {
      name: "C9",
      repoUrl: remoteUrl,
      repoPath: "",
      branch: "main",
    });

    await assert.rejects(sync.sync(col.id), (err: Error) => /broken\.json/.test(err.message));

    const count = db
      .prepare("SELECT COUNT(*) AS n FROM tests WHERE collection_id = ?")
      .get(col.id) as { n: number };
    assert.equal(count.n, 0, "no rows written — the reconcile was transactional");
  },
);

// --- shared-module consolidation -----------------------------------------------------------------

test("the extracted git-credential module is the ONE implementation (skills + collections consume it)", () => {
  const gitService = fs.readFileSync(
    fileURLToPath(new URL("../src/skills/git-service.ts", import.meta.url)),
    "utf8",
  );
  const publishService = fs.readFileSync(
    fileURLToPath(new URL("../src/skills/publish-service.ts", import.meta.url)),
    "utf8",
  );
  const gitSync = fs.readFileSync(
    fileURLToPath(new URL("../src/collections/git-sync.ts", import.meta.url)),
    "utf8",
  );
  for (const [name, src] of [
    ["skills/git-service", gitService],
    ["skills/publish-service", publishService],
    ["collections/git-sync", gitSync],
  ] as const) {
    assert.ok(
      /git\/git-credential/.test(src),
      `${name} imports from the shared git-credential module`,
    );
  }
  // And the shared module owns the credential runner — the duplicated private copy is gone from git-service.
  assert.ok(!/function runGit\(/.test(gitService), "git-service no longer defines its own runGit");
});

// --- 10. H-1: collections repoUrl honors the shared SSRF guard ------------------------------------

test("10 · H-1 — a non-https / blocked-host repoUrl is rejected at the create route (400)", async () => {
  const { app } = await setup();
  const blocked = [
    "http://169.254.169.254/x.git", // link-local metadata (SSRF classic)
    "https://127.0.0.1/x.git", // loopback (blocked host)
    "https://10.0.0.5/x.git", // RFC1918 private
    "https://192.168.1.10/x.git", // RFC1918 private
    "git://github.com/o/r.git", // non-https scheme
    "ssh://git@github.com/o/r.git", // non-https scheme
    "file:///etc/passwd", // local-file scheme
  ];
  for (const repoUrl of blocked) {
    const res = await app.inject({
      method: "POST",
      url: "/api/collections",
      payload: { name: `blk-${nanoid()}`, repoUrl, repoPath: "", branch: "main" },
    });
    assert.equal(res.statusCode, 400, `expected 400 for ${repoUrl}`);
  }
  // A well-formed public https binding is still accepted (created, never cloned here).
  const ok = await app.inject({
    method: "POST",
    url: "/api/collections",
    payload: {
      name: `ok-${nanoid()}`,
      repoUrl: "https://github.com/example/repo.git",
      repoPath: "",
      branch: "main",
    },
  });
  assert.equal(ok.statusCode, 201, "a public https binding is accepted");
});

// --- 11. C-1: path-safety helpers ----------------------------------------------------------------

test("11 · path-safety — isSafeRelativePath / assertSafeRelativePath / assertWithinBase", () => {
  const unsafe = [
    "../secret",
    "a/../../etc/passwd",
    "/etc/passwd",
    "C:\\Windows\\system32",
    "a\\b",
    "foo/./bar",
    "a//b",
    "",
    "a\0b",
    "..",
    ".",
  ];
  for (const p of unsafe) {
    assert.equal(isSafeRelativePath(p), false, `unsafe: ${JSON.stringify(p)}`);
    assert.throws(() => assertSafeRelativePath(p), `throws for ${JSON.stringify(p)}`);
  }
  const safe = ["tests/foo.json", "suites/a-b-c.json", "x", "a/b/c/d.json"];
  for (const p of safe) {
    assert.equal(isSafeRelativePath(p), true, `safe: ${JSON.stringify(p)}`);
    assert.doesNotThrow(() => assertSafeRelativePath(p), `does not throw for ${p}`);
  }
  // Containment: a path inside the base is fine; an escape (or the base dir itself) is rejected.
  const base = path.join(os.tmpdir(), "pathsafe-base");
  assert.doesNotThrow(() => assertWithinBase(base, path.join(base, "tests", "foo.json")));
  assert.throws(() => assertWithinBase(base, path.join(base, "..", "evil.txt")));
  assert.throws(() => assertWithinBase(base, "/etc/passwd"));
  assert.throws(() => assertWithinBase(base, base)); // the base dir is not a legal file target
});

// --- 12. C-1: resolve route rejects traversal at the schema boundary ------------------------------

test("12 · C-1 — the resolve route rejects a traversal path at the schema boundary (400)", async () => {
  const { app, db } = await setup();
  // The body schema parses BEFORE the service is reached, so an unsafe path is a 400 regardless of any
  // merge state — it can never reach the fs sink. (No clone happens; the seeded url is never used.)
  const col = seedBoundCollection(db, {
    name: "C12",
    repoUrl: pathToFileURL(path.join(os.tmpdir(), "unused-c12")).toString(),
    repoPath: "",
    branch: "main",
  });
  const badPaths = ["../../../../etc/passwd", "/etc/passwd", "a\\b", "foo/../bar", "a/./b"];
  for (const bad of badPaths) {
    const res = await app.inject({
      method: "POST",
      url: `/api/collections/${col.id}/resolve`,
      payload: { resolutions: [{ path: bad, resolution: "edited", content: "x" }] },
    });
    assert.equal(res.statusCode, 400, `schema rejects: ${bad}`);
  }
});

// --- 13. C-1: resolve engine layer rejects traversal; legal path still resolves -------------------

test(
  "13 · C-1 — resolve() rejects traversal at the engine layer (writes nothing outside); a legal conflict path still resolves",
  { skip: !gitAvailable },
  async () => {
    const remoteUrl = initBareRemote();
    const extKey = "ext-c13";
    mutateRemote(remoteUrl, "seed", (wt) => {
      fs.mkdirSync(path.join(wt, "tests"), { recursive: true });
      fs.writeFileSync(
        path.join(wt, "tests", "shared.json"),
        testFileJson(extKey, "Shared", "base"),
      );
    });

    const { db, tests, sync, baseDir } = await setup();
    const col = seedBoundCollection(db, {
      name: "C13",
      repoUrl: remoteUrl,
      repoPath: "",
      branch: "main",
    });
    await sync.sync(col.id); // pull

    // Local edit vs remote edit of the SAME file → a merge conflict (resolve's precondition).
    const localId = localTestByKey(db, col.id, extKey)!.id;
    const cur = tests.get(localId);
    tests.update(localId, {
      name: cur.name,
      userPrompt: "local edit",
      addedProfiles: cur.addedProfiles,
      tags: cur.tags,
    });
    mutateRemote(remoteUrl, "remote edit", (wt) => {
      fs.writeFileSync(
        path.join(wt, "tests", "shared.json"),
        testFileJson(extKey, "Shared", "remote edit"),
      );
    });
    const conflicted = await sync.sync(col.id);
    assert.equal(conflicted.status, "conflicts");
    const legalPath = conflicted.state.conflicts[0]!.path;

    // `../pwned.txt` resolves to <baseDir>/pwned.txt (one level above the clone). The resolve must
    // reject BEFORE any fs op — nothing lands outside the clone.
    const escapeTarget = path.join(baseDir, "pwned.txt");
    await assert.rejects(
      sync.resolve(col.id, [{ path: "../pwned.txt", resolution: "edited", content: "PWNED" }]),
    );
    assert.equal(fs.existsSync(escapeTarget), false, "no host file written outside the clone");

    // Absolute + backslash paths are rejected at the engine layer too.
    await assert.rejects(
      sync.resolve(col.id, [{ path: "/tmp/evil.txt", resolution: "edited", content: "x" }]),
    );
    await assert.rejects(
      sync.resolve(col.id, [{ path: "a\\b.json", resolution: "edited", content: "x" }]),
    );
    // A SAFE path that is NOT one of this merge's conflicts is rejected (best-in-depth set restriction).
    await assert.rejects(
      sync.resolve(col.id, [
        { path: "tests/not-a-conflict.json", resolution: "edited", content: "x" },
      ]),
    );

    // The rejected attempts touched nothing, so the merge is still in progress and the LEGAL conflict
    // path resolves and converges.
    const resolved = await sync.resolve(col.id, [{ path: legalPath, resolution: "take-remote" }]);
    assert.equal(resolved.status, "merged");
    assert.equal(localTestByKey(db, col.id, extKey)?.user_prompt, "remote edit");
  },
);

// --- 14. H-5: per-collection mutex serializes overlapping calls -----------------------------------

test(
  "14 · H-5 — concurrent syncs on one collection are serialized (deterministic, no corruption)",
  { skip: !gitAvailable },
  async () => {
    const remoteUrl = initBareRemote();
    const { db, collections, tests, sync } = await setup();
    const col = seedBoundCollection(db, {
      name: "C14",
      repoUrl: remoteUrl,
      repoPath: "",
      branch: "main",
    });
    const t = tests.create({ name: "Racer", userPrompt: "go" });
    collections.assignTest(col.id, t.id);

    // Fire two syncs at once. With the per-id mutex the second waits for the first: the first pushes,
    // the second sees the converged state → unchanged. Without serialization both would `git add`/commit
    // on ONE index and at least one would throw. Neither throws; the outcome is deterministic (chain order).
    const [r1, r2] = await Promise.all([sync.sync(col.id), sync.sync(col.id)]);
    assert.equal(r1.status, "pushed");
    assert.equal(r2.status, "unchanged");

    // A read-only status runs cleanly alongside another sync (both serialized on the same clone).
    const [s, st] = await Promise.all([sync.sync(col.id), sync.status(col.id)]);
    assert.equal(s.status, "unchanged");
    assert.equal(st.conflicts.length, 0);

    // Exactly the one expected file on the remote — no corruption from the concurrency.
    assert.deepEqual(listRemoteTests(remoteUrl), ["racer.json"]);
  },
);

// --- 15. H-6: export never clobbers a foreign (different-key) sibling ------------------------------

test(
  "15 · H-6 — export suffixes instead of overwriting a foreign (different-key) sibling file",
  { skip: !gitAvailable },
  async () => {
    const remoteUrl = initBareRemote();
    const { db, collections, tests, sync } = await setup();
    const col = seedBoundCollection(db, {
      name: "C15",
      repoUrl: remoteUrl,
      repoPath: "",
      branch: "main",
    });

    // Member A "Foo" → tests/foo.json (its own key), pushed.
    const a = tests.create({ name: "Foo", userPrompt: "aaa" });
    collections.assignTest(col.id, a.id);
    assert.equal((await sync.sync(col.id)).status, "pushed");
    assert.ok(readRemoteFile(remoteUrl, "tests/foo.json")?.includes("aaa"));

    // Detach A (its membership + external_key cleared) but the file stays on the remote → now "foreign".
    collections.removeTest(a.id);

    // A NEW member B "Foo" kebabs to the SAME slug. It must NOT overwrite A's foreign file.
    const b = tests.create({ name: "Foo", userPrompt: "bbb" });
    collections.assignTest(col.id, b.id);
    assert.equal((await sync.sync(col.id)).status, "pushed");

    // A's foreign file is byte-untouched ("aaa"); B landed on a `-2` suffix.
    const foreign = readRemoteFile(remoteUrl, "tests/foo.json");
    assert.ok(foreign?.includes("aaa"), "foreign file preserved");
    assert.ok(!foreign?.includes("bbb"), "foreign file NOT clobbered by the new member");
    assert.ok(
      readRemoteFile(remoteUrl, "tests/foo-2.json")?.includes("bbb"),
      "the new member took a -2 suffix",
    );
    assert.deepEqual(listRemoteTests(remoteUrl), ["foo-2.json", "foo.json"]);
  },
);
