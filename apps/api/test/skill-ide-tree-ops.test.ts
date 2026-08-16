import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { zipSync, type Zippable } from "fflate";
import { ZodError } from "zod";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { registerSkillflowRoutes } from "../src/skillflow/routes.js";
import { applyTreeOps } from "../src/skillflow/tree-ops.js";
import { SkillGitService } from "../src/skills/git-service.js";
import { SkillIngestService } from "../src/skills/ingest-service.js";
import { SkillRepository } from "../src/skills/repository.js";
import { registerSkillRoutes } from "../src/skills/routes.js";
import { RunRepository } from "../src/testing/run-repository.js";
import { toErrorMessage } from "../src/utils/errors.js";

// WP 3.1 — tree-level edit ops (add/update/rename/move/delete files + folders as implicit prefixes)
// round-tripping END-TO-END through POST /api/skills/:id/versions/:vid/edits. Harness mirrors
// skillflow-roundtrip.test.ts: seed a skill from the zero-annotation fixture via the real upload
// ingest path, then drive edits through the route and assert on the persisted new version + diff.

const here = path.dirname(fileURLToPath(import.meta.url));
const skillsDir = path.join(here, "fixtures/skillflow/skills");

const apps: FastifyInstance[] = [];
const databases: AppDatabase[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const db of databases.splice(0)) db.close();
});

async function buildApp(): Promise<{ app: FastifyInstance; repo: SkillRepository }> {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  databases.push(db);

  const repo = new SkillRepository(db, new SecretStore(Buffer.alloc(32, 7)));
  const dataDir = path.join(
    os.tmpdir(),
    `skill-ide-tree-ops-${Math.random().toString(36).slice(2)}`,
  );
  const ingest = new SkillIngestService(repo, { dataDir, tokenProfile: "generic_o200k" });
  const git = new SkillGitService(repo, { dataDir, tokenProfile: "generic_o200k" });
  const runs = new RunRepository(db);

  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: "Validation failed" });
    const typed = error as Error & { statusCode?: number };
    return reply.code(typed.statusCode ?? 500).send({ error: toErrorMessage(error) });
  });
  await registerSkillRoutes(app, repo, ingest, git);
  await registerSkillflowRoutes(app, repo, runs);
  await app.ready();
  apps.push(app);
  return { app, repo };
}

const BOUNDARY = "----skillIdeTreeOpsBoundary";

function walkFiles(dir: string, root: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walkFiles(full, root, out);
    else out.push(path.relative(root, full).split(path.sep).join("/"));
  }
}

function fixtureZip(name: string): Buffer {
  const dir = path.join(skillsDir, name);
  const paths: string[] = [];
  walkFiles(dir, dir, paths);
  const zippable: Zippable = {};
  for (const p of paths.sort()) zippable[p] = new Uint8Array(readFileSync(path.join(dir, p)));
  return Buffer.from(zipSync(zippable));
}

async function seedSkill(app: FastifyInstance, fixture: string) {
  const payload = Buffer.concat([
    Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${fixture}.zip"\r\n` +
        `Content-Type: application/zip\r\n\r\n`,
    ),
    fixtureZip(fixture),
    Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
  ]);
  const res = await app.inject({
    method: "POST",
    url: "/api/skills",
    payload,
    headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
  });
  assert.equal(res.statusCode, 201, res.body);
  return res.json() as { id: string; currentVersionId: string };
}

function postEdits(app: FastifyInstance, skillId: string, versionId: string, body: unknown) {
  return app.inject({
    method: "POST",
    url: `/api/skills/${skillId}/versions/${versionId}/edits`,
    payload: body as Record<string, unknown>,
  });
}

async function treeSha(app: FastifyInstance, skillId: string, vid: string): Promise<string> {
  return (await app.inject({ url: `/api/skills/${skillId}/versions/${vid}` })).json()
    .treeSha as string;
}

/** Assert every path in `fromMap` except those in `changed` carries over with an IDENTICAL blob sha. */
function assertUntouchedBlobsIdentical(
  repo: SkillRepository,
  fromVid: string,
  toVid: string,
  changed: string[],
): void {
  const fromMap = repo.getDiffFileMap(fromVid);
  const toMap = repo.getDiffFileMap(toVid);
  for (const [p, file] of fromMap) {
    if (changed.includes(p)) continue;
    assert.equal(toMap.get(p)?.blobSha, file.blobSha, `${p} blob sha must be unchanged`);
  }
}

// --- add_file (utf8 + base64 binary) --------------------------------------------------------------

test("add_file (utf8): new version, file present, untouched files keep identical blob shas", async () => {
  const { app, repo } = await buildApp();
  const skill = await seedSkill(app, "zero-annotation");
  const vid = skill.currentVersionId;

  const res = await postEdits(app, skill.id, vid, {
    baseTreeSha: await treeSha(app, skill.id, vid),
    ops: [{ op: "add_file", path: "references/glossary.md", content: "# Glossary\n\nTerms.\n" }],
  });
  assert.equal(res.statusCode, 201, res.body);
  const body = res.json();
  assert.equal(body.version.seq, 2);

  const added = repo.getFileContent(body.version.id, "references/glossary.md");
  assert.equal(added.isBinary, false);
  assert.ok(!added.isBinary && added.text.includes("# Glossary"));
  assertUntouchedBlobsIdentical(repo, vid, body.version.id, []); // nothing else changed
  const addedEntry = body.diff.entries.find(
    (e: { path: string }) => e.path === "references/glossary.md",
  );
  assert.equal(addedEntry?.status, "added");
});

test("add_file (base64 binary): stored as a binary blob, folder is an implicit prefix", async () => {
  const { app, repo } = await buildApp();
  const skill = await seedSkill(app, "zero-annotation");
  const vid = skill.currentVersionId;

  // A tiny PNG header contains NUL bytes → classified binary; base64-encoded on the wire.
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x01]);
  const res = await postEdits(app, skill.id, vid, {
    baseTreeSha: await treeSha(app, skill.id, vid),
    ops: [
      {
        op: "add_file",
        path: "assets/img/logo.png",
        content: bytes.toString("base64"),
        encoding: "base64",
      },
    ],
  });
  assert.equal(res.statusCode, 201, res.body);
  const body = res.json();
  const bytesBack = repo.getFileBytes(body.version.id, "assets/img/logo.png");
  assert.equal(bytesBack.isBinary, true);
  assert.ok(bytesBack.bytes.equals(bytes), "binary bytes round-trip exactly");
});

// --- update_file ----------------------------------------------------------------------------------

test("update_file: replaces an existing file's content, other blobs identical", async () => {
  const { app, repo } = await buildApp();
  const skill = await seedSkill(app, "zero-annotation");
  const vid = skill.currentVersionId;

  const res = await postEdits(app, skill.id, vid, {
    baseTreeSha: await treeSha(app, skill.id, vid),
    ops: [{ op: "update_file", path: "reference/format-spec.md", content: "# New spec\n" }],
  });
  assert.equal(res.statusCode, 201, res.body);
  const body = res.json();
  const updated = repo.getFileContent(body.version.id, "reference/format-spec.md");
  assert.ok(!updated.isBinary && updated.text === "# New spec\n");
  assertUntouchedBlobsIdentical(repo, vid, body.version.id, ["reference/format-spec.md"]);
  const entry = body.diff.entries.find(
    (e: { path: string }) => e.path === "reference/format-spec.md",
  );
  assert.equal(entry?.status, "modified");
});

// --- rename within a dir, and move across dirs (diff labels a rename via blob sha) -----------------

test("rename_file within a dir: diff reports a rename (blob preserved), not add+remove", async () => {
  const { app, repo } = await buildApp();
  const skill = await seedSkill(app, "zero-annotation");
  const vid = skill.currentVersionId;
  const before = repo.getDiffFileMap(vid).get("reference/format-spec.md")?.blobSha;

  const res = await postEdits(app, skill.id, vid, {
    baseTreeSha: await treeSha(app, skill.id, vid),
    ops: [{ op: "rename_file", from: "reference/format-spec.md", to: "reference/spec.md" }],
  });
  assert.equal(res.statusCode, 201, res.body);
  const body = res.json();
  const renamed = body.diff.entries.find((e: { path: string }) => e.path === "reference/spec.md");
  assert.equal(renamed?.status, "renamed", "diff labels the rename");
  assert.equal(renamed?.fromPath, "reference/format-spec.md");
  // The moved blob sha is preserved (rename, not a rewrite).
  assert.equal(repo.getDiffFileMap(body.version.id).get("reference/spec.md")?.blobSha, before);
  assert.equal(repo.getDiffFileMap(body.version.id).has("reference/format-spec.md"), false);
});

test("rename_file across dirs (move): diff still reports a rename", async () => {
  const { app } = await buildApp();
  const skill = await seedSkill(app, "zero-annotation");
  const vid = skill.currentVersionId;

  const res = await postEdits(app, skill.id, vid, {
    baseTreeSha: await treeSha(app, skill.id, vid),
    ops: [{ op: "rename_file", from: "scripts/validate.py", to: "bin/validate.py" }],
  });
  assert.equal(res.statusCode, 201, res.body);
  const body = res.json();
  const moved = body.diff.entries.find((e: { path: string }) => e.path === "bin/validate.py");
  assert.equal(moved?.status, "renamed");
  assert.equal(moved?.fromPath, "scripts/validate.py");
});

// --- delete_file ----------------------------------------------------------------------------------

test("delete_file: the file is gone in the new version and reported removed", async () => {
  const { app, repo } = await buildApp();
  const skill = await seedSkill(app, "zero-annotation");
  const vid = skill.currentVersionId;

  const res = await postEdits(app, skill.id, vid, {
    baseTreeSha: await treeSha(app, skill.id, vid),
    ops: [{ op: "delete_file", path: "assets/template.html" }],
  });
  assert.equal(res.statusCode, 201, res.body);
  const body = res.json();
  assert.equal(repo.getDiffFileMap(body.version.id).has("assets/template.html"), false);
  const removed = body.diff.entries.find(
    (e: { path: string }) => e.path === "assets/template.html",
  );
  assert.equal(removed?.status, "removed");
});

// --- SKILL.md guards ------------------------------------------------------------------------------

test("SKILL.md rename → 400; SKILL.md delete → 400", async () => {
  const { app } = await buildApp();
  const skill = await seedSkill(app, "zero-annotation");
  const vid = skill.currentVersionId;
  const base = await treeSha(app, skill.id, vid);

  const renameRes = await postEdits(app, skill.id, vid, {
    baseTreeSha: base,
    ops: [{ op: "rename_file", from: "SKILL.md", to: "README.md" }],
  });
  assert.equal(renameRes.statusCode, 400);
  assert.match(renameRes.json().error, /SKILL\.md cannot be renamed/i);

  const deleteRes = await postEdits(app, skill.id, vid, {
    baseTreeSha: base,
    ops: [{ op: "delete_file", path: "SKILL.md" }],
  });
  assert.equal(deleteRes.statusCode, 400);
  assert.match(deleteRes.json().error, /SKILL\.md cannot be deleted/i);
});

test("update_file on SKILL.md alone works and re-projects the graph", async () => {
  const { app } = await buildApp();
  const skill = await seedSkill(app, "zero-annotation");
  const vid = skill.currentVersionId;

  const newMd =
    "---\nname: data-report\ndescription: A report skill.\n---\n\n# Data Report\n\n## Compose the answer\n\nWrite it up.\n";
  const res = await postEdits(app, skill.id, vid, {
    baseTreeSha: await treeSha(app, skill.id, vid),
    ops: [{ op: "update_file", path: "SKILL.md", content: newMd }],
  });
  assert.equal(res.statusCode, 201, res.body);
  const body = res.json();
  // Re-project the new version's graph via the graph route — the new heading is a node.
  const graphRes = await app.inject({
    url: `/api/skills/${skill.id}/versions/${body.version.id}/graph`,
  });
  const graph = graphRes.json().graph;
  assert.ok(
    graph.nodes.some((n: { label: string }) => n.label === "Compose the answer"),
    "the update_file'd SKILL.md re-projects into a fresh graph",
  );
});

// --- mixed text + tree batch, and the SKILL.md text/update_file conflict ---------------------------

test("mixed text + tree batch → ONE version with BOTH applied", async () => {
  const { app, repo } = await buildApp();
  const skill = await seedSkill(app, "zero-annotation");
  const vid = skill.currentVersionId;

  const res = await postEdits(app, skill.id, vid, {
    baseTreeSha: await treeSha(app, skill.id, vid),
    ops: [
      { op: "rename_node", nodeId: "generate-the-report", label: "Generate the summary report" },
      { op: "add_file", path: "references/notes.md", content: "Notes.\n" },
    ],
  });
  assert.equal(res.statusCode, 201, res.body);
  const body = res.json();
  assert.equal(body.version.seq, 2, "exactly one new version for the whole batch");

  const md = repo.getFileContent(body.version.id, "SKILL.md");
  assert.ok(!md.isBinary && md.text.includes("## Generate the summary report"), "text op applied");
  assert.ok(repo.getDiffFileMap(body.version.id).has("references/notes.md"), "tree op applied");

  const versions = (await app.inject({ url: `/api/skills/${skill.id}/versions` })).json();
  assert.equal(versions.length, 2, "no version spam — one save");
});

test("text op + update_file(SKILL.md) in one batch → 400 conflicting", async () => {
  const { app } = await buildApp();
  const skill = await seedSkill(app, "zero-annotation");
  const vid = skill.currentVersionId;

  const res = await postEdits(app, skill.id, vid, {
    baseTreeSha: await treeSha(app, skill.id, vid),
    ops: [
      { op: "rename_node", nodeId: "generate-the-report", label: "X" },
      { op: "update_file", path: "SKILL.md", content: "# Whole new doc\n" },
    ],
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /conflicting skill\.md/i);
});

// --- caps, traversal, unknown path, empty batch ---------------------------------------------------

test("oversize add_file → 4xx and NOTHING persisted", async () => {
  const { app } = await buildApp();
  const skill = await seedSkill(app, "zero-annotation");
  const vid = skill.currentVersionId;

  // A 6 MB add: the default 5 MB per-file cap would reject it, and Fastify's own body limit rejects
  // the oversized JSON body even sooner — either way it is a 4xx and NOTHING is persisted. (The
  // per-file/total/file-count cap logic itself is proven directly against applyTreeOps below, where
  // a tight cap can be exercised without tripping the transport's body limit first.)
  const huge = "a".repeat(6 * 1024 * 1024);
  const res = await postEdits(app, skill.id, vid, {
    baseTreeSha: await treeSha(app, skill.id, vid),
    ops: [{ op: "add_file", path: "references/huge.txt", content: huge }],
  });
  assert.ok(
    res.statusCode >= 400 && res.statusCode < 500,
    `oversize add is a 4xx (got ${res.statusCode})`,
  );

  const versions = (await app.inject({ url: `/api/skills/${skill.id}/versions` })).json();
  assert.equal(versions.length, 1, "no version persisted on an oversize add");
});

test("applyTreeOps enforces per-file, total, and file-count caps (typed 400)", () => {
  const base = [{ path: "SKILL.md", content: Buffer.from("# S\n") }]; // 4 bytes, 1 file

  // Per-file cap: a single 10-byte add over maxFileBytes=8 (count/total generous).
  assert.throws(
    () =>
      applyTreeOps(base, [{ op: "add_file", path: "a.txt", content: "0123456789" }], {
        maxFiles: 10,
        maxFileBytes: 8,
        maxTotalBytes: 1000,
      }),
    (err: Error & { statusCode?: number }) =>
      err.statusCode === 400 && /per-file/.test(err.message),
  );
  // Total cap: 4 + 3×7 = 25 bytes over maxTotalBytes=20 (count/per-file generous).
  assert.throws(
    () =>
      applyTreeOps(
        base,
        [
          { op: "add_file", path: "a.txt", content: "1234567" },
          { op: "add_file", path: "b.txt", content: "1234567" },
          { op: "add_file", path: "c.txt", content: "1234567" },
        ],
        { maxFiles: 10, maxFileBytes: 100, maxTotalBytes: 20 },
      ),
    (err: Error & { statusCode?: number }) =>
      err.statusCode === 400 && /total-size/.test(err.message),
  );
  // File-count cap: 1 + 3 = 4 files over maxFiles=3 (per-file/total generous).
  assert.throws(
    () =>
      applyTreeOps(
        base,
        [
          { op: "add_file", path: "a.txt", content: "x" },
          { op: "add_file", path: "b.txt", content: "x" },
          { op: "add_file", path: "c.txt", content: "x" },
        ],
        { maxFiles: 3, maxFileBytes: 100, maxTotalBytes: 1000 },
      ),
    (err: Error & { statusCode?: number }) => err.statusCode === 400 && /files/.test(err.message),
  );

  // A within-caps batch returns the new tree.
  const ok = applyTreeOps(base, [{ op: "add_file", path: "a.txt", content: "hi" }], {
    maxFiles: 10,
    maxFileBytes: 100,
    maxTotalBytes: 1000,
  });
  // Sorted by localeCompare (same ordering repository/computeTreeSha use), so "a.txt" precedes "SKILL.md".
  assert.deepEqual(
    ok.files.map((f) => f.path),
    ["a.txt", "SKILL.md"],
  );
});

test("path traversal → 400 (nothing persisted)", async () => {
  const { app } = await buildApp();
  const skill = await seedSkill(app, "zero-annotation");
  const vid = skill.currentVersionId;

  for (const bad of ["../evil.md", "/etc/passwd", "a\\b.md"]) {
    const res = await postEdits(app, skill.id, vid, {
      baseTreeSha: await treeSha(app, skill.id, vid),
      ops: [{ op: "add_file", path: bad, content: "x" }],
    });
    assert.equal(res.statusCode, 400, `"${bad}" must be refused`);
  }
  const versions = (await app.inject({ url: `/api/skills/${skill.id}/versions` })).json();
  assert.equal(versions.length, 1);
});

test("unknown path → 400 listing the valid paths", async () => {
  const { app } = await buildApp();
  const skill = await seedSkill(app, "zero-annotation");
  const vid = skill.currentVersionId;

  const res = await postEdits(app, skill.id, vid, {
    baseTreeSha: await treeSha(app, skill.id, vid),
    ops: [{ op: "update_file", path: "does/not/exist.md", content: "x" }],
  });
  assert.equal(res.statusCode, 400);
  const error = res.json().error as string;
  assert.match(error, /unknown path "does\/not\/exist\.md"/);
  assert.match(error, /valid paths: .*SKILL\.md/);
});

test("empty batch → { unchanged: true } and no new version", async () => {
  const { app } = await buildApp();
  const skill = await seedSkill(app, "zero-annotation");
  const vid = skill.currentVersionId;

  const res = await postEdits(app, skill.id, vid, {
    baseTreeSha: await treeSha(app, skill.id, vid),
    ops: [],
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { unchanged: true, warnings: [] });
  const versions = (await app.inject({ url: `/api/skills/${skill.id}/versions` })).json();
  assert.equal(versions.length, 1);
});

// --- conflicting file-op pair (delete + update same path) -----------------------------------------

test("conflicting file ops (delete + update on one path) → 400", async () => {
  const { app } = await buildApp();
  const skill = await seedSkill(app, "zero-annotation");
  const vid = skill.currentVersionId;

  const res = await postEdits(app, skill.id, vid, {
    baseTreeSha: await treeSha(app, skill.id, vid),
    ops: [
      { op: "delete_file", path: "scripts/validate.py" },
      { op: "update_file", path: "scripts/validate.py", content: "print(1)\n" },
    ],
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /conflicting file ops/i);
});

// --- diff endpoint labels add / remove / rename correctly (verify blob-sha rename detection) -------

test("the diff endpoint labels add/remove/rename in one batch (rename via blob sha)", async () => {
  const { app } = await buildApp();
  const skill = await seedSkill(app, "zero-annotation");
  const vid = skill.currentVersionId;

  const res = await postEdits(app, skill.id, vid, {
    baseTreeSha: await treeSha(app, skill.id, vid),
    ops: [
      { op: "add_file", path: "references/added.md", content: "Added.\n" },
      { op: "delete_file", path: "assets/template.html" },
      { op: "rename_file", from: "reference/format-spec.md", to: "reference/moved-spec.md" },
    ],
  });
  assert.equal(res.statusCode, 201, res.body);
  const newVid = res.json().version.id;

  const diff = (
    await app.inject({ url: `/api/skills/${skill.id}/diff?from=${vid}&to=${newVid}` })
  ).json();
  const status = (p: string) => diff.entries.find((e: { path: string }) => e.path === p)?.status;
  assert.equal(status("references/added.md"), "added");
  assert.equal(status("assets/template.html"), "removed");
  assert.equal(status("reference/moved-spec.md"), "renamed");
  assert.equal(diff.rollup.filesAdded, 1);
  assert.equal(diff.rollup.filesRemoved, 1);
  assert.equal(diff.rollup.filesRenamed, 1);
});
