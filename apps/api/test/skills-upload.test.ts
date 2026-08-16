import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { unzipSync, zipSync, type Zippable } from "fflate";
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
    `skills-upload-test-${Math.random().toString(36).slice(2)}`,
  );
  const ingest = new SkillIngestService(repo, {
    dataDir,
    tokenProfile: "generic_o200k",
    // Tighten caps so the oversized/too-many-files cases are cheap to exercise.
    caps: { maxFiles: 5, maxFileBytes: 1024, maxTotalBytes: 4096 },
  });
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

const BOUNDARY = "----skillUploadTestBoundary";

/** Build a multipart/form-data body with one file part (+ optional fields). */
function multipart(
  file: { filename: string; content: Buffer; contentType?: string },
  fields: Record<string, string> = {},
): { payload: Buffer; headers: Record<string, string> } {
  const chunks: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(
      Buffer.from(
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  chunks.push(
    Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${file.filename}"\r\n` +
        `Content-Type: ${file.contentType ?? "application/octet-stream"}\r\n\r\n`,
    ),
  );
  chunks.push(file.content);
  chunks.push(Buffer.from(`\r\n--${BOUNDARY}--\r\n`));
  const payload = Buffer.concat(chunks);
  return {
    payload,
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

const SKILL_MD =
  "---\nname: pdf-tools\ndescription: Work with PDF files.\n---\n\n# PDF Tools\n\nBody text.";

async function upload(
  app: FastifyInstance,
  url: string,
  file: { filename: string; content: Buffer; contentType?: string },
  fields: Record<string, string> = {},
) {
  const { payload, headers } = multipart(file, fields);
  return app.inject({ method: "POST", url, payload, headers });
}

test("create-from-zip → 201 Skill + v1", async () => {
  const app = await buildApp();
  const res = await upload(app, "/api/skills", {
    filename: "pdf-tools.zip",
    content: zipOf({ "SKILL.md": SKILL_MD, "references/API.md": "reference doc" }),
    contentType: "application/zip",
  });
  assert.equal(res.statusCode, 201);
  const skill = res.json();
  assert.equal(skill.sourceType, "upload");
  assert.equal(skill.versionCount, 1);
  assert.ok(skill.currentVersionId);
  assert.equal(skill.description, "Work with PDF files.");

  const versions = (await app.inject({ url: `/api/skills/${skill.id}/versions` })).json();
  assert.equal(versions.length, 1);
  assert.equal(versions[0].seq, 1);
  assert.equal(versions[0].manifestValid, true);
  assert.ok(versions[0].l1MetadataTokens > 0, "L1 tokens backfilled");
  assert.ok(versions[0].l2BodyTokens > 0, "L2 tokens backfilled");
  assert.ok(versions[0].l3ResourceTokens > 0, "L3 tokens backfilled");
});

test("skill name comes from the SKILL.md manifest, not the upload filename", async () => {
  const app = await buildApp();
  const res = await upload(app, "/api/skills", {
    // Filename deliberately differs from the manifest `name: pdf-tools`.
    filename: "upload-2026-07-01.zip",
    content: zipOf({ "SKILL.md": SKILL_MD }),
    contentType: "application/zip",
  });
  assert.equal(res.statusCode, 201);
  const skill = res.json();
  assert.equal(skill.name, "pdf-tools", "canonical name is the manifest name");
  assert.equal(skill.displayName, "pdf-tools", "display name defaults to the manifest name");
  assert.ok(
    !skill.slug.startsWith("upload-2026"),
    "slug follows the manifest name, not the filename",
  );
});

test("lone SKILL.md upload → one-file skill", async () => {
  const app = await buildApp();
  const res = await upload(app, "/api/skills", {
    filename: "SKILL.md",
    content: Buffer.from(SKILL_MD, "utf8"),
    contentType: "text/markdown",
  });
  assert.equal(res.statusCode, 201);
  const skill = res.json();
  const files = (
    await app.inject({ url: `/api/skills/${skill.id}/versions/${skill.currentVersionId}/files` })
  ).json();
  assert.deepEqual(
    files.map((f: { path: string }) => f.path),
    ["SKILL.md"],
  );
  assert.equal(files[0].isSkillMd, true);
});

test("identical re-upload → { unchanged: true }; changed → v2", async () => {
  const app = await buildApp();
  const created = (
    await upload(app, "/api/skills", {
      filename: "pdf-tools.zip",
      content: zipOf({ "SKILL.md": SKILL_MD }),
      contentType: "application/zip",
    })
  ).json();

  const same = await upload(app, `/api/skills/${created.id}/versions`, {
    filename: "pdf-tools.zip",
    content: zipOf({ "SKILL.md": SKILL_MD }),
    contentType: "application/zip",
  });
  assert.equal(same.statusCode, 200);
  assert.deepEqual(same.json(), { unchanged: true });

  const changed = await upload(app, `/api/skills/${created.id}/versions`, {
    filename: "pdf-tools.zip",
    content: zipOf({ "SKILL.md": SKILL_MD, "references/NEW.md": "new content" }),
    contentType: "application/zip",
  });
  assert.equal(changed.statusCode, 201);
  assert.equal(changed.json().seq, 2);

  const versions = (await app.inject({ url: `/api/skills/${created.id}/versions` })).json();
  assert.equal(versions.length, 2);
});

test("nested-one-level SKILL.md is rebased to the root", async () => {
  const app = await buildApp();
  const res = await upload(app, "/api/skills", {
    filename: "pack.zip",
    content: zipOf({ "pdf-tools/SKILL.md": SKILL_MD, "pdf-tools/references/API.md": "ref" }),
    contentType: "application/zip",
  });
  assert.equal(res.statusCode, 201);
  const skill = res.json();
  const files = (
    await app.inject({ url: `/api/skills/${skill.id}/versions/${skill.currentVersionId}/files` })
  ).json();
  assert.deepEqual(files.map((f: { path: string }) => f.path).sort(), [
    "SKILL.md",
    "references/API.md",
  ]);
});

test("no SKILL.md → 400, no partial rows", async () => {
  const app = await buildApp();
  const res = await upload(app, "/api/skills", {
    filename: "junk.zip",
    content: zipOf({ "README.md": "hi" }),
    contentType: "application/zip",
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /SKILL\.md/);
  const list = (await app.inject({ url: "/api/skills" })).json();
  assert.equal(list.length, 0, "no skill shell left behind");
});

test("multi-skill archive → 400", async () => {
  const app = await buildApp();
  const res = await upload(app, "/api/skills", {
    filename: "multi.zip",
    content: zipOf({ "a/SKILL.md": SKILL_MD, "b/SKILL.md": SKILL_MD }),
    contentType: "application/zip",
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /one skill per archive/);
});

test("too many files → 400", async () => {
  const app = await buildApp();
  const tree: Record<string, string> = { "SKILL.md": SKILL_MD };
  for (let i = 0; i < 10; i += 1) tree[`references/f${i}.md`] = "x";
  const res = await upload(app, "/api/skills", {
    filename: "big.zip",
    content: zipOf(tree),
    contentType: "application/zip",
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /files/);
});

test("oversized total → 400", async () => {
  const app = await buildApp();
  // Four 1020-byte files (each under the 1024 per-file cap) sum to > the 4096 total cap.
  const big = "y".repeat(1020);
  const res = await upload(app, "/api/skills", {
    filename: "big.zip",
    content: zipOf({ "SKILL.md": SKILL_MD, "a.md": big, "b.md": big, "c.md": big, "d.md": big }),
    contentType: "application/zip",
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /limit/);
});

test("files list + file content (text) + export round-trip", async () => {
  const app = await buildApp();
  const tree = {
    "SKILL.md": SKILL_MD,
    "references/API.md": "reference doc",
    "scripts/run.sh": "echo hi",
  };
  const created = (
    await upload(app, "/api/skills", {
      filename: "pdf-tools.zip",
      content: zipOf(tree),
      contentType: "application/zip",
    })
  ).json();
  const vid = created.currentVersionId;

  // Files list carries kind + token totals.
  const files = (
    await app.inject({ url: `/api/skills/${created.id}/versions/${vid}/files` })
  ).json();
  const byPath = new Map(files.map((f: { path: string }) => [f.path, f]));
  assert.equal((byPath.get("SKILL.md") as { kind: string }).kind, "skill_md");
  assert.equal((byPath.get("references/API.md") as { kind: string }).kind, "reference");
  assert.equal((byPath.get("scripts/run.sh") as { kind: string }).kind, "script");

  // Text file content.
  const content = (
    await app.inject({
      url: `/api/skills/${created.id}/versions/${vid}/file?path=${encodeURIComponent("references/API.md")}`,
    })
  ).json();
  assert.equal(content.isBinary, false);
  assert.equal(content.text, "reference doc");

  // Export round-trips: unzipping the exported zip reproduces the exact tree.
  const exported = await app.inject({ url: `/api/skills/${created.id}/versions/${vid}/export` });
  assert.equal(exported.statusCode, 200);
  assert.equal(exported.headers["content-type"], "application/zip");
  const roundTripped = unzipSync(new Uint8Array(exported.rawPayload));
  const decoded: Record<string, string> = {};
  for (const [p, bytes] of Object.entries(roundTripped)) {
    decoded[p] = Buffer.from(bytes).toString("utf8");
  }
  assert.deepEqual(decoded, tree);
});

test("binary file content returns a downloadPath + raw bytes round-trip", async () => {
  const app = await buildApp();
  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0x03]);
  const zippable: Zippable = {
    "SKILL.md": new Uint8Array(Buffer.from(SKILL_MD, "utf8")),
    "assets/logo.png": new Uint8Array(pngBytes),
  };
  const created = (
    await upload(app, "/api/skills", {
      filename: "pdf-tools.zip",
      content: Buffer.from(zipSync(zippable)),
      contentType: "application/zip",
    })
  ).json();
  const vid = created.currentVersionId;

  const content = (
    await app.inject({
      url: `/api/skills/${created.id}/versions/${vid}/file?path=${encodeURIComponent("assets/logo.png")}`,
    })
  ).json();
  assert.equal(content.isBinary, true);
  assert.equal(
    content.downloadPath,
    `/api/skills/${created.id}/versions/${vid}/raw?path=assets%2Flogo.png`,
  );

  const raw = await app.inject({
    url: `/api/skills/${created.id}/versions/${vid}/raw?path=${encodeURIComponent("assets/logo.png")}`,
  });
  assert.equal(raw.statusCode, 200);
  assert.ok(Buffer.from(raw.rawPayload).equals(pngBytes));
});

test("POST /api/skills github branch validates the JSON body (bad url → 400)", async () => {
  const app = await buildApp();
  // WP 1.4 replaced the 501 stub with real github handling; an invalid body fails zod validation
  // before any clone is attempted (full github import is covered in skills-github.test.ts).
  const res = await app.inject({
    method: "POST",
    url: "/api/skills",
    payload: { source: "github", repoUrl: "not-a-url" },
  });
  assert.equal(res.statusCode, 400);
});

test("get/update/delete a skill", async () => {
  const app = await buildApp();
  const created = (
    await upload(app, "/api/skills", {
      filename: "pdf-tools.zip",
      content: zipOf({ "SKILL.md": SKILL_MD }),
      contentType: "application/zip",
    })
  ).json();

  const updated = (
    await app.inject({
      method: "PUT",
      url: `/api/skills/${created.id}`,
      payload: { displayName: "PDF Tools Renamed" },
    })
  ).json();
  assert.equal(updated.displayName, "PDF Tools Renamed");

  const del = await app.inject({ method: "DELETE", url: `/api/skills/${created.id}` });
  assert.equal(del.statusCode, 204);
  const list = (await app.inject({ url: "/api/skills" })).json();
  assert.equal(list.length, 0);
});
