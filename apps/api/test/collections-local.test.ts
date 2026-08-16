import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { pathToFileURL } from "node:url";
import { afterEach, before, test } from "node:test";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import {
  COLLECTION_FILE_FORMAT_VERSION,
  type Collection,
  REPO_NOT_BOUND_CODE,
} from "@mcp-token-footprint/shared";
import { CollectionGitSyncService } from "../src/collections/git-sync.js";
import { CollectionRepository } from "../src/collections/repository.js";
import { registerCollectionRoutes } from "../src/collections/routes.js";
import { serializeFile } from "../src/collections/serializer.js";
import { CollectionService } from "../src/collections/service.js";
import { applyMigrations, ensureLocalCollection, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { SuiteRepository } from "../src/suites/repository.js";
import { TestRepository } from "../src/testing/test-repository.js";
import { toErrorMessage } from "../src/utils/errors.js";

// Testing IA (WP 2.1, D-T4) — collections-as-home: LOCAL (unbound) collections with full CRUD, the
// reserved "Local" collection's undeletable/not-bindable/reassign-on-delete guarantees, honest
// REPO_NOT_BOUND on sync/status/resolve when unbound, and a bind-later → offline `file://` sync E2E.
// The git flow reuses the WP 4.2 pattern (a local `git init --bare` exposed as a `file://` URL — no
// network). `git` is required only for the sync E2E; if absent that one test skips.

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
  const dir = mkTmp("local-sync-remote-");
  git(dir, ["init", "--bare", "-b", "main"]);
  return pathToFileURL(dir).toString();
}

/** Clone the bare remote read-only and return the file at `relPath` (or undefined if absent). */
function readRemoteFile(remoteUrl: string, relPath: string): string | undefined {
  const wt = mkTmp("local-sync-read-");
  git(path.dirname(wt), ["clone", "-q", remoteUrl, wt]);
  const abs = path.join(wt, ...relPath.split("/"));
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : undefined;
}

/** A minimal on-disk TestFile JSON, byte-identical to what the engine exporter emits for a plain test. */
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
  app: FastifyInstance;
  logs: string[];
};

/**
 * In-memory DB at the latest schema WITH the reserved Local collection seeded (mirrors openDatabase),
 * the full service stack, and a Fastify app whose error handler MIRRORS the production one in
 * `apps/api/src/index.ts` (so a typed `code` surfaces additively in the response body).
 */
async function setup(): Promise<Env> {
  const db = new Database(":memory:") as unknown as AppDatabase;
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  ensureLocalCollection(db); // seed the reserved, undeletable "Local" collection (D-T4)
  databases.push(db);

  const secrets = new SecretStore(crypto.randomBytes(32));
  const collections = new CollectionRepository(db, secrets);
  const tests = new TestRepository(db);
  const suites = new SuiteRepository(db);
  const baseDir = mkTmp("local-sync-clones-");
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
    const typed = error as Error & { statusCode?: number; code?: string };
    request.log.error(error);
    const code =
      typeof typed.statusCode === "number" && typeof typed.code === "string"
        ? typed.code
        : undefined;
    return reply
      .code(typed.statusCode ?? 500)
      .send({ error: toErrorMessage(error), ...(code ? { code } : {}) });
  });
  await registerCollectionRoutes(app, new CollectionService(collections), sync);
  await app.ready();
  apps.push(app);
  return { db, collections, tests, suites, sync, app, logs };
}

function localCollection(collections: CollectionRepository): Collection {
  const local = collections.list().find((c) => c.isDefault);
  if (!local) throw new Error("test setup: reserved Local collection was not seeded");
  return local;
}

function seedSuite(db: AppDatabase, id: string, name: string): void {
  db.prepare(
    `INSERT INTO suites (id, name, config_json, created_at, updated_at)
     VALUES (@id, @name, '{}', @now, @now)`,
  ).run({ id, name, now: "2026-07-05T00:00:00.000Z" });
}

function externalKeyOf(db: AppDatabase, testId: string): string {
  const row = db.prepare("SELECT external_key FROM tests WHERE id = ?").get(testId) as {
    external_key: string | null;
  };
  return row.external_key ?? "";
}

// ── (1) Create a LOCAL (unbound) collection with full CRUD; it holds a test ───────────────────────────

test("a LOCAL (unbound) collection is created with NULL repo fields and holds a test", async () => {
  const { db, collections, tests } = await setup();

  const local = collections.create({ name: "My local set" });
  assert.equal(local.repoUrl, null, "unbound → repoUrl NULL");
  assert.equal(local.repoPath, null, "unbound → repoPath NULL");
  assert.equal(local.branch, null, "unbound → branch NULL");
  assert.equal(local.hasPat, false, "no PAT on a local collection");
  assert.equal(
    local.isDefault,
    false,
    "a user-created local collection is NOT the reserved default",
  );

  const t = tests.create({ name: "T1", userPrompt: "p" });
  collections.assignTest(local.id, t.id);

  const row = db
    .prepare("SELECT collection_id, external_key FROM tests WHERE id = ?")
    .get(t.id) as {
    collection_id: string | null;
    external_key: string | null;
  };
  assert.equal(row.collection_id, local.id, "the test is a member of the local collection");
  assert.ok(row.external_key, "membership stamped an external_key");
});

// ── (2) Deleting a NON-default collection reassigns its tests + suites to Local ────────────────────────

test("deleting a non-default collection reassigns its tests + suites to Local (never orphaned)", async () => {
  const { db, collections, tests } = await setup();
  const local = localCollection(collections);

  const col = collections.create({
    name: "Temp",
    repoUrl: "https://github.com/acme/x.git",
    repoPath: ".",
    branch: "main",
  });
  const t = tests.create({ name: "Member T", userPrompt: "p" });
  seedSuite(db, "s1", "Member S");
  collections.assignTest(col.id, t.id);
  collections.assignSuite(col.id, "s1");

  collections.delete(col.id);

  const tRow = db
    .prepare("SELECT collection_id, external_key FROM tests WHERE id = ?")
    .get(t.id) as {
    collection_id: string | null;
    external_key: string | null;
  };
  const sRow = db
    .prepare("SELECT collection_id, external_key FROM suites WHERE id = 's1'")
    .get() as {
    collection_id: string | null;
    external_key: string | null;
  };
  assert.equal(tRow.collection_id, local.id, "the member test moved to Local");
  assert.equal(sRow.collection_id, local.id, "the member suite moved to Local");
  assert.equal(tRow.external_key, null, "the deleted-collection git identity is cleared");
  assert.equal(sRow.external_key, null, "the deleted-collection git identity is cleared");
  assert.throws(
    () => collections.get(col.id),
    /Collection not found/,
    "the collection itself is gone",
  );
});

// ── (3) sync/status/resolve on an UNBOUND collection → honest 400 REPO_NOT_BOUND (service + route) ─────

test("sync/status/resolve on an unbound collection throw 400 with code REPO_NOT_BOUND (service)", async () => {
  const { collections, sync } = await setup();
  const col = collections.create({ name: "Loose" });

  const calls: Array<() => Promise<unknown>> = [
    () => sync.sync(col.id),
    () => sync.status(col.id),
    () => sync.resolve(col.id, []),
  ];
  for (const call of calls) {
    await assert.rejects(call, (err: Error & { statusCode?: number; code?: string }) => {
      assert.equal(err.statusCode, 400, "unbound sync is an honest 400, never a fake success");
      assert.equal(err.code, REPO_NOT_BOUND_CODE, "carries the shared REPO_NOT_BOUND code");
      return true;
    });
  }
});

test("the /sync, /status, /resolve routes answer 400 { code: REPO_NOT_BOUND } for an unbound collection", async () => {
  const { app, collections } = await setup();
  const col = collections.create({ name: "Loose route" });

  const synced = await app.inject({ method: "POST", url: `/api/collections/${col.id}/sync` });
  assert.equal(synced.statusCode, 400);
  assert.equal((synced.json() as { code?: string }).code, REPO_NOT_BOUND_CODE);

  const status = await app.inject({ method: "GET", url: `/api/collections/${col.id}/status` });
  assert.equal(status.statusCode, 400);
  assert.equal((status.json() as { code?: string }).code, REPO_NOT_BOUND_CODE);

  const resolved = await app.inject({
    method: "POST",
    url: `/api/collections/${col.id}/resolve`,
    payload: { resolutions: [] },
  });
  assert.equal(resolved.statusCode, 400);
  assert.equal((resolved.json() as { code?: string }).code, REPO_NOT_BOUND_CODE);
});

// ── (4) The reserved Local collection: undeletable + not repo-bindable ─────────────────────────────────

test("the reserved Local collection cannot be deleted or repo-bound; a binding-free rename is allowed", async () => {
  const { app, collections } = await setup();
  const local = localCollection(collections);
  assert.equal(local.isDefault, true, "the seeded Local collection is the reserved default");

  assert.throws(
    () => collections.delete(local.id),
    (err: Error & { statusCode?: number }) => {
      assert.equal(err.statusCode, 409);
      return /cannot be deleted/.test(err.message);
    },
    "Local is undeletable",
  );

  assert.throws(
    () =>
      collections.update(local.id, {
        name: local.name,
        repoUrl: "https://github.com/acme/x.git",
        repoPath: ".",
        branch: "main",
      }),
    (err: Error & { statusCode?: number }) => {
      assert.equal(err.statusCode, 409);
      return /cannot be bound/.test(err.message);
    },
    "Local is not repo-bindable",
  );

  // The reserved name is immutable: renaming the default to a DIFFERENT name → 409.
  assert.throws(
    () => collections.update(local.id, { name: "Renamed Local" }),
    (err: Error & { statusCode?: number }) => {
      assert.equal(err.statusCode, 409);
      return /reserved|renamed/.test(err.message);
    },
    "the default collection's name is reserved/immutable",
  );

  // A same-name update of Local still succeeds and keeps it local + default (didn't break other updates).
  const noop = collections.update(local.id, { name: local.name });
  assert.equal(noop.repoUrl, null, "Local stays unbound after a same-name update");
  assert.equal(noop.isDefault, true, "Local stays the reserved default after a same-name update");

  // The DELETE route also refuses Local (409).
  const res = await app.inject({ method: "DELETE", url: `/api/collections/${local.id}` });
  assert.equal(res.statusCode, 409, "the DELETE route refuses the reserved Local collection");
});

// ── (4b) The default name "Local" is reserved — no other collection may create/rename into it ─────────

test('the name "Local" is reserved: create/rename into it is refused (case-insensitive)', async () => {
  const { collections } = await setup();

  // Creating a collection named the reserved default (any case / surrounding whitespace) → 409.
  for (const name of ["Local", "local", "  LOCAL  "]) {
    assert.throws(
      () => collections.create({ name }),
      (err: Error & { statusCode?: number }) => {
        assert.equal(err.statusCode, 409);
        return /reserved/.test(err.message);
      },
      `creating a collection named ${JSON.stringify(name)} is refused`,
    );
  }

  // Renaming a normal collection INTO the reserved name → 409.
  const normal = collections.create({ name: "Perfectly normal" });
  assert.throws(
    () => collections.update(normal.id, { name: "local" }),
    (err: Error & { statusCode?: number }) => {
      assert.equal(err.statusCode, 409);
      return /reserved/.test(err.message);
    },
    "renaming a normal collection into the reserved name is refused",
  );
  // A normal update to a non-reserved name still works.
  const ok = collections.update(normal.id, { name: "Still normal" });
  assert.equal(ok.name, "Still normal");
});

// ── (5) Bind-later: a local collection bound to a repo then syncs (offline file:// remote) ─────────────

test(
  "bind-later: an unbound collection binds a repo, then the existing offline sync flow pushes it",
  { skip: !gitAvailable },
  async () => {
    const remoteUrl = initBareRemote();
    const { db, collections, tests, sync } = await setup();

    // Start LOCAL (unbound) and hold a member.
    const col = collections.create({ name: "Grows up" });
    assert.equal(col.repoUrl, null, "starts unbound");
    const t = tests.create({ name: "Alpha Test", userPrompt: "do the thing" });
    collections.assignTest(col.id, t.id);

    // Before binding, sync is honestly refused.
    await assert.rejects(
      sync.sync(col.id),
      (err: Error & { code?: string }) => err.code === REPO_NOT_BOUND_CODE,
      "unbound sync refused before binding",
    );

    // Bind later (full group; PAT discipline unchanged — none here). A `file://` remote is a test
    // stand-in and is now rejected by the https-only `collectionInputSchema` guard (H-1), so the
    // binding is written directly (mirroring the repository's own UPDATE) rather than through the
    // schema-validated `collections.update`.
    db.prepare(
      "UPDATE collections SET repo_url = ?, repo_path = ?, branch = ?, updated_at = ? WHERE id = ?",
    ).run(remoteUrl, "", "main", new Date().toISOString(), col.id);
    const bound = collections.get(col.id);
    assert.equal(bound.repoUrl, remoteUrl, "the binding persisted");
    assert.equal(bound.branch, "main");

    // The existing sync flow now works unchanged: the member is exported, committed, pushed.
    const result = await sync.sync(col.id);
    assert.equal(result.status, "pushed", "bind-later sync pushes the member");
    assert.equal(result.state.conflicts.length, 0);

    const key = externalKeyOf(db, t.id);
    const onRemote = readRemoteFile(remoteUrl, "tests/alpha-test.json");
    assert.ok(onRemote, "the exported file landed on the remote after bind-later");
    assert.equal(
      onRemote,
      testFileJson(key, "Alpha Test", "do the thing"),
      "byte-identical to the engine export",
    );
    assert.ok(
      collections.get(col.id).lastSyncedSha,
      "last_synced_sha recorded after the bind-later push",
    );
  },
);

// ── (6) The PAT is write-only and NEVER returned (create/bind/get/list) ────────────────────────────────

test("a PAT bound via bind-later is stored encrypted and NEVER returned by any route", async () => {
  const { app, collections } = await setup();
  const SECRET = "ghp_local_secret_value_9876543210";

  // A PAT requires a binding — a local collection carries none.
  const col = collections.create({ name: "Secretful" });

  const updated = await app.inject({
    method: "PUT",
    url: `/api/collections/${col.id}`,
    payload: {
      name: "Secretful",
      repoUrl: "https://github.com/acme/x.git",
      repoPath: ".",
      branch: "main",
      pat: SECRET,
    },
  });
  assert.equal(updated.statusCode, 200);
  assert.ok(!updated.body.includes(SECRET), "the bind-later response omits the PAT");
  assert.equal(
    (updated.json() as { hasPat: boolean }).hasPat,
    true,
    "hasPat reflects the stored PAT",
  );

  const got = await app.inject({ method: "GET", url: `/api/collections/${col.id}` });
  assert.ok(!got.body.includes(SECRET), "GET omits the PAT");
  const listed = await app.inject({ method: "GET", url: "/api/collections" });
  assert.ok(!listed.body.includes(SECRET), "list omits the PAT");

  // The PAT IS stored (encrypted) and recoverable only via the internal decryptPat.
  assert.equal(
    collections.decryptPat(col.id),
    SECRET,
    "the PAT is stored encrypted and internally recoverable",
  );
});

test("a PAT without a repo binding is rejected at the schema (no local collection may carry a PAT)", async () => {
  const { app } = await setup();
  const res = await app.inject({
    method: "POST",
    url: "/api/collections",
    payload: { name: "Bad", pat: "should-be-rejected" },
  });
  assert.equal(res.statusCode, 400, "a PAT without a binding is a 400");
});
