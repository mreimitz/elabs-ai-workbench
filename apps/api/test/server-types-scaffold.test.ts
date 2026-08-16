import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import type { ScaffoldFromServerResult } from "@mcp-token-footprint/shared";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { ScanRepository, type ToolScanInsert } from "../src/scans/repository.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { ServerTypeRepository } from "../src/server-types/repository.js";
import { ServerRepository } from "../src/servers/repository.js";
import { SkillBindingRepository } from "../src/skills/binding-repository.js";
import { SkillGitService } from "../src/skills/git-service.js";
import { SkillIngestService } from "../src/skills/ingest-service.js";
import { parseSkillManifest } from "../src/skills/manifest.js";
import { SkillPublishService } from "../src/skills/publish-service.js";
import { SkillRepository } from "../src/skills/repository.js";
import { registerSkillRoutes } from "../src/skills/routes.js";
import { toErrorMessage } from "../src/utils/errors.js";

// Server-types WP 3.2 (B) — scaffold a NEW skill from a TYPE. The additive `bindTypeName` makes the
// scaffolded skill's frontmatter `servers:` name the TYPE (bound to the type, not one box); the
// `serverId` is only the type's D-ST3 representative (the tool surface). Covers: the type name lands in
// frontmatter + no persisted override + the returned bindings resolve the type → representative
// (typeId/resolvedVia:"type"); a type-name that ALSO matches a server name is refused (400); an unknown
// type is refused (400); no serverTypes DI ⇒ refused (400); and a plain scaffold (no bindTypeName) still
// binds the source SERVER (byte-identical regression).

const dbs: AppDatabase[] = [];
const apps: FastifyInstance[] = [];

afterEach(async () => {
  for (const db of dbs.splice(0)) db.close();
  for (const app of apps.splice(0)) await app.close();
});

function track(db: AppDatabase): AppDatabase {
  dbs.push(db);
  return db;
}

type Harness = {
  app: FastifyInstance;
  repo: SkillRepository;
  serverRepo: ServerRepository;
  bindingRepo: SkillBindingRepository;
  scans: ScanRepository;
  types: ServerTypeRepository;
  db: AppDatabase;
};

async function buildApp(opts: { withTypes?: boolean } = {}): Promise<Harness> {
  const withTypes = opts.withTypes ?? true;
  const db = track(new Database(":memory:"));
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);

  const secrets = new SecretStore(Buffer.alloc(32, 7));
  const repo = new SkillRepository(db, secrets);
  const serverRepo = new ServerRepository(db, secrets);
  const bindingRepo = new SkillBindingRepository(db);
  const scans = new ScanRepository(db);
  const types = new ServerTypeRepository(db);
  const dataDir = path.join(
    os.tmpdir(),
    `server-types-scaffold-${Math.random().toString(36).slice(2)}`,
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
  if (withTypes) {
    await registerSkillRoutes(app, repo, ingest, git, publish, bindingRepo, serverRepo, scans, types);
  } else {
    await registerSkillRoutes(app, repo, ingest, git, publish, bindingRepo, serverRepo, scans);
  }
  await app.ready();
  apps.push(app);
  return { app, repo, serverRepo, bindingRepo, scans, types, db };
}

const seedServer = (serverRepo: ServerRepository, name: string, typeId?: string) =>
  serverRepo.create({ name, transport: "stdio", command: "echo", typeId }).id;

function toolInsert(name: string, totalTokens: number, description?: string): ToolScanInsert {
  return {
    toolName: name,
    description,
    inputSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
    annotations: undefined,
    rawTool: { name },
    totalTokens,
    nameTokens: 2,
    descriptionTokens: 4,
    schemaTokens: 6,
    annotationsTokens: 0,
    rawBytes: 64,
    contributionPercent: 0,
  };
}

function seedScan(
  db: AppDatabase,
  scans: ScanRepository,
  serverId: string,
  opts: { scannedAt: string; status: "success" | "failed"; tools?: ToolScanInsert[] },
): string {
  const running = scans.createRunningScan(serverId, "generic_o200k");
  db.prepare("UPDATE mcp_scans SET scanned_at = ? WHERE id = ?").run(opts.scannedAt, running.id);
  if (opts.status === "success") {
    const tools = opts.tools ?? [];
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
  } else {
    scans.failScan(running.id, "boom");
  }
  return running.id;
}

async function scaffold(app: FastifyInstance, body: unknown) {
  return app.inject({ method: "POST", url: "/api/skills/scaffold-from-server", payload: body });
}

// ── (1) Scaffold-from-type — the TYPE name lands in frontmatter; bindings resolve to the representative

test("scaffold-from-type writes the TYPE NAME into frontmatter and resolves to the representative", async () => {
  const { app, repo, serverRepo, scans, types, db } = await buildApp();
  const saas = types.create({ name: "Qlik-SaaS" });
  const member = seedServer(serverRepo, "Qlik Prod A", saas.id);
  seedScan(db, scans, member, {
    scannedAt: "2026-01-01T00:00:00.000Z",
    status: "success",
    tools: [
      toolInsert("get_app", 40, "Fetches an app."),
      toolInsert("list_apps", 55, "Lists apps."),
    ],
  });

  const res = await scaffold(app, {
    serverId: member, // the client-resolved D-ST3 representative (only the tool surface)
    name: "qlik-helper",
    bindTypeName: "Qlik-SaaS", // ← binds the TYPE
    tools: ["get_app"],
  });
  assert.equal(res.statusCode, 201, res.body);
  const result = res.json() as ScaffoldFromServerResult;

  // The frontmatter `servers:` names the TYPE, not the source server.
  const versionId = repo.getPublic(result.skill.id).currentVersionId!;
  const md = repo.getFileContent(versionId, "SKILL.md");
  assert.ok(!md.isBinary && md.text);
  const parsed = parseSkillManifest(md.text ?? "");
  assert.deepEqual(parsed.manifest.servers, ["Qlik-SaaS"], "frontmatter binds the TYPE name");

  // The returned bindings resolve the type name → representative (additive type metadata present) —
  // and NO persisted override was created (type resolution is dynamic).
  assert.deepEqual(result.bindings, [
    { serverName: "Qlik-SaaS", serverId: member, typeId: saas.id, resolvedVia: "type" },
  ]);
});

test("scaffold-from-type: the representative with NO successful scan among members still binds by name (honest unbound)", async () => {
  // A two-member type: memberA sourced the tools (its scan is the D-ST3 rep at scaffold time). The
  // binding response reflects live D-ST3 resolution over the current scans.
  const { app, repo, serverRepo, scans, types, db } = await buildApp();
  const saas = types.create({ name: "Qlik-SaaS" });
  const a = seedServer(serverRepo, "A", saas.id);
  const b = seedServer(serverRepo, "B", saas.id);
  seedScan(db, scans, a, {
    scannedAt: "2026-02-01T00:00:00.000Z",
    status: "success",
    tools: [toolInsert("t", 10, "One.")],
  });
  seedScan(db, scans, b, { scannedAt: "2026-01-01T00:00:00.000Z", status: "success", tools: [toolInsert("t", 10)] });

  const res = await scaffold(app, {
    serverId: a, // A is the newest-success representative
    name: "qh",
    bindTypeName: "Qlik-SaaS",
    tools: ["t"],
  });
  assert.equal(res.statusCode, 201, res.body);
  const result = res.json() as ScaffoldFromServerResult;
  assert.equal(result.bindings[0]?.serverId, a, "resolves to the newest-success member (A)");
  assert.equal(result.bindings[0]?.resolvedVia, "type");
});

// ── (2) A type name that ALSO matches a registered server name is refused (WP 3.1 precedence) ─────

test("scaffold-from-type 400s when the type name is ALSO a registered server name (would shadow the type)", async () => {
  const { app, serverRepo, scans, types, db } = await buildApp();
  const shared = types.create({ name: "Shared" });
  const member = seedServer(serverRepo, "member", shared.id);
  seedScan(db, scans, member, {
    scannedAt: "2026-01-01T00:00:00.000Z",
    status: "success",
    tools: [toolInsert("t", 10, "One.")],
  });
  seedServer(serverRepo, "Shared"); // a real server literally named "Shared"

  const res = await scaffold(app, {
    serverId: member,
    name: "s",
    bindTypeName: "Shared",
    tools: ["t"],
  });
  assert.equal(res.statusCode, 400, res.body);
  assert.match((res.json() as { error: string }).error, /also a registered server name/i);
});

// ── (3) Unknown type name → 400; no serverTypes DI ⇒ 400 ──────────────────────────────────────────

test("scaffold-from-type 400s on an unknown type name", async () => {
  const { app, serverRepo, scans, db } = await buildApp();
  const member = seedServer(serverRepo, "member");
  seedScan(db, scans, member, {
    scannedAt: "2026-01-01T00:00:00.000Z",
    status: "success",
    tools: [toolInsert("t", 10, "One.")],
  });
  const res = await scaffold(app, {
    serverId: member,
    name: "s",
    bindTypeName: "Nope-Type",
    tools: ["t"],
  });
  assert.equal(res.statusCode, 400, res.body);
  assert.match((res.json() as { error: string }).error, /unknown server type/i);
});

test("scaffold-from-type 400s (unknown type) when the ServerTypeRepository DI is not wired", async () => {
  const { app, serverRepo, scans, types, db } = await buildApp({ withTypes: false });
  const saas = types.create({ name: "Qlik-SaaS" });
  const member = seedServer(serverRepo, "member", saas.id);
  seedScan(db, scans, member, {
    scannedAt: "2026-01-01T00:00:00.000Z",
    status: "success",
    tools: [toolInsert("t", 10, "One.")],
  });
  const res = await scaffold(app, {
    serverId: member,
    name: "s",
    bindTypeName: "Qlik-SaaS",
    tools: ["t"],
  });
  assert.equal(res.statusCode, 400, res.body, "no serverTypes DI ⇒ the type can't be resolved");
});

// ── (4) A plain scaffold (no bindTypeName) still binds the SOURCE server (byte-identical regression) ─

test("scaffold-from-server (no bindTypeName) still binds the source server — unchanged", async () => {
  const { app, serverRepo, scans, db } = await buildApp();
  const alpha = seedServer(serverRepo, "Alpha");
  seedScan(db, scans, alpha, {
    scannedAt: "2026-01-01T00:00:00.000Z",
    status: "success",
    tools: [toolInsert("get_widget", 40, "Fetches a widget.")],
  });
  const res = await scaffold(app, { serverId: alpha, name: "wh", tools: ["get_widget"] });
  assert.equal(res.statusCode, 201, res.body);
  const result = res.json() as ScaffoldFromServerResult;
  assert.deepEqual(
    result.bindings,
    [{ serverName: "Alpha", serverId: alpha }],
    "an omitted bindTypeName keeps the plain server binding (no type metadata)",
  );
});