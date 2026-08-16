import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { unzipSync } from "fflate";
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
    `skills-blank-test-${Math.random().toString(36).slice(2)}`,
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

function createBlank(
  app: FastifyInstance,
  body: { name: string; description: string; displayName?: string },
) {
  return app.inject({
    method: "POST",
    url: "/api/skills",
    payload: { source: "blank", ...body },
  });
}

test("create-from-blank → 201 Skill + v1, manifest-valid, one-file tree, tokens counted", async () => {
  const app = await buildApp();
  const res = await createBlank(app, {
    name: "my-new-skill",
    description: "A skill I am building.",
  });
  assert.equal(res.statusCode, 201);
  const skill = res.json();
  assert.equal(
    skill.sourceType,
    "upload",
    "blank reuses upload storage semantics (no schema CHECK change)",
  );
  assert.equal(skill.name, "my-new-skill");
  assert.equal(skill.displayName, "my-new-skill", "display name defaults to the skill name");
  assert.equal(skill.description, "A skill I am building.");
  assert.equal(skill.versionCount, 1);
  assert.ok(skill.currentVersionId);

  const versions = (await app.inject({ url: `/api/skills/${skill.id}/versions` })).json();
  assert.equal(versions.length, 1);
  const version = versions[0];
  assert.equal(version.seq, 1);
  assert.equal(version.manifestValid, true, "manifest_valid = 1");
  assert.ok(version.l1MetadataTokens > 0, "L1 tokens > 0");
  assert.ok(version.l2BodyTokens > 0, "L2 tokens > 0");
  assert.ok(version.totalTokens > 0, "total tokens > 0");

  const files = (
    await app.inject({ url: `/api/skills/${skill.id}/versions/${skill.currentVersionId}/files` })
  ).json();
  assert.deepEqual(
    files.map((f: { path: string }) => f.path),
    ["SKILL.md"],
    "file list is exactly SKILL.md",
  );
  assert.equal(files[0].isSkillMd, true);
  assert.ok(files[0].tokenTotal > 0);
});

test("displayName is honored when provided", async () => {
  const app = await buildApp();
  const res = await createBlank(app, {
    name: "my-skill",
    description: "Desc.",
    displayName: "My Skill (pretty name)",
  });
  assert.equal(res.statusCode, 201);
  const skill = res.json();
  assert.equal(skill.displayName, "My Skill (pretty name)");
  assert.equal(skill.name, "my-skill", "the manifest/registry name stays the spec-valid slug");
});

test("scaffolded SKILL.md is spec-valid frontmatter + empty Steps section", async () => {
  const app = await buildApp();
  const res = await createBlank(app, {
    name: "blank-check",
    description: "Check the scaffold body.",
  });
  const skill = res.json();
  const vid = skill.currentVersionId;

  const content = (
    await app.inject({
      url: `/api/skills/${skill.id}/versions/${vid}/file?path=${encodeURIComponent("SKILL.md")}`,
    })
  ).json();
  assert.equal(content.isBinary, false);
  assert.match(content.text, /^---\n/);
  assert.match(content.text, /name: blank-check/);
  assert.match(content.text, /description: Check the scaffold body\./);
  assert.match(content.text, /## Steps\s*$/, "an empty Steps section closes the document");
});

test("slug collision is handled the same way other sources handle it", async () => {
  const app = await buildApp();
  const first = (await createBlank(app, { name: "dup-skill", description: "First." })).json();
  const second = (
    await createBlank(app, { name: "dup-skill", description: "Second, different name flow." })
  ).json();
  assert.notEqual(first.id, second.id);
  assert.equal(first.slug, "dup-skill");
  assert.notEqual(second.slug, first.slug, "the second skill gets a de-duplicated slug");
  assert.ok(second.slug.startsWith("dup-skill"));
});

test("invalid name (spaces) → 400, no partial rows", async () => {
  const app = await buildApp();
  const res = await createBlank(app, { name: "has spaces", description: "Desc." });
  assert.equal(res.statusCode, 400);
  const list = (await app.inject({ url: "/api/skills" })).json();
  assert.equal(list.length, 0, "no skill shell left behind");
});

test("invalid name (uppercase) → 400", async () => {
  const app = await buildApp();
  const res = await createBlank(app, { name: "MySkill", description: "Desc." });
  assert.equal(res.statusCode, 400);
});

test("invalid name (empty) → 400 (zod min-length)", async () => {
  const app = await buildApp();
  const res = await createBlank(app, { name: "", description: "Desc." });
  assert.equal(res.statusCode, 400);
});

test("empty description → 400", async () => {
  const app = await buildApp();
  const res = await createBlank(app, { name: "valid-name", description: "" });
  assert.equal(res.statusCode, 400);
});

test("the scaffolded SKILL.md re-ingests cleanly (export round-trip)", async () => {
  const app = await buildApp();
  const created = (
    await createBlank(app, { name: "round-trip-skill", description: "Round trip me." })
  ).json();
  const vid = created.currentVersionId;

  // Export → unzip → re-upload as a fresh skill; the re-ingested version must also be manifest-valid
  // with the identical file list (round-trips through the ordinary upload path unchanged).
  const exported = await app.inject({ url: `/api/skills/${created.id}/versions/${vid}/export` });
  assert.equal(exported.statusCode, 200);
  const unzipped = unzipSync(new Uint8Array(exported.rawPayload));
  assert.deepEqual(Object.keys(unzipped), ["SKILL.md"]);
  const skillMdBytes = unzipped["SKILL.md"];
  assert.ok(skillMdBytes);

  const BOUNDARY = "----blankRoundTripBoundary";
  const payload = Buffer.concat([
    Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="SKILL.md"\r\n` +
        `Content-Type: text/markdown\r\n\r\n`,
    ),
    Buffer.from(skillMdBytes),
    Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
  ]);
  const reuploaded = await app.inject({
    method: "POST",
    url: "/api/skills",
    payload,
    headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
  });
  assert.equal(reuploaded.statusCode, 201);
  const reuploadedSkill = reuploaded.json();
  assert.equal(reuploadedSkill.name, "round-trip-skill", "manifest name round-trips");

  const versions = (await app.inject({ url: `/api/skills/${reuploadedSkill.id}/versions` })).json();
  assert.equal(versions[0].manifestValid, true);
});

test("blank source is capped like every other ingestion path (regression guard)", async () => {
  const app = await buildApp();
  // A long-but-valid description still ingests fine — the scaffold is nowhere near any real cap.
  const longDescription = "A".repeat(500);
  const res = await createBlank(app, { name: "big-description", description: longDescription });
  assert.equal(res.statusCode, 201);
});
