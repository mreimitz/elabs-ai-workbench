import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { SkillServerBinding } from "@mcp-token-footprint/shared";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { applyMigrations, LATEST_SCHEMA_VERSION, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { ServerRepository } from "../src/servers/repository.js";
import { SkillBindingRepository } from "../src/skills/binding-repository.js";
import { parseSkillManifest } from "../src/skills/manifest.js";
import { SkillGitService } from "../src/skills/git-service.js";
import { SkillIngestService } from "../src/skills/ingest-service.js";
import { SkillPublishService } from "../src/skills/publish-service.js";
import { SkillRepository } from "../src/skills/repository.js";
import { registerSkillRoutes } from "../src/skills/routes.js";
import { toErrorMessage } from "../src/utils/errors.js";

// Skill IDE WP 8.1 (I9.1) — portable frontmatter `servers:` binding + exact-server resolution +
// `skill_server_bindings` (migration v17). Covers: the manifest `servers:` parse (order-preserving,
// byte-exact); the migration's forward-safety (fresh stamp + v16→v17 upgrade); the binding repository;
// the GET/PUT binding routes incl. the honest unbound (`serverId: null`) state; and the FK behaviors.

const here = path.dirname(fileURLToPath(import.meta.url));
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

const tableExists = (db: AppDatabase, name: string): boolean =>
  (
    db
      .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(name) as { n: number }
  ).n === 1;

// ── (1) Manifest `servers:` parsing — order-preserving, tolerant, byte-exact ─────────────────────

test("manifest: `servers:` is parsed as an order-preserving list (scalar OR list, trimmed, deduped)", () => {
  const listMd =
    "---\nname: s\ndescription: A binding fixture with a servers list.\nservers:\n  - Beta\n  - Alpha\n  - Beta\n  - '  '\n---\n\n# S\n";
  const parsed = parseSkillManifest(listMd);
  assert.deepEqual(
    parsed.manifest.servers,
    ["Beta", "Alpha"],
    "order preserved, dedup + empties dropped (NOT sorted)",
  );

  // A scalar string is tolerated as a single-element list (like keywords:).
  const scalar = parseSkillManifest(
    "---\nname: s\ndescription: One server scalar form.\nservers: solo\n---\n\n# S\n",
  );
  assert.deepEqual(scalar.manifest.servers, ["solo"]);
});

test("manifest: an absent `servers:` leaves the field unset; a non-string entry is ignored", () => {
  const none = parseSkillManifest(
    "---\nname: s\ndescription: No servers key at all here.\n---\n\n# S\n",
  );
  assert.equal(none.manifest.servers, undefined, "absent servers: → no field (tolerated metadata)");

  // Non-string list entries are skipped; the remaining strings survive in order.
  const mixed = parseSkillManifest(
    "---\nname: s\ndescription: Mixed servers list.\nservers:\n  - ok\n  - 42\n---\n\n# S\n",
  );
  assert.deepEqual(mixed.manifest.servers, ["ok"]);
});

test("manifest: parsing `servers:` is read-only — the SKILL.md body survives byte-exactly", () => {
  const md =
    "---\nname: s\ndescription: Byte-exactness of the frontmatter servers block.\nservers:\n  - Alpha\n  - Beta\n---\n\n# Body\n\nUntouched prose.\n";
  const parsed = parseSkillManifest(md);
  assert.deepEqual(parsed.manifest.servers, ["Alpha", "Beta"]);
  // The parser never re-serializes: the body after the frontmatter is returned verbatim, and re-parsing
  // is idempotent (same servers, same body) — the byte-exact round-trip guarantee for `servers:`.
  assert.equal(parsed.body, "# Body\n\nUntouched prose.\n");
  const again = parseSkillManifest(md);
  assert.deepEqual(again.manifest.servers, parsed.manifest.servers);
  assert.equal(again.body, parsed.body);
});

// ── (2) Migration v17 — forward-safety: fresh stamp + v16 → v17 upgrade gains the table ──────────

test("migration v17 — a fresh DB stamps at LATEST (17) and carries skill_server_bindings", () => {
  const db = track(new Database(":memory:"));
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);

  assert.equal(
    LATEST_SCHEMA_VERSION,
    57,
    "LATEST auto-derived to 55 (…v19 suite-run member index + v20 assistant tables + v21 assistant_settings + v22 suite_run_reports + v23 provider_credentials server link + v24 scenarios.answers_mode + v25 server_types + v26 rating_issues + v27 rating_state + v28 provider_credentials claude_subscription kind + v29 runs.cost_basis + v30 rating_issue_occurrences concrete evidence + v31 unified-sessions runs columns + v32 observability metrics indexes; v33 observability FTS5 search index + v34 run_views + v35 runs.pinned + v36 run_feedback + v37 run_steps hierarchy + v38 watch_rules + v39 watch_rules.last_evaluated_at + v40 notifications + v41 fleet issue aggregation + v42 runs fork lineage + v43 digest reports + v44 model pricing + v45 dashboard charts + v46 review_rubrics; v47 = hub_* tables, Assistant Hub WP0.2; v48 = hub_session_skills, Assistant Hub WP2.4; v49 = hub_memory.scope/scope_id + hub_agents.display_name + hub_crews.color + hub_sessions.archived_at, Assistant Hub UX WP1.0s; v50 = hub_sessions.tool_scope_json, end-user UX pass; v54 = hub_missions.parent_mission_id/depth/root_mission_id, crew-nesting mission-tree lineage; v55 = hub_sessions/hub_agents.provider_credential_id, model identity D-MI1; v56 = the acme_answers provider kind removed (purge + narrowed kind CHECK, mcp_server_id + scenarios.answers_mode dropped))",
  );
  assert.equal(db.pragma("user_version", { simple: true }), 57, "fresh DB stamped at 57");
  assert.ok(
    tableExists(db, "skill_server_bindings"),
    "fresh DB has the skill_server_bindings table",
  );

  const cols = db.prepare("PRAGMA table_info(skill_server_bindings)").all() as Array<{
    name: string;
    pk: number;
  }>;
  assert.deepEqual(cols.map((c) => c.name).sort(), ["server_id", "server_name", "skill_id"]);
  // The composite primary key is (skill_id, server_name).
  const pk = cols
    .filter((c) => c.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map((c) => c.name);
  assert.deepEqual(pk, ["skill_id", "server_name"], "PRIMARY KEY (skill_id, server_name)");
});

test("migration v17 — a v16 DB WITHOUT the table gains it when applyMigrations runs (forward-safe)", () => {
  const db = track(new Database(":memory:"));
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql); // everything at latest, incl. skill_server_bindings…
  db.exec("DROP TABLE skill_server_bindings"); // …then simulate a pre-v17 (v16) DB lacking it
  db.pragma("user_version = 16");
  assert.ok(!tableExists(db, "skill_server_bindings"), "sanity: the v16 fixture lacks the table");

  applyMigrations(db); // v17 (> 16) creates the table, then v18…v46 add their own changes

  assert.equal(
    db.pragma("user_version", { simple: true }),
    LATEST_SCHEMA_VERSION,
    "stamped to LATEST (57) after the v17 + v18 + v19 + v20 + v21 + v22 + v23 + v24 + v25 + v26 + v27 + v28 + v29 + v30 + v31 + v32 + v33 + v34 + v35 + v36 + v37 + v38 + v39 + v40 + v41 + v42 + v43 + v44 + v45 + v46 steps",
  );
  assert.ok(
    tableExists(db, "skill_server_bindings"),
    "v17 migration created the table on the existing DB",
  );
});

// ── (3) SkillBindingRepository — persistence round-trip incl. the unbound (null) state ───────────

function seedSkillWithServers(repo: SkillRepository, servers: string[] | undefined): string {
  const skill = repo.create({ name: "binding-skill", sourceType: "upload" });
  const frontmatter = servers ? `servers:\n${servers.map((s) => `  - ${s}`).join("\n")}\n` : "";
  const md = `---\nname: binding-skill\ndescription: A fixture for the WP 8.1 server-binding routes.\n${frontmatter}---\n\n# Binding Skill\n\nBody.\n`;
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

test("SkillBindingRepository: replaceForSkill upserts rows and listForSkill round-trips (incl. null)", () => {
  const db = track(new Database(":memory:"));
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  const secrets = new SecretStore(Buffer.alloc(32, 7));
  const repo = new SkillRepository(db, secrets);
  const serverRepo = new ServerRepository(db, secrets);
  const bindings = new SkillBindingRepository(db);
  // Real registered servers — the server_id FK (foreign_keys = ON) requires them to exist.
  const alpha = serverRepo.create({ name: "Alpha", transport: "stdio", command: "echo" }).id;
  const alpha2 = serverRepo.create({ name: "Alpha2", transport: "stdio", command: "echo" }).id;
  const skillId = seedSkillWithServers(repo, ["Alpha", "Beta"]);

  bindings.replaceForSkill(skillId, [
    { serverName: "Alpha", serverId: alpha },
    { serverName: "Beta", serverId: null }, // explicit unbound
  ]);
  assert.deepEqual(bindings.listForSkill(skillId), [
    { serverName: "Alpha", serverId: alpha },
    { serverName: "Beta", serverId: null },
  ]);

  // REPLACE semantics: a second replace fully supersedes the first set.
  bindings.replaceForSkill(skillId, [{ serverName: "Alpha", serverId: alpha2 }]);
  assert.deepEqual(bindings.listForSkill(skillId), [{ serverName: "Alpha", serverId: alpha2 }]);
});

// ── (4) Binding routes — GET/PUT round-trip, unbound state, resolution, FK behavior, guards ──────

async function buildApp() {
  const db = track(new Database(":memory:"));
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);

  const secrets = new SecretStore(Buffer.alloc(32, 7));
  const repo = new SkillRepository(db, secrets);
  const serverRepo = new ServerRepository(db, secrets);
  const bindingRepo = new SkillBindingRepository(db);
  const dataDir = path.join(
    os.tmpdir(),
    `skill-ide-binding-test-${Math.random().toString(36).slice(2)}`,
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
  await registerSkillRoutes(app, repo, ingest, git, publish, bindingRepo, serverRepo);
  await app.ready();
  apps.push(app);
  return { app, repo, serverRepo, bindingRepo };
}

const seedServer = (serverRepo: ServerRepository, name: string) =>
  serverRepo.create({ name, transport: "stdio", command: "echo" }).id;

const getBindings = async (app: FastifyInstance, id: string) => {
  const res = await app.inject({ url: `/api/skills/${id}/bindings` });
  assert.equal(res.statusCode, 200, res.body);
  return res.json() as SkillServerBinding[];
};

const putBindings = (app: FastifyInstance, id: string, bindings: SkillServerBinding[]) =>
  app.inject({ method: "PUT", url: `/api/skills/${id}/bindings`, payload: { bindings } });

test("GET /bindings auto-resolves frontmatter `servers:` names to registered servers (unmatched → null)", async () => {
  const { app, repo, serverRepo } = await buildApp();
  const alpha = seedServer(serverRepo, "Alpha"); // Beta is deliberately NOT registered
  const skillId = seedSkillWithServers(repo, ["Alpha", "Beta"]);

  const bindings = await getBindings(app, skillId);
  assert.deepEqual(
    bindings,
    [
      { serverName: "Alpha", serverId: alpha }, // auto-resolved by exact name
      { serverName: "Beta", serverId: null }, // no registered "Beta" → honest unbound (never guessed)
    ],
    "frontmatter order preserved; unmatched name resolves to null",
  );
});

test("PUT then GET /bindings round-trips the binding set including the explicit unbound (null) state", async () => {
  const { app, repo, serverRepo } = await buildApp();
  const alpha = seedServer(serverRepo, "Alpha");
  const beta = seedServer(serverRepo, "Beta");
  const skillId = seedSkillWithServers(repo, ["Alpha", "Beta", "Gamma"]);

  // Explicitly bind Alpha, bind Beta, and leave Gamma unbound (null).
  const desired: SkillServerBinding[] = [
    { serverName: "Alpha", serverId: alpha },
    { serverName: "Beta", serverId: beta },
    { serverName: "Gamma", serverId: null },
  ];
  const put = await putBindings(app, skillId, desired);
  assert.equal(put.statusCode, 200, put.body);
  assert.deepEqual(put.json(), desired, "PUT echoes the resolved set");

  // GET reflects the persisted overrides (a stored override wins over auto-resolution; null round-trips).
  assert.deepEqual(
    await getBindings(app, skillId),
    desired,
    "PUT → GET round-trips (incl. the unbound Gamma)",
  );
});

test("PUT /bindings rejects a non-null serverId that names no registered server (400, never a 500 FK error)", async () => {
  const { app, repo, serverRepo } = await buildApp();
  seedServer(serverRepo, "Alpha");
  const skillId = seedSkillWithServers(repo, ["Alpha"]);

  const res = await putBindings(app, skillId, [
    { serverName: "Alpha", serverId: "srv-does-not-exist" },
  ]);
  assert.equal(res.statusCode, 400, res.body);
  assert.match((res.json() as { error: string }).error, /Unknown serverId/);
});

test("bindings FK: deleting a bound server SET-NULLs the binding (honest unbound, not dangling)", async () => {
  const { app, repo, serverRepo, bindingRepo } = await buildApp();
  const alpha = seedServer(serverRepo, "Alpha");
  const skillId = seedSkillWithServers(repo, ["Alpha"]);
  await putBindings(app, skillId, [{ serverName: "Alpha", serverId: alpha }]);
  assert.deepEqual(bindingRepo.listForSkill(skillId), [{ serverName: "Alpha", serverId: alpha }]);

  serverRepo.delete(alpha); // ON DELETE SET NULL
  assert.deepEqual(
    bindingRepo.listForSkill(skillId),
    [{ serverName: "Alpha", serverId: null }],
    "the binding survives as unbound (server_id SET NULL), never dangling",
  );
});

test("bindings FK: deleting a skill CASCADE-drops its bindings", async () => {
  const { app, repo, serverRepo, bindingRepo } = await buildApp();
  const alpha = seedServer(serverRepo, "Alpha");
  const skillId = seedSkillWithServers(repo, ["Alpha"]);
  await putBindings(app, skillId, [{ serverName: "Alpha", serverId: alpha }]);

  repo.delete(skillId); // ON DELETE CASCADE
  assert.deepEqual(bindingRepo.listForSkill(skillId), [], "the skill's bindings cascaded away");
});

test("GET/PUT /bindings on an unknown skill 404s", async () => {
  const { app } = await buildApp();
  assert.equal((await app.inject({ url: "/api/skills/nope/bindings" })).statusCode, 404);
  assert.equal((await putBindings(app, "nope", [])).statusCode, 404);
});

test("GET /bindings on a skill with no `servers:` frontmatter is an empty set (honest, not an error)", async () => {
  const { app, repo } = await buildApp();
  const skillId = seedSkillWithServers(repo, undefined);
  assert.deepEqual(await getBindings(app, skillId), [], "no servers: → no bindings");
});

// ── (5) Purity — the binding-repository owns only its table (no MCP/secret decryption) ────────────

test("never-execute: binding-repository.ts opens no MCP session and decrypts no secret", () => {
  const source = fs.readFileSync(path.resolve(here, "../src/skills/binding-repository.ts"), "utf8");
  for (const pattern of [/openSession/, /callTool/, /child_process/, /SecretStore/, /decrypt/]) {
    assert.ok(!pattern.test(source), `binding-repository.ts must not reference ${pattern}`);
  }
});
