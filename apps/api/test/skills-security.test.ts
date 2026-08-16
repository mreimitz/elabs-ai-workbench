import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { zipSync, type Zippable } from "fflate";
import { ZodError } from "zod";
import {
  githubImportSchema,
  isBlockedIp,
  skillRepoProbeSchema,
  skillUpdateSchema,
} from "@mcp-token-footprint/shared";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { SkillGitService } from "../src/skills/git-service.js";
import { SkillPublishService } from "../src/skills/publish-service.js";
import { SkillIngestService, type IngestCaps } from "../src/skills/ingest-service.js";
import { SkillRepository } from "../src/skills/repository.js";
import { registerSkillRoutes } from "../src/skills/routes.js";
import { toErrorMessage } from "../src/utils/errors.js";

const apps: FastifyInstance[] = [];
const databases: AppDatabase[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const db of databases.splice(0)) db.close();
});

/** Tight caps keep the zip-bomb / oversized cases cheap to exercise. */
const TIGHT_CAPS: IngestCaps = { maxFiles: 5, maxFileBytes: 1024, maxTotalBytes: 4096 };

async function buildApp(caps: IngestCaps = TIGHT_CAPS): Promise<FastifyInstance> {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  databases.push(db);

  const repo = new SkillRepository(db, new SecretStore(Buffer.alloc(32, 7)));
  const dataDir = path.join(
    os.tmpdir(),
    `skills-security-test-${Math.random().toString(36).slice(2)}`,
  );
  const ingest = new SkillIngestService(repo, { dataDir, tokenProfile: "generic_o200k", caps });
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

const BOUNDARY = "----skillSecurityTestBoundary";

function multipart(file: { filename: string; content: Buffer; contentType?: string }): {
  payload: Buffer;
  headers: Record<string, string>;
} {
  const chunks: Buffer[] = [];
  chunks.push(
    Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${file.filename}"\r\n` +
        `Content-Type: ${file.contentType ?? "application/octet-stream"}\r\n\r\n`,
    ),
  );
  chunks.push(file.content);
  chunks.push(Buffer.from(`\r\n--${BOUNDARY}--\r\n`));
  return {
    payload: Buffer.concat(chunks),
    headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
  };
}

/** Zip a tree of raw byte entries (so we can craft high-compression + traversal entries). */
function zipBytes(tree: Record<string, Uint8Array>): Buffer {
  const zippable: Zippable = {};
  for (const [p, bytes] of Object.entries(tree)) zippable[p] = bytes;
  return Buffer.from(zipSync(zippable));
}

const SKILL_MD =
  "---\nname: pdf-tools\ndescription: Work with PDF files.\n---\n\n# PDF Tools\n\nBody text.";
const enc = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, "utf8"));

async function uploadZip(app: FastifyInstance, content: Buffer, url = "/api/skills") {
  const { payload, headers } = multipart({
    filename: "skill.zip",
    content,
    contentType: "application/zip",
  });
  return app.inject({ method: "POST", url, payload, headers });
}

// (a) A crafted high-compression-ratio zip whose inflated size blows past the total cap is rejected
//     — streaming enforcement aborts before the whole archive is inflated into memory.
test("zip bomb: tiny compressed archive that inflates past the total cap → 400", async () => {
  const app = await buildApp();
  // Four 1020-byte all-zero files (+ SKILL.md) stay within the 1024 per-file and 5-file caps, but
  // sum past the 4096 total cap. All-zeros compress ~1000:1 so the compressed archive is a few
  // hundred bytes — proving the total cap is enforced during streaming, not after full inflation.
  const tree: Record<string, Uint8Array> = { "SKILL.md": enc(SKILL_MD) };
  for (let i = 0; i < 4; i += 1) tree[`filler-${i}.bin`] = new Uint8Array(1020); // zero-filled
  const content = zipBytes(tree);
  assert.ok(
    content.byteLength < 4096,
    "the compressed bomb is smaller than the total cap it busts",
  );

  const res = await uploadZip(app, content);
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /limit \(zip-bomb guard\)/);

  const list = (await app.inject({ url: "/api/skills" })).json();
  assert.equal(list.length, 0, "no skill shell left behind after a rejected bomb");
});

// (a2) F2 — a zip bomb hidden entirely in an IGNORED path (`.git/…`) still trips the caps. Before the
//      fix, ignored entries were inflated through `file.start()` but their bytes were never counted, so
//      a bomb in `.git/` / `__MACOSX/` slipped straight past the total cap.
test("F2: a zip bomb hidden in an IGNORED path (.git/…) still trips the total cap", async () => {
  const app = await buildApp();
  // Only ignored entries carry the bomb: five 1020-byte zero files under `.git/` — each within the
  // 1024 per-file cap, summing to 5100 > the 4096 total cap. All-zeros compress ~1000:1, so the
  // archive is a few hundred bytes — the total cap must be enforced DURING streaming, on ignored
  // entries too, not after full inflation.
  const tree: Record<string, Uint8Array> = { "SKILL.md": enc(SKILL_MD) };
  for (let i = 0; i < 5; i += 1) tree[`.git/objects/pack-${i}.bin`] = new Uint8Array(1020);
  const content = zipBytes(tree);
  assert.ok(
    content.byteLength < 4096,
    "the compressed bomb is smaller than the total cap it busts",
  );

  const res = await uploadZip(app, content);
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /limit \(zip-bomb guard\)/);

  const list = (await app.inject({ url: "/api/skills" })).json();
  assert.equal(list.length, 0, "no skill shell left behind after a rejected ignored-path bomb");
});

// (b) An entry that escapes the skill root via `..` is rejected.
test("path traversal: a ../evil.md zip entry → 400", async () => {
  const app = await buildApp();
  const content = zipBytes({ "SKILL.md": enc(SKILL_MD), "../evil.md": enc("pwned") });
  const res = await uploadZip(app, content);
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /Unsafe path|traversal/i);
});

test("path traversal: an absolute /etc/evil.md zip entry → 400", async () => {
  const app = await buildApp();
  const content = zipBytes({ "SKILL.md": enc(SKILL_MD), "/etc/evil.md": enc("pwned") });
  const res = await uploadZip(app, content);
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /Unsafe path|absolute/i);
});

// (c) SSRF: dangerous repo URLs are rejected by the shared schema (before any git clone).
test("SSRF: file:// and internal-host repo URLs are rejected by the repo-URL schemas", async () => {
  for (const schema of [skillRepoProbeSchema, githubImportSchema]) {
    const wrap = (repoUrl: string) =>
      schema === githubImportSchema ? { source: "github", repoUrl } : { repoUrl };

    assert.equal(schema.safeParse(wrap("file:///etc/passwd")).success, false, "file:// rejected");
    assert.equal(
      schema.safeParse(wrap("http://169.254.169.254/latest/meta-data/")).success,
      false,
      "link-local metadata host rejected",
    );
    assert.equal(
      schema.safeParse(wrap("http://localhost:8080/x.git")).success,
      false,
      "http+localhost rejected",
    );
    assert.equal(
      schema.safeParse(wrap("https://127.0.0.1/x.git")).success,
      false,
      "https loopback rejected",
    );
    assert.equal(
      schema.safeParse(wrap("ssh://git@example.com/x.git")).success,
      false,
      "ssh:// rejected",
    );
    assert.equal(
      schema.safeParse(wrap("git://example.com/x.git")).success,
      false,
      "git:// rejected",
    );
    assert.equal(
      schema.safeParse(wrap("https://10.1.2.3/x.git")).success,
      false,
      "private 10/8 rejected",
    );
    assert.equal(
      schema.safeParse(wrap("https://[::1]/x.git")).success,
      false,
      "ipv6 loopback rejected",
    );
    // A normal public https repo still passes.
    assert.equal(
      schema.safeParse(wrap("https://github.com/acme/skills.git")).success,
      true,
      "public https ok",
    );
  }
});

// (b2) M2 — path traversal via `subpath`: a `..`-bearing or absolute subpath is rejected by the
//      shared schema (before any git clone), on BOTH the import (`githubImportSchema`) and the update
//      (`skillUpdateSchema`) bodies. A normal, safe subpath still validates.
test("M2: a ../ or absolute subpath is rejected by the GitHub import/update schemas", async () => {
  const unsafe = [
    "../../../../etc",
    "../evil",
    "a/../../b",
    "/etc/passwd",
    "\\etc\\passwd",
    "C:\\Windows",
  ];
  for (const subpath of unsafe) {
    assert.equal(
      githubImportSchema.safeParse({ source: "github", repoUrl: "https://github.com/a/b", subpath })
        .success,
      false,
      `githubImportSchema should reject subpath "${subpath}"`,
    );
    assert.equal(
      skillUpdateSchema.safeParse({ github: { subpath } }).success,
      false,
      `skillUpdateSchema should reject subpath "${subpath}"`,
    );
  }

  // A normal, safe, nested subpath still validates on both schemas.
  for (const subpath of ["", "skills/pdf-tools", "a/b/c"]) {
    assert.equal(
      githubImportSchema.safeParse({ source: "github", repoUrl: "https://github.com/a/b", subpath })
        .success,
      true,
      `githubImportSchema should accept subpath "${subpath}"`,
    );
    assert.equal(
      skillUpdateSchema.safeParse({ github: { subpath } }).success,
      true,
      `skillUpdateSchema should accept subpath "${subpath}"`,
    );
  }
});

// (c2) F1 — the shared `isBlockedIp` range helper (backs BOTH the literal-host schema guard and the
//      git-service's post-DNS-resolution guard). Unit-tested directly (the integration path resolves
//      DNS, which is exercised below via an injected resolver).
test("F1: isBlockedIp flags loopback / private / link-local / ULA / mapped, passes public", () => {
  for (const blocked of [
    "127.0.0.1",
    "127.5.5.5",
    "10.0.0.5",
    "192.168.1.1",
    "172.16.0.1",
    "172.31.255.255",
    "169.254.169.254", // cloud metadata endpoint
    "0.0.0.0",
    "::1",
    "::",
    "fe80::1",
    "fc00::1",
    "fd12:3456::1",
    "::ffff:127.0.0.1", // IPv4-mapped loopback
    "::ffff:10.0.0.1", // IPv4-mapped private
  ]) {
    assert.equal(isBlockedIp(blocked), true, `${blocked} should be blocked`);
  }
  for (const ok of ["8.8.8.8", "1.1.1.1", "140.82.112.3", "2606:4700::1111", "172.32.0.1"]) {
    assert.equal(isBlockedIp(ok), false, `${ok} should pass`);
  }
});

// (c3) F1 — SSRF via DNS: a PUBLIC hostname that RESOLVES to a private/loopback IP is rejected before
//      the clone / ls-remote. Uses an INJECTED resolver (mocking `node:dns` in ESM is fiddly) so the
//      guard is exercised deterministically without touching real DNS. Residual TOCTOU/rebinding
//      (git re-resolves independently) is acknowledged in `git-service.ts`; this closes the practical case.
test("F1: a public host that resolves to a private IP is rejected before clone/ls-remote", async () => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  databases.push(db);
  const repo = new SkillRepository(db, new SecretStore(Buffer.alloc(32, 5)));
  const dataDir = path.join(os.tmpdir(), `skills-ssrf-dns-${Math.random().toString(36).slice(2)}`);
  // Resolver injected: the public name resolves to an RFC-1918 private address.
  const privateLookup = async () => [{ address: "10.0.0.5", family: 4 }];
  const git = new SkillGitService(repo, {
    dataDir,
    tokenProfile: "generic_o200k",
    lookup: privateLookup,
  });

  // probe → thrown 400 (not a soft probeFailure).
  await assert.rejects(
    git.probe("https://public-name.example", "main"),
    (err: Error & { statusCode?: number }) => {
      assert.equal(err.statusCode, 400);
      assert.match(err.message, /not allowed|loopback|private/i);
      return true;
    },
  );

  // import → thrown 400 before any skill row is created.
  await assert.rejects(
    git.importSkill({ repoUrl: "https://public-name.example", ref: "main", subpath: "" }),
    (err: Error & { statusCode?: number }) => {
      assert.equal(err.statusCode, 400);
      return true;
    },
  );

  // upstream (ls-remote) → thrown 400 too. Seed a github-bound skill row directly so `upstream` runs.
  db.prepare(
    `INSERT INTO skills (id, name, display_name, slug, source_type, github_repo_url, github_ref, github_subpath, created_at, updated_at)
     VALUES ('sk-ssrf', 'x', 'x', 'x-ssrf', 'github', 'https://public-name.example', 'main', '', '2026-01-01', '2026-01-01')`,
  ).run();
  await assert.rejects(git.upstream("sk-ssrf"), (err: Error & { statusCode?: number }) => {
    assert.equal(err.statusCode, 400);
    return true;
  });
});

test("SSRF: the probe route surfaces a 400 for a file:// repo URL", async () => {
  const app = await buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/api/skills/probe",
    payload: { repoUrl: "file:///etc/passwd", ref: "main" },
  });
  assert.equal(res.statusCode, 400);
});

// (d) Regression guard: a normal small skill zip still ingests successfully.
test("regression: a normal small skill zip still ingests → 201 with a v1", async () => {
  const app = await buildApp();
  const content = zipBytes({
    "SKILL.md": enc(SKILL_MD),
    "references/API.md": enc("reference doc"),
  });
  const res = await uploadZip(app, content);
  assert.equal(res.statusCode, 201);
  const skill = res.json();
  assert.equal(skill.sourceType, "upload");
  assert.equal(skill.versionCount, 1);
  assert.equal(skill.description, "Work with PDF files.");

  const files = (
    await app.inject({ url: `/api/skills/${skill.id}/versions/${skill.currentVersionId}/files` })
  ).json();
  assert.deepEqual(files.map((f: { path: string }) => f.path).sort(), [
    "SKILL.md",
    "references/API.md",
  ]);
});
