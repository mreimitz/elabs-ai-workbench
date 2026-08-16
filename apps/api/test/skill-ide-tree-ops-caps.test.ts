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
import type { IngestCaps } from "../src/skills/caps.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { registerSkillflowRoutes } from "../src/skillflow/routes.js";
import { SkillGitService } from "../src/skills/git-service.js";
import { SkillIngestService } from "../src/skills/ingest-service.js";
import { SkillRepository } from "../src/skills/repository.js";
import { registerSkillRoutes } from "../src/skills/routes.js";
import { RunRepository } from "../src/testing/run-repository.js";
import { toErrorMessage } from "../src/utils/errors.js";

// Skill IDE WP 3.2 — env-cap wiring (closes the 3.1 review finding that the edits route hardcoded
// DEFAULT_INGEST_CAPS). `registerSkillflowRoutes` now takes an optional `caps`; `index.ts` threads the
// env-configurable `skillCaps` (config.skillMax*). These tests prove that a LOW cap passed to the
// route actually caps a tree op through POST /api/skills/:id/versions/:vid/edits — and that the
// default (no caps arg) still admits the same op.

const here = path.dirname(fileURLToPath(import.meta.url));
const skillsDir = path.join(here, "fixtures/skillflow/skills");

const apps: FastifyInstance[] = [];
const databases: AppDatabase[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const db of databases.splice(0)) db.close();
});

// Build an app wiring the skillflow routes with a specific `caps` (undefined ⇒ the route default).
async function buildApp(
  caps?: IngestCaps,
): Promise<{ app: FastifyInstance; repo: SkillRepository }> {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  databases.push(db);

  const repo = new SkillRepository(db, new SecretStore(Buffer.alloc(32, 7)));
  const dataDir = path.join(os.tmpdir(), `skill-ide-caps-${Math.random().toString(36).slice(2)}`);
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
  // The unit under test: the route accepts (and applies) an injected caps object.
  await registerSkillflowRoutes(app, repo, runs, caps);
  await app.ready();
  apps.push(app);
  return { app, repo };
}

const BOUNDARY = "----skillIdeTreeOpsCapsBoundary";

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

// A tight per-file cap (8 bytes) that a normal file add would exceed. maxFiles/maxTotalBytes are
// generous so ONLY the per-file cap can trip — proving the injected caps object is what the route uses.
const TIGHT_PER_FILE: IngestCaps = { maxFiles: 1000, maxFileBytes: 8, maxTotalBytes: 50_000_000 };

test("env override: a low SKILL_MAX_FILE_BYTES caps an add_file through the edits route (400)", async () => {
  const { app } = await buildApp(TIGHT_PER_FILE);
  const skill = await seedSkill(app, "zero-annotation");
  const vid = skill.currentVersionId;

  // 10 bytes > the 8-byte per-file cap → the tree engine throws a typed 400 through the edits route.
  const res = await postEdits(app, skill.id, vid, {
    baseTreeSha: await treeSha(app, skill.id, vid),
    ops: [{ op: "add_file", path: "references/note.md", content: "0123456789" }],
  });
  assert.equal(res.statusCode, 400, res.body);
  assert.match(res.json().error as string, /per-file/i);

  // NOTHING persisted — the cap breach is caught before createVersion.
  const versions = (await app.inject({ url: `/api/skills/${skill.id}/versions` })).json();
  assert.equal(versions.length, 1, "no version persisted when the injected cap rejects the add");
});

test("env override: a low SKILL_MAX_FILES caps a batch that adds too many files (400)", async () => {
  // maxFiles=1 (the seeded tree already has >1 file) → any add pushes the tree over the count cap.
  const { app } = await buildApp({
    maxFiles: 1,
    maxFileBytes: 50_000_000,
    maxTotalBytes: 50_000_000,
  });
  const skill = await seedSkill(app, "zero-annotation");
  const vid = skill.currentVersionId;

  const res = await postEdits(app, skill.id, vid, {
    baseTreeSha: await treeSha(app, skill.id, vid),
    ops: [{ op: "add_file", path: "references/a.md", content: "hi" }],
  });
  assert.equal(res.statusCode, 400, res.body);
  assert.match(res.json().error as string, /files/i);
});

test("the SAME add_file succeeds under the route's DEFAULT caps (no caps arg wired)", async () => {
  // Regression guard: the default value keeps the route permissive when index.ts doesn't override —
  // the identical op the tight cap rejected above is accepted here and persisted as v2.
  const { app } = await buildApp();
  const skill = await seedSkill(app, "zero-annotation");
  const vid = skill.currentVersionId;

  const res = await postEdits(app, skill.id, vid, {
    baseTreeSha: await treeSha(app, skill.id, vid),
    ops: [{ op: "add_file", path: "references/note.md", content: "0123456789" }],
  });
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(res.json().version.seq, 2);
});
