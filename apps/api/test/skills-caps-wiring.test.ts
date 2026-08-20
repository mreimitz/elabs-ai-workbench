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
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { ScanRepository, type ToolScanInsert } from "../src/scans/repository.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { ServerRepository } from "../src/servers/repository.js";
import type { IngestCaps } from "../src/skills/caps.js";
import { SkillBindingRepository } from "../src/skills/binding-repository.js";
import { SkillGitService } from "../src/skills/git-service.js";
import { SkillIngestService } from "../src/skills/ingest-service.js";
import { SkillPublishService } from "../src/skills/publish-service.js";
import { SkillRepository } from "../src/skills/repository.js";
import { registerSkillRoutes } from "../src/skills/routes.js";
import { toErrorMessage } from "../src/utils/errors.js";

// H-4 (planning/Research/RS-07-full-validation/notes/02-api-review.md) — `registerSkillRoutes` now takes an optional
// `options.caps`, mirroring how `registerSkillflowRoutes` already receives `skillCaps`
// (skill-ide-tree-ops-caps.test.ts covers that route). Before this fix, save-draft's tree-op apply
// and BOTH scaffold create paths (blank + server) always fell back to the compiled-in
// `DEFAULT_INGEST_CAPS`, silently ignoring a tightened `SKILL_MAX_*` env override even though every
// one of these routes accepts caller-supplied file content. These tests prove a LOW cap threaded
// through `options.caps` actually rejects an oversize request on each path, and that the route stays
// permissive under its default (no `caps` wired) — the exact regression guard the H-4 fix requires.

const here = path.dirname(fileURLToPath(import.meta.url));
const skillsDir = path.join(here, "fixtures/skillflow/skills");

const apps: FastifyInstance[] = [];
const databases: AppDatabase[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const db of databases.splice(0)) db.close();
});

type Harness = {
  app: FastifyInstance;
  repo: SkillRepository;
  serverRepo: ServerRepository;
  scans: ScanRepository;
  db: AppDatabase;
};

/** Build an app wiring `registerSkillRoutes` with a specific `options.caps` (undefined ⇒ the route
 *  default). The seeding `ingest`/`git` services are ALWAYS built with generous (default) caps, so a
 *  tight `caps` here only constrains the save-draft / scaffold paths under test — never the fixture
 *  upload used to seed a base skill. */
async function buildApp(caps?: IngestCaps): Promise<Harness> {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  databases.push(db);

  const secrets = new SecretStore(Buffer.alloc(32, 7));
  const repo = new SkillRepository(db, secrets);
  const serverRepo = new ServerRepository(db, secrets);
  const bindingRepo = new SkillBindingRepository(db);
  const scans = new ScanRepository(db);
  const dataDir = path.join(os.tmpdir(), `skills-caps-wiring-${Math.random().toString(36).slice(2)}`);
  const ingest = new SkillIngestService(repo, { dataDir, tokenProfile: "generic_o200k" });
  const git = new SkillGitService(repo, { dataDir, tokenProfile: "generic_o200k" });
  const publish = new SkillPublishService(repo, { dataDir });

  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: "Validation failed" });
    const typed = error as Error & { statusCode?: number };
    return reply.code(typed.statusCode ?? 500).send({ error: toErrorMessage(error) });
  });
  // The unit under test: the route accepts (and applies) an injected `caps` via `options.caps`.
  await registerSkillRoutes(app, repo, ingest, git, publish, bindingRepo, serverRepo, scans, undefined, {
    caps,
  });
  await app.ready();
  apps.push(app);
  return { app, repo, serverRepo, scans, db };
}

// A tight per-file cap that a real scaffolded/edited SKILL.md always exceeds; file-count/total caps
// stay generous so ONLY the per-file cap can trip — proving the injected `caps` is what the routes use.
const TIGHT_PER_FILE: IngestCaps = { maxFiles: 1000, maxFileBytes: 20, maxTotalBytes: 50_000_000 };

// --- save-draft: the tree-op apply (applyTreeOps) honors options.caps -----------------------------

const BOUNDARY = "----skillsCapsWiringBoundary";

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
        "Content-Type: application/zip\r\n\r\n",
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

test("save-draft: a low options.caps rejects an oversize add_file treeOp (400)", async () => {
  const { app } = await buildApp(TIGHT_PER_FILE);
  const skill = await seedSkill(app, "zero-annotation");

  const res = await app.inject({
    method: "POST",
    url: `/api/skills/${skill.id}/save-draft`,
    payload: {
      baseVersionId: skill.currentVersionId,
      content: "---\nname: data-report\ndescription: unchanged\n---\n\nbody\n",
      // 30 bytes of content > the 20-byte per-file cap.
      treeOps: [{ op: "add_file", path: "references/note.md", content: "0".repeat(30) }],
      intentLog: [],
    },
  });
  assert.equal(res.statusCode, 400, res.body);
  assert.match(res.json().error as string, /per-file/i);

  // Nothing persisted — the cap breach is caught before createVersion.
  const versions = (await app.inject({ url: `/api/skills/${skill.id}/versions` })).json();
  assert.equal(versions.length, 1, "no new version persisted when the injected cap rejects the add");
});

test("save-draft: the SAME add_file succeeds under the route's DEFAULT caps (no caps wired)", async () => {
  const { app } = await buildApp(undefined);
  const skill = await seedSkill(app, "zero-annotation");

  const res = await app.inject({
    method: "POST",
    url: `/api/skills/${skill.id}/save-draft`,
    payload: {
      baseVersionId: skill.currentVersionId,
      content: "---\nname: data-report\ndescription: unchanged\n---\n\nbody\n",
      treeOps: [{ op: "add_file", path: "references/note.md", content: "0".repeat(30) }],
      intentLog: [],
    },
  });
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(res.json().version.seq, 2);
});

// --- Blank-skill create (POST /api/skills, source:"blank") honors options.caps --------------------

test("blank-skill scaffold: a low options.caps rejects the scaffolded SKILL.md (400)", async () => {
  const { app } = await buildApp(TIGHT_PER_FILE);

  const res = await app.inject({
    method: "POST",
    url: "/api/skills",
    payload: {
      source: "blank",
      name: "widget-helper",
      description: "A brand-new skill that is definitely longer than twenty bytes of content.",
    },
  });
  assert.equal(res.statusCode, 400, res.body);
  assert.match(res.json().error as string, /per-file/i);

  const list = (await app.inject({ url: "/api/skills" })).json();
  assert.equal(list.length, 0, "no skill shell left behind after a rejected blank scaffold");
});

test("blank-skill scaffold: the SAME body succeeds under the route's DEFAULT caps (no caps wired)", async () => {
  const { app } = await buildApp(undefined);

  const res = await app.inject({
    method: "POST",
    url: "/api/skills",
    payload: {
      source: "blank",
      name: "widget-helper",
      description: "A brand-new skill that is definitely longer than twenty bytes of content.",
    },
  });
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(res.json().name, "widget-helper");
});

// --- Server scaffold (POST /api/skills/scaffold-from-server) honors options.caps -------------------

const seedServer = (serverRepo: ServerRepository, name: string) =>
  serverRepo.create({ name, transport: "stdio", command: "echo" }).id;

function toolInsert(name: string, description?: string): ToolScanInsert {
  return {
    toolName: name,
    description,
    inputSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
    annotations: undefined,
    rawTool: { name },
    totalTokens: 10,
    nameTokens: 2,
    descriptionTokens: 4,
    schemaTokens: 4,
    annotationsTokens: 0,
    rawBytes: 64,
    contributionPercent: 0,
  };
}

function seedScan(
  db: AppDatabase,
  scans: ScanRepository,
  serverId: string,
  tools: ToolScanInsert[],
): void {
  const running = scans.createRunningScan(serverId, "generic_o200k");
  const totalTokens = tools.reduce((sum, t) => sum + t.totalTokens, 0);
  scans.completeScan(
    running.id,
    {
      totalTools: tools.length,
      totalTokens,
      totalRawBytes: 100,
      averageTokensPerTool: tools.length ? totalTokens / tools.length : 0,
      largestToolName: tools[0]?.toolName ?? null,
      largestToolTokens: tools[0]?.totalTokens ?? 0,
      totalResources: 0,
      totalResourceTemplates: 0,
      totalPrompts: 0,
      totalResourceTokens: 0,
      totalPromptTokens: 0,
      largestResourceName: null,
      largestResourceTokens: 0,
      largestPromptName: null,
      largestPromptTokens: 0,
    },
    tools,
  );
}

test("server scaffold: a low options.caps rejects the scaffolded SKILL.md (400)", async () => {
  const { app, serverRepo, scans, db } = await buildApp(TIGHT_PER_FILE);
  const alpha = seedServer(serverRepo, "Alpha");
  seedScan(db, scans, alpha, [
    toolInsert("get_widget", "Fetches a widget by id. Returns the full record every time."),
  ]);

  const res = await app.inject({
    method: "POST",
    url: "/api/skills/scaffold-from-server",
    payload: { serverId: alpha, name: "widget-helper", tools: ["get_widget"] },
  });
  assert.equal(res.statusCode, 400, res.body);
  assert.match(res.json().error as string, /per-file/i);

  const list = (await app.inject({ url: "/api/skills" })).json();
  assert.equal(list.length, 0, "no skill shell left behind after a rejected server scaffold");
});

test("server scaffold: the SAME body succeeds under the route's DEFAULT caps (no caps wired)", async () => {
  const { app, serverRepo, scans, db } = await buildApp(undefined);
  const alpha = seedServer(serverRepo, "Alpha");
  seedScan(db, scans, alpha, [
    toolInsert("get_widget", "Fetches a widget by id. Returns the full record every time."),
  ]);

  const res = await app.inject({
    method: "POST",
    url: "/api/skills/scaffold-from-server",
    payload: { serverId: alpha, name: "widget-helper", tools: ["get_widget"] },
  });
  assert.equal(res.statusCode, 201, res.body);
  assert.equal((res.json() as { skill: { name: string } }).skill.name, "widget-helper");
});
