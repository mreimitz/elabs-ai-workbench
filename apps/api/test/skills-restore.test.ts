import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { zipSync, type Zippable } from "fflate";
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

// Behavior lock for POST /api/skills/:id/versions/:vid/restore — "set the latest back to an older
// version" as a NON-destructive re-point: a NEW head version is created with the chosen version's
// exact content, and every in-between version is kept (nothing deleted, only the head pointer moves).

const apps: FastifyInstance[] = [];
const databases: AppDatabase[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const db of databases.splice(0)) db.close();
});

async function buildApp(): Promise<FastifyInstance> {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  databases.push(db);

  const repo = new SkillRepository(db, new SecretStore(Buffer.alloc(32, 7)));
  const dataDir = path.join(
    os.tmpdir(),
    `skills-restore-test-${Math.random().toString(36).slice(2)}`,
  );
  const ingest = new SkillIngestService(repo, { dataDir, tokenProfile: "generic_o200k" });
  const git = new SkillGitService(repo, { dataDir, tokenProfile: "generic_o200k" });
  const publish = new SkillPublishService(repo, { dataDir });

  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: "Validation failed" });
    const typed = error as Error & { statusCode?: number };
    return reply.code(typed.statusCode ?? 500).send({ error: toErrorMessage(error) });
  });
  await registerSkillRoutes(app, repo, ingest, git, publish);
  await app.ready();
  apps.push(app);
  return app;
}

const BOUNDARY = "----skillRestoreTestBoundary";

function multipart(file: { filename: string; content: Buffer; contentType?: string }): {
  payload: Buffer;
  headers: Record<string, string>;
} {
  const chunks: Buffer[] = [
    Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${file.filename}"\r\n` +
        `Content-Type: ${file.contentType ?? "application/zip"}\r\n\r\n`,
    ),
    file.content,
    Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
  ];
  return {
    payload: Buffer.concat(chunks),
    headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
  };
}

function zipOf(tree: Record<string, string>): Buffer {
  const zippable: Zippable = {};
  for (const [p, text] of Object.entries(tree)) {
    zippable[p] = new Uint8Array(Buffer.from(text, "utf8"));
  }
  return Buffer.from(zipSync(zippable));
}

async function upload(app: FastifyInstance, url: string, tree: Record<string, string>) {
  const { payload, headers } = multipart({ filename: "skill.zip", content: zipOf(tree) });
  return app.inject({ method: "POST", url, payload, headers });
}

const SKILL_MD_A =
  "---\nname: pdf-tools\ndescription: Version A description.\n---\n\n# PDF Tools\n\nBody A.";
const SKILL_MD_B =
  "---\nname: pdf-tools\ndescription: Version B description.\n---\n\n# PDF Tools\n\nBody B — changed.";

/** Create a skill and drive it to three versions: v1 (A), v2 (A + NEW.md), v3 (B). Returns ids. */
async function seedThreeVersions(app: FastifyInstance) {
  const created = (await upload(app, "/api/skills", { "SKILL.md": SKILL_MD_A })).json();
  const v1 = created.currentVersionId as string;

  const r2 = await upload(app, `/api/skills/${created.id}/versions`, {
    "SKILL.md": SKILL_MD_A,
    "references/NEW.md": "added in v2",
  });
  assert.equal(r2.statusCode, 201);
  const v2 = r2.json().id as string;

  const r3 = await upload(app, `/api/skills/${created.id}/versions`, { "SKILL.md": SKILL_MD_B });
  assert.equal(r3.statusCode, 201);
  const v3 = r3.json().id as string;

  return { skillId: created.id as string, v1, v2, v3 };
}

test("restore v1 → NEW head v4 with v1's content; in-between versions kept", async () => {
  const app = await buildApp();
  const { skillId, v1, v2, v3 } = await seedThreeVersions(app);

  const res = await app.inject({
    method: "POST",
    url: `/api/skills/${skillId}/versions/${v1}/restore`,
    payload: {},
  });
  assert.equal(res.statusCode, 201);
  const body = res.json();

  // A NEW version, seq one past the highest — not a mutation of v1.
  assert.equal(body.version.seq, 4);
  assert.notEqual(body.version.id, v1);
  assert.equal(body.version.sourceRef, "restore");
  assert.equal(body.version.note, "Restored from v1");

  // The head pointer moved forward to the new version.
  const skill = (await app.inject({ url: `/api/skills/${skillId}` })).json();
  assert.equal(skill.currentVersionId, body.version.id);

  // Nothing was deleted — v1, v2, v3 all still present alongside the new v4.
  const versions = (await app.inject({ url: `/api/skills/${skillId}/versions` })).json();
  assert.deepEqual(
    versions.map((v: { seq: number }) => v.seq).sort((a: number, b: number) => a - b),
    [1, 2, 3, 4],
  );
  const ids = new Set(versions.map((v: { id: string }) => v.id));
  for (const id of [v1, v2, v3]) assert.ok(ids.has(id), "in-between version preserved");

  // v4's tree matches v1's: SKILL.md is Body A and NEW.md (added in v2) is gone again.
  const files = (
    await app.inject({ url: `/api/skills/${skillId}/versions/${body.version.id}/files` })
  ).json();
  assert.deepEqual(
    files.map((f: { path: string }) => f.path).sort(),
    ["SKILL.md"],
  );
  const skillMd = (
    await app.inject({
      url: `/api/skills/${skillId}/versions/${body.version.id}/file?path=SKILL.md`,
    })
  ).json();
  assert.match(skillMd.text, /Body A\./);

  // The diff rides along and is anchored to the PREVIOUS head (v3), not v1 (which is identical).
  assert.ok(body.diff, "diff vs previous head returned");
});

test("restoring the CURRENT head → { unchanged: true }, no new version", async () => {
  const app = await buildApp();
  const { skillId, v3 } = await seedThreeVersions(app);

  const res = await app.inject({
    method: "POST",
    url: `/api/skills/${skillId}/versions/${v3}/restore`,
    payload: {},
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { unchanged: true });

  const versions = (await app.inject({ url: `/api/skills/${skillId}/versions` })).json();
  assert.equal(versions.length, 3, "no version created for a no-op restore");
});

test("restore accepts a note override", async () => {
  const app = await buildApp();
  const { skillId, v1 } = await seedThreeVersions(app);

  const res = await app.inject({
    method: "POST",
    url: `/api/skills/${skillId}/versions/${v1}/restore`,
    payload: { note: "manual rollback after regression" },
  });
  assert.equal(res.statusCode, 201);
  assert.equal(res.json().version.note, "manual rollback after regression");
});

test("restore is 404 for an unknown skill / version, or a version of another skill", async () => {
  const app = await buildApp();
  const { skillId, v1 } = await seedThreeVersions(app);

  // Unknown skill.
  const noSkill = await app.inject({
    method: "POST",
    url: `/api/skills/does-not-exist/versions/${v1}/restore`,
    payload: {},
  });
  assert.equal(noSkill.statusCode, 404);

  // Unknown version.
  const noVersion = await app.inject({
    method: "POST",
    url: `/api/skills/${skillId}/versions/nope/restore`,
    payload: {},
  });
  assert.equal(noVersion.statusCode, 404);

  // A version id that belongs to a DIFFERENT skill.
  const other = (await upload(app, "/api/skills", { "SKILL.md": SKILL_MD_B })).json();
  const crossed = await app.inject({
    method: "POST",
    url: `/api/skills/${skillId}/versions/${other.currentVersionId}/restore`,
    payload: {},
  });
  assert.equal(crossed.statusCode, 404);
});
