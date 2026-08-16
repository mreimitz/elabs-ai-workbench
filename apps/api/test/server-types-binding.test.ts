import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import type { SkillServerBinding } from "@mcp-token-footprint/shared";
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

// Server-types WP 3.1 (D-ST3) — `resolveBindings` learns TYPE names + representative-server selection.
// A skill's frontmatter `servers:` name that is a server TYPE (not a registered server) resolves to the
// type's REPRESENTATIVE member (the member with the newest successful scan; tiebreak newest scanned_at,
// then server id ASC), stamping the additive `typeId`/`resolvedVia:"type"` wire. Precedence is preserved
// exactly: a persisted override wins; an exact server name wins over a type and NEVER falls through to a
// type; ambiguity resolves to null, never a type-guess. Pure persisted reads — no MCP, no secrets.

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

// ── Harness: a skills app WITH both the ScanRepository and ServerTypeRepository DIs ────────────────

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
    `server-types-binding-${Math.random().toString(36).slice(2)}`,
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
  // The `serverTypes` DI is positioned after `scans` and before `options`. Omitting it (withTypes:false)
  // leaves type-resolution inert (a type-named entry degrades to honest-unbound).
  if (withTypes) {
    await registerSkillRoutes(
      app,
      repo,
      ingest,
      git,
      publish,
      bindingRepo,
      serverRepo,
      scans,
      types,
    );
  } else {
    await registerSkillRoutes(app, repo, ingest, git, publish, bindingRepo, serverRepo, scans);
  }
  await app.ready();
  apps.push(app);
  return { app, repo, serverRepo, bindingRepo, scans, types, db };
}

// ── Seeding helpers ────────────────────────────────────────────────────────────────────────────────

/** A skill whose SKILL.md frontmatter declares `servers:` (the names the resolver reads). */
function seedSkill(repo: SkillRepository, servers: string[] | undefined): string {
  const skill = repo.create({ name: "types-binding-skill", sourceType: "upload" });
  const frontmatter = servers ? `servers:\n${servers.map((s) => `  - ${s}`).join("\n")}\n` : "";
  const md = `---\nname: types-binding-skill\ndescription: A fixture for the WP 3.1 type-binding resolver.\n${frontmatter}---\n\n# Types Binding Skill\n\nBody.\n`;
  const parsed = parseSkillManifest(md);
  repo.createVersion(skill.id, [{ path: "SKILL.md", bytes: Buffer.from(md, "utf8") }], {
    sourceKind: "upload",
    importedFrom: "upload",
    manifest: parsed.manifest,
    manifestValid: parsed.valid,
    manifestErrors: parsed.errors,
  });
  return skill.id;
}

const seedServer = (serverRepo: ServerRepository, name: string, typeId?: string) =>
  serverRepo.create({ name, transport: "stdio", command: "echo", typeId }).id;

/** Seed one scan for a server at a CONTROLLED `scanned_at` (deterministic newest-first ordering). */
function seedScan(
  db: AppDatabase,
  scans: ScanRepository,
  serverId: string,
  opts: { scannedAt: string; status: "success" | "failed" | "running"; tools?: ToolScanInsert[] },
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
  } else if (opts.status === "failed") {
    scans.failScan(running.id, "boom");
  }
  return running.id;
}

const getBindings = async (app: FastifyInstance, id: string): Promise<SkillServerBinding[]> => {
  const res = await app.inject({ url: `/api/skills/${id}/bindings` });
  assert.equal(res.statusCode, 200, res.body);
  return res.json() as SkillServerBinding[];
};

const byName = (bindings: SkillServerBinding[]) =>
  new Map(bindings.map((b) => [b.serverName, b] as const));

// ── (1) A type name resolves to the representative member (newest successful scan) ────────────────

test("a frontmatter name that matches a TYPE resolves to the representative member (newest successful scan)", async () => {
  const { app, repo, serverRepo, scans, types, db } = await buildApp();
  const saas = types.create({ name: "Qlik-SaaS" });
  const older = seedServer(serverRepo, "Qlik A", saas.id);
  const newer = seedServer(serverRepo, "Qlik B", saas.id);
  // Both members have a success scan; `newer` also carries a NEWER FAILED scan (must be ignored — its
  // representative-candidate timestamp is its newest SUCCESS, not the later failure).
  seedScan(db, scans, older, { scannedAt: "2026-01-01T00:00:00.000Z", status: "success" });
  seedScan(db, scans, newer, { scannedAt: "2026-01-02T00:00:00.000Z", status: "success" });
  seedScan(db, scans, newer, { scannedAt: "2026-01-09T00:00:00.000Z", status: "failed" });

  const skillId = seedSkill(repo, ["Qlik-SaaS"]);
  const bindings = await getBindings(app, skillId);

  assert.deepEqual(bindings, [
    { serverName: "Qlik-SaaS", serverId: newer, typeId: saas.id, resolvedVia: "type" },
  ]);
});

test("type resolution is CASE-INSENSITIVE (frontmatter `qlik-saas` matches type `Qlik-SaaS`)", async () => {
  const { app, repo, serverRepo, scans, types, db } = await buildApp();
  const saas = types.create({ name: "Qlik-SaaS" });
  const member = seedServer(serverRepo, "Qlik A", saas.id);
  seedScan(db, scans, member, { scannedAt: "2026-01-01T00:00:00.000Z", status: "success" });

  const skillId = seedSkill(repo, ["qlik-saas"]);
  assert.deepEqual(await getBindings(app, skillId), [
    { serverName: "qlik-saas", serverId: member, typeId: saas.id, resolvedVia: "type" },
  ]);
});

// ── (2) Tiebreak determinism — newer scanned_at wins; equal scanned_at → lower id ─────────────────

test("tiebreak: two members with successful scans → the NEWER scanned_at is the representative", async () => {
  const { app, repo, serverRepo, scans, types, db } = await buildApp();
  const saas = types.create({ name: "Qlik-SaaS" });
  const a = seedServer(serverRepo, "Qlik A", saas.id);
  const b = seedServer(serverRepo, "Qlik B", saas.id);
  seedScan(db, scans, a, { scannedAt: "2026-03-01T00:00:00.000Z", status: "success" });
  seedScan(db, scans, b, { scannedAt: "2026-05-01T00:00:00.000Z", status: "success" }); // newer

  const skillId = seedSkill(repo, ["Qlik-SaaS"]);
  const bindings = await getBindings(app, skillId);
  assert.equal(bindings[0]?.serverId, b, "the member with the newer successful scan is chosen");
});

test("tiebreak: EQUAL scanned_at → the lower server id wins (deterministic)", async () => {
  const { app, repo, serverRepo, scans, types, db } = await buildApp();
  const saas = types.create({ name: "Qlik-SaaS" });
  const a = seedServer(serverRepo, "Qlik A", saas.id);
  const b = seedServer(serverRepo, "Qlik B", saas.id);
  const at = "2026-06-06T00:00:00.000Z";
  seedScan(db, scans, a, { scannedAt: at, status: "success" });
  seedScan(db, scans, b, { scannedAt: at, status: "success" }); // same instant → id tiebreak

  const expected = [a, b].sort()[0]; // lower id (string ASC)
  const skillId = seedSkill(repo, ["Qlik-SaaS"]);
  const bindings = await getBindings(app, skillId);
  assert.equal(bindings[0]?.serverId, expected, "the lower server id breaks a scanned_at tie");
});

// ── (3) A type with no successful-scan member → honest unbound (serverId null) ────────────────────

test("a TYPE whose members have NO successful scan → serverId null (honest unbound), typeId still set", async () => {
  const { app, repo, serverRepo, scans, types, db } = await buildApp();
  const saas = types.create({ name: "Qlik-SaaS" });
  const m1 = seedServer(serverRepo, "Qlik A", saas.id);
  const m2 = seedServer(serverRepo, "Qlik B", saas.id);
  // Members exist but only failed/running scans → no representative.
  seedScan(db, scans, m1, { scannedAt: "2026-01-01T00:00:00.000Z", status: "failed" });
  seedScan(db, scans, m2, { scannedAt: "2026-01-02T00:00:00.000Z", status: "running" });

  const skillId = seedSkill(repo, ["Qlik-SaaS"]);
  assert.deepEqual(await getBindings(app, skillId), [
    { serverName: "Qlik-SaaS", serverId: null, typeId: saas.id, resolvedVia: "type" },
  ]);
});

test("a TYPE with NO members at all → serverId null (honest unbound), typeId still set", async () => {
  const { app, repo, types } = await buildApp();
  const empty = types.create({ name: "Empty-Type" });
  const skillId = seedSkill(repo, ["Empty-Type"]);
  assert.deepEqual(await getBindings(app, skillId), [
    { serverName: "Empty-Type", serverId: null, typeId: empty.id, resolvedVia: "type" },
  ]);
});

// ── (4) A unique SERVER name still resolves to that server (existing behavior preserved) ──────────

test("a name matching a unique registered SERVER resolves to it — no typeId/resolvedVia (byte-identical)", async () => {
  const { app, repo, serverRepo, types } = await buildApp();
  types.create({ name: "Qlik-SaaS" }); // a type exists, but the frontmatter names the SERVER
  const alpha = seedServer(serverRepo, "Alpha");

  const skillId = seedSkill(repo, ["Alpha"]);
  assert.deepEqual(
    await getBindings(app, skillId),
    [{ serverName: "Alpha", serverId: alpha }],
    "an exact server match carries no additive type metadata",
  );
});

test("an exact SERVER name that ALSO matches a TYPE name resolves via the SERVER (no type fall-through)", async () => {
  const { app, repo, serverRepo, scans, types, db } = await buildApp();
  // A type AND a server share the name "Shared". Precedence step 2 (server) wins over step 3 (type).
  const shared = types.create({ name: "Shared" });
  const typeMember = seedServer(serverRepo, "Qlik A", shared.id);
  seedScan(db, scans, typeMember, { scannedAt: "2026-01-01T00:00:00.000Z", status: "success" });
  const serverNamedShared = seedServer(serverRepo, "Shared"); // an actual server literally named "Shared"

  const skillId = seedSkill(repo, ["Shared"]);
  assert.deepEqual(
    await getBindings(app, skillId),
    [{ serverName: "Shared", serverId: serverNamedShared }],
    "the exact server match wins; the resolver never falls through to the same-named type",
  );
});

// ── (5) Ambiguous server name → null (never a type-guess fallback) ────────────────────────────────

test("an AMBIGUOUS server name stays null and NEVER falls through to a same-named type", async () => {
  const { app, repo, serverRepo, scans, types, db } = await buildApp();
  const dupe = types.create({ name: "Dupe" }); // a type also named "Dupe"…
  const member = seedServer(serverRepo, "Qlik A", dupe.id);
  seedScan(db, scans, member, { scannedAt: "2026-01-01T00:00:00.000Z", status: "success" });
  // …and TWO registered servers both literally named "Dupe" → the server match is ambiguous.
  seedServer(serverRepo, "Dupe");
  seedServer(serverRepo, "Dupe");

  const skillId = seedSkill(repo, ["Dupe"]);
  assert.deepEqual(
    await getBindings(app, skillId),
    [{ serverName: "Dupe", serverId: null }],
    "ambiguous → honest null; the resolver does NOT guess the type's representative",
  );
});

test("a name matching neither a server nor a type → honest unbound (null, no type metadata)", async () => {
  const { app, repo, serverRepo } = await buildApp();
  seedServer(serverRepo, "Alpha");
  const skillId = seedSkill(repo, ["Ghost"]);
  assert.deepEqual(await getBindings(app, skillId), [{ serverName: "Ghost", serverId: null }]);
});

// ── (6) Additive wire — existing PUT round-trips; persisted override wins; redaction-safe ──────────

test("additive wire: an existing {serverName, serverId} PUT still round-trips unchanged", async () => {
  const { app, repo, serverRepo } = await buildApp();
  const alpha = serverRepo.create({ name: "Alpha", transport: "stdio", command: "echo" }).id;
  const skillId = seedSkill(repo, ["Alpha"]);

  const desired: SkillServerBinding[] = [{ serverName: "Alpha", serverId: alpha }];
  const put = await app.inject({
    method: "PUT",
    url: `/api/skills/${skillId}/bindings`,
    payload: { bindings: desired },
  });
  assert.equal(put.statusCode, 200, put.body);
  assert.deepEqual(
    put.json(),
    desired,
    "PUT echoes the resolved set byte-for-byte (no new fields)",
  );
  assert.deepEqual(await getBindings(app, skillId), desired, "PUT → GET round-trips");
});

test("a persisted override WINS over type resolution (precedence step 1)", async () => {
  const { app, repo, serverRepo, scans, types, bindingRepo, db } = await buildApp();
  const saas = types.create({ name: "Qlik-SaaS" });
  const member = seedServer(serverRepo, "Qlik A", saas.id);
  seedScan(db, scans, member, { scannedAt: "2026-01-01T00:00:00.000Z", status: "success" });
  const picked = serverRepo.create({ name: "Hand-Picked", transport: "stdio", command: "echo" }).id;

  const skillId = seedSkill(repo, ["Qlik-SaaS"]);
  // The developer explicitly bound the type-named entry to a specific server — the override wins.
  bindingRepo.replaceForSkill(skillId, [{ serverName: "Qlik-SaaS", serverId: picked }]);

  assert.deepEqual(
    await getBindings(app, skillId),
    [{ serverName: "Qlik-SaaS", serverId: picked }],
    "an explicit persisted pick wins and carries no type metadata",
  );
});

test("type binding response is redaction-safe — only binding fields, never server secrets/config", async () => {
  const { app, repo, serverRepo, scans, types, db } = await buildApp();
  const saas = types.create({ name: "Qlik-SaaS" });
  // A member whose env carries a secret; the binding response must never echo it.
  const member = serverRepo.create({
    name: "Qlik A",
    transport: "stdio",
    command: "echo",
    env: { API_KEY: "super-secret-value" },
    typeId: saas.id,
  }).id;
  seedScan(db, scans, member, { scannedAt: "2026-01-01T00:00:00.000Z", status: "success" });

  const skillId = seedSkill(repo, ["Qlik-SaaS"]);
  const res = await app.inject({ url: `/api/skills/${skillId}/bindings` });
  assert.equal(res.statusCode, 200, res.body);
  assert.ok(!res.body.includes("super-secret-value"), "no secret leaks into the binding response");
  const bindings = res.json() as SkillServerBinding[];
  for (const b of bindings) {
    assert.deepEqual(
      Object.keys(b).sort(),
      ["resolvedVia", "serverId", "serverName", "typeId"].sort(),
      "only the binding wire fields are present",
    );
  }
  assert.equal(bindings[0]?.serverId, member);
});

// ── (7) Degradation — no ServerTypeRepository DI ⇒ type resolution can't fire ──────────────────────

test("without the ServerTypeRepository DI, a type-named entry degrades to honest unbound", async () => {
  const { app, repo, serverRepo, scans, types, db } = await buildApp({ withTypes: false });
  const saas = types.create({ name: "Qlik-SaaS" });
  const member = seedServer(serverRepo, "Qlik A", saas.id);
  seedScan(db, scans, member, { scannedAt: "2026-01-01T00:00:00.000Z", status: "success" });

  const skillId = seedSkill(repo, ["Qlik-SaaS"]);
  assert.deepEqual(
    await getBindings(app, skillId),
    [{ serverName: "Qlik-SaaS", serverId: null }],
    "no serverTypes wired ⇒ type-resolution is inert; the name is honest-unbound (never a 500)",
  );
});

// ── (8) Multiple entries in one skill — server + type + unbound, order preserved ──────────────────

test("a skill mixing a server, a type, and an unresolved name resolves each independently (order kept)", async () => {
  const { app, repo, serverRepo, scans, types, db } = await buildApp();
  const saas = types.create({ name: "Qlik-SaaS" });
  const alpha = seedServer(serverRepo, "Alpha");
  const member = seedServer(serverRepo, "Qlik A", saas.id);
  seedScan(db, scans, member, { scannedAt: "2026-01-01T00:00:00.000Z", status: "success" });

  const skillId = seedSkill(repo, ["Alpha", "Qlik-SaaS", "Ghost"]);
  const bindings = await getBindings(app, skillId);
  assert.deepEqual(
    bindings.map((b) => b.serverName),
    ["Alpha", "Qlik-SaaS", "Ghost"],
    "frontmatter order preserved",
  );
  const map = byName(bindings);
  assert.deepEqual(map.get("Alpha"), { serverName: "Alpha", serverId: alpha });
  assert.deepEqual(map.get("Qlik-SaaS"), {
    serverName: "Qlik-SaaS",
    serverId: member,
    typeId: saas.id,
    resolvedVia: "type",
  });
  assert.deepEqual(map.get("Ghost"), { serverName: "Ghost", serverId: null });
});
